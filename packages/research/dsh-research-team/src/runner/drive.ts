// @deepseek-ai/dsh-research-team — T19-B execution driver.
//
// Drives the real executor registry through the 16-step pipeline using the CORE
// engine as the single authority for state + gate adjudication:
//
//   createRun → setRunInput('domain-direction') → for each step in canonical order:
//     canStart (dependency guard) → startStep → runStep(registry executor)
//     → on success: build genuine gate verdicts (verdict.ts) → submitGateVerdict
//       (core `_adjudicate` is the SOLE gate adjudicator) → step leaves in_progress
//     → E2-submit (humanGate, empty gate): completeStep → 'gated' (await human approval)
//
// Discipline (spec §3/§7): the driver does NOT re-implement the gate, does NOT
// reinterpret outcomes, does NOT add a StepStatus, does NOT auto-approve E2, and
// preserves core runStep atomicity (rollback / new-attempt / timeout / error /
// artifact). Every artifact carries producer evidence (see registry.tagArtifact).
//
// EVERY core symbol used here comes from the public `@deepseek-ai/dsh-research-core`
// entry — including `runStep` and the read-only step accessors
// `getStepDefinitions()` / `getStepDefinitionById()`. No cross-package relative
// import into core `src/` (that never type-checks), and NO manual audit append:
// core `runStep` already emits 'step-executed' and core `submitGateVerdict` already
// emits 'gate-verdict' / 'gate-abstention' / 'step-completed'. Appending our own
// event would duplicate the audit trail.

import type {
  GateOutcome,
  ResearchRunStore,
  StepDefinition,
  StepExecContext,
  StepStatus,
} from '@deepseek-ai/dsh-research-core'
import {
  canStart,
  completeStep,
  createRun,
  getArtifact,
  getRunSnapshot,
  getStepDefinitionById,
  getStepDefinitions,
  rollback,
  runStep,
  setRunInput,
  startStep,
  submitGateVerdict,
} from '@deepseek-ai/dsh-research-core'

import { FIXED_TS, type RunContext, STEP_EXECUTOR_REGISTRY } from './registry.ts'
import type {
  DriveOptions,
  DriveStepOptions,
  RunResult,
  StepArtifactEvidence,
  StepOutcome,
  VerdictBuildCtx,
} from './types.ts'
import { buildStepVerdicts } from './verdict.ts'

export type {
  DriveOptions,
  DriveStepOptions,
  RunResult,
  StepArtifactEvidence,
  StepOutcome,
} from './types.ts'

/**
 * Narrow the per-step scenario hooks down to the subset that is actually defined.
 * Required under `exactOptionalPropertyTypes`: an explicit `undefined` is NOT a
 * legal value for an optional property.
 */
function stepOptsFrom(runCtx: RunContext, opts: DriveOptions): DriveStepOptions {
  return {
    runCtx,
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    ...(opts.executorOverride !== undefined ? { executorOverride: opts.executorOverride } : {}),
    ...(opts.abstainComponents !== undefined ? { abstainComponents: opts.abstainComponents } : {}),
  }
}

