/**
 * T27–T29 research workbench shell: a tabbed sub-panel host inside the
 * `conversation.view` `research` entry. The Summary tab reuses the T26
 * {@link SummaryPanel}; the remaining tabs mount the pipeline / figures / tables /
 * roadmap / gates / adversarial / approval / recovery panels. All panels read the
 * same {@link RunSummary} the host supplied or the run resolved with.
 *
 * NO SUMMARY MEANS NO RUN. The tab used to fall back to a bundled demo run, so a session that had
 * started nothing showed sixteen invented steps, invented artifacts and invented gate verdicts as
 * though they were a result. It now says that nothing has been run, and renders no panel: there is
 * nothing to report until a run produces something to report.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ConvViewProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ResearchKey } from '../locales.ts'
import type { ApprovalSubmitter } from '../approval-source.ts'
import type { RunSummary } from '../../summary.ts'
import type { WirePlan, WireProposalAnswer } from '../direction-source.ts'
import { DirectionDialog } from './DirectionDialog.tsx'
import { selectNextAction, type NextActionKind } from '../../panels.ts'
import { SummaryPanel } from './SummaryPanel.tsx'
import { PipelinePanel } from './PipelinePanel.tsx'
import { ArtifactsPanel } from './ArtifactsPanel.tsx'
import { RoadmapPanel } from './RoadmapPanel.tsx'
import { GatePanel } from './GatePanel.tsx'
import { AdversarialPanel } from './AdversarialPanel.tsx'
import { ApprovalPanel } from './ApprovalPanel.tsx'
import { RecoveryPanel } from './RecoveryPanel.tsx'
import css from './ResearchWorkbench.module.css'

/**
 * Props the conversation.view slot contributes to the research entry. `summary`
 * is the injection seam: a host that has a real run summary passes it, and one
 * that has no run passes none, which the view reports as "nothing run yet".
 */
export type ResearchViewProps = ConvViewProps & PropsLocale<'research'> & {
  /** The run to render. Omitted means this session has not run anything. */
  readonly summary?: RunSummary
  /**
   * Start a real run and resolve with its summary, under the plan the person confirmed.
   *
   * Omitted by a host that has no run to start, in which case the view shows no run control. The
   * plan is omitted by a caller that has none to state — the run then carries the deployment's
   * default, which is what a host with no proposal seam can offer.
   */
  readonly onRun?: (plan: WirePlan | undefined, onUpdate: (summary: RunSummary) => void) => Promise<void>
  /**
   * Ask the host for research directions within a field. Omitted by a host that cannot reach a
   * model, in which case the run control starts the default plan directly rather than opening a
   * dialog that could only ever fail.
   */
  readonly onPropose?: (field: string) => Promise<WireProposalAnswer>
  /**
   * Pick up the run this browser was following before a reload, reporting snapshots through the
   * callback. Omitted by a host that cannot name a run again, in which case a reload shows none.
   */
  readonly onResume?: (onUpdate: (summary: RunSummary) => void) => Promise<void>
  /**
   * Submit one human-gate decision to the backend. Omitted by a host whose deployment serves no
   * authenticated approval endpoint, in which case the approval panel's buttons stay disabled.
   */
  readonly onApprove?: ApprovalSubmitter
  /**
   * Retry a run's write after the host reported that it did not land. Omitted by a host that cannot
   * retry one, in which case the control is absent — a button that could not do anything would read
   * as a remedy this deployment does not have.
   */
  readonly onRetrySave?: (runId: string, onUpdate: (summary: RunSummary) => void) => Promise<void>
}

/** Workbench sub-panel tab identifiers. */
type WorkbenchTab =
  | 'summary' | 'pipeline' | 'figures' | 'tables' | 'roadmap'
  | 'gates' | 'adversarial' | 'approval' | 'recovery'

/** Tab roster: id → label dictionary key (kept in `research` namespace order). */
const TABS: ReadonlyArray<{ id: WorkbenchTab; labelKey: ResearchKey }> = [
  { id: 'summary', labelKey: 'tab.summary' },
  { id: 'pipeline', labelKey: 'tab.pipeline' },
  { id: 'figures', labelKey: 'tab.figures' },
  { id: 'tables', labelKey: 'tab.tables' },
  { id: 'roadmap', labelKey: 'tab.roadmap' },
  { id: 'gates', labelKey: 'tab.gates' },
  { id: 'adversarial', labelKey: 'tab.adversarial' },
  { id: 'approval', labelKey: 'tab.approval' },
  { id: 'recovery', labelKey: 'tab.recovery' },
]

/**
 * The copy for each next action.
 *
 * A record rather than a switch: the union is closed, so a new kind fails to compile here instead of
 * rendering an empty sentence.
 */
const NEXT_ACTION_KEY: Readonly<Record<NextActionKind, ResearchKey>> = {
  'not-started': 'next.notStarted',
  running: 'next.running',
  'awaiting-human': 'next.awaitingHuman',
  failed: 'next.failed',
  complete: 'next.complete',
}

