/**
 * The research one run carries, as data.
 *
 * WHY THIS EXISTS. The pipeline used to carry its study in the runner's own source: a claim id, a
 * reference sentence, a prediction, a metric key and a section skeleton were module constants in
 * `registry.ts`, and A1 retrieved literature for a hardcoded topic. A run could therefore only ever
 * produce one paper — and the topic A1 searched was not even the one the experiment measured, which
 * the study module's own header records as an internal inconsistency the pipeline shipped with.
 * Every one of those reads is a field of {@link StudyPlan} now, which is what lets a deployment
 * state what a run is about.
 *
 * ONE VALUE PER FACT. The direction is both the research direction and the topic A1 retrieves for,
 * because they were two values before and disagreed: the retrieval topic was a literal and the
 * direction was a run input nothing read.
 *
 * ONLY FIELDS WITH A READER. A plan field nothing consumes is an option in name only. The experiment
 * switch a benchmark executor will branch on is therefore absent here, and lands with that executor
 * rather than in advance of it.
 */

import { INPUT_LIMITS } from '@deepseek-ai/dsh-research-tools'
import { SUPPORTED_IMPLEMENTATIONS, resolveImplementation } from './implementations.ts'
import type { MethodImplementation } from './implementations.ts'
import type { MeasuredMetric, PredictionCommitment } from './prediction-gate.ts'
import { claimRejectionOf, commitmentFrom } from './prediction-gate.ts'
import { MEASURED_METRIC } from './platoon-sim.ts'
import { LATENCY_METRIC } from './service-latency-sim.ts'

/** One section of the paper's skeleton, in the order it is written. */
export interface PlanSection {
  readonly id: string
  readonly heading: string
}

/** The claim a plan commits the run to, as the pipeline's steps state it. */
export interface PlanClaim {
  /** Stable id, recorded on the claim artifact and read back by a resume. */
  readonly id: string
  /** The claim itself, one sentence. */
  readonly ref: string
  /** The assertion A2 hands to `claim-construct`. */
  readonly assertion: string
  /** What makes this claim essentially different from prior work. */
  readonly essentialDifference: string
  /** The experiment that would falsify the claim. */
  readonly experimentToFalsify: string
  /** The falsifiable prediction, carrying the anchor and the threshold the claim declares. */
  readonly prediction: string
}

/** The research a run carries: what is being studied, and what would settle it. */
export interface StudyPlan {
  /**
   * Which implementation this study runs. The runner refuses a plan naming one it does not have
   * (`runner/implementations.ts`), because a method section describing an algorithm the
   * experiment does not run is a defect the pipeline must not be able to reach.
   */
  readonly implementationId?: string
  /** The manuscript title. */
  readonly title: string
  /** The domain the study belongs to. */
  readonly field: string
  /**
   * The research direction within the field, and the topic A1 retrieves literature for.
   *
   * A retrieval topic that no input feeds is how a run's literature came to be about something its
   * measurement was not; this field is the one place that value lives.
   */
  readonly direction: string
  /** The paper's section skeleton, in order. */
  readonly outline: ReadonlyArray<PlanSection>
  readonly claim: PlanClaim
  /** The quantity the claim is about, and how a study measures it. */
  readonly metric: MeasuredMetric
  /**
   * What the claim commits that quantity to. Absent means it declared none, which makes the claim
   * ungradeable and holds the C channel rather than grading it.
   */
  readonly commitment?: PredictionCommitment | undefined
}

/**
 * The study this repository ships, as the default plan.
 *
 * Its job is to let a run with no plan supplied — every offline run, and every test — be
 * deterministic and exercise the whole pipeline against the one measurement this tree has. The
 * direction is the study's own subject rather than the signal-control topic A1 used to search for
 * unconditionally, because a run whose literature is about a different subject than its experiment
 * is the inconsistency the study module exists to remove; the retrieval topic is a plan field now,
 * so the two cannot drift apart again.
 *
 * Nothing here is a finding. A deployment states its own plan.
 */
