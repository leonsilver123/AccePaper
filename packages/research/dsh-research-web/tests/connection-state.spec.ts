/**
 * The connection state machine: what the page may claim about its own link.
 *
 * THE POINT OF THESE CASES. A page that stops receiving updates and a study that stops producing them
 * look identical in the DOM. Every transition below is a fact the page can state instead — and the two
 * predicates are the ones that decide what a reader is told and what they are allowed to do.
 */
import { describe, expect, it } from 'vitest'
import {
  IDLE_CONNECTION, allowsRevisionBoundWrite, applyConnectionEvent, isStale,
  type ConnectionPhase, type ConnectionState,
} from '../src/connection-state.ts'

/** Fold a sequence of events from the idle state. */
function after(...events: ReadonlyArray<Parameters<typeof applyConnectionEvent>[1]>): ConnectionState {
  return events.reduce<ConnectionState>(
    (state, event) => applyConnectionEvent(state, event), IDLE_CONNECTION)
}

describe('the phases a link passes through', () => {
  it('starts idle and connects on the first open', () => {
    expect(IDLE_CONNECTION.phase).toBe('idle')
    expect(after('open-requested').phase).toBe('connecting')
  })

  it('is live only once a frame has arrived', () => {
    // An open that has been requested is not a link. Reporting `live` at request time is how a page
    // claims a connection it has not made.
    expect(after('open-requested', 'reopen-requested').phase).toBe('reconnecting')
    expect(after('open-requested', 'frame').phase).toBe('live')
    // The attempt count is what the budget is spent against, so a re-open is one attempt and no more.
    expect(after('open-requested', 'reopen-requested').attempts).toBe(1)
  })

  it('reports a broken link as reconnecting, and keeps what the failure said', () => {
    const state = applyConnectionEvent(after('open-requested', 'frame'), 'failure', 'socket closed')
    expect(state.phase).toBe('reconnecting')
    expect(state.reason).toBe('socket closed')
  })

  it('clears the reason when a frame arrives', () => {
    // A LIVE LINK WITH A FAILURE BESIDE IT reports a problem that is over, and a reader cannot tell
    // whether to act on it.
    const state = after('open-requested', 'frame', 'failure', 'reopen-requested', 'frame')
    expect(state.phase).toBe('live')
    expect(state.reason).toBeUndefined()
  })

  it('names a refused cursor as its own phase', () => {
    // Resyncing is not reconnecting: one is the host refusing a position, the other is a link that
    // broke. They have different remedies, and the page tells them apart.
    expect(after('open-requested', 'frame', 'resync-requested').phase).toBe('resyncing')
    expect(after('open-requested', 'frame', 'resync-requested', 'reopen-requested', 'frame').phase).toBe('live')
  })

  it('goes offline only when the budget is spent, and not before', () => {
    expect(after('open-requested', 'failure', 'failure').phase).toBe('reconnecting')
    const spent = applyConnectionEvent(after('open-requested', 'failure'), 'budget-exhausted', '3 attempts')
    expect(spent.phase).toBe('offline')
    expect(spent.reason).toBe('3 attempts')
  })

  it('ignores everything after disposal', () => {
    // A FRAME ALREADY IN FLIGHT must not move a page that has let go of the run back into `live`.
    const disposed = after('open-requested', 'frame', 'dispose')
    expect(disposed.phase).toBe('disposed')
    expect(applyConnectionEvent(disposed, 'frame').phase).toBe('disposed')
    expect(applyConnectionEvent(disposed, 'open-requested').phase).toBe('disposed')
  })
})

describe('what a reader is told, and what they may still do', () => {
  const phases: ReadonlyArray<ConnectionPhase> =
    ['idle', 'connecting', 'live', 'reconnecting', 'resyncing', 'offline', 'disposed']

  it('calls the state stale exactly when the page has stopped repairing it', () => {
    const stale = phases.filter(phase => isStale({ phase, attempts: 0 }))
    expect(stale).toEqual(['offline'])
  })

  it('closes a revision-bound write while the link is known to be out of step', () => {
    // A DECISION IS ABOUT A REVISION. A page that cannot reach the deployment cannot know the run is
    // still at the revision it is showing, so it does not offer the click.
    const blocked = phases.filter(phase => !allowsRevisionBoundWrite({ phase, attempts: 0 }))
    expect(blocked).toEqual(['reconnecting', 'resyncing', 'offline'])
    // AND A FINISHED STUDY IS STILL DECIDABLE: following a run to its rest leaves the link disposed,
    // and that is exactly where the human gate is.
    expect(allowsRevisionBoundWrite({ phase: 'disposed', attempts: 1 })).toBe(true)
  })
})
