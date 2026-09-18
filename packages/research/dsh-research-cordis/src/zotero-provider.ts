// @deepseek-ai/dsh-research-cordis — one provider for a Zotero library, read over two local routes.
//
// WHY TWO ROUTES AND ONE PROVIDER. The collection's membership is structured JSON and the local HTTP
// API answers it directly; the bibliographic entry a package carries is BibTeX, and the MCP tool
// produces it. Reaching for one transport for both would mean parsing Markdown that a server wrote
// FOR A MODEL — a format with no contract, whose shape is a display decision — which is how a
// bibliography acquires an item called `**Item Key:**`. So the provider reads each thing the way it
// is available and presents ONE ledger: the same source identity, the same version check, the same
// refusals, whichever route answered.
//
// WHAT THE DEPLOYMENT FIXES AND WHAT A CALLER MAY NOT. The endpoint and the library are configuration,
// never arguments: a caller that could name a URL would be able to point this at anything the host can
// reach, and the read is meant to be one known local library. The request shape is a collection key
// and a page cursor, both of which the deployment's own configuration bounds.
//
// `users/0` IS A LOCAL ALIAS, NOT AN IDENTITY. The Zotero local API addresses the signed-in user's
// library as `users/0`, and `0` means "whoever is running this" — it is the same string on every
// machine and names a different library on each. The identity this module records therefore comes
// from the library object the API RETURNS for an item, and the configured alias is only how the
// endpoint is addressed locally.
//
// A COLLECTION READ IS COMPLETE OR IT IS NOT A COLLECTION. Pages are followed until the API reports
// no more, and the result says how many pages were read and whether the last one was full. A read
// that stopped early — a page that failed, a bound that was reached — is reported as TRUNCATED rather
// than handed on as the corpus, because a bibliography missing entries looks exactly like a corpus
// that never had them. An empty collection is a normal result and a different one.
//
// AND A SOURCE IS READ AT ONE VERSION OR NOT AT ALL. The JSON metadata carries the item's `version`,
// and the BibTeX is generated from whatever the library held when that call ran; an item edited
// between the two reads would otherwise be recorded as a mixture of two revisions. The chain re-reads
// a bounded number of times and then refuses, rather than claiming a snapshot it does not have.

import { createHash } from 'node:crypto'

import { checkBibtexEntry, literatureIdOf } from './zotero-bibliography.ts'
import type {
  BibtexRefusal, LiteratureId, ParsedCitation, ZoteroItemFacts,
} from './zotero-bibliography.ts'

/** Where this deployment's Zotero is, and which library it may read. */
export interface ZoteroProviderConfig {
  /**
   * The local API's origin, e.g. `http://127.0.0.1:23119/api`.
   *
   * A DEPLOYMENT SETTING, never a request parameter: a caller that could name it would be able to
   * aim this provider at any address the host can reach.
   */
  readonly apiBase: string
  /**
   * The library as the LOCAL ENDPOINT addresses it — `users/0` for the signed-in user.
   *
   * HOW THE ENDPOINT IS ADDRESSED, not who the library is; see {@link ZoteroLibraryRef}.
   */
  readonly localLibraryPath: string
  /** The MCP client's namespace for the Zotero server, e.g. `zotero`. */
  readonly mcpServerName: string
  /** Per-request timeout in milliseconds. */
  readonly timeoutMs?: number
  /** How many items one page asks for. */
  readonly pageSize?: number
}

/** The default time one request may take. */
const DEFAULT_TIMEOUT_MS = 30_000

/** The default page size; the API accepts up to 100. */
const DEFAULT_PAGE_SIZE = 100

/** How many times a source is re-read when the library moved under it. */
const REREAD_ATTEMPTS = 3

/**
 * The library an item belongs to, as the API reports it.
 *
 * THE RETURNED OBJECT IS THE IDENTITY, not the address that was used to reach it: `users/0` is the
 * same string everywhere and names a different library on each machine, so a record keyed by it would
 * say nothing about which library a source came from.
 */
export interface ZoteroLibraryRef {
  readonly type: string
  readonly id: string
  readonly name?: string
}

