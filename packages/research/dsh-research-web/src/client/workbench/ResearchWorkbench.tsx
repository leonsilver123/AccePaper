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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ResearchKey } from '../locales.ts'
import type { ApprovalSubmitter } from '../approval-source.ts'
import type { RunSummary } from '../../summary.ts'
import type { WirePlan, WireProposalAnswer } from '../direction-source.ts'
import type { RunListEntryView } from '../../run-source.ts'
import { DirectionDialog } from './DirectionDialog.tsx'
import { selectNextAction } from '../../panels.ts'
import { selectProgress, selectStages, type StageId } from '../../stages.ts'
import {
  IDLE_CONNECTION, allowsRevisionBoundWrite, isStale, type ConnectionState,
} from '../../connection-state.ts'
import { SummaryPanel } from './SummaryPanel.tsx'
import { PipelinePanel } from './PipelinePanel.tsx'
import { ArtifactsPanel } from './ArtifactsPanel.tsx'
import { RoadmapPanel } from './RoadmapPanel.tsx'
import { GatePanel } from './GatePanel.tsx'
import { AdversarialPanel } from './AdversarialPanel.tsx'
import { ApprovalPanel } from './ApprovalPanel.tsx'
import { QualityPanel } from './QualityPanel.tsx'
import { RecoveryPanel } from './RecoveryPanel.tsx'
import { SituationBanner } from './SituationBanner.tsx'
import { StageNavigation } from './StageNavigation.tsx'
import { StageWorkspace } from './StageWorkspace.tsx'
import { RevisionPanel } from './RevisionPanel.tsx'
import type { RevisionSource } from './RevisionPanel.tsx'
import css from './ResearchWorkbench.module.css'

/**
 * Props the research panel takes, from whichever seat mounts it.
 *
 * NO CONVERSATION-VIEW OWNER PROPS, and that is a removal rather than an omission. The panel used to
 * require them — the `conversation.view` seat supplies a focus request and the two calls that answer it
 * — but the workbench reads none of the three: it keeps its own selected stage, and the stage strip does
 * not address a focus identity. Requiring them made the panel mountable in exactly one seat and asked
 * callers for props nothing used, so the requirement is gone rather than satisfied with a fabricated
 * focus request. A seat that passes them still typechecks: a component that ignores extra props is
 * what React does anyway.
 */
export type ResearchViewProps = PropsLocale<'research'> & {
  /** The run to render. Omitted means this session has not run anything. */
  readonly summary?: RunSummary
  /**
   * Start a real run and resolve with its summary, under the plan the person confirmed.
   *
   * Omitted by a host that has no run to start, in which case the view shows no run control. The
   * plan is omitted by a caller that has none to state — the run then carries the deployment's
   * default, which is what a host with no proposal seam can offer.
   */
  readonly onRun?: (
    plan: WirePlan | undefined,
    onUpdate: (summary: RunSummary) => void,
    onPhase?: (state: ConnectionState) => void,
  ) => Promise<void>
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
  readonly onResume?: (
    onUpdate: (summary: RunSummary) => void,
    onPhase?: (state: ConnectionState) => void,
  ) => Promise<void>
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
  /**
   * The studies this deployment holds, newest first. Omitted by a host that cannot list them, in
   * which case this page offers only what it can start itself.
   */
  readonly onListRuns?: () => Promise<ReadonlyArray<RunListEntryView>>
  /**
   * Open one of those studies. Omitted on the same terms as {@link onListRuns}.
   */
  readonly onOpenRun?: (
    runId: string,
    onUpdate: (summary: RunSummary) => void,
    onPhase?: (state: ConnectionState) => void,
  ) => Promise<void>
  /**
   * Take a stored study back into the deployment's process, then follow it. Omitted by a host that
   * cannot, in which case a stopped study stays readable and undecidable.
   */
  readonly onAdoptRun?: (
    runId: string,
    onUpdate: (summary: RunSummary) => void,
    onPhase?: (state: ConnectionState) => void,
  ) => Promise<void>
  /**
   * Writes the run's package, as a working draft or as the final one. Omitted by a host that cannot
   * export, in which case the summary shows the files it has and offers no control.
   */
  readonly onExportPackage?: (
    runId: string,
    mode: 'draft' | 'final',
    onUpdate: (summary: RunSummary) => void,
  ) => Promise<void>
  /**
   * The revision loop's read and its two operations. Omitted by a host that cannot record
   * revisions, in which case the tab says so rather than offering controls that cannot work.
   */
  readonly revisions?: RevisionSource
}

