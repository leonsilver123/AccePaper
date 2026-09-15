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
