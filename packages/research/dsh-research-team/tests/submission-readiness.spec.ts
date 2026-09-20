/**
 * Readiness is a fact about a RUN; eligibility is a fact about a DEPLOYMENT.
 *
 * They were one field until 2026-09-16: `submittabilityOf('production')` returned
 * `submittable: true`, and the export projected it straight into the manifest — so a production
 * run blocked at its first step shipped a package that said it was submittable. Nothing about that
 * run was ready; the profile was simply eligible.
 *
 * These tests pin the pure decision, including the branch the manifest cannot easily reach (a
 * manuscript that exists while a step is still unfinished), and the export tests pin that both
 * facts reach the manifest and the run summary.
 *
 * AND THEY PIN THAT IT IS THE PACKAGE'S OWN EVALUATION. Readiness is `checkManuscript` — the same
 * function the final package's manuscript-side conditions come from — so the manifest's
 * `submissionReady` and the final package cannot disagree about the paper. Until 2026-09-18 they
 * were two copies of the conditions, and a run whose revisions nobody had read was ready in one and
 * refused by the other.
 */

import { describe, expect, it } from 'vitest'
import { getStepDefinitions } from '@deepseek-ai/dsh-research-core'
import { submissionReadinessOf } from '../src/runner/submission-readiness.ts'
import type { ManuscriptFacts } from '../src/runner/final-package.ts'

/** Every step passed, which is what a completed run records. */
function allPassed(): ReadonlyArray<string> {
  return []
}

/**
 * What a run that finished cleanly records, with the fields a case wants to vary.
 *
 * @param overrides - the facts this case changes.
 * @returns the facts the decision reads.
 */
function facts(overrides: Partial<ManuscriptFacts> = {}): ManuscriptFacts {
  return {
    profile: 'production',
    manuscriptProduced: true,
    unfinishedSteps: allPassed(),
    refusedSections: [],
    openIssues: [],
    staleApproval: undefined,
    compilation: { tool: null, dropped: [] },
    // A READY MANUSCRIPT CITES ITS SOURCES. See `final-package.spec.ts` for the condition this
    // feeds: a paper that cites nothing while the run held sources is not ready.
    citations: { made: 3, held: 3 },
    ...overrides,
    // THE TYPESET FORM RENDERS THE DOCUMENT THE RUN HOLDS, and this deployment declared no submission
    // format it produces. STATED AFTER THE SPREAD so the field is required in the result, the way
    // every other fact is; a case that varies it passes its own.
    typeset: overrides.typeset ?? {
      renderedManuscriptVersion: 1,
      manuscriptVersion: 1,
      declaredFormats: [],
      documents: [],
      repairedFromVersion: undefined,
    },
  }
}

