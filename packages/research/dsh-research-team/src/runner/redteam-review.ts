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
 * Every check is either a DECLARATION or an EXACT MATCH. Nothing here infers meaning from prose:
 * a direction and a bound are declared, and the anchor beside the number is compared as a string.
 * That was an auditor's conclusion after four attempts at a prose reader reached a wrong verdict on
 * the shipped study, and its recommendation — replace it with something narrower — is what this is.
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

import type { PredictionCommitment } from './platoon-sim.ts'
import { anchorBoundNear, percentagesIn, requirementDirectionIn, thresholdFromPrediction } from './platoon-sim.ts'

/**
 * The truthfulness levels this field can legitimately carry.
 *
 * ONLY THE LEVELS A PACK ENVELOPE MAY DECLARE, which is what this field carries: it comes from
 * the pack's own envelope, and every envelope in the shipped pack says `fixture` or `mock`. The
 * channel levels (`local_computation`, `fixture_executor`, `mock_external`, `live_external`,
 * `real_tool_fixture_input`) are NOT here: they describe what an executor did at run time and are
 * produced on artifacts, not declared by an input file. The loader now enforces the same pair rule
 * (`TRUTHFULNESS_BY_SOURCE_KIND`), so this check and the load-time check agree.
 *
 * The check exists because ACCEPTING ANY NON-EMPTY STRING let material declare
 * `peer-reviewed empirical finding` and pass. A first version of this list held only the five
 * channel levels, which would have refused the shipped pack's own `fixture` and stopped the run.
 */
