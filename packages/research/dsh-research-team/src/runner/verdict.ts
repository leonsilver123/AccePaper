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
//               The channel DECLARES that provenance (`fixture`; see
//               ./anchor-fixture.ts), and the run's evidence profile is checked
//               against it before adjudication: `production` REFUSES it, so the
//               verifications are withheld and the core B gate abstains on its own
//               missing-anchor path, while `evaluation` admits it and the run's
//               whole output is unsubmittable.
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
import { adjudicate, admitAsEvidence, bindVerdict } from '@deepseek-ai/dsh-research-core'

import type { ResearchRebuttal } from '../types.ts'
import { sessionId } from '../types.ts'
import type { RebuttalRound } from '../redteam/rebuttal.ts'
import { judgeRound } from '../redteam/judge.ts'
import { adjudicateClaimSupport } from '../experiment/support.ts'

import { B_CHANNEL_INCONCLUSIVE_REF, buildBChannelAnchors } from './anchor-fixture.ts'
import type { BChannelEvidence } from './anchor-fixture.ts'
import { buildEvidenceAnchors } from './evidence-anchors.ts'
import { REVIEW_ROLES, reviewClaim } from './redteam-review.ts'
import { MANUSCRIPT_REVIEW_ROLES, reviewManuscript } from './manuscript-review.ts'
import { RESULT_VERSION_SLUG } from './result-version.ts'
import { EXPERIMENT_RULE_VERSION, MEASURED_METRIC, measureStudy } from './platoon-sim.ts'
import { evaluatePrediction } from './prediction-gate.ts'
import { CANONICAL, planOf } from './registry.ts'
import type { VerdictBuildCtx } from './types.ts'

export type { VerdictBuildCtx } from './types.ts'

/** The A channel's roles, taken from the review module so the two cannot drift apart. */
const A_CHANNEL_ROLES: ReadonlyArray<string> = REVIEW_ROLES.map(entry => entry.role)

/**
 * The manuscript this step's A gate reviews, when the run has one.
 *
 * `D3-writing` produces `draft` and `D4-rebuttal` produces `revised-draft`; a step that reads the
 * draft sees it as an input. The more downstream artifact wins, because that is the document the
 * run is currently standing behind.
 */
const MANUSCRIPT_SLUGS: ReadonlyArray<string> = ['revised-draft', 'draft']

/**
 * The manuscript this step's A gate is to review, with the evidence its checks need.
 *
 * `readInput` is absent on a hand-built verdict context, and the run may hold no manuscript yet —
 * both mean the A channel reviews the claim material, which is the pre-manuscript path rather than
 * a fallback from a failure.
 *
 * @param ctx - the verdict context, with the run's artifacts behind it.
 * @returns the manuscript and its rosters, or undefined when there is no manuscript to review.
 */
function manuscriptUnderReview(ctx: VerdictBuildCtx): {
  readonly slug: string
  readonly sections: ReadonlyArray<{ id: string; heading: string; bodyText: string }>
  readonly implementationNames: ReadonlyArray<string>
  readonly declaredNumbers: ReadonlyArray<number>
  readonly referenceCount: number
  readonly floatLabels: ReadonlyArray<string>
} | undefined {
  if (ctx.readInput === undefined) return undefined
  for (const slug of MANUSCRIPT_SLUGS) {
    const value = ctx.readInput(slug)
    const sections = sectionsOfManuscript(value)
    if (sections === undefined) continue
    const draft = value as { references?: unknown; renderedFigures?: unknown }
    const references = Array.isArray(draft.references) ? draft.references : []
    const figures = Array.isArray(draft.renderedFigures) ? draft.renderedFigures : []
    const floatLabels = figures
      .map(entry => (entry !== null && typeof entry === 'object' ? (entry as { title?: unknown }).title : undefined))
      .filter((title): title is string => typeof title === 'string')
    const method = ctx.readInput('method-spec')
    const implementation = method !== null && typeof method === 'object'
      ? (method as { implementation?: { id?: unknown; algorithm?: unknown; parameters?: unknown; varied?: unknown } }).implementation
      : undefined
    const names = [implementation?.id, implementation?.algorithm]
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
    // Every number the run declares: the implementation's own parameters and the values its two
    // arms vary in. A Method section states these, and they are the run's numbers even though the
    // result record does not hold them.
    const declaredNumbers: number[] = []
    const parameters = implementation?.parameters
    if (parameters !== null && typeof parameters === 'object') {
      for (const value of Object.values(parameters)) {
        if (typeof value === 'number' && Number.isFinite(value)) declaredNumbers.push(value)
      }
    }
    if (Array.isArray(implementation?.varied)) {
      for (const entry of implementation.varied) {
        if (entry === null || typeof entry !== 'object') continue
        for (const value of Object.values(entry as Record<string, unknown>)) {
          if (typeof value === 'number' && Number.isFinite(value)) declaredNumbers.push(value)
        }
      }
    }
    return {
      slug,
      sections,
      implementationNames: names,
      declaredNumbers,
      referenceCount: references.length,
      floatLabels,
    }
  }
  return undefined
}

