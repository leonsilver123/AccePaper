/**
 * The second study — a different domain, metric, direction and data shape.
 *
 * THE REVIEW'S R03 IS THE REASON THIS FILE EXISTS. The "second task family" the earlier unit shipped
 * was the SAME study with its claim reversed: the same simulator, the same metric, the same figure,
 * the same sections. That proves the pipeline can report support and refutation; it does not prove it
 * can run a study that is not this one. What is tested here is the part that genuinely differs, and
 * what is recorded as NOT yet covered is the part of the execution path that is still platoon-shaped.
 */
import { describe, expect, it } from 'vitest'
import {
  LATENCY_INPUTS, LATENCY_METRIC, LATENCY_RULE_VERSION, compareLatency, declaredTrace,
  latencyHashOf, percentileMs, serveCoalesced, serveIndividually,
} from '../src/runner/service-latency-sim.ts'
import { SUPPORTED_IMPLEMENTATIONS, implementationOf } from '../src/runner/implementations.ts'
import { declaredMetricKeyOf, implementationForPlan } from '../src/runner/study-plan.ts'
import { checkMetricDeclaration, metricDefinition, metricsForStudy } from '../src/runner/metrics.ts'

describe('the quantity the second study measures', () => {
  it('is a different quantity, in a different unit, with the opposite direction', () => {
    // THE POINT OF A SECOND STUDY: a rule that assumed the first one's direction ("higher is better")
    // or its unit is wrong here, and the deployment's registry has to know this metric for the study
    // to run at all.
    expect(LATENCY_METRIC.unit).toBe('ms')
    expect(LATENCY_METRIC.direction).toBe('lower-is-better')
    expect(LATENCY_METRIC.key).not.toBe('min-ttc-seconds')
  })

  it('is declared in the deployment registry, with the study that measures it', () => {
    // THE DECLARATION AND THE STUDY-SCOPED VIEW, both of which this study needed and neither of
    // which existed when it was written: without them a run of it would be refused at the start for a
    // metric the deployment did not declare, or would report the other study's metrics as its own.
    const refusals = checkMetricDeclaration({
      key: LATENCY_METRIC.key,
      unit: LATENCY_METRIC.unit,
      direction: LATENCY_METRIC.direction,
    })
    expect(refusals).toEqual([])
    // AND IT IS THE SECOND STUDY'S, not the first one's: the registry says which study declares each
    // quantity, so a run's own metrics are read off its study rather than off the research type.
    expect(metricDefinition(LATENCY_METRIC.key)?.study).toBe('service-latency-coalescing')
    expect(metricsForStudy('service-latency-coalescing').required.map(entry => entry.key))
      .toEqual([LATENCY_METRIC.key])
  })
})

