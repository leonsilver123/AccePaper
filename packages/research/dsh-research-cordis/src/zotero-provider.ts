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
//
// A TOOL'S REPLY IS NOT THE PAPER. Measured 2026-09-18 against the real library: `read_pdf_pages`
// answers `# PDF Pages 1-1 of <title>` / `**Item Key:** …` / `**Total pages in PDF:** …` / `## Page 1`
// and only then the page's own words, and `get_item_fulltext` answers a `*Response size: …*` preamble
// followed by a `**Type:** / **Item Key:** / **Date:** / **Authors:**` header block, the rendered body,
// and the reference list. Hashing either reply whole hashes the server's presentation, so this module
// keeps the reply as an AUDIT RECORD and derives the evidence text from it separately. Where the two
// cannot be told apart the reply is NOT evidence, and the route that cannot be separated — the
// full-text rendering — is reachable only as navigation. A page marker does not make a reply clean
// either: the page route's envelope is stripped by the same rule, and `where` names what was removed.
//
// THE ENDPOINT NAMES AN ATTACHMENT'S FILE, IT DOES NOT SERVE IT. Measured 2026-09-19 against Zotero
// 9.0.6: `GET {apiBase}/{library}/items/{attachmentKey}/file` answers `302` with a
// `Location: file:///…/storage/<key>/<name>.pdf` and an empty body, and following that redirect is
// refused by the HTTP layer ("URL scheme must be a HTTP(S) scheme"). So reading a file is TWO steps —
// the endpoint says where the file is, and the bytes are read from THERE — which is why
// {@link ZoteroProvider.readAttachment} resolves a location instead of just streaming a response. A
// location that is not a file on this machine is refused rather than followed, and no path ever
// leaves this module: what a caller receives is the bytes with the version and the hash they were
// read at.
//
// AND READING A FILE IS THE DEPLOYMENT'S DECISION. {@link ZoteroAttachmentPolicy} is `'none'` unless
// a deployment states otherwise, and under `'none'` nothing is requested at all — so a deployment
// that says nothing about it behaves exactly as it did before the capability existed.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

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
  /**
   * Whether this deployment reads an attachment's own bytes, and where from.
   *
   * OMITTED IS `'none'`, AND THAT READS NOTHING: {@link ZoteroProvider.readAttachment} refuses with
   * `attachment-disabled` before it makes a request, so a deployment that states nothing here keeps
   * exactly the behaviour it had before the capability existed. `'local-cache'` states that this
   * deployment's library keeps its files on the machine the provider runs on, which is what makes
   * reading them a decision the deployment makes rather than a caller.
   */
  readonly attachments?: ZoteroAttachmentPolicy
}

/**
 * Whether this deployment reads an attachment's own bytes, and where from.
 *
 * `'local-cache'` states that this deployment's library keeps its files on this machine and that the
 * provider may read them; `'none'` reads nothing. A DEPLOYMENT setting for the same reason
 * {@link ZoteroProviderConfig.apiBase} is: which library's files are on this disk is a fact about the
 * machine, never a request parameter.
 */
export type ZoteroAttachmentPolicy = 'none' | 'local-cache'

/** Every {@link ZoteroAttachmentPolicy}. */
export const ATTACHMENT_POLICIES: readonly ZoteroAttachmentPolicy[] = ['none', 'local-cache']

/**
 * Whether a value names an attachment policy.
 *
 * @param value - the value a deployment declared, or any value read from configuration.
 * @returns true when the value names a policy.
 */
export function isAttachmentPolicy(value: unknown): value is ZoteroAttachmentPolicy {
  return typeof value === 'string' && (ATTACHMENT_POLICIES as ReadonlyArray<string>).includes(value)
}

/**
 * The policy a deployment has when it declares none: no attachment file is read.
 *
 * THE DEFAULT IS THE ABSENCE OF THE CAPABILITY. Reading a file off the machine is opted into, so an
 * undeclared deployment cannot begin doing it because a field was added to the code.
 */
export const DEFAULT_ATTACHMENT_POLICY: ZoteroAttachmentPolicy = 'none'

/**
 * Resolve the deployment's attachment policy.
 *
 * AN EXPLICIT RESOLUTION STEP in the implementation that owns the setting, and it VALIDATES as it
 * resolves: the value arrives from `cordis.yml` as untyped YAML, so a typo fails the load instead of
 * leaving a deployment running under a policy it did not choose.
 *
 * @param declared - the policy the deployment stated, if it stated one.
 * @returns the declared policy, or {@link DEFAULT_ATTACHMENT_POLICY} when none was declared.
 * @throws {Error} when the value names no policy, naming the field and the accepted values.
 */
export function resolveAttachmentPolicy(declared: unknown): ZoteroAttachmentPolicy {
  if (declared === undefined) return DEFAULT_ATTACHMENT_POLICY
  if (!isAttachmentPolicy(declared)) {
    throw new Error(
      `[research] \`attachments\` must be one of ${ATTACHMENT_POLICIES.join(' | ')}, got ${JSON.stringify(declared)}`,
    )
  }
  return declared
}

/**
 * The byte-order mark a tool reply may open with, measured 2026-09-18.
 *
 * BUILT FROM ITS CODE POINT rather than written into a literal: the character is invisible, a literal
 * one survives review as nothing at all, and an editor is free to strip it — which would turn the
 * strip below into a no-op that no diff shows.
 */
const BYTE_ORDER_MARK = String.fromCharCode(0xFEFF)

/** The default time one request may take. */
const DEFAULT_TIMEOUT_MS = 30_000

/** The default page size; the API accepts up to 100. */
const DEFAULT_PAGE_SIZE = 100

/** How many times a source is re-read when the library moved under it. */
const REREAD_ATTEMPTS = 3

/**
 * Which revision of this module's reading rules produced a record.
 *
 * IT TRAVELS WITH THE RECORD, so evidence read under one set of rules is not silently re-read under
 * another: an extraction that changes how a reply is split changes what the text means, and a
 * judgement made from the old split must be recognisable as one.
 */
