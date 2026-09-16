/**
 * The closed loop, end to end, on the production profile.
 *
 * The review's R5 asks for one acceptance path: real material → a manuscript constrained by that
 * material → an injected error → the revision that fixes it → a person's approval of the exact
 * package. Most of the machinery for it landed across R1–R4, and this file is where the whole chain
 * is asserted at once — because every part of it passing on its own is what a broken loop looks
 * like from the inside.
 *
 * FOUR FACTS, each of which was false at the start of this round:
 *
 *  1. A production run reaches the human gate on evidence that exists. Its B gates anchor on
 *     literature that was retrieved and read, and its manuscript's sections were written from the
 *     run's own measurements.
 *  2. An injected error is CAUGHT. A number the run never measured stops the run at the gate that
 *     read it, before anything downstream consumes it.
 *  3. The revision is a diff, and it is re-reviewed. A patch that changes a body is reviewed by the
 *     same checks that reviewed the draft it replaces.
 *  4. Readiness is not approval. The run is eligible and not ready until a person approves it, and
 *     the evaluation profile is never ready at all.
 */

import { describe, expect, it } from 'vitest'
import { getArtifact, getRunSnapshot, getStepDefinitions, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'

import { runT19B } from '../../src/runner/drive.ts'
import { readinessOfRun } from '../../src/runner/submission-readiness.ts'
import { planRunPackage } from '../../src/runner/package-export.ts'
import { STEP_EXECUTOR_REGISTRY } from '../../src/runner/registry.ts'
import type { RunResult } from '../../src/runner/types.ts'

/** The last step a run reached, and where a stopped one stopped. */
async function productionRun(): Promise<{ store: ResearchRunStore; runId: string; run: RunResult }> {
  const store: ResearchRunStore = new Map()
  const run = await runT19B(store, { evidenceProfile: 'production' })
  return { store, runId: run.runId, run }
}

describe('a production run carries real material to the human gate', () => {
  it('drives all fifteen steps and stops at E2, unapproved', async () => {
    const { store, runId } = await productionRun()
    const snap = getRunSnapshot(store, runId)
    const statuses = getStepDefinitions().map(definition => [definition.id, snap.steps[definition.id]?.status])
    expect(statuses.filter(([, status]) => status !== 'passed' && status !== 'gated')).toEqual([])
    expect(snap.steps['E2-submit']?.status).toBe('gated')
    expect(snap.registry['submission-record']).toBeUndefined()
  })

  it('anchors its B gates on reviewed literature rather than on the synthetic fixture', async () => {
    const { store, runId } = await productionRun()
    const b = String(getRunSnapshot(store, runId).steps['A1-landscape']?.gateResults.B?.evidence)
    expect(b).toContain('reviewed source')
    expect(b).not.toContain('MockCitationResolverAdapter')
  })

  it('writes a manuscript whose sections record the evidence they were written from', async () => {
    const { store, runId } = await productionRun()
    const draft = getArtifact(store, runId, 'draft') as
      | { refusedSections?: ReadonlyArray<string>; sectionEvidence?: ReadonlyArray<{ sectionId: string; supplied: ReadonlyArray<string> }> }
      | undefined
    expect(draft?.refusedSections).toEqual([])
    const results = draft?.sectionEvidence?.find(entry => entry.sectionId === 'results')
    expect(results?.supplied).toContain('result')
    // The one number every section quotes, and where it came from.
    const record = getArtifact(store, runId, 'result-version') as { measured?: { improvementPct?: number } } | undefined
    expect(record?.measured?.improvementPct).toEqual(expect.any(Number))
  })
})

describe('an injected error stops the run where it is read', () => {
  it('refuses a number the run never measured, and nothing downstream sees it', async () => {
    const store: ResearchRunStore = new Map()
    const real = STEP_EXECUTOR_REGISTRY.get('D3-writing')?.executor
    if (real === undefined) throw new Error('fixture: no D3 executor')
    const run = await runT19B(store, {
      evidenceProfile: 'production',
      executorOverride: (stepId: string) =>
        stepId === 'D3-writing'
          ? async (ctx) => {
            const produced = await real(ctx)
            const draft = produced['draft'] as { sections: ReadonlyArray<{ id: string; bodyText: string }> }
            return {
              ...produced,
              draft: {
                ...draft,
                sections: draft.sections.map(section =>
                  section.id === 'results'
                    ? { ...section, bodyText: `${section.bodyText} The improvement was 12.5%.` }
                    : section,
                ),
              },
            }
          }
          : undefined,
    })
    // Caught at the gate that read it, which is the only place it can be caught: the number is
    // well-formed, and nothing about the artifact says it is wrong.
    expect(run.steps.at(-1)?.stepId).toBe('D3-writing')
    expect(run.steps.at(-1)?.verdicts.A).toBe('blocked')
    // And the run produced no manuscript, so the number reached no reader.
    expect(getArtifact(store, run.runId, 'revised-draft')).toBeUndefined()
    expect(getArtifact(store, run.runId, 'formatted-manuscript')).toBeUndefined()
    expect(readinessOfRun(store, run.runId, 'production').ready).toBe(false)
  })

  it('lets a NEGATIVE result complete, because a refuted prediction is a result', async () => {
    // The published study's own measurement refutes its predicted direction (−38.2 % where the
    // claim predicts a rise). The run must finish anyway: a pipeline that only completes on
    // positive results manufactures them.
    const { store, runId } = await productionRun()
    const c1 = getRunSnapshot(store, runId).steps['C1-mvp']
    expect(c1?.status).toBe('passed')
    const mvp = getArtifact(store, runId, 'mvp-results') as
      | { outcome?: { verdict?: string; decisive?: boolean } }
      | undefined
    expect(mvp?.outcome?.verdict).toBe('refuted')
    // Decisive and refuted, which are two different facts: the experiment ran and spoke against the
    // claim, rather than failing to run.
    expect(mvp?.outcome?.decisive).toBe(true)
    expect(getRunSnapshot(store, runId).steps['E2-submit']?.status).toBe('gated')
  })
})

describe('the revision is re-reviewed, not merely recorded', () => {
  it('reviews the revised draft with the same checks that reviewed the draft', async () => {
    const { store, runId } = await productionRun()
    const snap = getRunSnapshot(store, runId)
    for (const stepId of ['D3-writing', 'D4-rebuttal']) {
      const a = snap.steps[stepId]?.gateResults.A
      expect(a?.outcome, stepId).toBe('passed')
      expect(String(a?.evidence), stepId).toContain('manuscript')
    }
    // The A verdict names the version it judged, so a report cannot be read as approving a
    // different draft from the one it saw.
    const receipt = snap.steps['D4-rebuttal']?.commit
    expect(snap.steps['D4-rebuttal']?.gateResults.A?.targetRefs).toEqual(receipt?.artifacts.map(a => a.ref))
  })
})

describe('readiness is not approval', () => {
  it('is eligible, has a manuscript, and is still not ready at the human gate', async () => {
    const { store, runId, run } = await productionRun()
    const plan = planRunPackage(store, run, 'production')
    expect(plan.manifest.profileEligible).toBe(true)
    expect(plan.manifest.submissionReady).toBe(false)
    expect(getArtifact(store, runId, 'formatted-manuscript')).toBeDefined()
    // The reason names the gate, not a missing artifact: the material is all there and a person has
    // not approved it.
    expect(plan.manifest.readinessNote).toMatch(/E2-submit/)
  })

  it('is never ready on the evaluation profile, whatever the run achieved', async () => {
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)
    const plan = planRunPackage(store, run, 'evaluation')
    expect(plan.manifest.profileEligible).toBe(false)
    expect(plan.manifest.submissionReady).toBe(false)
    expect(getArtifact(store, run.runId, 'formatted-manuscript')).toBeDefined()
  })

  it('writes both facts into the summary a reader of the package sees', async () => {
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { evidenceProfile: 'production' })
    const plan = planRunPackage(store, run, 'production')
    const summary = plan.files.find(file => file.path === 'run-summary.md')?.content ?? ''
    expect(summary).toMatch(/- evidence eligible: yes/)
    expect(summary).toMatch(/- submission ready: \*\*NO\*\*/)
    // The package holds what the run produced, including the record every number came from.
    const paths = plan.files.map(file => file.path)
    expect(paths).toContain('citations.json')
    expect(paths).toContain('run-summary.md')
  })
})
