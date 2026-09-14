// @deepseek-ai/dsh-research-team — T19-S P2-1 regression: the C gate must be
// FAIL-CLOSED when there is no experiment report, exactly like the C1-mvp
// executor that feeds it.
//
// Background (independent T19-S audit, P2-1): `verdictC` used to fabricate a
// keep-path report (`supportsPrediction: true`) whenever the experiment fixture
// lookup missed, while `c1Executor` (registry.ts) throws on the very same miss —
// an asymmetry that handed the C gate a default pass. Both sides now fail closed:
// no experiment ⇒ no adjudication ⇒ `abstained`, core holds the step.

import { describe, expect, it } from 'vitest'
import { getStepDefinitionById } from '@deepseek-ai/dsh-research-core'
import type { StepDefinition } from '@deepseek-ai/dsh-research-core'

import { createRunContext } from '../src/runner/drive.ts'
import { CANONICAL } from '../src/runner/registry.ts'
import { buildStepVerdicts } from '../src/runner/verdict.ts'
import { MEASURED_METRIC_KEY, evaluatePrediction, experimentScenario } from '../src/runner/traffic-sim.ts'
import type { VerdictBuildCtx } from '../src/runner/types.ts'

const C2: StepDefinition | undefined = getStepDefinitionById('C2-trinity-loop')

describe('T19-S — C-channel fail-closed symmetry with C1-mvp', () => {
  it('abstains when the experiment fixture row is missing (no default pass)', async () => {
    if (C2 === undefined) throw new Error('verdict-fail-closed: C2-trinity-loop is not a core step')
    const runCtx = createRunContext()
    runCtx.claimId = 'mock-claim-999'
    runCtx.claimRef = 'missing row'
    runCtx.predictionText = 'no such experiment row'
    const ctx: VerdictBuildCtx = { step: C2, attemptId: 1, runCtx, abstain: new Set() }

    const built = await buildStepVerdicts(ctx)
    const c = built.find(v => v.component === 'C')
    expect(c).toBeDefined()
    expect(c?.outcome).toBe('abstained')
    expect(c?.passed).toBe(false)
    // The experiment is RUN now, and the fail-closed condition is that the claim is
    // UNBINDABLE — here because the run states no metric, so nothing connects the prediction to
    // the quantity the experiment measures.
    expect(String(c?.evidence)).toContain('unbindable claim')
    expect(String(c?.evidence)).toContain('declares no metric')
    expect(String(c?.evidence)).toContain('fail-closed')
    // The miss must NOT be smuggled in as support.
    expect(String(c?.evidence)).not.toContain('exp-fixture-synthetic')
  })

  it('still adjudicates to `passed` when the run states a prediction the experiment supports', async () => {
    if (C2 === undefined) throw new Error('verdict-fail-closed: C2-trinity-loop is not a core step')
    const runCtx = createRunContext()
    // The run's OWN prediction. The gate grades this one; it is no longer allowed
    // to substitute the canonical constant when the run states none (next test).
    runCtx.predictionText = CANONICAL.prediction
    // ...and its OWN declared quantity. Both are needed: a prediction about the quantity the
    // experiment measures is what makes the comparison a comparison. Without the key the gate
    // holds, which is what the two tests above and below assert.
    runCtx.metricKey = MEASURED_METRIC_KEY
    const ctx: VerdictBuildCtx = { step: C2, attemptId: 1, runCtx, abstain: new Set() }

    const built = await buildStepVerdicts(ctx)
    const c = built.find(v => v.component === 'C')
    expect(c?.outcome).toBe('passed')
    // The verdict cites the measurement this run performed, and names the quantity it measured.
    // "live" is deliberately NOT the word here: the truthfulness vocabulary reserves
    // `live_external` for reaching a real external system, and this experiment runs locally.
    expect(String(c?.evidence)).toContain('the experiment ran here')
    expect(String(c?.evidence)).toContain(MEASURED_METRIC_KEY.replace('mean-delay-seconds-per-vehicle', 'mean vehicle delay'))
  })

  it('HOLDS a claim about a quantity this study never measures, however confident it reads', () => {
    // The P0 this guards (audit, 2026-09-14): the gate took the first percentage in the claim's
    // prose and compared it to the measured delay reduction. A claim about the platoon
    // string-instability index at ">=5%" was therefore graded `passed` and carried all 16 steps
    // to E2 — an untested claim reported as supported. A different key must hold, not pass;
    // and it must hold rather than fail, because "this study cannot test it" is not "it failed".
    const adjudication = evaluatePrediction(
      'the platoon string-instability index improves by at least 5%',
      experimentScenario(),
      'platoon-string-stability-index',
    )
    expect(adjudication.kind).toBe('unbindable')
    if (adjudication.kind === 'unbindable') {
      expect(adjudication.reason).toContain('platoon-string-stability-index')
      expect(adjudication.reason).toContain(MEASURED_METRIC_KEY)
    }
  })

  it('does NOT grade the canonical prediction when the run states none', async () => {
    // Regression: `verdictC` used to fall back to `CANONICAL.prediction` whenever
    // `runCtx.predictionText` was empty, so a run that stated no prediction was
    // adjudicated against the fixture one and reported `passed` — while the C1
    // executor threw on the very same emptiness. The gate now sees an absent
    // prediction as absent, and `adjudicateClaimSupport` decides what that means.
    if (C2 === undefined) throw new Error('verdict-fail-closed: C2-trinity-loop is not a core step')
    const runCtx = createRunContext() // predictionText stays ''
    const ctx: VerdictBuildCtx = { step: C2, attemptId: 1, runCtx, abstain: new Set() }

    const built = await buildStepVerdicts(ctx)
    const c = built.find(v => v.component === 'C')
    expect(c?.passed).toBe(false)
    // `adjudicateClaimSupport` names the reason: no falsifiable prediction at all,
    // as against a prediction that merely lacks a numeric threshold.
    expect(c?.outcome).toBe('blocked')
    expect(String(c?.rationale)).toContain('no falsifiable prediction')
  })
})
