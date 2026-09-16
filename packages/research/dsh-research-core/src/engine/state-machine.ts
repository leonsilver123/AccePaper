/**
 * v2 hardened state machine for the 16-step research engine.
 *
 * Run-keyed (ResearchRunStore) — every public method carries runId (P1-5). No public
 * `transition()` / `approveHumanGate()` (P1-3, P0-1-H2 — INV-NO-RAW-TRANSITION,
 * INV-NO-LEGACY-APPROVE); the human-approval path is `_applyHumanApproval` (package-
 * private, called only by the host trust channel in `../host.ts`, NOT re-exported from
 * the public `index.ts`). Caller-supplied values are deep-cloned at write time
 * (INV-WRITE-ISOLATION) and non-cloneable values rejected (DSH_VALUE_NOT_CLONEABLE).
 * Returns are deep-cloned read-only snapshots, never live internal refs (INV-SNAPSHOT,
 * INV-HISTORY-IMMUTABLE). Cascade rollback transitive-closes dependents with a visited
 * Set (INV-CASCADE, diamond-safe). Every mutator appends an AuditEvent (INV-AUDIT-APPEND).
 *
 * Legal forward edges: pending → in_progress; in_progress → gated/passed/blocked/failed;
 * gated → passed/blocked. Terminal states only exited by rollback. `_apply` is the sole
 * forward-edge mutator; `_adjudicate` is the sole gate-adjudicator (INV-SOLE-ADJUDICATOR).
 */

import type { ArtifactRef } from '../domain/artifact.ts'
import { contentHashOf } from '../domain/artifact.ts'
import type { ProjectRevision } from '../domain/ids.ts'
import type {
  ApprovalRecord,
  ArtifactRecordMeta,
  AttemptRecord,
  AuditEntry,
  AuditEvent,
  AuditEventKind,
  CurrentAttemptSnapshot,
  GateAbstentionRecord,
  GateOutcome,
  GateVerdict,
  ResearchRunStore,
  RunSnapshot,
  RunState,
  StepDefinition,
  StepSnapshot,
  StepState,
  StepStatus,
  TrinityComponent,
} from './types.ts'
import { lookupStep, SEEDABLE_INPUTS, STEPS } from './steps.ts'
import { sameTargetSet } from './commit.ts'
import type { CommitReceipt } from './commit.ts'

// ── Errors ────────────────────────────────────────────────────────────────────

/** Base error for the research state machine; every code it carries is a DSH_* string. */
export class ResearchError extends Error {
  /** The stable DSH_* failure code, also prefixed into the message so a caller can
   *  branch on the failure kind and `toThrow(/CODE/)` matches the code, not the prose. */
  readonly code: string
  constructor(code: string, message: string, cause?: unknown) {
    super(`[${code}] ${message}`)
    this.name = 'ResearchError'
    this.code = code
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause
  }
}

/** A caller-supplied value could not be deep-cloned (function/symbol/WeakMap etc.). */
export class ResearchValueError extends ResearchError {
  constructor(code: 'DSH_VALUE_NOT_CLONEABLE', message: string, cause?: unknown) {
    super(code, message, cause)
    this.name = 'ResearchValueError'
  }
}

/** Run lifecycle error (RUN_EXISTS / RUN_NOT_FOUND). */
export class ResearchRunError extends ResearchError {
  constructor(code: 'RUN_EXISTS' | 'RUN_NOT_FOUND', message: string) {
    super(code, message)
    this.name = 'ResearchRunError'
  }
}

// ── Clone ──────────────────────────────────────────────────────────────────────

/** Deep-clone a caller-supplied value; reject non-cloneable values at the write boundary
 *  (HOLE-2/H6) so the read/rollback paths can never throw DataCloneError. */
function cloneValue(x: unknown): unknown {
  try {
    return structuredClone(x)
  } catch (e) {
    throw new ResearchValueError(
      'DSH_VALUE_NOT_CLONEABLE',
      'value is not structured-cloneable (functions/symbols/WeakMap etc. are rejected at the write boundary — INV-WRITE-ISOLATION)',
      e,
    )
  }
}

// ── Run id ─────────────────────────────────────────────────────────────────────

let runIdCounter = 0
function generateRunId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return 'r_' + Date.now().toString(36) + '_' + (runIdCounter++).toString(36)
}

// ── Transitions ───────────────────────────────────────────────────────────────

const LEGAL_TRANSITIONS: Readonly<Record<StepStatus, ReadonlySet<StepStatus>>> = {
  pending: new Set<StepStatus>(['in_progress']),
  in_progress: new Set<StepStatus>(['gated', 'passed', 'blocked', 'failed']),
  gated: new Set<StepStatus>(['passed', 'blocked']),
  passed: new Set<StepStatus>(),
  blocked: new Set<StepStatus>(),
  failed: new Set<StepStatus>(),
}

/** Valid GateOutcome values (T19 — write-boundary allow-list, no silent reinterpretation). */
const OUTCOMES: ReadonlySet<GateOutcome> = new Set<GateOutcome>(['passed', 'blocked', 'failed', 'abstained'])

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * The run named by `runId`, or a refusal. Runs are never auto-created, so a typo in a run id is
 * an error rather than a second empty run.
 *
 * Exported for the sibling engine modules that mutate the same state (the commit point); it is
 * NOT re-exported from the package entry, so it stays inside this package.
 *
 * @param store - the caller-owned run store.
 * @param runId - the run to look up.
 * @returns the live run state.
 * @throws {ResearchRunError} RUN_NOT_FOUND when the store holds no such run.
 */
export function ensureRun(store: ResearchRunStore, runId: string): RunState {
  const run = store.get(runId)
  if (!run) throw new ResearchRunError('RUN_NOT_FOUND', `run '${runId}' not found (never auto-created — call createRun first)`)
  return run
}

function ensureEntry(run: RunState, stepId: string): StepState {
  const existing = run.steps.get(stepId)
  if (existing) return existing
  const state: StepState = {
    stepId,
    status: 'pending',
    attempts: 0,
    attempt_id: 0,
    artifacts: {},
    gateResults: {},
    history: [],
    startedAt: undefined,
    finishedAt: undefined,
    outputs: (lookupStep(stepId) as StepDefinition).outputs,
  }
  run.steps.set(stepId, state)
  return state
}

