// @deepseek-ai/dsh-research-cordis — the entry mapping the live acceptance reads, without the team package.
//
// WHY THIS EXISTS RATHER THAN AN IMPORT. `referenceEntriesOf` lives in `dsh-research-team`, which is
// this package's SIBLING: neither may import the other, so a cordis spec cannot call it. The mapping
// below is the same one — key from the identity, fields the source stated — and it is deliberately
// written out so that a drift between the two shows up as this file's own case failing rather than as
// a shared import hiding it.
//
// THE PRODUCTION PATH DOES NOT USE THIS FILE. The runner-side service calls its own `referenceEntriesOf`
// over the same `SourceRecord` shape; what travels between the two packages is the data, which is what
// the live acceptance is checking.

import type { SourceRegistration } from '@deepseek-ai/dsh-research-core'

/** One reference, as the writer needs it. */
export interface LiveEntry {
  readonly citationKey: string
  readonly title: string
  readonly authors: ReadonlyArray<string>
  readonly year?: number
  readonly venue?: string
  readonly doi?: string
}

/**
 * The key a source is cited under, derived from its identity.
 *
 * THE RUNNER'S `citeKeyOf` IS THE PRODUCTION ONE and it derives the same string from the same field;
 * this stands in for it in a package that cannot import it. The live acceptance asserts the key this
 * produces END TO END — registration, evidence, citation and `.bib` — so a drift between the two
 * would show up as a citation naming nothing.
 *
 * @param source - the source, by its identity.
 * @returns the citation key.
 */
export function citeKeyOfLike(source: { readonly identity: string }): string {
  return `cite-${source.identity}`
}

/**
 * The references one run's registered sources produce.
 *
 * @param sources - the sources the deployment registered.
 * @returns one entry per source, in cite-key order.
 */
export function referenceEntriesOf(sources: ReadonlyArray<SourceRegistration>): ReadonlyArray<LiveEntry> {
  return sources
    .map((source): LiveEntry => ({
      citationKey: `cite-${source.identity}`,
      title: source.title,
      authors: source.authors,
      ...(source.year === undefined ? {} : { year: source.year }),
      ...(source.venue === undefined ? {} : { venue: source.venue }),
      ...(source.ref.kind === 'doi' ? { doi: source.ref.id } : {}),
    }))
    .sort((left, right) => left.citationKey.localeCompare(right.citationKey))
}