/** One item's JSON metadata, as the local API returns it. */
export interface ZoteroItemRecord {
  readonly key: string
  /** The library's own version counter for this item; it moves when the item is edited. */
  readonly version: number
  readonly library: ZoteroLibraryRef
  readonly data: {
    readonly itemType?: string
    readonly title?: string
    readonly DOI?: string
    readonly date?: string
    readonly publicationTitle?: string
    readonly volume?: string
    readonly pages?: string
    /** The item's abstract, when it has one; the corpus filter reads it and nothing else does. */
    readonly abstractNote?: string
    readonly creators?: ReadonlyArray<{
      readonly creatorType?: string
      readonly lastName?: string
      readonly firstName?: string
      /** Present instead of the two above for an institutional creator. */
      readonly name?: string
    }>
  }
}

/** Why a read did not produce what it was asked for. */
export type ZoteroReadFailureCode =
  /** The configured endpoint did not answer, or answered with a status the read does not accept. */
  | 'endpoint-unreadable'
  /** A page of the collection did not arrive, so the membership is unknown rather than empty. */
  | 'collection-truncated'
  /** The MCP server's metadata tool is not registered on this deployment. */
  | 'metadata-tool-missing'
  /** The tool answered, and what it returned is not an entry this provider accepts. */
  | 'bibtex-refused'
  /** The item moved between two reads and stayed moved. */
  | 'version-moved'
  /** The text tool answered nothing: no attachment, a page past the end, or a read that failed. */
  | 'passage-unreadable'

/** One refusal, naming what failed and where. */
export interface ZoteroReadFailure {
  readonly code: ZoteroReadFailureCode
  readonly detail: string
  /** The bibliographic disagreements, when the failure is a refused entry. */
  readonly refusals?: ReadonlyArray<BibtexRefusal>
}

/** A collection's membership, with what it took to read it. */
export interface ZoteroCollection {
  readonly keys: ReadonlyArray<string>
  /** How many items the API reported for the collection. */
  readonly reported: number
  readonly pagesRead: number
  /**
   * Whether the read followed the collection to its end.
   *
   * FALSE IS NOT AN EMPTY COLLECTION. A read that stopped early knows nothing about the items it did
   * not reach, and the two states must not arrive as the same value.
   */
  readonly complete: boolean
}

/** One source, as this provider read it. */
export interface ZoteroSource {
  readonly library: ZoteroLibraryRef
  readonly itemKey: string
  readonly literatureId: LiteratureId
  /** The library's version for this item, at the read that produced this record. */
  readonly version: number
  readonly citation: ParsedCitation
  /** How each part was read, so a reader can tell which route answered. */
  readonly readBy: { readonly metadata: 'local-api-json'; readonly bibliography: 'mcp-bibtex' }
}

/**
 * A passage of a source's full text, with where it was read and what version it is.
 *
 * THE LOCATION IS PART OF THE EVIDENCE. A quote that cannot be traced to an attachment and a place
 * in it is a sentence somebody typed; `where` names the attachment and the page or span the text came
 * from, and `contentSha256` is the version of THAT text, so a later edit to the file invalidates a
 * judgement made from it exactly as a rewritten manuscript sentence invalidates its citation.
 */
export interface ZoteroPassage {
  readonly literatureId: LiteratureId
  readonly itemKey: string
  /** The attachment the text was read from, as Zotero keys it. */
  readonly attachmentKey?: string
  /** Where in the source the text is, in the words the read tool used. */
  readonly where: string
  readonly text: string
  /** SHA-256 of `text`, as read. */
  readonly contentSha256: string
  /** How it was read, so a reader can tell a full text from a page. */
  readonly readBy: 'mcp-fulltext' | 'mcp-pdf-pages'
}

/** How much of a source to read. */
export interface PassageRequest {
  /** A 1-indexed page, when one page is wanted rather than the whole text. */
  readonly page?: number
}

/** A candidate from the configured collection, as the roster read it. */
export interface CollectionHit {
  readonly itemKey: string
  readonly literatureId: LiteratureId
  readonly title: string
  readonly year?: number
  readonly venue?: string
  readonly doi?: string
  readonly authors: ReadonlyArray<string>
}

