/** Session-recovery panel (会话恢复): shows the run snapshot and a mock restore gesture. */
import { useState } from 'react'
import { loadFixtureSummary } from '../../loader.ts'
import { selectRecovery } from '../../panels.ts'
import type { PanelProps } from './shared.ts'
import css from './ResearchWorkbench.module.css'

/** Render the run snapshot descriptor with a local-only "restore from snapshot" action. */
export function RecoveryPanel({ summary, t }: PanelProps) {
  const [local, setLocal] = useState(summary)
  const [restored, setRestored] = useState(false)
  const view = selectRecovery(local)

  const onRestore = () => {
    setLocal(loadFixtureSummary())
    setRestored(true)
  }

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
      <button type="button" className={css.reloadBtn} onClick={onRestore}>
        {t('recovery.reload')}
      </button>
      {restored && <p className={css.mockNote}>{t('recovery.restored')}</p>}
    </section>
  )
}
