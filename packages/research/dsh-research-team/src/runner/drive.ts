// @deepseek-ai/dsh-research-team — T19-B execution driver.
//
// Drives the real executor registry through the 16-step pipeline using the CORE
// engine as the single authority for state + gate adjudication:
//
//   createRun → setRunInput('domain-direction') → for each step in canonical order:
//     canStart (dependency guard) → startStep → runStep(registry executor)
//     → on success: build genuine gate verdicts (verdict.ts) → submitGateVerdict
//       (core `_adjudicate` is the SOLE gate adjudicator) → step leaves in_progress
//     → E2-submit (humanGate, empty gate): its executor PREPARES the submission request and
//       submits nothing → completeStep → 'gated' (await human approval)
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
  ArtifactRef,
  GateOutcome,
  ResearchRunStore,
  StepDefinition,
  StepExecContext,
  StepStatus,
} from '@deepseek-ai/dsh-research-core'
import { join } from 'node:path'
import {
  DEFAULT_EVIDENCE_PROFILE,
  canStart,
  completeStep,
  createRun,
  getArtifact,
  getRunSnapshot,
  getStepDefinitionById,
  getStepDefinitions,
  recordManuscriptProjectionFailure,
  rollback,
  runStep,
  setRunInput,
  setRunSpec,
  startStep,
  submitGateVerdict,
} from '@deepseek-ai/dsh-research-core'

import { FIXED_TS, type RunContext, STEP_EXECUTOR_REGISTRY, TRUTHFULNESS_LEVELS, type Truthfulness } from './registry.ts'
import { EMPTY_CLAIM_MATERIAL } from './redteam-review.ts'
import { experimentStudy } from './platoon-sim.ts'
import { requireStudyAdapter } from './study-adapter.ts'
import { DEFAULT_PLAN, planForDirection, requirePlan } from './study-plan.ts'
import type { StudyPlan } from './study-plan.ts'
import type {
  DriveOptions,
  DriveStepOptions,
  RunResult,
  StepArtifactEvidence,
  StepOutcome,
  VerdictBuildCtx,
} from './types.ts'
import { buildStepVerdicts } from './verdict.ts'
import { referencePdfPlan } from './package-export.ts'
import { planManuscriptDirectory, writeManuscriptDirectory } from './manuscript-directory.ts'

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
    ...(opts.evidenceProfile !== undefined ? { evidenceProfile: opts.evidenceProfile } : {}),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    ...(opts.executorOverride !== undefined ? { executorOverride: opts.executorOverride } : {}),
    ...(opts.abstainComponents !== undefined ? { abstainComponents: opts.abstainComponents } : {}),
    ...(opts.invoker !== undefined ? { invoker: opts.invoker } : {}),
    ...(opts.proseWriter !== undefined ? { proseWriter: opts.proseWriter } : {}),
    ...(opts.documentCompiler !== undefined ? { documentCompiler: opts.documentCompiler } : {}),
    ...(opts.figureProvider !== undefined ? { figureProvider: opts.figureProvider } : {}),
    ...(opts.statementAssessor !== undefined ? { statementAssessor: opts.statementAssessor } : {}),
    ...(opts.sources !== undefined ? { sources: opts.sources } : {}),
    ...(opts.resolutionVerifier !== undefined ? { resolutionVerifier: opts.resolutionVerifier } : {}),
    ...(opts.reviewPolicy !== undefined ? { reviewPolicy: opts.reviewPolicy } : {}),
    ...(opts.toolDeps !== undefined ? { toolDeps: opts.toolDeps } : {}),
    ...(opts.evidenceSourceDoi !== undefined ? { evidenceSourceDoi: opts.evidenceSourceDoi } : {}),
    ...(opts.revisionRounds !== undefined ? { revisionRounds: opts.revisionRounds } : {}),
    ...(opts.manuscriptDirectory !== undefined ? { manuscriptDirectory: opts.manuscriptDirectory } : {}),
    ...(opts.referenceFiles !== undefined ? { referenceFiles: opts.referenceFiles } : {}),
  }
}