/** The draft's sections, or undefined when the value is not a manuscript-shaped artifact. */
function sectionsOfManuscript(value: unknown): ReadonlyArray<{ id: string; heading: string; bodyText: string }> | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const raw = (value as { sections?: unknown }).sections
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const sections: Array<{ id: string; heading: string; bodyText: string }> = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') return undefined
    const row = entry as { id?: unknown; heading?: unknown; bodyText?: unknown }
    if (typeof row.id !== 'string' || typeof row.heading !== 'string') return undefined
    sections.push({ id: row.id, heading: row.heading, bodyText: typeof row.bodyText === 'string' ? row.bodyText : '' })
  }
  return sections
}

/**
 * Build the A-channel verdict via the rule-based review → team `judgeRound` →
 * core `adjudicate('A')`.
 *
 * WHICH DOCUMENT IT REVIEWS. When the run has produced a manuscript, the A channel reviews THAT —
 * its numbers against the run's measured record, its floats and references against the draft's own
 * rosters, its Method section against the implementation that executed. Before this it reviewed the
 * claim material whatever the step had written, so an offline probe could change a number in the
 * draft, delete a Method section and skip the revision, and the A vote did not move: the gate that
 * is supposed to be the adversarial reader was reading a different document from the one the run
 * produced. The steps gated on A before any manuscript exists (A2, A3, B1, D2) still review the
 * claim material, and the verdict says which of the two it read.
 *
 * The votes are DERIVED from the material either way. They used to be three `support` literals with
 * a constant rationale, which made the gate a constant: it reported the same verdict whatever the
 * run contained, so every step it gated advanced for a reason unrelated to the work. See
 * `./redteam-review.ts` and `./manuscript-review.ts` for what each role checks and for the limit
 * that these are rulebooks rather than model reviewers.
 */
function verdictA(ctx: VerdictBuildCtx): GateVerdict {
  const useAbstain = ctx.abstain.has('A')
  const roundId = `t19b-round-${ctx.step.id}`
  const claimRef = ctx.runCtx.claimRef || CANONICAL.claimRef
  const manuscript = manuscriptUnderReview(ctx)
  const reviews = manuscript === undefined
    ? reviewClaim(ctx.runCtx.claimMaterial)
    : reviewManuscript({
      sections: manuscript.sections,
      result: ctx.readInput?.(RESULT_VERSION_SLUG),
      implementationNames: manuscript.implementationNames,
      declaredNumbers: manuscript.declaredNumbers,
      referenceCount: manuscript.referenceCount,
      floatLabels: manuscript.floatLabels,
      commitment: ctx.runCtx.commitment,
      predictionText: ctx.runCtx.predictionText,
      metricPhrases: planOf(ctx).metric.phrases,
    })
  const reviewed = manuscript === undefined ? 'claim material' : `the ${manuscript.slug} manuscript`
  const votes: ResearchRebuttal[] = reviews.map(review => ({
    roundId,
    claimRef,
    gate: ctx.step.id,
    voterRole: review.role,
    voterId: sessionId(`rulebook-${review.role}`),
    position: review.position,
    rationale: review.rationale,
    // No `modelFamily`: no model was called, so there is no family to declare. The field
    // is what core's correlation detector keys on, and writing one here would claim a
    // heterogeneity these votes do not have. The gate evidence states that limit instead.
  }))
  const round: RebuttalRound = {
    roundId,
    claimRef,
    gate: ctx.step.id,
    // Declared per path rather than taken from the reviews: a review that silently dropped a role
    // would otherwise produce a round that satisfies its own expectation.
    expectedRoles: manuscript === undefined ? A_CHANNEL_ROLES : MANUSCRIPT_REVIEW_ROLES,
    status: 'completed',
    votes,
  }
  // An uncalibrated config makes core abstain (NO DEFAULT PASS) — used to drive
  // the recovery `gate_abstained` hold faithfully through the real adjudicator.
  // `sameFamilyDownweight` is absent from the calibrated config because no vote declares a
  // family: it was previously set for votes that all claimed distinct families, which made
  // the knob unreachable and the claim false at the same time.
  //
  // `passThreshold: 1` — a refute by ANY role fails the gate. It was 0.5, which with three votes
  // meant two rulebooks had to contradict the material before anything happened; one was
  // outvoted. An audit demonstrated the consequence: a claim whose declared data source is not
  // one of the pack's files still passed A, and the C channel passed too because the metric
  // matched, so the whole step advanced with the provenance assertion unchecked. The material's
  // own consistency is not a matter of opinion to be outvoted, and the fail-closed reading of a
  // gate is that every check has to be satisfied.
  //
  // An `abstain` still does not decide, which is core's A semantics and is stated rather than
  // papered over: material with GAPS but no contradiction can still pass. In the shipped path the
  // gaps are unreachable — A2 reads every field through `requiredClaimField`, which throws rather
  // than seeding a claim with a hole.
  const config: AdjudicationConfig = useAbstain
    ? {}
    : { minValidVotes: 2, passThreshold: 1 }
  const rv = judgeRound(round, config, ctx.runCtx.timestamp)
  const tally = reviews.map(review => `${review.role}=${review.position}`).join(', ')
  return {
    component: 'A',
    outcome: rv.outcome,
    passed: rv.outcome === 'passed',
    evidence:
      `team:judgeRound → core adjudicate('A') outcome=${rv.outcome}; `
      + `rule-based offline review of ${reviewed} by ${String(reviews.length)} declared checklists `
      + `(${tally}); `
      + 'one deterministic implementation, NO model called, so these votes are not '
      + 'independent review opinions and a pass here is not three reviewers agreeing'
      + (useAbstain ? ' (injected abstention: uncalibrated config → abstain)' : ''),
    rationale: rv.summary,
    timestamp: ctx.runCtx.timestamp,
  }
}

