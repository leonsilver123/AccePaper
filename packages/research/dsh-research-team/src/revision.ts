// @deepseek-ai/dsh-research-team — pure CAS / state-transition engine.
//
// PURE-LOGIC LAYER (T20). No ctx / host / DSH imports, no runtime state, no
// clock: the epoch-based sequencing is expressed through the caller-supplied
// whole-value `revision` (every successful mutation appends revision + 1). All
// rejections throw {@link ResearchTeamError}; the adapter round maps these to
// {@link TeamMutationResult}.
//
// Ownership model (frozen T20 spec §1): every task carries `ownerId` while it
// is claimed / in_progress. A mutation is authorized when the actor is the
// task owner OR a lead ('lead' is exempt). `claim` is the one action with no
// pre-existing owner: it requires status 'pending' and every blocker
// 'completed'. DEC-004 / U-B keeps ONE active in_progress write task per
// member, so a second claim (or a reassign onto an already-active member) is
// rejected.
//
// writeScopes are normalized path prefixes; overlap between two claims is
// advisory only (CAS revision conflicts are the hard reject), matching the
// agent-team task-board semantics reproduced in the T20 design spec §1.
//
// State machine (task statuses): pending → in_progress → completed;
// in_progress → pending (release); completed → pending (reopen);
// any non-deleted → deleted (terminal tombstone).

import { freezeValue, researchTeamError } from './types.ts'
import type {
  ResearchTask,
  SessionId,
  TeamRole,
  TeamTaskAction,
  TeamTaskId,
  TeamTaskStatus,
} from './types.ts'

// ───────────────────────────── Write-scope rules ───────────────────────────

/** Normalize one path-prefix scope: trim, backslashes → '/', collapse
 *  duplicate slashes and '.' segments, drop trailing '/'. '..' traversal and
 *  empty results are rejected ({@link DSH_RESEARCH_TEAM_INVALID_SCOPE}). */
export function normalizeScope(scope: string): string {
  if (typeof scope !== 'string') {
    researchTeamError('INVALID_SCOPE', `normalizeScope: scope must be a string (got ${String(scope)})`)
  }
  const trimmed = scope.trim()
  const segments = trimmed
    .replaceAll('\\', '/')
    .split('/')
    .filter(segment => segment !== '' && segment !== '.')
  if (segments.length === 0) {
    researchTeamError('INVALID_SCOPE', `normalizeScope: scope ${JSON.stringify(scope)} is empty after normalization`)
  }
  if (segments.some(segment => segment === '..')) {
    researchTeamError('INVALID_SCOPE', `normalizeScope: scope ${JSON.stringify(scope)} contains '..' traversal`)
  }
  return segments.join('/')
}

/** Normalize a whole scope list into a canonical frozen array: each entry via
 *  {@link normalizeScope}, de-duplicated and sorted (deterministic snapshots). */
export function normalizeWriteScopes(scopes: ReadonlyArray<string>): ReadonlyArray<string> {
  const canonical = [...new Set(scopes.map(scope => normalizeScope(scope)))].sort()
  return freezeValue(canonical)
}

/** True when `child` is `parent` or lives under the `parent/` directory
 *  boundary (scope containment used for overlap detection). Inputs are
 *  assumed canonical (no trailing slash), though a trailing slash on `parent`
 *  is tolerated. */
export function scopeContains(parent: string, child: string): boolean {
  const base = parent.length > 0 && parent.endsWith('/') ? parent.slice(0, -1) : parent
  if (base.length === 0) return false
  return child === base || child.startsWith(`${base}/`)
}

/** True when two canonical scopes overlap (one contains the other). Overlap is
 *  advisory: it produces a warning, never a hard reject. */
export function overlapOnlyWarn(scopeA: string, scopeB: string): boolean {
  return scopeContains(scopeA, scopeB) || scopeContains(scopeB, scopeA)
}

// ───────────────────────────── Snapshot helpers ────────────────────────────

/** CAS read guard: the intent must be based on the CURRENT whole-value
 *  revision, otherwise the write is stale and rejected. */
