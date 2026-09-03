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

/** Brand a root session id into a {@link TeamId}. Empty input is rejected. */
export function TeamId(rootSessionId: string): TeamId {
  if (rootSessionId.trim().length === 0) {
    throw new ResearchTeamError(
      `${DSH_RESEARCH_TEAM_ERROR_PREFIX}INVALID_TEAM_ID`,
      `TeamId: root session id must be a non-empty string (got ${JSON.stringify(rootSessionId)})`,
    )
  }
  return rootSessionId as TeamId
}

/** Brand an agent/session id string into a {@link SessionId}. */
export function sessionId(value: string): SessionId {
  if (value.trim().length === 0) {
    throw new ResearchTeamError(
      `${DSH_RESEARCH_TEAM_ERROR_PREFIX}INVALID_SESSION_ID`,
      `sessionId: id must be a non-empty string (got ${JSON.stringify(value)})`,
    )
  }
  return value as SessionId
}

/** Brand a task id string into a {@link TeamTaskId}. */
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

/** Globally unique error codes thrown by this package's pure logic. */
export type ResearchTeamErrorCode = `${typeof DSH_RESEARCH_TEAM_ERROR_PREFIX}${ResearchTeamErrorSuffix}`

/** Error thrown on any pure-logic domain violation (stale CAS revision,
 *  authorization denial, illegal claim, dependency cycle, malformed scope…). */
export class ResearchTeamError extends Error {
  readonly code: ResearchTeamErrorCode

  constructor(code: ResearchTeamErrorCode, message: string, cause?: unknown) {
    super(`[${code}] ${message}`)
    this.name = 'ResearchTeamError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

/** Throw a {@link ResearchTeamError} with a {@link ResearchTeamErrorSuffix}. */
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
 *  snapshot (clone-first, freeze-second — no live reference escapes). */
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

export interface ResearchMemberEvent {
  readonly type: 'research/member'
  readonly version: 1
  readonly teamId: TeamId
  readonly member: ResearchMember
}

export interface ResearchTaskEvent {
  readonly type: 'research/task'
  readonly version: 1
  readonly teamId: TeamId
  readonly task: ResearchTask
}

export interface ResearchRevEvent {
  readonly type: 'research/rev'
  readonly version: 1
  readonly teamId: TeamId
  readonly rev: ResearchRev
}

export type ResearchEvent =
  | ResearchMemberEvent
  | ResearchTaskEvent
  | ResearchRevEvent

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
