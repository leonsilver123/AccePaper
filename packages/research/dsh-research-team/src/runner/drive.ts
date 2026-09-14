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

import { FIXED_TS, type RunContext, STEP_EXECUTOR_REGISTRY, TRUTHFULNESS_LEVELS, type Truthfulness } from './registry.ts'
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
    ...(opts.invoker !== undefined ? { invoker: opts.invoker } : {}),
    ...(opts.proseWriter !== undefined ? { proseWriter: opts.proseWriter } : {}),
    ...(opts.toolDeps !== undefined ? { toolDeps: opts.toolDeps } : {}),
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
        getInput: (slug: string) => resolveStepInput(store, runId, slug),
        runCtx: opts.runCtx,
        ...(opts.invoker !== undefined ? { invoker: opts.invoker } : {}),
        ...(opts.proseWriter !== undefined ? { proseWriter: opts.proseWriter } : {}),
        ...(opts.toolDeps !== undefined ? { toolDeps: opts.toolDeps } : {}),
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
    const built = await buildStepVerdicts(vctx)
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
  // The kind the artifacts declare about THEMSELVES, when every artifact this step
  // produced agrees on one. The static registry entry cannot know a deployment
  // fact — A1 reaches a live catalogue only where one is configured — so the
  // artifact's own tag is the more specific statement. A step whose artifacts
  // disagree declares nothing here and falls back to the registry entry.
  const declaredKinds = new Set<Truthfulness>()
  for (const slug of stepDef.outputs) {
    const value = getArtifact(store, runId, slug)
    const record =
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined
    const producedBy = record?.__producer
    const artifactKind = record?.__kind
    if (typeof artifactKind === 'string' && (TRUTHFULNESS_LEVELS as ReadonlyArray<string>).includes(artifactKind)) {
      declaredKinds.add(artifactKind as Truthfulness)
    }
    artifacts.push({
      slug,
      producedBy: typeof producedBy === 'string' ? producedBy : entry.producer,
    })
  }
  const declaredKind = declaredKinds.size === 1 ? [...declaredKinds][0] : undefined
  const effectiveKind = declaredKind ?? entry.kind

  return {
    stepId,
    status,
    attemptId,
    kind: effectiveKind,
    producer: entry.producer,
    outputSlugs: stepDef.outputs,
    artifacts,
    verdicts,
    usedRealTool: effectiveKind === 'real_tool_fixture_input',
    executeStatus: res.status,
  }
}

/**
 * Resolve one step input.
 *
 * A step's inputs come from two places, and the registry names both of them
 * (`InputSource` = `run-seed` | `upstream-artifact`). This reader consults BOTH: a run
 * seed set before the run starts, then an upstream step's artifact. Reading only artifacts
 * made every run-seeded input invisible to its own step — a selected Case Pack reached
 * `setRunInput` and then nothing downstream could see it.
 *
 * Seed-before-artifact precedence is unambiguous because core asserts (DEP-8, at module
 * load) that no seedable slug appears in any step's outputs, so the two sources can never
 * name the same input.
 *
 * @param store - the run store.
 * @param runId - the run to read from.
 * @param slug - the input slug.
 * @returns the seeded value when one exists, otherwise the recorded artifact.
 */
function resolveStepInput(store: ResearchRunStore, runId: string, slug: string): unknown {
  const seeded: Record<string, unknown> = getRunSnapshot(store, runId).inputs
  return slug in seeded ? seeded[slug] : getArtifact(store, runId, slug)
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
  // A selected Case Pack supplies this run's entry inputs. They are seeded BEFORE the
  // first step because `setRunInput` refuses a run that is already under way
  // (INV-INPUT-FROZEN), and each value keeps the file and pointer it was derived from.
  for (const input of opts.casePackInputs ?? []) {
    setRunInput(store, runId, input.slug, input.value)
  }
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
    const outcome = await driveStep(store, runId, step.id, stepOpts)
    outcomes.push(outcome)
    // STOP AT THE FIRST STEP THAT DID NOT PASS. Driving on would make the NEXT
    // step's `canStart` guard throw "dependency order violated", which reports the
    // consequence and hides the cause: a real run stopped at A1 because its retrieval
    // channel was rate-limited, and the caller was told A2's ordering was wrong.
    // The failing outcome carries `executeError`, so returning it is what lets a
    // caller say WHY the run ended.
    //
    // `gated` means two different things and only one of them is a place to stop and return:
    // E2's human gate (a person is expected next) and an ABSTAINED HOLD on any other step (the
    // run cannot continue). Treating the hold as "gated, keep going" made the next step's guard
    // throw, so an abstention reached the caller as a dependency error — the same
    // reported-consequence-hides-cause defect this rule exists to remove. The outcome's own
    // `kind` distinguishes them, because the driver sets `humanGate` for the human gate only.
    if (outcome.status !== 'passed' && !(outcome.status === 'gated' && outcome.kind === 'humanGate')) break
  }
  return { runId, steps: outcomes }
}

/** Build a fresh cross-step context (claim / prediction wiring) for a run. */
export function createRunContext(timestamp: number = FIXED_TS): RunContext {
  // `metricKey` starts empty: nothing has declared what the claim is about yet, and the C
  // channel treats an empty key as unbindable rather than assuming a quantity.
  return { predictionText: '', claimId: '', claimRef: '', metricKey: '', timestamp }
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
    const outcome = await driveStep(store, runId, step.id, stepOpts)
    outcomes.push(outcome)
    // Same rule as runT19B, including the human-gate distinction: stop at the first step that did
    // not pass, and continue through `gated` only when it is the human gate rather than a hold.
    if (outcome.status !== 'passed' && !(outcome.status === 'gated' && outcome.kind === 'humanGate')) break
  }
  if (!started) throw new Error(`T19B drive: unknown fromStepId '${fromStepId}'`)
  return { runId, steps: outcomes }
}

export { rollback }
