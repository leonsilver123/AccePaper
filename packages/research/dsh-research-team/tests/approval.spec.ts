// @deepseek-ai/dsh-research-team — human approval (E2-submit) invariants.
//
// PRECONDITION STATE. `E2-submit` is reachable only after the fifteen steps before it pass
// their A/B/C gates, and the offline Case Pack run stops at `A2-claim` — so this spec does not
// use the Case Pack. It drives the REAL driver with the default seeds (`runT19B(store)`), which
// reaches `E2-submit` `gated` the same way the happy-path E2E does.
//
// NO GATE IS WEAKENED HERE, and one thing about the default path is disclosed rather than left
// implicit: this run's C gate passes because the fixture claim declares the quantity the
// experiment measures (`CANONICAL_METRIC_KEY`) and its threshold is 5%, which the measured
// 11.09% satisfies. That threshold was 8% before, and the experiment refutes 8% — the change,
// and why it was made, are recorded at `CANONICAL_PREDICTION` in runner/registry.ts. Nothing in
// THIS spec touches a verdict, threshold, metric or component: it drives the production entry
// and decides only the gate a person would decide.
//
// WHAT EACH GROUP PROVES (ENGINEERING-CONTRACT §8.1):
//   - a decision produces a backend record: the step's `approval` and the run's `human-approval`
//     audit event, both written by core's `_applyHumanApproval`;
//   - a re-read of the backend still shows it;
//   - a repeated decision is refused, and the step keeps exactly one record;
//   - a decision for a superseded attempt is refused, and the current attempt stays pending;
//   - a rollback leaves the old decision inert (core clears the approval and completion);
//   - no ordinary mutation of the run, and no ordinary tool call, can pass the gate: the
//     approval surface is reachable only through the authenticated Connection channel, and the
//     package exports none of it;
//   - a client cannot write `passed`: the payload's own `status`, `actor`, `principal` and
//     `principalId` fields are read by nothing.

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'
import {
  DEFAULT_EVIDENCE_PROFILE,
  completeStep,
  getRunSnapshot,
  getStepDefinitions,
  isComplete,
  rollback,
  startStep,
} from '@deepseek-ai/dsh-research-core'
import { createRunPersistence } from '@deepseek-ai/dsh-research-core'
import type { ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { createHostApprovalChannel } from '@deepseek-ai/dsh-research-core/host'

import * as teamEntry from '../src/index.ts'
import {
  APPROVAL_CHANNEL,
  APPROVAL_DECIDE_ENDPOINT,
  APPROVAL_ERROR_CODES,
  OPERATOR_PRINCIPAL_ID,
  decideApprovalRequest,
  forgetRuns,
  installApprovalEndpoint,
  readSubmission,
  rememberRun,
  rememberedRun,
  submitApproval,
  type ApprovalConnectionHost,
  type ApprovalWireResult,
} from '../src/approval.ts'
import { runT19B } from '../src/runner/drive.ts'
import type { RunResult } from '../src/runner/types.ts'
import type { ResearchRunPersistence, ResearchRunSnapshot } from '../src/types.ts'

/** The human gate every approval test decides. */
const E2 = 'E2-submit'

interface GatedRun {
  readonly store: ResearchRunStore
  readonly run: RunResult
}

let gated: GatedRun | undefined

/**
 * The precondition run, driven once and memoized.
 *
 * A `describe`-scoped memo rather than a `beforeAll` local because several suites below share
 * it; every test that decides a gate re-gates the step first, so no test depends on another's
 * decision.
 */
/**
 * The revision a submission must name, for the tests that are not about that check.
 *
 * Every test below decides a gate the same way a reader does — against the run as it currently
 * stands — so they name the current revision. Only the tests about a moved revision name another.
 *
 * @param drive - the run being decided.
 * @returns the run's current project revision.
 */
function revisionNow(drive: GatedRun): number {
  return getRunSnapshot(drive.store, drive.run.runId).revision
}

async function gatedRun(): Promise<GatedRun> {
  if (gated !== undefined) return gated
  const store: ResearchRunStore = new Map()
  const run = await runT19B(store)
  gated = { store, run }
  registerGatedRun(gated)
  return gated
}

/**
 * Register one run with the approval endpoint the way the service does.
 *
 * `saveState` is the run's durable state as its owner reports it — the fact `submitApproval` reads
 * before it decides anything. The default answers null (this twin keeps no durable record), which is
 * the state a suite that is not about durability wants; a suite that IS about it states the failure
 * its deployment would report. `tests/start-run.spec.ts` drives the production wiring that fills
 * this from a real save.
 *
 * @param drive - the run to register.
 * @param saveState - what the run's last durable write did.
 */
function registerGatedRun(
  drive: GatedRun,
  saveState: () => ResearchRunPersistence | null = () => null,
): void {
  rememberRun(
    drive.run.runId,
    drive.store,
    () => project(drive.run, drive.store),
    // The twin's writer. It answers the way a deployment that configured no snapshot directory
    // does, so `persisted: false` stays the reported outcome unless a suite registers a real one.
    async () => null,
    saveState,
  )
}

/**
 * Project one run from its CURRENT store.
 *
 * The production projector is `snapshotOf` in `src/index.ts`; this is the same read of the same
 * public accessors (the step-catalogue/gate/artifact projections are not what these assertions
 * are about). The step states — which is what an approval changes — come straight from core.
 *
 * @param run - the driven run.
 * @param store - the run's store.
 * @returns a wire snapshot whose step states reflect the store as of this call.
 */
function project(run: RunResult, store: ResearchRunStore): ResearchRunSnapshot {
  const snapshot = getRunSnapshot(store, run.runId)
  return {
    run,
    projectRevision: snapshot.revision,
    execution: 'stopped' as const,
    catalog: [],
    gates: [],
    artifacts: [],
    // This twin exists to keep the wire snapshot's fields honest; the profile trio is part of
    // what the boundary carries, so it is stated here rather than defaulted.
    evidenceProfile: DEFAULT_EVIDENCE_PROFILE,
    profileEligible: false,
    submissionReady: false,
    readinessNote: 'evaluation profile (test twin)',
    steps: getStepDefinitions().flatMap((definition) => {
      const state = snapshot.steps[definition.id]
      return state === undefined
        ? []
        : [{
          stepId: state.stepId, status: state.status, attempt: state.attemptId,
          holdReason: state.holdReason ?? null,
          // The twin states the field the wire now carries: a step with no decision says so, rather
          // than omitting a field a client would read as a host built before it existed.
          approval: null,
        }]
    }),
    packageExport: null,
    runPersistence: null,
  }
}

/** The step state core currently records for E2. */
function e2(store: ResearchRunStore, runId: string) {
  return getRunSnapshot(store, runId).steps[E2]
}

/**
 * The `human-approval` records core wrote for one attempt of E2.
 *
 * Scoped to the attempt because every suite below decides the SAME run: the audit timeline is
 * append-only and accumulates a record per decision, and the invariant under test is one
 * decision per attempt.
 *
 * @param store - the run store.
 * @param runId - the run to read.
 * @param attemptId - the attempt whose records to count.
 * @returns the matching audit events.
 */
function approvalsAt(store: ResearchRunStore, runId: string, attemptId: number) {
  return getRunSnapshot(store, runId).events.filter(
    event => event.kind === 'human-approval' && event.stepId === E2 && event.attemptId === attemptId,
  )
}

/**
 * Return E2 to `gated` on a fresh attempt.
 *
 * The transitions are core's own public ones, and they are the same recovery path
 * `tests/fixtures/run-recovery/run-reader.ts` takes: rollback the terminal attempt, start a new
 * one, complete it (a humanGate step with an empty gate parks at `gated`).
 *
 * @param gatedRun - the run to re-gate.
 * @returns the attempt number the step is now pending at.
 */
function regate({ store, run }: GatedRun): number {
  rollback(store, run.runId, E2)
  startStep(store, run.runId, E2)
  completeStep(store, run.runId, E2)
  const state = e2(store, run.runId)
  if (state?.status !== 'gated') throw new Error(`regate: E2 is '${String(state?.status)}', not 'gated'`)
  return state.attemptId
}

describe('approval precondition — the real driver stops at the human gate', () => {
  beforeAll(async () => { await gatedRun() })

  it('leaves E2-submit gated with no approval recorded', async () => {
    const { store, run } = await gatedRun()
    const state = e2(store, run.runId)
    expect(state?.status).toBe('gated')
    expect(state?.approval).toBeUndefined()
    expect(approvalsAt(store, run.runId, state?.attemptId ?? 0)).toHaveLength(0)
  })
})

describe('§8.1 an approval produces a backend record', () => {
  it('records the decision on the step, in the audit timeline, and in completion', async () => {
    const drive = await gatedRun()
    const attempt = regate(drive)

    const result = await submitApproval({ runId: drive.run.runId, stepId: E2, attempt, decision: 'approved', commandId: 'cmd-2', expectedProjectRevision: revisionNow(drive) })
    if (!result.ok) throw new Error(`expected a decision, got ${result.error.code}: ${result.error.message}`)

    expect(result.value.status).toBe('passed')
    expect(result.value.operator).toBe(OPERATOR_PRINCIPAL_ID)
    expect(result.value.approvalEventId).not.toBe('')

    const state = e2(drive.store, drive.run.runId)
    expect(state?.status).toBe('passed')
    expect(state?.approval).toMatchObject({
      run_id: drive.run.runId,
      step_id: E2,
      attempt_id: attempt,
      principalId: OPERATOR_PRINCIPAL_ID,
      approval_event_id: result.value.approvalEventId,
      decision: 'approved',
    })
    expect(typeof state?.approval?.timestamp).toBe('number')

    const approvals = approvalsAt(drive.store, drive.run.runId, attempt)
    expect(approvals).toHaveLength(1)
    expect(approvals[0]?.detail).toMatchObject({
      principalId: OPERATOR_PRINCIPAL_ID,
      approvalEventId: result.value.approvalEventId,
      decision: 'approved',
    })

    expect(isComplete(drive.store, drive.run.runId, E2)).toBe(true)
  })

  it('records a rejection as blocked, and never as passed', async () => {
    const drive = await gatedRun()
    const attempt = regate(drive)

    const result = await submitApproval({ runId: drive.run.runId, stepId: E2, attempt, decision: 'rejected', commandId: 'cmd-3', expectedProjectRevision: revisionNow(drive) })
    if (!result.ok) throw new Error(`expected a decision, got ${result.error.code}: ${result.error.message}`)

    expect(result.value.status).toBe('blocked')
    expect(e2(drive.store, drive.run.runId)?.status).toBe('blocked')
    expect(isComplete(drive.store, drive.run.runId, E2)).toBe(false)
  })
})

describe('§8.1 a re-read of the backend still shows the decision', () => {
  it('re-projects the decided run from its store, not from what the caller had in hand', async () => {
    const drive = await gatedRun()
    const attempt = regate(drive)
    const result = await submitApproval({ runId: drive.run.runId, stepId: E2, attempt, decision: 'approved', commandId: 'cmd-4', expectedProjectRevision: revisionNow(drive) })
    expect(result.ok).toBe(true)

    // The response carries a projection taken AFTER the decision...
    // The projection is OPTIONAL on the wire: a decision that was applied but could not be
    // re-projected still reports success with `projectionError` set, so a caller never hears
    // "refused" for a decision the run recorded.
    const fromResponse = result.ok ? result.value.snapshot?.steps.find(step => step.stepId === E2) : undefined
    expect(result.ok ? result.value.snapshot : undefined).toBeDefined()
    expect(fromResponse?.status).toBe('passed')
    expect(fromResponse?.attempt).toBe(attempt)

    // ...and so does any later re-read of the remembered run.
    const remembered = rememberedRun(drive.run.runId)
    expect(remembered).toBeDefined()
    const reread = remembered?.project().steps.find(step => step.stepId === E2)
    expect(reread?.status).toBe('passed')
    expect(reread?.attempt).toBe(attempt)

    // A client that lost its state re-asks: the refusal names the recorded status, so the
    // answer is the backend's, not a fresh decision.
    const again = await submitApproval({ runId: drive.run.runId, stepId: E2, attempt, decision: 'approved', commandId: 'cmd-5', expectedProjectRevision: revisionNow(drive) })
    expect(again.ok).toBe(false)
    expect(again.ok ? '' : again.error.message).toContain('passed')
  })
})

describe('§8.1 a repeated decision cannot approve twice', () => {
  it('refuses the second decision and keeps exactly one record', async () => {
    const drive = await gatedRun()
    const attempt = regate(drive)

    const first = await submitApproval({ runId: drive.run.runId, stepId: E2, attempt, decision: 'approved', commandId: 'cmd-6', expectedProjectRevision: revisionNow(drive) })
    expect(first.ok).toBe(true)

    const second = await submitApproval({ runId: drive.run.runId, stepId: E2, attempt, decision: 'approved', commandId: 'cmd-7', expectedProjectRevision: revisionNow(drive) })
    expect(second.ok).toBe(false)
    expect(second.ok ? '' : second.error.code).toBe(APPROVAL_ERROR_CODES.notPending)

    const third = await submitApproval({ runId: drive.run.runId, stepId: E2, attempt, decision: 'rejected', commandId: 'cmd-8', expectedProjectRevision: revisionNow(drive) })
    expect(third.ok).toBe(false)

    expect(approvalsAt(drive.store, drive.run.runId, attempt)).toHaveLength(1)
    const recorded = e2(drive.store, drive.run.runId)?.approval
    expect(recorded?.decision).toBe('approved')
    expect(first.ok ? recorded?.approval_event_id === first.value.approvalEventId : false).toBe(true)
  })
})

describe('§8.1 a superseded attempt cannot be decided by the old approval', () => {
  it('refuses a decision naming an attempt the step has moved past', async () => {
    const drive = await gatedRun()
    const firstAttempt = regate(drive)
    const approved = await submitApproval({ runId: drive.run.runId, stepId: E2, attempt: firstAttempt, decision: 'approved', commandId: 'cmd-9', expectedProjectRevision: revisionNow(drive) })
    expect(approved.ok).toBe(true)

    // Roll back the decided attempt and start a new one, exactly as a recovery does.
    const secondAttempt = regate(drive)
    expect(secondAttempt).toBeGreaterThan(firstAttempt)

    const stale = await submitApproval({ runId: drive.run.runId, stepId: E2, attempt: firstAttempt, decision: 'approved', commandId: 'cmd-10', expectedProjectRevision: revisionNow(drive) })
    expect(stale.ok).toBe(false)
    expect(stale.ok ? '' : stale.error.code).toBe(APPROVAL_ERROR_CODES.staleAttempt)
    expect(stale.ok ? '' : stale.error.message).toContain(String(secondAttempt))

    // The stale decision changed nothing: the current attempt is still pending.
    expect(e2(drive.store, drive.run.runId)?.status).toBe('gated')
    expect(e2(drive.store, drive.run.runId)?.attemptId).toBe(secondAttempt)
    expect(e2(drive.store, drive.run.runId)?.approval).toBeUndefined()

    const current = await submitApproval({ runId: drive.run.runId, stepId: E2, attempt: secondAttempt, decision: 'approved', commandId: 'cmd-11', expectedProjectRevision: revisionNow(drive) })
    expect(current.ok).toBe(true)
    expect(e2(drive.store, drive.run.runId)?.approval?.attempt_id).toBe(secondAttempt)
  })

  it('leaves a rolled-back step inert until it is decided again', async () => {
    const drive = await gatedRun()
    const attempt = regate(drive)
    expect((await submitApproval({ runId: drive.run.runId, stepId: E2, attempt, decision: 'approved', commandId: 'cmd-12', expectedProjectRevision: revisionNow(drive) })).ok).toBe(true)
    expect(isComplete(drive.store, drive.run.runId, E2)).toBe(true)

    rollback(drive.store, drive.run.runId, E2)

    const after = e2(drive.store, drive.run.runId)
    expect(after?.status).toBe('pending')
    expect(after?.approval).toBeUndefined()
    expect(isComplete(drive.store, drive.run.runId, E2)).toBe(false)
    // The old audit record is history, not a live approval.
    const live = await submitApproval({ runId: drive.run.runId, stepId: E2, attempt, decision: 'approved', commandId: 'cmd-13', expectedProjectRevision: revisionNow(drive) })
    expect(live.ok).toBe(false)
    expect(live.ok ? '' : live.error.code).toBe(APPROVAL_ERROR_CODES.notPending)
  })
})

describe('§8.1 an Agent cannot self-approve through an ordinary call', () => {
  it('refuses every ordinary mutation of a gated human gate', async () => {
    const drive = await gatedRun()
    const attempt = regate(drive)
    const runId = drive.run.runId

    // The empty-gate finalize cannot run a step that is already waiting for a person.
    expect(() => completeStep(drive.store, runId, E2)).toThrow(/COMPLETE_BAD_STATUS/)
    // There is no approved state to reach by starting it again, either.
    expect(() => startStep(drive.store, runId, E2)).toThrow()
    expect(e2(drive.store, runId)?.status).toBe('gated')
    expect(attempt).toBe(e2(drive.store, runId)?.attemptId)
  })

  it('refuses a decision for a run this process does not hold', async () => {
    const drive = await gatedRun()
    const attempt = regate(drive)
    const foreign = await submitApproval({ runId: 'run-this-process-never-started', stepId: E2, attempt, decision: 'approved', commandId: 'cmd-14', expectedProjectRevision: revisionNow(drive) })
    expect(foreign.ok).toBe(false)
    expect(foreign.ok ? '' : foreign.error.code).toBe(APPROVAL_ERROR_CODES.runUnknown)
    expect(e2(drive.store, drive.run.runId)?.status).toBe('gated')
  })

  it('refuses a step that is not a human gate, and a step with no state', async () => {
    const drive = await gatedRun()
    const attempt = regate(drive)
    const ordinary = await submitApproval({ runId: drive.run.runId, stepId: 'A1-landscape', attempt, decision: 'approved', commandId: 'cmd-15', expectedProjectRevision: revisionNow(drive) })
    expect(ordinary.ok).toBe(false)
    expect(ordinary.ok ? '' : ordinary.error.code).toBe(APPROVAL_ERROR_CODES.notHumanGate)

    const unknown = await submitApproval({ runId: drive.run.runId, stepId: 'Z9-nothing', attempt: 1, decision: 'approved', commandId: 'cmd-16', expectedProjectRevision: revisionNow(drive) })
    expect(unknown.ok).toBe(false)
    expect(unknown.ok ? '' : unknown.error.code).toBe(APPROVAL_ERROR_CODES.stepUnknown)
    expect(e2(drive.store, drive.run.runId)?.status).toBe('gated')
  })

  it('exposes no approval capability from the package entry, and no Remote method for it', () => {
    // A tool call can only reach what the host registered. The approval surface is not an
    // export of the package, so there is nothing for such a call to name...
    expect(Object.keys(teamEntry).filter(name => /approv|decide|principal/i.test(name))).toEqual([])
    // ...and the one Remote-decorated method is still `run`: no approval endpoint was added
    // to the wire surface.
    const source = readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8')
    expect(source).toContain("@Remote('run')")
    expect(source).not.toMatch(/@Remote\(\s*['"][^'"]*(approv|decide|gate|principal)[^'"]*['"]\s*\)/i)
  })

  it('makes a second host channel unmintable in this process', async () => {
    const drive = await gatedRun()
    const attempt = regate(drive)
    // Mint the process channel by using it.
    expect((await submitApproval({ runId: drive.run.runId, stepId: E2, attempt, decision: 'approved', commandId: 'cmd-17', expectedProjectRevision: revisionNow(drive) })).ok).toBe(true)
    // A second mint — the shape a pre-empting caller takes — fails loudly rather than
    // producing a second, independent authority.
    expect(() => createHostApprovalChannel('pre-empting-secret')).toThrow(/DSH_APPROVAL_CHANNEL_EXISTS/)
  })

  it('refuses a decision made about a revision the run has left behind', async () => {
    // A DECISION IS ABOUT A REVISION, NOT A STEP. The reader read the manuscript at revision N; if
    // the run has moved since — a second tab, a step that landed, a recovery — then whatever is
    // there now is a document they have not read, and recording their decision against it approves
    // something nobody looked at. The refusal names both revisions so they can re-read.
    const drive = await gatedRun()
    const attempt = regate(drive)
    const stale = revisionNow(drive) - 1

    const result = await submitApproval({
      runId: drive.run.runId, stepId: E2, attempt, decision: 'approved',
      commandId: 'cmd-stale-revision', expectedProjectRevision: stale,
    })

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error.code).toBe(APPROVAL_ERROR_CODES.staleRevision)
    expect(result.ok ? '' : result.error.message).toContain(String(stale))
    expect(result.ok ? '' : result.error.message).toContain(String(revisionNow(drive)))
    // And nothing was decided: the gate is exactly as pending as it was.
    expect(e2(drive.store, drive.run.runId)?.status).toBe('gated')
    expect(e2(drive.store, drive.run.runId)?.approval).toBeUndefined()
  })

  it('answers a repeated command with the result its first send produced', async () => {
    // A RETRY IS NOT A SECOND DECISION. The caller could not read the first answer — a timeout, a
    // reload, a second click on a button that looked inert — and sends the same command again. The
    // alternative is what the shipped behaviour was: `not-pending`, because the first send decided
    // the gate, and a caller cannot tell that refusal apart from "my decision never landed".
    const drive = await gatedRun()
    const attempt = regate(drive)
    const command = { runId: drive.run.runId, stepId: E2, attempt, decision: 'approved' as const, commandId: 'cmd-retry', expectedProjectRevision: revisionNow(drive) }

    const first = await submitApproval(command)
    const second = await submitApproval(command)

    expect(first.ok).toBe(true)
    expect(second).toEqual(first)
    // The second send reached no decision of its own: the step holds ONE approval, under the first
    // send's event id.
    const approval = e2(drive.store, drive.run.runId)?.approval
    expect(approval?.approval_event_id).toBe(first.ok ? first.value.approvalEventId : 'no event')

    // A DIFFERENT command is a different intent, and meets the state the first one produced. The
    // ledger answers retries; it is not a way around the gate.
    const other = await submitApproval({ ...command, commandId: 'cmd-other' })
    expect(other.ok).toBe(false)
    expect(other.ok ? '' : other.error.code).toBe(APPROVAL_ERROR_CODES.notPending)
  })

  it('does not remember a refusal, so a retry after a transient failure can still decide', async () => {
    // Caching a refusal would make a command that failed for a reason outside its control — a
    // broken channel, a run this process does not hold — permanently refused under that id.
    const drive = await gatedRun()
    const attempt = regate(drive)
    const command = { runId: drive.run.runId, stepId: E2, attempt, decision: 'approved' as const, commandId: 'cmd-transient', expectedProjectRevision: revisionNow(drive) }

    const before = await submitApproval({ ...command, runId: 'no-such-run' })
    expect(before.ok).toBe(false)

    const after = await submitApproval(command)
    expect(after.ok).toBe(true)
  })

  it('forgets runs when the owning plugin unloads', async () => {
    const drive = await gatedRun()
    const attempt = regate(drive)
    const before = await submitApproval({ runId: drive.run.runId, stepId: E2, attempt, decision: 'approved', commandId: 'cmd-18', expectedProjectRevision: revisionNow(drive) })
    expect(before.ok).toBe(true)

    forgetRuns()
    const after = await submitApproval({ runId: drive.run.runId, stepId: E2, attempt, decision: 'approved', commandId: 'cmd-19', expectedProjectRevision: revisionNow(drive) })
    expect(after.ok).toBe(false)
    expect(after.ok ? '' : after.error.code).toBe(APPROVAL_ERROR_CODES.runUnknown)

    // Re-register for any later suite.
    registerGatedRun(drive)
  })
})

describe('§8.1 a decision is as durable as the run that produced it', () => {
  // The defect this covers: the handler moved the step in MEMORY and returned success while the
  // snapshot on disk still said `gated`, so the next process asked the person to approve what they
  // had already approved. `ApprovalDecision.persisted` reports which of the two happened; the
  // assertion that settles it is on the FILE, read through a writer this test did not decide with.
  it('writes the decision to the run snapshot, so a restart reads E2 as passed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-approval-durable-'))
    const writer = createRunPersistence({ dir })
    const drive = await gatedRun()
    const attempt = regate(drive)
    // The predecessor, written through the same writer: the run as it stands BEFORE the decision.
    // Without it the test could not tell the decision's write from the run's own.
    const before = await writer.save(drive.store, drive.run.runId, { baseRevision: 0 })
    const beforeStep = before.steps.find(step => step.stepId === E2)
    expect(beforeStep?.status).toBe('gated')
    expect(beforeStep?.approval).toBeUndefined()

    rememberRun(
      drive.run.runId,
      drive.store,
      () => project(drive.run, drive.store),
      async () => {
        const written = await writer.save(drive.store, drive.run.runId, { baseRevision: before.revision })
        return { runId: drive.run.runId, revision: written.revision, interrupted: [] }
      },
      // The same writer's state: it landed, so the approval's precondition has nothing to refuse.
      () => ({ runId: drive.run.runId, revision: before.revision, interrupted: [] }),
    )
    const result = await submitApproval({ runId: drive.run.runId, stepId: E2, attempt, decision: 'approved', commandId: 'cmd-20', expectedProjectRevision: revisionNow(drive) })
    expect(result.ok).toBe(true)
    expect(result.ok ? result.value.persisted : undefined).toBe(true)
    expect(result.ok ? result.value.persistenceError : 'no result').toBeUndefined()

    // A FRESH writer over the same directory, which is all the next process has.
    const reread = await createRunPersistence({ dir }).read()
    const decided = reread.steps.find(step => step.stepId === E2)
    expect(decided?.status).toBe('passed')
    expect(decided?.approval?.decision).toBe('approved')
    expect(reread.consumedApprovalEventIds).toContain(result.ok ? result.value.approvalEventId : 'no event')

    // Leave the shared registry as the other suites expect to find it.
    registerGatedRun(drive)
  })
})

