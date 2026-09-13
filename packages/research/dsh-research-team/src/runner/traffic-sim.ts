/**
 * A real signalised-intersection delay experiment.
 *
 * WHY THIS EXISTS. The C channel decides whether a falsifiable prediction survived
 * the experiment, and until now it looked the answer up in a fixture table keyed by
 * `(claimId, prediction)`. That made the channel incapable of adjudicating any claim
 * it had not been pre-written for — a derived claim simply abstained, which in turn
 * blocked every downstream step. This module replaces the lookup with an actual
 * computation.
 *
 * WHAT IS REAL HERE
 *  - The delay model is Webster's own delay formula (the standard analytic estimate
 *    for a fixed-time signalised approach), evaluated per phase and demand-weighted.
 *  - The demand the two policies run against is DERIVED from a real measured hourly
 *    vehicle-count series; `./study-demand.ts` records the series, its hash and the
 *    derivation. Nothing in the scenario is hand-written.
 *  - Both policies are the same deterministic plan-selection rule; they differ ONLY
 *    in which demand they compute that plan FROM. Fixed-time computes one plan from
 *    the design interval and holds it (which is what fixed-time control is).
 *    Adaptive recomputes the plan each interval from that interval's demand, under
 *    the same cycle band, lost time and split bounds. Nothing about the comparison
 *    is scripted: the numbers come out of the two policies running against the same
 *    measured demand.
 *
 * WHAT IS SIMPLIFIED (and must be declared as such in any write-up)
 *  - One isolated intersection, two phases, one critical approach per phase,
 *    uniform arrivals, no platoon arrival profile, no spillback, no turn movements.
 *  - Webster's formula is an analytic estimate, not a microsimulation: it does not
 *    reproduce stochastic queueing tails. Both policies are compared inside the
 *    same model, so the comparison is a measurement even though the model is
 *    approximate — but the ABSOLUTE delay values are model output, not field data.
 *  - The demand series measures a multi-lane interstate, not this intersection; the
 *    mapping between them is the declared scale recorded in `study-demand.ts`, and
 *    the per-phase share is a declared constant because the series has no
 *    per-approach split.
 * These simplifications bound the claim's scope; they do not make the comparison
 * between the two policies any less a measurement.
 */

import {
  STUDY_DEMAND_INTERVALS,
  STUDY_DESIGN_INPUTS,
} from './study-demand.ts'

/** Demand and geometry for one experiment run. */
export interface TrafficScenario {
  /** Number of control intervals the run is divided into. */
  readonly intervals: number
  /** Duration of one control interval, in seconds. */
  readonly intervalSeconds: number
  /** Total lost time per cycle in seconds (start-up + clearance, both phases). */
  readonly lostTimeSeconds: number
  /** Saturation flow per lane in veh/h; drives every approach's capacity. */
  readonly saturationFlowPerLane: number
  /** Shortest cycle either policy may select, in seconds. */
  readonly minCycleSeconds: number
  /** Longest cycle either policy may select, in seconds. */
  readonly maxCycleSeconds: number
  /** Demand in veh/h for each phase, per control interval. */
  readonly demandPerPhase: ReadonlyArray<readonly [number, number]>
}

/** One interval's measured outcome under one policy. */
export interface IntervalResult {
  readonly interval: number
  /** Cycle the policy ran in this interval, in seconds. */
  readonly cycleSeconds: number
  readonly greenSplit: readonly [number, number]
  readonly delaySecondsPerVehicle: readonly [number, number]
}

/** Aggregate and per-interval measurements of one policy over one scenario. */
export interface PolicyResult {
  readonly policy: 'fixed-time' | 'adaptive'
  readonly intervals: ReadonlyArray<IntervalResult>
  /** Demand-weighted mean delay across all vehicles (s/veh). */
  readonly meanDelaySecondsPerVehicle: number
  /** Worst single-phase delay observed (s/veh). */
  readonly worstPhaseDelaySecondsPerVehicle: number
}

/** Bounds the adaptive rule may move the split within, so a phase is never starved. */
export interface PolicyBounds {
  /** Minimum share of effective green one phase may receive. */
  readonly minShare: number
  /** Maximum share of effective green one phase may receive. */
  readonly maxShare: number
}

/** Default split bounds: neither phase may be driven below a quarter of the green. */
export const DEFAULT_POLICY_BOUNDS: PolicyBounds = { minShare: 0.25, maxShare: 0.75 }

