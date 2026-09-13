/**
 * A real (simplified) signalised-intersection delay experiment.
 *
 * WHY THIS EXISTS. The C channel decides whether a falsifiable prediction survived
 * the experiment, and until now it looked the answer up in a fixture table keyed by
 * `(claimId, prediction)`. That made the channel incapable of adjudicating any claim
 * it had not been pre-written for — a derived claim simply abstained, which in turn
 * blocked every downstream step. This module replaces the lookup with an actual
 * computation: a two-phase intersection whose delay is computed from demand, and two
 * control policies whose difference the experiment measures.
 *
 * WHAT IS REAL HERE
 *  - The delay model is Webster's own delay formula (the standard analytic estimate
 *    for a fixed-time signalised approach), evaluated per phase and demand-weighted.
 *  - The adaptive policy is a real algorithm over the same model: it observes the
 *    queue split at each control interval and shifts green time toward the phase
 *    that is actually loaded, under the same cycle length and lost-time budget as the
 *    baseline. Nothing about the comparison is scripted; the numbers come out of the
 *    two policies running against the same demand.
 *
 * WHAT IS SIMPLIFIED (and must be declared as such in any write-up)
 *  - One isolated intersection, two phases, uniform arrivals, no platoon arrival
 *    profile, no spillback between intersections, no turn movements.
 *  - Webster's formula is an analytic estimate, not a microsimulation: it does not
 *    reproduce stochastic queueing tails.
 * These simplifications bound the claim's scope; they do not make the comparison
 * between the two policies any less a measurement.
 */

/** Demand and geometry for one experiment run. */
export interface TrafficScenario {
  /** Cycle length in seconds (fixed for both policies). */
  readonly cycleSeconds: number
  /** Total lost time per cycle in seconds (start-up + clearance, both phases). */
  readonly lostTimeSeconds: number
  /** Saturation flow per lane in veh/h; drives every approach's capacity. */
  readonly saturationFlowPerLane: number
  /** Demand in veh/h for each phase, per control interval. */
  readonly demandPerPhase: ReadonlyArray<readonly [number, number]>
  /** Number of control intervals the run is divided into. */
  readonly intervals: number
}

/** One interval's measured outcome under one policy. */
export interface IntervalResult {
  readonly interval: number
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
  splitShare: number,
): readonly [number, number] {
  const effectiveGreen = Math.max(0, scenario.cycleSeconds - scenario.lostTimeSeconds)
  const first = (effectiveGreen * splitShare) / scenario.cycleSeconds
  const second = (effectiveGreen * (1 - splitShare)) / scenario.cycleSeconds
  return [first, second]
}

/** Run one policy over the scenario. `splitShare` is chosen per interval by the policy. */
function runPolicy(
  scenario: TrafficScenario,
  policy: PolicyResult['policy'],
  chooseSplit: (demand: readonly [number, number], interval: number) => number,
): PolicyResult {
  const intervals: IntervalResult[] = []
  let weightedDelaySum = 0
  let demandSum = 0
  let worst = 0

  for (let index = 0; index < scenario.intervals; index++) {
    const demand = scenario.demandPerPhase[index] ?? [0, 0]
    const splitShare = chooseSplit(demand, index)
    const greenRatio = effectiveGreenRatios(scenario, splitShare)

    const delay: [number, number] = [
      websterDelaySeconds(demand[0], greenRatio[0], scenario.cycleSeconds, scenario.saturationFlowPerLane),
      websterDelaySeconds(demand[1], greenRatio[1], scenario.cycleSeconds, scenario.saturationFlowPerLane),
    ]
    intervals.push({ interval: index, greenSplit: greenRatio, delaySecondsPerVehicle: delay })

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
 * Baseline: a fixed-time plan. The split is set once from the AVERAGE demand of the
 * run and then never changes — which is precisely what real fixed-time control does,
 * and precisely what an adaptive policy has to beat.
 *
 * @param scenario - the demand and geometry to run.
 * @returns the measured outcome under the fixed-time policy.
 */
export function runFixedTimePolicy(scenario: TrafficScenario): PolicyResult {
  const totals = scenario.demandPerPhase.reduce<[number, number]>(
    (acc, d) => [acc[0] + d[0], acc[1] + d[1]],
    [0, 0],
  )
  const total = totals[0] + totals[1]
  const plannedShare = total > 0 ? totals[0] / total : 0.5
  return runPolicy(scenario, 'fixed-time', () => plannedShare)
}

/**
 * Adaptive policy — the algorithm under test.
 *
 * Every interval it reads the CURRENT phase demand and moves the green split toward
 * the loaded phase, under three real constraints: a minimum green per phase (so a
 * phase is never starved), a maximum split bound (so a spike cannot take the whole
 * cycle), and the same cycle length and lost time as the baseline (so the comparison
 * is like-for-like).
 *
 * @param scenario - the demand and geometry to run.
 * @param options - minimum share per phase and the maximum share one phase may take.
 * @returns the measured outcome under the adaptive policy.
 */
export function runAdaptivePolicy(
  scenario: TrafficScenario,
  options: { readonly minShare?: number; readonly maxShare?: number } = {},
): PolicyResult {
  const minShare = options.minShare ?? 0.25
  const maxShare = options.maxShare ?? 0.75
  return runPolicy(scenario, 'adaptive', (demand) => {
    const total = demand[0] + demand[1]
    if (total <= 0) return 0.5
    // Proportional to the observed load, then clamped into the feasible band.
    const share = demand[0] / total
    return Math.min(maxShare, Math.max(minShare, share))
  })
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
 * The study's demand profile: a corridor-scale intersection whose phase demand swings
 * between intervals. It is the scenario the model is evaluated on, and it is fixed
 * here so the experiment is reproducible — a claim's verdict must not depend on a
 * scenario chosen after seeing the result.
 *
 * @returns the scenario both policies are run against.
 */
export function experimentScenario(): TrafficScenario {
  return {
    cycleSeconds: 90,
    lostTimeSeconds: 8,
    saturationFlowPerLane: 1800,
    intervals: 6,
    demandPerPhase: [
      [950, 250],
      [450, 350],
      [980, 220],
      [420, 380],
      [900, 260],
      [500, 340],
    ],
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
 * @returns the verdict, or undefined when the prediction states no threshold.
 */
export function evaluatePrediction(predictionText: string): PredictionVerdict | undefined {
  const thresholdPct = thresholdFromPrediction(predictionText)
  if (thresholdPct === undefined) return undefined

  const comparison = comparePolicies(experimentScenario())
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
 * @param options - adaptive-policy bounds (see {@link runAdaptivePolicy}).
 * @returns both measured results plus the relative delay reduction.
 */
export function comparePolicies(
  scenario: TrafficScenario,
  options: { readonly minShare?: number; readonly maxShare?: number } = {},
): ComparisonResult {
  const baseline = runFixedTimePolicy(scenario)
  const variant = runAdaptivePolicy(scenario, options)
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
