/**
 * The study's experiment: a deterministic platoon car-following simulation.
 *
 * WHY THIS EXISTS. The Case Pack this repository ships is a car-following study: it asks
 * how inserting one autonomous vehicle into a three-vehicle human platoon changes the
 * platoon's car-following risk. The C channel used to answer a DIFFERENT study — the delay
 * of a signalised intersection computed with Webster's formula — and its own artifact said
 * so (`doesNotMeasure: 'platoon car-following risk …'`). A run was therefore internally
 * inconsistent: its claim, its literature, its ablation and its boundary files were all
 * about platoons while the only measurement in it was about an intersection. This module
 * replaces that measurement with one of the study the pack actually states.
 *
 * WHAT IS REAL HERE
 *  - The car-following dynamics are the Intelligent Driver Model (Treiber, Hennecke &
 *    Helbing, *Congested traffic states in empirical observations and microscopic
 *    simulations*, Phys. Rev. E 62:1805, 2000), integrated at a declared fixed step.
 *    Nothing about either platoon's motion is scripted.
 *  - Reaction time is a real delay: a follower evaluates its leader's state as it was
 *    `reactionDelaySeconds` earlier, read out of a ring buffer of states. That delay is
 *    the ONLY mechanism the claim attributes the effect to, so the comparison is a test of
 *    the claim's own mechanism rather than of a pre-written table.
 *  - Every reported number is computed from the simulated trajectories: minimum
 *    time-to-collision, mean time headway, mean absolute jerk and the string-stability
 *    index. There is no fixture table on this path and no lookup by claim id.
 *
 * WHAT IS SIMPLIFIED (and must be declared as such in any write-up)
 *  - Three vehicles, one lane, no lane changes, no turns, no grade, no stochasticity: the
 *    run is deterministic by construction, so a re-run reproduces it exactly.
 *  - Time-to-collision is the classical surrogate (Minderhoud & Bovy, *Extended time-to-
 *    collision measures for road traffic safety assessment*, Accid. Anal. Prev. 33:89,
 *    2001) computed from the simulated states. It is a surrogate for conflict, not an
 *    observed crash count, and the study reports no crash frequency.
 *  - The leader's speed profile is a DECLARED design input, not a measurement: a periodic
 *    disturbance at a declared amplitude and period. It is the perturbation the
 *    string-stability literature uses to test whether a disturbance grows or decays down a
 *    platoon, and its period is the one the Case Pack's boundary file declares.
 *  - The absolute values are model output. The COMPARISON between the two platoons is the
 *    measurement; the absolute numbers are not field data and are labelled accordingly.
 *
 * A LIMIT THIS MODULE MEASURES AND REPORTS RATHER THAN HIDES. At the headways and forcings
 * this Case Pack declares, the `TTC < 1.5 s` band is not entered, and the numbers below say so
 * WITH THE GRID THEY CAME FROM — an earlier version of this paragraph quoted a floor of 2.08 s
 * that came from a 0.3 s headway, which is not a value the pack declares, and an independent
 * auditor could not reproduce it on three wider grids. The floor is a property of a stated sweep:
 *
 *   declared headways, free flow                      12.10 s (variant), 19.58 s (baseline)
 *   declared headways, the pack's own stop-and-go      4.158 s
 *   declared headways, a near-total stop (24 of 25 m/s) 2.847 s — harsher than the pack declares
 *
 * The rate is 0.00% at every one of those. An auditor's 3366-configuration sweep covered a WIDER
 * range of headways and deceleration limits than the pack declares and did not enter the band
 * either, which is why the qualifier below is about the CONCLUSION rather than about that sweep.
 *
 * THAT QUALIFIER IS LOAD-BEARING, and this paragraph previously lacked it: it claimed the band was
 * never entered at all, which an auditor then refuted using knobs the pack can reach — a 0.15 s
 * headway with a 0.2 m/s² deceleration limit enters it at 16.62%, and the same auditor's sweep
 * separately found 6.18% and 7.39%. The band is reachable; what is true is that the DECLARED
 * configuration does not reach it. Those are different claims and only the second is supported.
 *
 * The limiting factor is the model's own deceleration behaviour, and the arithmetic that
 * first suggested otherwise was wrong: `(s0 + v·T)/v` is what the TTC would be if the
 * follower never braked at all, and a follower does brake — within its reaction delay it can
 * decelerate at least as hard as its leader, so the closing speed stays small relative to the
 * gap it still has. That bound is below 1.5 s for the AV's declared 1.2 s headway, so it
 * never ruled the band out; only running the simulation does.
 *
 * The rate is still measured and reported — it is the quantity the pack's own mock rows are
 * written in — but it is NOT the quantity the study binds its claim to, because a metric that
 * does not move cannot adjudicate anything. The bound quantity is the platoon's minimum
 * time-to-collision, which does move. The pack's mock values for that column (18%–44%) are
 * not reachable under this model at any setting tested.
 */

/** Version of the rule that MEASURES this experiment. Identifies the measurement. */
export const EXPERIMENT_RULE_VERSION = 'platoon-idm-v1'

/**
 * Declared design inputs of the simulation.
 *
 * These are the modelling choices made on top of the Case Pack's own configuration. They
 * are constants rather than `Config` fields because they are properties of the published
 * model being applied (IDM's standard parameter set) — changing one changes what model is
 * being run, not how a deployment is configured.
 */
export const SIMULATION_INPUTS = {
  /** IDM maximum acceleration, m/s². Standard IDM value. */
  maxAccelerationMps2: 1.4,
  /** IDM comfortable deceleration, m/s². Standard IDM value. */
  comfortableDecelerationMps2: 2.0,
  /** IDM free-flow exponent δ. Standard IDM value. */
  accelerationExponent: 4,
  /** IDM minimum standstill gap s0, m. Standard IDM value. */
  minimumGapM: 2.0,
  /**
   * IDM desired free-flow speed v0, m/s.
   *
   * It MUST exceed the study's cruise speed, and this is a property of the model rather
   * than a tuning choice. IDM's free term is `1 − (v/v0)^δ`, so a vehicle reaches zero
   * acceleration only asymptotically as its gap grows without bound: there is NO finite
   * equilibrium gap at `v = v0`. A platoon whose leader cruises exactly at v0 therefore
   * diverges — the first version of this module did, opening to a 200 m gap — and the
   * comparison silently measured a spreading platoon instead of a following one. With v0
   * above the cruise speed the free and interaction terms balance at a real, finite gap.
   */
  desiredSpeedMps: 30.0,
  /** Length of one vehicle, m. Excluded from the gap used by IDM and by TTC. */
  vehicleLengthM: 4.5,
  /** Integration step, s. Fixed so a re-run reproduces the trajectories exactly. */
  stepSeconds: 0.02,
  /** Simulated seconds discarded before measurement, so the platoon starts settled. */
  warmupSeconds: 120,
  /** Simulated seconds measured, after the warm-up. */
  measurementSeconds: 240,
  /** Amplitude of the free-flow leader disturbance, m/s (20% of the declared 25 m/s). */
  freeFlowAmplitudeMps: 5.0,
  /** Period of the leader disturbance, s. Matches the Case Pack's declared wave period. */
  disturbancePeriodSeconds: 12.0,
  /** Stop-and-go forcing: the leader's speed drop, m/s. From the Case Pack's boundary file. */
  stopAndGoSpeedDropMps: 18.0,
  /** The TTC threshold the pack's own mock rows are written at, s. Reported, not bound. */
  ttcThresholdSeconds: 1.5,
  /**
   * Boundary test: the claim's scope is limited to steady free flow when the stop-and-go
   * minimum TTC falls below this fraction of the free-flow minimum TTC. The pack declares
   * a factor of two, stated as a RISK ratio; on a safety-margin quantity the equivalent
   * statement is that the margin is halved.
   */
  boundaryMarginRatio: 0.5,
} as const

/** The quantity this study's experiment MEASURES, and which a claim must declare. */
export const MEASURED_METRIC_KEY = 'min-ttc-seconds'

/** Display label for {@link MEASURED_METRIC_KEY}, for evidence strings. */
export const MEASURED_METRIC_LABEL =
  "the platoon's minimum time-to-collision (s)"

/** Whether a larger value of the measured quantity is better or worse. */
export type MetricDirection = 'lower-is-better' | 'higher-is-better'

/** Direction of {@link MEASURED_METRIC_KEY}: a larger safety margin is better. */
export const MEASURED_METRIC_DIRECTION: MetricDirection = 'higher-is-better'

