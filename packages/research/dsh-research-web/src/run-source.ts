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
 * WHY IT IS STILL HAND-DECLARED, and what that costs. The generated declaration for this namespace
 * already names the Host's type (`dsh-research-team/lib/typert.remote-client.d.ts`, "do not edit",
 * and it imports the snapshot from the Host's `./types` subpath). Using it here would make the
 * compiler the drift check. Two things stop that today:
 *   1. this package deliberately depends on NONE of the research packages, so the subpath does not
 *      resolve for this program and a project reference alone does not change that; and
 *   2. the dependency link it would need cannot be created on this host (the package manager will
 *      not run — see `plan/ENGINEERING-CONTRACT.md` §6).
 * So the twin stays, and the cost is real: the Host added `packageExport` and `runPersistence` and
 * this file was not updated with them, which left a run's exported files invisible in the product
 * while every test passed. A twin is a copy, and a copy drifts; a Host-side spec that fails when
 * the snapshot gains a field is the guard this shape needs and does not have.
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
  DeliverableView,
  RunExecution,
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
  /**
   * How the step's EXECUTION ended, and why when it did not succeed.
   *
   * The Host has carried both since the driver distinguished an execute failure from a gate
   * verdict. The twin did not, so a step that failed mid-execution reached the view as
   * `in_progress` with no cause: the user saw "running" indefinitely on a run that had already
   * stopped, which is the failure the P2 criterion "the failure reason is shown" is about. An
   * independent audit found it by feeding a real response through this mapping.
   */
  readonly executeStatus?: string
  readonly executeError?: string
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
  /**
   * The project revision this snapshot was read at, when the host names one.
   *
   * OPTIONAL for the same reason `packageExport` is: a host that predates the field still satisfies
   * this declaration. Read explicitly — a missing revision is reported as absent, never as zero,
   * because zero is a revision a run can genuinely be at.
   */
  readonly projectRevision?: number
  readonly catalog: ReadonlyArray<WireStepCatalogEntry>
  readonly gates: ReadonlyArray<WireGateVerdict>
  readonly artifacts: ReadonlyArray<WireArtifactMeta>
  readonly steps: ReadonlyArray<WireStepState>
  /**
   * What the run left on disk. OPTIONAL because the twin drifts: the Host added these two fields
   * when the export and the durable snapshot landed, and this declaration was not updated with
   * them, so the client received both and could name neither. Declared optional so a Host that
   * predates them still satisfies the twin — and read explicitly, per field, in
   * {@link deliverablesOf}.
   */
  readonly packageExport?: WirePackageExport | null
  readonly runPersistence?: WireRunPersistence | null
  /**
   * What the deployment's evidence profile allows, and whether THIS run is ready.
   *
   * The host has carried these four since the readiness split landed, and the twin did not declare
   * them — so the browser received them and could name none, which is the same drift `packageExport`
   * is annotated for. OPTIONAL on the same terms: an older host still satisfies the declaration.
   *
   * They are declared here because the workbench could not otherwise say the one thing a reader
   * needs before trusting a screen: whether this is a demonstration and whether anything is ready.
   */
  readonly evidenceProfile?: string
  readonly profileEligible?: boolean
  readonly submissionReady?: boolean
  readonly readinessNote?: string
  /**
   * Whether the HOST still has a driver on this run, and why it stopped when it threw.
   *
   * The host reports this per response rather than storing it, and the distinction is the whole
   * point: `running` says a driver is on the run in the process that answered, `stopped` says
   * nothing is. A page reload does not end a study, so a client that reads `stopped` after a
   * restart is being told the truth about the process, not about the work.
   *
   * OPTIONAL on the same terms as the fields above: a host that predates them still satisfies this
   * declaration, and an absent value is reported as unnamed rather than folded into `stopped`.
   */
  readonly execution?: string
  readonly executionError?: string
}

/**
 * One frame of a run's follow stream, as the wire carries it.
 *
 * A STREAM method is not wrapped in `RemoteResult` — the generated client declares it as
 * `AsyncIterable<T>` and a refusal arrives as a carrier failure — so these are the frames
 * themselves, not a result around them.
 *
 * The `snapshot` frame is the consistent point: its cursor is the position its snapshot was read
 * at, so a page that reconnects renders a state that already includes what it missed.
 */
