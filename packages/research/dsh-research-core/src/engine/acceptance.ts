/**
 * Accepting a reviewed manuscript candidate as the run's official manuscript.
 *
 * WHY THIS IS NOT A COMMIT. `commitStepOutputs` writes a step's declared outputs inside its own
 * in-progress attempt, and E1-format committed long before anyone read the paper. Publishing a
 * candidate over that artifact therefore has no attempt to write through: rolling the step back to
 * `in_progress` to make room would report the study as at a state it never reached, and a per-slug
 * write beside the commit receipt would leave the registry and the receipt describing different
 * values. This is the third way, and the module design calls for it: an operation with its own
 * production caller, its own guards and its own audit record.
 *
 * WHAT IT REFUSES, AND WHY EACH ONE IS A WAY OF PUBLISHING SOMETHING NOBODY READ:
 *   - a revision other than the one the caller read (the study moved);
 *   - a manuscript whose current version is not the one the candidate was written against (the
 *     candidate answers a document that is no longer there);
 *   - a candidate with no review, or one whose review did not pass (nobody checked it);
 *   - a review of a DIFFERENT version of the candidate (checked, but not this text).
 *
 * WHAT IT DOES NOT DO: it does not decide whether the study is good, and it does not make the run
 * submission-ready. Readiness is a fact about the profile and the gates, computed where it has
 * always been computed; this operation publishes one artifact version and records who did it.
 */
import { contentHashOf } from '../domain/artifact.ts'
import { appendAuditEvent, ensureRun, ResearchError } from './state-machine.ts'
import type { ArtifactRef } from '../domain/artifact.ts'
import type { ResearchRunStore, RunState } from './types.ts'
import { nextProjectRevision } from '../domain/project.ts'

/** The manuscript artifact a candidate replaces. */
export const ACCEPTED_MANUSCRIPT_SLUG = 'formatted-manuscript'

/** The producer recorded on an accepted manuscript: a person deciding, not a step executing. */
export const ACCEPTANCE_PRODUCER = 'human-acceptance'

/** What an acceptance is about, as the caller states it. */
export interface ManuscriptAcceptanceRequest {
  /** The run the manuscript belongs to. */
  readonly runId: string
  /**
   * The revision the caller read before deciding.
   *
   * The same discipline every other write uses: a caller that cannot name the state it read is
   * publishing over whatever the run happens to hold now.
   */
  readonly expectedRevision: number
  /**
   * The version of the manuscript artifact the candidate was written against.
   *
   * A candidate is text for a document. This is what makes "the document it answers" checkable at
   * the moment of acceptance rather than at the moment of writing.
   */
  readonly expectedManuscriptVersion: number
  /** The accepted manuscript's value, as the caller assembled it from the candidate. */
  readonly value: unknown
  /** The `contentHash` of the reviewed candidate's text. */
  readonly candidateHash: string
  /** Who accepted it. The host-attested principal, never a value from a page body. */
  readonly operator: string
  /** The audit trail: which request and candidate this acceptance answered. */
  readonly requestId: string
  readonly candidateId: string
}

/** The review an acceptance requires, as the caller hands it over. */
export interface CandidateReviewFacts {
  /** The candidate hash the review judged. */
  readonly candidateHash: string
  readonly passed: boolean
  /** Whether a review exists at all. Absent is refused, and it is not the same as `passed: false`. */
  readonly reviewed: boolean
}

/** What an acceptance produced. */
export interface ManuscriptAcceptanceReceipt {
  readonly runId: string
  /** The revision the acceptance published. */
  readonly revision: number
  /** The new manuscript version, as the registry now holds it. */
  readonly ref: ArtifactRef
  readonly operator: string
  readonly requestId: string
  readonly candidateId: string
  readonly acceptedAt: number
}

/** One acceptance refusal, in the words of the check that produced it. */
export class AcceptanceRefusal extends ResearchError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'AcceptanceRefusal'
  }
}

/**
 * Every reason an acceptance would be refused, in the order a caller must satisfy them.
 *
 * THE CHECKS LIVE HERE, ONCE. The operation below and the read a page makes before offering the
 * control both call this: a predicate that restated them could offer a control the operation then
 * refuses, and the two would drift with nothing to notice it.
 *
 * @param run - the run's state.
 * @param request - what would be accepted.
 * @param review - the review facts.
 * @returns the first refusal, or null when every check passes.
 */