/** A `fetch`-shaped function; injected so the read is testable without a library. */
export type FetchLike = (url: string, init: { readonly signal: AbortSignal }) => Promise<{
  readonly ok: boolean
  readonly status: number
  /** The response body as text. */
  readonly text: () => Promise<string>
}>

/** The metadata tools this provider calls, as `ctx.tools` hands them over. */
export interface ZoteroToolPort {
  get(name: string): { execute(args: unknown, exec: { readonly signal: AbortSignal }): Promise<unknown> } | undefined
}

/**
 * A Zotero library, read over the two local routes and presented as one ledger.
 *
 * @remarks Every method REFUSES rather than degrading: there is no fallback to parsing a tool's
 * rendered text, and no partial collection is ever returned as a whole one.
 */
export class ZoteroProvider {
  private readonly config: ZoteroProviderConfig
  private readonly fetchImpl: FetchLike
  private readonly tools: ZoteroToolPort
  private readonly timeoutMs: number
  private readonly pageSize: number

  /**
   * @param config - the endpoint, the library, and the MCP namespace.
   * @param fetchImpl - how HTTP is performed; the host's `fetch` by default.
   * @param tools - the tool registry the MCP client registered onto.
   */
  constructor(config: ZoteroProviderConfig, fetchImpl: FetchLike, tools: ZoteroToolPort) {
    this.config = config
    this.fetchImpl = fetchImpl
    this.tools = tools
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.pageSize = config.pageSize ?? DEFAULT_PAGE_SIZE
  }

  /**
   * Read a collection's membership, following the API's pages to the end.
   *
   * @param collectionKey - the collection to read.
   * @param signal - cancellation from the caller.
   * @returns the membership and what it took, or why the membership is unknown.
   */
  async readCollection(
    collectionKey: string,
    signal?: AbortSignal,
  ): Promise<{ readonly ok: true; readonly collection: ZoteroCollection } | { readonly ok: false; readonly failure: ZoteroReadFailure }> {
    const keys: string[] = []
    let pagesRead = 0
    let reported = 0
    for (let page = 0; ; page += 1) {
      const start = page * this.pageSize
      const url = `${this.config.apiBase}/${this.config.localLibraryPath}/collections/${collectionKey}/items`
        + `?format=json&limit=${String(this.pageSize)}&start=${String(start)}&itemType=-attachment`
      const read = await this.getJson(url, signal)
      if (!read.ok) {
        // NOT AN EMPTY PAGE, AND NOT ONE FAILURE EITHER. A first page that did not arrive means
        // nothing was read at all — the library is unreachable, which is a different fact from a
        // collection that was partly read. A later page failing leaves the items it holds unknown, so
        // THAT is a truncation and says how much was read.
        return {
          ok: false,
          failure: page === 0
            ? {
              code: 'endpoint-unreadable',
              detail: `'${collectionKey}' could not be read at all: the first page did not arrive`
                + ` (${read.detail})`,
            }
            : {
              code: 'collection-truncated',
              detail: `page ${String(page + 1)} of '${collectionKey}' did not arrive (${read.detail});`
                + ` the ${String(keys.length)} key(s) already read are not the collection`,
            },
        }
      }
      const items = read.value
      if (!Array.isArray(items)) {
        return {
          ok: false,
          failure: {
            code: 'endpoint-unreadable',
            detail: 'the collection endpoint answered something that is not a list of items',
          },
        }
      }
      pagesRead += 1
      reported = Math.max(reported, read.total ?? 0)
      for (const entry of items) {
        const key = (entry as { readonly key?: unknown } | null)?.key
        if (typeof key === 'string' && key.length > 0) keys.push(key)
      }
      // THE END IS A SHORT PAGE, which is the API's own statement that there is no more. A full page
      // means another request, and the loop is bounded by the caller's signal rather than by a guess.
      if (items.length < this.pageSize) {
        return { ok: true, collection: { keys, reported, pagesRead, complete: true } }
      }
    }
  }

