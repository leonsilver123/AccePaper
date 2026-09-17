/**
 * Follow one run's stream, rendering every state the host reports.
 *
 * WHY THIS IS ITS OWN MODULE. The subscription policy — what a page does with a snapshot, an event
 * out of order, and a re-sync — is the part of the run control that can be wrong in ways a rendered
 * page hides: an out-of-order frame renders as a plausible state. Keeping it here lets it be driven
 * frame by frame with a namespace that yields exactly the frames a test chooses.
 */
import { buildSummary } from '../loader.ts'
import { summaryInputFrom, type WireRunFrame } from '../run-source.ts'
import { IDLE_CONNECTION, applyConnectionEvent, type ConnectionState } from '../connection-state.ts'

/**
 * The host's follow, as this module needs it.
 *
 * Structural rather than imported: the generated declaration belongs to the Host face.
 */
export interface RunFollowNamespace {
  followRun(
    request: { readonly runId: string; readonly cursor?: string },
    signal?: AbortSignal,
  ): AsyncIterable<WireRunFrame>
}

/**
 * How many times a page re-opens a run's stream before it reports the failure instead.
 *
 * A re-open is the recovery for the two ways a subscription can be out of step with the run: the
 * host refuses the cursor (`resync`), or a frame arrives that does not continue the sequence the
 * page holds. Both are answered by taking a fresh opening, whose snapshot already includes
 * everything the page missed. The bound is here because a host that answered every open with
 * another refusal would otherwise spin a browser tab forever.
 */
const MAX_FOLLOW_ATTEMPTS = 3

/**
 * Follow one run to its end, rendering every state the host reports.
 *
 * THE SNAPSHOT IS THE STATE, and the events are the position. This page does not replay events into
 * a projection of its own: the service owns the projection, and a second one here could disagree
 * with it (a rule this repository states as "derive caches and UI echoes from one authoritative
 * source"). What the events are for is ORDER — the page knows which position it holds, notices a
 * frame that does not continue it, and re-opens rather than applying an out-of-order state.
 *
 * @param remote - the host's research namespace.
 * @param runId - the run to follow.
 * @param cursor - the position this page already holds, when it holds one.
 * @param onUpdate - called with every state the host reports.
 * @param onPhase - called with what the follow is doing, so the page can say it is re-opening
 *   rather than going quiet.
 * @returns when the run has stopped, or throws when the subscription cannot be repaired.
 */
export async function followToRest(
  remote: RunFollowNamespace,
  runId: string,
  cursor: string | null,
  onUpdate: (summary: ReturnType<typeof buildSummary>) => void,
  /**
   * Called with the link's state every time it changes.
   *
   * THE PAGE HAS TO BE ABLE TO SAY WHAT ITS LINK IS DOING. Without this the only fact a reader gets
   * is that updates stopped, which is also what a study that stopped producing them looks like. The
   * loop already knows every transition — it is the thing that re-opens, resyncs and gives up — so it
   * reports them rather than leaving the page to guess from a silence.
   */
  onPhase?: (state: ConnectionState) => void,
): Promise<void> {
  let connection: ConnectionState = IDLE_CONNECTION
  const phase = (event: Parameters<typeof applyConnectionEvent>[1], reason?: string): void => {
    connection = applyConnectionEvent(connection, event, reason)
    onPhase?.(connection)
  }
  phase('open-requested')
  // THE POSITION OUTLIVES ONE SUBSCRIPTION. It is what a re-open continues from, so resetting it
  // per attempt would make every re-open a fresh start that could not tell whether it had missed
  // anything — the thing the cursor is for.
  let held = cursor
  for (let attempt = 1; ; attempt += 1) {
    // A RE-OPEN IS ITS OWN EVENT, and the loop is the only thing that knows it is one: the first
    // pass opened the link, every pass after it is repairing one.
    if (attempt > 1) phase('reopen-requested')
    let expected: number | null = null
    let repaired = false
    const frames = remote.followRun({ runId, ...(held === null ? {} : { cursor: held }) })
    for await (const frame of frames) {
      if (frame.type === 'resync') {
        // THE HOST CANNOT SERVE THIS POSITION. It says why, and the page answers by opening again —
        // WITHOUT it: a position the host has just refused is not one to offer a second time. The
        // snapshot that comes back is at the current position, so nothing is lost by dropping it.
        held = null
        repaired = true
        phase('resync-requested', frame.reason)
        break
      }
      if (frame.type === 'snapshot') {
        phase('frame')
        held = frame.cursor
        expected = sequenceOfCursor(frame.cursor)
        onUpdate(buildSummary(summaryInputFrom(frame.snapshot)))
        continue
      }
      if (frame.event.sequence !== expected) {
        // A FRAME THAT DOES NOT CONTINUE WHAT THIS PAGE HOLDS. Applying it would put the page at a
        // position it cannot account for, so it re-opens and renders the snapshot instead.
        repaired = true
        break
      }
      phase('frame')
      expected = frame.event.sequence + 1
      // THE POSITION AFTER THE EVENT, not the event's identity. Naming the identity would ask the
      // host for the event just applied — a duplicate delivery — and it carries no log identity, so
      // a page that reconnected after a rebuild would be continued from a position whose contents it
      // never saw.
      held = frame.event.cursor
    }
    if (!repaired) {
      // THE LINK IS DONE BECAUSE THE RUN IS: nothing left to read is not a broken connection, and a
      // page that reported it as one would tell a reader to wait for a study that has finished.
      phase('dispose')
      return
    }
    if (attempt >= MAX_FOLLOW_ATTEMPTS) {
      phase('budget-exhausted', `the host would not serve a position after ${String(MAX_FOLLOW_ATTEMPTS)} attempts`)
      throw new Error(
        `the host would not serve a position in run ${runId} after ${String(MAX_FOLLOW_ATTEMPTS)} attempts`,
      )
    }
  }
}

/**
 * The position a cursor names.
 *
 * A cursor is `<runId>#<consumed>#<digest>`: the count of events the host has delivered to this
 * reader, not the index of the last one — so this reads the middle segment, through the same shape
 * the host writes rather than by trusting the last one.
 *
 * @param cursor - a cursor as the host produced it.
 * @returns its sequence, or null when it names none.
 */
export function sequenceOfCursor(cursor: string): number | null {
  const parts = cursor.split('#')
  const sequence = parts.length === 3 ? parts[1] : undefined
  return sequence !== undefined && /^\d+$/u.test(sequence) ? Number(sequence) : null
}
