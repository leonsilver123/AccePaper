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

import type { MeasuredMetric, PredictionCommitment } from './prediction-gate.ts'
import { claimRejectionOf, commitmentFrom } from './prediction-gate.ts'
import { MEASURED_METRIC } from './platoon-sim.ts'

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
    essentialDifference: 'control policy is adaptive (RL) rather than fixed-time',
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

  return {
    ok: true,
    plan: {
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
