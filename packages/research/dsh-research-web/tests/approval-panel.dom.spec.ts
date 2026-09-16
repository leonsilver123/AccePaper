// @vitest-environment jsdom
/**
 * Human approval in the workbench: the panel against its submitter, and the submitter against
 * the wire.
 *
 * Integration-verified only — the real React components and the real transport module run here,
 * with the Connection client and the backend replaced by doubles. No 1120 server is started, so
 * nothing here is Runtime-verified.
 *
 * What these pin, in ENGINEERING-CONTRACT §8.1 terms: the panel decides nothing by itself (a
 * refusal leaves the run untouched, and only the backend's returned summary replaces what is on
 * screen); the request carries exactly the four decidable fields, so a client cannot smuggle an
 * `actor` or a `status` into the decision; and a deployment with no authenticated channel
 * disables the buttons instead of showing a decision nobody made.
 */

import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toRunSummary, type RunSummaryInput } from '../src/summary.ts'
import { en } from '../src/client/locales.ts'
import {
  APPROVAL_CHANNEL,
  APPROVAL_DECIDE_ENDPOINT,
  buildApprovalSubmitter,
  type ApprovalRequest,
  type ApprovalSubmitter,
} from '../src/client/approval-source.ts'
import { ResearchWorkbench } from '../src/client/workbench/ResearchWorkbench.tsx'

/**
 * Translate double over a plain dictionary (first hit wins, `{name}` interpolated), mirroring
 * the locale runtime the other component specs use.
 * @param dicts - dictionaries consulted in order.
 * @returns the translate function.
 */
function makeTranslate(...dicts: ReadonlyArray<Record<string, string>>) {
  return (key: string, params?: Record<string, unknown>): string => {
    let template = key
    for (const dict of dicts) {
      const hit = dict[key]
      if (hit !== undefined) {
        template = hit
        break
      }
    }
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match)
  }
}

const t = makeTranslate(en)

/** One run whose only unfinished step is the E2 human gate. */
function gatedInput(runId = 'run_approval_001'): RunSummaryInput {
  return {
    runId,
    source: 'live',
    // A decision is about a revision, so the panel needs one to offer the buttons at all. The tests
    // that are ABOUT a missing revision override this to `undefined`.
    projectRevision: 1,
    status: 'completed',
    steps: [
      {
        stepId: 'E2-submit', index: 16, phase: 'E', name: 'Submission', status: 'gated',
        attempt: 2, humanGate: true, holdReason: 'human_gate', gateOutcomes: [],
      },
    ],
    artifacts: [],
    gates: [],
    abstentions: [],
    degradations: [],
    deliverables: [],
  }
}

/** The wire snapshot the backend returns after a decision: the same run, now passed. */
function passedSnapshot(runId = 'run_approval_001') {
  return {
    run: { runId, steps: [] },
    catalog: [],
    gates: [],
    artifacts: [],
    steps: [{ stepId: 'E2-submit', status: 'passed', attempt: 2, holdReason: null }],
  }
}

/** Render the workbench and open its approval tab. */
function openApprovalTab(props: Record<string, unknown>) {
  render(createElement(ResearchWorkbench, { t, ...props }))
  fireEvent.click(screen.getByRole('button', { name: en['tab.approval'] }))
}

afterEach(cleanup)

