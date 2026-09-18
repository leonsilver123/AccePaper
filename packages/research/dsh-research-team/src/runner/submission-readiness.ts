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
//
// AND IT IS THE SAME EVALUATION THE FINAL PACKAGE MAKES. This module used to decide readiness from
// its own copy of the conditions — profile, manuscript, steps, sections, open concerns, stale
// approval — while `final-package.ts` decided a package from its own. The two could disagree, and
// the review of 2026-09-18 named the consequence: a run whose revisions nobody had read carried
// `submissionReady: true` in its manifest and was refused as a final package. There is now one
// function for the manuscript's conditions, `checkManuscript`, and readiness is what it says.

import type { EvidenceProfile, ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { evidenceEligibilityOf } from '@deepseek-ai/dsh-research-core'
import { checkManuscript, manuscriptFactsOf } from './final-package.ts'
import type { ManuscriptFacts } from './final-package.ts'

export { openIssuesOf } from './final-package.ts'
export type { OpenIssue } from './final-package.ts'

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
 * @param facts - what the run records about its manuscript; see {@link manuscriptFactsOf}.
 * @returns the decision and the reason.
 */
export function submissionReadinessOf(facts: ManuscriptFacts): SubmissionReadiness {
  const eligibility = evidenceEligibilityOf(facts.profile)
  if (!eligibility.eligible) {
    return {
      ready: false,
      reason: eligibility.reason,
      profileEligible: false,
      manuscriptProduced: facts.manuscriptProduced,
    }
  }
  // THE FIRST UNMET CONDITION DECIDES, in the order `checkManuscript` reports them — the same
  // sentence a reader of the final package's checks would see, because it is the same evaluation.
  const failed = checkManuscript(facts).find(check => !check.passed)
  return {
    ready: failed === undefined,
    reason: failed?.detail
      ?? 'the production profile is eligible and the run completed every step, including the human'
        + ' gate — readiness says the material exists and its gates closed; it is not a submission,'
        + ' and a person still approves the final package',
    profileEligible: true,
    manuscriptProduced: facts.manuscriptProduced,
  }
}

/**
 * Read the facts {@link submissionReadinessOf} needs off a run.
 *
 * @param store - the run store, still live.
 * @param runId - the run to read.
 * @param profile - the deployment's evidence profile.
 * @returns the readiness decision for that run as it currently stands.
 * @throws {Error} when the store holds no such run.
 */
export function readinessOfRun(
  store: ResearchRunStore,
  runId: string,
  profile: EvidenceProfile,
): SubmissionReadiness {
  return submissionReadinessOf(manuscriptFactsOf(store, runId, profile))
}
