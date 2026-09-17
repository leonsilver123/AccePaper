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

/** SHA-256 over a measured outcome and the rule version that produced it. */
function hashOf(measured: MeasuredOutcome, ruleVersion: string): string {
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
 * @returns the record.
 */
export function resultVersionOf(
  comparison: PlatoonComparison,
  metricKey: string,
  version = 1,
  ruleVersion = EXPERIMENT_RULE_VERSION,
): ResultVersion {
  const measured = measuredFromComparison(comparison)
  return {
    resultId: `result:${metricKey}`,
    version,
    contentHash: hashOf(measured, ruleVersion),
    ruleVersion,
    metricKey,
    source: 'simulation',
    measured,
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
  }
}

/** The metric key the run's record carries, or undefined when there is no record. */
export function recordedMetricKey(value: unknown): string | undefined {
  const record = readResultVersion(value)
  return record === undefined ? undefined : record.metricKey
}
