// @deepseek-ai/dsh-research-tools — T12 literature search (文献检索工具), public entry.
//
// PURE tool function: given a research query + an injected adapter + a
// caller-provided timestamp, return candidate literature hits as a DEEPLY
// FROZEN {@link LiteratureSearchArtifact}. No network, no filesystem, no
// clocks, no hidden IO, no real model gateway and no real external literature
// API — external services are reached ONLY through the injected
// {@link LiteratureSearchAdapter} (this wave ships the fixture mock in
// ./mock.ts with SYNTHETIC data only).
//
// Trust-boundary invariants (see the frozen T12 design brief + shared.ts):
//  - IMMUTABLE ARTIFACT: the result is produced via {@link freezeArtifact}
//    (structuredClone + deep Object.freeze) and always carries
//    `meta: ToolArtifactMeta`. No live reference escapes the tool boundary.
//  - NO DEFAULT PASS: an adapter outage maps to `outcome: 'unavailable'`
//    (with zero hits) and is NEVER conflated with "no literature found"
//    (a genuine no-match is `outcome: 'ok'` with an empty `hits` list).
//    The adapter is called EXACTLY ONCE.
//  - PURE + DETERMINISTIC: `timestamp` (epoch ms, for `meta.producedAt`) is
//    caller-injected — the tool never reads a clock.
//  - ERROR BASE: {@link LiteratureSearchError} for invalid input and for
//    structurally-invalid adapter output. An adapter that THROWS is surfaced
//    as-is (never swallowed, never silently mapped to 'unavailable' — that
//    would hide faults; 'unavailable' is the adapter's own declared outcome).

import type { ToolArtifactMeta } from '../../shared.ts'
import { freezeArtifact } from '../../shared.ts'
import type {
  LiteratureHit,
  LiteratureQuery,
  LiteratureSearchAdapter,
  LiteratureSearchOutcome,
  LiteratureSearchStatus,
  LiteratureVenueTier,
} from './adapter.ts'

/** Stable tool id used in every artifact's meta. */
export const LITERATURE_SEARCH_TOOL_ID = 'literature-search'

/** Version of this tool's artifact schema / implementation. Kept in lockstep
 *  with the package version (0.1.2-alpha.4 at the time of writing). */
export const LITERATURE_SEARCH_TOOL_VERSION = '0.1.2-alpha.4'

/** Globally unique, grep-able error-code prefix for this tool. */
export const LITERATURE_SEARCH_ERROR_PREFIX = 'DSH_LITERATURE_SEARCH_'

/** Error codes thrown by {@link runLiteratureSearch}. */
export type LiteratureSearchErrorCode =
  | 'DSH_LITERATURE_SEARCH_INVALID_QUERY'
  | 'DSH_LITERATURE_SEARCH_EMPTY_TOPIC'
  | 'DSH_LITERATURE_SEARCH_INVALID_MAX_RESULTS'
  | 'DSH_LITERATURE_SEARCH_INVALID_VENUE_TIER_FILTER'
  | 'DSH_LITERATURE_SEARCH_MISSING_ADAPTER'
  | 'DSH_LITERATURE_SEARCH_INVALID_TIMESTAMP'
  | 'DSH_LITERATURE_SEARCH_INVALID_ADAPTER_OUTPUT'

/** Error thrown on invalid tool input or structurally-invalid adapter output.
 *  Adapter exceptions themselves are surfaced as-is, NOT wrapped here. */
export class LiteratureSearchError extends Error {
  readonly code: LiteratureSearchErrorCode

  constructor(code: LiteratureSearchErrorCode, message: string) {
    super(`[${code}] ${message}`)
    this.name = 'LiteratureSearchError'
    this.code = code
  }
}

/** Frozen artifact of one literature search (produced via freezeArtifact).
 *  `outcome` is 'ok' | 'unavailable'; when 'unavailable' the adapter was
 *  contacted but could not answer (hits is empty and truncated is false) —
 *  distinct from a genuine no-match, which is an 'ok' with zero hits. */
export interface LiteratureSearchArtifact {
  readonly meta: ToolArtifactMeta
  /** Validated query echo (topic trimmed; only valid fields present). */
  readonly query: LiteratureQuery
  readonly outcome: LiteratureSearchStatus
  /** Candidate hits (already capped at query.maxResults when set). */
  readonly hits: ReadonlyArray<LiteratureHit>
  /** True when more matches existed than the returned hits (a cap applied). */
  readonly truncated: boolean
}

