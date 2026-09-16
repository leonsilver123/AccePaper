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

import { createHash } from 'node:crypto'

import { canonicalJson } from '@deepseek-ai/dsh-research-core'
import type { AuditEvent, ResearchRunStore, RunState } from '@deepseek-ai/dsh-research-core'

import { RUN_EVENT_ENVELOPE_VERSION, type ResearchRunCursor, type RunEventEnvelope } from '../types.ts'

/** The separator between a run id, its sequence and its log identity inside one cursor. */
const CURSOR_SEPARATOR = '#'

/**
 * The identity of a run's log prefix: how many events it holds, and a rolling hash over them.
 *
 * WHY A CURSOR NEEDS ONE. An index alone names a POSITION, and a position is not a history. A run
 * restored from a checkpoint holds the events that checkpoint saved — its in-memory tail is gone —
 * and the run then appends NEW events at the indices the lost ones occupied. A reader that had
 * consumed up to some position in the old history would be served the new events from that position
 * as though they continued what it held, while the events in between were never delivered to it.
 *
 * The digest is a chain: each event's fingerprint is folded into the previous digest, so the value at
 * position N identifies the sequence of the first N events and nothing else. Two logs that agree up
 * to N and differ after it have the same digest at N and different digests later, which is exactly
 * the point — a reader that consumed N events holds a prefix, and a prefix is what a position means.
 */
export interface LogIdentity {
  /** How many events of the run this identity covers. */
  readonly consumed: number
  /** The chain digest of those events, as lower-case hex. */
  readonly digest: string
}

/**
 * The identity of an empty log.
 *
 * A hash of a fixed label rather than the empty string, so the value is a digest of a LOG and cannot
 * be confused with one this module might compute for some other purpose.
 */
export const EMPTY_LOG: LogIdentity = {
  consumed: 0,
  digest: createHash('sha256').update('dsh-research-run-log-v1', 'utf8').digest('hex'),
}

/**
 * The canonical fingerprint of one audit event.
 *
 * The fields are written in a FIXED ORDER rather than by `JSON.stringify(event)`: the event object
 * is built by different core paths in different orders (appending one versus parsing one back from a
 * snapshot), and a fingerprint that depended on their key order would make every restart look like a
 * different history. `detail` goes through core's canonical encoder for the same reason.
 *
 * @param event - the recorded event.
 * @returns a string that is the same for the same event in any process.
 */
function fingerprintOf(event: AuditEvent): string {
  return JSON.stringify([
    event.kind,
    event.runId,
    event.stepId ?? null,
    event.attemptId ?? null,
    event.ts,
    // A detail with no canonical encoding cannot be described, and this is unreachable for events
    // read out of a run: the run's events are persisted as JSON and parsed back by core, so every
    // detail that reaches here has an encoding.
    canonicalJson(event.detail ?? null) ?? '',
  ])
}

/**
 * Extend a log identity to cover more of the same log.
 *
 * @param events - the run's event log, in order.
 * @param from - the identity to extend.
 * @param upto - the position to extend it to.
 * @returns the identity at `upto`; `from` itself when it is already there.
 * @throws {Error} when `upto` is before `from` — a log that shrank is not this function's to guess
 *   about, and the reader must take a fresh opening.
 */
export function chainDigest(
  events: ReadonlyArray<AuditEvent>,
  from: LogIdentity,
  upto: number,
): LogIdentity {
  if (upto < from.consumed) {
    throw new Error(`a log cannot be read backwards: ${String(upto)} is before ${String(from.consumed)}`)
  }
  let digest = from.digest
  for (let index = from.consumed; index < upto; index += 1) {
    const event = events[index]
    if (event === undefined) {
      throw new Error(`the log holds ${String(events.length)} events, and ${String(index)} was asked for`)
    }
    digest = createHash('sha256').update(`${digest}\n${fingerprintOf(event)}`, 'utf8').digest('hex')
  }
  return { consumed: upto, digest }
}