/**
 * Webster's delay for one approach: d = A + B − C, in seconds per vehicle.
 *
 * UNITS MATTER HERE. Webster (1958) writes the incremental and correction terms in
 * veh/s, and those terms are only meaningful at that scale: fed veh/h they collapse
 * to ~0.02% of the total, which silently reduced this model to its uniform term
 * alone. The demand is therefore converted to veh/s for those two terms while the
 * uniform term keeps the cycle in seconds.
 *
 * @param demandVehPerHour - approach demand.
 * @param greenRatio - effective green over cycle length.
 * @param cycleSeconds - cycle length.
 * @param saturationFlowPerLane - saturation flow the capacity is computed from.
 * @returns delay in seconds per vehicle, or the saturation sentinel when x >= 1.
 */
function websterDelaySeconds(
  demandVehPerHour: number,
  greenRatio: number,
  cycleSeconds: number,
  saturationFlowPerLane: number,
): number {
  if (demandVehPerHour <= 0) return 0
  // Effective green capacity of the approach under this split.
  const capacity = saturationFlowPerLane * greenRatio
  if (capacity <= 0) return Number.POSITIVE_INFINITY
  const degreeOfSaturation = demandVehPerHour / capacity
  // Oversaturated: Webster is undefined (1 − x → 0) and delay grows without bound.
  // Report a large finite value so the aggregate stays comparable rather than NaN.
  if (degreeOfSaturation >= 1) return 999

  /** Webster's own unit for the incremental and correction terms. */
  const demandVehPerSecond = demandVehPerHour / 3600

  const uniformDelay =
    (cycleSeconds * (1 - greenRatio) ** 2) / (2 * (1 - Math.min(1, degreeOfSaturation) * greenRatio))
  const incrementalDelay =
    (degreeOfSaturation ** 2) / (2 * demandVehPerSecond * (1 - degreeOfSaturation))
  const correction =
    0.65 * (cycleSeconds / demandVehPerSecond ** 2) ** (1 / 3) * degreeOfSaturation ** (2 + 5 * greenRatio)
  return Math.max(0, uniformDelay + incrementalDelay - correction)
}

/** Effective green split available to the two phases after lost time. */
function effectiveGreenRatios(
  scenario: TrafficScenario,
  cycleSeconds: number,
  splitShare: number,
): readonly [number, number] {
  const effectiveGreen = Math.max(0, cycleSeconds - scenario.lostTimeSeconds)
  const first = (effectiveGreen * splitShare) / cycleSeconds
  const second = (effectiveGreen * (1 - splitShare)) / cycleSeconds
  return [first, second]
}

/** The cycle length and split one policy applies to one interval's demand. */
export interface IntervalPlan {
  readonly cycleSeconds: number
  readonly splitShare: number
}

/**
 * Webster's optimum cycle length for one interval's demand, clamped to the band.
 *
 * `C = (1.5L + 5) / (1 − Y)` with `Y` the sum of the critical flow ratios. At or
 * above saturation `Y >= 1` the formula has no solution, so the band's upper bound
 * is returned: the policy cannot lengthen its way out of oversaturation, and
 * pretending otherwise would be the model lying about its own domain.
 *
 * @param scenario - geometry and the cycle band.
 * @param demand - the two phases' demand in veh/h.
 * @returns the cycle in seconds, inside `[minCycleSeconds, maxCycleSeconds]`.
 */
export function websterOptimalCycle(
  scenario: TrafficScenario,
  demand: readonly [number, number],
): number {
  const criticalRatioSum = (demand[0] + demand[1]) / scenario.saturationFlowPerLane
  if (!(criticalRatioSum < 1)) return scenario.maxCycleSeconds
  const optimal = (1.5 * scenario.lostTimeSeconds + 5) / (1 - criticalRatioSum)
  return Math.min(scenario.maxCycleSeconds, Math.max(scenario.minCycleSeconds, optimal))
}

/**
 * The plan the study's rule selects for one interval's demand.
 *
 * The rule has two parts, both standard: the cycle is Webster's optimum for the
 * observed demand inside the practical band, and the split is proportional to the
 * observed demand, clamped so neither phase is starved. It is the SAME rule for
 * both policies — the policies differ only in the demand they feed it, which is
 * what makes the comparison between them a comparison of control strategies rather
 * than of two different algorithms.
 *
 * @param scenario - geometry and the cycle band.
 * @param demand - the two phases' demand in veh/h.
 * @param bounds - split bounds the rule must respect.
 * @returns the cycle and split to apply.
 */
