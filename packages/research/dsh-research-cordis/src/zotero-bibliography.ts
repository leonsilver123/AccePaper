// @deepseek-ai/dsh-research-cordis — a Zotero item's identity, and the bibliography entry it becomes.
//
// WHY THIS IS SEPARATE FROM THE ADAPTER. Three jobs that are different in kind: reading a library
// (a live MCP call, testable only against a running Zotero), deciding whether the BibTeX a tool
// returned is the entry it claims to be (pure, and where the wrong DOI would go unnoticed), and
// naming a source so that a sentence, a citation and a `.bib` entry can be shown to be about the same
// paper (pure, and where a cross-library key collision would otherwise be invisible). Only the first
// needs a server; the other two are checked here.
//
// THE IDENTITY CHAIN IS THE POINT. A Zotero item key is unique WITHIN ONE LIBRARY — `UA5MIGG3` names
// nothing at all without the library it was read from, and two libraries can hold items with the same
// key. So the identity is `library + item key`, and it is that pair this module mints an id from. The
// citation key is a separate matter: it is what the MANUSCRIPT prints, and it is the Citation
// Registry's to assign and to keep unique — this module records the one Zotero suggested and refuses
// an entry whose key does not match the one the run decided on.
//
// WHAT IS NOT DONE HERE. A returned entry is never repaired. A field that is missing, a DOI that
// disagrees with the item's metadata, a title that is not the item's: each is a refusal with its own
// code, because a `.bib` entry that has been quietly fixed is a bibliography nobody can trace back to
// the library it came from. The parser is `citation-js` (maintained, and it decodes BibTeX's TeX
// escapes into real characters); nothing here rewrites nested fields by hand.

import { Cite, plugins } from '@citation-js/core'
import '@citation-js/plugin-bibtex'

/** Which Zotero library an item was read from. The item key alone does not identify one. */
export interface ZoteroLibraryIdentity {
  /** A personal library or a group's. */
  readonly type: 'user' | 'group'
  /** The library's id, as the local API addresses it (`0` for the local user library). */
  readonly id: string
}

/**
 * The internal identity of one source, minted from the library and the item key.
 *
 * NOT THE CITATION KEY, and not the DOI. A citation key is assigned by the run and can be renamed
 * without the source changing; a DOI is absent for some item types and for a preprint whose DOI has
 * not been registered. This string is the pair that does not move.
 */
export type LiteratureId = string & { readonly __brand: 'LiteratureId' }

/**
 * The identity of one source, as the run records it.
 *
 * THE FOUR ARE KEPT TOGETHER ON PURPOSE: this is what makes "the sentence, the citation, the evidence
 * passage and the `.bib` entry are about one paper" a checkable statement rather than a hope.
 */
export interface SourceIdentity {
  readonly library: ZoteroLibraryIdentity
  readonly itemKey: string
  /** Minted from the two above; see {@link LiteratureId}. */
  readonly literatureId: LiteratureId
  /** The item's DOI, when it states one. */
  readonly doi?: string
  /** The key the MANUSCRIPT prints, as the run's citation registry decided it. */
  readonly citationKey: string
}

/**
 * The internal id of a source, minted from its library and item key.
 *
 * BOTH PARTS ARE IN THE STRING because either alone is not an identity: the same item key can name an
 * item in two libraries, and a library id names no item at all.
 *
 * @param library - where the item was read from.
 * @param itemKey - the item's key within that library.
 * @returns the internal id.
 */
export function literatureIdOf(library: ZoteroLibraryIdentity, itemKey: string): LiteratureId {
  return `zotero:${library.type}:${library.id}:${itemKey}` as LiteratureId
}

/** Why a returned entry could not be accepted as the source it claims to be. */
export type BibtexRefusalCode =
  /** The tool returned an error message or something that is not BibTeX at all. */
  | 'bibtex-unparseable'
  /** The entry's key is not the one the run assigned to this source. */
  | 'bibtex-key-mismatch'
  /** A field a citation cannot be rendered without is absent. */
  | 'bibtex-missing-field'
  /** The entry's DOI is not the item's DOI. */
  | 'bibtex-doi-mismatch'
  /** The entry's title is not the item's title. */
  | 'bibtex-title-mismatch'
  /** The entry's year is not the item's year. */
  | 'bibtex-year-mismatch'
  /** The entry carries no author, or an author with no name in it. */
  | 'bibtex-author-unusable'