describe('the approval panel decides nothing by itself', () => {
  it('disables both buttons when no authenticated channel is available', () => {
    openApprovalTab({ summary: toRunSummary(gatedInput()) })

    expect(screen.getByText(en['approval.disabled'])).toBeTruthy()
    for (const label of [en['approval.approve'], en['approval.reject']]) {
      expect(screen.getByRole('button', { name: label }).hasAttribute('disabled')).toBe(true)
    }
  })

  it('names the project revision the page is showing, and says nothing when the host named none', () => {
    // The exported package's manifest carries the same number, so this is what lets a reader tell
    // whether the page and the download describe one state of the study or two.
    openApprovalTab({ summary: toRunSummary({ ...gatedInput(), projectRevision: 7 }) })
    expect(screen.getByText(en['run.revision'].replace('{revision}', '7'))).toBeTruthy()
    cleanup()

    // Named none, shown none: revision 0 is a state a run genuinely starts at, so rendering it here
    // would name a revision nobody read.
    openApprovalTab({ summary: toRunSummary({ ...gatedInput(), projectRevision: undefined }) })
    expect(screen.queryByText(en['run.revision'].replace('{revision}', '0'))).toBeNull()
  })

  it('says an evaluation run cannot be a submission package', () => {
    // The one thing a reader must be able to tell from a green screen. It is stated as its own fact
    // rather than inferred from the status, because a finished demonstration is still finished.
    openApprovalTab({
      summary: toRunSummary({
        ...gatedInput(),
        evidenceProfile: 'evaluation',
        profileEligible: false,
        submissionReady: false,
        readinessNote: 'the deployment evidence profile is evaluation',
      }),
    })

    expect(screen.getByText(en['readiness.profile.evaluation'])).toBeTruthy()
    expect(screen.getByText(new RegExp(en['readiness.notReady']))).toBeTruthy()
  })

  it('says readiness is unknown rather than guessing when the host named none', () => {
    openApprovalTab({ summary: toRunSummary(gatedInput()) })

    expect(screen.getByText(en['readiness.profile.unknown'])).toBeTruthy()
    expect(screen.getByText(en['readiness.unknown'])).toBeTruthy()
    // Not the comfortable answer: an unstated readiness is not a ready one.
    expect(screen.queryByText(en['readiness.ready'])).toBeNull()
  })

  it('asks the submitter for exactly this run, step and attempt', async () => {
    const onSubmit = vi.fn<ApprovalSubmitter>().mockResolvedValue({
      ok: true,
      receipt: { runId: 'run_approval_001', stepId: 'E2-submit', attempt: 2, status: 'passed', operator: 'authenticated-browser-operator', decision: 'approved', approvalEventId: 'evt-1', decidedAt: 1, persisted: true },
      summary: toRunSummary({ ...gatedInput(), steps: [] }),
    })
    openApprovalTab({ summary: toRunSummary(gatedInput()), onApprove: onSubmit })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['approval.approve'] })) })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      runId: 'run_approval_001', stepId: 'E2-submit', attempt: 2, decision: 'approved',
    } satisfies Partial<ApprovalRequest>)
    // And it carries a command id of its own, which is what makes a retry a retry.
    expect(onSubmit.mock.calls[0]?.[0]?.commandId).toEqual(expect.any(String))
  })

  it('renders the receipt the backend returned, naming the operator it attested', async () => {
    const onSubmit = vi.fn<ApprovalSubmitter>().mockResolvedValue({
      ok: true,
      receipt: { runId: 'run_approval_001', stepId: 'E2-submit', attempt: 2, status: 'passed', operator: 'authenticated-browser-operator', decision: 'approved', approvalEventId: 'evt-1', decidedAt: 1, persisted: true },
      summary: toRunSummary(gatedInput()),
    })
    openApprovalTab({ summary: toRunSummary(gatedInput()), onApprove: onSubmit })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['approval.approve'] })) })

    expect(screen.getByText(en['approval.receipt']
      .replace('{stepId}', 'E2-submit')
      .replace('{attempt}', '2')
      .replace('{decision}', en['approval.decided.approved'])
      .replace('{operator}', 'authenticated-browser-operator'))).toBeTruthy()
  })

  it('replaces what is on screen only with the summary the backend returned', async () => {
    const onSubmit = vi.fn<ApprovalSubmitter>().mockResolvedValue({
      ok: true,
      receipt: { runId: 'run_approval_001', stepId: 'E2-submit', attempt: 2, status: 'passed', operator: 'authenticated-browser-operator', decision: 'approved', approvalEventId: 'evt-1', decidedAt: 1, persisted: true },
      summary: toRunSummary({ ...gatedInput(), steps: [] }),
    })
    openApprovalTab({ summary: toRunSummary(gatedInput()), onApprove: onSubmit })

    // Before the decision the queue lists the gate.
    expect(screen.getByRole('button', { name: en['approval.approve'] })).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['approval.approve'] })) })

    // The queue drains because the BACKEND's summary replaced the one on screen. A panel that
    // decided locally could not produce this: it holds no step status of its own.
    expect(screen.getByText(en['approval.empty'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: en['approval.approve'] })).toBeNull()
  })

  it('states a refusal and leaves the gate pending', async () => {
    const onSubmit = vi.fn<ApprovalSubmitter>().mockResolvedValue({
      ok: false,
      code: 'refused',
      detail: '[research/approval-not-pending] step E2-submit is passed, not gated',
    })
    openApprovalTab({ summary: toRunSummary(gatedInput()), onApprove: onSubmit })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['approval.approve'] })) })

    expect(screen.getByText(en['approval.failure.refused']
      .replace('{detail}', '[research/approval-not-pending] step E2-submit is passed, not gated'))).toBeTruthy()
    expect(screen.queryByText(/approval\.decided/)).toBeNull()
    // The step is still listed as awaiting a human: no local decision was invented.
    expect(screen.getByRole('button', { name: en['approval.approve'] })).toBeTruthy()
  })

  it('shows a rejected decision as rejected, never as approved', async () => {
    const onSubmit = vi.fn<ApprovalSubmitter>().mockResolvedValue({
      ok: true,
      receipt: { runId: 'run_approval_001', stepId: 'E2-submit', attempt: 2, status: 'blocked', operator: 'authenticated-browser-operator', decision: 'rejected', approvalEventId: 'evt-1', decidedAt: 1, persisted: true },
      summary: toRunSummary(gatedInput()),
    })
    openApprovalTab({ summary: toRunSummary(gatedInput()), onApprove: onSubmit })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['approval.reject'] })) })

    expect(screen.queryByText(new RegExp(en['approval.decided.approved']))).toBeNull()
    expect(screen.getByText(en['approval.receipt']
      .replace('{stepId}', 'E2-submit')
      .replace('{attempt}', '2')
      .replace('{decision}', en['approval.decided.rejected'])
      .replace('{operator}', 'authenticated-browser-operator'))).toBeTruthy()
  })

  it('says a decision stands and was NOT saved, instead of showing it as refused', async () => {
    // The backend distinguishes "applied" from "saved" and returns both. The panel used to drop the
    // second, so an operator whose approval existed only in the server's memory read exactly like
    // one that reached disk — and would close the page. The receipt stays; the warning joins it.
    const onSubmit = vi.fn<ApprovalSubmitter>().mockResolvedValue({
      ok: true,
      receipt: {
        runId: 'run_approval_001', stepId: 'E2-submit', attempt: 2, status: 'passed',
        operator: 'authenticated-browser-operator', decision: 'approved',
        approvalEventId: 'evt-1', decidedAt: 1, persisted: false,
        persistenceError: 'no snapshot directory is configured for this deployment',
      },
      summary: toRunSummary(gatedInput()),
    })
    openApprovalTab({ summary: toRunSummary(gatedInput()), onApprove: onSubmit })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['approval.approve'] })) })

    expect(screen.getByText(en['approval.notPersisted']
      .replace('{detail}', 'no snapshot directory is configured for this deployment'))).toBeTruthy()
    // And it is NOT reported as a refusal: the decision is the backend's, and it happened.
    expect(screen.queryByText(en['approval.failure.transport'].replace('{detail}', ''))).toBeNull()
    expect(screen.getByText(en['approval.decided.approved'])).toBeTruthy()
  })

  it('keeps the receipt when the refreshed run could not be read', async () => {
    // A projection failure is not a decision failure. The backend applied and saved the decision;
    // this client could not build a summary from what came back. Saying "the approval failed" would
    // send the operator to press the button again, which at best answers `not-pending`.
    const onSubmit = vi.fn<ApprovalSubmitter>().mockResolvedValue({
      ok: true,
      receipt: {
        runId: 'run_approval_001', stepId: 'E2-submit', attempt: 2, status: 'passed',
        operator: 'authenticated-browser-operator', decision: 'approved',
        approvalEventId: 'evt-1', decidedAt: 1, persisted: true,
      },
      summaryUnavailable: true,
      summaryFailure: 'the refreshed run could not be read: snapshot.steps is not an object',
    })
    openApprovalTab({ summary: toRunSummary(gatedInput()), onApprove: onSubmit })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['approval.approve'] })) })

    expect(screen.getByText(en['approval.summaryUnavailable']
      .replace('{detail}', 'the refreshed run could not be read: snapshot.steps is not an object'))).toBeTruthy()
    // The receipt is still on screen: the decision is what the operator came for.
    expect(screen.getByText(en['approval.receipt']
      .replace('{stepId}', 'E2-submit')
      .replace('{attempt}', '2')
      .replace('{decision}', en['approval.decided.approved'])
      .replace('{operator}', 'authenticated-browser-operator'))).toBeTruthy()
    // And nothing claims it was not saved.
    expect(screen.queryByText(en['approval.notPersisted'].replace('{detail}', ''))).toBeNull()
  })

  it('says WHY a step did not pass, on the step itself', () => {
    // A blocked step is where the reader has to act. The list said only `blocked`; the reason lived
    // behind another tab in a gate record they had to know to look for. It is the aggregate's own
    // sentence, so a step held because a required check never ran says exactly that.
    // The step list lives on the overview tab, so this opens that one.
    render(createElement(ResearchWorkbench, {
      t,
      summary: toRunSummary({
        ...gatedInput(),
        steps: [
          ...gatedInput().steps,
          {
            stepId: 'D3-writing', index: 13, phase: 'D', name: 'Writing', status: 'blocked',
            attempt: 1, humanGate: false, gateOutcomes: [],
          },
        ],
        gates: [{
          stepId: 'D3-writing', component: 'A', outcome: 'blocked', passed: false, timestamp: 1,
          evidence: 'e',
          rationale: 'required check(s) reported not_evaluated: red-stat — a check that did not run has found nothing',
        }],
      }),
    }))
    fireEvent.click(screen.getByRole('button', { name: en['tab.summary'] }))

    expect(screen.getByText(en['step.gateReason']
      .replace('{component}', 'A')
      .replace('{reason}', 'required check(s) reported not_evaluated: red-stat — a check that did not run has found nothing')))
      .toBeTruthy()
  })

  it('offers no buttons at all when the page cannot name a revision', async () => {
    // A decision is about a REVISION. A page that cannot say which one it is showing cannot promise
    // the reader decided about what they read, so it does not offer the button and says why.
    const onSubmit = vi.fn<ApprovalSubmitter>()
    openApprovalTab({ summary: toRunSummary({ ...gatedInput(), projectRevision: undefined }), onApprove: onSubmit })

    expect(screen.getByText(en['approval.noRevision'])).toBeTruthy()
    for (const label of [en['approval.approve'], en['approval.reject']]) {
      expect(screen.getByRole('button', { name: label }).hasAttribute('disabled')).toBe(true)
    }
    // And pressing one anyway decides nothing.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['approval.approve'] })) })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('retries under the SAME command id, and a changed mind under a new one', async () => {
    // The reader presses Approve, the call times out, and the button is offered again. Pressing it
    // has to be the same command — otherwise the backend sees a second decision, refuses it as
    // `not-pending`, and the reader cannot tell that apart from "my approval never landed".
    const onSubmit = vi.fn<ApprovalSubmitter>()
      .mockResolvedValueOnce({ ok: false, code: 'transport', detail: 'the request timed out' })
      .mockResolvedValueOnce({ ok: false, code: 'transport', detail: 'the request timed out again' })
      .mockResolvedValueOnce({
        ok: true,
        receipt: {
          runId: 'run_approval_001', stepId: 'E2-submit', attempt: 2, status: 'blocked',
          operator: 'authenticated-browser-operator', decision: 'rejected',
          approvalEventId: 'evt-1', decidedAt: 1, persisted: true,
        },
        summary: toRunSummary(gatedInput()),
      })
    openApprovalTab({ summary: toRunSummary(gatedInput()), onApprove: onSubmit })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['approval.approve'] })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['approval.approve'] })) })
    const first = onSubmit.mock.calls[0]?.[0]?.commandId
    const retry = onSubmit.mock.calls[1]?.[0]?.commandId
    expect(first).toBe(retry)

    // Rejecting after an approval failed is a DIFFERENT intent, and gets its own command.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['approval.reject'] })) })
    expect(onSubmit.mock.calls[2]?.[0]?.commandId).not.toBe(first)
  })

  it('reports a transport failure instead of a decision', async () => {
    const onSubmit = vi.fn<ApprovalSubmitter>().mockResolvedValue({
      ok: false,
      code: 'transport',
      detail: 'HTTP 401',
    })
    openApprovalTab({ summary: toRunSummary(gatedInput()), onApprove: onSubmit })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['approval.approve'] })) })

    expect(screen.getByText(en['approval.failure.transport'].replace('{detail}', 'HTTP 401'))).toBeTruthy()
  })
})

