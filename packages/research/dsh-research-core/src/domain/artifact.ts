/**
 * The artifact envelope: one immutable, content-addressed version of one produced value.
 *
 * The run registry this replaces keyed artifacts by slug and held a single current value per
 * slug, so "the landscape map" named both a logical artifact and whatever revision currently
 * existed — which is why a report could not say which revision it had judged. Here the id names
 * the artifact and the version names the revision, a reference carries both plus the hash of the
 * bytes it meant, and the hash is what a report is checked against.
 *
 * WHAT AN ENVELOPE DOES NOT SAY. It does not say the value is correct, or that a gate passed it.
 * Those are `status` transitions made by a commit, and a report bound to the version — never a
 * property the artifact asserts about itself.
 */

import { createHash } from 'node:crypto'
import type {
  ArtifactId,
  ArtifactVersion,
  ContentHash,
  ProjectId,
  ProjectRevision,
  TaskAttemptId,
} from './ids.ts'
import { DOMAIN_ERROR_PREFIX } from './ids.ts'
import type { Provenance } from './provenance.ts'
import { isSourceAccess, isSourceClass } from './provenance.ts'
import type { DomainParseFailure, Parsed } from './ingress.ts'
import {
  accept,
  arrayField,
  asRecord,
  countField,
  isContentHash,
  numberField,
  refuse,
  stringField,
} from './ingress.ts'

/**
 * Where an artifact sits in its life.
 *
 * `staged` is the only status a worker can produce: a candidate exists and nothing has accepted
 * it. `committed` is set by the single commit point. `accepted` / `rejected` are gate outcomes
 * recorded against a version, and `stale` is published when an input version it depended on was
 * superseded. Nothing moves backwards; a re-run is a new version.
 */
export type ArtifactStatus = 'staged' | 'committed' | 'accepted' | 'rejected' | 'stale'

/** Every {@link ArtifactStatus}. */
export const ARTIFACT_STATUSES: readonly ArtifactStatus[] = [
  'staged',
  'committed',
  'accepted',
  'rejected',
  'stale',
]

/** The schema version this module writes and reads. A record declaring another one is refused
 *  rather than read with today's rules, because the fields it means are not known here. */
export const ARTIFACT_SCHEMA_VERSION = 1

/**
 * A pointer to one exact revision of one artifact.
 *
 * The hash is part of the reference, not decoration: a reference that named only
 * (id, version) would still resolve after a store lied about what that version contained.
 * Two references are the same reference only when all three parts agree.
 */
export interface ArtifactRef {
  readonly artifactId: ArtifactId
  readonly version: ArtifactVersion
  readonly contentHash: ContentHash
}

/** One immutable artifact revision. */
export interface ResearchArtifact {
  readonly artifactId: ArtifactId
  readonly version: ArtifactVersion
  readonly contentHash: ContentHash
  readonly schemaVersion: number
  /** What kind of thing this is, in the producer's vocabulary (`landscape-map`, `mvp-results`). */
  readonly kind: string
  readonly projectId: ProjectId
  readonly projectRevision: ProjectRevision
  /** The exact attempt that produced it, so a late result cannot be credited to a newer one. */
  readonly producerTaskAttemptId: TaskAttemptId
  /** Everything this revision was derived from. Empty is legal: a first artifact derives from none. */
  readonly inputRefs: ReadonlyArray<ArtifactRef>
  readonly provenance: Provenance
  readonly status: ArtifactStatus
  readonly createdAt: number
}

/**
 * Encode a value as canonical JSON: object keys sorted, arrays in order, nothing dropped.
 *
 * `JSON.stringify` alone is not enough to hash by, because two producers that build the same
 * object in a different insertion order stringify differently — the hash would then report two
 * identical values as different, and a reference check would refuse a value that had not changed.
 *
 * @param value - the value to encode.
 * @returns the canonical text, or undefined when the value holds something JSON cannot represent
 *   (a function, a symbol, `undefined`, a non-finite number, a bigint, a cycle) or an object whose
 *   own enumerable keys do not describe it (a `Map`, `Set`, `Date`, `RegExp`, typed array or
 *   `ArrayBuffer`). Refusing is the point: a `Map` has no own enumerable keys, so encoding one
 *   would produce `{}` and hash every map in the run to the same value.
 */
