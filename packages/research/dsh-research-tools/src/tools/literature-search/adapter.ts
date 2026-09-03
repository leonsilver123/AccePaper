// @deepseek-ai/dsh-research-tools — T12 literature search (文献检索工具).
//
// Adapter SEAM (EXTERNAL DATA SEAM — mirrors core's CitationResolverAdapter in
// packages/research/dsh-research-core/src/citation/adapter.ts).
//
// The tool (./index.ts) is PURE: it never performs network/filesystem I/O and
// holds no API keys. Candidate literature hits enter ONLY through a
// {@link LiteratureSearchAdapter} implementation whose real wiring lives
// OUTSIDE this pure module. This wave ships a Fixture/Mock implementation
// (./mock.ts) backed by a clearly SYNTHETIC corpus — no real journal/conference
// data, no data whose license is unconfirmed (same rule as the l0 mock's
// "Synthetic Journal A" venues).
//
// A search outcome MUST distinguish "adapter outage" from "no literature
// found" (the resolver principle: `not_found` is never confused with
// `temporarily_unavailable`):
//   - 'ok'          -> the adapter answered; hits may be an EMPTY list (a
//                      genuine no-match) — that is still an 'ok' outcome;
//   - 'unavailable' -> adapter outage / no external service answer — NEVER
//                      reportable as an empty 'ok' (NO DEFAULT PASS).
//
// The hit `ref` is shaped like core's CitationRef (contracts.ts) — a structural
// subset (`doi` / `arxiv` kinds) so a downstream T13 verifier can consume it.
// Nothing here asserts a hit is real, peer-reviewed, or that its content is
// truthful.

/** Synthetic venue-quality tier used to filter candidate hits. Mirrors the
 *  marker VALUES of core's L0Tier ('tier1'..'tier3') — a QUALITY LEVEL only,
 *  never a literature-truth assertion. */
export type LiteratureVenueTier = 'tier1' | 'tier2' | 'tier3'

/** Branded id of a candidate literature hit (opaque; constructed at the
 *  mock boundary, e.g. 'syn-lit-0001'). */
export type LiteratureHitId = string & { readonly __brand: 'LiteratureHitId' }

/** Identifier kinds a synthetic hit's {@link LiteratureCitationRef} may carry.
 *  Subset of core's CitationIdKind so the ref stays assignable to CitationRef. */
export type LiteratureRefKind = 'doi' | 'arxiv'

/** Citation reference carried by a hit, shaped like core's CitationRef
 *  (contracts.ts) — structural subset; no core import so this module
 *  type-checks in isolation. */
export interface LiteratureCitationRef {
  readonly kind: LiteratureRefKind
  /** The DOI / arXiv id. Values are synthetic (10.1000/synth-* test DOIs /
   *  month-99 arXiv-style ids), never real identifiers. */
  readonly id: string
  readonly title: string
  readonly authors: readonly string[]
}

/** One candidate literature hit: synthetic id + venue + title, plus a
 *  CitationRef-shaped {@link LiteratureCitationRef} for downstream identity
 *  work. Plain data only (structured-cloneable). */
export interface LiteratureHit {
  readonly id: LiteratureHitId
  readonly venue: string
  readonly title: string
  readonly ref: LiteratureCitationRef
}

/** Frozen input type of the tool. `topic` is the search topic/keywords
 *  (non-empty after trim). `maxResults` >= 1 caps returned hits.
 *  `venueTierFilter` optionally restricts results to one synthetic venue tier. */
export interface LiteratureQuery {
  readonly topic: string
  readonly maxResults?: number
  readonly venueTierFilter?: LiteratureVenueTier
}

/** Outcome of one adapter search — a discriminated union. NEVER `undefined`,
 *  never a bare `null`. `total` = matching-corpus count BEFORE the maxResults
 *  cap (the tool derives `truncated` from it), so an adapter that already
 *  truncated its answer can still signal "more were available". */
export type LiteratureSearchOutcome =
  | {
    readonly status: 'ok'
    /** Candidate hits, already capped at `query.maxResults` when set.
     *  May be empty (genuine no-match — still an 'ok' outcome). */
    readonly hits: ReadonlyArray<LiteratureHit>
    /** Number of matches before capping (`total >= hits.length`). */
    readonly total: number
  }
  | {
    readonly status: 'unavailable'
    /** Why the adapter could not answer (auditable; never a literature
     *  judgment). */
    readonly detail?: string
  }

/** The two outcome statuses ('ok' | 'unavailable'). */
export type LiteratureSearchStatus = LiteratureSearchOutcome['status']

/**
 * Searches the literature for one query. PURE in this wave (Fixture/Mock);
 * real implementations live outside the pure module and MUST be network-free
 * in tests.
 *
 * Adapter contract (enforced / documented in ./index.ts):
 *  - the adapter receives a plain, validated snapshot of the query;
 *  - it MUST return a discriminated {@link LiteratureSearchOutcome} — never
 *    throw to express "no results" (that is an 'ok' outcome with zero hits),
 *    and never report an outage as an empty 'ok';
 *  - it MUST return plain, structured-cloneable data (the tool deep-freezes
 *    the artifact);
 *  - it MUST cap `hits` at `query.maxResults` when set and report the pre-cap
 *    match count in `total`.
 *
 * @param query a plain snapshot of the validated search query.
 * @returns a discriminated {@link LiteratureSearchOutcome}.
 */
export interface LiteratureSearchAdapter {
  search(query: LiteratureQuery): LiteratureSearchOutcome
}
