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
 */

import { describe, expect, it } from 'vitest'
import { getStepDefinitions } from '@deepseek-ai/dsh-research-core'
import { submissionReadinessOf } from '../src/runner/submission-readiness.ts'
import type { ReadinessStepFact } from '../src/runner/submission-readiness.ts'

/** Every step passed, which is what a completed run records. */
function allPassed(): ReadinessStepFact[] {
  return getStepDefinitions().map(definition => ({
    stepId: definition.id,
    status: 'passed',
  }))
}

describe('submissionReadinessOf', () => {
  it('is ready only when the profile is eligible, the manuscript exists and every step passed', () => {
    const readiness = submissionReadinessOf('production', allPassed(), true)
    expect(readiness.ready).toBe(true)
    expect(readiness.profileEligible).toBe(true)
    expect(readiness.manuscriptProduced).toBe(true)
    // Even then it is not a submission, and the reason says so.
    expect(readiness.reason).toMatch(/not a submission/)
  })

  it('is not ready when a step is unfinished, however complete the profile is', () => {
    const steps = allPassed().map(step =>
      step.stepId === 'C1-mvp' ? { ...step, status: 'gated' } : step)
    const readiness = submissionReadinessOf('production', steps, true)
    expect(readiness.ready).toBe(false)
    expect(readiness.reason).toMatch(/C1-mvp/)
    expect(readiness.reason).toMatch(/gated/)
  })

  it('is not ready when the run produced no manuscript', () => {
    const readiness = submissionReadinessOf('production', allPassed(), false)
    expect(readiness.ready).toBe(false)
    expect(readiness.reason).toMatch(/no formatted manuscript/)
  })

  it('is never ready under evaluation, whatever the run achieved', () => {
    const readiness = submissionReadinessOf('evaluation', allPassed(), true)
    expect(readiness.ready).toBe(false)
    expect(readiness.profileEligible).toBe(false)
    expect(readiness.manuscriptProduced).toBe(true)
    expect(readiness.reason).toMatch(/evaluation profile/)
  })

  it('names EVERY unfinished step, not just the first', () => {
    const steps = allPassed().map(step =>
      step.status === 'passed' && (step.stepId === 'A1-landscape' || step.stepId === 'E2-submit')
        ? { ...step, status: 'pending' }
        : step)
    const readiness = submissionReadinessOf('production', steps, true)
    expect(readiness.reason).toMatch(/A1-landscape/)
    expect(readiness.reason).toMatch(/E2-submit/)
  })

  it('is NOT ready when an approval no longer covers the revision it was given for', () => {
    // An approval binds the document that was in front of the person. A manuscript that moved after
    // the decision — by a later step, a recovery from another snapshot, or a hand — is not that
    // document, and a run whose material changed under its approval has not been approved.
    const readiness = submissionReadinessOf(
      'production',
      allPassed(),
      true,
      [],
      "'formatted-manuscript' moved from version 1 (aaaa…) to version 2 (bbbb…)",
    )
    expect(readiness.ready).toBe(false)
    expect(readiness.profileEligible).toBe(true)
    expect(readiness.reason).toContain('changed after the decision')
    expect(readiness.reason).toContain('formatted-manuscript')
  })

  it('stays ready when no approval went stale', () => {
    // The default, so every existing caller keeps its answer.
    expect(submissionReadinessOf('production', allPassed(), true).ready).toBe(true)
  })
})
