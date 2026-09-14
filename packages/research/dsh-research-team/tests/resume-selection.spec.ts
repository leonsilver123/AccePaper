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
import { canStart, getArtifact, getRunSnapshot, getStepDefinitions } from '@deepseek-ai/dsh-research-core'
import type { ResearchRunStore, RestoredRun } from '@deepseek-ai/dsh-research-core'
import { firstNonTerminalStep, materialWithCommitment, needsReleaseBeforeResume } from '../src/runner/resume.ts'
import { runT19B } from '../src/runner/drive.ts'
import { loadCasePack, planCasePackInputs } from '../src/runner/case-pack.ts'
import { rollback } from '@deepseek-ai/dsh-research-core'

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

/** The v1 pack's inputs, which is what makes the C gate hold at A2 (it declares no metric). */
function shippedPackInputs(): ReturnType<typeof planCasePackInputs> {
  return planCasePackInputs(loadCasePack('plan/overnight/2026-09-09/case-pack-traffic'))
}

/** The pack this fork SHIPS — v2, the one that binds a metric and declares a commitment. */
function currentPackInputs(): ReturnType<typeof planCasePackInputs> {
  return planCasePackInputs(loadCasePack('plan/overnight/2026-09-09/case-pack-traffic-v2'))
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

describe('the selector and the release condition agree', () => {
  it('releases a step whose EXECUTOR FAILED — the commonest interruption there is', async () => {
    // The audit's P1. A step whose executor throws is persisted `in_progress` with no verdict. The
    // selector returns it — it is not `passed` and not a held human gate — but the release
    // condition listed only `failed`/`blocked`/`gated`, so `startStep` refused it with "its status
    // is 'in_progress', and only a 'pending' step can start". A model-writer error or a tool
    // timeout left the run permanently stuck, reporting an engine error rather than a recovery.
    const store: ResearchRunStore = new Map()
    const interrupted = await runT19B(store, {
      executorOverride: stepId => (stepId === 'C1-mvp'
        ? () => { throw new Error('injected executor failure') }
        : undefined),
    })
    const failedState = getRunSnapshot(store, interrupted.runId).steps['C1-mvp']
    expect(failedState?.status).toBe('in_progress')

    const from = firstNonTerminalStep(restored(store, interrupted.runId))
    expect(from).toBe('C1-mvp')
    // The property, not just this case: whatever the selector returns, the release agrees.
    expect(needsReleaseBeforeResume(getRunSnapshot(store, interrupted.runId).steps[from]!.status)).toBe(true)

    // And the release actually unblocks it. The assertion is `canStart` rather than a successful
    // re-drive, because that is precisely what the defect made false: `startStep` — and therefore
    // `canStart` — accepts only a `pending` step, so `driveRemaining` threw before it reached any
    // executor. Re-driving would need the run context rebuilt from the artifacts (which
    // `resumeRunPipeline` does and this spec does not), and would test that instead of this.
    expect(canStart(store, interrupted.runId, from)).toBe(false)
    rollback(store, interrupted.runId, from)
    expect(getRunSnapshot(store, interrupted.runId).steps[from]?.status).toBe('pending')
    expect(canStart(store, interrupted.runId, from)).toBe(true)
  })

  it('agrees for EVERY status the selector can return, so the two cannot drift apart again', async () => {
    // Written as a sweep rather than as a list of cases on purpose: the defect was that the
    // selector and the release were two hand-maintained lists that overlapped without agreeing.
    // `pending` is the only status that needs no release, because it is already where `startStep`
    // wants the step to be.
    expect(needsReleaseBeforeResume('pending')).toBe(false)
    for (const status of ['in_progress', 'gated', 'blocked', 'failed'] as const) {
      expect(needsReleaseBeforeResume(status), status).toBe(true)
    }
  })
})

describe('the resumed claim material is the material the run was GIVEN', () => {
  it('matches field for field, so a field read at a path it does not live at cannot hide', async () => {
    // The class this catches, twice now: `essentialDifference` / `experimentToFalsify` were read off
    // the `claim` artifact at paths it does not have (they are under `claim.falsifiability`), and
    // `scope` / `dataSource` / `declaredSources` were left empty under a comment claiming they were
    // "not on disk to restore" when they are in `inputs['case-pack-claim']`. Both were permanently
    // empty, both made the resumed review report gaps the material does not have, and NEITHER was
    // visible by reading the code — an audit found them by comparing the two. So the comparison is a
    // test now.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { casePackInputs: currentPackInputs() })
    const inputs = getRunSnapshot(store, run.runId).inputs
    const packClaim = inputs['case-pack-claim'] as Record<string, unknown>
    // The material the run was GIVEN: every field the pack supplies is present and non-empty.
    for (const field of ['assertion', 'prediction', 'experimentToFalsify', 'scope', 'dataSource', 'essentialDifference', 'metricKey'] as const) {
      expect(typeof packClaim[field] === 'string' && packClaim[field].length > 0, field).toBe(true)
    }
    expect((packClaim['declaredSources'] as ReadonlyArray<string>).length).toBeGreaterThan(0)

    const resumed = materialWithCommitment(
      inputs,
      getArtifact(store, run.runId, 'claim'),
      getArtifact(store, run.runId, 'falsifiable-prediction'),
      String(packClaim['metricKey']),
    )
    const material = resumed.material
    expect(material.assertion).toBe(packClaim['assertion'])
    expect(material.prediction).toBe(packClaim['prediction'])
    expect(material.experimentToFalsify).toBe(packClaim['experimentToFalsify'])
    expect(material.essentialDifference).toBe(packClaim['essentialDifference'])
    expect(material.scope).toBe(packClaim['scope'])
    expect(material.dataSource).toBe(packClaim['dataSource'])
    expect(material.declaredSources).toEqual(packClaim['declaredSources'])
    expect(material.metricKey).toBe(String(packClaim['metricKey']))
    expect(material.truthfulness).toBe('fixture')
    // ...and the declared commitment comes through the same reader.
    expect(resumed.commitment).toEqual({ direction: 'increase', bound: 'at-least' })
  })

  it('reports a GAP for a field the run itself does not have, rather than inventing one', async () => {
    // A pack that omits a field leaves it empty and the review reports a gap. That is what an
    // unrestorable field is — not a verdict about the claim.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, {})
    const material = materialWithCommitment(
      getRunSnapshot(store, run.runId).inputs,
      getArtifact(store, run.runId, 'claim'),
      getArtifact(store, run.runId, 'falsifiable-prediction'),
      'min-ttc-seconds',
    ).material
    // The fixture path seeds no pack, so the pack-supplied fields are absent and stay absent.
    expect(material.scope).toBe('')
    expect(material.dataSource).toBe('')
    // ...while the artifact-supplied ones are still restored.
    expect(material.assertion.length).toBeGreaterThan(0)
    expect(material.experimentToFalsify.length).toBeGreaterThan(0)
  })
})
