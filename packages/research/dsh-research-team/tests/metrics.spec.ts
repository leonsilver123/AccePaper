/**
 * Metric semantics — the registry, and the declarations it refuses.
 *
 * THE REFUSALS ARE THE POINT. A registry that accepts whatever a study declares is a comment; what
 * makes it a rule is that a value in the wrong unit, or a direction that contradicts the definition,
 * is REFUSED rather than reconciled. Both directions of each rule are tested, because a check that
 * never fires and one that always fires are indistinguishable when only one side is exercised.
 */
import { describe, expect, it } from 'vitest'
import {
  METRIC_REGISTRY, checkMetricDeclaration, metricDefinition, metricsFor, metricsForStudy,
  requireMetricDeclaration,
} from '../src/runner/metrics.ts'
import { MEASURED_METRIC } from '../src/runner/platoon-sim.ts'

/** The registered declaration for the shipped study's metric. */
const SHIPPED = { key: 'min-ttc-seconds', unit: 's', direction: 'higher-is-better' } as const

describe('a declaration the registry agrees with', () => {
  it('is accepted', () => {
    expect(checkMetricDeclaration(SHIPPED)).toEqual([])
  })

  it('is accepted for every metric the deployment declares', () => {
    // The registry and its own declarations cannot drift: this asserts the table against itself, so a
    // definition added with a mismatched direction fails here rather than at a run.
    for (const definition of METRIC_REGISTRY) {
      expect(checkMetricDeclaration({
        key: definition.key, unit: definition.unit, direction: definition.direction,
      }), definition.key).toEqual([])
    }
  })
})

describe('a declaration the registry refuses', () => {
  it('refuses a metric nothing defines', () => {
    const refusals = checkMetricDeclaration({ key: 'novelty-score', unit: 'ratio', direction: 'higher-is-better' })
    expect(refusals.map(refusal => refusal.code)).toEqual(['metric-unknown'])
    expect(refusals[0]?.detail).toContain('cannot be compared with anything')
  })

  it('refuses the same quantity in another unit, and says both sides', () => {
    // THE UNIT IS COMPARED, NEVER CONVERTED: a study reporting the metric in milliseconds measured a
    // value nothing else in this deployment can be compared against.
    const refusals = checkMetricDeclaration({ ...SHIPPED, unit: 'ms' })
    expect(refusals.map(refusal => refusal.code)).toEqual(['metric-unit-mismatch'])
    expect(refusals[0]?.detail).toContain("'ms'")
    expect(refusals[0]?.detail).toContain("'s'")
  })

  it('refuses a direction that contradicts what the metric means', () => {
    // THE DEFECT THE QUALITY BASELINE CATCHES IN PROSE, refused here at the declaration: calling a
    // fall in time-to-collision an improvement.
    const refusals = checkMetricDeclaration({ ...SHIPPED, direction: 'lower-is-better' })
    expect(refusals.map(refusal => refusal.code)).toEqual(['metric-direction-mismatch'])
    // The refusal carries the interpretation, so the reader learns what the metric means rather than
    // only that their value was wrong.
    expect(refusals[0]?.detail).toContain('a fall is a worsening')
  })

  it('reports both disagreements when a declaration has both', () => {
    expect(checkMetricDeclaration({ key: 'min-ttc-seconds', unit: 'ms', direction: 'lower-is-better' })
      .map(refusal => refusal.code))
      .toEqual(['metric-unit-mismatch', 'metric-direction-mismatch'])
  })
})