describe('the approval request carries exactly the decidable fields', () => {
  /** A Connection client double recording every call. */
  function connectionDouble(result: unknown) {
    const calls: Array<{ channel: string; endpoint: string; payload: unknown }> = []
    return {
      calls,
      service: {
        rpc: {
          call(channel: string, endpoint: string, payload: unknown) {
            calls.push({ channel, endpoint, payload })
            return Promise.resolve(result)
          },
        },
      },
    }
  }

  const request: ApprovalRequest = { runId: 'run_1', stepId: 'E2-submit', attempt: 3, decision: 'approved' }

  it('posts the decidable fields to the research-approval channel, and nothing else', async () => {
    const connection = connectionDouble({
      ok: true,
      value: {
        runId: 'run_1', stepId: 'E2-submit', attempt: 3, status: 'passed', decision: 'approved',
        operator: 'authenticated-browser-operator', approvalEventId: 'evt-1', decidedAt: 1, persisted: true,
        snapshot: passedSnapshot('run_1'),
      },
    })
    const submit = buildApprovalSubmitter(() => connection.service)

    const outcome = await submit(request)

    expect(connection.calls).toHaveLength(1)
    expect(connection.calls[0]?.channel).toBe(APPROVAL_CHANNEL)
    expect(connection.calls[0]?.endpoint).toBe(APPROVAL_DECIDE_ENDPOINT)
    // The payload is the four fields verbatim: no `actor`, no `status`, no `principalId`.
    expect(connection.calls[0]?.payload).toEqual(request)
    expect(Object.keys(connection.calls[0]?.payload as object).sort())
      .toEqual(['attempt', 'commandId', 'decision', 'expectedProjectRevision', 'runId', 'stepId'])
    expect(outcome.ok).toBe(true)
    // `summary` is on ONE of the two applied-and-ok outcomes: the other carries `summaryUnavailable`
    // instead, because a decision whose refresh failed is still a decision.
    if (outcome.ok && 'summary' in outcome) {
      expect(outcome.receipt.operator).toBe('authenticated-browser-operator')
      expect(outcome.receipt.decision).toBe('approved')
      expect(outcome.summary.runId).toBe('run_1')
    }
  })

  it('reads the decision the backend recorded, and refuses a receipt that names none', async () => {
    // WHAT CHANGED, AND WHY. The decision used to be derived from the status (`passed` meant
    // approved, anything else rejected). A change request breaks that reading: its status stays
    // `gated`, so a derived decision reports a rejection the operator did not make and hides the
    // instruction they did write. The decision is now read from the backend's own field, and a host
    // that does not send one is reported as a different build rather than guessed at.
    const recorded = connectionDouble({
      ok: true,
      value: {
        runId: 'run_1', stepId: 'E2-submit', attempt: 3, status: 'blocked', decision: 'rejected',
        operator: 'authenticated-browser-operator', approvalEventId: 'evt-1', decidedAt: 1, persisted: true,
        snapshot: passedSnapshot('run_1'),
      },
    })
    const rejected = await buildApprovalSubmitter(() => recorded.service)(request)
    expect(rejected.ok && rejected.receipt.decision).toBe('rejected')

    const silent = connectionDouble({
      ok: true,
      value: {
        runId: 'run_1', stepId: 'E2-submit', attempt: 3, status: 'blocked',
        operator: 'authenticated-browser-operator', approvalEventId: 'evt-1', decidedAt: 1, persisted: true,
        snapshot: passedSnapshot('run_1'),
      },
    })
    const unnamed = await buildApprovalSubmitter(() => silent.service)(request)
    expect(unnamed.ok).toBe(false)
  })

  it('refuses a receipt that does not say whether the decision was saved', async () => {
    // The signature of a host built before the field existed. Defaulting it would invent the one
    // fact this channel exists to carry, and the operator would decide whether to close the page
    // on a guess.
    const connection = connectionDouble({
      ok: true,
      value: {
        runId: 'run_1', stepId: 'E2-submit', attempt: 3, status: 'passed', decision: 'approved',
        operator: 'authenticated-browser-operator', approvalEventId: 'evt-1', decidedAt: 1,
        snapshot: passedSnapshot('run_1'),
      },
    })

    const outcome = await buildApprovalSubmitter(() => connection.service)(request)

    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? undefined : outcome.code).toBe('malformed')
    expect(outcome.ok ? undefined : outcome.detail).toContain('the host and this client are not the same build')
  })

  it('reports the backend refusal with its own message', async () => {
    const connection = connectionDouble({
      ok: false,
      error: { code: 'research/approval-stale-attempt', message: '[research/approval-stale-attempt] step E2-submit is at attempt 4, not 3', details: {} },
    })
    const outcome = await buildApprovalSubmitter(() => connection.service)(request)

    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.code).toBe('refused')
    expect(outcome.ok ? '' : outcome.detail).toContain('attempt 4, not 3')
  })

  it('reports a value that is not a decision as unreadable', async () => {
    const outcome = await buildApprovalSubmitter(() => connectionDouble({ ok: true, value: { status: 'passed' } }).service)(request)

    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.code).toBe('malformed')
  })

  it('reports a failed call as a transport failure', async () => {
    const outcome = await buildApprovalSubmitter(() => ({
      rpc: { call: () => Promise.reject(new Error('HTTP 401')) },
    }))(request)

    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.code).toBe('transport')
    expect(outcome.ok ? '' : outcome.detail).toBe('HTTP 401')
  })

  it('reports an absent connection service as unavailable rather than throwing', async () => {
    for (const candidate of [undefined, null, {}, { rpc: {} }]) {
      const outcome = await buildApprovalSubmitter(() => candidate)(request)
      expect(outcome.ok ? '' : outcome.code).toBe('unavailable')
    }
  })
})

