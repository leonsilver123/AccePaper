/**
 * The A and B channels must judge FROM their material.
 *
 * The defect both halves of this file pin: the A channel emitted three `position: 'support'`
 * literals with a constant rationale whatever the run contained, and the B channel hardcoded
 * `claimedConclusion: 'supported'` / `contentSupportsClaim: true` into the citation chain
 * whatever the anchor said. A gate that cannot be moved by its input is a constant, and every
 * step it gated advanced for a reason unrelated to the work.
 *
 * The test that matters is therefore not "does the happy path pass" — the old code passed that
 * too — but **does the verdict change when the material changes**, in all three directions:
 * supporting material passes, contradicting material does not, and missing material is held
 * rather than graded. Each channel is driven through its real adjudicator, not a stub.
 */

import { describe, expect, it } from 'vitest'
import { getStepDefinitionById, adjudicate } from '@deepseek-ai/dsh-research-core'
import type { AdjudicationInput, StepDefinition } from '@deepseek-ai/dsh-research-core'

import { createRunContext } from '../src/runner/drive.ts'
import { B_CHANNEL_ANCHOR_REF, B_CHANNEL_CONTRADICT_REF, buildBChannelAnchors } from '../src/runner/anchor-fixture.ts'
import { MEASURED_METRIC_KEY, experimentStudy } from '../src/runner/platoon-sim.ts'
import { EMPTY_CLAIM_MATERIAL, reviewClaim } from '../src/runner/redteam-review.ts'
import type { ClaimMaterial } from '../src/runner/redteam-review.ts'
import { buildStepVerdicts } from '../src/runner/verdict.ts'
import type { VerdictBuildCtx } from '../src/runner/types.ts'

/** C2-trinity-loop is the only step whose gate carries all three components. */
const C2: StepDefinition | undefined = getStepDefinitionById('C2-trinity-loop')

/** Material a claim could genuinely produce: complete, bound, and traceable. */
const SUPPORTING: ClaimMaterial = {
  assertion: 'Inserting one AV into a three-vehicle human platoon raises the platoon minimum time-to-collision.',
  prediction: 'the HV-AV-HV platoon minimum time-to-collision exceeds the all-HV platoon minimum by at least 20%',
  experimentToFalsify: 'Simulate both platoons under the same declared disturbance and compare their minimum time-to-collision.',
  scope: 'three vehicles, one lane, steady free flow under the declared periodic disturbance',
  dataSource: 'mock-experiment.json',
  essentialDifference: 'a single autonomous vehicle in the middle position rather than a fully autonomous platoon',
  metricKey: MEASURED_METRIC_KEY,
  truthfulness: 'fixture',
  measuredMetricKey: MEASURED_METRIC_KEY,
  declaredSources: ['case-pack.json', 'mock-experiment.json', 'claim.json'],
  commitment: { direction: 'increase', bounded: false },
}

/** Material that CONTRADICTS what the study can test, in three different ways. */
const OPPOSING: ClaimMaterial = {
  ...SUPPORTING,
  // The claim is about a quantity this study never measures, and points at a source the pack
  // never shipped, and asserts an unbounded result. Each check has something to refuse.
  prediction: 'the platoon string-instability index improves by at least 20%',
  scope: '',
  dataSource: 'a-paper-we-did-not-ship.json',
  metricKey: 'platoon-string-stability-index',
}

/**
 * Supporting material whose EVIDENCE is degraded while its QUANTITY is unchanged: the claim,
 * the prediction and the metric are exactly `SUPPORTING`'s, and only the scope and the source
 * are broken. Used to show the A channel moves while the C channel does not — which is what
 * attributes the change to the review rather than to some other field of the run.
 *
 * Both of the review's evidence-bearing roles must refuse it. That is not incidental: with the
 * declared calibration (`passThreshold: 0.5` over deciding votes) ONE dissenting rulebook
 * cannot fail the gate, so a single-axis degradation still passes. That is the calibration's
 * pre-registered behaviour and it is recorded here rather than worked around.
 */
const GAPPED_A_ONLY: ClaimMaterial = { ...SUPPORTING, scope: '', dataSource: 'not-in-the-pack.json' }

/** Material that states nothing the review can run on. */
const INSUFFICIENT: ClaimMaterial = { ...EMPTY_CLAIM_MATERIAL }

function ctxFor(material: ClaimMaterial): VerdictBuildCtx {
  if (C2 === undefined) throw new Error('trinity-material: C2-trinity-loop is not a core step')
  const runCtx = createRunContext()
  runCtx.claimRef = 'claim-mixed-platoon-following-risk'
  runCtx.predictionText = material.prediction
  runCtx.metricKey = material.metricKey
  runCtx.claimMaterial = material
  runCtx.study = experimentStudy()
  return { step: C2, attemptId: 1, runCtx, abstain: new Set() }
}

