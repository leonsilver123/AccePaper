/**
 * Offline, rule-based red-team review of a run's claim material.
 *
 * WHY THIS EXISTS. The A channel used to emit three votes with `position: 'support'`
 * and a constant rationale, whatever the material was — the role names it used
 * (`red-stats`, `red-ethics`) do not even exist in `redteam/personas.ts`. An A gate that
 * cannot be moved by its input is not a judgment: it is a constant, and every step gated
 * on it advanced for a reason unrelated to the work. This module makes the A channel's
 * votes DERIVED from the material, so changing the material changes the verdict.
 *
 * WHAT THIS IS, AND IS NOT. Each role applies a fixed checklist to the claim material and
 * reports what it found. That is a rule-based review, not a model review: no model is
 * called, no prompt is sent, and the result is `local_computation`. The roles are the
 * declared fleet personas' competencies (methodology, statistics, domain grounding)
 * expressed as checks a deterministic implementation can actually perform. A reviewer that
 * could read a paper and judge it would take a model, and this repository will not report a
 * rule's output as a model's opinion.
 *
 * THE THREE OUTCOMES A ROLE CAN REACH, and why all three are needed:
 *   - `support`  — the check found what it looked for;
 *   - `refute`   — the material CONTRADICTS what the check requires (a prediction about a
 *                  quantity the study does not measure, a source that does not exist in
 *                  the pack);
 *   - `abstain`  — the material does not state the thing at all, so the check cannot run.
 * `refute` and `abstain` are different findings, and they lead to different gate outcomes:
 * a contradiction fails the gate, a gap holds it.
 *
 * A LIMIT THIS MODULE STATES RATHER THAN HIDES. The three votes come from ONE
 * implementation reading one material. They are therefore correlated in the way that
 * matters, and they are NOT independent model opinions. No vote declares a `modelFamily`,
 * because no model was called and the field would be a fiction; the A gate's same-family
 * correlation detector consequently reports no cluster, and a `passed` A verdict from this
 * module must NOT be read as "three independent reviewers agreed". The gate evidence string
 * says so in every verdict this module produces.
 */

import type { ResearchRebuttalPosition } from '../types.ts'

/** The claim material the review reads. Every field is what the run states, verbatim. */
export interface ClaimMaterial {
  /** The claim's assertion, as written. */
  readonly assertion: string
  /** The claim's falsifiable prediction, as written. */
  readonly prediction: string
  /** The experiment the claim says would falsify it. */
  readonly experimentToFalsify: string
  /** The conditions the claim is limited to. */
  readonly scope: string
  /** The source the adjudicating measurement will come from. */
  readonly dataSource: string
  /** What makes the claim essentially different from prior work. */
  readonly essentialDifference: string
  /** The quantity the claim is about, as it declares it. */
  readonly metricKey: string
  /** The truthfulness level the material declares for itself. */
  readonly truthfulness: string
  /** The studies' measured quantity, as the experiment declares it. */
  readonly measuredMetricKey: string
  /** Every source the Case Pack declares, so a claimed source can be traced to one. */
  readonly declaredSources: ReadonlyArray<string>
}

/** An empty material, for a run that has not yet produced a claim. */
export const EMPTY_CLAIM_MATERIAL: ClaimMaterial = {
  assertion: '',
  prediction: '',
  experimentToFalsify: '',
  scope: '',
  dataSource: '',
  essentialDifference: '',
  metricKey: '',
  truthfulness: '',
  measuredMetricKey: '',
  declaredSources: [],
}

/** What one review found on one check. */
export interface ReviewFinding {
  /** The question the check asked, phrased as the reviewer would ask it. */
  readonly check: string
  /** What the material actually says, quoted or named as absent. */
  readonly found: string
  readonly position: ResearchRebuttalPosition
}

/** One role's review of the material. */
export interface RoleReview {
  readonly role: string
  readonly position: ResearchRebuttalPosition
  /** One line naming every finding, so the verdict's rationale is not a constant. */
  readonly rationale: string
  readonly findings: ReadonlyArray<ReviewFinding>
}

/** Collapse a role's findings into its vote: any contradiction refutes, any gap abstains. */
function positionOf(findings: ReadonlyArray<ReviewFinding>): ResearchRebuttalPosition {
  if (findings.some(f => f.position === 'refute')) return 'refute'
  if (findings.some(f => f.position === 'abstain')) return 'abstain'
  return 'support'
}

/** Build a role's review from its findings, deriving the rationale from them. */
function review(role: string, findings: ReadonlyArray<ReviewFinding>): RoleReview {
  const position = positionOf(findings)
  return {
    role,
    position,
    rationale: `${position}: ` + findings.map(f => `${f.check} -> ${f.found}`).join('; '),
    findings,
  }
}

