// @deepseek-ai/dsh-research-team — T19-B recovery / fault-injection E2E.
//
// Proves that adding real tool executors did NOT weaken any core guarantee. Each
// scenario injects a fault through the T19-B driver and asserts the CORE contract
// holds, then recovers and drives the pipeline to the E2-submit human gate:
//
//   1. gate abstention           → step held `gated` (holdReason='gate_abstained');
//                                  in-place re-submit REJECTED; only rollback +
//                                  a new attempt with better evidence releases it
//   2. executor throws           → step stays `in_progress`, ZERO artifacts
//   3. executor timeout          → deterministic `timeout`, ZERO artifacts, no hang
//   4. undeclared output slug    → all-or-nothing write boundary, ZERO artifacts
//   5. stale / duplicate execute → the result lands exactly once
//   6. duplicate completion      → rejected (E2 cannot be completed twice)
//   7. rollback cascade          → downstream artifacts invalidated
//   8. recovered run             → E2-submit still ends `gated`, never approved
//
// Nothing here bypasses a gate, coerces an outcome, or approves E2.

import { describe, expect, it } from 'vitest'
import {
  completeStep,
  createRun,
  getArtifact,
  getAuditHistory,
  getRunSnapshot,
  rollback,
  setRunInput,
  startStep,
  submitGateVerdict,
} from '@deepseek-ai/dsh-research-core'
import type { ResearchRunStore } from '@deepseek-ai/dsh-research-core'

import { createRunContext, driveRemaining, driveStep, runT19B } from '../../src/runner/drive.ts'
import type { RunContext } from '../../src/runner/registry.ts'
import { writeRunReport } from '../../src/runner/report.ts'
import { buildStepVerdicts } from '../../src/runner/verdict.ts'

const DOMAIN = 'adaptive traffic signal control research program'

function freshStore(): { store: ResearchRunStore; runId: string; runCtx: RunContext } {
  const store: ResearchRunStore = new Map()
  const runId = createRun(store)
  setRunInput(store, runId, 'domain-direction', DOMAIN)
  return { store, runId, runCtx: createRunContext() }
}

const throwingExecutor = (): Record<string, unknown> => {
  throw new Error('injected executor failure (T19-B recovery scenario)')
}

const slowExecutor = async (): Promise<Record<string, unknown>> => {
  await new Promise(r => setTimeout(r, 200))
  return {}
}

const undeclaredSlugExecutor = (): Record<string, unknown> => ({
  'landscape-map': { ok: true },
  'not-a-declared-slug': { smuggled: true },
})

