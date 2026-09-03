// @deepseek-ai/dsh-research-team — host-only research projection definition.
//
// ADAPTER LAYER (T20). The pure fold (`projection.ts`) is a deterministic
// reducer over {@link ResearchEvent}s; this module registers it with the core
// `SessionProjectionRegistry` as the host-only `researchTeam` unit, whose state
// is checkpointed like every other unit but never published to client
// snapshots (no `wire`). `ResearchJournal.state()` and the global tool guard's
// resolver both read the live fold through `stateOf(root.session, 'researchTeam')`.
//
// Fold semantics follow the pure reducer exactly: whole-value member/task/rev
// snapshots, task revisions only ever move forward, deleted tasks are terminal
// tombstones, and stale/duplicate events are ignored. Any malformed research
// payload — or a fold rejection such as a cross-team event — latches a
// `failure` message so authoritative reads fail loudly instead of serving a
// partially-applied state.

import { z } from 'zod'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { createTeamState, reduceTeamState } from './projection.ts'
import {
  researchMemberSnapshotSchema,
  researchRevSnapshotSchema,
  researchTaskSnapshotSchema,
  researchEventFromSession,
} from './session-events.ts'
import { TeamId } from './types.ts'
import type { TeamState } from './types.ts'

/** Checkpointable host projection state: the pure fold plus an optional failure latch. */
export interface ResearchProjectionState extends TeamState {
  failure?: string
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    researchTeam: ResearchProjectionState
  }
}

/** Validates persisted `researchTeam` checkpoint rows before they seed a fold. */
const researchProjectionStateSchema = z.object({
  teamId: z.string().min(1).transform(value => TeamId(value)),
  members: z.record(z.string(), researchMemberSnapshotSchema),
  tasks: z.record(z.string(), researchTaskSnapshotSchema),
  artifactRevs: z.record(z.string(), researchRevSnapshotSchema),
  failure: z.string().optional(),
}).strict() as z.ZodType<ResearchProjectionState>

/** Empty projected state for the team rooted at one Session. */
function emptyState(header: SessionHeader): ResearchProjectionState {
  return createTeamState(TeamId(header.id))
}

/** Fold one committed event into the projection, latching `failure` on a reject. */
function applyResearchEvent(
  state: ResearchProjectionState,
  event: SessionEvent,
): ResearchProjectionState {
  if (state.failure !== undefined) return state
  const researchEvent = researchEventFromSession(event)
  if (researchEvent === undefined) return state
  try {
    return reduceTeamState(state, researchEvent)
  } catch (error: unknown) {
    return { ...state, failure: error instanceof Error ? error.message : String(error) }
  }
}

/** Host-only `researchTeam` projection registered by `ResearchTeamService`. */
export const researchTeamProjectionDefinition = {
  key: 'researchTeam',
  stateVersion: 1,
  stateSchema: researchProjectionStateSchema,
  init: emptyState,
  apply: applyResearchEvent,
} satisfies ProjectionDefinition<'researchTeam', ResearchProjectionState>