/** One refusal, naming what was wrong and what was expected. */
export interface BibtexRefusal {
  readonly code: BibtexRefusalCode
  readonly detail: string
}

/** What the tool said about the item, so a returned entry can be checked against it rather than trusted. */
export interface ZoteroItemFacts {
  readonly itemKey: string
  readonly title: string
  /** The item's year, when its date states one. */
  readonly year?: number
  /** The item's DOI, when it states one. */
  readonly doi?: string
}

/** One parsed entry, with the fields a citation is rendered from. */
export interface ParsedCitation {
  /** The citation key the entry carries. */
  readonly citationKey: string
  readonly title: string
  /** `family, given` for a person; the institution's name for a corporate author. */
  readonly authors: ReadonlyArray<string>
  readonly year?: number
  readonly container?: string
  readonly volume?: string
  readonly page?: string
  readonly doi?: string
  /** Every parsed field, for the record — the walk of what the tool actually returned. */
  readonly fields: ReadonlyArray<string>
}

/**
 * A tool reply that is an error message rather than BibTeX.
 *
 * A TOOL THAT FAILED RETURNS ITS REASON AS TEXT, and text saved as a bibliography entry is a citation
 * that resolves to nothing. The markers below are what the servers this repository talks to produce;
 * a reply carrying one is refused by name rather than handed to the parser, whose own error for
 * `Error exporting bibliography: …` would name a syntax position rather than the failure.
 *
 * @param text - what the tool returned.
 * @returns the marker found, or undefined.
 */
function toolErrorMarker(text: string): string | undefined {
  const markers = ['Error exporting', 'Error:', 'validation error for call[', 'Traceback (most recent call last)']
  return markers.find(marker => text.includes(marker))
}

/**
 * Parse one returned entry and check it is the source the item metadata describes.
 *
 * @param input - the tool's returned text, the item's own facts, and the key the run assigned.
 * @returns the parsed citation, or the refusals that stopped it.
 */
