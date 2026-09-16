// @vitest-environment jsdom
/**
 * Component-level DOM acceptance for the Research workbench (T26–T29).
 *
 * Integration-verified only: it mounts the real React components and asserts on
 * the produced DOM with `@testing-library/react` queries (no "bundle loaded"
 * proxies), but WITHOUT a running 1120 server. The conversation-view slot and
 * locale services are satisfied by lightweight in-test doubles (the same seam
 * the monorepo's other `*.client.spec.tsx` suites use), so the label below is
 * Integration-verified, never Runtime-verified.
 *
 * Covers: tab registration/guard, tab mount, 9 switchable panels, 16-step
 * status mapping, MOCK badge, artifact summaries, empty/error states, reload
 * re-render, unload/re-register lifecycle, and the U1 orientation block (what
 * the tab is, how to start a run, where the products go, and what to do next).
 */

import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { en } from '../src/client/locales.ts'
import {
  toRunSummary,
  type RunSummaryInput,
  type StepView,
} from '../src/summary.ts'
import { buildSummary } from '../src/loader.ts'
import { RESEARCH_FIXTURE } from './support/fixture.ts'
import { ResearchView } from '../src/client/ResearchView.tsx'
import { ResearchWorkbench } from '../src/client/workbench/ResearchWorkbench.tsx'
import { apply } from '../src/client/index.ts'

/**
 * Translate double over a plain dictionary (mirrors LocaleRuntime's chain:
 * first-dictionary lookup with `{name}` interpolation). Inlined so the spec
 * stays self-contained and free of cross-package import-resolution in jsdom.
 * @param dict - dictionary consulted in order.
 * @returns the translate function.
 */
function makeTranslate(...dicts: ReadonlyArray<Record<string, string>>) {
  return (key: string, params?: Record<string, unknown>): string => {
    let template = key
    for (const dict of dicts) {
      const hit = dict[key]
      if (hit !== undefined) {
        template = hit
        break
      }
    }
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match)
  }
}

/** Translate double over the `research` English dictionary (mirrors LocaleRuntime's chain). */
const t = makeTranslate(en)

/** Convenience: render a React component with the `t` double via createElement (no JSX). */
/** A minimal summary input with one step, used to exercise the source labelling. */
function fixtureInput(): RunSummaryInput {
  const fixture = buildSummary(RESEARCH_FIXTURE)
  return {
    runId: fixture.runId,
    source: 'fixture',
    status: fixture.status,
    steps: fixture.steps,
    artifacts: fixture.artifacts,
    gates: fixture.gates,
    abstentions: fixture.abstentions,
    degradations: fixture.degradations,
    deliverables: [],
  }
}

function renderComp(element: Parameters<typeof render>[0]) {
  return render(element)
}

afterEach(cleanup)

// ---------------------------------------------------------------------------
// In-test slot/locale service doubles (the seam; no cordis, no 1120 server).
// The `conversation.view` slot is a list slot keyed by `id`; the documented
// guard is that a second registration at the same id/priority throws rather
// than silently duplicating the tab — this double models exactly that.
// ---------------------------------------------------------------------------
interface MockCtx {
  ctx: Record<string, unknown>
  researchEntries(): Array<{ id?: string }>
  getDisposer(): (() => void) | null
}

function createMockCtx(): MockCtx {
  const registered: Array<{ name: string; id?: string; disposer: () => void }> = []
  let lastDisposer: (() => void) | null = null
  const declared = new Set<string>(['conversation.view'])

  const ctx = {
    effect(fn: () => unknown) {
      const d = fn()
      lastDisposer = typeof d === 'function' ? (d as () => void) : null
      return lastDisposer ?? (() => {})
    },
    slots: {
      inject(_name: string, fn: () => unknown) {
        // Service is immediately available in the test seam. The factory returns
        // the slot `register` disposer; the real `apply` discards it, but we
        // capture it so the test can simulate plugin unload (ctx disposal).
        const d = fn()
        lastDisposer = typeof d === 'function' ? (d as () => void) : null
        return lastDisposer ?? (() => {})
      },
      register(opts: { name: string; id?: string }, _component: unknown) {
        if (!declared.has(opts.name)) throw new Error(`slot "${opts.name}" is not declared`)
        const dup = registered.find(e => e.name === opts.name && e.id === opts.id)
        if (dup) {
          throw new Error(`list slot "${opts.name}" already has an entry with id "${opts.id}"`)
        }
        const disposer = () => {
          const i = registered.findIndex(e => e.name === opts.name && e.id === opts.id)
          if (i >= 0) registered.splice(i, 1)
        }
        registered.push({ name: opts.name, id: opts.id, disposer })
        return disposer
      },
    },
    locale: {
      register() {},
      bind() {
        return makeTranslate(en)
      },
    },
  }

  return {
    ctx: ctx as unknown as Record<string, unknown>,
    researchEntries: () => registered.filter(e => e.id === 'research'),
    getDisposer: () => lastDisposer,
  }
}

// ===========================================================================
// 1 & 10. Plugin registration lifecycle (tab singleton + unload/re-register)
// ===========================================================================
describe('research tab registration (plugin lifecycle)', () => {
  let harness: MockCtx
  beforeEach(() => { harness = createMockCtx() })

  it('registers the research tab exactly once and guards a duplicate registration', () => {
    apply(harness.ctx as never)

    expect(harness.researchEntries()).toHaveLength(1)

    // A second apply must NOT create a duplicate tab — the list slot rejects a
    // re-registration at the same id (the guard), so the tab count stays 1.
    expect(() => apply(harness.ctx as never)).toThrow(/already has an entry/)
    expect(harness.researchEntries()).toHaveLength(1)
  })

  it('unloading removes the tab, and re-registering leaves exactly one tab', () => {
    apply(harness.ctx as never)
    const disposer = harness.getDisposer()
    expect(harness.researchEntries()).toHaveLength(1)

    // Unload (lifecycle follows the cordis ctx effect disposer).
    act(() => { disposer?.() })
    expect(harness.researchEntries()).toHaveLength(0)

    // Re-register after the plugin is re-applied — exactly one tab remains.
    apply(harness.ctx as never)
    expect(harness.researchEntries()).toHaveLength(1)
  })
})

