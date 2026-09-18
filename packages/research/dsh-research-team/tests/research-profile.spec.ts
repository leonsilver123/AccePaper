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
  it('defaults to a simulation study for the shipped venue, with no journal rule claimed as read', () => {
    const profile = resolveResearchProfile({})
    expect(profile.researchType).toBe('simulation-study')
    expect(profile.journal.id).toBe('trc')
    // THE QUESTIONS, NOT ANSWERS, AND NOT NOTHING. An empty list used to say "nobody read the guide",
    // which is true but unactionable: it does not say what is missing. The eight requirements every
    // guide states are recorded with the page that would state them and what attempting it produced
    // (HTTP 403, measured 2026-09-18) — so a reader knows what to fetch, and NOT ONE OF THEM IS
    // CLAIMED AS READ. A filled-in word limit would be a guess wearing the venue's name.
    expect(profile.journal.rules.length).toBe(8)
    expect(profile.journal.rules.every(rule => rule.verification === 'unknown')).toBe(true)
    expect(profile.journal.rules.every(rule => rule.source.includes('guide-for-authors'))).toBe(true)
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
  it('claims no rule as read, and that is a fact about the reading rather than about the venue', () => {
    // THE DISTINCTION THE RECORD EXISTS FOR: TRC does state these requirements — every journal's guide
    // does — and NOBODY HERE HAS READ THEM. So the profile carries the subjects with the page that
    // would state them, and not one rule is marked verified. A rule that were marked read without
    // being read would be indistinguishable from one that was, everywhere downstream.
    expect(TRC_PROFILE.rules.length).toBe(8)
    expect(TRC_PROFILE.rules.filter(rule => rule.verification === 'verified')).toEqual([])
    expect(TRC_PROFILE.name).toContain('Transportation Research Part C')
  })

  it('lets a consumer read the metric definitions instead of restating them', () => {
    expect(declaredMetrics().map(definition => definition.key)).toContain('min-ttc-seconds')
  })
})