/**
 * Project the run's document onto its working directory, when this deployment configured one.
 *
 * THE SINGLE PLACE THE DRIVER OBSERVES A COMMIT, and therefore the single place this is written:
 * `runStep` above either committed or returned a non-success status, and every other caller of the
 * projection would be guessing which. What is projected is the run's REGISTRY — not the executor's
 * return value — so the directory cannot describe anything the commit refused.
 *
 * A FAILURE HERE DOES NOT FAIL THE STEP. The step has already committed; throwing away real work in
 * order to complain that a copy of it did not land is the trade `checkpointAfterStep` already
 * refuses. What must not happen is the failure going unsaid, so it is recorded twice: on the run's
 * own audit log — which is what the panel and the package checks read — and on the outcome, which is
 * how the run's result reports it.
 *
 * @param store - the run store, after the commit.
 * @param runId - the run that just committed.
 * @param stepId - the step whose commit this follows.
 * @param attemptId - the attempt that committed.
 * @param opts - the driver options carrying the directory and the deployment's reader.
 * @returns the failure as one sentence, or undefined when the projection landed or none is wanted.
 */
async function projectManuscript(
  store: ResearchRunStore,
  runId: string,
  stepId: string,
  attemptId: number,
  opts: DriveStepOptions,
): Promise<string | undefined> {
  const root = opts.manuscriptDirectory
  if (root === undefined) return undefined
  try {
    // THE REFERENCE FILES ARE READ HERE, not by the planner, for the same reason the package's are:
    // the planner decides what the directory may carry and never touches a file. Before the first
    // step that writes citations this asks for nothing, so a run reads its attachments only over the
    // steps where it has any.
    const plan = planManuscriptDirectory(store, runId, {
      referencePdfs: await referencePdfPlan(store, runId, opts.referenceFiles, opts.sources ?? new Map()),
    })
    writeManuscriptDirectory(plan, root)
    return undefined
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const version = getRunSnapshot(store, runId).registry['manuscript']?.ref.version
    recordManuscriptProjectionFailure(store, runId, {
      stepId,
      attemptId,
      // THE DIRECTORY, not the message: a reader told where the projection was aimed can look at it,
      // and the sentence below is what went wrong rather than where it happened.
      directory: join(root, runId),
      reason,
      ...(version === undefined ? {} : { manuscriptVersion: version }),
    })
    return `${stepId} (attempt ${String(attemptId)}): ${reason}`
  }
}

/**
 * Why a step cannot start, as far as the driver can tell from public state.
 *
 * `canStart` decides; this explains. It reads the step's recorded status and resolves each declared
 * input the same way the executor will, so the answer names the fact the caller needs instead of
 * the ordering rule that happened to reject it.
 *
 * @param store - the run store.
 * @param runId - the run to inspect.
 * @param stepId - the step that was refused.
 * @param stepDef - the step's definition, for its declared inputs.
 * @returns a one-line reason.
 */
