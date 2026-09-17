/**
 * The A gate reviews the manuscript, and finds the four things a pipeline can find without reading.
 *
 * The defect (the review's R3): `verdictA` called `reviewClaim(runCtx.claimMaterial)`, so the three
 * offline rulebooks judged the claim's own fields whatever D3 or D4 had written. An offline probe
 * changed a number in the draft, deleted a Method section and skipped the revision; none of it moved
 * the A vote. The gate that is supposed to be the adversarial reader was reading a different
 * document from the one the run produced.
 *
 * WHAT THESE TESTS INJECT, and why each one. Every fault below is one the review named, and each is
 * introduced into a run rather than into a hand-built value wherever the gate has to see it: a
 * doctored number, a deleted section, a citation to nothing, and a conclusion the run's own record
 * contradicts. The first three are checked through the pure review, and the number is checked again
 * through a driven run so that "the gate refuses it" is a fact about the gate rather than about a
 * function the gate happens to call.
 */

import { describe, expect, it } from 'vitest'
import { getArtifact, getRunSnapshot, getStepDefinitions, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { aggregateDisposition } from '@deepseek-ai/dsh-research-core'
import type { GateCheck } from '@deepseek-ai/dsh-research-core'

import { runT19B } from '../src/runner/drive.ts'
import { MANUSCRIPT_REVIEW_ROLES, reviewManuscript } from '../src/runner/manuscript-review.ts'
import { checkDispositionOf } from '../src/runner/verdict.ts'
import type { ManuscriptReviewInput } from '../src/runner/manuscript-review.ts'
import { resolveImplementation } from '../src/runner/implementations.ts'
import { resultVersionOf } from '../src/runner/result-version.ts'
import { comparePlatoons, experimentStudy } from '../src/runner/platoon-sim.ts'
import { DEFAULT_PLAN } from '../src/runner/study-plan.ts'
import { STEP_EXECUTOR_REGISTRY } from '../src/runner/registry.ts'

const RECORD = resultVersionOf(comparePlatoons(experimentStudy()), DEFAULT_PLAN.metric.key)
const NUMBER = RECORD.measured.improvementPct
const IMPLEMENTATION = resolveImplementation(DEFAULT_PLAN).implementation

/** A manuscript that passes, so each injection below has something to break. */
function cleanInput(overrides: Partial<ManuscriptReviewInput> = {}): ManuscriptReviewInput {
  return {
    sections: [
      {
        id: 'method',
        heading: 'Method',
        bodyText:
          'Both platoons are run with the Intelligent Driver Model at a fixed 0.02 s step and differ'
          + ' only in composition, an HV-HV-HV baseline against an HV-AV-HV variant.',
      },
      {
        id: 'results',
        heading: 'Results',
        // THE PROSE NAMES THE FLOATS THE MANUSCRIPT CARRIES: a draft that carries a float no sentence
        // refers to is refused, and this fixture is the manuscript that passes every check.
        bodyText: 'The comparison is drawn in Figure 1 and its two values are listed in Table 1.'
          + ` The homogeneous platoon held ${String(RECORD.measured.baselineMinTtcSeconds)} s of`
          + ' minimum time-to-collision and the mixed platoon'
          + ` ${String(RECORD.measured.variantMinTtcSeconds)} s, a change of ${String(NUMBER)}%.`,
      },
      { id: 'conclusion', heading: 'Conclusion', bodyText: 'The mixed platoon lowers the platoon minimum time-to-collision under the declared disturbance.' },
    ],
    result: RECORD,
    implementationNames: [IMPLEMENTATION?.id ?? '', IMPLEMENTATION?.algorithm ?? ''],
    declaredNumbers: [0.02],
    referenceCount: 3,
    floatLabels: ['Figure 1', 'Table 1'],
    commitment: DEFAULT_PLAN.commitment,
    predictionText: DEFAULT_PLAN.claim.prediction,
    metricPhrases: DEFAULT_PLAN.metric.phrases,
    ...overrides,
  }
}

/** The position one role reached, so a test names the check that fired. */
function positionOf(input: ManuscriptReviewInput, role: string): string {
  const found = reviewManuscript(input).find(entry => entry.role === role)
  if (found === undefined) throw new Error(`fixture: no review from '${role}'`)
  return found.position
}

/** The whole finding line from one role. */
function findingsOf(input: ManuscriptReviewInput, role: string): string {
  const found = reviewManuscript(input).find(entry => entry.role === role)
  return found?.rationale ?? ''
}

describe('a clean manuscript passes every check', () => {
  it('reports support from all four roles', () => {
    expect(reviewManuscript(cleanInput()).map(entry => entry.position)).toEqual([
      'support',
      'support',
      'support',
      'support',
    ])
  })

  it('does not read a citation’s year as a measurement', () => {
    // `(Treiber, Hennecke & Helbing 2000)` is four digits nothing measured, and the first version
    // of the check read it as a result. The rule is narrow: a parenthetical containing a year is a
    // citation.
    const input = cleanInput({
      sections: [
        {
          id: 'method',
          heading: 'Method',
          bodyText: 'The Intelligent Driver Model (Treiber, Hennecke & Helbing 2000) at a 0.02 s step.',
        },
      ],
    })
    expect(positionOf(input, 'red-stat')).toBe('support')
  })

  it('does not read a references section’s identifiers as measurements', () => {
    // THE FIRST BROWSER RUN OF THIS CHECK REFUSED A CORRECT MANUSCRIPT. A model-written References
    // section is a list of identifiers, and the scan read `10.1016/j.trb.2025.103352`, `18051527`
    // and `802.11` as numbers the run never measured — 47 of them — and blocked the step. Every
    // string below is one the real run produced.
    const input = cleanInput({
      sections: [
        {
          id: 'results',
          heading: 'Results',
          bodyText: 'The comparison is drawn in Figure 1 and its values are listed in Table 1.',
        },
        {
          id: 'references',
          heading: 'References',
          bodyText: [
            '[1] A. Author. A platoon study. doi:10.1016/j.trb.2025.103352',
            '[2] B. Author. String stability. https://doi.org/10.1109/TITS.2020.2966412',
            '[3] C. Author. Field tests. arXiv:2406.11508 and 18051527',
            '[4] D. Author. Communication. IEEE 802.11p at 5.9 GHz, 2019.',
          ].join('\n'),
        },
      ],
      referenceCount: 4,
    })
    // The rule is not "strip every identifier scheme" — that is a new scheme away from the next
    // false refusal. It is that this check reads the sections that state results, and a reference
    // list is not one of them.
    expect(positionOf(input, 'red-stat')).toBe('support')
    // What DOES read it is the citation check, and it still does.
    expect(positionOf(input, 'red-citation')).toBe('support')
  })

  it('does not read a citation’s volume and page as measurements', () => {
    // THE SECOND THING THE REAL RUN TAUGHT THIS CHECK. With the identifiers handled, the same
    // manuscript was refused for `62` and `1805` — the volume and page of
    // `Physical Review E 62(2):1805`, cited in running text with no parentheses and no year.
    // The rule that holds is not another scheme: it is what a QUANTITY looks like. A number stated
    // as a result carries a unit or a percent sign, or is a count small enough to be one. A bare
    // integer above that range in prose is a citation, an index or a year.
    const input = cleanInput({
      sections: [
        {
          id: 'method',
          heading: 'Method',
          bodyText:
            'The car-following model is the standard one (Treiber, Hennecke & Helbing, Physical'
            + ' Review E 62(2):1805, 2000), integrated at a fixed 0.02 s step.',
        },
      ],
    })
    expect(positionOf(input, 'red-stat')).toBe('support')
  })

  it('still counts a quantity that carries its unit', () => {
    // The cost of that rule, stated: a bare integer above the count range is not checked. A number
    // with a unit still is, which is what the shipped study's sections state.
    const input = cleanInput({
      sections: [
        { id: 'results', heading: 'Results', bodyText: 'The platoon held 47 s of minimum time-to-collision.' },
      ],
      declaredNumbers: [],
    })
    expect(positionOf(input, 'red-stat')).toBe('refute')
  })

  it('still refuses a measurement in a prose section beside an identifier', () => {
    // The exclusion has to be narrow, or it becomes a way to smuggle a number past the check.
    const input = cleanInput({
      sections: [
        {
          id: 'results',
          heading: 'Results',
          bodyText: 'Following doi:10.1016/j.trb.2025.103352, the effect was 47.3%.',
        },
      ],
      declaredNumbers: [],
    })
    expect(positionOf(input, 'red-stat')).toBe('refute')
    expect(findingsOf(input, 'red-stat')).toContain('47.3')
  })
})

describe('an injected number is found', () => {
  it('refutes a decimal the run did not measure, and names it', () => {
    // THE FAULT THE REVIEW INJECTED. `12.5` appears nowhere in the run.
    const input = cleanInput({
      sections: [
        {
          id: 'results',
          heading: 'Results',
          bodyText: 'The mixed platoon raised the minimum time-to-collision by 12.5%.',
        },
      ],
    })
    expect(positionOf(input, 'red-stat')).toBe('refute')
    expect(findingsOf(input, 'red-stat')).toContain('12.5')
  })

  it('accepts the numbers the run declares but did not measure', () => {
    // A Method section states its parameters, and those live in `method-spec` rather than in the
    // result record. Refusing them would make the check wrong about a correct paper.
    const input = cleanInput({ declaredNumbers: [0.02, 1.4, 2.0, 30.0] })
    expect(positionOf(input, 'red-stat')).toBe('support')
  })

  it('refuses a manuscript whose only number is one nothing declares', () => {
    const input = cleanInput({
      sections: [{ id: 'results', heading: 'Results', bodyText: 'The platoon improved by 47.3%.' }],
      declaredNumbers: [],
    })
    expect(positionOf(input, 'red-stat')).toBe('refute')
  })
})

describe('a deleted section is found', () => {
  it('refutes a manuscript with no Method section', () => {
    const input = cleanInput({
      sections: [{ id: 'results', heading: 'Results', bodyText: 'A result was obtained.' }],
    })
    expect(positionOf(input, 'red-method')).toBe('refute')
    expect(findingsOf(input, 'red-method')).toContain('no Method section')
  })

  it('refutes a Method section whose body is empty', () => {
    const input = cleanInput({
      sections: [
        { id: 'method', heading: 'Method', bodyText: '' },
        { id: 'results', heading: 'Results', bodyText: 'A result was obtained.' },
      ],
    })
    expect(positionOf(input, 'red-method')).toBe('refute')
    expect(findingsOf(input, 'red-method')).toContain('empty')
  })

  it('abstains rather than refuting when the method names no code', () => {
    // A gap, not a contradiction: nothing in the section is false, and nothing in it can be
    // checked. The distinction is the one the gate grades differently, so the check must keep it.
    const input = cleanInput({
      sections: [{ id: 'method', heading: 'Method', bodyText: 'We simulated two platoons and compared them.' }],
    })
    expect(positionOf(input, 'red-method')).toBe('abstain')
  })
})

describe('a citation to nothing is found', () => {
  it('refutes a float the document does not contain', () => {
    const input = cleanInput({
      sections: [
        { id: 'method', heading: 'Method', bodyText: 'The Intelligent Driver Model at a 0.02 s step.' },
        { id: 'results', heading: 'Results', bodyText: 'Figure 4 shows the trajectory.' },
      ],
      floatLabels: ['Figure 1', 'Table 1'],
    })
    expect(positionOf(input, 'red-citation')).toBe('refute')
    expect(findingsOf(input, 'red-citation')).toContain('figure 4')
  })

  it('refutes a bracketed reference outside the list', () => {
    const input = cleanInput({
      sections: [
        { id: 'method', heading: 'Method', bodyText: 'The Intelligent Driver Model at a 0.02 s step.' },
        { id: 'results', heading: 'Results', bodyText: 'This agrees with prior work [9].' },
      ],
      referenceCount: 3,
    })
    expect(positionOf(input, 'red-citation')).toBe('refute')
    expect(findingsOf(input, 'red-citation')).toContain('[9]')
  })

  it('accepts a citation that exists', () => {
    const input = cleanInput({
      sections: [
        { id: 'method', heading: 'Method', bodyText: 'The Intelligent Driver Model at a 0.02 s step.' },
        // Every float the manuscript carries is named, which is what the citation role checks in
        // both directions: a cited label must exist, and a carried float must be referred to.
        { id: 'results', heading: 'Results', bodyText: 'See Figure 1 and Table 1 and prior work [2].' },
      ],
    })
    expect(positionOf(input, 'red-citation')).toBe('support')
  })
})

describe('a conclusion its own evidence contradicts is found', () => {
  it('refutes a manuscript claiming a rise where the record fell', () => {
    // The run measures −38.2 %: the mixed platoon's minimum TTC is LOWER. A manuscript that reports
    // an improvement states the opposite of its own measurement.
    const input = cleanInput({
      sections: [
        { id: 'method', heading: 'Method', bodyText: 'The Intelligent Driver Model at a 0.02 s step.' },
        {
          id: 'conclusion',
          heading: 'Conclusion',
          // A FINDING states a magnitude. A direction with no number is a hypothesis, and the
          // check abstains on it rather than grading it — see the test below.
          bodyText: 'The autonomous vehicle raises the platoon minimum time-to-collision by 12.5%.',
        },
      ],
    })
    expect(NUMBER).toBeLessThan(0)
    expect(positionOf(input, 'red-claim')).toBe('refute')
  })

  it('abstains rather than refuting when the manuscript states no finding', () => {
    // A hypothesis is not a finding. Grading one as a false finding is how a correct manuscript
    // gets blocked for describing its own claim, which is what the first version of this check did
    // to a real browser run.
    const input = cleanInput({
      sections: [
        { id: 'method', heading: 'Method', bodyText: 'The Intelligent Driver Model at a 0.02 s step.' },
        {
          id: 'introduction',
          heading: 'Introduction',
          bodyText:
            'We test whether the autonomous vehicle raises the platoon minimum time-to-collision.'
            + ' The mixed platoon shall exceed the baseline in minimum time-to-collision by at least 20%.',
        },
      ],
    })
    expect(positionOf(input, 'red-claim')).toBe('abstain')
  })

  it('accepts the direction the record holds', () => {
    const input = cleanInput({
      sections: [
        { id: 'method', heading: 'Method', bodyText: 'The Intelligent Driver Model at a 0.02 s step.' },
        {
          id: 'conclusion',
          heading: 'Conclusion',
          bodyText: `The autonomous vehicle lowers the platoon minimum time-to-collision by ${String(Math.abs(NUMBER))}%.`,
        },
      ],
    })
    expect(positionOf(input, 'red-claim')).toBe('support')
  })
})

describe('the A gate refuses a doctored manuscript in a driven run', () => {
  it('blocks D3 when the draft carries a number nothing measured', async () => {
    const store: ResearchRunStore = new Map()
    const real = STEP_EXECUTOR_REGISTRY.get('D3-writing')?.executor
    if (real === undefined) throw new Error('fixture: no D3 executor')
    const run = await runT19B(store, {
      executorOverride: (stepId: string) =>
        stepId === 'D3-writing'
          ? async (ctx) => {
            const produced = await real(ctx)
            const draft = produced['draft'] as { sections: ReadonlyArray<{ id: string; bodyText: string }> }
            // The injection: one plausible decimal that the run never measured.
            const sections = draft.sections.map(section =>
              section.id === 'results'
                ? { ...section, bodyText: `${section.bodyText} The improvement was 12.5%.` }
                : section,
            )
            return { ...produced, draft: { ...draft, sections } }
          }
          : undefined,
      stopBefore: 'D4-rebuttal',
    })
    const d3 = run.steps.find(step => step.stepId === 'D3-writing')
    expect(d3?.verdicts.A).toBe('blocked')
    const evidence = String(getRunSnapshot(store, run.runId).steps['D3-writing']?.gateResults.A?.evidence)
    // The verdict names WHICH document it read. A gate that says only "blocked" leaves a reader
    // unable to tell a manuscript finding from a claim finding.
    expect(evidence).toContain('the draft manuscript')
    expect(evidence).toContain('red-stat=refute')
    // The run stops there rather than carrying a fabricated number further down the pipeline.
    expect(run.steps.at(-1)?.stepId).toBe('D3-writing')
    expect(getArtifact(store, run.runId, 'revised-draft')).toBeUndefined()
  })

  it('reviews the claim material on the steps that run before a manuscript exists', async () => {
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { stopBefore: 'A3-agenda' })
    const evidence = String(getRunSnapshot(store, run.runId).steps['A2-claim']?.gateResults.A?.evidence)
    expect(evidence).toContain('claim material')
    expect(evidence).not.toContain('manuscript')
  })
})

