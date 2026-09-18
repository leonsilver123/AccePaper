/** T29 adversarial red-team panel: everything touching judgement component A. */
import { selectAdversarial, stepNameOf } from '../../panels.ts'
import { artifactName } from '../record-vocabulary.ts'
import type { PanelProps } from './shared.ts'
import css from './ResearchWorkbench.module.css'

/** Render the focused adversarial red-team review (component A). */
export function AdversarialPanel({ summary, t }: PanelProps) {
  const view = selectAdversarial(summary)
  return (
    <section className={css.panel}>
      <h3 className={css.panelHeader}>{t('adversarial.title')}</h3>
      <p className={css.note}>{t('adversarial.note')}</p>

      <h3 className={css.panelHeader}>{t('adversarial.steps')}</h3>
      {view.steps.length === 0
        ? <p className={css.empty}>{t('adversarial.empty')}</p>
        : (
          <ul className={css.list}>
            {view.steps.map(step => (
              <li key={step.stepId} className={css.row} title={step.stepId}>
                <span className={css.index}>{step.index}</span>
                <span className={css.name}>
                  {step.name}
                  {/* WHAT THE STEP IS FOR, not the identifier it is keyed by: the identifier is the
                      row's own title, and the sentence is what a reader can act on. */}
                  {step.purpose !== undefined && <small>{step.purpose}</small>}
                </span>
                <span className={css.meta}>
                  <span className={`${css.tag} ${css[`s-${step.status}`]}`}>
                    {t(`status.${step.status}`)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

      <h3 className={css.panelHeader}>{t('section.gates')}</h3>
      <ul className={css.list}>
        {view.gates.map((gate, i) => (
          <li key={`${gate.stepId}-${gate.component}-${i}`} className={css.cell}>
            <span className={`${css.tag} ${css[`gate-${gate.outcome}`]}`}>
              {t(`gate.component.${gate.component}`)}: {t(`gate.outcome.${gate.outcome}`)}
            </span>
            <div className={css.summary}>{gate.rationale}</div>
          </li>
        ))}
      </ul>

      <h3 className={css.panelHeader}>{t('adversarial.artifact')}</h3>
      <ul className={css.list}>
        {view.artifacts.map(a => (
          <li key={a.slug} className={css.cell} title={a.slug}>
            <div className={css.slug}>{artifactName(a.slug, t)}</div>
            <div className={css.summary}>
              {t('artifact.producedBy', {
                step: stepNameOf(summary, a.producerStepId),
                attempt: String(a.producerAttemptId),
              })}
            </div>
          </li>
        ))}
      </ul>

      <h3 className={css.panelHeader}>{t('adversarial.abstention')}</h3>
      {view.abstentions.map((a, i) => (
        <li key={`${a.stepId}-${a.component}-${i}`} className={css.cell} title={a.stepId}>
          <span className={`${css.tag} ${css['gate-abstained']}`}>
            {stepNameOf(summary, a.stepId)} · {t(`gate.component.${a.component}`)}
          </span>
          <div className={css.summary}>
            {t('abstention.reason', { code: a.reasonCode })} · {a.recordedAt}
          </div>
        </li>
      ))}
    </section>
  )
}
