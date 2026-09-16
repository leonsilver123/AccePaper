import { lookupStep, STEPS } from '../src/engine/steps.ts'
import { commitStepOutputs } from '../src/engine/commit.ts'
import type { CommitReceipt } from '../src/engine/commit.ts'
import { completeStep, createRun, getRunSnapshot, setRunInput, startStep, submitGateVerdict } from '../src/engine/state-machine.ts'
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
 *
 * UNBOUND on purpose. A verdict that reaches the gate must carry the revisions it judged, and
 * {@link bindTo} or {@link submitBound} is what gives it them — from the step's own commit
 * receipt. A spec that wants to check the refusal keeps using this one unbound.
 */
export function verdict(component: TrinityComponent, passed: boolean): GateVerdict {
  const outcome: GateOutcome = passed ? 'passed' : 'failed'
  return { component, outcome, passed, evidence: 'evidence', rationale: 'rationale', timestamp: 1 }
}

/** Build an abstained gate verdict (T19 hold_abstained): outcome 'abstained', passed false. */
export function abstainVerdict(component: TrinityComponent): GateVerdict {
  return { component, outcome: 'abstained', passed: false, evidence: 'evidence', rationale: 'rationale', timestamp: 1 }
}

/**
 * Commit every output a step declares, with dummy values, and return the receipt.
 *
 * The gate adjudicates a step on what its attempt COMMITTED: a receipt is what it reads, and
 * writing the declared outputs one at a time is refused (`DSH_ARTIFACT_AFTER_COMMIT` once a commit
 * exists). So this is how a spec sets a step up for adjudication — the same commit point the
 * driver uses.
 *
 * @param store - the run store.
 * @param runId - the run.
 * @param stepId - the step whose declared outputs are written.
 * @param values - optional per-slug values; every slug gets `val:<slug>` when omitted.
 * @returns the receipt the commit produced.
 */
export function commitAll(
  store: ResearchRunStore,
  runId: string,
  stepId: string,
  values?: Readonly<Record<string, unknown>>,
): CommitReceipt {
  const step = lookupStep(stepId)
  if (!step) throw new Error(`commitAll: unknown step ${stepId}`)
  const snapshot = getRunSnapshot(store, runId)
  const attemptId = snapshot.steps[stepId]?.attemptId ?? 1
  const outcome = commitStepOutputs(store, runId, stepId, {
    attemptId,
    expectedRevision: snapshot.revision,
    idempotencyKey: `${stepId}#${String(attemptId)}`,
    outputs: step.outputs.map(slug => ({ slug, value: values?.[slug] ?? `val:${slug}` })),
  })
  if (!outcome.ok) throw new Error(`commitAll: ${outcome.code}: ${outcome.reason}`)
  return outcome.receipt
}

/** The commit receipt the step's current attempt produced. */
export function receiptOf(store: ResearchRunStore, runId: string, stepId: string): CommitReceipt {
  const receipt = getRunSnapshot(store, runId).steps[stepId]?.commit
  if (receipt === undefined) throw new Error(`receiptOf: '${stepId}' has not committed`)
  return receipt
}

/**
 * Bind a verdict to the step's current commit receipt.
 *
 * This is what `buildStepVerdicts` does in the runner, and it is the ONLY place a verdict acquires
 * its targets — never at submit time, where stamping would make an unrelated judgment look like a
 * judgment about the outputs it happened to land beside.
 */
export function bindTo(store: ResearchRunStore, runId: string, stepId: string, v: GateVerdict): GateVerdict {
  const receipt = receiptOf(store, runId, stepId)
  return { ...v, targetRefs: receipt.artifacts.map(artifact => artifact.ref), inputDigest: receipt.inputDigest }
}

/**
 * Submit a verdict bound to the step's current commit — the shape every real gate submission has.
 *
 * @param store - the run store.
 * @param runId - the run.
 * @param stepId - the step being adjudicated.
 * @param v - the UNBOUND verdict; this binds it before submitting.
 * @returns the step's status after the submission.
 */
export function submitBound(
  store: ResearchRunStore,
  runId: string,
  stepId: string,
  v: GateVerdict,
): ReturnType<typeof submitGateVerdict> {
  return submitGateVerdict(store, runId, stepId, bindTo(store, runId, stepId, v))
}

/** Start a step, commit all its declared outputs (dummy values), then adjudicate:
 *  empty gate → completeStep (humanGate→gated, non-humanGate→passed);
 *  non-empty gate → submit each declared component passed (auto-adjudicates to passed for non-humanGate). */
export function passStep(store: ResearchRunStore, runId: string, stepId: string): void {
  const step = lookupStep(stepId)
  if (!step) throw new Error(`passStep: unknown step ${stepId}`)
  startStep(store, runId, stepId)
  if (step.gate.length === 0) {
    completeStep(store, runId, stepId)
  } else {
    const receipt = commitAll(store, runId, stepId)
    for (const comp of step.gate) {
      submitGateVerdict(store, runId, stepId, {
        ...verdict(comp, true),
        targetRefs: receipt.artifacts.map(artifact => artifact.ref),
        inputDigest: receipt.inputDigest,
      })
    }
  }
}

/** Run all 16 steps in dependency order. E2-submit (humanGate, empty gate) ends at 'gated'. */
export function runFullPipeline(store: ResearchRunStore, runId?: string): string {
  const id = seedRun(store, runId)
  for (const s of STEPS) passStep(store, id, s.id)
  return id
}
