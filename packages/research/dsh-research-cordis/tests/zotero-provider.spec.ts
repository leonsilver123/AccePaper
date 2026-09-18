/**
 * One Zotero provider, two local routes, and the states that must not be confused.
 *
 * THE CASES THE GUIDANCE NAMES, each as a refusal rather than a shape: a collection read across pages
 * is complete or it is TRUNCATED — never a short list handed on as the corpus; a genuinely empty
 * collection is a normal result and not an error; the same item key in two libraries is two sources;
 * an item edited between the JSON read and the BibTeX read is not recorded as one version; and a
 * deployment without the metadata tool says so instead of inventing an entry.
 *
 * NOTHING HERE TALKS TO ZOTERO. The live read was measured separately (27 items in `ILFASAAE`,
 * `UA5MIGG3`'s BibTeX through the product's MCP client); what these cases hold is the provider's own
 * behaviour, which is where the confusions would live.
 */
import { describe, expect, it } from 'vitest'
import { ZoteroProvider } from '../src/zotero-provider.ts'
import type { FetchLike, ZoteroItemRecord, ZoteroToolPort } from '../src/zotero-provider.ts'

/** One item record, as the local API returns it. */
function record(key: string, version: number, overrides: Partial<ZoteroItemRecord['data']> = {}): ZoteroItemRecord {
  return {
    key,
    version,
    library: { type: 'user', id: '1234567', name: 'My Library' },
    data: {
      itemType: 'journalArticle',
      title: 'What happens when drivers of automated vehicles take over control in critical brake situations?',
      DOI: '10.1016/j.aap.2020.105588',
      date: '2020-09',
      ...overrides,
    },
  }
}

/** The entry the MCP tool returns for that item, as measured on 2026-09-18. */
const BIBTEX = String.raw`@article{rocheWhatHappensWhen2020,
  title = {What Happens When Drivers of Automated Vehicles Take over Control in Critical Brake Situations?},
  author = {Roche, Fabienne and Th{\"u}ring, Manfred and Trukenbrod, Anna K.},
  year = 2020,
  journal = {Accident Analysis and Prevention},
  volume = {144}, pages = {105588},
  doi = {10.1016/j.aap.2020.105588},
}`

/**
 * A `fetch` that answers from a script, one page at a time.
 *
 * @param pages - the bodies to answer with, in order; a page that throws is a read that failed.
 * @param onUrl - called with each URL, so a case can assert what was asked for.
 * @returns the fetch function.
 */
function scriptedFetch(
  pages: ReadonlyArray<string | Error>,
  onUrl: (url: string) => void = () => {},
): FetchLike {
  let index = 0
  return (url) => {
    onUrl(url)
    const page = pages[Math.min(index, pages.length - 1)]
    index += 1
    if (page instanceof Error) return Promise.reject(page)
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(page ?? '[]') })
  }
}

/** A tool registry holding the metadata tool, answering with a scripted text. */
function toolPort(answer: () => Promise<unknown> | string = () => BIBTEX): ZoteroToolPort {
  return {
    get: (name: string) => name === 'mcp__zotero__zotero_get_item_metadata'
      ? { execute: () => Promise.resolve(typeof answer === 'function' ? answer() : answer).then(text => ({ content: [{ type: 'text', text }] })) }
      : undefined,
  }
}

/** A provider over a scripted route. */
function provider(options: {
  readonly pages: ReadonlyArray<string | Error>
  readonly tools?: ZoteroToolPort
  readonly pageSize?: number
  readonly onUrl?: (url: string) => void
}): ZoteroProvider {
  return new ZoteroProvider({
    apiBase: 'http://127.0.0.1:23119/api',
    localLibraryPath: 'users/0',
    mcpServerName: 'zotero',
    pageSize: options.pageSize ?? 2,
  }, scriptedFetch(options.pages, options.onUrl ?? (() => {})), options.tools ?? toolPort())
}

