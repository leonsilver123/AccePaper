/**
 * Tests for the artifact envelope: canonical encoding and content hashing, the ingress parser that
 * reads one off a file/model/queue boundary, and the two reference operations a commit point uses.
 *
 * The acceptance requirements these cases are evidence for are that a file or model boundary
 * refuses an unknown schema, a missing content hash, and a wrong reference; and that a stored
 * version's content cannot change under a reference that already named it.
 */

import { describe, expect, it } from 'vitest'

import {
  ARTIFACT_SCHEMA_VERSION,
  ARTIFACT_STATUSES,
  artifactRefKey,
  artifactRefOf,
  canonicalJson,
  contentHashOf,
  parseArtifactIngress,
  refsResolvable,
  sameArtifactRef,
} from '../../src/domain/artifact.ts'
import type { ArtifactRef, ResearchArtifact } from '../../src/domain/artifact.ts'
import type { ArtifactId, ArtifactVersion, ContentHash } from '../../src/domain/ids.ts'

const HASH_A = 'a1'.repeat(32)
const HASH_B = 'b2'.repeat(32)

/** SHA-256 vectors produced outside this module (over the literal canonical texts below), so the
 *  hashing cases cannot pass by re-deriving the expectation from the code under test. */
const SHA256_OF = {
  '{"a":1}': '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862',
  '{}': '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
  '[1,2]': '49a64717d5d4cb19952e6eac2946415cf6879adacf9908e7d872332d32c6e684',
} as const

function ref(artifactId: string, version: number, contentHash: string): ArtifactRef {
  return {
    artifactId: artifactId as ArtifactId,
    version: version as ArtifactVersion,
    contentHash: contentHash as ContentHash,
  }
}

/** The key a caller holds available revisions under: id and version, with no hash. */
function revisionKey(artifactId: string, version: number): string {
  return `${artifactId}@${String(version)}`
}

function validRecord(): Record<string, unknown> {
  return {
    artifactId: 'landscape-map',
    version: 2,
    contentHash: HASH_A,
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    kind: 'landscape-map',
    projectId: 'project-1',
    projectRevision: 4,
    producerTaskAttemptId: 'attempt-1',
    inputRefs: [{ artifactId: 'gap-list', version: 1, contentHash: HASH_B }],
    provenance: { sourceClass: 'literature', producer: 'crossref-adapter' },
    status: 'staged',
    createdAt: 1_760_000_000_000,
  }
}

/** The valid record with one field removed, for the "field is absent" refusals. */
function without(field: string): Record<string, unknown> {
  const { [field]: _removed, ...rest } = validRecord()
  return rest
}

function withProvenance(provenance: unknown): Record<string, unknown> {
  return { ...validRecord(), provenance }
}

/** Parse the record, failing the case when it was accepted instead of refused. */
function refusalOf(value: unknown) {
  const parsed = parseArtifactIngress(value)
  if (parsed.ok) throw new Error('fixture: the artifact record was accepted and should have been refused')
  return parsed
}

/** Parse the record, failing the case when it was refused instead of accepted. */
function acceptArtifact(value: unknown): ResearchArtifact {
  const parsed = parseArtifactIngress(value)
  if (!parsed.ok) throw new Error(`fixture: record refused with ${parsed.code}: ${parsed.reason}`)
  return parsed.value
}

