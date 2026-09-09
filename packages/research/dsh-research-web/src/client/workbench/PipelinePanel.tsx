/** T27 pipeline panel: the 16-step research pipeline grouped by phase. */
import { selectPipeline } from '../../panels.ts'
import type { PanelProps } from './shared.ts'
import css from './ResearchWorkbench.module.css'

/** Render the run's steps as a phase-grouped pipeline. */
export function PipelinePanel({ summary, t }: PanelProps) {
  const phases = selectPipeline(summary)
  return (
    <section className={css.panel}>
      <h3 className={css.panelHeader}>{t('pipeline.title')}</h3>
      {phases.length === 0
        ? <p className={css.empty}>{t('pipeline.empty')}</p>
        : phases.map(({ phase, steps }) => (
          <div key={phase} className={css.phaseBlock}>
            <div className={css.phaseTitle}>{t('pipeline.phase', { phase })}</div>
            <ul className={css.list}>
              {steps.map(step => (
                <li key={step.stepId} className={css.row}>
                  <span className={css.index}>{step.index}</span>
                  <span className={css.name}>
                    {step.name}
                    <small>
                      {step.stepId} · {t('pipeline.attempt', { n: step.attempt })}
                      {step.humanGate ? ` · ${t('step.humanGate')}` : ''}
                    </small>
                  </span>
                  <span className={css.meta}>
                    {step.holdReason !== undefined && (
                      <span className={css.holdReason}>
                        {t(`step.holdReason.${step.holdReason}`)}
                      </span>
                    )}
                    <span className={`${css.tag} ${css[`s-${step.status}`]}`}>
                      {t(`status.${step.status}`)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </section>
  )
}
