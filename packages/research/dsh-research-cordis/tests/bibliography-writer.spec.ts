/**
 * The `.bib` a run hands a journal: parseable, keyed the way the manuscript cites, and free of this
 * machine's paths.
 *
 * PARSING IS NOT THE WHOLE TEST, and the cases below are the ones that distinguish the two. A file
 * can parse and carry the wrong key, or parse and disclose where the PDF lives, or parse and hold a
 * truncated title — all three have been produced by hand-rolled writers, which is why this one renders
 * from the parsed structure through the same library that reads BibTeX elsewhere in this package.
 */
import { describe, expect, it } from 'vitest'
import { checkBibtexEntry } from '../src/zotero-bibliography.ts'
import type { ZoteroItemFacts } from '../src/zotero-bibliography.ts'
import { CitationJsBibliographyWriter } from '../src/bibliography-writer.ts'
import type { BibliographyEntryLike } from '../src/bibliography-writer.ts'

/** One reference, as the runner-side seam hands it over. */
function entry(overrides: Partial<BibliographyEntryLike> = {}): BibliographyEntryLike {
  return {
    citationKey: 'cite-10.1016/j.aap.2020.105588',
    title: 'What happens when drivers of automated vehicles take over control in critical brake situations',
    authors: ['Roche, Fabienne', 'Thüring, Manfred', 'Trukenbrod, Anna K.'],
    year: 2020,
    venue: 'Accident Analysis and Prevention',
    doi: '10.1016/j.aap.2020.105588',
    locator: { volume: '144', page: '105588' },
    ...overrides,
  }
}

/**
 * What the item behind one entry states, so the product's own reader can check the rendered entry.
 *
 * READ BACK WITH THE PRODUCT'S OWN PARSER, not with a second import of the same library: the claim is
 * that a file this writer renders is a file the citation chain can read, and a test that parsed it
 * with its own private `Cite` would pass for a file the product itself refuses.
 *
 * @param entry - the reference that was rendered.
 * @returns the facts the entry must agree with.
 */
function factsOf(entry: BibliographyEntryLike): ZoteroItemFacts {
  return {
    itemKey: 'UA5MIGG3',
    title: entry.title,
    ...(entry.year === undefined ? {} : { year: entry.year }),
    ...(entry.doi === undefined ? {} : { doi: entry.doi }),
  }
}

/**
 * Read one rendered entry back, or report why the product's own reader refused it.
 *
 * @param text - the rendered file.
 * @param entry - the reference it was rendered from.
 * @returns the parsed citation.
 */
function readBack(text: string, entry: BibliographyEntryLike): {
  readonly citationKey: string
  readonly title: string
  readonly fields: ReadonlyArray<string>
} {
  const checked = checkBibtexEntry({ text, item: factsOf(entry), citationKey: entry.citationKey })
  if (!checked.ok) throw new Error(`the rendered entry was refused: ${JSON.stringify(checked.refusals)}`)
  return checked.citation
}

describe('rendering a run\'s references as BibTeX', () => {
  it('cites under the key the run decided, not one the writer invents', async () => {
    // MEASURED 2026-09-18: the writer ignores `id` and, without `citation-key`, invents a label from
    // author and title — an entry this run keyed `cite-…` came back as `@article{Roche2020title,`. The
    // manuscript prints the registry's key, so a renamed entry cites a source under a name nothing
    // else in the paper uses.
    const text = await new CitationJsBibliographyWriter().write([entry()])
    expect(readBack(text, entry()).citationKey).toBe('cite-10.1016/j.aap.2020.105588')
    expect(text).not.toContain('Roche2020')
  })

  it('carries the fields the source stated', async () => {
    const text = await new CitationJsBibliographyWriter().write([entry()])
    expect(readBack(text, entry()).fields).toContain('container-title')
    expect(text).toContain('Accident Analysis and Prevention')
    expect(text).toContain('105588')
    expect(text).toContain('2020')
  })

  it('carries no local path, because a path is never among the fields it emits', async () => {
    // ABSENT BY CONSTRUCTION, not by a pattern. A reference manager's own entry holds a `file` field
    // naming where this machine keeps the PDF; this writer emits a fixed set and `file` is not in it,
    // so there is no escaping rule to keep up with.
    const text = await new CitationJsBibliographyWriter().write([entry()])
    expect(text).not.toMatch(/[A-Za-z]:\\/u)
    expect(text).not.toMatch(/\/(?:home|Users)\//u)
    expect(text).not.toContain('file =')
  })

  it('renders a source with no DOI without inventing one', async () => {
    const report = entry({ citationKey: 'cite-zotero:user:17529257:REPORT01' })
    delete (report as { doi?: unknown }).doi
    const text = await new CitationJsBibliographyWriter().write([report])
    expect(readBack(text, report).citationKey).toBe('cite-zotero:user:17529257:REPORT01')
    expect(text.toLowerCase()).not.toContain('doi =')
  })

  it('renders a title containing braces and an ampersand without changing it', async () => {
    // THE ESCAPING CASE A HAND-ROLLED WRITER GETS WRONG, and it gets it wrong SILENTLY: the file still
    // parses, and the title the reader sees is not the title the source states.
    const title = 'Braces {in} a title & an ampersand: a study of \\LaTeX{} and 100% coverage'
    const text = await new CitationJsBibliographyWriter().write([entry({ title })])
    const read = readBack(text, entry({ title })).title
    expect(read).toContain('ampersand')
    expect(read).toContain('100% coverage')
    expect(read).toContain('Braces')
  })

  it('renders several entries as one file, each under its own key', async () => {
    const text = await new CitationJsBibliographyWriter().write([
      entry(),
      entry({ citationKey: 'cite-10.1155/2017/3082781', doi: '10.1155/2017/3082781' }),
    ])
    // READ BACK ONE ENTRY AT A TIME: `checkBibtexEntry` refuses a reply carrying several, because
    // "which entry is this source" would be a guess — so the file is split the way a reader of one
    // citation would.
    const second = entry({ citationKey: 'cite-10.1155/2017/3082781', doi: '10.1155/2017/3082781' })
    const blocks = text.split(/(?=@)/u).filter(block => block.trim() !== '')
    expect(blocks).toHaveLength(2)
    expect(readBack(blocks[0] ?? '', entry()).citationKey).toBe('cite-10.1016/j.aap.2020.105588')
    expect(readBack(blocks[1] ?? '', second).citationKey).toBe('cite-10.1155/2017/3082781')
  })

  it('names its own version, so a written file can say what rendered it', () => {
    expect(new CitationJsBibliographyWriter().id).toBe('citation-js-bibtex-v1')
  })
})
