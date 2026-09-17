// @deepseek-ai/dsh-research-team — shared public types + local stateless helpers.
//
// PURE-LOGIC LAYER (T20, member-scope self-build). This file is the ONLY
// sibling every other src module may import (`types.ts`); it must stay free of
// ctx / host / DSH runtime imports so the whole pure layer typechecks and runs
// under plain vitest with no Cordis root.
//
// Shape mirrors the frozen T20 design spec §1/§2 (`t20-design-spec.md`):
// a star research team rooted at one Lead session whose durable log carries
// whole-value snapshots of members / tasks / artifact revisions. Event wire
// shapes (`research/member`, `research/task`, `research/rev`) are declared
// here as pure values; the SessionEventMap `declare module` augmentation lives
// in session-events.ts in the adapter round.
//
// This file also owns the local deep-freeze helper (same semantics as
// dsh-research-tools' shared.freezeArtifact, reimplemented here so the team
// package does not import across packages) and the shared error type.

// ───────────────────────────── Local brands ────────────────────────────────
// A single nominal symbol with a per-type literal keeps structurally identical
// strings non-interchangeable (TeamId ≭ SessionId ≭ TeamTaskId) while keeping
// comparison / logging / serialization as plain strings.

declare const DSH_RESEARCH_TEAM_BRAND: unique symbol

/** Branded root-session id; a research team IS its root Lead session id. */
export type TeamId = string & { readonly [DSH_RESEARCH_TEAM_BRAND]: 'TeamId' }

/** Branded agent/session id used to identify a research member (or a lead). */
export type SessionId = string & { readonly [DSH_RESEARCH_TEAM_BRAND]: 'SessionId' }

/** Branded task id carried by {@link ResearchTask} and its events. */
export type TeamTaskId = string & { readonly [DSH_RESEARCH_TEAM_BRAND]: 'TeamTaskId' }

/** Brand a root session id into a {@link TeamId}. Empty input is rejected.
 * @param rootSessionId - the Lead session id the team is identified by; blank input is refused.
 * @returns the same id branded {@link TeamId}, so it cannot be passed where a task or member id is expected.
 */
export function TeamId(rootSessionId: string): TeamId {
  if (rootSessionId.trim().length === 0) {
    throw new ResearchTeamError(
      `${DSH_RESEARCH_TEAM_ERROR_PREFIX}INVALID_TEAM_ID`,
      `TeamId: root session id must be a non-empty string (got ${JSON.stringify(rootSessionId)})`,
    )
  }
  return rootSessionId as TeamId
}

/** Brand an agent/session id string into a {@link SessionId}.
 * @param value - identity of a live or durable Session; blank input is refused.
 * @returns the same id branded {@link SessionId}.
 */
export function sessionId(value: string): SessionId {
  if (value.trim().length === 0) {
    throw new ResearchTeamError(
      `${DSH_RESEARCH_TEAM_ERROR_PREFIX}INVALID_SESSION_ID`,
      `sessionId: id must be a non-empty string (got ${JSON.stringify(value)})`,
    )
  }
  return value as SessionId
}

/** Brand a task id string into a {@link TeamTaskId}.
 * @param value - team-local task identity; blank input is refused.
 * @returns the same id branded {@link TeamTaskId}.
 */
export function taskId(value: string): TeamTaskId {
  if (value.trim().length === 0) {
    throw new ResearchTeamError(
      `${DSH_RESEARCH_TEAM_ERROR_PREFIX}INVALID_TASK_ID`,
      `taskId: id must be a non-empty string (got ${JSON.stringify(value)})`,
    )
  }
  return value as TeamTaskId
}

// ───────────────────────────── Shared error ────────────────────────────────

/** Globally unique, grep-able error-code prefix for this package. */
export const DSH_RESEARCH_TEAM_ERROR_PREFIX = 'DSH_RESEARCH_TEAM_'

/** Error-code suffixes; combined with {@link DSH_RESEARCH_TEAM_ERROR_PREFIX}. */
export type ResearchTeamErrorSuffix =
  | 'INVALID_TEAM_ID'
  | 'INVALID_SESSION_ID'
  | 'INVALID_TASK_ID'
  | 'INVALID_SCOPE'
  | 'REVISION_CONFLICT'
  | 'TASK_NOT_FOUND'
  | 'TASK_DELETED'
  | 'NOT_AUTHORIZED'
  | 'CLAIM_NOT_READY'
  | 'ACTIVE_TASK_CONFLICT'
  | 'INVALID_STATUS'
  | 'DEPENDENCY_CYCLE'
  | 'TEAM_MISMATCH'
  | 'INVALID_EVENT'
  | 'INVALID_PERSONA'
  | 'INVALID_MODEL'
  | 'INVALID_REBUTTAL'
  | 'REBUTTAL_UNKNOWN_ROLE'
  | 'DUPLICATE_VOTE'
  | 'ROUND_NOT_FOUND'
  | 'FLEET_NOT_DEPLOYED'
  | 'JUDGE_ROUND_INCOMPLETE'
  | 'INVALID_EXPERIMENT'