export function canonicalJson(value: unknown): string | undefined {
  return encode(value, new Set<object>())
}

function encode(value: unknown, seen: Set<object>): string | undefined {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : undefined
  if (typeof value !== 'object') return undefined
  if (seen.has(value)) return undefined
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const parts: string[] = []
      for (const item of value) {
        const part = encode(item, seen)
        if (part === undefined) return undefined
        parts.push(part)
      }
      return `[${parts.join(',')}]`
    }
    const proto: unknown = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return undefined
    const record = value as Record<string, unknown>
    const parts: string[] = []
    for (const key of Object.keys(record).sort()) {
      const part = encode(record[key], seen)
      if (part === undefined) return undefined
      parts.push(`${JSON.stringify(key)}:${part}`)
    }
    return `{${parts.join(',')}}`
  } finally {
    seen.delete(value)
  }
}

/**
 * The content hash of a value: SHA-256 over its canonical encoding.
 *
 * @param value - the value to hash.
 * @returns the hash, or the refusal naming why the value has no canonical encoding.
 */
export function contentHashOf(value: unknown): Parsed<ContentHash> {
  const text = canonicalJson(value)
  if (text === undefined) {
    return refuse(
      `${DOMAIN_ERROR_PREFIX}BAD_FIELD`,
      'value has no canonical JSON encoding — it holds a function, symbol, undefined, non-finite number, bigint or cycle, or an object whose own enumerable keys do not describe it (a Map, Set, Date, RegExp, typed array, ArrayBuffer or class instance) — refusing to hash a value that is not the one the producer made',
    )
  }
  return accept(createHash('sha256').update(text, 'utf8').digest('hex') as ContentHash)
}

/**
 * The reference an artifact can be pointed at by.
 *
 * @param artifact - the artifact.
 * @returns its id, version, and content hash.
 */
export function artifactRefOf(artifact: ResearchArtifact): ArtifactRef {
  return {
    artifactId: artifact.artifactId,
    version: artifact.version,
    contentHash: artifact.contentHash,
  }
}

/**
 * Whether two references point at the same revision of the same content.
 *
 * @param a - one reference.
 * @param b - the other.
 * @returns true when all three parts agree.
 */
export function sameArtifactRef(a: ArtifactRef, b: ArtifactRef): boolean {
  return a.artifactId === b.artifactId && a.version === b.version && a.contentHash === b.contentHash
}

/**
 * A stable one-line key for a reference: `artifactId@version#contentHash`.
 *
 * Used as a map key when resolving references, and in the refusals a reader sees, so the same
 * three facts appear in the same order wherever a reference is named.
 *
 * @param ref - the reference to key.
 * @returns the key.
 */
export function artifactRefKey(ref: ArtifactRef): string {
  return `${ref.artifactId}@${String(ref.version)}#${ref.contentHash}`
}

/**
 * Whether every reference resolves, against the versions a caller can actually read.
 *
 * The invariant this checks is the one that makes a dependency edge mean something: a committed
 * artifact's parents must exist AND hold the content the reference recorded. A parent that is
 * absent is a broken edge; a parent present under the same (id, version) with a different hash
 * means the store's version numbering has been violated, and the reference must not silently
 * follow it there.
 *
 * @param refs - the references to resolve.
 * @param available - the revisions the caller can read, keyed by {@link artifactRefKey}.
 * @returns nothing when every reference resolves, otherwise the refusal naming the first that
 *   did not and which of the two ways it failed.
 */
