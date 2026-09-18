/**
 * The configured collection as the pipeline's corpus: what A1 receives, and what it refuses.
 *
 * THE TWO FACTS THAT MUST NEVER ARRIVE AS ONE VALUE are "the collection holds nothing that matches"
 * and "the library could not be read". The seam has one way to say the second — `unavailable` — and
 * the first is an `ok` with no hits, so every failure below asserts the status it produces rather than
 * a hit count a caller could read as a small corpus.
 *
 * AND AN ITEM THAT CANNOT BE CITED STOPS THE READ. A curated collection is a list somebody assembled;
 * an item in it with no DOI cannot enter the citation identity chain, and answering with the rest
 * would be a corpus quietly smaller than the one the deployment named.
 */
import { describe, expect, it } from 'vitest'
import { ZoteroProvider } from '../src/zotero-provider.ts'
import { ZoteroLiteratureAdapter } from '../src/zotero-literature-adapter.ts'
import type { FetchLike, ZoteroToolPort } from '../src/zotero-provider.ts'

/** One item, as the local API returns it. */
function record(key: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify([{
    key,
    version: 1,
    library: { type: 'user', id: '1234567', name: 'My Library' },
    data: {
      itemType: 'journalArticle',
      title: 'Take-over control in critical brake situations',
      DOI: '10.1016/j.aap.2020.105588',
      date: '2020-09',
      publicationTitle: 'Accident Analysis and Prevention',
      abstractNote: 'A driving simulator study of take-over behaviour.',
      creators: [{ lastName: 'Roche', firstName: 'Fabienne' }],
      ...overrides,
    },
  }])
}

/**
 * A `fetch` that answers the collection URL with a page and an item URL with one record.
 *
 * THE TWO ENDPOINTS RETURN DIFFERENT SHAPES — a member list and one item — and a stand-in that
 * answered both with the same body would exercise a provider reading an array where a record belongs,
 * which is the opposite of what these cases are for.
 *
 * @param page - the collection body.
 * @returns the fetch function.
 */
function fetchOver(page: string): FetchLike {
  const members = JSON.parse(page) as ReadonlyArray<unknown>
  const byKey = new Map(members.map((entry): [string, unknown] => [
    (entry as { readonly key: string }).key, entry,
  ]))
  return (url) => {
    const path = url.split('?')[0] ?? ''
    const itemKey = /\/items\/([A-Z0-9]+)$/u.exec(path)?.[1]
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(
        itemKey === undefined ? page : JSON.stringify(byKey.get(itemKey) ?? {}),
      ),
    })
  }
}

/** A provider answering one page of records, with no metadata tool registered. */
function providerOver(page: string): ZoteroProvider {
  const tools: ZoteroToolPort = { get: () => undefined }
  return new ZoteroProvider({
    apiBase: 'http://127.0.0.1:23119/api',
    localLibraryPath: 'users/0',
    mcpServerName: 'zotero',
    pageSize: 100,
  }, fetchOver(page), tools)
}

/** The adapter over one page of the collection. */
function adapterOver(page: string): ZoteroLiteratureAdapter {
  return new ZoteroLiteratureAdapter(providerOver(page), { collectionKey: 'ILFASAAE' })
}

