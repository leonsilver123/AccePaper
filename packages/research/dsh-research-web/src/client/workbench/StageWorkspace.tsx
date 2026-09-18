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
import { stepNameOf } from '../../panels.ts'
import type { ArtifactView, GateHistoryEntry, RunSummary, StepView } from '../../summary.ts'
import type { ResearchT } from '../locales.ts'
import { artifactName } from '../record-vocabulary.ts'
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
                <StepRow
                  key={step.stepId}
                  step={step}
                  verdicts={summary.gates.filter(gate => gate.stepId === step.stepId)}
                  outputs={summary.artifacts.filter(artifact => artifact.producerStepId === step.stepId)}
                  t={t}
                />
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
                  {/* WHAT IT IS CALLED, AND WHO PRODUCED IT, both in the reader's words. The slug is
                      not shown here — it is in the step's own expansion above, where whoever has to
                      quote it can find it. `artifact.summary` is not shown either: the view composes
                      that string from the producer's IDENTIFIER and the attempt, so it is an
                      identifier standing where a description belongs. */}
                  {artifactName(artifact.slug, t)}
                  <small>
                    {t('artifact.producedBy', {
                      step: stepNameOf(summary, artifact.producerStepId),
                      attempt: String(artifact.producerAttemptId),
                    })}
                  </small>
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

/** Props for {@link StepRow}. */
interface StepRowProps {
  readonly step: StepView
  readonly verdicts: ReadonlyArray<GateHistoryEntry>
  readonly outputs: ReadonlyArray<ArtifactView>
  readonly t: ResearchT
}

/**
 * One step: what it is, what it is doing, and — one click down — the record it is doing it with.
 *
 * THREE LAYERS, because one was not enough and two were too many. The row a researcher scans carries
 * the step's name and WHAT THE STEP IS FOR, both in the host's own words; the state tag says whether
 * it is waiting on them or cannot go on; and the expansion holds what the record carries — the
 * identifier, the attempt, the three judgement checks, the refusing verdict's own sentence, and the
 * products this step produced.
 *
 * THE IDENTIFIER MOVED DOWN, and that is the point of the expansion existing at all. `D3-writing`
 * used to sit on the row, right under the name: it is the one fact about a step that a researcher
 * cannot read and the one fact an engineer cannot work without, so it belongs where the engineer
 * looks and the researcher does not.
 */
function StepRow({ step, verdicts, outputs, t }: StepRowProps) {
  // THE VERDICTS THAT REFUSED IT, which is what a reader acting on a stopped step needs: a passing
  // verdict is a fact about the step's history, and a failing one is the reason it is where it is.
  const refused = verdicts.filter(verdict => !verdict.passed)
  return (
    <li className={css.stepItem} data-research-step={step.stepId}>
      <div className={css.row}>
        <span className={css.index}>{step.index}</span>
        <span className={css.name}>
          {step.name}
          {step.purpose !== undefined && (
            <small data-research-step-purpose={step.stepId}>{step.purpose}</small>
          )}
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
      </div>
      <details className={css.stepDetails} data-research-step-details={step.stepId}>
        <summary>{t('step.details')}</summary>
        <dl className={css.stepFacts}>
          <dt>{t('step.identifier')}</dt>
          <dd>{step.stepId}</dd>
          <dt>{t('step.attempts')}</dt>
          <dd>{t('pipeline.attempt', { n: step.attempt })}</dd>
          {verdicts.length > 0 && (
            <>
              <dt>{t('step.judgements')}</dt>
              <dd>
                {verdicts.map(verdict => (
                  <span
                    key={`${verdict.component}-${String(verdict.timestamp)}`}
                    className={css.judgement}
                  >
                    {t(`gate.component.${verdict.component}`)} {t(`gate.outcome.${verdict.outcome}`)}
                  </span>
                ))}
              </dd>
            </>
          )}
          {outputs.length > 0 && (
            <>
              <dt>{t('step.produced')}</dt>
              <dd>{outputs.map(output => artifactName(output.slug, t)).join('、')}</dd>
            </>
          )}
        </dl>
        {refused.map(verdict => (
          <p
            key={`${verdict.component}-${String(verdict.timestamp)}`}
            className={css.stepEvidence}
            data-research-step-verdict={step.stepId}
          >
            {verdict.evidence}
          </p>
        ))}
      </details>
    </li>
  )
}
