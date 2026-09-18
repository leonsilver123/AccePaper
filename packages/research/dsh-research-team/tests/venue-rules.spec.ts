/**
 * May this manuscript be published under the rules that were read?
 *
 * THE GAP THIS RECORDS IS THE ONE THE PLAN NAMES: the official TRC guide could not be read from this
 * host, and the honest response is a record that says so — not a word limit somebody remembers. A rule
 * is `'verified'` when someone read it at its source on a stated date, and `'unknown'` otherwise, and
 * a manuscript is published under the rules that were read.
 */
import { describe, expect, it } from 'vitest'
import { checkVenueRules } from '../src/runner/venue-rules.ts'
import { TRC_PROFILE, unreadRulesFor } from '../src/runner/research-profile.ts'
import type { JournalProfile, JournalRule } from '../src/runner/research-profile.ts'

/** One rule that was read at its source. */
function readRule(id: string): JournalRule {
  return {
    id,
    statement: 'a rule this case read',
    source: 'https://example.invalid/guide',
    accessedAt: '2026-09-18',
    articleType: 'research paper',
    verification: 'verified',
    detail: 'read at the source',
  }
}

/** A profile whose rules the caller names. */
function profile(rules: ReadonlyArray<JournalRule>): JournalProfile {
  return { id: 'a-venue', name: 'A Journal', rules }
}

describe('the guide this host could not read', () => {
  it('is recorded as the questions it answers, every one unknown', () => {
    // THE QUESTIONS, NOT ANSWERS. These are what every journal's guide states, and recording them as
    // questions is what makes the gap visible: a filled-in word limit would be a guess wearing the
    // journal's name, and an omitted one is a rule nobody misses.
    expect(TRC_PROFILE.rules.length).toBeGreaterThan(0)
    expect(TRC_PROFILE.rules.every(rule => rule.verification === 'unknown')).toBe(true)
    expect(TRC_PROFILE.rules.map(rule => rule.id)).toContain('abstract-length')
    expect(TRC_PROFILE.rules.map(rule => rule.id)).toContain('reference-style')
    for (const rule of TRC_PROFILE.rules) {
      // WHERE IT WOULD BE STATED AND WHAT THE ATTEMPT PRODUCED, so a reader can go and read it rather
      // than take this record's word for the gap.
      expect(rule.source).toContain('guide-for-authors')
      expect(rule.accessedAt).toBe('2026-09-18')
      expect(rule.detail).toContain('403')
      // The article type is part of the rule, and this record does not know it either: a journal
      // states different limits for a review than for a research paper.
      expect(rule.articleType).toContain('unstated')
    }
  })

  it('refuses a submission under it, naming every unread requirement', () => {
    const refusals = checkVenueRules(TRC_PROFILE)
    expect(refusals).toHaveLength(1)
    expect(refusals[0]?.code).toBe('journal-rules-unverified')
    expect(refusals[0]?.detail).toContain('have not been established')
    expect(refusals[0]?.detail).toContain('published under the rules that were read')
    expect(refusals[0]?.unverified).toContain('abstract-length')
  })

  it('is built from the page and the finding, so the record carries its own evidence', () => {
    const rules = unreadRulesFor('https://example.invalid/guide-for-authors', '2026-01-01', 'the page timed out')
    expect(rules.length).toBe(8)
    expect(rules.every(rule => rule.source.includes('example.invalid'))).toBe(true)
    expect(rules.every(rule => rule.detail === 'the page timed out')).toBe(true)
  })
})

describe('a run that carries no venue profile', () => {
  it('is refused as a manuscript nothing was checked against', () => {
    const refusals = checkVenueRules(undefined)
    expect(refusals).toHaveLength(1)
    expect(refusals[0]?.code).toBe('journal-rules-absent')
    expect(refusals[0]?.unverified).toEqual([])
  })

  it('is refused when the profile exists with no rules, which is an unread guide', () => {
    // AN EMPTY RULE LIST IS NOT A VENUE THAT REQUIRES NOTHING. The profile's own contract says so, and
    // a check that read it as "nothing to satisfy" would pass every manuscript written for a journal
    // nobody had looked up.
    const refusals = checkVenueRules(profile([]))
    expect(refusals).toHaveLength(1)
    expect(refusals[0]?.detail).toContain('checked against none of them')
  })
})

describe('a guide that was read', () => {
  it('is satisfied when every rule was established', () => {
    expect(checkVenueRules(profile([readRule('abstract-length'), readRule('reference-style')]))).toEqual([])
  })

  it('is refused while any single rule is still unknown', () => {
    // ONE UNREAD RULE IS ENOUGH. A submission the journal rejects for its reference style is rejected
    // whatever else was read, so a record that is mostly established has not established the paper.
    const refusals = checkVenueRules(profile([
      readRule('abstract-length'),
      { ...readRule('reference-style'), verification: 'unknown', detail: 'not read' },
    ]))
    expect(refusals).toHaveLength(1)
    expect(refusals[0]?.code).toBe('journal-rules-unverified')
    expect(refusals[0]?.unverified).toEqual(['reference-style'])
    expect(refusals[0]?.detail).toContain('1 of 2')
  })
})
