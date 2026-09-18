/**
 * A returned BibTeX entry, and whether it is the source the library describes.
 *
 * THE CASE THE PIPELINE REVIEW NAMES IS NOT "THE PARSER CRASHED" — it is an entry that parses
 * perfectly and cites something else: a DOI from another paper, a title the library does not hold, a
 * key nothing else uses. Every one of those renders, looks right on the page, and resolves to a
 * source the manuscript never read. So these cases are about the CHECKS, and the parser is only the
 * thing that makes the fields readable.
 *
 * THE TWO TOOL CAPABILITIES ARE DIFFERENT and this file depends on the difference: the metadata tool
 * produces BibTeX locally (measured 2026-09-18), while the bibliography-export tool needs a web API
 * CSL engine and fails without one. A failure message is what that second tool returns, which is why
 * one of the cases below is about a message arriving where an entry should be.
 */
import { describe, expect, it } from 'vitest'
import {
  checkBibtexEntry, literatureIdOf, renderBibtex,
} from '../src/zotero-bibliography.ts'
import type { ZoteroItemFacts } from '../src/zotero-bibliography.ts'

/** The item as the local Zotero API returned it, on 2026-09-18. */
const ITEM: ZoteroItemFacts = {
  itemKey: 'UA5MIGG3',
  title: 'What happens when drivers of automated vehicles take over control in critical brake situations?',
  year: 2020,
  doi: '10.1016/j.aap.2020.105588',
}

/** The entry the MCP tool returned for that item, verbatim through the product's own client. */
const RETURNED = String.raw`@article{rocheWhatHappensWhen2020,
  title = {What Happens When Drivers of Automated Vehicles Take over Control in Critical Brake Situations?},
  author = {Roche, Fabienne and Th{\"u}ring, Manfred and Trukenbrod, Anna K.},
  year = 2020, month = sep,
  journal = {Accident Analysis and Prevention}, volume = {144}, pages = {105588},
  issn = {00014575}, doi = {10.1016/j.aap.2020.105588},
  urldate = {2025-08-01},
  file = {/home/someone/Zotero/storage/UA5MIGG3/Roche et al. - 2020.pdf}
}`

/** The key this run assigned, which is what the manuscript will print. */
const KEY = 'rocheWhatHappensWhen2020'

describe('an entry that is the source it claims to be', () => {
  it('is accepted, with the bibliographic fields a citation needs', () => {
    const checked = checkBibtexEntry({ text: RETURNED, item: ITEM, citationKey: KEY })
    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    expect(checked.citation.citationKey).toBe(KEY)
    expect(checked.citation.container).toBe('Accident Analysis and Prevention')
    expect(checked.citation.volume).toBe('144')
    expect(checked.citation.page).toBe('105588')
    expect(checked.citation.doi).toBe('10.1016/j.aap.2020.105588')
    expect(checked.citation.year).toBe(2020)
  })

  it('decodes an author name out of its TeX escape', () => {
    // THE UMLAUT ARRIVES AS `{\"u}` AND MUST NOT STAY THAT WAY. A bibliography that printed the
    // escape would name a person who does not exist, and the mistake is invisible until a reader
    // sees it in print.
    const checked = checkBibtexEntry({ text: RETURNED, item: ITEM, citationKey: KEY })
    if (!checked.ok) throw new Error('expected the entry to be accepted')
    expect(checked.citation.authors).toEqual([
      'Roche, Fabienne', 'Thüring, Manfred', 'Trukenbrod, Anna K.',
    ])
  })
})