export const DEFAULT_PLAN: StudyPlan = {
  implementationId: 'idm-platoon-simulation',
  title: 'Inserting One Autonomous Vehicle Changes a Platoon Minimum Time-to-Collision',
  field: 'road transport safety and traffic flow',
  direction: 'mixed platoon car-following with an autonomous vehicle',
  outline: [
    { id: 'abstract', heading: 'Abstract' },
    { id: 'introduction', heading: 'Introduction' },
    { id: 'method', heading: 'Method' },
    { id: 'experiments', heading: 'Experiments' },
    { id: 'results', heading: 'Results' },
    { id: 'conclusion', heading: 'Conclusion' },
    { id: 'references', heading: 'References' },
  ],
  claim: {
    id: 'claim-mixed-platoon-following-risk',
    ref: 'inserting one AV into a three-vehicle human platoon raises the platoon minimum time-to-collision',
    assertion:
      'Inserting one AV into a three-vehicle human platoon raises the platoon minimum time-to-collision.',
    // WHAT THE STUDY ACTUALLY VARIES. This read 'control policy is adaptive (RL) rather than
    // fixed-time', which was false twice over: the car-following is IDM in both arms, not a
    // learned policy, and the baseline is a homogeneous IDM platoon, not a fixed-time signal plan.
    // The Method section derived its difference from this field, so the manuscript described an
    // experiment nobody ran. The values below are the ones `DECLARED_VEHICLE_CLASSES` holds and
    // `implementations.ts` publishes.
    essentialDifference:
      'the autonomous vehicle follows with a 0.15 s reaction delay, a 1.2 s desired headway and a'
      + ' 0.15 s look-ahead horizon, against the human 1.2 s delay, 2.0 s headway and no look-ahead',
    experimentToFalsify:
      'Simulate the homogeneous and the mixed platoon under the same declared disturbance and compare their minimum time-to-collision.',
    prediction:
      'the HV-AV-HV platoon shall exceed the all-HV platoon in minimum time-to-collision by at least 20%',
  },
  metric: MEASURED_METRIC,
  // Matching the sentence above, which says the quantity RISES. A declared commitment that
  // disagreed with the claim's own words would be worse than none at all.
  commitment: { direction: 'increase', bound: 'at-least', thresholdPct: 20 },
}

/**
 * The default plan with its direction replaced.
 *
 * The direction is also A1's retrieval topic, and a deployment overrides it through the run's seed
 * rather than by restating the rest of the plan.
 *
 * @param direction - the research direction to study instead.
 * @returns the plan, with that direction.
 */
export function planForDirection(direction: string): StudyPlan {
  return { ...DEFAULT_PLAN, direction }
}

/**
 * The second study this repository ships: request coalescing against tail latency.
 *
 * A SECOND PLAN RATHER THAN A SECOND DIRECTION, because it is a different study and not a variation
 * of the first: another field, another measured quantity in another unit with the OPPOSITE direction,
 * another mechanism, and a claim whose prediction says the quantity FALLS. A deployment states its
 * own; this one exists so a run can be conducted as something other than the platoon study, which is
 * the only way to tell whether the pipeline is a capability or that study's program.
 *
 * ITS CLAIM IS GRADEABLE BY THE SAME GATE as the first one's, which is the property that makes it a
 * test of the pipeline rather than a bypass: the prediction names the measured quantity with a
 * declared phrasing, states `shall lower` for a `decrease` declaration, anchors the threshold with
 * `at least`, and states its 30% exactly once.
 */