export const ZOTERO_READ_RULE_VERSION = 'zotero-local-read-v1'

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
    readonly ISBN?: string
    /** Zotero's free-text field, where a preprint's arXiv id is conventionally recorded. */
    readonly extra?: string
    readonly archiveID?: string
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
  /** The text tool answered nothing readable: no attachment, or a read that failed. */
  | 'passage-unreadable'
  /** The page asked for is not in the attachment, and the tool said so. */
  | 'passage-out-of-range'
  /** The tool answered something that is not this page's own words. */
  | 'passage-unrecognized'
  /** More than one PDF attachment could have answered, so which one did is not establishable. */
  | 'passage-unattributable'
  /** This deployment did not enable reading attachment files, so no file is read. */
  | 'attachment-disabled'
  /** The named attachment is not on the item, is not a PDF, or its bytes could not be read. */
  | 'attachment-unreadable'

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
  readonly ruleVersion: string
}

/** A file attached to an item, as the local API reports it. */
export interface ZoteroAttachment {
  readonly key: string
  /** The attachment's OWN version, which moves when the file is replaced even if the item does not. */
  readonly version: number
  readonly filename?: string
  readonly contentType?: string
}

/**
 * One attachment's own bytes, with what a reader needs to trust them.
 *
 * WHAT MAKES THIS THE FILE AND NOT A COPY OF SOMETHING ELSE. `attachment.version` is the version the
 * bytes were read at, established by reading the attachment's record before the bytes and again
 * after them and refusing a file that moved in between; `sha256` is over
 * {@link ZoteroAttachmentFile.bytes} exactly as returned, so a reader that stores the file can show
 * the stored copy is the one this read produced; `size` is that byte count. None of the three
 * implies another, so all three travel.
 *
 * AND IT NAMES NO PATH. Where this machine keeps the file is a fact about this disk: a record that
 * travels — into a package, a report, a `.bib` — carries the version and the hash instead. The same
 * rule the bibliography writer follows for the library's `file` field.
 */
export interface ZoteroAttachmentFile {
  /** The file's bytes, exactly as read. */
  readonly bytes: Uint8Array
  /** SHA-256 over {@link ZoteroAttachmentFile.bytes}, as returned. */
  readonly sha256: string
  /** How many bytes {@link ZoteroAttachmentFile.bytes} holds. */
  readonly size: number
  /** The attachment the bytes belong to, at the version they were read at. */
  readonly attachment: ZoteroAttachment
}

/**
 * What one tool reply was judged to be.
 *
 * THE RAW REPLY IS KEPT WHATEVER THIS SAYS. A classification is this module's reading of the reply,
 * and a reader who disagrees with it has the reply itself to check it against.
 */
export type ReplyClassification =
  /** A page of the source, with the tool's own header removed. */
  | 'page-text'
  /** The tool's whole-document rendering, with its own preamble and metadata header still in it. */
  | 'full-text-rendering'
  /** The tool reporting that the requested page is not in the file. */
  | 'out-of-range'
  /** An error block or an install notice — something the tool wrote, not something the paper says. */
  | 'error-or-notice'
  /** The tool answered no text at all. */
  | 'empty'

/** The tool's reply, kept whole, so any text derived from it can be checked against it. */
export interface ToolReplyAudit {
  /** The tool that answered. */
  readonly tool: string
  /** The reply exactly as the tool returned it. */
  readonly raw: string
  /** SHA-256 over {@link ToolReplyAudit.raw}: the version of the REPLY. */
  readonly rawSha256: string
  readonly rawLength: number
  readonly classification: ReplyClassification
}

/**
 * A page of a source, whose text is the page's own words and which may be quoted.
 *
 * WHAT MAKES THIS EVIDENCE AND NOT A TOOL'S OUTPUT. `text` is the page's own words with the tool's
 * envelope removed, and `contentSha256` is over THAT text — not over the reply, which would make the
 * hash depend on the server's presentation. The reply is kept in {@link ZoteroPassage.audit} so the
 * removal can be checked.
 *
 * AND IT CARRIES EVERY VERSION THE JUDGEMENT DEPENDS ON. `itemVersion` moves when the item's metadata
 * changes; `attachment.version` moves when the FILE is replaced, which need not move the item; and
 * `contentSha256` moves when the extracted words change. A judgement made from this page is bound to
 * all three, because none of them implies the others.
 */
export interface ZoteroPassage {
  readonly literatureId: LiteratureId
  readonly itemKey: string
  /** The library's version for the parent item at the read that produced this passage. */
  readonly itemVersion: number
  /** The attachment the words were read from, with its own version. */
  readonly attachment: ZoteroAttachment
  /** The 1-indexed page the words are printed on. */
  readonly page: number
  /** How many pages the attachment the tool read has, as the tool reported it. */
  readonly totalPages: number
  /**
   * Where in the source the text is, in words a reader can act on.
   *
   * It NAMES WHAT WAS REMOVED as well as what is left: a locator that said only "page 4" would leave
   * a reader unable to tell a stripped page from a page that happened to start with the tool's header.
   */
  readonly where: string
  /** The page's own words, with the tool's envelope removed. */
  readonly text: string
  /** SHA-256 over {@link ZoteroPassage.text}, as read. */
  readonly contentSha256: string
  readonly readBy: 'mcp-pdf-pages'
  readonly ruleVersion: string
  readonly audit: ToolReplyAudit
}

/**
 * The tool's rendering of a whole source, which is NOT evidence.
 *
 * WHY THIS IS A SEPARATE TYPE FROM {@link ZoteroPassage} RATHER THAN A FLAG ON IT. The full-text tool
 * answers a document it composed — a size preamble, a metadata header, the extracted body, the
 * reference list — and this module cannot tell, in general, where its own composition ends and the
 * paper begins; a rule that stripped a fixed prefix would be right until the server changed the
 * prefix. It also carries no page, so nothing quoted from it can be traced to a place in the file.
 * Under the repository's rule for a reply that cannot be separated, the route stays reachable for
 * FINDING out what a source says and for NAVIGATING to a passage — and a value of this type cannot be
 * passed to anything that takes evidence, which is what keeps the restriction structural rather than
 * a comment somebody has to remember.
 */
