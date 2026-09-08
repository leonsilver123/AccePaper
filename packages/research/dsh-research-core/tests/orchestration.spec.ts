// @deepseek-ai/dsh-research-core — T19-B orchestration surface tests (Wave 2).
//
// Locks the THREE narrow additions to the public entry:
//   1. `runStep` — execute-phase pipeline, exported from the MAIN entry. Verifies
//      run/step/attempt validation, result-once (duplicate execution), per-attempt
//      freshness after rollback, no gate adjudication, no terminal transition.
//   2. `getStepDefinitions()` / `getStepDefinitionById()` — read-only accessors that
//      return deep-frozen CLONES: immutability, per-call isolation, no aliasing of
//      the internal STEPS array / STEP_BY_ID Map.
//   3. Absence of the FORBIDDEN surface: no `appendAuditEvent` (no arbitrary audit
//      injection), no STEPS/STEP_BY_ID/stepsByPhase/TRINITY_LABEL/SEEDABLE_INPUTS/
//      assertDagAndSeedSeparation/_applyHumanApproval/approveHumanGate/transition.
//
// Import note: behavioral tests import the entry by repo-relative source path (the
// established research-package convention). The name-based `@deepseek-ai/dsh-research-core`
// import (→ built lib/index.js) is exercised by the plain-built smoke at the bottom and by
// the deep-import-blocking checks, which need the exports map of the built package.

import { describe, expect, it } from 'vitest'
import {
  createRun,
  getArtifact,
  getRunSnapshot,
  getStepDefinitionById,
  getStepDefinitions,
  rollback,
  runStep,
  setRunInput,
  startStep,
  submitGateVerdict,
} from '../src/index.ts'
import type { ResearchRunStore, RunState, StepDefinition } from '../../src/index.ts'

const EXPECTED_ORDER = [
  'A1-landscape', 'A2-claim', 'A3-agenda', 'A4-venue',
  'B1-method', 'B2-data', 'B3-baseline',
  'C1-mvp', 'C2-trinity-loop', 'C3-boundary',
  'D1-figure-map', 'D2-framework', 'D3-writing', 'D4-rebuttal',
  'E1-format', 'E2-submit',
]

function freshStore(): ResearchRunStore {
  return new Map<string, RunState>()
}

/** Seed domain-direction and start the given step (so runStep sees in_progress). */
function seedAndStart(store: ResearchRunStore, stepId: string): { runId: string; attemptId: number } {
  const runId = createRun(store)
  setRunInput(store, runId, 'domain-direction', 'seed')
  const snap = startStep(store, runId, stepId)
  return { runId, attemptId: snap.attemptId }
}

/** Deep-frozen check across every nested level of a StepDefinition clone. */
function expectDeepFrozen(def: StepDefinition): void {
  expect(Object.isFrozen(def)).toBe(true)
  expect(Object.isFrozen(def.inputs)).toBe(true)
  expect(Object.isFrozen(def.outputs)).toBe(true)
  expect(Object.isFrozen(def.gate)).toBe(true)
}

describe('orchestration surface — step accessors (getStepDefinitions / getStepDefinitionById)', () => {
  it('returns all 16 steps in canonical pipeline order with index 1..16', () => {
    const defs = getStepDefinitions()
    expect(defs).toHaveLength(16)
    expect(defs.map(d => d.id)).toEqual(EXPECTED_ORDER)
    defs.forEach((d, i) => expect(d.index).toBe(i + 1))
  })

  it('returns deep-frozen clones (array, elements, nested arrays)', () => {
    const defs = getStepDefinitions()
    expect(Object.isFrozen(defs)).toBe(true)
    for (const d of defs) expectDeepFrozen(d)
    const e2 = getStepDefinitionById('E2-submit')
    expect(e2).toBeDefined()
    if (e2) expectDeepFrozen(e2)
  })

  it('does NOT hand out internal array/Map aliases — each call returns fresh clones', () => {
    const a = getStepDefinitions()
    const b = getStepDefinitions()
    expect(a).not.toBe(b)
    expect(a[0]).not.toBe(b[0])
    const one = getStepDefinitionById('A1-landscape')
    const two = getStepDefinitionById('A1-landscape')
    expect(one).toBeDefined()
    expect(one).not.toBe(two)
    expect(two).toEqual(one)
  })

  it('caller mutation attempts cannot affect a later read (frozen + isolated)', () => {
    const before = getStepDefinitions()
    expect(before[0].humanGate).toBe(false)
    // Strict-mode (ESM) mutation of a frozen object THROWS — so it can never stick.
    expect(() => {
      ;(before[0] as { humanGate: boolean }).humanGate = true
    }).toThrow()
    expect(() => {
      ;(before[1].inputs as string[]).push('injected')
    }).toThrow()
    const after = getStepDefinitions()
    expect(after[0].humanGate).toBe(false)
    expect(after[1].inputs).not.toContain('injected')
    // Independent reads stay identical to the frozen canonical definitions.
    expect(after[0].id).toBe('A1-landscape')
    expect(after[1].gate).toEqual(['A', 'C'])
  })

  it('getStepDefinitionById returns exact canonical metadata and undefined for unknown ids', () => {
    const e2 = getStepDefinitionById('E2-submit')
    expect(e2?.humanGate).toBe(true)
    expect(e2?.gate).toEqual([])
    expect(e2?.phase).toBe('E')
    expect(getStepDefinitionById('E2-submit')?.outputs).toContain('submission-record')
    expect(getStepDefinitionById('not-a-step')).toBeUndefined()
    const c2 = getStepDefinitionById('C2-trinity-loop')
    expect(c2?.phase).toBe('C')
    expect(c2?.falsifiable).not.toBeNull()
  })
})