// ===========================================================================
// 2–9. Workbench DOM behaviour
// ===========================================================================
describe('research workbench DOM', () => {
  // 2. Clicking the tab mounts ResearchView (container present).
  it('mounts ResearchView with a container when the research view renders', () => {
    renderComp(createElement(ResearchView, { t, summary: buildSummary(RESEARCH_FIXTURE) }))

    // The summary root heading + MOCK badge prove the view mounted (container present).
    expect(screen.getByRole('heading', { name: en['view.research'] })).toBeTruthy()
    expect(screen.getByText(en['mock.badge'])).toBeTruthy()
  })

  // 3. Nine workbench panels present and switchable (only one visible at a time).
  it('renders nine switchable panels with exactly one visible at a time', () => {
    renderComp(createElement(ResearchWorkbench, { t, summary: buildSummary(RESEARCH_FIXTURE) }))

    const tabLabels = [
      'tab.summary', 'tab.pipeline', 'tab.figures', 'tab.tables', 'tab.roadmap',
      'tab.gates', 'tab.adversarial', 'tab.approval', 'tab.revision', 'tab.recovery',
    ] as const
    for (const key of tabLabels) {
      expect(screen.getByRole('button', { name: en[key] })).toBeTruthy()
    }
    // THE NINE TABS ARE THE TAB STRIP, so the count is taken from the strip rather than from the
    // whole page: the workbench also carries the stage navigation (six buttons) and the study list,
    // and a page-wide count made every one of those a failure of this test.
    const strip = screen.getByRole('button', { name: en['tab.summary'] }).closest('nav')
    expect(strip).not.toBeNull()
    expect(within(strip as HTMLElement).getAllByRole('button')).toHaveLength(10)

    // Default view is the Summary panel.
    expect(screen.getByText(/Step progress/)).toBeTruthy()

    // Switch to Pipeline — only the pipeline panel should be visible now.
    fireEvent.click(screen.getByRole('button', { name: en['tab.pipeline'] }))
    expect(screen.getByText(en['pipeline.title'])).toBeTruthy()
    expect(screen.queryByText(/Step progress/)).toBeNull()

    // Switch to Gates — pipeline must be gone, gates visible (single visibility).
    fireEvent.click(screen.getByRole('button', { name: en['tab.gates'] }))
    expect(screen.getByText(en['gate.title'])).toBeTruthy()
    expect(screen.queryByText(en['pipeline.title'])).toBeNull()
  })

  // 4. 16-step list renders with per-step status mapping:
  //    passed, blocked, abstained (gate outcome), hold_abstained,
  //    degradation, and E2 human pending.
  it('renders the 16-step list with status mapping for every required state', () => {
    const summary = toRunSummary(buildStatusFixture())

    renderComp(createElement(ResearchView, { t, summary }))

    // 16 step rows in the steps section.
    const stepsSection = screen.getByText(/Step progress/).closest('section')
    expect(stepsSection).not.toBeNull()
    expect(within(stepsSection as HTMLElement).getAllByRole('listitem')).toHaveLength(16)

    // passed steps present.
    expect(screen.getAllByText(en['status.passed']).length).toBeGreaterThanOrEqual(13)
    // blocked step status tag.
    expect(screen.getByText(en['status.blocked'])).toBeTruthy()
    // hold_abstained: gated step frozen on a gate abstention.
    expect(screen.getByText(en['step.holdReason.gate_abstained'])).toBeTruthy()
    // abstained gate outcome (component A abstained).
    expect(screen.getByText('component A: abstained')).toBeTruthy()
    // degradation note section + message.
    expect(screen.getByText(en['section.degradations'])).toBeTruthy()
    expect(screen.getByText('Mock degradation note for DOM test.')).toBeTruthy()

    // E2 human pending: the human-pending section surfaces the human-gated step.
    const humanSection = screen.getByText(en['section.humanPending']).closest('section')
    expect(humanSection).not.toBeNull()
    expect(within(humanSection as HTMLElement).getByText(en['step.holdReason.human_gate'])).toBeTruthy()
  })

  // 5. Mock/Fixture badge visible on fixture-sourced artifacts.
  it('shows the MOCK/ fixture badge for fixture-sourced data', () => {
    renderComp(createElement(ResearchView, { t, summary: buildSummary(RESEARCH_FIXTURE) }))

    expect(screen.getAllByText(en['mock.badge']).length).toBeGreaterThan(0)
  })

  // 6. Artifact summary link/text present for a run with artifacts.
  it('renders artifact summaries for a run that produced artifacts', () => {
    renderComp(createElement(ResearchView, { t, summary: buildSummary(RESEARCH_FIXTURE) }))

    // Fixture artifact slug + its human-readable summary text are both present.
    expect(screen.getByText('problem_statement')).toBeTruthy()
    expect(screen.getByText(/One-paragraph problem statement/)).toBeTruthy()
  })

  // 7. Empty run renders a friendly empty state (no crash / white screen).
  it('renders an empty run without crashing and shows the run header', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const summary = toRunSummary(emptyRun('run_empty_001', 'completed'))
      renderComp(createElement(ResearchView, { t, summary }))

      // Header still renders — not a white screen.
      expect(screen.getByRole('heading', { name: en['view.research'] })).toBeTruthy()
      expect(screen.getByText('run_empty_001')).toBeTruthy()

      // Steps section present but with zero rows (graceful empty list).
      const stepsSection = screen.getByText(/Step progress/).closest('section')
      expect(within(stepsSection as HTMLElement).queryAllByRole('listitem')).toHaveLength(0)

      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  // 8. Failed/error run renders error state without unhandled exceptions.
  it('renders a failed run without unhandled exceptions', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const summary = toRunSummary(emptyRun('run_failed_001', 'failed', [
        { stepId: 's01', index: 1, phase: 'A', name: 'Problem framing', status: 'failed', attempt: 1, humanGate: false, gateOutcomes: [] },
      ]))
      renderComp(createElement(ResearchView, { t, summary }))

      // Failed status is surfaced (header pill + step tag), and no console.error fired.
      expect(screen.getAllByText(en['status.failed']).length).toBeGreaterThan(0)
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  // 9. Reloading with updated data re-renders the correct state.
  it('re-renders the correct state when the supplied run data changes', () => {
    const completed = toRunSummary(emptyRun('run_reload_001', 'completed', [
      { stepId: 's01', index: 1, phase: 'A', name: 'Problem framing', status: 'passed', attempt: 1, humanGate: false, gateOutcomes: [] },
    ]))
    const failed = toRunSummary(emptyRun('run_reload_002', 'failed', [
      { stepId: 's01', index: 1, phase: 'A', name: 'Problem framing', status: 'failed', attempt: 1, humanGate: false, gateOutcomes: [] },
    ]))

    const { rerender } = renderComp(createElement(ResearchView, { t, summary: completed }))
    expect(screen.getByText(en['status.completed'])).toBeTruthy()

    rerender(createElement(ResearchView, { t, summary: failed }))
    expect(screen.queryByText(en['status.completed'])).toBeNull()
    expect(screen.getAllByText(en['status.failed']).length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/** A minimal run with no steps (used for empty/error/reload states). */
function emptyRun(
  runId: string,
  status: RunSummaryInput['status'],
  steps: ReadonlyArray<StepView> = [],
): RunSummaryInput {
  return {
    runId,
    status,
    steps,
    artifacts: [],
    gates: [],
    abstentions: [],
    degradations: [],
    deliverables: [],
  }
}

/** A 16-step run exercising every status mapping the spec calls out. */
function buildStatusFixture(): RunSummaryInput {
  const passed = (id: string, index: number, phase: StepView['phase'], name: string): StepView => ({
    stepId: id, index, phase, name, status: 'passed', attempt: 1, humanGate: false, gateOutcomes: [],
  })
  return {
    runId: 'run_dom_status_001',
    status: 'completed',
    steps: [
      passed('s01', 1, 'A', 'Problem framing'),
      passed('s02', 2, 'A', 'Literature survey'),
      passed('s03', 3, 'A', 'Hypothesis formalization'),
      passed('s04', 4, 'A', 'Research design'),
      passed('s05', 5, 'B', 'Adversarial critique'),
      passed('s06', 6, 'B', 'Judge vote'),
      passed('s07', 7, 'B', 'External anchoring'),
      // hold_abstained: gated, frozen on a gate abstention.
      {
        stepId: 's08', index: 8, phase: 'B', name: 'Adversarial convergence', status: 'gated',
        attempt: 3, humanGate: false, holdReason: 'gate_abstained',
        gateOutcomes: [{ component: 'A', outcome: 'abstained' }],
      },
      passed('s09', 9, 'B', 'Falsifiable prediction'),
      passed('s10', 10, 'C', 'Experiment design'),
      passed('s11', 11, 'C', 'Experiment execution'),
      passed('s12', 12, 'C', 'Experiment adjudication'),
      passed('s13', 13, 'D', 'Figure synthesis'),
      passed('s14', 14, 'D', 'Table synthesis'),
      // E2 human pending: human-gated, held awaiting a human decision.
      {
        stepId: 's15', index: 15, phase: 'E', name: 'Human verification (E2)', status: 'gated',
        attempt: 1, humanGate: true, holdReason: 'human_gate', gateOutcomes: [],
      },
      // blocked step.
      {
        stepId: 's16', index: 16, phase: 'E', name: 'Manuscript drafting', status: 'blocked',
        attempt: 1, humanGate: false, gateOutcomes: [],
      },
    ],
    artifacts: [
      {
        slug: 'mock_artifact', producerStepId: 's01', producerAttemptId: 1, producedAt: 0,
        invalidated: false, summary: 'Mock artifact summary text.',
      },
    ],
    gates: [
      // abstained gate outcome (component A).
      {
        stepId: 's08', component: 'A', outcome: 'abstained', passed: false,
        evidence: 'e', rationale: 'r', timestamp: 0,
      },
      {
        stepId: 's01', component: 'B', outcome: 'passed', passed: true,
        evidence: 'e', rationale: 'r', timestamp: 0,
      },
    ],
    abstentions: [
      {
        runId: 'run_dom_status_001', stepId: 's08', attemptId: 3, component: 'A',
        reasonCode: 'INSUFFICIENT_EVIDENCE', evidenceRefs: [], recordedAt: '2026-09-03T08:17:00.000Z',
      },
    ],
    degradations: [
      { kind: 'quality', message: 'Mock degradation note for DOM test.' },
    ],
    deliverables: [],
  }
}

// ===========================================================================
// 10. Host summary injection (T34 / B6) — the workbench data seam.
// ===========================================================================
describe('research workbench summary injection', () => {
  it('invents no run: with nothing supplied it renders no step rows at all', () => {
    const run = buildSummary(RESEARCH_FIXTURE)
    // Control: a supplied run does render its steps, so the assertion below is about absence
    // rather than about a list that would be empty either way.
    expect(run.steps.length).toBeGreaterThan(0)

    renderComp(createElement(ResearchWorkbench, { t }))
    expect(screen.getByText(en['intro.noRun'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: en['tab.summary'] })).toBeNull()
    cleanup()

    renderComp(createElement(ResearchWorkbench, { t, summary: run }))
    expect(screen.getByRole('button', { name: en['tab.summary'] })).toBeTruthy()
    expect(screen.getByText(/Step progress/)).toBeTruthy()
  })
})

// ===========================================================================
// 10b. The run control (T44 wiring).
//
// The workbench could render an injected summary but had no way to OBTAIN one, so
// the badge said MOCK unconditionally and no caller could start a run. These tests
// pin the three behaviours that wiring introduces: the badge follows the summary's
// source, the button starts a run and swaps the rendered summary, and a failed run
// says so instead of leaving the fixture on screen.
// ===========================================================================
describe('research workbench run control', () => {
  it('stops labelling a live run as demo data', async () => {
    const live = toRunSummary({ ...fixtureInput(), source: 'live' })
    renderComp(createElement(ResearchWorkbench, { t, summary: live }))

    // Both the workbench and the summary panel carry a source badge, so the
    // assertion counts rather than fetching a single node.
    expect(screen.queryAllByText(en['mock.badge'])).toHaveLength(0)
    expect(screen.getAllByText(en['source.live']).length).toBeGreaterThan(0)
  })

  it('renders no run control when the caller supplies no run source', () => {
    renderComp(createElement(ResearchWorkbench, { t }))

    expect(screen.queryByRole('button', { name: en['run.action'] })).toBeNull()
  })

  it('starts a run and renders the summary it reports', async () => {
    const live = toRunSummary({ ...fixtureInput(), runId: 'run-live-42', source: 'live' })
    const onRun = vi.fn(async (_plan: unknown, onUpdate: (summary: typeof live) => void) => { onUpdate(live) })
    renderComp(createElement(ResearchWorkbench, { t, onRun }))

    // Before the run there is nothing to label: no badge, and the page says so.
    expect(screen.queryByText(en['source.live'])).toBeNull()
    expect(screen.getByText(en['intro.noRun'])).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['run.action'] })) })

    expect(onRun).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(en['intro.noRun'])).toBeNull()
    expect(screen.getAllByText(en['source.live']).length).toBeGreaterThan(0)
  })

  it('renders a run the source is still following, and says what is driving it', async () => {
    // THE POINT OF THE STREAMING SEAM. The run source holds the promise open — the study is not
    // over — and the page already shows the run: its identity, its state, and the fact that
    // something is driving it. The alternative was a blank page for the eight minutes a study takes.
    const partial = toRunSummary({
      ...fixtureInput(),
      runId: 'run-live-7',
      source: 'live',
      execution: 'running',
    })
    let finish: () => void = () => {}
    const onRun = vi.fn(async (_plan: unknown, onUpdate: (summary: typeof partial) => void) => {
      onUpdate(partial)
      await new Promise<void>((resolve) => { finish = resolve })
    })
    renderComp(createElement(ResearchWorkbench, { t, onRun }))

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['run.action'] })) })

    // The run is on screen while its promise is unresolved. (Two panels carry the source badge, so
    // this counts rather than fetching one node.)
    expect(screen.getAllByText(en['source.live']).length).toBeGreaterThan(0)
    expect(screen.getByText(en['run.id'].replace('{runId}', 'run-live-7'))).toBeTruthy()
    expect(screen.getByText(en['run.execution.running'])).toBeTruthy()
    // And the control says it is still working, so nobody reads the page as finished.
    expect(screen.getByRole('button', { name: en['run.running'] })).toBeTruthy()

    await act(async () => { finish() })
  })

  it('picks up the run a reload interrupted, without waiting for a new one', async () => {
    // A RELOAD IS NOT A NEW STUDY. The host is still driving the run this browser started, so the
    // page asks what became of it on arrival. Nothing to resume is the normal first-visit case and
    // reports nothing.
    const known = toRunSummary({ ...fixtureInput(), runId: 'run-after-reload', source: 'live', execution: 'running' })
    const onResume = vi.fn(async (onUpdate: (summary: typeof known) => void) => { onUpdate(known) })
    renderComp(createElement(ResearchWorkbench, { t, onResume }))

    await waitFor(() => { expect(onResume).toHaveBeenCalledTimes(1) })
    expect(screen.getByText(en['run.id'].replace('{runId}', 'run-after-reload'))).toBeTruthy()
    expect(screen.queryByText(en['intro.noRun'])).toBeNull()
  })

  it('shows no run when there is nothing to resume, and does not report one as an error', async () => {
    // The common case: a first visit. A resume that found nothing must leave the orientation block
    // alone rather than putting a failure on a page where nothing went wrong.
    const onResume = vi.fn(async () => {})
    renderComp(createElement(ResearchWorkbench, { t, onResume }))

    await waitFor(() => { expect(onResume).toHaveBeenCalledTimes(1) })
    expect(screen.getByText(en['intro.noRun'])).toBeTruthy()
    expect(document.querySelector('[data-research-run-id]')).toBeNull()
  })

  it('shows the failure a run stopped with, and does not claim it is still running', async () => {
    // A driver that threw is a run-level fact: the steps say how far the study got, and this says
    // whatever was going to continue it is gone. Reporting only the steps leaves a reader waiting
    // on a run nothing is driving.
    const broken = toRunSummary({
      ...fixtureInput(),
      runId: 'run-live-9',
      source: 'live',
      execution: 'failed',
      executionError: 'the claim channel is unreachable',
    })
    const onRun = vi.fn(async (_plan: unknown, onUpdate: (summary: typeof broken) => void) => { onUpdate(broken) })
    renderComp(createElement(ResearchWorkbench, { t, onRun }))

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['run.action'] })) })

    const badge = document.querySelector('[data-research-execution]')
    expect(badge?.textContent).toContain(en['run.execution.failed'])
    // The REASON, not just the state: "it failed" without "why" is the report the user cannot act on.
    expect(badge?.textContent).toContain('the claim channel is unreachable')
  })

  it('offers a save retry on the host’s own report, and hands the refreshed run to the page', async () => {
    // THE ONE REMEDY FOR A RUN THAT IS NOT ON DISK. The host reports the failure with its own reason,
    // and the control that fixes it is offered on THAT report — not on a guess, and not as a new run:
    // the retry writes the state the host already holds, so the study is not carried out again.
    const broken = toRunSummary({
      ...fixtureInput(),
      runId: 'run-live-9',
      source: 'live',
      saveFailure: 'ENOSPC: no space left on device, write',
    })
    const healed = toRunSummary({
      ...fixtureInput(),
      runId: 'run-live-9',
      source: 'live',
      projectRevision: 16,
    })
    const onRun = vi.fn(async (_plan: unknown, onUpdate: (summary: typeof broken) => void) => { onUpdate(broken) })
    const onRetrySave = vi.fn(async (_runId: string, onUpdate: (summary: typeof healed) => void) => { onUpdate(healed) })
    renderComp(createElement(ResearchWorkbench, { t, onRun, onRetrySave }))

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['run.action'] })) })

    // THE HOST'S REASON IS SHOWN AS IT STATED IT, beside the control that fixes it.
    const failure = document.querySelector('[data-research-save-failure]')
    expect(failure?.textContent).toContain('ENOSPC: no space left on device, write')
    const retry = screen.getByRole('button', { name: en['run.retrySave'] })

    await act(async () => { fireEvent.click(retry) })

    // THE RUN ID IS THE HOST'S, and the page renders the run the retry answered with — the revision a
    // decision has to be taken against, not one this page remembered.
    expect(onRetrySave).toHaveBeenCalledWith('run-live-9', expect.any(Function))
    expect(document.querySelector('[data-research-save-failure]')).toBeNull()
    expect(document.querySelector('[data-research-revision]')?.textContent)
      .toContain('16')
  })

  it('offers the studies the deployment holds, and opens the one that is picked', async () => {
    // THE HANDLE A CLOSED PAGE LOSES. A page whose only way back to a study was the id in its own
    // session storage showed "nothing has been run" after the page was closed — while the study was
    // on disk the whole time. The list is the deployment's answer, not this tab's memory.
    const healed = toRunSummary({ ...fixtureInput(), runId: 'run-held-7', source: 'live' })
    const onListRuns = vi.fn(async () => ([
      {
        runId: 'run-held-7',
        execution: 'stopped' as const,
        projectRevision: 19,
        stepsPassed: 12,
        stepsTotal: 16,
        submissionReady: false,
        saveFailure: null,
        executionError: null,
        interrupted: ['D3-writing'],
      },
    ]))
    const onOpenRun = vi.fn(async (_runId: string, onUpdate: (summary: typeof healed) => void) => { onUpdate(healed) })
    renderComp(createElement(ResearchWorkbench, { t, onListRuns, onOpenRun }))

    // THE LIST IS READ ON ARRIVAL, and it says what the person needs to choose: how far the study got,
    // what state it is in, and — for one this process is not driving — what was in flight.
    await waitFor(() => { expect(document.querySelector('[data-research-project="run-held-7"]')).toBeTruthy() })
    const row = document.querySelector('[data-research-project="run-held-7"]')
    expect(row?.textContent).toContain('12 of 16 steps passed')
    expect(row?.textContent).toContain(en['run.execution.stopped'])
    expect(row?.textContent).toContain('D3-writing')

    await act(async () => {
      fireEvent.click(within(row as HTMLElement).getByRole('button', { name: en['projects.open'] }))
    })
    // The third argument is the phase channel: the page's link state, which the follow loop reports.
    // Asserted by shape rather than ignored, because a caller that stopped threading it would leave
    // the page unable to say what its link is doing.
    expect(onOpenRun).toHaveBeenCalledWith('run-held-7', expect.any(Function), expect.any(Function))
    // AND THE STUDY IT ANSWERED WITH IS WHAT THE PAGE SHOWS.
    expect(document.querySelector('[data-research-run-id]')?.textContent).toContain('run-held-7')
  })

  it('says the list could not be read instead of saying there are no studies', async () => {
    // "I could not ask" and "there is nothing" have different remedies, and telling a person their
    // work is gone when the question failed is the worse of the two mistakes.
    const onListRuns = vi.fn().mockRejectedValue(new Error('the snapshot root cannot be read'))
    const onOpenRun = vi.fn()
    renderComp(createElement(ResearchWorkbench, { t, onListRuns, onOpenRun }))

    await waitFor(() => {
      expect(screen.getByText(en['projects.listFailed'].replace('{message}', 'the snapshot root cannot be read'))).toBeTruthy()
    })
    expect(screen.queryByText(en['projects.empty'])).toBeNull()
  })

  it('offers no study list when the host cannot list one', async () => {
    renderComp(createElement(ResearchWorkbench, { t }))
    expect(document.querySelector('[data-research-projects]')).toBeNull()
  })

  it('offers no save retry when the host reports no failed write', async () => {
    // THE CONTROL FOLLOWS THE FACT. A retry button on a run that is on disk would read as a remedy
    // this deployment does not need, and a host that cannot retry one has no control at all.
    const healthy = toRunSummary({ ...fixtureInput(), source: 'live' })
    const onRun = vi.fn(async (_plan: unknown, onUpdate: (summary: typeof healthy) => void) => { onUpdate(healthy) })
    renderComp(createElement(ResearchWorkbench, { t, onRun, onRetrySave: vi.fn() }))

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['run.action'] })) })

    expect(screen.queryByRole('button', { name: en['run.retrySave'] })).toBeNull()
    expect(document.querySelector('[data-research-save-failure]')).toBeNull()
  })

  it('reports a failed run instead of leaving the fixture on screen', async () => {
    const onRun = vi.fn().mockRejectedValue(new Error('gateway refused the call'))
    renderComp(createElement(ResearchWorkbench, { t, onRun }))

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['run.action'] })) })

    // The failure is stated with its cause, and no run is passed off as the result.
    expect(screen.getByText(en['run.error'].replace('{message}', 'gateway refused the call'))).toBeTruthy()
    expect(screen.getByText(en['intro.noRun'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: en['tab.summary'] })).toBeNull()
  })
})

