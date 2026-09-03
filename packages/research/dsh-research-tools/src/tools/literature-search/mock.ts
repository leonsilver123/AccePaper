// @deepseek-ai/dsh-research-tools — T12 literature search: Fixture/Mock adapter.
//
// This is the batch-2 stand-in for a real literature index / crossref-style
// API. It performs NO network I/O, holds NO real API keys, and backs every
// search with a clearly SYNTHETIC corpus (venues like "Synthetic Journal A" /
// "Synthetic Conference B", titles prefixed "Synthetic", test DOIs under the
// Crossref-reserved `10.1000/synth-*` space and impossible month-99 arXiv-style
// ids) — same license rule as the l0 mock: no real venue data, no data whose
// license is unconfirmed.
//
// Determinism: the corpus is a fixed module table; each instance owns a
// deep-frozen clone; every search returns FRESH hit objects so callers can
// never mutate fixture state. Matching is substring token search over
// (title + venue + ref id), OR semantics over the whitespace tokens of
// `query.topic` (lower-cased). An unknown keyword simply matches nothing —
// that is a legitimate 'ok' outcome with zero hits, never an outage.
//
// Outage semantics: the adapter NEVER reports 'unavailable' on its own. It
// returns `{ status: 'unavailable' }` only when constructed with
// `{ unavailable: true }` — an explicit, test-only seed. This keeps the
// fixture unable to fabricate a real outage, exactly like the resolver
// fixture's seeded `unavailableKeys`.

import type {
  LiteratureHit,
  LiteratureHitId,
  LiteratureQuery,
  LiteratureSearchAdapter,
  LiteratureSearchOutcome,
  LiteratureVenueTier,
} from './adapter.ts'

/** One row of the synthetic corpus table. `venueTier` is the row's synthetic
 *  quality marker (used by `venueTierFilter`); it is deliberately NOT emitted
 *  on hits. All fields are plain, structured-cloneable data. */
interface CorpusRecord {
  readonly venueTier: LiteratureVenueTier
  readonly venue: string
  readonly title: string
  readonly refKind: 'doi' | 'arxiv'
  readonly refId: string
  readonly authors: ReadonlyArray<string>
}

/** Synthetic corpus (FIXTURE ONLY — clearly synthetic titles/venues/DOIs, not
 *  real literature data and not real identifiers). Row order is stable and
 *  drives the stable `syn-lit-NNNN` hit ids. */
const SYNTHETIC_CORPUS: ReadonlyArray<CorpusRecord> = [
  // tier1 — Synthetic Journal A / Synthetic Conference A
  { venueTier: 'tier1', venue: 'Synthetic Journal A', title: 'Synthetic attention over memory hierarchies', refKind: 'doi', refId: '10.1000/synth-lit-0001', authors: ['A. Synthetic', 'B. Plausible'] },
  { venueTier: 'tier1', venue: 'Synthetic Journal A', title: 'Synthetic benchmark for long-context recall', refKind: 'doi', refId: '10.1000/synth-lit-0002', authors: ['C. Hypothetical', 'A. Synthetic'] },
  { venueTier: 'tier1', venue: 'Synthetic Conference A', title: 'Synthetic evidence review of retrieval pipelines', refKind: 'doi', refId: '10.1000/synth-lit-0003', authors: ['D. Invented'] },
  { venueTier: 'tier1', venue: 'Synthetic Conference A', title: 'Synthetic graph reasoning on knowledge corpora', refKind: 'arxiv', refId: '2499.00001', authors: ['E. Fabricated', 'A. Synthetic'] },
  { venueTier: 'tier1', venue: 'Synthetic Conference A', title: 'Synthetic multimodal grounding for question answering', refKind: 'arxiv', refId: '2499.00002', authors: ['F. Madeup'] },
  // tier2 — Synthetic Journal B / Synthetic Conference B
  { venueTier: 'tier2', venue: 'Synthetic Journal B', title: 'Synthetic causal estimation under distribution shift', refKind: 'doi', refId: '10.1000/synth-lit-0006', authors: ['G. Fictitious', 'H. Borrowed'] },
  { venueTier: 'tier2', venue: 'Synthetic Conference B', title: 'Synthetic fault analysis of memory controllers', refKind: 'doi', refId: '10.1000/synth-lit-0007', authors: ['I. Imagined'] },
  { venueTier: 'tier2', venue: 'Synthetic Journal B', title: 'Synthetic survey of attention speedups', refKind: 'arxiv', refId: '2499.00003', authors: ['J. Notional', 'K. Whimsical'] },
  { venueTier: 'tier2', venue: 'Synthetic Conference B', title: 'Synthetic field study of citation practices', refKind: 'doi', refId: '10.1000/synth-lit-0009', authors: ['L. Suppositional'] },
  { venueTier: 'tier2', venue: 'Synthetic Journal B', title: 'Synthetic model merging for retrieval quality', refKind: 'doi', refId: '10.1000/synth-lit-0010', authors: ['A. Synthetic', 'M. Prefabricated'] },
  // tier3 — Synthetic Regional Journal A
  { venueTier: 'tier3', venue: 'Synthetic Regional Journal A', title: 'Synthetic regional case notes on dataset reuse', refKind: 'doi', refId: '10.1000/synth-lit-0011', authors: ['N. Apocryphal'] },
  { venueTier: 'tier3', venue: 'Synthetic Regional Journal A', title: 'Synthetic replication of reasoning baselines', refKind: 'arxiv', refId: '2499.00004', authors: ['O. Hypothetical', 'P. Asserted'] },
  { venueTier: 'tier3', venue: 'Synthetic Regional Journal A', title: 'Synthetic teaching materials for research integrity', refKind: 'doi', refId: '10.1000/synth-lit-0013', authors: ['Q. Stipulated'] },
  { venueTier: 'tier3', venue: 'Synthetic Regional Journal A', title: 'Synthetic audit of memory scheduling policies', refKind: 'doi', refId: '10.1000/synth-lit-0014', authors: ['R. Postulated', 'A. Synthetic'] },
]

