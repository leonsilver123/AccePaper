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
 * re-render, and unload/re-register lifecycle.
 */

import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { en } from '../src/client/locales.ts'
import {
  toRunSummary,
  type RunSummaryInput,
  type StepView,
} from '../src/summary.ts'
import { loadFixtureSummary } from '../src/loader.ts'
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
    renderComp(createElement(ResearchView, { t, summary: loadFixtureSummary() }))

    // The summary root heading + MOCK badge prove the view mounted (container present).
    expect(screen.getByRole('heading', { name: en['view.research'] })).toBeTruthy()
    expect(screen.getByText(en['mock.badge'])).toBeTruthy()
  })

  // 3. Nine workbench panels present and switchable (only one visible at a time).
  it('renders nine switchable panels with exactly one visible at a time', () => {
    renderComp(createElement(ResearchWorkbench, { t }))

    const tabLabels = [
      'tab.summary', 'tab.pipeline', 'tab.figures', 'tab.tables', 'tab.roadmap',
      'tab.gates', 'tab.adversarial', 'tab.approval', 'tab.recovery',
    ] as const
    for (const key of tabLabels) {
      expect(screen.getByRole('button', { name: en[key] })).toBeTruthy()
    }
    expect(screen.getAllByRole('button')).toHaveLength(9)

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
    renderComp(createElement(ResearchView, { t, summary: loadFixtureSummary() }))

    expect(screen.getAllByText(en['mock.badge']).length).toBeGreaterThan(0)
  })

  // 6. Artifact summary link/text present for a run with artifacts.
  it('renders artifact summaries for a run that produced artifacts', () => {
    renderComp(createElement(ResearchView, { t, summary: loadFixtureSummary() }))

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
  }
}