// ===========================================================================
// 12. Orientation (U1): what this tab is, what to do with it, and where the
//     numbers on screen came from.
//
// The tab used to be a badge, a run button and nine unlabelled panels. These
// assertions are what a person who has not read the design documents needs in
// order to start a run and know what they are looking at.
// ===========================================================================
describe('research workbench orientation', () => {
  it('says what the pipeline is, how to start it, and where the products go', () => {
    renderComp(createElement(ResearchWorkbench, { t }))

    expect(screen.getByRole('heading', { name: en['intro.title'] })).toBeTruthy()
    expect(screen.getByText(en['intro.what'])).toBeTruthy()
    expect(screen.getByRole('heading', { name: en['intro.how'] })).toBeTruthy()
    for (const key of ['intro.step1', 'intro.step2', 'intro.step3'] as const) {
      expect(screen.getByText(en[key])).toBeTruthy()
    }
  })

  it('says nothing has been run, rather than showing a run that did not happen', () => {
    renderComp(createElement(ResearchWorkbench, { t }))

    expect(screen.getByText(en['intro.noRun'])).toBeTruthy()
    // No run means no next action to derive and no panel to derive it from.
    expect(screen.queryByText(/^Next:/)).toBeNull()
    expect(screen.queryByRole('button', { name: en['tab.summary'] })).toBeNull()
  })

  it('names the channel a live run\'s manuscript prose came from', () => {
    const offline = toRunSummary({
      ...fixtureInput(),
      source: 'live',
      steps: [{
        stepId: 'D3-writing', index: 15, phase: 'D', name: 'Manuscript drafting',
        status: 'passed', attempt: 1, humanGate: false, gateOutcomes: [], executionKind: 'mock_external',
      }],
    })
    renderComp(createElement(ResearchWorkbench, { t, summary: offline }))

    expect(screen.queryByText(en['intro.noRun'])).toBeNull()
    expect(screen.getByText(en['channel.deterministic'])).toBeTruthy()
    expect(screen.getByText(en['intro.next'].replace('{action}', en['next.complete']))).toBeTruthy()
  })

  it('points at the approval tab when the run is waiting for a person', () => {
    const waiting = toRunSummary({
      ...fixtureInput(),
      source: 'live',
      steps: [{
        stepId: 'E2-submit', index: 16, phase: 'E', name: 'Submission',
        status: 'gated', attempt: 1, humanGate: true, holdReason: 'human_gate', gateOutcomes: [],
      }],
    })
    renderComp(createElement(ResearchWorkbench, { t, summary: waiting }))

    const expected = en['next.awaitingHuman'].replace('{count}', '1')
    expect(screen.getByText(en['intro.next'].replace('{action}', expected))).toBeTruthy()
  })
})

