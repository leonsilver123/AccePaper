/**
 * Publishing a new version of an artifact the run already holds, outside a step commit.
 *
 * WHY THIS IS NOT A COMMIT. `commitStepOutputs` writes a step's declared outputs inside its own
 * in-progress attempt. Two operations in this repository publish a replacement for an artifact a
 * step already wrote, and neither has an attempt to write through: a person's hand-edited file
 * handed back, and a re-render of a document a later step moved under the typeset form. Rolling the
 * step back to `in_progress` to make room would report the study as at a state it never reached,
 * and a per-slug write beside the commit receipt would leave the registry and the receipt describing
 * different values. This is the third way — and, like `acceptance.ts`, the guards, the producer and
 * the audit record are what make it an operation rather than a registry write.
 *
 * WHAT IT REFUSES, AND WHY EACH ONE IS A WAY OF PUBLISHING SOMETHING NOBODY PRODUCED:
 *   - a revision other than the one the caller read (the study moved);
 *   - a slug this run does not hold (there is nothing to republish over);
 *   - a version other than the one the run holds (the new value answers a revision that is gone);
 *   - a value with no canonical encoding (it could not be stored, so nothing may be written);
 *   - a producer that is empty (an artifact whose producer nobody can name is one whose origin
 *     cannot be read off the registry).
 *
 * WHO WROTE THIS TEXT, AND WHICH STEP IT CAME FROM, ARE TWO FACTS. A published entry inherits the
 * replaced entry's `producerStepId` and `producerAttemptId` and records the publisher in
 * `publishedBy`. The inherited pair is what the engine schedules on — `canStart` requires a step's
 * input to name a PASSED step at the attempt that wrote it — and a slug whose entry named a publisher
 * satisfied no downstream input at all, so a run whose manuscript a person had edited could not be
 * driven past the step that reads it. Inheriting is not a claim that the step wrote this text: the
 * publication, its basis, its replaced version and the publisher are all in the audit record, and
 * `publishedBy` says the same thing on the registry entry a reader is looking at.
 *
 * WHAT IT DOES NOT DO: it does not decide whether the new value is any good, does not move a step's
 * status, and does not invalidate the versions that were derived from the superseded one. The
 * registry keeps one entry per slug, so a reader that recorded the previous version still holds a
 * reference to it; whether that reference still means anything is the reader's question, and the
 * operations built on this one answer it where they know the answer.
 */
import { contentHashOf } from '../domain/artifact.ts'
import { appendAuditEvent, ensureRun, ResearchError } from './state-machine.ts'
import type { ArtifactRef } from '../domain/artifact.ts'
import type { ResearchRunStore, RunState } from './types.ts'
import { nextProjectRevision } from '../domain/project.ts'

/** What a publication is about, as the caller states it. */
export interface ArtifactPublicationRequest {
  /** The run holding the artifact. */
  readonly runId: string
  /**
   * The artifact being republished.
   *
   * NAMED, NOT DISCOVERED. A publication that took the slug from the value would be a write to
   * whatever the caller's value happened to look like; the slug is the caller's statement of which
   * artifact this is a new version of, and the guard below checks it against the registry.
   */
  readonly slug: string
  /**
   * The revision the caller read before producing the new value.
   *
   * The same discipline every other write uses: a caller that cannot name the state it read is
   * publishing over whatever the run happens to hold now.
   */
  readonly expectedRevision: number
  /**
   * The version of the artifact the new value was derived from.
   *
   * This is what makes "the revision this replaced" checkable at the moment of publication rather
   * than at the moment of production.
   */
  readonly expectedVersion: number
  /** The new value, as the caller produced it from the version above. */
  readonly value: unknown
  /**
   * Who published the new version, recorded on the registry entry as `publishedBy` and in the audit
   * record.
   *
   * A STEP ID WOULD BE A LIE HERE, so the field is a name in the producer vocabulary rather than an
   * id: `producerStepId` records which step wrote an entry, and neither of this operation's callers
   * is a step. Recording one anyway would make the registry say a step produced something it never
   * ran for.
   */
  readonly producer: string
  /** What the publication is for, in the caller's own words. Mandatory: see {@link PublicationReceipt.basis}. */
  readonly basis: string
  /** The audit detail the caller wants beside the receipt — the file, the losses, the versions. */
  readonly detail?: unknown
}