/**
 * A cursor naming one position in one run's event log.
 *
 * The format is `<runId>#<sequence>#<digest>`: the run id is part of the cursor so a cursor presented
 * for a different run is REFUSED rather than silently read as a position in that run's log, and the
 * digest is {@link LogIdentity} for the sequence — so a position in a DIFFERENT history is refused
 * too. Run ids are UUIDs, sequences are digits and digests are lower-case hex, so none of the three
 * contains a `#`.
 *
 * `sequence` is the number of events the reader has consumed — the exclusive end of a half-open
 * interval — not the index of the last one it saw. This is the position a reader names to continue,
 * so a reader that has consumed events `0..n` holds cursor `n+1`.
 *
 * @param runId - the run the position belongs to.
 * @param sequence - how many events of that run had been appended at this position.
 * @param digest - the chain digest of those events; {@link EMPTY_LOG}'s for the start.
 * @returns the cursor.
 */
export function runCursorOf(runId: string, sequence: number, digest: string): ResearchRunCursor {
  return `${runId}${CURSOR_SEPARATOR}${String(sequence)}${CURSOR_SEPARATOR}${digest}` as ResearchRunCursor
}

/**
 * The parts of one cursor, as {@link readRunCursor} read them.
 *
 * @param cursor - a cursor as it came off the wire.
 * @returns the named run, sequence and digest, or undefined when the text is not a cursor.
 */
export function partsOfCursor(
  cursor: string,
): { readonly runId: string; readonly sequence: number; readonly digest: string } | undefined {
  const parts = cursor.split(CURSOR_SEPARATOR)
  if (parts.length !== 3) return undefined
  const [runId, sequence, digest] = parts
  if (runId === undefined || sequence === undefined || digest === undefined) return undefined
  if (runId === '' || !/^\d+$/u.test(sequence) || !/^[0-9a-f]{64}$/u.test(digest)) return undefined
  const consumed = Number(sequence)
  if (!Number.isSafeInteger(consumed)) return undefined
  return { runId, sequence: consumed, digest }
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
 * Read a cursor against the run and the log it is presented for.
 *
 * @param runId - the run the caller asked to follow.
 * @param cursor - the cursor the caller holds, as it came off the wire.
 * @param events - that run's log, as this process holds it.
 * @returns the sequence it names, or why it cannot be served.
 */
export function readRunCursor(
  runId: string,
  cursor: string,
  events: ReadonlyArray<AuditEvent>,
): CursorRead {
  const parts = partsOfCursor(cursor)
  if (parts === undefined) {
    return { ok: false, reason: `'${cursor}' is not a run cursor: it names no run, position and log` }
  }
  if (parts.runId !== runId) {
    return { ok: false, reason: `the cursor belongs to run '${parts.runId}', not '${runId}'` }
  }
  if (parts.sequence > events.length) {
    // NOT REACHED YET, which for a log that only grows means the reader's window is not this run's:
    // this run has appended `events.length` events, and no position beyond that has ever existed.
    return {
      ok: false,
      reason: `the cursor is at ${String(parts.sequence)} but run '${runId}' has appended ${String(events.length)} events`,
    }
  }
  // THE POSITION IS IN THIS LOG'S RANGE — and that is not the same as being in this log's HISTORY.
  // A run restored from a checkpoint keeps the events that checkpoint saved and appends new ones at
  // the indices the lost tail occupied, so a position the reader consumed can hold different events
  // here. The digest is what tells the two apart, and a mismatch is a RESET rather than a gap to
  // continue from: the events between the reader's position and this one were never delivered to it.
  const actual = chainDigest(events, EMPTY_LOG, parts.sequence).digest
  if (actual !== parts.digest) {
    return {
      ok: false,
      reason: `the cursor names position ${String(parts.sequence)} of a different history of run '${runId}'`
        + ' — the log it was read from had different events there, so this reader cannot be continued',
    }
  }
  return { ok: true, sequence: parts.sequence }
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
 * @param cursor - the position AFTER this event: what a reader that has consumed it names next.
 * @returns the envelope a subscriber receives.
 */
export function envelopeOf(
  runId: string,
  sequence: number,
  event: AuditEvent,
  cursor: ResearchRunCursor,
): RunEventEnvelope {
  return {
    // THE IDENTITY OF THE EVENT, which is not the position to continue from: a reader that has
    // consumed event N continues at N+1, and naming N would ask for the event it already applied.
    eventId: `${runId}${CURSOR_SEPARATOR}${String(sequence)}`,
    runId,
    sequence,
    cursor,
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
