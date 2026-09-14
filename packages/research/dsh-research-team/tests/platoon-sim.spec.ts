/**
 * The study's experiment: a deterministic platoon car-following simulation.
 *
 * Every case below pins a property that a previous version of this module got WRONG, or
 * that the study's claim depends on. Its two recorded defects:
 *   - the leader cruised at the IDM desired speed, where the model has no finite
 *     equilibrium gap, so the platoon DIVERGED to a 200 m spacing and the comparison
 *     measured a spreading platoon instead of a following one;
 *   - the look-ahead mechanism cancelled the reaction delay outright, so ablating the
 *     reaction delay changed nothing and the ablation would have attributed a zero
 *     contribution to a mechanism it had not removed.
 */

import { describe, expect, it } from 'vitest'

import {
  ABLATION_MODULES,
  DECLARED_VEHICLE_CLASSES,
  MEASURED_METRIC_KEY,
  SIMULATION_INPUTS,
  percentagesIn,
  requirementDirectionIn,
  STUDY_OPERATING_POINT,
  ablationStudy,
  boundaryTest,
  comparePlatoons,
  evaluatePrediction,
  experimentStudy,
  runPlatoon,
  studyFromPack,
} from '../src/runner/platoon-sim.ts'

const study = experimentStudy()

describe('runPlatoon', () => {
  it('holds the platoon together instead of letting it diverge', () => {
    // The recorded defect: at `v = v0` the IDM free term is zero only for an infinite gap,
    // so the platoon spread without bound. A settled platoon must stay near its own
    // equilibrium spacing for the whole measurement window.
    const result = runPlatoon(study.baseline)
    for (const vehicle of result.vehicles.slice(1)) {
      expect(vehicle.minimumGapM).toBeGreaterThan(0)
      expect(vehicle.minimumGapM).toBeLessThan(STUDY_OPERATING_POINT.initialGapM * 3)
    }
  })

  it('is deterministic: the same scenario produces the same measurement', () => {
    const first = runPlatoon(study.variant)
    const second = runPlatoon(study.variant)
    expect(second.minTtcSeconds).toBe(first.minTtcSeconds)
    expect(second.meanJerkMps3).toBe(first.meanJerkMps3)
    expect(second.meanTimeHeadwaySeconds).toBe(first.meanTimeHeadwaySeconds)
  })

  it('reports the pack-declared TTC<1.5s rate even though it is inert here', () => {
    const result = runPlatoon(study.variant)
    expect(result.ttcLt1_5RatePct).toBe(0)
    expect(result.samples).toBeGreaterThan(0)
    expect(SIMULATION_INPUTS.ttcThresholdSeconds).toBe(1.5)
  })

  it('PINS the limit: the TTC<1.5s band is not entered at any forcing or headway tested', () => {
    // The study does not bind its claim to this band, and the reason has to stay a MEASURED one.
    // The first version of the reason was an argument — "an IDM platoon settles at s0 + v·T, so
    // the smallest TTC a leader stopping dead can produce is (s0 + v·T)/v, above 1.5 s" — and it
    // was wrong: that expression is the TTC a follower would see if it never braked, it is below
    // 1.5 s for the AV's declared 1.2 s headway, and real followers brake. Only running it shows
    // the band is not entered. This case keeps the reason empirical: if a model change ever puts
    // the platoon into that band, it fails here rather than in a comment nobody re-reads.
    const harsh = { ...study.variant, leader: { kind: 'stop-and-go' as const, speedDropMps: study.variant.initialSpeedMps - 1, periodSeconds: SIMULATION_INPUTS.disturbancePeriodSeconds } }
    for (const amplitude of [SIMULATION_INPUTS.freeFlowAmplitudeMps, 12, SIMULATION_INPUTS.stopAndGoSpeedDropMps]) {
      const forced = runPlatoon({ ...study.variant, leader: { kind: 'free-flow', amplitudeMps: amplitude, periodSeconds: SIMULATION_INPUTS.disturbancePeriodSeconds } })
      expect(forced.ttcLt1_5RatePct, `amplitude ${String(amplitude)}`).toBe(0)
    }
    const stopped = runPlatoon(harsh)
    expect(stopped.ttcLt1_5RatePct).toBe(0)
    // ...and the floor, so the numbers in the module header are checked rather than remembered.
    // `stopped` is a near-total stop at the DECLARED headways; the pack's own stop-and-go forcing
    // is milder and measures 4.158 s, which `boundaryTest` covers.
    expect(stopped.minTtcSeconds).toBeGreaterThan(2.8)
  })

  it('reports a minimum time-to-collision that is a finite, positive number', () => {
    const result = runPlatoon(study.variant)
    expect(Number.isFinite(result.minTtcSeconds)).toBe(true)
    expect(result.minTtcSeconds).toBeGreaterThan(0)
  })

  it('records a string-stability index whose sign matches its boolean', () => {
    for (const scenario of [study.baseline, study.variant]) {
      const result = runPlatoon(scenario)
      expect(result.stringStable).toBe(result.stringStabilityIndex >= 0)
    }
  })
})

