/**
 * The plan a caller supplies, and the reasons one is refused.
 *
 * Every case below is a wire boundary case: a plan arrives as JSON that no type checker saw, and
 * everything downstream trusts it completely — the manuscript's title, A1's retrieval topic, the
 * claim the C channel grades. A value that would produce a run whose artifacts disagree with each
 * other has to be refused HERE, with a reason, rather than three steps later.
 */

import { describe, expect, it } from 'vitest'

import { MEASURED_METRIC } from '../src/runner/platoon-sim.ts'
import { DEFAULT_PLAN, requirePlan } from '../src/runner/study-plan.ts'

/** The default plan as a wire value: JSON, so every type is the caller's claim rather than a type. */
function wire(over: Record<string, unknown> = {}): unknown {
  return JSON.parse(JSON.stringify({ ...DEFAULT_PLAN, ...over }))
}

/** The refusal reason for a value, or undefined when it was accepted. */
function refusal(value: unknown): string | undefined {
  const result = requirePlan(value, MEASURED_METRIC)
  return result.ok ? undefined : result.reason
}

describe('requirePlan', () => {
  it('accepts the default plan as it crosses the wire', () => {
    const result = requirePlan(wire(), MEASURED_METRIC)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.title).toBe(DEFAULT_PLAN.title)
    expect(result.plan.claim.prediction).toBe(DEFAULT_PLAN.claim.prediction)
    expect(result.plan.commitment).toEqual(DEFAULT_PLAN.commitment)
  })

  it('refuses a value that is not an object', () => {
    expect(refusal(undefined)).toContain('not an object')
    expect(refusal('a plan')).toContain('not an object')
  })

  it('names every top-level field a plan left out', () => {
    const reason = refusal(wire({ title: '', direction: '   ' }))
    expect(reason).toContain('title')
    expect(reason).toContain('direction')
  })

  it('refuses an outline a step downstream could not address', () => {
    // The section ids are what every step from D2 on addresses; a plan with different ones would
    // produce a manuscript whose sections the pipeline cannot find.
    const reason = refusal(wire({
      outline: [{ id: 'intro', heading: 'Intro' }, { id: 'body', heading: 'Body' }],
    }))
    expect(reason).toContain('this pipeline consumes')
    expect(reason).toContain('abstract')
  })

  it('refuses an outline entry that is missing its heading', () => {
    const outline = DEFAULT_PLAN.outline.map((section, index) =>
      index === 2 ? { id: section.id } : section)
    expect(refusal(wire({ outline }))).toContain('outline')
  })

  it('refuses a claim about a quantity this study does not measure', () => {
    // The refusal that matters most, because the alternative is a run that starts and then holds at
    // every gate: the C channel cannot grade a claim about a quantity nothing here measures.
    const reason = refusal(wire({
      metric: { ...MEASURED_METRIC, key: 'p99-latency-ms' },
    }))
    expect(reason).toContain('p99-latency-ms')
    expect(reason).toContain(MEASURED_METRIC.key)
  })

  it('refuses a plan that declares no commitment', () => {
    const withoutCommitment = JSON.parse(JSON.stringify(DEFAULT_PLAN)) as Record<string, unknown>
    delete withoutCommitment.commitment
    expect(refusal(withoutCommitment)).toContain('no usable commitment')
  })

  it('refuses a claim the gate cannot grade, in the gate\'s own words', () => {
    // The same check the C channel applies, applied before a run exists. A plan whose claim would
    // hold the run is refused here rather than started and abandoned.
    const claim = { ...DEFAULT_PLAN.claim, prediction: 'the cooperative cache shall fall in p99 latency by at least 20%' }
    expect(refusal(wire({ claim }))).toContain('does not name that quantity')
  })

  it('refuses a claim whose declaration contradicts its own sentence', () => {
    expect(refusal(wire({ commitment: { direction: 'decrease', bound: 'at-least', thresholdPct: 20 } })))
      .toContain('contradict each other')
  })

  it('carries the claim fields a proposal does not state, rather than inventing them', () => {
    // A proposal is a claim and the criterion that would settle it. The two fields it does not
    // state arrive empty and stay empty; filling them would put prose in the artifact that no step
    // meant.
    const claim = { ...DEFAULT_PLAN.claim, essentialDifference: undefined, experimentToFalsify: undefined }
    const result = requirePlan(wire({ claim }), MEASURED_METRIC)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.claim.essentialDifference).toBe('')
    expect(result.plan.claim.experimentToFalsify).toBe('')
  })
})