function pushEvent(
  run: RunState,
  kind: AuditEventKind,
  stepId: string | undefined,
  attemptId: number | undefined,
  detail?: unknown,
): void {
  const event: AuditEvent = {
    kind,
    runId: run.runId,
    ts: Date.now(),
    ...(stepId !== undefined ? { stepId } : {}),
    ...(attemptId !== undefined ? { attemptId } : {}),
    ...(detail !== undefined ? { detail: cloneValue(detail) } : {}),
  }
  run.events.push(event)
}

/**
 * Append-only audit sink for sibling pure-logic modules (e.g. the T19-A P3 execution
 * pipeline). Thin exported wrapper over the module-private {@link pushEvent}: deep-clones
 * `detail` (INV-EVENTS-IMMUTABLE) and appends to the run's event log. Does NOT mutate step
 * status — callers remain responsible for state transitions. `stepId`/`attemptId` may be
 * undefined for run-level events.
 */
export function appendAuditEvent(
  store: ResearchRunStore,
  runId: string,
  kind: AuditEventKind,
  stepId: string | undefined,
  attemptId: number | undefined,
  detail?: unknown,
): void {
  const run = ensureRun(store, runId)
  pushEvent(run, kind, stepId, attemptId, detail)
}

/**
 * The revision number a new value for `slug` takes: one past whatever the registry currently
 * holds, or 1 for a slug this run has never produced.
 *
 * A re-run after a rollback therefore takes the next number rather than reusing the first, so a
 * reference written against the superseded attempt cannot resolve against its replacement — the
 * hash in the reference would differ, and `refsResolvable` refuses it.
 *
 * @param run - the run whose registry to read.
 * @param slug - the artifact being written.
 * @returns the version the new value takes.
 */
export function nextArtifactVersion(run: RunState, slug: string): number {
  const record = run.registry[slug]
  return record === undefined ? 1 : record.ref.version + 1
}

/** Deep-cloned superseded snapshot of a step's current attempt (INV-HISTORY-IMMUTABLE). */
function snapshotOf(state: StepState): AttemptRecord {
  return {
    attempt_id: state.attempt_id,
    status: state.status,
    artifacts: cloneValue(state.artifacts) as Record<string, unknown>,
    gateResults: cloneValue(state.gateResults) as Partial<Record<TrinityComponent, GateVerdict>>,
    ...(state.approval ? { approval: cloneValue(state.approval) as ApprovalRecord } : {}),
    ...(state.holdReason ? { holdReason: state.holdReason } : {}),
    superseded: true,
  }
}

/** Reset a step's live fields to a fresh pending attempt (attempt_id NOT advanced — startStep advances it). */
function resetStep(state: StepState): void {
  state.status = 'pending'
  state.artifacts = {}
  state.gateResults = {}
  state.approval = undefined
  state.holdReason = undefined
  state.startedAt = undefined
  state.finishedAt = undefined
  // The commit receipt belongs to the attempt being abandoned. Keeping it would let a later
  // attempt read a receipt for work it did not do, and would make its own commit look like a
  // replay of that one.
  state.commit = undefined
}

/** Mark all current-attempt artifacts produced by (producerStepId, producerAttemptId) invalidated
 * (REPLACE with a fresh full record — DEP-4, never mutate in place). */
function invalidateArtifactsFor(run: RunState, producerStepId: string, producerAttemptId: number): void {
  for (const slug in run.registry) {
    const rec = run.registry[slug]
    if (!rec) continue
    if (rec.producerStepId === producerStepId && rec.producerAttemptId === producerAttemptId && !rec.invalidated) {
      run.registry[slug] = {
        slug: rec.slug,
        producerStepId: rec.producerStepId,
        producerAttemptId: rec.producerAttemptId,
        value: rec.value,
        producedAt: rec.producedAt,
        invalidated: true,
        ref: rec.ref,
      }
    }
  }
}

/**
 * BFS over the producer/consumer graph: every step whose inputs include an output of
 * `stepId` or of any transitive dependent. Visited Set guarantees each dependent is
 * returned exactly once (diamond-safe — DEP-3) and the closure is complete (DEP-2);
 * termination is guaranteed by assertDagAndSeedSeparation at module load (DEP-9).
 */
function computeTransitiveDependents(stepId: string): string[] {
  const result: string[] = []
  const visited = new Set<string>()
  const queue: string[] = [stepId]
  while (queue.length > 0) {
    const cur = queue.shift() as string
    const curDef = lookupStep(cur)
    if (!curDef) continue
    for (const s of STEPS) {
      if (visited.has(s.id)) continue
      if (s.inputs.some(input => curDef.outputs.indexOf(input) !== -1)) {
        visited.add(s.id)
        result.push(s.id)
        queue.push(s.id)
      }
    }
  }
  return result
}

/**
 * Sole forward-edge mutator (module-private — INV-APPLY-GUARDS). Throws on illegal edges
 * and forbids a humanGate step reaching 'passed' without an approved approval on record.
 * NOT exported from the public entry.
 */
function _apply(state: StepState, step: StepDefinition, to: StepStatus): void {
  // LEGAL_TRANSITIONS is a total Record<StepStatus, ...> so state.status is always a valid key
  // (no `undefined` branch) — index it directly.
  const allowed = LEGAL_TRANSITIONS[state.status]
  if (!allowed.has(to)) {
    throw new ResearchError('DSH_ILLEGAL_TRANSITION', `state-machine: illegal '${state.status}' -> '${to}' for '${step.id}'`)
  }
  if (to === 'passed' && step.humanGate && state.approval?.decision !== 'approved') {
    throw new ResearchError('DSH_HUMAN_GATE_NOT_APPROVED', `state-machine: humanGate step '${step.id}' cannot move to 'passed' without an approved human approval`)
  }
  state.status = to
  // holdReason is meaningful ONLY while status==='gated'; clear it on any other transition
  // (gated→passed/blocked via human approval, or any in_progress→terminal edge).
  if (to !== 'gated') state.holdReason = undefined
  if (to === 'passed' || to === 'blocked' || to === 'failed') {
    state.finishedAt = Date.now()
  }
}

/**
 * Sole gate adjudicator (INV-SOLE-ADJUDICATOR, INV-ADJUDICATE-SHARED). Requires every
 * declared gate component to have a verdict. anyFail + falsifiable C-fail → 'failed';
 * any other fail → 'blocked'; else humanGate → 'gated' (await human approval),
 * non-humanGate → 'passed'.
 */
