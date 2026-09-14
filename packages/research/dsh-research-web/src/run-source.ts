/**
 * Map a run snapshot from the Host into the view's summary input.
 *
 * WHY THIS IS A TWIN. The client bundle must not value-import a cross-plugin package,
 * and the research packages are split across compiler faces: the service that produces
 * this snapshot compiles in the Host face, this module in the Client face. So the wire
 * payload is declared here structurally, the way `runner/llm-prose-writer.ts` declares
 * its prose contract on the other side of the same divide. The twin is pinned from the
 * Host side: `dsh-research-team` exports the same field names and its integration spec
 * asserts them, so a rename there fails a test rather than silently blanking the view.
 *
 * WHAT IS NOT INVENTED. Every field comes from the snapshot. The gate evidence and the
 * artifact metadata are the run's OWN recorded values — they are the reason the Host
 * projects a snapshot rather than shipping the summary counts, which carry no evidence
 * to show.
 */
import type {
  AbstentionRecord,
  ArtifactView,
  DegradationNote,
  GateHistoryEntry,
  Phase,
  RunStatus,
  RunSummaryInput,
  StepStatus,
  StepView,
  TrinityComponent,
} from './summary.ts'

/** One gate verdict as the wire carries it. Twin of the Host's projection. */
export interface WireGateVerdict {
  readonly stepId: string
  readonly component: string
  readonly outcome: string
  readonly passed: boolean
  readonly evidence: string
  readonly rationale: string
  readonly timestamp: number
}

/** One artifact's metadata as the wire carries it. Twin of the Host's projection. */
export interface WireArtifactMeta {
  readonly slug: string
  readonly producerStepId: string
  readonly producerAttemptId: number
  readonly producedAt: number
  readonly invalidated: boolean
}

/** One step outcome as the wire carries it. */
export interface WireStepOutcome {
  readonly stepId: string
  readonly status: string
  readonly attemptId: number
  readonly kind: string
  readonly producer: string
  readonly outputSlugs: ReadonlyArray<string>
  readonly artifacts: ReadonlyArray<{ readonly slug: string; readonly producedBy: string }>
  readonly verdicts: Readonly<Record<string, string>>
  readonly usedRealTool: boolean
}

/** One step's catalogue entry as the wire carries it. */
export interface WireStepCatalogEntry {
  readonly id: string
  readonly index: number
  readonly phase: string
  readonly name: string
  readonly humanGate: boolean
  readonly gate: ReadonlyArray<string>
}

/** One step's runtime state as the wire carries it. */
export interface WireStepState {
  readonly stepId: string
  readonly status: string
  readonly attempt: number
  readonly holdReason: string | null
}

/** The complete payload one `run` returns. */
export interface WireRunSnapshot {
  readonly run: {
    readonly runId: string
    readonly steps: ReadonlyArray<WireStepOutcome>
  }
  readonly catalog: ReadonlyArray<WireStepCatalogEntry>
  readonly gates: ReadonlyArray<WireGateVerdict>
  readonly artifacts: ReadonlyArray<WireArtifactMeta>
  readonly steps: ReadonlyArray<WireStepState>
}

const STEP_STATUSES: ReadonlyArray<StepStatus> = ['pending', 'in_progress', 'gated', 'passed', 'blocked', 'failed']
const PHASES: ReadonlyArray<Phase> = ['A', 'B', 'C', 'D', 'E']
const COMPONENTS: ReadonlyArray<TrinityComponent> = ['A', 'B', 'C']

function asStepStatus(value: string): StepStatus {
  return STEP_STATUSES.find(status => status === value) ?? 'pending'
}

function asPhase(value: string): Phase {
  return PHASES.find(phase => phase === value) ?? 'A'
}

function asComponent(value: string): TrinityComponent | undefined {
  return COMPONENTS.find(component => component === value)
}

/**
 * The run-level status the header shows.
 *
 * Derived, not taken from the wire: a failure outranks an abstention, an abstention
 * outranks an unfinished step, and a run that finished its automatable work — leaving
 * only the human gate — is `completed`, because waiting for a person is the design.
 *
 * @param steps - the step outcomes the run produced.
 * @param gates - every gate verdict the run recorded.
 * @returns the run status.
 */