  /**
   * Read one source: its JSON metadata, its library version, and its BibTeX entry as one record.
   *
   * THE TWO READS ARE CHECKED AGAINST EACH OTHER. The JSON read reports the item's version; the
   * BibTeX read is generated from whatever the library held when it ran. If the item moved in
   * between, the pair describes two revisions, so the reads are repeated a bounded number of times
   * and then refused — a mixed version is not a snapshot, and calling it one would put a citation
   * and a version together that never existed at the same moment.
   *
   * @param itemKey - the item to read.
   * @param citationKey - the key the run's citation registry assigned.
   * @param signal - cancellation from the caller.
   * @returns the source, or why it could not be read as one record.
   */
  async readSource(
    itemKey: string,
    citationKey: string,
    signal?: AbortSignal,
  ): Promise<{ readonly ok: true; readonly source: ZoteroSource } | { readonly ok: false; readonly failure: ZoteroReadFailure }> {
    let lastVersion: number | undefined
    for (let attempt = 1; attempt <= REREAD_ATTEMPTS; attempt += 1) {
      const record = await this.readItemRecord(itemKey, signal)
      if (!record.ok) return record
      if (lastVersion !== undefined && record.value.version !== lastVersion) {
        // IT MOVED BETWEEN ATTEMPTS TOO. Another attempt reads a third revision, so this stops.
        return {
          ok: false,
          failure: {
            code: 'version-moved',
            detail: `'${itemKey}' was at version ${String(lastVersion)} and is at`
              + ` ${String(record.value.version)}; the library is being edited under this read`,
          },
        }
      }
      const bibtex = await this.readItemBibtex(itemKey, signal)
      if (!bibtex.ok) return bibtex
      const after = await this.readItemRecord(itemKey, signal)
      if (!after.ok) return after
      if (after.value.version !== record.value.version) {
        // THE RACE THIS EXISTS FOR: the entry was generated from a revision the record no longer
        // describes. Read both again rather than pairing them.
        lastVersion = after.value.version
        continue
      }
      const facts = factsOf(record.value)
      const checked = checkBibtexEntry({ text: bibtex.text, item: facts, citationKey })
      if (!checked.ok) {
        return { ok: false, failure: { code: 'bibtex-refused', detail: `'${itemKey}' was refused`, refusals: checked.refusals } }
      }
      return {
        ok: true,
        source: {
          library: record.value.library,
          itemKey,
          literatureId: literatureIdOf(
            { type: record.value.library.type === 'group' ? 'group' : 'user', id: libraryIdOf(record.value.library) },
            itemKey,
          ),
          version: record.value.version,
          citation: checked.citation,
          readBy: { metadata: 'local-api-json', bibliography: 'mcp-bibtex' },
        },
      }
    }
    return {
      ok: false,
      failure: {
        code: 'version-moved',
        detail: `'${itemKey}' moved on each of ${String(REREAD_ATTEMPTS)} reads, so no single version of it`
          + ' was read as both its metadata and its entry',
      },
    }
  }

  /**
   * Read the configured collection as candidates, filtered by the query's topic.
   *
   * THE FILTER IS LOCAL AND SAYS SO. A Zotero collection is a curated corpus, not a search index:
   * there is no relevance ranking to consult, so the topic is matched against each item's title and
   * abstract and the match is reported as what it is — a keyword filter over a list the deployment
   * chose, not a literature search. `total` counts the items that matched before the cap.
   *
   * @param query - the topic to filter by and how many hits to return.
   * @param signal - cancellation from the caller.
   * @returns the candidates and how many matched, or why the collection could not be read.
   */
  async readCandidates(
    query: { readonly topic: string; readonly collectionKey: string; readonly maxResults?: number },
    signal?: AbortSignal,
  ): Promise<{ readonly ok: true; readonly hits: ReadonlyArray<CollectionHit>; readonly total: number }
    | { readonly ok: false; readonly failure: ZoteroReadFailure }> {
    const collection = await this.readCollection(query.collectionKey, signal)
    if (!collection.ok) return collection
    const matched: CollectionHit[] = []
    for (const key of collection.collection.keys) {
      const record = await this.readItemRecord(key, signal)
      // A KEY THAT CANNOT BE READ IS NOT SKIPPED SILENTLY: the corpus would come back smaller, which
      // is the same value a corpus that never had the item produces.
      if (!record.ok) return { ok: false, failure: record.failure }
      if (!matchesTopic(record.value, query.topic)) continue
      matched.push(hitOf(record.value))
    }
    const capped = query.maxResults === undefined ? matched : matched.slice(0, query.maxResults)
    return { ok: true, hits: capped, total: matched.length }
  }