describe('comparePlatoons', () => {
  it('compares in the declared direction, so a LOSS reads as a negative change', () => {
    // The variant carries a SHORTER desired headway than the baseline, and on this metric
    // that costs more than the fast reaction buys. The comparison must report the sign of
    // the measured change rather than assume the variant wins.
    const comparison = comparePlatoons(study)
    expect(comparison.isComparable).toBe(true)
    expect(comparison.relativeImprovementPct).toBeLessThan(0)
    expect(comparison.variant.minTtcSeconds).toBeLessThan(comparison.baseline.minTtcSeconds)
    expect(comparison.meetsThreshold(20)).toBe(false)
  })

  it('refuses to compare a platoon with no measurable minimum', () => {
    // A platoon whose followers never close on their leader has no minimum time-to-collision,
    // and dividing by it would report "no improvement" for a measurement that never happened.
    // Built by giving the baseline a constant-speed leader AND a desired speed below the
    // cruise speed, which is what keeps its followers from ever exceeding it.
    const neverCloses: typeof study.baseline = {
      ...study.baseline,
      desiredSpeedMps: study.baseline.initialSpeedMps - 1,
      leader: { kind: 'free-flow', amplitudeMps: 0, periodSeconds: SIMULATION_INPUTS.disturbancePeriodSeconds },
    }
    const comparison = comparePlatoons({ baseline: neverCloses, variant: study.variant })
    expect(comparison.baseline.minTtcSeconds).toBe(Number.POSITIVE_INFINITY)
    expect(comparison.isComparable).toBe(false)
    expect(comparison.meetsThreshold(0)).toBe(false)
  })
})

describe('ablationStudy', () => {
  it('changes the measurement for EVERY declared module', () => {
    // The recorded defect: with a boolean look-ahead, removing the reaction delay changed
    // nothing at all and the ablation reported a 0.000 s contribution.
    const full = runPlatoon(study.variant)
    for (const moduleRemoved of ABLATION_MODULES) {
      const ablated = ablationStudy(study, moduleRemoved)
      expect(ablated, moduleRemoved).toBeDefined()
      const measured = runPlatoon(ablated!.variant)
      expect(measured.minTtcSeconds, `${moduleRemoved} must move the measurement`)
        .not.toBe(full.minTtcSeconds)
    }
  })

  it('removes exactly one mechanism, and never touches the baseline', () => {
    for (const moduleRemoved of ABLATION_MODULES) {
      const ablated = ablationStudy(study, moduleRemoved)!
      expect(ablated.baseline).toBe(study.baseline)
      const av = ablated.variant.vehicleClasses.AV
      const declared = DECLARED_VEHICLE_CLASSES.AV
      const differences = (Object.keys(declared) as ReadonlyArray<keyof typeof declared>)
        .filter(key => declared[key] !== av[key])
      expect(differences, moduleRemoved).toHaveLength(1)
    }
  })

  it('returns undefined for a module the study does not declare', () => {
    expect(ablationStudy(study, 'no-such-module')).toBeUndefined()
  })
})

describe('boundaryTest', () => {
  it('measures both forcings and reports a scope that does bind', () => {
    // The Case Pack asserts the claim is limited to steady free flow. That is a falsifiable
    // statement about the study, so it is measured: stop-and-go forcing drops the margin far
    // below the free-flow one.
    const probe = boundaryTest(study)
    expect(probe.stopAndGo.minTtcSeconds).toBeLessThan(probe.freeFlow.minTtcSeconds)
    expect(probe.scopeLimited).toBe(true)
    expect(probe.marginRatio).toBeLessThan(SIMULATION_INPUTS.boundaryMarginRatio)
  })
})

describe('studyFromPack', () => {
  /** The shipped pack's scenario block, trimmed to the fields the study reads. */
  const packScenarios = {
    domainScenarios: [
      {
        id: 'scenario-mixed-HV-AV-HV',
        platoonComposition: ['HV', 'AV', 'HV'],
        vehicleParams: {
          HV: { reactionDelay_ms: 1200, followDistance_s: 2.0, maxDecel_mps2: 7.5 },
          AV: { reactionDelay_ms: 150, followDistance_s: 1.2, maxDecel_mps2: 8.0 },
        },
        initialSpeed_mps: 25.0,
      },
      {
        id: 'scenario-homogeneous-HV-HV-HV',
        platoonComposition: ['HV', 'HV', 'HV'],
        vehicleParams: {
          HV: { reactionDelay_ms: 1200, followDistance_s: 2.0, maxDecel_mps2: 7.5 },
        },
        initialSpeed_mps: 25.0,
      },
    ],
  }

  it('takes the vehicle parameters from the pack rather than from the module constants', () => {
    const fromPack = studyFromPack(packScenarios)
    expect(fromPack).toBeDefined()
    expect(fromPack!.variant.composition).toEqual(['HV', 'AV', 'HV'])
    expect(fromPack!.baseline.composition).toEqual(['HV', 'HV', 'HV'])
    expect(fromPack!.variant.vehicleClasses.AV.reactionDelaySeconds).toBeCloseTo(0.15, 10)
    expect(fromPack!.variant.vehicleClasses.HV.desiredHeadwaySeconds).toBeCloseTo(2.0, 10)
    expect(fromPack!.variant.initialSpeedMps).toBe(25.0)
  })

  it('refuses a scenario block it cannot read instead of guessing one', () => {
    expect(studyFromPack(undefined)).toBeUndefined()
    expect(studyFromPack({})).toBeUndefined()
    expect(studyFromPack({ domainScenarios: [{ platoonComposition: ['HV'] }] })).toBeUndefined()
    expect(studyFromPack({
      domainScenarios: [
        { ...packScenarios.domainScenarios[0]!, platoonComposition: ['HV', 'TRUCK', 'HV'] },
        packScenarios.domainScenarios[1]!,
      ],
    })).toBeUndefined()
  })

  it('produces the same study as the module defaults for the shipped pack', () => {
    // The module constants mirror the pack, so a run with and without a pack measures the
    // same thing. If the pack moves, this is where the two are seen to diverge.
    const fromPack = studyFromPack(packScenarios)!
    expect(fromPack.variant.vehicleClasses).toEqual(study.variant.vehicleClasses)
    expect(fromPack.baseline.composition).toEqual(study.baseline.composition)
  })
})