/** The three valid synthetic venue tiers (runtime guard for hostile input). */
const VALID_VENUE_TIERS: ReadonlySet<LiteratureVenueTier> = new Set<LiteratureVenueTier>([
  'tier1', 'tier2', 'tier3',
])

function throwInvalidAdapterOutput(detail: string): never {
  throw new LiteratureSearchError(
    'DSH_LITERATURE_SEARCH_INVALID_ADAPTER_OUTPUT',
    `runLiteratureSearch: adapter returned structurally invalid output — ${detail} (adapter fault; NOT a literature judgment)`,
  )
}

/** Validate the query and return a normalized plain snapshot (trimmed topic,
 *  validated maxResults / venueTierFilter, invalid optional keys dropped).
 *  @throws {LiteratureSearchError} on invalid input — never coerced. */
function normalizeQuery(query: LiteratureQuery): LiteratureQuery {
  if (query === null || typeof query !== 'object') {
    throw new LiteratureSearchError(
      'DSH_LITERATURE_SEARCH_INVALID_QUERY',
      'runLiteratureSearch: query must be a non-null object with a string topic',
    )
  }
  const topic = (query as { topic?: unknown }).topic
  if (typeof topic !== 'string') {
    throw new LiteratureSearchError(
      'DSH_LITERATURE_SEARCH_INVALID_QUERY',
      'runLiteratureSearch: query.topic must be a string',
    )
  }
  const trimmedTopic = topic.trim()
  if (trimmedTopic.length === 0) {
    throw new LiteratureSearchError(
      'DSH_LITERATURE_SEARCH_EMPTY_TOPIC',
      'runLiteratureSearch: query.topic must be a non-empty string after trimming',
    )
  }

  const maxResults = (query as { maxResults?: unknown }).maxResults
  if (
    maxResults !== undefined &&
    (typeof maxResults !== 'number' ||
      !Number.isSafeInteger(maxResults) ||
      maxResults < 1)
  ) {
    throw new LiteratureSearchError(
      'DSH_LITERATURE_SEARCH_INVALID_MAX_RESULTS',
      `runLiteratureSearch: query.maxResults must be an integer >= 1 when provided (got ${String(maxResults)})`,
    )
  }

  const venueTierFilter = (query as { venueTierFilter?: unknown }).venueTierFilter
  if (
    venueTierFilter !== undefined &&
    (typeof venueTierFilter !== 'string' ||
      !VALID_VENUE_TIERS.has(venueTierFilter as LiteratureVenueTier))
  ) {
    throw new LiteratureSearchError(
      'DSH_LITERATURE_SEARCH_INVALID_VENUE_TIER_FILTER',
      `runLiteratureSearch: query.venueTierFilter must be one of tier1|tier2|tier3 when provided (got ${String(venueTierFilter)})`,
    )
  }

  // Build the normalized plain snapshot (optional keys carried only when
  // actually present — exactOptionalPropertyTypes-safe).
  return {
    topic: trimmedTopic,
    ...(maxResults === undefined ? {} : { maxResults: maxResults as number }),
    ...(venueTierFilter === undefined
      ? {}
      : { venueTierFilter: venueTierFilter as LiteratureVenueTier }),
  }
}

function validateAdapter(adapter: LiteratureSearchAdapter): void {
  if (
    adapter === null ||
    typeof adapter !== 'object' ||
    typeof (adapter as { search?: unknown }).search !== 'function'
  ) {
    throw new LiteratureSearchError(
      'DSH_LITERATURE_SEARCH_MISSING_ADAPTER',
      'runLiteratureSearch: adapter must be an object with a search() function',
    )
  }
}

function validateTimestamp(timestamp: number): void {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    throw new LiteratureSearchError(
      'DSH_LITERATURE_SEARCH_INVALID_TIMESTAMP',
      `runLiteratureSearch: timestamp must be a finite epoch-ms number (got ${String(timestamp)})`,
    )
  }
}

/** Map one adapter {@link LiteratureSearchOutcome} onto a frozen
 *  {@link LiteratureSearchArtifact}. NO DEFAULT PASS: anything other than an
 *  explicit 'ok' / 'unavailable' status is an adapter fault and throws; an
 *  'unavailable' outcome never masquerades as an empty 'ok'. */