/** Workbench sub-panel tab identifiers. */
export type WorkbenchTab =
  | 'summary' | 'pipeline' | 'figures' | 'tables' | 'roadmap'
  | 'gates' | 'adversarial' | 'approval' | 'revision' | 'quality' | 'recovery'

/**
 * The workbench's tab roster: id → label dictionary key, in `research` namespace order.
 *
 * EXPORTED SO THE COVERAGE SPEC READS IT rather than keeping its own copy. The spec that clicks every
 * tab had a hand-written list that stopped at nine while this roster grew to eleven, so the revision
 * and quality panels — the two a person reaches for when a finding is raised — were never rendered
 * under test, and the spec's own title went on saying "nine". A list the component and its spec share
 * cannot drift; a copy can, and did.
 */
export const WORKBENCH_TABS: ReadonlyArray<{ readonly id: WorkbenchTab; readonly labelKey: ResearchKey }> = [
  { id: 'summary', labelKey: 'tab.summary' },
  { id: 'pipeline', labelKey: 'tab.pipeline' },
  { id: 'figures', labelKey: 'tab.figures' },
  { id: 'tables', labelKey: 'tab.tables' },
  { id: 'roadmap', labelKey: 'tab.roadmap' },
  { id: 'gates', labelKey: 'tab.gates' },
  { id: 'adversarial', labelKey: 'tab.adversarial' },
  { id: 'approval', labelKey: 'tab.approval' },
  { id: 'revision', labelKey: 'tab.revision' },
  // THE QUALITY BASELINE SITS BESIDE THE REVISION LOOP, which is what answers it: a finding is
  // addressed by asking for different work, and the panel that asks is the one next to this one.
  { id: 'quality', labelKey: 'tab.quality' },
  { id: 'recovery', labelKey: 'tab.recovery' },
]

/**
 * The copy for each next action.
 *
 * THE NEXT ACTION IS THE SITUATION BANNER'S, not a sentence under the orientation block. The record
 * here mapped a kind to the fragment that block interpolated; the banner now states the step, the check
 * that stopped it and what the reader is to do, so the fragment had nothing left to say and is gone.
 * `next.running` survives because the banner itself uses it for a run whose projection names no step in
 * flight.
 */

/**
 * Render the research workbench. Renders the run the host supplied, or the one the
 * run control produced, and switches the active sub-panel on tab click. A session
 * with no run renders the orientation block and the run control alone.
 * @param props - slot runtime props, the `research` namespace translate `t`, an optional
 *   `summary` to render, and the optional run and approval seams.
 */
