// @deepseek-ai/dsh-research-team — the run's measured result, as one versioned artifact.
//
// THE DEFECT. The study's numbers were recomputed wherever they were needed: the C gate measured
// the study, `C1` measured it, `C2` compared the platoons, `D1` built the figure from another
// comparison, `D3` wrote the prose from a third, `D4` revised against a fourth, and `E1` formatted
// a fifth. Nothing compared them. They agreed because the simulation is deterministic over the same
// study — which is precisely why the arrangement survived review: the numbers matched, so no one
// looked at whether they came from the same computation. A change to the study would have had to
// move all six in step, and the first to drift would have been the one nobody re-read.
//
// WHAT THIS IS. One immutable record of what the run measured, written by the step that MEASURED
// it and read by everything that reports a number. The recomputation cannot be removed from a pure
// function, but it can be made detectable: a value carries which of the two it came from, and a
// test can assert that the pipeline reports a `result-version` rather than a fresh measurement.
//
// WHAT IT IS NOT. A validation. It records the numbers the run produced; whether they support the
// claim is the C gate's question, and whether they are correct is nobody's yet.

import { createHash } from 'node:crypto'
import { EXPERIMENT_RULE_VERSION, MEASURED_METRIC } from './platoon-sim.ts'
import type { PlatoonComparison } from './platoon-sim.ts'

/**
 * What one run measured, as the metric it measured and the two arms' values.
 *
 * THE RECORD NAMES ITS METRIC. It used to be six fixed fields — `baselineMinTtcSeconds`,
 * `stringStabilityIndex` — which made every consumer of a result depend on THIS study's quantity: a
 * study of queueing latency has no time-to-collision and could not report one. The metric identity
 * travels with the numbers now (`metricKey`, `unit`, `direction`), the two arms' values are
 * `baseline`/`variant`, and whatever else the implementation measured is in `values` under the names
 * the implementation gave it.
 *
 * A SECOND STUDY IS THEREFORE A SECOND IMPLEMENTATION, not a rewrite of every reader.
 */
export interface MeasuredOutcome {
  /** The quantity, as the deployment's registry declares it. */
  readonly metricKey: string
  readonly unit: string
  readonly direction: 'higher-is-better' | 'lower-is-better'
  /** The metric's value in each arm, in the metric's own unit. */
  readonly baseline: number
  readonly variant: number
  /** Change in the variant relative to the baseline, %, signed in the metric's units. */
  readonly improvementPct: number
  /** Every other quantity the implementation reported, under its own name. */
  readonly values: Readonly<Record<string, number>>
}

/**
 * The observations behind a record, when the study's measurement is a sequence.
 *
 * A CATEGORY COMPARISON NEEDS ONLY THE TWO ARMS. A study whose quantity is measured across an ordered
 * sequence — a latency profile over an arrival trace, a growth curve across a boundary — has a figure
 * whose x axis is that order, and a figure may only plot what the run recorded. So the sequence
 * travels WITH the record rather than being recomputed by whoever draws the chart: the plot and the
 * number the claim is graded on are then one measurement, which is the whole reason this record exists.
 */
export interface StudySeries {
  /** What one position on the sequence axis is, e.g. `request index`. */
  readonly axisLabel: string
  readonly unit: string
  /** Where each observation sits on the axis, in the study's own units. */
  readonly bucket: ReadonlyArray<number>
  /** One array per arm, each as long as `bucket`, keyed the way the record keys its arms. */
  readonly arms: Readonly<Record<string, ReadonlyArray<number>>>
}

/** Where a number came from. `result-version` is the run's record; `recomputed` is a fresh run. */
export type ResultSource = 'result-version' | 'recomputed'

/** One immutable record of what a run measured. */
export interface ResultVersion {
  readonly resultId: string
  readonly version: number
  /** SHA-256 over the measured values and the rule version, so two records are comparable. */
  readonly contentHash: string
  readonly ruleVersion: string
  readonly metricKey: string
  readonly source: 'simulation'
  readonly measured: MeasuredOutcome
  /** The sequence the measurement ran over, when it ran over one. Absent for a two-arm comparison. */
  readonly series?: StudySeries
}