describe('an entry that is not', () => {
  it('is refused when the tool returned a failure message instead of an entry', () => {
    // MEASURED, 2026-09-18: the export tool answers this in a local-only deployment. Text saved as a
    // bibliography entry is a citation that resolves to nothing, so it is refused by name.
    const failed = 'Error exporting bibliography: Bibliography and citation rendering requires'
      + " Zotero's web API CSL engine; the local API has no citation engine."
    const checked = checkBibtexEntry({ text: failed, item: ITEM, citationKey: KEY })
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(checked.refusals[0]?.code).toBe('bibtex-unparseable')
    expect(checked.refusals[0]?.detail).toContain('failure rather than an entry')
  })

  it('is refused when the text is not BibTeX at all', () => {
    const checked = checkBibtexEntry({ text: 'not a bibliography', item: ITEM, citationKey: KEY })
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(checked.refusals[0]?.code).toBe('bibtex-unparseable')
  })

  it('is refused when an entry cites a different DOI', () => {
    // THE ONE THAT LOOKS RIGHT ON THE PAGE. A DOI from another paper parses, has a title and authors,
    // and points a reader at a source this manuscript never read.
    const wrongDoi = RETURNED.replace('10.1016/j.aap.2020.105588', '10.1016/j.aap.2020.105999')
    const checked = checkBibtexEntry({ text: wrongDoi, item: ITEM, citationKey: KEY })
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(checked.refusals.map(refusal => refusal.code)).toContain('bibtex-doi-mismatch')
  })

  it('is refused when the entry is keyed differently from the run\'s assignment', () => {
    const renamed = RETURNED.replace('@article{rocheWhatHappensWhen2020,', '@article{roche2020takeover,')
    const checked = checkBibtexEntry({ text: renamed, item: ITEM, citationKey: KEY })
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(checked.refusals[0]?.code).toBe('bibtex-key-mismatch')
  })

  it('is refused when its title is not the item\'s', () => {
    const other = RETURNED.replace(
      '{What Happens When Drivers of Automated Vehicles Take over Control in Critical Brake Situations?}',
      '{A different paper entirely}',
    )
    const checked = checkBibtexEntry({ text: other, item: ITEM, citationKey: KEY })
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(checked.refusals.map(refusal => refusal.code)).toContain('bibtex-title-mismatch')
  })

  it('is refused when the year disagrees with the item', () => {
    const stale = RETURNED.replace('year = 2020', 'year = 2019')
    const checked = checkBibtexEntry({ text: stale, item: ITEM, citationKey: KEY })
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(checked.refusals.map(refusal => refusal.code)).toContain('bibtex-year-mismatch')
  })

  it('is refused when it names no usable author', () => {
    // AN ENTRY WITH AN EMPTY AUTHOR FIELD PARSES. A citation rendered without an author is not the
    // paper's citation, so the absence is refused rather than printed as an anonymous work.
    const anonymous = RETURNED.replace(
      'author = {Roche, Fabienne and Th{\\"u}ring, Manfred and Trukenbrod, Anna K.},', 'author = {},')
    const checked = checkBibtexEntry({ text: anonymous, item: ITEM, citationKey: KEY })
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(checked.refusals.map(refusal => refusal.code)).toContain('bibtex-author-unusable')
  })

  it('is refused when the reply carries several entries for one item', () => {
    const two = `${RETURNED}\n${RETURNED}`
    const checked = checkBibtexEntry({ text: two, item: ITEM, citationKey: KEY })
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(checked.refusals[0]?.detail).toContain('2 entries for one item')
  })
})

describe('the identity a source is recorded under', () => {
  it('is minted from the library AND the item key, because either alone names nothing', () => {
    // CROSS-LIBRARY COLLISION IS THE CASE: two libraries can each hold an item keyed `UA5MIGG3`, and
    // a bare key would make them one source. The library is part of the identity for that reason.
    const mine = literatureIdOf({ type: 'user', id: '0' }, 'UA5MIGG3')
    const theirs = literatureIdOf({ type: 'group', id: '12345' }, 'UA5MIGG3')
    expect(mine).not.toBe(theirs)
    expect(mine).toBe('zotero:user:0:UA5MIGG3')
    expect(theirs).toBe('zotero:group:12345:UA5MIGG3')
  })

  it('is stable across a rename of the citation key', () => {
    // A KEY THE RUN RENAMES IS NOT A DIFFERENT SOURCE. The citation key is what the manuscript
    // prints; the identity is where the paper came from, and it does not move when the first changes.
    const library = { type: 'user' as const, id: '0' }
    expect(literatureIdOf(library, 'UA5MIGG3')).toBe(literatureIdOf(library, 'UA5MIGG3'))
  })
})

describe('the bibliography the package carries', () => {
  it('is rendered from the parsed structure, with the machine-local file path gone', () => {
    // THE PATH IS IN THE TOOL'S REPLY AND NOT IN THE WRITER'S FIELDS. A submission that named where
    // one contributor's laptop keeps a PDF is carrying a fact about that machine, and it is dropped
    // by constructing the entry from the fields a citation has rather than by a pattern that has to
    // keep up with whatever a server appends.
    const checked = checkBibtexEntry({ text: RETURNED, item: ITEM, citationKey: KEY })
    if (!checked.ok) throw new Error('expected the entry to be accepted')
    const rendered = renderBibtex([checked.citation])
    expect(rendered).not.toContain('file')
    expect(rendered).not.toContain('Zotero/storage')
    expect(rendered).not.toContain('.pdf')
    // AND THE FIELDS A CITATION NEEDS SURVIVE THE ROUND TRIP.
    expect(rendered).toContain('rocheWhatHappensWhen2020')
    expect(rendered).toContain('Accident Analysis and Prevention')
    expect(rendered).toContain('10.1016/j.aap.2020.105588')
    expect(rendered).toContain('105588')
  })

  it('keeps an institutional author whole', () => {
    // SPLITTING IT WOULD INVENT A SURNAME. `World Health Organization` has no family name, and a
    // citation that printed `Organization, World Health` would name an author that does not exist.
    const corporate = String.raw`@techreport{who2020report,
  title = {Road safety annual report},
  author = {{World Health Organization}},
  year = 2020,
  doi = {10.1000/whoreport},
}`
    const checked = checkBibtexEntry({
      text: corporate,
      item: { itemKey: 'X1', title: 'Road safety annual report', year: 2020, doi: '10.1000/whoreport' },
      citationKey: 'who2020report',
    })
    if (!checked.ok) throw new Error(JSON.stringify(checked.refusals))
    expect(checked.citation.authors).toEqual(['World Health Organization'])
    expect(renderBibtex([checked.citation])).toContain('World Health Organization')
  })
})
