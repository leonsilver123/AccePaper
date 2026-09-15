/**
 * Reading a model's answer into research proposals.
 *
 * Every case below pins either the wire format a proposal must be written in, or the rule that a
 * proposal a person is offered is one the C channel can actually grade — which is the whole reason
 * the gate's claim-level check runs here and not only at run time.
 */

import { describe, expect, it } from 'vitest'

import { INPUT_LIMITS } from '@deepseek-ai/dsh-research-tools'
import type { ProposalRequest } from '../src/runner/direction-proposals.ts'
import { claimIdFor, parseDirectionProposals, planFromProposal, proposalInstruction } from '../src/runner/direction-proposals.ts'
import { MEASURED_METRIC } from '../src/runner/platoon-sim.ts'
import { DEFAULT_PLAN, requirePlan } from '../src/runner/study-plan.ts'

const request: ProposalRequest = {
  field: 'road transport safety',
  metric: MEASURED_METRIC,
  skeleton: DEFAULT_PLAN.outline,
}

const SECTIONS = 'Abstract | Introduction | Method | Experiments | Results | Conclusion | References'

/** One well-formed proposal block, as the instruction asks for it. */
function block(over: Partial<Record<'TITLE' | 'DIRECTION' | 'CLAIM' | 'PREDICTION' | 'BOUND' | 'THRESHOLD' | 'SECTIONS', string>> = {}): string {
  const fields = {
    TITLE: 'Ahead-of-Time Prediction in Mixed Platoons',
    DIRECTION: 'predictive look-ahead for autonomous following',
    CLAIM: 'An autonomous vehicle that predicts its leader raises the platoon minimum time-to-collision.',
    PREDICTION:
      'the HV-AV-HV platoon shall exceed the all-HV platoon in minimum time-to-collision by at least 25%',
    BOUND: 'at-least',
    THRESHOLD: '25',
    SECTIONS,
    ...over,
  }
  return Object.entries(fields).map(([label, value]) => `${label}: ${value}`).join('\n')
}

describe('the proposal instruction', () => {
  it('states the one quantity the run can measure, and that the claim must be about it', () => {
    const text = proposalInstruction(request)
    expect(text).toContain(MEASURED_METRIC.label)
    expect(text).toContain(MEASURED_METRIC.key)
    // The direction of the metric decides which way the model is told is better, or a proposal
    // would routinely commit to the wrong one.
    expect(text).toContain('larger value is better')
  })

  it('names the section ids the pipeline depends on', () => {
    // The ids are not the proposal's to choose: later steps consume named sections and D2 refuses an
    // outline whose count differs from the skeleton.
    const text = proposalInstruction(request)
    for (const section of DEFAULT_PLAN.outline) expect(text).toContain(section.id)
  })

  it('says so when the person stated no field, rather than leaving the model to guess', () => {
    expect(proposalInstruction({ ...request, field: '  ' })).toContain('the field this study belongs to')
  })
})

describe('parsing a model answer', () => {
  it('reads one block into a proposal, with the headings the model chose', () => {
    const outcome = parseDirectionProposals(block(), request)
    expect(outcome.rejected).toEqual([])
    expect(outcome.proposals).toHaveLength(1)
    const [proposal] = outcome.proposals
    expect(proposal?.title).toBe('Ahead-of-Time Prediction in Mixed Platoons')
    expect(proposal?.direction).toBe('predictive look-ahead for autonomous following')
    expect(proposal?.outline.map(s => s.id)).toEqual(DEFAULT_PLAN.outline.map(s => s.id))
    expect(proposal?.outline[0]?.heading).toBe('Abstract')
    // The commitment is built from the sentence's own `shall <word>` token and the model's stated
    // bound and threshold.
    expect(proposal?.commitment).toEqual({ direction: 'increase', bound: 'at-least', thresholdPct: 25 })
    expect(proposal?.claim.id.startsWith('claim-')).toBe(true)
  })

  it('reads several blocks and keeps the ones that are well formed', () => {
    const answer = [block(), '---', block({ TITLE: 'Second', DIRECTION: 'delayed reaction budgets' })].join('\n')
    const outcome = parseDirectionProposals(answer, request)
    expect(outcome.proposals.map(p => p.title)).toEqual([
      'Ahead-of-Time Prediction in Mixed Platoons',
      'Second',
    ])
  })

  it('refuses a claim about a quantity this study does not measure, in the gate\'s own words', () => {
    // The reason has to be the GATE's, not a parser's paraphrase: a proposal refused here and a run
    // held at the C channel are the same refusal, and two wordings of it would let them drift.
    const outcome = parseDirectionProposals(
      block({
        PREDICTION: 'the cooperative cache shall fall in p99 latency by at least 25%',
      }),
      request,
    )
    expect(outcome.proposals).toEqual([])
    expect(outcome.rejected[0]?.reason).toContain('does not name that quantity')
  })

  it('refuses a bound the sentence does not anchor', () => {
    const outcome = parseDirectionProposals(block({ BOUND: 'within' }), request)
    expect(outcome.rejected[0]?.reason).toContain('anchors the threshold with "at-least"')
  })

  it('refuses a threshold the sentence does not state', () => {
    const outcome = parseDirectionProposals(block({ THRESHOLD: '40' }), request)
    expect(outcome.rejected[0]?.reason).toContain('states 25%')
  })

  it('refuses a prediction that states no direction, and says which form it wanted', () => {
    // A written-as-prohibition prediction fails the SHAPE check first, so the reason a proposal is
    // refused for is the same sentence a run holds with. The parser does not paraphrase it.
    const outcome = parseDirectionProposals(
      block({
        PREDICTION:
          'the HV-AV-HV platoon minimum time-to-collision shall not rise by at least 25%',
      }),
      request,
    )
    expect(outcome.proposals).toEqual([])
    expect(outcome.rejected[0]?.reason).toContain('does not state its direction in the required form')
  })

  it('refuses a prediction whose negation is somewhere the shape check cannot see', () => {
    // The evasion `POLARITY_WORDS` documents: the required shape sits inside the measuring clause
    // and the negation sits elsewhere. The gate holds on it, so a proposal must not be offered.
    const outcome = parseDirectionProposals(
      block({
        PREDICTION:
          'the HV-AV-HV platoon shall rise in minimum time-to-collision by at least 25%, '
          + 'and that outcome is no artefact of the disturbance period',
      }),
      request,
    )
    expect(outcome.proposals).toEqual([])
    expect(outcome.rejected[0]?.reason).toContain('contains a negation')
  })

  it('refuses a section list that does not match the pipeline\'s skeleton', () => {
    const outcome = parseDirectionProposals(block({ SECTIONS: 'Abstract | Method' }), request)
    expect(outcome.rejected[0]?.reason).toContain('skeleton has 7')
  })

  it('refuses a bound that is none of the three accepted words', () => {
    const outcome = parseDirectionProposals(block({ BOUND: 'roughly' }), request)
    expect(outcome.rejected[0]?.reason).toContain('BOUND is "roughly"')
  })

  it('names every labelled field a block left out', () => {
    const outcome = parseDirectionProposals('TITLE: Only a title\nDIRECTION: and a direction', request)
    expect(outcome.rejected[0]?.reason).toContain('CLAIM')
    expect(outcome.rejected[0]?.reason).toContain('SECTIONS')
  })

  it('distinguishes "every block was refused" from "nothing was proposed"', () => {
    // A caller that only counted proposals could not tell an unusable answer from an empty one, and
    // the two need different things said about them.
    const refused = parseDirectionProposals('TITLE: Only a title', request)
    expect(refused.proposals).toEqual([])
    expect(refused.rejected).toHaveLength(1)
    const silent = parseDirectionProposals('   \n', request)
    expect(silent.proposals).toEqual([])
    expect(silent.rejected).toEqual([])
  })

  it('keeps the refused block, so a reader can see what was refused', () => {
    const outcome = parseDirectionProposals('TITLE: Only a title', request)
    expect(outcome.rejected[0]?.block).toBe('TITLE: Only a title')
  })
})