/** What a publication produced. */
export interface ArtifactPublicationReceipt {
  readonly runId: string
  readonly slug: string
  /** The revision the publication advanced the run to. */
  readonly revision: number
  /** The new version, as the registry now holds it. */
  readonly ref: ArtifactRef
  /** The producer recorded on it. */
  readonly producer: string
  /** Which version this replaced — the one the caller stated it derived the new value from. */
  readonly replacedVersion: number
  /** The content hash of the version that was replaced. */
  readonly replacedHash: string
  /**
   * Why this version exists, as the caller stated it.
   *
   * CARRIED ON THE RECEIPT AND IN THE AUDIT because the two callers publish for reasons a reader
   * cannot recover from the value: a person edited the file, or a document moved under a rendering.
   * A registry entry that named only "version 4" would leave the next reader to guess which.
   */
  readonly basis: string
  readonly publishedAt: number
}

/** One publication refusal, in the words of the check that produced it. */
export class PublicationRefusal extends ResearchError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'PublicationRefusal'
  }
}

/**
 * Every reason a publication would be refused, in the order a caller must satisfy them.
 *
 * THE CHECKS LIVE HERE, ONCE. The operation below and any read a page makes before offering a
 * control both call this: a predicate that restated them could offer a control the operation then
 * refuses, and the two would drift with nothing to notice it.
 *
 * @param run - the run's state.
 * @param request - what would be published.
 * @returns the first refusal, or null when every check passes.
 */
export function checkPublication(
  run: RunState,
  request: ArtifactPublicationRequest,
): PublicationRefusal | null {
  if (run.revision !== request.expectedRevision) {
    return new PublicationRefusal(
      'DSH_PUBLISH_REVISION_CONFLICT',
      `the publication was prepared against revision ${String(request.expectedRevision)} and run `
      + `'${request.runId}' is at ${String(run.revision)} — re-read the run before publishing`,
    )
  }
  if (request.slug.trim() === '') {
    return new PublicationRefusal(
      'DSH_PUBLISH_NO_SLUG',
      `run '${request.runId}' was asked to publish a version of an artifact with no slug`,
    )
  }
  if (request.producer.trim() === '') {
    return new PublicationRefusal(
      'DSH_PUBLISH_NO_PRODUCER',
      `a published version of '${request.slug}' must name who produced it — an artifact whose`
      + ' producer nobody can read off the registry is one whose origin cannot be established',
    )
  }
  const current = run.registry[request.slug]
  if (current === undefined) {
    return new PublicationRefusal(
      'DSH_PUBLISH_NO_ARTIFACT',
      `run '${request.runId}' holds no '${request.slug}' artifact — there is nothing to publish over`,
    )
  }
  if (current.ref.version !== request.expectedVersion) {
    return new PublicationRefusal(
      'DSH_PUBLISH_ARTIFACT_MOVED',
      `the new value was derived from '${request.slug}' version ${String(request.expectedVersion)} `
      + `and the run holds version ${String(current.ref.version)} — the artifact moved`,
    )
  }
  const hashed = contentHashOf(request.value)
  if (!hashed.ok) {
    return new PublicationRefusal(
      'DSH_PUBLISH_VALUE_NOT_PERSISTABLE',
      `the value for '${request.slug}' has no canonical encoding (${hashed.reason}) — nothing was written`,
    )
  }
  return null
}

/**
 * Publish a new version of an artifact the run already holds.
 *
 * @param store - the store holding the run.
 * @param request - what to publish, and against which versions.
 * @returns the receipt, with the revision and the new artifact reference.
 * @throws {PublicationRefusal} for every way of publishing something nobody produced.
 */