describe('canonicalJson encodes one value one way', () => {
  it('gives the same text for two objects built in a different key order', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }))
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
  })

  it('sorts nested object keys and keeps array order', () => {
    const built = { outer: { z: [1, 2], a: { d: 4, c: 3 } } }
    const reordered = { outer: { a: { c: 3, d: 4 }, z: [1, 2] } }
    expect(canonicalJson(built)).toBe(canonicalJson(reordered))
    expect(canonicalJson(built)).toBe('{"outer":{"a":{"c":3,"d":4},"z":[1,2]}}')
    // Array order is data, not layout: reordering it changes the value and must change the text.
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
  })

  it('encodes a shared reference, which is not a cycle', () => {
    const shared = ['one', 'two']
    expect(canonicalJson({ plan: shared, phases: shared })).toBe('{"phases":["one","two"],"plan":["one","two"]}')
  })

  it('refuses the whole value when any part of it has no JSON representation', () => {
    const cases: ReadonlyArray<{ label: string; value: unknown }> = [
      { label: 'a function', value: () => 'fixture' },
      { label: 'a symbol', value: Symbol('fixture') },
      { label: 'undefined', value: undefined },
      { label: 'a nested undefined', value: { present: 1, missing: undefined } },
      { label: 'NaN', value: Number.NaN },
      { label: 'Infinity', value: Number.POSITIVE_INFINITY },
      { label: '-Infinity', value: Number.NEGATIVE_INFINITY },
      { label: 'a bigint', value: 1n },
      { label: 'an array holding a function', value: [1, () => 'fixture'] },
    ]
    for (const testCase of cases) expect(canonicalJson(testCase.value), testCase.label).toBeUndefined()
  })

  it('refuses a cycle, including one reached through an array', () => {
    const cyclic: Record<string, unknown> = { name: 'fixture-cycle' }
    cyclic['self'] = cyclic
    expect(canonicalJson(cyclic)).toBeUndefined()
    const list: unknown[] = [1]
    list.push(list)
    expect(canonicalJson(list)).toBeUndefined()
    // The refusal is about the cycle, not about depth: the same structure acyclic encodes.
    expect(canonicalJson({ outer: { inner: { name: 'fixture' } } })).toBe('{"outer":{"inner":{"name":"fixture"}}}')
  })

  it('encodes exactly the JSON scalars', () => {
    expect(canonicalJson(null)).toBe('null')
    expect(canonicalJson(true)).toBe('true')
    expect(canonicalJson(false)).toBe('false')
    expect(canonicalJson('a"b')).toBe('"a\\"b"')
    expect(canonicalJson(-0.5)).toBe('-0.5')
    expect(canonicalJson({})).toBe('{}')
    expect(canonicalJson([])).toBe('[]')
  })

  it('refuses an object whose own enumerable keys do not describe it', () => {
    // A Map, Set, Date, RegExp, or typed array has no own enumerable keys, so encoding one would
    // produce `{}` and hash every such value to one digest. The sibling walk in run-persistence.ts
    // refuses the same values (DSH_SNAPSHOT_VALUE_NOT_JSON).
    const cases: ReadonlyArray<{ label: string; value: unknown }> = [
      { label: 'a Map', value: new Map([['a', 1]]) },
      { label: 'a Set', value: new Set([1]) },
      { label: 'a Date', value: new Date('2026-01-01T00:00:00.000Z') },
      { label: 'a RegExp', value: /fixture/u },
      { label: 'a typed array', value: new Uint8Array([1, 2]) },
      { label: 'an ArrayBuffer', value: new ArrayBuffer(8) },
      { label: 'a Map nested in an array', value: [new Map([['a', 1]])] },
    ]
    for (const testCase of cases) expect(canonicalJson(testCase.value), testCase.label).toBeUndefined()
    // The refusal is about the prototype, not about the shape: a Map and the empty record that
    // would have been hashed in its place are not both encodable.
    expect(canonicalJson({})).toBe('{}')
  })

  it('refuses a class instance and encodes a null-prototype record', () => {
    class Fixture {
      readonly marker = 'fixture'
    }
    // Own keys that describe the value are not enough: a producer hands over a plain record, not an
    // instance whose prototype the reader would have to trust.
    expect(canonicalJson(new Fixture())).toBeUndefined()
    const bare = Object.create(null) as Record<string, unknown>
    bare['a'] = 1
    expect(canonicalJson(bare)).toBe('{"a":1}')
  })
})