function _adjudicate(state: StepState, step: StepDefinition): StepStatus {
  // T19 (hold_abstained): abstained has priority over any other outcome — abstention is a
  // "no verdict" freeze, not a fail/pass. Any required component with outcome==='abstained'
  // holds the step at 'gated' with holdReason='gate_abstained'. The attempt is never auto-
  // resolved; it is abandoned only via rollback→new attempt (design §4). No default-pass.
  let anyAbstained = false
  for (const comp of step.gate) {
    const v = state.gateResults[comp]
    if (v && v.outcome === 'abstained') anyAbstained = true
  }
  if (anyAbstained) {
    state.holdReason = 'gate_abstained'
    _apply(state, step, 'gated')
    return state.status
  }
  let anyFail = false
  let cFailOnFalsifiable = false
  for (const comp of step.gate) {
    const v = state.gateResults[comp]
    if (v && !v.passed) {
      anyFail = true
      if (step.falsifiable !== null && comp === 'C') cFailOnFalsifiable = true
    }
  }
  let to: StepStatus
  if (!anyFail) {
    to = step.humanGate ? 'gated' : 'passed'
  } else if (cFailOnFalsifiable) {
    to = 'failed'
  } else {
    to = 'blocked'
  }
  _apply(state, step, to)
  return state.status
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Create a new run. Throws RUN_EXISTS on explicit-runId collision (never clobbers).
 *
 * @param store - the caller-owned run store to create the run in; the state machine
 *   keeps no registry of its own.
 * @param runId - the id to create, or omitted to generate one (crypto.randomUUID,
 *   falling back to a timestamp+counter when the runtime has no crypto).
 * @returns the new run's id, which every later call names.
 */
export function createRun(store: ResearchRunStore, runId?: string): string {
  const id = runId ?? generateRunId()
  if (store.has(id)) throw new ResearchRunError('RUN_EXISTS', `createRun: run '${id}' already exists (refusing to clobber existing run state + audit log)`)
  const run: RunState = {
    runId: id,
    inputs: {},
    spec: {},
    steps: new Map(),
    registry: {},
    events: [],
    consumedApprovals: new Set<string>(),
    // Revision 0 is "nothing has been committed". The first commit produces 1, so a caller that
    // read a brand-new run commits against 0 and cannot be confused with one that read a state
    // some earlier commit produced.
    revision: 0 as ProjectRevision,
  }
  store.set(id, run)
  pushEvent(run, 'run-created', undefined, undefined, { runId: id })
  return id
}

/** Seed a run-level input (T0 human authorization). Slug must be in SEEDABLE_INPUTS;
 *  value must be present; run must not have any started step — neither a non-pending status
 *  nor a prior attempt (rollback resets status to 'pending' but preserves attempts/history,
 *  so the guard checks both — INV-INPUT-FROZEN, RC-D). Value deep-cloned.
 *
 * @param store - the caller-owned run store that holds the run.
 * @param runId - the run to seed; it must already exist in `store` (RUN_NOT_FOUND —
 *   runs are never auto-created) and must not have started (INV-INPUT-FROZEN).
 * @param slug - the run-level input to set; must be one of SEEDABLE_INPUTS
 *   (DSH_INPUT_NOT_SEEDABLE).
 * @param value - the input value; must not be undefined/null (DSH_INPUT_EMPTY) and must
 *   survive structuredClone (DSH_VALUE_NOT_CLONEABLE).
 */
export function setRunInput(store: ResearchRunStore, runId: string, slug: string, value: unknown): void {
  const run = ensureRun(store, runId)
  if (SEEDABLE_INPUTS.indexOf(slug) === -1) {
    throw new ResearchError('DSH_INPUT_NOT_SEEDABLE', `setRunInput: slug '${slug}' is not a seedable input (allowed: ${SEEDABLE_INPUTS.join(', ')}) — INV-SEED-INPUT`)
  }
  if (value === undefined || value === null) {
    throw new ResearchError('DSH_INPUT_EMPTY', `setRunInput: value for '${slug}' must not be undefined/null (H9)`)
  }
  for (const s of run.steps.values()) {
    if (s.status !== 'pending' || s.attempts > 0) {
      throw new ResearchError(
        'DSH_INPUT_FROZEN',
        `setRunInput: run '${runId}' has started (step '${s.stepId}'` +
          ` status='${s.status}' attempts=${s.attempts}); inputs frozen — INV-INPUT-FROZEN (RC-D)`,
      )
    }
  }
  run.inputs[slug] = cloneValue(value)
  pushEvent(run, 'input-seeded', undefined, undefined, { slug })
}

/**
 * Record the RESOLVED configuration a run is being driven with: the study plan, the evidence
 * profile, the per-step budget, and anything else the driver settled before the first step.
 *
 * It freezes with the inputs, for the same reason: both are decisions made once, before the run
 * means anything, and a decision changed mid-run would describe a run that never happened. Core
 * does not interpret the value — it stores it, refuses a run that has already started, and hands
 * it back on restore, so a restart can drive the run it was actually running instead of the one
 * the deployment's current configuration describes.
 *
 * @param store - the caller-owned run store that holds the run.
 * @param runId - the run to describe; it must already exist in `store` (RUN_NOT_FOUND) and must
 *   not have started (DSH_INPUT_FROZEN — the same freeze the run's inputs obey).
 * @param spec - the resolved configuration, as a JSON-representable record. Deep-cloned at this
 *   boundary, so a caller editing its own object afterwards changes nothing here.
 */
export function setRunSpec(store: ResearchRunStore, runId: string, spec: Record<string, unknown>): void {
  const run = ensureRun(store, runId)
  for (const s of run.steps.values()) {
    if (s.status !== 'pending' || s.attempts > 0) {
      throw new ResearchError(
        'DSH_INPUT_FROZEN',
        `setRunSpec: run '${runId}' has started (step '${s.stepId}' status='${s.status}'`
          + ` attempts=${s.attempts}); the resolved configuration is frozen — a run whose plan`
          + ' changed under it would describe a run that never happened',
      )
    }
  }
  run.spec = cloneValue(spec) as Record<string, unknown>
  pushEvent(run, 'run-spec-set', undefined, undefined, { keys: Object.keys(spec).sort() })
}

/** Read-only run snapshot (deep-cloned; artifact values excluded — fetch via getArtifact — HOLE-4).
 *
 * @param store - the caller-owned run store that holds the run.
 * @param runId - the run to read; it must already exist in `store` (RUN_NOT_FOUND —
 *   runs are never auto-created).
 * @returns a deep-cloned, deep-frozen snapshot: the run's inputs, every created step's
 *   snapshot, the registry index, and the audit log. The freeze is what makes a
 *   caller's attempt to edit the returned timeline fail rather than mislead.
 */
export function getRunSnapshot(store: ResearchRunStore, runId: string): RunSnapshot {
  const run = ensureRun(store, runId)
  const steps: Record<string, StepSnapshot> = {}
  for (const [id, s] of run.steps) steps[id] = snapshotStep(s)
  const registry: Record<string, ArtifactRecordMeta> = {}
  for (const slug in run.registry) {
    const r = run.registry[slug]
    if (!r) continue
    registry[slug] = {
      slug: r.slug,
      producerStepId: r.producerStepId,
      producerAttemptId: r.producerAttemptId,
      producedAt: r.producedAt,
      invalidated: r.invalidated,
      ref: cloneValue(r.ref) as ArtifactRecordMeta['ref'],
    }
  }
  const snapshot: RunSnapshot = {
    runId: run.runId,
    inputs: cloneValue(run.inputs) as Record<string, unknown>,
    spec: cloneValue(run.spec) as Record<string, unknown>,
    steps,
    registry,
    events: run.events.map(e => cloneValue(e) as AuditEvent),
    revision: run.revision,
  }
  // P2-2: the snapshot is the public read-out of a run, so a caller must not be
  // able to edit it. Unfrozen, `snapshot.events.push({kind:'human-approval'})`
  // succeeded — core's own state stayed correct, but every downstream consumer of
  // the snapshot (reports, UI, adjudication logs) would have read a forged
  // timeline. Freezing the already-cloned snapshot costs nothing and removes that
  // whole class of confusion.
  deepFreezeSnapshot(snapshot)
  return snapshot
}

/**
 * Deep-freeze a freshly built snapshot (recursive; arrays included). Snapshots are
 * ALWAYS freshly cloned, so freezing them can never alias or freeze internal state.
 */
function deepFreezeSnapshot(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  const obj = value as Record<string, unknown>
  Object.freeze(obj)
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeSnapshot(item)
    return
  }
  for (const key of Object.keys(obj)) deepFreezeSnapshot(obj[key])
}