describe('the A verdict is bound to the manuscript version it judged', () => {
  it('carries the attempt’s artifact revisions', async () => {
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { stopBefore: 'D4-rebuttal' })
    const snap = getRunSnapshot(store, run.runId)
    const receipt = snap.steps['D3-writing']?.commit
    const verdict = snap.steps['D3-writing']?.gateResults.A
    expect(receipt).toBeDefined()
    expect(verdict?.targetRefs).toEqual(receipt?.artifacts.map(artifact => artifact.ref))
    // The digest is the other half: a manuscript whose inputs changed after it was written is a
    // different document even when its own bytes are the same.
    expect(verdict?.inputDigest).toBe(receipt?.inputDigest)
  })
})

describe('a required check that did not run blocks the gate', () => {
  it('does not let a required `not_evaluated` pass', () => {
    // The A channel's four checks are produced by one implementation, so the way one goes missing
    // is an implementation that stops running it. Core's aggregation is what refuses that, and it
    // is asserted here because this change is what makes the A channel's checks load-bearing.
    const required = ['red-method', 'red-stat']
    const ran: ReadonlyArray<GateCheck> = [
      { checkId: 'red-method', disposition: 'passed' },
      { checkId: 'red-stat', disposition: 'not_evaluated' },
    ]
    const aggregate = aggregateDisposition(ran, required)
    // A check that reported `not_evaluated` has told the gate it did not run. Reading that as
    // anything but a block would make the disposition decorative.
    expect(aggregate.disposition).toBe('block')
    expect(aggregate.reason).toContain('red-stat')
    // And a check that never ran at all is the same finding, named the same way.
    expect(aggregateDisposition([{ checkId: 'red-method', disposition: 'passed' }], required).disposition).toBe('block')
  })

  it('turns a check that could not run into a block, through the mapping the gate uses', () => {
    // THE WHOLE CHAIN, not the aggregate alone. A check whose required input does not exist says so
    // with `evaluated: false`; the gate reads that through `checkDispositionOf`; the aggregate
    // blocks. Before this the check reported `abstain` — the disposition for a check that READ the
    // material and found it inconclusive — so "nothing was verified" and "the material does not
    // settle it" were the same value, and the gate had no way to refuse the first.
    const withoutRecord = reviewManuscript({ ...cleanInput(), result: undefined })
    const checks: ReadonlyArray<GateCheck> = withoutRecord.map(entry => ({
      checkId: entry.role,
      disposition: checkDispositionOf(entry),
    }))

    expect(withoutRecord.filter(entry => entry.evaluated === false).map(entry => entry.role))
      .toEqual(['red-stat', 'red-claim'])
    const aggregate = aggregateDisposition(checks, MANUSCRIPT_REVIEW_ROLES)
    expect(aggregate.disposition).toBe('block')
    expect(aggregate.reason).toContain('not_evaluated')

    // And the two checks that DID read the manuscript are unaffected: they still pass.
    expect(checks.find(check => check.checkId === 'red-method')?.disposition).toBe('passed')
  })

  it('reports the same four roles the review produces', () => {
    // The round's expected roles are declared, not taken from the reviews: a review that silently
    // dropped a check would otherwise satisfy its own expectation.
    const roles = reviewManuscript(cleanInput()).map(entry => entry.role)
    expect(roles).toEqual(['red-method', 'red-stat', 'red-citation', 'red-claim'])
    expect(getStepDefinitions().length).toBe(16)
  })
})

