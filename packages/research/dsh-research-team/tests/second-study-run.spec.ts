/**
 * The second study, DRIVEN: all 16 steps, its own measurement, its own paper.
 *
 * THE REVIEW'S R03 IS THE REASON THIS FILE EXISTS. A pipeline whose second study is the first one's
 * claim reversed proves it can report support and refutation; it does not prove it can run a study
 * that is not this one. The unit before this one left the second study measurable but not DRIVABLE —
 * B3, C1, D1 and E1 built platoon-shaped artifacts, so the run stopped the moment it reached one of
 * them. These tests drive the queueing study to the human gate and read what came out.
 *
 * WHAT IS ASSERTED IS THE STUDY, NOT THE MACHINERY. That the run reaches E2 is necessary and not
 * sufficient: what matters is that its artifacts carry the queueing study's own quantity, unit,
 * direction, arms, sequence and table, and that none of them carries the platoon study's.
 */
import { describe, expect, it } from 'vitest'
import { getArtifact, getStepDefinitions } from '@deepseek-ai/dsh-research-core'
import type { ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { runT19B } from '../src/runner/drive.ts'
import { LATENCY_PLAN } from '../src/runner/study-plan.ts'
import { LATENCY_INPUTS, LATENCY_METRIC, LATENCY_RULE_VERSION } from '../src/runner/service-latency-sim.ts'
import { RESULT_VERSION_SLUG } from '../src/runner/result-version.ts'
import type { ResultVersion } from '../src/runner/result-version.ts'
import type { PresentationPlan } from '../src/runner/presentation-plan.ts'

interface Driven {
  readonly store: ResearchRunStore
  readonly runId: string
  readonly steps: ReadonlyArray<{ readonly stepId: string; readonly status: string; readonly executeError?: string }>
}

let cached: Driven | undefined
async function latencyRun(): Promise<Driven> {
  if (cached !== undefined) return cached
  const store: ResearchRunStore = new Map()
  const run = await runT19B(store, { studyPlan: LATENCY_PLAN })
  cached = {
    store,
    runId: run.runId,
    steps: run.steps.map(step => ({
      stepId: step.stepId,
      status: step.status,
      ...(step.executeError === undefined ? {} : { executeError: step.executeError }),
    })),
  }
  return cached
}

/** One artifact of the latency run, as a record. */
function artifactOf(store: ResearchRunStore, runId: string, slug: string): Record<string, unknown> {
  const value = getArtifact(store, runId, slug)
  if (value === null || typeof value !== 'object') throw new Error(`no artifact '${slug}'`)
  return value as Record<string, unknown>
}

describe('the queueing study runs to the human gate', () => {
  it('drives every step and stops at E2-submit, with nothing refused on the way', async () => {
    const { steps } = await latencyRun()
    expect(steps.map(step => step.stepId)).toEqual(getStepDefinitions().map(definition => definition.id))
    for (const step of steps.filter(entry => entry.stepId !== 'E2-submit')) {
      expect(step.status, `${step.stepId}: ${step.executeError ?? ''}`).toBe('passed')
    }
    expect(steps.at(-1)?.status).toBe('gated')
  })
})

describe('the artifacts carry the queueing study, not the platoon one', () => {
  it('records the tail latency as the run’s measured result, with its unit and direction', async () => {
    const { store, runId } = await latencyRun()
    const record = artifactOf(store, runId, RESULT_VERSION_SLUG) as unknown as ResultVersion
    // THE METRIC IDENTITY TRAVELS WITH THE NUMBERS. A record naming six platoon fields could not
    // describe this study at all — that generalization is what makes a second study reachable.
    expect(record.metricKey).toBe(LATENCY_METRIC.key)
    expect(record.ruleVersion).toBe(LATENCY_RULE_VERSION)
    const measured = record.measured
    expect(measured.unit).toBe('ms')
    expect(measured.direction).toBe('lower-is-better')
    expect(measured.baseline).toBeGreaterThan(measured.variant)
    // RAW MOVEMENT: the tail FELL, so the change is negative. Which way is better is the metric's
    // declared direction, and the gate applies it rather than reading a sign out of this field.
    expect(measured.improvementPct).toBeLessThan(0)
  })

  it('measures the experiment with the queueing implementation and grades it against the claim', async () => {
    const { store, runId } = await latencyRun()
    const mvp = artifactOf(store, runId, 'mvp-results')
    const experiment = mvp.experiment as Record<string, unknown>
    expect(String(experiment.source)).toContain('service-latency-coalescing')
    expect(experiment.measures).toBe(LATENCY_METRIC.key)
    expect(experiment.ruleVersion).toBe(LATENCY_RULE_VERSION)
    // THE PREDICTION IS ADJUDICATED, not held: the claim commits to a decrease of at least 30% and
    // the coalesced arm fell far past it. A run that held here would prove the study could be
    // declared, not that it could be tested.
    const outcome = mvp.outcome as Record<string, unknown>
    expect(outcome.decisive).toBe(true)
    expect(outcome.verdict).toBe('supported')
    const observed = mvp.observed as Record<string, unknown>
    expect(observed.metricKey).toBe(LATENCY_METRIC.key)
    expect(observed.baseline).toBeGreaterThan(observed.variant as number)
  })

  it('baselines the queueing study’s own arms, not a platoon', async () => {
    const { store, runId } = await latencyRun()
    const baseline = artifactOf(store, runId, 'baseline-results')
    const block = baseline.baseline as Record<string, unknown>
    expect(block.identity).toBe('individual-service')
    expect((block.metric as Record<string, unknown>).name).toBe(LATENCY_METRIC.key)
    expect((block.metric as Record<string, unknown>).direction).toBe('lower is better')
    const rows = artifactOf(store, runId, 'sota-comparison').rows as ReadonlyArray<Record<string, unknown>>
    expect(rows.map(row => row.method)).toEqual([
      'no coalescing (this study baseline)',
      expect.stringContaining('coalesced') as unknown as string,
    ])
    // No platoon vocabulary reaches a queueing study's baseline.
    expect(JSON.stringify(baseline)).not.toContain('TTC')
    expect(JSON.stringify(baseline)).not.toContain('platoon')
  })
})

describe('the paper carries the figures this study needs', () => {
  it('plans a figure over the SEQUENCE, with every value addressed in the run’s own record', async () => {
    const { store, runId } = await latencyRun()
    const plan = artifactOf(store, runId, 'figure-plan').presentationPlan as PresentationPlan
    const figure = plan.figures[0]
    expect(figure?.sourceSlug).toBe(RESULT_VERSION_SLUG)
    expect(figure?.x.kind).toBe('sequence')
    expect(figure?.y.unit).toBe('ms')
    // BOTH ARMS, ONE POINT PER DECLARED WINDOW, addressed positionally into the record's sequence.
    // A figure plotting anything else would illustrate a measurement the study did not take.
    expect(figure?.series.map(series => series.name))
      .toEqual(['no coalescing', expect.stringContaining('coalesced') as unknown as string])
    const windows = Math.ceil(LATENCY_INPUTS.requestCount / 100)
    for (const series of figure?.series ?? []) {
      expect(series.points).toHaveLength(windows)
      for (const [index, point] of series.points.entries()) {
        expect(point.key).toMatch(new RegExp(`^series\\.arms\\.(baseline|variant)\\.${String(index)}$`, 'u'))
      }
    }
  })

  it('records the sequence in the result record as well as in the plan', async () => {
    const { store, runId } = await latencyRun()
    const record = artifactOf(store, runId, RESULT_VERSION_SLUG) as unknown as ResultVersion
    const series = record.series
    expect(series?.unit).toBe('ms')
    expect(series?.bucket).toHaveLength(Math.ceil(LATENCY_INPUTS.requestCount / 100))
    // THE PLAN'S VALUES ARE THE RECORD'S VALUES: the figure reconciliation refuses a chart whose
    // points are not the run's, so the two are checked against each other rather than assumed equal.
    const plan = artifactOf(store, runId, 'figure-plan').presentationPlan as PresentationPlan
    const planned = plan.figures[0]?.series.find(entry => entry.name === 'no coalescing')
    expect(planned?.points.map(point => point.value)).toEqual(series?.arms['baseline'])
  })

  it('renders a table whose columns name the quantities this study measured', async () => {
    const { store, runId } = await latencyRun()
    const figures = artifactOf(store, runId, 'figure-plan').figures as ReadonlyArray<Record<string, unknown>>
    const table = figures.find(entry => entry.kind === 'three-line-table')
    expect(table?.title).toBe('Tail Latency With and Without Request Coalescing')
    expect(String(table?.tableMarkdown)).toContain('p95 latency (ms)')
    expect(String(table?.tableMarkdown)).not.toContain('TTC')
  })
})

describe('the manuscript is about the queueing study', () => {
  it('states the quantity, the change and the mechanism the run actually measured', async () => {
    const { store, runId } = await latencyRun()
    const manuscript = String(artifactOf(store, runId, 'formatted-manuscript').manuscript)
    expect(manuscript).toContain('95th-percentile request latency')
    expect(manuscript).toContain('coalesc')
    // THE PLATOON STUDY'S VOCABULARY IS ABSENT. This is the check that a "second study" is not the
    // first one under another name: the delivered manuscript for a queueing study must not describe
    // an Intelligent Driver Model or a time-to-collision.
    expect(manuscript).not.toContain('time-to-collision')
    expect(manuscript).not.toContain('Intelligent Driver Model')
    expect(manuscript).not.toContain('platoon')
  })

  it('carries the equations the queueing implementation computed', async () => {
    const { store, runId } = await latencyRun()
    const manuscript = String(artifactOf(store, runId, 'formatted-manuscript').manuscript)
    expect(manuscript).toContain('Nearest-rank percentile')
    expect(manuscript).not.toContain('Intelligent Driver Model')
  })
})

describe('the boundary this study reports is its own', () => {
  it('ablates the coalescing arm and probes the regime above capacity', async () => {
    const { store, runId } = await latencyRun()
    const ablation = artifactOf(store, runId, 'ablation-results')
    const modules = ablation.moduleAblations as Record<string, unknown>
    expect((modules.rows as ReadonlyArray<Record<string, unknown>>).map(row => row.moduleRemoved))
      .toEqual(['coalescingWindowMs', 'maxBatch'])
    const boundary = ablation.boundary as Record<string, unknown>
    const overloaded = boundary.overloaded as Record<string, unknown>
    // THE SCOPE TEST IS MEASURED, and it binds: above capacity the baseline arm does not settle, so
    // the claim is limited to a queue below its capacity.
    expect(overloaded.utilization as number).toBeGreaterThanOrEqual(1)
    expect(boundary.scopeLimited).toBe(true)
    expect(String(boundary.note)).toContain('MEASURED')
  })
})
