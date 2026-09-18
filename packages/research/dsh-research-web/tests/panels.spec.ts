/**
 * What the page tells a reader to do next, and why a step was refused.
 *
 * THE CASE THAT PRODUCED THIS. A real run stopped at `D3-writing`: the drafting step left the
 * `references` section empty, the run's own offline review refused the manuscript for it, and the
 * step was recorded `blocked`. The page then told the researcher the run was still working — the
 * `blocked` kind did not exist in the selector, so the run fell through to `running` — and the person
 * who had been staring at 「受阻」 had no way to learn which question had been asked or what the
 * answer was. The refusal sentences below are that run's own gate verdicts, character for character.
 */
import { describe, expect, it } from 'vitest'
import { buildSummary } from '../src/loader.ts'
import { blockerOfVerdict, selectNextAction, type StepBlocker } from '../src/panels.ts'
import type { GateHistoryEntry, RunSummaryInput, StepStatus, StepView } from '../src/summary.ts'

/** One step of a run, in the shape the projection carries. */
function step(
  stepId: string,
  status: StepStatus,
  index: number,
  overrides: Partial<StepView> = {},
): StepView {
  return {
    stepId, index, phase: stepId.slice(0, 1) as StepView['phase'], name: stepId,
    status, attempt: status === 'pending' ? 0 : 1, humanGate: false, gateOutcomes: [],
    ...overrides,
  }
}

/** One recorded gate verdict. */
function gate(overrides: Partial<GateHistoryEntry> = {}): GateHistoryEntry {
  return {
    stepId: 'D3-writing', component: 'A', outcome: 'blocked', passed: false,
    evidence: '', rationale: '', timestamp: 1_700_000_000_000,
    ...overrides,
  }
}

/** A run summary carrying exactly the given steps and gates. */
function runOf(steps: ReadonlyArray<StepView>, gates: ReadonlyArray<GateHistoryEntry> = []) {
  const input: RunSummaryInput = {
    runId: 'run_panels_spec',
    source: 'live',
    status: 'running',
    steps,
    artifacts: [],
    gates,
    abstentions: [],
    degradations: [],
    deliverables: [],
  }
  return buildSummary(input)
}

/**
 * The refusal the selector reports, asserting that it reports one.
 *
 * NARROWED RATHER THAN READ WITH `?.` at each assertion: a test that says "the check is red-method" and
 * passes because no blocker was reported at all is a test that cannot fail for the reason it names.
 * @param summary - the run to read.
 * @returns the blocker the refusal names.
 */
function refusalOf(summary: ReturnType<typeof runOf>): StepBlocker {
  const next = selectNextAction(summary)
  if (next.kind !== 'blocked') throw new Error(`expected a refusal, got ${next.kind}`)
  if (next.blocker === undefined) throw new Error('expected the refusal to name the check that made it')
  return next.blocker
}

/** The refusal `D3-writing` was blocked by, as the run recorded it. */
const EMPTY_REFERENCES_EVIDENCE =
  'team:judgeRound → core adjudicate(\'A\') outcome=blocked; rule-based offline review of the draft'
  + ' manuscript by 4 declared checklists (red-method=refute, red-stat=support, red-citation=support,'
  + ' red-claim=support); one deterministic implementation, NO model called, so these votes are not'
  + ' independent review opinions and a pass here is not three reviewers agreeing; required-check'
  + ' aggregate: block — check(s) failed: red-method (refute: is every section the outline declares'
  + ' actually written? -> sections with an empty body: references)'

/** A refusal whose finding carries brackets of its own, which the reader must not be cut short by. */
const UNTRACEABLE_NUMBER_EVIDENCE =
  'team:judgeRound → core adjudicate(\'A\') outcome=blocked; required-check aggregate: block —'
  + ' check(s) failed: red-stat (refute: is every number in the manuscript one the run measured? ->'
  + ' numbers the run\'s record does not account for: experiments#28=20260909 — the record holds 19.58,'
  + ' 12.1 (s), -38.2 (%) and 0.88)'