export function checkBibtexEntry(input: {
  readonly text: string
  readonly item: ZoteroItemFacts
  readonly citationKey: string
}): { readonly ok: true; readonly citation: ParsedCitation } | { readonly ok: false; readonly refusals: ReadonlyArray<BibtexRefusal> } {
  const refusals: BibtexRefusal[] = []
  const marker = toolErrorMarker(input.text)
  if (marker !== undefined) {
    return {
      ok: false,
      refusals: [{
        code: 'bibtex-unparseable',
        detail: `the tool returned a failure rather than an entry ('${marker}'): a message saved as a`
          + ' bibliography entry is a citation that resolves to nothing',
      }],
    }
  }
  let entries: ReadonlyArray<{ id?: string; [field: string]: unknown }>
  try {
    entries = new Cite(input.text).data
  } catch (error) {
    return {
      ok: false,
      refusals: [{
        code: 'bibtex-unparseable',
        detail: `the returned text is not BibTeX: ${error instanceof Error ? error.message : String(error)}`,
      }],
    }
  }
  if (entries.length === 0) {
    return {
      ok: false,
      refusals: [{ code: 'bibtex-unparseable', detail: 'the returned text parsed to no entries' }],
    }
  }
  if (entries.length > 1) {
    // ONE ITEM, ONE ENTRY. A reply carrying several would make "which entry is this source" a guess.
    return {
      ok: false,
      refusals: [{
        code: 'bibtex-unparseable',
        detail: `the tool returned ${String(entries.length)} entries for one item`,
      }],
    }
  }
  const entry = entries[0] ?? {}
  const citationKey = typeof entry.id === 'string' ? entry.id : ''
  if (citationKey !== input.citationKey) {
    refusals.push({
      code: 'bibtex-key-mismatch',
      detail: `the entry is keyed '${citationKey}' and this run assigned '${input.citationKey}' — the key`
        + ' the manuscript prints is the registry\'s to decide, and a renamed entry would cite a'
        + ' source under a name nothing else uses',
    })
  }
  const authors = authorsOf(entry)
  if (authors.length === 0) {
    refusals.push({
      code: 'bibtex-author-unusable',
      detail: 'the entry names no usable author: a citation without one cannot be rendered, and an'
        + ' author parsed from an empty field is not a name',
    })
  }
  const title = typeof entry.title === 'string' ? entry.title : ''
  if (title.trim() === '') {
    refusals.push({
      code: 'bibtex-missing-field',
      detail: 'the entry states no title',
    })
  } else if (normalise(title) !== normalise(input.item.title)) {
    // COMPARED, NOT REPLACED. A title that differs from the item's is reported rather than overwritten
    // with the library's: the two disagree, and which is right is not this check's to decide.
    refusals.push({
      code: 'bibtex-title-mismatch',
      detail: `the entry's title ('${title}') is not the item's ('${input.item.title}')`,
    })
  }
  const year = yearOf(entry)
  if (input.item.year !== undefined && year !== undefined && year !== input.item.year) {
    refusals.push({
      code: 'bibtex-year-mismatch',
      detail: `the entry says ${String(year)} and the item says ${String(input.item.year)}`,
    })
  }
  if (input.item.doi !== undefined) {
    const doi = typeof entry.DOI === 'string' ? entry.DOI : ''
    if (normaliseDoi(doi) !== normaliseDoi(input.item.doi)) {
      refusals.push({
        code: 'bibtex-doi-mismatch',
        detail: `the entry's DOI ('${doi}') is not the item's ('${input.item.doi}')`,
      })
    }
  }
  if (refusals.length > 0) return { ok: false, refusals }
  return {
    ok: true,
    citation: {
      citationKey,
      title,
      authors,
      ...(year === undefined ? {} : { year }),
      ...(typeof entry['container-title'] === 'string' ? { container: entry['container-title'] } : {}),
      ...(typeof entry.volume === 'string' ? { volume: entry.volume } : {}),
      ...(typeof entry.page === 'string' ? { page: entry.page } : {}),
      ...(typeof entry.DOI === 'string' ? { doi: entry.DOI } : {}),
      fields: Object.keys(entry).sort(),
    },
  }
}

/**
 * The authors of a parsed entry, each as one printable name.
 *
 * AN INSTITUTIONAL AUTHOR ARRIVES AS `literal` AND IS KEPT WHOLE. Splitting it into a family and a
 * given name would print `World Health Organization` as `Organization, World Health` — a name no
 * reader of that citation would recognise.
 *
 * @param entry - one parsed entry.
 * @returns the names, in the entry's order.
 */
function authorsOf(entry: Record<string, unknown>): ReadonlyArray<string> {
  const authors = entry.author
  if (!Array.isArray(authors)) return []
  return authors.flatMap((raw): string[] => {
    if (raw === null || typeof raw !== 'object') return []
    const { given, family, literal } = raw as { given?: unknown; family?: unknown; literal?: unknown }
    if (typeof literal === 'string' && literal.trim() !== '') return [literal.trim()]
    const parts = [family, given].filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    return parts.length === 0 ? [] : [parts.map(part => part.trim()).join(', ')]
  })
}

/** The year a parsed entry states, when its date states one. */
function yearOf(entry: Record<string, unknown>): number | undefined {
  const issued = entry.issued as { readonly 'date-parts'?: ReadonlyArray<ReadonlyArray<number>> } | undefined
  const year = issued?.['date-parts']?.[0]?.[0]
  return typeof year === 'number' ? year : undefined
}

/**
 * Text compared in a way that ignores what a reader would not notice.
 *
 * CASE, RUNS OF WHITESPACE AND THE BRACES BIBTEX USES FOR CAPITALISATION ARE NOT DIFFERENCES between
 * the same title; a word is.
 *
 * @param text - the text.
 * @returns the comparable form.
 */
