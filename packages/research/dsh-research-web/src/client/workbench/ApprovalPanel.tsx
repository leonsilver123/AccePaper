/**
 * Human-approval panel (人工审批): decides the `E2-submit` human gate for real.
 *
 * The panel used to keep a local `decisions` map and show "approved (demo)" without calling
 * anything — the reader was shown a decision the backend had never heard of. It now submits the
 * reader's decision over the host's browser-authenticated channel and renders what the backend
 * recorded back: the step's status, the attempt it belonged to, and the operator the host
 * attested. A refusal states the reason instead of showing a decision.
 *
 * The buttons are DISABLED when no submitter was supplied — a deployment whose browser trust
 * surface is absent serves no approval endpoint, and a button that cannot reach one must say so
 * rather than pretend.
 */
import { useCallback, useState } from 'react'
import type { RunSummary } from '../../summary.ts'
import { newApprovalCommandId } from '../approval-source.ts'
import type { ApprovalFailure, ApprovalReceipt, ApprovalSubmitter } from '../approval-source.ts'
import type { PanelProps } from './shared.ts'
import css from './ResearchWorkbench.module.css'

/** Props the panel additionally needs to decide a gate. */
export interface ApprovalPanelProps extends PanelProps {
  /** Submit one decision to the backend. Omitted when this deployment serves no endpoint. */
  readonly onSubmit?: ApprovalSubmitter
  /** Receive the run summary the backend returned after a decision. */
  readonly onDecided?: (summary: RunSummary) => void
  /**
   * Whether the page's link is live enough for a decision.
   *
   * A decision is about a revision, and a page that cannot reach the deployment cannot know the run is
   * still at the one it is showing. The backend refuses a stale decision anyway; this is what keeps a
   * person from spending a click to learn that. Defaults to true for callers that have no link to
   * report — the specs and any host that mounts the panel alone.
   */
  readonly writesAllowed?: boolean
}

/**
 * One step's decision in flight, or what came back from the backend.
 *
 * `commandId` travels with the intent so a RETRY reuses it: a transport failure leaves the reader
 * looking at a button they already pressed, and pressing it again has to be the same command.
 * Changing the decision mints a new one, because that is a different intent.
 */
/** What the panel can ask the backend to do. */
type Decision = 'approved' | 'rejected' | 'request_changes'

type RowState =
  | { readonly kind: 'deciding'; readonly decision: Decision; readonly commandId: string }
  | { readonly kind: 'decided'; readonly receipt: ApprovalReceipt }
  | {
    readonly kind: 'refused'
    readonly code: ApprovalFailure
    readonly detail: string
    readonly decision: Decision
    readonly commandId: string
  }

/** The tag colour for each recorded decision: a request is neither a pass nor a failure. */
const ROW_TAG_CLASS: Readonly<Record<Decision, string>> = {
  approved: 's-passed',
  rejected: 's-failed',
  request_changes: 's-gated',
}

/** The outcome the panel states above the queue, once one decision has landed. */
type Outcome =
  | {
    readonly kind: 'decided'
    readonly receipt: ApprovalReceipt
    /** Why no refreshed run is on screen, when there is none. The decision still stands. */
    readonly summaryFailure?: string | undefined
  }
  | { readonly kind: 'refused'; readonly code: ApprovalFailure; readonly detail: string }

/**
 * Render the E2 human-approval queue, wired to the backend's decision endpoint.
 * @param props - the run summary, the `research` translate, and the approval submitter.
 */
