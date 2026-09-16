/**
 * The six groups a researcher moves through, and what each one reports.
 *
 * A GROUPING OVER THE REAL STEPS, never a second state machine. Every stage names the pipeline steps
 * it reports on, and every state it can show is derived from those steps' own statuses plus the
 * run-level facts the host sends — so a stage cannot be "half done" in a way the pipeline disagrees
 * with, and collapsing a stage in the UI cannot change whether the study advances.
 *
 * The intake group is the one that reports no step: what a person supplies before a study exists
 * (the question, the material, the plan they confirmed) is not a seventeenth executed step, and
 * presenting it as one would claim work the pipeline never did.
 */
import type { ArtifactView, RunSummary, StepStatus, StepView } from './summary.ts'

/** The six stage identifiers, in the order a study moves through them. */
export type StageId =
  | 'intake'
  | 'literature'
  | 'method'
  | 'results'
  | 'writing'
  | 'delivery'

/** One stage: its identifier, and the steps whose outcomes it reports. */
export interface StageDefinition {
  readonly id: StageId
  /**
   * The step ids this stage reports on, or an empty list for the intake group.
   *
   * Listings are explicit rather than derived from a prefix: the `D` phase spans three stages
   * (the figure map belongs with the results it maps, the rebuttal with the delivery it answers
   * for), so "the phase letter" is not the grouping rule and a prefix rule would silently file
   * the rebuttal under the writing stage.
   */
  readonly stepIds: ReadonlyArray<string>
}

/**
 * The stage roster, in pipeline order.
 *
 * The step ids are the engine's own. {@link verifyStageCoverage} checks them against the catalogue a
 * projection actually carries, so a step added to the pipeline fails the gate here instead of
 * disappearing from every stage.
 */
export const STAGES: ReadonlyArray<StageDefinition> = [
  { id: 'intake', stepIds: [] },
  { id: 'literature', stepIds: ['A1-landscape', 'A2-claim', 'A3-agenda', 'A4-venue'] },
  { id: 'method', stepIds: ['B1-method', 'B2-data', 'B3-baseline'] },
  { id: 'results', stepIds: ['C1-mvp', 'C2-trinity-loop', 'C3-boundary', 'D1-figure-map'] },
  { id: 'writing', stepIds: ['D2-framework', 'D3-writing'] },
  { id: 'delivery', stepIds: ['D4-rebuttal', 'E1-format', 'E2-submit'] },
]

/**
 * What one step is doing, as a stage counts it.
 *
 * `awaiting-human` is its own bucket and never a kind of progress: a step held at a human gate is
 * waiting for a PERSON, and a view that folded it into "in progress" would show a study moving while
 * it is stopped on a decision nobody has been asked for yet.
 */
export type StepBucket =
  | 'not-started'
  | 'working'
  | 'awaiting-human'
  | 'passed'
  | 'blocked'
  | 'failed'
  | 'unknown'

/**
 * Classify one step's status into the bucket a stage counts.
 *
 * @param status - the step's status as the host reported it.
 * @returns the bucket that status counts in.
 */
export function bucketOf(status: StepStatus): StepBucket {
  switch (status) {
    case 'pending': return 'not-started'
    case 'in_progress': return 'working'
    case 'gated': return 'awaiting-human'
    case 'passed': return 'passed'
    case 'blocked': return 'blocked'
    case 'failed': return 'failed'
    // A status this build cannot name counts in no real bucket. Folding it into `not-started` would
    // report a step the host has advanced as untouched, which is the reading this build must never
    // produce about a study someone is waiting on.
    default: return 'unknown'
  }
}

