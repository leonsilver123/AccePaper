// @deepseek-ai/dsh-research-team — T19-B gate-verdict construction (real trinity channels).
//
// For each step gate component ('A' | 'B' | 'C') this module builds the genuine
// GateVerdict via the SAME adjudication sources the production pipeline uses:
//
//   A-channel → team `judgeRound` (pure projection of a completed rebuttal round
//               into a ResearchVerdict via core `adjudicate` component 'A')
//   C-channel → team `adjudicateClaimSupport` (falsifiable prediction vs a `live`
//               experiment report MEASURED by the traffic simulation on the study's
//               measured demand profile, decided by core `adjudicate` component 'C')
//   B-channel → the T23 external-anchor fixture (`../anchor`) supplies the claim
//               stance; the REAL core citation identity chain `verifyCitation`
//               runs against a SIMULATED resolver (`MockCitationResolverAdapter`)
//               to produce the anchoring verification; core `adjudicate`
//               component 'B' decides. Truthfulness: `mock_external`.
//               See ./anchor-fixture.ts for the full four-stage chain.
//
// Discipline (spec §3/§7): this module does NOT re-implement the core gate and
// does NOT reinterpret an outcome. Every verdict is submitted to the core
// `submitGateVerdict` by drive.ts (the single adjudication source). `abstained`
// is preserved verbatim — it is never coerced to `passed` (the core state machine
// holds the step at `gated` with `holdReason='gate_abstained'`).

import type {
  AdjudicationConfig,
  AdjudicationInput,
  ClaimId,
  GateVerdict,
  VerificationResult,
} from '@deepseek-ai/dsh-research-core'
import { adjudicate } from '@deepseek-ai/dsh-research-core'

import type { ResearchRebuttal, SessionId } from '../types.ts'
import type { RebuttalRound } from '../redteam/rebuttal.ts'
import { judgeRound } from '../redteam/judge.ts'
import { adjudicateClaimSupport } from '../experiment/support.ts'
import { EXPERIMENT_FIXTURE_RULE_VERSION } from '../experiment/fixture.ts'
import { B_CHANNEL_CONTRADICT_REF, buildBChannelAnchors } from './anchor-fixture.ts'
import { evaluatePrediction } from './traffic-sim.ts'
import { CANONICAL } from './registry.ts'
import type { VerdictBuildCtx } from './types.ts'

export type { VerdictBuildCtx } from './types.ts'

const A_CHANNEL_ROLES = ['red-method', 'red-stats', 'red-ethics'] as const

function supportVote(
  role: string,
  index: number,
  roundId: string,
  claimRef: string,
  gate: string,
): ResearchRebuttal {
  return {
    roundId,
    claimRef,
    gate,
    voterRole: role,
    voterId: `s-${role}` as unknown as SessionId,
    position: 'support',
    rationale: `red-team ${role} converges on support`,
    modelFamily: `family-${index + 1}`,
  }
}

/** Build the A-channel verdict via team `judgeRound` → core `adjudicate('A')`. */
function verdictA(ctx: VerdictBuildCtx): GateVerdict {
  const useAbstain = ctx.abstain.has('A')
  const roundId = `t19b-round-${ctx.step.id}`
  const claimRef = ctx.runCtx.claimRef || CANONICAL.claimRef
  const votes: ResearchRebuttal[] = A_CHANNEL_ROLES.map((role, i) =>
    supportVote(role, i, roundId, claimRef, ctx.step.id),
  )
  const round: RebuttalRound = {
    roundId,
    claimRef,
    gate: ctx.step.id,
    expectedRoles: A_CHANNEL_ROLES,
    status: 'completed',
    votes,
  }
  // An uncalibrated config makes core abstain (NO DEFAULT PASS) — used to drive
  // the recovery `gate_abstained` hold faithfully through the real adjudicator.
  const config: AdjudicationConfig = useAbstain
    ? {}
    : { minValidVotes: 2, passThreshold: 0.5, sameFamilyDownweight: 0.5 }
  const rv = judgeRound(round, config, ctx.runCtx.timestamp)
  return {
    component: 'A',
    outcome: rv.outcome,
    passed: rv.outcome === 'passed',
    evidence:
      `team:judgeRound → core adjudicate('A') outcome=${rv.outcome}` +
      (useAbstain ? ' (injected abstention: uncalibrated config → abstain)' : ''),
    rationale: rv.summary,
    timestamp: ctx.runCtx.timestamp,
  }
}

/**
 * Build the B-channel verdict: T23 anchor fixture (stance) + core `verifyCitation`
 * over `MockCitationResolverAdapter` (anchoring evidence) → core `adjudicate('B')`.
 *
 * The abstention scenario is driven by DATA, not by a bypass: it points the T23
 * lookup at the `contradict` fixture row, so the fail-closed path produces no
 * anchoring verification and the real core gate abstains on its own.
 */