describe('evaluatePrediction', () => {
  const canonical = 'the HV-AV-HV platoon shall exceed the all-HV platoon in minimum time-to-collision by at least 20%'

  it('adjudicates the bound quantity and reports the measured direction', () => {
    const verdict = evaluatePrediction(canonical, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least', thresholdPct: 20 })
    expect(verdict.kind).toBe('adjudicated')
    if (verdict.kind !== 'adjudicated') return
    expect(verdict.supportsPrediction).toBe(false)
    expect(verdict.improvementPct).toBeLessThan(0)
    expect(verdict.thresholdPct).toBe(20)
    expect(verdict.matchedPhrase).toBe('minimum time-to-collision')
  })

  it('GRADES THE DECLARED COMMITMENT, and nothing else about the sentence', () => {
    // What this replaced: the gate inferred a direction and a cap from the prediction's prose, and
    // three audit rounds dismantled that reader — a fixed comparison graded a satisfied prediction
    // backwards; the fix reported a 38.20% fall as meeting a 20% cap; the cap was located by a
    // character window, so `under` as an ordinary preposition flipped the verdict, and adding "the
    // same" to the sentence flipped it back; `by up to N%` was read as a floor; `no` inside
    // `normal` held a gradeable prediction; and a year in the sentence became the clause the
    // direction was read from. The auditor's verdict was that it could not be trusted and should be
    // replaced by something narrower. This is the replacement: the claim DECLARES its commitment.
    const rise = 'the HV-AV-HV platoon shall exceed the all-HV platoon in minimum time-to-collision by at least 20%'
    const increase = evaluatePrediction(rise, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least', thresholdPct: 20 })
    expect(increase.kind).toBe('adjudicated')
    if (increase.kind !== 'adjudicated') return
    expect(increase.direction).toBe('increase')
    expect(increase.supportsPrediction).toBe(false)

    // The SAME sentence declared as a FALL is refused, and that is the point of this being a
    // declared field rather than a free one: the sentence says "exceeds", the declaration says the
    // quantity should decrease, and the two contradict each other — the same class as the
    // truthfulness pair the loader refuses. A matching sentence IS graded as a fall instead.
    const declaredFall = evaluatePrediction(rise, study, MEASURED_METRIC_KEY, { direction: 'decrease', bound: 'at-least', thresholdPct: 20 })
    expect(declaredFall.kind).toBe('unbindable')
    if (declaredFall.kind === 'unbindable') expect(declaredFall.reason).toContain('the declaration and the sentence contradict each other')

    const fallen = 'the HV-AV-HV platoon shall fall in minimum time-to-collision by at least 20% against the all-HV platoon'
    const decrease = evaluatePrediction(fallen, study, MEASURED_METRIC_KEY, { direction: 'decrease', bound: 'at-least', thresholdPct: 20 })
    expect(decrease.kind).toBe('adjudicated')
    if (decrease.kind !== 'adjudicated') return
    expect(decrease.direction).toBe('decrease')
    expect(decrease.supportsPrediction).toBe(true)

    // A CAPPED commitment needs an anchor that SAYS so: declaring `at-most` against a sentence
    // anchored "at least" is the declaration contradicting the claim's own words, and the gate
    // refuses it rather than grading either half. The anchor is compared as a string, which is
    // wire-format validation and not a reading.
    const mismatched = evaluatePrediction(rise, study, MEASURED_METRIC_KEY, { direction: 'decrease', bound: 'at-most', thresholdPct: 20 })
    expect(mismatched.kind).toBe('unbindable')
    if (mismatched.kind === 'unbindable') expect(mismatched.reason).toContain('contradict each other')

    // Anchored to match, the cap is graded: a 38.20% fall is not "at most 20%".
    // The sentence names a direction AND an anchor that agree with what it declares.
    const cappedText = 'the HV-AV-HV platoon minimum time-to-collision shall rise by at most 20% against the all-HV platoon minimum'
    const capped = evaluatePrediction(cappedText, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-most', thresholdPct: 20 })
    expect(capped.kind).toBe('adjudicated')
    if (capped.kind !== 'adjudicated') return
    expect(capped.bound).toBe('at-most')
    expect(capped.supportsPrediction).toBe(true)
  })

  it('HOLDS a claim that declares no commitment, rather than guessing one', () => {
    // The fail-closed answer, and the same one an undeclared metric gets: a study has to say what
    // it is testing. The sentence here is unambiguous to a reader and still holds, because a
    // reader is not what grades it.
    const verdict = evaluatePrediction(
      'the platoon minimum time-to-collision falls by at least 20%',
      study,
      MEASURED_METRIC_KEY,
    )
    expect(verdict.kind).toBe('unbindable')
    if (verdict.kind === 'unbindable') expect(verdict.reason).toContain('declares no commitment')
  })

  it('REFUSES to compare platoons that COLLIDED, instead of grading a failed run', () => {
    // `collisions` was computed and read by nothing: a configuration with 5138 vehicle-time
    // samples of overlap still produced `improvementPct: -100.00`, `isComparable: true`, and a C
    // verdict. Two vehicles in one place means the platoon stopped following, so every number read
    // off those trajectories describes a failed run. An audit found the field had no consumer.
    // A platoon asked to hold a 0.15 s headway by vehicles that can only decelerate at 0.2 m/s²:
    // they follow far closer than they can stop from. The reviewer's own probe found this
    // configuration and measured 5138 overlapping vehicle-time samples in it.
    const weakBrakes = { desiredHeadwaySeconds: 0.15, maxDecelerationMps2: 0.2 }
    const colliding: typeof study = {
      baseline: study.baseline,
      variant: {
        ...study.variant,
        vehicleClasses: {
          HV: { ...study.variant.vehicleClasses.HV, ...weakBrakes },
          AV: { ...study.variant.vehicleClasses.AV, ...weakBrakes },
        },
      },
    }
    const measured = runPlatoon(colliding.variant)
    expect(measured.collisions).toBeGreaterThan(0)
    const comparison = comparePlatoons(colliding)
    expect(comparison.isComparable).toBe(false)

    const verdict = evaluatePrediction(
      'the HV-AV-HV platoon shall exceed the all-HV platoon in minimum time-to-collision by at least 20%',
      colliding,
      MEASURED_METRIC_KEY,
      { direction: 'increase', bound: 'at-least', thresholdPct: 20 },
    )
    expect(verdict.kind).toBe('unbindable')
    if (verdict.kind === 'unbindable') expect(verdict.reason).toContain('occupied the same space')
  })

  it('supports the prediction when the measurement warrants it', () => {
    // The direction-sensitivity check. On this metric the sign is set by the AV's declared
    // headway: it must hold a LARGER headway than the human vehicle before its faster
    // reaction converts into a larger margin at all. At the packed 1.2 s it does not; at
    // 3.0 s the same prediction clears. Without this case the adjudicator could be reporting
    // a constant and no test would notice.
    const generous = {
      baseline: study.baseline,
      variant: {
        ...study.variant,
        vehicleClasses: {
          ...study.variant.vehicleClasses,
          AV: { ...study.variant.vehicleClasses.AV, desiredHeadwaySeconds: 4.0 },
        },
      },
    }
    const verdict = evaluatePrediction(canonical, generous, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least', thresholdPct: 20 })
    expect(verdict.kind).toBe('adjudicated')
    if (verdict.kind !== 'adjudicated') return
    expect(verdict.supportsPrediction).toBe(true)
    expect(verdict.improvementPct).toBeGreaterThan(20)
  })

  it('holds a claim that declares no metric', () => {
    const verdict = evaluatePrediction(canonical, study, '')
    expect(verdict.kind).toBe('unbindable')
    if (verdict.kind === 'unbindable') expect(verdict.reason).toContain('declares no metric')
  })

  it('holds a claim about a quantity this study does not measure', () => {
    const verdict = evaluatePrediction(canonical, study, 'platoon-string-stability-index')
    expect(verdict.kind).toBe('unbindable')
    if (verdict.kind === 'unbindable') {
      expect(verdict.reason).toContain('platoon-string-stability-index')
      expect(verdict.reason).toContain(MEASURED_METRIC_KEY)
    }
  })

  it('holds a claim whose declaration disagrees with its own words', () => {
    const verdict = evaluatePrediction(
      'the platoon string-stability index improves by at least 20%',
      study,
      MEASURED_METRIC_KEY,
    )
    expect(verdict.kind).toBe('unbindable')
    if (verdict.kind === 'unbindable') expect(verdict.reason).toContain('does not name that quantity')
  })

  it('holds a claim whose prediction states no percentage, whatever it declares', () => {
    // The prose must state the DECLARED number, exactly once, and that equality is the only thing the
    // gate still reads out of the sentence. A claim that declares a threshold its own prediction
    // never writes is not gradeable as stated.
    // The case used to declare no commitment at all, so the guard it reached first was the
    // "declares no commitment" one above rather than the percentage guard it is about. Declaring a
    // threshold is what puts it on the check it names.
    const verdict = evaluatePrediction('the platoon minimum time-to-collision improves', study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least', thresholdPct: 20 })
    expect(verdict.kind).toBe('unbindable')
    if (verdict.kind === 'unbindable') expect(verdict.reason).toContain('states none')
  })

  it('HOLDS a claim that only MENTIONS the measured quantity in another clause', () => {
    // The false-positive direction, which the phrase check cannot close and which is pinned
    // here so a future change to it is visible rather than silent. No keyword test can
    // establish that a claim is ABOUT a quantity; it can only establish that the claim used
    // the words. The check is a NECESSARY condition and not a sufficient one.
    // This case used to be recorded as a LIMIT — the phrase was present, so the claim "used the
    // words", and a claim naming the quantity in passing was graded. Scoping to the clause removes
    // it: the phrase sits in the second clause while the number and its anchor sit in the first, so
    // the clause naming the quantity states no percentage and the gate holds. The limit that
    // replaces it is the segmentation heuristic, which fails to a HOLD rather than to a pass. That
    // scoping is scope rather than soundness — `measuringClause` in the module says what it is and,
    // more to the point, what it is not: a literal inside the clause naming the quantity is not
    // thereby shown to be ABOUT it, which is why the number the verdict grades is the declared
    // threshold rather than anything read from the sentence.
    const verdict = evaluatePrediction(
      'the platoon string-stability index shall rise by at least 20%, unlike prior work on '
      + 'minimum time-to-collision that assumed uniform arrivals',
      study,
      MEASURED_METRIC_KEY,
      { direction: 'increase', bound: 'at-least', thresholdPct: 20 },
    )
    expect(verdict.kind).toBe('unbindable')
  })
})

describe('the declaration is checked against the claim\'s own words', () => {
  // The gate grades three DECLARED fields — direction, bound and threshold — and nothing tied them
  // to the sentence, so an audit showed that changing ONE declared field records a claim its own
  // sentence refutes as supported. What this tests is the tie: the sentence must name the measured
  // quantity, carry a machine-readable anchor and a direction word, and state the declared
  // percentage, and each is compared to the declaration by STRING EQUALITY — wire-format validation,
  // which needs no comprehension. A disagreement is a contradiction and is refused; an absence is a
  // gap and is held, and none of the three can produce a verdict on its own.
  const rise = 'the HV-AV-HV platoon shall exceed the all-HV platoon in minimum time-to-collision by at least 20%'

  it('REFUSES a declaration that contradicts the anchor the sentence states', () => {
    const mismatched = evaluatePrediction(rise, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-most', thresholdPct: 20 })
    expect(mismatched.kind).toBe('unbindable')
    if (mismatched.kind === 'unbindable') {
      expect(mismatched.reason).toContain('contradict each other')
      expect(mismatched.reason).toContain('at-least')
      expect(mismatched.reason).toContain('at-most')
    }
  })

  it('REFUSES a prediction with no anchor beside its number', () => {
    const unanchored = 'the HV-AV-HV platoon minimum time-to-collision exceeds the all-HV platoon minimum by 20%'
    const verdict = evaluatePrediction(unanchored, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least', thresholdPct: 20 })
    expect(verdict.kind).toBe('unbindable')
    if (verdict.kind === 'unbindable') expect(verdict.reason).toContain('carries no anchor')
  })

  it('grades the percentage of the clause naming the quantity, and refuses a clause stating two', () => {
    // The old rule took the FIRST percentage in the sentence: "Over 20% of the interval, the … shall
    // exceed by at least 35%" graded 20 while the sentence commits to 35. Scoping to the clause
    // fixes it — the 20% belongs to a different clause — so the 35 is what the declaration is
    // checked against. That equality is with the DECLARED threshold rather than a reading of the
    // sentence, which makes the scope a question of WHERE the gate looks rather than of what it can
    // understand; `measuringClause` in the module states both halves of that.
    const twoNumbers = 'over 20% of the simulated interval, the platoon minimum time-to-collision shall exceed the all-HV baseline by at least 35%'
    expect(percentagesIn(twoNumbers)).toEqual([20, 35])
    const verdict = evaluatePrediction(twoNumbers, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least', thresholdPct: 35 })
    expect(verdict.kind).toBe('adjudicated')
    if (verdict.kind === 'adjudicated') expect(verdict.thresholdPct).toBe(35)

    // Two in the SAME clause is still a guess, and holds.
    // One clause, two percentages: parentheses are not clause boundaries, so neither can be
    // explained away as belonging to another clause.
    const sameClause = 'the platoon minimum time-to-collision shall exceed the all-HV baseline by at least 35% (within 20%)'
    const ambiguous = evaluatePrediction(sameClause, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least', thresholdPct: 35 })
    expect(ambiguous.kind).toBe('unbindable')
    if (ambiguous.kind === 'unbindable') expect(ambiguous.reason).toContain('states 35, 20%')
  })

  it('grades a TWO-SIDED tolerance, which a boolean bound could not express', () => {
    // The one boundary of the audit's three that produced a false positive on its own: declared as
    // a cap, a 38.20% fall was graded `-38.20 <= 20` → SUPPORTED for a claim that a 38% fall
    // plainly violates. The declaration was honest; the model could not express it.
    const within = 'the platoon minimum time-to-collision against the all-HV baseline shall rise within 40%'
    const verdict = evaluatePrediction(within, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'within', thresholdPct: 40 })
    expect(verdict.kind).toBe('adjudicated')
    if (verdict.kind !== 'adjudicated') return
    expect(verdict.bound).toBe('within')
    // |−38.20| <= 40 → met. Tighten the tolerance past the measured change and it is missed.
    expect(verdict.supportsPrediction).toBe(true)
    const tight = evaluatePrediction(
      'the platoon minimum time-to-collision against the all-HV baseline shall rise within 10%',
      study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'within', thresholdPct: 10 },
    )
    expect(tight.kind === 'adjudicated' && tight.supportsPrediction).toBe(false)
  })

  it('HOLDS a sentence that names both directions, and one that names none', () => {
    // Ambiguity is a gap, not a contradiction: the gate cannot tell which word the claim means, so
    // it holds. Every outcome of this check is either agreement or a hold — a missed word, a
    // spurious word or an ambiguous sentence can only make the gate STRICTER, never hand out a
    // pass. That property is what separates it from the prose reader this batch deleted.
    const both = 'the platoon minimum time-to-collision rises under the AV and falls under the all-HV platoon by at least 20%'
    // Both hold. WHICH guard reports it depends on where the clause boundary falls — the first
    // clause here names the quantity and carries a direction but no percentage — and the property
    // that matters is that neither is graded.
    const ambiguous = evaluatePrediction(both, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least', thresholdPct: 20 })
    expect(ambiguous.kind).toBe('unbindable')

    const none = 'the platoon minimum time-to-collision against the all-HV platoon by at least 20%'
    const silent = evaluatePrediction(none, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least', thresholdPct: 20 })
    expect(silent.kind).toBe('unbindable')
    if (silent.kind === 'unbindable') expect(silent.reason).toContain('required form')
  })

  it('HOLDS a PROHIBITION, which the anchors cannot tell from a requirement', () => {
    // The counterexample an auditor built after I claimed a mismatched anchor could only make the
    // gate stricter. It is a prohibition — a 38.20% fall VIOLATES it — yet `fall` reads as
    // `decrease`, `≥` reads as `at-least`, and BOTH agree with this declaration, so the gate graded
    // the prohibition as a requirement and reported `supported`.
    const prohibition = 'The insertion of one AV shall not cause the platoon minimum time-to-collision to fall by ≥ 20% relative to the all-HV baseline'
    const verdict = evaluatePrediction(prohibition, study, MEASURED_METRIC_KEY, { direction: 'decrease', bound: 'at-least', thresholdPct: 20 })
    expect(verdict.kind).toBe('unbindable')
    if (verdict.kind === 'unbindable') expect(verdict.reason).toContain('requirement or a PROHIBITION')
  })

  it('HOLDS an emphasis-cased prohibition, which the first guard let through', () => {
    // An auditor found the negation guard was case-SENSITIVE while the two anchor checks beside it
    // folded case first, so `shall Not fall` and `shall NOT FALL` walked past it — and it ran the
    // emphasised form through the whole pipeline to a `supported` verdict on a measurement that
    // violated the prohibition. The pair below is the finding: same sentence, one case apart.
    const lower = 'the HV-AV-HV platoon shall not fall in minimum time-to-collision by at least 20%'
    const upper = 'the HV-AV-HV platoon shall NOT fall in minimum time-to-collision by at least 20%'
    for (const text of [lower, upper]) {
      const verdict = evaluatePrediction(text, study, MEASURED_METRIC_KEY, { direction: 'decrease', bound: 'at-least', thresholdPct: 20 })
      expect(verdict.kind, text).toBe('unbindable')
    }
  })

  it('HOLDS a prohibition no negation list could catch, because the SHAPE is required', () => {
    // The case fix leaves what the auditor then pointed at: "shall refrain from falling" forbids
    // without using any word on any list. That is why the rule is a required shape rather than a
    // longer blacklist — the direction word must FOLLOW `shall`, and a prohibition's negation
    // occupies that position.
    for (const text of [
      'the HV-AV-HV platoon shall refrain from falling in minimum time-to-collision by at least 20%',
      'the HV-AV-HV platoon shall never fall in minimum time-to-collision by at least 20%',
      'the HV-AV-HV platoon shall, under no circumstances, fall in minimum time-to-collision by at least 20%',
    ]) {
      const verdict = evaluatePrediction(text, study, MEASURED_METRIC_KEY, { direction: 'decrease', bound: 'at-least', thresholdPct: 20 })
      // All three hold. WHICH guard catches them differs and is not the point — `refrain` has no
      // negation word and is caught by the SHAPE, the other two by the negation guard that runs
      // first. That both reach the same safe answer from different directions is the point.
      expect(verdict.kind, text).toBe('unbindable')
    }
    const refrain = evaluatePrediction(
      'the HV-AV-HV platoon shall refrain from falling in minimum time-to-collision by at least 20%',
      study, MEASURED_METRIC_KEY, { direction: 'decrease', bound: 'at-least', thresholdPct: 20 },
    )
    expect(refrain.kind === 'unbindable' && refrain.reason).toContain('required form')
    // The positive form of the same sentence is graded, whatever its case.
    for (const text of [
      'the HV-AV-HV platoon shall fall in minimum time-to-collision by at least 20%',
      'the HV-AV-HV platoon SHALL FALL in minimum time-to-collision by at least 20%',
    ]) {
      expect(requirementDirectionIn(text), text).toBe('decrease')
      expect(evaluatePrediction(text, study, MEASURED_METRIC_KEY, { direction: 'decrease', bound: 'at-least', thresholdPct: 20 }).kind, text).toBe('adjudicated')
    }
  })

  it('HOLDS any negated anchor, and that is a stated consequence rather than an oversight', () => {
    // A negation stops the grading instead of being interpreted, so the cap forms written as
    // negations are unreachable and were removed from the table. A claim has to be a POSITIVE
    // directional statement: "shall rise by at most 20%", not "shall not exceed 20%". An auditor
    // asked for `not exceed` to be supported and a later auditor showed why it cannot be — this is
    // the record of that, so the next reader does not re-open it as a missing token.
    for (const text of [
      'the platoon minimum time-to-collision shall rise and shall not exceed 20% above the all-HV baseline',
      'the platoon minimum time-to-collision shall rise by no more than 20% above the all-HV baseline',
    ]) {
      const verdict = evaluatePrediction(text, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-most', thresholdPct: 20 })
      // Which guard fires differs — the negation words are on two of them, and the third carries no
      // anchor in its clause at all. All three hold, which is the property that matters.
      expect(verdict.kind, text).toBe('unbindable')
    }
    // The non-negated form of the same cap IS graded.
    const positive = 'the platoon minimum time-to-collision shall rise by at most 20% above the all-HV baseline'
    expect(evaluatePrediction(positive, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-most', thresholdPct: 20 }).kind).toBe('adjudicated')
  })

  it('CLOSES the substring problem a bare `includes` had', () => {
    // `no` inside `normal` and `not` inside `note` used to hold a perfectly gradeable prediction;
    // word boundaries are what fixed it, and this pins that they did.
    const normal = 'under normal free flow the platoon minimum time-to-collision shall rise by at least 20%'
    expect(evaluatePrediction(normal, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least', thresholdPct: 20 }).kind).toBe('adjudicated')
    const note = 'note that the platoon minimum time-to-collision shall rise by at least 20%'
    expect(evaluatePrediction(note, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least', thresholdPct: 20 }).kind).toBe('adjudicated')
  })

  it('reads the anchor from the clause naming the quantity, not from the whole sentence', () => {
    // `anchorBoundIn` takes a clause and requires the bound it finds there to be UNIQUE. The read is
    // scoped to the clause naming the measured quantity because a second clause may legitimately
    // carry its own anchor: read over the whole sentence, the sentence below states two distinct
    // bounds ("at least" for the threshold, "within" for the headway band) and holds, which is a
    // false refusal of an honest sentence. Scoped, it grades.
    // The proximity window this replaced went with `anchorBoundNear`: what makes a bound ambiguous is
    // a second anchor in the same CLAUSE, which is a uniqueness rule rather than a distance.
    const twoClauses = 'the platoon minimum time-to-collision shall rise by at least 20%, and the mean headway stays within its band'
    const verdict = evaluatePrediction(twoClauses, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least', thresholdPct: 20 })
    expect(verdict.kind).toBe('adjudicated')
    if (verdict.kind === 'adjudicated') expect(verdict.bound).toBe('at-least')

    // ...and inside ONE clause, two distinct bounds are a gap rather than a guess: nothing says which
    // of them the threshold is bound by, so the gate holds instead of resolving by table order. The
    // sentence carries both tokens, so what refuses it is the uniqueness rule and not their absence.
    const twoBounds = 'the platoon minimum time-to-collision shall rise by at least 20% within the baseline band'
    expect(twoBounds).toContain('at least')
    expect(twoBounds).toContain('within')
    const held = evaluatePrediction(twoBounds, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least', thresholdPct: 20 })
    expect(held.kind).toBe('unbindable')
    if (held.kind === 'unbindable') expect(held.reason).toContain('carries more than one')
  })
})

describe('the literals must be ATTACHED to the measured quantity, not merely present', () => {
  it('HOLDS the counterexample an auditor built: the number belongs to another quantity', () => {
    // Every check in this gate was an existence check — is the phrase there, the percentage, an
    // anchor, a direction word — and an auditor broke it a fourth time with all four present,
    // attached to something else:
    //
    //   "The platoon mean headway shall reduce by at least 20% while the minimum time-to-collision
    //    falls."
    //
    // The 20% and its anchor belong to MEAN HEADWAY. The sentence never says the measured quantity
    // moved 20%, and the gate reported `supported`. What refuses it is the clause scope: the number
    // and its anchor sit in the clause about headway, and the clause naming the measured quantity
    // states no percentage.
    //
    // THAT SCOPE IS NOT SOUNDNESS, and the module no longer claims it is. Four measured attempts to
    // establish where a number ATTACHES — a wider boundary table, requiring the phrase before the
    // direction structure, requiring it to be an argument of the predicate, and narrowing to one
    // template — all died on the same thing: the distinguishing material is predicate structure and
    // every literal proxy for it is an open class. So the scope can cut in the wrong place, and the
    // threshold is a DECLARED field for that reason: the verdict grades `commitment.thresholdPct`
    // and never a number read from the sentence. What the scope decides is only whether the sentence
    // states that number where the gate looks, and both failure directions are a HOLD.
    const sentence = 'The platoon mean headway shall reduce by at least 20% while the platoon minimum time-to-collision falls.'
    const verdict = evaluatePrediction(sentence, study, MEASURED_METRIC_KEY, { direction: 'decrease', bound: 'at-least', thresholdPct: 20 })
    expect(verdict.kind).toBe('unbindable')
    // ...and its mirror, where the number sits with the measured quantity and the direction does
    // not. Both are refused; either alone would have been graded.
    const mirrored = 'The platoon minimum time-to-collision shall fall while the platoon mean headway reduces by at least 20%.'
    expect(evaluatePrediction(mirrored, study, MEASURED_METRIC_KEY, { direction: 'decrease', bound: 'at-least', thresholdPct: 20 }).kind)
      .toBe('unbindable')
  })

  it('NEVER grades a scattered prediction (property, seeded)', () => {
    // A case table is how the previous four rounds were validated, and each round the next sentence
    // was outside the table. This generates combinations nobody wrote by hand and asserts the
    // invariant for all of them: when the phrase naming the measured quantity sits in one clause
    // and the number with its anchor in another, the gate must not adjudicate. Seeded, so a failure
    // reproduces exactly.
    // What makes it hold is the clause scope rather than a reading of where a number attaches — the
    // module records four measured attempts to establish that, all of which failed. The threshold is
    // DECLARED, so the number the verdict grades never comes out of the sentence; what the sentence
    // must do is state that number inside the clause the scope picks.
    const subjects = ['the platoon mean headway', 'the platoon minimum time-to-collision', 'the platoon mean jerk']
    const moves = ['shall reduce', 'shall fall', 'shall exceed', 'shall rise']
    const thresholds = ['by at least 20%', 'by at least 5%']
    const directionOf = (move: string): 'increase' | 'decrease' => (move === 'shall reduce' || move === 'shall fall' ? 'decrease' : 'increase')
    let seed = 20260914
    const pick = <T>(list: ReadonlyArray<T>): T => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return list[seed % list.length] as T
    }
    const MEASURED = 'the platoon minimum time-to-collision'
    let scattered = 0
    for (let i = 0; i < 1200; i++) {
      const numbered = pick(subjects)
      const named = pick(subjects)
      const move = pick(moves)
      const threshold = pick(thresholds)
      // The shape that has to hold is the one where the number rides with one subject and the
      // MEASURED PHRASE appears only in the other clause: `numbered` must not be the measured
      // subject (or the first clause states the requirement legitimately) and `named` must be.
      if (numbered === MEASURED || named !== MEASURED) continue
      const sentence = `${numbered} ${move} ${threshold} while ${named}.`
      // The declaration matches the number the sentence states, so the refusal cannot be blamed on
      // the declaration disagreeing with the prose: it is the scatter alone that stops the grading.
      const verdict = evaluatePrediction(sentence, study, MEASURED_METRIC_KEY, { direction: directionOf(move), bound: 'at-least', thresholdPct: threshold === thresholds[0] ? 20 : 5 })
      expect(verdict.kind, sentence).toBe('unbindable')
      scattered++
    }
    // The generator has to have actually generated the cases, or the loop proves nothing.
    expect(scattered).toBeGreaterThan(100)
    // ~270 of the generated sentences reach a real adjudication and every one of those runs BOTH
    // platoon simulations, so this case is seconds of wall clock on its own — over vitest's 5 s
    // default once the suite's workers are loaded, which is a timeout rather than a slow assertion.
    // The budget is raised rather than the sample reduced: the sample is what makes the property
    // worth asserting.
  }, 30_000)
})

describe('the shape requirement on the prose, and what it does not establish', () => {
  // The auditor that built these answered the question I had set it — "does a prohibition exist that
  // satisfies the shape?" — with yes, and its advice was to fix the CLAIM rather than the mechanism:
  // this is a check on the SHAPE of a sentence, not an analysis of its polarity, and extending the
  // word list for `neither` / `nor` / `none` would repeat the mistake the list was abandoned for.
  //
  // WHAT THE TWO PROHIBITION CASES BELOW RECORD. Both were written when the gate inferred a direction out of the
  // sentence, and the finding then was that the shape check let a prohibition through to a verdict.
  // They still reach a verdict — but no longer because a check failed. The verdict grades the
  // DECLARED threshold, which these claims state honestly, and a sentence's FORCE is outside what
  // this gate grades at all: a claim declaring that the measured quantity should fall by 20% is
  // graded on whether it did. A prohibition written in the required shape is a PROSE defect rather
  // than a graded one, and what it costs stays bounded by the declaration having to be honest — the
  // same demand the shape requirement makes from the other side. If a future change does start
  // reading a sentence's force, these fail and this note gets rewritten, which is why they are here.
  it('a prohibition that negates its SUBJECT is graded on its declaration', () => {
    const subjectNegation = 'Neither platoon shall fall short of the baseline minimum time-to-collision by at least 20%'
    // The direction word follows `shall` and no word on the negation list appears, so nothing in the
    // sentence marks it as a prohibition — and under the declared-threshold design nothing needs to.
    // The declaration says the quantity should fall by 20%, and the measurement fell 38.20%.
    const verdict = evaluatePrediction(subjectNegation, study, MEASURED_METRIC_KEY, { direction: 'decrease', bound: 'at-least', thresholdPct: 20 })
    expect(verdict.kind).toBe('adjudicated')
    if (verdict.kind === 'adjudicated') expect(verdict.supportsPrediction).toBe(true)
    expect(requirementDirectionIn(subjectNegation)).toBe('decrease')
  })

  it('a prohibition appended as a second clause is graded on its declaration too', () => {
    const appended = 'the platoon minimum time-to-collision shall fall by at least 20%; that outcome is forbidden'
    const verdict = evaluatePrediction(appended, study, MEASURED_METRIC_KEY, { direction: 'decrease', bound: 'at-least', thresholdPct: 20 })
    expect(verdict.kind).toBe('adjudicated')
    if (verdict.kind === 'adjudicated') expect(verdict.supportsPrediction).toBe(true)
  })

  it('...and what the shape requirement DOES refuse is unchanged', () => {
    // WHERE THESE HOLDS COME FROM, stated because it moved. Not from detecting a prohibition: the
    // two cases above are graded, and nothing on this path reads a sentence's force. They hold
    // because the direction word must immediately follow `shall`, so a negation in that position
    // leaves no direction word to read. That is the narrower property that survives — every phrasing
    // that does not state its direction as `shall <word>` holds, and none of them produces a verdict.
    for (const text of [
      'the platoon minimum time-to-collision shall not fall by at least 20%',
      'the platoon minimum time-to-collision shall never fall by at least 20%',
      'the platoon minimum time-to-collision shall refrain from falling by at least 20%',
      // Inflected forms are not base forms: `shall` takes the infinitive, so `reduces` is not the
      // word that can follow it, and the table no longer pretends otherwise.
      'the platoon minimum time-to-collision shall reduces by at least 20%',
    ]) {
      const verdict = evaluatePrediction(text, study, MEASURED_METRIC_KEY, { direction: 'decrease', bound: 'at-least', thresholdPct: 20 })
      expect(verdict.kind, text).toBe('unbindable')
    }
    // ...except the three base forms an auditor showed were missing from the table. They grade now,
    // and each is checked on its own sentence.
    expect(requirementDirectionIn('the platoon minimum time-to-collision shall reduce by at least 20%')).toBe('decrease')
    expect(requirementDirectionIn('the platoon minimum time-to-collision shall raise the minimum by at least 20%')).toBe('increase')
    expect(requirementDirectionIn('the platoon mean jerk shall drop by at least 20%')).toBe('decrease')
  })
})
