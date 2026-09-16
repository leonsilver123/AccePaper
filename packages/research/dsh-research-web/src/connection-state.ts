/**
 * What the page's link to the deployment is doing, as a state a reader can be shown.
 *
 * WHY THIS IS ITS OWN MODULE. The follow loop already recovers — it re-opens a stream whose cursor
 * was refused, and reports the failure when it runs out of attempts. What it did not have was a NAME
 * for the states it passes through, so the page could not tell a reader whether it was live, repairing
 * itself, or done trying. Without that, a page that stopped receiving updates looked exactly like a
 * study that had stopped producing them.
 *
 * NO TIMER AND NO TRANSPORT IN HERE. The transitions are a function of what happened, so they are
 * testable without a socket, and the module owns no policy the host should own: it does not decide
 * when to retry — the follow loop does — it only records what a retry means.
 */

/** Where the page's link stands. */
export type ConnectionPhase =
  /** Nothing has been opened yet: a page that has no run to follow. */
  | 'idle'
  /** An opening has been requested and nothing has arrived. */
  | 'connecting'
  /** Frames are arriving; the page's state is the host's. */
  | 'live'
  /** The link broke and the page is opening it again, within its attempt budget. */
  | 'reconnecting'
  /** The cursor was refused: the page is taking a fresh opening, whose snapshot fills the gap. */
  | 'resyncing'
  /** The budget is spent. The page holds its last state and says it may not be current. */
  | 'offline'
  /** The page or the run is finished with the link. */
  | 'disposed'

/** One thing that can happen to the link. */
export type ConnectionEvent =
  /** The link's FIRST open. */
  | 'open-requested'
  /** The loop opening the link again after a failure or a refused cursor. */
  | 'reopen-requested'
  | 'frame'
  | 'resync-requested'
  | 'failure'
  | 'budget-exhausted'
  | 'dispose'

/** The phase, with what a reader needs beside it. */
export interface ConnectionState {
  readonly phase: ConnectionPhase
  /** How many times this link has been re-opened since it was first opened. */
  readonly attempts: number
  /** Why the link is not live, when it is not. */
  readonly reason?: string
}

/** The attempt budget the follow loop enforces, restated here so both agree on what "exhausted" is. */
export const MAX_FOLLOW_ATTEMPTS = 3

/** The state a page starts in, before anything has been opened. */
export const IDLE_CONNECTION: ConnectionState = { phase: 'idle', attempts: 0 }

/**
 * Whether the page is showing state the host still stands behind.
 *
 * `offline` is the only phase where the page's state may be behind the run: while reconnecting the
 * last snapshot is stale too, but the page is actively repairing it, and a reader told "not current"
 * about a link that is mid-repair would be told the wrong thing about what to do.
 *
 * @param state - the link's state.
 * @returns whether a reader must be told the state on screen may be out of date.
 */
export function isStale(state: ConnectionState): boolean {
  return state.phase === 'offline'
}

/**
 * Whether a write that depends on the CURRENT project revision may be attempted.
 *
 * A decision is about a revision, and a page that cannot reach the deployment cannot know the run is
 * still at the revision it is showing. The backend refuses a stale decision anyway; disabling the
 * control here is what keeps a person from spending a click to learn that.
 *
 * THE DISCONNECTED PHASES ARE WHAT CLOSE IT, not everything that is not `live`. A run followed to its
 * rest leaves the link `disposed`, and the human gate is reached exactly there — a rule that demanded
 * `live` would make a finished study undecidable, which is the one thing the gate exists for. The same
 * goes for `idle` and `connecting`: a page that has opened nothing has nothing to be stale about.
 *
 * @param state - the link's state.
 * @returns whether the page may offer a revision-bound write.
 */
export function allowsRevisionBoundWrite(state: ConnectionState): boolean {
  return state.phase !== 'reconnecting' && state.phase !== 'resyncing' && state.phase !== 'offline'
}

/**
 * Apply one event to the link's state.
 *
 * @param state - the state before the event.
 * @param event - what happened.
 * @param reason - why, for the events that carry one.
 * @returns the state after it. A disposed link ignores everything: a page that has let go of a run
 *   must not be moved back into `live` by a frame that was already in flight.
 */
export function applyConnectionEvent(
  state: ConnectionState,
  event: ConnectionEvent,
  reason?: string,
): ConnectionState {
  if (state.phase === 'disposed') return state
  const withReason = (next: ConnectionPhase, attempts: number): ConnectionState => ({
    phase: next, attempts, ...(reason === undefined ? {} : { reason }),
  })
  switch (event) {
    case 'open-requested':
      return withReason('connecting', state.attempts)
    case 'reopen-requested':
      // THE ATTEMPT COUNT LIVES HERE, and it is what the budget is spent against: a state machine
      // that counted opens would call the first re-open the second attempt.
      return withReason('reconnecting', state.attempts + 1)
    case 'frame':
      // A FRAME IS THE ONLY THING THAT MAKES A LINK LIVE, and it clears what the last failure said:
      // a page that kept the old reason beside live frames would be reporting a failure that is over.
      return { phase: 'live', attempts: state.attempts }
    case 'resync-requested':
      return withReason('resyncing', state.attempts)
    case 'failure':
      return withReason('reconnecting', state.attempts)
    case 'budget-exhausted':
      return withReason('offline', state.attempts)
    case 'dispose':
      return { phase: 'disposed', attempts: state.attempts }
    default:
      // No default branch is reachable: the union is closed, and a `satisfies`-style exhaustiveness
      // check would need a value here. Returning the state unchanged is the honest fallback.
      return state
  }
}