describe('contentHashOf is SHA-256 over the canonical encoding', () => {
  it('returns the SHA-256 of the canonical text', () => {
    for (const [text, digest] of Object.entries(SHA256_OF)) {
      expect(canonicalJson(JSON.parse(text))).toBe(text)
      const hashed = contentHashOf(JSON.parse(text))
      expect(hashed, text).toEqual({ ok: true, value: digest })
    }
  })

  it('gives one digest for two objects written in a different key order', () => {
    expect(contentHashOf({ b: 2, a: 1 })).toEqual(contentHashOf({ a: 1, b: 2 }))
    expect(contentHashOf([{ z: 1, a: 2 }])).toEqual(contentHashOf([{ a: 2, z: 1 }]))
  })

  it('does not treat a number and its string as the same value', () => {
    // No coercion: encoding `1` and `"1"` produce different texts, so the two values cannot share
    // a reference.
    expect(contentHashOf({ a: 1 })).not.toEqual(contentHashOf({ a: '1' }))
    expect(contentHashOf({ a: 1 })).not.toEqual(contentHashOf({ a: 2 }))
  })

  it('REFUSES a value with no canonical encoding instead of hashing what is left of it', () => {
    const parsed = contentHashOf({ ok: 1, bad: () => 'fixture' })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('fixture: a function-valued field was hashed')
    expect(parsed.code).toBe('DSH_DOMAIN_BAD_FIELD')
    expect(parsed.reason).toContain('canonical JSON')
  })

  it('produces a digest the artifact parser accepts as a contentHash', () => {
    // Closes the loop between the two modules: the digest this module writes is well formed for
    // the boundary that reads one back.
    const hashed = contentHashOf({ claim: 'fixture-claim' })
    expect(hashed.ok).toBe(true)
    if (!hashed.ok) throw new Error('fixture: a plain record was refused')
    expect(hashed.value).toMatch(/^[0-9a-f]{64}$/u)
    expect(acceptArtifact({ ...validRecord(), contentHash: hashed.value }).contentHash).toBe(hashed.value)
  })
})

