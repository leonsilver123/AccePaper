// @deepseek-ai/dsh-research-team — what each figure is FOR, before anything draws it.
//
// WHY THIS EXISTS. D1 rendered one bar chart: a fixed 320×240 canvas, one series, a fixed palette,
// a fixed title. Nothing said what the chart was FOR, so nothing could say whether it answered
// anything — and the quality baseline found the consequence on the delivered paper: six floats
// nothing in the text refers to. A figure exists to answer a question the paper asks; a figure that
// answers no question is decoration, and decoration nothing cites is what a reader skips.
//
// THE PLAN COMES FIRST. Each entry states the question the figure answers, the run record its values
// come from, the fields and units it plots, its axes, any uncertainty it carries, its size and
// format, and whether the paper NEEDS it. The renderer is handed that spec, so the chart a reader
// sees and the question somebody wrote down are the same object rather than two things that happen
// to agree.
//
// A CHART WHOSE DATA IS NOT IN THE RUN IS REFUSED. Source-data reconciliation is a check here, not a
// promise: every value a figure plots must be a value the run recorded, matched by the record's own
// key, so a figure cannot illustrate a number the study never measured.
//
// WHAT THIS IS NOT. It does not draw, and it does not judge whether a chart is the right chart: it
// states what was asked for and refuses a plan that cannot be answered from the run. Whether the
// figure is legible, well-scaled and well-argued is the visual review's work (M09).

/** What kind of quantity an axis carries, which decides what the figure needs to be meaningful. */
export type AxisKind =
  /** A measured quantity on a continuous scale. */
  | 'quantity'
  /** Time, or a position in a sequence of observations. A figure over this axis needs values in order. */
  | 'sequence'
  /** A named category, such as a composition or a condition. */
  | 'category'

/** How one axis is labelled and what it carries. */
export interface FigureAxis {
  /** What the axis states, e.g. `platoon composition`. */
  readonly label: string
  /** The unit, when the axis carries one. */
  readonly unit?: string
  readonly kind: AxisKind
}

/** One series in a figure: the values, and which record they were read from. */
export interface FigureSeries {
  /** The series' name as the legend shows it. */
  readonly name: string
  readonly unit: string
  /**
   * The values, in the order the category axis lists them.
   *
   * A value is a RECORD FIELD, not a literal: `key` names it the way the run's record does, and the
   * reconciliation check matches it against that record, so a figure cannot plot a number nobody
   * measured.
   */
  readonly points: ReadonlyArray<{ readonly key: string; readonly value: number }>
}

/** An uncertainty statement a figure carries, when it carries one. */
export interface FigureUncertainty {
  /** What kind of statement it is. `interval` requires bounds; the others require a note. */
  readonly kind: 'interval' | 'range' | 'not-quantified'
  /** The bounds, when the kind is `interval`. A figure that declares an interval must carry these. */
  readonly lower?: number
  readonly upper?: number
  /** What the bounds (or the absence of them) mean. */
  readonly note: string
}

/** One figure, as the paper's presentation plan asks for it. */
export interface PlannedFigure {
  /** Stable id, e.g. `figure-1`. */
  readonly id: string
  /** The question IN THE PAPER this figure answers, in one sentence. */
  readonly answers: string
  /** The slug of the run's record the values come from. */
  readonly sourceSlug: string
  readonly series: ReadonlyArray<FigureSeries>
  readonly x: FigureAxis
  readonly y: FigureAxis
  readonly uncertainty?: FigureUncertainty
  /** Canvas size in px. Stated per figure rather than fixed for every chart in the paper. */
  readonly size: { readonly width: number; readonly height: number }
  readonly format: 'svg' | 'png'
  /** The caption a reader sees, which states what the figure shows. */
  readonly caption: string
  /** Whether the paper needs this figure. A required figure that cannot be drawn stops the step. */
  readonly necessity: 'required' | 'optional'
  /** Why this figure and not a table, or why it is optional. */
  readonly justification: string
}

/** The figures a paper plans to carry, in the order the text refers to them. */
export interface PresentationPlan {
  /** Which revision of this plan a figure was drawn under, recorded so a package is reproducible. */
  readonly version: string
  readonly figures: ReadonlyArray<PlannedFigure>
}

/** Why a presentation plan was refused. */
export type PresentationRefusalCode =
  /** A figure that answers no stated question is decoration. */
  | 'figure-no-question'
  /** A figure whose values are not the run's records illustrates a measurement nobody made. */
  | 'figure-values-unsourced'
  /** A figure over a sequence carries no sequence, so the order it plots is not a fact. */
  | 'figure-sequence-missing'
  /** A figure declaring an interval carries no bounds. */
  | 'figure-interval-missing'
  /** Two figures claim one id. */
  | 'figure-duplicate-id'

/** One refusal, naming the figure. */
export interface PresentationRefusal {
  readonly code: PresentationRefusalCode
  readonly figureId: string
  readonly detail: string
}

/** The plan revision the shipped figures are written under. */
export const PRESENTATION_PLAN_VERSION = 'presentation-plan-v1'

/** The canvas a figure gets when its own entry does not state one. */
export const DEFAULT_FIGURE_SIZE = { width: 480, height: 360 } as const

/**
 * Judge a presentation plan against the run's records, before anything is drawn.
 *
 * @param plan - the figures the paper plans to carry.
 * @param records - the run's records, keyed by slug, as the values are matched against.
 * @returns one refusal per problem, or an empty list.
 */
