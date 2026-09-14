/**
 * T27–T29 research workbench shell: a tabbed sub-panel host inside the
 * `conversation.view` `research` entry. The Summary tab reuses the T26
 * {@link SummaryPanel}; the remaining tabs mount the pipeline / figures / tables /
 * roadmap / gates / adversarial / approval / recovery panels. All panels read the
 * same fixture/snapshot {@link RunSummary} (MOCK) loaded once here.
 */
import { useCallback, useMemo, useState } from 'react'
import type {
  ConvViewProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ResearchKey } from '../locales.ts'
import type { ApprovalSubmitter } from '../approval-source.ts'
import { loadFixtureSummary } from '../../loader.ts'
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
 * is the injection seam: a host that has a real run summary passes it, and only a
 * caller that supplies none falls back to the bundled MOCK fixture.
 */
export type ResearchViewProps = ConvViewProps & PropsLocale<'research'> & {
  /** Run summary to render; the bundled MOCK fixture is used when omitted. */
  readonly summary?: ReturnType<typeof loadFixtureSummary>
  /**
   * Start a real run and resolve with its summary. Omitted by a host that has no run
   * to start, in which case the view shows the fixture and no run control.
   */
  readonly onRun?: () => Promise<ReturnType<typeof loadFixtureSummary>>
  /**
   * Submit one human-gate decision to the backend. Omitted by a host whose deployment serves no
   * authenticated approval endpoint, in which case the approval panel's buttons stay disabled.
   */
  readonly onApprove?: ApprovalSubmitter
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
 * Render the research workbench. Renders the injected run summary when the host
 * supplies one and the bundled MOCK fixture otherwise, then switches the active
 * sub-panel on tab click. The view never polls a live run.
 * @param props - slot runtime props, the `research` namespace translate `t`, and an
 *   optional `summary` to render in place of the bundled fixture.
 */
export function ResearchWorkbench({ t, summary: injected, onRun, onApprove }: ResearchViewProps) {
  // The hook runs unconditionally so its order is stable; the fixture is only
  // materialized when no summary was injected.
  const [live, setLive] = useState<ReturnType<typeof loadFixtureSummary> | undefined>(undefined)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const summary = useMemo(() => live ?? injected ?? loadFixtureSummary(), [live, injected])
  const [active, setActive] = useState<WorkbenchTab>('summary')

  const start = useCallback(() => {
    if (onRun === undefined) return
    setRunning(true)
    setError(undefined)
    void onRun().then(
      (result) => { setLive(result); setRunning(false) },
      (cause: unknown) => {
        // A run that failed is reported as a failure. Showing the fixture instead
        // would leave a reader looking at demo numbers after asking for a real run.
        setError(cause instanceof Error ? cause.message : String(cause))
        setRunning(false)
      },
    )
  }, [onRun])

  return (
    <div className={css.workbench}>
      {/* The badge states where the numbers came from. It used to be unconditional,
          so an injected real run was still labelled as demo data. */}
      <span className={css.mockBadge}>{summary.isMock ? t('mock.badge') : t('source.live')}</span>
      {onRun !== undefined && (
        <button type="button" className={css.tab} onClick={start} disabled={running}>
          {running ? t('run.running') : t('run.action')}
        </button>
      )}
      {error !== undefined && (
        <span className={css.mockBadge}>{t('run.error').replace('{message}', error)}</span>
      )}

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
    </div>
  )
}
