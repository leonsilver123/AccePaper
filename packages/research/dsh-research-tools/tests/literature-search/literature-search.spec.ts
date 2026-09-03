// T12 literature search (文献检索工具) — vitest spec.
//
// Covers the frozen T12 design contract for this fixture/adapter-only wave:
//   - ok path returns a DEEPLY FROZEN artifact; hits within maxResults;
//   - empty/whitespace topic and maxResults < 1 throw LiteratureSearchError;
//   - a seeded-unavailable adapter surfaces outcome 'unavailable' (NEVER an
//     empty 'ok' — no default pass);
//   - truncation flag is set when the corpus exceeds maxResults;
//   - meta.toolId / version / producedAt present, producedAt numeric.

import { describe, expect, it } from 'vitest'
import {
  LITERATURE_SEARCH_TOOL_ID,
  LITERATURE_SEARCH_TOOL_VERSION,
  LiteratureSearchError,
  createMockLiteratureSearchAdapter,
  mockLiteratureSearchAdapter,
  runLiteratureSearch,
} from '../../src/tools/literature-search/index.ts'
import type {
  LiteratureHit,
  LiteratureQuery,
  LiteratureSearchAdapter,
  LiteratureSearchOutcome,
  LiteratureVenueTier,
} from '../../src/tools/literature-search/index.ts'

const TS = 1_700_000_000_000
const run = runLiteratureSearch

/** Run fn and return the LiteratureSearchError code (or undefined when it did
 *  not throw a LiteratureSearchError). */
function errorCodeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (e) {
    return e instanceof LiteratureSearchError ? e.code : undefined
  }
  return undefined
}

/** Tier1 venues in the synthetic corpus (used to assert venueTierFilter). */
const TIER1_VENUES: ReadonlySet<string> = new Set([
  'Synthetic Journal A',
  'Synthetic Conference A',
])

describe('ok path — frozen artifact + maxResults', () => {
  it('returns a deeply-frozen ok artifact (mutating hits / hit fields throws)', () => {
    const artifact = run({ topic: 'synthetic' }, mockLiteratureSearchAdapter, TS)
    expect(artifact.outcome).toBe('ok')

    // Whole-artifact / hits-array mutation throws (frozen).
    expect(() => {
      (artifact.hits as unknown as unknown[]).push({} as never)
    }).toThrow(TypeError)

    // Nested hit + ref mutation throws (deep freeze).
    const first = artifact.hits[0] as unknown as { title: string; ref: { id: string } }
    expect(() => {
      first.title = 'mutated title'
    }).toThrow(TypeError)
    expect(() => {
      first.ref.id = 'mutated-id'
    }).toThrow(TypeError)

    // Query echo is the normalized (trimmed) topic, also frozen.
    const trimmed = run({ topic: '   synthetic  ' }, mockLiteratureSearchAdapter, TS)
    expect(trimmed.query.topic).toBe('synthetic')
    expect(() => {
      (trimmed.query as { topic: string }).topic = 'mutated'
    }).toThrow(TypeError)
  })

  it('keeps hits within a provided maxResults and reports truncation', () => {
    const artifact = run({ topic: 'synthetic', maxResults: 5 }, mockLiteratureSearchAdapter, TS)
    expect(artifact.outcome).toBe('ok')
    expect(artifact.hits).toHaveLength(5)
    expect(artifact.truncated).toBe(true)
  })

  it('maxResults larger than the match set returns all matches without truncation', () => {
    const artifact = run(
      { topic: 'synthetic', maxResults: 100 },
      mockLiteratureSearchAdapter,
      TS,
    )
    expect(artifact.outcome).toBe('ok')
    expect(artifact.hits).toHaveLength(14)
    expect(artifact.truncated).toBe(false)
  })

  it('calls the injected adapter exactly once', () => {
    let calls = 0
    const countingAdapter: LiteratureSearchAdapter = {
      search(query) {
        calls += 1
        return mockLiteratureSearchAdapter.search(query)
      },
    }
    run({ topic: 'synthetic' }, countingAdapter, TS)
    expect(calls).toBe(1)
  })
})