describe('the study’s measurement', () => {
  it('runs a queue below capacity, so the comparison is about coalescing and not about overload', () => {
    // A RATE ABOVE THE SERVER'S CAPACITY measures an overload: latency grows without bound and the
    // comparison reports the instability rather than the mechanism the claim is about.
    const capacityPerSecond = 1000 / LATENCY_INPUTS.meanServiceMs
    expect(LATENCY_INPUTS.arrivalRatePerSecond).toBeLessThan(capacityPerSecond)
    const run = serveIndividually(declaredTrace())
    const measured = percentileMs(run.latenciesMs, LATENCY_INPUTS.percentile)
    expect(measured).toBeGreaterThan(0)
    expect(Number.isFinite(measured)).toBe(true)
  })

  it('reports both arms from the same trace, and the change between them', () => {
    const comparison = compareLatency()
    expect(comparison.baseline.p95Ms).toBeGreaterThan(comparison.variant.p95Ms)
    // Negative means the tail got SHORTER, which for a lower-is-better metric is an improvement —
    // and the sign convention is the record's, stated once in `result-version.ts`.
    expect(comparison.relativeImprovementPct).toBeLessThan(0)
  })

  it('carries the series its figure needs, built from the same two runs', () => {
    // THE FIGURE'S DATA IS NOT RE-DERIVED ANYWHERE ELSE: a series plotted from a second computation
    // could disagree with the number the claim is graded on.
    const comparison = compareLatency()
    expect(comparison.series.bucket.length).toBeGreaterThan(1)
    expect(comparison.series.baseline.length).toBe(comparison.series.bucket.length)
    expect(comparison.series.variant.length).toBe(comparison.series.bucket.length)
    expect(comparison.series.baseline[0]).toBeGreaterThan(comparison.series.variant[0] ?? 0)
  })

  it('hashes the numbers it was built from, so two records are comparable', () => {
    const comparison = compareLatency()
    // THE SAME MEASUREMENT IS THE SAME RECORD, which is what makes two runs comparable at all.
    expect(latencyHashOf(comparison)).toBe(latencyHashOf(compareLatency()))
    expect(latencyHashOf(comparison)).toHaveLength(64)
    // AND A DIFFERENT MEASUREMENT IS NOT. The first version of this case hashed the same call twice
    // and never moved a number, so a digest that ignored the comparison — a constant, or one taken
    // over the metric key alone — satisfied it. `result-version.spec.ts` is the same case for the
    // other study, and it varies its input for this reason.
    const moved = { ...comparison, relativeImprovementPct: comparison.relativeImprovementPct + 1 }
    expect(latencyHashOf(moved)).not.toBe(latencyHashOf(comparison))
  })

  it('batching actually forms, which is what makes the variant a variant', () => {
    // A WINDOW NARROWER THAN THE INTER-ARRIVAL SPACING admits one request at a time, and the variant
    // would be the baseline under another name — a study that measured nothing while reporting a
    // comparison.
    const spacingMs = 1000 / LATENCY_INPUTS.arrivalRatePerSecond
    expect(LATENCY_INPUTS.coalescingWindowMs).toBeGreaterThan(spacingMs)
    const trace = declaredTrace()
    const coalesced = serveCoalesced(trace)
    expect(coalesced.busyMs).toBeLessThan(serveIndividually(trace).busyMs)
  })
})

describe('a plan about a quantity no implementation measures', () => {
  it('is refused, naming what this runner can measure', () => {
    const refused = implementationForPlan({ metric: { key: 'co2-per-km' } })
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.reason).toContain('no implementation this runner has can measure')
    // The refusal names what IS available, so a caller can see the distance rather than guess it.
    expect(refused.reason).toContain('min-ttc-seconds')
    expect(refused.reason).toContain('p95-latency-ms')
  })

  it('is refused when the plan declares no metric at all', () => {
    expect(implementationForPlan({ title: 'a study' }).ok).toBe(false)
    expect(declaredMetricKeyOf({ title: 'a study' })).toBeUndefined()
  })
})

describe('a plan about the second study', () => {
  it('resolves to the implementation that measures it', () => {
    // THE GENERIC ENTRY: the plan says what it is about and the runner answers with the study it can
    // run — which is what makes a second study reachable at all.
    const resolved = implementationForPlan({ metric: { key: LATENCY_METRIC.key } })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.implementation.id).toBe('service-latency-coalescing')
    expect(resolved.implementation.metric.direction).toBe('lower-is-better')
    expect(resolved.implementation.version).toBe(LATENCY_RULE_VERSION)
    expect(declaredMetricKeyOf({ metric: { key: LATENCY_METRIC.key } })).toBe(LATENCY_METRIC.key)
  })

  it('declares what the two arms differ in, read from the simulation’s own constants', () => {
    const implementation = implementationOf({ implementationId: 'service-latency-coalescing' } as never)
    expect(implementation?.varied.map(entry => entry.field)).toEqual(['coalescingWindowMs', 'maxBatch'])
    expect(implementation?.varied[0]?.variant).toBe(LATENCY_INPUTS.coalescingWindowMs)
    expect(implementation?.equations.length).toBeGreaterThan(2)
  })

  it('is one of two implementations this process can run, and neither is the other renamed', () => {
    expect(SUPPORTED_IMPLEMENTATIONS.map(entry => entry.id))
      .toEqual(['idm-platoon-simulation', 'service-latency-coalescing'])
    const metrics = SUPPORTED_IMPLEMENTATIONS.map(entry => entry.metric.key)
    expect(new Set(metrics).size).toBe(metrics.length)
  })
})
