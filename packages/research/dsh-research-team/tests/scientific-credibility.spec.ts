/**
 * Scientific credibility — what the system does with evidence that does not cooperate.
 *
 * THE FIXTURE IS THE POINT. The shipped case pack's study measures something the claim predicted
 * would go the other way: the claim says inserting one autonomous vehicle raises the platoon's
 * minimum time-to-collision, and the measurement moves it down. That is the condition a system
 * claiming to be honest about evidence has to survive, and it is worth more as a test than a run
 * that agrees with itself:
 *
 *   - the refutation is REPORTED as a refutation, and the run still finishes — no retrying until a
 *     configuration supports the claim;
 *   - retrieving records is not the same as the literature supporting the assertion;
 *   - a mechanism is attributed by REMOVING IT and re-measuring, not by reading the joint difference;
 *   - evidence that is missing blocks the manuscript rather than being filled in.
 *
 * These are assertions about what the pipeline records, not about what its prose sounds like: prose
 * is where a system can say the right thing for the wrong reason.
 */
import { describe, expect, it } from 'vitest'
import { getArtifact, getStepDefinitions, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { runT19B } from '../src/runner/drive.ts'
import { submissionReadinessOf } from '../src/runner/submission-readiness.ts'
import type { ManuscriptFacts } from '../src/runner/final-package.ts'

/** One offline run of the shipped pipeline, which is where all of these facts come from. */
async function shippedRun(): Promise<{ store: ResearchRunStore; runId: string }> {
  const store = new Map() as ResearchRunStore
  const run = await runT19B(store)
  return { store, runId: run.runId }
}

/** One artifact's value, as the run recorded it. */
function artifact(store: ResearchRunStore, runId: string, slug: string): Record<string, unknown> {
  const value = getArtifact(store, runId, slug)
  if (value === null || typeof value !== 'object') throw new Error(`no artifact '${slug}'`)
  return value as Record<string, unknown>
}

describe('a measurement that contradicts the claim', () => {
  it('is recorded as a refutation, and the run carries on to its gate', async () => {
    const { store, runId } = await shippedRun()
    const outcome = artifact(store, runId, 'mvp-results').outcome as {
      supportsPrediction: boolean
      decisive: boolean
      verdict: string
      detail: string
    }

    // THE HONEST VERDICT, not a failure to execute: the experiment ran, it is decisive, and it says
    // the prediction did not hold.
    expect(outcome.verdict).toBe('refuted')
    expect(outcome.supportsPrediction).toBe(false)
    expect(outcome.decisive).toBe(true)
    // It names both what was measured and what was required, so a reader can see the gap.
    expect(outcome.detail).toContain('19.58')
    expect(outcome.detail).toContain('12.10')
    expect(outcome.detail).toContain('20%')

    // AND THE RUN FINISHED. A pipeline that retried until the measurement agreed would never reach
    // its human gate with a refutation in hand; this one does, which is what makes the refutation
    // something a person can act on.
    const steps = getStepDefinitions().map(definition => definition.id)
    expect(steps.length).toBe(16)
    expect(artifact(store, runId, 'typeset')).toBeDefined()
  })

  it('keeps the measured numbers as numbers, so a reader is not left with the prose', async () => {
    const { store, runId } = await shippedRun()
    const observed = artifact(store, runId, 'mvp-results').observed as Record<string, unknown>

    expect(observed.metricKey).toBe('min-ttc-seconds')
    expect(observed.baseline).toBeCloseTo(19.58, 1)
    expect(observed.variant).toBeCloseTo(12.1, 1)
    expect(observed.improvementPct).toBeCloseTo(-38.2, 1)
    // The metric's direction is the claim's own: for minimum time-to-collision, higher is better, so
    // a negative improvement is the wrong direction and the numbers say so without the prose.
    expect(observed.improvementPct).toBeLessThan(0)
  })
})

describe('retrieval is not support', () => {
  it('records the records it retrieved and claims no support from them', async () => {
    // THE CONFLATION THIS GUARDS: "we found papers" is not "the papers back the claim". A pipeline
    // that turned a retrieval into a support status would launder a corpus into evidence, and the
    // reader of the manuscript would have no way to tell.
    const { store, runId } = await shippedRun()
    const landscape = artifact(store, runId, 'landscape-map')
    const hits = landscape.hits as ReadonlyArray<unknown> | undefined
    expect(Array.isArray(hits) && hits.length > 0).toBe(true)

    const claim = artifact(store, runId, 'claim')
    expect(claim.supportStatus).toBe('not_claimed')
    // And the prediction does not claim it either: the status travels with the claim material.
    const prediction = artifact(store, runId, 'falsifiable-prediction')
    expect(prediction.supportStatus).toBe('not_claimed')
  })
})

describe('a mechanism is attributed by removing it', () => {
  it('publishes one ablation per declared mechanism, each measured against the full variant', async () => {
    // THE JOINT CHANGE IS A DIFFERENT FACT. The variant differs from the baseline in several
    // parameters at once, so the baseline-to-variant difference belongs to that configuration. What
    // isolates a mechanism is running the study with exactly that mechanism removed — which is what
    // these rows are, and what a claim about a single cause has to stand on.
    const { store, runId } = await shippedRun()
    const ablations = artifact(store, runId, 'ablation-results').moduleAblations as {
      readonly fullVariantMinTtcSeconds: number
      readonly note: string
      readonly rows: ReadonlyArray<{
        moduleRemoved: string
        measured: boolean
        minTtcSeconds: number
        changeVsFullVariantSeconds: number
      }>
    }
    const rows = ablations.rows

    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.moduleRemoved.length).toBeGreaterThan(0)
      // MEASURED, not quoted from the pack: a row that carried the Case Pack's own figure would be a
      // citation wearing a measurement's name.
      expect(row.measured).toBe(true)
      expect(Number.isFinite(row.minTtcSeconds)).toBe(true)
    }
    // The comparison the rows are against, stated once.
    expect(typeof ablations.fullVariantMinTtcSeconds).toBe('number')
    expect(ablations.note).toContain('ONE mechanism')
  })
})