/** Globally unique error codes thrown by this package's pure logic. */
export type ResearchTeamErrorCode = `${typeof DSH_RESEARCH_TEAM_ERROR_PREFIX}${ResearchTeamErrorSuffix}`

/** Error thrown on any pure-logic domain violation (stale CAS revision,
 *  authorization denial, illegal claim, dependency cycle, malformed scope…). */
export class ResearchTeamError extends Error {
  /** The failure's stable code; the same value is bracketed into the message. */
  readonly code: ResearchTeamErrorCode

  constructor(code: ResearchTeamErrorCode, message: string, cause?: unknown) {
    super(`[${code}] ${message}`)
    this.name = 'ResearchTeamError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

/** Throw a {@link ResearchTeamError} with a {@link ResearchTeamErrorSuffix}.
 * @param suffix - the failure kind, without the package prefix.
 * @param detail - human-readable specifics of the violation.
 * @returns never — the throw is the whole effect.
 */
export function researchTeamError(
  suffix: ResearchTeamErrorSuffix,
  detail: string,
): never {
  throw new ResearchTeamError(`${DSH_RESEARCH_TEAM_ERROR_PREFIX}${suffix}`, detail)
}

// ───────────────────────── Deep-freeze helpers ─────────────────────────────
// INV-IMMUTABLE semantics identical to the core/tools snapshots: tool inputs
// and results are plain structured-cloneable data by contract, so
// structuredClone can only throw TypeError for non-cloneable input.

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

/** Deep-freeze a structured-cloneable value into an independent Readonly
 *  snapshot (clone-first, freeze-second — no live reference escapes).
 * @param value - the value to snapshot.
 * @returns a frozen deep copy; later mutation of the original cannot reach it.
 */
export function freezeValue<T>(value: T): Readonly<T> {
  return deepFreeze(structuredClone(value))
}

// ───────────────────────────── Domain types ────────────────────────────────

/** Membership role inside one research team. */
export type TeamRole = 'lead' | 'teammate'

/** Provisioning lifecycle of a durable member session. */
export type TeamMemberPhase = 'provisioning' | 'active' | 'failed'

/** Lifecycle of a research task (whole-value snapshots; deleted is terminal). */
export type TeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

/** Authorized state transitions a member/lead may apply to a task. */
export type TeamTaskAction =
  | 'claim'
  | 'release'
  | 'edit'
  | 'set_dependencies'
  | 'complete'
  | 'reopen'
  | 'reassign'
  | 'delete'

/** Roster entry of one durable research member (persisted whole-value). */
export interface ResearchMember {
  readonly id: SessionId
  readonly name: string
  readonly description: string
  readonly provider: string
  /** 'fresh' = spawned with an empty context; 'fork' = forked from the lead. */
  readonly context: 'fresh' | 'fork'
  readonly phase: TeamMemberPhase
  /** Non-empty only when phase === 'failed'. */
  readonly error?: string
}

/** Live presentation view of one member (resolved by the host round). */
export interface ResearchMemberView {
  readonly id: SessionId
  readonly name: string
  readonly role: TeamRole
  readonly status: 'running' | 'idle' | 'inactive' | 'provisioning' | 'failed'
  readonly model?: string
  readonly diagnostics: ReadonlyArray<string>
}

/** One claimable unit of research work. `writeScopes` are normalized path
 *  prefixes the owning member may write while the task is in_progress. */
export interface ResearchTask {
  readonly id: TeamTaskId
  /** Monotonic whole-value revision; every mutation appends revision + 1. */
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  /** Owning member; present while claimed/in_progress (and kept on completed
   *  for audit), cleared when the task returns to the pool. */
  readonly ownerId?: SessionId
  readonly blockedBy: ReadonlyArray<TeamTaskId>
  readonly writeScopes: ReadonlyArray<string>
}

/** One compare-and-set revision record for a shared artifact head. */
export interface ResearchRev {
  readonly artifactId: string
  readonly revision: number
  readonly prevRevision: number
  readonly kind: 'file' | 'claim' | 'section'
  readonly path: string
  readonly hash?: string
}

/** Result envelope of a board mutation at the public API boundary. The pure
 *  layer throws granular {@link ResearchTeamError}s; adapters map stale
 *  revisions to 'team-task-conflict' and every other rejection to
 *  'team-rejected'. */
export type TeamMutationResult<T = ResearchTask> =
  | { readonly ok: true; readonly value: T }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'team-task-conflict' | 'team-rejected'
      readonly message: string
    }
  }