// ===========================================================================
// S6: the change request, from the panel to the receipt.
//
// The gate had two outcomes and the person had three intents: approving passed work they may not
// accept, rejecting stopped a study they wanted continued, and "change this and show me again" had
// nowhere to go. These cases are about the third one — that it cannot be sent empty, that it leaves
// the gate open, and that the receipt carries the instruction back.
// ===========================================================================
describe('a change request at the gate', () => {
  it('cannot be sent without saying what to change', () => {
    const onSubmit = vi.fn(() => Promise.resolve({
      ok: true as const,
      receipt: {
        runId: 'run_approval_001', stepId: 'E2-submit', attempt: 2, status: 'gated',
        operator: 'operator', decision: 'request_changes' as const, request: 'x',
        approvalEventId: 'evt-1', decidedAt: 1, persisted: true,
      },
    }))
    openApprovalTab({ summary: toRunSummary(gatedInput()), onApprove: onSubmit })

    const button = screen.getByRole('button', { name: en['approval.requestChanges'] })
    // BEFORE THE FIELD IS FILLED the action is not offered: the backend refuses a request that names
    // nothing, and a button that would send one teaches the person a refusal they cannot fix.
    expect((button as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText(en['approval.requestLabel']), { target: { value: '   ' } })
    expect((button as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText(en['approval.requestLabel']), { target: { value: 'tighten §3' } })
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(button)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      decision: 'request_changes', request: 'tighten §3',
    })
  })

  it('shows the instruction the backend recorded, when the decision landed', async () => {
    const onSubmit = vi.fn(() => Promise.resolve({
      ok: true as const,
      receipt: {
        runId: 'run_approval_001', stepId: 'E2-submit', attempt: 2, status: 'gated',
        operator: 'operator', decision: 'request_changes' as const, request: 'tighten §3',
        approvalEventId: 'evt-1', decidedAt: 1, persisted: true,
      },
    }))
    openApprovalTab({ summary: toRunSummary(gatedInput()), onApprove: onSubmit })
    fireEvent.change(screen.getByLabelText(en['approval.requestLabel']), { target: { value: 'tighten §3' } })
    fireEvent.click(screen.getByRole('button', { name: en['approval.requestChanges'] }))

    // THE RECEIPT SAYS WHAT WAS ASKED FOR, not only that something was: the instruction is the whole
    // content of the decision, and whoever acts on it has to be able to read it back.
    const recorded = await screen.findByText(new RegExp(en['approval.requestRecorded'].split('{')[0] as string))
    expect(recorded.textContent).toContain('tighten §3')
    // And it is stated as a request, never as an approval or a rejection.
    expect(screen.getAllByText(en['approval.decided.request_changes']).length).toBeGreaterThan(0)
  })

  it('leaves the decision with the person when the backend refuses it', () => {
    const onSubmit = vi.fn(() => Promise.resolve({
      ok: false as const, code: 'staleRevision' as const, detail: 'the run moved',
    }))
    openApprovalTab({ summary: toRunSummary(gatedInput()), onApprove: onSubmit })
    fireEvent.change(screen.getByLabelText(en['approval.requestLabel']), { target: { value: 'tighten §3' } })
    fireEvent.click(screen.getByRole('button', { name: en['approval.requestChanges'] }))

    // The text the person wrote is still in the field: a refusal they must act on (re-read, then ask
    // again) should not also cost them what they typed.
    return waitFor(() => {
      expect((screen.getByLabelText(en['approval.requestLabel']) as HTMLInputElement).value).toBe('tighten §3')
    })
  })
})