/** The artifact slug the record lives under. */
export const RESULT_VERSION_SLUG = 'result-version'

/** Two decimals, the precision the pipeline reports at. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * The measured outcome of one platoon comparison, rounded the way the pipeline reports it.
 *
 * @param comparison - the comparison the simulation produced.
 * @returns the six numbers every consumer reports.
 */
export function measuredFromComparison(comparison: PlatoonComparison): MeasuredOutcome {
  return {
    metricKey: MEASURED_METRIC.key,
    unit: MEASURED_METRIC.unit,
    direction: MEASURED_METRIC.direction,
    // THE METRIC IS THE MINIMUM TIME-TO-COLLISION, so the two arms' values ARE those numbers; the
    // band rate and the stability index are what else this implementation reported.
    baseline: round2(comparison.baseline.minTtcSeconds),
    variant: round2(comparison.variant.minTtcSeconds),
    improvementPct: round2(comparison.relativeImprovementPct),
    values: {
      baselineTtcRatePct: round2(comparison.baseline.ttcLt1_5RatePct),
      variantTtcRatePct: round2(comparison.variant.ttcLt1_5RatePct),
      stringStabilityIndex: round2(comparison.variant.stringStabilityIndex),
    },
  }
}

/** SHA-256 over a measured outcome, the sequence behind it, and the rule version that produced it. */
function hashOf(measured: MeasuredOutcome, ruleVersion: string, series?: StudySeries): string {
  // SORTED, so the hash depends on the values rather than on the order an implementation happened to
  // write them — two records of the same measurement must hash the same however they were built.
  const text = [
    ruleVersion,
    measured.metricKey,
    measured.unit,
    measured.direction,
    measured.baseline,
    measured.variant,
    measured.improvementPct,
    ...Object.keys(measured.values).sort().map(key => `${key}=${String(measured.values[key])}`),
    // THE SEQUENCE IS PART OF WHAT WAS MEASURED, so it is part of what the record identifies. Two
    // records whose arms agree and whose observations differ are two different measurements, and a
    // hash that ignored the second would call them the same one.
    ...(series === undefined
      ? []
      : [
        series.axisLabel,
        series.unit,
        series.bucket.join(','),
        ...Object.keys(series.arms).sort().map(arm => `${arm}=${(series.arms[arm] ?? []).join(',')}`),
      ]),
  ].join('|')
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Build the record of one measurement.
 *
 * @param comparison - the comparison the simulation produced.
 * @param metricKey - the quantity the study measures, which the claim binds to.
 * @param version - this record's version, one past whatever the run already holds.
 * @param ruleVersion - the implementation version that produced the numbers.
 * @param series - the sequence the measurement ran over, when it ran over one.
 * @returns the record.
 */
export function resultVersionOf(
  comparison: PlatoonComparison,
  metricKey: string,
  version = 1,
  ruleVersion = EXPERIMENT_RULE_VERSION,
  series?: StudySeries,
): ResultVersion {
  return resultVersionFrom(measuredFromComparison(comparison), metricKey, ruleVersion, version, series)
}

/**
 * Build the record of one measurement, from the measurement rather than from a particular study.
 *
 * THE ENTRY EVERY STUDY USES. `resultVersionOf` reads a platoon comparison because that is the study
 * this module was written for; a second study has no platoon comparison to hand it, and a record
 * built by a second code path would be a second definition of what a result record IS. Both go
 * through here, so the hash, the id and the required fields cannot differ between studies.
 *
 * @param measured - what the study measured, in the metric's own terms.
 * @param metricKey - the quantity the claim binds to.
 * @param ruleVersion - the implementation version that produced the numbers.
 * @param version - this record's version, one past whatever the run already holds.
 * @param series - the sequence the measurement ran over, when it ran over one.
 * @returns the record.
 */
export function resultVersionFrom(
  measured: MeasuredOutcome,
  metricKey: string,
  ruleVersion: string,
  version = 1,
  series?: StudySeries,
): ResultVersion {
  return {
    resultId: `result:${metricKey}`,
    version,
    contentHash: hashOf(measured, ruleVersion, series),
    ruleVersion,
    metricKey,
    source: 'simulation',
    measured,
    ...(series === undefined ? {} : { series }),
  }
}

/**
 * Read a result record off an artifact value, or undefined when the value is not one.
 *
 * @param value - the artifact value read from the run.
 * @returns the record, or undefined.
 */
export function readResultVersion(value: unknown): ResultVersion | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const measured = record['measured']
  if (measured === null || typeof measured !== 'object' || Array.isArray(measured)) return undefined
  const numbers = measured as Record<string, unknown>
  // THE METRIC IDENTITY AND THE TWO ARMS ARE REQUIRED; the rest of the measurements are whatever the
  // implementation reported, and a record whose `values` is not a record of finite numbers is not one
  // this reader can hand to a consumer that adds them up.
  const required = ['baseline', 'variant', 'improvementPct'] as const
  for (const key of required) {
    if (typeof numbers[key] !== 'number' || !Number.isFinite(numbers[key])) return undefined
  }
  const extra = numbers['values']
  if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) return undefined
  const values: Record<string, number> = {}
  for (const [key, value] of Object.entries(extra as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
    values[key] = value
  }
  const unit = numbers['unit']
  const direction = numbers['direction']
  if (typeof unit !== 'string' || (direction !== 'higher-is-better' && direction !== 'lower-is-better')) {
    return undefined
  }
  if (typeof record['contentHash'] !== 'string' || typeof record['ruleVersion'] !== 'string') return undefined
  // A SEQUENCE THE READER CANNOT ADD UP IS NOT THIS RECORD'S. A record carrying a malformed series is
  // refused rather than read with the series dropped: the figure that plots it would then draw from
  // keys this reader silently discarded, and a chart of a sequence nobody can reconstruct is worse
  // than no chart.
  const series = readSeries(record['series'])
  if (record['series'] !== undefined && series === undefined) return undefined
  return {
    resultId: typeof record['resultId'] === 'string' ? record['resultId'] : 'result:unknown',
    version: typeof record['version'] === 'number' ? record['version'] : 1,
    contentHash: record['contentHash'],
    ruleVersion: record['ruleVersion'],
    metricKey: typeof record['metricKey'] === 'string' ? record['metricKey'] : '',
    source: 'simulation',
    measured: {
      metricKey: typeof record['metricKey'] === 'string' ? record['metricKey'] : '',
      unit,
      direction,
      baseline: numbers['baseline'] as number,
      variant: numbers['variant'] as number,
      improvementPct: numbers['improvementPct'] as number,
      values,
    },
    ...(series === undefined ? {} : { series }),
  }
}