/** Deep-cloned value of one artifact (undefined if missing/invalidated).
 *
 * @param store - the caller-owned run store that holds the run.
 * @param runId - the run to read; it must already exist in `store` (RUN_NOT_FOUND —
 *   runs are never auto-created).
 * @param slug - the artifact slug to read.
 * @returns a deep clone of the artifact's value, or undefined. An invalidated record
 *   yields undefined rather than its superseded value, so a rolled-back artifact's data
 *   can never be read back as current.
 */
export function getArtifact(store: ResearchRunStore, runId: string, slug: string): unknown {
  const run = ensureRun(store, runId)
  const rec = run.registry[slug]
  if (!rec || rec.invalidated) return undefined
  return cloneValue(rec.value)
}

function isInputSatisfied(run: RunState, slug: string): boolean {
  const rec = run.registry[slug]
  if (rec) {
    if (rec.invalidated) return false // DEP-8: registry invalidation wins over seed
    const producer = run.steps.get(rec.producerStepId)
    if (!producer || producer.status !== 'passed') return false // P1-1: upstream must be passed
    if (producer.attempt_id !== rec.producerAttemptId) return false // stale attempt
    return true
  }
  return slug in run.inputs // DEP-7: seedable run input (permanent across rollback)
}

/** True iff the step is pending and every input is satisfied by a passed-producer artifact or a seed.
 *
 * @param store - the caller-owned run store that holds the run.
 * @param runId - the run to read; it must already exist in `store` (RUN_NOT_FOUND —
 *   runs are never auto-created).
 * @param stepId - the step to test; an id outside the pipeline is not an error here.
 * @returns true when the step may be started now. An unknown step id is false rather
 *   than an error, so a caller probing an id cannot tell it from a step that is merely
 *   not ready — {@link startStep} is the call that names the difference.
 */
export function canStart(store: ResearchRunStore, runId: string, stepId: string): boolean {
  const run = ensureRun(store, runId)
  const step = lookupStep(stepId)
  if (!step) return false
  const state = run.steps.get(stepId)
  if (state && state.status !== 'pending') return false
  for (const input of step.inputs) {
    if (!isInputSatisfied(run, input)) return false
  }
  return true
}

/** Move a pending step whose inputs are ready to in_progress. Throws if it cannot start.
 *  Returns a deep-cloned StepSnapshot (never the internal ref — INV-SNAPSHOT).
 *
 * @param store - the caller-owned run store that holds the run.
 * @param runId - the run to act on; it must already exist in `store` (RUN_NOT_FOUND —
 *   runs are never auto-created).
 * @param stepId - the step to start; must be a pipeline step (DSH_UNKNOWN_STEP) whose
 *   inputs are ready and which is not already started (DSH_CANNOT_START).
 * @returns a deep-cloned snapshot of the step after it moved to in_progress, whose
 *   `attemptId` names the attempt the caller is now executing.
 */
export function startStep(store: ResearchRunStore, runId: string, stepId: string): StepSnapshot {
  const run = ensureRun(store, runId)
  const step = lookupStep(stepId)
  if (!step) throw new ResearchError('DSH_UNKNOWN_STEP', `startStep: unknown step '${stepId}'`)
  if (!canStart(store, runId, stepId)) {
    throw new ResearchError('DSH_CANNOT_START', `startStep: cannot start '${stepId}' (not pending or inputs missing)`)
  }
  const state = ensureEntry(run, stepId)
  state.status = 'in_progress'
  state.startedAt = Date.now()
  state.attempts += 1
  state.attempt_id = state.attempts
  pushEvent(run, 'step-started', stepId, state.attempt_id)
  return snapshotStep(state)
}

/** Atomic check+transition (C-9 TOCTOU-safe): returns the snapshot, or null if it cannot start.
 *
 * @param store - the caller-owned run store that holds the run.
 * @param runId - the run to act on; it must already exist in `store` (RUN_NOT_FOUND —
 *   runs are never auto-created).
 * @param stepId - the step to start.
 * @returns the started step's snapshot, or null when the step cannot start — the
 *   caller gets the same verdict `canStart` would give, with no separate call.
 */