describe('parseArtifactIngress refuses a record it cannot read', () => {
  const refusals: ReadonlyArray<{
    label: string
    value: unknown
    code: string
    names: readonly string[]
  }> = [
    {
      label: 'a value that is not an object',
      value: 'artifact-record',
      code: 'DSH_DOMAIN_NOT_AN_OBJECT',
      names: ['not an object'],
    },
    {
      label: 'an array, which is an object to typeof',
      value: [],
      code: 'DSH_DOMAIN_NOT_AN_OBJECT',
      names: ['not an object'],
    },
    { label: 'null', value: null, code: 'DSH_DOMAIN_NOT_AN_OBJECT', names: ['not an object'] },
    {
      label: 'no schemaVersion',
      value: without('schemaVersion'),
      code: 'DSH_DOMAIN_UNKNOWN_SCHEMA',
      names: ['schemaVersion'],
    },
    {
      label: 'schemaVersion 2',
      value: { ...validRecord(), schemaVersion: 2 },
      code: 'DSH_DOMAIN_UNKNOWN_SCHEMA',
      names: ['schemaVersion 2'],
    },
    {
      label: 'a schemaVersion that is not an integer',
      value: { ...validRecord(), schemaVersion: 1.5 },
      code: 'DSH_DOMAIN_UNKNOWN_SCHEMA',
      names: ['schemaVersion'],
    },
    { label: 'no artifactId', value: without('artifactId'), code: 'DSH_DOMAIN_MISSING_FIELD', names: ['artifactId'] },
    { label: 'no version', value: without('version'), code: 'DSH_DOMAIN_MISSING_FIELD', names: ['version'] },
    {
      label: 'no contentHash',
      value: without('contentHash'),
      code: 'DSH_DOMAIN_MISSING_CONTENT_HASH',
      names: ['contentHash'],
    },
    {
      label: 'a contentHash of 63 characters',
      value: { ...validRecord(), contentHash: HASH_A.slice(0, 63) },
      code: 'DSH_DOMAIN_MISSING_CONTENT_HASH',
      names: ['64 lower-case hex'],
    },
    {
      label: 'an upper-case contentHash',
      value: { ...validRecord(), contentHash: HASH_A.toUpperCase() },
      code: 'DSH_DOMAIN_MISSING_CONTENT_HASH',
      names: ['64 lower-case hex'],
    },
    {
      label: 'a contentHash that is not a string',
      value: { ...validRecord(), contentHash: 1234 },
      code: 'DSH_DOMAIN_MISSING_CONTENT_HASH',
      names: ['64 lower-case hex'],
    },
    { label: 'no kind', value: without('kind'), code: 'DSH_DOMAIN_MISSING_FIELD', names: ['kind'] },
    { label: 'no projectId', value: without('projectId'), code: 'DSH_DOMAIN_MISSING_FIELD', names: ['projectId'] },
    {
      label: 'no projectRevision',
      value: without('projectRevision'),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['projectRevision'],
    },
    {
      label: 'no producerTaskAttemptId',
      value: without('producerTaskAttemptId'),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['producerTaskAttemptId'],
    },
    {
      label: 'an unknown status',
      value: { ...validRecord(), status: 'archived' },
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['status', 'staged'],
    },
    { label: 'no createdAt', value: without('createdAt'), code: 'DSH_DOMAIN_MISSING_FIELD', names: ['createdAt'] },
    {
      label: 'a createdAt that is not a number',
      value: { ...validRecord(), createdAt: 'now' },
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['createdAt'],
    },
    {
      label: 'an inputRefs that is not an array',
      value: { ...validRecord(), inputRefs: {} },
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['inputRefs'],
    },
    {
      label: 'an inputRefs entry that is not an object',
      value: { ...validRecord(), inputRefs: ['gap-list@1'] },
      code: 'DSH_DOMAIN_BAD_REFERENCE',
      names: ['not an object'],
    },
    {
      label: 'an inputRefs entry with a bad contentHash',
      value: { ...validRecord(), inputRefs: [{ artifactId: 'gap-list', version: 1, contentHash: 'nope' }] },
      code: 'DSH_DOMAIN_BAD_REFERENCE',
      names: ['contentHash'],
    },
    {
      label: 'an inputRefs entry with a negative version',
      value: { ...validRecord(), inputRefs: [{ artifactId: 'gap-list', version: -1, contentHash: HASH_B }] },
      code: 'DSH_DOMAIN_BAD_REFERENCE',
      names: ['version'],
    },
    {
      label: 'no provenance object',
      value: without('provenance'),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['provenance'],
    },
    {
      label: 'a provenance that is not an object',
      value: withProvenance('literature'),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['provenance'],
    },
    {
      label: 'a provenance with no declared sourceClass',
      value: withProvenance({ producer: 'crossref-adapter' }),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['sourceClass'],
    },
    {
      label: 'a provenance with an undeclared sourceClass',
      value: withProvenance({ sourceClass: 'nonsense', producer: 'crossref-adapter' }),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['sourceClass'],
    },
    {
      label: 'a provenance with no producer',
      value: withProvenance({ sourceClass: 'literature' }),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['producer'],
    },
    {
      label: 'a present-but-empty ruleVersion',
      value: withProvenance({ sourceClass: 'literature', producer: 'crossref-adapter', ruleVersion: '' }),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['ruleVersion'],
    },
    {
      label: 'a present-but-undeclared sourceAccess',
      value: withProvenance({ sourceClass: 'literature', producer: 'crossref-adapter', sourceAccess: 'skimmed' }),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['sourceAccess'],
    },
    {
      label: 'a sourceAccess that differs only in case',
      value: withProvenance({ sourceClass: 'literature', producer: 'crossref-adapter', sourceAccess: 'FULL-TEXT' }),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['sourceAccess'],
    },
    {
      label: 'a note that is not a string',
      value: withProvenance({ sourceClass: 'literature', producer: 'crossref-adapter', note: 7 }),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['note'],
    },
  ]

  for (const testCase of refusals) {
    it(`refuses ${testCase.label}`, () => {
      const failure = refusalOf(testCase.value)
      expect(failure.code).toBe(testCase.code)
      for (const name of testCase.names) expect(failure.reason).toContain(name)
    })
  }
})

