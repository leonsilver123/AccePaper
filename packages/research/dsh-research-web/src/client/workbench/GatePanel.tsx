/** T29 gate panel: trinity gate history, abstentions, and degradation notes. */
import { stepNameOf } from '../../panels.ts'
import type { PanelProps } from './shared.ts'
import css from './ResearchWorkbench.module.css'

/** Render the consolidated gate-verdict view (components A/B/C, freezes, degradations). */
export function GatePanel({ summary, t }: PanelProps) {
  return (
    <section className={css.panel}>
      <h3 className={css.panelHeader}>{t('gate.title')}</h3>

      {summary.gates.length === 0
        ? <p className={css.empty}>{t('gate.empty')}</p>
        : (
          <ul className={css.list}>
            {summary.gates.map((gate, i) => (
              <li key={`${gate.stepId}-${gate.component}-${i}`} className={css.cell} title={gate.stepId}>
                <span className={`${css.tag} ${css[`gate-${gate.outcome}`]}`}>
                  {/* WHICH CHECK, BY NAME: the component letter names a slot in the trinity, and the
                      step it judged is the fact a reader needs with it. */}
                  {t(`gate.component.${gate.component}`)}: {t(`gate.outcome.${gate.outcome}`)}
                </span>
                <div className={css.summary}>{gate.rationale}</div>
              </li>
            ))}
          </ul>
        )}

      {summary.hasAbstention && (
        <h3 className={css.panelHeader}>{t('section.abstentions')}</h3>
      )}
      {summary.abstentions.map((a, i) => (
        <li key={`${a.stepId}-${a.component}-${i}`} className={css.cell} title={a.stepId}>
          <span className={`${css.tag} ${css['gate-abstained']}`}>
            {stepNameOf(summary, a.stepId)} · {t(`gate.component.${a.component}`)}
          </span>
          <div className={css.summary}>
            {t('abstention.reason', { code: a.reasonCode })} · {a.recordedAt}
          </div>
        </li>
      ))}

      {summary.hasDegradation && (
        <h3 className={css.panelHeader}>{t('section.degradations')}</h3>
      )}
      {summary.degradations.map((d, i) => (
        <li key={i} className={css.cell}>
          <span className={`${css.tag} ${css['s-gated']}`}>
            {t(`degradation.kind.${d.kind}`)}
            {d.stepId !== undefined ? ` · ${stepNameOf(summary, d.stepId)}` : ''}
          </span>
          <div className={css.summary}>{d.message}</div>
        </li>
      ))}
    </section>
  )
}