export type WireRunFrame =
  | { readonly type: 'snapshot'; readonly cursor: string; readonly snapshot: WireRunSnapshot }
  | {
    readonly type: 'event'
    readonly event: {
      /** The event's identity. NOT the position to continue from — that is `cursor`. */
      readonly eventId: string
      readonly runId: string
      readonly sequence: number
      /**
       * The position AFTER this event, which is what a page that has consumed it names next.
       *
       * It carries the log's identity as well as the count, so a page cannot resume a position that
       * belongs to a different history of the run: the host refuses it and the page re-reads.
       */
      readonly cursor: string
      readonly schemaVersion: number
      readonly kind: string
      readonly stepId?: string
      readonly attemptId?: number
      readonly ts: number
    }
  }
  | { readonly type: 'resync'; readonly reason: string }

/** What one start command answers with, as the wire carries it. */
export interface WireRunStart {
  readonly runId: string
  /** Whether a restart could find this run on disk. FALSE is not a failure; it is a limit. */
  readonly persisted: boolean
  readonly persistenceError?: string
  readonly startedAt: number
}

/** The Host's export result, structurally. */
export interface WirePackageExport {
  readonly files: ReadonlyArray<{ readonly path: string; readonly bytes: number; readonly sha256: string }>
  readonly error?: string
  readonly directory?: string
}

/**
 * One study the deployment holds, as the list query carries it.
 *
 * Structural twin of the Host's `ResearchRunSummaryEntry`. The page needs no more than this to offer
 * a choice: what the study is, how far it got, and whether it can be submitted.
 */
export interface WireRunSummaryEntry {
  readonly runId: string
  readonly execution?: string
  readonly projectRevision: number
  readonly stepsPassed: number
  readonly stepsTotal: number
  readonly submissionReady: boolean
  readonly saveFailure?: string
  readonly executionError?: string
  readonly interrupted: ReadonlyArray<string>
}

/**
 * One entry as the workbench renders it.
 *
 * A VIEW MODEL, not the wire shape: an execution state this build does not recognise becomes `null`
 * rather than being folded into `stopped`, for the same reason {@link RunSummary.execution} is
 * nullable — a host that says something this build cannot name has not said the study stopped.
 */
export interface RunListEntryView {
  readonly runId: string
  /** One of the states this build knows, or null when the host named one it does not. */
  readonly execution: RunExecution | null
  readonly projectRevision: number
  readonly stepsPassed: number
  readonly stepsTotal: number
  readonly submissionReady: boolean
  readonly saveFailure: string | null
  readonly executionError: string | null
  readonly interrupted: ReadonlyArray<string>
}

/**
 * Map the list query's answer into what the workbench renders.
 *
 * @param entries - the entries the host returned.
 * @returns one view per entry, in the host's order.
 */
export function runListFrom(entries: ReadonlyArray<WireRunSummaryEntry>): ReadonlyArray<RunListEntryView> {
  return entries.map(entry => ({
    runId: entry.runId,
    // REPORT, do not default: a state this build cannot name is null, never folded into `stopped`.
    execution: RUN_EXECUTIONS.find(execution => execution === entry.execution) ?? null,
    projectRevision: entry.projectRevision,
    stepsPassed: entry.stepsPassed,
    stepsTotal: entry.stepsTotal,
    submissionReady: entry.submissionReady,
    saveFailure: entry.saveFailure ?? null,
    executionError: entry.executionError ?? null,
    interrupted: entry.interrupted,
  }))
}

/**
 * What one save retry answers with, structurally.
 *
 * The same fields {@link WireRunStart} carries for a start, because they are the same facts: whether
 * the run's state reached its snapshot, why not when it did not, and the run as it stands after the
 * attempt — which is what the page re-renders from rather than re-reading separately.
 */
export interface WireRunSaveRetry {
  readonly runId: string
  readonly persisted: boolean
  readonly persistenceError?: string
  readonly snapshot: WireRunSnapshot
}