/** Drive exactly one step end-to-end (dependency guard → execute → gate → E2 stop). */
export async function driveStep(
  store: ResearchRunStore,
  runId: string,
  stepId: string,
  opts: DriveStepOptions,
): Promise<StepOutcome> {
  const entry = STEP_EXECUTOR_REGISTRY.get(stepId)
  if (!entry) throw new Error(`T19B drive: no registry entry for '${stepId}'`)
  const stepDef: StepDefinition | undefined = getStepDefinitionById(stepId)
  if (!stepDef) throw new Error(`T19B drive: unknown step '${stepId}'`)
  if (!canStart(store, runId, stepId)) {
    throw new Error(`T19B drive: step '${stepId}' cannot start — dependency order violated`)
  }

  const started = startStep(store, runId, stepId)
  const attemptId = started.attemptId
  const usedRealTool = entry.kind === 'real_tool_fixture_input'

  // E2-submit: human gate, empty gate → completeStep leaves it 'gated' (awaiting
  // human approval). The driver NEVER auto-approves (spec §7).
  if (entry.humanGateStop) {
    const status = completeStep(store, runId, stepId)
    return {
      stepId,
      status,
      attemptId,
      kind: 'humanGate',
      producer: entry.producer,
      outputSlugs: [],
      artifacts: [],
      verdicts: {},
      usedRealTool: false,
    }
  }

  // Execute phase — core runStep keeps atomicity (rollback / attempt / timeout / error).
  // The timeout comes from the registry declaration unless the caller overrides it.
  const myExec = opts.executorOverride?.(stepId) ?? entry.executor
  const effectiveTimeoutMs = opts.timeoutMs ?? entry.timeoutMs
  const res = await runStep(store, runId, stepId, {
    executor: (coreCtx: StepExecContext) =>
      myExec({
        runId: coreCtx.runId,
        stepId: coreCtx.stepId,
        attemptId: coreCtx.attemptId,
        ...(coreCtx.signal !== undefined ? { signal: coreCtx.signal } : {}),
        getInput: (slug: string) => getArtifact(store, runId, slug),
        runCtx: opts.runCtx,
      }),
    ...(effectiveTimeoutMs > 0 ? { timeoutMs: effectiveTimeoutMs } : {}),
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  })

  // Execute did NOT succeed: step stays 'in_progress' (rollback-able), NO artifact,
  // NO gate adjudication. The caller asserts and then rolls back (recovery).
  if (res.status !== 'success') {
    return {
      stepId,
      status: 'in_progress',
      attemptId,
      kind: entry.kind,
      producer: entry.producer,
      outputSlugs: res.outputSlugs,
      artifacts: [],
      verdicts: {},
      usedRealTool,
      executeStatus: res.status,
      ...(res.error !== undefined ? { executeError: res.error.message } : {}),
    }
  }

  // Gate phase — build genuine verdicts and submit via core (single adjudication source).
  // core `submitGateVerdict` writes the 'gate-verdict' / 'gate-abstention' audit
  // events itself; the driver adds nothing.
  const verdicts: Record<string, GateOutcome> = {}
  if (stepDef.gate.length > 0) {
    const comps = opts.abstainComponents?.(stepId) ?? []
    const vctx: VerdictBuildCtx = {
      step: stepDef,
      attemptId,
      runCtx: opts.runCtx,
      abstain: new Set(comps),
    }
    const built = buildStepVerdicts(vctx)
    for (const v of built) {
      submitGateVerdict(store, runId, stepId, v)
      verdicts[v.component] = v.outcome
    }
  }

  const snap = getRunSnapshot(store, runId)
  const stepSnap = snap.steps[stepId]
  if (stepSnap === undefined) {
    throw new Error(`T19B drive: step '${stepId}' missing from the run snapshot`)
  }
  const status: StepStatus = stepSnap.status

  const artifacts: StepArtifactEvidence[] = []
  for (const slug of stepDef.outputs) {
    const value = getArtifact(store, runId, slug)
    const producedBy =
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>).__producer
        : undefined
    artifacts.push({
      slug,
      producedBy: typeof producedBy === 'string' ? producedBy : entry.producer,
    })
  }

  return {
    stepId,
    status,
    attemptId,
    kind: entry.kind,
    producer: entry.producer,
    outputSlugs: stepDef.outputs,
    artifacts,
    verdicts,
    usedRealTool,
    executeStatus: res.status,
  }
}

/**
 * Drive a full 16-step run. Returns the per-step outcomes. `stopBefore` halts
 * before the named step (used by recovery scenarios to inject faults mid-run).
 *
 * The execution order is the canonical order of `getStepDefinitions()` — core owns
 * the graph, the driver never re-declares it.
 */
export async function runT19B(
  store: ResearchRunStore,
  opts: DriveOptions = {},
): Promise<RunResult> {
  const timestamp = opts.fixedTimestamp ?? FIXED_TS
  const runCtx: RunContext = createRunContext(timestamp)
  const runId = createRun(store)
  setRunInput(
    store,
    runId,
    'domain-direction',
    opts.domainDirection ?? 'adaptive traffic signal control research program',
  )

  const stepOpts = stepOptsFrom(runCtx, opts)
  const outcomes: StepOutcome[] = []
  for (const step of getStepDefinitions()) {
    if (opts.stopBefore !== undefined && step.id === opts.stopBefore) break
    outcomes.push(await driveStep(store, runId, step.id, stepOpts))
  }
  return { runId, steps: outcomes }
}

/** Build a fresh cross-step context (claim / prediction wiring) for a run. */
export function createRunContext(timestamp: number = FIXED_TS): RunContext {
  return { predictionText: '', claimId: '', claimRef: '', timestamp }
}

/** Drive every step from `fromStepId` (inclusive) through E2. */
export async function driveRemaining(
  store: ResearchRunStore,
  runId: string,
  runCtx: RunContext,
  fromStepId: string,
  opts: Omit<DriveOptions, 'stopBefore'> = {},
): Promise<RunResult> {
  const stepOpts = stepOptsFrom(runCtx, opts)
  const outcomes: StepOutcome[] = []
  let started = false
  for (const step of getStepDefinitions()) {
    if (!started) {
      if (step.id !== fromStepId) continue
      started = true
    }
    outcomes.push(await driveStep(store, runId, step.id, stepOpts))
  }
  if (!started) throw new Error(`T19B drive: unknown fromStepId '${fromStepId}'`)
  return { runId, steps: outcomes }
}

export { rollback }