// ===========================================================================
// 11. Every workbench tab renders (T34 / B5).
//
// Before this spec only 3 of the 9 tabs were ever clicked, so the other six panel
// components never executed under test. A panel that dereferences a missing field,
// or throws while rendering, surfaces as a React console.error — which is what this
// asserts against, so the check fails when a panel breaks rather than merely
// confirming the click did not throw.
// ===========================================================================
describe('research workbench tab coverage', () => {
  it('renders all nine tabs without logging a console error', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      renderComp(createElement(ResearchWorkbench, { t, summary: buildSummary(RESEARCH_FIXTURE) }))

      const tabLabels = [
        'tab.summary', 'tab.pipeline', 'tab.figures', 'tab.tables', 'tab.roadmap',
        'tab.gates', 'tab.adversarial', 'tab.approval', 'tab.recovery',
      ] as const

      for (const key of tabLabels) {
        const button = screen.getByRole('button', { name: en[key] })
        fireEvent.click(button)
        // The tab strip survives the switch, i.e. the panel did not take the tree down.
        expect(screen.getByRole('button', { name: en[key] })).toBeTruthy()
      }

      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })
})

// ===========================================================================
// S5: the six stages, and what each one reports.
//
// The stage view is a VIEW: every state below is asserted to come from the run's own step outcomes,
// so a collapse or a click can never change whether a study advances.
// ===========================================================================
describe('research workbench stages', () => {
  const REAL_STEPS: ReadonlyArray<{ id: string; index: number; phase: StepView['phase'] }> = [
    { id: 'A1-landscape', index: 1, phase: 'A' },
    { id: 'A2-claim', index: 2, phase: 'A' },
    { id: 'A3-agenda', index: 3, phase: 'A' },
    { id: 'A4-venue', index: 4, phase: 'A' },
    { id: 'B1-method', index: 5, phase: 'B' },
    { id: 'B2-data', index: 6, phase: 'B' },
    { id: 'B3-baseline', index: 7, phase: 'B' },
    { id: 'C1-mvp', index: 8, phase: 'C' },
    { id: 'C2-trinity-loop', index: 9, phase: 'C' },
    { id: 'C3-boundary', index: 10, phase: 'C' },
    { id: 'D1-figure-map', index: 11, phase: 'D' },
    { id: 'D2-framework', index: 12, phase: 'D' },
    { id: 'D3-writing', index: 13, phase: 'D' },
    { id: 'D4-rebuttal', index: 14, phase: 'D' },
    { id: 'E1-format', index: 15, phase: 'E' },
    { id: 'E2-submit', index: 16, phase: 'E' },
  ]

  /** A run carrying the engine's real steps, with the statuses given. */
  function realRun(
    overrides: Readonly<Record<string, StepView['status']>>,
    detail?: { readonly stepId: string; readonly extra: Partial<StepView> },
  ): RunSummaryInput {
    return emptyRun('run_stages_dom', 'running', REAL_STEPS.map(definition => ({
      stepId: definition.id, index: definition.index, phase: definition.phase, name: definition.id,
      status: overrides[definition.id] ?? 'pending',
      attempt: overrides[definition.id] === undefined ? 0 : 1,
      humanGate: definition.id === 'E2-submit',
      gateOutcomes: [],
      ...(detail?.stepId === definition.id ? detail.extra : {}),
    })))
  }

  /** Mount the workbench over a summary and return the stage strip. */
  function mountStages(input: RunSummaryInput) {
    renderComp(createElement(ResearchWorkbench, { t, summary: buildSummary(input) }))
    return screen.getByRole('navigation', { name: en['stages.title'] })
  }

  it('renders the six stages in order, with the run own counts', () => {
    const strip = mountStages(realRun({ 'A1-landscape': 'passed', 'A2-claim': 'passed' }))
    const buttons = within(strip).getAllByRole('button')
    expect(buttons.map(button => button.getAttribute('data-research-stage'))).toEqual([
      'intake', 'literature', 'method', 'results', 'writing', 'delivery',
    ])
    // The strip states each stage's own count; the numbers are what a reader checks, and they come
    // from the run rather than from the strip.
    expect(within(strip).getByRole('button', { name: new RegExp(en['stages.literature']) })
      .textContent).toContain('2 of 4')
  })

  it('opens on the stage the study is actually in', () => {
    // A1 and A2 passed, A3 in flight: the literature stage is where the work is, and a page that
    // just loaded must not open on the intake group.
    mountStages(realRun({ 'A1-landscape': 'passed', 'A2-claim': 'passed', 'A3-agenda': 'in_progress' }))
    expect(screen.getByRole('button', { name: new RegExp(en['stages.literature']) })
      .getAttribute('aria-current')).toBe('step')
  })

  it('keeps a decision waiting on a person apart from progress', () => {
    const strip = mountStages(realRun({
      'A1-landscape': 'passed', 'A2-claim': 'passed', 'A3-agenda': 'passed', 'A4-venue': 'passed',
      'B1-method': 'passed', 'B2-data': 'passed', 'B3-baseline': 'passed',
      'C1-mvp': 'passed', 'C2-trinity-loop': 'passed', 'C3-boundary': 'passed', 'D1-figure-map': 'passed',
      'D2-framework': 'passed', 'D3-writing': 'passed', 'D4-rebuttal': 'passed', 'E1-format': 'passed',
      'E2-submit': 'gated',
    }))
    expect(within(strip).getByRole('button', { name: new RegExp(en['stages.delivery']) })
      .getAttribute('data-research-stage-state')).toBe('awaiting-human')
    // The decision is counted as a to-do, never as progress towards completion.
    expect(screen.getByText(en['progress.awaitingHuman']).parentElement?.textContent).toContain('1')
  })

  it('names the cause of a failure on the stage that failed', () => {
    renderComp(createElement(ResearchWorkbench, {
      t,
      summary: buildSummary(realRun({ 'C1-mvp': 'failed' }, {
        stepId: 'C1-mvp', extra: { executeError: 'the experiment runner exited 1' },
      })),
    }))
    const strip = screen.getByRole('navigation', { name: en['stages.title'] })
    fireEvent.click(within(strip).getByRole('button', { name: new RegExp(en['stages.results']) }))
    // Scoped to the stage workspace: the same failure also appears in the summary panel, and the
    // claim here is that THIS stage names it.
    const workspace = document.querySelector('[data-research-stage-workspace="results"]') as HTMLElement
    expect(within(workspace).getByText('the experiment runner exited 1')).toBeTruthy()
  })

  it('says what a later stage is waiting for instead of offering it', () => {
    const strip = mountStages(realRun({ 'A1-landscape': 'in_progress' }))
    fireEvent.click(within(strip).getByRole('button', { name: new RegExp(en['stages.delivery']) }))
    expect(screen.getByText(en['stages.explain.not-started'])).toBeTruthy()
  })

  it('does not render an empty panel for the group the person supplies', () => {
    const strip = mountStages(realRun({}))
    fireEvent.click(within(strip).getByRole('button', { name: new RegExp(en['stages.intake']) }))
    expect(screen.getByText(en['stages.intakeNote'])).toBeTruthy()
  })

  it('reports a projection this build cannot place instead of calling it the person own', () => {
    // The synthetic fixture carries ids this build does not know: every stage must say so rather
    // than rendering the intake note over steps that exist on the host.
    mountStages(fixtureInput())
    const prefix = en['stages.missingSteps'].split('{')[0] as string
    expect(screen.getAllByText(new RegExp(prefix)).length).toBeGreaterThan(0)
    // And the intake group is NOT what it says: the run's steps exist, this build just cannot place
    // them, so the person's own material is not claimed to be the thing on screen.
    expect(screen.queryByText(en['stages.intakeNote'])).toBeNull()
  })

  it('shows counts rather than a percentage', () => {
    renderComp(createElement(ResearchWorkbench, {
      t,
      summary: buildSummary(realRun({ 'A1-landscape': 'passed', 'A2-claim': 'passed' })),
    }))
    const line = screen.getByText(en['progress.steps']).parentElement
    expect(line?.textContent).toContain('2 / 16')
    expect(line?.textContent).not.toMatch(/%/)
  })
})