describe('a float the prose never names', () => {
  it('is refused, because a float nothing refers to is a float the paper did not need', () => {
    // THE DELIVERED PAPER, EXACTLY: Figure 1, Figure 2, Table 1 and three equations, with no sentence
    // naming any of them. A reader meets them as decoration, and the A gate refuses the draft rather
    // than reporting it — a draft that carries a float has decided the float belongs.
    const input = cleanInput({
      sections: [
        { id: 'method', heading: 'Method', bodyText: 'The Intelligent Driver Model at a 0.02 s step.' },
        { id: 'results', heading: 'Results', bodyText: 'The comparison is stated below.' },
      ],
      floatLabels: ['Figure 1', 'Table 1'],
    })
    expect(positionOf(input, 'red-citation')).toBe('refute')
    expect(findingsOf(input, 'red-citation')).toContain('floats no sentence refers to: Figure 1, Table 1')
  })

  it('accepts a draft whose prose names every float it carries', () => {
    const input = cleanInput({
      sections: [
        { id: 'method', heading: 'Method', bodyText: 'The Intelligent Driver Model at a 0.02 s step.' },
        { id: 'results', heading: 'Results', bodyText: 'The comparison is drawn in Figure 1 and listed in Table 1.' },
      ],
      floatLabels: ['Figure 1', 'Table 1'],
    })
    expect(positionOf(input, 'red-citation')).toBe('support')
  })
})

