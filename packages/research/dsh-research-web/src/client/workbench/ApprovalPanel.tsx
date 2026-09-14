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
import type { ApprovalFailure, ApprovalReceipt, ApprovalSubmitter } from '../approval-source.ts'
import type { PanelProps } from './shared.ts'
import css from './ResearchWorkbench.module.css'

/** Props the panel additionally needs to decide a gate. */
export interface ApprovalPanelProps extends PanelProps {
  /** Submit one decision to the backend. Omitted when this deployment serves no endpoint. */
  readonly onSubmit?: ApprovalSubmitter
  /** Receive the run summary the backend returned after a decision. */
  readonly onDecided?: (summary: RunSummary) => void
}

/** One step's decision in flight, or what came back from the backend. */
type RowState =
  | { readonly kind: 'deciding'; readonly decision: 'approved' | 'rejected' }
  | { readonly kind: 'decided'; readonly receipt: ApprovalReceipt }
  | { readonly kind: 'refused'; readonly code: ApprovalFailure; readonly detail: string }

/** The outcome the panel states above the queue, once one decision has landed. */
type Outcome =
  | { readonly kind: 'decided'; readonly receipt: ApprovalReceipt }
  | { readonly kind: 'refused'; readonly code: ApprovalFailure; readonly detail: string }

/**
 * Render the E2 human-approval queue, wired to the backend's decision endpoint.
 * @param props - the run summary, the `research` translate, and the approval submitter.
 */
export function ApprovalPanel({ summary, t, onSubmit, onDecided }: ApprovalPanelProps) {
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [outcome, setOutcome] = useState<Outcome | undefined>(undefined)

  const settle = useCallback((stepId: string, row: RowState, stated: Outcome) => {
    setRows(current => ({ ...current, [stepId]: row }))
    setOutcome(stated)
  }, [])

  const decide = useCallback((runId: string, stepId: string, attempt: number, decision: 'approved' | 'rejected') => {
    if (onSubmit === undefined) return
    setRows(current => ({ ...current, [stepId]: { kind: 'deciding', decision } }))
    void onSubmit({ runId, stepId, attempt, decision }).then(
      (result) => {
        if (result.ok) {
          settle(stepId, { kind: 'decided', receipt: result.receipt }, { kind: 'decided', receipt: result.receipt })
          // The refreshed summary replaces the one on screen, so every other tab shows the
          // status the backend recorded rather than the one the reader was looking at. The
          // backend applied the decision but could not re-project the run, so there is nothing
          // refreshed to show — the decision itself stands and the panel keeps its receipt.
          if ('summary' in result) onDecided?.(result.summary)
          return
        }
        settle(stepId, { kind: 'refused', code: result.code, detail: result.detail }, { kind: 'refused', code: result.code, detail: result.detail })
      },
      (cause: unknown) => {
        const detail = cause instanceof Error ? cause.message : String(cause)
        settle(stepId, { kind: 'refused', code: 'transport', detail }, { kind: 'refused', code: 'transport', detail })
      },
    )
  }, [onSubmit, onDecided, settle])

  const detailKey = (code: ApprovalFailure) =>
    code === 'unavailable' ? 'approval.unavailable' : `approval.failure.${code}` as const

  return (
    <section className={css.panel}>
      <h3 className={css.panelHeader}>{t('approval.title')}</h3>
      <p className={css.note}>{onSubmit === undefined ? t('approval.disabled') : t('approval.note')}</p>

      {/* The receipt is stated once, above the queue: a decision drains its own row when the
          backend's refreshed summary arrives, so this is where "who decided what" survives.
          A refusal stays on its row, where the buttons that produced it are. */}
      {outcome?.kind === 'decided' && (
        <p className={css.tag}>
          {t('approval.receipt')
            .replace('{stepId}', outcome.receipt.stepId)
            .replace('{attempt}', String(outcome.receipt.attempt))
            .replace('{decision}', t(outcome.receipt.decision === 'approved' ? 'approval.decided.approved' : 'approval.decided.rejected'))
            .replace('{operator}', outcome.receipt.operator)}
        </p>
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
                  </span>
                  <span className={css.meta}>
                    {row?.kind === 'refused' && (
                      <small>{t(detailKey(row.code)).replace('{detail}', row.detail)}</small>
                    )}
                    {row?.kind === 'decided'
                      ? (
                        <span className={`${css.tag} ${css[row.receipt.decision === 'approved' ? 's-passed' : 's-failed']}`}>
                          {t(row.receipt.decision === 'approved' ? 'approval.decided.approved' : 'approval.decided.rejected')}
                        </span>
                      )
                      : (
                        <>
                          <button
                            type="button"
                            className={css.approveBtn}
                            disabled={onSubmit === undefined || row?.kind === 'deciding'}
                            onClick={() => { decide(summary.runId, step.stepId, step.attempt, 'approved') }}
                          >
                            {row?.kind === 'deciding' ? t('approval.submitting') : t('approval.approve')}
                          </button>
                          <button
                            type="button"
                            className={css.rejectBtn}
                            disabled={onSubmit === undefined || row?.kind === 'deciding'}
                            onClick={() => { decide(summary.runId, step.stepId, step.attempt, 'rejected') }}
                          >
                            {t('approval.reject')}
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
