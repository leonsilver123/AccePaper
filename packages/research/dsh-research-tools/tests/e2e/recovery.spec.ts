/**
 * T19-A P4/P5 — E2E-2 Abstained / Failure / Recovery.
 *
 * One continuous 16-step run that recovers through THREE distinct fault modes, then reaches
 * E2-submit's human gate (gated). No production src is modified; the driver reuses the same
 * real core engine as the happy path.
 *
 *   Fault 1 — gate ABSTENTION at C2-trinity-loop (one component abstains):
 *     step → gated + holdReason='gate_abstained' + 'gate-abstention' audit; downstream (C3)
 *     canStart=false; attempt human approval → DSH_ABSTENTION_REQUIRES_ROLLBACK (refused);
 *     rollback → re-drive with passing verdicts → passed (recovered).
 *
 *   Fault 2 — EXECUTOR THROW at D2-framework (tool crash):
 *     step stays in_progress; NO artifact written; 'step-executed'(error) audit; rollback →
 *     re-drive → passed.
 *
 *   Fault 3 — EXECUTOR TIMEOUT at D3-writing (slow executor + small timeoutMs):
 *     pipeline records a deterministic 'timeout' (no hang); step in_progress & rollback-able;
 *     rollback → re-drive → passed.
 *
 * On success it writes `run-snapshot-recovery.json` + `e2e-report-recovery.md` and assembles
 * the combined `e2e-report.md`. On any assertion failure the test is red and NO report written.
 */

import { afterAll, describe, expect, it } from 'vitest'
import type { ResearchRunStore } from './helpers/imports.ts'
import {
  canStart,
  createHostApprovalChannel,
  createRun,
  getArtifact,
  getRunSnapshot,
  _resetApprovalChannelForTests,
  rollback,
  setRunInput,
  STEPS,
} from './helpers/imports.ts'
import { runStepWithGate } from './helpers/runner.ts'
import { passedVerdictFactory, abstainComponentFactory } from './fixtures/verdicts.ts'
import { throwingExecutor, slowExecutor } from './fixtures/executors.ts'
import {
  buildCombinedReport,
  collectRunReport,
  writeFragment,
  writeRunSnapshot,
} from './helpers/report.ts'

/** Drive a list of steps with all-pass verdicts (happy segment). */
async function driveHappy(
  store: ResearchRunStore,
  runId: string,
  stepIds: string[],
): Promise<void> {
  for (const id of stepIds) {
    const r = await runStepWithGate(store, runId, id, { verdictFactory: passedVerdictFactory() })
    expect(r.status, `happy segment step ${id} should pass`).toBe('passed')
  }
}

/** Assert a step has a single step-executed audit with the given terminal status. */
function assertStepExecuted(store: ResearchRunStore, runId: string, stepId: string, status: string): void {
  const ev = getRunSnapshot(store, runId).events.find(
    e => e.stepId === stepId && e.kind === 'step-executed',
  )
  expect(ev, `step ${stepId} missing step-executed`).toBeDefined()
  if (!ev) throw new Error(`step ${stepId} missing step-executed`)
  expect((ev.detail as { status: string }).status).toBe(status)
}