export function runStatusOf(
  steps: ReadonlyArray<WireStepOutcome>,
  gates: ReadonlyArray<WireGateVerdict>,
): RunStatus {
  if (steps.some(step => step.status === 'failed')) return 'failed'
  if (gates.some(gate => gate.outcome === 'abstained')) return 'abstained'
  if (steps.some(step => step.status === 'pending' || step.status === 'in_progress')) return 'running'
  return 'completed'
}

/**
 * Build the view's summary input from one wire snapshot.
 *
 * @param snapshot - the payload `ctx.remote.research.run(...)` resolved with.
 * @returns the flattened summary input the view model consumes.
 */
export function summaryInputFrom(snapshot: WireRunSnapshot): RunSummaryInput {
  const byStep = new Map(snapshot.run.steps.map(step => [step.stepId, step]))
  const stateByStep = new Map(snapshot.steps.map(state => [state.stepId, state]))
  const gatesByStep = new Map<string, ReadonlyArray<WireGateVerdict>>()
  for (const gate of snapshot.gates) {
    gatesByStep.set(gate.stepId, [...(gatesByStep.get(gate.stepId) ?? []), gate])
  }

  // Every catalogued step appears, whether or not the run reached it: a step with no
  // outcome is `pending`, which is what the run actually left behind.
  const steps: StepView[] = snapshot.catalog.map((entry) => {
    const outcome = byStep.get(entry.id)
    const state = stateByStep.get(entry.id)
    const holdReason = state?.holdReason
    return {
      stepId: entry.id,
      index: entry.index,
      phase: asPhase(entry.phase),
      name: entry.name,
      status: asStepStatus(outcome?.status ?? state?.status ?? 'pending'),
      attempt: state?.attempt ?? outcome?.attemptId ?? 0,
      humanGate: entry.humanGate,
      // The view model only knows the two hold reasons the engine records.
      ...(holdReason === 'gate_abstained' || holdReason === 'human_gate' ? { holdReason } : {}),
      gateOutcomes: (gatesByStep.get(entry.id) ?? [])
        .map(gate => ({ component: asComponent(gate.component), outcome: gate.outcome }))
        .filter((row): row is { component: TrinityComponent; outcome: GateHistoryEntry['outcome'] } =>
          row.component !== undefined),
    }
  })

  const gates: GateHistoryEntry[] = snapshot.gates
    .map((gate) => {
      const component = asComponent(gate.component)
      if (component === undefined) return undefined
      return {
        stepId: gate.stepId,
        component,
        outcome: gate.outcome as GateHistoryEntry['outcome'],
        passed: gate.passed,
        evidence: gate.evidence,
        rationale: gate.rationale,
        timestamp: gate.timestamp,
      }
    })
    .filter((entry): entry is GateHistoryEntry => entry !== undefined)

  const artifacts: ArtifactView[] = snapshot.artifacts.map(meta => ({
    slug: meta.slug,
    producerStepId: meta.producerStepId,
    producerAttemptId: meta.producerAttemptId,
    producedAt: meta.producedAt,
    invalidated: meta.invalidated,
    summary: `produced by ${meta.producerStepId} (attempt ${String(meta.producerAttemptId)})`,
  }))

  // An abstention is recorded per step and component; the wire carries the verdict, so
  // the record is built from it rather than from a separate channel that does not exist.
  const abstentions: AbstentionRecord[] = snapshot.gates
    .filter(gate => gate.outcome === 'abstained')
    .map((gate) => {
      const component = gate.component
      return {
        runId: snapshot.run.runId,
        stepId: gate.stepId,
        attemptId: stateByStep.get(gate.stepId)?.attempt ?? 0,
        component: (asComponent(component) ?? 'A'),
        reasonCode: gate.rationale === '' ? 'GATE_ABSTAINED' : gate.rationale,
        evidenceRefs: [],
        recordedAt: new Date(gate.timestamp).toISOString(),
      }
    })

  // Which steps produced their product from a fixture rather than from the real thing
  // is something the run reports on every step; the view surfaces it as a degradation
  // so a reader is never shown a fixture step without being told.
  const degradations: DegradationNote[] = snapshot.run.steps
    .filter(step => step.kind === 'fixture_executor')
    .map(step => ({
      stepId: step.stepId,
      kind: 'fallback' as const,
      message: 'this step ran a fixture executor: its product is deterministic built-in content, not derived from real inputs',
    }))

  return {
    runId: snapshot.run.runId,
    source: 'live',
    status: runStatusOf(snapshot.run.steps, snapshot.gates),
    steps,
    artifacts,
    gates,
    abstentions,
    degradations,
  }
}
