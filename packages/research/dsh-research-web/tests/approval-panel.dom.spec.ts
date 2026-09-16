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
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

  it('asks the submitter for exactly this run, step and attempt', async () => {
    const onSubmit = vi.fn<ApprovalSubmitter>().mockResolvedValue({
      ok: true,
      receipt: { runId: 'run_approval_001', stepId: 'E2-submit', attempt: 2, status: 'passed', operator: 'authenticated-browser-operator', decision: 'approved', approvalEventId: 'evt-1', decidedAt: 1, persisted: true },
      summary: toRunSummary({ ...gatedInput(), steps: [] }),
    })
    openApprovalTab({ summary: toRunSummary(gatedInput()), onApprove: onSubmit })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['approval.approve'] })) })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      runId: 'run_approval_001', stepId: 'E2-submit', attempt: 2, decision: 'approved',
    } satisfies ApprovalRequest)
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

  it('posts the four fields to the research-approval channel, and nothing else', async () => {
    const connection = connectionDouble({
      ok: true,
      value: {
        runId: 'run_1', stepId: 'E2-submit', attempt: 3, status: 'passed',
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
      .toEqual(['attempt', 'decision', 'runId', 'stepId'])
    expect(outcome.ok).toBe(true)
    // `summary` is on ONE of the two applied-and-ok outcomes: the other carries `summaryUnavailable`
    // instead, because a decision whose refresh failed is still a decision.
    if (outcome.ok && 'summary' in outcome) {
      expect(outcome.receipt.operator).toBe('authenticated-browser-operator')
      expect(outcome.receipt.decision).toBe('approved')
      expect(outcome.summary.runId).toBe('run_1')
    }
  })

  it('reads the decision from the recorded status, not from a field the payload could set', async () => {
    const connection = connectionDouble({
      ok: true,
      value: {
        runId: 'run_1', stepId: 'E2-submit', attempt: 3, status: 'blocked',
        operator: 'authenticated-browser-operator', approvalEventId: 'evt-1', decidedAt: 1, persisted: true,
        snapshot: passedSnapshot('run_1'),
      },
    })
    const outcome = await buildApprovalSubmitter(() => connection.service)(request)

    // A `blocked` status is a rejection however the request was phrased.
    expect(outcome.ok && outcome.receipt.decision).toBe('rejected')
  })

  it('refuses a receipt that does not say whether the decision was saved', async () => {
    // The signature of a host built before the field existed. Defaulting it would invent the one
    // fact this channel exists to carry, and the operator would decide whether to close the page
    // on a guess.
    const connection = connectionDouble({
      ok: true,
      value: {
        runId: 'run_1', stepId: 'E2-submit', attempt: 3, status: 'passed',
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