export function assertExpectedRevision(
  current: ResearchTask | undefined,
  expectedRevision: number,
): ResearchTask {
  if (current === undefined) {
    researchTeamError('TASK_NOT_FOUND', 'assertExpectedRevision: no task snapshot to check')
  }
  if (current.revision !== expectedRevision) {
    researchTeamError(
      'REVISION_CONFLICT',
      `assertExpectedRevision: task ${current.id} is at revision ${String(current.revision)} but the caller expected ${String(expectedRevision)}`,
    )
  }
  return current
}

/** Fields a mutation may change; absent fields stay unchanged, `ownerId: null`
 *  clears the owner. Produces an independent frozen snapshot with
 *  `revision + 1`. */
export interface ResearchTaskPatch {
  readonly subject?: string
  readonly description?: string
  readonly status?: TeamTaskStatus
  readonly ownerId?: SessionId | null
  readonly blockedBy?: ReadonlyArray<TeamTaskId>
  readonly writeScopes?: ReadonlyArray<string>
}

/** Next whole-value snapshot after applying a patch (revision bumped by 1).
 *  Patch arrays are copied and the result is deep-frozen — no live reference
 *  escapes and no input array is mutated. */
export function nextSnapshot(
  current: ResearchTask,
  patch: ResearchTaskPatch,
): ResearchTask {
  const ownerPart =
    patch.ownerId === undefined
      ? current.ownerId === undefined
        ? {}
        : { ownerId: current.ownerId }
      : patch.ownerId === null
        ? {}
        : { ownerId: patch.ownerId }
  const next: ResearchTask = {
    id: current.id,
    revision: current.revision + 1,
    subject: patch.subject ?? current.subject,
    description: patch.description ?? current.description,
    status: patch.status ?? current.status,
    ...ownerPart,
    blockedBy: patch.blockedBy !== undefined ? [...patch.blockedBy] : [...current.blockedBy],
    writeScopes: patch.writeScopes !== undefined ? [...patch.writeScopes] : [...current.writeScopes],
  }
  return freezeValue(next)
}

// ───────────────────────────── Task mutations ──────────────────────────────

/** Who performs a mutation: a member (teammate) or the research lead. */
export interface TaskActor {
  readonly role: TeamRole
  readonly id: SessionId
}

/** Full mutation intent. `board` is the current task projection (needed for
 *  claim readiness and dependency-cycle detection). */
export interface TaskMutationInput {
  readonly action: TeamTaskAction
  readonly taskId: TeamTaskId
  readonly expectedRevision: number
  readonly actor: TaskActor
  readonly board: ReadonlyArray<ResearchTask>
  /** claim / edit payload. */
  readonly writeScopes?: ReadonlyArray<string>
  /** set_dependencies payload (replaces blockedBy). */
  readonly blockedBy?: ReadonlyArray<TeamTaskId>
  /** reassign payload. */
  readonly newOwnerId?: SessionId
  /** edit payload. */
  readonly subject?: string
  /** edit payload. */
  readonly description?: string
}

/** Owner-or-lead authorization for mutations on an owned task. */
function requireOwnerOrLead(
  task: ResearchTask,
  actor: TaskActor,
  action: TeamTaskAction,
): void {
  if (actor.role === 'lead') return
  if (actor.id === task.ownerId) return
  researchTeamError(
    'NOT_AUTHORIZED',
    `${action} task ${task.id}: member ${actor.id} is not the owner (owner ${
      task.ownerId === undefined ? 'unset' : task.ownerId
    })`,
  )
}

/** Every blocker of `task` must exist on the board and be completed. */
function requireBlockersCompleted(task: ResearchTask, board: ReadonlyArray<ResearchTask>): void {
  for (const blockerId of task.blockedBy) {
    const blocker = board.find(candidate => candidate.id === blockerId)
    if (blocker === undefined) {
      researchTeamError(
        'TASK_NOT_FOUND',
        `claim task ${task.id}: blocker ${blockerId} does not exist on the board`,
      )
    }
    if (blocker.status !== 'completed') {
      researchTeamError(
        'CLAIM_NOT_READY',
        `claim task ${task.id}: blocker ${blockerId} is ${blocker.status}, not completed`,
      )
    }
  }
}

