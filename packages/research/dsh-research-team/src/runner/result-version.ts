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
import { EXPERIMENT_RULE_VERSION } from './platoon-sim.ts'
import type { PlatoonComparison } from './platoon-sim.ts'

/** The measured quantities one run reports, rounded as the pipeline reports them. */
export interface MeasuredOutcome {
  readonly baselineMinTtcSeconds: number
  readonly variantMinTtcSeconds: number
  /** Change in the variant relative to the baseline, %. Positive means the AV helped. */
  readonly improvementPct: number
  readonly baselineTtcRatePct: number
  readonly variantTtcRatePct: number
  readonly stringStabilityIndex: number
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
    baselineMinTtcSeconds: round2(comparison.baseline.minTtcSeconds),
    variantMinTtcSeconds: round2(comparison.variant.minTtcSeconds),
    improvementPct: round2(comparison.relativeImprovementPct),
    baselineTtcRatePct: round2(comparison.baseline.ttcLt1_5RatePct),
    variantTtcRatePct: round2(comparison.variant.ttcLt1_5RatePct),
    stringStabilityIndex: round2(comparison.variant.stringStabilityIndex),
  }
}

/** SHA-256 over a measured outcome and the rule version that produced it. */
function hashOf(measured: MeasuredOutcome, ruleVersion: string): string {
  const text = [
    ruleVersion,
    measured.baselineMinTtcSeconds,
    measured.variantMinTtcSeconds,
    measured.improvementPct,
    measured.baselineTtcRatePct,
    measured.variantTtcRatePct,
    measured.stringStabilityIndex,
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
  const keys = [
    'baselineMinTtcSeconds',
    'variantMinTtcSeconds',
    'improvementPct',
    'baselineTtcRatePct',
    'variantTtcRatePct',
    'stringStabilityIndex',
  ] as const
  for (const key of keys) {
    if (typeof numbers[key] !== 'number' || !Number.isFinite(numbers[key])) return undefined
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
      baselineMinTtcSeconds: numbers['baselineMinTtcSeconds'] as number,
      variantMinTtcSeconds: numbers['variantMinTtcSeconds'] as number,
      improvementPct: numbers['improvementPct'] as number,
      baselineTtcRatePct: numbers['baselineTtcRatePct'] as number,
      variantTtcRatePct: numbers['variantTtcRatePct'] as number,
      stringStabilityIndex: numbers['stringStabilityIndex'] as number,
    },
  }
}

/** The metric key the run's record carries, or undefined when there is no record. */
export function recordedMetricKey(value: unknown): string | undefined {
  const record = readResultVersion(value)
  return record === undefined ? undefined : record.metricKey
}

/**
 * The one line a consumer writes when it could not find the run's record.
 *
 * Kept here so every consumer says the same thing, and so a reader of any artifact can search for
 * one phrase to find every place a number was recomputed rather than read.
 *
 * @param stepId - the step doing the reporting.
 * @returns the note.
 */
export function recomputedNote(stepId: string): string {
  return `[${stepId}] reported a RECOMPUTED measurement: the run holds no result-version artifact,`
    + ' so this step measured the study itself. In a driven run that means a defect; here it means'
    + ' the step was driven without its producer.'
}