function startabilityOf(
  store: ResearchRunStore,
  runId: string,
  stepId: string,
  stepDef: StepDefinition,
): string {
  const status = getRunSnapshot(store, runId).steps[stepId]?.status
  if (status !== undefined && status !== 'pending') {
    return `its status is '${status}', and only a 'pending' step can start`
  }
  const missing = stepDef.inputs.filter(input => resolveStepInput(store, runId, input) === undefined)
  if (missing.length > 0) {
    return `it is missing ${missing.map(input => `'${input}'`).join(', ')}`
  }
  // The engine refused and the driver can see nothing wrong: say exactly that rather than
  // inventing an ordering problem.
  return 'the engine refused it, and its status and declared inputs both look startable to the driver'
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
    // NAME THE CAUSE, not the symptom. "dependency order violated" was this thread's recurring
    // red herring: it was printed for a step held by an abstention, for a step whose inputs were
    // missing, and for a step that was simply not pending — and every time the reader was sent
    // looking at the ordering. `canStart` is the decision; this only explains it, using the same
    // input reader the driver uses.
    throw new Error(
      `T19B drive: step '${stepId}' cannot start — ${startabilityOf(store, runId, stepId, stepDef)}`,
    )
  }

  const started = startStep(store, runId, stepId)
  const attemptId = started.attemptId
  const usedRealTool = entry.kind === 'real_tool_fixture_input'

  // Execute phase — core runStep keeps atomicity (rollback / attempt / timeout / error).
  // The timeout comes from the registry declaration unless the caller overrides it.
  const myExec = opts.executorOverride?.(stepId) ?? entry.executor
  const effectiveTimeoutMs = opts.timeoutMs ?? entry.timeoutMs
  // Every slug the executor asks for, in the order it asks. Recorded so the run can state what it
  // actually read — the declared inputs are what the engine schedules on, and the two are only the
  // same when nobody has made a mistake.
  const readSlugs: string[] = []
  const res = await runStep(store, runId, stepId, {
    // The versions this attempt consumed, resolved at commit time from the slugs the executor
    // asked for. This is what makes the receipt's `inputDigest` name a state rather than a
    // placeholder.
    inputRefs: () => {
      const registry = getRunSnapshot(store, runId).registry
      const refs: ArtifactRef[] = []
      for (const slug of readSlugs) {
        const meta = registry[slug]
        if (meta !== undefined) refs.push(meta.ref)
      }
      return refs
    },
    executor: (coreCtx: StepExecContext) =>
      myExec({
        runId: coreCtx.runId,
        stepId: coreCtx.stepId,
        attemptId: coreCtx.attemptId,
        ...(coreCtx.signal !== undefined ? { signal: coreCtx.signal } : {}),
        getInput: (slug: string) => {
          readSlugs.push(slug)
          return resolveStepInput(store, runId, slug)
        },
        // WHICH VERSION, not only which value. Resolved from the same registry `getInput` reads, so an
        // executor cannot be handed a value and a version that describe different revisions.
        readInputRef: (slug: string) => inputRefOf(store, runId, slug),
        runCtx: opts.runCtx,
        ...(opts.invoker !== undefined ? { invoker: opts.invoker } : {}),
        ...(opts.proseWriter !== undefined ? { proseWriter: opts.proseWriter } : {}),
        ...(opts.documentCompiler !== undefined ? { documentCompiler: opts.documentCompiler } : {}),
        ...(opts.figureProvider !== undefined ? { figureProvider: opts.figureProvider } : {}),
        ...(opts.statementAssessor !== undefined ? { statementAssessor: opts.statementAssessor } : {}),
        ...(opts.sources !== undefined ? { sources: opts.sources } : {}),
        ...(opts.resolutionVerifier !== undefined ? { resolutionVerifier: opts.resolutionVerifier } : {}),
        ...(opts.reviewPolicy !== undefined ? { reviewPolicy: opts.reviewPolicy } : {}),
        ...(opts.toolDeps !== undefined ? { toolDeps: opts.toolDeps } : {}),
        ...(opts.revisionRounds !== undefined ? { revisionRounds: opts.revisionRounds } : {}),
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
      readSlugs: [...readSlugs],
      executeStatus: res.status,
      ...(res.error !== undefined ? { executeError: res.error.message } : {}),
    }
  }

  // THE STEP COMMITTED. Before the gate, because the gate does not decide whether the work exists:
  // a blocked or failed step's output IS committed, and the person editing the file has to be able
  // to see the document the run actually holds. A failure of the projection is reported rather than
  // raised — see {@link projectManuscript}.
  const projectionError = await projectManuscript(store, runId, stepId, attemptId, opts)

  // Finalize phase — the two ways a step reaches a terminal status, and no third one.
  //
  // AN EMPTY GATE IS FINALIZED BY `completeStep`, the core's empty-gate finalize. For the pipeline's
  // human gate (E2-submit) that call leaves the step `gated`: the run STOPS HERE FOR A PERSON, and
  // the driver never approves it (spec §7) — the host's approval channel is the only route to
  // `passed`. E2 HAS AN EXECUTOR AND IS NOT EXEMPT FROM THIS PATH ANY MORE: it prepares the
  // submission request through the same startStep → runStep → completeStep sequence as every other
  // step, so the request it declares as its output is really written, and the decision on it is
  // still nobody's but the person's.
  //
  // A NON-EMPTY GATE is adjudicated by the verdicts below, and core `submitGateVerdict` writes the
  // 'gate-verdict' / 'gate-abstention' audit events itself; the driver adds nothing.
  const verdicts: Record<string, GateOutcome> = {}
  if (stepDef.gate.length === 0) {
    completeStep(store, runId, stepId)
  } else {
    const comps = opts.abstainComponents?.(stepId) ?? []
    // The receipt this attempt's commit produced. Its absence is not tolerated here: a step whose
    // gate is non-empty was executed through `runStep`, which commits, and a missing receipt means
    // the execute phase did not do what this driver believes it did.
    const receipt = getRunSnapshot(store, runId).steps[stepId]?.commit
    if (receipt === undefined) {
      throw new Error(
        `T19B drive: step '${stepId}' reached its gate with no commit receipt — its verdicts would`
          + ' judge nothing',
      )
    }
    const vctx: VerdictBuildCtx = {
      step: stepDef,
      attemptId,
      commit: receipt,
      runCtx: opts.runCtx,
      abstain: new Set(comps),
      // Resolved once, here, so every channel is built under the run's declared profile. The
      // default is the demo profile: an undeclared run executes and cannot be submitted.
      evidenceProfile: opts.evidenceProfile ?? DEFAULT_EVIDENCE_PROFILE,
      evidenceSourceDoi: opts.evidenceSourceDoi,
      // The same resolution the executor used, so a verdict and the step it judges cannot disagree
      // about what the run contains.
      readInput: (slug: string) => resolveStepInput(store, runId, slug),
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
    readSlugs: [...readSlugs],
    executeStatus: res.status,
    ...(projectionError === undefined ? {} : { projectionError }),
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
 * The reference of the artifact the run holds under a slug, or undefined when it holds none.
 *
 * THE OTHER HALF OF {@link resolveStepInput}. That function answers with a value, and a value does not
 * know its own version — so a step that has to state which revision it read (E1 records the manuscript
 * version its typeset form is of, E2 records the versions its submission request was prepared from)
 * has no way to say it from the value alone. This reads the run's registry, which is where that fact
 * lives.
 *
 * A SEEDED INPUT IS NOT AN ARTIFACT. `domain-direction` and the Case Pack files are recorded in the
 * run's `inputs` by `setRunInput` before it starts, are assigned no version, and answer undefined here
 * rather than a number invented for them.
 *
 * @param store - the run store.
 * @param runId - the run to read from.
 * @param slug - the artifact slug.
 * @returns the reference, or undefined.
 */
function inputRefOf(store: ResearchRunStore, runId: string, slug: string): ArtifactRef | undefined {
  return getRunSnapshot(store, runId).registry[slug]?.ref
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
  const prepared = prepareRun(store, opts)
  return await driveRun(store, prepared.runId, prepared.runCtx, opts)
}

/**
 * Create the run and write everything that must exist before it is driven.
 *
 * SPLIT FROM DRIVING so a caller can answer a start command with a run id before the work happens.
 * The two halves have different owners: this one creates, seeds and freezes — and a run id created
 * here is THE run id, not a first attempt at one. A command that returns an id while a second
 * `createRun` waits inside the driver would hand the caller an id no artifact will ever carry.
 *
 * @param store - the run store the run is created in.
 * @param opts - the drive options; `runId` is ignored, since this is what creates one.
 * @returns the run id and the context the driver runs with.
 */
export function prepareRun(
  store: ResearchRunStore,
  opts: DriveOptions = {},
): { readonly runId: string; readonly runCtx: RunContext } {
  const timestamp = opts.fixedTimestamp ?? FIXED_TS
  // The research this run carries. A deployment states it; the default stands in otherwise, and
  // the run's seedable direction overrides that default's own direction rather than adding a
  // second place the direction is written.
  const requested = opts.studyPlan ?? (opts.domainDirection === undefined
    ? DEFAULT_PLAN
    : planForDirection(opts.domainDirection))
  // RESOLVED HERE, at the driver's own boundary, and not left for the step that needs it. The
  // driver accepts a plan without an implementation id — the wire path never carries one — and
  // `B1-method` used to be where that surfaced, as a thrown error four steps into a run whose
  // first four gates had already closed. One resolution point, before the first step, means a plan
  // this runner cannot execute is refused while a caller can still be told why.
  const resolvedPlan = requirePlan(requested, requested.metric)
  if (!resolvedPlan.ok) {
    throw new Error(`T19B drive: the plan cannot be executed — ${resolvedPlan.reason}`)
  }
  const plan = resolvedPlan.plan
  // THE STUDY AND THE RESEARCH TYPE MUST AGREE. A profile that says this deployment conducts
  // literature reviews, driving a plan whose quantity is a simulated platoon measurement, is two
  // configurations disagreeing about what the run IS — and the metrics a reader would check it against
  // come from the type while the numbers come from the study. Refused here, before the first step,
  // rather than discovered by a reader of the finished paper.
  const typeMetrics = opts.researchProfile?.metrics.required ?? []
  const metricKey = plan.metric.key
  if (typeMetrics.length > 0 && !typeMetrics.some(definition => definition.key === metricKey)) {
    throw new Error(
      `T19B drive: this run is conducted as a '${opts.researchProfile?.researchType ?? 'unknown'}'`
      + ` and its plan measures '${metricKey}', which that research type does not have`
      + ` (it has: ${typeMetrics.map(definition => definition.key).join(', ')}) — the study and the`
      + ' type must be the same configuration',
    )
  }
  const runCtx: RunContext = createRunContext(
    timestamp,
    plan,
    opts.studyPlan === undefined ? 'default' : 'caller',
  )
  const runId = createRun(store)
  // A selected Case Pack supplies this run's entry inputs. They are seeded BEFORE the
  // first step because `setRunInput` refuses a run that is already under way
  // (INV-INPUT-FROZEN), and each value keeps the file and pointer it was derived from.
  for (const input of opts.casePackInputs ?? []) {
    setRunInput(store, runId, input.slug, input.value)
  }
  // The seeded direction IS the plan's, because it is also A1's retrieval topic: two values for
  // one fact is how a run's literature came to be about something its measurement was not.
  setRunInput(store, runId, 'domain-direction', plan.direction)
  // The RESOLVED configuration, recorded on the run before it starts. A resume that rebuilt any of
  // this from the deployment's CURRENT settings would drive a different run from the one whose
  // artifacts it is holding — the plan's title, field, direction and outline are in no artifact,
  // so without this record they can only be re-defaulted.
  setRunSpec(store, runId, runSpecOf(plan, planSourceOf(opts), opts))

  return { runId, runCtx }
}

/**
 * Drive a run that already exists, step by step.
 *
 * @param store - the store holding the run.
 * @param runId - the run to drive; it must have been prepared.
 * @param runCtx - the context {@link prepareRun} built for it.
 * @param opts - the drive options.
 * @returns the per-step outcomes, and any checkpoint failures alongside them.
 */
export async function driveRun(
  store: ResearchRunStore,
  runId: string,
  runCtx: RunContext,
  opts: DriveOptions = {},
): Promise<RunResult> {
  const stepOpts = stepOptsFrom(runCtx, opts)
  const outcomes: StepOutcome[] = []
  const checkpointErrors: string[] = []
  const projectionErrors: string[] = []
  for (const step of getStepDefinitions()) {
    if (opts.stopBefore !== undefined && step.id === opts.stopBefore) break
    const outcome = await driveStep(store, runId, step.id, stepOpts)
    outcomes.push(outcome)
    if (outcome.projectionError !== undefined) projectionErrors.push(outcome.projectionError)
    await checkpoint(runId, opts, outcome, checkpointErrors)
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
  return {
    runId,
    steps: outcomes,
    ...(checkpointErrors.length === 0 ? {} : { checkpointErrors }),
    ...(projectionErrors.length === 0 ? {} : { projectionErrors }),
  }
}

/**
 * The resolved configuration a run is driven with, as the run records it.
 *
 * @param plan - the research this run carries.
 * @param planSource - whether that plan is a caller's or the deployment's default.
 * @param opts - the driver options the run was given.
 * @returns the record. A budget the caller did not set is absent rather than zero, because
 *   "the registry's per-step value applies" and "the budget is zero" are different facts.
 */
function runSpecOf(plan: StudyPlan, planSource: 'caller' | 'default', opts: DriveOptions): Record<string, unknown> {
  return {
    studyPlan: plan,
    planSource,
    evidenceProfile: opts.evidenceProfile ?? DEFAULT_EVIDENCE_PROFILE,
    // THE RESEARCH PROFILE IS FROZEN WITH THE RUN, not read again later: a deployment that is
    // reconfigured while a study is under way must not change which metrics that study has or which
    // venue it is being written for. It travels in the spec for the same reason the plan does.
    ...(opts.researchProfile === undefined ? {} : { researchProfile: opts.researchProfile }),
    ...(opts.timeoutMs !== undefined ? { stepTimeoutMs: opts.timeoutMs } : {}),
  }
}

/** Whether the driver was handed a plan or fell back to the deployment's default. */
function planSourceOf(opts: DriveOptions): 'caller' | 'default' {
  return opts.studyPlan === undefined ? 'default' : 'caller'
}

/**
 * Hand one finished step to the caller's checkpoint, collecting a failure rather than raising it.
 *
 * `runId` is passed in, not looked up. An earlier version read the store's first key, which is
 * the run the hook is for only while a store holds exactly one — and a store holding two is a
 * shape this runner already produces in recovery tests. The hook was then told the WRONG run id
 * while the callback's name promised the right one, so a checkpoint could persist one run's state
 * under another's name.
 *
 * @param runId - the run being driven, which is what the hook may persist.
 * @param opts - the driver options carrying the hook.
 * @param outcome - the step that just finished.
 * @param errors - the accumulator the failure is recorded in.
 * @returns nothing; the run continues either way.
 */
async function checkpoint(
  runId: string,
  opts: DriveOptions,
  outcome: StepOutcome,
  errors: string[],
): Promise<void> {
  const hook = opts.checkpointAfterStep
  if (hook === undefined) return
  try {
    await hook(runId, outcome)
  } catch (error) {
    // Reported, not raised. The step has already committed; stopping the run here would throw
    // away work that exists in order to complain that a copy of it does not.
    errors.push(`checkpoint after '${outcome.stepId}' (attempt ${String(outcome.attemptId)}) failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Build a fresh cross-step context (claim / prediction wiring) for a run.
 *
 * @param timestamp - the fixed timestamp the run records on its artifacts.
 * @param plan - the research the run carries; the default plan when none is supplied.
 * @param planSource - whether that plan is a caller's or the deployment's default.
 * @returns a context with nothing yet declared about the claim.
 */
export function createRunContext(
  timestamp: number = FIXED_TS,
  plan: StudyPlan = DEFAULT_PLAN,
  planSource: 'caller' | 'default' = 'default',
): RunContext {
  // `metricKey` starts empty: nothing has declared what the claim is about yet, and the C channel
  // treats an empty key as unbindable rather than assuming a quantity. `claimMaterial` starts
  // empty for the same reason: A2 fills it, and until then the A channel reviews an empty claim
  // and reports every check as unmet rather than inventing material.
  const study = experimentStudy()
  return {
    predictionText: '',
    claimId: '',
    claimRef: '',
    metricKey: '',
    claimMaterial: { ...EMPTY_CLAIM_MATERIAL },
    study,
    // RESOLVED WITH THE CONTEXT, so a plan this process cannot present is refused before the first
    // step rather than four steps in, by the step that first needed a figure. `A2-claim` re-resolves
    // it after the Case Pack, because the pack is what supplies the platoon study's own scenarios.
    adapter: requireStudyAdapter(plan, study),
    studyPlan: plan,
    planSource,
    timestamp,
  }
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
  const checkpointErrors: string[] = []
  const projectionErrors: string[] = []
  let started = false
  for (const step of getStepDefinitions()) {
    if (!started) {
      if (step.id !== fromStepId) continue
      started = true
    }
    const outcome = await driveStep(store, runId, step.id, stepOpts)
    outcomes.push(outcome)
    if (outcome.projectionError !== undefined) projectionErrors.push(outcome.projectionError)
    await checkpoint(runId, opts, outcome, checkpointErrors)
    // Same rule as runT19B, including the human-gate distinction: stop at the first step that did
    // not pass, and continue through `gated` only when it is the human gate rather than a hold.
    if (outcome.status !== 'passed' && !(outcome.status === 'gated' && outcome.kind === 'humanGate')) break
  }
  if (!started) throw new Error(`T19B drive: unknown fromStepId '${fromStepId}'`)
  return {
    runId,
    steps: outcomes,
    ...(checkpointErrors.length === 0 ? {} : { checkpointErrors }),
    ...(projectionErrors.length === 0 ? {} : { projectionErrors }),
  }
}

export { rollback }