describe('A channel — the verdict follows the material', () => {
  it('reviews each role from the material rather than emitting a constant', () => {
    const supporting = reviewClaim(SUPPORTING)
    const opposing = reviewClaim(OPPOSING)
    const insufficient = reviewClaim(INSUFFICIENT)

    // Same roles, three different outcomes — the property the old fixed votes could not have.
    expect(supporting.map(r => r.position)).toEqual(['support', 'support', 'support'])
    expect(opposing.map(r => r.position)).toContain('refute')
    expect(insufficient.map(r => r.position)).toEqual(['abstain', 'abstain', 'abstain'])

    // And the rationales name what was found, so two roles cannot report the same sentence.
    const rationales = opposing.map(r => r.rationale)
    expect(new Set(rationales).size).toBe(rationales.length)
    expect(opposing.find(r => r.role === 'red-stat')!.rationale).toContain('platoon-string-stability-index')
    expect(opposing.find(r => r.role === 'red-domain')!.rationale).toContain('a-paper-we-did-not-ship.json')
    expect(supporting.find(r => r.role === 'red-method')!.rationale).toContain('steady free flow')
  })

  it('passes on supporting material and does NOT pass on the other two', async () => {
    const supporting = await buildStepVerdicts(ctxFor(SUPPORTING))
    const opposing = await buildStepVerdicts(ctxFor(OPPOSING))
    const insufficient = await buildStepVerdicts(ctxFor(INSUFFICIENT))

    const aOf = (verdicts: Awaited<ReturnType<typeof buildStepVerdicts>>) =>
      verdicts.find(v => v.component === 'A')

    // Three DIFFERENT outcomes from the same code path, driven only by the material.
    expect(aOf(supporting)?.outcome).toBe('passed')
    expect(aOf(opposing)?.outcome).toBe('failed')
    expect(aOf(insufficient)?.outcome).toBe('abstained')

    // A contradiction and a gap are different findings and must not collapse into one.
    expect(aOf(opposing)?.outcome).not.toBe(aOf(insufficient)?.outcome)
  })

  it('states in its evidence that the votes are rulebooks, not independent reviewers', async () => {
    // The A gate's heterogeneity signal keys on `modelFamily`, and no vote declares one
    // because no model was called. A reader who took `passed` as "three reviewers agreed"
    // would be taking a guarantee this channel does not offer, so the evidence says so.
    const verdicts = await buildStepVerdicts(ctxFor(SUPPORTING))
    const a = verdicts.find(v => v.component === 'A')
    expect(String(a?.evidence)).toContain('NO model called')
    expect(String(a?.evidence)).toContain('red-method=support')
    expect(String(a?.rationale)).toContain('the claim names the experiment that would falsify it')
  })
})

describe('B channel — the verdict follows the anchor material', () => {
  /** Run the real anchor chain for one fixture row and let core decide the gate. */
  async function gateB(anchorRef: string): Promise<string> {
    const anchors = await buildBChannelAnchors({ claimId: 'claim-x' as never, stepId: 'C2-trinity-loop', timestamp: 1, anchorRef })
    const input: AdjudicationInput = {
      claimId: 'claim-x' as never,
      component: 'B',
      verifications: anchors.verifications,
      config: { requireExternalAnchor: true },
      timestamp: 1,
    }
    return adjudicate(input).outcome
  }

  it('produces three different outcomes for the three anchor stances', async () => {
    // support / contradict / inconclusive are three different statements about the claim, and
    // all three must be distinguishable at the gate. Before this change a contradicting anchor
    // produced no anchoring verification at all, so it and an inconclusive one were the same
    // verdict — the channel could not report "the literature disagrees with you".
    expect(await gateB(B_CHANNEL_ANCHOR_REF)).toBe('passed')
    expect(await gateB(B_CHANNEL_CONTRADICT_REF)).toBe('blocked')
    expect(await gateB('syn-l0-003')).toBe('abstained') // tier3 -> inconclusive stance
  })

  it('blocks on contradiction rather than abstaining, and says which source contradicted', async () => {
    const anchors = await buildBChannelAnchors({
      claimId: 'claim-x' as never,
      stepId: 'C2-trinity-loop',
      timestamp: 1,
      anchorRef: B_CHANNEL_CONTRADICT_REF,
    })
    expect(anchors.anchoring).toBe(false)
    expect(anchors.basis).toContain('contradict')
    const result = adjudicate({
      claimId: 'claim-x' as never,
      component: 'B',
      verifications: anchors.verifications,
      config: { requireExternalAnchor: true },
      timestamp: 1,
    })
    expect(result.outcome).toBe('blocked')
    expect(result.reasonCode).toContain('EXTERNAL_CONTRADICTION')
  })
})

describe('the two channels together', () => {
  it('moves the A verdict on the A material alone, leaving C where it was', async () => {
    // The end-to-end form of the ask. `GAPPED_A_ONLY` differs from `SUPPORTING` only in the
    // fields the REVIEW reads — its metric and its prediction are untouched — so the A
    // component moving while C stands still is what attributes the change to the review
    // rather than to some other field of the run.
    const supporting = await buildStepVerdicts(ctxFor(SUPPORTING))
    const gapped = await buildStepVerdicts(ctxFor(GAPPED_A_ONLY))
    const opposing = await buildStepVerdicts(ctxFor(OPPOSING))
    expect(supporting.find(v => v.component === 'A')?.outcome).toBe('passed')
    // BLOCKED, not FAILED, and the difference is the calibration doing its job: with
    // `passThreshold: 1` a refute by any role means the gate cannot pass, but the outcome still
    // reflects how the deciding votes fell. Here one role refuted, one supported and one
    // abstained — a disagreement that REWORK resolves — where the all-refute material below is
    // `failed` outright. Both stop the run; they say different things about what to do next.
    expect(gapped.find(v => v.component === 'A')?.outcome).toBe('blocked')
    expect(opposing.find(v => v.component === 'A')?.outcome).toBe('failed')
    expect(gapped.find(v => v.component === 'C')?.outcome)
      .toBe(supporting.find(v => v.component === 'C')?.outcome)
  })
})
