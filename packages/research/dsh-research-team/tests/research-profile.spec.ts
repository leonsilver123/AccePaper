/**
 * The research profile — what a run is, and what a venue may NOT be said to require.
 *
 * The second half is the one worth testing: a profile that accepted an unsourced rule would let a
 * guess about a journal's word limit be enforced on every manuscript, and nothing downstream could
 * tell that rule from one somebody read in the author guide.
 */
import { describe, expect, it } from 'vitest'
import {
  RESEARCH_TYPES, TRC_PROFILE, declaredMetrics, resolveResearchProfile,
} from '../src/runner/research-profile.ts'

describe('what a run is', () => {
  it('defaults to a simulation study for the shipped venue, whose guide HAS been read', () => {
    const profile = resolveResearchProfile({})
    expect(profile.researchType).toBe('simulation-study')
    expect(profile.journal.id).toBe('trc')
    // THE GUIDE WAS OBTAINED on 2026-09-18 and its requirements are recorded, each citing the official
    // page, the date it was read, the article type and the heading it was read under — so a reader can
    // check a rule against the sentence it came from rather than taking this list's word for it.
    expect(profile.journal.rules.length).toBeGreaterThan(0)
    expect(profile.journal.rules.every(rule => rule.source.includes('guide-for-authors'))).toBe(true)
    expect(profile.journal.rules.every(rule => rule.accessedAt === '2026-09-18')).toBe(true)
    expect(profile.journal.rules.every(rule => rule.articleType === 'Research Paper')).toBe(true)
    expect(profile.journal.rules.every(rule => (rule.readAt ?? '').length > 0)).toBe(true)
    // NOT ONE RULE IS `unknown`: every question this profile asks was answered by reading the guide.
    expect(profile.journal.rules.filter(rule => rule.verification === 'unknown')).toEqual([])
  })

  it('carries the metrics of its own type, and separates them from the other type\'s', () => {
    const simulation = resolveResearchProfile({ researchType: 'simulation-study' })
    expect(simulation.metrics.required.map(definition => definition.key)).toContain('min-ttc-seconds')
    expect(simulation.metrics.notApplicable.map(definition => definition.key)).toContain('citation-coverage')

    const review = resolveResearchProfile({ researchType: 'literature-review' })
    expect(review.metrics.required.map(definition => definition.key)).toEqual(['citation-coverage'])
    expect(review.metrics.notApplicable.map(definition => definition.key)).toContain('min-ttc-seconds')
  })

  it('knows more than one research type, which is what makes the configuration a choice', () => {
    expect(RESEARCH_TYPES.length).toBeGreaterThanOrEqual(2)
  })
})

describe('a configuration this build cannot honour', () => {
  it('refuses a research type it does not know, rather than defaulting one', () => {
    // A DEPLOYMENT THAT NAMED A TYPE AND GOT ANOTHER would be running under rules nobody chose, and
    // the failure would surface as a manuscript missing the metrics its own venue asked for.
    expect(() => resolveResearchProfile({ researchType: 'field-trial' }))
      .toThrow(/not a research type this build knows/)
  })

  it('refuses a journal rule with no source', () => {
    // THE RULE THAT MUST NOT BE ENFORCEABLE: a venue requirement nobody read. Accepting it would make
    // a guess indistinguishable from a verified rule everywhere downstream.
    expect(() => resolveResearchProfile({
      journal: {
        id: 'trc',
        name: 'Transportation Research Part C',
        rules: [{
          id: 'abstract-word-limit',
          statement: '250 words',
          source: '   ',
          accessedAt: '2026-09-17',
          articleType: 'research paper',
          verification: 'verified' as const,
          detail: 'read at the source',
        }],
      },
    })).toThrow(/no source: a rule nobody read is a guess/)
  })

  it('accepts a rule that names where it was read', () => {
    const profile = resolveResearchProfile({
      journal: {
        id: 'trc',
        name: 'Transportation Research Part C',
        rules: [{
          id: 'abstract-word-limit',
          statement: 'the abstract is limited to the venue\'s stated maximum',
          source: 'https://example.invalid/author-guide (read 2026-09-17)',
          accessedAt: '2026-09-17',
          articleType: 'research paper',
          verification: 'verified' as const,
          detail: 'read at the source',
        }],
      },
    })
    expect(profile.journal.rules[0]?.id).toBe('abstract-word-limit')
  })
})

describe('the shipped venue profile', () => {
  it('records what the guide states, and says so where it states nothing', () => {
    // TWO FINDINGS, AND THEY ARE DIFFERENT. A rule the guide states is `verified` with the condition
    // in the guide's own terms; a subject the guide was read for and does NOT require is
    // `not_specified` — which is a finding rather than a gap, and is why it does not block a
    // submission the way an unread rule does.
    expect(TRC_PROFILE.name).toContain('Transportation Research Part C')
    const verified = TRC_PROFILE.rules.filter(rule => rule.verification === 'verified')
    expect(verified.length).toBeGreaterThan(0)
    // The abstract limit is the one a reader can check at a glance, and it is the guide's own number.
    expect(verified.find(rule => rule.id === 'abstract-length')?.detail).toContain('250 words')
    expect(TRC_PROFILE.rules.find(rule => rule.id === 'graphical-abstract')?.verification)
      .toBe('not_specified')
    // THE ANONYMITY RULE IS THE ONE THAT WOULD BE READ BACKWARDS: this journal's review is SINGLE
    // anonymized, so the authors stay on the title page and anonymizing the manuscript would be the
    // error rather than the requirement.
    expect(TRC_PROFILE.rules.find(rule => rule.id === 'anonymity')?.statement)
      .toContain('NOT anonymized')
  })

  it('lets a consumer read the metric definitions instead of restating them', () => {
    expect(declaredMetrics().map(definition => definition.key)).toContain('min-ttc-seconds')
  })
})