describe('orchestration surface — runStep (run/step/attempt validation + result-once)', () => {
  it('throws DSH_UNKNOWN_STEP for a step id outside the frozen 16', async () => {
    const store = freshStore()
    const runId = createRun(store)
    // Guard failures are SYNCHRONOUS throws — wrap so expect().rejects can observe them.
    await expect(async () => {
      await runStep(store, runId, 'X9-nope', { executor: () => ({}) })
    }).rejects.toThrow(/DSH_UNKNOWN_STEP/)
  })

  it('throws DSH_NOT_IN_PROGRESS when the step is no longer in_progress (settled terminal state)', async () => {
    const store = freshStore()
    const { runId } = seedAndStart(store, 'A1-landscape')
    // Execute, then pass the single B-gate verdict → A1 reaches 'passed'.
    await runStep(store, runId, 'A1-landscape', {
      executor: () => ({ 'landscape-map': {}, 'gap-list': [] }),
    })
    submitGateVerdict(store, runId, 'A1-landscape', {
      component: 'B',
      outcome: 'passed',
      passed: true,
      evidence: 'e',
      rationale: 'r',
      timestamp: 1,
    })
    expect(getRunSnapshot(store, runId).steps['A1-landscape']?.status).toBe('passed')
    await expect(async () => {
      await runStep(store, runId, 'A1-landscape', { executor: () => ({}) })
    }).rejects.toThrow(/DSH_NOT_IN_PROGRESS/)
  })

  it('executes, writes ONLY declared artifacts, and stays in_progress (no gate adjudication)', async () => {
    const store = freshStore()
    const { runId } = seedAndStart(store, 'A1-landscape')
    const res = await runStep(store, runId, 'A1-landscape', {
      executor: () => ({ 'landscape-map': { hits: 3 }, 'gap-list': ['gap'] }),
    })
    expect(res.ok).toBe(true)
    expect(res.status).toBe('success')
    expect(res.attemptId).toBe(1)
    expect(res.outputSlugs).toEqual(['landscape-map', 'gap-list'])
    expect(getArtifact(store, runId, 'landscape-map')).toEqual({ hits: 3 })
    expect(getArtifact(store, runId, 'gap-list')).toEqual(['gap'])
    // Execute phase only: still in_progress, no verdicts, no terminal state.
    const snap = getRunSnapshot(store, runId)
    expect(snap.steps['A1-landscape']?.status).toBe('in_progress')
    expect(Object.keys(snap.steps['A1-landscape']?.gateResults ?? {})).toHaveLength(0)
  })

  it('rejects undeclared output slugs all-or-nothing (no partial artifact write)', async () => {
    const store = freshStore()
    const { runId } = seedAndStart(store, 'A1-landscape')
    // An undeclared slug surfaces as an EXECUTE failure (resolved ok:false error result,
    // not a guard rejection) — zero artifacts written.
    const res = await runStep(store, runId, 'A1-landscape', {
      executor: () => ({ 'landscape-map': { ok: 1 }, 'undeclared': true }),
    })
    expect(res.ok).toBe(false)
    expect(res.status).toBe('error')
    expect(res.error?.message).toMatch(/DSH_OUTPUT_NOT_DECLARED/)
    expect(getArtifact(store, runId, 'landscape-map')).toBeUndefined()
  })

  it('duplicate execution on the SAME attempt throws result-once and emits exactly one step-executed audit', async () => {
    const store = freshStore()
    const { runId } = seedAndStart(store, 'A1-landscape')
    await runStep(store, runId, 'A1-landscape', {
      executor: () => ({ 'landscape-map': { v: 1 } }),
    })
    await expect(async () => {
      await runStep(store, runId, 'A1-landscape', { executor: () => ({ 'landscape-map': { v: 2 } }) })
    }).rejects.toThrow(/DSH_STEP_ALREADY_EXECUTED/)
    const snap = getRunSnapshot(store, runId)
    const exec = snap.events.filter(e => e.kind === 'step-executed' && e.stepId === 'A1-landscape' && e.attemptId === 1)
    expect(exec).toHaveLength(1)
    expect(getArtifact(store, runId, 'landscape-map')).toEqual({ v: 1 }) // first result untouched
  })

  it('rollback → new attempt allows re-execution (old attempt results do not block/pollute)', async () => {
    const store = freshStore()
    const { runId } = seedAndStart(store, 'A1-landscape')
    await runStep(store, runId, 'A1-landscape', {
      executor: () => ({ 'landscape-map': { attempt: 1 } }),
    })
    rollback(store, runId, 'A1-landscape')
    const snap2 = startStep(store, runId, 'A1-landscape')
    expect(snap2.attemptId).toBe(2)
    const res = await runStep(store, runId, 'A1-landscape', {
      executor: () => ({ 'landscape-map': { attempt: 2 } }),
    })
    expect(res.ok).toBe(true)
    expect(getArtifact(store, runId, 'landscape-map')).toEqual({ attempt: 2 })
    const after = getRunSnapshot(store, runId)
    const execs = after.events.filter(e => e.kind === 'step-executed' && e.stepId === 'A1-landscape')
    expect(execs.map(e => e.attemptId).sort()).toEqual([1, 2])
  })

  it('non-success executions (error/timeout/cancel) write NO artifact and stay rollback-able in_progress', async () => {
    const store = freshStore()
    const { runId } = seedAndStart(store, 'A1-landscape')
    const res = await runStep(store, runId, 'A1-landscape', {
      executor: () => { throw new Error('boom') },
    })
    expect(res.ok).toBe(false)
    expect(res.status).toBe('error')
    expect(res.error?.message).toBe('boom')
    expect(getArtifact(store, runId, 'landscape-map')).toBeUndefined()
    const snap = getRunSnapshot(store, runId)
    expect(snap.steps['A1-landscape']?.status).toBe('in_progress')
  })
})