export function publishArtifactVersion(
  store: ResearchRunStore,
  request: ArtifactPublicationRequest,
): ArtifactPublicationReceipt {
  const run: RunState = ensureRun(store, request.runId)
  const refusal = checkPublication(run, request)
  if (refusal !== null) throw refusal
  const previous = run.registry[request.slug]
  /* c8 ignore next -- checkPublication refuses an absent slug and an unencodable value */
  if (previous === undefined) throw new PublicationRefusal('DSH_PUBLISH_NO_ARTIFACT', 'no artifact to publish over')
  const hashed = contentHashOf(request.value)
  /* c8 ignore next -- checkPublication refuses an unencodable value, so this cannot be reached */
  if (!hashed.ok) throw new PublicationRefusal('DSH_PUBLISH_VALUE_NOT_PERSISTABLE', 'the value has no canonical encoding')

  // ── write phase: nothing below this line can refuse ──────────────────────────
  const revision = nextProjectRevision(run.revision)
  const publishedAt = Date.now()
  const ref: ArtifactRef = {
    artifactId: request.slug as ArtifactRef['artifactId'],
    // ONE REGISTRY ENTRY PER SLUG, so the published value REPLACES the step's and the counter is
    // what keeps the superseded revision legible to anything that recorded it.
    version: (previous.ref.version + 1) as ArtifactRef['version'],
    contentHash: hashed.value,
  }
  run.registry[request.slug] = {
    slug: request.slug,
    // THE PUBLICATION INHERITS THE PRODUCER LINK OF THE VERSION IT REPLACES. The engine decides
    // whether a step may start from `producerStepId`/`producerAttemptId`, so a published slug whose
    // entry named a producer that is not a passed step satisfied NO downstream input: an imported or
    // repaired run could not be driven past the step that reads the slug again, and the only way back
    // was to roll the step back and re-commit it, discarding the edit the publication exists to keep.
    // The dependency the pipeline scheduled on is the step that produced the value this one replaces,
    // and it is still the same artifact under the same slug.
    producerStepId: previous.producerStepId,
    producerAttemptId: previous.producerAttemptId,
    // WHO PUBLISHED IT, kept beside the inherited link. The inherited fields answer "which step does
    // this artifact come from"; they cannot answer "a person wrote this text", and the audit record
    // of the publication is not where a reader of the registry would look.
    publishedBy: request.producer,
    value: request.value,
    producedAt: publishedAt,
    invalidated: false,
    ref,
    projectRevision: revision,
  }
  run.revision = revision
  const receipt: ArtifactPublicationReceipt = {
    runId: request.runId,
    slug: request.slug,
    revision,
    ref,
    producer: request.producer,
    replacedVersion: previous.ref.version,
    replacedHash: previous.ref.contentHash,
    basis: request.basis,
    publishedAt,
  }
  // THE RECORD NAMES THE VERSIONS, not only the fact: a later reader has to be able to tell what
  // this replaced, or the audit says a publication happened and not what it changed.
  appendAuditEvent(store, request.runId, 'artifact-republished', undefined, undefined, {
    ...receipt,
    ...(request.detail === undefined ? {} : { detail: request.detail }),
  })
  return receipt
}

/**
 * Whether a publication would be accepted, as a READ a page can make before offering the control.
 *
 * It does not write and it cannot: it runs {@link checkPublication} and reports its refusal. The
 * operation above is the authority on what happens; this is the authority on what a page may OFFER,
 * and they share the check rather than restating it.
 *
 * @param store - the store holding the run.
 * @param request - what would be published.
 * @returns `{ ok: true }`, or the code and message of the first refusal.
 */
export function canPublishArtifactVersion(
  store: ResearchRunStore,
  request: ArtifactPublicationRequest,
): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string } {
  const run: RunState = ensureRun(store, request.runId)
  const refusal = checkPublication(run, request)
  return refusal === null ? { ok: true } : { ok: false, code: refusal.code, message: refusal.message }
}