export const LATENCY_PLAN: StudyPlan = {
  implementationId: 'service-latency-coalescing',
  title: 'Coalescing Requests Lowers the Tail Latency of a Single-Server Service',
  field: 'computer systems performance',
  direction: 'request coalescing and tail latency in a single-server service',
  outline: [
    { id: 'abstract', heading: 'Abstract' },
    { id: 'introduction', heading: 'Introduction' },
    { id: 'method', heading: 'Method' },
    { id: 'experiments', heading: 'Experiments' },
    { id: 'results', heading: 'Results' },
    { id: 'conclusion', heading: 'Conclusion' },
    { id: 'references', heading: 'References' },
  ],
  claim: {
    id: 'claim-coalescing-tail-latency',
    ref: 'coalescing arrivals within a declared window lowers the 95th-percentile request latency of a single-server service',
    assertion:
      'Coalescing arrivals within a declared window lowers the 95th-percentile request latency of a single-server service.',
    essentialDifference:
      'the coalesced arm batches every arrival within 40 ms of a batch\'s first request, up to 8'
      + ' requests, and serves the batch for as long as its slowest member, against serving each'
      + ' request as it arrives',
    experimentToFalsify:
      'Serve the same declared arrival trace with and without coalescing and compare the'
      + ' 95th-percentile request latency.',
    prediction:
      'the coalesced service shall lower the 95th-percentile latency by at least 30%',
  },
  metric: LATENCY_METRIC,
  // Matching the sentence above, which says the quantity FALLS. A declared commitment that disagreed
  // with the claim's own words would be worse than none at all — the C gate refuses that pair.
  commitment: { direction: 'decrease', bound: 'at-least', thresholdPct: 30 },
}

/** Read a nested object field, or an empty record when it is absent or not an object. */
function recordField(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key]
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** Read a required string field, or undefined when it is absent or empty. */
function textField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

/**
 * A plan that arrived from outside this process, or the reason it cannot be used.
 *
 * WHY THIS EXISTS AT ALL. A plan is now something a caller supplies, and a caller is a wire
 * boundary: the plan a browser confirms is JSON that no type checker saw. Everything downstream
 * trusts the plan completely — the manuscript's title, A1's retrieval topic, the claim the C
 * channel grades — so a malformed one would not fail where it entered, it would produce a run whose
 * artifacts disagree with each other. This is the point at which such a value is refused.
 *
 * WHAT IT REFUSES, in the order the failures matter:
 *  - a missing or empty field, because an empty title or an empty prediction is a gap the run
 *    cannot report as anything but success;
 *  - an outline whose section ids differ from the skeleton this pipeline consumes, because D2 and
 *    every step after it address sections by id;
 *  - a metric key this study does not measure, because the C channel would hold on every step of
 *    the run — a refusal now, with a reason, rather than a run that stalls at C;
 *  - a claim the gate cannot grade, with the GATE's own reason. This is the one that matters most:
 *    the same check the C channel applies, applied before a run exists.
 *
 * @param value - the value a caller supplied.
 * @param metric - the quantity this run's study measures.
 * @returns the plan, or a reason it cannot be used.
 */
/**
 * Resolve the implementation that will execute a plan, and refuse a plan this runner cannot run.
 *
 * THE WIRE PATH CARRIES NO IMPLEMENTATION ID, and a plan without one used to be accepted here and
 * fail four steps later: `b1Executor` calls `resolveImplementation`, a plan naming none resolves to
 * nothing, and B1 threw — the pipeline had said it could do the work and then discovered midway
 * that it could not. That is what a browser run did, every time.
 *
 * What replaces it is a resolution rather than a default: a plan is executed by the implementation
 * that MEASURES its declared quantity. A plan whose quantity no implementation measures is refused
 * here, at the boundary, with the reason; a plan that also declares an id has that id checked
 * against the quantity, because two statements about one method that disagree is how a manuscript
 * comes to describe an experiment nobody ran.
 *
 * @param source - the plan record being validated.
 * @param metricKey - the quantity the plan declares it measures.
 * @returns the resolved id, or the refusal naming what is missing and what is available.
 */
