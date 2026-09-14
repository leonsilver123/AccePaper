/**
 * The run-snapshot mapper.
 *
 * These tests pin the mapping from the Host's wire payload to the view model. The
 * payload shape is a structural twin of the Host's projection, so the assertions here
 * are what keeps the two sides agreed: a field renamed on the Host side blanks the view
 * silently, which is the failure this mapper exists to make impossible to miss.
 */

import { describe, expect, it } from 'vitest'

import { buildSummary } from '../src/loader.ts'
import { resolveStepStatus, runStatusOf, summaryInputFrom, type WireRunSnapshot, type WireStepOutcome, type WireStepState } from '../src/run-source.ts'

/** A two-step payload: one passed with gates, one waiting at the human gate. */
function snapshot(): WireRunSnapshot {
  return {
    run: {
      runId: 'run-live-1',
      steps: [
        {
          stepId: 'A1-landscape',
          status: 'passed',
          attemptId: 1,
          kind: 'real_tool_fixture_input',
          producer: 'literature-search@1',
          outputSlugs: ['landscape-map'],
          artifacts: [{ slug: 'landscape-map', producedBy: 'literature-search@1' }],
          verdicts: { B: 'passed' },
          usedRealTool: true,
        },
        {
          stepId: 'E2-submit',
          status: 'gated',
          attemptId: 1,
          kind: 'humanGate',
          producer: 'human-gate:E2-submit',
          outputSlugs: [],
          artifacts: [],
          verdicts: {},
          usedRealTool: false,
        },
      ],
    },
    catalog: [
      {
        id: 'A1-landscape',
        index: 1,
        phase: 'A',
        name: 'Landscape',
        humanGate: false,
        gate: ['B'],
      },
      {
        id: 'E2-submit',
        index: 16,
        phase: 'E',
        name: 'Submit',
        humanGate: true,
        gate: [],
      },
    ],
    gates: [
      {
        stepId: 'A1-landscape',
        component: 'B',
        outcome: 'passed',
        passed: true,
        evidence: "core:adjudicate('B') outcome=passed",
        rationale: 'ANCHOR_OK',
        timestamp: 1_700_000_000_000,
      },
    ],
    artifacts: [
      {
        slug: 'landscape-map',
        producerStepId: 'A1-landscape',
        producerAttemptId: 1,
        producedAt: 1_700_000_000_000,
        invalidated: false,
      },
    ],
    steps: [
      { stepId: 'A1-landscape', status: 'passed', attempt: 1, holdReason: null },
      { stepId: 'E2-submit', status: 'gated', attempt: 1, holdReason: null },
    ],
  }
}

describe('the two facts called `status`', () => {
  const outcome = (status: string): WireStepOutcome => ({
    stepId: 'A1-landscape', status, attemptId: 1, kind: 'fixture_executor', producer: 'p',
    outputSlugs: [], artifacts: [], verdicts: {}, usedRealTool: false,
  })
  const state = (status: string): WireStepState => ({ stepId: 'A1-landscape', status, attempt: 1, holdReason: null })

  it('takes the OUTCOME the driver recorded, and says that is where it came from', () => {
    const resolved = resolveStepStatus(outcome('passed'), state('passed'))
    expect(resolved).toEqual({ status: 'passed', source: 'outcome', diverged: false })
  })

  it('falls back to the state the store holds only for a step the driver never reached', () => {
    expect(resolveStepStatus(undefined, state('gated')))
      .toEqual({ status: 'gated', source: 'state', diverged: false })
  })

  it('reports a step with neither record as never reached, not as pending work', () => {
    // The distinction the view could not make: `pending` from `?? 'pending'` covered both "the
    // run will get to this" and "the run stopped before this", and they are different answers.
    expect(resolveStepStatus(undefined, undefined))
      .toEqual({ status: 'pending', source: 'unreached', diverged: false })
  })

  it('SURFACES a disagreement between the two instead of resolving it silently', () => {
    // A rolled-back step, or a resume that re-attempted: the driver recorded how its attempt
    // ended while the store has moved on. Preferring one without saying so is how a run that
    // had stopped appeared to still be working.
    expect(resolveStepStatus(outcome('passed'), state('in_progress')))
      .toEqual({ status: 'passed', source: 'outcome', diverged: true })
    expect(resolveStepStatus(outcome('in_progress'), state('passed')))
      .toEqual({ status: 'in_progress', source: 'outcome', diverged: true })
  })

  it('does not invent a divergence when the store holds no state for the step', () => {
    // `diverged` must mean "these two disagreed", not "one of them was missing".
    expect(resolveStepStatus(outcome('passed'), undefined).diverged).toBe(false)
  })
})