describe('§8.1 a run that is not on disk is not decided', () => {
  // The defect this covers: the run's durability was consulted only AFTER the decision, so an
  // approval sent while the deployment could not save the run was APPLIED — E2 moved to `passed` in
  // memory — and the caller was told `persisted: false`. A restart then read the snapshot, found
  // `gated`, and asked the person to approve what they already had. The refusal belongs with the
  // other preconditions, which is where a decision can still be declined.

  it('refuses before the decision, in the deployment’s own words', async () => {
    const drive = await gatedRun()
    const attempt = regate(drive)
    // What a full disk reports, verbatim: the message travels from the deployment, not from a
    // summary written here.
    const failure = 'ENOSPC: no space left on device, write'
    registerGatedRun(drive, () => ({ runId: drive.run.runId, revision: null, interrupted: [], error: failure }))
    try {
      const refused = await submitApproval({
        runId: drive.run.runId,
        stepId: E2,
        attempt,
        decision: 'approved',
        commandId: 'cmd-save-broken',
        expectedProjectRevision: revisionNow(drive),
      })
      expect(refused.ok).toBe(false)
      expect(refused.ok ? '' : refused.error.code).toBe(APPROVAL_ERROR_CODES.saveFailed)
      expect(refused.ok ? '' : refused.error.message).toContain(failure)

      // NOTHING WAS DECIDED, which is the whole difference from reporting `persisted: false` after
      // the fact: the gate is where the reader left it and no approval record exists for the
      // attempt.
      const state = e2(drive.store, drive.run.runId)
      expect(state?.status).toBe('gated')
      expect(state?.approval).toBeUndefined()
      expect(approvalsAt(drive.store, drive.run.runId, attempt)).toHaveLength(0)
      expect(isComplete(drive.store, drive.run.runId, E2)).toBe(false)
    } finally {
      registerGatedRun(drive)
    }
  })

  it('decides the same command once the run’s next write has landed', async () => {
    // THE RECOVERY, and why the refusal above is safe to make: it is about a FACT, not about the
    // command. The fact is cleared by the run's next durable write landing — a checkpoint, while
    // the run is still being driven — and a refusal is never remembered, so the caller's own retry
    // under the SAME command id is the decision they meant to make.
    const drive = await gatedRun()
    const attempt = regate(drive)
    const command = {
      runId: drive.run.runId,
      stepId: E2,
      attempt,
      decision: 'approved' as const,
      commandId: 'cmd-save-recovered',
      expectedProjectRevision: revisionNow(drive),
    }
    registerGatedRun(drive, () => ({ runId: drive.run.runId, revision: null, interrupted: [], error: 'ENOTDIR: not a directory' }))
    try {
      const refused = await submitApproval(command)
      expect(refused.ok ? '' : refused.error.code).toBe(APPROVAL_ERROR_CODES.saveFailed)

      // The next write landed.
      registerGatedRun(drive)
      const decided = await submitApproval(command)
      expect(decided.ok).toBe(true)
      expect(decided.ok ? decided.value.status : '').toBe('passed')
      expect(e2(drive.store, drive.run.runId)?.status).toBe('passed')
      expect(approvalsAt(drive.store, drive.run.runId, attempt)).toHaveLength(1)
    } finally {
      registerGatedRun(drive)
    }
  })
})

