/**
 * The single commit point: one attempt's outputs become the run's artifacts, atomically.
 *
 * WHY THIS EXISTS. The write path used to be one `recordArtifact` call per returned slug, with
 * the returned map iterated in whatever order the executor's object had. Three defects followed
 * from that and all three were reproduced before this module was written: a value that could not
 * be cloned threw AFTER earlier slugs had already landed in the registry, so a failed execution
 * left partial official output; a completion that arrived after a rollback was written under the
 * NEW attempt id, so a superseded result was recorded as the current one; and a gate could be
 * submitted for a step that had produced nothing at all.
 *
 * THREE RULES, each checked before anything is written:
 *  - COMPLETE: the candidate set must be exactly the step's declared outputs — no more, no fewer.
 *    A gate certifies a step's work, and a step missing an output has not done that work.
 *  - FENCED: the commit carries the attempt it was started for, and is refused when the step has
 *    moved on. This is the check that makes a rollback mean something to an executor still
 *    running: its result can no longer be credited to the attempt that replaced it.
 *  - ATOMIC: every value is cloned and hashed during validation, so the write phase that follows
 *    has no failure mode left in it. An error therefore cannot leave the registry half-updated.
 *
 * REVISION. A successful commit advances the run's revision by exactly one, and a commit whose
 * `expectedRevision` no longer matches is refused. Two writers that both read revision 7 cannot
 * both produce 8; the loser re-reads. The revision is what lets a caller say "commit against the
 * state I read" instead of "commit against whatever is there now" — and `nextProjectRevision` is
 * the only thing that advances it.
 */

import { createHash } from 'node:crypto'
import type { ArtifactRef } from '../domain/artifact.ts'
import { contentHashOf } from '../domain/artifact.ts'
import type { ContentHash, InputDigest, ProjectRevision } from '../domain/ids.ts'
import { nextProjectRevision } from '../domain/project.ts'
import type { ResearchRunStore, RunState, StepState } from './types.ts'
import { ResearchError, appendAuditEvent, ensureRun, nextArtifactVersion } from './state-machine.ts'
import { lookupStep } from './steps.ts'

/** One value an executor offers for commit, under the slug the step declared for it. */
export interface CommitCandidate {
  readonly slug: string
  readonly value: unknown
}

/** Why a commit was refused. Stable strings: a caller branches on these, and a reader sees the
 *  same words in the audit trail as in the source. */
export type CommitErrorCode =
  | 'DSH_COMMIT_UNKNOWN_STEP'
  | 'DSH_COMMIT_NOT_IN_PROGRESS'
  | 'DSH_COMMIT_STALE_ATTEMPT'
  | 'DSH_COMMIT_ALREADY_COMMITTED'
  | 'DSH_COMMIT_REVISION_CONFLICT'
  | 'DSH_COMMIT_OUTPUT_NOT_DECLARED'
  | 'DSH_COMMIT_OUTPUTS_INCOMPLETE'
  | 'DSH_COMMIT_DUPLICATE_OUTPUT'
  | 'DSH_COMMIT_VALUE_NOT_PERSISTABLE'

/** One artifact this commit wrote, identified by revision rather than by slug. */
export interface CommittedArtifact {
  readonly slug: string
  readonly ref: ArtifactRef
}

/**
 * What a commit did. A receipt is the evidence that the commit happened, and it is stored on the
 * attempt, so a repeated request with the same {@link CommitRequest.idempotencyKey} returns the
 * receipt of the FIRST commit rather than writing a second revision.
 */
export interface CommitReceipt {
  readonly stepId: string
  readonly attemptId: number
  /** The run revision this commit produced. */
  readonly revision: ProjectRevision
  readonly idempotencyKey: string
  readonly artifacts: ReadonlyArray<CommittedArtifact>
  /** SHA-256 over the committed input references, so a report can name the inputs it judged. */
  readonly inputDigest: InputDigest
  readonly committedAt: number
}

/** What one commit request carries. */
export interface CommitRequest {
  readonly attemptId: number
  /** The run revision the caller read. A commit against a stale revision is refused. */
  readonly expectedRevision: ProjectRevision
  /** Identifies this commit for replay. A repeat with the same key is not a second commit. */
  readonly idempotencyKey: string
  readonly outputs: ReadonlyArray<CommitCandidate>
  /** The versions this attempt read, for the receipt's digest. Empty is legal. */
  readonly inputRefs?: ReadonlyArray<ArtifactRef>
}

