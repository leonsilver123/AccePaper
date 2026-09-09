import { lookupStep, STEPS } from '../src/engine/steps.ts'
import { completeStep, createRun, recordArtifact, setRunInput, startStep, submitGateVerdict } from '../src/engine/state-machine.ts'
import type { GateOutcome, GateVerdict, ResearchRunStore, RunState, TrinityComponent } from '../src/engine/types.ts'

export function freshStore(): ResearchRunStore {
  return new Map<string, RunState>()
}

/** createRun + seed domain-direction. */
export function seedRun(store: ResearchRunStore, runId?: string): string {
  const id = createRun(store, runId)
  setRunInput(store, id, 'domain-direction', 'ML')
  return id
}

/**
 * Build a gate verdict. T19: `passed` is a derived projection of `outcome`
 * (passed ⟺ outcome==='passed'); the write boundary rejects verdicts lacking a
 * valid `outcome` (DSH_GATEVERDICT_MISSING_OUTCOME — no silent reinterpretation).
 */
export function verdict(component: TrinityComponent, passed: boolean): GateVerdict {
  const outcome: GateOutcome = passed ? 'passed' : 'failed'
  return { component, outcome, passed, evidence: 'evidence', rationale: 'rationale', timestamp: 1 }
}

/** Build an abstained gate verdict (T19 hold_abstained): outcome 'abstained', passed false. */
export function abstainVerdict(component: TrinityComponent): GateVerdict {
  return { component, outcome: 'abstained', passed: false, evidence: 'evidence', rationale: 'rationale', timestamp: 1 }
}

/** Start a step, record all its declared outputs (dummy values), then adjudicate:
 *  empty gate → completeStep (humanGate→gated, non-humanGate→passed);
 *  non-empty gate → submit each declared component passed (auto-adjudicates to passed for non-humanGate). */
export function passStep(store: ResearchRunStore, runId: string, stepId: string): void {
  const step = lookupStep(stepId)
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