// ───────────────────────── Pure fold event shapes ──────────────────────────
// Discriminated union fed to the pure projection reducer. `version: 1` mirrors
// the future SessionEventMap payload version; the adapter round maps between
// these and the injected session event types (session-events.ts).

/** One whole member record as the `research/member` event carries it; the fold
 *  replaces that member's entry by id, so a later event supersedes an earlier one. */
export interface ResearchMemberEvent {
  readonly type: 'research/member'
  readonly version: 1
  readonly teamId: TeamId
  readonly member: ResearchMember
}

/** One whole task snapshot as the `research/task` event carries it. The fold
 *  applies only a strictly newer revision, and a deleted id stays retired. */
export interface ResearchTaskEvent {
  readonly type: 'research/task'
  readonly version: 1
  readonly teamId: TeamId
  readonly task: ResearchTask
}

/** One artifact's compare-and-set revision as the `research/rev` event carries
 *  it; the fold keeps the highest revision seen per artifact id. */
export interface ResearchRevEvent {
  readonly type: 'research/rev'
  readonly version: 1
  readonly teamId: TeamId
  readonly rev: ResearchRev
}

// ─────────────────────── Red-team rebuttal (T21) ──────────────────────────
// One fleet voter's stance on the claim under rebuttal. The durable rebuttal
// event (`research/rebuttal`) is appended ONLY by the research Lead — fleet
// members never write the lead log (write-scope boundary); each event mirrors
// one accepted member vote. The projected TeamState deliberately does NOT fold
// rebuttals: they are an audit trail feeding the future T22/judge gate, whose
// pure reducer (`redteam/rebuttal.ts`) owns the round state machine.

/** One fleet voter's stance on the claim under rebuttal (spec §0). */
export type ResearchRebuttalPosition = 'support' | 'refute' | 'abstain'

/** One accepted red-team rebuttal vote, durably recorded by the Lead.
 *  `voterRole` is the persona/role name (never a model id); `modelFamily`
 *  mirrors the member's live `options.model` so same-family votes can be
 *  DETECTED + downweighted by the future gate (C3 — never report same-family
 *  votes as genuine model heterogeneity). */
export interface ResearchRebuttal {
  /** Stable round identifier grouping one (claim × judgment point) review. */
  readonly roundId: string
  /** Claim reference text/id under rebuttal. */
  readonly claimRef: string
  /** Judgment point identifier (e.g. 'A2' / 'B1' / 'C2'), caller-owned. */
  readonly gate: string
  /** Fleet persona/role name that cast this vote (e.g. 'red-method'). */
  readonly voterRole: string
  /** Durable member Session identity that returned the vote. */
  readonly voterId: SessionId
  readonly position: ResearchRebuttalPosition
  /** Non-empty human rationale backing the position. */
  readonly rationale: string
  /** The member's live model name, when resolvable at vote time. */
  readonly modelFamily?: string
}

/** One accepted fleet vote as the `research/rebuttal` event carries it; the
 *  research Lead is its only writer. */
export interface ResearchRebuttalEvent {
  readonly type: 'research/rebuttal'
  readonly version: 1
  readonly teamId: TeamId
  readonly rebuttal: ResearchRebuttal
}

/** Every event shape the fold accepts. A `research/rebuttal` still crosses the
 *  validation seam before the fold, but contributes nothing to {@link TeamState}. */
export type ResearchEvent =
  | ResearchMemberEvent
  | ResearchTaskEvent
  | ResearchRevEvent
  | ResearchRebuttalEvent

/** Projection state folded from a team's whole-value event log. */
export interface TeamState {
  readonly teamId: TeamId
  /** By member id. */
  readonly members: Readonly<Record<string, ResearchMember>>
  /** By task id; deleted tasks stay as terminal tombstones. */
  readonly tasks: Readonly<Record<string, ResearchTask>>
  /** Head revision per artifact id (monotonic). */
  readonly artifactRevs: Readonly<Record<string, ResearchRev>>
}