/** One record's `series` field, or undefined when the value is absent or not a sequence. */
function readSeries(value: unknown): StudySeries | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const series = value as Record<string, unknown>
  const axisLabel = series['axisLabel']
  const unit = series['unit']
  const bucket = numberArray(series['bucket'])
  if (typeof axisLabel !== 'string' || typeof unit !== 'string' || bucket === undefined) return undefined
  const rawArms = series['arms']
  if (rawArms === null || typeof rawArms !== 'object' || Array.isArray(rawArms)) return undefined
  const arms: Record<string, ReadonlyArray<number>> = {}
  for (const [arm, values] of Object.entries(rawArms as Record<string, unknown>)) {
    const parsed = numberArray(values)
    // EVERY ARM IS AS LONG AS THE AXIS. A series whose arms disagree with its own axis plots positions
    // that have no observation, which is the shape a mis-sliced sequence takes.
    if (parsed === undefined || parsed.length !== bucket.length) return undefined
    arms[arm] = parsed
  }
  return Object.keys(arms).length === 0 ? undefined : { axisLabel, unit, bucket, arms }
}

/** An array of finite numbers, or undefined when the value is not one. */
function numberArray(value: unknown): ReadonlyArray<number> | undefined {
  if (!Array.isArray(value)) return undefined
  const out: number[] = []
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return undefined
    out.push(entry)
  }
  return out
}

/** The metric key the run's record carries, or undefined when there is no record. */
export function recordedMetricKey(value: unknown): string | undefined {
  const record = readResultVersion(value)
  return record === undefined ? undefined : record.metricKey
}