export function checkPresentationPlan(
  plan: PresentationPlan,
  records: ReadonlyMap<string, Record<string, unknown>>,
): ReadonlyArray<PresentationRefusal> {
  const refusals: PresentationRefusal[] = []
  const seen = new Set<string>()
  for (const figure of plan.figures) {
    if (seen.has(figure.id)) {
      refusals.push({
        code: 'figure-duplicate-id',
        figureId: figure.id,
        detail: `'${figure.id}' is claimed by more than one figure, so the paper cannot name one of them`,
      })
    }
    seen.add(figure.id)
    if (figure.answers.trim() === '') {
      refusals.push({
        code: 'figure-no-question',
        figureId: figure.id,
        detail: `'${figure.id}' answers no stated question — a float that answers nothing is`
          + ' decoration, and nothing in the text will refer to it',
      })
    }
    // A FIGURE OVER A SEQUENCE MUST CARRY ONE. Plotting category values along an axis labelled as a
    // sequence draws a trend that no measurement established, which is the shape of a time series
    // chart with nothing behind its order.
    if (figure.x.kind === 'sequence') {
      const ordered = figure.series.every(series =>
        series.points.every(point => /^\d+$/u.test(point.key.split('.').at(-1) ?? '')))
      if (!ordered) {
        refusals.push({
          code: 'figure-sequence-missing',
          figureId: figure.id,
          detail: `'${figure.id}' is plotted over a sequence axis and its points are not positions in`
            + ' one, so the order they are drawn in is not a fact about the run',
        })
      }
    }
    if (figure.uncertainty?.kind === 'interval'
      && (figure.uncertainty.lower === undefined || figure.uncertainty.upper === undefined)) {
      refusals.push({
        code: 'figure-interval-missing',
        figureId: figure.id,
        detail: `'${figure.id}' declares an interval and carries no bounds — a chart drawing a band`
          + ' nobody computed is an uncertainty claim the run did not make',
      })
    }
    // SOURCE-DATA RECONCILIATION. Every point must be a value the run recorded under the key it
    // names, in the record the figure says it read: a figure that plots a literal is a figure about
    // a measurement nobody made.
    const record = records.get(figure.sourceSlug)
    for (const series of figure.series) {
      for (const point of series.points) {
        const recorded = readRecordValue(record, point.key)
        if (recorded === undefined) {
          refusals.push({
            code: 'figure-values-unsourced',
            figureId: figure.id,
            detail: `'${figure.id}' plots '${point.key}', which '${figure.sourceSlug}' does not`
              + ' record — a figure cannot illustrate a value the study did not measure',
          })
        } else if (Math.abs(recorded - point.value) > 1e-9) {
          refusals.push({
            code: 'figure-values-unsourced',
            figureId: figure.id,
            detail: `'${figure.id}' plots ${String(point.value)} for '${point.key}' and the run`
              + ` recorded ${String(recorded)}`,
          })
        }
      }
    }
  }
  return refusals
}

/** One dotted path's value in a record, or undefined when the record does not hold a number there. */
function readRecordValue(record: Record<string, unknown> | undefined, path: string): number | undefined {
  let cursor: unknown = record
  for (const step of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined
    cursor = (cursor as Record<string, unknown>)[step]
  }
  return typeof cursor === 'number' && Number.isFinite(cursor) ? cursor : undefined
}

/**
 * The figures the shipped study's paper carries, read from the run's own measurement.
 *
 * ONE FIGURE, AND THE QUESTION IT ANSWERS: whether the mixed platoon's minimum time-to-collision
 * differs from the homogeneous platoon's. Its values are the run's measured seconds, keyed the way
 * the result record keys them, its size is stated here rather than fixed for every chart, and its
 * caption says what it shows. The comparison is the figure's subject, so the baseline is drawn beside
 * the variant rather than only stated in prose.
 *
 * @param input - the measured values and the record slug they were read from.
 * @returns the plan, with its version.
 */
export function shippedPresentationPlan(input: {
  readonly sourceSlug: string
  readonly baselineKey: string
  readonly variantKey: string
  readonly baselineSeconds: number
  readonly variantSeconds: number
  readonly metricUnit: string
  readonly outcome: string
}): PresentationPlan {
  return {
    version: PRESENTATION_PLAN_VERSION,
    figures: [{
      id: 'figure-1',
      answers: 'does inserting one autonomous vehicle change the platoon minimum time-to-collision',
      sourceSlug: input.sourceSlug,
      series: [{
        name: `minimum time-to-collision (${input.metricUnit})`,
        unit: input.metricUnit,
        points: [
          { key: input.variantKey, value: input.variantSeconds },
          { key: input.baselineKey, value: input.baselineSeconds },
        ],
      }],
      x: { label: 'platoon composition', kind: 'category' },
      y: { label: 'minimum time-to-collision', unit: input.metricUnit, kind: 'quantity' },
      // THE UNCERTAINTY IS NOT QUANTIFIED AND SAYS SO. The study is a deterministic simulation, so
      // there is no sampling interval to draw; a band here would be an interval nobody computed.
      uncertainty: {
        kind: 'not-quantified',
        note: 'the study is a deterministic simulation over declared parameters, so the measurement'
          + ' carries no sampling uncertainty and no interval is drawn',
      },
      size: DEFAULT_FIGURE_SIZE,
      format: 'svg',
      caption: 'Minimum time-to-collision of the homogeneous platoon and of the platoon carrying one'
        + ` autonomous vehicle, measured in the study's own simulation (${input.outcome}).`,
      necessity: 'required',
      justification: 'the claim is a comparison between two compositions; a table states the two'
        + ' values and a figure shows the difference the claim is about',
    }],
  }
}
