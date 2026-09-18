/**
 * The configured collection as the pipeline's corpus, and a page of a source as evidence.
 *
 * THE TWO FACTS THAT MUST NEVER ARRIVE AS ONE VALUE are "the collection holds nothing that matches"
 * and "the library could not be read". The seam has one way to say the second — `unavailable` — and
 * the first is an `ok` with no hits, so every failure below asserts the status it produces rather than
 * a hit count a caller could read as a small corpus.
 *
 * A TOOL'S REPLY IS NOT THE PAPER, and every string the page cases feed the provider below is a reply
 * the real server was measured returning on 2026-09-18, character for character — the header it wraps
 * a page in, the notice it answers when it cannot read PDFs at all, and the out-of-range sentence with
 * the byte-order mark it actually carries. A case built on a hand-written clean reply would pass
 * against a provider that hands the server's prose on as evidence, which is the defect they exist for.
 */
import { createHash } from 'node:crypto'
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

/** One PDF attachment, as the children endpoint returns it. */
function attachment(key: string, version: number): unknown {
  return { key, version, data: { itemType: 'attachment', contentType: 'application/pdf', filename: `${key}.pdf` } }
}

/**
 * A `fetch` that answers each of the three endpoints with the shape that endpoint returns.
 *
 * THE THREE RETURN DIFFERENT SHAPES — a member list, one item, and a child list — and a stand-in that
 * answered them alike would exercise a provider reading an array where a record belongs, which is the
 * opposite of what these cases are for.
 *
 * @param page - the collection body.
 * @param children - the item's attachments; one PDF by default.
 * @returns the fetch function.
 */
function fetchOver(page: string, children: ReadonlyArray<unknown> = [attachment('PU2XWW83', 2690)]): FetchLike {
  const members = JSON.parse(page) as ReadonlyArray<unknown>
  const byKey = new Map(members.map((entry): [string, unknown] => [
    (entry as { readonly key: string }).key, entry,
  ]))
  return (url) => {
    const path = url.split('?')[0] ?? ''
    if (path.endsWith('/children')) {
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(children)) })
    }
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