export function startIfCan(store: ResearchRunStore, runId: string, stepId: string): StepSnapshot | null {
  if (!canStart(store, runId, stepId)) return null
  return startStep(store, runId, stepId)
}

/** Record a produced output artifact. Slug must be declared in step.outputs (INV-OUTPUT-CONTRACT);
 *  step must be in_progress. Value deep-cloned; registry entry REPLACED fresh (invalidated=false — DEP-4).
 *
 * @param store - the caller-owned run store that holds the run.
 * @param runId - the run to act on; it must already exist in `store` (RUN_NOT_FOUND —
 *   runs are never auto-created).
 * @param stepId - the producing step; must be a pipeline step (DSH_UNKNOWN_STEP) that
 *   is in_progress (DSH_NOT_IN_PROGRESS).
 * @param outputSlug - the artifact's slug; must be declared in that step's outputs
 *   (DSH_OUTPUT_NOT_DECLARED).
 * @param value - the artifact value; deep-cloned at this boundary, so a non-cloneable
 *   value is rejected (DSH_VALUE_NOT_CLONEABLE) rather than stored.
 */
export function recordArtifact(store: ResearchRunStore, runId: string, stepId: string, outputSlug: string, value: unknown): void {
  const run = ensureRun(store, runId)
  const step = lookupStep(stepId)
  if (!step) throw new ResearchError('DSH_UNKNOWN_STEP', `recordArtifact: unknown step '${stepId}'`)
  if (step.outputs.indexOf(outputSlug) === -1) {
    throw new ResearchError('DSH_OUTPUT_NOT_DECLARED', `recordArtifact: slug '${outputSlug}' is not declared in step '${stepId}' outputs — INV-OUTPUT-CONTRACT`)
  }
  const state = run.steps.get(stepId)
  if (!state || state.status !== 'in_progress') {
    throw new ResearchError('DSH_NOT_IN_PROGRESS', `recordArtifact: step '${stepId}' is not in_progress`)
  }
  // THE COMMIT IS THE WRITE OF RECORD. Once this attempt has committed, its official outputs exist
  // with a receipt that names their revisions, and a per-slug write beside them would replace one
  // of those values while the receipt still described the old one — the registry and the receipt
  // would disagree, and nothing advanced the run revision to say so. Closing the seam here is
  // what makes "one commit point" a property of the code rather than of the driver's habits: the
  // way to write again is a new attempt, which is a new commit.
  if (state.commit !== undefined) {
    throw new ResearchError(
      'DSH_ARTIFACT_AFTER_COMMIT',
      `recordArtifact: step '${stepId}' attempt ${String(state.attempt_id)} has already committed`
        + ` (key '${state.commit.idempotencyKey}'); its outputs are written for this attempt —`
        + ' rolling the step back and starting a new attempt is what re-opens the write',
    )
  }
  const cloned = cloneValue(value)
  const hashed = contentHashOf(cloned)
  if (!hashed.ok) {
    // A value with no canonical encoding cannot be given an identity, and an artifact without one
    // cannot be referenced, reported on, or checked by a rule that names a version. Refusing here
    // keeps "every registry entry has a revision" true rather than mostly true.
    throw new ResearchError('DSH_VALUE_NOT_CANONICAL', `recordArtifact: value for '${outputSlug}' has no canonical encoding (${hashed.reason})`)
  }
  state.artifacts[outputSlug] = cloned
  run.registry[outputSlug] = {
    slug: outputSlug,
    producerStepId: stepId,
    producerAttemptId: state.attempt_id,
    value: cloned,
    producedAt: Date.now(),
    invalidated: false,
    ref: {
      artifactId: outputSlug as ArtifactRef['artifactId'],
      version: nextArtifactVersion(run, outputSlug) as ArtifactRef['version'],
      contentHash: hashed.value,
    },
  }
  pushEvent(run, 'artifact-recorded', stepId, state.attempt_id, { slug: outputSlug })
}

/**
 * Submit one trinity-component gate verdict. Component must be declared in step.gate
 * (INV-GATE-COMPONENT); throws on empty-gate steps (use completeStep — INV-COMPLETESTEP-EMPTY);
 * step must be in_progress (INV-VERDICT-STATUS); one verdict per component per attempt
 * (INV-VERDICT-IMMUTABLE). Auto-adjudicates via the shared `_adjudicate` on the last verdict
 * (INV-SOLE-ADJUDICATOR). Verdict deep-cloned before storage (INV-WRITE-ISOLATION).
 *
 * @param store - the caller-owned run store that holds the run.
 * @param runId - the run to act on; it must already exist in `store` (RUN_NOT_FOUND —
 *   runs are never auto-created).
 * @param stepId - the step being adjudicated; must be a pipeline step with a non-empty
 *   gate (DSH_EMPTY_GATE) that is in_progress (DSH_VERDICT_BAD_STATUS).
 * @param verdict - the verdict for one component of that gate; `outcome` must be one of
 *   the four gate outcomes and is the only field read to decide it
 *   (DSH_GATEVERDICT_MISSING_OUTCOME), and a component may be given only one verdict per
 *   attempt (DSH_VERDICT_ALREADY_SET).
 * @returns the step's status after this submission — still in_progress while components
 *   are outstanding, otherwise the status adjudication reached.
 */
