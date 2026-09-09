/**
 * T19-A P4/P5 — E2E-1 Happy Path.
 *
 * First true end-to-end drive of all 16 steps (A1 → E2) through the real core engine:
 * startStep → runStep(execute) → submitGateVerdict/completeStep. Every gate component is
 * adjudicated by the REAL core `_adjudicate` (fed fixture verdicts that all pass). `D1-figure-map`
 * uses the REAL figure tool; the other 15 steps use deterministic fixtures. The chain stops at
 * E2-submit's human gate (no auto-approval). Finally, the run is driven TWICE and the two
 * snapshots are asserted byte-identical after timestamp stripping (deterministic chain).
 *
 * On success it writes `run-snapshot-happy-path.json` + `e2e-report-happy-path.md` under the
 * task-mandated e2e-out dir. On any assertion failure the test is red and NO report is written.
 */

import { describe, expect, it } from 'vitest'
import type { ResearchRunStore, StepStatus } from './helpers/imports.ts'
import {
  createRun,
  getArtifact,
  getRunSnapshot,
  setRunInput,
  lookupStep,
  STEPS,
} from './helpers/imports.ts'
import { driveAll, REAL_TOOL_STEP } from './helpers/runner.ts'
import { passedVerdictFactory } from './fixtures/verdicts.ts'
import {
  collectRunReport,
  stripForDeterminism,
  writeFragment,
  writeRunSnapshot,
} from './helpers/report.ts'

/** Run the full happy-path chain once on a fresh store; return (store, runId, results). */
async function runHappyOnce(): Promise<{
  store: ResearchRunStore
  runId: string
  results: Awaited<ReturnType<typeof driveAll>>
}> {
  const store: ResearchRunStore = new Map()
  const runId = createRun(store)
  setRunInput(store, runId, 'domain-direction', 'traffic signal control')
  const results = await driveAll(store, runId, { verdictFactory: passedVerdictFactory() })
  return { store, runId, results }
}

describe('E2E-1 Happy Path — 16 steps A1→E2, real figure tool on D1, stop at E2 human gate', () => {
  it('drives all 16 steps, each artifact traceable, ends gated at E2, and is deterministic across runs', async () => {
    const { store, runId, results } = await runHappyOnce()

    // 1) Exactly 16 step results, in canonical order.
    expect(results).toHaveLength(STEPS.length)
    expect(results.map(r => r.stepId)).toEqual(STEPS.map(s => s.id))

    // 2) Steps 1..15 all PASS; E2-submit stops at GATED (human gate, no auto-approval).
    const e2 = results[results.length - 1]
    for (const r of results.slice(0, 15)) {
      expect(r.status, `step ${r.stepId} should pass`).toBe('passed')
    }
    expect(e2.stepId).toBe('E2-submit')
    expect(e2.status).toBe('gated')

    // 3) E2 is a humanGate step and was NOT auto-approved: no approval record, isComplete false.
    const e2Snap = getRunSnapshot(store, runId).steps['E2-submit']
    expect(lookupStep('E2-submit')?.humanGate).toBe(true)
    expect(e2Snap.approval).toBeUndefined()
    // isComplete on a humanGate step requires an approved approval for the current attempt.
    const { isComplete } = await import('./helpers/imports.ts')
    expect(isComplete(store, runId, 'E2-submit')).toBe(false)

    // 4) D1 used the REAL figure tool; every other step used a fixture.
    const real = results.find(r => r.stepId === REAL_TOOL_STEP)
    expect(real?.usedRealTool).toBe(true)
    for (const r of results) {
      if (r.stepId === REAL_TOOL_STEP) continue
      expect(r.usedRealTool, `step ${r.stepId} should be a fixture`).toBe(false)
    }

    // 5) Artifact traceability: each executed step wrote EXACTLY its declared outputs.
    for (const step of STEPS) {
      const r = results.find(x => x.stepId === step.id)
      if (r && (r.status === 'passed' || r.status === 'gated')) {
        expect([...r.outputSlugs].sort()).toEqual([...step.outputs].sort())
      }
    }

    // 6) D1's figure-plan is genuinely produced by the real tool (byte-valid SVG+PNG provenance).
    const figurePlanRaw = getArtifact(store, runId, 'figure-plan')
    const figurePlan = figurePlanRaw as
      | { source: string; svgByteLength: number; pngByteLength: number }
      | undefined
    expect(figurePlan).toBeDefined()
    expect(figurePlan?.source).toBe('REAL-figure-tool')
    expect(figurePlan?.svgByteLength).toBeGreaterThan(0)
    expect(figurePlan?.pngByteLength).toBeGreaterThan(0)

    // 7) Every step has a 'step-executed' audit with status 'success' and matching output slugs,
    //    plus a terminal 'step-completed' audit (status 'passed', or 'gated' for E2).
    const snap = getRunSnapshot(store, runId)
    for (const step of STEPS) {
      const events = snap.events.filter(e => e.stepId === step.id)
      const executed = events.find(e => e.kind === 'step-executed')
      if (!executed) throw new Error(`step ${step.id} missing step-executed`)
      const rec = executed.detail as { status: string; outputSlugs: string[] }
      expect(rec.status).toBe('success')
      expect([...rec.outputSlugs].sort()).toEqual([...step.outputs].sort())
      const completed = events.find(e => e.kind === 'step-completed')
      if (!completed) throw new Error(`step ${step.id} missing step-completed`)
      const cs = (completed.detail as { status: StepStatus }).status
      expect(cs === 'passed' || cs === 'gated').toBe(true)
    }

    // 8) No dead steps: every step is either passed or (for E2) gated.
    for (const r of results) {
      expect(['passed', 'gated']).toContain(r.status)
    }

    // 9) Determinism: a second identical run yields a byte-identical snapshot after stripping
    //    timestamp/id fields (the chain is fully deterministic).
    const { store: store2, runId: runId2 } = await runHappyOnce()
    const report1 = collectRunReport(store, runId, 'happy-path')
    const report2 = collectRunReport(store2, runId2, 'happy-path')
    const a = JSON.stringify(stripForDeterminism(report1))
    const b = JSON.stringify(stripForDeterminism(report2))
    expect(a).toEqual(b)

    // ── Success: emit reports (NOT on failure). ──
    const scenarioPath = writeRunSnapshot('happy-path', report1)
    const md = [
      `E2E-1 ran on run **${runId}**. All 16 steps executed; steps A1–D4 passed, E2-submit stopped at **gated** (human gate, no auto-approval).`,
      '',
      `**Real tool:** \`D1-figure-map\` → \`renderFigure\` produced a REAL SVG+PNG; \`figure-plan.source === 'REAL-figure-tool'\`, svg ${figurePlan?.svgByteLength}B / png ${figurePlan?.pngByteLength}B.`,
      '',
      '**Determinism:** a second run produced a byte-identical snapshot after timestamp stripping.',
      '',
      '**Result counts:** 16 steps; 15 passed + 1 gated; 1 real-tool step + 15 fixture steps.',
      '',
      `Snapshot JSON: \`${scenarioPath}\``,
    ].join('\n')
    writeFragment('happy-path', md)
  })
})
