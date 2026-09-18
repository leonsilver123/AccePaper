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
// AN ITEM THAT CANNOT BE CITED IS REPORTED, NOT DROPPED. A record with no DOI cannot enter the
// citation identity chain — the pipeline cites by identifier, and an entry with only a bibliography
// is a citation nothing downstream can check. A catalogue search legitimately skips such records
// among thousands; a CURATED collection of tens is a corpus somebody assembled, and an item in it
// that cannot be cited is a fact about the corpus. So the outcome is `unavailable`, naming the items
// and what would fix it, rather than an `ok` with fewer hits than the collection holds.

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
    const uncitable = read.hits.filter(hit => hit.doi === undefined)
    if (uncitable.length > 0) {
      return {
        status: 'unavailable',
        detail: 'these items in the corpus state no DOI, so they cannot enter the citation identity'
          + ` chain (${uncitable.map(hit => hit.itemKey).join(', ')}) — give each one a DOI, or take it`
          + ' out of the collection this deployment names as its corpus',
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
    ref: {
      kind: 'doi',
      // The DOI without its resolver prefix, which is the form the citation chain compares.
      id: (hit.doi ?? '').replace(/^https?:\/\/(dx\.)?doi\.org\//u, ''),
      title: hit.title,
      authors: hit.authors,
    },
  }
}