/**
 * Build the B-channel verdict: an external anchor (reviewed literature, or the T23 fixture) + core
 * `verifyCitation` (anchoring evidence) → core `adjudicate('B')`.
 *
 * TWO PATHS, ONE GATE. When the checked-in evidence corpus holds a reviewed judgement for THIS
 * claim version, that source is the anchor: a real article, a real excerpt, and a person's recorded
 * verdict on whether it supports the claim. Otherwise the T23 fixture supplies the stance, as
 * before — that path is what the demonstration profile still runs on, and its provenance says
 * `fixture` so the policy decides its fate rather than this function.
 *
 * The run does NOT choose the stance and neither does this function: on the corpus path it is the
 * reviewer's recorded verdict, on the fixture path the fixture row's. `requireExternalAnchor` is
 * true either way, so a step with no usable anchor abstains rather than passing.
 *
 * The profile decides whether the anchor may carry the gate at all. When the policy does not admit
 * it, the verifications are withheld and core reaches its own missing-anchor abstention — the
 * adjudication stays in one place, and nothing here reinterprets the outcome.
 *
 * The abstention scenario is driven by DATA, not by a bypass: it points the T23 lookup at the
 * INCONCLUSIVE fixture row — material that takes no stance — so no anchoring verification is
 * requested and the real core gate abstains on its own. It used to point at the contradict
 * row, which was interchangeable with this one only while a contradiction and a gap both
 * abstained; the contradict row now blocks, and a scenario named "abstain" must not block.
 */
async function verdictB(ctx: VerdictBuildCtx): Promise<GateVerdict> {
  const useAbstain = ctx.abstain.has('B')
  const claimId = (ctx.runCtx.claimId || CANONICAL.claimId) as ClaimId
  // The claim sentence this run states. A judgement recorded about a different sentence is not
  // about this claim, so the corpus path declines rather than reusing it.
  const claimRef = ctx.runCtx.claimRef || CANONICAL.claimRef
  const corpus = useAbstain
    ? undefined
    : await buildEvidenceAnchors({
      claimId,
      claimRef,
      stepId: ctx.step.id,
      timestamp: ctx.runCtx.timestamp,
      sourceDoi: ctx.evidenceSourceDoi,
    })
  const anchors: BChannelEvidence =
    corpus ??
    (await buildBChannelAnchors({
      claimId,
      stepId: ctx.step.id,
      timestamp: ctx.runCtx.timestamp,
      ...(useAbstain ? { anchorRef: B_CHANNEL_INCONCLUSIVE_REF } : {}),
    }))
  const admission = admitAsEvidence(ctx.evidenceProfile, anchors.provenance)
  // A policy refusal is a HOLD, not a finding about the claim: the anchor cannot carry this
  // gate, which says "we cannot judge", never "the claim is wrong". `blocked` and `failed`
  // are reserved for evidence that was usable and spoke against the claim.
  const verifications: ReadonlyArray<VerificationResult> =
    admission.disposition === 'admitted' ? anchors.verifications : []

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
      (admission.disposition === 'admitted'
        ? ''
        : `anchor withheld from adjudication — ${admission.code}: ${admission.reason}; `) +
      anchors.basis +
      // The material the gate was NOT handed is stated on the verdict, not left for a reader to
      // find in the corpus: a counter-assessed source that nothing adjudicates and nothing reports
      // is indistinguishable from one that was never retrieved.
      (corpus === undefined || corpus.assessments.length <= 1
        ? ''
        : `; this claim version holds ${String(corpus.assessments.length)} reviewed assessments: `
          + corpus.assessments
            .map(entry => `${entry.sourceDoi}=${entry.verdict}${entry.anchor ? ' (anchor)' : ''}`)
            .join(', ')),
    rationale: result.reasonCode,
    timestamp: ctx.runCtx.timestamp,
  }
}