export function submitGateVerdict(store: ResearchRunStore, runId: string, stepId: string, verdict: GateVerdict): StepStatus {
  const run = ensureRun(store, runId)
  const step = lookupStep(stepId)
  if (!step) throw new ResearchError('DSH_UNKNOWN_STEP', `submitGateVerdict: unknown step '${stepId}'`)
  if (step.gate.length === 0) {
    throw new ResearchError('DSH_EMPTY_GATE', `submitGateVerdict: step '${stepId}' has an empty gate — use completeStep() (INV-COMPLETESTEP-EMPTY)`)
  }
  // (the output-binding check below runs once the step's state — and so its attempt — is known)
  // RC-F (single-snapshot): clone the verdict ONCE into `snapshot`, then read component/passed
  // ONLY from `snapshot` for the membership test, the immutability `in`-check, the storage key,
  // the stored object, the audit event, and adjudication. Never re-read the original `verdict`.
  // The prior "read verdict.component once into a local, but cloneValue(verdict) separately for
  // storage" pattern left a residual: a polymorphic getter returning A on read#1 (the local →
  // storage KEY 'A') and C on the cloneValue invocation (stored OBJECT.component 'C') produced
  // gateResults = { A: { component: 'C' } } — key A, object-internal C — and the audit event
  // carried component 'A' for a C-valued object (INV-VERDICT consistency broken). Cloning FIRST
  // (structuredClone invokes an enumerable getter once and stores the return as a data property)
  // then using snapshot.* everywhere makes the guard, the storage key, the stored object, AND
  // the audit all read the single cloned value — key == object.component == audit.component
  // (INV-VERDICT-IMMUTABLE, INV-VERDICT-SNAPSHOT).
  const base = cloneValue(verdict) as GateVerdict
  // T19 write-boundary: outcome is the single source of truth; reject any verdict lacking a
  // valid outcome BEFORE any other check (no silent reinterpretation — design §3). This must
  // fire before the in_progress status check so a missing-outcome resubmit on a settled step
  // reports DSH_GATEVERDICT_MISSING_OUTCOME, not DSH_VERDICT_BAD_STATUS.
  if (!OUTCOMES.has(base.outcome)) {
    throw new ResearchError(
      'DSH_GATEVERDICT_MISSING_OUTCOME',
      `submitGateVerdict: verdict for '${stepId}' is missing a valid 'outcome' (expected one of ${[...OUTCOMES].join(', ')}) — outcome is the single source of truth and must be supplied at the write boundary (T19, no silent reinterpretation)`,
    )
  }
  // Derive the legacy `passed` projection from `outcome` (passed ⟺ outcome==='passed') so the
  // stored verdict can never carry a passed/outcome contradiction. Spread into a fresh object
  // literal because GateVerdict.passed is readonly (INV-WRITE-ISOLATION already cloned `verdict`).
  const snapshot: GateVerdict = { ...base, passed: base.outcome === 'passed' }
  const component = snapshot.component
  if (step.gate.indexOf(component) === -1) {
    throw new ResearchError('DSH_GATE_COMPONENT_NOT_DECLARED', `submitGateVerdict: component '${component}' is not in step '${stepId}' gate — INV-GATE-COMPONENT`)
  }
  const state = run.steps.get(stepId)
  if (!state) throw new ResearchError('DSH_NO_STATE', `submitGateVerdict: no state for '${stepId}'`)
  // A GATE CERTIFIES WORK, AND THE WORK IT CERTIFIES IS THE ATTEMPT'S COMMITTED OUTPUT SET.
  //
  // Three separate things are checked here, and each closes a defect that was reproduced:
  //
  //  1. the attempt has a COMMIT receipt. Per-slug writes that add up to the declared set are not
  //     a commit: they carry no receipt, no revision, and no input digest, so nothing binds a
  //     verdict to them.
  //  2. the registry still AGREES with that receipt. A value replaced beside the commit leaves the
  //     receipt describing one content and the registry holding another; the step would then pass
  //     on work nobody wrote.
  //  3. the VERDICT names exactly those revisions. Without this an old judgment approves a new
  //     attempt's products — reproduced as: attempt 1 commits and passes B, the step is rolled
  //     back, attempt 2 commits different values, and re-submitting the SAME verdict object
  //     reports `passed` for attempt 2.
  //
  // The gate never stamps a verdict with the current targets; see {@link GateVerdict.targetRefs}.
  const receipt = state.commit
  if (receipt === undefined) {
    throw new ResearchError(
      'DSH_GATE_WITHOUT_COMMIT',
      `submitGateVerdict: step '${stepId}' attempt ${String(state.attempt_id)} has no commit receipt —`
        + ' a step is adjudicated on what its attempt committed, and writing the declared outputs'
        + ' one at a time is not a commit (NO DEFAULT PASS)',
    )
  }
  {
    const committed = new Map(receipt.artifacts.map(artifact => [artifact.slug, artifact.ref]))
    const wrong = step.outputs.filter((slug) => {
      const record = run.registry[slug]
      const wanted = committed.get(slug)
      return (
        wanted === undefined ||
        record === undefined ||
        record.invalidated ||
        record.producerStepId !== stepId ||
        record.producerAttemptId !== state.attempt_id ||
        record.ref.version !== wanted.version ||
        record.ref.contentHash !== wanted.contentHash
      )
    })
    if (wrong.length > 0) {
      throw new ResearchError(
        'DSH_GATE_COMMIT_MISMATCH',
        `submitGateVerdict: step '${stepId}' attempt ${String(state.attempt_id)} does not hold what its`
          + ` commit receipt records for ${wrong.join(', ')} — the receipt names the revisions this`
          + ' attempt wrote, and the registry is what it wrote them to',
      )
    }
    const targets = snapshot.targetRefs
    if (targets === undefined || snapshot.inputDigest === undefined) {
      throw new ResearchError(
        'DSH_GATE_UNBOUND_VERDICT',
        `submitGateVerdict: the '${component}' verdict for '${stepId}' names no target revisions —`
          + ' a verdict that cannot say what it judged is a verdict about whatever the registry'
          + ' happens to hold when it arrives (build it with bindVerdict)',
      )
    }
    if (!sameTargetSet(targets, receipt.artifacts.map(artifact => artifact.ref))) {
      throw new ResearchError(
        'DSH_GATE_STALE_TARGET',
        `submitGateVerdict: the '${component}' verdict for '${stepId}' judged a different set of`
          + ` revisions than attempt ${String(state.attempt_id)} committed — an old judgment cannot`
          + " approve a new attempt's products",
      )
    }
    if (snapshot.inputDigest !== receipt.inputDigest) {
      throw new ResearchError(
        'DSH_GATE_STALE_INPUTS',
        `submitGateVerdict: the '${component}' verdict for '${stepId}' was built over a different`
          + ` input digest than attempt ${String(state.attempt_id)} read`,
      )
    }
  }
  // INV-VERDICT-IMMUTABLE (T19 hold_abstained): on a held 'gated' step, re-submitting an
  // already-adjudicated component is rejected as DSH_VERDICT_ALREADY_SET BEFORE the status
  // guard (design §4 — "覆盖路径不存在"). This is the one precedence override: a settled/passed
  // step still reports DSH_VERDICT_BAD_STATUS for a re-submit (INV-VERDICT-STATUS), but a held
  // abstention must never be silently overwritten, so the duplicate-component guard wins there.
  if (state.status === 'gated' && component in state.gateResults) {
    throw new ResearchError('DSH_VERDICT_ALREADY_SET', `submitGateVerdict: component '${component}' already has a verdict for '${stepId}' (held step) — INV-VERDICT-IMMUTABLE (re-adjudication requires rollback+restart)`)
  }
  if (state.status !== 'in_progress') {
    throw new ResearchError('DSH_VERDICT_BAD_STATUS', `submitGateVerdict: step '${stepId}' status '${state.status}' !== 'in_progress' — INV-VERDICT-STATUS`)
  }
  if (component in state.gateResults) {
    throw new ResearchError('DSH_VERDICT_ALREADY_SET', `submitGateVerdict: component '${component}' already has a verdict for '${stepId}' — INV-VERDICT-IMMUTABLE (re-adjudication requires rollback+restart)`)
  }
  state.gateResults[component] = snapshot
  pushEvent(run, 'gate-verdict', stepId, state.attempt_id, { component, passed: snapshot.passed })
  for (const comp of step.gate) {
    if (!(comp in state.gateResults)) return state.status
  }
  const result = _adjudicate(state, step)
  // T19 hold_abstained: an abstained adjudication holds the step at 'gated' (holdReason=
  // 'gate_abstained'). Emit the dedicated 'gate-abstention' audit and NEVER a 'step-completed'
  // — the attempt is frozen until rollback→new attempt (design §4).
  if (result === 'gated' && state.holdReason === 'gate_abstained') {
    // Identify the abstained component and its verdict (defaults to the just-submitted `component`
    // / `base` when the abstained one is the triggering submit — both are always present in
    // gateResults at this point). Mirrors the `if (v && ...)` defensive style used in _adjudicate.
    let abstainedComp: TrinityComponent = component
    let av: GateVerdict = base
    for (const c of step.gate) {
      const v = state.gateResults[c]
      if (v && v.outcome === 'abstained') {
        abstainedComp = c
        av = v
        break
      }
    }
    const record: GateAbstentionRecord = {
      runId,
      stepId,
      attemptId: state.attempt_id,
      component: abstainedComp,
      reasonCode: 'gate_abstained',
      evidenceRefs: [av.evidence],
      recordedAt: new Date().toISOString(),
    }
    pushEvent(run, 'gate-abstention', stepId, state.attempt_id, record)
    return result
  }
  pushEvent(run, 'step-completed', stepId, state.attempt_id, { status: result })
  return result
}