export function refsResolvable(
  refs: ReadonlyArray<ArtifactRef>,
  available: ReadonlyMap<string, ArtifactRef>,
): DomainParseFailure | undefined {
  for (const ref of refs) {
    const found = available.get(`${ref.artifactId}@${String(ref.version)}`)
    if (found === undefined) {
      return refuse(
        `${DOMAIN_ERROR_PREFIX}BAD_REFERENCE`,
        `input reference '${artifactRefKey(ref)}' does not resolve: no artifact '${ref.artifactId}' at version ${String(ref.version)} is available to this commit`,
      )
    }
    if (found.contentHash !== ref.contentHash) {
      return refuse(
        `${DOMAIN_ERROR_PREFIX}BAD_REFERENCE`,
        `input reference '${artifactRefKey(ref)}' does not resolve: artifact '${ref.artifactId}' version ${String(ref.version)} holds content ${found.contentHash}`,
      )
    }
  }
  return undefined
}

function parseRef(value: unknown): Parsed<ArtifactRef> {
  const record = asRecord(value)
  if (record === undefined) {
    return refuse(`${DOMAIN_ERROR_PREFIX}BAD_REFERENCE`, 'artifact reference is not an object')
  }
  const artifactId = stringField(record, 'artifactId')
  const version = countField(record, 'version')
  const contentHash = record['contentHash']
  if (artifactId === undefined || version === undefined || !isContentHash(contentHash)) {
    return refuse(
      `${DOMAIN_ERROR_PREFIX}BAD_REFERENCE`,
      'artifact reference needs a non-empty artifactId, a non-negative integer version, and a'
      + ' 64-character lower-case hex contentHash',
    )
  }
  return accept({
    artifactId: artifactId as ArtifactId,
    version: version as ArtifactVersion,
    contentHash,
  })
}

/**
 * Read one artifact envelope off an untyped boundary.
 *
 * @param value - the value read from a file, a model's JSON, or a queued record.
 * @returns the artifact, or the refusal naming the first thing wrong with it. A record declaring
 *   a `schemaVersion` other than {@link ARTIFACT_SCHEMA_VERSION} is refused: this parser knows
 *   today's fields, and reading a future record with them would produce a plausible wrong object.
 */
