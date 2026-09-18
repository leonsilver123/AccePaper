/**
 * OpenAlexLiteratureAdapter — the real literature-retrieval channel.
 *
 * Offline by construction: `fetchImpl` is injected, so no test here touches the
 * network. What is locked is the adapter's CONTRACT, where the failure branches
 * matter more than the happy path:
 *  - an outage or an HTTP error must resolve to 'unavailable', never to an empty
 *    'ok' (that would read as "no literature exists"), and a 200 whose body is not
 *    a results envelope is that same failure — an unreadable answer is not a
 *    catalogue that holds nothing;
 *  - `venueTierFilter` is refused, not silently ignored;
 *  - catalogue records nothing can name (no id, no title) are skipped rather than
 *    emitted half-formed, while a record the catalogue states no DOI for IS
 *    emitted, under the `unknown` kind carrying the work id OpenAlex minted.
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
    // The year the catalogue states travels with the hit. It did not: the record declared
    // `publication_year` and `toHit` never read it, so every reference the pipeline exported named
    // a venue, authors and a DOI and could not be placed in time.
    expect(outcome.hits[0]!.year).toBe(2020)
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

  it('leaves the year absent when the catalogue does not state a usable one', async () => {
    // A MISSING year is a missing year. Coercing `null`, a range, or a value outside what a
    // citation can carry would replace a visibly incomplete reference with a wrong one, and the
    // reader has no way to tell the difference.
    const adapter = new OpenAlexLiteratureAdapter({
      fetchImpl: jsonFetch({
        meta: { count: 3 },
        results: [
          work({ id: 'https://openalex.org/W1', publication_year: null }),
          work({ id: 'https://openalex.org/W2', publication_year: 'forthcoming' }),
          work({ id: 'https://openalex.org/W3', publication_year: 12020 }),
        ],
      }),
    })

    const outcome = await adapter.search({ topic: 'x' })

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.hits.map(hit => 'year' in hit)).toEqual([false, false, false])
  })

  it('reads a numeric-string year, which some proxies emit', async () => {
    const adapter = new OpenAlexLiteratureAdapter({
      fetchImpl: jsonFetch({ meta: { count: 1 }, results: [work({ publication_year: '2019' })] }),
    })

    const outcome = await adapter.search({ topic: 'x' })

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.hits[0]!.year).toBe(2019)
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

  it('skips records nothing can name', async () => {
    // A RECORD WITH NO ID HAS NO IDENTITY TO RECORD and one with no title can be stated by no
    // citation style, so both are skipped. What is NOT skipped any more is a record with no DOI.
    const adapter = new OpenAlexLiteratureAdapter({
      fetchImpl: jsonFetch({
        meta: { count: 3 },
        results: [
          work({ id: 'https://openalex.org/W1' }),
          work({ id: null }),
          work({ id: 'https://openalex.org/W3', title: null, display_name: null }),
        ],
      }),
    })

    const outcome = await adapter.search({ topic: 'x' })

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.hits.map(hit => hit.id)).toEqual(['W1'])
  })

  it('emits a work the catalogue states no DOI for, under the identity OpenAlex minted', async () => {
    // THE TWO CHANNELS DISAGREED. `LiteratureRefKind` was widened to include `unknown` and the
    // Zotero adapter implemented the fallback; this one still dropped every DOI-less work, so a
    // book, a standard or a report the catalogue holds could never be cited from here. The work id
    // is the identity the SOURCE'S OWN registry minted for it, and it is what this run records.
    const adapter = new OpenAlexLiteratureAdapter({
      fetchImpl: jsonFetch({ meta: { count: 1 }, results: [work({ doi: null })] }),
    })

    const outcome = await adapter.search({ topic: 'x' })

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.hits).toHaveLength(1)
    expect(outcome.hits[0]!.ref).toEqual({
      kind: 'unknown',
      id: 'W123456789',
      title: 'Adaptive traffic signal control with reinforcement learning',
      authors: ['A. Researcher'],
    })
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

  it('refuses a 200 that is not a results envelope instead of reporting no matches', async () => {
    // `payload.results ?? []` read every unreadable 200 as `{ hits: [], total: 0 }`, which the
    // pipeline reads as "the catalogue genuinely holds nothing" — so a proxy rewrite, a rate-limit
    // notice or a schema change arrived as an empty literature rather than as a failure.
    const adapter = new OpenAlexLiteratureAdapter({ fetchImpl: jsonFetch({}) })

    const outcome = await adapter.search({ topic: 'x' })

    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') return
    expect(outcome.detail).toContain('an object with no keys')
    expect(outcome.detail).toContain('NOT a no-match')
  })

  it('refuses a 200 carrying an error notice rather than a results envelope', async () => {
    const adapter = new OpenAlexLiteratureAdapter({
      fetchImpl: jsonFetch({ error: 'too many requests' }),
    })

    const outcome = await adapter.search({ topic: 'x' })

    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') return
    // The refusal NAMES what arrived, so a reader can tell an error body from a schema change.
    expect(outcome.detail).toContain('an object with keys: error')
  })

  it('names what arrived when the body is not an object at all', async () => {
    for (const [body, arrived] of [
      [null, 'null'],
      [[], 'a JSON array'],
      ['<html>maintenance</html>', 'a JSON string'],
    ] as ReadonlyArray<[unknown, string]>) {
      const outcome = await new OpenAlexLiteratureAdapter({ fetchImpl: jsonFetch(body) })
        .search({ topic: 'x' })
      expect(outcome.status).toBe('unavailable')
      if (outcome.status !== 'unavailable') continue
      expect(outcome.detail).toContain(arrived)
    }
  })

  it('refuses an answer carrying only half an envelope, whichever half', async () => {
    // OpenAlex states both halves on every search, so a body carrying one of them is not the
    // catalogue answering this question — and each half is checked on its own rather than by reading
    // whichever one happens to be present.
    for (const body of [{ results: [] }, { results: [], meta: null }, { results: [], meta: 'lots' }]) {
      const outcome = await new OpenAlexLiteratureAdapter({ fetchImpl: jsonFetch(body) })
        .search({ topic: 'x' })
      expect(outcome.status).toBe('unavailable')
    }
  })

  it('keeps a genuine zero-match as an ok with no hits', async () => {
    // THE DISTINCTION THIS RESTS ON: the catalogue answered, and it holds nothing for this topic.
    // That is a fact the run may act on, and it must not be confused with the refusal above.
    const adapter = new OpenAlexLiteratureAdapter({
      fetchImpl: jsonFetch({ meta: { count: 0 }, results: [] }),
    })

    const outcome = await adapter.search({ topic: 'x' })

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.hits).toEqual([])
    expect(outcome.total).toBe(0)
  })

  it('reports what it saw when the envelope states no usable pre-cap count', async () => {
    // `meta.count` is READ, never fabricated: an envelope that carries a meta object without a
    // number in it reports the matches this call actually saw, which is the least it can be wrong by.
    for (const meta of [{}, { count: null }, { count: 'many' }]) {
      const outcome = await new OpenAlexLiteratureAdapter({
        fetchImpl: jsonFetch({ meta, results: [work()] }),
      }).search({ topic: 'x' })
      expect(outcome.status).toBe('ok')
      if (outcome.status !== 'ok') continue
      expect(outcome.total).toBe(1)
    }
  })
})