describe('parseArtifactIngress accepts a record that declares today schema', () => {
  it('reads every field, and leaves an omitted optional absent rather than undefined-valued', () => {
    const artifact = acceptArtifact(validRecord())
    expect(artifact.artifactId).toBe('landscape-map')
    expect(artifact.version).toBe(2)
    expect(artifact.contentHash).toBe(HASH_A)
    expect(artifact.schemaVersion).toBe(ARTIFACT_SCHEMA_VERSION)
    expect(artifact.kind).toBe('landscape-map')
    expect(artifact.projectId).toBe('project-1')
    expect(artifact.projectRevision).toBe(4)
    expect(artifact.producerTaskAttemptId).toBe('attempt-1')
    expect(artifact.status).toBe('staged')
    expect(artifact.createdAt).toBe(1_760_000_000_000)
    expect(artifact.inputRefs).toEqual([ref('gap-list', 1, HASH_B)])
    expect(artifact.provenance).toEqual({ sourceClass: 'literature', producer: 'crossref-adapter' })
    // `toEqual` ignores an undefined-valued key, so the absence is asserted on the key set: a
    // `{ruleVersion: undefined}` would survive a JSON round trip as a key that says nothing.
    expect(Object.keys(artifact.provenance).sort()).toEqual(['producer', 'sourceClass'])
    expect('ruleVersion' in artifact.provenance).toBe(false)
    expect('sourceAccess' in artifact.provenance).toBe(false)
    expect('note' in artifact.provenance).toBe(false)
  })

  it('carries every optional provenance field when the producer supplied one', () => {
    const artifact = acceptArtifact({
      ...validRecord(),
      inputRefs: [],
      provenance: {
        sourceClass: 'measured',
        producer: 'bench-rig',
        ruleVersion: 'rig-v3',
        sourceAccess: 'full-text',
        note: 'run on the fixture rig',
      },
    })
    // An artifact derived from nothing is legal: a first artifact has no parents.
    expect(artifact.inputRefs).toEqual([])
    expect(artifact.provenance.ruleVersion).toBe('rig-v3')
    expect(artifact.provenance.sourceAccess).toBe('full-text')
    expect(artifact.provenance.note).toBe('run on the fixture rig')
  })

  it('accepts every declared status', () => {
    for (const status of ARTIFACT_STATUSES) {
      expect(acceptArtifact({ ...validRecord(), status }).status, status).toBe(status)
    }
  })
})

describe('refsResolvable: a reference means the content it recorded', () => {
  const available = new Map<string, ArtifactRef>([
    [revisionKey('gap-list', 1), ref('gap-list', 1, HASH_B)],
    [revisionKey('method', 3), ref('method', 3, HASH_A)],
  ])

  it('returns nothing when every reference resolves, including when there are none', () => {
    expect(refsResolvable([ref('gap-list', 1, HASH_B)], available)).toBeUndefined()
    expect(refsResolvable([], available)).toBeUndefined()
  })

  it('REFUSES a reference whose revision is absent', () => {
    const failure = refsResolvable([ref('gap-list', 2, HASH_B)], available)
    expect(failure?.code).toBe('DSH_DOMAIN_BAD_REFERENCE')
    expect(failure?.reason).toContain('gap-list@2')
    expect(failure?.reason).toContain('does not resolve')
  })

  it('REFUSES a reference whose (id, version) holds different content', () => {
    // The invariant a dependency edge rests on: version numbering is immutable, so a reference
    // that resolves to another hash means the store rewrote a version, and the commit must not
    // follow it there.
    const failure = refsResolvable([ref('gap-list', 1, HASH_A)], available)
    expect(failure?.code).toBe('DSH_DOMAIN_BAD_REFERENCE')
    expect(failure?.reason).toContain(`gap-list@1#${HASH_A}`)
    expect(failure?.reason).toContain(HASH_B)
  })

  it('reports the first reference that did not resolve', () => {
    const failure = refsResolvable(
      [ref('method', 3, HASH_A), ref('absent-a', 1, HASH_A), ref('absent-b', 1, HASH_A)],
      available,
    )
    expect(failure?.reason).toContain('absent-a@1')
    expect(failure?.reason).not.toContain('absent-b')
  })
})

describe('sameArtifactRef is false when any one part differs', () => {
  it('compares all three parts', () => {
    const base = ref('a1', 1, HASH_A)
    expect(sameArtifactRef(base, ref('a1', 1, HASH_A))).toBe(true)
    expect(sameArtifactRef(base, ref('a2', 1, HASH_A))).toBe(false)
    expect(sameArtifactRef(base, ref('a1', 2, HASH_A))).toBe(false)
    expect(sameArtifactRef(base, ref('a1', 1, HASH_B))).toBe(false)
  })
})

describe('artifactRefOf and artifactRefKey', () => {
  it('takes the reference from the artifact, keyed id@version#hash', () => {
    const artifact = acceptArtifact(validRecord())
    expect(artifactRefOf(artifact)).toEqual(ref('landscape-map', 2, HASH_A))
    expect(artifactRefKey(artifactRefOf(artifact))).toBe(`landscape-map@2#${HASH_A}`)
  })
})
