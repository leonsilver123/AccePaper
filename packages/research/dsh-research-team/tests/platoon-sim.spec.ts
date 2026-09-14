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
  anchorBoundNear,
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
    const verdict = evaluatePrediction(canonical, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least' })
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
    const increase = evaluatePrediction(rise, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least' })
    expect(increase.kind).toBe('adjudicated')
    if (increase.kind !== 'adjudicated') return
    expect(increase.direction).toBe('increase')
    expect(increase.supportsPrediction).toBe(false)

    // The SAME sentence declared as a FALL is refused, and that is the point of this being a
    // declared field rather than a free one: the sentence says "exceeds", the declaration says the
    // quantity should decrease, and the two contradict each other — the same class as the
    // truthfulness pair the loader refuses. A matching sentence IS graded as a fall instead.
    const declaredFall = evaluatePrediction(rise, study, MEASURED_METRIC_KEY, { direction: 'decrease', bound: 'at-least' })
    expect(declaredFall.kind).toBe('unbindable')
    if (declaredFall.kind === 'unbindable') expect(declaredFall.reason).toContain('the declaration and the sentence contradict each other')

    const fallen = 'the HV-AV-HV platoon shall fall in minimum time-to-collision by at least 20% against the all-HV platoon'
    const decrease = evaluatePrediction(fallen, study, MEASURED_METRIC_KEY, { direction: 'decrease', bound: 'at-least' })
    expect(decrease.kind).toBe('adjudicated')
    if (decrease.kind !== 'adjudicated') return
    expect(decrease.direction).toBe('decrease')
    expect(decrease.supportsPrediction).toBe(true)

    // A CAPPED commitment needs an anchor that SAYS so: declaring `at-most` against a sentence
    // anchored "at least" is the declaration contradicting the claim's own words, and the gate
    // refuses it rather than grading either half. The anchor is compared as a string, which is
    // wire-format validation and not a reading.
    const mismatched = evaluatePrediction(rise, study, MEASURED_METRIC_KEY, { direction: 'decrease', bound: 'at-most' })
    expect(mismatched.kind).toBe('unbindable')
    if (mismatched.kind === 'unbindable') expect(mismatched.reason).toContain('contradict each other')

    // Anchored to match, the cap is graded: a 38.20% fall is not "at most 20%".
    // The sentence names a direction AND an anchor that agree with what it declares.
    const cappedText = 'the HV-AV-HV platoon minimum time-to-collision shall rise by at most 20% against the all-HV platoon minimum'
    const capped = evaluatePrediction(cappedText, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-most' })
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
      { direction: 'increase', bound: 'at-least' },
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
    const verdict = evaluatePrediction(canonical, generous, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least' })
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

  it('holds a claim that states no numeric threshold', () => {
    const verdict = evaluatePrediction('the platoon minimum time-to-collision improves', study, MEASURED_METRIC_KEY)
    expect(verdict.kind).toBe('unbindable')
    if (verdict.kind === 'unbindable') expect(verdict.reason).toContain('states no numeric threshold')
  })

  it('DOCUMENTS the limit: a claim that merely MENTIONS the phrasing still binds', () => {
    // The false-positive direction, which the phrase check cannot close and which is pinned
    // here so a future change to it is visible rather than silent. No keyword test can
    // establish that a claim is ABOUT a quantity; it can only establish that the claim used
    // the words. The check is a NECESSARY condition and not a sufficient one.
    const verdict = evaluatePrediction(
      'the platoon string-stability index shall rise by at least 20%, unlike prior work on '
      + 'minimum time-to-collision that assumed uniform arrivals',
      study,
      MEASURED_METRIC_KEY,
      { direction: 'increase', bound: 'at-least' },
    )
    expect(verdict.kind).toBe('adjudicated')
  })
})

describe('the declaration is checked against the claim\'s own words', () => {
  // The gate grades two declared bits plus a number. Nothing tied them to the sentence, and an
  // audit showed that changing ONE declared field records a claim its own sentence refutes as
  // supported. Its proposed fix is what this tests: the sentence must carry a machine-readable
  // anchor beside the number, and the declared bound is compared to that token by string equality.
  const rise = 'the HV-AV-HV platoon shall exceed the all-HV platoon in minimum time-to-collision by at least 20%'

  it('REFUSES a declaration that contradicts the anchor the sentence states', () => {
    const mismatched = evaluatePrediction(rise, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-most' })
    expect(mismatched.kind).toBe('unbindable')
    if (mismatched.kind === 'unbindable') {
      expect(mismatched.reason).toContain('contradict each other')
      expect(mismatched.reason).toContain('at-least')
      expect(mismatched.reason).toContain('at-most')
    }
  })

  it('REFUSES a prediction with no anchor beside its number', () => {
    const unanchored = 'the HV-AV-HV platoon minimum time-to-collision exceeds the all-HV platoon minimum by 20%'
    const verdict = evaluatePrediction(unanchored, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least' })
    expect(verdict.kind).toBe('unbindable')
    if (verdict.kind === 'unbindable') expect(verdict.reason).toContain('no anchor beside it')
  })

  it('REFUSES a prediction stating more than one percentage', () => {
    // `thresholdFromPrediction` takes the FIRST percentage — unambiguous as a string, not as a
    // commitment. "Over 20% of the interval, the … shall exceed by at least 35%" grades 20 while
    // the sentence commits to 35.
    const twoNumbers = 'over 20% of the simulated interval, the platoon minimum time-to-collision shall exceed the all-HV baseline by at least 35%'
    expect(percentagesIn(twoNumbers)).toEqual([20, 35])
    const verdict = evaluatePrediction(twoNumbers, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least' })
    expect(verdict.kind).toBe('unbindable')
    if (verdict.kind === 'unbindable') expect(verdict.reason).toContain('states 2 percentages')
  })

  it('grades a TWO-SIDED tolerance, which a boolean bound could not express', () => {
    // The one boundary of the audit's three that produced a false positive on its own: declared as
    // a cap, a 38.20% fall was graded `-38.20 <= 20` → SUPPORTED for a claim that a 38% fall
    // plainly violates. The declaration was honest; the model could not express it.
    const within = 'the platoon minimum time-to-collision against the all-HV baseline shall rise within 40%'
    const verdict = evaluatePrediction(within, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'within' })
    expect(verdict.kind).toBe('adjudicated')
    if (verdict.kind !== 'adjudicated') return
    expect(verdict.bound).toBe('within')
    // |−38.20| <= 40 → met. Tighten the tolerance past the measured change and it is missed.
    expect(verdict.supportsPrediction).toBe(true)
    const tight = evaluatePrediction(
      'the platoon minimum time-to-collision against the all-HV baseline shall rise within 10%',
      study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'within' },
    )
    expect(tight.kind === 'adjudicated' && tight.supportsPrediction).toBe(false)
  })

  it('HOLDS a sentence that names both directions, and one that names none', () => {
    // Ambiguity is a gap, not a contradiction: the gate cannot tell which word the claim means, so
    // it holds. Every outcome of this check is either agreement or a hold — a missed word, a
    // spurious word or an ambiguous sentence can only make the gate STRICTER, never hand out a
    // pass. That property is what separates it from the prose reader this batch deleted.
    const both = 'the platoon minimum time-to-collision rises under the AV and falls under the all-HV platoon by at least 20%'
    const ambiguous = evaluatePrediction(both, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least' })
    expect(ambiguous.kind).toBe('unbindable')
    if (ambiguous.kind === 'unbindable') expect(ambiguous.reason).toContain('required form')

    const none = 'the platoon minimum time-to-collision against the all-HV platoon by at least 20%'
    const silent = evaluatePrediction(none, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least' })
    expect(silent.kind).toBe('unbindable')
    if (silent.kind === 'unbindable') expect(silent.reason).toContain('required form')
  })

  it('HOLDS a PROHIBITION, which the anchors cannot tell from a requirement', () => {
    // The counterexample an auditor built after I claimed a mismatched anchor could only make the
    // gate stricter. It is a prohibition — a 38.20% fall VIOLATES it — yet `fall` reads as
    // `decrease`, `≥` reads as `at-least`, and BOTH agree with this declaration, so the gate graded
    // the prohibition as a requirement and reported `supported`.
    const prohibition = 'The insertion of one AV shall not cause the platoon minimum time-to-collision to fall by ≥ 20% relative to the all-HV baseline'
    const verdict = evaluatePrediction(prohibition, study, MEASURED_METRIC_KEY, { direction: 'decrease', bound: 'at-least' })
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
      const verdict = evaluatePrediction(text, study, MEASURED_METRIC_KEY, { direction: 'decrease', bound: 'at-least' })
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
      const verdict = evaluatePrediction(text, study, MEASURED_METRIC_KEY, { direction: 'decrease', bound: 'at-least' })
      // All three hold. WHICH guard catches them differs and is not the point — `refrain` has no
      // negation word and is caught by the SHAPE, the other two by the negation guard that runs
      // first. That both reach the same safe answer from different directions is the point.
      expect(verdict.kind, text).toBe('unbindable')
    }
    const refrain = evaluatePrediction(
      'the HV-AV-HV platoon shall refrain from falling in minimum time-to-collision by at least 20%',
      study, MEASURED_METRIC_KEY, { direction: 'decrease', bound: 'at-least' },
    )
    expect(refrain.kind === 'unbindable' && refrain.reason).toContain('required form')
    // The positive form of the same sentence is graded, whatever its case.
    for (const text of [
      'the HV-AV-HV platoon shall fall in minimum time-to-collision by at least 20%',
      'the HV-AV-HV platoon SHALL FALL in minimum time-to-collision by at least 20%',
    ]) {
      expect(requirementDirectionIn(text), text).toBe('decrease')
      expect(evaluatePrediction(text, study, MEASURED_METRIC_KEY, { direction: 'decrease', bound: 'at-least' }).kind, text).toBe('adjudicated')
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
      const verdict = evaluatePrediction(text, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-most' })
      expect(verdict.kind, text).toBe('unbindable')
      if (verdict.kind === 'unbindable') expect(verdict.reason).toContain('contains a negation')
    }
    // The non-negated form of the same cap IS graded.
    const positive = 'the platoon minimum time-to-collision shall rise by at most 20% above the all-HV baseline'
    expect(anchorBoundNear(positive, 20)).toBe('at-most')
    expect(evaluatePrediction(positive, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-most' }).kind).toBe('adjudicated')
  })

  it('CLOSES the substring problem a bare `includes` had', () => {
    // `no` inside `normal` and `not` inside `note` used to hold a perfectly gradeable prediction;
    // word boundaries are what fixed it, and this pins that they did.
    const normal = 'under normal free flow the platoon minimum time-to-collision shall rise by at least 20%'
    expect(evaluatePrediction(normal, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least' }).kind).toBe('adjudicated')
    const note = 'note that the platoon minimum time-to-collision shall rise by at least 20%'
    expect(evaluatePrediction(note, study, MEASURED_METRIC_KEY, { direction: 'increase', bound: 'at-least' }).kind).toBe('adjudicated')
  })

  it('reads the anchor only from beside the number', () => {
    // An anchor elsewhere in the sentence is not the one the threshold is bound by.
    expect(anchorBoundNear(rise, 20)).toBe('at-least')
    expect(anchorBoundNear('at least the platoon minimum time-to-collision is checked, within 20% of it', 20)).toBe('within')
  })
})
