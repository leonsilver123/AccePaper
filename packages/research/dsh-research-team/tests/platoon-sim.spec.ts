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
    // The metric the Case Pack's own mock rows are written in. At the declared headways an
    // IDM platoon cannot reach `TTC < 1.5 s` — the smallest TTC a leader stopping dead can
    // produce is `(s0 + v·T)/v`, above 1.5 s — so this rate is measured and REPORTED, and is
    // deliberately not the quantity the claim binds to. A future change that made the rate
    // nonzero would move this test, which is the point of pinning it.
    const result = runPlatoon(study.variant)
    expect(result.ttcLt1_5RatePct).toBe(0)
    expect(result.samples).toBeGreaterThan(0)
    expect(SIMULATION_INPUTS.ttcThresholdSeconds).toBe(1.5)
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
  const canonical = 'the HV-AV-HV platoon minimum time-to-collision exceeds the all-HV platoon minimum by at least 20%'

  it('adjudicates the bound quantity and reports the measured direction', () => {
    const verdict = evaluatePrediction(canonical, study, MEASURED_METRIC_KEY)
    expect(verdict.kind).toBe('adjudicated')
    if (verdict.kind !== 'adjudicated') return
    expect(verdict.supportsPrediction).toBe(false)
    expect(verdict.improvementPct).toBeLessThan(0)
    expect(verdict.thresholdPct).toBe(20)
    expect(verdict.matchedPhrase).toBe('minimum time-to-collision')
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
          AV: { ...study.variant.vehicleClasses.AV, desiredHeadwaySeconds: 3.0 },
        },
      },
    }
    const verdict = evaluatePrediction(canonical, generous, MEASURED_METRIC_KEY)
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
      'the platoon string-stability index improves by at least 20%, unlike prior work on '
      + 'minimum time-to-collision that assumed uniform arrivals',
      study,
      MEASURED_METRIC_KEY,
    )
    expect(verdict.kind).toBe('adjudicated')
  })
})