describe('T19-B recovery — gate abstention holds the step (no default pass)', () => {
  it('holds A1-landscape at `gated` with holdReason=gate_abstained when B abstains', async () => {
    const { store, runId, runCtx } = freshStore()
    const outcome = await driveStep(store, runId, 'A1-landscape', {
      runCtx,
      abstainComponents: id => (id === 'A1-landscape' ? ['B'] : []),
    })
    expect(outcome.verdicts.B).toBe('abstained')
    expect(outcome.status).toBe('gated')
    const snap = getRunSnapshot(store, runId)
    expect(snap.steps['A1-landscape']?.status).toBe('gated')
    expect(snap.steps['A1-landscape']?.holdReason).toBe('gate_abstained')
    expect(snap.events.some(e => e.kind === 'gate-abstention')).toBe(true)
    // The abstention came from the REAL core B gate refusing to anchor, not from a flag.
    const evidence = String(snap.steps['A1-landscape']?.gateResults.B?.evidence)
    expect(evidence).toContain('anchoring=false')
    expect(evidence).toContain('fail-closed')
  })

  it('rejects an in-place re-submit of the same component on a held step', async () => {
    const { store, runId, runCtx } = freshStore()
    await driveStep(store, runId, 'A1-landscape', {
      runCtx,
      abstainComponents: () => ['B'],
    })
    const stepDef = { id: 'A1-landscape', gate: ['B'] as const }
    const better = buildStepVerdicts({
      step: getRunSnapshot(store, runId).steps['A1-landscape'] === undefined
        ? (undefined as never)
        : ({ ...stepDef, gate: ['B'], humanGate: false } as never),
      attemptId: 1,
      runCtx,
      abstain: new Set(),
    })
    expect(better.length).toBe(1)
    expect(() => submitGateVerdict(store, runId, 'A1-landscape', better[0])).toThrow(
      /DSH_VERDICT_ALREADY_SET|DSH_VERDICT_BAD_STATUS|not 'in_progress'|status/i,
    )
    // Still held — the runner never coerced abstained into passed.
    expect(getRunSnapshot(store, runId).steps['A1-landscape']?.status).toBe('gated')
  })

  it('releases the hold ONLY through rollback + a new attempt with better evidence', async () => {
    const { store, runId, runCtx } = freshStore()
    const held = await driveStep(store, runId, 'A1-landscape', {
      runCtx,
      abstainComponents: () => ['B'],
    })
    expect(held.attemptId).toBe(1)

    rollback(store, runId, 'A1-landscape')
    const afterRollback = getRunSnapshot(store, runId)
    expect(afterRollback.steps['A1-landscape']?.status).toBe('pending')
    expect(afterRollback.steps['A1-landscape']?.holdReason).toBeUndefined()
    expect(afterRollback.events.some(e => e.kind === 'rollback')).toBe(true)

    // New attempt WITH the anchoring evidence present → the real B gate passes.
    const retried = await driveStep(store, runId, 'A1-landscape', { runCtx })
    expect(retried.attemptId).toBe(2)
    expect(retried.verdicts.B).toBe('passed')
    expect(retried.status).toBe('passed')
    const history = getAuditHistory(store, runId, 'A1-landscape')
    expect(history.length).toBe(2)
  })
})

describe('T19-B recovery — execute-phase faults leave no artifact', () => {
  it('an executor throw leaves the step in_progress with ZERO artifacts', async () => {
    const { store, runId, runCtx } = freshStore()
    const outcome = await driveStep(store, runId, 'A1-landscape', {
      runCtx,
      executorOverride: id => (id === 'A1-landscape' ? throwingExecutor : undefined),
    })
    expect(outcome.executeStatus).toBe('error')
    expect(outcome.status).toBe('in_progress')
    expect(outcome.executeError).toContain('injected executor failure')
    expect(outcome.artifacts).toEqual([])
    const snap = getRunSnapshot(store, runId)
    expect(snap.steps['A1-landscape']?.status).toBe('in_progress')
    expect(Object.keys(snap.steps['A1-landscape']?.artifacts ?? {})).toEqual([])
    expect(snap.registry['landscape-map']).toBeUndefined()
    // core getArtifact returns `undefined` (not null) when an artifact is absent.
    expect(getArtifact(store, runId, 'landscape-map')).toBeUndefined()
    expect(Object.keys(snap.steps['A1-landscape']?.gateResults ?? {})).toEqual([])
  })

  it('a slow executor times out deterministically with ZERO artifacts (no hang)', async () => {
    const { store, runId, runCtx } = freshStore()
    const outcome = await driveStep(store, runId, 'A1-landscape', {
      runCtx,
      timeoutMs: 5,
      executorOverride: () => slowExecutor,
    })
    expect(outcome.executeStatus).toBe('timeout')
    expect(outcome.status).toBe('in_progress')
    const snap = getRunSnapshot(store, runId)
    expect(snap.registry['landscape-map']).toBeUndefined()
    expect(Object.keys(snap.steps['A1-landscape']?.gateResults ?? {})).toEqual([])
  })

  it('an undeclared output slug is rejected all-or-nothing (declared slug NOT written)', async () => {
    const { store, runId, runCtx } = freshStore()
    const outcome = await driveStep(store, runId, 'A1-landscape', {
      runCtx,
      executorOverride: () => undeclaredSlugExecutor,
    })
    expect(outcome.executeStatus).toBe('error')
    expect(outcome.executeError).toContain('not-a-declared-slug')
    const snap = getRunSnapshot(store, runId)
    // The legitimate slug from the SAME return value must also be absent.
    expect(snap.registry['landscape-map']).toBeUndefined()
    expect(snap.registry['not-a-declared-slug']).toBeUndefined()
    expect(Object.keys(snap.steps['A1-landscape']?.artifacts ?? {})).toEqual([])
  })

  it('recovers a failed step through rollback + a clean new attempt', async () => {
    const { store, runId, runCtx } = freshStore()
    await driveStep(store, runId, 'A1-landscape', {
      runCtx,
      executorOverride: () => throwingExecutor,
    })
    rollback(store, runId, 'A1-landscape')
    const retried = await driveStep(store, runId, 'A1-landscape', { runCtx })
    expect(retried.executeStatus).toBe('success')
    expect(retried.status).toBe('passed')
    expect(retried.attemptId).toBe(2)
    // The real tool ran on the recovery attempt — provable from the artifact.
    const value = getArtifact(store, runId, 'landscape-map') as Record<string, unknown>
    expect(String(value.__producer)).toContain('literature-search@')
    expect(value.__kind).toBe('real_tool_fixture_input')
  })
})