export function ApprovalPanel({ summary, t, onSubmit, onDecided, writesAllowed = true }: ApprovalPanelProps) {
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [outcome, setOutcome] = useState<Outcome | undefined>(undefined)
  // WHAT THE PERSON WANTS CHANGED, per step, while they type it. Held here rather than inside the
  // row so the text survives the button being pressed and a refusal coming back.
  const [requests, setRequests] = useState<Record<string, string>>({})

  const settle = useCallback((stepId: string, row: RowState, stated: Outcome) => {
    setRows(current => ({ ...current, [stepId]: row }))
    setOutcome(stated)
  }, [])

  // A DECISION NEEDS A REVISION TO BE ABOUT. A page that cannot say which one it is showing cannot
  // promise the reader decided about what they read, so the buttons are not offered.
  const revision = summary.projectRevision
  const decide = useCallback((runId: string, stepId: string, attempt: number, decision: Decision) => {
    if (onSubmit === undefined || revision === null) return
    // A CHANGE REQUEST WITHOUT AN INSTRUCTION IS NOT OFFERED. The backend refuses one that names
    // nothing, and the panel does not send a decision it knows will be refused — the button stays
    // disabled until the person says what to change.
    const request = requests[stepId]?.trim()
    if (decision === 'request_changes' && (request === undefined || request === '')) return
    // Same intent, same command: a retry after a failure must not become a second decision.
    const previous = rows[stepId]
    const commandId = previous !== undefined && previous.kind === 'refused' && previous.decision === decision
      ? previous.commandId
      : newApprovalCommandId()
    setRows(current => ({ ...current, [stepId]: { kind: 'deciding', decision, commandId } }))
    void onSubmit({
      runId, stepId, attempt, decision, commandId,
      // The revision on screen. The backend refuses a decision about any other.
      expectedProjectRevision: revision,
      ...(decision === 'request_changes' && request !== undefined ? { request } : {}),
    }).then(
      (result) => {
        if (result.ok) {
          // THE DECISION STANDS WHATEVER ELSE FAILED. A summary that could not be built and a
          // decision that did not reach disk are two different facts about a decision that WAS
          // made, and each is stated beside it rather than instead of it.
          const summaryFailure = 'summaryUnavailable' in result ? result.summaryFailure : undefined
          const stated: Outcome = {
            kind: 'decided',
            receipt: result.receipt,
            ...(summaryFailure === undefined ? {} : { summaryFailure }),
          }
          settle(stepId, { kind: 'decided', receipt: result.receipt }, stated)
          // The refreshed summary replaces the one on screen, so every other tab shows the
          // status the backend recorded rather than the one the reader was looking at. When
          // there is nothing refreshed to show, the panel keeps its receipt.
          if ('summary' in result) onDecided?.(result.summary)
          return
        }
        settle(
          stepId,
          { kind: 'refused', code: result.code, detail: result.detail, decision, commandId },
          { kind: 'refused', code: result.code, detail: result.detail },
        )
      },
      (cause: unknown) => {
        const detail = cause instanceof Error ? cause.message : String(cause)
        settle(
          stepId,
          { kind: 'refused', code: 'transport', detail, decision, commandId },
          { kind: 'refused', code: 'transport', detail },
        )
      },
    )
  }, [onSubmit, onDecided, settle, rows, revision, requests])

  const detailKey = (code: ApprovalFailure) =>
    code === 'unavailable' ? 'approval.unavailable' : `approval.failure.${code}` as const

  return (
    <section className={css.panel}>
      <h3 className={css.panelHeader}>{t('approval.title')}</h3>
      <p className={css.note}>
        {onSubmit === undefined
          ? t('approval.disabled')
          : revision === null ? t('approval.noRevision')
            : writesAllowed ? t('approval.note') : t('approval.offline')}
      </p>

      {/* The receipt is stated once, above the queue: a decision drains its own row when the
          backend's refreshed summary arrives, so this is where "who decided what" survives.
          A refusal stays on its row, where the buttons that produced it are. */}
      {outcome?.kind === 'decided' && (
        <>
          <p className={css.tag}>
            {t('approval.receipt')
              .replace('{stepId}', outcome.receipt.stepId)
              .replace('{attempt}', String(outcome.receipt.attempt))
              .replace('{decision}', t(`approval.decided.${outcome.receipt.decision}`))
              .replace('{operator}', outcome.receipt.operator)}
          </p>
          {/* A DECISION THIS PROCESS HOLDS AND THE DISK DOES NOT. The operator is told they can not
              rely on it surviving a restart, which is the fact that decides whether they may close
              the page — and it is stated as what it is, not as a failed approval. */}
          {/* WHAT WAS ASKED FOR, as the backend recorded it. It is the whole content of the
              decision, and a receipt that said only "changes requested" would leave the person
              who must act on it with nothing. */}
          {outcome.receipt.request !== undefined && (
            <p className={css.note} data-research-approval-request="">
              {t('approval.requestRecorded').replace('{request}', outcome.receipt.request)}
            </p>
          )}
          {!outcome.receipt.persisted && (
            <p className={css.refusal}>
              {t('approval.notPersisted').replace('{detail}', outcome.receipt.persistenceError ?? '')}
            </p>
          )}
          {outcome.summaryFailure !== undefined && (
            <p className={css.note}>
              {t('approval.summaryUnavailable').replace('{detail}', outcome.summaryFailure)}
            </p>
          )}
        </>
      )}

      {summary.humanPending.length === 0
        ? <p className={css.empty}>{t('approval.empty')}</p>
        : (
          <ul className={css.list}>
            {summary.humanPending.map((step) => {
              const row = rows[step.stepId]
              return (
                <li key={step.stepId} className={css.decisionRow}>
                  <span className={css.name}>
                    {step.name}
                    <small>{step.stepId} · {t('step.humanGate')} · {t('approval.attempt').replace('{attempt}', String(step.attempt))}</small>
                    {/* WHAT WAS ALREADY DECIDED, for a page that was not there when it was: the
                        gate is open because a change request left it open, and the person looking
                        at it now has to be able to read what was asked for without asking anyone. */}
                    {step.approval !== undefined && row === undefined && (
                      <small data-research-recorded-decision={step.stepId}>
                        {t(`approval.decided.${step.approval.decision}`)}
                        {' · '}
                        {step.approval.operator}
                        {step.approval.rationale === undefined
                          ? ''
                          : ` · ${t('approval.requestRecorded').replace('{request}', step.approval.rationale)}`}
                      </small>
                    )}
                  </span>
                  <span className={css.meta}>
                    {row?.kind === 'refused' && (
                      <small>{t(detailKey(row.code)).replace('{detail}', row.detail)}</small>
                    )}
                    {row?.kind === 'decided'
                      ? (
                        // The recorded decision, in all three of its values: a change request that
                        // rendered as "rejected" would report a stopped study where the gate is in
                        // fact still open and waiting for the work it asked for.
                        <span
                          className={`${css.tag} ${css[ROW_TAG_CLASS[row.receipt.decision]]}`}
                          data-research-decision={row.receipt.decision}
                        >
                          {t(`approval.decided.${row.receipt.decision}`)}
                        </span>
                      )
                      : (
                        <>
                          <button
                            type="button"
                            className={css.approveBtn}
                            disabled={onSubmit === undefined || revision === null || !writesAllowed || row?.kind === 'deciding'}
                            onClick={() => { decide(summary.runId, step.stepId, step.attempt, 'approved') }}
                          >
                            {row?.kind === 'deciding' ? t('approval.submitting') : t('approval.approve')}
                          </button>
                          <button
                            type="button"
                            className={css.rejectBtn}
                            disabled={onSubmit === undefined || revision === null || !writesAllowed || row?.kind === 'deciding'}
                            onClick={() => { decide(summary.runId, step.stepId, step.attempt, 'rejected') }}
                          >
                            {t('approval.reject')}
                          </button>
                          {/* THE ACTION BETWEEN THE TWO. Approving passes work the person may not
                              accept and rejecting stops a study they want continued; asking for a
                              change is what they actually mean, and it leaves the gate open. */}
                          <input
                            type="text"
                            className={css.requestInput}
                            aria-label={t('approval.requestLabel')}
                            placeholder={t('approval.requestPlaceholder')}
                            value={requests[step.stepId] ?? ''}
                            onChange={(event) => {
                              const value = event.target.value
                              setRequests(current => ({ ...current, [step.stepId]: value }))
                            }}
                          />
                          <button
                            type="button"
                            className={css.rejectBtn}
                            data-research-request-changes={step.stepId}
                            disabled={onSubmit === undefined || revision === null || !writesAllowed
                              || row?.kind === 'deciding' || (requests[step.stepId] ?? '').trim() === ''}
                            onClick={() => { decide(summary.runId, step.stepId, step.attempt, 'request_changes') }}
                          >
                            {t('approval.requestChanges')}
                          </button>
                        </>
                      )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
    </section>
  )
}
