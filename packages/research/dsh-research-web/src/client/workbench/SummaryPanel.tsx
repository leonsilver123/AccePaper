/** T26 summary panel: the fixture/snapshot run-summary body (MOCK-labelled). */
import type { PanelProps } from './shared.ts'
import css from '../ResearchView.module.css'

/**
 * Render the research run summary. The data is fixture/snapshot-driven (MOCK) and
 * labelled as such; the view never polls a live run. Shared by the T26
 * conversation-view entry and the workbench Summary tab.
 * @param props - the flattened run summary and the `research` translate `t`.
 */
export function SummaryPanel({ summary, t }: PanelProps) {
  return (
    <div className={css.root}>
      <span className={css.mockBadge}>{t('mock.badge')}</span>

      <header className={css.header}>
        <h2>{t('view.research')}</h2>
        <span className={css.runId}>{summary.runId}</span>
        <span className={`${css.statusPill} ${css[`status-${summary.status}`]}`}>
          {t(`status.${summary.status}`)}
        </span>
      </header>

      {summary.humanPending.length > 0 && (
        <section className={`${css.section} ${css.humanPending}`}>
          <h3 className={css.sectionTitle}>{t('section.humanPending')}</h3>
          <p className={css.note}>{t('humanPending.note')}</p>
          <ul className={css.stepList}>
            {summary.humanPending.map(step => (
              <li key={step.stepId} className={css.stepRow}>
                <span className={css.stepIndex}>{step.index}</span>
                <span className={css.stepName}>
                  {step.name}
                  <small>{step.stepId}</small>
                </span>
                <span className={css.stepMeta}>
                  <span className={`${css.tag} ${css.humanGate}`}>{t('step.humanGate')}</span>
                  {step.holdReason !== undefined && (
                    <span className={css.holdReason}>
                      {t(`step.holdReason.${step.holdReason}`)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={css.section}>
        <h3 className={css.sectionTitle}>
          {t('section.steps')} · {t('steps.total', { total: summary.totalSteps })}
        </h3>
        <p className={css.note}>
          {t('steps.byStatus', {
            passed: summary.byStatus.passed,
            in_progress: summary.byStatus.in_progress,
            gated: summary.byStatus.gated,
            blocked: summary.byStatus.blocked,
            failed: summary.byStatus.failed,
            pending: summary.byStatus.pending,
          })}
        </p>
        <ul className={css.stepList}>
          {summary.steps.map(step => (
            <li key={step.stepId} className={css.stepRow}>
              <span className={css.stepIndex}>{step.index}</span>
              <span className={css.stepName}>
                {step.name}
                <small>{step.stepId} · {t('step.attempt', { n: step.attempt })}{step.humanGate ? ` · ${t('step.humanGate')}` : ''}</small>
              </span>
              <span className={css.stepMeta}>
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
      </section>

      <section className={css.section}>
        <h3 className={css.sectionTitle}>
          {t('section.artifacts')} · {t('artifacts.count', {
            valid: summary.validArtifactCount,
            total: summary.artifactCount,
          })}
        </h3>
        <ul className={css.artifactList}>
          {summary.artifacts.map(artifact => (
            <li
              key={artifact.slug}
              className={`${css.artifactRow} ${artifact.invalidated ? css.invalidated : ''}`}
            >
              <div className={css.slug}>{artifact.slug}</div>
              <div className={css.summary}>
                {artifact.summary}
                {artifact.invalidated && ` (${t('artifacts.invalidated')})`}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className={css.section}>
        <h3 className={css.sectionTitle}>{t('section.gates')}</h3>
        <ul className={css.gateList}>
          {summary.gates.map((gate, i) => (
            <li key={`${gate.stepId}-${gate.component}-${i}`} className={css.gateRow}>
              <span className={`${css.tag} ${css[`gate-${gate.outcome}`]}`}>
                {t('gate.component', { component: gate.component })}: {t(`gate.outcome.${gate.outcome}`)}
              </span>
              <div className={css.summary}>{gate.rationale}</div>
            </li>
          ))}
        </ul>
      </section>

      {summary.hasAbstention && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('section.abstentions')}</h3>
          <ul className={css.abstentionList}>
            {summary.abstentions.map((a, i) => (
              <li key={`${a.stepId}-${a.component}-${i}`} className={css.abstentionRow}>
                <span className={`${css.tag} ${css['gate-abstained']}`}>
                  {a.stepId} · {t('gate.component', { component: a.component })}
                </span>
                <div className={css.summary}>
                  {t('abstention.reason', { code: a.reasonCode })} · {a.recordedAt}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary.hasDegradation && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('section.degradations')}</h3>
          <ul className={css.degradationList}>
            {summary.degradations.map((d, i) => (
              <li key={i} className={css.degradationRow}>
                <span className={`${css.tag} ${css['s-gated']}`}>
                  {t(`degradation.kind.${d.kind}`)}
                  {d.stepId !== undefined ? ` · ${d.stepId}` : ''}
                </span>
                <div className={css.summary}>{d.message}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