describe('reading a collection', () => {
  it('follows the pages to a short one, and reports what it took', async () => {
    // A FULL PAGE IS NOT THE END. The API says there is no more by answering with fewer items than
    // were asked for; anything else is a guess, and a guess here is a bibliography that stops early.
    const urls: string[] = []
    const read = await provider({
      pageSize: 2,
      onUrl: url => urls.push(url),
      pages: [
        JSON.stringify([record('K1', 1), record('K2', 1)]),
        JSON.stringify([record('K3', 1)]),
      ],
    }).readCollection('ILFASAAE')
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.collection.keys).toEqual(['K1', 'K2', 'K3'])
    expect(read.collection.pagesRead).toBe(2)
    expect(read.collection.complete).toBe(true)
    // THE CURSOR MOVES and the page size is the configured one, not whatever the server defaults to.
    expect(urls[1]).toContain('start=2')
    expect(urls[0]).toContain('limit=2')
  })

  it('treats an empty collection as a normal result', async () => {
    const read = await provider({ pageSize: 2, pages: ['[]'] }).readCollection('EMPTY')
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.collection.keys).toEqual([])
    expect(read.collection.complete).toBe(true)
  })

  it('refuses to call a truncated read a collection', async () => {
    // THE CONFUSION THIS EXISTS FOR: a page that did not arrive leaves the rest unknown, and an empty
    // list and an unreachable library must not arrive as the same value.
    const read = await provider({
      pageSize: 2,
      pages: [JSON.stringify([record('K1', 1), record('K2', 1)]), new Error('connect ECONNREFUSED')],
    }).readCollection('ILFASAAE')
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('collection-truncated')
    expect(read.failure.detail).toContain('ECONNREFUSED')
    expect(read.failure.detail).toContain('are not the collection')
  })

  it('refuses a collection endpoint that answered something else', async () => {
    const read = await provider({ pages: ['{"error":"not found"}'] }).readCollection('NOPE')
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('endpoint-unreadable')
  })
})

describe('reading one source', () => {
  it('records the library the API returned, not the local alias it was reached through', async () => {
    // `users/0` IS THE SAME STRING ON EVERY MACHINE and names a different library on each. The record
    // keeps the library object the API answered with, so two machines cannot mint one source.
    const read = await provider({
      pages: [JSON.stringify(record('UA5MIGG3', 42))],
    }).readSource('UA5MIGG3', 'rocheWhatHappensWhen2020')
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.source.library).toEqual({ type: 'user', id: '1234567', name: 'My Library' })
    expect(read.source.version).toBe(42)
    expect(read.source.literatureId).toBe('zotero:user:1234567:UA5MIGG3')
    expect(read.source.readBy).toEqual({ metadata: 'local-api-json', bibliography: 'mcp-bibtex' })
    expect(read.source.citation.authors).toContain('Thüring, Manfred')
  })

  it('refuses when the library moved between the metadata read and the entry', async () => {
    // TWO REVISIONS ARE NOT A SNAPSHOT. Every attempt sees the item at a different version, so the
    // pair (metadata, entry) never describes one moment and the read is refused rather than recorded.
    let version = 1
    const fetchImpl: FetchLike = () => {
      version += 1
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(record('UA5MIGG3', version))),
      })
    }
    const read = await new ZoteroProvider({
      apiBase: 'http://127.0.0.1:23119/api', localLibraryPath: 'users/0', mcpServerName: 'zotero',
    }, fetchImpl, toolPort()).readSource('UA5MIGG3', 'rocheWhatHappensWhen2020')
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('version-moved')
  })

  it('accepts a source whose version is stable across the reads', async () => {
    const read = await provider({ pages: [JSON.stringify(record('UA5MIGG3', 7))] })
      .readSource('UA5MIGG3', 'rocheWhatHappensWhen2020')
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.source.version).toBe(7)
  })

  it('refuses an entry whose DOI is not the item\'s', async () => {
    // THE SUBSTANTIVE CONFLICT THE GUIDANCE NAMES. Both reads succeeded; they disagree about which
    // paper this is, and that is not something to reconcile by preferring one.
    const wrong = BIBTEX.replace('10.1016/j.aap.2020.105588', '10.1016/j.aap.2020.105999')
    const read = await provider({
      pages: [JSON.stringify(record('UA5MIGG3', 3))],
      tools: toolPort(() => wrong),
    }).readSource('UA5MIGG3', 'rocheWhatHappensWhen2020')
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('bibtex-refused')
    expect(read.failure.refusals?.map(r => r.code)).toContain('bibtex-doi-mismatch')
  })

  it('says so when the deployment registers no metadata tool', async () => {
    // NO FALLBACK TO THE ITEM'S OWN FIELDS. An entry this provider assembled from `data` would be
    // presented as Zotero's, and nothing would record that no generator ever ran.
    const read = await provider({
      pages: [JSON.stringify(record('UA5MIGG3', 3))],
      tools: { get: () => undefined },
    }).readSource('UA5MIGG3', 'rocheWhatHappensWhen2020')
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('metadata-tool-missing')
    expect(read.failure.detail).toContain('mcp__zotero__zotero_get_item_metadata')
  })

  it('records a tool that failed as a failure, not as an entry', async () => {
    const read = await provider({
      pages: [JSON.stringify(record('UA5MIGG3', 3))],
      tools: toolPort(() => 'Error exporting bibliography: requires the web API CSL engine.'),
    }).readSource('UA5MIGG3', 'rocheWhatHappensWhen2020')
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('bibtex-refused')
    expect(read.failure.refusals?.[0]?.code).toBe('bibtex-unparseable')
  })
})