/** Build the C-channel verdict via team `adjudicateClaimSupport` → core `adjudicate('C')`. */
function verdictC(ctx: VerdictBuildCtx): GateVerdict {
  const useAbstain = ctx.abstain.has('C')
  // The run's OWN prediction, with no substitution. Falling back to the canonical
  // constant graded a claim this run never made: with an empty run context the gate
  // reported `passed` on the fixture prediction while the C1 executor threw on the
  // same emptiness. An absent prediction now reaches `adjudicateClaimSupport` as an
  // absent prediction, which is what it is (`NO_FALSIFIABLE_PREDICTION`).
  const predictionText = ctx.runCtx.predictionText
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
  const experiment = evaluatePrediction({
    predictionText,
    metric: MEASURED_METRIC,
    declaredMetricKey: ctx.runCtx.metricKey,
    commitment: ctx.runCtx.commitment,
    measure: () => measureStudy(ctx.runCtx.study),
  })
  if (experiment.kind === 'unbindable') {
    // FAIL-CLOSED, and a HOLD rather than a verdict: this study cannot adjudicate the claim
    // at all, so the gate abstains instead of comparing an unrelated number to a threshold.
    // Before this check a claim about a quantity nothing here measures was graded — either
    // `passed` and carried to E2, or `failed` as "refuted" by a number it was never about.
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
        `team:adjudicateClaimSupport outcome=${held.outcome} (unbindable claim → hold; `
        + `fail-closed, symmetric with C1-mvp): ${experiment.reason}`,
      rationale: held.summary,
      timestamp: ctx.runCtx.timestamp,
    }
  }
  const report = {
    source: 'live' as const,
    supportsPrediction: experiment.supportsPrediction,
    detail: experiment.detail,
    // The experiment RAN and graded the DECLARED threshold against its own measurement, so it
    // can state decisiveness — the graded number comes from the declaration, not from the
    // prediction prose (see PredictionCommitment.thresholdPct). A decisive negation is a completed test: the claim is
    // recorded as refuted and the step advances. Without this the run hard-fails whenever
    // the hypothesis loses, which is a pipeline that can only run studies that succeed.
    decisive: true,
    evaluator: 'platoon-sim (Intelligent Driver Model, three-vehicle platoon, declared disturbance)',
    ruleVersion: EXPERIMENT_RULE_VERSION,
  }
  const rec = adjudicateClaimSupport({
    claimRef,
    prediction: { text: predictionText },
    report,
    timestamp: ctx.runCtx.timestamp,
  })
  const negated = !report.supportsPrediction
  return {
    component: 'C',
    outcome: rec.outcome,
    passed: rec.outcome === 'passed',
    evidence:
      `team:adjudicateClaimSupport → core adjudicate('C') outcome=${rec.outcome} `
      + `verdict=${rec.verdict} (the experiment ran here: `
      + `measured ${experiment.improvementPct.toFixed(2)}% vs required ${String(experiment.thresholdPct)}% `
      + `of ${MEASURED_METRIC.label}, which the claim names as "${experiment.matchedPhrase}"; `
      + (negated
        ? 'the measurement NEGATED the prediction — recorded as refuted, and the step advances on a decisive test rather than failing)'
        : 'the measurement supports the prediction)'),
    rationale: rec.summary,
    timestamp: ctx.runCtx.timestamp,
  }
}

/**
 * Build the genuine gate verdicts for every component of one step's gate.
 *
 * Each verdict is BOUND to the attempt's commit receipt as it is built ({@link bindVerdict}), so
 * it carries the artifact revisions and the input digest it was decided about. The binding happens
 * here, once, for every channel, and never at submit time.
 */
export async function buildStepVerdicts(ctx: VerdictBuildCtx): Promise<ReadonlyArray<GateVerdict>> {
  const out: GateVerdict[] = []
  for (const comp of ctx.step.gate) {
    const built = comp === 'A'
      ? verdictA(ctx)
      : comp === 'B'
        ? await verdictB(ctx)
        : verdictC(ctx)
    out.push(bindVerdict(built, ctx.commit))
  }
  return out
}
