/**
 * The revision loop, as a person reads it: what was asked for, what answered it, and what the checks
 * said about that answer.
 *
 * EVERY LINE COMES FROM THE HOST. The request, its candidates and their reviews are read back from
 * the deployment's own records, so a reload shows the same loop rather than an empty panel — and the
 * panel holds no state of its own beyond which operation is in flight.
 *
 * WHAT IS NOT OFFERED, DELIBERATELY: an accept. A candidate cannot be made the official manuscript
 * yet — that needs the accepting transaction the module design describes as a core operation with
 * its own production caller — and a control that appeared here would be a remedy this deployment does
 * not have. The panel says so instead.
 */
import { useCallback, useEffect, useState } from 'react'
import type { WireRevisionView } from '../../run-source.ts'
import type { PanelProps } from './shared.ts'
import css from './ResearchWorkbench.module.css'

/** What the workbench hands the panel: the read, and the two operations that move a loop along. */
export interface RevisionSource {
  /** The revisions this deployment holds for one run. */
  readonly list: (runId: string) => Promise<ReadonlyArray<WireRevisionView>>
  /** Record a request to change the manuscript at the gate. */
  readonly request: (input: {
    readonly runId: string
    readonly stepId: string
    readonly instruction: string
  }) => Promise<WireRevisionView>
  /** Write a candidate for a request, or judge one. */
  readonly step: (call: {
    readonly runId: string
    readonly requestId: string
    readonly candidateId: string
    readonly operation: 'generate' | 'review'
  }) => Promise<WireRevisionView>
}

/** Props for {@link RevisionPanel}. */
export interface RevisionPanelProps extends PanelProps {
  /** Omitted by a host that cannot record or read revisions, which then shows no loop. */
  readonly revisions?: RevisionSource
  /**
   * Whether the page's link is live enough to move the loop along.
   *
   * Writing a candidate and reviewing one both change the run's records, and a page that cannot reach
   * the deployment cannot know they still describe what it is showing. Defaults to true for callers
   * with no link to report.
   */
  readonly writesAllowed?: boolean
}

