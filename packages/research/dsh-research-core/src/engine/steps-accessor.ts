// @deepseek-ai/dsh-research-core — read-only 16-step definition accessor (T19-B orchestration).
//
// Why this module exists: the frozen step-definition singletons STEPS / STEP_BY_ID
// are consumed internally by the state machine and are intentionally NOT re-exported
// from the public entry (RC-A — an importer must not obtain the live array/Map, and
// must not be able to mutate `step.humanGate`/`step.gate`/`step.inputs` and thereby
// bypass the guards that read them live). T19-B's team runner still needs to iterate
// the canonical step order and read step metadata (gate components / outputs) to drive
// the pipeline. This accessor is the ONLY sanctioned read path:
//
//   - `getStepDefinitions()` returns a fresh array of DEEP-FROZEN CLONES (one per
//     step, in canonical pipeline order). The clones are structurally independent of
//     the internal definitions: mutating a returned object (attempted in strict mode
//     it throws TypeError because every level is frozen) can never affect the internal
//     definitions or a later caller's snapshot.
//   - `getStepDefinitionById(stepId)` returns the deep-frozen clone for one step, or
//     undefined for an unknown id.
//   - The caller NEVER obtains the internal STEPS array, the STEP_BY_ID Map, or any
//     live (non-cloned) object reference.
//
// Cloning cost is negligible (16 small plain objects); the clone-then-freeze strategy
// is preferred over returning the already-frozen internals because it also makes the
// accessor's contract testable in isolation ("caller mutation does not affect internal
// definitions" holds even if a future change thaws the internals).

import { lookupStep, STEPS } from './steps.ts'
import type { StepDefinition } from './types.ts'

/**
 * Recursively Object.freeze an already-cloned value (mirror of the RC-A backstop used
 * in steps.ts; module-private here because steps.ts does not export its helper).
 */
function deepFreezeClone<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    Object.freeze(obj)
    if (Array.isArray(obj)) {
      for (const v of obj) deepFreezeClone(v)
    } else {
      for (const key of Object.keys(obj)) deepFreezeClone(obj[key])
    }
  }
  return value
}

function cloneFrozen(def: StepDefinition): StepDefinition {
  // structuredClone strips the prototype and copies every own enumerable property,
  // yielding a plain structural twin of the frozen internal definition.
  return deepFreezeClone(structuredClone(def))
}

/**
 * All 16 step definitions in canonical pipeline order, as structurally independent,
 * deep-frozen clones. Read-only: every nested level is Object.freeze-d.
 */
export function getStepDefinitions(): readonly StepDefinition[] {
  return Object.freeze(STEPS.map(cloneFrozen))
}

/**
 * One step definition by id (deep-frozen clone), or undefined when the id is not a
 * known pipeline step. Never returns the internal object.
 */
export function getStepDefinitionById(stepId: string): StepDefinition | undefined {
  // Same source as `getStepDefinitions()` (the frozen STEPS array) — audit P1-1:
  // resolving through a mutable Map let the two accessors disagree.
  const def = lookupStep(stepId)
  return def === undefined ? undefined : cloneFrozen(def)
}