describe('two libraries, one item key', () => {
  it('does not fuse them into one source', async () => {
    // THE COLLISION: two libraries can each hold an item keyed `UA5MIGG3`, and an identity minted from
    // the key alone would make them the same paper. The library the API returned is part of the id.
    const mine = await provider({ pages: [JSON.stringify(record('UA5MIGG3', 1))] })
      .readSource('UA5MIGG3', 'rocheWhatHappensWhen2020')
    const theirs = await new ZoteroProvider({
      apiBase: 'http://127.0.0.1:23119/api', localLibraryPath: 'groups/999', mcpServerName: 'zotero',
    }, scriptedFetch([JSON.stringify({
      ...record('UA5MIGG3', 1),
      library: { type: 'group', id: '999', name: 'A shared group' },
    })]), toolPort(() => BIBTEX.replace('rocheWhatHappensWhen2020', 'keyA')))
      .readSource('UA5MIGG3', 'keyA')
    expect(mine.ok && theirs.ok).toBe(true)
    if (!mine.ok || !theirs.ok) return
    expect(mine.source.literatureId).not.toBe(theirs.source.literatureId)
  })

  it('keeps the source identity when the run renames the citation key', async () => {
    // A RENAMED KEY IS NOT A DIFFERENT SOURCE. The key is what the manuscript prints; the identity is
    // where the paper came from, and the two move independently.
    const first = await provider({ pages: [JSON.stringify(record('UA5MIGG3', 1))] })
      .readSource('UA5MIGG3', 'rocheWhatHappensWhen2020')
    const renamed = await provider({
      pages: [JSON.stringify(record('UA5MIGG3', 1))],
      tools: toolPort(() => BIBTEX.replace('rocheWhatHappensWhen2020', 'roche2020takeover')),
    }).readSource('UA5MIGG3', 'roche2020takeover')
    expect(first.ok && renamed.ok).toBe(true)
    if (!first.ok || !renamed.ok) return
    expect(renamed.source.literatureId).toBe(first.source.literatureId)
    expect(renamed.source.citation.citationKey).toBe('roche2020takeover')
  })
})