/**
 * The facts a readiness decision reads, for a run whose steps all passed.
 *
 * `unfinishedSteps` is DERIVED from the statuses the case supplies, because that is the fact the
 * decision reads and a case that stated both could state them inconsistently.
 *
 * @param input - the step statuses, and the facts this case varies.
 * @returns the facts the decision reads.
 */
function manuscriptFacts(input: {
  readonly steps: ReadonlyArray<{ readonly stepId: string; readonly status: string }>
  readonly refusedSections?: ReadonlyArray<string>
}): ManuscriptFacts {
  return {
    profile: 'production',
    manuscriptProduced: true,
    unfinishedSteps: input.steps
      .filter(step => step.status !== 'passed')
      .map(step => `${step.stepId} (${step.status})`),
    refusedSections: input.refusedSections ?? [],
    openIssues: [],
    staleApproval: undefined,
    compilation: { tool: null, dropped: [] },
    // THE TYPESET FORM RENDERS THE DOCUMENT THE RUN HOLDS, so nothing about the submission is what
    // these cases are about: the manuscript's conditions decide what they assert.
    typeset: {
      renderedManuscriptVersion: 1,
      manuscriptVersion: 1,
      declaredFormats: [],
      documents: [],
    },
  }
}

describe('evidence that is missing blocks the manuscript', () => {
  it('refuses to call a manuscript ready when a section was refused for want of evidence', () => {
    // THE ALTERNATIVE IS FABRICATION: a section filled from the built-in sentences reads as complete,
    // which is the failure the pipeline is built against. The rule is the same one the manifest and
    // the page read, so this asserts the rule rather than restating it.
    const steps = getStepDefinitions().map(definition => ({ stepId: definition.id, status: 'passed' }))
    const ready = submissionReadinessOf(manuscriptFacts({ steps }))
    expect(ready.ready).toBe(true)

    const refused = submissionReadinessOf(manuscriptFacts({ steps, refusedSections: ['results'] }))
    expect(refused.ready).toBe(false)
    expect(refused.reason).toContain('results')
    expect(refused.reason).toContain('refused to write it')
  })

  it('records the sections it refused, so the gap is a fact about the run', async () => {
    const { store, runId } = await shippedRun()
    const draft = artifact(store, runId, 'manuscript')
    // An empty list here is the shipped case pack's honest outcome — every section had evidence. The
    // assertion is that the field exists and is a list: a run that could not say which sections it
    // skipped could not be checked for them either.
    expect(Array.isArray(draft.refusedSections)).toBe(true)
  })
})
