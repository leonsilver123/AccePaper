import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ResearchError,
  getArtifact,
  getRunSnapshot,
  recordArtifact,
  rollback,
  startStep,
  submitGateVerdict,
} from '../src/engine/state-machine.ts'
import { runStep } from '../src/engine/pipeline.ts'
import type { StepExecutedRecord } from '../src/engine/types.ts'
import { freshStore, seedRun, verdict } from './helpers.ts'
import { lookupStep } from '../src/engine/steps.ts'

/**
 * T19-A P3 — minimal execution pipeline (src/engine/pipeline.ts).
 *
 * `runStep` is a self-contained, Cordis-free pure-logic module: it executes an injected
 * executor under a timeout + abort-signal discipline, writes declared artifacts via the
 * existing `recordArtifact` write-boundary, appends an append-only `step-executed` audit
 * record, and NEVER leaves a step hanging in `in_progress`. It does NOT re-implement gate
 * adjudication — on success the caller continues the gate via `submitGateVerdict` (see the
 * gate-integration block). All state transitions other than artifact writes + audit are the
 * upper layer's responsibility.
 *
 * Test step: A1-landscape (outputs ['landscape-map','gap-list'], gate ['B'], non-humanGate).
 */

const STEP = 'A1-landscape'
const OUTS = lookupStep(STEP)!.outputs // ['landscape-map','gap-list']

/** seed + start STEP so it is in_progress; returns [store, runId]. */
function started(): [ReturnType<typeof freshStore>, string] {
  const store = freshStore()
  const id = seedRun(store)
  startStep(store, id, STEP)
  expect(getRunSnapshot(store, id).steps[STEP]?.status).toBe('in_progress')
  return [store, id]
}

function execRecorded(store: ReturnType<typeof freshStore>, id: string, status: StepExecutedRecord['status']): StepExecutedRecord {
  const ev = getRunSnapshot(store, id).events.find(e => e.kind === 'step-executed' && e.stepId === STEP)
  expect(ev).toBeDefined()
  expect(ev!.detail).toMatchObject({ status })
  return ev!.detail as StepExecutedRecord
}

afterEach(() => {
  vi.useRealTimers()
})

// ── Guards ─────────────────────────────────────────────────────────────────────

describe('P3 guard — unknown step / not in_progress', () => {
  it('throws DSH_UNKNOWN_STEP when the step id is not in the run', () => {
    const store = freshStore()
    const id = seedRun(store)
    expect(() => runStep(store, id, 'NO-SUCH-STEP', { executor: () => ({}) })).toThrow(/DSH_UNKNOWN_STEP/)
  })

  it('throws DSH_NOT_IN_PROGRESS when the step is in the run but not in_progress (rolled back to pending)', () => {
    const [store, id] = started()
    rollback(store, id, STEP) // superseded → pending, still in the run's step store
    expect(getRunSnapshot(store, id).steps[STEP]?.status).toBe('pending')
    expect(() => runStep(store, id, STEP, { executor: () => ({}) })).toThrow(/DSH_NOT_IN_PROGRESS/)
  })
})

// ── Success: artifact validation + write via recordArtifact ───────────────────

describe('P3 success — declared outputs written, step-executed audit', () => {
  it('writes each declared output slug through recordArtifact and records a success audit', async () => {
    const [store, id] = started()
    const res = await runStep(store, id, STEP, { executor: () => ({ 'landscape-map': 1, 'gap-list': 2 }) })
    expect(res.ok).toBe(true)
    expect(res.status).toBe('success')
    expect(res.outputSlugs).toEqual(expect.arrayContaining(OUTS))
    // artifacts persisted + deep-cloned into registry
    expect(getArtifact(store, id, 'landscape-map')).toBe(1)
    expect(getArtifact(store, id, 'gap-list')).toBe(2)
    // step stays in_progress — pipeline does NOT transition; upper layer continues gate
    expect(getRunSnapshot(store, id).steps[STEP]?.status).toBe('in_progress')
    const rec = execRecorded(store, id, 'success')
    expect(rec.outputSlugs).toEqual(expect.arrayContaining(OUTS))
    expect(typeof rec.durationMs).toBe('number')
  })

  it('succeeds with zero outputs (empty artifact map)', async () => {
    const [store, id] = started()
    const res = await runStep(store, id, STEP, { executor: () => ({}) })
    expect(res.ok).toBe(true)
    expect(res.outputSlugs).toEqual([])
    expect(execRecorded(store, id, 'success').outputSlugs).toEqual([])
  })

  it('treats a non-object return as zero outputs (no artifacts written)', async () => {
    const [store, id] = started()
    const res = await runStep(store, id, STEP, { executor: () => undefined as unknown as Record<string, unknown> })
    expect(res.ok).toBe(true)
    expect(res.outputSlugs).toEqual([])
  })
})