/** DEC-004 / U-B: one member holds at most ONE in_progress write task. */
function requireSingleActiveTask(
  actorId: SessionId,
  board: ReadonlyArray<ResearchTask>,
  taskId: TeamTaskId,
  action: TeamTaskAction,
): void {
  const active = board.find(
    candidate => candidate.ownerId === actorId && candidate.id !== taskId && candidate.status === 'in_progress',
  )
  if (active !== undefined) {
    researchTeamError(
      'ACTIVE_TASK_CONFLICT',
      `${action} by member ${actorId}: already owns in_progress task ${active.id} (single active write task per member)`,
    )
  }
}

/** Cycle check over the board adjacency after replacing `taskId`'s blockers
 *  with `newBlockedBy` (self-loops included). DFS coloring: gray = on the
 *  current stack, black = fully explored. */
function wouldCreateCycle(
  board: ReadonlyArray<ResearchTask>,
  taskId: TeamTaskId,
  newBlockedBy: ReadonlyArray<TeamTaskId>,
): boolean {
  const adjacency: Record<string, ReadonlyArray<TeamTaskId>> = {}
  for (const task of board) {
    adjacency[task.id] = task.id === taskId ? newBlockedBy : task.blockedBy
  }
  const color: Record<string, 0 | 1 | 2> = {}
  const visit = (id: string): boolean => {
    const seen = color[id] ?? 0
    if (seen === 1) return true
    if (seen === 2) return false
    color[id] = 1
    const deps = adjacency[id]
    if (deps === undefined) {
      // Dangling blocker on an id outside the board cannot close a cycle.
      color[id] = 2
      return false
    }
    for (const dep of deps) {
      if (visit(dep)) return true
    }
    color[id] = 2
    return false
  }
  return Object.keys(adjacency).some(id => visit(id))
}

/** Apply one authorized task mutation against the current board. The caller
 *  must pass the revision it based its intent on (CAS); a stale revision is
 *  rejected with {@link DSH_RESEARCH_TEAM_REVISION_CONFLICT}. Returns the next
 *  frozen whole-value snapshot of the mutated task.
 *
 *  Transition rules:
 *  - claim:           pending + all blockers completed; owner := actor; status
 *                     → in_progress; writeScopes normalized.
 *  - release:         in_progress; owner-or-lead; owner + scopes cleared;
 *                     status → pending.
 *  - complete:        in_progress; owner-or-lead; status → completed.
 *  - reopen:          completed; owner-or-lead; owner + scopes cleared;
 *                     status → pending.
 *  - edit:            non-deleted; owner-or-lead; applies subject/description/
 *                     writeScopes (scope list normalized).
 *  - set_dependencies: non-deleted; owner-or-lead; blockers must exist and be
 *                     non-deleted and must not close a cycle.
 *  - reassign:        in_progress; owner-or-lead; owner := newOwnerId (must be
 *                     present and not already active).
 *  - delete:          non-deleted; owner-or-lead; status → deleted (tombstone).
 */
