/**
 * OpenAlex-backed `LiteratureSearchAdapter` — the REAL retrieval channel.
 *
 * The pure tool module (`dsh-research-tools`) deliberately holds no network code:
 * candidate hits enter only through the adapter seam. This file is that seam's
 * real implementation, living in the host adapter package.
 *
 * Contract notes that the pure module's docs require:
 *  - a service failure resolves to `'unavailable'`, never to an empty `'ok'`
 *    (an outage must never be misread as "no literature exists"), and a `200`
 *    whose body is not a results envelope is a service failure in exactly that
 *    sense: the catalogue never answered the question that was asked;
 *  - the outcome is a plain, structured-cloneable snapshot;
 *  - `hits` is capped at `maxResults` while `total` reports the pre-cap match
 *    count, so the tool can derive `truncated` itself;
 *  - a work the catalogue holds without a DOI is a hit, not a casualty: a DOI is
 *    an external identifier, and the work id OpenAlex minted is the identity this
 *    adapter records and cites under `unknown` (see `refOf` in the Zotero
 *    literature adapter, which states the same reasoning for a collection item);
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

/** How the OpenAlex literature adapter reaches the catalogue. */
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

/**
 * Read a publication year, refusing anything that is not a plausible one.
 *
 * The catalogue states this as a number; a JSON round trip through some proxies states it as a
 * numeric string. Anything else — a null, a range, a year outside what a citation can carry — is
 * treated as NOT STATED rather than coerced, because a coerced year is a wrong citation.
 */
function asYear(value: unknown): number | undefined {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isInteger(parsed)) return undefined
  return parsed >= 1000 && parsed <= 9999 ? parsed : undefined
}

/** Strip the OpenAlex work URL down to a stable opaque id (`W123...`). */
function workId(work: OpenAlexWork): string | undefined {
  const raw = asString(work.id)
  if (raw === undefined) return undefined
  const tail = raw.slice(raw.lastIndexOf('/') + 1)
  return tail.length > 0 ? tail : undefined
}

/**
 * What arrived where a results envelope belongs, for the refusal to name.
 *
 * WHICH KIND OF WRONG ARRIVED IS THE ACTIONABLE PART: a proxy's error object, a bare array, and a
 * JSON scalar mean different things to whoever has to fix the deployment, and a refusal that said
 * only "unexpected body" would send all three readers to the same place. `Object.keys` throws on a
 * non-object, so the type is stated for those instead.
 */
function arrivedAs(payload: unknown): string {
  if (payload === null) return 'null'
  if (Array.isArray(payload)) return 'a JSON array'
  if (typeof payload !== 'object') return `a JSON ${typeof payload}`
  const keys = Object.keys(payload)
  return keys.length === 0 ? 'an object with no keys' : `an object with keys: ${keys.join(', ')}`
}

function toHit(work: OpenAlexWork): LiteratureHit | undefined {
  const id = workId(work)
  const title = asString(work.title) ?? asString(work.display_name)
  // A RECORD NOTHING CAN NAME IS SKIPPED: with no id there is no identity to record, and with no
  // title no citation style can state it and no identity check can compare against it. That is what
  // this adapter requires, and it says so rather than emitting a half-formed hit.
  if (id === undefined || title === undefined) return undefined

  const authors = (work.authorships ?? [])
    .map(authorship => asString(authorship?.author?.display_name))
    .filter((name): name is string => name !== undefined)
  // The record declares this field and used not to read it, so every reference the pipeline
  // exported carried a venue, authors and a DOI and no year — a citation a reader cannot place.
  const year = asYear(work.publication_year)
  const doiUrl = asString(work.doi)

  return {
    id: id as LiteratureHitId,
    venue: asString(work.primary_location?.source?.display_name) ?? 'unknown venue',
    title,
    ...(year === undefined ? {} : { year }),
    ref: doiUrl === undefined
      // A DOI IS AN EXTERNAL IDENTIFIER, NOT THE SOURCE'S IDENTITY, and this adapter used to treat
      // one as a condition of citability: a work the catalogue holds without a DOI was dropped here,
      // so "this adapter cannot name it externally" reached the pipeline as "no such literature".
      // The OpenAlex work id is the identity the SOURCE'S OWN registry minted for it, and under
      // `unknown` it is the identifier this run records, cites and checks against — the same
      // reasoning `refOf` in ./zotero-literature-adapter.ts states for a collection item.
      ? { kind: 'unknown', id, title, authors }
      : {
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
 * A `200` whose body is not a results envelope is one of those failures: see
 * {@link OpenAlexLiteratureAdapter.search}.
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

    // THE BODY IS READ AS WHAT IT IS, not as what a successful search would have carried: the
    // envelope below is checked before anything is read out of it, because the response JSON is a
    // wire boundary and a `200` only says the request arrived.
    let payload: unknown
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
      payload = await response.json()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { status: 'unavailable', detail: `OpenAlex request failed: ${message}` }
    }

    // A 200 IS NOT AN ANSWER UNTIL THE BODY IS ONE. A proxy rewrite, a rate-limit notice and a schema
    // change all arrive as HTTP 200, and `payload.results ?? []` read every one of them as
    // `{ hits: [], total: 0 }` — the exact value the pipeline reads as "the catalogue genuinely holds
    // nothing". OpenAlex answers a search with both a `results` array and a `meta` object, so a body
    // without them is a response this adapter cannot read, and it says which one arrived rather than
    // answering on the catalogue's behalf.
    const envelope = payload as { readonly meta?: unknown; readonly results?: unknown } | null
    if (
      envelope === null
      || typeof envelope !== 'object'
      || !Array.isArray(envelope.results)
      || envelope.meta === null
      || typeof envelope.meta !== 'object'
    ) {
      return {
        status: 'unavailable',
        detail: `OpenAlex answered HTTP 200 with ${arrivedAs(payload)} where a results envelope`
          + ' belongs (a search answer carries a `results` array and a `meta` object). A 200 that is'
          + ' not a results envelope is NOT a no-match: nothing in it states what the catalogue'
          + ' holds, so reading it as zero matches would report a rewritten, rate-limited or'
          + ' redesigned answer as an empty literature',
      }
    }

    const results = envelope.results as ReadonlyArray<OpenAlexWork>
    const hits = results
      .map(toHit)
      .filter((hit): hit is LiteratureHit => hit !== undefined)
      .slice(0, limit)
    // `meta.count` is the catalogue's pre-cap match count; fall back to what we
    // actually saw when the catalogue omits it, never to a fabricated number.
    const reported = (envelope.meta as { readonly count?: unknown }).count
    const total = typeof reported === 'number' && Number.isFinite(reported)
      ? Math.max(reported, hits.length)
      : hits.length

    return { status: 'ok', hits, total }
  }
}