describe('input validation — invalid input throws LiteratureSearchError', () => {
  it('rejects empty and whitespace-only topics', () => {
    expect(errorCodeOf(() => run({ topic: '' }, mockLiteratureSearchAdapter, TS))).toBe(
      'DSH_LITERATURE_SEARCH_EMPTY_TOPIC',
    )
    expect(errorCodeOf(() => run({ topic: '   ' }, mockLiteratureSearchAdapter, TS))).toBe(
      'DSH_LITERATURE_SEARCH_EMPTY_TOPIC',
    )
  })

  it('rejects a missing / non-string topic', () => {
    expect(
      errorCodeOf(() =>
        run({ topic: 42 as unknown as string }, mockLiteratureSearchAdapter, TS),
      ),
    ).toBe('DSH_LITERATURE_SEARCH_INVALID_QUERY')
    expect(
      errorCodeOf(() => run(null as unknown as LiteratureQuery, mockLiteratureSearchAdapter, TS)),
    ).toBe('DSH_LITERATURE_SEARCH_INVALID_QUERY')
  })

  it('rejects maxResults < 1 (and non-integers)', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(
        errorCodeOf(() =>
          run({ topic: 'synthetic', maxResults: bad }, mockLiteratureSearchAdapter, TS),
        ),
      ).toBe('DSH_LITERATURE_SEARCH_INVALID_MAX_RESULTS')
    }
  })

  it('rejects an unknown venueTierFilter value', () => {
    expect(
      errorCodeOf(() =>
        run(
          { topic: 'synthetic', venueTierFilter: 'tier9' as LiteratureVenueTier },
          mockLiteratureSearchAdapter,
          TS,
        ),
      ),
    ).toBe('DSH_LITERATURE_SEARCH_INVALID_VENUE_TIER_FILTER')
  })

  it('rejects a missing / malformed adapter', () => {
    expect(
      errorCodeOf(() =>
        run({ topic: 'synthetic' }, null as unknown as LiteratureSearchAdapter, TS),
      ),
    ).toBe('DSH_LITERATURE_SEARCH_MISSING_ADAPTER')
    expect(
      errorCodeOf(() =>
        run(
          { topic: 'synthetic' },
          {} as unknown as LiteratureSearchAdapter,
          TS,
        ),
      ),
    ).toBe('DSH_LITERATURE_SEARCH_MISSING_ADAPTER')
  })

  it('rejects a non-finite timestamp', () => {
    expect(errorCodeOf(() => run({ topic: 'synthetic' }, mockLiteratureSearchAdapter, Number.NaN)))
      .toBe('DSH_LITERATURE_SEARCH_INVALID_TIMESTAMP')
  })

  it('accepts maxResults = 1 as the lower bound', () => {
    const artifact = run({ topic: 'synthetic', maxResults: 1 }, mockLiteratureSearchAdapter, TS)
    expect(artifact.outcome).toBe('ok')
    expect(artifact.hits).toHaveLength(1)
  })
})

describe('adapter outage — NO DEFAULT PASS', () => {
  it('a seeded-unavailable adapter surfaces outcome unavailable (never empty ok)', () => {
    const adapter = createMockLiteratureSearchAdapter({ unavailable: true })
    const artifact = run({ topic: 'synthetic' }, adapter, TS)
    expect(artifact.outcome).toBe('unavailable')
    expect(artifact.hits).toEqual([])
    expect(artifact.truncated).toBe(false)
  })

  it('a genuine no-match is outcome ok with zero hits — distinct from unavailable', () => {
    const artifact = run({ topic: 'no-such-token-xyzzy' }, mockLiteratureSearchAdapter, TS)
    expect(artifact.outcome).toBe('ok')
    expect(artifact.hits).toEqual([])
    expect(artifact.truncated).toBe(false)
  })

  it('an adapter that throws is surfaced as-is, not swallowed into unavailable', () => {
    const adapter: LiteratureSearchAdapter = {
      search: () => {
        throw new Error('adapter exploded')
      },
    }
    expect(() => run({ topic: 'synthetic' }, adapter, TS)).toThrow('adapter exploded')
  })

  it('structurally-invalid adapter output is an adapter fault, never a pass', () => {
    const adapter: LiteratureSearchAdapter = {
      search: () => ({ status: 'maybe' }) as unknown as LiteratureSearchOutcome,
    }
    expect(
      errorCodeOf(() => run({ topic: 'synthetic' }, adapter, TS)),
    ).toBe('DSH_LITERATURE_SEARCH_INVALID_ADAPTER_OUTPUT')
  })
})