export function applyTaskAction(input: TaskMutationInput): ResearchTask {
  const { action, taskId, actor } = input
  const found = input.board.find(candidate => candidate.id === taskId)
  const current = assertExpectedRevision(found, input.expectedRevision)

  switch (action) {
    case 'claim': {
      if (actor.role === 'lead') {
        researchTeamError(
          'NOT_AUTHORIZED',
          `claim task ${taskId}: leads coordinate work, only team members claim tasks`,
        )
      }
      if (current.status !== 'pending') {
        researchTeamError(
          'INVALID_STATUS',
          `claim task ${taskId}: status is ${current.status}, only pending tasks can be claimed`,
        )
      }
      requireBlockersCompleted(current, input.board)
      requireSingleActiveTask(actor.id, input.board, taskId, action)
      const scopes = input.writeScopes === undefined ? [] : [...input.writeScopes]
      return nextSnapshot(current, {
        status: 'in_progress',
        ownerId: actor.id,
        writeScopes: normalizeWriteScopes(scopes),
      })
    }
    case 'release': {
      requireOwnerOrLead(current, actor, action)
      if (current.status !== 'in_progress') {
        researchTeamError(
          'INVALID_STATUS',
          `release task ${taskId}: status is ${current.status}, only in_progress tasks can be released`,
        )
      }
      return nextSnapshot(current, { status: 'pending', ownerId: null, writeScopes: [] })
    }
    case 'complete': {
      requireOwnerOrLead(current, actor, action)
      if (current.status !== 'in_progress') {
        researchTeamError(
          'INVALID_STATUS',
          `complete task ${taskId}: status is ${current.status}, only in_progress tasks can be completed`,
        )
      }
      return nextSnapshot(current, { status: 'completed' })
    }
    case 'reopen': {
      requireOwnerOrLead(current, actor, action)
      if (current.status !== 'completed') {
        researchTeamError(
          'INVALID_STATUS',
          `reopen task ${taskId}: status is ${current.status}, only completed tasks can be reopened`,
        )
      }
      return nextSnapshot(current, { status: 'pending', ownerId: null, writeScopes: [] })
    }
    case 'edit': {
      requireOwnerOrLead(current, actor, action)
      if (current.status === 'deleted') {
        researchTeamError('TASK_DELETED', `edit task ${taskId}: deleted tasks are immutable`)
      }
      const patch = {
        ...(input.subject === undefined ? {} : { subject: input.subject }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.writeScopes === undefined
          ? {}
          : { writeScopes: normalizeWriteScopes([...input.writeScopes]) }),
      }
      return nextSnapshot(current, patch)
    }
    case 'set_dependencies': {
      requireOwnerOrLead(current, actor, action)
      if (current.status === 'deleted') {
        researchTeamError('TASK_DELETED', `set_dependencies task ${taskId}: deleted tasks are immutable`)
      }
      const newBlockers = [...(input.blockedBy ?? [])]
      for (const blockerId of newBlockers) {
        const blocker = input.board.find(candidate => candidate.id === blockerId)
        if (blocker === undefined) {
          researchTeamError(
            'TASK_NOT_FOUND',
            `set_dependencies task ${taskId}: blocker ${blockerId} does not exist on the board`,
          )
        }
        if (blocker.status === 'deleted') {
          researchTeamError(
            'TASK_DELETED',
            `set_dependencies task ${taskId}: blocker ${blockerId} is deleted and cannot be a dependency`,
          )
        }
      }
      const deduped = [...new Set(newBlockers)].sort()
      if (wouldCreateCycle(input.board, taskId, deduped)) {
        researchTeamError(
          'DEPENDENCY_CYCLE',
          `set_dependencies task ${taskId}: the new blocker set closes a cycle`,
        )
      }
      return nextSnapshot(current, { blockedBy: deduped })
    }
    case 'reassign': {
      requireOwnerOrLead(current, actor, action)
      if (current.status !== 'in_progress') {
        researchTeamError(
          'INVALID_STATUS',
          `reassign task ${taskId}: status is ${current.status}, only in_progress tasks can be reassigned`,
        )
      }
      const newOwnerId = input.newOwnerId
      if (newOwnerId === undefined) {
        researchTeamError('NOT_AUTHORIZED', `reassign task ${taskId}: newOwnerId is required`)
      }
      requireSingleActiveTask(newOwnerId, input.board, taskId, action)
      return nextSnapshot(current, { ownerId: newOwnerId })
    }
    case 'delete': {
      requireOwnerOrLead(current, actor, action)
      if (current.status === 'deleted') {
        researchTeamError('TASK_DELETED', `delete task ${taskId}: task is already deleted`)
      }
      return nextSnapshot(current, { status: 'deleted' })
    }
  }
}
