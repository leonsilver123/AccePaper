// @deepseek-ai/dsh-research-team — is this run's output actually ready to submit?
//
// TWO DIFFERENT QUESTIONS, which were answered by one field until 2026-09-16:
//
//   ELIGIBILITY — may evidence of this kind carry a submission at all? That is a property of the
//   deployment's `evidenceProfile`, decided by core (`evidenceEligibilityOf`), and it says nothing
//   about any particular run.
//
//   READINESS — did THIS run produce a manuscript whose gates all closed and which a person
//   approved at its final version? A production run that stopped at A1 is eligible and nowhere
//   near ready, and reporting it as `submittable: true` was the conflation: a reader of the
//   manifest could not tell the two apart.
//
// Readiness is computed from the run's own state and never asserted by a caller. Every fact it
// reads is one the run already recorded, so a run cannot become ready by describing itself.

import { getArtifact, getRunSnapshot, getStepDefinitions } from '@deepseek-ai/dsh-research-core'
import type { EvidenceProfile, ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { evidenceEligibilityOf } from '@deepseek-ai/dsh-research-core'

/** The artifact E1 writes; a run without one produced no manuscript to submit. */
const MANUSCRIPT_SLUG = 'formatted-manuscript'

/** One step's contribution to readiness. */
export interface ReadinessStepFact {
  readonly stepId: string
  readonly status: string
}

/** Whether a run may be submitted, and the sentence that says why or why not. */
export interface SubmissionReadiness {
  readonly ready: boolean
  /** The first reason that decided it, phrased so a reader knows what to do next. */
  readonly reason: string
  readonly profileEligible: boolean
  readonly manuscriptProduced: boolean
}

/**
 * Decide whether one run's products are ready to submit.
 *
 * NOT a submission and not an approval: this says the material exists and its gates closed. A
 * journal submission would be a separate, explicitly authorized external action, and a person's
 * approval of the final package is a separate check still — a run can be ready here and have no
 * approval on record, which is what a live E2 looks like.
 *
 * @param profile - the deployment's evidence profile.
 * @param steps - every step the pipeline declares, with the run's recorded status for it.
 * @param manuscriptProduced - whether the run produced the manuscript artifact.
 * @param refusedSections - sections `D3-writing` refused to write for want of evidence.
 * @returns the decision and the reason.
 */
export function submissionReadinessOf(
  profile: EvidenceProfile,
  steps: ReadonlyArray<ReadinessStepFact>,
  manuscriptProduced: boolean,
  refusedSections: ReadonlyArray<string> = [],
): SubmissionReadiness {
  const eligibility = evidenceEligibilityOf(profile)
  if (!eligibility.eligible) {
    return {
      ready: false,
      reason: eligibility.reason,
      profileEligible: false,
      manuscriptProduced,
    }
  }
  if (!manuscriptProduced) {
    return {
      ready: false,
      reason: 'the run produced no formatted manuscript, so there is nothing to submit',
      profileEligible: true,
      manuscriptProduced: false,
    }
  }
  const unfinished = steps.filter(step => step.status !== 'passed')
  if (unfinished.length > 0) {
    const named = unfinished.map(step => `${step.stepId} (${step.status})`).join(', ')
    return {
      ready: false,
      reason: `the run has not completed: ${named} — an incomplete run's manuscript is a draft of`
        + ' whatever the pipeline had reached, not a reviewed paper',
      profileEligible: true,
      manuscriptProduced: true,
    }
  }
  if (refusedSections.length > 0) {
    // Every gate closed and the manuscript exists, and it is still not a paper: a section the
    // pipeline declined to write for want of evidence leaves a hole the prose does not show. The
    // alternative — filling it from the built-in sentences — produces something that reads as
    // complete, which is the failure this whole pipeline is built against.
    return {
      ready: false,
      reason:
        `the manuscript has no ${refusedSections.join(', ')} section: the run held none of the`
        + ' evidence that section is written from, and the pipeline refused to write it rather than'
        + ' fill it in. Supply the missing evidence and re-run that step',
      profileEligible: true,
      manuscriptProduced: true,
    }
  }
  return {
    ready: true,
    reason:
      'the production profile is eligible and the run completed every step, including the human'
      + ' gate — readiness says the material exists and its gates closed; it is not a submission,'
      + ' and a person still approves the final package',
    profileEligible: true,
    manuscriptProduced: true,
  }
}

/** The sections `D3-writing` recorded as refused, read off the run's draft. */
function refusedSectionsOf(draft: unknown): ReadonlyArray<string> {
  if (draft === null || typeof draft !== 'object') return []
  const recorded = (draft as { refusedSections?: unknown }).refusedSections
  return Array.isArray(recorded) ? recorded.filter((id): id is string => typeof id === 'string') : []
}

/**
 * Read the facts {@link submissionReadinessOf} needs off a run.
 *
 * @param store - the run store, still live.
 * @param runId - the run to read.
 * @param profile - the deployment's evidence profile.
 * @returns the readiness decision for that run as it currently stands.
 */
export function readinessOfRun(
  store: ResearchRunStore,
  runId: string,
  profile: EvidenceProfile,
): SubmissionReadiness {
  const snapshot = getRunSnapshot(store, runId)
  const steps: ReadinessStepFact[] = getStepDefinitions().map(definition => ({
    stepId: definition.id,
    status: snapshot.steps[definition.id]?.status ?? 'pending',
  }))
  return submissionReadinessOf(
    profile,
    steps,
    getArtifact(store, runId, MANUSCRIPT_SLUG) !== undefined,
    refusedSectionsOf(getArtifact(store, runId, 'draft')),
  )
}