describe('T19-B recovery — replay / duplicate protection', () => {
  it('refuses to drive a step whose dependencies are not satisfied', async () => {
    const { store, runId, runCtx } = freshStore()
    await expect(driveStep(store, runId, 'A2-claim', { runCtx })).rejects.toThrow(
      /dependency order violated/i,
    )
  })

  it('refuses to re-drive an already-passed step (result lands exactly once)', async () => {
    const { store, runId, runCtx } = freshStore()
    await driveStep(store, runId, 'A1-landscape', { runCtx })
    await expect(driveStep(store, runId, 'A1-landscape', { runCtx })).rejects.toThrow(
      /dependency order violated|cannot start/i,
    )
    expect(getAuditHistory(store, runId, 'A1-landscape').length).toBe(1)
  })

  it('rejects a duplicate completion of the E2-submit human gate', async () => {
    const { store } = freshStore()
    const run = await runT19B(store)
    expect(run.steps[run.steps.length - 1]?.status).toBe('gated')
    // Already gated: completeStep requires 'in_progress'.
    expect(() => completeStep(store, run.runId, 'E2-submit')).toThrow(/DSH_COMPLETE_BAD_STATUS|in_progress/i)
    expect(getRunSnapshot(store, run.runId).steps['E2-submit']?.status).toBe('gated')
  })

  it('rejects starting a step that is already in progress', async () => {
    const { store, runId, runCtx } = freshStore()
    await driveStep(store, runId, 'A1-landscape', {
      runCtx,
      executorOverride: () => throwingExecutor,
    })
    // Still in_progress after the failure — a second start is an illegal transition.
    expect(() => startStep(store, runId, 'A1-landscape')).toThrow()
  })
})

describe('T19-B recovery — rollback cascades to downstream artifacts', () => {
  it('invalidates downstream artifacts when an upstream step is rolled back', async () => {
    const { store } = freshStore()
    const run = await runT19B(store, { stopBefore: 'B1-method' })
    expect(run.steps.map(s => s.stepId)).toEqual([
      'A1-landscape',
      'A2-claim',
      'A3-agenda',
      'A4-venue',
    ])
    expect(getArtifact(store, run.runId, 'claim')).not.toBeUndefined()
    expect(getArtifact(store, run.runId, 'agenda')).not.toBeUndefined()

    rollback(store, run.runId, 'A2-claim')
    const snap = getRunSnapshot(store, run.runId)
    expect(snap.steps['A2-claim']?.status).toBe('pending')
    // A3/A4 depend (transitively) on `claim` → invalidated by the cascade.
    expect(snap.steps['A3-agenda']?.status).toBe('pending')
    expect(snap.steps['A4-venue']?.status).toBe('pending')
    // core getArtifact returns `undefined` (not null) once the cascade deleted them.
    expect(getArtifact(store, run.runId, 'claim')).toBeUndefined()
    expect(getArtifact(store, run.runId, 'agenda')).toBeUndefined()
    // A1 is upstream of the rollback point and survives.
    expect(snap.steps['A1-landscape']?.status).toBe('passed')
    expect(getArtifact(store, run.runId, 'landscape-map')).not.toBeNull()
  })
})