  /**
   * Read a source's text, whole or one page of it.
   *
   * @param itemKey - the item whose text is wanted.
   * @param request - a page, when one page is wanted.
   * @param signal - cancellation from the caller.
   * @returns the passage with where it came from and its version, or why it could not be read.
   */
  async readPassage(
    itemKey: string,
    request: PassageRequest = {},
    signal?: AbortSignal,
  ): Promise<{ readonly ok: true; readonly passage: ZoteroPassage } | { readonly ok: false; readonly failure: ZoteroReadFailure }> {
    const record = await this.readItemRecord(itemKey, signal)
    if (!record.ok) return record
    const page = request.page
    const name = page === undefined
      ? `mcp__${this.config.mcpServerName}__zotero_get_item_fulltext`
      : `mcp__${this.config.mcpServerName}__zotero_read_pdf_pages`
    const tool = this.tools.get(name)
    if (tool === undefined) {
      return {
        ok: false,
        failure: {
          code: 'metadata-tool-missing',
          detail: `this deployment registers no '${name}', so the text of '${itemKey}' cannot be read`
            + ' over the route the deployment chose',
        },
      }
    }
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    let result: unknown
    try {
      // THE ARGUMENT NAMES ARE THE TOOLS' OWN, measured 2026-09-18: the page route takes
      // `item_key` and `start_page` — the ITEM, not the attachment, and an inclusive start with an
      // optional `end_page`. A call with the wrong names is not a refusal the caller can act on; it
      // is five validation errors from a server.
      result = await tool.execute(
        page === undefined
          ? { item_key: itemKey }
          : { item_key: itemKey, start_page: page, end_page: page },
        { signal: combined },
      )
    } catch (error) {
      // A MISSING ATTACHMENT ARRIVES HERE, and it is a different fact from an empty one: the tool
      // says there is no PDF to read, and this read reports that rather than an empty passage.
      return {
        ok: false,
        failure: {
          code: 'passage-unreadable',
          detail: `'${itemKey}': ${error instanceof Error ? error.message : String(error)}`,
        },
      }
    }
    const text = toolText(result)
    if (text === undefined || text.trim() === '') {
      return {
        ok: false,
        failure: {
          code: 'passage-unreadable',
          detail: `the text tool answered with nothing readable for '${itemKey}'`
            + (page === undefined ? '' : ` page ${String(page)}`),
        },
      }
    }
    return {
      ok: true,
      passage: {
        literatureId: literatureIdOf(
          { type: record.value.library.type === 'group' ? 'group' : 'user', id: libraryIdOf(record.value.library) },
          itemKey,
        ),
        itemKey,
        where: page === undefined ? 'the whole text, as the tool returned it' : `page ${String(page)}`,
        text,
        contentSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
        readBy: page === undefined ? 'mcp-fulltext' : 'mcp-pdf-pages',
      },
    }
  }