describe('a decision a page did not make', () => {
  it('is stated on the step, from the run’s own record', () => {
    // A page that reloaded — or was never open — must still be able to read what was decided and
    // what was asked for. The gate is open because a change request left it open, and the row says
    // so rather than showing a decision-free gate that invites the same request twice.
    openApprovalTab({
      onApprove: vi.fn(() => Promise.resolve({
        ok: true as const,
        receipt: {
          runId: 'run_approval_001', stepId: 'E2-submit', attempt: 2, status: 'gated',
          operator: 'operator', decision: 'request_changes' as const, request: 'tighten §3',
          approvalEventId: 'evt-1', decidedAt: 1, persisted: true,
        },
      })),
      summary: toRunSummary({
        ...gatedInput(),
        steps: [{
          stepId: 'E2-submit', index: 16, phase: 'E', name: 'Submission', status: 'gated',
          attempt: 2, humanGate: true, holdReason: 'human_gate', gateOutcomes: [],
          approval: {
            decision: 'request_changes' as const,
            operator: 'authenticated-browser-operator',
            decidedAt: 1,
            rationale: 'tighten §3',
            targetRefs: [{ artifactId: 'manuscript', version: 3 }],
          },
        }],
      }),
    })

    const stated = document.querySelector('[data-research-recorded-decision="E2-submit"]')
    expect(stated?.textContent).toContain(en['approval.decided.request_changes'])
    expect(stated?.textContent).toContain('tighten §3')
    // The instruction is still readable AND the decision is still the reader's to make or change.
    expect((screen.getAllByRole('button', { name: en['approval.approve'] })[0] as HTMLButtonElement).disabled)
      .toBe(false)
  })

  it('renders no decision at all when the host reports none', () => {
    openApprovalTab({ summary: toRunSummary(gatedInput()) })
    // Not "decided nothing": a host that reports no decision has said nothing, and the row shows
    // nothing rather than an empty verdict.
    expect(document.querySelector('[data-research-recorded-decision]')).toBeNull()
  })
})
