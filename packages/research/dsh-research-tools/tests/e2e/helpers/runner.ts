/**
 * T19-A P4/P5 E2E — driver (test helper layer).
 *
 * The driver is the boundary between the E2E test and the core engine. Its contract:
 *
 *   runStepWithGate = startStep → runStep(executor) → (upper layer) gate adjudication
 *
 * It does NOT adjudicate and does NOT re-implement `_adjudicate`: on a successful execute it
 * feeds each declared gate component into the core `submitGateVerdict` (which calls the
 * singular `_adjudicate`), and for an empty-gate step it calls `completeStep`. Dependency
 * order is enforced by `STEPS.inputs/outputs` via `canStart` (the driver throws if a step
 * cannot start, surfacing any dependency-order violation as a test failure).
 *
 * The real-tool vs fixture partition is tracked: `D1-figure-map` is the only step whose
 * executor is the REAL figure tool; every other step uses a deterministic fixture executor.
 */

import type { StepExecutor, StepStatus } from './imports.ts'
import {
  STEP_BY_ID,
  STEPS,
  canStart,
  completeStep,
  getRunSnapshot,
  runStep,
  startStep,
  submitGateVerdict,
} from './imports.ts'
import { FIXTURE_EXECUTORS } from '../fixtures/executors.ts'
import { passedVerdictFactory, type VerdictFactory, type VerdictContext } from '../fixtures/verdicts.ts'

/** The single step that integrates the REAL figure tool (vs deterministic fixtures elsewhere). */
export const REAL_TOOL_STEP = 'D1-figure-map'

export interface StepDriveOptions {
  /** Optional per-step executor override (default: fixture map, or REAL tool for D1). */
  executor?: StepExecutor
  /** Optional verdict strategy (default: all components pass). */
  verdictFactory?: VerdictFactory
  /** Pipeline timeout (ms) for the execute phase. */
  timeoutMs?: number
  /** Cooperative-cancellation signal forwarded into runStep. */
  signal?: AbortSignal
}

export interface StepDriveResult {
  readonly runId: string
  readonly stepId: string
  readonly attemptId: number
  /** Final step status after the drive (for a failed/timeout execute this is 'in_progress'). */
  readonly status: StepStatus
  /** Slugs the execute phase actually wrote (empty on error/timeout/cancelled). */
  readonly outputSlugs: ReadonlyArray<string>
  /** True iff this step used the real figure tool. */
  readonly usedRealTool: boolean
  /** Present when the execute phase did not succeed (error/timeout/cancelled). */
  readonly executeError?: string
}

function executorFor(stepId: string, override?: StepExecutor): StepExecutor {
  if (override) return override
  const fixture = FIXTURE_EXECUTORS.get(stepId)
  if (!fixture) throw new Error(`E2E runner: no fixture executor registered for step '${stepId}'`)
  return fixture
}

/**
 * Drive ONE step end-to-end: dependency guard → start → execute (runStep) → gate adjudication
 * (submitGateVerdict / completeStep). Throws if the step cannot start (dependency-order guard).
 */
export async function runStepWithGate(
  store: import('./imports.ts').ResearchRunStore,
  runId: string,
  stepId: string,
  opts: StepDriveOptions = {},
): Promise<StepDriveResult> {
  const stepDef = STEP_BY_ID.get(stepId)
  if (!stepDef) throw new Error(`E2E runner: unknown step '${stepId}'`)

  // Dependency-order guard: only pending steps whose inputs are satisfied may start.
  if (!canStart(store, runId, stepId)) {
    throw new Error(
      `E2E runner: step '${stepId}' cannot start — dependency order violated (inputs not satisfied or not pending)`,
    )
  }

  const started = startStep(store, runId, stepId)
  const attemptId = started.attemptId
  const usedRealTool = stepId === REAL_TOOL_STEP
  const verdictFactory: VerdictFactory = opts.verdictFactory ?? passedVerdictFactory()

  const res = await runStep(store, runId, stepId, {
    executor: executorFor(stepId, opts.executor),
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
  })

  // Execute did NOT succeed: step stays 'in_progress' (rollback-able), NO gate adjudication,
  // NO fake artifact. The caller (recovery scenario) asserts and then rolls back.
  if (res.status !== 'success') {
    return {
      runId,
      stepId,
      attemptId,
      status: 'in_progress',
      outputSlugs: res.outputSlugs,
      usedRealTool,
      executeError: res.error?.message,
    }
  }

  // Successful execute → drive gate adjudication via the core entry (NOT re-implemented here).
  if (stepDef.gate.length === 0) {
    // Empty gate (E2-submit, humanGate): completeStep → 'gated' (awaiting human approval).
    const final = completeStep(store, runId, stepId)
    return { runId, stepId, attemptId, status: final, outputSlugs: res.outputSlugs, usedRealTool }
  }

  const ctxBase = { runId, stepId, attemptId }
  let lastStatus: StepStatus = 'in_progress'
  for (const comp of stepDef.gate) {
    const ctx: VerdictContext = { ...ctxBase, component: comp }
    submitGateVerdict(store, runId, stepId, verdictFactory(ctx))
    lastStatus = getRunSnapshot(store, runId).steps[stepId].status
  }
  return { runId, stepId, attemptId, status: lastStatus, outputSlugs: res.outputSlugs, usedRealTool }
}

/**
 * Drive all 16 steps in canonical order (which is a valid topological order of the DAG).
 * Returns per-step results. E2-submit stops at 'gated' (human gate, no auto-approval).
 */
export async function driveAll(
  store: import('./imports.ts').ResearchRunStore,
  runId: string,
  opts: { verdictFactory?: VerdictFactory; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<StepDriveResult[]> {
  const results: StepDriveResult[] = []
  for (const step of STEPS) {
    results.push(await runStepWithGate(store, runId, step.id, opts))
  }
  return results
}