/** The outcome of a commit: the receipt, or the refusal that says why nothing was written. */
export type CommitOutcome =
  | { readonly ok: true; readonly receipt: CommitReceipt }
  | { readonly ok: false; readonly code: CommitErrorCode; readonly reason: string }

function refuse(code: CommitErrorCode, reason: string): CommitOutcome {
  return { ok: false, code, reason }
}

/**
 * A stable digest over an attempt's inputs: the ordered (id, version, hash) triples, hashed.
 *
 * Unknown and empty are separated on purpose — "this attempt read nothing" and "this attempt's
 * inputs were not recorded" must not produce the same digest, or a report could not tell them
 * apart either.
 *
 * @param refs - the input references, or undefined when the caller recorded none.
 * @returns the digest.
 */
export function inputDigestOf(refs: ReadonlyArray<ArtifactRef> | undefined): InputDigest {
  if (refs === undefined) {
    return createHash('sha256').update('inputs:unrecorded', 'utf8').digest('hex') as InputDigest
  }
  const text = refs
    .map(ref => `${ref.artifactId}@${String(ref.version)}#${ref.contentHash}`)
    .sort()
    .join('\n')
  return createHash('sha256').update(`inputs:recorded\n${text}`, 'utf8').digest('hex') as InputDigest
}

/** A prepared artifact: everything the write phase needs, computed before it starts. */
interface Prepared {
  readonly slug: string
  readonly value: unknown
  readonly contentHash: ContentHash
}

/**
 * Commit one attempt's outputs as the run's artifacts.
 *
 * The step must be `in_progress` and still be the attempt the caller started; the candidate set
 * must be exactly the step's declared outputs; every value must be cloneable and have a canonical
 * encoding; and `expectedRevision` must still be the run's revision. Any of those failing writes
 * NOTHING — neither an artifact, nor a revision, nor an audit event.
 *
 * @param store - the run store holding the run.
 * @param runId - the run to commit into; it must exist (RUN_NOT_FOUND — runs are never created here).
 * @param stepId - the step whose outputs are being committed.
 * @param request - the attempt, the expected revision, the idempotency key, and the outputs.
 * @returns the receipt on success; otherwise the refusal, naming which rule refused and why. A
 *   repeated request with a key this attempt already committed returns the FIRST receipt, so a
 *   retry after a lost response does not create a second revision.
 */