export const KNOWN_TRUTHFULNESS: ReadonlyArray<string> = [
  'fixture',
  'mock',
]

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
  /**
   * Which way the claim DECLARES its quantity should move, and whether it caps the change.
   *
   * Declared rather than inferred. The reviewer used to read a direction out of the prediction's
   * prose, and three rounds of audit dismantled that reader — see `PredictionCommitment` in
   * `./platoon-sim.ts` for the six independent ways it reached a wrong verdict on the shipped
   * study. Absent means the claim declared none, which is a gap the reviewer reports.
   */
  readonly commitment?: PredictionCommitment
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
    // An absent scope is a GAP, not a contradiction. This check first returned `refute` here, on
    // the argument that a claim with no scope asserts an unbounded result — but that is an
    // inference about what the absence MEANS, and the vote is supposed to report what the material
    // says. It also made the pipeline's own fixture claim fail its gate, which is how the
    // difference showed up.
    //
    // WHAT THIS CHECK STILL CANNOT DO, stated rather than implied: an audit demonstrated that a
    // scope which EXPLICITLY EXCLUDES the condition under test also passes, because deciding
    // whether a sentence excludes something is a reading, not a word test — the same limit the
    // phrase binding states. This check is necessary and not sufficient.
    scope.length === 0
      ? {
        check: 'the claim is bounded to the conditions it holds under',
        found: 'the claim states no scope, so nothing bounds the result it asserts',
        position: 'abstain',
      }
      : {
        check: 'the claim is bounded to the conditions it holds under',
        found: `bounded: ${scope} (whether this scope EXCLUDES what the experiment tests is not decidable here)`,
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
    // A threshold with no DECLARED commitment is not a testable prediction: "changed by 20%" does
    // not say which way the number has to move, so the C channel cannot grade it and holds.
    // Reviewing it as "fine" would leave the reviewer and the gate disagreeing about whether the
    // claim is testable at all.
    //
    // THIS CHECK READS A DECLARATION, NOT A SENTENCE, and that is the whole point. Its predecessor
    // tried to infer the direction from the prediction's prose, and an audit dismantled that reader
    // across three rounds: it graded a satisfied prediction backwards, then reported a violated cap
    // as met, then flipped on a preposition inside a character window. Its replacement by a
    // declared field is what an auditor asked for after concluding the reader could not be trusted.
    //
    // WHAT WAS LOST WITH THE PARSER, stated rather than implied: a claim whose ASSERTION and
    // PREDICTION contradict each other was previously caught by comparing two parsed directions.
    // No word test can do that soundly — it is a reading, like deciding whether a scope excludes a
    // condition — so the check is gone and the limit is recorded here instead of being replaced by
    // a different guess. The remaining checks are all declarations or exact matches: the falsifier,
    // the difference, the scope, the threshold, the quantity key, the data source and the
    // truthfulness level.
    hasThreshold
      ? material.commitment === undefined
        ? {
          check: 'the claim declares which way its quantity should move',
          found: 'the claim declares no commitment, so nothing says whether the quantity should rise or fall',
          position: 'abstain',
        }
        : {
          check: 'the claim declares which way its quantity should move',
          found: `declared: the quantity should ${material.commitment.direction}, `
            + `${material.commitment.bound} the stated threshold`,
          position: 'support',
        }
      : {
        check: 'the claim declares which way its quantity should move',
        found: 'no threshold to be bound to',
        position: 'abstain',
      },
    // THE DECLARATION MUST AGREE WITH THE CLAIM'S OWN WORDS. The gate grades a declared direction
    // and bound plus a parsed number, and nothing tied those to the sentence: an audit showed that
    // changing ONE declared field records a claim its own sentence refutes as supported, with no
    // wordplay needed. The anchor literal beside the number is checked by STRING EQUALITY — wire
    // format, not a reading — so a contradiction is exact and belongs here as a `refute`.
    //
    // The two cases are different findings and are kept apart: an ABSENT anchor is the claim
    // declining to relate the number to the change (a gap), while a PRESENT anchor naming a
    // different bound is the claim contradicting itself.
    hasThreshold && material.commitment !== undefined && thresholdFromPrediction(prediction) !== undefined
      ? (() => {
        const stated = thresholdFromPrediction(prediction) as number
        const anchor = anchorBoundNear(prediction, stated)
        if (anchor === undefined) {
          return {
            check: 'the prediction anchors its threshold to the change',
            found: 'the prediction states a percentage with no anchor beside it (>=, <=, at least, at most, no more than, within), so nothing in its own words says how the number relates to the change',
            position: 'abstain',
          }
        }
        return anchor === material.commitment.bound
          ? {
            check: 'the prediction anchors its threshold to the change',
            found: `anchored "${anchor}", which is what the claim declares`,
            position: 'support',
          }
          : {
            check: 'the prediction anchors its threshold to the change',
            found: `the prediction anchors "${anchor}" while the claim declares "${material.commitment.bound}" — the declaration and the sentence contradict each other`,
            position: 'refute',
          }
      })()
      : {
        check: 'the prediction anchors its threshold to the change',
        found: 'no declared commitment or threshold to check the anchor against',
        position: 'abstain',
      },
    // POLARITY. A negation makes the prediction ungradeable, because a prohibition and a
    // requirement share the same number and the same operator and only the sentence's force
    // differs — an auditor graded a violated prohibition as MET. The reviewer reports the gap; the
    // C channel holds on the same condition.
    requirementDirectionIn(prediction) === undefined
      ? {
        check: 'the prediction states a positive requirement',
        found: 'the prediction does not state its direction as "shall <rise|fall|…>", so whether it requires a change or PROHIBITS one cannot be read from it',
        position: 'abstain',
      }
      : {
        check: 'the prediction states a positive requirement',
        found: `the prediction states a positive requirement: shall ${String(requirementDirectionIn(prediction))}`,
        position: 'support',
      },
    // ONE percentage. `thresholdFromPrediction` takes the first, which is unambiguous as a string
    // and not as a commitment: "Over 20% of the simulated interval, the … shall exceed by at least
    // 35%" reads its threshold as 20 while the sentence commits to 35.
    percentagesIn(prediction).length > 1
      ? {
        check: 'the prediction commits to exactly one threshold',
        found: `it states ${String(percentagesIn(prediction).length)} percentages (${percentagesIn(prediction).join(', ')}), so which one is the threshold is a guess`,
        position: 'refute',
      }
      : percentagesIn(prediction).length === 1
        ? {
          check: 'the prediction commits to exactly one threshold',
          found: 'one percentage, so the graded number is the only one it could mean',
          position: 'support',
        }
        : {
          check: 'the prediction commits to exactly one threshold',
          found: 'no percentage at all',
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
      : KNOWN_TRUTHFULNESS.includes(truthfulness)
        // The level has to be one this deployment DEFINES. Accepting any non-empty string let
        // material declare `peer-reviewed empirical finding` and pass — a claim about where the
        // data came from, in a vocabulary nothing checks. An audit found it.
        ? {
          check: 'the material declares its own truthfulness',
          found: `declared as "${truthfulness}"`,
          position: 'support',
        }
        : {
          check: 'the material declares its own truthfulness',
          found: `declared as "${truthfulness}", which is not a level this deployment defines (${KNOWN_TRUTHFULNESS.join(', ')})`,
          position: 'refute',
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