function normalise(text: string): string {
  return text.replace(/[{}]/gu, '').replace(/\s+/gu, ' ').trim().toLowerCase()
}

/**
 * A DOI in the form two sources can be compared in.
 *
 * @param doi - the DOI as written.
 * @returns the comparable form.
 */
function normaliseDoi(doi: string): string {
  return doi.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//u, '')
}

/**
 * A `.bib` rendering of the entries a run accepted.
 *
 * RENDERED BY THE PARSER'S OWN WRITER, from the parsed structure. That is what keeps machine-local
 * fields out of the deliverable: a `file` field naming where this machine keeps the PDF is in the
 * tool's reply and is NOT among the fields the writer emits, so it is absent by construction rather
 * than by a pattern that has to keep up with the formats. Nothing here rewrites a nested field.
 *
 * @param citations - the parsed entries, in the order the package should carry them.
 * @returns the bibliography text.
 */
export function renderBibtex(citations: ReadonlyArray<ParsedCitation>): string {
  // THE KEY THE RUN DECIDED IS THE KEY THE FILE MUST PRINT, AND THE WRITER WILL NOT DO IT UNASKED.
  //
  // Measured 2026-09-18, against the installed plugin: `LABEL.toSource` uses the label it is given
  // only when `isLabelSafe` accepts it, and `isLabelSafe` rejects anything matching
  // `/[ -/:-@[-^]…/` — which includes `-`, `.` and `/`. EVERY cite key
  // this run mints is `cite-<identifier>` and every DOI contains all three, so the check rejected all
  // of them and the writer fell through to inventing a label from author and year: the file carried
  // `@article{Roche2020What,` where the manuscript cites `cite-10.1016/j.aap.2020.105588`. It parsed,
  // it looked like a bibliography, and the citation in the text named nothing in it.
  //
  // `checkLabel: false` is the plugin's own configuration point for exactly this, and `useIdAsLabel`
  // makes the fallback the id rather than a label built from the entry's fields. A DOI is a legal
  // BibTeX key — BibTeX reserves `,`, `{`, `}`, `(` and `)` and whitespace, none of which appears in
  // one — and it is what reference managers themselves key DOIs by.
  configureBibtexLabels()
  const entries = citations.map(citation => ({
    id: citation.citationKey,
    'citation-key': citation.citationKey,
    type: 'article-journal',
    title: citation.title,
    author: citation.authors.map(name => nameOf(name)),
    ...(citation.year === undefined ? {} : { issued: { 'date-parts': [[citation.year]] } }),
    ...(citation.container === undefined ? {} : { 'container-title': citation.container }),
    ...(citation.volume === undefined ? {} : { volume: citation.volume }),
    ...(citation.page === undefined ? {} : { page: citation.page }),
    ...(citation.doi === undefined ? {} : { DOI: citation.doi }),
  }))
  return plugins.output.format('bibtex', entries)
}

/**
 * Tell the BibTeX writer to print the label it was given, rather than inventing one.
 *
 * THE PLUGIN'S OWN CONFIGURATION POINT, set once. It is a module-level setting on the plugin rather
 * than an argument to the writer, which is why this cannot be a parameter: the alternative would be
 * rewriting the rendered text, and a deliverable repaired by string surgery is a deliverable whose
 * correctness depends on the shape of a label this repository does not control.
 *
 * Idempotent, and safe to call from every render.
 */
function configureBibtexLabels(): void {
  const config = plugins.config.get('@bibtex') as {
    format: { checkLabel: boolean; useIdAsLabel: boolean }
  }
  config.format.checkLabel = false
  config.format.useIdAsLabel = true
}

/**
 * One printable name back into the structure the writer expects.
 *
 * A name that carries a comma is `family, given` — the form {@link authorsOf} produced — and one that
 * does not is an institution, which the writer must be told is a literal or it will invent a surname.
 *
 * @param name - the printable name.
 * @returns the parsed name.
 */
function nameOf(name: string): Record<string, string> {
  const comma = name.indexOf(',')
  return comma < 0
    ? { literal: name }
    : { family: name.slice(0, comma).trim(), given: name.slice(comma + 1).trim() }
}
