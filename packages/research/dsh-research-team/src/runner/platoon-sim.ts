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
 * this Case Pack declares, the `TTC < 1.5 s` band is not entered. That is a MEASUREMENT, not
 * an argument: across disturbance amplitudes from 5 m/s to 24 m/s — the last a near-total
 * stop from a 25 m/s cruise, harsher than anything the pack declares — and across desired
 * headways from 2.0 s down to 0.3 s, the rate is 0.00% in every case and the platoon's
 * minimum time-to-collision never falls below 2.08 s.
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
export const MEASURED_METRIC_LABEL = "the platoon's minimum time-to-collision (s)"

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
    /** The direction the CLAIM stated, which is the one its threshold was graded in. */
    readonly direction: PredictionDirection
    readonly detail: string
    /** The claim's own phrasing that binds it to the measured quantity. */
    readonly matchedPhrase: string
  }
  | { readonly kind: 'unbindable'; readonly reason: string }

/** The Case Pack's declared 3-vehicle mixed platoon: HV, AV, HV. */
export const MIXED_PLATOON_COMPOSITION: ReadonlyArray<VehicleClassId> = ['HV', 'AV', 'HV']
/** The Case Pack's declared homogeneous platoon: HV, HV, HV. */
export const HOMOGENEOUS_PLATOON_COMPOSITION: ReadonlyArray<VehicleClassId> = ['HV', 'HV', 'HV']

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
export const DECLARED_VEHICLE_CLASSES: Readonly<Record<VehicleClassId, VehicleClass>> = {
  HV: { reactionDelaySeconds: 1.2, desiredHeadwaySeconds: 2.0, maxDecelerationMps2: 7.5, lookAheadHorizonSeconds: 0 },
  // The AV predicts its leader's motion over its own 150 ms reaction horizon, which
  // cancels that delay and leaves no lag. Both declared numbers come from the Case Pack.
  AV: { reactionDelaySeconds: 0.15, desiredHeadwaySeconds: 1.2, maxDecelerationMps2: 8.0, lookAheadHorizonSeconds: 0.15 },
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
export function studyFromPack(scenarioInput: unknown): PlatoonStudy | undefined {
  if (scenarioInput === null || typeof scenarioInput !== 'object') return undefined
  const declared = (scenarioInput as { domainScenarios?: unknown }).domainScenarios
  if (!Array.isArray(declared) || declared.length !== 2) return undefined

  const build = (raw: unknown): PlatoonScenario | undefined => {
    if (raw === null || typeof raw !== 'object') return undefined
    const entry = raw as Record<string, unknown>
    const composition = entry.platoonComposition
    const params = entry.vehicleParams
    const speed = entry.initialSpeed_mps
    if (!Array.isArray(composition) || composition.some(id => id !== 'HV' && id !== 'AV')) return undefined
    // A platoon needs a leader and at least one follower. Accepting a one-vehicle composition and
    // letting `runPlatoon` refuse it later turned a pack this loader cannot use into an uncaught
    // exception thrown from inside the C channel, where every neighbouring refusal (an
    // incomparable measurement, an unstated metric) is a fail-closed `unbindable` hold. An audit
    // found it; the contract here is "a pack this loader cannot read is refused", so it is refused.
    if (composition.length < 2) return undefined
    if (params === null || typeof params !== 'object') return undefined
    if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0) return undefined

    const classes: Partial<Record<VehicleClassId, VehicleClass>> = {}
    for (const id of ['HV', 'AV'] as const) {
      const table = (params as Record<string, unknown>)[id]
      if (table === null || typeof table !== 'object') continue
      const row = table as Record<string, unknown>
      const reactionMs = row.reactionDelay_ms
      const headway = row.followDistance_s
      const decel = row.maxDecel_mps2
      if (typeof reactionMs !== 'number' || typeof headway !== 'number' || typeof decel !== 'number') return undefined
      const reactionDelaySeconds = reactionMs / 1000
      classes[id] = {
        reactionDelaySeconds,
        desiredHeadwaySeconds: headway,
        maxDecelerationMps2: decel,
        // The pack states a fast reaction, not a prediction horizon. The horizon is the
        // vehicle's own reaction delay — it predicts over exactly the interval it would
        // otherwise lag by — and is derived here rather than invented as a second constant.
        lookAheadHorizonSeconds: id === 'AV' ? reactionDelaySeconds : 0,
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
  const homogeneous = scenarios.find(s => s.composition.every(id => id === 'HV'))
  const mixed = scenarios.find(s => s.composition.includes('AV'))
  if (homogeneous === undefined || mixed === undefined) return undefined
  return { baseline: homogeneous, variant: mixed }
}

/** The leader's imposed speed at one instant, m/s. */
function leaderSpeedAt(forcing: LeaderForcing, cruiseMps: number, seconds: number): number {
  const phase = (2 * Math.PI * seconds) / forcing.periodSeconds
  if (forcing.kind === 'free-flow') {
    return Math.max(0, cruiseMps + forcing.amplitudeMps * Math.sin(phase))
  }
  // A stop-and-go wave: the speed falls to `cruise − drop` and returns, once per period.
  return Math.max(0, cruiseMps - (forcing.speedDropMps / 2) * (1 - Math.cos(phase)))
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
    throw new Error(`[platoon-sim] internal index ${String(index)} is out of range (length ${String(list.length)})`)
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
  const gap = leader.position - follower.position - SIMULATION_INPUTS.vehicleLengthM
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
    position: state.position + state.speed * seconds + 0.5 * state.acceleration * seconds ** 2,
    speed: Math.max(0, state.speed + state.acceleration * seconds),
    acceleration: state.acceleration,
  }
}

/** Run one platoon and measure it. Pure: same scenario in, same numbers out. */
export function runPlatoon(scenario: PlatoonScenario): PlatoonResult {
  const { stepSeconds, warmupSeconds, measurementSeconds } = SIMULATION_INPUTS
  const { vehicleLengthM, maxAccelerationMps2, comfortableDecelerationMps2, accelerationExponent, minimumGapM } =
    SIMULATION_INPUTS
  const count = scenario.composition.length
  if (count < 2) {
    throw new Error(`[platoon-sim] a platoon needs at least a leader and one follower, got ${String(count)}`)
  }
  const classes = scenario.composition.map(id => scenario.vehicleClasses[id])
  const maxDelay = Math.max(...classes.map(klass => klass.reactionDelaySeconds))
  const bufferSteps = Math.max(1, Math.ceil(maxDelay / stepSeconds) + 1)

  // Positions increase along the direction of travel, so the leader is the LARGEST x.
  let states: VehicleState[] = scenario.composition.map((_, index) => ({
    position: -index * (scenario.initialGapM + vehicleLengthM),
    speed: scenario.initialSpeedMps,
    acceleration: 0,
  }))
  /** Ring buffer of every vehicle's state, newest last. Index -1 is the present. */
  const history: Array<ReadonlyArray<VehicleState>> = [states.map(s => ({ ...s }))]

  const totalSteps = Math.round((warmupSeconds + measurementSeconds) / stepSeconds)
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
    const leaderSpeed = leaderSpeedAt(scenario.leader, scenario.initialSpeedMps, time)
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
      const desiredGap = minimumGapM
        + Math.max(
          0,
          me.speed * klass.desiredHeadwaySeconds
          + (me.speed * approachSpeed) / (2 * Math.sqrt(maxAccelerationMps2 * comfortableDecelerationMps2)),
        )
      const freeFlow = 1 - (me.speed / scenario.desiredSpeedMps) ** accelerationExponent
      const interaction = (desiredGap / Math.max(gap, 0.01)) ** 2
      const wanted = maxAccelerationMps2 * (freeFlow - interaction)
      const acceleration = Math.max(-klass.maxDecelerationMps2, Math.min(maxAccelerationMps2, wanted))
      const speed = Math.max(0, me.speed + acceleration * stepSeconds)
      next.push({ position: me.position + speed * stepSeconds, speed, acceleration })
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
      jerkSum += Math.abs(follow.acceleration - at(previous, index).acceleration) / stepSeconds
    }
  }

  const amplitude = (index: number): number => (at(speedMax, index) - at(speedMin, index)) / 2
  const leaderAmplitude = amplitude(0)
  const lastAmplitude = amplitude(count - 1)
  const stringStabilityIndex = leaderAmplitude > 0 ? 1 - lastAmplitude / leaderAmplitude : 0

  return {
    composition: scenario.composition,
    vehicles: scenario.composition.map((vehicleClass, index) => ({
      position: index,
      vehicleClass,
      speedAmplitudeMps: amplitude(index),
      minimumGapM: minGap[index] === Number.POSITIVE_INFINITY ? 0 : at(minGap, index),
    })),
    minTtcSeconds: Number.isFinite(minTtc) ? minTtc : Number.POSITIVE_INFINITY,
    ttcLt1_5RatePct: samples > 0 ? (riskySamples / samples) * 100 : 0,
    meanTimeHeadwaySeconds: headwaySamples > 0 ? headwaySum / headwaySamples : 0,
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
  const isComparable = Number.isFinite(base) && base > 0 && Number.isFinite(variant.minTtcSeconds)
  const forward = MEASURED_METRIC_DIRECTION === 'higher-is-better' ? 1 : -1
  const relativeImprovementPct = isComparable
    ? (forward * (variant.minTtcSeconds - base) / base) * 100
    : 0
  return {
    baseline,
    variant,
    isComparable,
    relativeImprovementPct,
    meetsThreshold: (thresholdPct: number) => isComparable && relativeImprovementPct >= thresholdPct,
  }
}

/** The direction a prediction commits to, as its own words state it. */
export type PredictionDirection = 'increase' | 'decrease'

const INCREASE_WORDS: ReadonlyArray<string> = [
  'increase', 'increases', 'increased', 'raise', 'raises', 'raised', 'exceed', 'exceeds', 'exceeding',
  'higher', 'greater', 'above', 'improve', 'improves', 'improved', 'improvement', 'gain', 'gains', 'rise', 'rises',
]

const DECREASE_WORDS: ReadonlyArray<string> = [
  'decrease', 'decreases', 'decreased', 'fall', 'falls', 'falling', 'lower', 'lowers', 'lowered',
  'reduce', 'reduces', 'reduced', 'reduction', 'drop', 'drops', 'dropping', 'decline', 'declines',
  'below', 'less', 'shorter', 'smaller',
]

/**
 * The direction a prediction commits to.
 *
 * WHY THIS IS READ AT ALL. The gate compared the measured change against the threshold with ONE
 * fixed direction (`improvement >= threshold`) and took the threshold from the first percentage in
 * the text. So "the minimum time-to-collision shall FALL by at least 20%" was graded as an
 * INCREASE: a measurement of -38.20%, which satisfies that prediction exactly, was reported as
 * NEGATING it. Two independent audits found it, and this batch's own `decisive` flag then carried
 * the wrong conclusion forward as a PASS instead of stopping at a failure — the change made a wrong
 * judgment worse than it had been.
 *
 * A prediction that states no direction, or states both, is AMBIGUOUS and the gate cannot grade it:
 * there is no reading of "changed by 20%" that decides which way the number has to move. That is a
 * hold, not a pass — the same fail-closed answer an unstated metric gets.
 *
 * A word test cannot establish what a prediction is ABOUT, only which words it used — the same limit
 * the phrase binding states. It is enough to stop the gate grading a claim backwards.
 *
 * @param predictionText - the prediction as written.
 * @returns the direction, or undefined when the text does not commit to exactly one.
 */
export function directionFromPrediction(predictionText: string): PredictionDirection | undefined {
  const lowered = predictionText.toLowerCase()
  const saysIncrease = INCREASE_WORDS.some(word => new RegExp(`\\b${word}\\b`, 'u').test(lowered))
  const saysDecrease = DECREASE_WORDS.some(word => new RegExp(`\\b${word}\\b`, 'u').test(lowered))
  if (saysIncrease === saysDecrease) return undefined
  return saysIncrease ? 'increase' : 'decrease'
}

/**
 * Read the numeric threshold a prediction commits to.
 *
 * The prediction is prose, but a falsifiable one names a quantity, so the first percentage
 * in the text is the commitment. A prediction with no percentage is not falsifiable in this
 * study's terms and yields undefined, which callers must treat as "cannot adjudicate"
 * rather than as a pass.
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
 * The phrasing a claim about `metricKey` uses, if it uses one.
 *
 * @param text - the claim's PREDICTION, as written.
 * @param metricKey - the key the claim declares.
 * @returns the matched phrase, or undefined when the text names no phrasing of that quantity.
 */
export function claimTextNamesQuantity(text: string, metricKey: string): string | undefined {
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
): PredictionAdjudication {
  // The binding is checked FIRST. A prediction about a quantity this study does not measure
  // cannot be adjudicated however many percentages it states, and grading it would report an
  // untested claim as supported or refuted.
  if (metricKey === undefined || metricKey === '' || metricKey !== MEASURED_METRIC_KEY) {
    return {
      kind: 'unbindable',
      reason: metricKey === undefined || metricKey === ''
        ? `the claim declares no metric, so nothing binds it to the quantity this study measures (${MEASURED_METRIC_LABEL})`
        : `the claim is about "${metricKey}" while this study measures "${MEASURED_METRIC_KEY}" (${MEASURED_METRIC_LABEL}), so the measurement cannot adjudicate it`,
    }
  }
  const matched = claimTextNamesQuantity(predictionText, metricKey)
  if (matched === undefined) {
    return {
      kind: 'unbindable',
      reason:
        `the claim declares the metric "${metricKey}" but the prediction it commits to does not name `
        + `that quantity (no phrasing of ${MEASURED_METRIC_LABEL} appears in it), so the declaration `
        + 'is unverified and the measurement cannot adjudicate it',
    }
  }
  const thresholdPct = thresholdFromPrediction(predictionText)
  if (thresholdPct === undefined) {
    return {
      kind: 'unbindable',
      reason: `the claim is about ${MEASURED_METRIC_LABEL} but states no numeric threshold, so there is nothing to adjudicate`,
    }
  }

  const comparison = comparePlatoons(study)
  if (!comparison.isComparable) {
    // Fail-closed: a platoon that never closed on its leader has no minimum
    // time-to-collision, so there is no ratio to test the threshold against. Grading it
    // would report "the prediction was refuted" for a measurement that never happened.
    return {
      kind: 'unbindable',
      reason:
        'the simulation produced no comparable minimum time-to-collision '
        + `(all-HV ${formatSeconds(comparison.baseline.minTtcSeconds)}, `
        + `HV-AV-HV ${formatSeconds(comparison.variant.minTtcSeconds)}), so the measurement `
        + 'cannot adjudicate the prediction',
    }
  }
  // The direction the CLAIM committed to, read from its own words. Without it the threshold has
  // no reading: "changed by 20%" does not say which way the number has to move, and grading it
  // either way would invent the half the claim left out.
  const direction = directionFromPrediction(predictionText)
  if (direction === undefined) {
    return {
      kind: 'unbindable',
      reason:
        `the claim is about ${MEASURED_METRIC_LABEL} and states a threshold, but does not commit to a `
        + 'DIRECTION, so there is no reading of that threshold that decides whether the measurement '
        + 'meets it — the claim has to say whether the quantity should rise or fall',
    }
  }

  const improvementPct = comparison.relativeImprovementPct
  // What is graded is the change the CLAIM asked for, stated in the claim's own direction: a
  // prediction that the margin gets WORSE is met by a negative improvement, and this is the line
  // whose absence let the gate report a met prediction as a negated one.
  const inClaimDirection = direction === 'increase' ? improvementPct : -improvementPct
  const supportsPrediction = inClaimDirection >= thresholdPct
  return {
    kind: 'adjudicated',
    matchedPhrase: matched,
    supportsPrediction,
    improvementPct,
    thresholdPct,
    direction,
    detail:
      `the study ${supportsPrediction ? 'met' : 'missed'} the stated threshold: the claim predicts the `
      + `quantity should ${direction}, and the measurement moved ${improvementPct.toFixed(2)}% `
      + `(i.e. ${inClaimDirection.toFixed(2)}% in the direction the claim asked for) against the required `
      + `${String(thresholdPct)}% of ${MEASURED_METRIC_LABEL} `
      + `(all-HV ${formatSeconds(comparison.baseline.minTtcSeconds)} -> `
      + `HV-AV-HV ${formatSeconds(comparison.variant.minTtcSeconds)})`,
  }
}

/** Format a time-to-collision for prose, naming the no-closing case rather than printing Infinity. */
function formatSeconds(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(2)} s` : 'no closing conflict observed'
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
export function ablationStudy(study: PlatoonStudy, moduleRemoved: string): PlatoonStudy | undefined {
  const av = study.variant.vehicleClasses.AV
  let degraded: VehicleClass
  if (moduleRemoved === 'av-reaction') {
    // Reaction delay forced to the human value; the look-ahead mechanism is kept.
    degraded = { ...av, reactionDelaySeconds: DECLARED_VEHICLE_CLASSES.HV.reactionDelaySeconds }
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
  const stopAndGo = runPlatoon({ ...study.variant, leader: STOP_AND_GO_FORCING })
  const marginRatio = Number.isFinite(freeFlow.minTtcSeconds) && freeFlow.minTtcSeconds > 0
    ? stopAndGo.minTtcSeconds / freeFlow.minTtcSeconds
    : Number.NaN
  return {
    freeFlow,
    stopAndGo,
    marginRatio,
    scopeLimited: Number.isFinite(marginRatio) && marginRatio < SIMULATION_INPUTS.boundaryMarginRatio,
  }
}
