/**
 * The dialog a run starts from: state the field, choose a direction, confirm.
 *
 * WHY A DIALOG AND NOT THE RUN BUTTON. The pipeline used to be started with one click, and what it
 * would study was a constant in the runner's source. A run now carries a plan, so a person has to
 * say what it is about — and the criterion the run will be graded against is the part that most
 * needs a reader, because it is the one sentence a person can check before several minutes of work
 * rather than after.
 *
 * WHAT IT DOES NOT DO. It composes no sentence about the proposals: every line it prints is either
 * locale copy or the model's own words, and the criterion is rendered from the plan's declared
 * commitment rather than from a description of it. It also does not validate: the host refuses an
 * unusable proposal before this dialog ever sees it, and the refusals it reports are the host's own
 * reasons.
 */

import { useState } from 'react'

import type { ResearchKey, ResearchT } from '../locales.ts'
import type { WirePlan, WireProposalAnswer } from '../direction-source.ts'
import css from './ResearchWorkbench.module.css'

/** The bound a commitment declares, as a locale key. */
const BOUND_KEY: Readonly<Record<string, ResearchKey>> = {
  'at-least': 'propose.bound.atLeast',
  'at-most': 'propose.bound.atMost',
  within: 'propose.bound.within',
}

/** The channel a proposal answer came from, as a locale key. */
const CHANNEL_KEY: Readonly<Record<string, ResearchKey>> = {
  llm: 'propose.channel.llm',
  deterministic: 'propose.channel.deterministic',
}

/** Props for {@link DirectionDialog}. */
export interface DirectionDialogProps {
  /** The `research` namespace translate. */
  readonly t: ResearchT
  /** Ask the host for directions in a field. Resolves with what it could propose. */
  readonly onPropose: (field: string) => Promise<WireProposalAnswer>
  /** Run the confirmed plan. */
  readonly onConfirm: (plan: WirePlan) => void
  /** Close without running. */
  readonly onCancel: () => void
}

/** Which step of the dialog the person is on. */
type DialogPhase = 'field' | 'asking' | 'choosing'

/**
 * Render the run dialog.
 * @param props - the translate, the proposal seam, and the confirm and cancel handlers.
 */
export function DirectionDialog({ t, onPropose, onConfirm, onCancel }: DirectionDialogProps) {
  const [field, setField] = useState('')
  const [phase, setPhase] = useState<DialogPhase>('field')
  const [answer, setAnswer] = useState<WireProposalAnswer | undefined>(undefined)
  const [chosen, setChosen] = useState(0)
  const [error, setError] = useState<string | undefined>(undefined)

  const ask = (): void => {
    setPhase('asking')
    setError(undefined)
    void onPropose(field).then(
      (result) => {
        setAnswer(result)
        setChosen(0)
        setPhase('choosing')
      },
      (cause: unknown) => {
        // A request that failed is reported as a failure. Falling back to the default plan would
        // start a run about something the person did not choose, and label it as their choice.
        setError(cause instanceof Error ? cause.message : String(cause))
        setPhase('field')
      },
    )
  }

  const proposals = answer?.proposals ?? []
  const selected = proposals[chosen]

  return (
    <div className={css.dialogBackdrop} data-research-dialog="">
      <div className={css.dialog} role="dialog" aria-modal="true" aria-label={t('propose.title')}>
        <h3 className={css.panelHeader}>{t('propose.title')}</h3>
        <p className={css.note}>{t('propose.note')}</p>

        <label className={css.dialogField} htmlFor="research-field">{t('propose.fieldLabel')}</label>
        <input
          id="research-field"
          className={css.dialogInput}
          value={field}
          onChange={(event) => { setField(event.target.value) }}
          placeholder={t('propose.fieldPlaceholder')}
          disabled={phase !== 'field'}
          data-research-field=""
        />

        {phase === 'field' && (
          <div className={css.dialogActions}>
            <button type="button" className={css.tab} onClick={ask} data-research-ask="">
              {t('propose.ask')}
            </button>
            <button type="button" className={css.tab} onClick={onCancel} data-research-cancel="">
              {t('propose.cancel')}
            </button>
          </div>
        )}

        {phase === 'asking' && <p className={css.note}>{t('propose.asking')}</p>}

        {error !== undefined && (
          <p className={css.mockNote} data-research-propose-error="">
            {t('propose.failed').replace('{message}', error)}
          </p>
        )}

        {phase === 'choosing' && (
          <>
            <p className={css.note} data-research-channel="">
              {t('propose.channel', { channel: t(CHANNEL_KEY[answer?.channel ?? ''] ?? 'propose.channel.unknown') })}
            </p>
            {proposals.length === 0
              ? <p className={css.mockNote} data-research-no-proposals="">{t('propose.none')}</p>
              : (
                <ul className={css.proposalList} data-research-proposals="">
                  {proposals.map((proposal, index) => (
                    <li className={css.proposal} key={proposal.plan.claim.id}>
                      <label className={css.proposalChoice}>
                        <input
                          type="radio"
                          name="research-proposal"
                          checked={index === chosen}
                          onChange={() => { setChosen(index) }}
                        />
                        <span className={css.proposalTitle}>{proposal.title}</span>
                      </label>
                      <p className={css.note}>{proposal.direction}</p>
                      <p className={css.note}>{proposal.claim}</p>
                      <p className={css.note}>{proposal.plan.claim.prediction}</p>
                      <p className={css.note} data-research-criterion="">
                        {t('propose.criterion', {
                          bound: t(BOUND_KEY[proposal.plan.commitment?.bound ?? ''] ?? 'propose.bound.unknown'),
                          threshold: String(proposal.plan.commitment?.thresholdPct ?? ''),
                          metric: proposal.plan.metric.label,
                        })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            {answer !== undefined && answer.refusals.length > 0 && (
              // Stated rather than dropped: an answer whose every block was refused must not look
              // like an answer that proposed nothing, which are two different things to tell a
              // person.
              <p className={css.mockNote} data-research-refusals="">
                {t('propose.refused', { count: String(answer.refusals.length) })}
              </p>
            )}
            <div className={css.dialogActions}>
              <button
                type="button"
                className={css.tab}
                onClick={() => { if (selected !== undefined) onConfirm(selected.plan) }}
                disabled={selected === undefined}
                data-research-confirm=""
              >
                {t('propose.confirm')}
              </button>
              <button type="button" className={css.tab} onClick={onCancel} data-research-cancel="">
                {t('propose.cancel')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