/** `red-method` — is the claim testable as it is stated? */
function reviewMethod(material: ClaimMaterial): RoleReview {
  const falsifier = material.experimentToFalsify.trim()
  const difference = material.essentialDifference.trim()
  const scope = material.scope.trim()
  // An absent scope is a CONTRADICTION only when a claim was actually stated: a claim with no
  // scope claims everything, which no experiment can support. With no claim at all there is
  // nothing over-broad to refuse, and the honest finding is the gap, not a contradiction —
  // otherwise an empty material would report as a refuted claim rather than an unreviewable one.
  const claimStated = material.assertion.trim().length > 0 || material.prediction.trim().length > 0
  return review('red-method', [
    falsifier.length === 0
      ? {
        check: 'the claim names the experiment that would falsify it',
        found: 'no falsifying experiment is stated, so nothing could refute the claim',
        position: 'abstain',
      }
      : {
        check: 'the claim names the experiment that would falsify it',
        found: `stated: ${falsifier}`,
        position: 'support',
      },
    difference.length === 0
      ? {
        check: 'the claim states what makes it different from prior work',
        found: 'no essential difference is stated',
        position: 'abstain',
      }
      : {
        check: 'the claim states what makes it different from prior work',
        found: `stated: ${difference}`,
        position: 'support',
      },
    scope.length === 0
      ? {
        check: 'the claim is bounded to the conditions it holds under',
        found: claimStated
          ? 'the claim states no scope, so it asserts an unbounded result'
          : 'no claim is stated, so there is no scope to check',
        position: claimStated ? 'refute' : 'abstain',
      }
      : {
        check: 'the claim is bounded to the conditions it holds under',
        found: `bounded: ${scope}`,
        position: 'support',
      },
  ])
}

/** `red-stat` — does the prediction commit to a measurable quantity and threshold? */
function reviewStatistics(material: ClaimMaterial): RoleReview {
  const prediction = material.prediction.trim()
  const hasThreshold = /\d+(?:\.\d+)?\s*%/.test(prediction)
  return review('red-stat', [
    prediction.length === 0
      ? {
        check: 'the claim carries a falsifiable prediction',
        found: 'no prediction is stated',
        position: 'abstain',
      }
      : {
        check: 'the claim carries a falsifiable prediction',
        found: `stated: ${prediction}`,
        position: 'support',
      },
    prediction.length === 0
      ? {
        check: 'the prediction commits to a numeric threshold',
        found: 'no prediction to read a threshold out of',
        position: 'abstain',
      }
      : hasThreshold
        ? {
          check: 'the prediction commits to a numeric threshold',
          found: `stated in the prediction: ${prediction}`,
          position: 'support',
        }
        : {
          check: 'the prediction commits to a numeric threshold',
          found: 'the prediction states no numeric threshold, so no measurement can decide it',
          position: 'abstain',
        },
    // The decisive check: the claim's declared quantity and the study's measured quantity
    // must be the same one. A mismatch is not an evidence gap — the claim is about
    // something this study will never measure, and no amount of running fixes it.
    material.metricKey.trim().length === 0
      ? {
        check: 'the claim declares the quantity the study measures',
        found: 'the claim declares no metric',
        position: 'abstain',
      }
      : material.metricKey === material.measuredMetricKey
        ? {
          check: 'the claim declares the quantity the study measures',
          found: `declared "${material.metricKey}", which is the measured quantity`,
          position: 'support',
        }
        : {
          check: 'the claim declares the quantity the study measures',
          found: `declared "${material.metricKey}" while the study measures "${material.measuredMetricKey}"`,
          position: 'refute',
        },
  ])
}

/** `red-domain` — is the material traceable and honestly labelled? */
function reviewDomain(material: ClaimMaterial): RoleReview {
  const source = material.dataSource.trim()
  const truthfulness = material.truthfulness.trim()
  return review('red-domain', [
    source.length === 0
      ? {
        check: 'the measurement traces to a declared source',
        found: 'the claim names no data source',
        position: 'abstain',
      }
      : material.declaredSources.some(declared => source.includes(declared) || declared.includes(source))
        ? {
          check: 'the measurement traces to a declared source',
          found: `"${source}" is one of the pack's declared sources`,
          position: 'support',
        }
        : {
          check: 'the measurement traces to a declared source',
          found: `"${source}" is not among the pack's declared sources (${material.declaredSources.join(', ') || 'none'})`,
          position: 'refute',
        },
    truthfulness.length === 0
      ? {
        check: 'the material declares its own truthfulness',
        found: 'no truthfulness level is declared, so a reader cannot tell a fixture from a measurement',
        position: 'abstain',
      }
      : {
        check: 'the material declares its own truthfulness',
        found: `declared as "${truthfulness}"`,
        position: 'support',
      },
  ])
}

/**
 * The review roles, in deterministic order, with the personas they express.
 *
 * The names are the fleet personas' own role names (`redteam/personas.ts`), so a reader can
 * read the persona's stated remit next to the checks it actually performs here.
 */
export const REVIEW_ROLES: ReadonlyArray<{ readonly role: string; readonly review: (m: ClaimMaterial) => RoleReview }> = [
  { role: 'red-method', review: reviewMethod },
  { role: 'red-stat', review: reviewStatistics },
  { role: 'red-domain', review: reviewDomain },
]

/**
 * Review one claim material with every role.
 *
 * @param material - the claim material, verbatim from the run.
 * @returns one review per role in {@link REVIEW_ROLES}, in that order.
 */
export function reviewClaim(material: ClaimMaterial): ReadonlyArray<RoleReview> {
  return REVIEW_ROLES.map(entry => entry.review(material))
}