// ── Artifact validation reject (write-boundary) ───────────────────────────────

describe('P3 artifact validation — undeclared slug rejected, no partial write', () => {
  it('rejects an undeclared slug, writes NO artifact, and records an error audit', async () => {
    const [store, id] = started()
    const before = getRunSnapshot(store, id).steps[STEP]!.artifacts
    const res = await runStep(store, id, STEP, { executor: () => ({ 'not-declared': 42 }) })
    expect(res.ok).toBe(false)
    expect(res.status).toBe('error')
    // no artifact written (all-or-nothing)
    expect(getRunSnapshot(store, id).steps[STEP]!.artifacts).toEqual(before)
    const rec = execRecorded(store, id, 'error')
    expect(rec.errorMessage).toMatch(/DSH_OUTPUT_NOT_DECLARED/)
  })

  it('rejects a MIXED declared+undeclared map with ZERO artifacts written (all-or-nothing — no partial write)', async () => {
    const [store, id] = started()
    const before = { ...getRunSnapshot(store, id).steps[STEP]!.artifacts }
    const res = await runStep(store, id, STEP, { executor: () => ({ 'landscape-map': 1, 'not-declared': 42 }) })
    expect(res.ok).toBe(false)
    expect(res.status).toBe('error')
    // the declared slug must NOT have been persisted — validation happens before any write
    expect(res.error?.message).toMatch(/DSH_OUTPUT_NOT_DECLARED/)
    expect(getRunSnapshot(store, id).steps[STEP]!.artifacts).toEqual(before)
    const rec = execRecorded(store, id, 'error')
    expect(rec.errorMessage).toMatch(/DSH_OUTPUT_NOT_DECLARED/)
  })
})

// ── Executor error → append-only error audit, no fake-success artifact ─────────

describe('P3 executor error — error audit, no artifact, step rollback-able', () => {
  it('records an error audit and NO artifact when the executor throws an Error', async () => {
    const [store, id] = started()
    const boom = new Error('kaboom')
    const res = await runStep(store, id, STEP, { executor: () => { throw boom } })
    expect(res.ok).toBe(false)
    expect(res.status).toBe('error')
    expect(res.error).toBe(boom)
    expect(getRunSnapshot(store, id).steps[STEP]!.artifacts).toEqual({})
    expect(execRecorded(store, id, 'error').errorMessage).toMatch(/kaboom/)
    // step remains in_progress → rollback-able (no hang)
    expect(getRunSnapshot(store, id).steps[STEP]?.status).toBe('in_progress')
  })

  it('wraps a non-Error throw in a ResearchError but still surfaces it', async () => {
    const [store, id] = started()
    const res = await runStep(store, id, STEP, { executor: () => { throw 'string-fail' } })
    expect(res.ok).toBe(false)
    expect(res.status).toBe('error')
    expect(res.error).toBeInstanceOf(ResearchError)
  })

  it('a failed step can be rolled back (rollback-able terminal state)', async () => {
    const [store, id] = started()
    await runStep(store, id, STEP, { executor: () => { throw new Error('x') } })
    expect(() => rollback(store, id, STEP)).not.toThrow()
    expect(getRunSnapshot(store, id).steps[STEP]?.status).toBe('pending') // superseded → pending
  })
})

// ── Result exactly once ────────────────────────────────────────────────────────

describe('P3 result lands exactly once', () => {
  it('rejects a second runStep on the same attempt with DSH_STEP_ALREADY_EXECUTED', async () => {
    const [store, id] = started()
    const r1 = await runStep(store, id, STEP, { executor: () => ({ 'landscape-map': 1 }) })
    expect(r1.ok).toBe(true)
    expect(() => runStep(store, id, STEP, { executor: () => ({ 'landscape-map': 2 }) })).toThrow(/DSH_STEP_ALREADY_EXECUTED/)
  })
})

// ── Timeout discipline (never hang in_progress) ────────────────────────────────

