// @vitest-environment jsdom
/**
 * 现在该你做什么 — the panel's first block.
 *
 * THE CASE THAT PRODUCED IT, and why the assertions are shaped this way. A real run stopped at
 * `D3-writing` because that step left the `references` section empty; the page said the run was still
 * working, and the stage badge beside it said 受阻 with nothing anywhere explaining it. So this spec
 * asserts three separate promises, each of which was broken before:
 *   1. a refusal is reported AS a refusal, naming the step it stopped at;
 *   2. the two ways a run stops are told apart — a decision waiting on a person and a run that cannot
 *      go on are different colours and different remedies;
 *   3. every claim about a refusal can be checked against the verdict that made it, one click away.
 *
 * The refusal sentence is the real run's own gate verdict, character for character.
 */
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { en } from '../src/client/locales.ts'
import { toRunSummary } from '../src/summary.ts'
import { buildSummary } from '../src/loader.ts'
import { blockerOfVerdict, type NextAction } from '../src/panels.ts'
import { SituationBanner } from '../src/client/workbench/SituationBanner.tsx'
import { ResearchWorkbench } from '../src/client/workbench/ResearchWorkbench.tsx'
import type { RunSummaryInput, StepView } from '../src/summary.ts'

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

/** The refusal `D3-writing` was blocked by, as the run recorded it. */
const EMPTY_REFERENCES_EVIDENCE =
  "team:judgeRound → core adjudicate('A') outcome=blocked; rule-based offline review of the draft"
  + ' manuscript by 4 declared checklists (red-method=refute, red-stat=support, red-citation=support,'
  + ' red-claim=support); one deterministic implementation, NO model called, so these votes are not'
  + ' independent review opinions and a pass here is not three reviewers agreeing; required-check'
  + ' aggregate: block — check(s) failed: red-method (refute: is every section the outline declares'
  + ' actually written? -> sections with an empty body: references)'

/** One step of a run. */
function step(overrides: Partial<StepView> = {}): StepView {
  return {
    stepId: 'D3-writing', index: 13, phase: 'D', name: '写作', status: 'blocked',
    attempt: 1, humanGate: false, gateOutcomes: [], ...overrides,
  }
}

/** The refused run, as `selectNextAction` would answer for it. */
function refused(): NextAction {
  return {
    kind: 'blocked',
    pendingCount: 0,
    step: step(),
    blocker: blockerOfVerdict({
      stepId: 'D3-writing', component: 'A', outcome: 'blocked', passed: false,
      evidence: EMPTY_REFERENCES_EVIDENCE, rationale: '', timestamp: 1_700_000_000_000,
    }),
  }
}

afterEach(cleanup)

describe('the block that answers "what do I do now"', () => {
  it('reports a refusal as a refusal, naming the step and the check that stopped it', () => {
    render(createElement(SituationBanner, { next: refused(), t }))

    const line = screen.getByText((_, node) =>
      node?.getAttribute('data-research-situation-line') !== null
      && node?.getAttribute('data-research-situation-line') !== undefined)
    expect(line.textContent).toContain(en['situation.blocked'].replace('{step}', '写作'))
    // The check is named by the question it asks, not by the engine's identifier: `red-method` is not
    // a word a researcher can act on, and the page has words for all four checks.
    expect(line.textContent).toContain(en['check.red-method'])
    // The section the check found empty is named by its Chinese heading, not as `references`.
    expect(line.textContent).toContain(en['paperSection.references'])
    expect(line.textContent).not.toContain('references')
  })

  it('keeps the verdict one click away, so any restatement can be checked', () => {
    render(createElement(SituationBanner, { next: refused(), t }))

    const record = screen.getByText(en['situation.record'])
    expect(record).toBeTruthy()
    // THE RECORD ITSELF, verbatim: a restatement of somebody else's judgement is worth what the
    // reader can verify, and the engine's own sentence is the thing being restated.
    expect(screen.getByText(EMPTY_REFERENCES_EVIDENCE)).toBeTruthy()
  })

  it('tells a run that cannot go on apart from a run waiting on a person', () => {
    const { container: stuck } = render(createElement(SituationBanner, { next: refused(), t }))
    const stuckMark = stuck.querySelector('[data-research-situation]')
      ?.className

    cleanup()

    const waiting: NextAction = { kind: 'awaiting-human', pendingCount: 1 }
    const { container: pending } = render(createElement(SituationBanner, { next: waiting, t }))
    const pendingMark = pending.querySelector('[data-research-situation]')?.className

    // The two are different KINDS, and the difference reaches the interface: same block, different
    // state and a different remedy. Collapsing them is how somebody ends up approving a run that
    // cannot proceed.
    expect(pending.querySelector('[data-research-situation]')?.getAttribute('data-research-situation'))
      .toBe('awaiting-human')
    expect(stuckMark).not.toBe(pendingMark)
    expect(screen.getByText(en['situation.remedy.awaitingHuman'])).toBeTruthy()
    expect(screen.queryByText(en['situation.remedy.blocked'])).toBeNull()
  })

  it('says which step is running rather than only that something is', () => {
    const running: NextAction = {
      kind: 'running', pendingCount: 0,
      step: step({ status: 'in_progress', name: '写作', index: 13 }),
    }
    render(createElement(SituationBanner, { next: running, t }))

    expect(screen.getByText(en['situation.running'].replace('{index}', '13').replace('{step}', '写作')))
      .toBeTruthy()
  })

  it('renders nothing for a session that has run nothing', () => {
    // No run means the orientation block above already says what to press, and a second "what to do
    // now" would be the same sentence twice.
    const { container } = render(createElement(SituationBanner, {
      next: { kind: 'not-started', pendingCount: 0 }, t,
    }))

    expect(container.querySelector('[data-research-situation]')).toBeNull()
  })
})

describe('the block on the page', () => {
  it('is the first thing a reader of a stopped run sees', () => {
    const input: RunSummaryInput = {
      runId: 'run_situation_spec', source: 'live', status: 'running',
      steps: [step(), step({ stepId: 'E1-format', index: 15, name: '排版', status: 'pending' })],
      artifacts: [],
      gates: [{
        stepId: 'D3-writing', component: 'A', outcome: 'blocked', passed: false,
        evidence: EMPTY_REFERENCES_EVIDENCE, rationale: '', timestamp: 1_700_000_000_000,
      }],
      abstentions: [], degradations: [], deliverables: [],
    }
    const { container } = render(createElement(ResearchWorkbench, {
      t, summary: buildSummary(input),
    } as never))

    const marks = container.querySelectorAll('[data-research-situation]')
    expect(marks).toHaveLength(1)
    expect(marks[0]?.getAttribute('data-research-situation')).toBe('blocked')
    // FIRST in the panel: the question "what do I do" outranks the run's badges, the stage strip and the
    // detail tabs, and it is the first thing the column shows.
    expect(container.querySelector('[data-research-situation]')?.previousElementSibling).toBeNull()
    // And the run is not reported as still working anywhere on the page.
    expect(screen.queryByText(en['next.running'])).toBeNull()
  })
})

/** Kept so `toRunSummary` stays imported for the summary-shaped cases above. */
void toRunSummary