export interface ZoteroNavigation {
  readonly literatureId: LiteratureId
  readonly itemKey: string
  readonly itemVersion: number
  /** What the tool returned, in full and unaltered. */
  readonly rendering: string
  readonly readBy: 'mcp-fulltext'
  readonly ruleVersion: string
  /** What this value may NOT be used for, stated where a caller reading the type will see it. */
  readonly notEvidence: string
  readonly audit: ToolReplyAudit
}

/** A candidate from the configured collection, as the roster read it. */
export interface CollectionHit {
  readonly itemKey: string
  readonly literatureId: LiteratureId
  readonly title: string
  readonly year?: number
  readonly venue?: string
  readonly doi?: string
  /** The item's own ISBN, when it is a book. */
  readonly isbn?: string
  /** The arXiv id the item records, when it records one. */
  readonly arxivId?: string
  readonly authors: ReadonlyArray<string>
}

/**
 * A `fetch`-shaped function; injected so the read is testable without a library.
 *
 * A CALLER MUST FORWARD THE INIT IT IS GIVEN, not only the signal: the attachment route is read with
 * its redirect visible because on a real library the redirect IS the answer, and a wrapper that
 * dropped `redirect` would make the HTTP layer follow a `file://` location and fail.
 */
export type FetchLike = (url: string, init: {
  readonly signal: AbortSignal
  /** How a redirect is handled, when the route being read answers one that carries the answer. */
  readonly redirect?: 'follow' | 'manual'
}) => Promise<{
  readonly ok: boolean
  readonly status: number
  /** The response's headers, where a route answers with a location rather than a body. */
  readonly headers: { get(name: string): string | null }
  /** The response body as text. */
  readonly text: () => Promise<string>
  /** The response body as bytes; a library that streams a file answers it here. */
  readonly arrayBuffer: () => Promise<ArrayBuffer>
}>

/** The metadata tools this provider calls, as `ctx.tools` hands them over. */
export interface ZoteroToolPort {
  get(name: string): { execute(args: unknown, exec: { readonly signal: AbortSignal }): Promise<unknown> } | undefined
}

/**
 * A Zotero library, read over the two local routes and presented as one ledger.
 *
 * @remarks Every method REFUSES rather than degrading: there is no fallback to parsing a tool's
 * rendered text as evidence, and no partial collection is ever returned as a whole one.
 */
export class ZoteroProvider {
  private readonly config: ZoteroProviderConfig
  private readonly fetchImpl: FetchLike
  private readonly tools: ZoteroToolPort
  private readonly timeoutMs: number
  private readonly pageSize: number
  /** The resolved attachment policy; `'none'` unless this deployment enabled reading files. */
  private readonly attachments: ZoteroAttachmentPolicy

  /**
   * @param config - the endpoint, the library, the MCP namespace, and whether files may be read.
   * @param fetchImpl - how HTTP is performed; the host's `fetch` by default.
   * @param tools - the tool registry the MCP client registered onto.
   */
  constructor(config: ZoteroProviderConfig, fetchImpl: FetchLike, tools: ZoteroToolPort) {
    this.config = config
    this.fetchImpl = fetchImpl
    this.tools = tools
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.pageSize = config.pageSize ?? DEFAULT_PAGE_SIZE
    this.attachments = resolveAttachmentPolicy(config.attachments)
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
          ruleVersion: ZOTERO_READ_RULE_VERSION,
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
   * IT RANKS RATHER THAN EXCLUDES, WHICH IS A CHANGE OF RULE AND NOT A LOOSENING. The filter used to
   * demand every word of the topic, and a topic is a research DIRECTION — a sentence — so it matched
   * nothing at all: measured 2026-09-19, a 27-item collection came back empty for the study it was
   * assembled for, and the emptiness surfaced four steps later as a held references section and a
   * blocked D3. An item that states some of the direction says something about it, so it is returned,
   * scored by how much it states and ordered best first. A collection is a list somebody chose; "all
   * of it bears on my question" is the honest answer for a broad direction, not a failure.
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
    const scored: Array<{ readonly score: number; readonly hit: CollectionHit }> = []
    for (const key of collection.collection.keys) {
      const record = await this.readItemRecord(key, signal)
      // A KEY THAT CANNOT BE READ IS NOT SKIPPED SILENTLY: the corpus would come back smaller, which
      // is the same value a corpus that never had the item produces.
      if (!record.ok) return { ok: false, failure: record.failure }
      const score = topicScore(record.value, query.topic)
      if (score === 0) continue
      scored.push({ score, hit: hitOf(record.value) })
    }
    // BEST FIRST, BY THE SAME MEASURE THAT ADMITTED THEM. A caller reading `hits[0]` is asking what
    // bears on the topic most, and the collection's own order is the order somebody filed it in.
    // Ties keep that order, so two runs over one collection agree.
    scored.sort((left, right) => right.score - left.score)
    const matched = scored.map(entry => entry.hit)
    const capped = query.maxResults === undefined ? matched : matched.slice(0, query.maxResults)
    return { ok: true, hits: capped, total: matched.length }
  }

