/**
 * Where a resumed run picks up from.
 *
 * `firstNonTerminalStep` had no test file and regressed silently twice — both times found by an
 * outside auditor rather than by this suite. It lives in its own module precisely so this file can
 * exist, and every case below drives a REAL run rather than a hand-built step table.
 *
 * Its two failure modes:
 *   - a held abstention was treated as settled, so a run that stopped honestly reported "every step
 *     is terminal" while fourteen of them had no recorded state at all;
 *   - the SELECTOR and the RELEASE condition disagreed, so a `gated` step could be chosen as the
 *     resume point and then refused by `startStep`, surfacing as "dependency order violated".
 *
 * The two configurations differ in where they stop, and both are real: with the shipped Case Pack
 * the C gate holds at A2 (the claim declares no metric); with the pipeline's own seeds it runs to
 * E2 and stops at the human gate.
 */

import { describe, expect, it } from 'vitest'
import { getRunSnapshot, getStepDefinitions } from '@deepseek-ai/dsh-research-core'
import type { ResearchRunStore, RestoredRun } from '@deepseek-ai/dsh-research-core'
import { firstNonTerminalStep } from '../src/runner/resume.ts'
import { runT19B } from '../src/runner/drive.ts'
import { loadCasePack, planCasePackInputs } from '../src/runner/case-pack.ts'

/** A `RestoredRun` over a real store; only the fields the selector reads carry meaning here. */
function restored(store: ResearchRunStore, runId: string): RestoredRun {
  return {
    store,
    runId,
    revision: 1,
    savedAtIso: '',
    capability: undefined,
    consumedApprovalEventIds: [],
    interrupted: [],
  }
}

/** The shipped Case Pack's inputs, which is what makes the C gate hold at A2. */
function shippedPackInputs(): ReturnType<typeof planCasePackInputs> {
  return planCasePackInputs(loadCasePack('plan/overnight/2026-09-09/case-pack-traffic'))
}

describe('firstNonTerminalStep', () => {
  it('picks the HELD step of the shipped configuration instead of declaring the run done', async () => {
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, {
      casePackInputs: shippedPackInputs(),
    })
    const state = getRunSnapshot(store, run.runId).steps

    // The premise: this run stopped on a HOLD at a non-humanGate step, and most steps have no
    // record at all — which is exactly the state the old selector described as "every step is
    // terminal".
    expect(state['A2-claim']?.status).toBe('gated')
    expect(getStepDefinitions().filter(s => s.humanGate).map(s => s.id)).toEqual(['E2-submit'])
    expect(Object.keys(state).length).toBeLessThan(getStepDefinitions().length)

    expect(firstNonTerminalStep(restored(store, run.runId))).toBe('A2-claim')
  })

  it('picks that step even when the snapshot carries no holdReason for it', async () => {
    // The selector/release disagreement: the persistence boundary accepts a `gated` step whose
    // `holdReason` is absent, so the old pair — one keyed on the status, the other on the reason —
    // coincided only on the states core happens to write.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { casePackInputs: shippedPackInputs() })
    const internal = (store as unknown as Map<string, {
      steps: Map<string, { status: string; holdReason?: string }>
    }>).get(run.runId)
    const held = internal?.steps.get('A2-claim')
    expect(held?.status).toBe('gated')
    expect(held?.holdReason).toBe('gate_abstained')
    delete held?.holdReason

    expect(firstNonTerminalStep(restored(store, run.runId))).toBe('A2-claim')
  })

  it('resumes at the first step that has NOT run, after a settled prefix', async () => {
    // What a snapshot taken mid-drive looks like: a passed prefix and an unstarted remainder.
    // This is the most resumable state there is, and the earlier selector reported it as "no step
    // left to resume" because it skipped every step without a record — a defect this test found.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { stopBefore: 'B1-method' })
    const state = getRunSnapshot(store, run.runId).steps

    expect(state['A4-venue']?.status).toBe('passed')
    expect(state['B1-method']).toBeUndefined()
    expect(firstNonTerminalStep(restored(store, run.runId))).toBe('B1-method')
  })

  it('returns nothing for a run waiting at the human gate, and says what it found', async () => {
    // Driven with the pipeline's own seeds, which reaches E2. E2 awaits a person, so a resume must
    // not return it, and the refusal must name the recorded states instead of claiming they are
    // all terminal.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)
    const state = getRunSnapshot(store, run.runId).steps
    expect(state['E2-submit']?.status).toBe('gated')
    for (const step of getStepDefinitions()) {
      if (step.humanGate) continue
      expect(state[step.id]?.status, step.id).toBe('passed')
    }

    expect(() => firstNonTerminalStep(restored(store, run.runId))).toThrow(/no step left to resume/)
    expect(() => firstNonTerminalStep(restored(store, run.runId))).toThrow(/A1-landscape=passed/)
  })
})