/**
 * Wire request for `ResearchTeamService.run`, the Remote entry to the 16-step pipeline.
 *
 * A distinct type from the in-process pipeline options because an `AbortSignal` cannot
 * cross the wire: the request carries the seed alone and the Gateway contributes
 * cancellation through the trailing parameter.
 */
export interface ResearchRunRequest {
  /** Seed for the run's single seedable input (`domain-direction`). */
  readonly domainDirection?: string
  /**
   * The research this run carries, when the caller states one.
   *
   * Untrusted at this boundary and validated by the host before the run starts: everything
   * downstream trusts the plan completely, so a malformed one would not fail where it entered — it
   * would produce a run whose title, retrieval topic and graded claim disagree with each other.
   */
  readonly plan?: StudyPlan
}

/**
 * Wire request for `ResearchTeamService.proposeDirections`, the run dialog's first call.
 *
 * @see ResearchRunRequest.plan — what a confirmed proposal becomes.
 */
export interface ResearchProposalRequest {
  /**
   * The domain the person stated. Absent or empty asks for the field the study itself belongs to,
   * which the host substitutes rather than sending an empty field to the model.
   */
  readonly field?: string
}

/** One proposal, with the plan that confirming it would run. */
export interface ResearchProposalEntry {
  /** What the host validated. The dialog sends this back unchanged as `ResearchRunRequest.plan`. */
  readonly plan: StudyPlan
  /** The model's own words, which the dialog shows as content rather than as copy. */
  readonly title: string
  readonly direction: string
  readonly claim: string
}

/** One block of the model's answer that became no proposal, and the reason it did not. */
export interface ResearchProposalRefusal {
  readonly reason: string
  readonly block: string
}

/**
 * What `proposeDirections` answers with.
 *
 * Refusals travel beside the proposals rather than being dropped: an answer whose every block was
 * refused and an answer that proposed nothing are different facts, and a client that only counted
 * proposals could not tell a person which happened.
 */
export interface ResearchProposalAnswer {
  readonly proposals: ReadonlyArray<ResearchProposalEntry>
  readonly refusals: ReadonlyArray<ResearchProposalRefusal>
  /** Which channel produced the proposals, so a person knows whether a model was reached. */
  readonly channel: string
}

import type { EvidenceProfile } from '@deepseek-ai/dsh-research-core'
import type { StudyPlan } from './runner/study-plan.ts'

export type { PlanClaim, PlanSection, StudyPlan } from './runner/study-plan.ts'

/**
 * The runner's per-step outcome shape, re-exported so the Remote boundary can name it.
 *
 * The Typert generator requires a Remote method's parameter and result types to be
 * exported from a public non-root type subpath (`./types`), so the boundary types are
 * re-exported here rather than reached through the root entry.
 */
import type { StepProjection } from './runner/project-view.ts'

export type { RunResult, StepOutcome, StepArtifactEvidence } from './runner/types.ts'

/**
 * One pipeline step's catalogue entry, as the Remote boundary carries it.
 *
 * A client receives the run's per-step outcomes keyed by `stepId` and has no other way
 * to learn a step's index, phase, display name, or whether it gates on a human — that
 * catalogue belongs to core. Sending it with the run keeps the client from duplicating
 * the 16-step definition, where it would drift.
 */
export interface ResearchStepCatalogEntry {
  readonly id: string
  readonly index: number
  readonly phase: string
  readonly name: string
  readonly humanGate: boolean
  readonly gate: ReadonlyArray<string>
}

/**
 * One gate verdict as the Remote boundary carries it.
 *
 * Projected from the run's own snapshot rather than rebuilt from the summary counts,
 * because `evidence` and `rationale` are what a reader checks a verdict against and
 * they exist only on the recorded verdict.
 */
/**
 * What a start command answers with.
 *
 * The run id is usable IMMEDIATELY — the driver is already on it — and `persisted` says whether a
 * restart could find it. That is a separate fact and it is reported separately: a deployment with
 * no snapshot directory answers `persisted: false`, which is not a failure of the start but is the
 * reason a reader must not close the page and expect the run to still be there.
 */
export interface ResearchRunStart {
  readonly runId: string
  /** Whether the run is on disk. FALSE means a restart cannot find it. */
  readonly persisted: boolean
  /** Why it is not on disk, when it is not. */
  readonly persistenceError?: string
  /** When this process received the command. */
  readonly startedAt: number
}