/** One stage as the workbench renders it. */
export interface StageView {
  readonly id: StageId
  readonly steps: ReadonlyArray<StepView>
  /**
   * How many steps this stage reports on, whether or not the projection carried them.
   *
   * Zero is the intake group and only the intake group: it is how a view tells "you supply this"
   * apart from "this run's projection did not carry the steps", which are different facts with
   * different remedies.
   */
  readonly declared: number
  /**
   * The steps this stage reports on that the projection did not carry.
   *
   * Usually empty — a run's projection names every catalogued step — and never silently folded into
   * "no outcomes yet", which would report a stage as untouched when the truth is that this build and
   * the host disagree about what the run contains.
   */
  readonly missingStepIds: ReadonlyArray<string>
  /** How many steps in this stage fall in each bucket. */
  readonly counts: Readonly<Record<StepBucket, number>>
  /**
   * What this stage is doing, derived from its steps' own outcomes.
   *
   * The order the states are tested in is the order of what a reader must know first: a failure, then
   * a decision waiting on a person, then a block, then work in flight, then completion.
   */
  readonly state: 'empty' | 'not-started' | 'working' | 'awaiting-human' | 'blocked' | 'failed' | 'done'
  /**
   * The steps that have to finish before this stage can report anything, and have not.
   *
   * Empty for a stage whose own steps are reachable. A later stage listing a prerequisite here is
   * how a page says "not yet, and here is what is missing" instead of offering a control that
   * cannot work.
   */
  readonly missingPrerequisites: ReadonlyArray<string>
}

/** Every bucket, for a counts record that always has all of them. */
const BUCKETS: ReadonlyArray<StepBucket> =
  ['not-started', 'working', 'awaiting-human', 'passed', 'blocked', 'failed', 'unknown']

/**
 * Count the run's steps per bucket, per stage, and say what each stage is doing.
 *
 * @param summary - the flattened run summary the workbench renders.
 * @returns one view per stage, in pipeline order.
 */
export function selectStages(summary: RunSummary): ReadonlyArray<StageView> {
  const byId = new Map(summary.steps.map(step => [step.stepId, step]))
  const views: StageView[] = []
  let earlierIncomplete = false
  for (const definition of STAGES) {
    const steps = definition.stepIds
      .map(stepId => byId.get(stepId))
      .filter((step): step is StepView => step !== undefined)
    const counts = Object.fromEntries(
      BUCKETS.map(bucket => [bucket, steps.filter(step => bucketOf(step.status) === bucket).length]),
    ) as Record<StepBucket, number>
    const state = stateOf(counts, definition.stepIds.length)
    views.push({
      id: definition.id,
      steps,
      declared: definition.stepIds.length,
      missingStepIds: definition.stepIds.filter(stepId => !byId.has(stepId)),
      counts,
      state,
      // A STAGE WITH NOTHING TO REPORT YET says what it is waiting for, and it is the run's own
      // order that says so: a stage preceded by one that has not finished is not "empty", it is
      // early, and the difference is what a reader needs to decide whether to wait or to act.
      missingPrerequisites: earlierIncomplete && definition.stepIds.length > 0
        ? [previousIncompleteId(views)]
        : [],
    })
    if (definition.stepIds.length > 0 && state !== 'done') earlierIncomplete = true
  }
  return views
}

/**
 * The FIRST stage still standing between the run and this one.
 *
 * The earliest incomplete stage, not the latest: it is the one whose completion unblocks the chain,
 * and naming a later stage would send a reader to work that cannot start yet.
 */
function previousIncompleteId(views: ReadonlyArray<StageView>): string {
  for (const candidate of views) {
    if (candidate.declared > 0 && candidate.state !== 'done') return candidate.id
  }
  return 'intake'
}

/** What a stage is doing, from its own counts. */
function stateOf(counts: Readonly<Record<StepBucket, number>>, declared: number): StageView['state'] {
  if (declared === 0) return 'empty'
  if (counts.failed > 0) return 'failed'
  if (counts['awaiting-human'] > 0) return 'awaiting-human'
  if (counts.blocked > 0) return 'blocked'
  if (counts.unknown > 0) return 'blocked'
  if (counts.working > 0) return 'working'
  if (counts.passed === declared) return 'done'
  return 'not-started'
}