export function parseArtifactIngress(value: unknown): Parsed<ResearchArtifact> {
  const record = asRecord(value)
  if (record === undefined) {
    return refuse(`${DOMAIN_ERROR_PREFIX}NOT_AN_OBJECT`, 'artifact record is not an object')
  }
  const schemaVersion = countField(record, 'schemaVersion')
  if (schemaVersion === undefined) {
    return refuse(`${DOMAIN_ERROR_PREFIX}UNKNOWN_SCHEMA`, "artifact record has no integer 'schemaVersion'")
  }
  if (schemaVersion !== ARTIFACT_SCHEMA_VERSION) {
    return refuse(
      `${DOMAIN_ERROR_PREFIX}UNKNOWN_SCHEMA`,
      `artifact record declares schemaVersion ${String(schemaVersion)}; this reader writes and reads ${String(ARTIFACT_SCHEMA_VERSION)} and will not read a record whose fields it does not know`,
    )
  }
  const artifactId = stringField(record, 'artifactId')
  if (artifactId === undefined) {
    return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "artifact record has no non-empty 'artifactId'")
  }
  const version = countField(record, 'version')
  if (version === undefined) {
    return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "artifact record has no integer 'version'")
  }
  const contentHash = record['contentHash']
  if (contentHash === undefined) {
    return refuse(
      `${DOMAIN_ERROR_PREFIX}MISSING_CONTENT_HASH`,
      "artifact record has no 'contentHash': without it the record names a revision but not the content that revision held",
    )
  }
  if (!isContentHash(contentHash)) {
    return refuse(
      `${DOMAIN_ERROR_PREFIX}MISSING_CONTENT_HASH`,
      "'contentHash' is not 64 lower-case hex characters",
    )
  }
  const kind = stringField(record, 'kind')
  if (kind === undefined) {
    return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "artifact record has no non-empty 'kind'")
  }
  const projectId = stringField(record, 'projectId')
  if (projectId === undefined) {
    return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "artifact record has no non-empty 'projectId'")
  }
  const projectRevision = countField(record, 'projectRevision')
  if (projectRevision === undefined) {
    return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "artifact record has no integer 'projectRevision'")
  }
  const producerTaskAttemptId = stringField(record, 'producerTaskAttemptId')
  if (producerTaskAttemptId === undefined) {
    return refuse(
      `${DOMAIN_ERROR_PREFIX}MISSING_FIELD`,
      "artifact record has no non-empty 'producerTaskAttemptId': without it a late result cannot be told from a current one",
    )
  }
  const status = record['status']
  if (typeof status !== 'string' || !(ARTIFACT_STATUSES as ReadonlyArray<string>).includes(status)) {
    return refuse(
      `${DOMAIN_ERROR_PREFIX}BAD_FIELD`,
      `artifact record has no usable 'status' (expected one of ${ARTIFACT_STATUSES.join(', ')})`,
    )
  }
  const createdAt = numberField(record, 'createdAt')
  if (createdAt === undefined) {
    return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "artifact record has no finite 'createdAt'")
  }
  const rawRefs = arrayField(record, 'inputRefs')
  if (rawRefs === undefined) {
    return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "artifact record has no 'inputRefs' array")
  }
  const inputRefs: ArtifactRef[] = []
  for (const raw of rawRefs) {
    const parsed = parseRef(raw)
    if (!parsed.ok) return parsed
    inputRefs.push(parsed.value)
  }
  const provenanceRecord = asRecord(record['provenance'])
  if (provenanceRecord === undefined) {
    return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "artifact record has no 'provenance' object")
  }
  const sourceClass = provenanceRecord['sourceClass']
  if (!isSourceClass(sourceClass)) {
    return refuse(
      `${DOMAIN_ERROR_PREFIX}BAD_FIELD`,
      "artifact provenance has no declared 'sourceClass': what produced a value is the one thing a reader cannot infer from the value",
    )
  }
  const producer = stringField(provenanceRecord, 'producer')
  if (producer === undefined) {
    return refuse(`${DOMAIN_ERROR_PREFIX}BAD_FIELD`, "artifact provenance has no non-empty 'producer'")
  }
  const ruleVersion = provenanceRecord['ruleVersion']
  if (ruleVersion !== undefined && (typeof ruleVersion !== 'string' || ruleVersion.length === 0)) {
    return refuse(`${DOMAIN_ERROR_PREFIX}BAD_FIELD`, "artifact provenance 'ruleVersion' is present but not a non-empty string")
  }
  const sourceAccess = provenanceRecord['sourceAccess']
  if (sourceAccess !== undefined && !isSourceAccess(sourceAccess)) {
    return refuse(
      `${DOMAIN_ERROR_PREFIX}BAD_FIELD`,
      "artifact provenance 'sourceAccess' is present but is not a declared access level",
    )
  }
  const note = provenanceRecord['note']
  if (note !== undefined && typeof note !== 'string') {
    return refuse(`${DOMAIN_ERROR_PREFIX}BAD_FIELD`, "artifact provenance 'note' is present but is not a string")
  }
  return accept({
    artifactId: artifactId as ArtifactId,
    version: version as ArtifactVersion,
    contentHash,
    schemaVersion,
    kind,
    projectId: projectId as ProjectId,
    projectRevision: projectRevision as ProjectRevision,
    producerTaskAttemptId: producerTaskAttemptId as TaskAttemptId,
    inputRefs,
    provenance: {
      sourceClass,
      producer,
      ...(ruleVersion !== undefined ? { ruleVersion } : {}),
      ...(sourceAccess !== undefined ? { sourceAccess } : {}),
      ...(note !== undefined ? { note } : {}),
    },
    status: status as ArtifactStatus,
    createdAt,
  })
}