/**
 * One study this deployment holds, as a list entry.
 *
 * A STUDY OUTLIVES THE PAGE THAT STARTED IT, and a browser that closed has nothing left to name it
 * by: the run id lived in that tab's storage. This is the entry a person picks from instead — the
 * deployment's own inventory, read from the runs it holds, not from anything the page remembered.
 */
export interface ResearchRunSummaryEntry {
  readonly runId: string
  /** Whether a driver is on it IN THIS PROCESS; `stopped` says only that nothing here is. */
  readonly execution: ResearchRunExecution
  /** The revision the study is at, so two entries can be told apart by what they produced. */
  readonly projectRevision: number
  /** How many of the pipeline's steps have passed. */
  readonly stepsPassed: number
  /** How many steps are catalogued, so "3 of 16" is a fact rather than an impression. */
  readonly stepsTotal: number
  readonly submissionReady: boolean
  /** Why the run's last save did not land, when it did not. */
  readonly saveFailure?: string
  /** Why a driver stopped with a failure, when it did. */
  readonly executionError?: string
  /**
   * The steps that were in flight when the snapshot was taken, for a run this process is not driving.
   *
   * Empty for a run this process holds, whose live state is the answer instead.
   */
  readonly interrupted: ReadonlyArray<string>
}

/**
 * What one retry of a run's write did, and the run as it stands after it.
 *
 * The remedy for a save that failed, and the reason it is a separate command rather than a second
 * `startRun`: the state it writes is the one this process already holds. Nothing is re-executed —
 * a finished study has already cost what it cost, and running it again to make a write succeed
 * would produce different numbers under the same name.
 */
export interface ResearchRunSaveRetry {
  readonly runId: string
  /** Whether the run's current state reached its snapshot. */
  readonly persisted: boolean
  /** Why it did not, when it did not. */
  readonly persistenceError?: string
  /**
   * The run re-projected after the retry, so the caller renders backend truth rather than its own.
   *
   * A retry moves the SNAPSHOT's revision — the write counter in `runPersistence` — and deliberately
   * not the run's `projectRevision`: that one counts what the study committed, and writing the same
   * state to disk again commits nothing. A decision taken before the retry therefore still names a
   * current revision, and the binding it is held to is unchanged by the recovery.
   */
  readonly snapshot: ResearchRunSnapshot
}

/**
 * One start command.
 *
 * `commandId` is the caller's, and it is what makes a retry a retry: the same id reads the answer
 * the first send produced instead of beginning a second study.
 */
export interface ResearchStartRequest {
  readonly commandId: string
  readonly domainDirection?: string
  readonly plan?: StudyPlan
}

/**
 * A position in one run's append-only event log.
 *
 * OPAQUE, and scoped: the string carries the run it belongs to, so a cursor presented for a
 * different run is refused rather than read as a position in that run's history. What it names is
 * the event's INDEX — see `runner/run-events.ts` for why an index and not a timestamp.
 */
export type ResearchRunCursor = string & { readonly [DSH_RESEARCH_TEAM_BRAND]: 'ResearchRunCursor' }

/**
 * The envelope format this build writes — plan §7.1's `EventEnvelope`.
 *
 * A reader compares it against the one it knows and refuses an envelope it cannot read, rather than
 * parsing fields that may have moved.
 */
export const RUN_EVENT_ENVELOPE_VERSION = 1

/**
 * One recorded event, as a subscriber receives it.
 *
 * `sequence` is the position the cursor names; `eventId` is the same position written as the
 * scoped string a caller can hand back. Two things are deliberately NOT here:
 *   - the run's `revision`: the log does not record which revision each event was appended under,
 *     and one read off the run at delivery time would be a claim about the past made from the
 *     present. The snapshot frame carries the run's revision, which is a fact a reader has;
 *   - the event's own `detail`: a bare `unknown` has no place on a wire boundary, and the typert
 *     generator refuses it (it caught this on the first build). What a subscriber needs from an
 *     event is WHICH event it was and WHERE it sits — the state it produced arrives as the
 *     projection beside it. A consumer that needs a specific payload gets a typed field for it.
 */