/**
 * Finalize an empty-gate step (INV-COMPLETESTEP-EMPTY — throws on non-empty gates, which are
 * adjudicated solely by submitGateVerdict; INV-SOLE-ADJUDICATOR). Step must be in_progress.
 * Non-humanGate empty gate → 'passed'; humanGate empty gate → 'gated' (await human approval).
 *
 * @param store - the caller-owned run store that holds the run.
 * @param runId - the run to act on; it must already exist in `store` (RUN_NOT_FOUND —
 *   runs are never auto-created).
 * @param stepId - the step to finalize; must be a pipeline step with an empty gate
 *   (DSH_NON_EMPTY_GATE) that is in_progress (DSH_COMPLETE_BAD_STATUS).
 * @returns 'passed' for a non-humanGate step, 'gated' for one awaiting human approval.
 *   A humanGate step reaches 'passed' only through the host approval channel, so that
 *   status is never this call's outcome.
 */
export function completeStep(store: ResearchRunStore, runId: string, stepId: string): StepStatus {
  const run = ensureRun(store, runId)
  const step = lookupStep(stepId)
  if (!step) throw new ResearchError('DSH_UNKNOWN_STEP', `completeStep: unknown step '${stepId}'`)
  if (step.gate.length !== 0) {
    throw new ResearchError('DSH_NON_EMPTY_GATE', `completeStep: step '${stepId}' has a non-empty gate — use submitGateVerdict (INV-COMPLETESTEP-EMPTY; completeStep is the empty-gate finalize only)`)
  }
  const state = run.steps.get(stepId)
  if (!state) throw new ResearchError('DSH_NO_STATE', `completeStep: no state for '${stepId}'`)
  if (state.status !== 'in_progress') {
    throw new ResearchError('DSH_COMPLETE_BAD_STATUS', `completeStep: step '${stepId}' status '${state.status}' !== 'in_progress'`)
  }
  const to: StepStatus = step.humanGate ? 'gated' : 'passed'
  _apply(state, step, to)
  pushEvent(run, 'step-completed', stepId, state.attempt_id, { status: to })
  return state.status
}

/**
 * Rollback a step: no-op if never started / already pending (DEP-6); legal from terminal
 * states too (C-3, INV-FAILED-RERUN). Snapshots the current attempt into history (deep-cloned),
 * invalidates its artifacts, then transitively cascade-resets every dependent downstream step
 * (visited, once — DEP-3; including blocked/failed — C-5), snapshotting + invalidating each.
 * History is preserved (append-only — INV-HISTORY-IMMUTABLE).
 *
 * @param store - the caller-owned run store that holds the run.
 * @param runId - the run to act on; it must already exist in `store` (RUN_NOT_FOUND —
 *   runs are never auto-created).
 * @param stepId - the step to roll back; must be a pipeline step (DSH_UNKNOWN_STEP).
 *   Rolling back a step that was never started is a no-op, not an error (DEP-6).
 */
export function rollback(store: ResearchRunStore, runId: string, stepId: string): void {
  const run = ensureRun(store, runId)
  const step = lookupStep(stepId)
  if (!step) throw new ResearchError('DSH_UNKNOWN_STEP', `rollback: unknown step '${stepId}'`)
  const state = run.steps.get(stepId)
  if (!state || state.status === 'pending') return
  state.history.push(snapshotOf(state))
  invalidateArtifactsFor(run, stepId, state.attempt_id)
  for (const depId of computeTransitiveDependents(stepId)) {
    const dep = run.steps.get(depId)
    if (!dep) continue
    if (dep.status === 'pending') continue
    dep.history.push(snapshotOf(dep))
    invalidateArtifactsFor(run, depId, dep.attempt_id)
    resetStep(dep)
    pushEvent(run, 'rollback', depId, dep.attempt_id, { cascaded: true })
  }
  resetStep(state)
  pushEvent(run, 'rollback', stepId, state.attempt_id, { cascaded: false })
}