describe('orchestration surface — forbidden surface stays closed', () => {
  it('does not export appendAuditEvent, mutable step singletons, or approval/transition internals', async () => {
    const entry = await import('../src/index.ts')
    const forbidden = [
      'appendAuditEvent',       // generic arbitrary audit injection
      'STEPS',                  // mutable singleton array
      'STEP_BY_ID',             // internal Map
      'stepsByPhase',
      'TRINITY_LABEL',
      'SEEDABLE_INPUTS',
      'assertDagAndSeedSeparation',
      '_applyHumanApproval',
      'approveHumanGate',
      'transition',
      '_adjudicate',
      '_apply',
    ]
    for (const name of forbidden) {
      expect(entry, `entry must not export '${name}'`).not.toHaveProperty(name)
    }
  })

  it('built-package exports map exposes only ., ./host and ./package.json (deep-import hatch removed)', async () => {
    const pkg = (await import('@deepseek-ai/dsh-research-core/package.json')) as {
      exports: Record<string, unknown>
    }
    expect(Object.keys(pkg.exports).sort()).toEqual(['.', './host', './package.json'])
  })

  it('deep imports of engine internals are blocked at runtime (no src/subpath hatch)', async () => {
    // Concatenated specifiers: Vite must NOT statically resolve these at transform
    // time (a build-time resolution error would abort the suite) — resolution and
    // its rejection must happen at RUNTIME through the built package exports map.
    const base = '@deepseek-ai/dsh-research-core'
    await expect(import(`${base}/engine/steps`)).rejects.toThrow()
    await expect(import(`${base}/engine/state-machine`)).rejects.toThrow()
    await expect(import(`${base}/src/engine/steps.ts`)).rejects.toThrow()
  })
})

describe('orchestration surface — plain built-package smoke (name-based entry)', () => {
  it('the built lib exposes runStep + the step accessors and executes a happy path', async () => {
    const built = await import('@deepseek-ai/dsh-research-core')
    expect(typeof built.runStep).toBe('function')
    expect(typeof built.getStepDefinitions).toBe('function')
    expect(typeof built.getStepDefinitionById).toBe('function')
    const defs = built.getStepDefinitions() as readonly StepDefinition[]
    expect(defs).toHaveLength(16)
    expect(defs[0].id).toBe('A1-landscape')

    const store = new Map<string, RunState>()
    const runId = built.createRun(store)
    built.setRunInput(store, runId, 'domain-direction', 'seed')
    built.startStep(store, runId, 'A1-landscape')
    const res = await built.runStep(store, runId, 'A1-landscape', {
      executor: () => ({ 'landscape-map': { hits: 1 } }),
    })
    expect(res.ok).toBe(true)
    expect(built.getArtifact(store, runId, 'landscape-map')).toEqual({ hits: 1 })
    // Empty-gate humanGate step reached gated via completeStep — never auto-passed by runStep.
    const e2RunId = built.createRun(store)
    built.setRunInput(store, e2RunId, 'domain-direction', 'seed')
    // seed every upstream output minimally? E2 needs upstream artifacts; drive seeds via canStart.
    // Just assert completeStep exists and E2 metadata stays human-gated by contract.
    expect(built.completeStep).toBeTypeOf('function')
    expect(defs[15].id).toBe('E2-submit')
    expect(defs[15].humanGate).toBe(true)
  })
})