/** Render the revision loop for the run on screen. */
export function RevisionPanel({ summary, t, revisions, writesAllowed = true }: RevisionPanelProps) {
  const [held, setHeld] = useState<ReadonlyArray<WireRevisionView>>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState<string | undefined>(undefined)

  const read = useCallback((): void => {
    if (revisions === undefined) return
    void revisions.list(summary.runId).then(
      (entries) => { setHeld(entries) },
      (cause: unknown) => {
        // A LIST THAT COULD NOT BE READ IS REPORTED, not rendered as "no revisions": the two facts
        // have different remedies, and one of them is not "you never asked".
        setError(cause instanceof Error ? cause.message : String(cause))
      },
    )
  }, [revisions, summary.runId])

  useEffect(() => { read() }, [read])

  const run = useCallback((key: string, work: () => Promise<WireRevisionView>): void => {
    setBusy(key)
    setError(undefined)
    void work().then(
      () => { setBusy(undefined); read() },
      (cause: unknown) => {
        setBusy(undefined)
        setError(cause instanceof Error ? cause.message : String(cause))
      },
    )
  }, [read])

  /**
   * Write a candidate for one request.
   *
   * The source is read here rather than at the render site, so the buttons close over the value the
   * panel actually has instead of asserting one into existence.
   *
   * @param requestId - the request to answer.
   */
  const generate = useCallback((requestId: string): void => {
    if (revisions === undefined || !writesAllowed) return
    run(requestId, () => revisions.step({
      runId: summary.runId, requestId, candidateId: '', operation: 'generate',
    }))
  }, [revisions, run, summary.runId, writesAllowed])

  /**
   * Judge one candidate.
   *
   * @param requestId - the request the candidate answers.
   * @param candidateId - the candidate to judge.
   */
  const review = useCallback((requestId: string, candidateId: string): void => {
    if (revisions === undefined || !writesAllowed) return
    run(candidateId, () => revisions.step({
      runId: summary.runId, requestId, candidateId, operation: 'review',
    }))
  }, [revisions, run, summary.runId])

  return (
    <section className={css.panel} data-research-revisions="">
      <h3 className={css.panelHeader}>{t('revision.title')}</h3>
      <p className={css.note}>{t('revision.note')}</p>
      {error !== undefined && <p className={css.refusal}>{t('revision.failed').replace('{message}', error)}</p>}
      {held.length === 0
        ? <p className={css.empty} data-research-revisions-empty="">{t('revision.empty')}</p>
        : held.map(revision => (
          <div key={revision.requestId} className={css.phaseBlock} data-research-revision={revision.requestId}>
            <div className={css.phaseTitle}>{t('revision.requestTitle')}</div>
            <p className={css.note} data-research-revision-instruction="">
              {revision.instruction}
            </p>
            <p className={css.note}>
              {t('revision.by')
                .replace('{operator}', revision.operator)
                .replace('{revision}', String(revision.projectRevision))}
              {' · '}
              {revision.targets.length === 0
                ? t('revision.wholeManuscript')
                : t('revision.targets').replace('{sections}', revision.targets.join(', '))}
            </p>
            {revision.candidates.length === 0
              ? (
                <button
                  type="button"
                  className={css.tab}
                  data-research-generate={revision.requestId}
                  disabled={revisions === undefined || !writesAllowed || busy !== undefined}
                  onClick={() => { generate(revision.requestId) }}
                >
                  {busy === revision.requestId ? t('revision.generating') : t('revision.generate')}
                </button>
              )
              : revision.candidates.map((candidate) => {
                const recorded = revision.reviews.find(entry => entry.candidateId === candidate.candidateId)
                return (
                  <div key={candidate.candidateId} data-research-candidate={candidate.candidateId}>
                    <p className={css.note}>
                      {t('revision.candidate').replace('{writer}', candidate.writer)}
                    </p>
                    {candidate.sections.filter(section => section.changed).map(section => (
                      <div key={section.sectionId} data-research-diff={section.sectionId}>
                        <div className={css.phaseTitle}>{section.heading}</div>
                        {/* BEFORE AND AFTER, both from the host: a page that showed only the new
                            text would be asking the reader to remember the old one. */}
                        <p className={css.note}>{t('revision.before')}</p>
                        <pre className={css.cell}>{section.basisText}</pre>
                        <p className={css.note}>{t('revision.after')}</p>
                        <pre className={css.cell}>{section.bodyText}</pre>
                      </div>
                    ))}
                    {candidate.sections.every(section => !section.changed) && (
                      <p className={css.note}>{t('revision.unchanged')}</p>
                    )}
                    {recorded === undefined
                      ? (
                        <button
                          type="button"
                          className={css.tab}
                          data-research-review={candidate.candidateId}
                          disabled={revisions === undefined || !writesAllowed || busy !== undefined}
                          onClick={() => { review(revision.requestId, candidate.candidateId) }}
                        >
                          {busy === candidate.candidateId ? t('revision.reviewing') : t('revision.review')}
                        </button>
                      )
                      : (
                        <div data-research-review-report={candidate.candidateId} data-research-review-passed={String(recorded.passed)}>
                          <p className={css.note}>
                            {recorded.passed ? t('revision.reviewPassed') : t('revision.reviewFailed')}
                          </p>
                          <ul className={css.list}>
                            {recorded.findings.map(finding => (
                              <li key={finding.check} className={css.row}>
                                <span className={css.name}>
                                  {t(`revision.check.${finding.check}` as 'revision.check.numbers')}
                                  <small>{finding.detail}</small>
                                </span>
                                <span className={`${css.tag} ${finding.passed ? css['s-passed'] : css['s-failed']}`}>
                                  {finding.passed ? t('revision.checkPassed') : t('revision.checkFailed')}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                  </div>
                )
              })}
          </div>
        ))}
      {/* WHAT THIS PANEL DOES NOT DO, said where a person would look for it. */}
      <p className={css.mockNote} data-research-accept-absent="">{t('revision.acceptNotImplemented')}</p>
    </section>
  )
}