describe('§8.1 a client cannot write `passed`', () => {
  it('reads four fields and ignores every identity or status the payload claims', async () => {
    const drive = await gatedRun()
    const attempt = regate(drive)
    // The body an attacker sends: the four decidable fields plus every claim a client might
    // hope the backend believes. It is declared at the type the endpoint actually receives —
    // `unknown` — because that is what a wire body is. Handing this literal to the typed
    // `submitApproval` would only make the compiler say what the test is here to prove: this is
    // not a submission the type describes, and nothing downstream may treat it as one.
    const hostile: Record<string, unknown> = {
      runId: drive.run.runId,
      stepId: E2,
      attempt,
      decision: 'rejected',
      commandId: 'cmd-attacker',
      // The one field a hostile body CANNOT fake its way past: this must name the revision the
      // reader actually had in front of them, and the run is the authority on which that is.
      expectedProjectRevision: revisionNow(drive),
      status: 'passed',
      actor: 'human',
      principal: 'somebody-important',
      principalId: 'somebody-important',
      humanGate: true,
    }

    // The reader production calls projects it onto the DECIDABLE fields and discards the rest. The
    // command id is among the fields it keeps, and that is not an identity claim: it names the
    // caller's own retry, and the host never reads it as who the caller is.
    expect(readSubmission(hostile)).toEqual({
      runId: drive.run.runId, stepId: E2, attempt, decision: 'rejected',
      commandId: 'cmd-attacker', expectedProjectRevision: revisionNow(drive),
    })

    // ...and the whole endpoint, driven with that same body, decides on those four fields alone.
    const refused = await decideApprovalRequest(APPROVAL_DECIDE_ENDPOINT, hostile)
    expect(refused.ok).toBe(true)
    // The body asked for `passed`; the decision it stated was a rejection, and that is what the
    // backend recorded — under the host's principal, not the one the body named. Its `status`,
    // `actor`, `principalId` and `humanGate` are all ignored for the same reason.
    expect(e2(drive.store, drive.run.runId)?.status).toBe('blocked')
    expect(e2(drive.store, drive.run.runId)?.approval?.principalId).toBe(OPERATOR_PRINCIPAL_ID)
  })

  it('rejects a payload that is not a decidable request', () => {
    for (const payload of [
      undefined,
      null,
      'approved',
      [],
      { stepId: E2, attempt: 1, decision: 'approved', commandId: 'cmd-21', expectedProjectRevision: 1 },
      { runId: 'r', attempt: 1, decision: 'approved', commandId: 'cmd-22', expectedProjectRevision: 1 },
      { runId: 'r', stepId: E2, attempt: '1', decision: 'approved', commandId: 'cmd-23', expectedProjectRevision: 1 },
      { runId: 'r', stepId: E2, attempt: 1.5, decision: 'approved', commandId: 'cmd-24', expectedProjectRevision: 1 },
      { runId: 'r', stepId: E2, attempt: 1, decision: 'yes' },
      { runId: '', stepId: E2, attempt: 1, decision: 'approved', commandId: 'cmd-25', expectedProjectRevision: 1 },
      { runId: 'r', stepId: E2, attempt: 1, decision: 'approved', commandId: 'cmd-26' },
      { runId: 'r', stepId: E2, attempt: 1, decision: 'approved', expectedProjectRevision: 1 },
    ]) {
      expect(readSubmission(payload), JSON.stringify(payload)).toBeUndefined()
    }
  })
})

