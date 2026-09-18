/**
 * May this manuscript be published under the rules that were read?
 *
 * THE GAP THIS CLOSED IS THE ONE THE PLAN NAMES, and on 2026-09-18 it was closed: the official TRC
 * guide could not be read from this host, and the honest response was a record that said so rather
 * than a word limit somebody remembered. The user then obtained the official text, so `TRC_PROFILE`
 * now records what it states. The three states remain, and the distinction between them is the point:
 * `'verified'` — read, with the condition in the guide's own terms; `'not_specified'` — read, and the
 * guide requires nothing; `'unknown'` — nobody has read it, which is the only one that blocks.
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

describe('a guide that could not be obtained', () => {
  it('is recorded as the questions it answers, every one unknown', () => {
    // THE QUESTIONS, NOT ANSWERS. `unreadRulesFor` is the state a guide nobody could fetch is in —
    // TRC was in it until 2026-09-18, when the user obtained the official text. It is kept because a
    // venue whose rules nobody has read must stay distinguishable from one whose rules were read and
    // state nothing, and because the refusal it produces names what to go and read.
    const rules = unreadRulesFor(
      'https://example.invalid/guide-for-authors', '2026-01-01', 'the page timed out',
    )
    expect(rules.length).toBe(8)
    expect(rules.every(rule => rule.verification === 'unknown')).toBe(true)
    expect(rules.every(rule => rule.source.includes('example.invalid'))).toBe(true)
    expect(rules.every(rule => rule.detail === 'the page timed out')).toBe(true)
    expect(rules.every(rule => rule.articleType.includes('unstated'))).toBe(true)
    expect(checkVenueRules({ id: 'a', name: 'A Journal', rules })[0]?.code)
      .toBe('journal-rules-unverified')
  })
})

describe('the guide that was read', () => {
  it('is satisfied, with nothing left unread and one finding of "not specified"', () => {
    // THE SHIPPED PROFILE, AFTER THE OFFICIAL TEXT WAS OBTAINED. Every rule is either `verified` —
    // read, with the condition in the guide's own terms — or `not_specified`, which is also a
    // finding: the guide was read for that subject and requires nothing. Neither is a gap, so the
    // submission is not refused on this condition.
    expect(checkVenueRules(TRC_PROFILE)).toEqual([])
    expect(TRC_PROFILE.rules.filter(rule => rule.verification === 'unknown')).toEqual([])
    expect(TRC_PROFILE.rules.some(rule => rule.verification === 'not_specified')).toBe(true)
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

describe('a rule set the caller names', () => {
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
