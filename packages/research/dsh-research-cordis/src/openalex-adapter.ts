/**
 * OpenAlex-backed `LiteratureSearchAdapter` — the REAL retrieval channel.
 *
 * The pure tool module (`dsh-research-tools`) deliberately holds no network code:
 * candidate hits enter only through the adapter seam. This file is that seam's
 * real implementation, living in the host adapter package.
 *
 * Contract notes that the pure module's docs require:
 *  - a service failure resolves to `'unavailable'`, never to an empty `'ok'`
 *    (an outage must never be misread as "no literature exists");
 *  - the outcome is a plain, structured-cloneable snapshot;
 *  - `hits` is capped at `maxResults` while `total` reports the pre-cap match
 *    count, so the tool can derive `truncated` itself;
 *  - nothing here asserts a hit is peer-reviewed or that its content is truthful —
 *    a hit is a catalogue record, nothing more.
 *
 * ONE THING THIS ADAPTER REFUSES: `venueTierFilter`. The tier vocabulary maps to
 * a venue-quality partition (CAS / CCF), and no verified partition source is
 * configured, so the filter cannot be honoured. It reports `'unavailable'` with
 * that reason rather than silently returning unfiltered results, which would be a
 * default-pass on a quality claim the caller asked to be enforced.
 */

import type {
  LiteratureHit,
  LiteratureHitId,
  LiteratureQuery,
  LiteratureSearchAdapter,
  LiteratureSearchOutcome,
} from '@deepseek-ai/dsh-research-tools'

/** OpenAlex work record fields this adapter reads (a structural subset). */
interface OpenAlexWork {
  readonly id?: unknown
  readonly title?: unknown
  readonly display_name?: unknown
  readonly doi?: unknown
  readonly publication_year?: unknown
  readonly cited_by_count?: unknown
  readonly primary_location?: {
    readonly source?: { readonly display_name?: unknown } | null
  } | null
  readonly authorships?: ReadonlyArray<{
    readonly author?: { readonly display_name?: unknown } | null
  }> | null
}

export interface OpenAlexAdapterOptions {
  /** Contact address OpenAlex asks for ("polite pool"); improves reliability. */
  readonly mailto?: string
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch
  /** Endpoint override (tests point this at a local stub). */
  readonly baseUrl?: string
}

const DEFAULT_BASE_URL = 'https://api.openalex.org'
/** OpenAlex returns bare DOIs; the citation contract stores the identifier only. */
const DOI_PREFIX = 'https://doi.org/'

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

/** Strip the OpenAlex work URL down to a stable opaque id (`W123...`). */
function workId(work: OpenAlexWork): string | undefined {
  const raw = asString(work.id)
  if (raw === undefined) return undefined
  const tail = raw.slice(raw.lastIndexOf('/') + 1)
  return tail.length > 0 ? tail : undefined
}

function toHit(work: OpenAlexWork): LiteratureHit | undefined {
  const id = workId(work)
  const title = asString(work.title) ?? asString(work.display_name)
  const doiUrl = asString(work.doi)
  // A record with no id, no title, or no resolvable DOI cannot enter the citation
  // identity chain downstream, so it is skipped rather than emitted half-formed.
  if (id === undefined || title === undefined || doiUrl === undefined) return undefined

  const authors = (work.authorships ?? [])
    .map(authorship => asString(authorship?.author?.display_name))
    .filter((name): name is string => name !== undefined)

  return {
    id: id as LiteratureHitId,
    venue: asString(work.primary_location?.source?.display_name) ?? 'unknown venue',
    title,
    ref: {
      kind: 'doi',
      id: doiUrl.startsWith(DOI_PREFIX) ? doiUrl.slice(DOI_PREFIX.length) : doiUrl,
      title,
      authors,
    },
  }
}

/**
 * Real literature retrieval through the OpenAlex catalogue.
 *
 * @remarks Every failure path resolves to `'unavailable'` with an auditable
 * detail; this adapter never throws and never reports an outage as no-match.
 */
export class OpenAlexLiteratureAdapter implements LiteratureSearchAdapter {
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string
  private readonly mailto: string | undefined

  constructor(options: OpenAlexAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.mailto = options.mailto
  }

  async search(query: LiteratureQuery): Promise<LiteratureSearchOutcome> {
    if (query.venueTierFilter !== undefined) {
      return {
        status: 'unavailable',
        detail: 'venueTierFilter needs a verified venue-tier (partition) source; none is configured, so the filter is refused rather than silently ignored',
      }
    }

    const limit = query.maxResults ?? 25
    const url = new URL('/works', this.baseUrl)
    url.searchParams.set('search', query.topic)
    url.searchParams.set('per-page', String(limit))
    if (this.mailto !== undefined) url.searchParams.set('mailto', this.mailto)

    let payload: { meta?: { count?: unknown }; results?: ReadonlyArray<OpenAlexWork> }
    try {
      const response = await this.fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': `accepaper-research/0.1${this.mailto !== undefined ? ` (mailto:${this.mailto})` : ''}`,
        },
      })
      if (!response.ok) {
        return { status: 'unavailable', detail: `OpenAlex responded HTTP ${response.status}` }
      }
      payload = await response.json() as typeof payload
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { status: 'unavailable', detail: `OpenAlex request failed: ${message}` }
    }

    const results = payload.results ?? []
    const hits = results
      .map(toHit)
      .filter((hit): hit is LiteratureHit => hit !== undefined)
      .slice(0, limit)
    // `meta.count` is the catalogue's pre-cap match count; fall back to what we
    // actually saw when the catalogue omits it, never to a fabricated number.
    const reported = payload.meta?.count
    const total = typeof reported === 'number' && Number.isFinite(reported)
      ? Math.max(reported, hits.length)
      : hits.length

    return { status: 'ok', hits, total }
  }
}