/** A provider answering one page of records, with no tool registered. */
function providerOver(page: string, children?: ReadonlyArray<unknown>): ZoteroProvider {
  const tools: ZoteroToolPort = { get: () => undefined }
  return new ZoteroProvider({
    apiBase: 'http://127.0.0.1:23119/api',
    localLibraryPath: 'users/0',
    mcpServerName: 'zotero',
    pageSize: 100,
  }, fetchOver(page, children), tools)
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

  it('cites a work that states no DOI, under the namespace the record does establish', async () => {
    // A DOI IS AN EXTERNAL IDENTIFIER, NOT A CONDITION OF CITABILITY. A book states an ISBN.
    const outcome = await adapterOver(record('BOOK0001', { DOI: undefined, ISBN: '978-3-16-148410-0' }))
      .search({ topic: 'take-over control' })
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.hits[0]?.ref.kind).toBe('isbn')
    expect(outcome.hits[0]?.ref.id).toBe('978-3-16-148410-0')
  })

  it('cites a work that states no external identifier at all, by its own identity', async () => {
    // THE CASE THE OLD RULE REFUSED OUTRIGHT. Nothing about this record is less citable than a
    // DOI-bearing one: it is the same library, the same item key, the same identity downstream.
    const outcome = await adapterOver(record('REPORT01', { DOI: undefined, itemType: 'report' }))
      .search({ topic: 'take-over control' })
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.hits[0]?.ref).toEqual({
      kind: 'unknown',
      id: 'zotero:user:1234567:REPORT01',
      title: 'Take-over control in critical brake situations',
      authors: ['Roche, Fabienne'],
    })
  })

  it('reads a preprint\'s arXiv id from the field the item states it in', async () => {
    const outcome = await adapterOver(record('PREPRINT', { DOI: undefined, extra: 'arXiv:2409.06884v1' }))
      .search({ topic: 'take-over control' })
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.hits[0]?.ref.kind).toBe('arxiv')
    expect(outcome.hits[0]?.ref.id).toBe('2409.06884v1')
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

  it('matches a plural topic word against the singular form the title carries', async () => {
    // THE DEFECT: matching was by raw substring, so the topic's plural could never match the title's
    // singular. A collection holding the paper the topic is about read as an empty corpus, and the
    // pipeline had nothing to distinguish that from a collection that holds nothing.
    const outcome = await adapterOver(record('PLATOON1', {
      title: 'A robust platoon control study in mixed traffic flow',
      abstractNote: 'String stability is measured for the platoon.',
    })).search({ topic: 'Platoons in mixed traffic' })
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.hits.map(hit => String(hit.id))).toEqual(['zotero:user:1234567:PLATOON1'])
  })

  it('matches a nominalised topic word against the adjective in the title', async () => {
    // The other shape of the same defect: `robustness` is never a substring of `robust`, and the
    // title states the adjective. The token the rule matches on is the title's OWN word, and the
    // four-character floor is what keeps `plan` from answering `platoons`.
    const outcome = await adapterOver(record('ROBUST01', {
      title: 'Robust platoon control under disturbances',
      abstractNote: 'The controller is evaluated over a range of speeds.',
    })).search({ topic: 'Robustness of platoon control' })
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.hits.map(hit => String(hit.id))).toEqual(['zotero:user:1234567:ROBUST01'])
  })

  it('ranks by how much of the topic an item states, and keeps the weak matches last', async () => {
    // THE CONJUNCTION IS GONE, AND THIS IS WHAT REPLACED IT. A1 passes its topic as a research
    // DIRECTION — a sentence — so requiring every word could only match an item that restated the
    // whole question: measured 2026-09-19, a 27-item collection came back empty for the study it was
    // assembled for. A curated list is answered by relevance instead, which is why the traffic-signal
    // record is INCLUDED here rather than excluded — it states one of the topic's words — and why it
    // comes back last.
    const page = JSON.stringify([
      (JSON.parse(record('SIGNALS1', {
        title: 'Adaptive traffic signal control with reinforcement learning',
        abstractNote: 'A reinforcement learning approach to signal timing at isolated intersections.',
      })) as ReadonlyArray<unknown>)[0],
      (JSON.parse(record('PLATOON1', {
        title: 'Robustness of platoons to mixed-traffic disturbances',
        abstractNote: 'Platoon control under mixed traffic, including disturbances from human drivers.',
      })) as ReadonlyArray<unknown>)[0],
    ])
    const outcome = await adapterOver(page)
      .search({ topic: 'Robustness of platoons to mixed-traffic disturbances' })
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    // The item that states the topic comes first; the one that states a word of it comes last.
    expect(outcome.hits.map(hit => String(hit.id))).toEqual([
      'zotero:user:1234567:PLATOON1',
      'zotero:user:1234567:SIGNALS1',
    ])
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

  it('refuses a corpus item that states no title, naming it and calling the limit its own', async () => {
    // WHAT REPLACED THE NO-DOI REFUSAL ON 2026-09-18. A record with no title cannot be named in a
    // reference list or checked for identity, so the read stops — and the refusal says this is what
    // THIS ADAPTER requires, not a rule about what may be cited. Answering with the rest would be a
    // corpus smaller than the one the deployment named.
    // The topic is matched on the title OR the abstract, so this one names a word only the abstract
    // carries — otherwise the item would be filtered out before the refusal could be about its title.
    const outcome = await adapterOver(record('NOTITLE1', { title: undefined }))
      .search({ topic: 'driving simulator' })
    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') return
    expect(outcome.detail).toContain('NOTITLE1')
    expect(outcome.detail).toContain('not a rule about what may be cited')
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

// ── The page route: measured replies, verbatim ────────────────────────────────────────────────────

/** The header the page tool wraps a single page in, measured 2026-09-18. */
function pageReply(page: number, total: number, body: string): string {
  return `# PDF Pages ${String(page)}-${String(page)} of Take-over control in critical brake situations?\n`
    + '**Item Key:** UA5MIGG3\n'
    + `**Total pages in PDF:** ${String(total)}\n\n`
    + `## Page ${String(page)}\n\n`
    + body
}

/** The notice the tool answered before its PDF extra was installed, verbatim from the live run. */
const PYMUPDF_NOTICE =
  "PyMuPDF is required for PDF page reading. Install it with: pip install 'zotero-mcp-server[pdf]'"
  + " (uv: uv tool install --upgrade 'zotero-mcp-server[pdf]'; pipx: pipx install --force"
  + " 'zotero-mcp-server[pdf]')"

/** The out-of-range sentence, with the byte-order mark the live reply actually carried. */
const OUT_OF_RANGE = `${String.fromCharCode(0xFEFF)}Start page 11 is out of range. PDF has 10 pages (1-10).`

/**
 * A provider whose text tools answer with scripted replies.
 *
 * @param pageReplyText - what the page tool returns.
 * @param fullText - what the full-text tool returns.
 * @param children - the item's attachments.
 * @returns the provider.
 */
function withTools(
  pageReplyText: string,
  fullText = '',
  children?: ReadonlyArray<unknown>,
): ZoteroProvider {
  const tools: ZoteroToolPort = {
    get: (name: string) => {
      if (/zotero_read_pdf_pages$/u.test(name)) {
        return { execute: () => Promise.resolve({ content: [{ type: 'text', text: pageReplyText }] }) }
      }
      if (/zotero_get_item_fulltext$/u.test(name)) {
        return { execute: () => Promise.resolve({ content: [{ type: 'text', text: fullText }] }) }
      }
      return undefined
    },
  }
  return new ZoteroProvider({
    apiBase: 'http://127.0.0.1:23119/api', localLibraryPath: 'users/0', mcpServerName: 'zotero',
  }, fetchOver(record('UA5MIGG3'), children), tools)
}

describe('reading a page of a source', () => {
  const BODY = 'Participants took over control after 1.2 s.\nThe brake situation was critical.'

  it('hands on the page\'s own words with the tool\'s header removed', async () => {
    // THE DEFECT THIS CLOSES: the reply is the server's presentation with the page inside it, and a
    // provider that hashed the reply whole would bind a judgement to the server's header.
    const read = await withTools(pageReply(1, 10, BODY)).readPage('UA5MIGG3', 1)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.passage.text).toBe(BODY)
    expect(read.passage.text).not.toContain('PDF Pages')
    expect(read.passage.text).not.toContain('Item Key')
    expect(read.passage.text).not.toContain('## Page')
    expect(read.passage.contentSha256).toBe(createHash('sha256').update(BODY, 'utf8').digest('hex'))
  })

  it('keeps the whole reply as an audit record beside the evidence text', async () => {
    const reply = pageReply(1, 10, BODY)
    const read = await withTools(reply).readPage('UA5MIGG3', 1)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.passage.audit.raw).toBe(reply)
    expect(read.passage.audit.rawSha256).toBe(createHash('sha256').update(reply, 'utf8').digest('hex'))
    expect(read.passage.audit.rawLength).toBe(reply.length)
    expect(read.passage.audit.classification).toBe('page-text')
    expect(read.passage.audit.tool).toBe('mcp__zotero__zotero_read_pdf_pages')
  })

  it('records the attachment and every version a judgement would depend on', async () => {
    // NONE OF THE THREE IMPLIES THE OTHERS: the item's version moves when its metadata is edited, the
    // attachment's when the FILE is replaced, and the hash when the extracted words change.
    const read = await withTools(pageReply(4, 10, BODY)).readPage('UA5MIGG3', 4)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.passage.itemVersion).toBe(1)
    expect(read.passage.attachment).toEqual({
      key: 'PU2XWW83', version: 2690, filename: 'PU2XWW83.pdf', contentType: 'application/pdf',
    })
    expect(read.passage.page).toBe(4)
    expect(read.passage.totalPages).toBe(10)
    expect(read.passage.where).toContain('page 4 of 10')
    expect(read.passage.where).toContain('PU2XWW83')
    // The locator says what was taken out, so a reader can tell a stripped page from one that began
    // with the tool's header by coincidence.
    expect(read.passage.where).toContain('header removed')
    expect(read.passage.readBy).toBe('mcp-pdf-pages')
    expect(read.passage.literatureId).toBe('zotero:user:1234567:UA5MIGG3')
  })

  it('refuses the tool\'s install notice instead of reading it as a page', async () => {
    // MEASURED, VERBATIM. This reply is non-empty, names the item, and would have entered the
    // evidence chain as page text under any provider that only checked for emptiness.
    const read = await withTools(PYMUPDF_NOTICE).readPage('UA5MIGG3', 1)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('passage-unrecognized')
    expect(read.failure.detail).toContain('PyMuPDF is required')
  })

  it('refuses a page past the end, naming how long the file is', async () => {
    // The leading byte-order mark is part of the measured reply; a parser that did not strip it would
    // report this as an unrecognised reply instead of an out-of-range page.
    const read = await withTools(OUT_OF_RANGE).readPage('UA5MIGG3', 11)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('passage-out-of-range')
    expect(read.failure.detail).toContain('10 page(s)')
  })

  it('refuses a reply whose page marker is not the page that was asked for', async () => {
    const read = await withTools(pageReply(3, 10, BODY)).readPage('UA5MIGG3', 4)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('passage-unrecognized')
    expect(read.failure.detail).toContain('page 4')
  })

  it('refuses a blank page rather than reporting an empty passage', async () => {
    // A page that extracted nothing is a different fact from a page with no text on it, and an empty
    // passage would support no sentence while looking like a reading.
    const read = await withTools(pageReply(2, 10, '   \n  ')).readPage('UA5MIGG3', 2)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('passage-unreadable')
  })

  it('refuses when two PDFs could have answered, because which one did is not establishable', async () => {
    // THE TOOL TAKES THE ITEM AND PICKS THE FILE. Binding a judgement's invalidation to a guessed
    // attachment would be worse than refusing, because the guess looks like a fact.
    const read = await withTools(pageReply(1, 10, BODY), '', [
      attachment('PU2XWW83', 2690), attachment('SUPP0001', 42),
    ]).readPage('UA5MIGG3', 1)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('passage-unattributable')
    expect(read.failure.detail).toContain('PU2XWW83')
    expect(read.failure.detail).toContain('SUPP0001')
  })

  it('refuses an item that has no PDF at all', async () => {
    const read = await withTools(pageReply(1, 10, BODY), '', []).readPage('UA5MIGG3', 1)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('passage-unreadable')
    expect(read.failure.detail).toContain('no PDF attachment')
  })

  it('names the missing tool when the deployment registers no page tool', async () => {
    const read = await providerOver(record('UA5MIGG3')).readPage('UA5MIGG3', 2)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('metadata-tool-missing')
    expect(read.failure.detail).toContain('zotero_read_pdf_pages')
  })
})

describe('reading a whole source, which is navigation and not evidence', () => {
  /** The full-text reply's opening, measured 2026-09-18. */
  const RENDERING = '*Response size: ~16K tokens. Consider using zotero_semantic_search to find'
    + ' specific content instead of reading full papers.*\n\n'
    + '# What happens when drivers of automated vehicles take over control in critical brake'
    + ' situations?\n\n**Type:** journalArticle\n\n**Item Key:** UA5MIGG3\n\n**DOI:**'
    + ' 10.1016/j.aap.2020.105588\n\nContents lists available at ScienceDirect\n'

  it('returns the tool\'s rendering with a type that cannot be quoted or cited', async () => {
    // THE RESTRICTION IS STRUCTURAL, NOT A COMMENT. The guidance's rule for a reply that cannot be
    // separated from the tool's own composition is to keep it for retrieval and navigation; this
    // value has no page, no content hash, and a field stating what it may not be used for, so nothing
    // that takes evidence can accept it by accident.
    const read = await withTools('', RENDERING).readFullText('UA5MIGG3')
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.navigation.rendering).toBe(RENDERING)
    expect(read.navigation.rendering).toContain('**Item Key:**')
    expect(read.navigation.notEvidence).toContain('may not be quoted or cited')
    expect(read.navigation.readBy).toBe('mcp-fulltext')
    expect(read.navigation.audit.classification).toBe('full-text-rendering')
    expect('contentSha256' in read.navigation).toBe(false)
    expect('page' in read.navigation).toBe(false)
  })
})
