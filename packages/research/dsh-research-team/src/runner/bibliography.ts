// @deepseek-ai/dsh-research-team — the bibliography a run's citations produce, and who renders it.
//
// WHY AN ENTRY TYPE OF ITS OWN. The registry holds `SourceRecord`s, whose `ref` is whatever namespace
// the source stated and whose `locator` is a record of what the source said about its own volume and
// pages. A bibliography format needs those facts arranged its own way, and it needs a citation key
// that the manuscript and the file agree on. Keeping the arrangement here, in the package that decides
// WHAT is cited, leaves the package that knows HOW to write BibTeX responsible for the syntax alone.
//
// THE ENTRIES COME FROM CITATIONS, NEVER FROM THE RETRIEVAL. `referenceEntriesOf` is handed the
// sources the manuscript actually cited; a writer given the search result set would produce the
// bibliography the alternative produced — twenty-five retrieved works under a body that cites none.

import type { SourceRecord } from './citation-bindings.ts'
import { citeKeyOf } from './citation-bindings.ts'

/**
 * One reference as a bibliography format needs it.
 *
 * `locator` IS COPIED, NOT FLATTENED. A source that states an article number and no page range is a
 * fact about that source; writing its number into a `page` field invents the page range nobody read,
 * and the format's own writer is where the decision to print it as a page belongs.
 */
export interface BibliographyEntry {
  /** The key the manuscript's citations were bound under, which the file must print. */
  readonly citationKey: string
  readonly title: string
  readonly authors: ReadonlyArray<string>
  /** As the source stated it. Absent when the source stated none. */
  readonly year?: number
  /** The container: a journal, a book, a proceedings. */
  readonly venue?: string
  /** The DOI the source stated, when it stated one. */
  readonly doi?: string
  /** Volume, issue, pages or article number, as the source stated them. */
  readonly locator?: Readonly<Record<string, string>>
}

/**
 * Renders bibliography entries as a file a reference manager can read.
 *
 * A CAPABILITY THE DEPLOYMENT SUPPLIES, declared here because this package decides what is cited and
 * therefore knows what the entries are, and implemented elsewhere because a BibTeX writer is a
 * serialization concern with its own dependencies. The same split as `StatementSupportAssessor`: the
 * contract lives where it is consumed.
 */
export interface BibliographyWriter {
  /** Names the implementation and its version, so a written file can say what rendered it. */
  readonly id: string
  /**
   * Render entries as one bibliography file.
   *
   * @param entries - the references the manuscript cites, in cite-key order.
   * @returns the file's text.
   */
  write(entries: ReadonlyArray<BibliographyEntry>): Promise<string>
}

/** The rule version this module's entry mapping is written to. */
export const BIBLIOGRAPHY_RULE_VERSION = 'citation-entries-v1'

/**
 * The references a set of cited sources produces.
 *
 * A SOURCE WITH NO YEAR IS STILL AN ENTRY: the missing field is a fact about the source, and dropping
 * the reference instead would leave a citation marker in the body with nothing behind it. Whether the
 * rendered entry is acceptable is what the E1 manuscript checks decide.
 *
 * @param sources - the sources the manuscript cited, as the registry holds them.
 * @returns one entry per source, in cite-key order.
 */
export function referenceEntriesOf(
  sources: ReadonlyArray<SourceRecord>,
): ReadonlyArray<BibliographyEntry> {
  return sources
    .map((source): BibliographyEntry => ({
      citationKey: citeKeyOf(source),
      title: source.title,
      authors: source.authors,
      ...(source.year === undefined ? {} : { year: source.year }),
      ...(source.venue === undefined ? {} : { venue: source.venue }),
      // ONLY A DOI IS CARRIED AS A DOI. A source identified by ISBN or by its registry's own key is
      // still cited, and writing its identity into a DOI field would print an identifier that
      // resolves to nothing.
      ...(source.ref.kind === 'doi' ? { doi: source.ref.id } : {}),
      ...(source.locator === undefined ? {} : { locator: source.locator }),
    }))
    .sort((left, right) => left.citationKey.localeCompare(right.citationKey))
}

/**
 * Whether one rendered file may be written as a bibliography.
 *
 * A FILE THAT LEAKS A PATH OR DRIFTS FROM THE SOURCES IS NOT A BIBLIOGRAPHY. Two things are checked
 * because both have happened: a `.bib` carrying a local attachment path discloses the machine's
 * layout to whoever the paper is sent to, and an entry whose fields disagree with the registry is a
 * reference the reader cannot reconcile with the citation in the text.
 *
 * @param text - the writer's output.
 * @param entries - the entries it was asked to render.
 * @returns one refusal per problem, or an empty list.
 */
export function checkBibliography(
  text: string,
  entries: ReadonlyArray<BibliographyEntry>,
): ReadonlyArray<string> {
  const refusals: string[] = []
  // A PATH IN A BIBLIOGRAPHY IS ALWAYS A LEAK. A reference manager records where it copied a file
  // from locally; the repository's export already reduces such strings to their final segment, and a
  // `.bib` that still carries a drive letter or a home directory was not put through that.
  const leaked = /[A-Za-z]:\\(?!\\)|\/(?:home|Users)\/[^\s"']+/u.exec(text)
  if (leaked !== null) {
    refusals.push(`the bibliography carries a local path ('${leaked[0]}'), which discloses where this`
      + ' machine keeps its files')
  }
  for (const entry of entries) {
    if (!text.includes(entry.citationKey)) {
      refusals.push(`the bibliography does not carry the key '${entry.citationKey}', so the manuscript's`
        + ' citation names nothing in it')
    }
  }
  if (entries.length > 0 && !/^\s*@/mu.test(text)) {
    refusals.push('the bibliography carries no entries, though the manuscript cites'
      + ` ${String(entries.length)} source(s)`)
  }
  return refusals
}
