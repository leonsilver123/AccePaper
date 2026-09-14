// @deepseek-ai/dsh-research-team — the C gate is FAIL-CLOSED, and a DECISIVE negation is
// not a failure.
//
// Two properties, and they pull in opposite directions on purpose:
//
//   FAIL-CLOSED. An unbindable claim, an absent prediction or an incomparable measurement
//   holds or blocks — none of them may become a pass. `verdictC` once fabricated a keep-path
//   report whenever the experiment fixture lookup missed, while `c1Executor` threw on the very
//   same miss, so the gate handed out a default pass its own executor refused to produce.
//
//   A DECISIVE NEGATION ADVANCES. An experiment that ran, measured the claim's own quantity
//   and NEGATED the prediction has produced its result. The step advances with the claim
//   recorded as refuted. Treating that as a hard failure would mean the pipeline could only
//   run studies that were going to succeed, which is the opposite of what it is for.

import { describe, expect, it } from 'vitest'
import { getStepDefinitionById } from '@deepseek-ai/dsh-research-core'
import type { StepDefinition } from '@deepseek-ai/dsh-research-core'

import { createRunContext } from '../src/runner/drive.ts'
import { CANONICAL } from '../src/runner/registry.ts'
import { buildStepVerdicts } from '../src/runner/verdict.ts'
import { MEASURED_METRIC_KEY, evaluatePrediction, experimentStudy } from '../src/runner/platoon-sim.ts'
import type { VerdictBuildCtx } from '../src/runner/types.ts'

const C2: StepDefinition | undefined = getStepDefinitionById('C2-trinity-loop')

function ctxWith(
  predictionText: string,
  metricKey: string,
  study: ReturnType<typeof experimentStudy> = experimentStudy(),
): VerdictBuildCtx {
  if (C2 === undefined) throw new Error('verdict-fail-closed: C2-trinity-loop is not a core step')
  const runCtx = createRunContext()
  runCtx.claimId = 'claim-mixed-platoon-following-risk'
  runCtx.claimRef = 'mixed platoon'
  runCtx.predictionText = predictionText
  runCtx.metricKey = metricKey
  runCtx.study = study
  // The claim's DECLARED commitment. The gate grades this rather than reading a direction out of
  // the prediction's prose; a run that declares none holds.
  runCtx.commitment = { direction: 'increase', bounded: false }
  return { step: C2, attemptId: 1, runCtx, abstain: new Set() }
}

/** The shipped study with the AV's headway raised until its fast reaction pays off. */
function studyWhereThePredictionHolds(): ReturnType<typeof experimentStudy> {
  const base = experimentStudy()
  return {
    baseline: base.baseline,
    variant: {
      ...base.variant,
      vehicleClasses: {
        ...base.variant.vehicleClasses,
        AV: { ...base.variant.vehicleClasses.AV, desiredHeadwaySeconds: 4.0 },
      },
    },
  }
}

