// @deepseek-ai/dsh-research-team — pure projection reducer (fold).
//
// PURE-LOGIC LAYER (T20). Folds the team's whole-value event log into a
// {@link TeamState}: members by id, tasks by id (deleted tasks remain as
// terminal tombstones), artifact revision heads by artifact id. `research/rebuttal`
// events (T21) are validated at the log boundary but deliberately NOT folded —
// votes are an audit trail for the future judge gate, not projected state.
//
// No ctx / host wiring here — `ctx.sessionProjections.register` is an adapter
// concern (projection.ts of the later round). This module is a pure,
// deterministic reducer:
//   - same event list + same initial state ⇒ identical output state
//     (fold idempotence);
//   - task/rev revisions only ever move forward: an event whose revision is
//     ≤ the stored revision for the same key is ignored (monotonic), which
//     also makes re-folding a partially-replayed log safe;
//   - a deleted task is a tombstone: no later event for the same id can
//     resurrect it.
// Every stored whole-value snapshot is an independent deep-frozen clone, so no
// live reference escapes into (or out of) the projection.

import { freezeValue, researchTeamError } from './types.ts'
import type {
  ResearchEvent,
  ResearchMember,
  ResearchRev,
  ResearchTask,
  TeamId,
  TeamState,
} from './types.ts'

/** Empty frozen projection for one research team. */
export function createTeamState(teamId: TeamId): TeamState {
  return freezeValue({ teamId, members: {}, tasks: {}, artifactRevs: {} } satisfies TeamState)
}

/** Whole-value-snapshot fold over an event list. Events for a different team
 *  than `initial.teamId` are rejected ({@link DSH_RESEARCH_TEAM_TEAM_MISMATCH}). */
export function foldTeamEvents(
  initial: TeamState,
  events: ReadonlyArray<ResearchEvent>,
): TeamState {
  return events.reduce<TeamState>((state, event) => reduceTeamState(state, event), initial)
}

/** Single-event reducer. Ignores (returns the same state) when the event is
 *  stale/duplicate or targets a deleted task tombstone. */
export function reduceTeamState(state: TeamState, event: ResearchEvent): TeamState {
  if (event.teamId !== state.teamId) {
    researchTeamError(
      'TEAM_MISMATCH',
      `reduceTeamState: event targets team ${event.teamId} but the projection is for team ${state.teamId}`,
    )
  }
  switch (event.type) {
    case 'research/member':
      return withMember(state, event.member)
    case 'research/task':
      return withTask(state, event.task)
    case 'research/rev':
      return withRev(state, event.rev)
    case 'research/rebuttal':
      // Rebuttal votes are an audit trail consumed by the future T22/judge
      // gate, not part of the projected TeamState (member/task/rev only).
      // The event still crosses the validation seam before the fold, so a
      // malformed persisted payload latches the projection like any other
      // research event.
      return state
    // v8 ignore next 3 -- event.type is a closed union; unknown variants are
    // rejected at the session-event boundary before they reach the fold.
    default:
      return state
  }
}

function withMember(state: TeamState, member: ResearchMember): TeamState {
  const members = { ...state.members, [member.id]: freezeValue(member) }
  return freezeValue({ ...state, members })
}

function withTask(state: TeamState, task: ResearchTask): TeamState {
  const existing = state.tasks[task.id]
  // Tombstone: a deleted task id is retired forever; no later event may
  // resurrect it, regardless of its revision.
  if (existing !== undefined && existing.status === 'deleted') return state
  // Monotonic whole-value snapshots: only strictly newer revisions apply.
  if (existing !== undefined && task.revision <= existing.revision) return state
  const tasks = { ...state.tasks, [task.id]: freezeValue(task) }
  return freezeValue({ ...state, tasks })
}

function withRev(state: TeamState, rev: ResearchRev): TeamState {
  const existing = state.artifactRevs[rev.artifactId]
  if (existing !== undefined && rev.revision <= existing.revision) return state
  const artifactRevs = { ...state.artifactRevs, [rev.artifactId]: freezeValue(rev) }
  return freezeValue({ ...state, artifactRevs })
}