function resolvePlanImplementation(
  source: Record<string, unknown>,
  metricKey: string,
): { readonly ok: true; readonly implementationId: string } | { readonly ok: false; readonly reason: string } {
  const declared = source['implementationId']
  if (declared !== undefined && (typeof declared !== 'string' || declared.length === 0)) {
    return { ok: false, reason: "the plan's implementationId is present but is not a non-empty string" }
  }
  const available = SUPPORTED_IMPLEMENTATIONS.map(candidate => candidate.id).join(', ')
  if (typeof declared === 'string') {
    const resolved = resolveImplementation({ ...DEFAULT_PLAN, implementationId: declared })
    if (!resolved.ok || resolved.implementation === undefined) return { ok: false, reason: resolved.reason }
    if (resolved.implementation.metric.key !== metricKey) {
      return {
        ok: false,
        reason:
          `the plan names implementation '${declared}', which measures `
          + `'${resolved.implementation.metric.key}', but declares '${metricKey}' — a plan and its`
          + ' implementation disagreeing about the measured quantity is a manuscript that would'
          + ' describe an experiment nobody ran',
      }
    }
    return { ok: true, implementationId: declared }
  }
  const matching = SUPPORTED_IMPLEMENTATIONS.filter(candidate => candidate.metric.key === metricKey)
  if (matching.length === 0) {
    return {
      ok: false,
      reason:
        `the plan measures '${metricKey}', which no implementation this runner has can measure`
        + ` (available: ${available}) — describing a method and measuring something else is the`
        + ' failure this refusal prevents',
    }
  }
  if (matching.length > 1) {
    return {
      ok: false,
      reason:
        `the plan measures '${metricKey}', which ${String(matching.length)} implementations can`
        + ` measure (${matching.map(candidate => candidate.id).join(', ')}) — the plan must name one`,
    }
  }
  const [only] = matching
  if (only === undefined) return { ok: false, reason: `no implementation can measure '${metricKey}'` }
  return { ok: true, implementationId: only.id }
}

/**
 * The quantity a plan declares, or undefined when it declares none.
 *
 * A PLAN CARRIES ITS METRIC, which is what lets the runner ask "can I measure what this plan is
 * about" instead of "is this plan about the one quantity I measure". The shipped caller passes the
 * metric explicitly; a caller that does not know which study it is looking at reads it here.
 *
 * @param value - the plan as it arrived.
 * @returns the declared key, or undefined.
 */
export function declaredMetricKeyOf(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const metric = (value as Record<string, unknown>)['metric']
  if (metric === null || typeof metric !== 'object') return undefined
  const key = (metric as Record<string, unknown>)['key']
  return typeof key === 'string' && key.length > 0 ? key : undefined
}

/**
 * The implementation that measures the quantity a plan declares.
 *
 * THE GENERIC ENTRY, for a caller that does not already know which study it is holding: the plan says
 * what it is about, and this resolves that to a study this process can run. A quantity no
 * implementation measures is REFUSED here rather than run as something else — which is the same
 * refusal the explicit entry makes, reached from the plan's own declaration.
 *
 * @param value - the plan as it arrived.
 * @returns the implementation, or the refusal naming what this runner has.
 */
export function implementationForPlan(
  value: unknown,
): { readonly ok: true; readonly implementation: MethodImplementation } | { readonly ok: false; readonly reason: string } {
  const key = declaredMetricKeyOf(value)
  if (key === undefined) {
    return { ok: false, reason: 'the plan declares no metric, so nothing says what it would measure' }
  }
  const matching = SUPPORTED_IMPLEMENTATIONS.filter(candidate => candidate.metric.key === key)
  if (matching.length === 0) {
    return {
      ok: false,
      reason:
        `the plan measures '${key}', which no implementation this runner has can measure`
        + ` (available: ${SUPPORTED_IMPLEMENTATIONS.map(candidate => candidate.metric.key).join(', ')})`,
    }
  }
  const [only] = matching
  if (only === undefined) return { ok: false, reason: `no implementation can measure '${key}'` }
  return { ok: true, implementation: only }
}

