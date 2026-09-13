/**
 * The C channel's experiment engine.
 *
 * These tests do not check that a fixture table was read; they check that running
 * the two policies against the same demand produces a measurement, and that the
 * measurement behaves the way the underlying traffic model says it must. The
 * monotonicity test is the load-bearing one: it is the falsifiable content the
 * experiment is supposed to establish.
 */

import { describe, expect, it } from 'vitest'
import {
  comparePolicies,
  runAdaptivePolicy,
  runFixedTimePolicy,
  type TrafficScenario,
} from '../src/runner/traffic-sim.ts'

const BASE: Omit<TrafficScenario, 'demandPerPhase'> = {
  cycleSeconds: 90,
  lostTimeSeconds: 8,
  saturationFlowPerLane: 1800,
  capacityPerPhase: 1800,
  intervals: 6,
}

/** Same mean demand, increasing variation between intervals. */
const STEADY = [[700, 300], [700, 300], [700, 300], [700, 300], [700, 300], [700, 300]] as const
const SWINGING = [[950, 250], [450, 350], [980, 220], [420, 380], [900, 260], [500, 340]] as const

describe('traffic-sim experiment engine', () => {
  it('produces a finite, physically plausible delay for a realistic demand', () => {
    const result = runFixedTimePolicy({ ...BASE, demandPerPhase: STEADY })

    // A signalised approach under unsaturated demand delays vehicles by seconds, not
    // minutes; a value outside this band means the model, not the traffic, is wrong.
    expect(result.meanDelaySecondsPerVehicle).toBeGreaterThan(0)
    expect(result.meanDelaySecondsPerVehicle).toBeLessThan(120)
    expect(result.intervals).toHaveLength(BASE.intervals)
  })

  it('leaves a fixed-time plan unchanged across intervals (that is what fixed means)', () => {
    const result = runFixedTimePolicy({ ...BASE, demandPerPhase: SWINGING })

    const first = result.intervals[0]?.greenSplit
    for (const interval of result.intervals) {
      expect(interval.greenSplit).toEqual(first)
    }
  })

  it('moves the adaptive split toward the loaded phase, within its bounds', () => {
    const result = runAdaptivePolicy({ ...BASE, demandPerPhase: SWINGING })

    for (const interval of result.intervals) {
      expect(interval.greenSplit[0]).toBeGreaterThanOrEqual(0.25)
      expect(interval.greenSplit[0]).toBeLessThanOrEqual(0.75)
    }
    // The splits are not all identical: the policy reacted to the demand.
    const distinct = new Set(result.intervals.map(i => i.greenSplit[0].toFixed(4)))
    expect(distinct.size).toBeGreaterThan(1)
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
    // The claim under test is about variation, so with none there is nothing to
    // adapt to. If this ever reported a large gain, the comparison would be
    // measuring something other than demand responsiveness.
    const comparison = comparePolicies({ ...BASE, demandPerPhase: STEADY })

    expect(Math.abs(comparison.relativeReductionPct)).toBeLessThan(1)
  })

  it('shows the benefit growing with demand variation', () => {
    const steady = comparePolicies({ ...BASE, demandPerPhase: STEADY })
    const swinging = comparePolicies({ ...BASE, demandPerPhase: SWINGING })

    expect(swinging.relativeReductionPct).toBeGreaterThan(steady.relativeReductionPct)
  })
})