/**
 * The phrasings a claim about {@link MEASURED_METRIC_KEY} must actually use.
 *
 * A declared key alone is SELF-ATTESTATION: a claim whose prose is about something else
 * passes every check if it merely declares the key of the quantity this study measures.
 * This repository had exactly that defect once (a platoon-risk claim declaring the delay
 * key), so the key and the claim's own words must agree.
 *
 * A keyword test cannot establish that a claim is ABOUT a quantity, only that it USED the
 * words, so the check is NECESSARY and not sufficient. It refuses a claim that never names
 * the measured quantity and still admits one that names it in passing. Judging relevance
 * would take a reader or a model, and this repository will not let a model's judgement of a
 * claim stand as the standard for that same claim. The limit is stated, not papered over.
 */
export const MEASURED_METRIC_PHRASES: ReadonlyArray<string> = [
  'minimum time-to-collision',
  'minimum time to collision',
  'minimum ttc',
  'smallest time-to-collision',
  'smallest time to collision',
  'tightest time-to-collision',
  'tightest time to collision',
  'worst-case time-to-collision',
  'worst case time to collision',
]

/** The phrasings each supported metric key requires. Closed: an unlisted key has none. */
const METRIC_PHRASES: Readonly<Record<string, ReadonlyArray<string>>> = {
  [MEASURED_METRIC_KEY]: MEASURED_METRIC_PHRASES,
}

/** Which vehicle class a platoon position holds. */
export type VehicleClassId = 'HV' | 'AV'

/** One vehicle class's car-following parameters, as the Case Pack declares them. */
export interface VehicleClass {
  /** Reaction time, s. The mechanism the claim attributes the effect to. */
  readonly reactionDelaySeconds: number
  /** IDM desired time headway T, s. */
  readonly desiredHeadwaySeconds: number
  /** Hard limit on deceleration, m/s². Clamps the IDM acceleration. */
  readonly maxDecelerationMps2: number
  /**
   * Seconds of the leader's future motion this vehicle predicts, cancelling that much of
   * its own reaction delay. Zero means no look-ahead.
   *
   * This is expressed as a HORIZON rather than a boolean because the two mechanisms the
   * Case Pack names have to be separable for either ablation to mean anything. A boolean
   * made a looking-ahead vehicle ignore its own reaction delay entirely, so ablating the
   * reaction delay changed nothing at all — the ablation reported a 0.000 s difference and
   * would have attributed zero contribution to a mechanism it had not removed.
   */
  readonly lookAheadHorizonSeconds: number
}

/** The leader's imposed speed profile. Declared, not measured. */
export type LeaderForcing =
  | {
    readonly kind: 'free-flow'
    readonly amplitudeMps: number
    readonly periodSeconds: number
  }
  | {
    readonly kind: 'stop-and-go'
    readonly speedDropMps: number
    readonly periodSeconds: number
  }

/** One platoon and the conditions it is run under. */
export interface PlatoonScenario {
  /** Vehicle class at each position, leader first. */
  readonly composition: ReadonlyArray<VehicleClassId>
  readonly vehicleClasses: Readonly<Record<VehicleClassId, VehicleClass>>
  /** Cruise speed the leader oscillates around, m/s. */
  readonly initialSpeedMps: number
  /**
   * IDM desired free-flow speed for this platoon, m/s. Must exceed
   * {@link initialSpeedMps}; see {@link SIMULATION_INPUTS.desiredSpeedMps}.
   */
  readonly desiredSpeedMps: number
  /** Gap between consecutive vehicles at t=0, m (bumper to bumper). */
  readonly initialGapM: number
  readonly leader: LeaderForcing
}

/** The two platoons the study compares. */
export interface PlatoonStudy {
  /** The homogeneous all-human platoon. */
  readonly baseline: PlatoonScenario
  /** The platoon carrying one AV. */
  readonly variant: PlatoonScenario
}

/** Per-vehicle measurements over the measurement window. */
export interface VehicleMeasurement {
  readonly position: number
  readonly vehicleClass: VehicleClassId
  /** Half the peak-to-peak variation of this vehicle's speed, m/s. */
  readonly speedAmplitudeMps: number
  /** Smallest gap this vehicle held to its leader, m (bumper to bumper). */
  readonly minimumGapM: number
}

/** Measurements of one platoon over one measurement window. */
export interface PlatoonResult {
  readonly composition: ReadonlyArray<VehicleClassId>
  readonly vehicles: ReadonlyArray<VehicleMeasurement>
  /** Smallest time-to-collision observed anywhere in the platoon, s. */
  readonly minTtcSeconds: number
  /** Share of vehicle-time samples whose time-to-collision was below the pack's threshold, %. */
  readonly ttcLt1_5RatePct: number
  /** Mean time headway, s. */
  readonly meanTimeHeadwaySeconds: number
  /** Mean absolute jerk, m/s³. */
  readonly meanJerkMps3: number
  /**
   * String-stability index: `1 − A_last / A_leader`, with `A` the speed-amplitude of the
   * last vehicle and of the leader. Positive means the disturbance decayed down the
   * platoon (stable); negative means it grew (unstable). Zero means it was transmitted
   * unchanged.
   */
  readonly stringStabilityIndex: number
  /** True when the disturbance did not grow: `stringStabilityIndex >= 0`. */
  readonly stringStable: boolean
  /** Vehicle-time samples in which a follower occupied the same space as its leader. */
  readonly collisions: number
  /** Vehicle-time samples the window contained. */
  readonly samples: number
}

/** The study's two measurements and the quantity that compares them. */
export interface PlatoonComparison {
  readonly baseline: PlatoonResult
  readonly variant: PlatoonResult
  /**
   * True when both platoons produced a positive, finite minimum time-to-collision, so the
   * relative improvement is a real ratio. False means the measurement cannot be compared —
   * which is NOT the same fact as "the variant is no better".
   */
  readonly isComparable: boolean
  /**
   * How much BETTER the variant is than the baseline, as a percentage of the baseline,
   * in the declared direction of {@link MEASURED_METRIC_KEY}. Positive is better.
   */
  readonly relativeImprovementPct: number
  readonly meetsThreshold: (thresholdPct: number) => boolean
}

/** Why a prediction could not be adjudicated, or its verdict when it could. */
export type PredictionAdjudication =
  | {
    readonly kind: 'adjudicated'
    /** True when the measured improvement met the threshold the prediction stated. */
    readonly supportsPrediction: boolean
    readonly improvementPct: number
    readonly thresholdPct: number
    /** The direction the claim DECLARED, which is the one its threshold was graded in. */
    readonly direction: PredictionCommitment['direction']
    /** How the claim relates the threshold to the change; see {@link PredictionCommitment.bound}. */
    readonly bound: PredictionCommitment['bound']
    readonly detail: string
    /** The claim's own phrasing that binds it to the measured quantity. */
    readonly matchedPhrase: string
  }
  | { readonly kind: 'unbindable'; readonly reason: string }

/** The Case Pack's declared 3-vehicle mixed platoon: HV, AV, HV. */
export const MIXED_PLATOON_COMPOSITION: ReadonlyArray<VehicleClassId> = [
  'HV',
  'AV',
  'HV',
]
/** The Case Pack's declared homogeneous platoon: HV, HV, HV. */
export const HOMOGENEOUS_PLATOON_COMPOSITION: ReadonlyArray<VehicleClassId> = [
  'HV',
  'HV',
  'HV',
]

/**
 * The operating point the study starts from.
 *
 * The initial gap is the gap the measured traffic stream implies: at a measured flow `q`
 * and the platoon's declared speed `v`, the identity `q = k·v` fixes the mean spacing at
 * `v / (q / 3600)` centres, so the bumper-to-bumper gap is that minus one vehicle length.
 * The flow is the busiest interval of the measured diurnal curve, scaled to the declared
 * design volume by the same derivation the Case Pack's demand file records.
 *
 * The pack's own IDM parameters put a settled human platoon at `s0 + v·T = 52.0 m` of gap
 * at 25 m/s. The measured operating point puts it at 50.6 m. The simulation starts from
 * the measured one and relaxes during the warm-up, so the transient is real rather than
 * removed; the two agreeing to within 3% is a consistency check on the declared inputs,
 * not a fitted result.
 */
export const STUDY_OPERATING_POINT = {
  designTotalVehPerHour: 1476,
  declaredLanes: 3,
  perLaneVehPerHour: 492,
  initialSpeedMps: 25.0,
  initialGapM: 50.62,
} as const

/** The Case Pack's declared vehicle parameters, as this module's class table. */
export const DECLARED_VEHICLE_CLASSES: Readonly<
  Record<VehicleClassId, VehicleClass>
> = {
  HV: {
    reactionDelaySeconds: 1.2,
    desiredHeadwaySeconds: 2.0,
    maxDecelerationMps2: 7.5,
    lookAheadHorizonSeconds: 0,
  },
  // The AV predicts its leader's motion over its own 150 ms reaction horizon, which
  // cancels that delay and leaves no lag. Both declared numbers come from the Case Pack.
  AV: {
    reactionDelaySeconds: 0.15,
    desiredHeadwaySeconds: 1.2,
    maxDecelerationMps2: 8.0,
    lookAheadHorizonSeconds: 0.15,
  },
}

