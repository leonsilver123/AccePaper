// @deepseek-ai/dsh-research-team — D4-rebuttal pure revision-record logic.
//
// PURE-LOGIC LAYER (D4, pipeline step 14 of 16): no ctx / host / DSH imports,
// no I/O, no network, no clock, no randomness. Given the reviewer concerns of
// one round — each already paired with the author's response — the module
// derives the frozen {@link RevisionRecord} that D4 hands to the driver as its
// auditable "rebuttal → revision" trail. It replaces nothing in
// `registry.ts`; the registry keeps its own executor and this module stays a
// pure contract the executor can build its record through.
//
// NO DEFAULT PASS (frozen project discipline): an empty concern list is NOT a
// successful rebuttal. It throws instead of returning a well-formed empty
// record, because a record that says "0 concerns, nothing to revise" is
// indistinguishable from an approved manuscript and would let an absent
// rebuttal read as a passed step. A concern or a response that is blank after
// trim throws for the same reason: a hollow point is not a rebuttal. A missing
// `requiresRevision` flag is rejected outright rather than coerced — reading
// `undefined` as "no revision" is exactly the silent default this module must
// not have.
//
// DERIVED AGGREGATES: `revisionCount` is counted from the points and
// `hasRevisions` follows from `revisionCount > 0`. Neither is accepted from the
// caller, so no caller can assert an outcome the points do not support.
//
// SNAPSHOT ISOLATION (INV-WRITE-ISOLATION / INV-SNAPSHOT): the returned record
// is `structuredClone`d and recursively `Object.freeze`d, so no live reference
// to the caller's data escapes the call and neither side can observe a later
// mutation of the other.
//
// Every rejection is a plain `Error` whose message begins with a stable
// `[DSH_REBUTTAL_*]` code prefix, so a caller can match on the code without
// importing this module's internals.

/** Stable error-code prefix carried by every rejection this module throws. */
export const DSH_REBUTTAL_ERROR_PREFIX = 'DSH_REBUTTAL_'

/** One reviewer concern paired with the author's response to it. */
export interface RebuttalPoint {
  /** The reviewer's concern, as reported (stored verbatim, never trimmed). */
  readonly concern: string
  /** The author's response to that concern (stored verbatim, never trimmed). */
  readonly response: string
  /** Whether the response commits the author to a change in the manuscript. */
  readonly requiresRevision: boolean
}

/** The auditable rebuttal → revision trail produced for one D4 attempt. */
export interface RevisionRecord {
  /** Point-by-point replies, in input order. */
  readonly points: ReadonlyArray<RebuttalPoint>
  /** How many points commit to a revision (derived, never asserted by the caller). */
  readonly revisionCount: number
  /** True iff `revisionCount > 0` (derived from the count, never passed in). */
  readonly hasRevisions: boolean
  /** One-line auditable statement of what this record is based on. */
  readonly basis: string
}

/**
 * Throw a plain `Error` carrying one stable `[DSH_REBUTTAL_*]` code prefix.
 * @param suffix - the code suffix appended to {@link DSH_REBUTTAL_ERROR_PREFIX}.
 * @param detail - human-readable context rendered after the code.
 * @returns never — this function always throws.
 */
function rebuttalError(suffix: string, detail: string): never {
  throw new Error(`[${DSH_REBUTTAL_ERROR_PREFIX}${suffix}] ${detail}`)
}

/**
 * Describe a rejected value's runtime shape for an error message.
 * @param value - the value that failed validation.
 * @returns `'null'` when the value is null, otherwise its `typeof` tag.
 */
function describeValue(value: unknown): string {
  return value === null ? 'null' : typeof value
}

/**
 * Validate one raw entry into a {@link RebuttalPoint}, or throw.
 * @param raw - the candidate entry (validated as `unknown`, not trusted by type).
 * @param index - the entry's position, used to locate the failure in the round.
 * @returns the validated point, with `concern` and `response` stored verbatim.
 */