describe('a collection read as the corpus', () => {
  it('answers with the collection\'s items, carrying their identity', async () => {
    const outcome = await adapterOver(record('UA5MIGG3')).search({ topic: 'take-over control' })
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.total).toBe(1)
    expect(outcome.hits).toHaveLength(1)
    const hit = outcome.hits[0]
    // THE ID IS THE SOURCE'S INTERNAL IDENTITY, not a per-query ordinal: the same paper read again in
    // another run has to be recognisable as the same paper.
    expect(String(hit?.id)).toBe('zotero:user:1234567:UA5MIGG3')
    expect(hit?.title).toBe('Take-over control in critical brake situations')
    expect(hit?.venue).toBe('Accident Analysis and Prevention')
    expect(hit?.year).toBe(2020)
    expect(hit?.ref).toEqual({
      kind: 'doi',
      id: '10.1016/j.aap.2020.105588',
      title: 'Take-over control in critical brake situations',
      authors: ['Roche, Fabienne'],
    })
  })

  it('totals what matched before the cap, so a capped answer reads as capped', async () => {
    // `total > hits.length` is how this seam says "more were available"; a cap that also lowered the
    // total would make a truncated corpus look like a small one.
    const page = JSON.stringify(JSON.parse(`[${record('K1').slice(1, -1)},${record('K2').slice(1, -1)}]`))
    const outcome = await adapterOver(page).search({ topic: 'take-over control', maxResults: 1 })
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.hits).toHaveLength(1)
    expect(outcome.total).toBe(2)
  })

  it('reports a library that could not be read as unavailable, not as an empty corpus', async () => {
    const failing: FetchLike = () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:23119'))
    const provider = new ZoteroProvider({
      apiBase: 'http://127.0.0.1:23119/api', localLibraryPath: 'users/0', mcpServerName: 'zotero',
    }, failing, { get: () => undefined })
    const outcome = await new ZoteroLiteratureAdapter(provider, { collectionKey: 'ILFASAAE' })
      .search({ topic: 'anything' })
    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') return
    expect(outcome.detail).toContain('endpoint-unreadable')
    expect(outcome.detail).toContain('ECONNREFUSED')
  })

  it('reports a truncated collection as unavailable rather than answering from what it read', async () => {
    let call = 0
    const fetchImpl: FetchLike = () => {
      call += 1
      if (call === 1) {
        return Promise.resolve({
          ok: true, status: 200, text: () => Promise.resolve(
            JSON.stringify(Array.from({ length: 100 }, (_, i) =>
              (JSON.parse(record(`K${String(i)}`)) as ReadonlyArray<unknown>)[0]))),
        })
      }
      return Promise.reject(new Error('the connection dropped'))
    }
    const provider = new ZoteroProvider({
      apiBase: 'http://127.0.0.1:23119/api', localLibraryPath: 'users/0', mcpServerName: 'zotero',
      pageSize: 100,
    }, fetchImpl, { get: () => undefined })
    const outcome = await new ZoteroLiteratureAdapter(provider, { collectionKey: 'ILFASAAE' })
      .search({ topic: 'anything' })
    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') return
    expect(outcome.detail).toContain('collection-truncated')
    expect(outcome.detail).toContain('not the collection')
  })

  it('refuses a corpus item that cannot be cited, naming it', async () => {
    // NO DOI, NO IDENTITY CHAIN. Answering with the rest would be a corpus smaller than the one the
    // deployment named, and nothing downstream could tell that an item had been left out.
    const outcome = await adapterOver(record('NODOI', { DOI: undefined }))
      .search({ topic: 'take-over control' })
    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') return
    expect(outcome.detail).toContain('NODOI')
    expect(outcome.detail).toContain('cannot enter the citation identity chain')
  })

  it('refuses a venue-tier filter, which a curated collection cannot answer', async () => {
    const outcome = await adapterOver(record('UA5MIGG3'))
      .search({ topic: 'take-over control', venueTierFilter: 'tier1' })
    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') return
    expect(outcome.detail).toContain('venueTierFilter')
  })

  it('answers an empty collection as an ok with no hits', async () => {
    // THE OTHER SIDE OF THE SAME DISTINCTION: a collection that holds nothing is a fact the pipeline
    // may act on, and it is not an outage.
    const outcome = await adapterOver('[]').search({ topic: 'take-over control' })
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.hits).toEqual([])
    expect(outcome.total).toBe(0)
  })
})

describe('reading a source\'s text', () => {
  /** A provider whose metadata tool answers with the text the caller supplies. */
  function withText(text: string): ZoteroProvider {
    const fetchImpl = fetchOver(record('UA5MIGG3'))
    const tools: ZoteroToolPort = {
      get: (name: string) => /zotero_(get_item_fulltext|read_pdf_pages)$/u.test(name)
        ? { execute: () => Promise.resolve({ content: [{ type: 'text', text }] }) }
        : undefined,
    }
    return new ZoteroProvider({
      apiBase: 'http://127.0.0.1:23119/api', localLibraryPath: 'users/0', mcpServerName: 'zotero',
    }, fetchImpl, tools)
  }

  it('records where the text came from and its version', async () => {
    // THE LOCATION IS PART OF THE EVIDENCE: a quote that cannot be traced to a place in an attachment
    // is a sentence somebody typed, and the hash is what makes a later edit to the file invalidate a
    // judgement made from it.
    const read = await withText('Participants took over control after 1.2 s.').readPassage('UA5MIGG3')
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.passage.itemKey).toBe('UA5MIGG3')
    expect(read.passage.literatureId).toBe('zotero:user:1234567:UA5MIGG3')
    expect(read.passage.where).toContain('whole text')
    expect(read.passage.readBy).toBe('mcp-fulltext')
    expect(read.passage.contentSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(read.passage.text).toContain('1.2 s')
  })

  it('names the page when one page was asked for', async () => {
    const read = await withText('page four text').readPassage('UA5MIGG3', { page: 4 })
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.passage.where).toBe('page 4')
    expect(read.passage.readBy).toBe('mcp-pdf-pages')
  })

  it('refuses an empty read rather than reporting an empty passage', async () => {
    // A TOOL THAT ANSWERED NOTHING IS NOT A SOURCE WITH NO TEXT. No attachment, a page past the end
    // and a failed extraction all arrive as nothing readable, and a passage of length zero entering
    // the evidence chain would support no sentence while looking like a reading.
    const read = await withText('   ').readPassage('UA5MIGG3')
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('passage-unreadable')
  })

  it('reports a tool that failed with its own reason', async () => {
    const fetchImpl = fetchOver(record('UA5MIGG3'))
    const tools: ZoteroToolPort = {
      get: (name: string) => /zotero_get_item_fulltext$/u.test(name)
        ? { execute: () => Promise.reject(new Error('no PDF attachment found for this item')) }
        : undefined,
    }
    const provider = new ZoteroProvider({
      apiBase: 'http://127.0.0.1:23119/api', localLibraryPath: 'users/0', mcpServerName: 'zotero',
    }, fetchImpl, tools)
    const read = await provider.readPassage('UA5MIGG3')
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('passage-unreadable')
    expect(read.failure.detail).toContain('no PDF attachment')
  })

  it('names the missing tool when the deployment registers no text tool', async () => {
    const read = await providerOver(record('UA5MIGG3')).readPassage('UA5MIGG3', { page: 2 })
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('metadata-tool-missing')
    expect(read.failure.detail).toContain('zotero_read_pdf_pages')
  })
})