describe('planFromProposal', () => {
  it('takes the field from the person, not from the proposal', () => {
    // The proposal was asked for WITHIN that field; restating it as the proposal's own would give
    // the model authorship of a choice it was given.
    const [proposal] = parseDirectionProposals(block(), request).proposals
    expect(proposal).toBeDefined()
    const plan = planFromProposal(proposal!, 'road transport safety', MEASURED_METRIC)
    expect(plan.field).toBe('road transport safety')
    expect(plan.title).toBe(proposal?.title)
    expect(plan.direction).toBe(proposal?.direction)
    expect(plan.commitment).toEqual(proposal?.commitment)
  })
})

describe('a derived claim id fits the tool that consumes it', () => {
  // The defect: `claimIdFor` slugged the whole direction with no bound, so a model-proposed
  // direction over 58 characters produced a claim id the `claim-construct` tool refused. The plan
  // passed `requirePlan`, the run reached A2, and A2 failed with a schema violation — a plan
  // problem surfacing as an execution failure two steps in, which is what an unbounded derivation
  // costs. Measured against a real run, not constructed: the run's A2 error was
  // `claim-construct.claimId: longer than maxLength 64`.
  const LONG_DIRECTION =
    'Compensating for vehicle-to-vehicle communication delay in a cooperative adaptive cruise control platoon'

  it('bounds an id derived from a long direction', () => {
    const id = claimIdFor(LONG_DIRECTION)
    expect(id.length).toBeLessThanOrEqual(INPUT_LIMITS.maxClaimIdChars)
    expect(id.startsWith('claim-')).toBe(true)
  })

  it('keeps two long directions that share a prefix apart', () => {
    // Truncation alone would collide them onto one id, and two studies on one claim id is worse
    // than a long one: nothing downstream could tell their artifacts apart.
    const twin = `${LONG_DIRECTION} under mixed traffic`
    expect(claimIdFor(LONG_DIRECTION)).not.toBe(claimIdFor(twin))
  })

  it('is stable for the same direction', () => {
    expect(claimIdFor(LONG_DIRECTION)).toBe(claimIdFor(LONG_DIRECTION))
  })

  it('leaves a short direction alone', () => {
    expect(claimIdFor('mixed platoon car-following')).toBe('claim-mixed-platoon-car-following')
  })

  it('refuses a plan whose claim id the tool would reject, at the boundary', () => {
    const plan = {
      ...DEFAULT_PLAN,
      claim: { ...DEFAULT_PLAN.claim, id: 'c'.repeat(INPUT_LIMITS.maxClaimIdChars + 1) },
    }
    const validated = requirePlan(plan, MEASURED_METRIC)
    expect(validated.ok).toBe(false)
    if (validated.ok) throw new Error('unreachable')
    expect(validated.reason).toContain('claim.id')
    expect(validated.reason).toContain(String(INPUT_LIMITS.maxClaimIdChars))
  })

  it('accepts an id exactly at the limit', () => {
    const plan = {
      ...DEFAULT_PLAN,
      claim: { ...DEFAULT_PLAN.claim, id: 'c'.repeat(INPUT_LIMITS.maxClaimIdChars) },
    }
    expect(requirePlan(plan, MEASURED_METRIC).ok).toBe(true)
  })
})
