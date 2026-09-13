/**
 * OpenAlexCitationResolver — the real bibliographic resolver.
 *
 * Offline by construction (`fetchImpl` injected). The status mapping is the whole
 * point of this adapter, and two of the four branches carry scientific weight:
 *  - a 404 must become 'not_found' (the core turns that into a hard block for
 *    fabricated literature), and
 *  - a service fault must become 'temporarily_unavailable', NEVER 'not_found', so an
 *    outage can never be misread as a fabricated citation.
 */

import { describe, expect, it } from 'vitest'
import type { CitationRef } from '@deepseek-ai/dsh-research-core'
import { OpenAlexCitationResolver } from '../src/openalex-citation-resolver.ts'

function ref(kind: CitationRef['kind'], id: string): CitationRef {
  return { kind, id }
}

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })) as unknown as typeof fetch
}

function doiRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Multi-Agent Deep Reinforcement Learning for Traffic Signal Control',
    is_retracted: false,
    authorships: [
      { author: { display_name: 'A. Researcher' } },
      { author: { display_name: 'B. Coauthor' } },
    ],
    ...overrides,
  }
}

describe('OpenAlexCitationResolver', () => {
  it('resolves a real record into catalogue metadata', async () => {
    const resolver = new OpenAlexCitationResolver({ fetchImpl: jsonFetch(doiRecord()) })

    const outcome = await resolver.resolveMetadata(ref('doi', '10.1109/tits.2019.2901791'))

    expect(outcome.status).toBe('resolved')
    if (outcome.status !== 'resolved') return
    expect(outcome.metadata.title).toContain('Traffic Signal Control')
    expect(outcome.metadata.authors).toEqual(['A. Researcher', 'B. Coauthor'])
    expect(outcome.metadata.retracted).toBe(false)
    expect(outcome.metadata.ruleVersion.length).toBeGreaterThan(0)
  })

  it("carries the catalogue's own retraction flag through", async () => {
    const resolver = new OpenAlexCitationResolver({
      fetchImpl: jsonFetch(doiRecord({ is_retracted: true })),
    })

    const outcome = await resolver.resolveMetadata(ref('doi', '10.1000/retracted'))

    expect(outcome.status).toBe('resolved')
    if (outcome.status !== 'resolved') return
    expect(outcome.metadata.retracted).toBe(true)
  })

  it("maps an authoritative 404 to 'not_found' (the fabricated-literature signal)", async () => {
    const resolver = new OpenAlexCitationResolver({
      fetchImpl: (async () => new Response('', { status: 404 })) as unknown as typeof fetch,
    })

    const outcome = await resolver.resolveMetadata(ref('doi', '10.9999/not-real'))

    expect(outcome.status).toBe('not_found')
  })

  it("maps a service fault to 'temporarily_unavailable', never to 'not_found'", async () => {
    const resolver = new OpenAlexCitationResolver({
      fetchImpl: jsonFetch({ error: 'rate limited' }, 429),
    })

    const outcome = await resolver.resolveMetadata(ref('doi', '10.1000/real'))

    expect(outcome.status).toBe('temporarily_unavailable')
    if (outcome.status !== 'temporarily_unavailable') return
    expect(outcome.detail).toContain('429')
  })

  it('maps a transport failure to unavailable and does not throw', async () => {
    const resolver = new OpenAlexCitationResolver({
      fetchImpl: (async () => { throw new Error('socket hang up') }) as unknown as typeof fetch,
    })

    const outcome = await resolver.resolveMetadata(ref('doi', '10.1000/real'))

    expect(outcome.status).toBe('temporarily_unavailable')
  })

  it('refuses non-DOI identifiers without claiming they are missing', async () => {
    const resolver = new OpenAlexCitationResolver({ fetchImpl: jsonFetch(doiRecord()) })

    const outcome = await resolver.resolveMetadata(ref('arxiv', '2499.00001'))

    // Unknown is not a verdict: reporting a miss this adapter never established
    // would surface downstream as fabricated literature.
    expect(outcome.status).toBe('temporarily_unavailable')
  })

  it('treats a titleless record as unresolvable rather than resolved', async () => {
    const resolver = new OpenAlexCitationResolver({
      fetchImpl: jsonFetch(doiRecord({ title: null, display_name: null })),
    })

    const outcome = await resolver.resolveMetadata(ref('doi', '10.1000/titleless'))

    expect(outcome.status).toBe('temporarily_unavailable')
  })
})
