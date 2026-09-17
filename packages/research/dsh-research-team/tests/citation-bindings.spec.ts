/**
 * Citation bindings — what a citation claims, and the ways one can look complete while establishing
 * nothing.
 *
 * EACH REFUSAL HERE IS A SHAPE THE DELIVERED PAPER ALREADY HAS. It carries twenty-five retrieved
 * works in its reference list and a body that cites none of them, so every rule below is written
 * against a failure this deployment has already produced rather than against an imagined one.
 */
import { describe, expect, it } from 'vitest'
import {
  bibliographyOf, checkCitationKeys, checkCitationUse, checkManuscriptCitations, citeKeyOf,
  citedKeysIn, missingSourceFields, renderCitationMarkers,
} from '../src/runner/citation-bindings.ts'
import type { CitationUse, SourceRecord } from '../src/runner/citation-bindings.ts'

/** A retrieved source that states everything a bibliography needs. */
const SOURCE: SourceRecord = {
  id: 'W2046366715',
  ref: { kind: 'doi', id: '10.1016/j.vehcom.2015.03.004' },
  title: 'Platoon management with cooperative adaptive cruise control enabled by VANET',
  authors: ['Mani Amoozadeh', 'Hui Deng'],
  year: 2015,
  venue: 'Vehicular Communications',
  locator: { articleNumber: '12' },
}

/** A binding that may be recorded: a passage was read in the full text and it supports the sentence. */
const BINDING: CitationUse = {
  statementId: 'stmt-prior-platooning',
  // THE VERSION OF THE SENTENCE the judgement below was made about. A binding that carries no version
  // is one nobody can tell from a judgement about different text.
  statementSha256: 'b'.repeat(64),
  literatureRef: SOURCE.id,
  citeKey: citeKeyOf(SOURCE),
  location: 'section 3, paragraph 2',
  quote: 'the platoon controller maintains a constant inter-vehicle gap under the declared disturbance',
  quoteSha256: 'a'.repeat(64),
  support: 'supported',
  readScope: 'full-text',
  access: 'read',
  judgedBy: 'reviewer',
}

describe('a citation that may be recorded', () => {
  it('is accepted', () => {
    expect(checkCitationUse(BINDING, SOURCE)).toEqual([])
  })

  it('keeps its key when the title is corrected', () => {
    // THE IDENTIFIER IS THE IDENTITY. A key rebuilt from the title changes when the title changes, and
    // the manuscript's citation then names a source the reader cannot find.
    const corrected = { ...SOURCE, title: `${SOURCE.title}: a corrigendum` }
    expect(citeKeyOf(corrected)).toBe(BINDING.citeKey)
  })
})

