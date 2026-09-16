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
  // The LAST execution record per step, which is what "how did it end" means. An earlier attempt's
  // record is history: reading the first would report a failure the step has since recovered from.
  const execution = new Map<string, StepExecutionView>()
  for (const event of snapshot.events) {
    if (event.kind !== 'step-executed' || event.stepId === undefined) continue
    const detail = event.detail as
      | { status?: unknown; errorMessage?: unknown; durationMs?: unknown; recordedAt?: unknown }
      | undefined
    if (detail === undefined || typeof detail.status !== 'string') continue
    execution.set(event.stepId, {
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
    const ran = execution.get(entry.stepId)
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
    }
  })
}