// ===========================================================================
// A study opened second is not overwritten by the first.
// ===========================================================================
describe('a late read of another study', () => {
  it('cannot replace the study the person moved to', async () => {
    const studies = [
      { runId: 'run-first', execution: 'stopped', projectRevision: 3, stepsPassed: 1, stepsTotal: 16, submissionReady: false, saveFailure: null, executionError: null, interrupted: [] },
      { runId: 'run-second', execution: 'stopped', projectRevision: 9, stepsPassed: 7, stepsTotal: 16, submissionReady: false, saveFailure: null, executionError: null, interrupted: [] },
    ]
    const callbacks: Array<(summary: ReturnType<typeof buildSummary>) => void> = []
    const onOpenRun = vi.fn((_runId: string, onUpdate: (summary: ReturnType<typeof buildSummary>) => void) => {
      callbacks.push(onUpdate)
      return Promise.resolve()
    })
    renderComp(createElement(ResearchWorkbench, {
      t,
      onListRuns: () => Promise.resolve(studies),
      onOpenRun,
    }))
    await screen.findByText('run-first')
    const buttons = screen.getAllByRole('button', { name: en['projects.open'] })
    fireEvent.click(buttons[0] as HTMLElement)
    await waitFor(() => { expect(onOpenRun).toHaveBeenCalledTimes(1) })
    fireEvent.click(buttons[1] as HTMLElement)
    await waitFor(() => { expect(onOpenRun).toHaveBeenCalledTimes(2) })

    // The study the person moved to arrives, and the page shows it.
    await act(async () => {
      callbacks[1]?.(buildSummary(emptyRun('run-second', 'stopped', [
        { stepId: 'A1-landscape', index: 1, phase: 'A', name: 'A1', status: 'passed', attempt: 1, humanGate: false, gateOutcomes: [] },
      ])))
    })
    const shown = () => document.querySelector('[data-research-run-id]')?.textContent ?? ''
    expect(shown()).toContain('run-second')

    // The FIRST study's follow answers late. Its numbers describe another study, and the page must
    // stay on the one the person picked.
    await act(async () => {
      callbacks[0]?.(buildSummary(emptyRun('run-first', 'stopped', [
        { stepId: 'A1-landscape', index: 1, phase: 'A', name: 'A1', status: 'pending', attempt: 0, humanGate: false, gateOutcomes: [] },
      ])))
    })
    expect(shown()).toContain('run-second')
    expect(shown()).not.toContain('run-first')
  })
})