/** The Host's durability result, structurally. */
export interface WireRunPersistence {
  readonly runId: string
  readonly revision: number | null
  readonly interrupted: ReadonlyArray<string>
  readonly error?: string
  readonly directory?: string
}

const STEP_STATUSES: ReadonlyArray<StepStatus> = ['pending', 'in_progress', 'gated', 'passed', 'blocked', 'failed']
const PHASES: ReadonlyArray<Phase> = ['A', 'B', 'C', 'D', 'E']
const COMPONENTS: ReadonlyArray<TrinityComponent> = ['A', 'B', 'C']

const RUN_EXECUTIONS: ReadonlyArray<RunExecution> = ['running', 'stopped', 'failed']

function asStepStatus(value: string): StepStatus {
  // REPORT, do not default. Defaulting to `pending` showed a step the Host had advanced as 未开始
  // and folded it into a real bucket in the counts. An independent audit found the three coercions
  // in this file defaulting silently, and named this as the shape a `keyof` freeze cannot see.
  if (STEP_STATUSES.some(status => status === value)) return value as StepStatus
  return 'unknown'
}

function asPhase(value: string): Phase {
  return PHASES.some(phase => phase === value) ? (value as Phase) : 'unknown'
}

function asComponent(value: string): TrinityComponent | undefined {
  return COMPONENTS.find(component => component === value)
}

/** Which of the two `status` fields the view took its answer from. */
export type StepStatusSource = 'outcome' | 'state' | 'unreached'

/** The status the view shows, which field it came from, and whether the two disagreed. */
export interface ResolvedStepStatus {
  readonly status: StepStatus
  /**
   * `outcome` — the driver recorded how an attempt on this step ended;
   * `state`    — only the store has a state for it;
   * `unreached`— neither does, so the run never got here.
   */
  readonly source: StepStatusSource
  /**
   * True when both fields were present and named different statuses.
   *
   * Surfaced rather than resolved away: the divergence is the interesting fact, and a reader
   * who is not told about it has to know the rule to notice.
   */
  readonly diverged: boolean
}

/**
 * Resolve the one status the view shows, from the TWO different facts named `status`.
 *
 * WHY THIS IS A FUNCTION AND NOT A `??`. Two unrelated facts travel under that name, and they
 * are not interchangeable:
 *   - `WireStepOutcome.status` is how ONE ATTEMPT ended, as the driver recorded it. It exists
 *     only for a step the driver actually reached, and it is the only one that carries an
 *     execution error beside it.
 *   - `WireStepState.status` is what the STORE currently holds for the step. It exists for
 *     every step the run started, reaches further than the driver's outcomes, and is the one a
 *     later attempt or a rollback changes.
 * The view resolved them with `outcome?.status ?? state?.status ?? 'pending'` — a silent
 * preference for whichever happened to be present. That is how a run which had stopped
 * mid-execution still appeared to be working, and why nobody could say which status a screen
 * was showing without reading this file.
 *
 * THE RULE, stated so a reader can check a screen against it: the OUTCOME wins where it
 * exists, because it describes the attempt that ended; the store's state answers for a step
 * the driver never reached; and a step with neither was never reached at all. A disagreement
 * is reported through {@link ResolvedStepStatus.diverged} rather than hidden.
 *
 * @param outcome - the driver's record for the step, when it produced one.
 * @param state - the store's record for the step, when the run created one.
 * @returns the status to show, its source, and whether the two contradicted each other.
 */
export function resolveStepStatus(
  outcome: WireStepOutcome | undefined,
  state: WireStepState | undefined,
): ResolvedStepStatus {
  if (outcome !== undefined) {
    const status = asStepStatus(outcome.status)
    return {
      status,
      source: 'outcome',
      diverged: state !== undefined && asStepStatus(state.status) !== status,
    }
  }
  if (state !== undefined) return { status: asStepStatus(state.status), source: 'state', diverged: false }
  return { status: 'pending', source: 'unreached', diverged: false }
}