/** The disturbance the two platoons are run under in the study's main comparison. */
export const FREE_FLOW_FORCING: LeaderForcing = {
  kind: 'free-flow',
  amplitudeMps: SIMULATION_INPUTS.freeFlowAmplitudeMps,
  periodSeconds: SIMULATION_INPUTS.disturbancePeriodSeconds,
}

/** The stop-and-go forcing the boundary test runs the variant under. */
export const STOP_AND_GO_FORCING: LeaderForcing = {
  kind: 'stop-and-go',
  speedDropMps: SIMULATION_INPUTS.stopAndGoSpeedDropMps,
  periodSeconds: SIMULATION_INPUTS.disturbancePeriodSeconds,
}

/**
 * The study's own two scenarios, built from the declared parameters.
 *
 * A Case Pack that declares its own scenarios overrides these; when no pack is selected
 * this is what runs, so the pipeline is deterministic without one.
 *
 * @returns the baseline and variant scenarios of the study.
 */
export function experimentStudy(): PlatoonStudy {
  const common = {
    vehicleClasses: DECLARED_VEHICLE_CLASSES,
    initialSpeedMps: STUDY_OPERATING_POINT.initialSpeedMps,
    desiredSpeedMps: SIMULATION_INPUTS.desiredSpeedMps,
    initialGapM: STUDY_OPERATING_POINT.initialGapM,
    leader: FREE_FLOW_FORCING,
  } as const
  return {
    baseline: { ...common, composition: HOMOGENEOUS_PLATOON_COMPOSITION },
    variant: { ...common, composition: MIXED_PLATOON_COMPOSITION },
  }
}

/**
 * Build the study from a Case Pack's declared scenarios.
 *
 * The pack is the run's selected input, so its scenario parameters are what the experiment
 * must run — otherwise a pack could state one vehicle configuration and the pipeline would
 * measure another, which is the class of defect this whole module exists to remove. The
 * pack declares two scenarios (a homogeneous and a mixed platoon); the study takes those
 * two, and a pack that declares anything else is refused rather than guessed at.
 *
 * What the pack does NOT declare, and this function therefore does not take from it: the
 * initial gap and the leader's disturbance. Those come from {@link STUDY_OPERATING_POINT}
 * and {@link SIMULATION_INPUTS} and are recorded with the measurement.
 *
 * @param scenarioInput - the `case-pack-scenario` run input value.
 * @returns the study the pack describes, or undefined when the value is not a pack scenario
 *   holding exactly one homogeneous and one mixed platoon.
 */
export function studyFromPack(
  scenarioInput: unknown,
): PlatoonStudy | undefined {
  if (scenarioInput === null || typeof scenarioInput !== 'object')
    return undefined
  const declared = (scenarioInput as { domainScenarios?: unknown })
    .domainScenarios
  if (!Array.isArray(declared) || declared.length !== 2) return undefined

  const build = (raw: unknown): PlatoonScenario | undefined => {
    if (raw === null || typeof raw !== 'object') return undefined
    const entry = raw as Record<string, unknown>
    const composition = entry.platoonComposition
    const params = entry.vehicleParams
    const speed = entry.initialSpeed_mps
    if (
      !Array.isArray(composition) ||
      composition.some(id => id !== 'HV' && id !== 'AV')
    )
      return undefined
    // A platoon needs a leader and at least one follower. Accepting a one-vehicle composition and
    // letting `runPlatoon` refuse it later turned a pack this loader cannot use into an uncaught
    // exception thrown from inside the C channel, where every neighbouring refusal (an
    // incomparable measurement, an unstated metric) is a fail-closed `unbindable` hold. An audit
    // found it; the contract here is "a pack this loader cannot read is refused", so it is refused.
    if (composition.length < 2) return undefined
    if (params === null || typeof params !== 'object') return undefined
    if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0)
      return undefined

    const classes: Partial<Record<VehicleClassId, VehicleClass>> = {}
    for (const id of ['HV', 'AV'] as const) {
      const table = (params as Record<string, unknown>)[id]
      if (table === null || typeof table !== 'object') continue
      const row = table as Record<string, unknown>
      const reactionMs = row.reactionDelay_ms
      const headway = row.followDistance_s
      const decel = row.maxDecel_mps2
      if (
        typeof reactionMs !== 'number' ||
        typeof headway !== 'number' ||
        typeof decel !== 'number'
      )
        return undefined
      const reactionDelaySeconds = reactionMs / 1000
      const declaredHorizonMs = row.predictiveHorizon_ms
      classes[id] = {
        reactionDelaySeconds,
        desiredHeadwaySeconds: headway,
        maxDecelerationMps2: decel,
        // The pack DECLARES the horizon when it carries one. A pack that does not gets the
        // vehicle's own reaction delay instead, and that derivation is recorded on the artifact
        // (`studyEvidence.derivedParameters`): once the horizon became a real mechanism worth
        // 0.72 s of the measured effect, a result resting on it must not rest on a number no input
        // states. An audit raised exactly that, and the fix is for the pack to carry the field.
        lookAheadHorizonSeconds:
          typeof declaredHorizonMs === 'number' &&
          Number.isFinite(declaredHorizonMs) &&
          declaredHorizonMs >= 0
            ? declaredHorizonMs / 1000
            : id === 'AV'
              ? reactionDelaySeconds
              : 0,
      }
    }
    if (classes.HV === undefined) return undefined
    return {
      composition: composition as ReadonlyArray<VehicleClassId>,
      // A pack that declares only HV still has an AV row to fall back on: an AV-composed
      // platoon cannot run without AV parameters, and silently substituting human ones would
      // measure a different vehicle than the pack names.
      vehicleClasses: { HV: classes.HV, AV: classes.AV ?? classes.HV },
      initialSpeedMps: speed,
      desiredSpeedMps: SIMULATION_INPUTS.desiredSpeedMps,
      initialGapM: STUDY_OPERATING_POINT.initialGapM,
      leader: FREE_FLOW_FORCING,
    }
  }

  const built = declared.map(build)
  if (built.some(entry => entry === undefined)) return undefined
  const scenarios = built as ReadonlyArray<PlatoonScenario>
  const homogeneous = scenarios.find(s =>
    s.composition.every(id => id === 'HV'),
  )
  const mixed = scenarios.find(s => s.composition.includes('AV'))
  if (homogeneous === undefined || mixed === undefined) return undefined
  return { baseline: homogeneous, variant: mixed }
}

/** The leader's imposed speed at one instant, m/s. */
function leaderSpeedAt(
  forcing: LeaderForcing,
  cruiseMps: number,
  seconds: number,
): number {
  const phase = (2 * Math.PI * seconds) / forcing.periodSeconds
  if (forcing.kind === 'free-flow') {
    return Math.max(0, cruiseMps + forcing.amplitudeMps * Math.sin(phase))
  }
  // A stop-and-go wave: the speed falls to `cruise − drop` and returns, once per period.
  return Math.max(
    0,
    cruiseMps - (forcing.speedDropMps / 2) * (1 - Math.cos(phase)),
  )
}

/**
 * Read an array element, refusing an out-of-range index.
 *
 * The loop below indexes fixed-size per-vehicle tables with the vehicle's own position, so
 * every read is in range by construction — but "by construction" is exactly the claim the
 * previous version wrote as `!`, which the compiler accepts and the linter forbids. This makes
 * the bound explicit and says what a violation would mean.
 *
 * @param list - the table to read.
 * @param index - the per-vehicle index.
 * @returns the element.
 * @throws {Error} when the index is out of range, which is a bug in this module, not in a call.
 */
function at<T>(list: ReadonlyArray<T>, index: number): T {
  const value = list[index]
  if (value === undefined) {
    throw new Error(
      `[platoon-sim] internal index ${String(index)} is out of range (length ${String(list.length)})`,
    )
  }
  return value
}

/** One vehicle's state at one instant, for the delay buffer. */
interface VehicleState {
  readonly position: number
  readonly speed: number
  readonly acceleration: number
}

/** Time-to-collision from one follower to its leader, or Infinity when it is not closing. */
function timeToCollision(follower: VehicleState, leader: VehicleState): number {
  const gap =
    leader.position - follower.position - SIMULATION_INPUTS.vehicleLengthM
  const closingSpeed = follower.speed - leader.speed
  if (!(closingSpeed > 0)) return Number.POSITIVE_INFINITY
  if (!(gap > 0)) return 0
  return gap / closingSpeed
}

/**
 * Extrapolate one vehicle's state forward by `seconds`.
 *
 * This is what a vehicle that PREDICTS its leader does: it takes the state it can see — which,
 * for a vehicle with a reaction delay, is a state from the past — and projects it forward over
 * the horizon it looks ahead by. Constant-acceleration extrapolation, the same second-order form
 * a driver's anticipation is usually modelled with.
 *
 * @param state - the state as observed.
 * @param seconds - how far forward to project it.
 * @returns the projected state.
 */
