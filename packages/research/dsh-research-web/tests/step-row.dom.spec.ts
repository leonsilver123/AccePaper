// @vitest-environment jsdom
/**
 * One step's row, and what its expansion holds.
 *
 * THE READER IS THE RESEARCHER. The row used to carry the engine's identifier right under the step's
 * name — `D3-writing · attempt 1` — which is the one fact about a step that a researcher cannot read
 * and the one fact an engineer cannot work without. So this spec pins both halves of the split:
 *   - the row says the step's name and WHAT THE STEP IS FOR, and does not say the identifier;
 *   - the expansion holds the identifier, the judgement checks, the refusing verdict's own sentence,
 *     and the products the step produced, by name.
 */
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { en } from '../src/client/locales.ts'
import { buildSummary } from '../src/loader.ts'
import type { StageView } from '../src/stages.ts'
import { StageWorkspace } from '../src/client/workbench/StageWorkspace.tsx'
import type { GateHistoryEntry, RunSummaryInput, StepView } from '../src/summary.ts'

/** Translate double over the `research` English dictionary (mirrors LocaleRuntime's chain). */
function makeTranslate(dict: Readonly<Record<string, string>>) {
  return (key: string, params?: Record<string, unknown>): string => {
    const template = dict[key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match)
  }
}

const t = makeTranslate(en)

/** One step of a run. */
function step(overrides: Partial<StepView> & Pick<StepView, 'stepId' | 'status'>): StepView {
  return {
    index: 12, phase: 'D', name: overrides.stepId, attempt: 1, humanGate: false,
    gateOutcomes: [], ...overrides,
  }
}

/** One recorded gate verdict. */
function verdict(overrides: Partial<GateHistoryEntry>): GateHistoryEntry {
  return {
    stepId: 'D3-writing', component: 'A', outcome: 'passed', passed: true,
    evidence: '', rationale: '', timestamp: 1_700_000_000_000, ...overrides,
  }
}

/** The refusal a real run recorded against `D3-writing`. */
const REFUSAL =
  "core adjudicate('A') outcome=blocked — check(s) failed: red-method (refute: is every section the"
  + ' outline declares actually written? -> sections with an empty body: references)'

/**
 * The stage under test.
 *
 * BUILT BY HAND RATHER THAN THROUGH `selectStages`, because the branches this file has to cover are
 * component branches: a step the host gave a sentence for and one it did not, a step with verdicts and
 * one with none, a step with products and one with none, and each of the three ways a step can be
 * stopped. A stage projected from the real catalogue carries only some of those.
 */
function writingStage(): StageView {
  return {
    id: 'writing',
    declared: 4,
    missingStepIds: [],
    missingPrerequisites: [],
    counts: {
      'not-started': 0, working: 0, 'awaiting-human': 1, passed: 1, blocked: 1, failed: 1, unknown: 0,
    },
    state: 'blocked',
    steps: [
      step({
        stepId: 'D2-framework', index: 12, status: 'passed', name: '搭框架',
        purpose: '搭出论文的章节结构与大纲',
      }),
      step({
        stepId: 'D3-writing', index: 13, status: 'blocked', name: '写作',
        purpose: '起草各章节正文,并整理出参考文献',
      }),
      // The host named no sentence for this one, and no attempt has been made at it.
      step({
        stepId: 'D4-rebuttal', index: 14, status: 'gated', name: '答辩演练', attempt: 0,
        holdReason: 'gate_abstained',
      }),
      // An execution that stopped with a cause of its own.
      step({
        stepId: 'E1-format', index: 15, status: 'failed', name: '排版', attempt: 2,
        executeError: 'pandoc was not found',
      }),
    ],
  }
}

