/**
 * The C channel's experiment engine.
 *
 * These tests do not check that a fixture table was read; they check that running
 * the two policies against the same demand produces a measurement, and that the
 * measurement behaves the way the underlying traffic model says it must. The
 * load-bearing test is `both policies select the SAME plan for the same demand`:
 * it pins that the comparison is between two CONTROL STRATEGIES rather than between
 * two different algorithms, which is what makes the measured reduction attributable
 * to adaptivity. The steady-demand test pins the falsifiable direction: with nothing
 * to adapt to, there must be no gain.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_POLICY_BOUNDS,
  comparePolicies,
  designInterval,
  experimentScenario,
  runAdaptivePolicy,
  runFixedTimePolicy,
  selectPlan,
  thresholdFromPrediction,
  websterOptimalCycle,
  type TrafficScenario,
} from '../src/runner/traffic-sim.ts'
import { STUDY_DEMAND_INTERVALS } from '../src/runner/study-demand.ts'

const BASE: Omit<TrafficScenario, 'demandPerPhase'> = {
  intervals: 6,
  intervalSeconds: 4 * 3600,
  lostTimeSeconds: 8,
  saturationFlowPerLane: 1800,
  minCycleSeconds: 40,
  maxCycleSeconds: 120,
}

/** Same demand in every interval: the design interval equals all of them. */
const STEADY = [[700, 300], [700, 300], [700, 300], [700, 300], [700, 300], [700, 300]] as const

/** A quiet night, a heavy day: the design interval is the peak, not the mean. */
const SWINGING = [[60, 40], [300, 200], [800, 530], [900, 600], [700, 460], [200, 130]] as const