export function checkAcceptance(
  run: RunState,
  request: ManuscriptAcceptanceRequest,
  review: CandidateReviewFacts,
): AcceptanceRefusal | null {
  if (run.revision !== request.expectedRevision) {
    return new AcceptanceRefusal(
      'DSH_ACCEPT_REVISION_CONFLICT',
      `the acceptance was prepared against revision ${String(request.expectedRevision)} and run `
      + `'${request.runId}' is at ${String(run.revision)} — re-read the run before accepting`,
    )
  }
  const current = run.registry[ACCEPTED_MANUSCRIPT_SLUG]
  if (current === undefined) {
    return new AcceptanceRefusal(
      'DSH_ACCEPT_NO_MANUSCRIPT',
      `run '${request.runId}' has no '${ACCEPTED_MANUSCRIPT_SLUG}' artifact — there is nothing to accept over`,
    )
  }
  if (current.ref.version !== request.expectedManuscriptVersion) {
    return new AcceptanceRefusal(
      'DSH_ACCEPT_MANUSCRIPT_MOVED',
      `the candidate was written against manuscript version ${String(request.expectedManuscriptVersion)} `
      + `and the run holds version ${String(current.ref.version)} — the manuscript moved`,
    )
  }
  // A REVIEW OF ANOTHER VERSION IS NOT A REVIEW OF THIS ONE. `reviewed: false` is its own refusal
  // rather than `passed: false`: "nobody checked this" and "the checks failed" are different facts,
  // and a caller that merged them would report a failed review where none was run.
  if (!review.reviewed) {
    return new AcceptanceRefusal(
      'DSH_ACCEPT_UNREVIEWED',
      `candidate '${request.candidateId}' has no review — an unreviewed candidate is not accepted`,
    )
  }
  if (review.candidateHash !== request.candidateHash) {
    return new AcceptanceRefusal(
      'DSH_ACCEPT_REVIEW_STALE',
      `the review is about candidate hash ${review.candidateHash.slice(0, 12)} and this acceptance `
      + `names ${request.candidateHash.slice(0, 12)} — a review of another version is not a review of this one`,
    )
  }
  if (!review.passed) {
    return new AcceptanceRefusal(
      'DSH_ACCEPT_REVIEW_FAILED',
      `candidate '${request.candidateId}' did not pass its review — the checks state what failed`,
    )
  }
  const hashed = contentHashOf(request.value)
  if (!hashed.ok) {
    return new AcceptanceRefusal(
      'DSH_ACCEPT_VALUE_NOT_PERSISTABLE',
      `the accepted manuscript has no canonical encoding (${hashed.reason}) — nothing was written`,
    )
  }
  return null
}

/**
 * Publish a reviewed candidate as the run's official manuscript.
 *
 * @param store - the store holding the run.
 * @param request - what to accept, and against which versions.
 * @param review - the review the candidate must have, and its verdict.
 * @returns the receipt, with the revision and the new artifact reference.
 * @throws {AcceptanceRefusal} for every way of publishing something nobody read.
 */
export function acceptManuscriptCandidate(
  store: ResearchRunStore,
  request: ManuscriptAcceptanceRequest,
  review: CandidateReviewFacts,
): ManuscriptAcceptanceReceipt {
  const run: RunState = ensureRun(store, request.runId)
  const refusal = checkAcceptance(run, request, review)
  if (refusal !== null) throw refusal
  const previous = run.registry[ACCEPTED_MANUSCRIPT_SLUG]
  const hashed = contentHashOf(request.value)
  /* c8 ignore next -- checkAcceptance refuses an unencodable value, so this cannot be reached */
  if (!hashed.ok) throw new AcceptanceRefusal('DSH_ACCEPT_VALUE_NOT_PERSISTABLE', 'the value has no canonical encoding')

  // ── write phase: nothing below this line can refuse ──────────────────────────
  const revision = nextProjectRevision(run.revision)
  const acceptedAt = Date.now()
  const ref: ArtifactRef = {
    artifactId: ACCEPTED_MANUSCRIPT_SLUG as ArtifactRef['artifactId'],
    // ONE REGISTRY ENTRY PER SLUG, so the accepted value REPLACES the step's and the counter is what
    // keeps the superseded revision legible to anything that recorded it.
    version: ((previous?.ref.version ?? 0) + 1) as ArtifactRef['version'],
    contentHash: hashed.value,
  }
  run.registry[ACCEPTED_MANUSCRIPT_SLUG] = {
    slug: ACCEPTED_MANUSCRIPT_SLUG,
    // A PERSON DECIDING IS NOT A STEP EXECUTING, and the record says so: a reader of the registry can
    // tell an artifact a step produced from one a person accepted.
    producerStepId: ACCEPTANCE_PRODUCER,
    producerAttemptId: 0,
    value: request.value,
    producedAt: acceptedAt,
    invalidated: false,
    ref,
    projectRevision: revision,
  }
  run.revision = revision
  const receipt: ManuscriptAcceptanceReceipt = {
    runId: request.runId,
    revision,
    ref,
    operator: request.operator,
    requestId: request.requestId,
    candidateId: request.candidateId,
    acceptedAt,
  }
  // THE RECORD NAMES THE VERSIONS, not only the fact: a later reader has to be able to tell what this
  // replaced, or the audit says an acceptance happened and not what it changed.
  appendAuditEvent(store, request.runId, 'manuscript-accepted', undefined, undefined, {
    ...receipt,
    replacedVersion: previous?.ref.version ?? null,
    replacedHash: previous?.ref.contentHash ?? null,
  })
  return receipt
}

/**
 * Whether a candidate may be accepted, as a READ a page can make before offering the control.
 *
 * It does not write and it cannot: it runs {@link checkAcceptance} and reports its refusal. The
 * operation above is the authority on what happens; this is the authority on what a page may OFFER,
 * and they share the check rather than restating it.
 *
 * @param store - the store holding the run.
 * @param request - what would be accepted.
 * @param review - the review facts.
 * @returns `{ ok: true }`, or the code and message of the first refusal.
 */
export function canAcceptManuscriptCandidate(
  store: ResearchRunStore,
  request: ManuscriptAcceptanceRequest,
  review: CandidateReviewFacts,
): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string } {
  const run: RunState = ensureRun(store, request.runId)
  const refusal = checkAcceptance(run, request, review)
  return refusal === null ? { ok: true } : { ok: false, code: refusal.code, message: refusal.message }
}