/** The run those steps belong to. */
function summaryOf(input: Partial<RunSummaryInput> = {}) {
  const base: RunSummaryInput = {
    runId: 'run_step_row_spec',
    source: 'live',
    status: 'running',
    steps: writingStage().steps,
    artifacts: [
      {
        slug: 'manuscript', producerStepId: 'D3-writing', producerAttemptId: 1, producedAt: 1,
        invalidated: false, summary: 'the assembled manuscript',
      },
      {
        slug: 'paper-outline', producerStepId: 'D2-framework', producerAttemptId: 1, producedAt: 1,
        invalidated: true, summary: 'the section structure',
      },
    ],
    gates: [
      verdict({ stepId: 'D2-framework', component: 'A' }),
      verdict({ stepId: 'D3-writing', component: 'A', outcome: 'blocked', passed: false, evidence: REFUSAL }),
    ],
    abstentions: [],
    degradations: [],
    deliverables: [],
    ...input,
  }
  return buildSummary(base)
}

/** Render the stage's steps. */
function renderStage(summary = summaryOf()) {
  const stage = writingStage()
  return render(createElement(StageWorkspace, { summary, stage, stages: [stage], t } as never))
}

afterEach(cleanup)

describe('a step row', () => {
  it('says what the step is for, in the host\u2019s own words', () => {
    renderStage()

    expect(screen.getByText('搭出论文的章节结构与大纲')).toBeTruthy()
    expect(screen.getByText('起草各章节正文,并整理出参考文献')).toBeTruthy()
  })

  it('keeps the identifier off the row and puts it in the expansion', () => {
    const { container } = renderStage()

    // The row is the step item's first element; the expansion is its second. Addressed by structure
    // rather than by a stylesheet class, because a class name is the stylesheet's business.
    const item = container.querySelector('[data-research-step="D3-writing"]')
    const row = item?.firstElementChild
    expect(row).not.toBeNull()
    expect(row?.textContent).not.toContain('D3-writing')
    // The engineer's fact is still on the page, one click down, and the attempt travels with it.
    const details = container.querySelector('[data-research-step-details="D3-writing"]')
    expect(details?.textContent).toContain('D3-writing')
    expect(details?.textContent).toContain(en['step.identifier'])
  })

  it('names the products the step produced, not the slugs the registry keys on', () => {
    const { container } = renderStage()

    const details = container.querySelector('[data-research-step-details="D3-writing"]')
    expect(details?.textContent).toContain(en['artifactName.manuscript'])
    // The stage's own product list names them too — a slug is what a reader cannot use, so it is not
    // what either surface shows.
    const outcomes = container.querySelector('[data-research-stage-artifacts]')
    expect(outcomes?.textContent).toContain(en['artifactName.paper-outline'])
    expect(outcomes?.textContent).not.toContain('paper-outline')
    expect(outcomes?.textContent).toContain(en['artifact.invalidated'])
  })

  it('carries the refusing verdict\u2019s own sentence, verbatim', () => {
    const { container } = renderStage()

    const shown = container.querySelector('[data-research-step-verdict="D3-writing"]')
    expect(shown?.textContent).toBe(REFUSAL)
    // A step whose verdicts all passed has nothing to show there: the expansion is for the reason a
    // reader has to act on, not for a log of everything that ever happened.
    expect(container.querySelector('[data-research-step-verdict="D2-framework"]')).toBeNull()
  })

  it('names the judgement checks rather than their component letters', () => {
    const { container } = renderStage()

    const details = container.querySelector('[data-research-step-details="D3-writing"]')
    expect(details?.textContent).toContain(en['gate.component.A'])
    expect(details?.textContent).toContain(en['gate.outcome.blocked'])
    expect(details?.textContent).toContain(en['step.produced'])
  })

  it('reports each way a step can be stopped, in the run\u2019s own words where it has them', () => {
    const { container } = renderStage()

    // Waiting on a person, in the words the engine recorded.
    expect(container.querySelector('[data-research-step="D4-rebuttal"]')?.textContent)
      .toContain(en['step.holdReason.gate_abstained'])
    // And an execution that stopped with its own cause.
    expect(container.querySelector('[data-research-step-error="E1-format"]')?.textContent)
      .toBe('pandoc was not found')
    // The state of every one of them, as the tag the reader scans for.
    expect(container.querySelector('[data-research-step="D3-writing"]')?.textContent)
      .toContain(en['status.blocked'])
  })
})
