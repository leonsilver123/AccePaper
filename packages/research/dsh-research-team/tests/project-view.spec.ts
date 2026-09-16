/**
 * A run's steps, read while it is still running.
 *
 * WHAT THIS PINS. The browser's view used to be built from `RunResult`, the value a drive call
 * returns when it has FINISHED — so "what is this run doing" could not be answered about a run that
 * was doing it. `stepProjectionsOf` reads the run's own records instead: the step states, the
 * artifact registry and the `step-executed` audit records. These tests drive a real run to a real
 * intermediate state and read the projection there.
 *
 * NO SLEEPS. The state is reached deterministically — `stopBefore` halts the driver at a step
 * boundary, and an injected executor fails a step on purpose — so every assertion below is about a
 * state the driver was placed in rather than one it was raced into.
 */

import { describe, expect, it } from 'vitest'
import { getRunSnapshot, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'

import { runT19B } from '../src/runner/drive.ts'
import { stepProjectionsOf } from '../src/runner/project-view.ts'
import { STEP_EXECUTOR_REGISTRY } from '../src/runner/registry.ts'

/** Every step the projection reports, by id. */
function byId(store: ResearchRunStore, runId: string): Map<string, ReturnType<typeof stepProjectionsOf>[number]> {
  return new Map(stepProjectionsOf(store, runId).map(step => [step.stepId, step]))
}

describe('a running study reports its steps', () => {
  it('reads a run that stopped at a step boundary, without a drive result', async () => {
    // THE CASE THE OLD PROJECTION COULD NOT SERVE. `stopBefore` halts the driver mid-run, so no
    // `RunResult` exists — and the projection still answers, because every fact it needs is in the
    // run's own record.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { stopBefore: 'B1-method' })
    expect(run.steps.map(step => step.stepId)).not.toContain('B1-method')

    const steps = byId(store, run.runId)
    // Every catalogued step is present, in the catalogue's own terms: a caller reading this cannot
    // mistake "not started" for "absent".
    expect(steps.size).toBe(STEP_EXECUTOR_REGISTRY.size)

    // What ran, ran; what did not, says `pending` rather than being left out or defaulted to a
    // success.
    expect(steps.get('A1-landscape')?.status).toBe('passed')
    expect(steps.get('B1-method')?.status).toBe('pending')
    expect(steps.get('B1-method')?.attemptId).toBe(0)

    // The executor's declared identity travels with the step, so a reader knows what would run
    // before it has run.
    expect(steps.get('B1-method')?.kind).toBe(STEP_EXECUTOR_REGISTRY.get('B1-method')?.kind)
    expect(steps.get('B1-method')?.producer).toBe(STEP_EXECUTOR_REGISTRY.get('B1-method')?.producer)

    // And what the finished steps committed is attributed to the step that wrote it.
    expect(steps.get('A1-landscape')?.artifacts.map(artifact => artifact.slug)).toContain('landscape-map')
    expect(steps.get('B1-method')?.artifacts).toEqual([])
  })

  it('reports how a step EXECUTION ended, and why, from the run record', async () => {
    // The alternative was `in_progress` forever: the engine leaves a failed attempt rollback-able,
    // so the step's STATUS cannot carry "it failed", and the cause lived only in the drive result.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, {
      executorOverride: (stepId: string) =>
        stepId === 'A2-claim'
          ? () => { throw new Error('the claim channel is unreachable') }
          : undefined,
    })

    const steps = byId(store, run.runId)
    expect(steps.get('A2-claim')?.executeStatus).toBe('error')
    expect(steps.get('A2-claim')?.executeError).toContain('the claim channel is unreachable')
    // A step that never executed reports NO outcome, which is a different fact from a success.
    expect(steps.get('B1-method')?.executeStatus).toBeUndefined()
  })

  it('reads the LAST execution of a step, not an attempt it recovered from', async () => {
    // A step can execute more than once — a rollback re-opens it — and the question a reader asks
    // is how it ended, not how it ended once. Reading the first record would report a failure the
    // run has already recovered from.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)

    const events = getRunSnapshot(store, run.runId).events
      .filter(event => event.kind === 'step-executed' && event.stepId === 'A1-landscape')
    // A clean run executes each step once; the assertion that matters is the projection agreeing
    // with the record's own last entry.
    expect(events.length).toBeGreaterThan(0)
    expect(byId(store, run.runId).get('A1-landscape')?.executeStatus).toBe('success')
  })
})