function normalizePoint(raw: unknown, index: number): RebuttalPoint {
  if (raw === null || typeof raw !== 'object') {
    rebuttalError('INVALID_POINT', `point ${index} must be an object (got ${describeValue(raw)})`)
  }
  const fields = raw as Record<string, unknown>

  const concern = fields['concern']
  if (typeof concern !== 'string') {
    rebuttalError(
      'INVALID_CONCERN',
      `point ${index}: concern must be a string (got ${describeValue(concern)})`,
    )
  }
  if (concern.trim().length === 0) {
    rebuttalError('EMPTY_CONCERN', `point ${index}: concern is blank after trim`)
  }

  const response = fields['response']
  if (typeof response !== 'string') {
    rebuttalError(
      'INVALID_RESPONSE',
      `point ${index}: response must be a string (got ${describeValue(response)})`,
    )
  }
  if (response.trim().length === 0) {
    rebuttalError('EMPTY_RESPONSE', `point ${index}: response is blank after trim`)
  }

  const requiresRevision = fields['requiresRevision']
  if (typeof requiresRevision !== 'boolean') {
    rebuttalError(
      'INVALID_FLAG',
      `point ${index}: requiresRevision must be a boolean (got ${describeValue(requiresRevision)}); ` +
        'an absent flag is never read as "no revision"',
    )
  }

  return { concern, response, requiresRevision }
}

/**
 * Recursively freeze a clone so no caller can mutate a published snapshot.
 * @param value - the value to freeze in place.
 * @returns the same value, preserving its type.
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    const snapshot = value as Record<string, unknown>
    for (const field of Object.keys(snapshot)) {
      deepFreeze(snapshot[field])
    }
    Object.freeze(value)
  }
  return value
}

/**
 * Build the auditable D4 rebuttal → revision record for one reviewer round.
 *
 * The aggregates are DERIVED, never accepted from the caller: `revisionCount`
 * counts the points whose `requiresRevision` is true and `hasRevisions` is
 * `revisionCount > 0`. `concern` and `response` are stored verbatim (input
 * order preserved); only whitespace-only values are rejected.
 *
 * The result is an independent, recursively frozen snapshot
 * (INV-WRITE-ISOLATION / INV-SNAPSHOT): mutating the input afterwards cannot
 * change the record, and mutating the record throws.
 *
 * @param points - the round's reviewer concerns with their responses, in report order.
 * @returns the frozen {@link RevisionRecord} with derived counts and basis line.
 * @throws {Error} `[DSH_REBUTTAL_EMPTY_POINTS]` when `points` is empty — an empty
 *   round is not a rebuttal, and this module never returns a successful-looking
 *   empty record (NO DEFAULT PASS).
 * @throws {Error} `[DSH_REBUTTAL_INVALID_POINTS]` when `points` is not an array.
 * @throws {Error} `[DSH_REBUTTAL_INVALID_POINT]` when an entry is not an object.
 * @throws {Error} `[DSH_REBUTTAL_INVALID_CONCERN]` / `[DSH_REBUTTAL_EMPTY_CONCERN]`
 *   when a concern is not a string, or is blank after trim.
 * @throws {Error} `[DSH_REBUTTAL_INVALID_RESPONSE]` / `[DSH_REBUTTAL_EMPTY_RESPONSE]`
 *   when a response is not a string, or is blank after trim.
 * @throws {Error} `[DSH_REBUTTAL_INVALID_FLAG]` when `requiresRevision` is not a
 *   boolean — an absent flag is never silently read as "no revision".
 */
export function buildRevisionRecord(points: ReadonlyArray<RebuttalPoint>): RevisionRecord {
  const candidate: unknown = points
  if (!Array.isArray(candidate)) {
    rebuttalError(
      'INVALID_POINTS',
      `points must be an array (got ${describeValue(candidate)})`,
    )
  }
  const list: ReadonlyArray<unknown> = candidate
  if (list.length === 0) {
    rebuttalError(
      'EMPTY_POINTS',
      'a round with no reviewer concerns is not a rebuttal; refusing to publish an empty revision record',
    )
  }

  const normalized = list.map((point, index) => normalizePoint(point, index))
  const revisionCount = normalized.filter(point => point.requiresRevision).length
  const hasRevisions = revisionCount > 0
  const total = normalized.length
  const basis = hasRevisions
    ? `D4-rebuttal: ${total} concern(s) answered; ${revisionCount} require manuscript revision; ${total - revisionCount} answered without revision`
    : `D4-rebuttal: ${total} concern(s) answered; none require manuscript revision`

  return deepFreeze(
    structuredClone({
      points: normalized,
      revisionCount,
      hasRevisions,
      basis,
    }),
  )
}