function extrapolate(state: VehicleState, seconds: number): VehicleState {
  if (seconds <= 0) return state
  return {
    position:
      state.position +
      state.speed * seconds +
      0.5 * state.acceleration * seconds ** 2,
    speed: Math.max(0, state.speed + state.acceleration * seconds),
    acceleration: state.acceleration,
  }
}

/** Run one platoon and measure it. Pure: same scenario in, same numbers out. */
export function runPlatoon(scenario: PlatoonScenario): PlatoonResult {
  const { stepSeconds, warmupSeconds, measurementSeconds } = SIMULATION_INPUTS
  const {
    vehicleLengthM,
    maxAccelerationMps2,
    comfortableDecelerationMps2,
    accelerationExponent,
    minimumGapM,
  } = SIMULATION_INPUTS
  const count = scenario.composition.length
  if (count < 2) {
    throw new Error(
      `[platoon-sim] a platoon needs at least a leader and one follower, got ${String(count)}`,
    )
  }
  const classes = scenario.composition.map(id => scenario.vehicleClasses[id])
  const maxDelay = Math.max(
    ...classes.map(klass => klass.reactionDelaySeconds),
  )
  const bufferSteps = Math.max(1, Math.ceil(maxDelay / stepSeconds) + 1)

  // Positions increase along the direction of travel, so the leader is the LARGEST x.
  let states: VehicleState[] = scenario.composition.map((_, index) => ({
    position: -index * (scenario.initialGapM + vehicleLengthM),
    speed: scenario.initialSpeedMps,
    acceleration: 0,
  }))
  /** Ring buffer of every vehicle's state, newest last. Index -1 is the present. */
  const history: Array<ReadonlyArray<VehicleState>> = [
    states.map(s => ({ ...s })),
  ]

  const totalSteps = Math.round(
    (warmupSeconds + measurementSeconds) / stepSeconds,
  )
  const startStep = Math.round(warmupSeconds / stepSeconds)

  let minTtc = Number.POSITIVE_INFINITY
  let riskySamples = 0
  let samples = 0
  let headwaySum = 0
  let headwaySamples = 0
  let jerkSum = 0
  let collisions = 0
  const minGap = new Array<number>(count).fill(Number.POSITIVE_INFINITY)
  const speedMin = new Array<number>(count).fill(Number.POSITIVE_INFINITY)
  const speedMax = new Array<number>(count).fill(Number.NEGATIVE_INFINITY)

  for (let step = 0; step < totalSteps; step++) {
    const time = step * stepSeconds
    const previous = states
    const next: VehicleState[] = []
    // The leader's speed is IMPOSED; every follower's is computed.
    const leaderSpeed = leaderSpeedAt(
      scenario.leader,
      scenario.initialSpeedMps,
      time,
    )
    next.push({
      position: at(previous, 0).position + leaderSpeed * stepSeconds,
      speed: leaderSpeed,
      acceleration: at(previous, 0).acceleration,
    })

    for (let index = 1; index < count; index++) {
      const klass = at(classes, index)
      const me = at(previous, index)
      // TWO INDEPENDENT MECHANISMS, and they are separate on purpose.
      //
      // (1) The REACTION DELAY: the leader's state as it was `reactionDelaySeconds` ago, read out
      //     of the ring buffer. This is the buffer's whole purpose.
      // (2) The LOOK-AHEAD: that observed state is then extrapolated FORWARD by the vehicle's
      //     horizon, which is what predicting a leader's motion means.
      //
      // They were previously one thing. The horizon was SUBTRACTED from the delay
      // (`max(0, reactionDelay - horizon)`), so with the AV's declared 0.15 s of each the model
      // simply had no delay at all — two "separable mechanisms" that were two points on one
      // scalar. An audit proved it by showing `{reaction: 0.15, horizon: 0.15}` and
      // `{reaction: 1.2, horizon: 1.2}` producing bit-identical trajectories, which also meant the
      // Method section's claim that the AV "predicts its leader over a 0.15 s horizon" described
      // nothing the simulation did.
      const lagSteps = Math.round(klass.reactionDelaySeconds / stepSeconds)
      const bufferIndex = Math.max(0, history.length - 1 - lagSteps)
      const observed = at(at(history, bufferIndex), index - 1)
      const lead = extrapolate(observed, klass.lookAheadHorizonSeconds)

      const gap = lead.position - me.position - vehicleLengthM
      const approachSpeed = me.speed - lead.speed
      const desiredGap =
        minimumGapM +
        Math.max(
          0,
          me.speed * klass.desiredHeadwaySeconds +
            (me.speed * approachSpeed) /
              (2 *
                Math.sqrt(maxAccelerationMps2 * comfortableDecelerationMps2)),
        )
      const freeFlow =
        1 - (me.speed / scenario.desiredSpeedMps) ** accelerationExponent
      const interaction = (desiredGap / Math.max(gap, 0.01)) ** 2
      const wanted = maxAccelerationMps2 * (freeFlow - interaction)
      const acceleration = Math.max(
        -klass.maxDecelerationMps2,
        Math.min(maxAccelerationMps2, wanted),
      )
      const speed = Math.max(0, me.speed + acceleration * stepSeconds)
      next.push({
        position: me.position + speed * stepSeconds,
        speed,
        acceleration,
      })
    }

    states = next
    history.push(next.map(s => ({ ...s })))
    if (history.length > bufferSteps + 1) history.shift()

    if (step < startStep) continue

    for (let index = 0; index < count; index++) {
      speedMin[index] = Math.min(at(speedMin, index), at(next, index).speed)
      speedMax[index] = Math.max(at(speedMax, index), at(next, index).speed)
    }
    for (let index = 1; index < count; index++) {
      const follow = at(next, index)
      const lead = at(next, index - 1)
      const gap = lead.position - follow.position - vehicleLengthM
      const ttc = timeToCollision(follow, lead)
      if (ttc < minTtc) minTtc = ttc
      if (ttc < SIMULATION_INPUTS.ttcThresholdSeconds) riskySamples++
      if (gap < 0) collisions++
      minGap[index] = Math.min(at(minGap, index), gap)
      samples++
      if (follow.speed > 0) {
        headwaySum += gap / follow.speed
        headwaySamples++
      }
      // Jerk is the change of acceleration between consecutive steps, so it needs the
      // PREVIOUS state — reading `next` here would difference a value against itself and
      // report a flat zero, which is exactly what the first version of this loop did.
      jerkSum +=
        Math.abs(follow.acceleration - at(previous, index).acceleration) /
        stepSeconds
    }
  }

  const amplitude = (index: number): number =>
    (at(speedMax, index) - at(speedMin, index)) / 2
  const leaderAmplitude = amplitude(0)
  const lastAmplitude = amplitude(count - 1)
  const stringStabilityIndex =
    leaderAmplitude > 0 ? 1 - lastAmplitude / leaderAmplitude : 0

  return {
    composition: scenario.composition,
    vehicles: scenario.composition.map((vehicleClass, index) => ({
      position: index,
      vehicleClass,
      speedAmplitudeMps: amplitude(index),
      minimumGapM:
        minGap[index] === Number.POSITIVE_INFINITY ? 0 : at(minGap, index),
    })),
    minTtcSeconds: Number.isFinite(minTtc) ? minTtc : Number.POSITIVE_INFINITY,
    ttcLt1_5RatePct: samples > 0 ? (riskySamples / samples) * 100 : 0,
    meanTimeHeadwaySeconds:
      headwaySamples > 0 ? headwaySum / headwaySamples : 0,
    meanJerkMps3: samples > 0 ? jerkSum / samples : 0,
    stringStabilityIndex,
    stringStable: stringStabilityIndex >= 0,
    collisions,
    samples,
  }
}

/**
 * Run both platoons of a study and compare them in the declared direction.
 *
 * @param study - the baseline and variant scenarios.
 * @returns both measurements plus the relative improvement of the variant.
 */