describe('a run whose step was refused', () => {
  it('reports the refusal instead of reporting the run as still working', () => {
    // THE REGRESSION. Steps after the refused one never ran, so the pending count was non-zero and
    // the page said the run was in flight — to a person watching a run that had already stopped.
    const summary = runOf(
      [
        step('A1-landscape', 'passed', 1),
        step('D3-writing', 'blocked', 13),
        step('E1-format', 'pending', 15),
        step('E2-submit', 'pending', 16, { humanGate: true }),
      ],
      [gate({ evidence: EMPTY_REFERENCES_EVIDENCE })],
    )

    const next = selectNextAction(summary)

    expect(next.kind).toBe('blocked')
    expect(next.step?.stepId).toBe('D3-writing')
    expect(next.pendingCount).toBe(0)
  })

  it('names the check that refused and the section that was empty', () => {
    const summary = runOf(
      [step('D3-writing', 'blocked', 13)],
      [gate({ evidence: EMPTY_REFERENCES_EVIDENCE })],
    )

    const blocker = refusalOf(summary)

    expect(blocker.component).toBe('A')
    expect(blocker.check).toBe('red-method')
    expect(blocker.finding).toEqual({ kind: 'empty-sections', sections: ['references'] })
  })

  it('names no check it has no words for', () => {
    // A CLOSED UNION, so the page cannot render a check name it cannot translate. The identifier is
    // not lost — it is inside the evidence, which the reader can open — and `unknown` is a stated
    // answer rather than an identifier leaking into the interface.
    const summary = runOf(
      [step('D3-writing', 'blocked', 13)],
      [gate({ evidence: 'required-check aggregate: block — check(s) failed: red-novelty (refute: is it new?)' })],
    )

    expect(refusalOf(summary).check).toBe('unknown')
  })

  it('keeps the record verbatim when the finding is one this build cannot restate', () => {
    // RESTATING A FINDING IS A CLAIM ABOUT WHAT THE ENGINE SAID. A shape this build does not know is
    // shown as the record wrote it rather than translated into something it might not mean.
    const summary = runOf(
      [step('D3-writing', 'blocked', 13)],
      [gate({ evidence: UNTRACEABLE_NUMBER_EVIDENCE })],
    )

    const blocker = refusalOf(summary)

    expect(blocker.check).toBe('red-stat')
    expect(blocker.finding).toEqual({ kind: 'other' })
    // The brackets inside the finding are why the evidence is carried whole rather than trimmed to
    // the first `)`: `12.1 (s)` is part of what the check said.
    expect(blocker.evidence).toBe(UNTRACEABLE_NUMBER_EVIDENCE)
  })

  it('reads the verdict that LEFT the step blocked, not the first one ever recorded', () => {
    // A step driven twice has a verdict per attempt. Naming an earlier, passing attempt would send
    // the reader to a question nobody asked.
    const first = gate({ outcome: 'passed', passed: true, evidence: 'red-method=support' })
    const later = gate({ evidence: EMPTY_REFERENCES_EVIDENCE })

    expect(blockerOfVerdict(later).check).toBe('red-method')
    expect(refusalOf(runOf([step('D3-writing', 'blocked', 13)], [first, later])).check).toBe('red-method')
  })

  it('says nothing about a check when the run recorded no refusing verdict', () => {
    // Absent stays absent. A step the run marked blocked with no verdict behind it is reported as
    // blocked, and the page then shows no reason rather than a composed one.
    const next = selectNextAction(runOf([step('D3-writing', 'blocked', 13)]))

    expect(next.kind).toBe('blocked')
    expect(Object.hasOwn(next, 'blocker')).toBe(false)
  })
})

describe('what to do next', () => {
  it('puts a failure first, then a refusal, then a human wait, then work in flight', () => {
    const pending = [step('E1-format', 'pending', 15)]
    const humanWait = [step('E2-submit', 'gated', 16, { humanGate: true, holdReason: 'human_gate' })]

    expect(selectNextAction(runOf([...pending, step('B1-method', 'failed', 5)])).kind).toBe('failed')
    expect(selectNextAction(runOf(pending)).kind).toBe('running')
    expect(selectNextAction(runOf([...pending, step('D3-writing', 'blocked', 13)])).kind).toBe('blocked')
    // A step that errored mid-execution stays `in_progress` in the state machine while its outcome
    // records the error, so the cause travels on the outcome and not on the status.
    expect(selectNextAction(runOf([step('B1-method', 'in_progress', 5, { executeError: 'timeout' })]))
      .kind).toBe('failed')
    expect(selectNextAction(runOf(humanWait)).kind).toBe('awaiting-human')
    expect(selectNextAction(runOf(humanWait)).pendingCount).toBe(1)
  })

  it('reports a run that finished with nothing waiting as complete', () => {
    expect(selectNextAction(runOf([step('A1-landscape', 'passed', 1)])).kind).toBe('complete')
  })

  it('reports demo data as nothing to act on, whatever states it happens to carry', () => {
    const input: RunSummaryInput = {
      runId: 'run_demo', source: 'fixture', status: 'degraded',
      steps: [step('D3-writing', 'blocked', 13)],
      artifacts: [], gates: [gate({ evidence: EMPTY_REFERENCES_EVIDENCE })],
      abstentions: [], degradations: [], deliverables: [],
    }

    expect(selectNextAction(buildSummary(input)).kind).toBe('not-started')
  })
})