describe('C gate — fail-closed on everything that is not a measurement', () => {
  it('HOLDS a claim that declares no metric, naming the absence', async () => {
    const built = await buildStepVerdicts(ctxWith(CANONICAL.prediction, ''))
    const c = built.find(v => v.component === 'C')
    expect(c?.outcome).toBe('abstained')
    expect(c?.passed).toBe(false)
    expect(String(c?.evidence)).toContain('unbindable claim')
    expect(String(c?.evidence)).toContain('declares no metric')
    expect(String(c?.evidence)).toContain('fail-closed')
  })

  it('HOLDS a claim about a quantity this study never measures, however confident it reads', async () => {
    // The P0 this guards (audit, 2026-09-14): the gate took the first percentage in the
    // claim's prose and compared it to a number the experiment had measured for a DIFFERENT
    // quantity, so an untested claim reached E2 reported as supported.
    const adjudication = evaluatePrediction(
      'the platoon string-instability index improves by at least 20%',
      experimentStudy(),
      'platoon-string-stability-index',
      { direction: 'increase', bounded: false },
    )
    expect(adjudication.kind).toBe('unbindable')
    if (adjudication.kind === 'unbindable') {
      expect(adjudication.reason).toContain('platoon-string-stability-index')
      expect(adjudication.reason).toContain(MEASURED_METRIC_KEY)
    }
  })

  it('HOLDS a claim whose declared key disagrees with its own words', () => {
    // The key alone is self-attestation: a claim about something else passes every check if it
    // simply declares the key of the quantity this study measures. The declaration must agree
    // with the prediction's own text, and this asserts that it is checked rather than trusted.
    const adjudication = evaluatePrediction(
      'the platoon string-instability index improves by at least 20%',
      experimentStudy(),
      MEASURED_METRIC_KEY,
      { direction: 'increase', bounded: false },
    )
    expect(adjudication.kind).toBe('unbindable')
    if (adjudication.kind === 'unbindable') {
      expect(adjudication.reason).toContain('does not name that quantity')
      expect(adjudication.reason).toContain('unverified')
    }
  })

  it('blocks a claim with no falsifiable prediction at all', async () => {
    // Regression: `verdictC` used to fall back to `CANONICAL.prediction` whenever the run
    // stated none, so a run that stated no prediction was adjudicated against the fixture one
    // and reported — while the C1 executor threw on the very same emptiness.
    const built = await buildStepVerdicts(ctxWith('', MEASURED_METRIC_KEY))
    const c = built.find(v => v.component === 'C')
    expect(c?.outcome).toBe('blocked')
    expect(c?.passed).toBe(false)
    expect(String(c?.rationale)).toContain('no falsifiable prediction')
  })
})

describe('C gate — a decisive negation advances the run', () => {
  it('PASSES the step and records the claim as refuted when the experiment negates it', async () => {
    // The shipped configuration: the AV's declared 1.2 s headway costs more margin than its
    // 150 ms reaction buys, so the canonical prediction is refuted. That is a RESULT.
    const verdict = evaluatePrediction(CANONICAL.prediction, experimentStudy(), MEASURED_METRIC_KEY,
      { direction: 'increase', bounded: false })
    expect(verdict.kind).toBe('adjudicated')
    if (verdict.kind !== 'adjudicated') return
    expect(verdict.supportsPrediction).toBe(false)

    const built = await buildStepVerdicts(ctxWith(CANONICAL.prediction, MEASURED_METRIC_KEY))
    const c = built.find(v => v.component === 'C')
    // Passed, because the step's question is whether the claim met a falsifiable test this
    // study could run — not whether the hypothesis won.
    expect(c?.outcome).toBe('passed')
    // ...and the direction is in the evidence, so no reader can take the pass as support.
    expect(String(c?.evidence)).toContain('verdict=refuted')
    expect(String(c?.evidence)).toContain('NEGATED the prediction')
    expect(String(c?.evidence)).toContain('decisive test rather than failing')
  })

  it('passes an experiment that SUPPORTS the prediction too, without the negation wording', async () => {
    // The other direction, so the wording above is known to be CONDITIONAL rather than fixed.
    // The prediction sentence is identical; only the study's AV headway differs, and that is
    // what changes the measurement's sign.
    const prediction = 'the HV-AV-HV platoon minimum time-to-collision exceeds the all-HV platoon minimum by at least 20%'
    const verdict = evaluatePrediction(prediction, studyWhereThePredictionHolds(), MEASURED_METRIC_KEY,
      { direction: 'increase', bounded: false })
    expect(verdict.kind).toBe('adjudicated')
    if (verdict.kind !== 'adjudicated') return
    expect(verdict.supportsPrediction).toBe(true)

    const built = await buildStepVerdicts(ctxWith(prediction, MEASURED_METRIC_KEY, studyWhereThePredictionHolds()))
    const c = built.find(v => v.component === 'C')
    expect(c?.outcome).toBe('passed')
    expect(String(c?.evidence)).toContain('verdict=supported')
    expect(String(c?.evidence)).not.toContain('NEGATED the prediction')
  })
})
