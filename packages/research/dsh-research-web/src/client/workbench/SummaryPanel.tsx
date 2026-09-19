/** T26 summary panel: the fixture/snapshot run-summary body (MOCK-labelled). */
import { useState } from 'react'
import type { PanelProps } from './shared.ts'
import { stepNameOf } from '../../panels.ts'
import { artifactName, packageCheckName } from '../record-vocabulary.ts'
import css from '../ResearchView.module.css'

/**
 * Render the research run summary. The data is fixture/snapshot-driven (MOCK) and
 * labelled as such; the view never polls a live run. Shared by the T26
 * conversation-view entry and the workbench Summary tab.
 * @param props - the flattened run summary and the `research` translate `t`.
 */
export interface SummaryPanelProps extends PanelProps {
  /**
   * Ask the host to write the package again, as a draft or as the final one.
   *
   * Absent on a host that cannot export, and the controls are then not rendered at all: a button that
   * calls nothing is worse than no button. The host refuses a final package for the same reasons it
   * states here, so hiding the control is not what enforces anything.
   */
  readonly onExportPackage?: (runId: string, mode: 'draft' | 'final') => Promise<void>
}

export function SummaryPanel({ summary, t, onExportPackage }: SummaryPanelProps) {
  const [exporting, setExporting] = useState<'draft' | 'final' | undefined>(undefined)
  const [exportError, setExportError] = useState<string | undefined>(undefined)
  // The run's working directory, when the host reports one. Null is the host naming none, which is
  // not a directory that projects nothing — that one arrives with `projected: false`.
  const manuscript = summary.manuscriptDirectory

  const exportPackage = (mode: 'draft' | 'final'): void => {
    if (onExportPackage === undefined || exporting !== undefined) return
    setExporting(mode)
    setExportError(undefined)
    void onExportPackage(summary.runId, mode)
      .catch((cause: unknown) => { setExportError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { setExporting(undefined) })
  }

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
              <li key={step.stepId} className={css.stepRow} title={step.stepId}>
                <span className={css.stepIndex}>{step.index}</span>
                <span className={css.stepName}>
                  {step.name}
                  {/* WHAT THE STEP IS FOR, not the identifier it is keyed by: the identifier is on the
                      row's own title, and the sentence is what a reader can act on. */}
                  {step.purpose !== undefined && <small>{step.purpose}</small>}
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
          {summary.steps.map((step) => {
            // WHY A STEP DID NOT PASS. A blocked step is where the reader has to act, and until now
            // the list said only `blocked` — the reason lived behind another tab, in a gate record
            // they had to know to look for. It is the aggregate's own sentence, so a step held
            // because a required check never ran says exactly that.
            const gate = summary.gates.find(entry => entry.stepId === step.stepId && !entry.passed)
            return (
              <li key={step.stepId} className={css.stepRow} title={step.stepId}>
                <span className={css.stepIndex}>{step.index}</span>
                <span className={css.stepName}>
                  {step.name}
                  {step.purpose !== undefined && <small>{step.purpose}</small>}
                </span>
                <span className={css.stepMeta}>
                  <span className={css.tag}>
                    {t('step.attempt', { n: step.attempt })}
                  </span>
                  {step.humanGate && (
                    <span className={`${css.tag} ${css.humanGate}`}>{t('step.humanGate')}</span>
                  )}
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
                {gate !== undefined && (
                  <span className={css.note} data-research-step-reason="">
                    {/* WHICH CHECK, BY NAME. This sentence used to carry the component letter — "check
                        A did not pass" — which names a slot in the trinity and not a question anybody
                        can answer. */}
                    {t('step.gateReason', {
                      component: t(`gate.component.${gate.component}`),
                      reason: gate.rationale,
                    })}
                  </span>
                )}
              </li>
            )
          })}
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
              title={artifact.slug}
            >
              {/* WHAT IT IS CALLED, not the slug the registry keys on; the slug is the row's title, so
                  whoever has to quote it still can. The line under it names the step that produced it —
                  `artifact.summary` is composed by the view from that step's identifier, so showing it
                  put an identifier where a description belongs. */}
              <div className={css.slug}>{artifactName(artifact.slug, t)}</div>
              <div className={css.summary}>
                {t('artifact.producedBy', {
                  step: stepNameOf(summary, artifact.producerStepId),
                  attempt: String(artifact.producerAttemptId),
                })}
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
            <li key={`${gate.stepId}-${gate.component}-${i}`} className={css.gateRow} title={gate.stepId}>
              <span className={`${css.tag} ${css[`gate-${gate.outcome}`]}`}>
                {t(`gate.component.${gate.component}`)}: {t(`gate.outcome.${gate.outcome}`)}
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
              <li key={`${a.stepId}-${a.component}-${i}`} className={css.abstentionRow} title={a.stepId}>
                <span className={`${css.tag} ${css['gate-abstained']}`}>
                  {stepNameOf(summary, a.stepId)} · {t(`gate.component.${a.component}`)}
                </span>
                <div className={css.summary}>
                  {/* THE REASON CODE IS AN AUDIT CODE, and it is labelled as one: `DSH_GATE_…` is what
                      an engineer searches the log for, not an explanation a researcher reads. */}
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
                  {d.stepId !== undefined ? ` · ${stepNameOf(summary, d.stepId)}` : ''}
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
                {/* WHICH PACKAGE THIS IS. A list of filenames read the same whether a person had
                    approved the paper or nothing had been decided yet, and the package a drive
                    writes when it stops at the human gate is always a draft. */}
                {deliverable.kind === 'package' && deliverable.state !== undefined && (
                  <div data-research-package-state={deliverable.state}>
                    <span className={`${css.tag} ${deliverable.state === 'final' ? '' : css['s-blocked']}`}>
                      {deliverable.state === 'final'
                        ? t('deliverables.stateFinal')
                        : t('deliverables.stateDraft')}
                    </span>
                  </div>
                )}
                {deliverable.kind === 'package' && (deliverable.checks?.length ?? 0) > 0 && (
                  <ul className={css.list} data-research-package-checks="">
                    {deliverable.checks?.map(check => (
                      <li key={check.code} className={css.row} data-research-package-check={check.code}>
                        {/* WHICH CONDITION, IN THE READER'S WORDS. `no-refused-sections` is the answer
                            to a question about their manuscript, and the code alone is a key. */}
                        <span className={css.name}>{packageCheckName(check.code, t)}</span>
                        <span className={css.note}>
                          {check.passed ? t('deliverables.checkPassed') : check.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {exportError !== undefined && (
                  <div className={`${css.tag} ${css['s-failed']}`} data-research-package-error="">
                    {t('deliverables.exportRefused', { message: exportError })}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {/* THE ONE DOCUMENT THE RUN MAINTAINS, beside the package and the snapshot. A person who
            opens `manuscript.docx` to fix a sentence has to know which version of the document that
            copy is and whether anything has moved since the run wrote it — and a projection that
            failed does NOT fail the step, so this is the only place it is ever seen.
            THE TWO DRIFT FACTS ARE STATED SEPARATELY, because they have different remedies: a file
            changed on disk is re-projected, a run that moved past the projected version is
            re-rendered. One "out of sync" line would send the reader to the wrong repair. */}
        {manuscript !== null && (
          <ul className={css.list} data-research-manuscript-directory={manuscript.directory}>
            <li className={css.row}>
              <span className={css.name}>
                {t('deliverables.manuscriptDirectory', { directory: manuscript.directory })}
              </span>
              <span className={css.note}>
                {manuscript.projected && manuscript.projectedVersion !== null
                  ? t('deliverables.manuscriptProjected', { version: String(manuscript.projectedVersion) })
                  : t('deliverables.manuscriptNotProjected')}
              </span>
              {manuscript.runMoved && (
                <span className={`${css.tag} ${css['s-gated']}`} data-research-manuscript-moved="">
                  {t('deliverables.manuscriptMoved', {
                    projected: String(manuscript.projectedVersion),
                    current: String(manuscript.currentVersion),
                  })}
                </span>
              )}
              {manuscript.edited.length > 0 && (
                <span className={css.tag} data-research-manuscript-edited="">
                  {t('deliverables.manuscriptEdited', { files: manuscript.edited.join(', ') })}
                </span>
              )}
              {/* The failure is not folded into the drift above: a directory with drifted files is
                  a directory that WAS projected, and a projection that threw is one that was not. */}
              {manuscript.projectionError !== null && (
                <span className={`${css.tag} ${css['s-failed']}`} data-research-manuscript-projection-error="">
                  {t('deliverables.manuscriptProjectionFailed', { message: manuscript.projectionError })}
                </span>
              )}
            </li>
          </ul>
        )}
        {/* THE CONTROLS BELONG TO THE RUN, not to a package file that exists yet: a study taken back
            from a previous process has no export recorded, and a reader on it must still be able to
            ask for one. Absent on a host that cannot export. */}
        {onExportPackage !== undefined && (
          <div className={css.tabs}>
            <button
              type="button"
              className={css.tab}
              data-research-package-export="draft"
              disabled={exporting !== undefined}
              onClick={() => { exportPackage('draft') }}
            >
              {exporting === 'draft' ? t('deliverables.exporting') : t('deliverables.exportDraft')}
            </button>
            <button
              type="button"
              className={css.tab}
              data-research-package-export="final"
              disabled={exporting !== undefined}
              onClick={() => { exportPackage('final') }}
            >
              {exporting === 'final' ? t('deliverables.exporting') : t('deliverables.exportFinal')}
            </button>
          </div>
        )}
        {exportError !== undefined && (
          <div className={`${css.tag} ${css['s-failed']}`} data-research-package-error="">
            {t('deliverables.exportRefused', { message: exportError })}
          </div>
        )}
      </section>
    </div>
  )
}
