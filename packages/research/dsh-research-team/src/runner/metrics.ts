// @deepseek-ai/dsh-research-team — what a metric MEANS, declared once and checked.
//
// WHY THIS EXISTS. The pipeline already knows a metric's key and the direction the claim committed
// to, and it reads both out of whatever artifact happens to carry them. What it has never had is a
// place that says what the metric IS: its unit, which way is better, what a movement means, and which
// research types it belongs to at all. Without that, "the change is an improvement" is assembled from
// prose, and the failure it produces is the one the quality baseline was written to catch — a result
// described in a direction its own measurement contradicts.
//
// DECLARED, NOT INFERRED. Every field here is stated by the deployment or by the study, and a
// declaration that disagrees with the registry is REFUSED rather than reconciled: a run that reports
// `min-ttc-seconds` in milliseconds, or calls a fall in time-to-collision an improvement, has a
// measurement nobody can compare with anything. The refusal names both sides so the mismatch is
// fixable.
//
// WHAT THIS IS NOT. It is not a units library and it does not convert: a metric whose unit differs is
// a different metric, and silently converting one into another is how two studies come to be compared
// that never measured the same thing.

/** The kinds of study this pipeline runs, as configurations rather than branches. */
export type ResearchType =
  /** A simulated or experimental study: a metric is measured and compared against a claim. */
  | 'simulation-study'
  /** A review of published work: no measurement of its own, and no experiment to adjudicate. */
  | 'literature-review'

/** Which way is better, declared rather than derived from the metric's name. */
export type MetricDirection = 'higher-is-better' | 'lower-is-better'

/** One metric, as the deployment declares it. */
export interface MetricDefinition {
  /** The key artifacts carry, e.g. `min-ttc-seconds`. */
  readonly key: string
  /** The unit a value is expressed in, e.g. `s`. Compared literally; never converted. */
  readonly unit: string
  readonly direction: MetricDirection
  /** What a movement means, in one sentence, for whoever reads a result. */
  readonly interpretation: string
  /**
   * The implementation — the study — that measures this quantity.
   *
   * A METRIC IS DECLARED BY A STUDY. It used to be declared per research TYPE, which was enough while
   * one implementation existed per type: with two simulation studies, "the metrics a simulation study
   * requires" stopped being a fact about the type. The registry keeps the type view (below) for the
   * checks a type makes applicable, and this field is what makes a run's own metrics its study's.
   */
  readonly study: string
  /** The research types this metric belongs to. A type not listed does not have it at all. */
  readonly requiredFor: ReadonlyArray<ResearchType>
}

/** A metric as a study or artifact declares it, to be checked against the registry. */
export interface MetricDeclaration {
  readonly key: string
  readonly unit: string
  readonly direction: string
}

/** Why a declaration was refused. */
export type MetricRefusalCode =
  | 'metric-unknown'
  | 'metric-unit-mismatch'
  | 'metric-direction-mismatch'

/** One refusal, with both sides named. */
export interface MetricRefusal {
  readonly code: MetricRefusalCode
  readonly detail: string
}

/**
 * The metrics this pipeline can report, as the shipped study declares them.
 *
 * A deployment adds its own; what it may not do is state one loosely. `min-ttc-seconds` is here
 * because the shipped Case Pack measures it, and its direction is `higher-is-better` because a longer
 * time to collision is the safer outcome — which is exactly the fact a sentence calling a fall an
 * "improvement" gets wrong.
 */
export const METRIC_REGISTRY: ReadonlyArray<MetricDefinition> = [
  {
    key: 'min-ttc-seconds',
    unit: 's',
    direction: 'higher-is-better',
    interpretation:
      'the smallest time-to-collision reached during the measurement window; a larger value means more '
      + 'time before a potential collision, so a fall is a worsening whatever the prose calls it',
    study: 'idm-platoon-simulation',
    requiredFor: ['simulation-study'],
  },
  {
    key: 'string-stability-index',
    unit: 'ratio',
    direction: 'lower-is-better',
    interpretation:
      'how much a perturbation grows along the platoon; below one it is attenuated, so a rise toward '
      + 'one is a worsening',
    study: 'idm-platoon-simulation',
    requiredFor: ['simulation-study'],
  },
  {
    key: 'citation-coverage',
    unit: 'ratio',
    direction: 'higher-is-better',
    interpretation:
      'the share of a review\'s statements that carry a citation to a work that supports them; a '
      + 'higher value means less of the review rests on nothing',
    study: 'literature-review',
    requiredFor: ['literature-review'],
  },
  {
    key: 'p95-latency-ms',
    unit: 'ms',
    direction: 'lower-is-better',
    interpretation:
      'the 95th-percentile request latency of a service under a declared arrival trace; a lower value '
      + 'means fewer requests wait longer than they should, so a rise is a worsening',
    // A SECOND STUDY'S METRIC. It shares the research type with the platoon study and shares nothing
    // else: another domain, another unit, the opposite direction, and its own implementation.
    study: 'service-latency-coalescing',
    requiredFor: ['simulation-study'],
  },
]