export function ResearchWorkbench({
  t, summary: injected, onRun, onPropose, onApprove, onResume, onRetrySave, onListRuns, onOpenRun,
  revisions, onAdoptRun, onExportPackage,
}: ResearchViewProps) {
  const [live, setLive] = useState<RunSummary | undefined>(undefined)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const summary = useMemo(() => live ?? injected, [live, injected])
  /**
   * Which detail panel is open, or none.
   *
   * NONE IS THE DEFAULT, and that is the simplification. The panel used to open on the summary tab,
   * whose sixteen step rows, artifact list, gate list and degradation list rendered BELOW the stage
   * surface that already shows the same steps: the first screen was tens of rows of detail and no
   * statement of what the reader was meant to do with any of it. The stage surface says where the run
   * is and the banner above it says what to do; a tab is a question the reader asks, so the page waits
   * to be asked.
   */
  const [active, setActive] = useState<WorkbenchTab | undefined>(undefined)
  // WHERE THE STUDY IS, not where the reader last looked: the stage strip opens on the first stage
  // that is not done, so a page that just loaded shows the work in front of it. A stage the person
  // picked is kept until they pick another, and a run that moves on does not yank the view away.
  const [pickedStage, setPickedStage] = useState<StageId | undefined>(undefined)
  /**
   * What this page's link to the deployment is doing.
   *
   * REPORTED BY THE FOLLOW LOOP, which is the only thing that knows: it opens, re-opens, resyncs and
   * gives up, and each of those is a fact a reader needs. The page keeps the last state it was told.
   */
  const [connection, setConnection] = useState<ConnectionState>(IDLE_CONNECTION)
  /**
   * Which read of a study the page is currently showing.
   *
   * A STUDY OPENED SECOND MUST NOT BE OVERWRITTEN BY THE FIRST. Opening one starts a follow that
   * reports every snapshot it reads; opening another while the first is still reporting leaves two
   * live callbacks writing the same state, and whichever answers last wins — so a page that moved to
   * the study a person picked would flip back to the one before it, showing numbers as the current
   * study's that belong to another. Each read takes a generation, and a callback from an older one
   * is dropped rather than rendered.
   */
  const viewGeneration = useRef(0)
  const currentRead = useCallback((): number => {
    viewGeneration.current += 1
    return viewGeneration.current
  }, [])
  const appliedTo = useCallback((generation: number, update: RunSummary): void => {
    if (viewGeneration.current === generation) setLive(update)
  }, [])
  // No run means the next action is the one that starts a run, so there is nothing to derive.
  const nextAction = summary === undefined ? undefined : selectNextAction(summary)
  const stages = useMemo(() => (summary === undefined ? [] : selectStages(summary)), [summary])
  const progress = summary === undefined ? undefined : selectProgress(summary)
  // The default is the first stage still to do, and it is chosen by what the stage DECLARES rather
  // than by what this run's projection carried: a projection this build cannot place would otherwise
  // fall through to the intake group and answer "this is yours to supply" about a host's own steps.
  const currentStage = stages.find(stage => stage.id === pickedStage)
    ?? stages.find(stage => stage.declared > 0 && stage.state !== 'done')
    ?? stages[0]
  // THE STUDIES THIS DEPLOYMENT HOLDS. Read once on arrival, and again after a study is opened, so
  // the list is the host's answer rather than a copy of what this tab happened to start.
  const [offered, setOffered] = useState<ReadonlyArray<RunListEntryView>>([])
  const [listError, setListError] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (onListRuns === undefined) return
    let cancelled = false
    void onListRuns().then(
      (entries) => { if (!cancelled) setOffered(entries) },
      (cause: unknown) => {
        if (cancelled) return
        // A LIST THAT COULD NOT BE READ IS REPORTED, not rendered as "no studies": the two facts
        // have different remedies, and one of them is not "your work is gone".
        setListError(cause instanceof Error ? cause.message : String(cause))
      },
    )
    return () => { cancelled = true }
  }, [onListRuns])

  // ONCE, ON ARRIVAL. A reload is not a new study: the host is still driving the run this browser
  // started, and this asks it what became of it. An injected summary means the caller already knows
  // which run to show, and a resume would then be a second opinion about the same page.
  useEffect(() => {
    if (onResume === undefined || injected !== undefined) return
    let cancelled = false
    const mine = currentRead()
    void onResume((update) => { if (!cancelled) appliedTo(mine, update) }, setConnection).catch((cause: unknown) => {
      if (cancelled) return
      // A resume that was REFUSED is reported. A resume that found nothing is not an error and does
      // not come through here — the page simply still shows no run.
      setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { cancelled = true }
  }, [onResume, injected, currentRead, appliedTo])

  const start = useCallback((plan?: WirePlan) => {
    if (onRun === undefined) return
    setDialogOpen(false)
    setRunning(true)
    setError(undefined)
    // THE PAGE FOLLOWS THE RUN RATHER THAN WAITING FOR IT. Every snapshot the run source reads is
    // rendered as it arrives, so a study that takes minutes is visible while it happens; the
    // promise settles when there is nothing left to read.
    const mine = currentRead()
    void onRun(plan, (update) => { appliedTo(mine, update) }, setConnection).then(
      () => { setRunning(false) },
      (cause: unknown) => {
        // A run that failed is reported as a failure. Showing anything else would leave a
        // reader looking at numbers no run produced.
        setError(cause instanceof Error ? cause.message : String(cause))
        setRunning(false)
      },
    )
  }, [onRun, currentRead, appliedTo])

  return (
    <div className={css.workbench}>
      {/* WHAT THIS TAB IS, AND WHAT TO DO WITH IT. The tab used to be a badge, a run button and nine
          unlabelled panels: a person who had not read the design documents could not tell what a run
          would do, where its products went, or which channel wrote the text they were reading. The
          next action is derived from the summary rather than written here. */}
      {/* The data attributes are the stable hooks the browser probe reads; the copy itself is
          locale-owned and asserted through these. */}
      {/* WHAT THE LINK IS DOING, said in the page rather than left to be inferred from a silence: a
          page that stopped receiving updates and a study that stopped producing them look the same
          without this line. It is stated for a run on screen only — a page with no run has no link. */}
      {summary !== undefined && connection.phase !== 'idle' && (
        <p className={css.note} data-research-connection={connection.phase}>
          {t(`connection.phase.${connection.phase}`)}
          {connection.reason === undefined ? '' : ` — ${connection.reason}`}
          {isStale(connection) ? ` ${t('connection.stale')}` : ''}
        </p>
      )}
      {/* 现在该你做什么, FIRST — before the orientation text, because a person arriving at a run that
          has stopped needs the answer to that question before they need to be told what the pipeline
          is. It renders nothing for a session that has run nothing, where the orientation block below
          already says what to press. */}
      {nextAction !== undefined && <SituationBanner next={nextAction} t={t} />}
      {/* ORIENTATION IS FOR A PAGE WITH NOTHING ON IT. The "what this is / how to use it" block used to
          render above every run: six elements of what-the-pipeline-is, pushing the person who came back
          to read where their run had got to below the fold. A session that has run something does not
          need telling what a run is, and the block says nothing about the run on screen. */}
      {summary === undefined && (
        <section className={css.intro} data-research-intro="">
          <h2 className={css.introTitle}>{t('intro.title')}</h2>
          <p className={css.note}>{t('intro.what')}</p>
          <h3 className={css.introSubtitle}>{t('intro.how')}</h3>
          <ol className={css.introSteps}>
            <li>{t('intro.step1')}</li>
            <li>{t('intro.step2')}</li>
            <li>{t('intro.step3')}</li>
          </ol>
          <p className={css.mockNote} data-research-source-note="">{t('intro.noRun')}</p>
        </section>
      )}

      {/* WHETHER THE TEXT CAME FROM A MODEL, said only when the answer is not the obvious one. Every
          deployment that writes prose routes it through a model, so a badge confirming that is a badge
          that says nothing; the cases a reader must be told about are the ones where the manuscript is
          demo text, the built-in sentences, or of unstated origin. */}
      {summary !== undefined && summary.proseChannel !== 'model' && (
        <p className={css.mockNote} data-research-source-note="">
          {t(`channel.${summary.proseChannel}`)}
        </p>
      )}

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
      {/* THE RUN'S IDENTITY, one click down. Which revision the page is showing, which run this is, and
          whether anything is still driving it are facts a reader needs when they ask about a run — and
          they were three of the six badges this row showed at once, in front of a person who came to
          find out what to do next. The two that change what a reader may DO — the evidence profile and
          readiness — stay on the row, and so does anything that is a failure. */}
      {summary !== undefined && (
        <details className={css.runFacts} data-research-run-facts="">
          <summary>{t('run.facts')}</summary>
          <p className={css.factsBody}>
            <span data-research-run-id="">{t('run.id', { runId: summary.runId })}</span>
            {summary.projectRevision !== null && (
              <span data-research-revision="">
                {t('run.revision', { revision: String(summary.projectRevision) })}
              </span>
            )}
            {summary.execution !== null && (
              <span data-research-execution="">
                {t(`run.execution.${summary.execution}`)}
                {summary.executionError !== null ? ` — ${summary.executionError}` : ''}
              </span>
            )}
          </p>
        </details>
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
        <span className={css.mockBadge} data-research-error="">{t('run.error').replace('{message}', error)}</span>
      )}

      {/* THE STUDIES THIS DEPLOYMENT HOLDS. A page whose only handle on a study was the id it kept in
          its own storage lost that study when the page closed, while the study stayed on disk. This
          is the list a person picks from — read from the deployment, not from this tab. */}
      {onListRuns !== undefined && onOpenRun !== undefined && summary === undefined && (
        <section className={css.intro} data-research-projects="">
          <h3 className={css.introSubtitle}>{t('projects.title')}</h3>
          <p className={css.note}>{t('projects.note')}</p>
          {listError !== undefined && (
            <p className={css.mockNote}>{t('projects.listFailed').replace('{message}', listError)}</p>
          )}
          {listError === undefined && offered.length === 0 && (
            <p className={css.mockNote} data-research-projects-empty="">{t('projects.empty')}</p>
          )}
          {offered.map(entry => (
            <div key={entry.runId} className={css.recoveryGrid} data-research-project={entry.runId}>
              <span className={css.recoveryVal}>{t('projects.steps', { passed: String(entry.stepsPassed), total: String(entry.stepsTotal) })}</span>
              <span className={css.recoveryKey}>{t('projects.state')}</span>
              <span className={css.recoveryVal}>
                {entry.execution === null ? t('projects.stateUnknown') : t(`run.execution.${entry.execution}`)}
                {entry.saveFailure !== null ? ` — ${entry.saveFailure}` : ''}
                {entry.interrupted.length > 0 ? ` — ${t('projects.interrupted', { steps: entry.interrupted.join(', ') })}` : ''}
              </span>
              <span className={css.recoveryKey}>{t('projects.runId')}</span>
              <span className={css.recoveryVal}>{entry.runId}</span>
              <button
                type="button"
                className={css.tab}
                onClick={() => {
                  setError(undefined)
                  // THE GENERATION IS TAKEN BEFORE THE READ STARTS, so a read already in flight for
                  // another study cannot land on top of this one.
                  const mine = currentRead()
                  void onOpenRun(entry.runId, (update) => { appliedTo(mine, update) }, setConnection).catch((cause: unknown) => {
                    setError(cause instanceof Error ? cause.message : String(cause))
                  })
                }}
              >
                {t('projects.open')}
              </button>
              {/* A STOPPED STUDY IS READABLE AND NOT DECIDABLE until it is taken back into the
                  deployment's process: an approval is refused for a run the process does not hold.
                  The control is offered only where it can work — a study nothing is driving — and a
                  host that cannot adopt one shows no control at all. */}
              {onAdoptRun !== undefined && entry.execution === 'stopped' && (
                <button
                  type="button"
                  className={css.tab}
                  data-research-adopt={entry.runId}
                  onClick={() => {
                    setError(undefined)
                    const mine = currentRead()
                    void onAdoptRun(entry.runId, (update) => { appliedTo(mine, update) }, setConnection)
                      .catch((cause: unknown) => {
                        setError(cause instanceof Error ? cause.message : String(cause))
                      })
                  }}
                >
                  {t('projects.adopt')}
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {summary !== undefined && (
        <>
          {/* WHAT THIS STUDY HAS DONE, IN COUNTS A READER CAN TRACE TO A STEP. No percentage and no
              estimate: the steps differ by orders of magnitude in cost, so a fraction of them is not
              a fraction of the work, and a completion time would be a promise nothing here can keep.
              A decision waiting on a person is listed apart from progress, because it is a to-do. */}
          {progress !== undefined && (
            <p className={css.progress} data-research-progress="">
              <span>
                {t('progress.steps')}
                {' '}
                <span className={css.progressValue} data-research-progress-steps="">
                  {progress.stepsPassed} / {progress.stepsTotal}
                </span>
              </span>
              <span>
                {t('progress.awaitingHuman')}
                {' '}
                <span className={css.progressValue} data-research-progress-human="">
                  {progress.awaitingHuman}
                </span>
              </span>
              {progress.failed > 0 && (
                <span>
                  {t('progress.failed')}
                  {' '}
                  <span className={css.progressValue} data-research-progress-failed="">
                    {progress.failed}
                  </span>
                </span>
              )}
              {progress.unknown > 0 && (
                <span>
                  {t('progress.unknown')}
                  {' '}
                  <span className={css.progressValue} data-research-progress-unknown="">
                    {progress.unknown}
                  </span>
                </span>
              )}
            </p>
          )}
          <StageNavigation
            stages={stages}
            selected={currentStage?.id ?? 'intake'}
            onSelect={setPickedStage}
            t={t}
          />
          {currentStage !== undefined && (
            <StageWorkspace summary={summary} stage={currentStage} stages={stages} t={t} />
          )}

          <nav className={css.tabs}>
            {WORKBENCH_TABS.map(tab => (
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

          {active === 'summary' && (
            <SummaryPanel
              summary={summary}
              t={t}
              {...onExportPackage === undefined
                ? {}
                : { onExportPackage: (runId: string, mode: 'draft' | 'final') => onExportPackage(runId, mode, (update) => { setLive(update) }) }}
            />
          )}
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
              writesAllowed={allowsRevisionBoundWrite(connection)}
            />
          )}
          {active === 'revision' && (
            <RevisionPanel
              summary={summary}
              t={t}
              {...revisions === undefined ? {} : { revisions }}
              writesAllowed={allowsRevisionBoundWrite(connection)}
            />
          )}
          {active === 'quality' && <QualityPanel summary={summary} t={t} />}
          {active === 'recovery' && <RecoveryPanel summary={summary} t={t} />}
        </>
      )}
    </div>
  )
}