export function comparePlatoons(study: PlatoonStudy): PlatoonComparison {
  const baseline = runPlatoon(study.baseline)
  const variant = runPlatoon(study.variant)
  const base = baseline.minTtcSeconds
  // A comparison needs a positive, finite baseline. A platoon that never closed on its
  // leader has no measurable minimum, and dividing by it would turn "nothing to compare"
  // into "no improvement" — two different facts. `isComparable` keeps them apart and the
  // C channel refuses to grade an incomparable measurement.
  // A COLLISION IS NOT A SMALL NUMBER, IT IS A BROKEN PREMISE. When two vehicles occupy the same
  // space the platoon stopped following, and every quantity read off those trajectories — the
  // min-TTC, the headway, the comparison itself — describes a failed run rather than a risky one.
  // Reporting it as a comparison produced `improvementPct: -100.00` and `isComparable: true`, so a
  // step C gate could pass on 5138 vehicle-seconds of collision. `collisions` was computed and read
  // by NOTHING in the tree; an audit found that. It refuses the comparison instead.
  const collided = baseline.collisions > 0 || variant.collisions > 0
  const isComparable =
    !collided &&
    Number.isFinite(base) &&
    base > 0 &&
    Number.isFinite(variant.minTtcSeconds)
  const forward = MEASURED_METRIC_DIRECTION === 'higher-is-better' ? 1 : -1
  const relativeImprovementPct = isComparable
    ? ((forward * (variant.minTtcSeconds - base)) / base) * 100
    : 0
  return {
    baseline,
    variant,
    isComparable,
    relativeImprovementPct,
    meetsThreshold: (thresholdPct: number) =>
      isComparable && relativeImprovementPct >= thresholdPct,
  }
}

/**
 * What a claim commits the study to — DECLARED, not read out of prose.
 *
 * WHY THIS IS A DECLARED FIELD. It was inferred from the prediction's words, and three rounds of
 * independent audit dismantled that reader one mechanism at a time, each time on the shipped study:
 *
 *   - a fixed comparison direction graded "shall FALL by 20%" backwards, so a measurement that
 *     satisfied the prediction was recorded as negating it, and this batch's `decisive` flag then
 *     advanced the step on that wrong conclusion;
 *   - the fix introduced a false POSITIVE — "shall NOT FALL BY MORE THAN 20%" was read as a floor,
 *     and a 38.20% fall "cleared" a 20% cap it plainly violates;
 *   - the cap was located by a character window, so `under` as an ordinary preposition ("shall
 *     increase under steady free flow by at least 20%") turned a floor into a cap and flipped the
 *     verdict — and adding "the same" to that sentence pushed the word out of the window and flipped
 *     it back;
 *   - cap phrasings outside the list ("by up to N%", "capped at") were read as floors;
 *   - the negation check matched substrings, so `no` inside `normal` or `nonlinear` held a perfectly
 *     gradeable prediction;
 *   - the clause carrying the threshold was located by digit substring, so a year in the sentence
 *     ("reported in 2020") became the carrier and the direction was read from the wrong clause.
 *
 * Every one of those is a way for a WORD TEST to decide a scientific verdict, and the auditor's
 * conclusion was that the reader could not be trusted and should be replaced by something narrower.
 * This is it: the claim DECLARES which way its quantity should move, and the gate grades that
 * declaration. Nothing about the verdict depends on parsing prose.
 *
 * WHAT THE PROSE IS STILL USED FOR, and the limits of each: it must NAME the measured quantity (a
 * keyword check, necessary and not sufficient — a claim can still name a quantity in passing), and
 * it must STATE the threshold (the first `\d+%` in it, which is unambiguous). Neither decides a
 * direction.
 *
 * A claim that declares no commitment HOLDS. That is the same fail-closed answer an unstated metric
 * key gets, and it is the same demand: a study has to say what it is testing.
 */
export type PredictionDirection = 'increase' | 'decrease'

export interface PredictionCommitment {
  /** Which way the claim says the measured quantity should move. */
  readonly direction: 'increase' | 'decrease'
  /**
   * How the stated threshold relates to the change.
   *
   * THREE VALUES, not a boolean, and the third is why. `bounded: boolean` could express "at least"
   * and "at most" and nothing else, so a claim with a TWO-SIDED tolerance — "shall stay within 20%
   * of the baseline" — had to be declared as one of them, and an audit showed the result: declared
   * `at most`, measured a 38.20% fall, graded `-38.20 <= 20` → SUPPORTED, for a claim a 38% fall
   * plainly violates. The declaration was HONEST and the model could not express it. That is the
   * only one of the audit's boundaries that produced a false positive on its own.
   *
   *   at-least : met when the change in `direction` is `>= threshold`  ("by at least 20%")
   *   at-most  : met when it is `<= threshold`                          ("by no more than 20%")
   *   within   : met when `|change| <= threshold`                       ("within 20%")
   *
   * `direction` IS A SIGN HERE, NOT A REQUIREMENT, and the three lines above are the whole of what
   * is graded. `at-most` and `within` compare a signed or an absolute value, so a change in the
   * OPPOSITE direction can satisfy the bound, and the prose is still REQUIRED to state a direction
   * word that the verdict then does not read. Measured by an audit on one −38.20% measurement:
   * declared `{increase, at-most, 20}` grades `supportsPrediction: true`, and under `within` the
   * direction word has no effect at all — "shall rise within 40%" and "shall fall within 40%" grade
   * identically. A claim that means "shall increase by at most 20%" cannot be expressed here; the
   * recording of that is this paragraph, not an implementation.
   */
  readonly bound: 'at-least' | 'at-most' | 'within'
  /**
   * The percentage the claim commits the measured quantity to move by.
   *
   * THE THIRD DECLARED FIELD, and the last one this gate needed. The threshold used to be PARSED
   * from the sentence, and a sentence can state a percentage that belongs to a different quantity:
   * with the declaration held fixed and only the prose number changed, the verdict flipped (5% and
   * 20% supported, 99% refuted), so the gate was grading a threshold the claim had never put on the
   * quantity it is about. Declaring it takes the prose out of the verdict; the prose still has to
   * state this number, and `evaluatePrediction` says why that check survives and what it is worth.
   */
  readonly thresholdPct: number
}

/**
 * The literal an anchor's text uses, and the bound it asserts.
 *
 * WHY A LITERAL AND NOT A READING. The gate grades three declared fields — direction, bound and
 * threshold — and nothing tied them to the claim's sentence — an audit demonstrated that changing
 * ONE declared field records a claim its own sentence refutes as supported, with no wordplay.
 * Its proposed fix is this: require the sentence to carry a MACHINE-READABLE anchor beside the
 * number, and compare the declared bound to that token by STRING EQUALITY. That is wire-format
 * validation, not reading: there is no heuristic here, only whether one string equals another.
 *
 * The cost is one fixture edit — the pack's sentence says "by at least 20%" and now says "≥ 20%" —
 * and the gain is that a declaration contradicting the claim's own words stops being invisible.
 */
const ANCHOR_TOKENS: ReadonlyArray<{
  readonly text: string
  readonly bound: PredictionCommitment['bound']
}> = [
  { text: '>=', bound: 'at-least' },
  { text: '≥', bound: 'at-least' },
  { text: 'at least', bound: 'at-least' },
  { text: '<=', bound: 'at-most' },
  { text: '≤', bound: 'at-most' },
  { text: 'at most', bound: 'at-most' },
  { text: 'within', bound: 'within' },
]

/**
 * Words whose presence makes a prediction UNGRADEABLE, whatever else it says.
 *
 * THE FALSE POSITIVE THIS CLOSES, and an auditor built it after I claimed the opposite. The
 * direction and bound anchors compare WORDS to a declaration, and a word test cannot see a
 * sentence's POLARITY:
 *
 *   "The insertion of one AV shall NOT cause the platoon minimum time-to-collision to FALL by
 *    ≥ 20% relative to the all-HV baseline."
 *
 * That is a PROHIBITION, and a 38.20% fall violates it. But `fall` reads as `decrease`, `≥` reads
 * as `at-least`, and BOTH agree with a declaration of `{direction: 'decrease', bound: 'at-least'}`
 * — so the gate graded the prohibition as a requirement and reported `supported`. A prohibition and
 * a requirement share the same number and the same comparison operator; only the sentence's force
 * differs, and nothing in this model carries force.
 *
 * So a negation stops the grading instead of being interpreted. It can only produce a HOLD, never
 * a verdict, which is the property the previous claim lacked — the claim was that a mismatch could
 * only make the gate stricter, and this counterexample is what refuted it.
 *
 * The word boundaries also close the reported `no`-inside-`normal` and `not`-inside-`note`
 * substring problem, which a bare `includes` had.
 *
 * THE CONSEQUENCE, stated rather than discovered: the cap anchors written as negations
 * (`no more than`, `not exceed`) are no longer reachable and are gone from the table. A claim has
 * to be a POSITIVE directional statement — "shall rise by at most 20%", not "shall not exceed
 * 20%" — and a prohibition cannot be written in the GRADED path. Two forms carry no listed
 * negation word and still reach a verdict; they are recorded under `anchorForms.prohibitionLimits`
 * on the claim artifact rather than left to be rediscovered.
 */