function buildArtifact(
  outcome: LiteratureSearchOutcome,
  query: LiteratureQuery,
  timestamp: number,
): LiteratureSearchArtifact {
  if (outcome === null || typeof outcome !== 'object') {
    throwInvalidAdapterOutput('outcome must be a non-null object')
  }
  const status = (outcome as { status?: unknown }).status

  if (status === 'ok') {
    const ok = outcome as Extract<LiteratureSearchOutcome, { status: 'ok' }>
    if (!Array.isArray(ok.hits)) {
      throwInvalidAdapterOutput("'ok' outcome must carry a hits array")
    }
    if (typeof ok.total !== 'number' || !Number.isSafeInteger(ok.total) || ok.total < 0) {
      throwInvalidAdapterOutput("'ok' outcome must carry a non-negative integer total")
    }
    // An 'ok' outcome may legitimately have zero hits (genuine no-match) —
    // but only when the adapter says total === 0 too. hits capped above total
    // or above the caller's maxResults means the adapter violated its contract.
    if (ok.hits.length > ok.total) {
      throwInvalidAdapterOutput('ok.hits longer than ok.total (capping contract violated)')
    }
    if (query.maxResults !== undefined && ok.hits.length > query.maxResults) {
      throwInvalidAdapterOutput('ok.hits longer than query.maxResults (capping contract violated)')
    }

    const truncated = ok.total > ok.hits.length
    const meta: ToolArtifactMeta = {
      toolId: LITERATURE_SEARCH_TOOL_ID,
      version: LITERATURE_SEARCH_TOOL_VERSION,
      producedAt: timestamp,
    }
    return freezeArtifact({
      meta,
      query,
      outcome: 'ok' as const,
      hits: ok.hits,
      truncated,
    })
  }

  if (status === 'unavailable') {
    const meta: ToolArtifactMeta = {
      toolId: LITERATURE_SEARCH_TOOL_ID,
      version: LITERATURE_SEARCH_TOOL_VERSION,
      producedAt: timestamp,
    }
    // Adapter outage — NEVER an empty 'ok'. hits stays empty, truncated false.
    return freezeArtifact({
      meta,
      query,
      outcome: 'unavailable' as const,
      hits: [],
      truncated: false,
    })
  }

  throwInvalidAdapterOutput(
    `outcome.status must be 'ok' or 'unavailable' (got ${String(status)})`,
  )
}

/**
 * Run one literature search and return a deeply-frozen
 * {@link LiteratureSearchArtifact}. PURE: validates the input, calls the
 * injected adapter EXACTLY ONCE with a plain normalized query snapshot, and
 * maps the discriminated outcome onto the artifact.
 *
 * Outcome mapping (NO DEFAULT PASS):
 *  - 'ok'          -> artifact outcome 'ok', `truncated` = pre-cap total
 *                     exceeded returned hits, hits already capped;
 *  - 'unavailable' -> artifact outcome 'unavailable', hits [], truncated false
 *                     (an adapter outage, never reported as an empty 'ok');
 *  - anything else -> adapter fault -> {@link LiteratureSearchError}.
 *
 * Adapter exceptions are NOT swallowed: a throwing adapter propagates its own
 * error (surfaced, not remapped) — 'unavailable' is only ever the adapter's
 * own declared outcome.
 *
 * @param query the search query (frozen input type).
 * @param adapter the {@link LiteratureSearchAdapter} to search through.
 * @param timestamp caller-injected epoch ms (auditable; lands in meta.producedAt).
 * @throws {LiteratureSearchError} on invalid query / maxResults / venueTierFilter
 *   / missing adapter / invalid timestamp / structurally-invalid adapter output.
 */
export function runLiteratureSearch(
  query: LiteratureQuery,
  adapter: LiteratureSearchAdapter,
  timestamp: number,
): LiteratureSearchArtifact {
  const normalizedQuery = normalizeQuery(query)
  validateAdapter(adapter)
  validateTimestamp(timestamp)

  // Call the adapter EXACTLY ONCE (no retry, no fallback adapter).
  const outcome: LiteratureSearchOutcome = adapter.search(normalizedQuery)

  return buildArtifact(outcome, normalizedQuery, timestamp)
}

// ── Public re-exports (single import surface for consumers) ────────────────
export { createMockLiteratureSearchAdapter, mockLiteratureSearchAdapter } from './mock.ts'
export type { MockLiteratureSearchAdapterOptions } from './mock.ts'
export type {
  LiteratureCitationRef,
  LiteratureHit,
  LiteratureHitId,
  LiteratureQuery,
  LiteratureRefKind,
  LiteratureSearchAdapter,
  LiteratureSearchOutcome,
  LiteratureSearchStatus,
  LiteratureVenueTier,
} from './adapter.ts'
