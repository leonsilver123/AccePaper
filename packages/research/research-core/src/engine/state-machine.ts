import type { GateVerdict, StepState, StepStatus } from './types.ts'
import { STEP_BY_ID } from './steps.ts'

/**
 * State machine for the 16-step research engine (F-W1 gap — newly created).
 *
 * Enforces:
 *  - input dependency: a step may not start until every slug in its `inputs`
 *    has been produced as an artifact somewhere in the store;
 *  - gate adjudication: a step may not exit until every component in its
 *    `gate` has a verdict; all-passed → 'passed', falsifiable C-fail → 'failed',
 *    other fail → 'blocked';
 *  - legal StepStatus transitions: pending → in_progress → gated →
 *    passed/blocked/failed, with rollback reverting to 'pending'.
 *
 * Rollback semantics (D4 回退): revert the target step to 'pending' and clear
 * its gateResults (and artifacts by default), enabling a fresh re-run via
 * startStep. The cascade is emergent — downstream consumers of this step's
 * outputs lose those inputs, so their canStart returns false until the outputs
 * are re-produced. `attempts` is retained across rollback for diagnostics.
 */

/** Mutable map of step runtime states, keyed by step id. */
export type StepStore = Map<string, StepState>

/** Legal forward edges; terminal states allow none. Rollback (any → pending) is performed via rollback(), not transition(). */
const LEGAL_TRANSITIONS: Readonly<Record<StepStatus, ReadonlySet<StepStatus>>> = {
  pending: new Set<StepStatus>(['in_progress']),
  in_progress: new Set<StepStatus>(['gated']),
  gated: new Set<StepStatus>(['passed', 'blocked', 'failed']),
  passed: new Set<StepStatus>(),
  blocked: new Set<StepStatus>(),
  failed: new Set<StepStatus>(),
}

function ensureEntry(stepId: string, store: StepStore): StepState {
  let state = store.get(stepId)
  if (!state) {
    state = {
      stepId,
      status: 'pending',
      attempts: 0,
      artifacts: {},
      gateResults: {},
      startedAt: undefined,
      finishedAt: undefined,
    }
    store.set(stepId, state)
  }
  return state
}

/**
 * True iff the step is pending (or has no state yet, which is implicitly pending)
 * and every input slug has been produced as an artifact somewhere in the store.
 */
export function canStart(stepId: string, store: Readonly<StepStore>): boolean {
  const step = STEP_BY_ID.get(stepId)
  if (!step) return false
  const state = store.get(stepId)
  const status: StepStatus = state?.status ?? 'pending'
  if (status !== 'pending') return false
  for (const slug of step.inputs) {
    let produced = false
    for (const other of store.values()) {
      if (slug in other.artifacts) {
        produced = true
        break
      }
    }
    if (!produced) return false
  }
  return true
}

/** Move a pending step whose inputs are ready to in_progress. Throws if it cannot start. */
export function startStep(stepId: string, store: StepStore): StepState {
  if (!canStart(stepId, store)) {
    throw new Error(`state-machine.startStep: cannot start '${stepId}' (not pending or inputs missing)`)
  }
  const state = ensureEntry(stepId, store)
  state.status = 'in_progress'
  state.startedAt = Date.now()
  state.attempts += 1
  return state
}

/** Record a produced output artifact. The step must be in_progress. */
export function recordArtifact(stepId: string, outputSlug: string, value: unknown, store: StepStore): void {
  const state = store.get(stepId)
  if (!state || state.status !== 'in_progress') {
    throw new Error(`state-machine.recordArtifact: step '${stepId}' is not in_progress`)
  }
  state.artifacts[outputSlug] = value
}

/**
 * Submit one trinity-component gate verdict. Adjudicates once every component
 * in the step's `gate` has a verdict: all-passed → 'passed'; any fail on a
 * falsifiable step's component C → 'failed'; any other fail → 'blocked'.
 * An empty gate passes immediately on submit. Returns the resulting status.
 */
export function submitGateVerdict(stepId: string, verdict: GateVerdict, store: StepStore): StepStatus {
  const step = STEP_BY_ID.get(stepId)
  if (!step) throw new Error(`state-machine.submitGateVerdict: unknown step '${stepId}'`)
  const state = store.get(stepId)
  if (!state) throw new Error(`state-machine.submitGateVerdict: no state for '${stepId}'`)
  if (state.status !== 'in_progress' && state.status !== 'gated') {
    throw new Error(`state-machine.submitGateVerdict: step '${stepId}' status '${state.status}' cannot accept verdicts`)
  }
  state.gateResults[verdict.component] = verdict

  if (step.gate.length === 0) {
    state.status = 'passed'
    state.finishedAt = Date.now()
    return state.status
  }

  // Not all gate components in yet — stay in_progress/gated.
  for (const comp of step.gate) {
    if (!(comp in state.gateResults)) return state.status
  }

  // All in: adjudicate.
  let anyFail = false
  let cFailOnFalsifiable = false
  for (const comp of step.gate) {
    const v = state.gateResults[comp]
    if (v && !v.passed) {
      anyFail = true
      if (step.falsifiable !== null && comp === 'C') cFailOnFalsifiable = true
    }
  }
  if (!anyFail) {
    state.status = 'passed'
  } else if (cFailOnFalsifiable) {
    state.status = 'failed'
  } else {
    state.status = 'blocked'
  }
  state.finishedAt = Date.now()
  return state.status
}

/** Guarded legal-edge transition. Throws on illegal edges. */
export function transition(stepId: string, to: StepStatus, store: StepStore): void {
  const state = store.get(stepId)
  if (!state) throw new Error(`state-machine.transition: no state for '${stepId}'`)
  const allowed = LEGAL_TRANSITIONS[state.status]
  if (!allowed || !allowed.has(to)) {
    throw new Error(`state-machine.transition: illegal '${state.status}' -> '${to}' for '${stepId}'`)
  }
  state.status = to
  if (to === 'passed' || to === 'blocked' || to === 'failed') {
    state.finishedAt = Date.now()
  }
}

/**
 * D4 回退: revert the step to 'pending' and clear gateResults (and artifacts by
 * default), enabling a fresh re-run via startStep. `attempts` is retained.
 * Cascade is emergent: downstream consumers lose this step's outputs.
 */
export function rollback(stepId: string, store: StepStore, opts?: { clearArtifacts?: boolean }): void {
  const state = store.get(stepId)
  if (!state) throw new Error(`state-machine.rollback: no state for '${stepId}'`)
  const clearArtifacts = opts?.clearArtifacts !== false
  state.status = 'pending'
  state.gateResults = {}
  if (clearArtifacts) state.artifacts = {}
  state.startedAt = undefined
  state.finishedAt = undefined
}

/** True iff the step has reached 'passed'. */
export function isComplete(stepId: string, store: Readonly<StepStore>): boolean {
  const state = store.get(stepId)
  return state?.status === 'passed'
}
