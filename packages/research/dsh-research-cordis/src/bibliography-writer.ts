// @deepseek-ai/dsh-research-cordis — the deployment's BibTeX writer.
//
// WHY A WRITER AND NOT STRING CONCATENATION. A `.bib` assembled by joining fields is a file whose
// correctness depends on this repository's escaping being right for every character a title can
// contain — braces, backslashes, accents, the ampersand in a publisher's name — and it fails by
// producing a file that PARSES while saying something different. `@citation-js` already owns that
// problem here: it reads the library's BibTeX back in `zotero-bibliography.ts`. This module is the
// other direction, and it renders from the parsed structure rather than from text.
//
// AND IT IS THE HALF THAT KEEPS MACHINE-LOCAL FIELDS OUT. The library's own entry carries a `file`
// field naming where this machine keeps the PDF. The writer below emits a fixed set of fields and
// `file` is not among them, so a local path is absent by construction rather than by a pattern that
// has to keep up with what a reference manager decides to store.

import { renderBibtex } from './zotero-bibliography.ts'
import type { ParsedCitation } from './zotero-bibliography.ts'

/**
 * One reference, as the runner-side seam states it.
 *
 * A STRUCTURAL TWIN OF THE RUNNER'S `BibliographyEntry`, spelled out rather than imported because
 * `dsh-research-team` is not a dependency of this package — the two are siblings. The fields are the
 * ones a reference is rendered from and nothing else; a field added on the runner's side without one
 * here simply does not reach the file, which is the failure direction to prefer.
 */
export interface BibliographyEntryLike {
  readonly citationKey: string
  readonly title: string
  readonly authors: ReadonlyArray<string>
  readonly year?: number
  readonly venue?: string
  readonly doi?: string
  readonly locator?: Readonly<Record<string, string>>
}

/**
 * The `.bib` writer the runner-side seam consumes, as this package offers it.
 *
 * THE RUNNER CHECKS `id` AND `write`, and this class is what a deployment publishes on the research
 * service under `bibliographyWriter`.
 */
export interface BibliographyWriterLike {
  readonly id: string
  write(entries: ReadonlyArray<BibliographyEntryLike>): Promise<string>
}

/**
 * The keys a source's own locator may use, and the field each becomes.
 *
 * A SOURCE THAT STATES AN ARTICLE NUMBER KEEPS IT AS ONE. The locator is what the source said; the
 * bibliography format has one field for "where in the container", so these are the keys that map onto
 * it and anything else is left out rather than written into a field it does not belong in.
 */
const LOCATOR_FIELDS: ReadonlyArray<readonly [string, 'volume' | 'issue' | 'page']> = [
  ['volume', 'volume'],
  ['issue', 'issue'],
  ['page', 'page'],
  ['pages', 'page'],
]

/**
 * Renders a run's references as BibTeX, through the parser's own writer.
 *
 * @remarks Stateless: the same entries always render to the same text, which is what lets the caller
 * check the file it is about to write.
 */
export class CitationJsBibliographyWriter implements BibliographyWriterLike {
  readonly id = 'citation-js-bibtex-v1'

  /**
   * Render entries as one `.bib` file.
   *
   * @param entries - the references the manuscript cites.
   * @returns the file's text, with one entry per citation key.
   */
  write(entries: ReadonlyArray<BibliographyEntryLike>): Promise<string> {
    // ONE TRAILING NEWLINE, AND EXACTLY ONE. The underlying writer ends its output with a blank line,
    // which is a well-formed `.bib` and fails this repository's own byte-level rule for a text file —
    // so the file is normalized HERE, where the text is produced, rather than by every caller that
    // writes one. An empty entry list renders to an empty string rather than to a lone newline.
    const rendered = renderBibtex(entries.map(citationOf)).replace(/\n+$/u, '')
    return Promise.resolve(rendered === '' ? '' : `${rendered}\n`)
  }
}

/**
 * One reference as the writer's parsed structure.
 *
 * @param entry - the reference.
 * @returns the structure `renderBibtex` reads.
 */
function citationOf(entry: BibliographyEntryLike): ParsedCitation {
  const locator = entry.locator ?? {}
  const mapped = LOCATOR_FIELDS.flatMap(([from, to]): ReadonlyArray<readonly [string, string]> => {
    const value = locator[from]
    return value === undefined || value === '' ? [] : [[to, value]]
  })
  const fieldOf = new Map(mapped)
  return {
    citationKey: entry.citationKey,
    title: entry.title,
    authors: entry.authors,
    ...(entry.year === undefined ? {} : { year: entry.year }),
    ...(entry.venue === undefined ? {} : { container: entry.venue }),
    ...(fieldOf.get('volume') === undefined ? {} : { volume: fieldOf.get('volume') as string }),
    ...(fieldOf.get('page') === undefined ? {} : { page: fieldOf.get('page') as string }),
    ...(entry.doi === undefined ? {} : { doi: entry.doi }),
    // THE FIELDS ACTUALLY RENDERED, for the record. A reader comparing the entry with the source can
    // see which of the source's own fields this file carries and which it does not.
    fields: ['citationKey', 'title', 'authors', ...[...fieldOf.keys()], ...(entry.year === undefined ? [] : ['year']),
      ...(entry.venue === undefined ? [] : ['container']), ...(entry.doi === undefined ? [] : ['doi'])],
  }
}