  /**
   * One item's JSON metadata, as the local API returns it.
   *
   * @param itemKey - the item to read.
   * @param signal - cancellation from the caller.
   * @returns the record, or why it could not be read.
   */
  private async readItemRecord(
    itemKey: string,
    signal?: AbortSignal,
  ): Promise<{ readonly ok: true; readonly value: ZoteroItemRecord } | { readonly ok: false; readonly failure: ZoteroReadFailure }> {
    const url = `${this.config.apiBase}/${this.config.localLibraryPath}/items/${itemKey}`
    const read = await this.getJson(url, signal)
    if (!read.ok) {
      return { ok: false, failure: { code: 'endpoint-unreadable', detail: `'${itemKey}': ${read.detail}` } }
    }
    // THE BOUNDARY CHECK: this is a local HTTP response, which is one of the places the repository's
    // rules require validation rather than trust. A body that is not an item record is refused by
    // name; nothing downstream reads a field off it.
    const parsed = read.value as {
      readonly key?: unknown
      readonly version?: unknown
      readonly library?: unknown
      readonly data?: unknown
    } | null
    const usable = parsed !== null && typeof parsed === 'object'
      && typeof parsed.key === 'string' && typeof parsed.version === 'number'
      && parsed.library !== undefined && parsed.library !== null && typeof parsed.library === 'object'
      && typeof parsed.data === 'object' && parsed.data !== null
    if (!usable) {
      return {
        ok: false,
        failure: {
          code: 'endpoint-unreadable',
          detail: `'${itemKey}' answered without a key, a version and a library, so it is not an item`
            + ' record this provider can place',
        },
      }
    }
    return { ok: true, value: parsed as unknown as ZoteroItemRecord }
  }

  /**
   * One item's BibTeX, through the MCP client's tool.
   *
   * @param itemKey - the item to read.
   * @param signal - cancellation from the caller.
   * @returns the entry text, or why it could not be read.
   */
  private async readItemBibtex(
    itemKey: string,
    signal?: AbortSignal,
  ): Promise<{ readonly ok: true; readonly text: string } | { readonly ok: false; readonly failure: ZoteroReadFailure }> {
    const name = `mcp__${this.config.mcpServerName}__zotero_get_item_metadata`
    const tool = this.tools.get(name)
    if (tool === undefined) {
      // NAMED, NOT SUBSTITUTED. The deployment mounts the Zotero server; a provider that fell back to
      // reading the item's own fields would produce an entry nobody generated and call it Zotero's.
      return {
        ok: false,
        failure: {
          code: 'metadata-tool-missing',
          detail: `this deployment registers no '${name}', so the bibliography of '${itemKey}' cannot be`
            + ' read over the route the deployment chose',
        },
      }
    }
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    let result: unknown
    try {
      result = await tool.execute({ item_key: itemKey, format: 'bibtex' }, { signal: combined })
    } catch (error) {
      return {
        ok: false,
        failure: {
          code: 'bibtex-refused',
          detail: `the metadata tool failed for '${itemKey}':`
            + ` ${error instanceof Error ? error.message : String(error)}`,
        },
      }
    }
    const text = toolText(result)
    if (text === undefined) {
      return {
        ok: false,
        failure: { code: 'bibtex-refused', detail: `the metadata tool answered with no text for '${itemKey}'` },
      }
    }
    return { ok: true, text }
  }

  /**
   * GET one URL as JSON.
   *
   * @param url - the address, built from configuration and a collection key.
   * @param signal - cancellation from the caller.
   * @returns the parsed body and the API's reported total, or why the read failed.
   */
  private async getJson(
    url: string,
    signal?: AbortSignal,
  ): Promise<{ readonly ok: true; readonly value: unknown; readonly total?: number } | { readonly ok: false; readonly detail: string }> {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    let response: Awaited<ReturnType<FetchLike>>
    try {
      response = await this.fetchImpl(url, { signal: combined })
    } catch (error) {
      // ZOTERO NOT RUNNING ARRIVES HERE, and it is a different fact from an empty collection: the
      // local API is only there while the application is. The reason travels; nothing is inferred.
      return { ok: false, detail: error instanceof Error ? error.message : String(error) }
    }
    if (!response.ok) return { ok: false, detail: `HTTP ${String(response.status)}` }
    const raw = await response.text()
    try {
      const total = totalOf(raw)
      return total === undefined
        ? { ok: true, value: JSON.parse(raw) }
        : { ok: true, value: JSON.parse(raw), total }
    } catch {
      return { ok: false, detail: 'the response is not JSON' }
    }
  }
}

/**
 * The library's stable id, from the object the API returned.
 *
 * @param library - the library an item belongs to.
 * @returns the id, preferring the numeric one the API addresses libraries by.
 */