describe('a title that claims the finding the study refuted', () => {
  it('is refused, naming the word and the measurement', () => {
    // THE DELIVERED PAPER'S TITLE: "Raising Minimum Time-to-Collision in Three-Vehicle Platoons ..."
    // above a manuscript reporting that the quantity FELL by 38.2%. The headline asserts the finding
    // the study refuted, and a reader who stops at the title has read the opposite of the result.
    const input = cleanInput({
      title: 'Raising Minimum Time-to-Collision in Three-Vehicle Platoons via Adaptive Gap Control',
    })
    expect(positionOf(input, 'red-claim')).toBe('refute')
    expect(findingsOf(input, 'red-claim')).toContain('the headline asserts the finding the study refuted')
  })

  it('accepts a title that claims no direction, which is what the truth looks like here', () => {
    // WHAT A TITLE MAY SAY when the measurement went against the claim: that the study measured the
    // quantity, not that it moved the way the authors hoped.
    const input = cleanInput({ title: 'Inserting One Autonomous Vehicle Changes a Platoon Minimum Time-to-Collision' })
    expect(positionOf(input, 'red-claim')).toBe('support')
  })

  it('refuses a title claiming a fall when the record rose', () => {
    const input = cleanInput({
      title: 'Lowering the Platoon Minimum Time-to-Collision',
      // The record's own field is `improvementPct`, signed in the metric's units.
      result: { ...RECORD, measured: { ...RECORD.measured, improvementPct: 38.2 } },
    })
    expect(positionOf(input, 'red-claim')).toBe('refute')
  })
})