const POLARITY_WORDS = /\b(?:not|no|never|without)\b|n['’]t/iu

/**
 * Whether a prediction carries a negation, read over the WHOLE sentence.
 *
 * The C gate holds on this, and the red team abstains on the same condition, so both read it from
 * here rather than keeping a second copy of the word list. Scoping it to the clause that names the
 * measured quantity was tried and refuted: a prohibition keeps the required shape inside that clause
 * ("…shall fall by at least 20%") and can put its negation anywhere else, which reached a verdict of
 * SUPPORTED on a measured 38.20% fall. See `POLARITY_WORDS` for the word list, and
 * `evaluatePrediction` for the honest sentences this whole-sentence read refuses.
 *
 * @param predictionText - the falsifiable prediction, whole.
 * @returns true when any listed negation word appears in it.
 */
export function carriesNegation(predictionText: string): boolean {
  return POLARITY_WORDS.test(predictionText)
}

/**
 * The shape a prediction must have for its direction to be gradeable: `shall <direction word>`.
 *
 * WHY A SHAPE, NOT A LONGER LIST. The guard above is a BLACKLIST, and an auditor showed it cannot
 * be complete: it folded no case, so `Not fall` and `NOT FALL` walked past it — an emphasised
 * prohibition ran the pipeline to a `supported` verdict while the lower-case form was held. Fixing
 * the case left what that auditor then pointed at: "shall REFRAIN FROM falling by at least 20%" is
 * a prohibition with no word on any list, and no list enumerates every way English forbids
 * something.
 *
 * So the polarity is not DETECTED, it is REQUIRED: the direction word must come immediately after
 * `shall`. `shall not fall`, `shall never fall` and `shall refrain from falling` fail the shape and
 * are HELD. It is a wire format, checkable by string comparison, and it needs no understanding of
 * the sentence.
 *
 * THE JUSTIFICATION I FIRST WROTE FOR THIS WAS WRONG, and an auditor refuted it by answering the
 * question I had set it: I claimed a prohibition "has to negate and the negation would occupy that
 * position", so no prohibition could satisfy the shape. English can negate the SUBJECT instead, and
 * then the direction word still follows `shall`:
 *
 *   "Neither platoon shall fall short of the baseline minimum time-to-collision by at least 20%."
 *
 * That is a prohibition, `fall` follows `shall`, no word on the negation list appears, and the
 * declared commitment agrees — so a 38.20% fall was graded as MEETING it. A prohibition APPENDED as
 * a second clause ("…; that outcome is forbidden") evades the shape the same way.
 *
 * These two are KNOWN LIMITS, not open work, and the auditor's reasoning is why: this is a check on
 * the SHAPE of a sentence, not an analysis of its polarity, and extending the word list for
 * `neither` / `nor` / `none` would repeat the mistake the list was abandoned for. What must be
 * right is the STATEMENT, not the mechanism — so the two shapes are recorded here, beside the cost,
 * where the next reader finds them instead of rediscovering them.
 *
 * WHY IT IS STILL WORTH HAVING. Every failure of this check produces a HOLD: a missing direction
 * word, a wrong inflection, an unexpected phrasing, a negated subject — all stop the C channel
 * without a verdict. It cannot hand out a pass for a sentence it failed to understand; the only
 * escapes are the two shapes above, which need a claim deliberately written as a prohibition in
 * one of those two forms. That is a much narrower failure than the reader this batch deleted, whose
 * errors reached a `supports` value from ordinary phrasing.
 *
 * THE COST, stated: a claim reads "<subject> shall <rise|fall|…> … by <anchor> <n>%". Every claim in
 * this repository is written that way; one that is not holds, which is the safe direction, and the
 * hold names the required form.
 */
const REQUIREMENT_SHAPE = /\bshall\s+([a-z]+)/iu


/**
 * The words that commit a prediction to a direction, and which one.
 *
 * THE SYMMETRIC HALF OF THE ANCHOR, and both auditors reached it independently: the anchor bound
 * the THRESHOLD but not the DIRECTION, so a claim whose sentence says the quantity rises could
 * declare `decrease` and be graded as a fall. One auditor ran it end to end — a pack declaring
 * `{direction: 'decrease', bound: 'at-least'}` against the sentence "shall exceed … by ≥ 20%"
 * returned `supports: true` and `verdict: supported` on a measurement of −38.20%. That is the same
 * class as the truthfulness pair the loader now refuses, in the same file, describing the same
 * material.
 *
 * WHAT THIS CAN AND CANNOT DO, corrected. I wrote here that every outcome of this check was either
 * agreement or a HOLD, "so a false match can only make the gate stricter, never hand out a pass" —
 * and an auditor refuted it: a PROHIBITION whose words agree with the declaration was graded as a
 * requirement and PASSED. The claim was false, and the counterexample is recorded at
 * `POLARITY_WORDS` where the guard against it lives.
 *
 * What survives is narrower and is the reason this check is still worth having: it verifies the
 * declaration against the claim's own words, and a disagreement holds. It does NOT establish what
 * the sentence means, and it cannot.
 */
const DIRECTION_TOKENS: ReadonlyArray<{ readonly text: string; readonly direction: PredictionDirection }> = [
  // BASE FORMS ONLY. `shall` takes the infinitive, so a third-person or participle entry can
  // never match the word that follows it: the first version of this table held 18 entries of which
  // 12 (`exceeds`, `rising`, `falls`, `decreases`, …) were unreachable, implying a coverage the
  // gate does not have. An auditor counted them. What remains is what `shall <word>` can actually
  // produce, plus three base forms that were MISSING while their inflected forms sat in the table
  // — `shall reduce`, `shall raise` and `shall drop` all held, and `reduces` was useless.
  { text: 'exceed', direction: 'increase' },
  { text: 'rise', direction: 'increase' },
  { text: 'increase', direction: 'increase' },
  { text: 'grow', direction: 'increase' },
  { text: 'raise', direction: 'increase' },
  { text: 'fall', direction: 'decrease' },
  { text: 'decrease', direction: 'decrease' },
  { text: 'lower', direction: 'decrease' },
  { text: 'reduce', direction: 'decrease' },
  { text: 'drop', direction: 'decrease' },
]

/**
 * The direction the prediction commits to, read from the `shall <word>` position.
 *
 * Searching the whole sentence for a direction word was not enough: an auditor's prohibition
 * ("shall NOT cause the … to FALL by ≥ 20%") contains `fall` and agrees with a `decrease`
 * declaration, so it was graded as a requirement and passed. Reading the word that FOLLOWS `shall`
 * is what makes the difference, because a prohibition's negation occupies that position.
 *
 * @param predictionText - the prediction as written.
 * @returns the direction, or undefined when the sentence does not state one after `shall`.
 */
export function requirementDirectionIn(predictionText: string): PredictionDirection | undefined {
  const match = REQUIREMENT_SHAPE.exec(predictionText)
  if (match === null) return undefined
  const word = match[1]?.toLowerCase()
  return DIRECTION_TOKENS.find(token => token.text === word)?.direction
}

/**
 * The anchor the prediction states beside its threshold, if it states one.
 *
 * The anchor must sit NEAR the number — the twenty characters before it — because an anchor
 * elsewhere in the sentence is not the one the threshold is bound by.
 *
 * @param predictionText - the prediction as written.
 * @param thresholdPct - the percentage the prediction states.
 * @returns the bound the anchor asserts, or undefined when no anchor is beside the number.
 */
export function anchorBoundIn(clause: string): PredictionCommitment['bound'] | undefined {
  const lowered = clause.toLowerCase()
  const found = ANCHOR_TOKENS.filter(token => lowered.includes(token.text))
  const distinct = new Set(found.map(token => token.bound))
  // MORE THAN ONE DISTINCT BOUND IS A GAP, NOT A GUESS. The previous version took the first hit by
  // TABLE ORDER inside a 20-character window, so "…by at most, at least 20%" resolved by array
  // position rather than by anything the sentence said. Requiring uniqueness removes that and the
  // character cliff that pushed a correct anchor out of the window ("by at least an additional
  // 20%" held). Both failure directions are HOLD.
  return distinct.size === 1 ? [...distinct][0] : undefined
}

/**
 * Every distinct percentage the prediction states, in order.
 *
 * The verdict does not grade any of them — the threshold is DECLARED. What this supports is the
 * consistency check: the sentence must state the declared number, exactly once. "Over 20% of the
 * simulated interval, the … shall exceed the baseline by at least 35%" states two, so which one the
 * claim meant is a guess, and a guess is a HOLD.
 *
 * @param predictionText - the prediction as written.
 * @returns the percentages, in the order they appear.
 */
export function percentagesIn(predictionText: string): ReadonlyArray<number> {
  return [...predictionText.matchAll(/(\d+(?:\.\d+)?)\s*%/gu)].map(match =>
    Number(match[1]),
  )
}

/**
 * Where one clause ends and the next begins.
 *
 * Punctuation, plus the conjunctions that introduce a new clause. A period between digits is not a
 * boundary, so a decimal or a version is not mistaken for a sentence break.
 */
const CLAUSE_BOUNDARY = /[;,]|(?<!\d)\.(?!\d)|\b(?:while|whereas|because|although|and|but)\b/iu

/**
 * The clause of a prediction that names the quantity this study measures.
 *
 * WHAT THIS IS FOR NOW — scope, not soundness. The anchor, the direction word and the percentage are
 * read from this clause, and NOT from the whole sentence, because a sentence's second clause may
 * legitimately carry its own number or anchor: read over the whole prediction, "…shall fall by at
 * least 20%, and the headway stays within its band" states two anchors and holds, and "…shall rise
 * while the minimum time-to-collision shall fall by at least 20%" is refused for the direction of
 * the WRONG clause. An independent audit measured all three of those as new false refusals of
 * honest sentences, and they are why this function survived.
 *
 * WHAT IT IS NOT. It is not a claim that a literal inside this clause is ABOUT this quantity, and
 * the module no longer makes that claim. Four measured attempts to establish where a number
 * attaches — a wider boundary table, requiring the phrase before the direction structure, requiring
 * it to be an argument of the predicate, and narrowing to one template — all died on the same
 * thing: the distinguishing material is predicate structure, and every literal proxy for it is an
 * open class. `whilst` and `though` are synonyms of two listed boundaries and split nothing; a
 * participial adjunct needs no connective at all; and "…shall lower the platoon minimum
 * time-to-collision thereby reducing the platoon mean headway by at least 20%" is an argument AND
 * binds its number elsewhere.
 *
 * So clause splitting is a heuristic and can cut in the wrong place. When it cuts too finely the
 * literals land in different segments and the result is a HOLD; when it does not cut at all, the
 * number the prose states is still required to EQUAL the declared threshold, and the verdict grades
 * the declaration rather than any number read from the sentence. Both failure directions stop short
 * of the verdict. `PredictionCommitment.thresholdPct` is where the graded number comes from.
 *
 * @param predictionText - the prediction as written.
 * @param metricKey - the quantity the claim declared.
 * @returns the clause naming it, or undefined when no clause does.
 */
export function measuringClause(predictionText: string, metricKey: string): string | undefined {
  const phrases = METRIC_PHRASES[metricKey]
  if (phrases === undefined) return undefined
  return predictionText
    .split(CLAUSE_BOUNDARY)
    .map(part => part.trim())
    .find((part) => {
      const lowered = part.toLowerCase()
      return phrases.some(phrase => lowered.includes(phrase))
    })
}

/**
 * The phrasing a claim about `metricKey` uses, if it uses one.
 *
 * @param text - the claim's PREDICTION, as written.
 * @param metricKey - the key the claim declares.
 * @returns the matched phrase, or undefined when the text names no phrasing of that quantity.
 */
export function claimTextNamesQuantity(
  text: string,
  metricKey: string,
): string | undefined {
  const phrases = METRIC_PHRASES[metricKey]
  if (phrases === undefined) return undefined
  const lowered = text.toLowerCase()
  return phrases.find(phrase => lowered.includes(phrase))
}

/**
 * Run the experiment and adjudicate one prediction against it.
 *
 * This is the single source the C1 executor and the C gate both consume, so the artifact
 * and the verdict can never disagree: they are the same measurement.
 *
 * @param predictionText - the claim's falsifiable prediction.
 * @param study - the study to run; defaults to the study's own scenarios.
 * @param metricKey - the quantity the claim declares.
 * @returns the verdict, or why the prediction could not be adjudicated.
 */
export function evaluatePrediction(
  predictionText: string,
  study: PlatoonStudy = experimentStudy(),
  metricKey?: string,
  commitment?: PredictionCommitment,
): PredictionAdjudication {
  // The binding is checked FIRST. A prediction about a quantity this study does not measure
  // cannot be adjudicated however many percentages it states, and grading it would report an
  // untested claim as supported or refuted.
  if (
    metricKey === undefined ||
    metricKey === '' ||
    metricKey !== MEASURED_METRIC_KEY
  ) {
    return {
      kind: 'unbindable',
      reason:
        metricKey === undefined || metricKey === ''
          ? `the claim declares no metric, so nothing binds it to the quantity this study measures (${MEASURED_METRIC_LABEL})`
          : `the claim is about "${metricKey}" while this study measures "${MEASURED_METRIC_KEY}" (${MEASURED_METRIC_LABEL}), so the measurement cannot adjudicate it`,
    }
  }
  const matched = claimTextNamesQuantity(predictionText, metricKey)
  if (matched === undefined) {
    return {
      kind: 'unbindable',
      reason:
        `the claim declares the metric "${metricKey}" but the prediction it commits to does not name ` +
        `that quantity (no phrasing of ${MEASURED_METRIC_LABEL} appears in it), so the declaration ` +
        'is unverified and the measurement cannot adjudicate it',
    }
  }
  // The literals are read from the clause naming the measured quantity, not from the whole
  // sentence: a second clause may legitimately carry its own number or anchor, and an audit measured
  // three honest sentences that a whole-sentence read refuses. See `measuringClause` for what this
  // scoping is and, more importantly, what it is NOT — the verdict grades the declaration, so a
  // number the prose attached elsewhere no longer reaches it.
  const clause = measuringClause(predictionText, metricKey)
  if (clause === undefined) {
    // UNREACHABLE AS THE TWO TABLES STAND, and kept for when that stops being true. The check
    // above matched a phrase from the same closed table this call searches, and no phrase contains
    // a CLAUSE_BOUNDARY match, so the split cannot cut the matched phrase in two — measured: 0 of 9
    // phrases are splittable, and a 66-text sweep found no text where the two disagree. It stays
    // because the phrase table and the boundary table are edited independently: a phrase that ever
    // gains a boundary word makes this call return undefined, and without the branch the caller
    // would throw on `percentagesIn(undefined)` instead of HOLDING. The spec pins the table.
    return {
      kind: 'unbindable',
      reason:
        `the measurement cannot adjudicate the prediction: no clause of it names ${MEASURED_METRIC_LABEL}`,
    }
  }

  // The commitment is DECLARED, not inferred. See `PredictionCommitment` for why the inference was
  // removed rather than narrowed again.
  if (commitment === undefined) {
    return {
      kind: 'unbindable',
      reason:
        `the claim is about ${MEASURED_METRIC_LABEL} and states a threshold, but declares no ` +
        'commitment, so nothing says which way the quantity is supposed to move — a study has to ' +
        'state what it is testing, exactly as it has to declare the quantity itself',
    }
  }
  const { direction, bound, thresholdPct } = commitment
  // The prose must STATE the declared threshold, exactly once. This is an equality between two
  // values, not a reading of the sentence — which is why it survives the deletion above. It can see
  // that the number the claim wrote is the number the claim declared; it cannot see which quantity
  // that number was written about, and after four measured attempts neither can any literal rule.
  // A prose number that differs contradicts the declaration; none at all means the claim never
  // committed in writing.
  const statedPercentages = percentagesIn(clause)
  // The declared number as the sentence may state it. A commitment that reached here without one
  // would otherwise be described as "a threshold of undefined%" — a sentence about a number the run
  // never had. The parameter type says that cannot happen; this is what the message reads if a value
  // off the durable boundary ever gets past the reader that validates it.
  // The predicate is the DOORS' own (`typeof === number && Number.isFinite && > 0`), not a weaker
  // `typeof` alone: NaN and Infinity are exactly "a value off the durable boundary", and a bare
  // typeof check would render them as "a threshold of NaN%" — the sentence this exists to remove.
  // A finite non-positive number is printed as itself; it is a number the claim did declare.
  const declaredThreshold =
    typeof thresholdPct === 'number' && Number.isFinite(thresholdPct)
      ? `${String(thresholdPct)}%`
      : 'no usable threshold'
  if (statedPercentages.length !== 1 || statedPercentages[0] !== thresholdPct) {
    return {
      kind: 'unbindable',
      reason:
        `the claim declares ${declaredThreshold}, while its own prediction states `
        + `${statedPercentages.length === 0 ? 'none' : `${statedPercentages.map(String).join(', ')}%`} `
        + '— the declaration and the sentence contradict each other, so the claim is not gradeable as stated',
    }
  }
  // POLARITY FIRST. A negation makes the sentence ungradeable whatever its words say, because the
  // model cannot tell a prohibition from a requirement — see `POLARITY_WORDS` for the counterexample
  // that refuted the previous claim that a mismatched anchor could only ever be stricter.
  // NOT SCOPED TO THE CLAUSE, and that was measured rather than assumed. Reading this over the
  // clause alone was tried, to admit a negation in a SECOND clause ("…shall rise by at least 20%,
  // and the mean headway must not exceed its band"). An audit refuted it with three shapes — the
  // negation BEFORE the measuring clause, AFTER a semicolon, and in a TRAILING clause — where the
  // prohibition kept its required shape inside the clause and the gate reported
  // `supportsPrediction: true` on a measured 38.20% FALL. A whole-sentence read refuses those
  // honest sentences too, and that is the correct direction: a false refusal is a HOLD the author
  // fixes by writing positively, while a false pass publishes a refuted claim as supported.
  if (carriesNegation(predictionText)) {
    return {
      kind: 'unbindable',
      reason:
        'the prediction contains a negation, so whether it states a requirement or a PROHIBITION '
        + 'cannot be read from it — this model can only grade a positive statement of the direction '
        + 'the quantity should move',
    }
  }

  // The declaration must agree with the claim's OWN anchor literal, compared as strings. This is
  // the wire-format check an audit proposed in place of reading the sentence: it needs no
  // comprehension, and a mismatch is a positive contradiction — the same class as a declared
  // metric that disagrees with the measured one — so the claim is not gradeable as stated.
  const anchorBound = anchorBoundIn(clause)
  if (anchorBound === undefined) {
    return {
      kind: 'unbindable',
      reason:
        'the prediction carries no anchor, or carries more than one '
        + `(accepted: ${ANCHOR_TOKENS.map(token => token.text).join(', ')}), so nothing in the claim's `
        + 'own words says how the number relates to the change',
    }
  }
  if (anchorBound !== bound) {
    return {
      kind: 'unbindable',
      reason:
        `the claim declares bound "${bound}" while its own prediction anchors the threshold with ` +
        `"${anchorBound}" — the declaration and the sentence contradict each other, so the claim is ` +
        'not gradeable as stated',
    }
  }
  // ...and the DIRECTION must agree with the sentence too. Absent or ambiguous is a gap; a
  // disagreement is the contradiction. Neither can produce a verdict, which is the property that
  // separates this from the reader this batch deleted.
  const namedDirection = requirementDirectionIn(clause)
  if (namedDirection === undefined) {
    return {
      kind: 'unbindable',
      reason:
        'the prediction does not state its direction in the required form ("shall rise", "shall '
        + 'fall" and the other direction words), so whether it requires a change or PROHIBITS one '
        + 'cannot be read from it — a claim has to be a positive statement',
    }
  }
  if (namedDirection !== direction) {
    return {
      kind: 'unbindable',
      reason:
        `the claim declares direction "${direction}" while its own prediction says the quantity ` +
        `should ${namedDirection} — the declaration and the sentence contradict each other, so the ` +
        'claim is not gradeable as stated',
    }
  }

  // THE MEASUREMENT IS COMPARED LAST, AFTER EVERY CLAIM-LEVEL CHECK. Two reasons, and the second
  // is the one that matters: it costs two full IDM runs, and it is the only check here whose defect
  // is not the claim's. A sentence that declares no commitment, or contradicts its own declaration,
  // is ungradeable whatever the experiment did — the same principle the metric-binding check states
  // at the top of this function ("cannot be adjudicated however many percentages it states").
  // Running the comparison first let a collision MASK those defects: measured against the colliding
  // fixture in the specs, all three wording defects reported the collision instead.
  const comparison = comparePlatoons(study)
  if (!comparison.isComparable) {
    // Fail-closed: a platoon that never closed on its leader has no minimum
    // time-to-collision, so there is no ratio to test the threshold against. Grading it
    // would report "the prediction was refuted" for a measurement that never happened.
    const collisionCount =
      comparison.baseline.collisions + comparison.variant.collisions
    return {
      kind: 'unbindable',
      reason:
        collisionCount > 0
          ? `the simulation produced ${String(collisionCount)} vehicle-time samples in which two ` +
            'vehicles occupied the same space, so the platoons did not follow and the trajectories ' +
            'describe a failed run rather than a risky one — the measurement cannot adjudicate the ' +
            'prediction'
          : 'the simulation produced no comparable minimum time-to-collision ' +
            `(all-HV ${formatSeconds(comparison.baseline.minTtcSeconds)}, ` +
            `HV-AV-HV ${formatSeconds(comparison.variant.minTtcSeconds)}), so the measurement ` +
            'cannot adjudicate the prediction',
    }
  }
  const improvementPct = comparison.relativeImprovementPct
  // What is graded is the change the CLAIM asked for, in the claim's own direction: a prediction
  // that the margin gets WORSE is met by a negative improvement. This is the line whose absence let
  // the gate report a met prediction as a negated one.
  const inClaimDirection =
    direction === 'increase' ? improvementPct : -improvementPct
  // A CAPPED prediction is met by staying under the cap, not by clearing it. Grading both the same
  // way reported a prediction that a 38.20% fall plainly violates as SUPPORTED.
  const supportsPrediction =
    bound === 'at-least'
      ? inClaimDirection >= thresholdPct
      : bound === 'at-most'
        ? inClaimDirection <= thresholdPct
        : // A two-sided tolerance, which `bounded: boolean` could not express at all.
        Math.abs(inClaimDirection) <= thresholdPct
  return {
    kind: 'adjudicated',
    matchedPhrase: matched,
    supportsPrediction,
    improvementPct,
    thresholdPct,
    direction,
    bound,
    detail:
      `the study ${supportsPrediction ? 'met' : 'missed'} the stated threshold: the claim predicts the ` +
      `quantity should ${direction} (threshold ${bound}), and the measurement moved ${improvementPct.toFixed(2)}% ` +
      `(i.e. ${inClaimDirection.toFixed(2)}% in the direction the claim asked for) against the required ` +
      `${String(thresholdPct)}% of ${MEASURED_METRIC_LABEL} ` +
      `(all-HV ${formatSeconds(comparison.baseline.minTtcSeconds)} -> ` +
      `HV-AV-HV ${formatSeconds(comparison.variant.minTtcSeconds)})`,
  }
}

/** Format a time-to-collision for prose, naming the no-closing case rather than printing Infinity. */
function formatSeconds(value: number): string {
  return Number.isFinite(value)
    ? `${value.toFixed(2)} s`
    : 'no closing conflict observed'
}

/** The Case Pack ablation ids this study can run. */
export const ABLATION_MODULES = ['av-reaction', 'predictive'] as const
/** One of {@link ABLATION_MODULES}. */
export type AblationModule = (typeof ABLATION_MODULES)[number]

/**
 * The study with one of the AV's mechanisms removed.
 *
 * Both ablations remove exactly one mechanism and keep everything else, so the difference
 * between the ablated result and the full variant attributes to that mechanism. Neither
 * changes the baseline: an ablation is a property of the variant only.
 *
 * @param study - the study to ablate.
 * @param moduleRemoved - which mechanism to remove.
 * @returns the study with the AV degraded, or undefined for an unknown module.
 */
export function ablationStudy(
  study: PlatoonStudy,
  moduleRemoved: string,
): PlatoonStudy | undefined {
  const av = study.variant.vehicleClasses.AV
  let degraded: VehicleClass
  if (moduleRemoved === 'av-reaction') {
    // Reaction delay forced to the human value; the look-ahead mechanism is kept.
    degraded = {
      ...av,
      reactionDelaySeconds: DECLARED_VEHICLE_CLASSES.HV.reactionDelaySeconds,
    }
  } else if (moduleRemoved === 'predictive') {
    // Look-ahead removed; the fast reaction is kept, so the AV now lags by its raw
    // 150 ms physical reaction delay instead of by nothing.
    degraded = { ...av, lookAheadHorizonSeconds: 0 }
  } else {
    return undefined
  }
  return {
    baseline: study.baseline,
    variant: {
      ...study.variant,
      vehicleClasses: { ...study.variant.vehicleClasses, AV: degraded },
    },
  }
}

/**
 * The variant platoon under stop-and-go forcing, with the free-flow result to compare it to.
 *
 * This is the scope test the Case Pack's boundary file states: the claim is scoped to
 * steady free flow, and this reports whether that scope actually binds. Both numbers are
 * measured here; the ratio is arithmetic on them.
 *
 * @param study - the study whose variant is re-run.
 * @returns the free-flow and stop-and-go variant measurements plus the margin ratio.
 */
export function boundaryTest(study: PlatoonStudy = experimentStudy()): {
  readonly freeFlow: PlatoonResult
  readonly stopAndGo: PlatoonResult
  /** Stop-and-go minimum TTC as a fraction of the free-flow minimum TTC. */
  readonly marginRatio: number
  /** True when the margin halves or worse, so the claim does not carry into stop-and-go. */
  readonly scopeLimited: boolean
} {
  const freeFlow = runPlatoon(study.variant)
  const stopAndGo = runPlatoon({
    ...study.variant,
    leader: STOP_AND_GO_FORCING,
  })
  const marginRatio =
    Number.isFinite(freeFlow.minTtcSeconds) && freeFlow.minTtcSeconds > 0
      ? stopAndGo.minTtcSeconds / freeFlow.minTtcSeconds
      : Number.NaN
  return {
    freeFlow,
    stopAndGo,
    marginRatio,
    scopeLimited:
      Number.isFinite(marginRatio) &&
      marginRatio < SIMULATION_INPUTS.boundaryMarginRatio,
  }
}
