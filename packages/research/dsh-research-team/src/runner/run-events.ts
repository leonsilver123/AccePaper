// @deepseek-ai/dsh-research-team — a run's event log, as an ordered, cursor-addressed stream.
//
// WHY THIS EXISTS. The browser held the run's progress the only way a unary method allows: re-reading
// the whole projection every 1500 ms. That answers "what is this run doing" but it cannot answer
// "what happened", and it has no position to resume from — a page that reconnected had to take a
// fresh snapshot and hope nothing in between mattered. The plan's §7.2 asks for the other shape:
// a snapshot and a cursor that name the SAME sequence point, a subscription that continues from that
// cursor, and an explicit re-sync signal when the cursor cannot be served.
//
// WHAT THE CURSOR IS, AND WHY IT IS NOT A TIMESTAMP. A run's audit events carry no sequence field
// (`AuditEvent` is kind/runId/stepId?/attemptId?/ts/detail?), and `ts` is `Date.now()` — two events
// appended in the same millisecond share it. The ONE strictly monotonic key the run has is the
// event's index in `run.events`: entries are only ever pushed, and nothing in core trims, reorders
// or compacts the array, so an index names the same event for the life of the run. The cursor is
// that index, SCOPED to the run it belongs to, so a cursor from another run is detectable rather
// than merely wrong.

import type { AuditEvent, ResearchRunStore, RunState } from '@deepseek-ai/dsh-research-core'

import { RUN_EVENT_ENVELOPE_VERSION, type ResearchRunCursor, type RunEventEnvelope } from '../types.ts'

/** The separator between a run id and its sequence inside one cursor. */
const CURSOR_SEPARATOR = '#'

/**
 * A cursor naming one position in one run's event log.
 *
 * The format is `<runId>#<sequence>`: the run id is part of the cursor so a cursor presented for a
 * different run is REFUSED rather than silently read as a position in that run's log. Run ids are
 * UUIDs and contain no `#`, so the last separator is the split.
 *
 * @param runId - the run the position belongs to.
 * @param sequence - how many events of that run had been appended at this position.
 * @returns the cursor.
 */
export function runCursorOf(runId: string, sequence: number): ResearchRunCursor {
  return `${runId}${CURSOR_SEPARATOR}${String(sequence)}` as ResearchRunCursor
}

/** What reading one cursor produced. */
export type CursorRead =
  /** The position, in the run that was asked for. */
  | { readonly ok: true; readonly sequence: number }
  /**
   * The cursor cannot be served here, and the reader must take a new snapshot.
   *
   * A cursor belongs to one run and names a position that run has REACHED. One that names another
   * run, or a position past the end of this run's log, is not a gap to paper over: the reader's
   * window and this run's log are not the same history, and continuing from it would deliver a
   * sequence that never happened.
   */
  | { readonly ok: false; readonly reason: string }

/**
 * Read a cursor against the run it is presented for.
 *
 * @param runId - the run the caller asked to follow.
 * @param cursor - the cursor the caller holds, as it came off the wire.
 * @param available - how many events that run has appended.
 * @returns the sequence it names, or why it cannot be served.
 */
export function readRunCursor(
  runId: string,
  cursor: string,
  available: number,
): CursorRead {
  const separator = cursor.lastIndexOf(CURSOR_SEPARATOR)
  if (separator <= 0) {
    return { ok: false, reason: `'${cursor}' is not a run cursor: it names no run and no position` }
  }
  const named = cursor.slice(0, separator)
  if (named !== runId) {
    return { ok: false, reason: `the cursor belongs to run '${named}', not '${runId}'` }
  }
  // DIGITS, not `Number(...)` alone: an empty tail parses as 0 and would silently mean "the
  // beginning of the log", which is a position no caller ever wrote.
  const tail = cursor.slice(separator + 1)
  if (!/^\d+$/u.test(tail)) {
    return { ok: false, reason: `'${cursor}' names no position in the log` }
  }
  const sequence = Number(tail)
  if (!Number.isSafeInteger(sequence)) {
    return { ok: false, reason: `'${cursor}' names a position too large to be one` }
  }
  if (sequence > available) {
    // NOT REACHED YET, which for a log that only grows means the reader's window is not this run's:
    // this run has appended `available` events, and no position beyond that has ever existed.
    return {
      ok: false,
      reason: `the cursor is at ${String(sequence)} but run '${runId}' has appended ${String(available)} events`,
    }
  }
  return { ok: true, sequence }
}

/**
 * How long a follow waits between reads of the run's log.
 *
 * A RUN'S EVENTS ARE APPENDED BY THE DRIVER, not published: core has no emitter, and the journal's
 * seam is an empty callback (the service constructs it with `() => {}`). So a subscription observes
 * the log the way the page did, but from a POSITION instead of from nothing — which is what makes
 * the delivery ordered and resumable. The cost is bounded by this interval rather than by a page
 * round trip, and an event that arrives one tick late is still delivered exactly once.
 */
export const RUN_FOLLOW_TICK_MS = 250

/**
 * Build the envelope for one recorded event.
 *
 * @param runId - the run that recorded it.
 * @param sequence - its index in the run's log.
 * @param event - the recorded event.
 * @returns the envelope a subscriber receives.
 */
export function envelopeOf(runId: string, sequence: number, event: AuditEvent): RunEventEnvelope {
  return {
    eventId: `${runId}${CURSOR_SEPARATOR}${String(sequence)}`,
    runId,
    sequence,
    schemaVersion: RUN_EVENT_ENVELOPE_VERSION,
    kind: event.kind,
    ...(event.stepId === undefined ? {} : { stepId: event.stepId }),
    ...(event.attemptId === undefined ? {} : { attemptId: event.attemptId }),
    ts: event.ts,
  }
}

/**
 * The run's own live state, or undefined when this store does not hold it.
 *
 * The events are read from the LIVE record rather than from a snapshot: a snapshot is a deep clone
 * taken once, and a subscription needs the entries appended after it. What makes that safe is that
 * the array only grows — the clone's length is a position that stays meaningful.
 *
 * @param store - the store holding the run.
 * @param runId - the run to read.
 * @returns the live run state, or undefined.
 */
export function liveRunOf(store: ResearchRunStore, runId: string): RunState | undefined {
  return store.get(runId)
}