export function commitStepOutputs(
  store: ResearchRunStore,
  runId: string,
  stepId: string,
  request: CommitRequest,
): CommitOutcome {
  const run: RunState = ensureRun(store, runId)
  const step = lookupStep(stepId)
  if (!step) {
    return refuse('DSH_COMMIT_UNKNOWN_STEP', `commitStepOutputs: unknown step '${stepId}'`)
  }
  const state: StepState | undefined = run.steps.get(stepId)
  if (!state || state.status !== 'in_progress') {
    return refuse(
      'DSH_COMMIT_NOT_IN_PROGRESS',
      `commitStepOutputs: step '${stepId}' is '${state?.status ?? 'unknown'}', not 'in_progress' — only an executing step has outputs to commit`,
    )
  }
  // IDEMPOTENCY BEFORE THE FENCE. A retry of a commit that already succeeded must be able to read
  // its own receipt back; checking the fence first would report a stale attempt for a request
  // whose whole point is that it is a repeat.
  const previous = state.commit
  if (previous !== undefined && previous.idempotencyKey === request.idempotencyKey) {
    return { ok: true, receipt: previous }
  }
  if (state.attempt_id !== request.attemptId) {
    return refuse(
      'DSH_COMMIT_STALE_ATTEMPT',
      `commitStepOutputs: step '${stepId}' is on attempt ${String(state.attempt_id)} but this commit was started for attempt ${String(request.attemptId)} — a superseded attempt cannot write, however long its executor took`,
    )
  }
  if (previous !== undefined) {
    return refuse(
      'DSH_COMMIT_ALREADY_COMMITTED',
      `commitStepOutputs: step '${stepId}' attempt ${String(request.attemptId)} already committed under key '${previous.idempotencyKey}' — a second commit under a different key would silently replace it`,
    )
  }
  if (run.revision !== request.expectedRevision) {
    return refuse(
      'DSH_COMMIT_REVISION_CONFLICT',
      `commitStepOutputs: step '${stepId}' expected run revision ${String(request.expectedRevision)} but the run is at ${String(run.revision)} — the state this commit was prepared against has moved`,
    )
  }

  const declared = step.outputs
  const seen = new Set<string>()
  for (const candidate of request.outputs) {
    if (declared.indexOf(candidate.slug) === -1) {
      return refuse(
        'DSH_COMMIT_OUTPUT_NOT_DECLARED',
        `commitStepOutputs: slug '${candidate.slug}' is not declared in step '${stepId}' outputs — INV-OUTPUT-CONTRACT`,
      )
    }
    if (seen.has(candidate.slug)) {
      return refuse(
        'DSH_COMMIT_DUPLICATE_OUTPUT',
        `commitStepOutputs: slug '${candidate.slug}' was offered twice — which of the two values is the artifact is not decidable here`,
      )
    }
    seen.add(candidate.slug)
  }
  const missing = declared.filter(slug => !seen.has(slug))
  if (missing.length > 0) {
    return refuse(
      'DSH_COMMIT_OUTPUTS_INCOMPLETE',
      `commitStepOutputs: step '${stepId}' declares ${declared.join(', ')} but this commit has no value for ${missing.join(', ')} — a partially written step is not a step whose work is done`,
    )
  }

  // VALIDATE AND PREPARE EVERYTHING BEFORE WRITING ANYTHING. Cloning and hashing are the only
  // steps that can fail, and both happen here; the write phase below has no failure mode, which
  // is what makes "an error leaves nothing behind" true rather than merely intended.
  const prepared: Prepared[] = []
  for (const candidate of request.outputs) {
    let cloned: unknown
    try {
      cloned = structuredClone(candidate.value)
    } catch (e) {
      return refuse(
        'DSH_COMMIT_VALUE_NOT_PERSISTABLE',
        `commitStepOutputs: value for '${candidate.slug}' is not structured-cloneable (${e instanceof Error ? e.message : String(e)}) — nothing was written`,
      )
    }
    const hashed = contentHashOf(cloned)
    if (!hashed.ok) {
      return refuse(
        'DSH_COMMIT_VALUE_NOT_PERSISTABLE',
        `commitStepOutputs: value for '${candidate.slug}' has no canonical encoding (${hashed.reason}) — nothing was written`,
      )
    }
    prepared.push({ slug: candidate.slug, value: cloned, contentHash: hashed.value })
  }

  // ── write phase: no failure paths below this line ────────────────────────────
  const revision = nextProjectRevision(run.revision)
  const committedAt = Date.now()
  const artifacts: CommittedArtifact[] = []
  for (const item of prepared) {
    const ref: ArtifactRef = {
      artifactId: item.slug as ArtifactRef['artifactId'],
      version: nextArtifactVersion(run, item.slug) as ArtifactRef['version'],
      contentHash: item.contentHash,
    }
    state.artifacts[item.slug] = item.value
    run.registry[item.slug] = {
      slug: item.slug,
      producerStepId: stepId,
      producerAttemptId: state.attempt_id,
      value: item.value,
      producedAt: committedAt,
      invalidated: false,
      ref,
    }
    artifacts.push({ slug: item.slug, ref })
  }
  run.revision = revision
  const receipt: CommitReceipt = {
    stepId,
    attemptId: state.attempt_id,
    revision,
    idempotencyKey: request.idempotencyKey,
    artifacts,
    inputDigest: inputDigestOf(request.inputRefs),
    committedAt,
  }
  state.commit = receipt
  appendAuditEvent(store, runId, 'step-committed', stepId, state.attempt_id, receipt)
  return { ok: true, receipt }
}

/**
 * Throw the refusal a {@link commitStepOutputs} result carries, for callers whose contract is an
 * exception rather than a return value.
 *
 * The pipeline writes artifacts inside a promise chain, where a refusal has to become a rejection
 * to be recorded as an `error` disposition at all; returning a value there would look like success.
 *
 * @param outcome - the failed outcome.
 * @returns never: the call always throws.
 * @throws {ResearchError} carrying the outcome's code and reason.
 */
export function throwCommitRefusal(outcome: Extract<CommitOutcome, { ok: false }>): never {
  throw new ResearchError(outcome.code, outcome.reason)
}
