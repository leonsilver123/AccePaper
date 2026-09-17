/**
 * The presentation plan a DRIVEN run carries, and the refusal when a figure cannot be sourced.
 *
 * THE DELIVERED PAPER IS THE REASON: six floats, and no sentence anywhere referring to them — figures
 * that were drawn because a step drew them, not because the paper asked a question. D1 now plans the
 * figure first, and these tests read the artifact a run produced rather than the module's interface.
 */
import { describe, expect, it } from 'vitest'
import { getArtifact, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { runT19B } from '../src/runner/drive.ts'
import { DEFAULT_PLAN } from '../src/runner/study-plan.ts'
import { FIXED_TS } from '../src/runner/registry.ts'
import type { ExecCtx, RunContext } from '../src/runner/registry.ts'
import { loadCasePack, planCasePackInputs } from '../src/runner/case-pack.ts'
import { fileURLToPath } from 'node:url'
import { experimentStudy } from '../src/runner/platoon-sim.ts'
import { PRESENTATION_PLAN_VERSION } from '../src/runner/presentation-plan.ts'
import type { PresentationPlan } from '../src/runner/presentation-plan.ts'

/** A SECOND TASK: the same study, a claim that commits to a decrease. Synthetic, test-owned. */
const DECREASE_PACK_DIR = fileURLToPath(new URL('./fixtures/case-pack-decrease', import.meta.url))

/**
 * The run context and step context for a step driven on its own.
 *
 * THE REGISTRY'S OWN SEAM, not a copy of it: `DEFAULT_PLAN`, the study and the run context are the
 * ones a driven run has, so a step driven here meets the same inputs it would meet in a run.
 */
function execCtxWith(inputs: Readonly<Record<string, unknown>>): ExecCtx {
  const runCtx = {
    stepId: 'D1-figure-map',
    commitment: undefined,
    claimText: '',
    predictionText: '',
    claimId: '',
    claimRef: '',
    metricKey: '',
    claimMaterial: {},
    study: experimentStudy(),
    studyPlan: DEFAULT_PLAN,
    planSource: 'default',
    timestamp: FIXED_TS,
  } as unknown as RunContext
  return {
    runId: 'presentation-plan-spec',
    stepId: 'D1-figure-map',
    attemptId: 1,
    getInput: (slug: string): unknown =>
      (inputs as Record<string, unknown>)[slug],
    runCtx,
  }
}

/** The plan a driven run recorded on its figure artifact. */
function planOfRun(store: ResearchRunStore, runId: string): PresentationPlan {
  const plan = getArtifact(store, runId, 'figure-plan') as { presentationPlan?: PresentationPlan }
  if (plan.presentationPlan === undefined) throw new Error('the figure plan recorded no presentation plan')
  return plan.presentationPlan
}

describe('the figure a driven run carries', () => {
  it('was planned before it was drawn, with the question it answers and its own size', async () => {
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)
    const plan = planOfRun(store, run.runId)
    expect(plan.version).toBe(PRESENTATION_PLAN_VERSION)
    const figure = plan.figures[0]
    expect(figure?.answers).toContain('minimum time-to-collision')
    expect(figure?.sourceSlug).toBe('result-version')
    expect(figure?.size).toEqual({ width: 480, height: 360 })
    expect(figure?.necessity).toBe('required')
  })

  it('plots the values the run recorded, and no others', async () => {
    // SOURCE-DATA RECONCILIATION, read from the two artifacts a reader would compare: what the figure
    // plots and what the study measured.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)
    const figure = planOfRun(store, run.runId).figures[0]
    const record = getArtifact(store, run.runId, 'result-version') as {
      measured: { baselineMinTtcSeconds: number; variantMinTtcSeconds: number }
    }
    const plotted = Object.fromEntries(
      (figure?.series[0]?.points ?? []).map(point => [point.key, point.value]),
    )
    expect(plotted['measured.baselineMinTtcSeconds']).toBe(record.measured.baselineMinTtcSeconds)
    expect(plotted['measured.variantMinTtcSeconds']).toBe(record.measured.variantMinTtcSeconds)
  })

  it('renders the canvas the plan states, so the figure a reader gets is the one that was asked for', async () => {
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)
    const plan = getArtifact(store, run.runId, 'figure-plan') as {
      figures: ReadonlyArray<{ svg?: string; label?: string }>
    }
    const planned = planOfRun(store, run.runId).figures[0]
    const svg = plan.figures.find(entry => typeof entry.svg === 'string')?.svg ?? ''
    expect(svg).toContain(`width="${String(planned?.size.width)}"`)
    expect(svg).toContain(`height="${String(planned?.size.height)}"`)
  })
})

describe('a step asked to draw a figure the run cannot source', () => {
  it('is refused rather than drawn from a literal', async () => {
    // THE RECORD EXISTS AND DOES NOT HOLD THE VALUES THE FIGURE PLOTS — a drifted result record. The
    // step recomputes the measurement to have something to draw, and the reconciliation refuses
    // because the figure claims a record that does not account for what it shows.
    const { STEP_EXECUTOR_REGISTRY } = await import('../src/runner/registry.ts')
    const entry = STEP_EXECUTOR_REGISTRY.get('D1-figure-map')
    await expect(entry?.executor(execCtxWith({
      'result-version': { measured: { somethingElse: 1 } },
    }))).rejects.toThrow(/figure-values-unsourced/u)
  })

  it('names the record its values came from when the step measured the study itself', async () => {
    // A STEP DRIVEN ALONE HAS NO RESULT RECORD and measures the study itself; the plan says so, so a
    // reader of the artifact can tell which of the two happened instead of the difference being
    // invisible.
    const { STEP_EXECUTOR_REGISTRY } = await import('../src/runner/registry.ts')
    const entry = STEP_EXECUTOR_REGISTRY.get('D1-figure-map')
    const out = await entry?.executor(execCtxWith({})) as { 'figure-plan': { presentationPlan: PresentationPlan } }
    expect(out['figure-plan'].presentationPlan.figures[0]?.sourceSlug).toBe('recomputed-measurement')
  })
})


describe('the second task family', () => {
  it('plans and draws its own figure from its own measurement', async () => {
    // A FIGURE THAT ONLY WORKS FOR ONE PAPER IS NOT A CAPABILITY. The decrease pack is the same study
    // under a claim that committed the other way; its figure is planned from its own record and its
    // caption states what its own measurement did to its own claim.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, {
      casePackInputs: planCasePackInputs(loadCasePack(DECREASE_PACK_DIR)),
    })
    const figure = planOfRun(store, run.runId).figures[0]
    expect(figure?.sourceSlug).toBe('result-version')
    expect(figure?.caption).toContain('supported')
    const plan = getArtifact(store, run.runId, 'figure-plan') as {
      figures: ReadonlyArray<{ svg?: string }>
    }
    expect(plan.figures.some(entry => (entry.svg ?? '').includes('<svg'))).toBe(true)
  })
})
