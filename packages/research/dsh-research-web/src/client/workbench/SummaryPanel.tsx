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
      {/* The badge states where the numbers came from: this panel is used both by the
          workbench (which may hold a real run) and by the fixture-only view. */}
      <span className={css.mockBadge}>{summary.isMock ? t('mock.badge') : t('source.live')}</span>

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
                {/* A step that failed mid-execution stays `in_progress` in the engine — it is
                    rollback-able — while its outcome records the error. Showing only the status
                    told a person the run was still working, and named no cause. */}
                {step.executeError !== undefined && (
                  <span className={`${css.tag} ${css['s-failed']}`}>
                    {t('step.executeError', { message: step.executeError })}
                  </span>
                )}
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

      {/* What the run left on disk. The Host has reported this since the export and the durable
          snapshot landed; the view received it and rendered nothing, so a person asking where the
          files went had no answer in the product. */}
      <section className={css.section}>
        <h3 className={css.sectionTitle}>{t('section.deliverables')}</h3>
        <p className={css.note}>{t('deliverables.note')}</p>
        {summary.deliverables.length === 0 ? (
          <p className={css.note}>{t('deliverables.none')}</p>
        ) : (
          <ul className={css.stepList}>
            {summary.deliverables.map(deliverable => (
              <li key={deliverable.kind} className={css.stepRow}>
                <span className={css.stepName}>{t(`deliverables.${deliverable.kind}`)}</span>
                <span className={css.stepMeta}>
                  {deliverable.error !== undefined && (
                    <span className={`${css.tag} ${css['s-failed']}`}>
                      {t('deliverables.failed', { message: deliverable.error })}
                    </span>
                  )}
                  {deliverable.revision !== null && (
                    <span className={css.tag}>{t('deliverables.revision', { revision: String(deliverable.revision) })}</span>
                  )}
                </span>
                {deliverable.directory !== undefined && (
                  <div className={css.summary}>
                    {t('deliverables.directory', { directory: deliverable.directory })}
                  </div>
                )}
                {deliverable.files.length > 0 && (
                  <div className={css.summary}>
                    {deliverable.files
                      .map(file => `${file.path} (${String(file.bytes)} B)`)
                      .join(', ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
