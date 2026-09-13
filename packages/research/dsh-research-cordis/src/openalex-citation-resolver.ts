/**
 * OpenAlex-backed `CitationResolverAdapter` — the REAL bibliographic resolver.
 *
 * The pure core module (`dsh-research-core`) holds the citation identity chain and
 * deliberately performs no network I/O: metadata enters only through the resolver
 * seam. This file is that seam's real implementation.
 *
 * The four resolver statuses are load-bearing, and this adapter maps them from
 * actual HTTP outcomes rather than from a heuristic:
 *  - 200                  -> 'resolved' with the catalogue's own metadata
 *  - 404                  -> 'not_found' — an AUTHORITATIVE miss. The core verifier
 *                            turns this into a hard block (fabricated literature),
 *                            never into 'unverified'.
 *  - 429 / 5xx / transport -> 'temporarily_unavailable' — a service fault must never
 *                            be misread as fabricated literature.
 *  - anything else        -> 'temporarily_unavailable' (unknown is not a verdict)
 *
 * `is_retracted` is read from the record itself; it is a property of the source of
 * truth, never an inference of this adapter's own.
 */

import type { CitationRef, ResolvedCitationMetadata, ResolverOutcome } from '@deepseek-ai/dsh-research-core'

/** OpenAlex work fields this resolver reads (a structural subset). */
interface OpenAlexWorkRecord {
  readonly title?: unknown
  readonly display_name?: unknown
  readonly is_retracted?: unknown
  readonly authorships?: ReadonlyArray<{
    readonly author?: { readonly display_name?: unknown } | null
  }> | null
}

export interface OpenAlexCitationResolverOptions {
  /** Contact address OpenAlex asks for ("polite pool"). */
  readonly mailto?: string
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch
  /** Endpoint override (tests point this at a local stub). */
  readonly baseUrl?: string
  /** Rule/version marker recorded on resolved metadata (auditable). */
  readonly ruleVersion?: string
}

const DEFAULT_BASE_URL = 'https://api.openalex.org'
const DEFAULT_RULE_VERSION = 'openalex-live-v1'

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

/**
 * Real bibliographic resolution through the OpenAlex catalogue.
 *
 * @remarks Only DOI-shaped refs can be resolved here: the catalogue is addressed by
 * DOI, and an arXiv/ISBN/standard identifier has no equivalent lookup in this
 * adapter. Those resolve to 'temporarily_unavailable' rather than to 'not_found',
 * because this adapter cannot know whether such a record exists — reporting a miss
 * it did not establish would surface as fabricated literature.
 */
export class OpenAlexCitationResolver {
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string
  private readonly mailto: string | undefined
  private readonly ruleVersion: string

  constructor(options: OpenAlexCitationResolverOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.mailto = options.mailto
    this.ruleVersion = options.ruleVersion ?? DEFAULT_RULE_VERSION
  }

  /**
   * Resolve one citation reference to its catalogue record.
   *
   * @param ref - the frozen citation ref snapshot supplied by the verifier.
   * @returns the discriminated outcome; never throws, never returns a bare null.
   */
  async resolveMetadata(ref: CitationRef): Promise<ResolverOutcome> {
    if (ref.kind !== 'doi') {
      return {
        status: 'temporarily_unavailable',
        detail: `this resolver addresses the catalogue by DOI; ref kind '${ref.kind}' has no equivalent lookup here`,
      }
    }

    const url = new URL(`/works/doi:${encodeURIComponent(ref.id)}`, this.baseUrl)
    if (this.mailto !== undefined) url.searchParams.set('mailto', this.mailto)

    let response: Response
    try {
      response = await this.fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': `accepaper-research/0.1${this.mailto !== undefined ? ` (mailto:${this.mailto})` : ''}`,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { status: 'temporarily_unavailable', detail: `OpenAlex request failed: ${message}` }
    }

    // An authoritative miss: the catalogue answered that no such record exists.
    if (response.status === 404) {
      return { status: 'not_found', detail: `no OpenAlex record for DOI '${ref.id}'` }
    }
    if (!response.ok) {
      return {
        status: 'temporarily_unavailable',
        detail: `OpenAlex responded HTTP ${response.status}`,
      }
    }

    let record: OpenAlexWorkRecord
    try {
      record = await response.json() as OpenAlexWorkRecord
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { status: 'temporarily_unavailable', detail: `OpenAlex returned unreadable JSON: ${message}` }
    }

    const title = asString(record.title) ?? asString(record.display_name)
    if (title === undefined) {
      // A record we cannot compare against the claimed title cannot support an
      // identity judgment, so it must not be reported as resolved.
      return { status: 'temporarily_unavailable', detail: 'OpenAlex record carries no title' }
    }

    const authors = (record.authorships ?? [])
      .map(authorship => asString(authorship?.author?.display_name))
      .filter((name): name is string => name !== undefined)

    const metadata: ResolvedCitationMetadata = {
      title,
      authors,
      retracted: record.is_retracted === true,
      ruleVersion: this.ruleVersion,
    }
    return { status: 'resolved', metadata }
  }
}
