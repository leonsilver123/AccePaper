/**
 * One run reports one result, and says which numbers it is reporting.
 *
 * The defect (review J12): the study's numbers were recomputed wherever they were needed. The C
 * gate measured the study, `C1` measured it, `C2` compared the platoons, `D1` built its figure
 * from another comparison, `D3` wrote the prose from a third and `D4` revised against a fourth.
 * Nothing compared them, and nothing needed to: the simulation is deterministic over the same
 * study, so every recomputation agreed, which is why the arrangement survived review. A change to
 * the study would have had to move all of them in step, and the first to drift would have been
 * the one nobody re-read.
 *
 * The fix is a record. `C1-mvp` writes `result-version` — the numbers, the metric, the rule
 * version that produced them, and a hash over all of it — and every later step reads that instead
 * of measuring. The recomputation cannot be deleted from a pure function, so it is made
 * DETECTABLE instead: each reader writes `resultSource` on its own artifact, and the tests below
 * assert the pipeline reports `result-version` and never `recomputed`.
 */

import { describe, expect, it } from 'vitest'
import {
  createRun,
  getArtifact,
  getRunSnapshot,
  getStepDefinitionById,
  getStepDefinitions,
  setRunInput,
} from '@deepseek-ai/dsh-research-core'
import type { ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { createRunContext, driveStep, runT19B } from '../src/runner/drive.ts'
import { FIXED_TS } from '../src/runner/registry.ts'
import {
  RESULT_VERSION_SLUG,
  readResultVersion,
  resultVersionOf,
} from '../src/runner/result-version.ts'
import {
  EXPERIMENT_RULE_VERSION,
  comparePlatoons,
  experimentStudy,
} from '../src/runner/platoon-sim.ts'
import type { PlatoonStudy } from '../src/runner/platoon-sim.ts'

interface DraftShape {
  readonly resultSource: string
  readonly resultRef: string
}

interface RecitedShape {
  readonly resultSource: string
  readonly resultRef: string
}

async function fullRun(): Promise<{ store: ResearchRunStore; runId: string }> {
  const store: ResearchRunStore = new Map()
  const run = await runT19B(store)
  return { store, runId: run.runId }
}

describe('the result record', () => {
  it('is produced by the step that measured, and read by every step that reports', async () => {
    const { store, runId } = await fullRun()
    const record = readResultVersion(getArtifact(store, runId, RESULT_VERSION_SLUG))
    expect(record).toBeDefined()
    if (record === undefined) throw new Error('unreachable')
    expect(record.source).toBe('simulation')
    expect(record.ruleVersion).toBe(EXPERIMENT_RULE_VERSION)
    expect(record.metricKey).toBe('min-ttc-seconds')
    expect(record.contentHash).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('carries the same numbers the experiment recorded', async () => {
    const { store, runId } = await fullRun()
    const record = readResultVersion(getArtifact(store, runId, RESULT_VERSION_SLUG))
    const mvp = getArtifact(store, runId, 'mvp-results') as
      | { observed?: { baseline?: number; variant?: number; improvementPct?: number } }
      | undefined
    // `mvp-results.observed` reports the raw comparison; the record rounds to the precision the
    // manuscript states. Agreement is what matters: both are read off C1's one comparison, so a
    // reader of either sees the same experiment.
    const round2 = (value: number | undefined): number | undefined =>
      value === undefined ? undefined : Math.round(value * 100) / 100
    expect(record?.measured.baseline).toBe(round2(mvp?.observed?.baseline))
    expect(record?.measured.variant).toBe(round2(mvp?.observed?.variant))
    expect(record?.measured.improvementPct).toBe(round2(mvp?.observed?.improvementPct))
  })

  it('is what the prose steps report, not a fresh measurement', async () => {
    const { store, runId } = await fullRun()
    // ONE DOCUMENT, ONE SLUG, TWO VERSIONS. D3 creates `manuscript` and D4 republishes it under the
    // same name, so the registry holds only the revision; D3's version is read where the engine
    // keeps it, as D3's own attempt. Reading the slug twice would assert the revision's
    // `resultSource` against itself and leave D3's unreported — which is the defect this file exists
    // to catch.
    const draft = getRunSnapshot(store, runId).steps['D3-writing']?.artifacts['manuscript'] as DraftShape | undefined
    const revised = getArtifact(store, runId, 'manuscript') as RecitedShape | undefined
    const record = readResultVersion(getArtifact(store, runId, RESULT_VERSION_SLUG))
    // THE ASSERTION THIS FILE EXISTS FOR. `recomputed` would mean the step measured the study
    // itself while a record of that measurement sat in the run.
    expect(draft?.resultSource).toBe('result-version')
    expect(revised?.resultSource).toBe('result-version')
    expect(draft?.resultRef).toBe(record?.contentHash)
    expect(revised?.resultRef).toBe(record?.contentHash)
  })

  it('declares itself as a dependency of the steps that read it', () => {
    // The graph has to say so: a step that reads a record its definition does not declare takes a
    // dependency the engine cannot see, and re-measuring would not invalidate it.
    expect(getStepDefinitionById('C1-mvp')?.outputs).toContain(RESULT_VERSION_SLUG)
    for (const stepId of ['C2-trinity-loop', 'C3-boundary', 'D1-figure-map', 'D3-writing', 'D4-rebuttal', 'E1-format']) {
      expect(getStepDefinitionById(stepId)?.inputs, stepId).toContain(RESULT_VERSION_SLUG)
    }
  })
})

describe('a reporting step cannot run without the record', () => {
  it('is refused by the driver, which names the missing record', async () => {
    // The teeth behind every `resultSource` assertion above. The record is a declared input, so the
    // driver will not start a reporting step on a run that holds none: the `recomputed` path is
    // reachable only by calling an executor directly, never by driving a run.
    const store: ResearchRunStore = new Map()
    const runId = createRun(store)
    setRunInput(store, runId, 'domain-direction', 'a direction')
    await expect(driveStep(store, runId, 'D3-writing', { runCtx: createRunContext(FIXED_TS) }))
      .rejects.toThrow(/result-version/u)
  })
})

describe('an exhibit reports the record, not the study its caller is holding', () => {
  /** A study in which the two arms are identical, so it measures a 0 % change. */
  function flatStudy(): PlatoonStudy {
    const base = experimentStudy()
    return {
      baseline: base.baseline,
      variant: {
        ...base.variant,
        vehicleClasses: { ...base.variant.vehicleClasses, AV: base.variant.vehicleClasses.HV },
      },
    }
  }

  it('draws D1’s table from the record even when the step’s own study says otherwise', async () => {
    const store: ResearchRunStore = new Map()
    const runCtx = createRunContext(FIXED_TS)
    const runId = createRun(store)
    setRunInput(store, runId, 'domain-direction', 'a direction')
    for (const step of getStepDefinitions()) {
      if (step.id === 'D1-figure-map') break
      const outcome = await driveStep(store, runId, step.id, { runCtx })
      expect(outcome.status, step.id).toBe('passed')
    }
    const record = readResultVersion(getArtifact(store, runId, RESULT_VERSION_SLUG))
    if (record === undefined) throw new Error('fixture: no result record after C1')

    // The drift the fix is meant to survive: the caller hands D1 a study whose arms do not differ,
    // which measures a change of exactly zero. Before the fix D1 measured THAT study and the
    // manuscript's table said the two compositions performed identically.
    const flat = flatStudy()
    expect(comparePlatoons(flat).relativeImprovementPct).not.toBe(record.measured.improvementPct)
    const outcome = await driveStep(store, runId, 'D1-figure-map', {
      runCtx: { ...createRunContext(FIXED_TS), study: flat },
    })
    expect(outcome.status).toBe('passed')

    const plan = getArtifact(store, runId, 'figure-plan') as { figures?: ReadonlyArray<{ kind: string; tableMarkdown?: string }> } | undefined
    const table = plan?.figures?.find(figure => figure.kind === 'three-line-table')?.tableMarkdown
    expect(table).toBeDefined()
    // Both of the record's numbers, and not the numbers the step's own study would have produced.
    expect(table).toContain(record?.measured.variant.toFixed(2))
    expect(table).toContain(record?.measured.baseline.toFixed(2))
    expect(record?.measured.variant).not.toBe(record?.measured.baseline)
  })
})

describe('the record is a function of what was measured', () => {
  it('changes when the study changes, so a stale record cannot pass for a current one', () => {
    const base = comparePlatoons(experimentStudy())
    const first = resultVersionOf(base, 'min-ttc-seconds')
    // A different comparison — any real change to the study moves the numbers and the hash with
    // them, which is what makes the record comparable across runs rather than merely present.
    const shifted = { ...base, relativeImprovementPct: base.relativeImprovementPct + 1 }
    const second = resultVersionOf(shifted, 'min-ttc-seconds')
    expect(second.contentHash).not.toBe(first.contentHash)
  })

  it('is stable for the same measurement', () => {
    const comparison = comparePlatoons(experimentStudy())
    expect(resultVersionOf(comparison, 'min-ttc-seconds').contentHash)
      .toBe(resultVersionOf(comparison, 'min-ttc-seconds').contentHash)
  })

  it('names the metric the claim binds to', () => {
    const record = resultVersionOf(comparePlatoons(experimentStudy()), 'some-other-quantity')
    expect(record.resultId).toBe('result:some-other-quantity')
    expect(record.metricKey).toBe('some-other-quantity')
  })

  it('refuses to read a value that is not a record', () => {
    expect(readResultVersion(undefined)).toBeUndefined()
    expect(readResultVersion({ measured: { improvementPct: 'lots' } })).toBeUndefined()
    expect(readResultVersion({ measured: {} })).toBeUndefined()
  })

  it('takes its version from the caller, so a re-measure is a new version', () => {
    const comparison = comparePlatoons(experimentStudy())
    expect(resultVersionOf(comparison, 'min-ttc-seconds', 1).version).toBe(1)
    expect(resultVersionOf(comparison, 'min-ttc-seconds', 2).version).toBe(2)
  })
})