/** How far a run has got, in the counts a reader can check. */
export interface RunProgressView {
  /** Steps whose outcome is `passed`. */
  readonly stepsPassed: number
  /** Steps the pipeline catalogues, as the host counted them. */
  readonly stepsTotal: number
  /** Steps held at a human gate: decisions, not progress. */
  readonly awaitingHuman: number
  /** Steps that failed. */
  readonly failed: number
  /** Steps this build cannot name the status of. */
  readonly unknown: number
}

/**
 * Count what the run has done, in numbers that came from the run.
 *
 * NO PERCENTAGE AND NO ESTIMATE. A run's remaining work is not a fraction of its elapsed work: the
 * steps differ by orders of magnitude in cost, so a percentage would be a number this view knows
 * nothing about, and a completion time would be a promise it cannot keep.
 *
 * @param summary - the flattened run summary.
 * @returns the counts, each of which a reader can trace to a step.
 */
export function selectProgress(summary: RunSummary): RunProgressView {
  const buckets = summary.steps.map(step => bucketOf(step.status))
  return {
    stepsPassed: buckets.filter(bucket => bucket === 'passed').length,
    stepsTotal: summary.steps.length,
    awaitingHuman: buckets.filter(bucket => bucket === 'awaiting-human').length,
    failed: buckets.filter(bucket => bucket === 'failed').length,
    unknown: buckets.filter(bucket => bucket === 'unknown').length,
  }
}

/** What one stage produced, and how the checks on its steps went. */
export interface StageEvidenceView {
  /** Artifacts whose producing step belongs to this stage, in the run's own order. */
  readonly artifacts: ReadonlyArray<ArtifactView>
  /** Gate verdicts recorded against this stage's steps that passed. */
  readonly checksPassed: number
  /** Every gate verdict recorded against this stage's steps. */
  readonly checksTotal: number
}

/**
 * Read what one stage produced and how its checks went.
 *
 * BOTH ARE READ FROM THE RUN'S OWN RECORDS: an artifact is placed by the step that produced it, and a
 * check is placed by the step it judged — no stage claims an artifact or a verdict that names
 * another stage's step.
 *
 * @param summary - the flattened run summary.
 * @param stage - the stage to read.
 * @returns the stage's artifacts and its check tally.
 */
export function selectStageEvidence(summary: RunSummary, stage: StageView): StageEvidenceView {
  const ids = new Set(stage.steps.map(step => step.stepId))
  const gates = summary.gates.filter(gate => ids.has(gate.stepId))
  return {
    artifacts: summary.artifacts.filter(artifact => ids.has(artifact.producerStepId)),
    checksPassed: gates.filter(gate => gate.passed).length,
    checksTotal: gates.length,
  }
}

/** A stage the run has not reached, with what it is waiting for. */
export interface StageCoverageGap {
  readonly stepId: string
}

/**
 * Report the steps a projection carries that no stage reports on, and those a stage names that the
 * projection does not carry.
 *
 * THE MAPPING IS CHECKED AGAINST A REAL PROJECTION, not against a copy of the catalogue kept here:
 * a step added to the pipeline must appear in exactly one stage, and this is what says so.
 *
 * @param stepIds - the step ids a projection carries.
 * @returns the ids missing from the mapping, and the mapped ids the projection lacks.
 */
export function verifyStageCoverage(stepIds: ReadonlyArray<string>): {
  readonly unmapped: ReadonlyArray<StageCoverageGap>
  readonly unknown: ReadonlyArray<StageCoverageGap>
} {
  const mapped = new Set(STAGES.flatMap(stage => [...stage.stepIds]))
  const present = new Set(stepIds)
  return {
    unmapped: stepIds.filter(id => !mapped.has(id)).map(stepId => ({ stepId })),
    unknown: [...mapped].filter(id => !present.has(id)).map(stepId => ({ stepId })),
  }
}
