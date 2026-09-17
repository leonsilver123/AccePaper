/**
 * The argument plan — what each section is FOR, and what it must not leave out.
 *
 * THE PAPER THESE RULES COME FROM reports a refutation as though it were the finding it hoped for:
 * −38.2% against a prediction of at least +20%, with no section saying the measurement contradicts
 * the claim. Two things follow, and both are tested here: the obligations a refuted claim puts on the
 * sections that report it, and the fact that the SAME measurement under a claim that predicted a fall
 * is supported — so the plan is derived from the run, not written for this paper.
 */
import { describe, expect, it } from 'vitest'
import {
  ARGUMENT_PLAN_VERSION, argumentPlanOf, checkArgumentPlan, checkSectionContract, claimOutcomeOf,
} from '../src/runner/argument-plan.ts'
import type { ArgumentPlan } from '../src/runner/argument-plan.ts'

/** The shipped study: a claim that predicts a rise, and a measurement that fell by 38.2%. */
const SHIPPED = {
  question: 'does one autonomous vehicle change the platoon minimum time-to-collision',
  claimRef: 'inserting one AV into a three-vehicle human platoon raises the platoon minimum time-to-collision',
  metricLabel: 'the platoon minimum time-to-collision',
  measuredPct: -38.2,
  committedDirection: 'increase' as const,
  thresholdPct: 20,
  sectionIds: ['abstract', 'introduction', 'method', 'experiments', 'results', 'conclusion', 'references'],
}

/** The contract one section of a plan carries. */
function contractOf(plan: ArgumentPlan, id: string) {
  const contract = plan.sections.find(section => section.id === id)
  if (contract === undefined) throw new Error(`no contract for ${id}`)
  return contract
}

describe('what a measurement did to the claim it committed to', () => {
  it('is a refutation when the measurement moved the other way', () => {
    expect(claimOutcomeOf(-38.2, 'increase', 20)).toBe('refuted')
  })

  it('is a support when it moved the committed way and cleared the threshold', () => {
    expect(claimOutcomeOf(-38.2, 'decrease', 20)).toBe('supported')
    expect(claimOutcomeOf(38.2, 'increase', 20)).toBe('supported')
  })

  it('is indeterminate when it moved the committed way and fell short of the threshold', () => {
    // MOVING THE RIGHT WAY IS NOT THE CLAIM BEING MET. A claim that committed to at least 20% is not
    // supported by a 3% movement, and calling that a support is how a threshold stops meaning anything.
    expect(claimOutcomeOf(3, 'increase', 20)).toBe('indeterminate')
  })
})

describe('the obligations a refuted claim puts on the sections that report it', () => {
  const plan = argumentPlanOf(SHIPPED)

  it('makes the Results section state the change, the direction, and the contradiction', () => {
    const obligations = contractOf(plan, 'results').obligations
    expect(obligations.map(obligation => obligation.kind))
      .toEqual(['measured-change', 'direction-of-change', 'adverse-result'])
    expect(obligations.find(obligation => obligation.kind === 'measured-change')?.check?.percentWithin)
      .toBe(38.2)
  })

  it('is discharged by a section that states the measured change and its direction', () => {
    // THE DIRECTION IS STATED IN WORDS, not only in the sign of the number: a section carrying
    // `-38.20%` and calling it an improvement is the misreading the quality baseline catches, and a
    // rule that took the sign for a direction would let it through here.
    expect(checkSectionContract(
      contractOf(plan, 'results'),
      'The mixed platoon held 12.10 s against 19.58 s, a change of -38.20%: the quantity fell,'
      + ' contradicting the claim it was measured against.',
    )).toEqual([])
  })

  it('is REFUSED when the section reports the result and not the contradiction', () => {
    // THE DELIVERED PAPER'S CONCLUSION, in the shape it has: the number, no direction, and nothing
    // saying the measurement runs against the claim it was testing.
    const refusals = checkSectionContract(
      contractOf(plan, 'conclusion'),
      'The platoon minimum time-to-collision fell by 38.20%.',
    )
    expect(refusals.map(refusal => refusal.code)).toEqual(['argument-obligation-unmet'])
    // THE SECTION REPORTED THE MEASUREMENT FAITHFULLY AND SAID NOTHING ABOUT WHAT IT DID TO THE CLAIM,
    // which is the delivered paper's Conclusion exactly.
    expect(refusals[0]?.detail).toContain('does not state the contradiction')
  })

  it('is refused when the section rounds the measurement into a different number', () => {
    // A SECTION STATING 38% HAS STATED A NUMBER THE RUN DID NOT MEASURE, and the tolerance is what
    // separates rounding from a different figure.
    const refusals = checkSectionContract(
      contractOf(plan, 'results'),
      'The change was 38% and the platoon slowed.',
    )
    expect(refusals[0]?.detail).toContain('does not state 38.2%')
  })

  it('leaves the sections that do not report the outcome alone', () => {
    // THE METHOD SECTION OWES NO MEASUREMENT, and a plan that obliged every section to quote one would
    // refuse the paper over a section that is not about the result.
    expect(checkSectionContract(contractOf(plan, 'method'), 'Both platoons run the same model.'))
      .toEqual([])
  })
})

describe('the same measurement under a claim that predicted it', () => {
  it('makes a supported claim, and obliges the section to state the direction it moved', () => {
    // THE SECOND TASK IS THE CONTROL: the same −38.2% against a claim that committed to a fall is a
    // SUPPORT, and what the section owes changes with it. A plan written for one paper would demand
    // the opposite of a contradiction here and refuse a correct manuscript.
    const plan = argumentPlanOf({ ...SHIPPED, committedDirection: 'decrease' })
    expect(plan.outcome).toBe('supported')
    expect(contractOf(plan, 'results').obligations.map(obligation => obligation.kind))
      .toEqual(['measured-change', 'direction-of-change'])
    expect(checkSectionContract(
      contractOf(plan, 'results'),
      'The platoon minimum time-to-collision fell by 38.20%, which is what the claim predicted.',
    )).toEqual([])
  })
})

describe('the manuscript and the plan it was written under', () => {
  const plan = argumentPlanOf(SHIPPED)

  it('is refused when a section the plan declares is absent', () => {
    const refusals = checkArgumentPlan(plan, [
      { id: 'results', bodyText: 'The change was 38.20% and the platoon slowed.' },
    ])
    expect(refusals.filter(refusal => refusal.code === 'argument-section-missing').length)
      .toBe(plan.sections.length - 1)
  })

  it('is refused when the manuscript carries a section the plan does not declare', () => {
    const refusals = checkArgumentPlan(argumentPlanOf({
      ...SHIPPED,
      // A plan whose outline does not name the section the manuscript carries. The outline is the
      // plan's, so a section outside it is one whose job nobody declared.
      sectionIds: ['results'],
    }), [
      { id: 'results', bodyText: 'The change was 38.20%, a fall.' },
      { id: 'acknowledgements', bodyText: 'Thanks.' },
    ])
    expect(refusals.map(refusal => refusal.code)).toContain('argument-section-undeclared')
  })

  it('states the version it is, so a draft records what it was written under', () => {
    expect(plan.version).toBe(ARGUMENT_PLAN_VERSION)
  })
})