export function selectPlan(
  scenario: TrafficScenario,
  demand: readonly [number, number],
  bounds: PolicyBounds,
): IntervalPlan {
  const total = demand[0] + demand[1]
  const proportional = total > 0 ? demand[0] / total : 0.5
  return {
    cycleSeconds: websterOptimalCycle(scenario, demand),
    splitShare: Math.min(bounds.maxShare, Math.max(bounds.minShare, proportional)),
  }
}

/** Run one policy over the scenario. `choosePlan` decides the plan per interval. */
function runPolicy(
  scenario: TrafficScenario,
  policy: PolicyResult['policy'],
  choosePlan: (demand: readonly [number, number], interval: number) => IntervalPlan,
): PolicyResult {
  const intervals: IntervalResult[] = []
  let weightedDelaySum = 0
  let demandSum = 0
  let worst = 0

  for (let index = 0; index < scenario.intervals; index++) {
    const demand = scenario.demandPerPhase[index] ?? [0, 0]
    const plan = choosePlan(demand, index)
    const greenRatio = effectiveGreenRatios(scenario, plan.cycleSeconds, plan.splitShare)

    const delay: [number, number] = [
      websterDelaySeconds(demand[0], greenRatio[0], plan.cycleSeconds, scenario.saturationFlowPerLane),
      websterDelaySeconds(demand[1], greenRatio[1], plan.cycleSeconds, scenario.saturationFlowPerLane),
    ]
    intervals.push({ interval: index, cycleSeconds: plan.cycleSeconds, greenSplit: greenRatio, delaySecondsPerVehicle: delay })

    const intervalDemand = demand[0] + demand[1]
    weightedDelaySum += delay[0] * demand[0] + delay[1] * demand[1]
    demandSum += intervalDemand
    worst = Math.max(worst, delay[0], delay[1])
  }

  return {
    policy,
    intervals,
    meanDelaySecondsPerVehicle: demandSum > 0 ? weightedDelaySum / demandSum : 0,
    worstPhaseDelaySecondsPerVehicle: worst,
  }
}

/**
 * The design interval: the one carrying the most demand.
 *
 * A fixed-time plan is designed for a design-hour flow, and this is that hour as
 * the study's own measured profile states it. Ties resolve to the earliest
 * interval, so the design does not depend on iteration order.
 *
 * @param scenario - the scenario whose intervals are searched.
 * @returns the 0-based index of the busiest interval.
 */
export function designInterval(scenario: TrafficScenario): number {
  let best = 0
  let bestDemand = -1
  for (let index = 0; index < scenario.intervals; index++) {
    const demand = scenario.demandPerPhase[index] ?? [0, 0]
    const total = demand[0] + demand[1]
    if (total > bestDemand) {
      bestDemand = total
      best = index
    }
  }
  return best
}

/**
 * Baseline: a fixed-time plan. The plan is designed ONCE from the design interval's
 * demand and then never changes — which is precisely what real fixed-time control
 * does, and precisely what an adaptive policy has to beat.
 *
 * @param scenario - the demand and geometry to run.
 * @param bounds - split bounds (see {@link PolicyBounds}).
 * @returns the measured outcome under the fixed-time policy.
 */
export function runFixedTimePolicy(
  scenario: TrafficScenario,
  bounds: PolicyBounds = DEFAULT_POLICY_BOUNDS,
): PolicyResult {
  const design = scenario.demandPerPhase[designInterval(scenario)] ?? [0, 0]
  const planned = selectPlan(scenario, design, bounds)
  return runPolicy(scenario, 'fixed-time', () => planned)
}

/**
 * Adaptive policy — the algorithm under test.
 *
 * Every interval it recomputes the plan from the demand it observes in THAT
 * interval, under the same cycle band, lost time and split bounds the baseline is
 * held to (so the comparison is like-for-like). It is the same {@link selectPlan}
 * rule the baseline uses; what differs is that the baseline is frozen at the design
 * interval and this one is not.
 *
 * @param scenario - the demand and geometry to run.
 * @param bounds - split bounds (see {@link PolicyBounds}).
 * @returns the measured outcome under the adaptive policy.
 */
export function runAdaptivePolicy(
  scenario: TrafficScenario,
  bounds: PolicyBounds = DEFAULT_POLICY_BOUNDS,
): PolicyResult {
  return runPolicy(scenario, 'adaptive', demand => selectPlan(scenario, demand, bounds))
}