describe('a citation that establishes nothing', () => {
  it('is refused when nothing was quoted', () => {
    const refusals = checkCitationUse({ ...BINDING, quote: '   ' }, SOURCE)
    expect(refusals.map(refusal => refusal.code)).toEqual(['citation-no-passage'])
  })

  it('is refused when the quote is the whole source rather than the passage', () => {
    const refusals = checkCitationUse({ ...BINDING, quote: 'x'.repeat(2001) }, SOURCE)
    expect(refusals[0]?.detail).toContain('the source rather than')
  })

  it('is refused when support is claimed from an abstract', () => {
    // WHAT AN ABSTRACT CANNOT SHOW is whether the method supports the claim, which is the thing a
    // citation for a method sentence asserts. The judgement is refused rather than recorded at a
    // strength its evidence does not carry.
    const refusals = checkCitationUse({ ...BINDING, readScope: 'abstract-only' }, SOURCE)
    expect(refusals.map(refusal => refusal.code)).toEqual(['citation-support-beyond-scope'])
    expect(refusals[0]?.detail).toContain('abstract-only')
  })

  it('is refused when a source that could not be read is recorded as supporting', () => {
    const refusals = checkCitationUse({ ...BINDING, access: 'unavailable' }, SOURCE)
    expect(refusals.map(refusal => refusal.code)).toEqual(['citation-source-unavailable'])
  })

  it('allows a source that could not be read to be recorded as unrelated, which is what was found', () => {
    // ACCESS AND SUPPORT ARE SEPARATE FACTS: "I could not read it" is not a support judgement, and
    // recording it as one would be the conflation this refuses in the other direction.
    const refusals = checkCitationUse(
      { ...BINDING, access: 'not-accessible', support: 'unrelated', readScope: 'metadata-only' },
      SOURCE,
    )
    expect(refusals).toEqual([])
  })

  it('is refused when the source is retracted, naming what was recorded', () => {
    const retracted: SourceRecord = {
      ...SOURCE,
      correction: { kind: 'retracted', note: 'retracted 2021-03-04: data fabrication' },
    }
    const refusals = checkCitationUse(BINDING, retracted)
    expect(refusals.map(refusal => refusal.code)).toEqual(['citation-source-retracted'])
    expect(refusals[0]?.detail).toContain('retracted 2021-03-04')
  })

  it('is refused when the retrieval holds no source for it', () => {
    const refusals = checkCitationUse(BINDING, undefined)
    expect(refusals.map(refusal => refusal.code)).toEqual(['citation-metadata-missing'])
  })

  it('reports every problem at once, so one pass fixes them', () => {
    const refusals = checkCitationUse(
      { ...BINDING, quote: '', readScope: 'abstract-only', access: 'unavailable' },
      { ...SOURCE, correction: { kind: 'corrected', note: 'corrigendum 2019' } },
    )
    expect(refusals.map(refusal => refusal.code)).toEqual([
      'citation-no-passage',
      'citation-support-beyond-scope',
      'citation-source-unavailable',
      'citation-source-retracted',
    ])
  })
})

describe('the keys of one manuscript', () => {
  it('are refused when two citations claim one key', () => {
    const refusals = checkCitationKeys([BINDING, { ...BINDING, statementId: 'stmt-other' }])
    expect(refusals.map(refusal => refusal.code)).toEqual(['citation-duplicate-key'])
  })

  it('are accepted when every citation names its own source', () => {
    expect(checkCitationKeys([
      BINDING,
      { ...BINDING, statementId: 'stmt-other', literatureRef: 'W1', citeKey: 'cite-W1' },
    ])).toEqual([])
  })
})

describe('the bibliography of one manuscript', () => {
  const second: SourceRecord = { ...SOURCE, id: 'W1', title: 'Another work' }
  const sources = new Map([[SOURCE.id, SOURCE], [second.id, second]])

  it('is the sources the statements cite, not the search result set', () => {
    // THE DEFECT THIS REPLACES: the delivered package's reference list is the retrieval ledger, so it
    // prints works the paper never mentions. An entry belongs here only because a sentence cites it.
    const { entries } = bibliographyOf([BINDING], sources)
    expect(entries.map(entry => entry.id)).toEqual([SOURCE.id])
  })

  it('leaves out a source that was examined and found unrelated', () => {
    const { entries } = bibliographyOf([
      BINDING,
      { ...BINDING, statementId: 'stmt-2', literatureRef: second.id, citeKey: 'cite-W1', support: 'unrelated' },
    ], sources)
    expect(entries.map(entry => entry.id)).toEqual([SOURCE.id])
  })

  it('reports a cited source the retrieval does not hold, instead of printing a partial entry', () => {
    const { entries, unresolvable } = bibliographyOf(
      [{ ...BINDING, literatureRef: 'W404', citeKey: 'cite-W404' }],
      sources,
    )
    expect(entries).toEqual([])
    expect(unresolvable).toEqual(['W404'])
  })
})