function libraryIdOf(library: ZoteroLibraryRef): string {
  return library.id
}

/**
 * The `Total-Results` header's value, when the response carried one.
 *
 * Zotero reports the size of a result set in a header rather than in the body, and the value is read
 * out of the raw text only because the injected `fetch` face is deliberately small. It is used for
 * the record, not for deciding whether the read finished — a short page is what says that.
 *
 * @param raw - the response body.
 * @returns the reported total, when the body carried it.
 */
function totalOf(raw: string): number | undefined {
  const match = /"totalResults"\s*:\s*(\d+)/u.exec(raw)
  return match === null ? undefined : Number(match[1])
}

/**
 * The item facts a returned entry is checked against, from the item's own JSON.
 *
 * @param record - one item record.
 * @returns the facts the entry must agree with.
 */
function factsOf(record: ZoteroItemRecord): ZoteroItemFacts {
  const yearMatch = /(\d{4})/u.exec(record.data.date ?? '')
  return {
    itemKey: record.key,
    title: record.data.title ?? '',
    ...(yearMatch === null ? {} : { year: Number(yearMatch[1]) }),
    ...(record.data.DOI === undefined || record.data.DOI === '' ? {} : { doi: record.data.DOI }),
  }
}

/**
 * Whether an item's title or abstract mentions the topic's words.
 *
 * A LOCAL FILTER OVER A CURATED LIST, not a relevance search; see {@link ZoteroProvider.readCandidates}.
 * Every word of the topic must appear somewhere in the two fields — a sentence's words are not all
 * keywords, and matching ANY of them would return the whole collection for a topic like "the effect
 * of a change on the system".
 *
 * @param record - one item record.
 * @param topic - the topic as the query states it.
 * @returns whether the item mentions it.
 */
function matchesTopic(record: ZoteroItemRecord, topic: string): boolean {
  const haystack = `${record.data.title ?? ''} ${record.data.abstractNote ?? ''}`.toLowerCase()
  const words = topic.toLowerCase().split(/[^a-z0-9]+/u).filter(word => word.length > 3)
  if (words.length === 0) return true
  return words.every(word => haystack.includes(word))
}

/**
 * One item record as a candidate.
 *
 * @param record - the record.
 * @returns the candidate, carrying the identity the read minted.
 */
function hitOf(record: ZoteroItemRecord): CollectionHit {
  const yearMatch = /(\d{4})/u.exec(record.data.date ?? '')
  return {
    itemKey: record.key,
    literatureId: literatureIdOf(
      { type: record.library.type === 'group' ? 'group' : 'user', id: libraryIdOf(record.library) },
      record.key,
    ),
    title: record.data.title ?? '',
    ...(yearMatch === null ? {} : { year: Number(yearMatch[1]) }),
    ...(record.data.publicationTitle === undefined ? {} : { venue: record.data.publicationTitle }),
    ...(record.data.DOI === undefined || record.data.DOI === '' ? {} : { doi: record.data.DOI }),
    authors: (record.data.creators ?? []).flatMap((creator): string[] => {
      if (typeof creator.name === 'string' && creator.name !== '') return [creator.name]
      const parts = [creator.lastName, creator.firstName]
        .filter((part): part is string => typeof part === 'string' && part !== '')
      return parts.length === 0 ? [] : [parts.join(', ')]
    }),
  }
}

/**
 * The text one tool result carries.
 *
 * The MCP client hands back the content array it received; anything else is not a reply this provider
 * can read, which is reported by the caller rather than guessed at here.
 *
 * @param result - what the tool's `execute` resolved with.
 * @returns the concatenated text, or undefined when there is none.
 */
function toolText(result: unknown): string | undefined {
  const content = (result as { readonly content?: unknown } | null)?.content
  if (!Array.isArray(content)) return undefined
  const parts = content.flatMap((part): string[] => {
    const text = (part as { readonly text?: unknown } | null)?.text
    return typeof text === 'string' ? [text] : []
  })
  return parts.length === 0 ? undefined : parts.join('\n')
}