export interface RunEventEnvelope {
  /** The event's identity: `<runId>#<index>`. Not the position to continue from — see `cursor`. */
  readonly eventId: string
  readonly runId: string
  /** The event's index in the run's log. Strictly increasing, never reused. */
  readonly sequence: number
  /**
   * The position AFTER this event, for a reader that has consumed it.
   *
   * A reader names this to continue, and it carries the log's identity as well as the count, so a
   * position in a DIFFERENT history of the same run is refused rather than continued from.
   */
  readonly cursor: ResearchRunCursor
  readonly schemaVersion: number
  /** The `AuditEventKind` this event was appended as. */
  readonly kind: string
  readonly stepId?: string
  readonly attemptId?: number
  /** When the run appended it (`AuditEvent.ts`). */
  readonly ts: number
}

/**
 * What one follow stream yields.
 *
 * THE SNAPSHOT FRAME IS THE CONSISTENT POINT, and it is the answer to "no gap between snapshot and
 * subscription": the cursor it carries is the position the snapshot was read at, and the run's log
 * only grows, so the snapshot already contains the effect of every event at or before it. A reader
 * that reconnects does not have to replay what it missed — it is handed a state that includes it —
 * and the frames after it are exactly the events appended since.
 */
export type ResearchRunFrame =
  | {
    readonly type: 'snapshot'
    readonly cursor: ResearchRunCursor
    readonly snapshot: ResearchRunSnapshot
  }
  /** One event appended after the opening cursor, in sequence order. */
  | { readonly type: 'event'; readonly event: RunEventEnvelope }
  /**
   * The cursor cannot be served, so the reader must take a fresh opening.
   *
   * Today this is reachable for a cursor that names another run, or one the run's log has not
   * reached. The run's log is never trimmed, so no cursor this deployment ever produced becomes
   * unservable on its own; a build that introduces trimming owes this frame a second reason.
   */
  | { readonly type: 'resync'; readonly reason: string }

/** What a client sends to follow a run. */
export interface ResearchRunFollowRequest {
  readonly runId: string
  /**
   * The last position the caller holds, or absent to start at the current end.
   *
   * It is VALIDATED, not replayed from: the opening snapshot is read at the current position and
   * already contains everything up to it.
   */
  readonly cursor?: string
}

/** The query a client sends to read one run. */
export interface ResearchRunQuery {
  readonly runId: string
}

/** Whether this process still has a driver on a run. */
export type ResearchRunExecution =
  /** A driver is on it here and now. */
  | 'running'
  /** Nothing is driving it here: it finished, it was never started here, or the driver is gone. */
  | 'stopped'
  /** A driver was on it and threw; the snapshot's `executionError` says what. */
  | 'failed'

/** One gate verdict recorded during a run, with the evidence it carried. */
export interface ResearchGateVerdictView {
  readonly stepId: string
  readonly component: string
  readonly outcome: string
  readonly passed: boolean
  readonly evidence: string
  readonly rationale: string
  readonly timestamp: number
}

/** One produced artifact's metadata as the Remote boundary carries it. */
export interface ResearchArtifactMetaView {
  readonly slug: string
  readonly producerStepId: string
  readonly producerAttemptId: number
  readonly producedAt: number
  readonly invalidated: boolean
}

/**
 * One step's runtime state.
 *
 * `RunResult` carries the attempt id but not the hold reason, and a client rendering a
 * held step needs to tell an abstention from a human wait.
 */
export interface ResearchStepStateView {
  readonly stepId: string
  readonly status: string
  readonly attempt: number
  /**
   * The hold reason recorded on the step, or `null`.
   *
   * Only a gate abstention records one (`gate_abstained`). A step waiting at the human
   * gate reads `status: 'gated'` with `holdReason: null` — its hold is the absence of an
   * approval, not a recorded reason.
   */
  readonly holdReason: string | null
  /**
   * The last human decision recorded against this step, or `null` when none was.
   *
   * Carried on the snapshot rather than only in the decision's own response, because a page that
   * loads AFTER the decision — a reload, another tab, tomorrow — must be able to state who decided,
   * when, and, for a change request, what was asked for. A receipt that only the deciding tab ever
   * sees is a fact about that tab, not about the study.
   */
  readonly approval: ResearchStepApprovalView | null
}

/** One step's recorded human decision, as the wire carries it. */
export interface ResearchStepApprovalView {
  /** `approved`, `rejected`, or `request_changes`, which leaves the gate open. */
  readonly decision: string
  /** The host-attested operator the decision was recorded under. */
  readonly operator: string
  readonly decidedAt: number
  /** The instruction a change request carries, or a rejection's reason. */
  readonly rationale: string | null
  /** The artifact revisions that were in front of the person when they decided. */
  readonly targetRefs: ReadonlyArray<{ readonly artifactId: string; readonly version: number }>
}