describe('T19-B recovery — the recovered run still reaches the E2 human gate', () => {
  it('faults on A1 + C2, recovers each, and ends at E2-submit `gated`', async () => {
    const { store, runId, runCtx } = freshStore()

    // Fault 1: A1 executor throws → rollback → clean retry.
    const failed = await driveStep(store, runId, 'A1-landscape', {
      runCtx,
      executorOverride: () => throwingExecutor,
    })
    expect(failed.executeStatus).toBe('error')
    rollback(store, runId, 'A1-landscape')
    const a1 = await driveStep(store, runId, 'A1-landscape', { runCtx })
    expect(a1.status).toBe('passed')

    // Drive up to the trinity loop.
    const upTo = await driveRemaining(store, runId, runCtx, 'A2-claim')
    const beforeC2 = upTo.steps.findIndex(s => s.stepId === 'C2-trinity-loop')
    expect(beforeC2).toBeGreaterThan(-1)

    // C2 already passed in that sweep; roll it back and re-run with an A abstention.
    rollback(store, runId, 'C2-trinity-loop')
    const abstained = await driveStep(store, runId, 'C2-trinity-loop', {
      runCtx,
      abstainComponents: id => (id === 'C2-trinity-loop' ? ['A'] : []),
    })
    expect(abstained.verdicts.A).toBe('abstained')
    expect(abstained.status).toBe('gated')
    expect(getRunSnapshot(store, runId).steps['C2-trinity-loop']?.holdReason).toBe('gate_abstained')

    // Fault 2 recovery: rollback → new attempt with converged evidence.
    rollback(store, runId, 'C2-trinity-loop')
    const rest = await driveRemaining(store, runId, runCtx, 'C2-trinity-loop')
    const c2 = rest.steps.find(s => s.stepId === 'C2-trinity-loop')
    expect(c2?.verdicts).toEqual({ A: 'passed', B: 'passed', C: 'passed' })

    const e2 = rest.steps[rest.steps.length - 1]
    expect(e2?.stepId).toBe('E2-submit')
    expect(e2?.status).toBe('gated')
    expect(e2?.kind).toBe('humanGate')

    const snap = getRunSnapshot(store, runId)
    expect(snap.steps['E2-submit']?.approval).toBeUndefined()
    expect(snap.events.some(e => e.kind === 'human-approval')).toBe(false)
    // At least the 3 explicit rollbacks (A1, C2, C2) appear; core also cascades a
    // `rollback` audit event to each transitive downstream dependent, so the total
    // can exceed 3. We assert the contract (a rollback happened) without over-counting.
    expect(snap.events.filter(e => e.kind === 'rollback').length).toBeGreaterThanOrEqual(3)

    // Report the recovery run for audit.
    const allSteps = [a1, ...upTo.steps.filter(s => s.stepId !== 'C2-trinity-loop'), ...rest.steps]
    const { jsonPath, mdPath, jsonContent, mdContent } = writeRunReport(
      { runId, steps: allSteps },
      'recovery',
      undefined,
      {
        auditTimeline: snap.events,
        artifactManifest: snap.registry,
        faultsInjected: [
          'A1-landscape executor throw → rollback → clean retry',
          'C2-trinity-loop A-channel abstention → rollback → re-evidence',
        ],
        gateHistory: Object.fromEntries(
          Object.entries(snap.steps).map(([id, s]) => [
            id,
            { status: s.status, holdReason: s.holdReason ?? null, attempts: s.attempts },
          ]),
        ),
      },
    )
    // The writers returned non-empty content + paths, proving the report files were produced.
    expect(typeof jsonPath).toBe('string')
    expect(typeof mdPath).toBe('string')
    expect(jsonContent.length).toBeGreaterThan(0)
    expect(mdContent.length).toBeGreaterThan(0)
  })
})