/**
 * Render the research workbench. Renders the run the host supplied, or the one the
 * run control produced, and switches the active sub-panel on tab click. A session
 * with no run renders the orientation block and the run control alone.
 * @param props - slot runtime props, the `research` namespace translate `t`, an optional
 *   `summary` to render, and the optional run and approval seams.
 */
export function ResearchWorkbench({ t, summary: injected, onRun, onPropose, onApprove, onResume, onRetrySave }: ResearchViewProps) {
  const [live, setLive] = useState<RunSummary | undefined>(undefined)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const summary = useMemo(() => live ?? injected, [live, injected])
  const [active, setActive] = useState<WorkbenchTab>('summary')
  // No run means the next action is the one that starts a run, so there is nothing to derive.
  const nextAction = summary === undefined ? undefined : selectNextAction(summary)

  // ONCE, ON ARRIVAL. A reload is not a new study: the host is still driving the run this browser
  // started, and this asks it what became of it. An injected summary means the caller already knows
  // which run to show, and a resume would then be a second opinion about the same page.
  useEffect(() => {
    if (onResume === undefined || injected !== undefined) return
    let cancelled = false
    void onResume((update) => { if (!cancelled) setLive(update) }).catch((cause: unknown) => {
      if (cancelled) return
      // A resume that was REFUSED is reported. A resume that found nothing is not an error and does
      // not come through here — the page simply still shows no run.
      setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { cancelled = true }
  }, [onResume, injected])

  const start = useCallback((plan?: WirePlan) => {
    if (onRun === undefined) return
    setDialogOpen(false)
    setRunning(true)
    setError(undefined)
    // THE PAGE FOLLOWS THE RUN RATHER THAN WAITING FOR IT. Every snapshot the run source reads is
    // rendered as it arrives, so a study that takes minutes is visible while it happens; the
    // promise settles when there is nothing left to read.
    void onRun(plan, (update) => { setLive(update) }).then(
      () => { setRunning(false) },
      (cause: unknown) => {
        // A run that failed is reported as a failure. Showing anything else would leave a
        // reader looking at numbers no run produced.
        setError(cause instanceof Error ? cause.message : String(cause))
        setRunning(false)
      },
    )
  }, [onRun])

  return (
    <div className={css.workbench}>
      {/* WHAT THIS TAB IS, AND WHAT TO DO WITH IT. The tab used to be a badge, a run button and nine
          unlabelled panels: a person who had not read the design documents could not tell what a run
          would do, where its products went, or which channel wrote the text they were reading. The
          next action is derived from the summary rather than written here. */}
      {/* The data attributes are the stable hooks the browser probe reads; the copy itself is
          locale-owned and asserted through these. */}
      <section className={css.intro} data-research-intro="">
        <h2 className={css.introTitle}>{t('intro.title')}</h2>
        <p className={css.note}>{t('intro.what')}</p>
        <h3 className={css.introSubtitle}>{t('intro.how')}</h3>
        <ol className={css.introSteps}>
          <li>{t('intro.step1')}</li>
          <li>{t('intro.step2')}</li>
          <li>{t('intro.step3')}</li>
        </ol>
        {/* What this page is showing: a run that happened, or nothing yet. */}
        {summary === undefined
          ? <p className={css.mockNote} data-research-source-note="">{t('intro.noRun')}</p>
          : (
            <p className={css.mockNote} data-research-source-note="">
              {t(`channel.${summary.proseChannel}`)}
            </p>
          )}
        {nextAction !== undefined && (
          <p className={css.nextAction} data-research-next-action="">
            {t('intro.next', { action: t(NEXT_ACTION_KEY[nextAction.kind], { count: nextAction.pendingCount }) })}
          </p>
        )}
      </section>

      {/* The badge states where the numbers came from. It is rendered only when there are numbers. */}
      {summary !== undefined && (
        <span className={css.mockBadge}>{summary.isMock ? t('mock.badge') : t('source.live')}</span>
      )}
      {/* WHICH STATE OF THE STUDY THIS PAGE IS SHOWING. The exported package names the same
          revision, so a reader can tell whether the page and the download describe one state or
          two — a question a timestamp cannot answer. Absent when the host names none: showing a
          zero would name a revision nobody read. */}
      {/* WHAT THIS RUN IS AND WHETHER ANYTHING IS READY — stated where the source badge is, not
          behind a tab, because it is true of the whole run. A reader shown a green screen has to be
          able to tell a demonstration from a submission, and "the pipeline finished" from "this
          could be submitted": collapsing either pair is the failure the host's readiness split was
          made for, at the layer where a reader sees it. An unstated readiness says so. */}
      {summary !== undefined && (
        <span className={css.mockBadge} data-research-profile="">
          {summary.evidenceProfile === null
            ? t('readiness.profile.unknown')
            : t(summary.evidenceProfile === 'production'
              ? 'readiness.profile.production'
              : 'readiness.profile.evaluation')}
        </span>
      )}
      {summary !== undefined && (
        <span className={css.mockBadge} data-research-readiness="">
          {summary.submissionReady === null
            ? t('readiness.unknown')
            : t(summary.submissionReady ? 'readiness.ready' : 'readiness.notReady')}
          {summary.readinessNote !== null && summary.readinessNote.length > 0
            ? ` — ${summary.readinessNote}`
            : ''}
        </span>
      )}
      {summary !== undefined && summary.projectRevision !== null && (
        <span className={css.mockBadge} data-research-revision="">
          {t('run.revision', { revision: String(summary.projectRevision) })}
        </span>
      )}
      {/* WHICH RUN THIS IS, AND WHETHER ANYTHING IS STILL DRIVING IT. Two facts a reader cannot get
          from the numbers: the id is what they quote when they ask about it, and the execution
          state is the difference between a study that is working and one that stopped — a run
          whose steps all read 未开始 looks identical in the panels either way. Unstated stays
          unstated: a host that names no execution state is not claiming the run has stopped. */}
      {summary !== undefined && (
        <span className={css.mockBadge} data-research-run-id="">
          {t('run.id', { runId: summary.runId })}
        </span>
      )}
      {summary !== undefined && summary.execution !== null && (
        <span className={css.mockBadge} data-research-execution="">
          {t(`run.execution.${summary.execution}`)}
          {summary.executionError !== null ? ` — ${summary.executionError}` : ''}
        </span>
      )}
      {onRun !== undefined && (
        <button
          type="button"
          className={css.tab}
          // The plan is what a run is ABOUT, so the control that starts one asks for it first. A
          // host with no proposal seam has nothing to ask with, and starts the default directly
          // rather than opening a dialog that could only fail.
          onClick={() => { if (onPropose === undefined) start(); else setDialogOpen(true) }}
          disabled={running}
        >
          {running ? t('run.running') : t('run.action')}
        </button>
      )}
      {dialogOpen && onPropose !== undefined && (
        <DirectionDialog
          t={t}
          onPropose={onPropose}
          onConfirm={start}
          onCancel={() => { setDialogOpen(false) }}
        />
      )}
      {/* THE ONE OPERATION THAT FIXES A RUN THAT IS NOT ON DISK, offered on the host's own report of
          the failure rather than on a guess. It is NOT a re-run: the host writes the state it already
          holds, so a study that finished stays finished. Shown only when the host reported a failed
          write and can retry one. */}
      {onRetrySave !== undefined && summary !== undefined && summary.saveFailure !== null && (
        <button
          type="button"
          className={css.tab}
          data-research-retry-save=""
          disabled={retrying}
          onClick={() => {
            setRetrying(true)
            setError(undefined)
            void onRetrySave(summary.runId, (update) => { setLive(update) }).then(
              () => { setRetrying(false) },
              (cause: unknown) => {
                setError(cause instanceof Error ? cause.message : String(cause))
                setRetrying(false)
              },
            )
          }}
        >
          {retrying ? t('run.retryingSave') : t('run.retrySave')}
        </button>
      )}
      {summary !== undefined && summary.saveFailure !== null && (
        <span className={css.mockBadge} data-research-save-failure="">
          {t('run.saveFailure', { message: summary.saveFailure })}
        </span>
      )}
      {error !== undefined && (
        <span className={css.mockBadge}>{t('run.error').replace('{message}', error)}</span>
      )}

      {summary !== undefined && (
        <>
          <nav className={css.tabs}>
            {TABS.map(tab => (
              <button
                type="button"
                key={tab.id}
                className={`${css.tab} ${active === tab.id ? css.tabActive : ''}`}
                onClick={() => { setActive(tab.id) }}
              >
                {t(tab.labelKey)}
              </button>
            ))}
          </nav>

          {active === 'summary' && <SummaryPanel summary={summary} t={t} />}
          {active === 'pipeline' && <PipelinePanel summary={summary} t={t} />}
          {active === 'figures' && <ArtifactsPanel summary={summary} t={t} variant="figure" />}
          {active === 'tables' && <ArtifactsPanel summary={summary} t={t} variant="table" />}
          {active === 'roadmap' && <RoadmapPanel summary={summary} t={t} />}
          {active === 'gates' && <GatePanel summary={summary} t={t} />}
          {active === 'adversarial' && <AdversarialPanel summary={summary} t={t} />}
          {active === 'approval' && (
            <ApprovalPanel
              summary={summary}
              t={t}
              {...onApprove === undefined ? {} : { onSubmit: onApprove }}
              onDecided={setLive}
            />
          )}
          {active === 'recovery' && <RecoveryPanel summary={summary} t={t} />}
        </>
      )}
    </div>
  )
}
