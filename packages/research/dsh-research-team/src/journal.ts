// @deepseek-ai/dsh-research-team — per-root serialized Lead-log journal.
//
// ADAPTER LAYER (T20). The team's authoritative store is ONE log: the exact
// live Lead (root) Session, which carries every `research/*` whole-value
// snapshot. This module owns the two durability primitives every mutation
// builds on:
//   - `transact(rootId, operation)`: a per-root promise tail so concurrent
//     read-check-append operations on one team strictly serialize (single
//     process; cross-process concurrency is out of scope, matching the frozen
//     design spec §6 / X4);
//   - `appendAndFlush(root, type, data)`: validate the payload at the log
//     boundary, append it to the root Session's durable log, flush the Session
//     store, then notify commit waiters.
//
// Reads (`state(root)`) are the live `researchTeam` projection checkpointed by
// the host projection registry, so every operation observes the same fold the
// guard resolver reads — one consistent snapshot per committed prefix.

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEventMap, SessionId } from '@deepseek-ai/dsh-session'
import type { ResearchProjectionState } from './research-projection.ts'
import {
  validateResearchEventPayload,
} from './session-events.ts'
import type { ResearchEventType } from './session-events.ts'

/** Narrow local capability: research events are never part of the conversation
 *  surface, so the raw append takes no surface-intent argument. */
type AppendResearchEvent = <T extends ResearchEventType>(
  type: T,
  data: SessionEventMap[T],
) => void

/**
 * Serialized transactions over the exact live research Lead Session log.
 * One queue tail per root Session preserves read-check-append atomicity for
 * every member operating against the same durable team.
 */
export class ResearchJournal {
  private readonly tails = new Map<SessionId, Promise<void>>()

  /**
   * @param ctx - research service context (Session + projection services).
   * @param onCommit - synchronous notification after a research event flush.
   */
  constructor(
    private readonly ctx: Context,
    private readonly onCommit: (root: Agent) => void,
  ) {}

  /**
   * Read the authoritative projected state of one exact live research Lead.
   * @param root - exact live Lead Agent whose Session owns the team log.
   * @returns the current projected team state, or throws when the projection
   * unit is absent or has latched a fold failure.
   */
  state(root: Agent): ResearchProjectionState {
    const projection = this.ctx.sessionProjections.stateOf(root.session, 'researchTeam')
    if (projection === undefined) throw new Error('researchTeam projection is not registered')
    if (projection.failure !== undefined) throw new Error(projection.failure)
    return projection
  }

  /**
   * Serialize one root-owned mutation operation behind that root's queue tail.
   * @param rootId - root Session identity selecting the transaction queue.
   * @param operation - the complete read-check-append operation.
   * @returns the operation result once the queue reaches it.
   */
  async transact<T>(rootId: SessionId, operation: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(rootId) ?? Promise.resolve()
    const run = prior.then(operation, operation)
    const tail = run.then(() => undefined, () => undefined)
    this.tails.set(rootId, tail)
    try {
      return await run
    } finally {
      if (this.tails.get(rootId) === tail) this.tails.delete(rootId)
    }
  }

  /**
   * Validate, append, and checkpoint one research event on the root log before
   * publishing the durable prefix to commit waiters.
   * @param root - exact live Lead Agent whose Session owns the event.
   * @param type - research event discriminant.
   * @param data - the corresponding event payload.
   */
  async appendAndFlush<T extends ResearchEventType>(
    root: Agent,
    type: T,
    data: SessionEventMap[T],
  ): Promise<void> {
    // Research events never enter the conversation surface. This narrower
    // capability removes Session.append's conditional surface argument while
    // preserving the event-key/payload correlation.
    const append = root.session.append.bind(root.session) as unknown as AppendResearchEvent
    append(type, validateResearchEventPayload(type, data))
    await this.ctx.sessions.flush(root.session)
    this.onCommit(root)
  }
}
