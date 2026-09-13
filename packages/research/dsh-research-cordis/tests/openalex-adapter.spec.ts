/**
 * OpenAlexLiteratureAdapter — the real literature-retrieval channel.
 *
 * Offline by construction: `fetchImpl` is injected, so no test here touches the
 * network. What is locked is the adapter's CONTRACT, where the failure branches
 * matter more than the happy path:
 *  - an outage or an HTTP error must resolve to 'unavailable', never to an empty
 *    'ok' (that would read as "no literature exists");
 *  - `venueTierFilter` is refused, not silently ignored;
 *  - catalogue records that cannot enter the citation identity chain (no id, no
 *    title, no DOI) are skipped rather than emitted half-formed.
 */

import { describe, expect, it } from 'vitest'
import { OpenAlexLiteratureAdapter } from '../src/openalex-adapter.ts'

/** Build a fetch stub returning one JSON response. */
function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })) as unknown as typeof fetch
}

/** A minimal OpenAlex work record. */
function work(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'https://openalex.org/W123456789',
    title: 'Adaptive traffic signal control with reinforcement learning',
    doi: 'https://doi.org/10.1000/example',
    publication_year: 2020,
    cited_by_count: 42,
    primary_location: { source: { display_name: 'Synthetic Journal of Transport' } },
    authorships: [{ author: { display_name: 'A. Researcher' } }],
    ...overrides,
  }
}

describe('OpenAlexLiteratureAdapter', () => {
  it('maps catalogue records into hits carrying a DOI-shaped citation ref', async () => {
    const adapter = new OpenAlexLiteratureAdapter({
      fetchImpl: jsonFetch({ meta: { count: 1234 }, results: [work()] }),
    })

    const outcome = await adapter.search({ topic: 'adaptive traffic signal control' })

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.hits).toHaveLength(1)
    // The length assertion above pins the only element this test reads.
    expect(outcome.hits[0]!.venue).toBe('Synthetic Journal of Transport')
    expect(outcome.hits[0]!.ref).toMatchObject({
      kind: 'doi',
      // The https://doi.org/ prefix is stripped down to the bare identifier.
      id: '10.1000/example',
      title: 'Adaptive traffic signal control with reinforcement learning',
      authors: ['A. Researcher'],
    })
    // `total` is the catalogue's pre-cap match count, not the returned length.
    expect(outcome.total).toBe(1234)
  })

  it('caps hits at maxResults while still reporting the pre-cap total', async () => {
    const adapter = new OpenAlexLiteratureAdapter({
      fetchImpl: jsonFetch({
        meta: { count: 900 },
        results: [work({ id: 'https://openalex.org/W1' }), work({ id: 'https://openalex.org/W2' })],
      }),
    })

    const outcome = await adapter.search({ topic: 'x', maxResults: 1 })

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.hits).toHaveLength(1)
    expect(outcome.total).toBe(900)
  })

  it('reports an HTTP error as unavailable, never as an empty ok', async () => {
    const adapter = new OpenAlexLiteratureAdapter({
      fetchImpl: jsonFetch({ error: 'rate limited' }, 429),
    })

    const outcome = await adapter.search({ topic: 'x' })

    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') return
    expect(outcome.detail).toContain('429')
  })

  it('reports a transport failure as unavailable rather than throwing', async () => {
    const adapter = new OpenAlexLiteratureAdapter({
      fetchImpl: (async () => { throw new Error('socket hang up') }) as unknown as typeof fetch,
    })

    const outcome = await adapter.search({ topic: 'x' })

    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') return
    expect(outcome.detail).toContain('socket hang up')
  })

  it('refuses venueTierFilter instead of silently returning unfiltered results', async () => {
    const adapter = new OpenAlexLiteratureAdapter({
      fetchImpl: jsonFetch({ meta: { count: 5 }, results: [work()] }),
    })

    const outcome = await adapter.search({ topic: 'x', venueTierFilter: 'tier1' })

    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') return
    expect(outcome.detail).toContain('venueTierFilter')
  })

  it('skips records that cannot enter the citation identity chain', async () => {
    const adapter = new OpenAlexLiteratureAdapter({
      fetchImpl: jsonFetch({
        meta: { count: 3 },
        results: [
          work({ id: 'https://openalex.org/W1' }),
          work({ id: 'https://openalex.org/W2', doi: null }),
          work({ id: 'https://openalex.org/W3', title: null, display_name: null }),
        ],
      }),
    })

    const outcome = await adapter.search({ topic: 'x' })

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.hits.map(hit => hit.id)).toEqual(['W1'])
  })

  it("sends the configured contact address as OpenAlex's mailto parameter", async () => {
    let seen: URL | undefined
    const adapter = new OpenAlexLiteratureAdapter({
      mailto: 'research@example.org',
      fetchImpl: (async (input: URL | RequestInfo) => {
        seen = new URL(String(input))
        return new Response(JSON.stringify({ meta: { count: 0 }, results: [] }), { status: 200 })
      }) as unknown as typeof fetch,
    })

    await adapter.search({ topic: 'adaptive traffic signals' })

    expect(seen?.searchParams.get('mailto')).toBe('research@example.org')
    expect(seen?.searchParams.get('search')).toBe('adaptive traffic signals')
  })

  it('survives a payload with no results array', async () => {
    const adapter = new OpenAlexLiteratureAdapter({ fetchImpl: jsonFetch({ meta: {} }) })

    const outcome = await adapter.search({ topic: 'x' })

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.hits).toEqual([])
    expect(outcome.total).toBe(0)
  })
})