export function requirePlan(
  value: unknown,
  metric: MeasuredMetric,
): { readonly ok: true; readonly plan: StudyPlan } | { readonly ok: false; readonly reason: string } {
  if (value === null || typeof value !== 'object') {
    return { ok: false, reason: 'the plan is not an object' }
  }
  const source = value as Record<string, unknown>
  const title = textField(source, 'title')
  const field = textField(source, 'field')
  const direction = textField(source, 'direction')
  const missing = [
    ['title', title],
    ['field', field],
    ['direction', direction],
  ].filter(([, entry]) => entry === undefined).map(([key]) => key)

  const rawOutline = source.outline
  const outline: PlanSection[] = []
  if (Array.isArray(rawOutline)) {
    for (const entry of rawOutline) {
      if (entry === null || typeof entry !== 'object') continue
      const row = entry as Record<string, unknown>
      const id = textField(row, 'id')
      const heading = textField(row, 'heading')
      if (id !== undefined && heading !== undefined) outline.push({ id, heading })
    }
  }
  if (outline.length !== rawOutlineCount(rawOutline)) {
    missing.push('outline (every entry needs a non-empty id and heading)')
  }

  const claim = recordField(source, 'claim')
  const claimFields = {
    id: textField(claim, 'id'),
    ref: textField(claim, 'ref'),
    assertion: textField(claim, 'assertion'),
    prediction: textField(claim, 'prediction'),
  }
  for (const [key, entry] of Object.entries(claimFields)) {
    if (entry === undefined) missing.push(`claim.${key}`)
  }
  // The claim id is not free text: `claim-construct` declares how long one may be, and a plan
  // carrying a longer one is refused HERE rather than at A2, where it surfaces as a step that
  // could not execute. That is how a model-proposed direction over the limit ended a run: the plan
  // passed this check, the tool refused the id, and the run died two steps in with a schema error
  // instead of a plan problem.
  if (claimFields.id !== undefined && claimFields.id.length > INPUT_LIMITS.maxClaimIdChars) {
    return {
      ok: false,
      reason: `the plan's claim.id is ${String(claimFields.id.length)} characters, over the `
        + `${String(INPUT_LIMITS.maxClaimIdChars)} the claim-construct tool accepts`,
    }
  }

  if (missing.length > 0) {
    return { ok: false, reason: `the plan states no ${missing.join(', ')}` }
  }

  // The skeleton is a contract, not a preference: every step from D2 on addresses sections by id.
  const expectedIds = DEFAULT_PLAN.outline.map(section => section.id)
  if (outline.map(section => section.id).join(',') !== expectedIds.join(',')) {
    return {
      ok: false,
      reason:
        `the plan's sections are ${outline.map(section => section.id).join(', ')} where this pipeline `
        + `consumes ${expectedIds.join(', ')} — the ids and their order are what the steps after D2 address`,
    }
  }

  const declaredMetricKey = textField(recordField(source, 'metric'), 'key')
  if (declaredMetricKey !== metric.key) {
    return {
      ok: false,
      reason:
        `the plan's claim is about "${declaredMetricKey ?? ''}" while this run's study measures `
        + `"${metric.key}" (${metric.label}), so the C channel could not adjudicate it`,
    }
  }

  const commitment = commitmentFrom(source.commitment)
  if (commitment === undefined) {
    return {
      ok: false,
      reason:
        'the plan declares no usable commitment, so nothing says which way its quantity should move '
        + 'and the C channel would hold on every step of the run',
    }
  }

  const rejection = claimRejectionOf({
    predictionText: claimFields.prediction as string,
    metric,
    declaredMetricKey,
    commitment,
  })
  if (rejection !== undefined) {
    return { ok: false, reason: `the plan's claim is not gradeable: ${rejection}` }
  }

  // RESOLVED LAST, because it reads the quantity the checks above established. The wire path — a
  // model proposes a study, a person confirms it — carries no implementation id, and requiring one
  // would mean the product could not start a run at all. A plan is executed by the implementation
  // that measures the quantity it declares, and that is a resolution: the returned plan names it,
  // so nothing downstream has to resolve it again or discover the absence.
  const implementation = resolvePlanImplementation(source, declaredMetricKey)
  if (!implementation.ok) return { ok: false, reason: implementation.reason }

  return {
    ok: true,
    plan: {
      implementationId: implementation.implementationId,
      title: title as string,
      field: field as string,
      direction: direction as string,
      outline,
      claim: {
        id: claimFields.id as string,
        ref: claimFields.ref as string,
        assertion: claimFields.assertion as string,
        essentialDifference: typeof claim.essentialDifference === 'string' ? claim.essentialDifference : '',
        experimentToFalsify:
          typeof claim.experimentToFalsify === 'string' ? claim.experimentToFalsify : '',
        prediction: claimFields.prediction as string,
      },
      metric,
      commitment,
    },
  }
}

/** How many entries an outline value claims to hold, so a partly-unreadable one is not silently short. */
function rawOutlineCount(value: unknown): number {
  return Array.isArray(value) ? value.length : -1
}
