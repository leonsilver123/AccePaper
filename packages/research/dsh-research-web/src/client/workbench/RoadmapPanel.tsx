/** T27 roadmap panel: the per-phase layered roadmap rollup (phases A–E). */
import { selectRoadmap } from '../../panels.ts'
import type { PanelProps } from './shared.ts'
import css from './ResearchWorkbench.module.css'

/** Render the phase-rolled research roadmap. */
export function RoadmapPanel({ summary, t }: PanelProps) {
  const phases = selectRoadmap(summary)
  const passed = summary.steps.filter(s => s.status === 'passed').length
  return (
    <section className={css.panel}>
      <h3 className={css.panelHeader}>{t('roadmap.title')}</h3>
      <p className={css.note}>
        {t('roadmap.total', { phases: phases.length, passed, total: summary.totalSteps })}
      </p>
      <ul className={css.list}>
        {phases.map(p => (
          <li key={p.phase} className={css.cell}>
            <div className={css.phaseTitle}>
              {t('roadmap.phase.summary', { phase: p.phase, passed: p.passed, total: p.total })}
            </div>
            <div className={css.summary}>
              {t('status.passed')}: {p.passed} · {t('status.failed')}: {p.failed}
              {' '}· {t('status.gated')}: {p.gated} · {t('status.blocked')}: {p.blocked}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
