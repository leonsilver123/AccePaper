// @deepseek-ai/dsh-research-team — a second study: request coalescing and tail latency.
//
// WHY A SECOND STUDY EXISTS. Every reader of a result used to know this package's first study by
// name: the metric was `min-ttc-seconds`, the two arms were platoons, and the record's fields were
// `baselineMinTtcSeconds` and `stringStabilityIndex`. A pipeline that can only describe one study is
// not a capability, it is that study's program — so this module is a genuinely different one, and the
// generalization it forced (a result that names its own metric) is what makes it executable.
//
// WHAT IS DIFFERENT HERE, and each difference is deliberate:
//
//   - the DOMAIN is a service, not a vehicle platoon: a single server draining a declared arrival
//     trace;
//   - the METRIC is `p95-latency-ms` in MILLISECONDS, and LOWER is better — the opposite direction
//     from the platoon study's, so a rule that assumed "higher is better" fails here;
//   - the DATA is a SEQUENCE: a trace of arrivals over time, so the figure this study needs is a
//     series over a sequence axis rather than two bars over a category axis;
//   - the MECHANISM is coalescing — batching arrivals that fall inside a declared window into one
//     service — which trades a longer wait for some requests against a shorter queue for all of them.
//
// WHAT IT IS NOT. A deterministic simulation over declared parameters, like the first study: no
// randomness, no field data, and its numbers are model output rather than measurement. Nothing here
// is a finding about a real service.

import { createHash } from 'node:crypto'

/** The rule version every artifact of this study carries. */
export const LATENCY_RULE_VERSION = 'service-latency-v1'

/**
 * The study's declared parameters.
 *
 * Declared rather than tuned: each value is a modelling choice the Method section must state, and a
 * study whose numbers came from parameters nobody declared would be reporting its own configuration
 * as a finding.
 */
export const LATENCY_INPUTS = {
  /** Requests in the declared trace. */
  requestCount: 600,
  /**
   * Arrival rate, requests per second, and therefore the load the queue is placed under.
   *
   * BELOW THE SERVER'S CAPACITY, deliberately: at the mean service time declared below this is a
   * utilization of about 0.9, which is a busy queue that still settles. A rate above capacity would
   * measure an overload — latency grows without bound and the comparison would report the instability
   * rather than the coalescing.
   */
  arrivalRatePerSecond: 30,
  /** Mean service time, milliseconds. */
  meanServiceMs: 30,
  /** Every Nth request is a slow one, and by how much — a declared, deterministic spread. */
  slowEveryNth: 17,
  slowFactorMs: 4,
  /**
   * The coalescing window, milliseconds. Arrivals inside one window share a service.
   *
   * WIDER THAN THE INTER-ARRIVAL SPACING AT THE DECLARED RATE (33.3 ms), so batches actually form: a
   * window narrower than the spacing admits one request at a time and the variant would be the
   * baseline under another name.
   */
  coalescingWindowMs: 40,
  /** How many requests a single coalesced service may cover. */
  maxBatch: 8,
  /** The percentile the claim is about. */
  percentile: 95,
} as const

/**
 * The quantity this study measures, in the shape the pipeline's metric gate takes.
 *
 * `phrases` is what a claim must actually say for the C channel to bind it: the same discipline the
 * first study's metric carries, applied to a quantity from another field.
 */
export const LATENCY_METRIC = {
  key: 'p95-latency-ms',
  label: 'the 95th-percentile request latency (ms)',
  unit: 'ms',
  direction: 'lower-is-better' as const,
  phrases: [
    '95th-percentile latency',
    '95th percentile latency',
    'p95 latency',
    'tail latency',
    '95th-percentile request latency',
  ],
}

/** One request in the declared trace: when it arrived, and how long it takes to serve. */
interface Arrival {
  readonly index: number
  /** Arrival time, milliseconds. */
  readonly atMs: number
  /** Service time, milliseconds, from the declared deterministic spread. */
  readonly serviceMs: number
}

/**
 * The declared trace, built rather than recorded.
 *
 * A DETERMINISTIC TRACE, so the study is reproducible without shipping a data file: arrivals are
 * evenly spaced at the declared rate, and every Nth request is the declared factor slower. The shape
 * is what matters — a steady load with a declared tail — and it is stated here rather than measured
 * somewhere, which the Method section has to say.
 *
 * @returns the trace, in arrival order.
 */
