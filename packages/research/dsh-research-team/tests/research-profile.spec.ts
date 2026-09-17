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
  it('defaults to a simulation study for the shipped venue, with no journal rules claimed', () => {
    const profile = resolveResearchProfile({})
    expect(profile.researchType).toBe('simulation-study')
    expect(profile.journal.id).toBe('trc')
    // NO RULES IS THE HONEST STATE: the author guide was never obtained, so nothing about the venue
    // is known — and an empty list says that, where a filled one would invent it.
    expect(profile.journal.rules).toEqual([])
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
        rules: [{ id: 'abstract-word-limit', statement: '250 words', source: '   ' }],
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
        }],
      },
    })
    expect(profile.journal.rules[0]?.id).toBe('abstract-word-limit')
  })
})

describe('the shipped venue profile', () => {
  it('claims no rules, and that is a fact about the reading rather than about the venue', () => {
    expect(TRC_PROFILE.rules).toEqual([])
    expect(TRC_PROFILE.name).toContain('Transportation Research Part C')
  })

  it('lets a consumer read the metric definitions instead of restating them', () => {
    expect(declaredMetrics().map(definition => definition.key)).toContain('min-ttc-seconds')
  })
})
