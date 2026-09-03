import { STEP_BY_ID, STEPS } from '../src/engine/steps.ts'
import { completeStep, createRun, recordArtifact, setRunInput, startStep, submitGateVerdict } from '../src/engine/state-machine.ts'
import type { GateVerdict, ResearchRunStore, RunState, TrinityComponent } from '../src/engine/types.ts'

export function freshStore(): ResearchRunStore {
  return new Map<string, RunState>()
}

/** createRun + seed domain-direction. */
export function seedRun(store: ResearchRunStore, runId?: string): string {
  const id = createRun(store, runId)
  setRunInput(store, id, 'domain-direction', 'ML')
  return id
}

export function verdict(component: TrinityComponent, passed: boolean): GateVerdict {
  return { component, passed, evidence: 'evidence', rationale: 'rationale', timestamp: 1 }
}

/** Start a step, record all its declared outputs (dummy values), then adjudicate:
 *  empty gate → completeStep (humanGate→gated, non-humanGate→passed);
 *  non-empty gate → submit each declared component passed (auto-adjudicates to passed for non-humanGate). */
export function passStep(store: ResearchRunStore, runId: string, stepId: string): void {
  const step = STEP_BY_ID.get(stepId)
  if (!step) throw new Error(`passStep: unknown step ${stepId}`)
  startStep(store, runId, stepId)
  for (const out of step.outputs) recordArtifact(store, runId, stepId, out, `val:${out}`)
  if (step.gate.length === 0) {
    completeStep(store, runId, stepId)
  } else {
    for (const comp of step.gate) submitGateVerdict(store, runId, stepId, verdict(comp, true))
  }
}

/** Run all 16 steps in dependency order. E2-submit (humanGate, empty gate) ends at 'gated'. */
export function runFullPipeline(store: ResearchRunStore, runId?: string): string {
  const id = seedRun(store, runId)
  for (const s of STEPS) passStep(store, id, s.id)
  return id
}
