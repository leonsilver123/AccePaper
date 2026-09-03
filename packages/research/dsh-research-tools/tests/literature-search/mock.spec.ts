// T12 literature search — DIRECT mock-fixture contract tests (G2 debt).
//
// The tool-level spec exercises the mock only through runLiteratureSearch
// ('synthetic' matches all 14; an unknown token matches none), which cannot
// distinguish OR-token semantics, cannot prove venue/refId join the haystack,
// and cannot observe fresh-hit / instance-isolation guarantees. These tests
// import the mock module DIRECTLY and lock the fixture contract documented in
// src/tools/literature-search/mock.ts:
//   (a) whitespace tokens are OR-combined substring matches;
//   (b) the searchable haystack is title + venue + ref id (venue-only and
//       refId-only queries hit the expected synthetic corpus rows);
//   (c) every search returns FRESH hit objects (no aliasing across calls);
//   (d) each instance owns an isolated corpus + outage seed;
//   (e) hit ids are stable `syn-lit-NNNN` corpus-row ids in row order.
// Assertions target the mock's OWN behavior only — no src change.

import { describe, expect, it } from 'vitest'
import {
  createMockLiteratureSearchAdapter,
  mockLiteratureSearchAdapter,
} from '../../src/tools/literature-search/mock.ts'
import type { LiteratureSearchOutcome } from '../../src/tools/literature-search/adapter.ts'

type OkOutcome = Extract<LiteratureSearchOutcome, { status: 'ok' }>

/** Assert the outcome is the 'ok' branch and return it narrowed. */
function okOf(outcome: LiteratureSearchOutcome): OkOutcome {
  expect(outcome.status).toBe('ok')
  return outcome as OkOutcome
}

const ROW1_TITLE = 'Synthetic attention over memory hierarchies'

describe('T12 mock fixture contract — token matching (OR semantics)', () => {
  it('combines query tokens with OR: a hit matching only the second token is returned', () => {
    const adapter = createMockLiteratureSearchAdapter()
    const ok = okOf(adapter.search({ topic: 'memory retrieval' }))

    // Row 3 matches ONLY the second token ('retrieval' — its title/venue/ref
    // never contain 'memory'); rows 7 + 14 match ONLY the first token. OR
    // means all of them must be present, proving "ANY token may satisfy the
    // query" (a single-token query returns a strict subset of these 5).
    const titles = ok.hits.map(hit => hit.title)
    expect(titles).toContain('Synthetic evidence review of retrieval pipelines')
    expect(titles).toContain('Synthetic fault analysis of memory controllers')
    expect(titles).toContain('Synthetic audit of memory scheduling policies')

    // Rows matching either token: 1 (memory), 3 (retrieval), 7 (memory),
    // 10 (retrieval), 14 (memory).
    expect(ok.total).toBe(5)
    expect(ok.hits.map(hit => hit.id).sort()).toEqual([
      'syn-lit-0001',
      'syn-lit-0003',
      'syn-lit-0007',
      'syn-lit-0010',
      'syn-lit-0014',
    ])
  })

  it('matches on any single whitespace token (substring, case-insensitive)', () => {
    const adapter = createMockLiteratureSearchAdapter()
    // 'MEMORY' appears in rows 1 + 7; 'GRAPH' in row 4 alone.
    const ok = okOf(adapter.search({ topic: '  MEMORY graph ' }))
    const titles = ok.hits.map(hit => hit.title)
    expect(titles).toContain(ROW1_TITLE)
    expect(titles).toContain('Synthetic fault analysis of memory controllers')
    expect(titles).toContain('Synthetic graph reasoning on knowledge corpora')
  })
})

describe('T12 mock fixture contract — venue + refId join the haystack', () => {
  it('a venue-only token (no title/refId contains it) matches the venue rows', () => {
    const adapter = createMockLiteratureSearchAdapter()
    const ok = okOf(adapter.search({ topic: 'conference' }))

    // 'Conference' appears in NO title and NO refId — only in the two
    // Synthetic Conference venue strings. Rows 3/4/5 (Conference A) + 7/9
    // (Conference B); id reflects the corpus row index.
    expect(ok.total).toBe(5)
    expect(ok.hits.map(hit => hit.id)).toEqual([
      'syn-lit-0003',
      'syn-lit-0004',
      'syn-lit-0005',
      'syn-lit-0007',
      'syn-lit-0009',
    ])
    for (const hit of ok.hits) {
      expect(hit.venue).toMatch(/^Synthetic Conference [AB]$/)
    }
  })

  it('venueTierFilter narrows a venue-haystack hit set to the requested tier', () => {
    const adapter = createMockLiteratureSearchAdapter()
    const ok = okOf(adapter.search({ topic: 'conference', venueTierFilter: 'tier1' }))
    expect(ok.total).toBe(3)
    expect(ok.hits.map(hit => hit.id)).toEqual(['syn-lit-0003', 'syn-lit-0004', 'syn-lit-0005'])
    for (const hit of ok.hits) {
      expect(hit.venue).toBe('Synthetic Conference A')
    }
  })

  it('a refId token (DOI / arXiv-style) locates the single owning corpus row', () => {
    const adapter = createMockLiteratureSearchAdapter()

    const doiHit = okOf(adapter.search({ topic: 'synth-lit-0002' }))
    expect(doiHit.total).toBe(1)
    expect(doiHit.hits[0].id).toBe('syn-lit-0002')
    expect(doiHit.hits[0].ref).toMatchObject({ kind: 'doi', id: '10.1000/synth-lit-0002' })

    const arxivHit = okOf(adapter.search({ topic: '2499.00001' }))
    expect(arxivHit.total).toBe(1)
    expect(arxivHit.hits[0].id).toBe('syn-lit-0004')
    expect(arxivHit.hits[0].ref).toMatchObject({ kind: 'arxiv', id: '2499.00001' })
  })
})

