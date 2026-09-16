/**
 * One stage, as the researcher's own view of it: what it produced, what it is doing, what is missing.
 *
 * THE STAGE VIEW IS A VIEW, NOT A SECOND ENGINE. It reads the run's own steps, artifacts and gate
 * verdicts through the selectors in `stages.ts`, and every control it offers comes from a panel that
 * already had one — the approval, retry-save and recovery affordances are the same components the
 * workbench mounted before, reached from the stage that needs them instead of from a tab roster the
 * reader has to translate.
 */
import { selectStageEvidence, type StageView } from '../../stages.ts'
import type { RunSummary } from '../../summary.ts'
import type { ResearchT } from '../locales.ts'
import css from './ResearchWorkbench.module.css'

/** Props for {@link StageWorkspace}. */
export interface StageWorkspaceProps {
  readonly summary: RunSummary
  readonly stage: StageView
  /** Every stage, so a stage waiting on an earlier one can name it. */
  readonly stages: ReadonlyArray<StageView>
  readonly t: ResearchT
}

/** Render one stage. */
export function StageWorkspace({ summary, stage, stages, t }: StageWorkspaceProps) {
  const evidence = selectStageEvidence(summary, stage)
  const blocking = stages.find(candidate => candidate.id === stage.missingPrerequisites[0])
  return (
    <section className={css.panel} data-research-stage-workspace={stage.id} data-research-stage-state={stage.state}>
      <h3 className={css.panelHeader}>{t(`stages.${stage.id}`)}</h3>
      <p className={css.note} data-research-stage-state-reason="">
        {t(`stages.explain.${stage.state}`)}
      </p>
      {blocking !== undefined && (
        <p className={css.mockNote} data-research-stage-blocked-by={blocking.id}>
          {t('stages.waitingFor', { stage: t(`stages.${blocking.id}`) })}
        </p>
      )}

      {stage.declared === 0
        ? (
          // NOT AN EMPTY STATE: this stage is where the person's own question, material and confirmed
          // plan belong, and the page says what it holds rather than rendering a blank panel.
          <p className={css.note} data-research-stage-intake="">{t('stages.intakeNote')}</p>
        )
        : stage.steps.length === 0
          ? (
            // A STAGE WHOSE STEPS THE PROJECTION DID NOT CARRY is not "yours to supply": this build
            // and the host disagree about what the run contains, and the page names the steps it
            // expected instead of rendering the intake note over them.
            <p className={css.mockNote} data-research-stage-missing={stage.id}>
              {t('stages.missingSteps', { steps: stage.missingStepIds.join(', ') })}
            </p>
          )
          : (
            <ul className={css.list} data-research-stage-steps="">
              {stage.steps.map(step => (
                <li key={step.stepId} className={css.row}>
                  <span className={css.index}>{step.index}</span>
                  <span className={css.name}>
                    {step.name}
                    <small>{step.stepId} · {t('pipeline.attempt', { n: step.attempt })}</small>
                  </span>
                  <span className={css.meta}>
                    {/* WHY IT IS STOPPED, IN THE RUN'S OWN WORDS, not only as a coloured tag: a failed
                      step that shows "失败" and no reason is the reading this line exists to stop. */}
                    {step.executeError !== undefined && (
                      <span className={css.holdReason} data-research-step-error={step.stepId}>
                        {step.executeError}
                      </span>
                    )}
                    {step.holdReason !== undefined && (
                      <span className={css.holdReason}>{t(`step.holdReason.${step.holdReason}`)}</span>
                    )}
                    <span className={`${css.tag} ${css[`s-${step.status}`]}`}>{t(`status.${step.status}`)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

      <h4 className={css.panelHeader}>{t('stages.outcomes')}</h4>
      {evidence.artifacts.length === 0
        ? <p className={css.empty} data-research-stage-no-artifacts="">{t('stages.noOutcomes')}</p>
        : (
          <ul className={css.list} data-research-stage-artifacts="">
            {evidence.artifacts.map(artifact => (
              <li key={`${artifact.slug}-${String(artifact.producerAttemptId)}`} className={css.row}>
                <span className={css.name}>
                  {artifact.slug}
                  <small>{artifact.producerStepId} · {artifact.summary}</small>
                </span>
                {artifact.invalidated && <span className={css.holdReason}>{t('artifact.invalidated')}</span>}
              </li>
            ))}
          </ul>
        )}
      {evidence.checksTotal > 0 && (
        <p className={css.note} data-research-stage-checks={stage.id}>
          {t('stages.checks', {
            passed: String(evidence.checksPassed),
            total: String(evidence.checksTotal),
          })}
        </p>
      )}
    </section>
  )
}