async function verdictB(ctx: VerdictBuildCtx): Promise<GateVerdict> {
  const useAbstain = ctx.abstain.has('B')
  const claimId = (ctx.runCtx.claimId || CANONICAL.claimId) as ClaimId
  const anchors = await buildBChannelAnchors({
    claimId,
    stepId: ctx.step.id,
    timestamp: ctx.runCtx.timestamp,
    ...(useAbstain ? { anchorRef: B_CHANNEL_CONTRADICT_REF } : {}),
  })
  const verifications: ReadonlyArray<VerificationResult> = anchors.verifications

  const input: AdjudicationInput = {
    claimId,
    component: 'B',
    verifications,
    // The external anchor is REQUIRED: without a usable anchor the core gate
    // abstains rather than passing (NO DEFAULT PASS), in both scenarios.
    config: { requireExternalAnchor: true },
    timestamp: ctx.runCtx.timestamp,
  }
  const result = adjudicate(input)
  return {
    component: 'B',
    outcome: result.outcome,
    passed: result.outcome === 'passed',
    evidence:
      `core:adjudicate('B') outcome=${result.outcome}; anchoring=${anchors.anchoring}; ` +
      anchors.basis,
    rationale: result.reasonCode,
    timestamp: ctx.runCtx.timestamp,
  }
}

/** Build the C-channel verdict via team `adjudicateClaimSupport` → core `adjudicate('C')`. */
function verdictC(ctx: VerdictBuildCtx): GateVerdict {
  const useAbstain = ctx.abstain.has('C')
  const predictionText = ctx.runCtx.predictionText || CANONICAL.prediction
  const claimRef = ctx.runCtx.claimRef || CANONICAL.claimRef

  if (useAbstain) {
    // No experiment report → adjudicateClaimSupport abstains (NO DEFAULT PASS).
    const rec = adjudicateClaimSupport({
      claimRef,
      prediction: { text: predictionText },
      timestamp: ctx.runCtx.timestamp,
    })
    return {
      component: 'C',
      outcome: rec.outcome,
      passed: rec.outcome === 'passed',
      evidence: `team:adjudicateClaimSupport outcome=${rec.outcome} (no experiment report → hold)`,
      rationale: rec.summary,
      timestamp: ctx.runCtx.timestamp,
    }
  }

  // The experiment is RUN, not looked up. Both this gate and the C1 executor call
  // the same measurement, so the verdict can never disagree with the artifact.
  const experiment = evaluatePrediction(predictionText)
  if (experiment === undefined) {
    // FAIL-CLOSED: a prediction that states no numeric threshold cannot be
    // adjudicated by this study, so the gate holds instead of fabricating a report.
    // Symmetric with the C1 executor, which throws on the same condition.
    const held = adjudicateClaimSupport({
      claimRef,
      prediction: { text: predictionText },
      timestamp: ctx.runCtx.timestamp,
    })
    return {
      component: 'C',
      outcome: held.outcome,
      passed: held.outcome === 'passed',
      evidence:
        `team:adjudicateClaimSupport outcome=${held.outcome} `
        + '(the prediction states no numeric threshold → hold; fail-closed, symmetric with C1-mvp)',
      rationale: held.summary,
      timestamp: ctx.runCtx.timestamp,
    }
  }
  const report = {
    source: 'live' as const,
    supportsPrediction: experiment.supportsPrediction,
    detail: experiment.detail,
    evaluator: 'traffic-sim (Webster delay model, two-phase intersection, measured demand profile)',
    fixtureVersion: EXPERIMENT_FIXTURE_RULE_VERSION,
  }
  const rec = adjudicateClaimSupport({
    claimRef,
    prediction: { text: predictionText },
    report,
    timestamp: ctx.runCtx.timestamp,
  })
  return {
    component: 'C',
    outcome: rec.outcome,
    passed: rec.outcome === 'passed',
    evidence:
      `team:adjudicateClaimSupport → core adjudicate('C') outcome=${rec.outcome} `
      + `(live experiment: measured ${experiment.reductionPct.toFixed(2)}% vs required ${String(experiment.thresholdPct)}%)`,
    rationale: rec.summary,
    timestamp: ctx.runCtx.timestamp,
  }
}

/** Build the genuine gate verdicts for every component of one step's gate. */
export async function buildStepVerdicts(ctx: VerdictBuildCtx): Promise<ReadonlyArray<GateVerdict>> {
  const out: GateVerdict[] = []
  for (const comp of ctx.step.gate) {
    if (comp === 'A') out.push(verdictA(ctx))
    else if (comp === 'B') out.push(await verdictB(ctx))
    else out.push(verdictC(ctx))
  }
  return out
}