/** True iff the step has reached 'passed' (and, for humanGate steps, holds an approved
 *  human approval for the CURRENT attempt — INV-COMPLETE-ATTEMPT).
 *
 * @param store - the caller-owned run store that holds the run.
 * @param runId - the run to read; it must already exist in `store` (RUN_NOT_FOUND —
 *   runs are never auto-created).
 * @param stepId - the step to test; an id with no state is not an error here.
 * @returns true only when the step is passed and, for a humanGate step, its approval
 *   names the current attempt — an approval from an earlier attempt does not complete it.
 */
export function isComplete(store: ResearchRunStore, runId: string, stepId: string): boolean {
  const run = ensureRun(store, runId)
  const state = run.steps.get(stepId)
  if (!state || state.status !== 'passed') return false
  const step = lookupStep(stepId)
  if (step?.humanGate) {
    return state.approval?.decision === 'approved' && state.approval.attempt_id === state.attempt_id
  }
  return true
}

/** Audit view: superseded snapshots followed by the current attempt snapshot, all deep-cloned.
 *
 * @param store - the caller-owned run store that holds the run.
 * @param runId - the run to read; it must already exist in `store` (RUN_NOT_FOUND —
 *   runs are never auto-created).
 * @param stepId - the step whose attempts to read; an id with no state yields an empty
 *   array, so a never-started step and an unknown one are indistinguishable here.
 * @returns the attempts oldest-first, the current attempt last. Never empty for a step
 *   that has state: an empty array means no entry was ever created for this id.
 */
export function getAuditHistory(store: ResearchRunStore, runId: string, stepId: string): AuditEntry[] {
  const run = ensureRun(store, runId)
  const state = run.steps.get(stepId)
  if (!state) return []
  const history = state.history.map(h => cloneValue(h) as AttemptRecord)
  const current: CurrentAttemptSnapshot = {
    attempt_id: state.attempt_id,
    status: state.status,
    artifacts: cloneValue(state.artifacts) as Record<string, unknown>,
    gateResults: cloneValue(state.gateResults) as Partial<Record<TrinityComponent, GateVerdict>>,
    ...(state.approval ? { approval: cloneValue(state.approval) as ApprovalRecord } : {}),
    ...(state.holdReason ? { holdReason: state.holdReason } : {}),
    current: true,
  }
  return [...history, current]
}

/** Deep-cloned step snapshot (read-only view; never the internal ref — INV-SNAPSHOT). */
function snapshotStep(state: StepState): StepSnapshot {
  return {
    stepId: state.stepId,
    status: state.status,
    attempts: state.attempts,
    attemptId: state.attempt_id,
    artifacts: cloneValue(state.artifacts) as Record<string, unknown>,
    gateResults: cloneValue(state.gateResults) as Partial<Record<TrinityComponent, GateVerdict>>,
    ...(state.approval ? { approval: cloneValue(state.approval) as ApprovalRecord } : {}),
    ...(state.holdReason ? { holdReason: state.holdReason } : {}),
    history: state.history.map(h => cloneValue(h) as AttemptRecord),
    ...(state.startedAt !== undefined ? { startedAt: state.startedAt } : {}),
    ...(state.finishedAt !== undefined ? { finishedAt: state.finishedAt } : {}),
    // P2-3: CLONE, never hand out the internal (frozen) definition's array — the
    // snapshot stays correct even if the freeze on `STEPS` were ever relaxed.
    outputs: [...state.outputs],
    ...(state.commit !== undefined ? { commit: cloneValue(state.commit) as CommitReceipt } : {}),
  }
}

/**
 * Package-private: apply a validated human approval (gated → passed/blocked) for a humanGate
 * step. NOT re-exported from the public `index.ts` — the host trust channel (`../host.ts`)
 * imports it relatively; external importers cannot reach it via the built main entry.
 *
 * Pre-conditions (validated by `HostApprovalChannel.submit` BEFORE calling this):
 *  - principal instanceof TrustedHumanPrincipal (host-minted via the singleton channel)
 *  - principal.principalId ∈ the channel's host-populated principal registry
 *  - state.status === 'gated' (INV-APPROVAL-STATE)
 *  - step.humanGate === true
 *  - principal.approvalEventId ∉ run.consumedApprovals (INV-REPLAY)
 * This function re-checks the status/humanGate/replay guards as defense-in-depth.
 */
export function _applyHumanApproval(
  store: ResearchRunStore,
  runId: string,
  stepId: string,
  decision: 'approved' | 'rejected',
  principalId: string,
  approvalEventId: string,
): StepStatus {
  const run = ensureRun(store, runId)
  const step = lookupStep(stepId)
  if (!step) throw new ResearchError('DSH_UNKNOWN_STEP', `_applyHumanApproval: unknown step '${stepId}'`)
  if (!step.humanGate) throw new ResearchError('DSH_NOT_HUMAN_GATE', `_applyHumanApproval: step '${stepId}' is not a humanGate step`)
  const state = run.steps.get(stepId)
  if (!state) throw new ResearchError('DSH_NO_STATE', `_applyHumanApproval: no state for '${stepId}'`)
  // NOTE (T19 hold_abstained): the `gate_abstained` refusal guard lives in `host.ts`
  // `HostApprovalChannel.submit` (pre-guard, before this function is called) — design §6.
  // A held abstention is released ONLY via rollback→new attempt; human approval must never
  // convert an abstention into 'passed'. Placing the guard here too would be dead code because
  // the host pre-guard already rejects every held-abstention submit before reaching this point.
  if (state.status !== 'gated') {
    throw new ResearchError('DSH_APPROVAL_BAD_STATUS', `_applyHumanApproval: step '${stepId}' status '${state.status}' !== 'gated' — INV-APPROVAL-STATE`)
  }
  if (run.consumedApprovals.has(approvalEventId)) {
    throw new ResearchError('DSH_APPROVAL_REPLAY', `_applyHumanApproval: approvalEventId '${approvalEventId}' already consumed — INV-REPLAY (single-use per run)`)
  }
  const approval: ApprovalRecord = {
    run_id: runId,
    step_id: stepId,
    attempt_id: state.attempt_id,
    principalId,
    approval_event_id: approvalEventId,
    decision,
    timestamp: Date.now(),
  }
  state.approval = approval
  run.consumedApprovals.add(approvalEventId)
  const to: StepStatus = decision === 'approved' ? 'passed' : 'blocked'
  _apply(state, step, to)
  pushEvent(run, 'human-approval', stepId, state.attempt_id, { principalId, approvalEventId, decision })
  return state.status
}
