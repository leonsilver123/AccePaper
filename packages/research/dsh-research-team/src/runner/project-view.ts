// @deepseek-ai/dsh-research-team — the run's steps, read from the run's own records.
//
// WHY THIS EXISTS. The view the browser renders used to be built from `RunResult`, the value a
// drive call returns when it has finished. That made "what is this run doing" unanswerable while it
// was doing it: a running study has no `RunResult` yet, so a query would either have to wait for the
// end (which is not a query) or invent outcomes for steps that have not run.
//
// Everything needed is already a durable fact. `getRunSnapshot` returns the step states, the
// artifact registry, the run revision AND the audit events, and a `step-executed` event records how
// each step's last execution ended — including why it failed. This module reads those and nothing
// else: no fabricated `StepOutcome`, no assertion around a missing field.

import type { ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { getRunSnapshot } from '@deepseek-ai/dsh-research-core'

import { STEP_EXECUTOR_REGISTRY } from './registry.ts'

/**
 * How one step's last execution ended, from its `step-executed` record.
 *
 * Absent means the step has not executed yet in this run — a fact, and not `success`.
 */
export interface StepExecutionView {
  /** `success` | `error` | `timeout` | `cancelled`, verbatim from the record. */
  readonly status: string
  /** Why it failed, when it did. */
  readonly errorMessage?: string
  /** Wall-clock duration the record measured; ABSENT when the record did not measure one. */
  readonly durationMs?: number
  /** When the record was appended (the record's own ISO timestamp). */
  readonly recordedAt: string
}

/** One step, as a reader of the run needs it. */
export interface StepProjection {
  readonly stepId: string
  readonly status: string
  readonly attemptId: number
  /** The executor's declared truthfulness level, from the registry. */
  readonly kind: string
  readonly producer: string
  readonly outputSlugs: ReadonlyArray<string>
  /** Artifacts this step has COMMITTED, with the producer that wrote them. */
  readonly artifacts: ReadonlyArray<{ readonly slug: string; readonly producedBy: string }>
  /** Gate component to outcome, for the gates this step has had adjudicated. */
  readonly verdicts: Readonly<Record<string, string>>
  /** Whether the executor is one that reaches a real external system. */
  readonly usedRealTool: boolean
  readonly executeStatus?: string
  readonly executeError?: string
  readonly holdReason?: string
  /**
   * The last human decision recorded against this step, when one was.
   *
   * Read from the run's own approval record rather than from whatever a page happened to see: a
   * decision is a durable fact about the study, and a page that loads after it must be able to state
   * who decided, when, and — for a change request — what was asked for.
   */
  readonly approval?: StepApprovalProjection
}

/** One step's recorded human decision, as a reader of the run needs it. */
export interface StepApprovalProjection {
  /** `approved`, `rejected`, or `request_changes`, which leaves the gate open. */
  readonly decision: string
  readonly operator: string
  readonly decidedAt: number
  /** The instruction a change request carries, or a rejection's reason. */
  readonly rationale?: string
  /**
   * The artifact revisions that were in front of the person, frozen when they decided.
   *
   * A decision is about a revision, not a step name: these are the refs the run recorded at the
   * moment of the decision, so a reader can tell whether the thing they are looking at now is the
   * thing that was decided about.
   */
  readonly targetRefs: ReadonlyArray<{ readonly artifactId: string; readonly version: number }>
}

/**
 * Every step of a run, in canonical order, from the run's own records.
 *
 * @param store - the run store, live or restored.
 * @param runId - the run to read.
 * @returns one projection per catalogued step.
 * @throws {ResearchRunError} when the store holds no such run.
 */
export function stepProjectionsOf(
  store: ResearchRunStore,
  runId: string,
): ReadonlyArray<StepProjection> {
  const snapshot = getRunSnapshot(store, runId)
  // HOW THE STEP'S CURRENT ATTEMPT ENDED — keyed by `(stepId, attemptId)`, never by `stepId` alone.
  // Keying on the step and taking the last record let a SUPERSEDED attempt's record win: a timeout
  // or cancellation is emitted from the attempt that was started, without re-checking whether the
  // step has since moved on (`engine/pipeline.ts`), so an old attempt's late record lands after the
  // new attempt's and overwrote it. The step's own state carries the attempt it is on; a record for
  // any other attempt is history about an attempt this run no longer has.
  const execution = new Map<string, StepExecutionView>()
  for (const event of snapshot.events) {
    if (event.kind !== 'step-executed' || event.stepId === undefined || event.attemptId === undefined) continue
    const detail = event.detail as
      | { status?: unknown; errorMessage?: unknown; durationMs?: unknown; recordedAt?: unknown }
      | undefined
    if (detail === undefined || typeof detail.status !== 'string') continue
    execution.set(`${event.stepId}#${String(event.attemptId)}`, {
      status: detail.status,
      ...(typeof detail.errorMessage === 'string' ? { errorMessage: detail.errorMessage } : {}),
      ...(typeof detail.durationMs === 'number' ? { durationMs: detail.durationMs } : {}),
      recordedAt: typeof detail.recordedAt === 'string' ? detail.recordedAt : new Date(event.ts).toISOString(),
    })
  }

  // Which step produced each artifact, so a step's list is the artifacts IT committed rather than
  // every artifact the run holds.
  const byStep = new Map<string, Array<{ slug: string; producedBy: string }>>()
  for (const record of Object.values(snapshot.registry)) {
    const list = byStep.get(record.producerStepId) ?? []
    list.push({ slug: record.slug, producedBy: record.producerStepId })
    byStep.set(record.producerStepId, list)
  }

  return [...STEP_EXECUTOR_REGISTRY.values()].map((entry): StepProjection => {
    const state = snapshot.steps[entry.stepId]
    // The record for the attempt the step is ON. A step that has not been started has no attempt to
    // match, and then no record is claimed — which is the same fact as "it has not executed".
    const ran = state === undefined ? undefined : execution.get(`${entry.stepId}#${String(state.attemptId)}`)
    const verdicts: Record<string, string> = {}
    // `gateResults` is a partial map of the three components; only the ones that were graded
    // appear, so iterating the entries is what keeps an ungraded component absent rather than
    // present with a fabricated outcome.
    for (const [component, verdict] of Object.entries(state?.gateResults ?? {})) {
      verdicts[component] = verdict.outcome
    }
    return {
      stepId: entry.stepId,
      // A step with no state has not been started; `pending` is what the run left behind, not a
      // default standing in for an answer.
      status: state?.status ?? 'pending',
      attemptId: state?.attemptId ?? 0,
      kind: entry.kind,
      producer: entry.producer,
      outputSlugs: [...(state?.outputs ?? [])],
      artifacts: byStep.get(entry.stepId) ?? [],
      verdicts,
      usedRealTool: entry.kind === 'real_tool_fixture_input',
      ...(ran === undefined ? {} : { executeStatus: ran.status }),
      ...(ran?.errorMessage === undefined ? {} : { executeError: ran.errorMessage }),
      ...(state?.holdReason === undefined ? {} : { holdReason: state.holdReason }),
      ...(state?.approval === undefined ? {} : {
        approval: {
          decision: state.approval.decision,
          operator: state.approval.principalId,
          decidedAt: state.approval.timestamp,
          ...(state.approval.rationale === undefined ? {} : { rationale: state.approval.rationale }),
          targetRefs: state.approval.targetRefs.map(ref => ({
            artifactId: ref.artifactId, version: ref.version,
          })),
        },
      }),
    }
  })
}