/**
 * One request to revise the manuscript, as the page asks for it.
 *
 * The instruction is the person's own words; the run and the gate say which study and which
 * decision it answers. The revision is read by the SERVICE rather than stated by the caller, for the
 * same reason an approval's revision is: a caller that named its own would be promising it read one.
 */
export interface ResearchRevisionRequest {
  readonly requestId: string
  readonly runId: string
  /** The gate step the request was made at. */
  readonly stepId: string
  readonly instruction: string
}

/** One operation on an existing request: write a candidate, judge one, or accept one. */
export interface ResearchCandidateRequest {
  readonly runId: string
  readonly requestId: string
  /** The candidate to act on; ignored when writing one, which mints its own. */
  readonly candidateId: string
  /**
   * The run revision and manuscript version the person READ, for an acceptance.
   *
   * Required by the acceptance operation and ignored by the other two: without them it would be a
   * publication over whatever the run happens to hold when the button is pressed.
   */
  readonly expectedRevision?: number
  readonly expectedManuscriptVersion?: number
}

/** One candidate section, as the page renders it. */
export interface ResearchCandidateSectionView {
  readonly sectionId: string
  readonly heading: string
  /** False means the candidate left this section exactly as it was. */
  readonly changed: boolean
  /** The body the candidate replaced, so the page shows a diff rather than a claim of one. */
  readonly basisText: string
  readonly bodyText: string
}

/** One candidate manuscript, as the page renders it. */
export interface ResearchCandidateView {
  readonly candidateId: string
  /** Which channel wrote it (`llm` / `deterministic`), so the text's provenance is on screen. */
  readonly writer: string
  readonly createdAt: number
  readonly sections: ReadonlyArray<ResearchCandidateSectionView>
}

/** One check's verdict, as the page renders it. */
export interface ResearchReviewFindingView {
  readonly check: string
  readonly passed: boolean
  readonly detail: string
}

/** One candidate's review, as the page renders it. */
export interface ResearchReviewView {
  readonly candidateId: string
  readonly passed: boolean
  readonly findings: ReadonlyArray<ResearchReviewFindingView>
}

/**
 * One revision request with everything recorded against it.
 *
 * WHAT IS NOT IN HERE, deliberately: an acceptance. A candidate cannot be made the official
 * manuscript yet — that needs the accepting transaction the module design describes as a core
 * operation — so the view carries no field that would let a page render one as accepted.
 */
export interface ResearchRevisionView {
  readonly runId: string
  readonly requestId: string
  readonly instruction: string
  readonly operator: string
  /** The project revision the person was reading when they asked. */
  readonly projectRevision: number
  readonly requestedAt: number
  /** The manuscript version the request read; an acceptance is checked against this. */
  readonly manuscriptVersion: number
  /** The sections the request read, with the body hash each one had. */
  readonly sections: ReadonlyArray<{ readonly sectionId: string; readonly heading: string; readonly basisHash: string }>
  /** The sections the instruction is about; the rest of the manuscript is carried unchanged. */
  readonly targets: ReadonlyArray<string>
  readonly candidates: ReadonlyArray<ResearchCandidateView>
  readonly reviews: ReadonlyArray<ResearchReviewView>
  /**
   * What an acceptance produced, when one has happened.
   *
   * ABSENT UNTIL A CANDIDATE IS ACCEPTED, which is not the same as a failed acceptance: the page
   * renders the difference, and a view that defaulted this would show an acceptance nobody made.
   */
  readonly acceptance?: ResearchAcceptanceView
}

/** One accepted candidate, as the page renders it. */
export interface ResearchAcceptanceView {
  /** The run revision the acceptance published. */
  readonly revision: number
  /** The manuscript version the accepted text became. */
  readonly manuscriptVersion: number
  readonly operator: string
  readonly acceptedAt: number
  /** Whether it reached the run's durable snapshot; a restart keeps what the disk has. */
  readonly persisted: boolean
  readonly persistenceError?: string
}

