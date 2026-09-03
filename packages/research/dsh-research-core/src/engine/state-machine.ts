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

import type {
  ApprovalRecord,
  AttemptRecord,
  AuditEntry,
  AuditEvent,
  AuditEventKind,
  CurrentAttemptSnapshot,
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
import { SEEDABLE_INPUTS, STEP_BY_ID, STEPS } from './steps.ts'

// ── Errors ────────────────────────────────────────────────────────────────────

/** Base error for the research state machine (carries a stable `code`, also prefixed into the
 *  message so `toThrow(/CODE/)` assertions can match the code, not just the prose). */
export class ResearchError extends Error {
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

// ── Internal helpers ──────────────────────────────────────────────────────────

function ensureRun(store: ResearchRunStore, runId: string): RunState {
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

/** Deep-cloned superseded snapshot of a step's current attempt (INV-HISTORY-IMMUTABLE). */
function snapshotOf(state: StepState): AttemptRecord {
  return {
    attempt_id: state.attempt_id,
    status: state.status,
    artifacts: cloneValue(state.artifacts) as Record<string, unknown>,
    gateResults: cloneValue(state.gateResults) as Partial<Record<TrinityComponent, GateVerdict>>,
    ...(state.approval ? { approval: cloneValue(state.approval) as ApprovalRecord } : {}),
    superseded: true,
  }
}

/** Reset a step's live fields to a fresh pending attempt (attempt_id NOT advanced — startStep advances it). */
function resetStep(state: StepState): void {
  state.status = 'pending'
  state.artifacts = {}
  state.gateResults = {}
  state.approval = undefined
  state.startedAt = undefined
  state.finishedAt = undefined
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
    const curDef = STEP_BY_ID.get(cur)
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
  const allowed = LEGAL_TRANSITIONS[state.status]
  if (!allowed || !allowed.has(to)) {
    throw new ResearchError('DSH_ILLEGAL_TRANSITION', `state-machine: illegal '${state.status}' -> '${to}' for '${step.id}'`)
  }
  if (to === 'passed' && step.humanGate && state.approval?.decision !== 'approved') {
    throw new ResearchError('DSH_HUMAN_GATE_NOT_APPROVED', `state-machine: humanGate step '${step.id}' cannot move to 'passed' without an approved human approval`)
  }
  state.status = to
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

/** Create a new run. Throws RUN_EXISTS on explicit-runId collision (never clobbers). */
export function createRun(store: ResearchRunStore, runId?: string): string {
  const id = runId ?? generateRunId()
  if (store.has(id)) throw new ResearchRunError('RUN_EXISTS', `createRun: run '${id}' already exists (refusing to clobber existing run state + audit log)`)
  const run: RunState = { runId: id, inputs: {}, steps: new Map(), registry: {}, events: [], consumedApprovals: new Set<string>() }
  store.set(id, run)
  pushEvent(run, 'run-created', undefined, undefined, { runId: id })
  return id
}

/** Seed a run-level input (T0 human authorization). Slug must be in SEEDABLE_INPUTS;
 *  value must be present; run must not have any started step — neither a non-pending status
 *  nor a prior attempt (rollback resets status to 'pending' but preserves attempts/history,
 *  so the guard checks both — INV-INPUT-FROZEN, RC-D). Value deep-cloned. */
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

/** Read-only run snapshot (deep-cloned; artifact values excluded — fetch via getArtifact — HOLE-4). */
export function getRunSnapshot(store: ResearchRunStore, runId: string): RunSnapshot {
  const run = ensureRun(store, runId)
  const steps: Record<string, StepSnapshot> = {}
  for (const [id, s] of run.steps) steps[id] = snapshotStep(s)
  const registry: Record<string, {
    slug: string
    producerStepId: string
    producerAttemptId: number
    producedAt: number
    invalidated: boolean
  }> = {}
  for (const slug in run.registry) {
    const r = run.registry[slug]
    if (!r) continue
    registry[slug] = {
      slug: r.slug,
      producerStepId: r.producerStepId,
      producerAttemptId: r.producerAttemptId,
      producedAt: r.producedAt,
      invalidated: r.invalidated,
    }
  }
  return {
    runId: run.runId,
    inputs: cloneValue(run.inputs) as Record<string, unknown>,
    steps,
    registry,
    events: run.events.map(e => cloneValue(e) as AuditEvent),
  }
}

/** Deep-cloned value of one artifact (undefined if missing/invalidated). */
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

/** True iff the step is pending and every input is satisfied by a passed-producer artifact or a seed. */
export function canStart(store: ResearchRunStore, runId: string, stepId: string): boolean {
  const run = ensureRun(store, runId)
  const step = STEP_BY_ID.get(stepId)
  if (!step) return false
  const state = run.steps.get(stepId)
  if (state && state.status !== 'pending') return false
  for (const input of step.inputs) {
    if (!isInputSatisfied(run, input)) return false
  }
  return true
}

/** Move a pending step whose inputs are ready to in_progress. Throws if it cannot start.
 *  Returns a deep-cloned StepSnapshot (never the internal ref — INV-SNAPSHOT). */
export function startStep(store: ResearchRunStore, runId: string, stepId: string): StepSnapshot {
  const run = ensureRun(store, runId)
  const step = STEP_BY_ID.get(stepId)
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

/** Atomic check+transition (C-9 TOCTOU-safe): returns the snapshot, or null if it cannot start. */
export function startIfCan(store: ResearchRunStore, runId: string, stepId: string): StepSnapshot | null {
  if (!canStart(store, runId, stepId)) return null
  return startStep(store, runId, stepId)
}

/** Record a produced output artifact. Slug must be declared in step.outputs (INV-OUTPUT-CONTRACT);
 *  step must be in_progress. Value deep-cloned; registry entry REPLACED fresh (invalidated=false — DEP-4). */
export function recordArtifact(store: ResearchRunStore, runId: string, stepId: string, outputSlug: string, value: unknown): void {
  const run = ensureRun(store, runId)
  const step = STEP_BY_ID.get(stepId)
  if (!step) throw new ResearchError('DSH_UNKNOWN_STEP', `recordArtifact: unknown step '${stepId}'`)
  if (step.outputs.indexOf(outputSlug) === -1) {
    throw new ResearchError('DSH_OUTPUT_NOT_DECLARED', `recordArtifact: slug '${outputSlug}' is not declared in step '${stepId}' outputs — INV-OUTPUT-CONTRACT`)
  }
  const state = run.steps.get(stepId)
  if (!state || state.status !== 'in_progress') {
    throw new ResearchError('DSH_NOT_IN_PROGRESS', `recordArtifact: step '${stepId}' is not in_progress`)
  }
  const cloned = cloneValue(value)
  state.artifacts[outputSlug] = cloned
  run.registry[outputSlug] = {
    slug: outputSlug,
    producerStepId: stepId,
    producerAttemptId: state.attempt_id,
    value: cloned,
    producedAt: Date.now(),
    invalidated: false,
  }
  pushEvent(run, 'artifact-recorded', stepId, state.attempt_id, { slug: outputSlug })
}

/**
 * Submit one trinity-component gate verdict. Component must be declared in step.gate
 * (INV-GATE-COMPONENT); throws on empty-gate steps (use completeStep — INV-COMPLETESTEP-EMPTY);
 * step must be in_progress (INV-VERDICT-STATUS); one verdict per component per attempt
 * (INV-VERDICT-IMMUTABLE). Auto-adjudicates via the shared `_adjudicate` on the last verdict
 * (INV-SOLE-ADJUDICATOR). Verdict deep-cloned before storage (INV-WRITE-ISOLATION).
 */
export function submitGateVerdict(store: ResearchRunStore, runId: string, stepId: string, verdict: GateVerdict): StepStatus {
  const run = ensureRun(store, runId)
  const step = STEP_BY_ID.get(stepId)
  if (!step) throw new ResearchError('DSH_UNKNOWN_STEP', `submitGateVerdict: unknown step '${stepId}'`)
  if (step.gate.length === 0) {
    throw new ResearchError('DSH_EMPTY_GATE', `submitGateVerdict: step '${stepId}' has an empty gate — use completeStep() (INV-COMPLETESTEP-EMPTY)`)
  }
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
  const snapshot = cloneValue(verdict) as GateVerdict
  const component = snapshot.component
  if (step.gate.indexOf(component) === -1) {
    throw new ResearchError('DSH_GATE_COMPONENT_NOT_DECLARED', `submitGateVerdict: component '${component}' is not in step '${stepId}' gate — INV-GATE-COMPONENT`)
  }
  const state = run.steps.get(stepId)
  if (!state) throw new ResearchError('DSH_NO_STATE', `submitGateVerdict: no state for '${stepId}'`)
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
  pushEvent(run, 'step-completed', stepId, state.attempt_id, { status: result })
  return result
}

/**
 * Finalize an empty-gate step (INV-COMPLETESTEP-EMPTY — throws on non-empty gates, which are
 * adjudicated solely by submitGateVerdict; INV-SOLE-ADJUDICATOR). Step must be in_progress.
 * Non-humanGate empty gate → 'passed'; humanGate empty gate → 'gated' (await human approval).
 */
export function completeStep(store: ResearchRunStore, runId: string, stepId: string): StepStatus {
  const run = ensureRun(store, runId)
  const step = STEP_BY_ID.get(stepId)
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
 */
export function rollback(store: ResearchRunStore, runId: string, stepId: string): void {
  const run = ensureRun(store, runId)
  const step = STEP_BY_ID.get(stepId)
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
 *  human approval for the CURRENT attempt — INV-COMPLETE-ATTEMPT). */
export function isComplete(store: ResearchRunStore, runId: string, stepId: string): boolean {
  const run = ensureRun(store, runId)
  const state = run.steps.get(stepId)
  if (!state || state.status !== 'passed') return false
  const step = STEP_BY_ID.get(stepId)
  if (step?.humanGate) {
    return state.approval?.decision === 'approved' && state.approval.attempt_id === state.attempt_id
  }
  return true
}

/** Audit view: superseded snapshots followed by the current attempt snapshot, all deep-cloned. */
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
    history: state.history.map(h => cloneValue(h) as AttemptRecord),
    ...(state.startedAt !== undefined ? { startedAt: state.startedAt } : {}),
    ...(state.finishedAt !== undefined ? { finishedAt: state.finishedAt } : {}),
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
  const step = STEP_BY_ID.get(stepId)
  if (!step) throw new ResearchError('DSH_UNKNOWN_STEP', `_applyHumanApproval: unknown step '${stepId}'`)
  if (!step.humanGate) throw new ResearchError('DSH_NOT_HUMAN_GATE', `_applyHumanApproval: step '${stepId}' is not a humanGate step`)
  const state = run.steps.get(stepId)
  if (!state) throw new ResearchError('DSH_NO_STATE', `_applyHumanApproval: no state for '${stepId}'`)
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
