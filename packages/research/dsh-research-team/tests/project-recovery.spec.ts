/**
 * What a restart needs in order to drive the run it was running.
 *
 * The defect this pins: `resumeRunPipeline` rebuilt the cross-step context from the artifacts the
 * run had recorded — the claim, the prediction, the metric key — but took the title, the field,
 * the retrieval direction, the section skeleton and the per-step budget from the plan and config
 * THIS deployment supplies. None of those five is in any artifact, so a resume after a deployment
 * changed its plan (or after one deployment resumed another's run) wrote a manuscript about a
 * study its own gates had not graded, and a run driven through a model route resumed under the
 * registry's offline per-step budget recorded `timeout` on its first long step.
 *
 * The fix is a record: `setRunSpec` stores the resolved configuration on the run before the first
 * step, and the persistence layer carries it. These tests drive real runs and real saves, then
 * read the record back the way the resume does — through `requirePlan`, which is the same
 * validation a plan arriving off the wire gets.
 */

import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRunPersistence, getRunSnapshot, setRunSpec, startStep } from '@deepseek-ai/dsh-research-core'
import type { ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { runT19B } from '../src/runner/drive.ts'
import { requirePlan } from '../src/runner/study-plan.ts'
import type { StudyPlan } from '../src/runner/study-plan.ts'
import { MEASURED_METRIC } from '../src/runner/platoon-sim.ts'
import { IDM_PLATOON_IMPLEMENTATION } from '../src/runner/implementations.ts'

/** A plan that is nobody's default, so "it survived" and "it was re-defaulted" cannot look alike. */
const CUSTOM_PLAN: StudyPlan = {
  title: 'A Study That No Deployment Would Have Defaulted',
  field: 'queueing systems',
  direction: 'priority queue scheduling under bursty arrivals',
  outline: [
    { id: 'abstract', heading: 'Abstract' },
    { id: 'introduction', heading: 'Introduction' },
    { id: 'method', heading: 'Method' },
    { id: 'experiments', heading: 'Experiments' },
    { id: 'results', heading: 'Results' },
    { id: 'conclusion', heading: 'Conclusion' },
    { id: 'references', heading: 'References' },
  ],
  claim: {
    id: 'claim-priority-queue-wait',
    ref: 'priority scheduling lowers mean waiting time in a bursty queue',
    assertion: 'Priority scheduling lowers mean waiting time in a bursty queue.',
    essentialDifference: 'admission is ordered by class rather than by arrival',
    experimentToFalsify: 'Simulate both disciplines against the same arrival trace.',
    prediction: 'the prioritised queue shall exceed the FIFO queue in minimum time-to-collision by at least 20%',
  },
  metric: MEASURED_METRIC,
  commitment: { direction: 'increase', bound: 'at-least', thresholdPct: 20 },
}

const CUSTOM_TIMEOUT_MS = 4242

async function persistenceDir(): Promise<{ dir: string; store: ResearchRunStore }> {
  return { dir: await mkdtemp(join(tmpdir(), 'dsh-project-recovery-')), store: new Map() }
}

describe('a run records the configuration it was driven with', () => {
  it('records the caller plan, the source of that plan, and the budget', async () => {
    const { store } = await persistenceDir()
    const run = await runT19B(store, {
      studyPlan: CUSTOM_PLAN,
      timeoutMs: CUSTOM_TIMEOUT_MS,
      evidenceProfile: 'production',
      stopBefore: 'A2-claim',
    })
    const spec = getRunSnapshot(store, run.runId).spec
    expect(spec['planSource']).toBe('caller')
    expect(spec['stepTimeoutMs']).toBe(CUSTOM_TIMEOUT_MS)
    expect(spec['evidenceProfile']).toBe('production')
    // Read back the way the resume reads it: through the same validation a plan off the wire gets.
    const restored = requirePlan(spec['studyPlan'], MEASURED_METRIC)
    expect(restored.ok).toBe(true)
    if (!restored.ok) throw new Error(restored.reason)
    // The plan that comes back carries the implementation it was RESOLVED to, which the caller did
    // not state. That is the fact a resume needs: the run's record says which code executed it, so
    // a deployment whose supported implementations changed under it cannot quietly resume this run
    // as a different one.
    expect(restored.plan).toEqual({ ...CUSTOM_PLAN, implementationId: IDM_PLATOON_IMPLEMENTATION.id })
  })

  it('says the plan was the deployment default when no caller stated one', async () => {
    const { store } = await persistenceDir()
    const run = await runT19B(store, { stopBefore: 'A2-claim' })
    const spec = getRunSnapshot(store, run.runId).spec
    expect(spec['planSource']).toBe('default')
    // Absent, not zero: "the registry's per-step value applies" and "the budget is zero" differ.
    expect('stepTimeoutMs' in spec).toBe(false)
    expect(spec['evidenceProfile']).toBe('evaluation')
  })

  it('refuses to change the record once the run has started', async () => {
    const { store } = await persistenceDir()
    const run = await runT19B(store, { stopBefore: 'A2-claim' })
    expect(() =>{  setRunSpec(store, run.runId, { studyPlan: CUSTOM_PLAN }) }).toThrow(/DSH_INPUT_FROZEN/)
  })

  it('records the direction it seeded, so the literature and the measurement agree', async () => {
    const { store } = await persistenceDir()
    const run = await runT19B(store, { studyPlan: CUSTOM_PLAN, stopBefore: 'A2-claim' })
    const snap = getRunSnapshot(store, run.runId)
    expect(snap.inputs['domain-direction']).toBe(CUSTOM_PLAN.direction)
    const recorded = requirePlan(snap.spec['studyPlan'], MEASURED_METRIC)
    expect(recorded.ok && recorded.plan.direction).toBe(CUSTOM_PLAN.direction)
  })
})

describe('the record survives the boundary a restart crosses', () => {
  it('round-trips through save and load, plan and budget intact', async () => {
    const { dir, store } = await persistenceDir()
    const run = await runT19B(store, {
      studyPlan: CUSTOM_PLAN,
      timeoutMs: CUSTOM_TIMEOUT_MS,
      stopBefore: 'A2-claim',
    })
    await createRunPersistence({ dir }).save(store, run.runId, { baseRevision: 0 })

    const loaded = await createRunPersistence({ dir }).load({})
    const spec = getRunSnapshot(loaded.store, run.runId).spec
    const restored = requirePlan(spec['studyPlan'], MEASURED_METRIC)
    expect(restored.ok).toBe(true)
    if (!restored.ok) throw new Error(restored.reason)
    expect(restored.plan.title).toBe(CUSTOM_PLAN.title)
    expect(restored.plan.field).toBe(CUSTOM_PLAN.field)
    expect(restored.plan.outline).toEqual(CUSTOM_PLAN.outline)
    expect(spec['stepTimeoutMs']).toBe(CUSTOM_TIMEOUT_MS)
    expect(spec['evidenceProfile']).toBe('evaluation')
  })
})

describe('a run checkpoints as it goes, and says so when a checkpoint fails', () => {
  it('calls the checkpoint once per finished step, in order', async () => {
    const { store } = await persistenceDir()
    const seen: string[] = []
    const run = await runT19B(store, {
      stopBefore: 'A3-agenda',
      checkpointAfterStep: (_runId, outcome) => { seen.push(outcome.stepId) },
    })
    expect(seen).toEqual(run.steps.map(step => step.stepId))
    expect(seen).toEqual(['A1-landscape', 'A2-claim'])
  })

  it('records a failing checkpoint instead of throwing away the steps that already ran', async () => {
    const { store } = await persistenceDir()
    const run = await runT19B(store, {
      stopBefore: 'A3-agenda',
      checkpointAfterStep: (_runId, outcome) => {
        if (outcome.stepId === 'A1-landscape') throw new Error('disk full')
      },
    })
    // The run continues past the failure ...
    expect(run.steps.map(step => step.stepId)).toEqual(['A1-landscape', 'A2-claim'])
    // ... and the failure is said out loud rather than swallowed.
    expect(run.checkpointErrors).toHaveLength(1)
    expect(run.checkpointErrors?.[0]).toMatch(/A1-landscape/)
    expect(run.checkpointErrors?.[0]).toMatch(/disk full/)
  })

  it('has no checkpoint errors when every checkpoint succeeds', async () => {
    const { store } = await persistenceDir()
    const run = await runT19B(store, { stopBefore: 'A2-claim', checkpointAfterStep: () => {} })
    expect(run.checkpointErrors).toBeUndefined()
  })
})

describe('F03 — a checkpoint is told the run it belongs to', () => {
  it('routes each run its own id when one store drives two of them', async () => {
    const { store } = await persistenceDir()
    const first = await runT19B(store, { stopBefore: 'A2-claim' })
    const firstSeen: string[] = []
    const secondSeen: string[] = []
    const second = await runT19B(store, {
      stopBefore: 'A2-claim',
      checkpointAfterStep: (runId) => { secondSeen.push(runId) },
    })
    void firstSeen
    // Both runs live in one store, which is a shape this runner already produces in recovery.
    expect(store.size).toBe(2)
    expect(first.runId).not.toBe(second.runId)
    // The callback used to be handed the store's FIRST key, which is the other run as soon as a
    // second one exists — so a checkpoint persisted one run's state under another's name.
    expect(secondSeen.length).toBeGreaterThan(0)
    expect(secondSeen.every(id => id === second.runId)).toBe(true)
    expect(secondSeen.some(id => id === first.runId)).toBe(false)
  })

  it('re-running the first run again still routes to it, not to the newest', async () => {
    const { store } = await persistenceDir()
    await runT19B(store, { stopBefore: 'A2-claim' })
    const thirdSeen: string[] = []
    const third = await runT19B(store, {
      stopBefore: 'A2-claim',
      checkpointAfterStep: (runId) => { thirdSeen.push(runId) },
    })
    expect(thirdSeen.every(id => id === third.runId)).toBe(true)
  })
})

describe('the run spec is the run’s, not the deployment’s', () => {
  it('keeps the first run’s record when a second run is driven under a different plan', async () => {
    const { store } = await persistenceDir()
    const first = await runT19B(store, { studyPlan: CUSTOM_PLAN, stopBefore: 'A2-claim' })
    const second = await runT19B(store, { stopBefore: 'A2-claim' })
    // Two runs in one store keep two records; the second is nobody's edit of the first.
    expect(getRunSnapshot(store, first.runId).spec['planSource']).toBe('caller')
    expect(getRunSnapshot(store, second.runId).spec['planSource']).toBe('default')
    expect(first.runId).not.toBe(second.runId)
  })

  it('refuses a spec on a run that has already been started by hand', async () => {
    const { store } = await persistenceDir()
    const run = await runT19B(store, { stopBefore: 'A2-claim' })
    startStep(store, run.runId, 'A2-claim')
    expect(() =>{  setRunSpec(store, run.runId, { planSource: 'caller' }) }).toThrow(/DSH_INPUT_FROZEN/)
  })
})