// ===========================================================================
// S5: what the page says about its own link, and what it stops offering.
//
// A page that stopped receiving updates and a study that stopped producing them look the same in the
// DOM. These cases drive the phase channel the follow loop reports and assert both halves of the
// answer: the page says what its link is doing, and it stops offering a decision that would be taken
// against a revision it cannot confirm.
// ===========================================================================
describe('the page reports what its link is doing', () => {
  /** The gate summary, injected so the panel renders without a follow of its own. */
  const gated = (): RunSummaryInput => ({
    runId: 'run_link_1',
    source: 'live',
    projectRevision: 4,
    status: 'awaiting-approval',
    steps: [{
      stepId: 'E2-submit', index: 16, phase: 'E', name: 'Submission', status: 'gated',
      attempt: 1, humanGate: true, holdReason: 'human_gate', gateOutcomes: [],
    }],
    artifacts: [], gates: [], abstentions: [], degradations: [], deliverables: [],
  })

  /** Mount a workbench whose resume reports the phases the case drives. */
  function mounted(phases: ReadonlyArray<'open-requested' | 'frame' | 'reconnect' | 'resync' | 'offline'>) {
    const submitter = vi.fn(() => Promise.resolve({ ok: true as const, receipt: {
      runId: 'run_link_1', stepId: 'E2-submit', attempt: 1, status: 'passed', operator: 'operator',
      decision: 'approved' as const, approvalEventId: 'evt-1', decidedAt: 1, persisted: true,
    } }))
    const onResume = vi.fn(async (onUpdate: (summary: ReturnType<typeof buildSummary>) => void,
      onPhase?: (state: ConnectionState) => void) => {
      onUpdate(buildSummary(gated()))
      for (const phase of phases) {
        if (phase === 'open-requested') onPhase?.({ phase: 'connecting', attempts: 0 })
        if (phase === 'frame') onPhase?.({ phase: 'live', attempts: 0 })
        if (phase === 'reconnect') onPhase?.({ phase: 'reconnecting', attempts: 1, reason: 'socket closed' })
        if (phase === 'resync') onPhase?.({ phase: 'resyncing', attempts: 1 })
        if (phase === 'offline') onPhase?.({ phase: 'offline', attempts: 3, reason: 'budget spent' })
      }
    })
    renderComp(createElement(ResearchWorkbench, {
      t, onResume, onApprove: submitter,
    }))
    return submitter
  }

  it('says it is connected when frames are arriving', async () => {
    mounted(['open-requested', 'frame'])
    const line = await screen.findByText(en['connection.phase.live'])
    expect(line.getAttribute('data-research-connection')).toBe('live')
    // The stale note belongs to a link that has given up, not to a live one.
    expect(screen.queryByText(new RegExp(en['connection.stale']))).toBeNull()
  })

  it('keeps the last state and says it may not be current once the budget is spent', async () => {
    mounted(['open-requested', 'frame', 'reconnect', 'offline'])
    const line = await screen.findByText(new RegExp(en['connection.phase.offline']))
    expect(line.getAttribute('data-research-connection')).toBe('offline')
    // THE TWO FACTS ARE SEPARATE: what the link is doing, and that what is on screen may be behind.
    expect(line.textContent).toContain(en['connection.stale'])
    expect(line.textContent).toContain('budget spent')
  })

  it('closes a decision while the link is out of step, and reopens it when it is live', async () => {
    mounted(['open-requested', 'reconnect'])
    fireEvent.click(screen.getByRole('button', { name: en['tab.approval'] }))
    const approve = await screen.findByRole('button', { name: en['approval.approve'] })
    // RECONNECTING IS NOT LIVE ENOUGH: a decision is about a revision, and this page cannot confirm
    // the run is still at the one it is showing.
    expect((approve as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(en['approval.offline'])).toBeTruthy()
  })

  it('renders no link line for a page that has no run', () => {
    renderComp(createElement(ResearchWorkbench, { t }))
    // A PAGE WITH NO RUN HAS NO LINK: an idle line over an empty screen would report a connection the
    // page never needed.
    expect(document.querySelector('[data-research-connection]')).toBeNull()
  })
})

// ===========================================================================
// A stopped study can be taken back into the deployment's process.
//
// An approval is refused for a run the process does not hold — the right rule, since a decision has
// to be written into the run's state. Without this control a study that reached the human gate and
// survived a restart could be found, read, and never decided.
// ===========================================================================
describe('taking a stopped study back', () => {
  const studies = [
    {
      runId: 'run-stopped', execution: 'stopped', projectRevision: 9, stepsPassed: 15, stepsTotal: 16,
      submissionReady: false, saveFailure: null, executionError: null, interrupted: [],
    },
  ]

  it('offers the control for a study nothing is driving, and calls the host', async () => {
    const onAdoptRun = vi.fn((_runId: string, onUpdate: (summary: ReturnType<typeof buildSummary>) => void) => {
      onUpdate(buildSummary(emptyRun('run-stopped', 'completed', [
        { stepId: 'E2-submit', index: 16, phase: 'E', name: 'Submission', status: 'gated', attempt: 1, humanGate: true, gateOutcomes: [] },
      ])))
      return Promise.resolve()
    })
    renderComp(createElement(ResearchWorkbench, {
      t,
      onListRuns: () => Promise.resolve(studies),
      onOpenRun: vi.fn(() => Promise.resolve()),
      onAdoptRun,
    }))
    const adopt = await screen.findByRole('button', { name: en['projects.adopt'] })
    expect(adopt.getAttribute('data-research-adopt')).toBe('run-stopped')
    fireEvent.click(adopt)

    await waitFor(() => { expect(onAdoptRun).toHaveBeenCalledTimes(1) })
    expect(onAdoptRun.mock.calls[0]?.[0]).toBe('run-stopped')
    // The study it reports is the one on screen afterwards, so the reader can go on to decide it.
    // The picker's row also carries the id, so this reads the run view's own field.
    await waitFor(() => {
      expect(document.querySelector('[data-research-run-id]')?.textContent).toContain('run-stopped')
    })
  })

  it('offers no adoption when the host cannot adopt one', async () => {
    renderComp(createElement(ResearchWorkbench, {
      t,
      onListRuns: () => Promise.resolve(studies),
      onOpenRun: vi.fn(() => Promise.resolve()),
    }))
    await screen.findByText('run-stopped')
    // THE CONTROL FOLLOWS THE HOST, not the study: a deployment that cannot adopt shows no button
    // rather than one whose only outcome is a refusal.
    expect(document.querySelector('[data-research-adopt]')).toBeNull()
  })
})