/**
 * The run-level status the header shows.
 *
 * Derived, not taken from the wire: a failure outranks an abstention, an abstention
 * outranks an unfinished step, and a step waiting for a PERSON outranks "done" — the run has
 * automatable work left only in the sense that someone has to look at it.
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
  // A gated step is not an unfinished one: the pipeline has stopped exactly where it is supposed
  // to and is waiting for a decision. Reporting that as `completed` told the reader the work was
  // over at the moment it needed them.
  if (steps.some(step => step.status === 'gated')) return 'awaiting-approval'
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
      // One named rule for the two things called `status`; see `resolveStepStatus`.
      status: resolveStepStatus(outcome, state).status,
      attempt: state?.attempt ?? outcome?.attemptId ?? 0,
      humanGate: entry.humanGate,
      // The view model only knows the two hold reasons the engine records.
      ...(holdReason === 'gate_abstained' || holdReason === 'human_gate' ? { holdReason } : {}),
      // Execution outcome and its cause, so a step that stopped mid-flight is not shown as
      // still working.
      ...(outcome?.executeStatus === undefined ? {} : { executeStatus: outcome.executeStatus }),
      ...(outcome?.executeError === undefined ? {} : { executeError: outcome.executeError }),
      // The wire has carried `kind` since the driver began recording it; the view read only
      // `fixture_executor` out of it, so a run whose prose came from the deterministic route was
      // shown as a live run with nothing to say about its text.
      ...(outcome?.kind === undefined ? {} : { executionKind: outcome.kind }),
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
        // NEVER coerced to a component. Defaulting to `A` displayed a verdict under a component it
        // was not about — the one coercion of the three that misattributes rather than under-reports.
        component: asComponent(component) ?? 'unknown',
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
    deliverables: deliverablesOf(snapshot),
    // Absent stays absent: a host that names no revision is reported as naming none, rather than as
    // revision 0, which is a revision a run genuinely starts at. The readiness facts follow the same
    // rule — an unstated readiness is not a failed one.
    ...(snapshot.projectRevision === undefined ? {} : { projectRevision: snapshot.projectRevision }),
    ...(snapshot.execution === undefined ? {} : { execution: snapshot.execution }),
    ...(snapshot.executionError === undefined ? {} : { executionError: snapshot.executionError }),
    // THE RUN'S DURABILITY IS READ OFF THE SAME RECORD THE HOST'S OWN PRECONDITIONS READ, and it is
    // carried as its own fact rather than left to the deliverables list: the page offers a save
    // retry on it, and a reader looking for a reason there would be reading a list of files.
    ...(typeof snapshot.runPersistence?.error === 'string' ? { saveFailure: snapshot.runPersistence.error } : {}),
    ...(typeof snapshot.evidenceProfile === 'string' ? { evidenceProfile: snapshot.evidenceProfile } : {}),
    ...(typeof snapshot.profileEligible === 'boolean' ? { profileEligible: snapshot.profileEligible } : {}),
    ...(typeof snapshot.submissionReady === 'boolean' ? { submissionReady: snapshot.submissionReady } : {}),
    ...(typeof snapshot.readinessNote === 'string' ? { readinessNote: snapshot.readinessNote } : {}),
  }
}

/**
 * What the run left on disk, from the snapshot's own records.
 *
 * The package and the snapshot are separate outputs with separate failures, so they are separate
 * entries: one can be written while the other is refused, and a single "exported" flag would hide
 * that.
 *
 * @param snapshot - the wire snapshot.
 * @returns one entry per output, in the order they are written.
 */
function deliverablesOf(snapshot: WireRunSnapshot): ReadonlyArray<DeliverableView> {
  const out: DeliverableView[] = []
  const pkg = snapshot.packageExport
  if (pkg !== null && pkg !== undefined) {
    out.push({
      kind: 'package',
      files: pkg.files.map(file => ({ path: file.path, bytes: file.bytes })),
      revision: null,
      ...(pkg.error === undefined ? {} : { error: pkg.error }),
      ...(pkg.directory === undefined ? {} : { directory: pkg.directory }),
    })
  }
  const stored = snapshot.runPersistence
  if (stored !== null && stored !== undefined) {
    out.push({
      kind: 'snapshot',
      files: [],
      revision: stored.revision,
      ...(stored.error === undefined ? {} : { error: stored.error }),
      ...(stored.directory === undefined ? {} : { directory: stored.directory }),
    })
  }
  return out
}