describe('structurally-invalid adapter output — ok-outcome contract violations', () => {
  // A structurally valid hit (shaped like the synthetic corpus rows), reused by
  // the stub adapters below to isolate the ONE violated field per test.
  function validHit(id: string): LiteratureHit {
    return {
      id: id as LiteratureHit['id'],
      venue: 'Synthetic Journal A',
      title: `Synthetic paper ${id}`,
      ref: { kind: 'doi', id: `10.1000/synth-${id}`, title: `Synthetic paper ${id}`, authors: ['A. Synthetic'] },
    }
  }

  function adapterReturning(outcome: unknown): LiteratureSearchAdapter {
    return { search: () => outcome as unknown as LiteratureSearchOutcome }
  }

  it('throws DSH_LITERATURE_SEARCH_INVALID_ADAPTER_OUTPUT when the outcome is null', () => {
    expect(errorCodeOf(() => run({ topic: 'synthetic' }, adapterReturning(null), TS))).toBe(
      'DSH_LITERATURE_SEARCH_INVALID_ADAPTER_OUTPUT',
    )
  })

  it('throws DSH_LITERATURE_SEARCH_INVALID_ADAPTER_OUTPUT when the outcome is a non-object', () => {
    expect(errorCodeOf(() => run({ topic: 'synthetic' }, adapterReturning(42), TS))).toBe(
      'DSH_LITERATURE_SEARCH_INVALID_ADAPTER_OUTPUT',
    )
  })

  it("throws DSH_LITERATURE_SEARCH_INVALID_ADAPTER_OUTPUT when an 'ok' outcome lacks a hits array", () => {
    expect(errorCodeOf(() => run({ topic: 'synthetic' }, adapterReturning({ status: 'ok' }), TS))).toBe(
      'DSH_LITERATURE_SEARCH_INVALID_ADAPTER_OUTPUT',
    )
  })

  it("throws DSH_LITERATURE_SEARCH_INVALID_ADAPTER_OUTPUT when an 'ok' outcome carries a negative total", () => {
    expect(
      errorCodeOf(() =>
        run({ topic: 'synthetic' }, adapterReturning({ status: 'ok', hits: [validHit('a')], total: -1 }), TS),
      ),
    ).toBe('DSH_LITERATURE_SEARCH_INVALID_ADAPTER_OUTPUT')
  })

  it('throws DSH_LITERATURE_SEARCH_INVALID_ADAPTER_OUTPUT when hits outnumber total (capping contract violated)', () => {
    expect(
      errorCodeOf(() =>
        run(
          { topic: 'synthetic' },
          adapterReturning({ status: 'ok', hits: [validHit('a'), validHit('b')], total: 1 }),
          TS,
        ),
      ),
    ).toBe('DSH_LITERATURE_SEARCH_INVALID_ADAPTER_OUTPUT')
  })

  it('throws DSH_LITERATURE_SEARCH_INVALID_ADAPTER_OUTPUT when hits exceed the caller maxResults', () => {
    expect(
      errorCodeOf(() =>
        run(
          { topic: 'synthetic', maxResults: 2 },
          adapterReturning({ status: 'ok', hits: [validHit('a'), validHit('b'), validHit('c')], total: 3 }),
          TS,
        ),
      ),
    ).toBe('DSH_LITERATURE_SEARCH_INVALID_ADAPTER_OUTPUT')
  })
})

describe('mock adapter — direct search() defensive branches (tool validation bypassed)', () => {
  type OkOutcome = { status: 'ok'; hits: ReadonlyArray<unknown>; total: number }

  it('caps a negative maxResults at zero hits (Math.max defensive floor)', () => {
    const adapter = createMockLiteratureSearchAdapter()
    const outcome = adapter.search({ topic: 'synthetic', maxResults: -5 }) as unknown as OkOutcome
    expect(outcome.status).toBe('ok')
    expect(outcome.total).toBe(14)
    expect(outcome.hits).toEqual([])
  })

  it('an empty-topic query matches nothing and stays an ok outcome (defensive empty-token filter)', () => {
    const adapter = createMockLiteratureSearchAdapter()
    const outcome = adapter.search({ topic: '   ' }) as unknown as OkOutcome
    expect(outcome.status).toBe('ok')
    expect(outcome.total).toBe(0)
    expect(outcome.hits).toEqual([])
  })
})

describe('venueTierFilter + truncation', () => {
  it('venueTierFilter restricts hits to the requested synthetic tier', () => {
    const artifact = run(
      { topic: 'synthetic', venueTierFilter: 'tier1' },
      mockLiteratureSearchAdapter,
      TS,
    )
    expect(artifact.outcome).toBe('ok')
    expect(artifact.hits).toHaveLength(5)
    for (const hit of artifact.hits) {
      expect(TIER1_VENUES.has(hit.venue)).toBe(true)
    }
    expect(artifact.truncated).toBe(false)
  })

  it('venueTierFilter + maxResults still truncates', () => {
    const artifact = run(
      { topic: 'synthetic', venueTierFilter: 'tier1', maxResults: 2 },
      mockLiteratureSearchAdapter,
      TS,
    )
    expect(artifact.outcome).toBe('ok')
    expect(artifact.hits).toHaveLength(2)
    expect(artifact.truncated).toBe(true)
  })
})

describe('artifact meta envelope', () => {
  it('carries toolId / version / numeric producedAt', () => {
    const artifact = run({ topic: 'synthetic' }, mockLiteratureSearchAdapter, TS)
    expect(artifact.meta.toolId).toBe(LITERATURE_SEARCH_TOOL_ID)
    expect(artifact.meta.toolId).toBe('literature-search')
    expect(artifact.meta.version).toBe(LITERATURE_SEARCH_TOOL_VERSION)
    expect(typeof artifact.meta.producedAt).toBe('number')
    expect(artifact.meta.producedAt).toBe(TS)
  })

  it('meta is present on the unavailable outcome too', () => {
    const artifact = run(
      { topic: 'synthetic' },
      createMockLiteratureSearchAdapter({ unavailable: true }),
      TS,
    )
    expect(artifact.meta.toolId).toBe('literature-search')
    expect(artifact.meta.version).toBe(LITERATURE_SEARCH_TOOL_VERSION)
    expect(artifact.meta.producedAt).toBe(TS)
  })
})