describe('T12 mock fixture contract — fresh hits + instance isolation', () => {
  it('every search returns FRESH hit objects (no aliasing between calls)', () => {
    const adapter = createMockLiteratureSearchAdapter()
    const first = okOf(adapter.search({ topic: 'synthetic' }))
    const second = okOf(adapter.search({ topic: 'synthetic' }))

    // Distinct array + distinct hit instances per call.
    expect(first.hits).not.toBe(second.hits)
    expect(first.hits[0]).not.toBe(second.hits[0])
    expect(first.hits[0].ref).not.toBe(second.hits[0].ref)

    // Hits are plain (unfrozen) per-call objects: mutating a previous result
    // must never leak into a later result (no fixture-state mutation possible).
    ;(first.hits[0] as { title: string }).title = 'MUTATED via first result'
    const third = okOf(adapter.search({ topic: 'synthetic' }))
    expect(third.hits[0].title).toBe(ROW1_TITLE)
    expect(second.hits[0].title).toBe(ROW1_TITLE)
  })

  it('separate instances are isolated: the unavailable seed never leaks', () => {
    const healthy = createMockLiteratureSearchAdapter()
    const seededOutage = createMockLiteratureSearchAdapter({ unavailable: true })

    expect(seededOutage.search({ topic: 'synthetic' })).toEqual({
      status: 'unavailable',
      detail: 'MockLiteratureSearchAdapter seeded outage (no external service was contacted)',
    })

    // The healthy instance (created before AND after the seeded one) still
    // answers 'ok' — outage seeding is per-instance state, never global.
    expect(okOf(healthy.search({ topic: 'synthetic' })).total).toBe(14)
    const laterHealthy = createMockLiteratureSearchAdapter()
    expect(okOf(laterHealthy.search({ topic: 'synthetic' })).total).toBe(14)
  })

  it('two healthy instances do not share hit objects', () => {
    const a = okOf(createMockLiteratureSearchAdapter().search({ topic: 'synthetic' }))
    const b = okOf(createMockLiteratureSearchAdapter().search({ topic: 'synthetic' }))
    expect(a.hits[0]).not.toBe(b.hits[0])
    expect(a.hits).not.toBe(b.hits)
  })
})

describe('T12 mock fixture contract — stable synthetic corpus ids', () => {
  it('a full-corpus query returns syn-lit-0001..0014 in row order, every hit synthetic', () => {
    const adapter = createMockLiteratureSearchAdapter()
    const ok = okOf(adapter.search({ topic: 'synthetic' }))

    expect(ok.total).toBe(14)
    expect(ok.hits.map(hit => hit.id)).toEqual(
      Array.from({ length: 14 }, (_, index) => `syn-lit-${String(index + 1).padStart(4, '0')}`),
    )
    for (const hit of ok.hits) {
      expect(hit.id).toMatch(/^syn-lit-\d{4}$/)
      expect(hit.venue).toMatch(/^Synthetic (Journal|Conference|Regional Journal)/)
      expect(hit.title).toMatch(/^Synthetic /)
      expect(hit.ref.id.length).toBeGreaterThan(0)
    }
  })

  it('ids stay corpus-row-indexed even under filtering/capping (never re-numbered)', () => {
    const adapter = createMockLiteratureSearchAdapter()
    const tier2 = okOf(adapter.search({ topic: 'synthetic', venueTierFilter: 'tier2' }))
    expect(tier2.hits.map(hit => hit.id)).toEqual([
      'syn-lit-0006',
      'syn-lit-0007',
      'syn-lit-0008',
      'syn-lit-0009',
      'syn-lit-0010',
    ])

    const capped = okOf(adapter.search({ topic: 'synthetic', maxResults: 3 }))
    expect(capped.hits.map(hit => hit.id)).toEqual(['syn-lit-0001', 'syn-lit-0002', 'syn-lit-0003'])
  })

  it('is deterministic: repeated queries return identical ids/content', () => {
    const adapter = createMockLiteratureSearchAdapter()
    const first = okOf(adapter.search({ topic: 'synthetic', venueTierFilter: 'tier3' }))
    const second = okOf(adapter.search({ topic: 'synthetic', venueTierFilter: 'tier3' }))
    expect(second).toEqual(first)
    expect(first.hits.map(hit => hit.id)).toEqual([
      'syn-lit-0011',
      'syn-lit-0012',
      'syn-lit-0013',
      'syn-lit-0014',
    ])
  })

  it('the shared stateless mock instance also answers fresh, deterministic results', () => {
    const ok = okOf(mockLiteratureSearchAdapter.search({ topic: 'synthetic' }))
    expect(ok.total).toBe(14)
    expect(ok.hits[0].id).toBe('syn-lit-0001')
  })
})