/** Outcome of one comparative experiment. */
export interface ComparisonResult {
  readonly baseline: PolicyResult
  readonly variant: PolicyResult
  /** Relative reduction in demand-weighted mean delay, as a percentage. */
  readonly relativeReductionPct: number
  /** True when the reduction meets or exceeds the claim's threshold. */
  readonly meetsThreshold: (thresholdPct: number) => boolean
}

/**
 * The study's demand profile: the measured, scaled and phase-split series recorded
 * in `./study-demand.ts`, paired with the declared geometry the experiment runs it
 * against. It is a fixed function of the dataset — a claim's verdict must not depend
 * on a scenario chosen after seeing the result.
 *
 * @returns the scenario both policies are run against.
 */
export function experimentScenario(): TrafficScenario {
  const demandPerPhase = STUDY_DEMAND_INTERVALS.map(interval => interval.demandPerPhase)
  return {
    intervals: demandPerPhase.length,
    intervalSeconds: (24 / demandPerPhase.length) * 3600,
    lostTimeSeconds: STUDY_DESIGN_INPUTS.lostTimeSeconds,
    saturationFlowPerLane: STUDY_DESIGN_INPUTS.saturationFlowPerLane,
    minCycleSeconds: 40,
    maxCycleSeconds: 120,
    demandPerPhase,
  }
}

/** Verdict of one falsifiable prediction against the experiment. */
export interface PredictionVerdict {
  /** True when the measured reduction meets the threshold the prediction stated. */
  readonly supportsPrediction: boolean
  /** Measured relative reduction (%). */
  readonly reductionPct: number
  /** Threshold parsed out of the prediction text (%). */
  readonly thresholdPct: number
  /** Auditable one-line basis for the verdict. */
  readonly detail: string
}

/**
 * Read the numeric threshold a prediction commits to.
 *
 * The prediction is prose, but a falsifiable one names a quantity, so the first
 * percentage in the text is the commitment. A prediction with no percentage is not
 * falsifiable in this study's terms and yields undefined, which callers must treat
 * as "cannot adjudicate" rather than as a pass.
 *
 * @param predictionText - the prediction as written.
 * @returns the threshold in percent, or undefined when none is stated.
 */
export function thresholdFromPrediction(predictionText: string): number | undefined {
  const match = predictionText.match(/(\d+(?:\.\d+)?)\s*%/)
  if (match === null) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

/**
 * Run the experiment and adjudicate one prediction against it.
 *
 * This is the single source the C1 executor and the C gate both consume, so the
 * artifact and the verdict can never disagree: they are the same measurement.
 *
 * @param predictionText - the claim's falsifiable prediction.
 * @param scenario - the scenario to run; defaults to the study's measured profile.
 * @returns the verdict, or undefined when the prediction states no threshold.
 */
export function evaluatePrediction(
  predictionText: string,
  scenario: TrafficScenario = experimentScenario(),
): PredictionVerdict | undefined {
  const thresholdPct = thresholdFromPrediction(predictionText)
  if (thresholdPct === undefined) return undefined

  const comparison = comparePolicies(scenario)
  const reductionPct = comparison.relativeReductionPct
  const supportsPrediction = comparison.meetsThreshold(thresholdPct)
  return {
    supportsPrediction,
    reductionPct,
    thresholdPct,
    detail:
      `adaptive control ${supportsPrediction ? 'met' : 'missed'} the stated threshold: `
      + `measured reduction ${reductionPct.toFixed(2)}% vs required ${String(thresholdPct)}% `
      + `(fixed-time ${comparison.baseline.meanDelaySecondsPerVehicle.toFixed(2)} s/veh -> `
      + `adaptive ${comparison.variant.meanDelaySecondsPerVehicle.toFixed(2)} s/veh)`,
  }
}

/**
 * Run both policies over the same scenario and compare them.
 *
 * @param scenario - the demand and geometry to run.
 * @param bounds - split bounds (see {@link PolicyBounds}).
 * @returns both measured results plus the relative delay reduction.
 */
export function comparePolicies(
  scenario: TrafficScenario,
  bounds: PolicyBounds = DEFAULT_POLICY_BOUNDS,
): ComparisonResult {
  const baseline = runFixedTimePolicy(scenario, bounds)
  const variant = runAdaptivePolicy(scenario, bounds)
  const base = baseline.meanDelaySecondsPerVehicle
  const relativeReductionPct = base > 0
    ? ((base - variant.meanDelaySecondsPerVehicle) / base) * 100
    : 0
  return {
    baseline,
    variant,
    relativeReductionPct,
    meetsThreshold: (thresholdPct: number) => relativeReductionPct >= thresholdPct,
  }
}