describe('runStatusOf', () => {
  it('marks a live run as live, so the badge stops saying MOCK', () => {
    const input = summaryInputFrom(snapshot())

    expect(input.source).toBe('live')
    expect(buildSummary(input).isMock).toBe(false)
  })

  it('carries the recorded gate evidence, not a restatement of the outcome', () => {
    const summary = buildSummary(summaryInputFrom(snapshot()))

    expect(summary.gates).toHaveLength(1)
    expect(summary.gates[0]?.evidence).toBe("core:adjudicate('B') outcome=passed")
    expect(summary.gates[0]?.rationale).toBe('ANCHOR_OK')
  })

  it('labels every step from the catalogue and leaves an unreached step pending', () => {
    const payload = snapshot()
    // A run that stopped after one step: BOTH the outcome list and the state list end
    // there, which is what "the run never reached E2" looks like on the wire.
    const partial: WireRunSnapshot = {
      ...payload,
      run: { ...payload.run, steps: [payload.run.steps[0] as (typeof payload.run.steps)[number]] },
      steps: [payload.steps[0] as (typeof payload.steps)[number]],
    }
    const summary = buildSummary(summaryInputFrom(partial))

    expect(summary.steps.map(step => step.stepId)).toEqual(['A1-landscape', 'E2-submit'])
    expect(summary.steps[0]?.name).toBe('Landscape')
    expect(summary.steps[0]?.phase).toBe('A')
    // E2 produced no outcome in this payload, so the run did not reach it.
    expect(summary.steps[1]?.status).toBe('pending')
    expect(summary.steps[1]?.humanGate).toBe(true)
  })

  it('reports a fixture step as a degradation rather than letting it pass unremarked', () => {
    const payload = snapshot()
    const withFixture: WireRunSnapshot = {
      ...payload,
      run: {
        ...payload.run,
        steps: [{ ...(payload.run.steps[0] as (typeof payload.run.steps)[number]), kind: 'fixture_executor' }],
      },
    }
    const summary = buildSummary(summaryInputFrom(withFixture))

    expect(summary.degradations).toHaveLength(1)
    expect(summary.degradations[0]?.stepId).toBe('A1-landscape')
    expect(summary.degradations[0]?.kind).toBe('fallback')
  })

  it('records an abstention from the verdict that recorded it', () => {
    const payload = snapshot()
    const abstained: WireRunSnapshot = {
      ...payload,
      gates: [
        {
          stepId: 'A1-landscape',
          component: 'C',
          outcome: 'abstained',
          passed: false,
          evidence: 'no experiment report → hold',
          rationale: 'NO_EXPERIMENT_REPORT',
          timestamp: 1_700_000_000_000,
        },
      ],
    }
    const summary = buildSummary(summaryInputFrom(abstained))

    expect(summary.hasAbstention).toBe(true)
    expect(summary.abstentions[0]?.component).toBe('C')
    expect(summary.abstentions[0]?.reasonCode).toBe('NO_EXPERIMENT_REPORT')
    expect(summary.status).toBe('abstained')
  })

  it('ranks a failure above an abstention and an abstention above an unfinished step', () => {
    const gate = {
      stepId: 'A1-landscape',
      component: 'B',
      outcome: 'abstained',
      passed: false,
      evidence: 'e',
      rationale: 'r',
      timestamp: 0,
    }
    const step = (status: string): WireRunSnapshot['run']['steps'][number] => ({
      stepId: 'A1-landscape',
      status,
      attemptId: 1,
      kind: 'fixture_executor',
      producer: 'p',
      outputSlugs: [],
      artifacts: [],
      verdicts: {},
      usedRealTool: false,
    })

    expect(runStatusOf([step('failed')], [gate])).toBe('failed')
    expect(runStatusOf([step('passed')], [gate])).toBe('abstained')
    expect(runStatusOf([step('in_progress')], [])).toBe('running')
    expect(runStatusOf([step('passed'), step('gated')], [])).toBe('completed')
  })
})