describe('P3 timeout — deterministic failure, no hang, late result ignored', () => {
  it('times out a hanging executor, records a timeout audit, leaves step in_progress', async () => {
    vi.useFakeTimers()
    const [store, id] = started()
    let resolveExec!: (v: Record<string, unknown>) => void
    const executor = () => new Promise<Record<string, unknown>>((res) => { resolveExec = res })
    const p = runStep(store, id, STEP, { executor, timeoutMs: 100 })
    vi.advanceTimersByTime(100)
    const res = await p
    expect(res.ok).toBe(false)
    expect(res.status).toBe('timeout')
    expect(getRunSnapshot(store, id).steps[STEP]!.artifacts).toEqual({})
    expect(execRecorded(store, id, 'timeout').status).toBe('timeout')
    expect(getRunSnapshot(store, id).steps[STEP]?.status).toBe('in_progress')
    // late executor resolution must be ignored (no success artifact)
    resolveExec({ 'landscape-map': 9 })
    await Promise.resolve()
    expect(getRunSnapshot(store, id).steps[STEP]!.artifacts).toEqual({})
  })

  it('does not install a timer when timeoutMs is 0', async () => {
    const [store, id] = started()
    const res = await runStep(store, id, STEP, { executor: () => ({ 'landscape-map': 1 }), timeoutMs: 0 })
    expect(res.ok).toBe(true)
  })
})

// ── Cancellation discipline (signal) ──────────────────────────────────────────

describe('P3 cancel — signal abort, no hang, late result ignored', () => {
  it('cancels immediately when the signal is already aborted at call time', async () => {
    const [store, id] = started()
    const ac = new AbortController()
    ac.abort()
    const res = await runStep(store, id, STEP, { executor: () => ({ 'landscape-map': 1 }), signal: ac.signal })
    expect(res.ok).toBe(false)
    expect(res.status).toBe('cancelled')
    expect(getRunSnapshot(store, id).steps[STEP]!.artifacts).toEqual({})
    expect(execRecorded(store, id, 'cancelled').status).toBe('cancelled')
  })

  it('cancels mid-execution and ignores a late thrown error', async () => {
    const [store, id] = started()
    const ac = new AbortController()
    let rejectExec!: (e: unknown) => void
    const executor = () => new Promise<Record<string, unknown>>((_res, rej) => { rejectExec = rej })
    const p = runStep(store, id, STEP, { executor, signal: ac.signal })
    ac.abort()
    const res = await p
    expect(res.ok).toBe(false)
    expect(res.status).toBe('cancelled')
    expect(getRunSnapshot(store, id).steps[STEP]!.artifacts).toEqual({})
    // late rejection must be swallowed (no unhandled rejection, no artifact)
    rejectExec(new Error('too late'))
    await Promise.resolve()
    expect(getRunSnapshot(store, id).steps[STEP]!.artifacts).toEqual({})
  })

  it('a late timer / abort after success is a no-op (idempotent finish)', async () => {
    vi.useFakeTimers()
    const [store, id] = started()
    const ac = new AbortController()
    const p = runStep(store, id, STEP, { executor: () => ({ 'landscape-map': 1, 'gap-list': 2 }), timeoutMs: 5000, signal: ac.signal })
    const res = await p
    expect(res.status).toBe('success')
    // fire the timer + abort AFTER done → must not alter state
    vi.advanceTimersByTime(5000)
    ac.abort()
    expect(getRunSnapshot(store, id).steps[STEP]!.artifacts['landscape-map']).toBe(1)
    expect(getRunSnapshot(store, id).steps[STEP]!.artifacts['gap-list']).toBe(2)
    const succ = getRunSnapshot(store, id).events.filter(e => e.kind === 'step-executed' && e.stepId === STEP)
    expect(succ).toHaveLength(1) // exactly one success audit
  })
})

// ── Gate adjudication integration (pipeline does NOT re-implement adjudicate) ──

describe('P3 gate integration — caller continues the gate after success', () => {
  it('after a successful execute the caller drives submitGateVerdict to adjudicate (pipeline stays out of it)', async () => {
    const [store, id] = started()
    const res = await runStep(store, id, STEP, { executor: () => ({ 'landscape-map': 1, 'gap-list': 2 }) })
    expect(res.ok).toBe(true)
    // upper layer continues the gate via the EXISTING submitGateVerdict (single-source adjudication)
    const status = submitGateVerdict(store, id, STEP, verdict('B', true))
    expect(status).toBe('passed')
    expect(getRunSnapshot(store, id).steps[STEP]?.status).toBe('passed')
  })

  it('exposes recordArtifact so a caller can write artifacts independently if needed', () => {
    // sanity: the reused write-boundary is the same symbol the pipeline relies on
    expect(typeof recordArtifact).toBe('function')
  })
})