export function declaredTrace(): ReadonlyArray<Arrival> {
  const intervalMs = 1000 / LATENCY_INPUTS.arrivalRatePerSecond
  return Array.from({ length: LATENCY_INPUTS.requestCount }, (_, index) => ({
    index,
    atMs: index * intervalMs,
    serviceMs: (index + 1) % LATENCY_INPUTS.slowEveryNth === 0
      ? LATENCY_INPUTS.meanServiceMs * LATENCY_INPUTS.slowFactorMs
      : LATENCY_INPUTS.meanServiceMs,
  }))
}

/** What one arm of the study produced: every request's latency, and the trace's own totals. */
export interface LatencyRun {
  /** Latency in milliseconds of each request, in arrival order. */
  readonly latenciesMs: ReadonlyArray<number>
  /** Total time the server was busy, milliseconds. */
  readonly busyMs: number
  /** Requests per second actually served. */
  readonly throughputPerSecond: number
}

/**
 * Serve the trace, one request at a time.
 *
 * THE BASELINE ARM: a request is admitted when the server is free, and waits otherwise. This is the
 * queue the variant has to beat, computed rather than assumed.
 *
 * @param trace - the declared arrivals.
 * @returns the latencies and the server's own totals.
 */
export function serveIndividually(trace: ReadonlyArray<Arrival>): LatencyRun {
  let freeAtMs = 0
  let busyMs = 0
  const latenciesMs = trace.map((arrival) => {
    const startMs = Math.max(freeAtMs, arrival.atMs)
    const endMs = startMs + arrival.serviceMs
    freeAtMs = endMs
    busyMs += arrival.serviceMs
    return endMs - arrival.atMs
  })
  const spanMs = Math.max(1, freeAtMs)
  return {
    latenciesMs,
    busyMs: round2(busyMs),
    throughputPerSecond: round2((trace.length / spanMs) * 1000),
  }
}

/**
 * Serve the trace with coalescing: arrivals inside one declared window share one service.
 *
 * THE VARIANT ARM. A batch is one service whose duration is the batch's own slowest member, and every
 * request in it is answered when that service ends — so the requests that waited share one longer
 * wait while the queue behind them drains faster. `maxBatch` bounds the batch, because an unbounded
 * one would trade the tail for the median without limit.
 *
 * @param trace - the declared arrivals.
 * @returns the latencies and the server's own totals.
 */
export function serveCoalesced(trace: ReadonlyArray<Arrival>): LatencyRun {
  let freeAtMs = 0
  let busyMs = 0
  const latenciesMs: number[] = []
  let index = 0
  while (index < trace.length) {
    const first = trace[index] as Arrival
    // The batch: arrivals whose offset from the FIRST one is inside the window, up to the bound.
    const batch: Arrival[] = [first]
    let next = index + 1
    while (
      next < trace.length
      && batch.length < LATENCY_INPUTS.maxBatch
      && (trace[next] as Arrival).atMs - first.atMs <= LATENCY_INPUTS.coalescingWindowMs
    ) {
      batch.push(trace[next] as Arrival)
      next += 1
    }
    const serviceMs = Math.max(...batch.map(entry => entry.serviceMs))
    const startMs = Math.max(freeAtMs, first.atMs)
    const endMs = startMs + serviceMs
    freeAtMs = endMs
    busyMs += serviceMs
    for (const entry of batch) latenciesMs.push(endMs - entry.atMs)
    index = next
  }
  const spanMs = Math.max(1, freeAtMs)
  return {
    latenciesMs,
    busyMs: round2(busyMs),
    throughputPerSecond: round2((trace.length / spanMs) * 1000),
  }
}

/**
 * The latency at one percentile of a run.
 *
 * NEAREST-RANK, stated rather than assumed: with a few hundred samples the interpolation an
 * implementation chooses changes the number, and a percentile whose rule is unstated is a number
 * nobody can reproduce.
 *
 * @param latenciesMs - one latency per request.
 * @param percentile - the percentile to read, e.g. 95.
 * @returns the latency at that percentile, milliseconds.
 */
export function percentileMs(latenciesMs: ReadonlyArray<number>, percentile: number): number {
  if (latenciesMs.length === 0) return 0
  const sorted = [...latenciesMs].sort((left, right) => left - right)
  const rank = Math.ceil((percentile / 100) * sorted.length)
  return round2(sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] as number)
}

