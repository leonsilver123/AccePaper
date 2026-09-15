/**
 * Session-recovery panel (会话恢复): reports the run currently on screen.
 *
 * READ-ONLY, and it says so. The panel used to offer a "restore from snapshot" button whose handler
 * reloaded a bundled demo run — a control that looked like it recovered a run and in fact replaced
 * whatever the reader was looking at with invented data.
 */
import { selectRecovery } from '../../panels.ts'
import type { PanelProps } from './shared.ts'
import css from './ResearchWorkbench.module.css'

/**
 * Render the current run's snapshot descriptor.
 * @param props - the flattened run summary and the `research` translate `t`.
 */
export function RecoveryPanel({ summary, t }: PanelProps) {
  const view = selectRecovery(summary)

  return (
    <section className={css.panel}>
      <h3 className={css.panelHeader}>{t('recovery.title')}</h3>
      <p className={css.note}>{t('recovery.note')}</p>
      <div className={css.recoveryGrid}>
        <span className={css.recoveryKey}>{t('recovery.runId')}</span>
        <span className={css.recoveryVal}>{view.runId}</span>
        <span className={css.recoveryKey}>{t('recovery.status')}</span>
        <span className={css.recoveryVal}>{view.status}</span>
        <span className={css.recoveryKey}>{t('recovery.steps')}</span>
        <span className={css.recoveryVal}>{view.totalSteps}</span>
        <span className={css.recoveryKey}>{t('recovery.artifacts')}</span>
        <span className={css.recoveryVal}>{view.validArtifactCount}/{view.artifactCount}</span>
        <span className={css.recoveryKey}>{t('recovery.abstention')}</span>
        <span className={css.recoveryVal}>{view.hasAbstention ? t('recovery.yes') : t('recovery.no')}</span>
        <span className={css.recoveryKey}>{t('recovery.degradation')}</span>
        <span className={css.recoveryVal}>{view.hasDegradation ? t('recovery.yes') : t('recovery.no')}</span>
      </div>
    </section>
  )
}