/** Lower-cased, whitespace-separated tokens of a topic string. */
function topicTokens(topic: string): ReadonlyArray<string> {
  return topic.trim().toLowerCase().split(/\s+/).filter(t => t.length > 0)
}

/** OR-token substring match over the row's searchable text (title + venue +
 *  ref id). Deterministic; unknown keywords match nothing. */
function matches(record: CorpusRecord, tokens: ReadonlyArray<string>): boolean {
  const haystack = `${record.title} ${record.venue} ${record.refId}`.toLowerCase()
  return tokens.some(token => haystack.includes(token))
}

/** Stable, corpus-row-indexed hit id (independent of filtering/capping). */
function hitIdAt(rowIndex: number): LiteratureHitId {
  return `syn-lit-${String(rowIndex + 1).padStart(4, '0')}` as LiteratureHitId
}

/** Build a fresh hit object (never alias fixture state). */
function toHit(record: CorpusRecord, id: LiteratureHitId): LiteratureHit {
  return {
    id,
    venue: record.venue,
    title: record.title,
    ref: {
      kind: record.refKind,
      id: record.refId,
      title: record.title,
      authors: record.authors,
    },
  }
}

/** Construction options. `unavailable: true` SEEDS a test-only outage so a
 *  search deterministically answers `{ status: 'unavailable' }` — the adapter
 *  never fabricates an outage on its own. */
export interface MockLiteratureSearchAdapterOptions {
  /** When true, every search answers 'unavailable' (test-only outage seed). */
  readonly unavailable?: boolean
}

/** Pure Fixture/Mock {@link LiteratureSearchAdapter}. Each instance deep-clones
 *  and freezes the synthetic corpus at construction (cross-run isolation), is
 *  fully deterministic, and honors `query.maxResults` / `query.venueTierFilter`.
 *  A search NEVER throws and NEVER reports an outage unless `unavailable` was
 *  seeded. */
export class MockLiteratureSearchAdapter implements LiteratureSearchAdapter {
  private readonly unavailable: boolean
  private readonly corpus: ReadonlyArray<CorpusRecord>

  constructor(options: MockLiteratureSearchAdapterOptions = {}) {
    this.unavailable = options.unavailable === true
    // Deep clone + freeze the module table per instance (no shared mutable
    // fixture state; callers can never observe a later mutation of this table).
    this.corpus = structuredClone(SYNTHETIC_CORPUS).map(record => Object.freeze(record))
    Object.freeze(this.corpus)
  }

  search(query: LiteratureQuery): LiteratureSearchOutcome {
    if (this.unavailable) {
      return {
        status: 'unavailable',
        detail: 'MockLiteratureSearchAdapter seeded outage (no external service was contacted)',
      }
    }

    const tokens = topicTokens(query.topic)
    const tierFilter = query.venueTierFilter

    const matchesAll: ReadonlyArray<{ record: CorpusRecord; id: LiteratureHitId }> =
      this.corpus
        .map((record, index) => ({ record, id: hitIdAt(index) }))
        .filter(entry => tierFilter === undefined || entry.record.venueTier === tierFilter)
        .filter(entry => tokens.length === 0 ? false : matches(entry.record, tokens))

    const total = matchesAll.length
    const cap =
      query.maxResults === undefined ? total : Math.min(total, Math.max(0, query.maxResults))
    const hits = matchesAll.slice(0, cap).map(entry => toHit(entry.record, entry.id))

    return { status: 'ok', total, hits }
  }
}

/** Build a fresh mock adapter instance (deterministic; each instance owns its
 *  own frozen corpus clone). */
export function createMockLiteratureSearchAdapter(
  options: MockLiteratureSearchAdapterOptions = {},
): LiteratureSearchAdapter {
  return new MockLiteratureSearchAdapter(options)
}

/** A ready, stateless mock fixture instance (safe to share; no outage seed). */
export const mockLiteratureSearchAdapter: LiteratureSearchAdapter =
  new MockLiteratureSearchAdapter()