/** What `ResearchTeamService.runPipeline` returns, and what the Remote `run` sends. */
export interface ResearchRunSnapshot {
  /**
   * The run and its steps, read from the run's own records.
   *
   * NOT the drive call's result: a run still executing has none, and a query that had to wait for
   * one would not be a query. `stepProjectionsOf` builds every step from the run snapshot, the
   * artifact registry, the executor registry and the `step-executed` audit records — so a running
   * study reports its real steps, its real artifacts, and WHY a step stopped, whether or not the
   * drive call has returned.
   */
  readonly run: {
    readonly runId: string
    readonly steps: ReadonlyArray<StepProjection>
  }
  /**
   * The project revision this snapshot was read at.
   *
   * The artifacts below belong to this state of the run. A reader comparing what the page shows with
   * an exported package — which names the same revision — can tell whether the two describe the same
   * study state, which `producedAt` timestamps cannot answer.
   */
  readonly projectRevision: number
  /** The catalogue for the steps in `run.steps`, in canonical order. */
  readonly catalog: ReadonlyArray<ResearchStepCatalogEntry>
  /** Every gate verdict recorded during the run, with the evidence each carried. */
  readonly gates: ReadonlyArray<ResearchGateVerdictView>
  /** Every artifact the run registered, with its recorded metadata. */
  readonly artifacts: ReadonlyArray<ResearchArtifactMetaView>
  /** Per-step runtime state (attempt, hold reason). */
  readonly steps: ReadonlyArray<ResearchStepStateView>
  /**
   * The evidence profile this run was conducted under, and whether what it produced may be
   * submitted.
   *
   * The browser surface reads this to say what kind of run it is showing. A view that rendered
   * an evaluation run and a production run identically would invite a reader to take the first
   * for the second.
   */
  readonly evidenceProfile: EvidenceProfile
  readonly profileEligible: boolean
  readonly submissionReady: boolean
  readonly readinessNote: string
  /**
   * Whether this PROCESS is still executing the run.
   *
   * Not a durable fact, and deliberately not persisted: a restart has no drivers, so reporting
   * `running` from a record written by a process that is gone would be the lie this field exists
   * to prevent. `running` means a driver is on it here and now; `stopped` means nothing is.
   */
  readonly execution: ResearchRunExecution
  /** Why the driver stopped with a failure, when it did. */
  readonly executionError?: string
  /**
   * The export result, when the deployment configured a package directory.
   *
   * Carries the manifest the run wrote: every file with its byte count and content digest,
   * plus the per-step record. A run with no configured directory leaves this null, and a run
   * whose export failed reports it rather than silently omitting it.
   */
  readonly packageExport: ResearchPackageExport | null
  /**
   * The durability result, when the deployment configured a snapshot directory.
   *
   * `revision` is the persisted revision on success and null on failure, with `error` naming the
   * failure. Null (the whole field) means the deployment configured no directory, which is a
   * different fact from a write that was attempted and refused.
   */
  readonly runPersistence: ResearchRunPersistence | null
}

/** What persisting one run did, or why it did nothing. */
export interface ResearchRunPersistence {
  readonly runId: string
  /** Persisted revision, or null when the write was refused or failed. */
  readonly revision: number | null
  /** Steps that were in flight when the snapshot was taken (empty for a fresh save). */
  readonly interrupted: ReadonlyArray<string>
  /** Set when the write failed; `revision` is then null. */
  readonly error?: string
  /**
   * The run this save replaced in the snapshot directory, when one was stored.
   *
   * The directory holds ONE run, so a new one takes its place. Reported here because this is
   * where a reader actually looks — the service's own logger goes to a sink that the shipped
   * profile attaches no exporter to, so a warning written there is not visibility.
   */
  /** The directory this snapshot was written to; see {@link ResearchPackageExport.directory}. */
  readonly directory?: string
}

/** What a run's package export produced, or why it produced nothing. */
export interface ResearchPackageExport {
  /** Paths as written, relative to the package root. Never the absolute directory. */
  readonly files: ReadonlyArray<{ readonly path: string; readonly bytes: number; readonly sha256: string }>
  /** Set when the export failed; `files` is then empty. */
  readonly error?: string
  /**
   * The directory the package was written to.
   *
   * Reported so the person who asked the run to produce files can find them: a list of names with
   * nowhere to look is half an answer. It is the directory the DEPLOYMENT configured, told back to
   * the operator who configured it — not a machine path leaking out of an export, which is what
   * the package files themselves must never contain.
   */
  readonly directory?: string
  /**
   * Whether what was written is the final package or a working draft, and the conditions that
   * decided it.
   *
   * Reported on the wire because the page states them BESIDE the export control: a reader who is
   * told "refused" and not which condition failed has to guess what to do next, and a reader who is
   * told the package is final has to be able to check that against the run's own records.
   */
  readonly state?: 'draft' | 'final'
  readonly checks?: ReadonlyArray<{ readonly code: string; readonly passed: boolean; readonly detail: string }>
}