describe('traffic-sim experiment engine', () => {
  it('produces a finite, physically plausible delay for a realistic demand', () => {
    const result = runFixedTimePolicy({ ...BASE, demandPerPhase: STEADY })

    // A signalised approach under unsaturated demand delays vehicles by seconds, not
    // minutes; a value outside this band means the model, not the traffic, is wrong.
    expect(result.meanDelaySecondsPerVehicle).toBeGreaterThan(0)
    expect(result.meanDelaySecondsPerVehicle).toBeLessThan(120)
    expect(result.intervals).toHaveLength(BASE.intervals)
  })

  it('holds one fixed-time plan across every interval (that is what fixed means)', () => {
    const result = runFixedTimePolicy({ ...BASE, demandPerPhase: SWINGING })

    const first = result.intervals[0]
    for (const interval of result.intervals) {
      expect(interval.greenSplit).toEqual(first?.greenSplit)
      expect(interval.cycleSeconds).toBe(first?.cycleSeconds)
    }
  })

  it('designs the fixed-time plan for the busiest interval, not the average', () => {
    // Real fixed-time practice designs for the design-hour flow. Pinned because
    // designing for the mean would produce a plan that is infeasible at the peak and
    // would quietly change what the adaptive policy is being compared against.
    const scenario: TrafficScenario = { ...BASE, demandPerPhase: SWINGING }
    const result = runFixedTimePolicy(scenario)

    expect(designInterval(scenario)).toBe(3)
    expect(result.intervals[0]?.cycleSeconds)
      .toBeCloseTo(websterOptimalCycle(scenario, SWINGING[3]), 9)
  })

  it('recomputes the adaptive plan from each interval\'s own demand', () => {
    const result = runAdaptivePolicy({ ...BASE, demandPerPhase: SWINGING })

    // The cycle is shortest where the demand is lightest and longest where it is
    // heaviest, and every cycle stays inside the declared band.
    const quiet = result.intervals[0]
    const peak = result.intervals[3]
    expect(quiet?.cycleSeconds).toBeLessThan(peak?.cycleSeconds ?? 0)
    for (const interval of result.intervals) {
      expect(interval.cycleSeconds).toBeGreaterThanOrEqual(BASE.minCycleSeconds)
      expect(interval.cycleSeconds).toBeLessThanOrEqual(BASE.maxCycleSeconds)
      expect(interval.greenSplit[0]).toBeGreaterThanOrEqual(DEFAULT_POLICY_BOUNDS.minShare * 0.5)
    }
  })

  it('selects the SAME plan for the same demand, for both policies', () => {
    // The comparison is between two control strategies, not two algorithms: the
    // fixed policy's plan for the design interval and the adaptive policy's plan for
    // that same interval are the same plan by construction. If they ever diverge,
    // the measured reduction is attributable to the algorithm rather than to
    // adaptivity, and this experiment would no longer support its own claim.
    const scenario: TrafficScenario = { ...BASE, demandPerPhase: SWINGING }
    const fixed = runFixedTimePolicy(scenario)
    const adaptive = runAdaptivePolicy(scenario)
    const design = designInterval(scenario)

    const fixedAtDesign = fixed.intervals[design]
    const adaptiveAtDesign = adaptive.intervals[design]
    expect(adaptiveAtDesign?.cycleSeconds).toBeCloseTo(fixedAtDesign?.cycleSeconds ?? -1, 9)
    expect(adaptiveAtDesign?.greenSplit[0]).toBeCloseTo(fixedAtDesign?.greenSplit[0] ?? -1, 9)
    expect(fixedAtDesign?.delaySecondsPerVehicle).toEqual(adaptiveAtDesign?.delaySecondsPerVehicle)
  })

  it('respects the split bounds the caller declares', () => {
    const scenario: TrafficScenario = { ...BASE, demandPerPhase: SWINGING }
    const plan = selectPlan(scenario, [1000, 10], { minShare: 0.4, maxShare: 0.6 })

    // Demand-proportional would be 0.99; the bound is what applies.
    expect(plan.splitShare).toBe(0.6)
  })

  it('returns the longest cycle the band allows when demand is at saturation', () => {
    // Webster's optimum is undefined at Y >= 1. The model must not invent a finite
    // cycle there: it reports the band's ceiling and lets the delay term show the
    // oversaturation as the 999 sentinel.
    const scenario: TrafficScenario = { ...BASE, demandPerPhase: SWINGING }
    expect(websterOptimalCycle(scenario, [1800, 1800])).toBe(BASE.maxCycleSeconds)
  })

  it('quantifies the relative reduction against the baseline', () => {
    const comparison = comparePolicies({ ...BASE, demandPerPhase: SWINGING })

    expect(comparison.baseline.policy).toBe('fixed-time')
    expect(comparison.variant.policy).toBe('adaptive')
    expect(comparison.relativeReductionPct).toBeGreaterThan(0)
    expect(comparison.meetsThreshold(0)).toBe(true)
    expect(comparison.meetsThreshold(1000)).toBe(false)
  })

  it('yields no benefit when the demand is perfectly steady (the model is falsifiable)', () => {
    // With one demand there is only one plan, so both policies run the same cycle
    // and the same split. If this ever reported a gain, the comparison would be
    // measuring something other than demand responsiveness.
    const comparison = comparePolicies({ ...BASE, demandPerPhase: STEADY })

    expect(comparison.relativeReductionPct).toBe(0)
  })

  it('attributes the benefit to the cycle a quiet interval can run', () => {
    // Pins the MECHANISM, not just the sign: fixed-time is frozen at the design
    // cycle, so its delay in a quiet interval is higher even though both policies
    // use the same split rule. A change that produced a reduction some other way
    // would fail here.
    const scenario: TrafficScenario = { ...BASE, demandPerPhase: SWINGING }
    const comparison = comparePolicies(scenario)

    const quiet = 0
    const fixedQuiet = comparison.baseline.intervals[quiet]
    const adaptiveQuiet = comparison.variant.intervals[quiet]
    expect(adaptiveQuiet?.cycleSeconds).toBeLessThan(fixedQuiet?.cycleSeconds ?? 0)
    expect(adaptiveQuiet?.delaySecondsPerVehicle[0]).toBeLessThan(fixedQuiet?.delaySecondsPerVehicle[0] ?? 0)
  })

  it('does not claim a benefit where the design interval is the run\'s only demand', () => {
    // Counter-case for the previous tests: a profile that sits at the design demand
    // at every interval is exactly the case adaptive control has nothing to offer,
    // and the experiment must say so rather than report a flattering number.
    const flatAtPeak = [[900, 600], [900, 600], [900, 600], [900, 600], [900, 600], [900, 600]] as const
    const comparison = comparePolicies({ ...BASE, demandPerPhase: flatAtPeak })

    expect(comparison.relativeReductionPct).toBe(0)
  })

  it('reads the threshold the prediction commits to, and refuses a prediction without one', () => {
    expect(thresholdFromPrediction('mean delay falls by at least 5% under adaptive control')).toBe(5)
    expect(thresholdFromPrediction('delay drops 7.25% versus fixed-time')).toBe(7.25)
    expect(thresholdFromPrediction('adaptive control performs better')).toBeUndefined()
  })
})

describe('the study scenario', () => {
  it('runs against the measured demand, with no demand array written into the source', () => {
    const scenario = experimentScenario()

    expect(scenario.intervals).toBe(STUDY_DEMAND_INTERVALS.length)
    expect(scenario.demandPerPhase).toEqual(STUDY_DEMAND_INTERVALS.map(i => i.demandPerPhase))
    // The profile is measured, so it is NOT constant across intervals — which is the
    // property the whole comparison rests on.
    const totals = scenario.demandPerPhase.map(d => d[0] + d[1])
    expect(new Set(totals).size).toBeGreaterThan(1)
  })

  it('measures a real reduction on the measured profile', () => {
    const comparison = comparePolicies(experimentScenario())

    // The measured profile is not steady, so the adaptive policy has something to
    // work with. The number itself is pinned in the C-channel test, not here.
    expect(comparison.relativeReductionPct).toBeGreaterThan(0)
    expect(comparison.relativeReductionPct).toBeLessThan(100)
    expect(Number.isFinite(comparison.variant.meanDelaySecondsPerVehicle)).toBe(true)
  })
})
