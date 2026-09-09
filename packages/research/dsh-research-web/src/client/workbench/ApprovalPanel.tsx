/** Human-approval panel (人工审批): E2 human-pending steps with local-only demo controls. */
import { useState } from 'react'
import type { PanelProps } from './shared.ts'
import css from './ResearchWorkbench.module.css'

/** Local, display-only decision for one human-pending step (never reaches a gateway). */
type Decision = 'approved' | 'rejected'

/** Render the E2 human-approval queue with mock approve/reject controls. */
export function ApprovalPanel({ summary, t }: PanelProps) {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})

  if (summary.humanPending.length === 0) {
    return (
      <section className={css.panel}>
        <h3 className={css.panelHeader}>{t('approval.title')}</h3>
        <p className={css.empty}>{t('approval.empty')}</p>
      </section>
    )
  }

  return (
    <section className={css.panel}>
      <h3 className={css.panelHeader}>{t('approval.title')}</h3>
      <p className={css.note}>{t('approval.note')}</p>
      <ul className={css.list}>
        {summary.humanPending.map((step) => {
          const decision = decisions[step.stepId]
          return (
            <li key={step.stepId} className={css.decisionRow}>
              <span className={css.name}>
                {step.name}
                <small>{step.stepId} · {t('step.humanGate')}</small>
              </span>
              {decision === undefined
                ? (
                  <span className={css.meta}>
                    <button
                      type="button"
                      className={css.approveBtn}
                      onClick={() => { setDecisions(d => ({ ...d, [step.stepId]: 'approved' })) }}
                    >
                      {t('approval.approve')}
                    </button>
                    <button
                      type="button"
                      className={css.rejectBtn}
                      onClick={() => { setDecisions(d => ({ ...d, [step.stepId]: 'rejected' })) }}
                    >
                      {t('approval.reject')}
                    </button>
                  </span>
                )
                : (
                  <span className={`${css.tag} ${css[decision === 'approved' ? 's-passed' : 's-failed']}`}>
                    {t(decision === 'approved' ? 'approval.decided.approved' : 'approval.decided.rejected')}
                  </span>
                )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
