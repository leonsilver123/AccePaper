// @deepseek-ai/dsh-research-cordis — the configured Zotero collection, as the pipeline's corpus.
//
// WHY THIS EXISTS. `A1-landscape` asks a `LiteratureSearchAdapter` what the field holds. A deployment
// whose evidence is a curated Zotero collection answers that question from that collection, and this
// adapter is the shape it answers in — the same seam the OpenAlex adapter fills, so the pipeline does
// not learn a second way to receive literature.
//
// IT IS NOT A SEARCH ENGINE AND DOES NOT PRETEND TO BE ONE. A catalogue has relevance ranking and
// millions of records; a collection is a list somebody chose. The topic is matched against titles and
// abstracts as a keyword filter and the outcome says so, because a caller that read this as a search
// would believe the corpus had been searched rather than filtered.
//
// A DOI IS NOT A CONDITION OF CITABILITY. This adapter refused records without one until 2026-09-18,
// on the reasoning that the pipeline cites by identifier. That was wrong twice over: a DOI is an
// EXTERNAL identifier, not the source's identity — the identity is the library and the item key, and
// this module already mints it — and a legitimate work without one (a book, a standard, a report, a
// preprint Zotero never matched) is citable in every style a journal publishes. What the citation
// chain needs is an identifier it can record and a claimed title and authors it can check, so the ref
// carries whichever namespace the RECORD ITSELF establishes, and `unknown` with the internal identity
// when it establishes none. The DOI is still read, and still travels, for external identity,
// cross-checking and de-duplication — as one identifier among others, never as the key.
//
// AN ITEM THAT CANNOT BE IDENTIFIED IS REPORTED, NOT DROPPED. A record with no title is not a source
// any citation style can name and no identity check can compare against, so it stops the read and is
// named. That is an IMPLEMENTATION LIMIT — what this adapter currently requires — and the refusal
// says so rather than presenting it as a rule about what may be cited.

import type {
  LiteratureHit, LiteratureHitId, LiteratureQuery, LiteratureSearchAdapter, LiteratureSearchOutcome,
} from '@deepseek-ai/dsh-research-tools'

import type { CollectionHit, ZoteroProvider } from './zotero-provider.ts'

/** What the adapter reads, and which collection is the corpus. */
export interface ZoteroLiteratureConfig {
  /** The collection whose members are this deployment's corpus. */
  readonly collectionKey: string
  /** The venue name to record for an item whose record states none. */
  readonly fallbackVenue?: string
}

/** The venue recorded for an item whose own record states none. */
const DEFAULT_VENUE = 'the configured literature collection'

/**
 * The pipeline's literature seam, over one Zotero collection.
 *
 * @remarks Every failure is reported as `unavailable` with its reason: this adapter never resolves
 * with an empty `ok` to express a problem, because "the field holds nothing" and "the library could
 * not be read" are the two facts the pipeline must never confuse.
 */
export class ZoteroLiteratureAdapter implements LiteratureSearchAdapter {
  private readonly provider: ZoteroProvider
  private readonly config: ZoteroLiteratureConfig

  /**
   * @param provider - the library to read.
   * @param config - which collection is the corpus.
   */
  constructor(provider: ZoteroProvider, config: ZoteroLiteratureConfig) {
    this.provider = provider
    this.config = config
  }

  /**
   * Answer one literature query from the configured collection.
   *
   * @param query - the topic to filter by, and how many hits are wanted.
   * @returns the candidates, or why the collection could not answer.
   */
  async search(query: LiteratureQuery): Promise<LiteratureSearchOutcome> {
    if (query.venueTierFilter !== undefined) {
      // The same refusal the catalogue adapter makes, for the same reason: a venue tier is a fact
      // about a venue's standing, and a collection covers whatever the operator put in it.
      return {
        status: 'unavailable',
        detail: 'venueTierFilter needs a verified venue-tier source; a curated collection states no'
          + ' tiers, so the filter is refused rather than silently ignored',
      }
    }
    const read = await this.provider.readCandidates({
      topic: query.topic,
      collectionKey: this.config.collectionKey,
      ...(query.maxResults === undefined ? {} : { maxResults: query.maxResults }),
    })
    if (!read.ok) {
      return { status: 'unavailable', detail: `[${read.failure.code}] ${read.failure.detail}` }
    }
    const untitled = read.hits.filter(hit => hit.title.trim() === '')
    if (untitled.length > 0) {
      return {
        status: 'unavailable',
        detail: 'these items in the corpus state no title, so nothing can name them in a reference list'
          + ` or check an identity against them (${untitled.map(hit => hit.itemKey).join(', ')}) — give`
          + ' each one a title, or take it out of the collection this deployment names as its corpus.'
          + ' This is a limit of what this adapter requires, not a rule about what may be cited',
      }
    }
    return {
      status: 'ok',
      hits: read.hits.map(hit => hitOf(hit, this.config.fallbackVenue ?? DEFAULT_VENUE)),
      // THE COLLECTION'S OWN COUNT, before the cap: the seam reads `total > hits.length` as "more were
      // available", and that is true here — the collection holds more than this call returned.
      total: read.total,
    }
  }
}

/**
 * One collection item as a pipeline hit.
 *
 * THE HIT ID IS THE SOURCE'S INTERNAL IDENTITY, not a per-query counter: a source read again in
 * another run, or from another section, has to be recognisable as the same source, and an ordinal
 * would make two readings of one paper look like two papers.
 *
 * @param hit - the candidate as the provider read it.
 * @param fallbackVenue - the venue to record when the item states none.
 * @returns the hit.
 */
function hitOf(hit: CollectionHit, fallbackVenue: string): LiteratureHit {
  return {
    id: hit.literatureId as unknown as LiteratureHitId,
    venue: hit.venue ?? fallbackVenue,
    title: hit.title,
    ...(hit.year === undefined ? {} : { year: hit.year }),
    ref: refOf(hit),
  }
}

/**
 * The citation ref for one candidate, in the namespace the RECORD ITSELF establishes.
 *
 * THE ORDER IS THE ONE THE NAMESPACES ARE WORTH, not an order of preference for citing: a DOI is
 * the identifier most catalogues cross-check, an ISBN names a book on its own, and an arXiv id names
 * a preprint. A record that states none of them is still a source — a report, a working paper, a
 * dataset — and it is identified by what this run's registry minted for it, which is the same
 * identity the sentence, the citation and the bibliography share.
 *
 * @param hit - the candidate as the provider read it.
 * @returns the ref, carrying its claimed title and authors so the identity check has something to
 *   compare against.
 */
function refOf(hit: CollectionHit): LiteratureHit['ref'] {
  const doi = hit.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//u, '')
  const identified = doi !== undefined && doi !== ''
    ? { kind: 'doi' as const, id: doi }
    : hit.isbn !== undefined && hit.isbn !== ''
      ? { kind: 'isbn' as const, id: hit.isbn }
      : hit.arxivId !== undefined && hit.arxivId !== ''
        ? { kind: 'arxiv' as const, id: hit.arxivId }
        // NO EXTERNAL NAMESPACE: the source's own identity is the identifier, under `unknown` because
        // this run established no namespace for it. That is a statement about the identifier, never
        // about whether the work may be cited.
        : { kind: 'unknown' as const, id: String(hit.literatureId) }
  return { kind: identified.kind, id: identified.id, title: hit.title, authors: hit.authors }
}