describe('the declaration a run must be able to make', () => {
  it('passes the shipped study\'s own metric', () => {
    // THE STUDY'S OWN DECLARATION, read from where the run reads it rather than restated here: the
    // run calls this on every start, so a study that drifted from the registry would refuse to run.
    expect(() => {
      requireMetricDeclaration({
        key: MEASURED_METRIC.key, unit: MEASURED_METRIC.unit, direction: MEASURED_METRIC.direction,
      })
    }).not.toThrow()
  })

  it('refuses a study measuring the registered metric in another unit, naming both sides', () => {
    expect(() => { requireMetricDeclaration({ ...SHIPPED, unit: 'ms' }) })
      .toThrow(/'ms'[\s\S]*'s'/)
  })

  it('lists every disagreement at once, so one resolution fixes all of them', () => {
    expect(() => {
      requireMetricDeclaration({ key: 'min-ttc-seconds', unit: 'ms', direction: 'lower-is-better' })
    }).toThrow(/metric-unit-mismatch[\s\S]*metric-direction-mismatch/)
  })

  it('refuses a quantity nothing defines, rather than adopting its meaning from the study', () => {
    // THE PIPELINE MUST NOT INVENT WHAT A METRIC MEANS. A study measuring a quantity this deployment
    // has not declared would have its direction read out of the study's own field, which is the
    // arrangement the registry exists to replace — so it is refused until the deployment declares it.
    expect(() => {
      requireMetricDeclaration({ key: 'novelty-score', unit: 'ratio', direction: 'higher-is-better' })
    }).toThrow(/metric-unknown/)
  })
})

describe('required and not-applicable are different facts', () => {
  it('says what a simulation study requires, and what simply is not part of it', () => {
    // THE TYPE-LEVEL VIEW IS A UNION OF THE STUDIES THAT TYPE CONTAINS: with two simulation studies
    // it names both quantities, and says which metrics belong to other kinds of work entirely.
    const simulation = metricsFor('simulation-study')
    expect(simulation.required.map(definition => definition.key))
      .toEqual(['min-ttc-seconds', 'string-stability-index', 'p95-latency-ms'])
    // A review's metric is not missing from a simulation study: it does not belong to it.
    expect(simulation.notApplicable.map(definition => definition.key)).toEqual(['citation-coverage'])
  })

  it('says the same for a literature review', () => {
    const review = metricsFor('literature-review')
    expect(review.required.map(definition => definition.key)).toEqual(['citation-coverage'])
    expect(review.notApplicable.map(definition => definition.key))
      .toEqual(['min-ttc-seconds', 'string-stability-index', 'p95-latency-ms'])
  })

  it('separates the metrics of one STUDY from the metrics of another', () => {
    // THE LEVEL A RUN'S OWN METRICS ARE READ AT. Two studies can share a research type and share no
    // quantity: a run conducted as one of them requires its own metrics and reports the other's as
    // belonging elsewhere, which is what the package's `declaredMetrics` states.
    const platoon = metricsForStudy('idm-platoon-simulation')
    expect(platoon.required.map(definition => definition.key))
      .toEqual(['min-ttc-seconds', 'string-stability-index'])
    expect(platoon.notApplicable.map(definition => definition.key))
      .toEqual(['citation-coverage', 'p95-latency-ms'])

    const latency = metricsForStudy('service-latency-coalescing')
    expect(latency.required.map(definition => definition.key)).toEqual(['p95-latency-ms'])
    expect(latency.notApplicable.map(definition => definition.key))
      .toEqual(['min-ttc-seconds', 'string-stability-index', 'citation-coverage'])
  })

  it('says which study declares each metric, so nothing is reachable by accident', () => {
    for (const definition of METRIC_REGISTRY) {
      expect(definition.study.length, definition.key).toBeGreaterThan(0)
    }
  })

  it('gives every registered metric a research type it belongs to', () => {
    // A metric no type requires is a definition nothing reads, and the two research types together
    // must cover the registry — otherwise a metric could be silently unreachable.
    const covered = new Set([...metricsFor('simulation-study').required, ...metricsFor('literature-review').required]
      .map(definition => definition.key))
    expect([...covered].sort()).toEqual(METRIC_REGISTRY.map(definition => definition.key).sort())
  })
})

describe('the registry itself', () => {
  it('resolves a key to its definition, and an unknown key to nothing', () => {
    expect(metricDefinition('min-ttc-seconds')?.unit).toBe('s')
    expect(metricDefinition('no-such-metric')).toBeUndefined()
  })

  it('states what each metric means, not only how to spell it', () => {
    for (const definition of METRIC_REGISTRY) {
      expect(definition.interpretation.length, definition.key).toBeGreaterThan(40)
      expect(definition.requiredFor.length, definition.key).toBeGreaterThan(0)
    }
  })
})