/** The study's comparison: both arms, the percentile the claim is about, and the change between them. */
export interface LatencyComparison {
  readonly baseline: { readonly p95Ms: number; readonly throughputPerSecond: number; readonly busyMs: number }
  readonly variant: { readonly p95Ms: number; readonly throughputPerSecond: number; readonly busyMs: number }
  /** Change in the variant relative to the baseline, %. Negative means the tail got shorter. */
  readonly relativeImprovementPct: number
  /** The series the figure plots: latency per 100-request bucket, both arms. */
  readonly series: {
    readonly bucket: ReadonlyArray<number>
    readonly baseline: ReadonlyArray<number>
    readonly variant: ReadonlyArray<number>
  }
}

/** Two decimals, the precision the pipeline reports at. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Run both arms of the study over the declared trace and compare them.
 *
 * @returns the comparison the result record is built from.
 */
export function compareLatency(): LatencyComparison {
  const trace = declaredTrace()
  const baseline = serveIndividually(trace)
  const variant = serveCoalesced(trace)
  const baselineP95 = percentileMs(baseline.latenciesMs, LATENCY_INPUTS.percentile)
  const variantP95 = percentileMs(variant.latenciesMs, LATENCY_INPUTS.percentile)
  return {
    baseline: {
      p95Ms: baselineP95,
      throughputPerSecond: baseline.throughputPerSecond,
      busyMs: baseline.busyMs,
    },
    variant: {
      p95Ms: variantP95,
      throughputPerSecond: variant.throughputPerSecond,
      busyMs: variant.busyMs,
    },
    relativeImprovementPct: baselineP95 === 0 ? 0 : round2(((variantP95 - baselineP95) / baselineP95) * 100),
    // THE FIGURE'S DATA IS BUILT HERE, from the same two runs the percentile came from: a series
    // plotted anywhere else could disagree with the number the claim is graded on.
    series: {
      bucket: Array.from({ length: Math.ceil(trace.length / 100) }, (_, index) => (index + 1) * 100),
      baseline: bucketPercentiles(baseline.latenciesMs, LATENCY_INPUTS.percentile),
      variant: bucketPercentiles(variant.latenciesMs, LATENCY_INPUTS.percentile),
    },
  }
}

/** The percentile of each 100-request window of one arm, for the series the figure plots. */
function bucketPercentiles(latenciesMs: ReadonlyArray<number>, percentile: number): ReadonlyArray<number> {
  const out: number[] = []
  for (let start = 0; start < latenciesMs.length; start += 100) {
    out.push(percentileMs(latenciesMs.slice(start, start + 100), percentile))
  }
  return out
}

/**
 * A digest over the comparison, so a record names the numbers it was built from.
 *
 * @param comparison - the comparison.
 * @returns its SHA-256, hex.
 */
export function latencyHashOf(comparison: LatencyComparison): string {
  const text = [
    LATENCY_RULE_VERSION,
    comparison.baseline.p95Ms,
    comparison.variant.p95Ms,
    comparison.relativeImprovementPct,
    ...comparison.series.baseline,
    ...comparison.series.variant,
  ].join('|')
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * The model's equations, as the Method section states them.
 *
 * The queue recurrence and the percentile are what this study actually computes; a Method section
 * that named an algorithm the code does not run is the defect `implementations.ts` exists for.
 */
export const LATENCY_EQUATIONS: ReadonlyArray<{ readonly name: string; readonly latex: string; readonly note: string }> = [
  {
    name: 'Queue recurrence',
    latex: 'S_{i} = \\max\\left(S_{i-1},\\; A_{i}\\right) + s_{i}',
    note: 'The time service i starts is the later of the previous service ending and this request arriving; s_i is its service time.',
  },
  {
    name: 'Latency',
    latex: 'L_{i} = S_{i} + s_{i} - A_{i}',
    note: 'What the request waited plus what it took to serve.',
  },
  {
    name: 'Nearest-rank percentile',
    latex: 'P_{p} = L_{\\lceil p n / 100 \\rceil}',
    note: 'On the sorted latencies, with no interpolation: stated because the rule changes the number at this sample size.',
  },
  {
    name: 'Coalesced service',
    latex: 's^{\\mathrm{batch}} = \\max_{i \\in B} s_{i},\\quad |B| \\le B_{\\max}',
    note: 'One service per batch, as long as its slowest member, bounded by the declared maximum batch size.',
  },
]