describe('E2E-2 Abstained / Failure / Recovery — recover through 3 faults to E2 human gate', () => {
  it('holds on abstention (human approval refused), then recovers from executor throw + timeout, ending gated at E2', async () => {
    _resetApprovalChannelForTests()
    const store: ResearchRunStore = new Map()
    const runId = createRun(store)
    setRunInput(store, runId, 'domain-direction', 'traffic signal control')

    // ── Happy preamble: A1 → C1 ──
    await driveHappy(store, runId, [
      'A1-landscape', 'A2-claim', 'A3-agenda', 'A4-venue',
      'B1-method', 'B2-data', 'B3-baseline', 'C1-mvp',
    ])

    // ── Fault 1: C2 abstention ──
    const c2 = await runStepWithGate(store, runId, 'C2-trinity-loop', {
      verdictFactory: abstainComponentFactory('B', 'citation evidence insufficient for external anchoring'),
    })
    expect(c2.status).toBe('gated')
    const c2Snap = getRunSnapshot(store, runId).steps['C2-trinity-loop']
    expect(c2Snap.status).toBe('gated')
    expect(c2Snap.holdReason).toBe('gate_abstained')
    // dedicated gate-abstention audit emitted, and NO step-completed audit
    const c2Events = getRunSnapshot(store, runId).events.filter(e => e.stepId === 'C2-trinity-loop')
    expect(c2Events.some(e => e.kind === 'gate-abstention')).toBe(true)
    expect(c2Events.some(e => e.kind === 'step-completed')).toBe(false)

    // downstream C3 cannot start (its input producer C2 is not 'passed')
    expect(canStart(store, runId, 'C3-boundary')).toBe(false)

    // human approval is REFUSED for an abstained hold
    const channel = createHostApprovalChannel('e2e-host-secret')
    channel.registerPrincipal('human1')
    const principal = channel.mintPrincipal(runId, 'C2-trinity-loop', 'human1', 'evt-abstain-1')
    expect(() => channel.submit(store, runId, 'C2-trinity-loop', 'approved', principal)).toThrow(
      /DSH_ABSTENTION_REQUIRES_ROLLBACK/,
    )
    // still held after the refused attempt
    expect(getRunSnapshot(store, runId).steps['C2-trinity-loop'].status).toBe('gated')

    // release via rollback → new attempt → re-adjudicate passed
    rollback(store, runId, 'C2-trinity-loop')
    expect(getRunSnapshot(store, runId).steps['C2-trinity-loop'].status).toBe('pending')
    expect(canStart(store, runId, 'C2-trinity-loop')).toBe(true)
    const c2b = await runStepWithGate(store, runId, 'C2-trinity-loop', {
      verdictFactory: passedVerdictFactory(),
    })
    expect(c2b.status).toBe('passed')

    // continue C3 → D1 happy
    await driveHappy(store, runId, ['C3-boundary', 'D1-figure-map'])

    // ── Fault 2: D2 executor throw ──
    const d2 = await runStepWithGate(store, runId, 'D2-framework', {
      executor: throwingExecutor('upstream model unavailable'),
    })
    expect(d2.status).toBe('in_progress')
    expect(d2.executeError).toMatch(/E2E-fixture-executor-failure/)
    // NO fake artifact: declared output 'paper-outline' was never written
    expect(getArtifact(store, runId, 'paper-outline')).toBeUndefined()
    assertStepExecuted(store, runId, 'D2-framework', 'error')
    // rollback-able, then re-drive success
    expect(getRunSnapshot(store, runId).steps['D2-framework'].status).toBe('in_progress')
    rollback(store, runId, 'D2-framework')
    const d2b = await runStepWithGate(store, runId, 'D2-framework', { verdictFactory: passedVerdictFactory() })
    expect(d2b.status).toBe('passed')

    // ── Fault 3: D3 executor timeout ──
    const d3 = await runStepWithGate(store, runId, 'D3-writing', {
      executor: slowExecutor(200),
      timeoutMs: 20,
    })
    expect(d3.status).toBe('in_progress') // never left in_progress, never hung
    expect(getArtifact(store, runId, 'draft')).toBeUndefined()
    assertStepExecuted(store, runId, 'D3-writing', 'timeout') // deterministic timeout, no hang
    rollback(store, runId, 'D3-writing')
    const d3b = await runStepWithGate(store, runId, 'D3-writing', { verdictFactory: passedVerdictFactory() })
    expect(d3b.status).toBe('passed')

    // ── Finish: D4, E1, E2 ──
    await driveHappy(store, runId, ['D4-rebuttal', 'E1-format'])
    const e2 = await runStepWithGate(store, runId, 'E2-submit')
    expect(e2.status).toBe('gated')

    // Final invariant: every step passed except E2 (human gate).
    const finalSnap = getRunSnapshot(store, runId)
    for (const s of STEPS) {
      const st = finalSnap.steps[s.id].status
      if (s.id === 'E2-submit') expect(st).toBe('gated')
      else expect(st, `step ${s.id} should be passed at end`).toBe('passed')
    }
    // E2 still not auto-approved
    expect(finalSnap.steps['E2-submit'].approval).toBeUndefined()

    // ── Success: emit reports (NOT on failure). ──
    const report = collectRunReport(store, runId, 'recovery')
    const jsonPath = writeRunSnapshot('recovery', report)
    const md = [
      `E2E-2 ran on run **${runId}**. Recovered through 3 faults and ended gated at E2-submit.`,
      '',
      '**Fault 1 — abstention:** C2-trinity-loop held at `gated` with `holdReason=gate_abstained` + `gate-abstention` audit; `canStart(C3)=false`; human approval via `HostApprovalChannel.submit` threw `DSH_ABSTENTION_REQUIRES_ROLLBACK`; released via `rollback()` → re-adjudicated `passed`.',
      '',
      '**Fault 2 — executor throw:** D2-framework stayed `in_progress`, NO artifact written, `step-executed`(`error`) audit; `rollback()` → re-drive `passed`.',
      '',
      '**Fault 3 — timeout:** D3-writing recorded a deterministic `step-executed`(`timeout`) with no hang; `rollback()` → re-drive `passed`.',
      '',
      `**Result:** 16 steps; 15 passed + E2 gated. Snapshot JSON: \`${jsonPath}\``,
    ].join('\n')
    writeFragment('recovery', md)
  })
})

// Assemble the single combined `e2e-report.md` once both fragments exist (happy-path.spec.ts
// writes its fragment first under normal collection order; this reads both fragments).
afterAll(() => {
  try {
    buildCombinedReport()
  } catch {
    /* report assembly is best-effort; the per-scenario JSON + fragments are the durable outputs */
  }
})
