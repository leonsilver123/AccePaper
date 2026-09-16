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
 * @returns when the run has stopped, or throws when the subscription cannot be repaired.
 */
export async function followToRest(
  remote: RunFollowNamespace,
  runId: string,
  cursor: string | null,
  onUpdate: (summary: ReturnType<typeof buildSummary>) => void,
): Promise<void> {
  // THE POSITION OUTLIVES ONE SUBSCRIPTION. It is what a re-open continues from, so resetting it
  // per attempt would make every re-open a fresh start that could not tell whether it had missed
  // anything — the thing the cursor is for.
  let held = cursor
  for (let attempt = 1; ; attempt += 1) {
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
        break
      }
      if (frame.type === 'snapshot') {
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
      expected = frame.event.sequence + 1
      held = frame.event.eventId
    }
    if (!repaired) return
    if (attempt >= MAX_FOLLOW_ATTEMPTS) {
      throw new Error(
        `the host would not serve a position in run ${runId} after ${String(MAX_FOLLOW_ATTEMPTS)} attempts`,
      )
    }
  }
}

/**
 * The position a cursor names.
 * @param cursor - a cursor as the host produced it.
 * @returns its sequence, or null when it names none.
 */
export function sequenceOfCursor(cursor: string): number | null {
  const tail = cursor.slice(cursor.lastIndexOf('#') + 1)
  return /^\d+$/u.test(tail) ? Number(tail) : null
}