  /**
   * Read one page of a source: the words printed on it, with the tool's envelope removed.
   *
   * THE PAGE IS NOT OPTIONAL, because evidence needs a locator. The guidance this method answers to
   * asks for "page or verifiable locator" with every piece of evidence, and a whole-document read
   * carries none — that is why the whole-document route is {@link ZoteroProvider.readFullText} and
   * returns a value that is not evidence.
   *
   * @param itemKey - the item whose page is wanted.
   * @param page - the 1-indexed page.
   * @param signal - cancellation from the caller.
   * @returns the page with what it took to establish it, or why no page was read.
   */
  async readPage(
    itemKey: string,
    page: number,
    signal?: AbortSignal,
  ): Promise<{ readonly ok: true; readonly passage: ZoteroPassage } | { readonly ok: false; readonly failure: ZoteroReadFailure }> {
    const record = await this.readItemRecord(itemKey, signal)
    if (!record.ok) return record
    const attachments = await this.readPdfAttachments(itemKey, signal)
    if (!attachments.ok) return attachments
    // THE FILE THE WORDS CAME FROM IS PART OF THE EVIDENCE, and this route cannot be told which file
    // it read: the tool takes the ITEM and picks the attachment itself. One PDF is therefore
    // establishable; two are not, and guessing would bind the judgement's invalidation to the wrong
    // file, so the read stops and names them instead.
    if (attachments.value.length === 0) {
      return {
        ok: false,
        failure: {
          code: 'passage-unreadable',
          detail: `'${itemKey}' has no PDF attachment, so it has no pages to read`,
        },
      }
    }
    if (attachments.value.length > 1) {
      return {
        ok: false,
        failure: {
          code: 'passage-unattributable',
          detail: `'${itemKey}' has ${String(attachments.value.length)} PDF attachments`
            + ` (${attachments.value.map(entry => entry.key).join(', ')}) and the page tool takes the item,`
            + ' not the attachment, so which file answered cannot be established — give the item one PDF,'
            + ' or name the attachment in a route that takes one',
        },
      }
    }
    const attachment = attachments.value[0]
    if (attachment === undefined) {
      return { ok: false, failure: { code: 'passage-unreadable', detail: `'${itemKey}': no attachment` } }
    }
    if (!Number.isInteger(page) || page < 1) {
      return {
        ok: false,
        failure: { code: 'passage-out-of-range', detail: `page ${String(page)} is not a page number` },
      }
    }
    const name = `mcp__${this.config.mcpServerName}__zotero_read_pdf_pages`
    const tool = this.tools.get(name)
    if (tool === undefined) {
      return {
        ok: false,
        failure: {
          code: 'metadata-tool-missing',
          detail: `this deployment registers no '${name}', so a page of '${itemKey}' cannot be read over`
            + ' the route the deployment chose',
        },
      }
    }
    // THE ARGUMENT NAMES ARE THE TOOL'S OWN, measured 2026-09-18: `item_key`, and an inclusive
    // `start_page`/`end_page`. `start_page` is REQUIRED — a call without it is refused by the server
    // with a validation error, which is not a refusal a caller can act on.
    let result: unknown
    try {
      result = await tool.execute(
        { item_key: itemKey, start_page: page, end_page: page },
        { signal: this.combined(signal) },
      )
    } catch (error) {
      return {
        ok: false,
        failure: {
          code: 'passage-unreadable',
          detail: `'${itemKey}' page ${String(page)}: ${error instanceof Error ? error.message : String(error)}`,
        },
      }
    }
    const raw = toolText(result)
    if (raw === undefined || raw.trim() === '') {
      return { ok: false, failure: { code: 'passage-unreadable', detail: `the text tool answered with nothing readable for '${itemKey}' page ${String(page)}` } }
    }
    const audit = auditOf(name, raw)
    const split = pageTextOf(raw, page)
    if (!split.ok) {
      // A REPLY THAT IS NOT THIS PAGE'S WORDS IS NOT EVIDENCE, whatever it says. The measured shapes
      // that arrive here include an out-of-range notice, a missing-dependency install notice, and a
      // 404 error block; none of them is the paper, and accepting one would put the server's prose
      // into an evidence chain under a page number.
      return {
        ok: false,
        failure: {
          code: split.classification === 'out-of-range'
            ? 'passage-out-of-range'
            : split.classification === 'empty'
              // A PAGE THAT EXTRACTED NOTHING MEANS NOTHING READABLE CAME BACK — the same fact the
              // whole-text route reports, and a different one from a reply this module could not
              // recognise. Only the second is about the module's reading of the reply.
              ? 'passage-unreadable'
              : 'passage-unrecognized',
          detail: `'${itemKey}' page ${String(page)}: ${split.detail}; the reply began`
            + ` '${firstLineOf(raw)}'`,
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
        itemVersion: record.value.version,
        attachment,
        page,
        totalPages: split.totalPages,
        where: `page ${String(page)} of ${String(split.totalPages)} in attachment ${attachment.key}`
          + ', with the tool\'s \'PDF Pages\' header removed',
        text: split.text,
        contentSha256: createHash('sha256').update(split.text, 'utf8').digest('hex'),
        readBy: 'mcp-pdf-pages',
        ruleVersion: ZOTERO_READ_RULE_VERSION,
        audit: { ...audit, classification: 'page-text' },
      },
    }
  }

  /**
   * Read a source's whole text as the tool renders it, for finding what to read next.
   *
   * NOT EVIDENCE, AND THE RETURN TYPE SAYS SO. See {@link ZoteroNavigation} for why this module does
   * not separate the tool's rendering from the paper: the reply is a document the server composed,
   * and a fixed-prefix rule would be correct only until the server changed the prefix.
   *
   * @param itemKey - the item to render.
   * @param signal - cancellation from the caller.
   * @returns the rendering and what it may be used for, or why nothing was read.
   */
  async readFullText(
    itemKey: string,
    signal?: AbortSignal,
  ): Promise<{ readonly ok: true; readonly navigation: ZoteroNavigation } | { readonly ok: false; readonly failure: ZoteroReadFailure }> {
    const record = await this.readItemRecord(itemKey, signal)
    if (!record.ok) return record
    const name = `mcp__${this.config.mcpServerName}__zotero_get_item_fulltext`
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
    let result: unknown
    try {
      result = await tool.execute({ item_key: itemKey }, { signal: this.combined(signal) })
    } catch (error) {
      // A MISSING ATTACHMENT ARRIVES HERE, and it is a different fact from an empty one: the tool
      // says there is no PDF to read, and this read reports that rather than an empty rendering.
      return {
        ok: false,
        failure: {
          code: 'passage-unreadable',
          detail: `'${itemKey}': ${error instanceof Error ? error.message : String(error)}`,
        },
      }
    }
    const raw = toolText(result)
    if (raw === undefined || raw.trim() === '') {
      return {
        ok: false,
        failure: { code: 'passage-unreadable', detail: `the text tool answered with nothing readable for '${itemKey}'` },
      }
    }
    return {
      ok: true,
      navigation: {
        literatureId: literatureIdOf(
          { type: record.value.library.type === 'group' ? 'group' : 'user', id: libraryIdOf(record.value.library) },
          itemKey,
        ),
        itemKey,
        itemVersion: record.value.version,
        rendering: raw,
        readBy: 'mcp-fulltext',
        ruleVersion: ZOTERO_READ_RULE_VERSION,
        notEvidence:
          'this is the tool\'s own rendering: its size preamble and metadata header are still in it and no'
          + ' page or attachment is recorded, so it may locate a passage but may not be quoted or cited',
        audit: { ...auditOf(name, raw), classification: 'full-text-rendering' },
      },
    }
  }

  /**
   * One attachment's own bytes: the file itself, not the words a tool extracted from it.
   *
   * A SOURCE IS READ AT ONE VERSION OR NOT AT ALL, AND A FILE IS A SOURCE. The attachment's record is
   * read before the bytes and again after them, and a file that moved in between is REFUSED: the
   * bytes would still be real, but calling them the file a passage was read from would not be, and
   * that is the only thing a record of them is used for. There is deliberately NO retry here, unlike
   * {@link ZoteroProvider.readSource}: the two reads that make a source are two views of one moment,
   * while a re-read after a moved file would produce a coherent record of a DIFFERENT file than the
   * one a judgement about this source was made from.
   *
   * WHERE THE BYTES COME FROM. On a real library the file route answers a POINTER — a `file://`
   * location — rather than the file, so the read is two steps; see the module header for the
   * measurement. A library that streams the bytes instead is used as it arrives.
   *
   * @param itemKey - the item the attachment belongs to; the pair must name one file.
   * @param attachmentKey - the attachment whose bytes are wanted.
   * @param signal - cancellation from the caller.
   * @returns the bytes with the version read at and the hash over them, or why no file was read.
   */
  async readAttachment(
    itemKey: string,
    attachmentKey: string,
    signal?: AbortSignal,
  ): Promise<{ readonly ok: true; readonly file: ZoteroAttachmentFile } | { readonly ok: false; readonly failure: ZoteroReadFailure }> {
    // THE CAPABILITY IS THE DEPLOYMENT'S, CHECKED BEFORE ANYTHING IS ASKED FOR. An undeclared policy
    // resolves to `'none'`, so this refusal is where the capability simply is not there — a caller
    // cannot reach a file by naming one, and no request leaves the process.
    if (this.attachments === 'none') {
      return {
        ok: false,
        failure: {
          code: 'attachment-disabled',
          detail: 'this deployment reads no attachment files (`attachments` is `none`), so the file'
            + ` of '${attachmentKey}' was not read and nothing was requested`,
        },
      }
    }
    const before = await this.readAttachmentRecord(itemKey, attachmentKey, signal)
    if (!before.ok) return before
    const bytes = await this.readAttachmentBytes(attachmentKey, signal)
    if (!bytes.ok) return bytes
    // THE HALF THAT MATTERS is this one: the first read says what the file was, and the second says
    // what it still is once the bytes have been taken from the machine.
    const after = await this.readAttachmentRecord(itemKey, attachmentKey, signal)
    if (!after.ok) return after
    if (after.value.version !== before.value.version) {
      return {
        ok: false,
        failure: {
          code: 'version-moved',
          detail: `attachment '${attachmentKey}' of '${itemKey}' was at version`
            + ` ${String(before.value.version)} and is at ${String(after.value.version)}; the file was`
            + ' replaced while it was being read, so these bytes belong to no version a passage of this'
            + ' source could have been read at',
        },
      }
    }
    return {
      ok: true,
      file: {
        bytes: bytes.value,
        sha256: createHash('sha256').update(bytes.value).digest('hex'),
        size: bytes.value.byteLength,
        attachment: before.value,
      },
    }
  }

  /**
   * One item's attachments, as the local API lists them.
   *
   * EVERY ATTACHMENT, NOT ONLY THE PDFs: a caller that named an attachment has to be told that the
   * file it named is not one this provider reads, and a list already filtered to PDFs would report
   * that as the attachment not existing at all.
   *
   * @param itemKey - the item whose attachments are wanted.
   * @param signal - cancellation from the caller.
   * @returns the attachments, or why they could not be listed.
   */
  private async readAttachments(
    itemKey: string,
    signal?: AbortSignal,
  ): Promise<{ readonly ok: true; readonly value: ReadonlyArray<ZoteroAttachment> }
    | { readonly ok: false; readonly failure: ZoteroReadFailure }> {
    const url = `${this.config.apiBase}/${this.config.localLibraryPath}/items/${itemKey}/children`
      + '?format=json&limit=100'
    const read = await this.getJson(url, signal)
    if (!read.ok) {
      return {
        ok: false,
        failure: { code: 'endpoint-unreadable', detail: `the attachments of '${itemKey}': ${read.detail}` },
      }
    }
    if (!Array.isArray(read.value)) {
      return {
        ok: false,
        failure: {
          code: 'endpoint-unreadable',
          detail: `the attachments of '${itemKey}' answered something that is not a list`,
        },
      }
    }
    const children = read.value.flatMap((entry): ZoteroAttachment[] => {
      const child = entry as {
        readonly key?: unknown
        readonly version?: unknown
        readonly data?: { readonly itemType?: unknown; readonly contentType?: unknown; readonly filename?: unknown }
      } | null
      if (child === null || typeof child !== 'object') return []
      if (typeof child.key !== 'string' || typeof child.version !== 'number') return []
      if (child.data?.itemType !== 'attachment') return []
      return [{
        key: child.key,
        version: child.version,
        ...(typeof child.data.filename === 'string' ? { filename: child.data.filename } : {}),
        ...(typeof child.data.contentType === 'string' ? { contentType: child.data.contentType } : {}),
      }]
    })
    return { ok: true, value: children }
  }

  /**
   * One item's PDF attachments.
   *
   * @param itemKey - the item whose PDFs are wanted.
   * @param signal - cancellation from the caller.
   * @returns the PDF attachments, or why they could not be listed.
   */
  private async readPdfAttachments(
    itemKey: string,
    signal?: AbortSignal,
  ): Promise<{ readonly ok: true; readonly value: ReadonlyArray<ZoteroAttachment> }
    | { readonly ok: false; readonly failure: ZoteroReadFailure }> {
    const attachments = await this.readAttachments(itemKey, signal)
    if (!attachments.ok) return attachments
    return { ok: true, value: attachments.value.filter(entry => entry.contentType === 'application/pdf') }
  }

  /**
   * One attachment of one item, as the item's own children list it.
   *
   * WHY THE CHILDREN LIST AND NOT THE ATTACHMENT'S ITEM RECORD. Measured 2026-09-19: the item route
   * answers `404` for a key the library does not hold, which arrives as an unreadable ENDPOINT — the
   * failure an outage produces — while the list says plainly which attachments the item has. The list
   * is also the read this provider already performs for a page, so what a caller listed and what this
   * read checks against are one source of truth rather than two routes that could disagree.
   *
   * @param itemKey - the item the attachment must belong to.
   * @param attachmentKey - the attachment wanted.
   * @param signal - cancellation from the caller.
   * @returns the attachment with its own version, or why it is not one PDF of this item.
   */
  private async readAttachmentRecord(
    itemKey: string,
    attachmentKey: string,
    signal?: AbortSignal,
  ): Promise<{ readonly ok: true; readonly value: ZoteroAttachment } | { readonly ok: false; readonly failure: ZoteroReadFailure }> {
    const attachments = await this.readAttachments(itemKey, signal)
    if (!attachments.ok) return attachments
    const found = attachments.value.find(entry => entry.key === attachmentKey)
    if (found === undefined) {
      return {
        ok: false,
        failure: {
          code: 'attachment-unreadable',
          detail: `'${itemKey}' holds no attachment '${attachmentKey}'`
            + (attachments.value.length === 0
              ? ', and no attachment at all'
              : ` (it holds ${attachments.value.map(entry => entry.key).join(', ')})`),
        },
      }
    }
    // A FILE THIS PROVIDER DOES NOT READ IS NAMED AS ITSELF. Saying "no such attachment" for a page
    // image or a snapshot would send a reader looking for a key that is there.
    if (found.contentType !== 'application/pdf') {
      return {
        ok: false,
        failure: {
          code: 'attachment-unreadable',
          detail: `attachment '${attachmentKey}' of '${itemKey}' is not a PDF (its content type is`
            + ` ${found.contentType ?? 'not declared'})`,
        },
      }
    }
    return { ok: true, value: found }
  }

  /**
   * One attachment's bytes, over the local endpoint's file route.
   *
   * THE ENDPOINT NAMES THE FILE; IT DOES NOT SERVE IT. Measured 2026-09-19: the route answers `302`
   * with a `file://` location and an empty body, and the redirect must be READ rather than followed —
   * an HTTP client that follows it is refused by its own scheme rule. A response that does carry the
   * bytes is used as it arrives, so a library that streams files works through the same call.
   *
   * @param attachmentKey - the attachment whose file is wanted.
   * @param signal - cancellation from the caller.
   * @returns the file's bytes, or why they could not be read.
   */
  private async readAttachmentBytes(
    attachmentKey: string,
    signal?: AbortSignal,
  ): Promise<{ readonly ok: true; readonly value: Uint8Array } | { readonly ok: false; readonly failure: ZoteroReadFailure }> {
    const url = `${this.config.apiBase}/${this.config.localLibraryPath}/items/${attachmentKey}/file`
    let response: Awaited<ReturnType<FetchLike>>
    try {
      response = await this.fetchImpl(url, { signal: this.combined(signal), redirect: 'manual' })
    } catch (error) {
      // ZOTERO NOT RUNNING ARRIVES HERE, the same fact {@link ZoteroProvider.getJson} reports, and it
      // is an OUTAGE rather than an attachment: nothing about this file was established.
      return {
        ok: false,
        failure: {
          code: 'endpoint-unreadable',
          detail: `the file of '${attachmentKey}': ${error instanceof Error ? error.message : String(error)}`,
        },
      }
    }
    if (response.ok) return { ok: true, value: new Uint8Array(await response.arrayBuffer()) }
    const location = response.headers.get('location')
    if (location === null) {
      return {
        ok: false,
        failure: {
          code: 'attachment-unreadable',
          detail: `the file of '${attachmentKey}' answered HTTP ${String(response.status)} without`
            + ' naming where the file is',
        },
      }
    }
    if (!location.startsWith('file:')) {
      return {
        ok: false,
        failure: {
          code: 'attachment-unreadable',
          detail: `the file of '${attachmentKey}' was answered at a '${schemeOf(location)}' location;`
            + ' this provider reads a file on this machine and follows nothing else',
        },
      }
    }
    // THE LOCATION IS RESOLVED, NOT TRUSTED. `fileURLToPath` refuses a location whose host is not
    // this machine, which keeps a file read local for the same reason the endpoint is a deployment
    // setting rather than a request parameter.
    let path: string
    try {
      path = fileURLToPath(location)
    } catch {
      // WHAT REACHES THIS: a location on another host, which `fileURLToPath` refuses, and a location
      // that is malformed. Neither names a file this provider may read, and the location itself is
      // not repeated in the refusal — it names where a machine keeps a file.
      return {
        ok: false,
        failure: {
          code: 'attachment-unreadable',
          detail: `the file of '${attachmentKey}' was named on a host that is not this machine, so it`
            + ' was not read',
        },
      }
    }
    try {
      return { ok: true, value: new Uint8Array(await readFile(path)) }
    } catch (error) {
      // THE PATH IS NOT IN THE DETAIL. It names where THIS machine keeps the file, and a failure
      // sentence travels into records a run's package may carry — the same reason the bibliography
      // writer emits no `file` field. The code (`ENOENT`, `EACCES`) is what tells an operator where
      // to look without putting a disk's layout into the product.
      return {
        ok: false,
        failure: {
          code: 'attachment-unreadable',
          detail: `the file of '${attachmentKey}' could not be read from local storage`
            + ` (${errorCodeOf(error)})`,
        },
      }
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
    let result: unknown
    try {
      result = await tool.execute({ item_key: itemKey, format: 'bibtex' }, { signal: this.combined(signal) })
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
   * The timeout a tool call or request runs under, combined with the caller's cancellation.
   *
   * @param signal - cancellation from the caller, when the caller passed one.
   * @returns the signal to pass on.
   */
  private combined(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    return signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  }

  /**
   * GET one URL as JSON.
   *
   * @param url - the address, built from configuration and a collection or item key.
   * @param signal - cancellation from the caller.
   * @returns the parsed body and the API's reported total, or why the read failed.
   */
  private async getJson(
    url: string,
    signal?: AbortSignal,
  ): Promise<{ readonly ok: true; readonly value: unknown; readonly total?: number } | { readonly ok: false; readonly detail: string }> {
    let response: Awaited<ReturnType<FetchLike>>
    try {
      response = await this.fetchImpl(url, { signal: this.combined(signal) })
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
 * The scheme a location names, for a refusal that must not carry the location itself.
 *
 * A refusal sentence travels into records a run's package may carry, and a `file://` location is a
 * path this machine keeps a file at, so what is reported is the KIND of place the endpoint pointed at
 * rather than the place.
 *
 * @param location - the location an endpoint answered with.
 * @returns the scheme, or that the location states none.
 */
function schemeOf(location: string): string {
  const colon = location.indexOf(':')
  return colon === -1 ? 'no scheme' : location.slice(0, colon)
}

/**
 * The code a filesystem error carries, when it carries one.
 *
 * @param error - the thrown value.
 * @returns the code Node's `fs` sets (`ENOENT`, `EACCES`, …), or that it stated none.
 */
function errorCodeOf(error: unknown): string {
  const code = (error as { readonly code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'no code given'
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
 * How strongly one item answers a topic: how many of its significant words the item states.
 *
 * A CURATED LIST IS ANSWERED BY RELEVANCE, NOT BY CONJUNCTION, and this replaced a rule that demanded
 * EVERY word. A1 passes its topic as a RESEARCH DIRECTION — a sentence — so a conjunctive filter could
 * only ever match an item that restated the whole question, which is nothing at all: measured
 * 2026-09-19, a 27-item collection came back empty for the study it was chosen to support, and the
 * emptiness surfaced four steps later as a held references section.
 *
 * The reasoning that produced the old rule — that matching ANY word would return the whole collection
 * for a generic topic — is sound for a CATALOGUE of millions. A collection is a list somebody
 * assembled, and "all of it bears on my question" is then the honest answer rather than a failure.
 *
 * @param record - one item record.
 * @param topic - the topic as the query states it.
 * @returns how many distinct significant topic words the item states; 0 means it does not bear on it.
 */
function topicScore(record: ZoteroItemRecord, topic: string): number {
  const words = topicWords(topic)
  if (words.length === 0) return 1
  const haystack = `${record.data.title ?? ''} ${record.data.abstractNote ?? ''}`.toLowerCase()
  const tokens = haystack.split(/[^a-z0-9]+/u).filter(token => token.length > 0)
  return words.filter(word =>
    // BOTH HALVES ARE DELIBERATE and the first is not redundant: the topic word `take-over` is split
    // into `take` and `over`, and only `includes` reaches a title that states them as one word
    // (`takeover`) — the added half asks whether a TITLE token opens the topic's word, and `take` does
    // not begin with `takeover`.
    haystack.includes(word) || tokens.some(token => token.length >= 4 && word.startsWith(token))).length
}

/**
 * The words of a topic that say something about it.
 *
 * SHORT WORDS AND STOP WORDS ARE DROPPED because they match everything: a direction asks "how does
 * inserting a single AV into a platoon change risk" and `how`, `does`, `into`, `the` carry no subject.
 * Keeping them would let any item score, which is the failure the old rule was written to avoid.
 *
 * @param topic - the topic as the query states it.
 * @returns the distinct significant words, in the order they appear.
 */
function topicWords(topic: string): ReadonlyArray<string> {
  const seen = new Set<string>()
  return topic.toLowerCase().split(/[^a-z0-9]+/u).filter((word) => {
    if (word.length <= 3 || STOP_WORDS.has(word) || seen.has(word)) return false
    seen.add(word)
    return true
  })
}

/** Words that carry no subject, so a match on one says nothing about relevance. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'about', 'after', 'against', 'also', 'among', 'because', 'been', 'before', 'being', 'between',
  'both', 'does', 'doing', 'down', 'during', 'each', 'from', 'further', 'have', 'having', 'here',
  'into', 'itself', 'more', 'most', 'only', 'other', 'over', 'same', 'should', 'some', 'such',
  'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
  'under', 'until', 'very', 'were', 'what', 'when', 'where', 'which', 'while', 'with', 'would',
  'your',
])

/**
 * The arXiv id an item records in its own fields, when it records one.
 *
 * Zotero has no arXiv field, so a preprint's id is conventionally written in `archiveID` or in
 * `extra`. Only an id the item states is read: deriving one from a URL would be this module's guess,
 * and the id is offered to the citation chain as the item's OWN identifier.
 *
 * @param data - one item's data.
 * @returns the id, when the item states one.
 */
function arxivIdOf(data: ZoteroItemRecord['data']): string | undefined {
  const stated = `${data.archiveID ?? ''}\n${data.extra ?? ''}`
  const match = /(?:arxiv[:\s]*)(\d{4}\.\d{4,5}(?:v\d+)?)/iu.exec(stated)
  return match?.[1]
}

/**
 * One item record as a candidate.
 *
 * @param record - the record.
 * @returns the candidate, carrying the identity the read minted.
 */
function hitOf(record: ZoteroItemRecord): CollectionHit {
  const yearMatch = /(\d{4})/u.exec(record.data.date ?? '')
  const arxivId = arxivIdOf(record.data)
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
    ...(record.data.ISBN === undefined || record.data.ISBN === '' ? {} : { isbn: record.data.ISBN }),
    ...(arxivId === undefined ? {} : { arxivId }),
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

/**
 * One tool reply as an audit record.
 *
 * @param tool - the tool that answered.
 * @param raw - the reply, exactly as it arrived.
 * @returns the record, with the classification left to whoever read the reply.
 */
function auditOf(tool: string, raw: string): Omit<ToolReplyAudit, 'classification'> {
  return {
    tool,
    raw,
    rawSha256: createHash('sha256').update(raw, 'utf8').digest('hex'),
    rawLength: raw.length,
  }
}

/**
 * A reply without the byte-order mark some tools open with.
 *
 * @param raw - the reply, exactly as the tool returned it.
 * @returns the reply with a leading mark removed, and otherwise unchanged.
 */
function stripByteOrderMark(raw: string): string {
  return raw.startsWith(BYTE_ORDER_MARK) ? raw.slice(BYTE_ORDER_MARK.length) : raw
}

/** The first line of a reply, for a refusal that has to name what actually arrived. */
function firstLineOf(raw: string): string {
  const line = raw.replace(/^/u, '').split(/\r?\n/u)[0] ?? ''
  return line.length > 120 ? `${line.slice(0, 120)}…` : line
}

/** What {@link pageTextOf} found: the page's own words, or why the reply is not them. */
type PageText =
  | { readonly ok: true; readonly text: string; readonly totalPages: number }
  | { readonly ok: false; readonly classification: ReplyClassification; readonly detail: string }

/**
 * One page out of a `read_pdf_pages` reply, with the tool's own header removed.
 *
 * THE RULE IS POSITIVE, NOT A LIST OF THINGS TO STRIP. The reply must be the shape the tool is
 * measured to produce — a `# PDF Pages <a>-<b> of …` first line naming THIS page, exactly one
 * `## Page <n>` marker for THIS page, and a `**Total pages in PDF:** <n>` line — and everything after
 * that marker is the page. A reply that does not match is refused rather than stripped, because a
 * list of known-bad preambles is wrong the first time the server writes a new one, and the reply that
 * arrives here when the tool cannot read PDFs at all is an install notice that a stripper would
 * happily hand on as page text.
 *
 * A LEADING BYTE-ORDER MARK IS REMOVED FIRST: the tool's out-of-range notice carries one, measured
 * 2026-09-18, and a leading one would otherwise make every pattern miss.
 *
 * @param raw - the reply, exactly as the tool returned it.
 * @param page - the page that was asked for.
 * @returns the page's words and the attachment's length, or why the reply is not this page.
 */
function pageTextOf(raw: string, page: number): PageText {
  const cleaned = stripByteOrderMark(raw)
  const lines = cleaned.split(/\r?\n/u)
  const header = /^# PDF Pages (\d+)-(\d+) of /u.exec(lines[0] ?? '')
  if (header === null) {
    const range = /^Start page (\d+) is out of range\. PDF has (\d+) pages \((\d+)-(\d+)\)\.$/u.exec(cleaned.trim())
    if (range !== null) {
      return {
        ok: false,
        classification: 'out-of-range',
        detail: `the tool reports that page ${String(page)} is not in the file, which has`
          + ` ${range[2] ?? '?'} page(s)`,
      }
    }
    return {
      ok: false,
      classification: 'error-or-notice',
      detail: 'the reply does not begin with the page route\'s own header, so it is not a page of the'
        + ' attachment',
    }
  }
  if (header[1] !== String(page) || header[2] !== String(page)) {
    return {
      ok: false,
      classification: 'error-or-notice',
      detail: `the reply names pages ${header[1] ?? '?'}-${header[2] ?? '?'} and page ${String(page)} was`
        + ' asked for',
    }
  }
  const marker = `## Page ${String(page)}`
  const markers = lines.filter(line => /^## Page \d+$/u.test(line))
  if (markers.length !== 1 || markers[0] !== marker) {
    return {
      ok: false,
      classification: 'error-or-notice',
      detail: `the reply carries ${String(markers.length)} page marker(s)`
        + ` (${markers.join(', ') || 'none'}) where exactly one '${marker}' was expected`,
    }
  }
  const totalLine = lines.find(line => /^\*\*Total pages in PDF:\*\* \d+$/u.test(line))
  if (totalLine === undefined) {
    return {
      ok: false,
      classification: 'error-or-notice',
      detail: 'the reply states no total page count, so how long the attachment is cannot be recorded',
    }
  }
  const totalPages = Number(/\d+/u.exec(totalLine)?.[0] ?? '0')
  const at = lines.indexOf(marker)
  const text = lines.slice(at + 1).join('\n').replace(/^\n+/u, '')
  if (text.trim() === '') {
    return {
      ok: false,
      classification: 'empty',
      detail: `the reply's page ${String(page)} carries no text, which is a page that was not extracted`
        + ' rather than a page that is blank',
    }
  }
  return { ok: true, text, totalPages }
}
