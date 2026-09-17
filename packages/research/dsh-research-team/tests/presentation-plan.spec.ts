/**
 * The presentation plan — what each figure answers, and whether the run can answer it.
 *
 * THE DEFECT THESE RULES COME FROM is on the delivered paper: six floats that no sentence refers to.
 * A figure nobody refers to is a figure nobody needed, and the pipeline had no way to tell, because
 * D1 drew a chart with a fixed size, a fixed title and one series and nothing anywhere said what it
 * was FOR. Every rule below turns one of those absences into a refusal.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FIGURE_SIZE, PRESENTATION_PLAN_VERSION, checkPresentationPlan, shippedPresentationPlan,
} from '../src/runner/presentation-plan.ts'
import type { PlannedFigure, PresentationPlan } from '../src/runner/presentation-plan.ts'

/** The run's records, as the values a figure may plot are matched against. */
const RECORDS = new Map<string, Record<string, unknown>>([
  ['result-version', {
    measured: { baselineMinTtcSeconds: 19.58, variantMinTtcSeconds: 12.1 },
    series: { t: { 0: 1, 1: 2, 2: 3 } },
  }],
])

/** A figure that answers a question from the run's own record. */
function figure(overrides: Partial<PlannedFigure> = {}): PlannedFigure {
  return {
    ...shippedPresentationPlan({
      sourceSlug: 'result-version',
      baselineKey: 'measured.baselineMinTtcSeconds',
      variantKey: 'measured.variantMinTtcSeconds',
      baselineSeconds: 19.58,
      variantSeconds: 12.1,
      metricUnit: 's',
      outcome: 'refuted',
    }).figures[0] as PlannedFigure,
    ...overrides,
  }
}

/** A plan carrying one figure. */
function planOf(...figures: ReadonlyArray<PlannedFigure>): PresentationPlan {
  return { version: PRESENTATION_PLAN_VERSION, figures }
}

describe('the shipped study’s figure', () => {
  it('states the question it answers and reads its values from the run', () => {
    const plan = planOf(figure())
    expect(checkPresentationPlan(plan, RECORDS)).toEqual([])
    const drawn = plan.figures[0]
    expect(drawn?.answers).toContain('minimum time-to-collision')
    expect(drawn?.series[0]?.points.map(point => point.value)).toEqual([12.1, 19.58])
    expect(drawn?.size).toEqual(DEFAULT_FIGURE_SIZE)
  })

  it('states that its uncertainty is not quantified, rather than drawing a band', () => {
    // A DETERMINISTIC SIMULATION HAS NO SAMPLING INTERVAL, and a chart that drew one would make an
    // uncertainty claim the study never made.
    expect(figure().uncertainty?.kind).toBe('not-quantified')
    expect(figure().uncertainty?.note).toContain('no sampling uncertainty')
  })
})

describe('a figure the run cannot stand behind', () => {
  it('is refused when it answers no question', () => {
    const refusals = checkPresentationPlan(planOf(figure({ answers: '   ' })), RECORDS)
    expect(refusals.map(refusal => refusal.code)).toEqual(['figure-no-question'])
    expect(refusals[0]?.detail).toContain('nothing in the text will refer to it')
  })

  it('is refused when it plots a value the run never recorded', () => {
    // SOURCE-DATA RECONCILIATION, which is the whole point of naming a key: a figure is a statement
    // about measurements, and a value nobody measured is not one.
    const refusals = checkPresentationPlan(planOf(figure({
      series: [{ name: 'minimum TTC (s)', unit: 's', points: [{ key: 'measured.inventedValue', value: 3 }] }],
    })), RECORDS)
    expect(refusals.map(refusal => refusal.code)).toEqual(['figure-values-unsourced'])
    expect(refusals[0]?.detail).toContain('the study did not measure')
  })

  it('is refused when it plots a different number than the run recorded under that key', () => {
    const refusals = checkPresentationPlan(planOf(figure({
      series: [{
        name: 'minimum TTC (s)',
        unit: 's',
        points: [{ key: 'measured.variantMinTtcSeconds', value: 12.5 }],
      }],
    })), RECORDS)
    expect(refusals[0]?.detail).toContain('the run recorded 12.1')
  })

  it('is refused when it is drawn over a sequence it does not carry', () => {
    // A TIME SERIES WITH NOTHING BEHIND ITS ORDER: the x axis says the points are positions in a
    // sequence and the points are named quantities, so the trend the chart draws is not a fact.
    const refusals = checkPresentationPlan(planOf(figure({
      x: { label: 'time', unit: 's', kind: 'sequence' },
    })), RECORDS)
    expect(refusals.map(refusal => refusal.code)).toEqual(['figure-sequence-missing'])
    expect(refusals[0]?.detail).toContain('not a fact about the run')
  })

  it('is refused when it declares an interval and carries no bounds', () => {
    // A CONFIDENCE BAND NOBODY COMPUTED is an uncertainty claim, and the run that draws it has no
    // interval to draw.
    const refusals = checkPresentationPlan(planOf(figure({
      uncertainty: { kind: 'interval', note: 'a 95% interval' },
    })), RECORDS)
    expect(refusals.map(refusal => refusal.code)).toEqual(['figure-interval-missing'])
  })

  it('accepts an interval that carries its bounds', () => {
    expect(checkPresentationPlan(planOf(figure({
      uncertainty: { kind: 'interval', lower: 11.2, upper: 13.4, note: 'a 95% interval' },
    })), RECORDS)).toEqual([])
  })

  it('is refused when two figures claim one id', () => {
    const refusals = checkPresentationPlan(planOf(figure(), figure()), RECORDS)
    expect(refusals.map(refusal => refusal.code)).toEqual(['figure-duplicate-id'])
  })

  it('reports every problem at once, so one pass fixes them', () => {
    const refusals = checkPresentationPlan(planOf(figure({
      answers: '',
      x: { label: 'time', kind: 'sequence' },
      uncertainty: { kind: 'interval', note: 'a band' },
    })), RECORDS)
    expect(refusals.map(refusal => refusal.code))
      .toEqual(['figure-no-question', 'figure-sequence-missing', 'figure-interval-missing'])
  })
})