describe('submissionReadinessOf', () => {
  it('is ready only when the profile is eligible, the manuscript exists and every step passed', () => {
    const readiness = submissionReadinessOf(facts())
    expect(readiness.ready).toBe(true)
    expect(readiness.profileEligible).toBe(true)
    expect(readiness.manuscriptProduced).toBe(true)
    // Even then it is not a submission, and the reason says so.
    expect(readiness.reason).toMatch(/not a submission/)
  })

  it('is not ready when a step is unfinished, however complete the profile is', () => {
    const readiness = submissionReadinessOf(facts({ unfinishedSteps: ['C1-mvp (gated)'] }))
    expect(readiness.ready).toBe(false)
    expect(readiness.reason).toMatch(/C1-mvp/)
    expect(readiness.reason).toMatch(/gated/)
  })

  it('is not ready when the run produced no manuscript', () => {
    const readiness = submissionReadinessOf(facts({ manuscriptProduced: false }))
    expect(readiness.ready).toBe(false)
    expect(readiness.reason).toMatch(/no formatted manuscript/)
  })

  it('is never ready under evaluation, whatever the run achieved', () => {
    const readiness = submissionReadinessOf(facts({ profile: 'evaluation' }))
    expect(readiness.ready).toBe(false)
    expect(readiness.profileEligible).toBe(false)
    expect(readiness.manuscriptProduced).toBe(true)
    expect(readiness.reason).toMatch(/evaluation profile/)
  })

  it('names EVERY unfinished step, not just the first', () => {
    const readiness = submissionReadinessOf(facts({
      unfinishedSteps: ['A1-landscape (pending)', 'E2-submit (pending)'],
    }))
    expect(readiness.reason).toMatch(/A1-landscape/)
    expect(readiness.reason).toMatch(/E2-submit/)
  })

  it('is NOT ready when an approval no longer covers the revision it was given for', () => {
    // An approval binds the document that was in front of the person. A manuscript that moved after
    // the decision — by a later step, a recovery from another snapshot, or a hand — is not that
    // document, and a run whose material changed under its approval has not been approved.
    const readiness = submissionReadinessOf(facts({
      staleApproval: "'typeset' moved from version 1 (aaaa…) to version 2 (bbbb…)",
    }))
    expect(readiness.ready).toBe(false)
    expect(readiness.profileEligible).toBe(true)
    expect(readiness.reason).toContain('changed after the decision')
    expect(readiness.reason).toContain('typeset')
  })

  it('stays ready when no approval went stale', () => {
    expect(submissionReadinessOf(facts()).ready).toBe(true)
  })

  it('is NOT ready when the typeset form renders a document the run has moved past', () => {
    // A JOURNAL IS HANDED THE TYPESET FORM, and a form rendered from a superseded version is a
    // submission of the draft the paper was. Readiness is a fact about the run, so it says so here
    // rather than only at export time.
    const readiness = submissionReadinessOf(facts({
      typeset: { renderedManuscriptVersion: 1, manuscriptVersion: 2, declaredFormats: [], documents: [], repairedFromVersion: undefined },
    }))
    expect(readiness.ready).toBe(false)
    expect(readiness.reason).toContain('the document moved after it was typeset')
  })

  it('is NOT ready when a submission format the deployment declared has no document', () => {
    const readiness = submissionReadinessOf(facts({
      typeset: {
        renderedManuscriptVersion: 1,
        manuscriptVersion: 1,
        declaredFormats: ['latex'],
        documents: [],
        repairedFromVersion: undefined,
      },
    }))
    expect(readiness.ready).toBe(false)
    expect(readiness.reason).toContain('latex')
  })

  it('is NOT ready when the review the deployment requires did not finish', () => {
    // THE DISAGREEMENT THIS MODULE AND `final-package.ts` USED TO BE ABLE TO PRODUCE. The review
    // policy's evaluation travels on the rebuttal artifact; readiness reads it like any other fact
    // about the manuscript, so a run whose answers nobody read is not ready here either.
    const readiness = submissionReadinessOf(facts({
      review: {
        satisfied: false,
        reason: '1 issue(s) are open and 2 are waiting for a reader, so the last revision has not'
          + ' finished its review',
      },
    }))
    expect(readiness.ready).toBe(false)
    expect(readiness.reason).toContain('waiting for a reader')
  })

  it('is NOT ready when the compiled document lost a float the manuscript carries', () => {
    const readiness = submissionReadinessOf(facts({
      compilation: { tool: 'pandoc', dropped: ['Figure 2 (a diagram is carried as its own source)'] },
    }))
    expect(readiness.ready).toBe(false)
    expect(readiness.reason).toContain('Figure 2')
    expect(readiness.reason).toMatch(/figures are missing/u)
  })

  it('stays ready when this deployment compiled nothing, which is not a document that lost a float', () => {
    // `tool: null` is the deployment's own statement that it has no compiler. Reading it as a failure
    // would refuse every run under a deployment that never claimed to produce a PDF.
    const readiness = submissionReadinessOf(facts({ compilation: { tool: null, dropped: ['Figure 2 (x)'] } }))
    expect(readiness.ready).toBe(true)
  })

  it('reports the first unmet condition in the order the final package reports them', () => {
    // ONE ORDER, SO A READER SEES THE SAME NEXT ACTION in the manifest and beside the export control.
    const readiness = submissionReadinessOf(facts({
      unfinishedSteps: ['C1-mvp (gated)'],
      review: { satisfied: false, reason: 'no complete review' },
    }))
    expect(readiness.reason).toMatch(/C1-mvp/)
    expect(readiness.reason).not.toMatch(/no complete review/)
  })
})

describe('the step vocabulary this module reads', () => {
  it('is the pipeline the run actually declares', () => {
    // `allPassed` above is empty because the facts carry the UNFINISHED steps; the definitions are
    // still the authority on what a run is made of.
    expect(getStepDefinitions().length).toBeGreaterThan(0)
  })
})