describe('the citation markers a body carries', () => {
  it('are read in order, once each', () => {
    expect(citedKeysIn('Prior work established this [@cite-W1]. It was extended later [@cite-W2] and '
      + 'confirmed again [@cite-W1].')).toEqual(['cite-W1', 'cite-W2'])
  })

  it('are read from the text the writer was told to emit, and nothing else is treated as one', () => {
    // PROSE IS NOT PARSED FOR CITATIONS: a bracketed number a model wrote without being asked is not
    // a citation, and reading it as one would attribute a source nobody bound.
    expect(citedKeysIn('see [12] and (Author, 2019)')).toEqual([])
  })

  it('are printed as the number their entry carries, and left alone when they have none', () => {
    const numbered = renderCitationMarkers(
      'This [@cite-W1] and that [@cite-W404].',
      new Map([['cite-W1', 3]]),
    )
    expect(numbered).toBe('This [3] and that [@cite-W404].')
  })
})

describe('a manuscript whose citations and reference list differ', () => {
  const entries = [{ citeKey: 'cite-W1' }]
  const reviewedKeys = ['cite-W1']

  it('is accepted when every citation resolves and every entry is cited', () => {
    expect(checkManuscriptCitations({
      bodyText: 'The gap is established [@cite-W1].',
      entries,
      reviewedKeys,
    })).toEqual([])
  })

  it('is refused when a sentence cites a key the reference list does not carry', () => {
    const refusals = checkManuscriptCitations({
      bodyText: 'The gap is established [@cite-W1] and extended [@cite-W404].',
      entries,
      reviewedKeys: [...reviewedKeys, 'cite-W404'],
    })
    expect(refusals.map(refusal => refusal.code)).toEqual(['citation-target-missing'])
    expect(refusals[0]?.detail).toContain('cannot resolve the citation')
  })

  it('is refused when the reference list carries something nothing cites', () => {
    // THE DELIVERED PAPER, EXACTLY: twenty-five retrieved works in the reference list and a body that
    // cites none of them.
    const refusals = checkManuscriptCitations({
      bodyText: 'The gap is established [@cite-W1].',
      entries: [...entries, { citeKey: 'cite-W2' }],
      reviewedKeys,
    })
    expect(refusals.map(refusal => refusal.code)).toEqual(['citation-entry-uncited'])
    expect(refusals[0]?.detail).toContain('not what a search returned')
  })

  it('is refused when a cited source was retrieved but never reviewed', () => {
    // BEING ON THE SAME TOPIC IS WHAT A SEARCH RETURNS, not what a citation claims. A source with no
    // reviewed judgement has nothing binding it to the sentence it is attached to.
    const refusals = checkManuscriptCitations({
      bodyText: 'The gap is established [@cite-W1] and so is this [@cite-W9].',
      entries: [...entries, { citeKey: 'cite-W9' }],
      reviewedKeys,
    })
    expect(refusals.map(refusal => refusal.code)).toEqual(['citation-unreviewed-source'])
    expect(refusals[0]?.detail).toContain('being retrieved is not being read')
  })

  it('reports a missing target and an uncited entry in the same pass', () => {
    const refusals = checkManuscriptCitations({
      bodyText: 'Only this [@cite-W404].',
      entries,
      reviewedKeys: [...reviewedKeys, 'cite-W404'],
    })
    expect(refusals.map(refusal => refusal.code))
      .toEqual(['citation-target-missing', 'citation-entry-uncited'])
  })
})

describe('what a source did not state', () => {
  it('is reported rather than filled in from another field', () => {
    // A YEAR GUESSED FROM A VOLUME NUMBER reads as verified and is not. The absence is reported so the
    // writer states it, and a reader can see which fields the source itself provided.
    const { year: _year, locator: _locator, ...noYearNoLocator } = SOURCE
    expect(missingSourceFields(noYearNoLocator)).toEqual(['year', 'locator'])
    expect(missingSourceFields(SOURCE)).toEqual([])
  })

  it('reports an unnamed author and an unnamed venue as their own absences', () => {
    const { venue: _venue, ...noVenue } = SOURCE
    expect(missingSourceFields({ ...noVenue, authors: [] })).toEqual(['authors', 'venue'])
  })
})
