/**
 * The references a run's citations produce, and what disqualifies a rendered file.
 *
 * THE TWO THINGS CHECKED HERE ARE THE TWO THAT HAVE GONE WRONG. A `.bib` carrying a local attachment
 * path hands whoever receives the paper a map of this machine; a `.bib` missing a cited key leaves a
 * citation marker in the body naming nothing in the list. Both make a file that opens, parses, and is
 * wrong — which is why they are refusals rather than warnings.
 */
import { describe, expect, it } from 'vitest'
import {
  BIBLIOGRAPHY_RULE_VERSION, checkBibliography, referenceEntriesOf,
} from '../src/runner/bibliography.ts'
import type { SourceRecord } from '../src/runner/citation-bindings.ts'

/** One source, as the registry holds it. */
function source(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id: '10.1016/j.aap.2020.105588',
    ref: { kind: 'doi', id: '10.1016/j.aap.2020.105588' },
    title: 'What happens when drivers of automated vehicles take over control in critical brake situations',
    authors: ['Roche, Fabienne', 'Thüring, Manfred'],
    year: 2020,
    venue: 'Accident Analysis and Prevention',
    locator: { volume: '144', page: '105588' },
    registry: 'zotero',
    acquisition: 'live-library-read',
    ...overrides,
  }
}

describe('the references a run cites', () => {
  it('keys every entry the way the manuscript cites it', () => {
    // THE KEY IS THE ONE THING THE FILE AND THE BODY MUST AGREE ON. `citeKeyOf` derives it from the
    // identifier, so an entry rendered under any other name leaves the manuscript's citation pointing
    // at nothing — the failure a reference list cannot show.
    const entries = referenceEntriesOf([source()])
    expect(entries[0]?.citationKey).toBe('cite-10.1016/j.aap.2020.105588')
  })

  it('carries a source that states no DOI by its own identity, not in a DOI field', () => {
    const entries = referenceEntriesOf([source({
      id: 'zotero:user:17529257:REPORT01',
      ref: { kind: 'unknown', id: 'zotero:user:17529257:REPORT01' },
    })])
    expect(entries[0]?.citationKey).toBe('cite-zotero:user:17529257:REPORT01')
    // A DOI FIELD HOLDING SOMETHING ELSE PRINTS AN IDENTIFIER THAT RESOLVES TO NOTHING.
    expect(entries[0]?.doi).toBeUndefined()
  })

  it('keeps a source that states no year rather than dropping the reference', () => {
    // The citation marker is already in the body; dropping the entry would leave it naming nothing,
    // and the missing year is a fact about the source that E1's checks are there to report.
    const undated = source()
    delete (undated as { year?: unknown }).year
    const entries = referenceEntriesOf([undated])
    expect(entries).toHaveLength(1)
    expect(entries[0]?.year).toBeUndefined()
  })

  it('orders entries by cite key, so two runs produce the same file', () => {
    const entries = referenceEntriesOf([
      source({ id: 'b', ref: { kind: 'doi', id: 'b' } }),
      source({ id: 'a', ref: { kind: 'doi', id: 'a' } }),
    ])
    expect(entries.map(entry => entry.citationKey)).toEqual(['cite-a', 'cite-b'])
  })

  it('names its own rule version', () => {
    expect(BIBLIOGRAPHY_RULE_VERSION).toBe('citation-entries-v1')
  })
})

describe('what disqualifies a rendered bibliography', () => {
  const entries = referenceEntriesOf([source()])

  it('refuses a file carrying a local path', () => {
    // THE LEAK IS ALWAYS A LEAK. A reference manager records where it copied a file from; the export's
    // own sanitizer reduces such strings to their last segment, and a `.bib` that skipped it carries
    // the machine's layout to every reader of the paper.
    const refusals = checkBibliography(
      '@article{cite-10.1016/j.aap.2020.105588,\n  file = {C:\\Users\\Administrator\\Zotero\\storage\\PU2XWW83\\Roche.pdf}\n}',
      entries,
    )
    expect(refusals.join(' ')).toContain('local path')
  })

  it('refuses a file that omits a key the manuscript cites', () => {
    const refusals = checkBibliography('@article{cite-something-else,\n  title = {Other}\n}', entries)
    expect(refusals.join(' ')).toContain('cite-10.1016/j.aap.2020.105588')
  })

  it('refuses a file with no entries at all when the manuscript cites some', () => {
    expect(checkBibliography('', entries).join(' ')).toContain('no entries')
  })

  it('accepts a file that carries every cited key and no path', () => {
    expect(checkBibliography(
      '@article{cite-10.1016/j.aap.2020.105588,\n  title = {What happens when drivers of automated'
      + ' vehicles take over control}\n}',
      entries,
    )).toEqual([])
  })

  it('accepts an empty file when the manuscript cites nothing', () => {
    // No citations is a real state — a draft before D3 — and a file for it should be empty, not refused.
    expect(checkBibliography('', [])).toEqual([])
  })
})