/** The definition registered for one key, or undefined. */
export function metricDefinition(key: string): MetricDefinition | undefined {
  return METRIC_REGISTRY.find(definition => definition.key === key)
}

/**
 * Judge one metric declaration against the registry.
 *
 * @param declaration - what the study or artifact states about the metric.
 * @returns one refusal per disagreement, or an empty list when the declaration is the registry's.
 */
export function checkMetricDeclaration(declaration: MetricDeclaration): ReadonlyArray<MetricRefusal> {
  const definition = metricDefinition(declaration.key)
  if (definition === undefined) {
    return [{
      code: 'metric-unknown',
      detail: `'${declaration.key}' is not a metric this deployment declares — a measurement nothing`
        + ' defines cannot be compared with anything',
    }]
  }
  const refusals: MetricRefusal[] = []
  // THE UNIT IS COMPARED, NEVER CONVERTED. A study reporting the metric in another unit measured a
  // different quantity, whatever the key says.
  if (declaration.unit !== definition.unit) {
    refusals.push({
      code: 'metric-unit-mismatch',
      detail: `'${declaration.key}' is declared in '${declaration.unit}' and this deployment defines it`
        + ` in '${definition.unit}' — the value is not the same quantity`,
    })
  }
  if (declaration.direction !== definition.direction) {
    refusals.push({
      code: 'metric-direction-mismatch',
      detail: `'${declaration.key}' is declared '${declaration.direction}' and this deployment defines it`
        + ` '${definition.direction}': ${definition.interpretation}`,
    })
  }
  return refusals
}

/**
 * Require a declaration to be the registry's, or refuse the run.
 *
 * THE PRODUCTION CONSUMER of the refusals above. The study states its measured quantity's key, unit
 * and direction where it measures that quantity; the registry states what the quantity IS. Those are
 * two declarations of one metric, and the types cannot tell a deliberate one from a drifted one — a
 * study whose unit was edited to `ms` still compiles, still measures, and still reports a value that
 * the gate, the package and the manuscript all read as seconds. This is where that is refused, at the
 * start of the run, naming both sides.
 *
 * @param declaration - the quantity the study measures.
 * @throws {Error} listing every disagreement, so one resolution fixes all of them.
 */
export function requireMetricDeclaration(declaration: MetricDeclaration): void {
  const refusals = checkMetricDeclaration(declaration)
  if (refusals.length === 0) return
  throw new Error(
    '[metrics] the measured quantity does not agree with what this deployment declares: '
    + refusals.map(refusal => `[${refusal.code}] ${refusal.detail}`).join('; '),
  )
}

/** What one research type requires, and what it does not have at all. */
export interface MetricApplicability {
  readonly required: ReadonlyArray<MetricDefinition>
  /** Metrics that belong to OTHER research types: not missing, simply not part of this one. */
  readonly notApplicable: ReadonlyArray<MetricDefinition>
}

/**
 * The metrics one STUDY carries, and the ones that belong to other studies.
 *
 * THE LEVEL A RUN'S OWN METRICS ARE READ AT. A research type says which metrics are applicable to
 * that kind of work — with two simulation studies that is the union of both — while a RUN is conducted
 * as one study, and the metrics it requires are that study's. `required: false` here means "this
 * quantity belongs to another study", which is a different fact from a metric the study failed to
 * measure, and the two must not be collapsed in a run's own manifest.
 *
 * @param study - the implementation id the run is conducted as.
 * @returns the metrics that study measures, and every other metric this deployment declares.
 */
export function metricsForStudy(study: string): MetricApplicability {
  return {
    required: METRIC_REGISTRY.filter(definition => definition.study === study),
    notApplicable: METRIC_REGISTRY.filter(definition => definition.study !== study),
  }
}

/**
 * The metrics one research type carries.
 *
 * REQUIRED AND NOT-APPLICABLE ARE DIFFERENT FACTS, and a view that collapsed them would report a
 * literature review as missing every measurement it was never supposed to take — which is the same
 * conflation the stage view refuses between "you supply this" and "this build cannot place it".
 *
 * @param type - the research type the run is configured as.
 * @returns the metrics it requires, and those belonging to other types.
 */
export function metricsFor(type: ResearchType): MetricApplicability {
  return {
    required: METRIC_REGISTRY.filter(definition => definition.requiredFor.includes(type)),
    notApplicable: METRIC_REGISTRY.filter(definition => !definition.requiredFor.includes(type)),
  }
}