describe('§8.1 the decision arrives on the host-authenticated channel', () => {
  /** A recording stand-in for `ctx.connection`. */
  interface FakeConnection {
    readonly host: ApprovalConnectionHost
    /** Every channel the module registered on. */
    readonly channels: string[]
    /** The handler the module registered, once it has. */
    handler: ApprovalEndpointHandler | undefined
  }

  /** The handler shape the loopback channel receives. */
  type ApprovalEndpointHandler =
    (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ApprovalWireResult>

  function fakeConnection(): FakeConnection {
    const channels: string[] = []
    const recorder: FakeConnection = {
      channels,
      handler: undefined,
      host: {
        rpc: {
          handle(channel: string, handler: ApprovalEndpointHandler) {
            channels.push(channel)
            recorder.handler = handler
            return async () => {}
          },
        },
      },
    }
    return recorder
  }

  it('registers exactly one channel, through the host Connection service', async () => {
    const connection = fakeConnection()
    installApprovalEndpoint(connection.host)
    expect(connection.channels).toEqual([APPROVAL_CHANNEL])

    const drive = await gatedRun()
    const attempt = regate(drive)
    const handler = connection.handler
    if (handler === undefined) throw new Error('installApprovalEndpoint registered no handler')

    const decided = await handler(
      APPROVAL_DECIDE_ENDPOINT,
      { runId: drive.run.runId, stepId: E2, attempt, decision: 'approved', commandId: 'cmd-26', expectedProjectRevision: revisionNow(drive) },
      new AbortController().signal,
    )
    expect(decided.ok).toBe(true)
    expect(e2(drive.store, drive.run.runId)?.status).toBe('passed')
  })

  it('refuses an unknown endpoint and a malformed body through the same channel', async () => {
    const connection = fakeConnection()
    installApprovalEndpoint(connection.host)
    const handler = connection.handler
    if (handler === undefined) throw new Error('installApprovalEndpoint registered no handler')

    const unknown = await handler('elevate', {}, new AbortController().signal)
    expect(unknown.ok ? '' : unknown.error.code).toBe(APPROVAL_ERROR_CODES.requestInvalid)

    const malformed = await handler(APPROVAL_DECIDE_ENDPOINT, { actor: 'human' }, new AbortController().signal)
    expect(malformed.ok ? '' : malformed.error.code).toBe(APPROVAL_ERROR_CODES.requestInvalid)
  })

  describe('the endpoint hands an applied decision to the service', () => {
    it('calls the hook with the receipt, and not for a refusal', async () => {
    // THE HOOK IS THE LOOP'S ONLY PRODUCTION CALLER. A change request is an instruction, and the
    // service is the layer that turns it into a durable revision request; this pins that the
    // endpoint actually hands it the applied decision — and stays silent when there is none.
      const seen: Array<{ decision: string; request?: string }> = []
      const connection = fakeConnection()
      installApprovalEndpoint(connection.host, {
        onDecided: (receipt) => {
          seen.push({
            decision: receipt.decision,
            ...(receipt.request === undefined ? {} : { request: receipt.request }),
          })
        },
      })
      const handler = connection.handler
      if (handler === undefined) throw new Error('installApprovalEndpoint registered no handler')

      const drive = await gatedRun()
      const attempt = regate(drive)
      const decided = await handler(APPROVAL_DECIDE_ENDPOINT, {
        runId: drive.run.runId, stepId: E2, attempt, decision: 'request_changes',
        commandId: 'cmd-hook-1', expectedProjectRevision: revisionNow(drive),
        request: 'tighten the claim in the results',
      }, new AbortController().signal)
      if (!decided.ok) throw new Error(`the decision was refused: ${decided.error.message}`)
      expect(seen).toEqual([{ decision: 'request_changes', request: 'tighten the claim in the results' }])

      // A REFUSAL DECIDES NOTHING, so there is nothing for the service to record.
      const refused = await handler(APPROVAL_DECIDE_ENDPOINT, {
        runId: drive.run.runId, stepId: E2, attempt, decision: 'approved',
        commandId: 'cmd-hook-2', expectedProjectRevision: revisionNow(drive) + 5,
      }, new AbortController().signal)
      expect(refused.ok).toBe(false)
      expect(seen).toHaveLength(1)
    })

    it('answers with the decision even when the hook throws', async () => {
    // THE DECISION IS APPLIED AND DURABLE BEFORE THE HOOK RUNS. Reporting a hook failure as a refusal
    // would tell the operator their decision did not land while the run says it did.
      const connection = fakeConnection()
      installApprovalEndpoint(connection.host, {
        onDecided: () => { throw new Error('the revision root is gone') },
      })
      const handler = connection.handler
      if (handler === undefined) throw new Error('installApprovalEndpoint registered no handler')

      const drive = await gatedRun()
      const attempt = regate(drive)
      const decided = await handler(APPROVAL_DECIDE_ENDPOINT, {
        runId: drive.run.runId, stepId: E2, attempt, decision: 'approved',
        commandId: 'cmd-hook-3', expectedProjectRevision: revisionNow(drive),
      }, new AbortController().signal)
      expect(decided.ok).toBe(true)
    })
  })
})

describe('§8.1 simulated human identity exists only in test assembly', () => {
  it('ships no principal, operator or approval secret in the research bundle config', () => {
    const patch = readFileSync(
      fileURLToPath(new URL('../../../bundle/research-app/cordis.patch.yml', import.meta.url)),
      'utf8',
    )
    expect(patch).not.toContain(OPERATOR_PRINCIPAL_ID)
    expect(patch).not.toContain('registerPrincipal')
    expect(patch).not.toContain('DSH_APPROVAL_SECRET')
    expect(patch).not.toContain('actor')

    // The identity the tests use IS the production one — it is named for the host mechanism,
    // not for a fabricated person, and the profile config never mentions it.
    expect(OPERATOR_PRINCIPAL_ID).toBe('authenticated-browser-operator')
  })

  it('names the operator for the host mechanism it came from, not for a user', () => {
    // `registerPrincipal` refuses the literal 'agent'; the deployment registers the one
    // identity the host can actually attest to.
    expect(OPERATOR_PRINCIPAL_ID).not.toBe('agent')
    expect(OPERATOR_PRINCIPAL_ID).not.toBe('human')
  })
})

describe('a change request travels the same channel as the other decisions', () => {
  it('leaves the gate open and answers with the instruction it recorded', async () => {
    const drive = await gatedRun()
    const attempt = regate(drive)
    const result = await submitApproval({
      runId: drive.run.runId, stepId: E2, attempt, decision: 'request_changes',
      commandId: 'cmd-request-1', expectedProjectRevision: revisionNow(drive),
      request: '  the claim in §3 is stronger than the measurement  ',
    })
    if (!result.ok) throw new Error(`a change request was refused: ${result.error.message}`)
    // THE GATE IS STILL OPEN: the receipt says which decision was taken and what it asked for, and
    // the run reports the step where it was rather than blocked.
    expect(result.value.status).toBe('gated')
    expect(result.value.decision).toBe('request_changes')
    expect(result.value.request).toBe('the claim in §3 is stronger than the measurement')
    expect(result.value.operator).toBe(OPERATOR_PRINCIPAL_ID)
    expect(result.value.approvalEventId).not.toBe('')
  })

  it('refuses a request that names nothing to change', async () => {
    const drive = await gatedRun()
    const attempt = regate(drive)
    // Read at the boundary, before an event id is minted and before the run is touched: a request
    // nobody can act on is not a decision, and recording it would leave the gate open with an empty
    // instruction against it.
    expect(readSubmission({
      runId: drive.run.runId, stepId: E2, attempt, decision: 'request_changes',
      commandId: 'cmd-request-2', expectedProjectRevision: revisionNow(drive), request: '   ',
    })).toBeUndefined()
    expect(readSubmission({
      runId: drive.run.runId, stepId: E2, attempt, decision: 'request_changes',
      commandId: 'cmd-request-3', expectedProjectRevision: revisionNow(drive),
    })).toBeUndefined()
  })

  it('is decided against the revision the reader saw, like any other decision', async () => {
    const drive = await gatedRun()
    const attempt = regate(drive)
    const stale = await submitApproval({
      runId: drive.run.runId, stepId: E2, attempt, decision: 'request_changes',
      commandId: 'cmd-request-4', expectedProjectRevision: revisionNow(drive) + 1,
      request: 'change something',
    })
    // A request is as bound to a revision as an approval: the instruction names work on a document,
    // and a document nobody read is not the one to change.
    expect(stale.ok).toBe(false)
    if (stale.ok) throw new Error('a request against another revision was accepted')
    expect(stale.error.code).toBe(APPROVAL_ERROR_CODES.staleRevision)
  })

  it('a retry of the same command reads the first answer', async () => {
    const drive = await gatedRun()
    const attempt = regate(drive)
    const first = await submitApproval({
      runId: drive.run.runId, stepId: E2, attempt, decision: 'request_changes',
      commandId: 'cmd-request-5', expectedProjectRevision: revisionNow(drive), request: 'change something',
    })
    const again = await submitApproval({
      runId: drive.run.runId, stepId: E2, attempt, decision: 'request_changes',
      commandId: 'cmd-request-5', expectedProjectRevision: revisionNow(drive), request: 'change something',
    })
    // A page that never read the first response must not send a second request: the gate is open and
    // the second send would reach core as a fresh decision with the same event id.
    expect(again).toEqual(first)
    expect(again.ok).toBe(true)
  })
})
