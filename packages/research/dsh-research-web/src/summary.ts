/**
 * Pure research-run summary view-model.
 *
 * This module is intentionally dependency-free (no React, no `@deepseek-ai/*`
 * runtime imports) so the fixture → view-model transformation can be unit-tested
 * in isolation and so the browser bundle never value-imports a cross-plugin
 * package (the client-bundle purity gate stays green).
 *
 * The shape mirrors the `dsh-research-core` engine's {@link RunSnapshot} /
 * audit-event model (16 steps, trinity-component gate verdicts with an
 * `abstained` outcome, artifact registry, gate-abstention records) but is
 * flattened into a presentation-ready model the {@link ResearchView} renders
 * directly. A snapshot produced by the T19-B runner (or any future producer)
 * can be mapped into {@link RunSummaryInput} by an adapter living outside this
 * package; this package only consumes the flattened input + a fixture loader.
 */

/** Methodology phase (the research 16-step pipeline phases A–E). */
export type Phase = 'A' | 'B' | 'C' | 'D' | 'E'

/** Judgment trinity component (A adversarial, B external anchor, C falsifiable). */
export type TrinityComponent = 'A' | 'B' | 'C'

/** Runtime status of one step instance. */
export type StepStatus =
  | 'pending'
  | 'in_progress'
  | 'gated'
  | 'passed'
  | 'blocked'
  | 'failed'

/** Explicit gate outcome — the single source of truth for a component verdict. */
export type GateOutcome = 'passed' | 'blocked' | 'failed' | 'abstained'

/** Top-level run status surfaced in the view header. */
export type RunStatus =
  | 'running'
  | 'completed'
  | 'abstained'
  | 'failed'
  | 'degraded'

/** Reason a `gated` step is held. */
export type HoldReason = 'human_gate' | 'gate_abstained'

/** One step's flattened presentation row. */
export interface StepView {
  readonly stepId: string
  readonly index: number
  readonly phase: Phase
  readonly name: string
  /** Runtime status of the step. */
  readonly status: StepStatus
  /** Current attempt number (1-based; 0 when never started). */
  readonly attempt: number
  /** Whether this step gates on a human approval (human-in-the-loop). */
  readonly humanGate: boolean
  /** Present only when `status === 'gated'`. */
  readonly holdReason?: HoldReason
  /** Per-component gate outcomes recorded for this step. */
  readonly gateOutcomes: ReadonlyArray<{
    readonly component: TrinityComponent
    readonly outcome: GateOutcome
  }>
}

/** One produced artifact's presentation row. */
export interface ArtifactView {
  readonly slug: string
  readonly producerStepId: string
  readonly producerAttemptId: number
  /** Epoch millis when the artifact was produced. */
  readonly producedAt: number
  /** True when rolled back / cascade-invalidated. */
  readonly invalidated: boolean
  /** Short human-readable summary of the artifact content. */
  readonly summary: string
}

/** One gate-verdict history entry. */
export interface GateHistoryEntry {
  readonly stepId: string
  readonly component: TrinityComponent
  readonly outcome: GateOutcome
  readonly passed: boolean
  readonly evidence: string
  readonly rationale: string
  /** Epoch millis. */
  readonly timestamp: number
}

/** One gate-abstention freeze record (never silently collapsed to failed). */
export interface AbstentionRecord {
  readonly runId: string
  readonly stepId: string
  readonly attemptId: number
  readonly component: TrinityComponent
  readonly reasonCode: string
  readonly evidenceRefs: ReadonlyArray<string>
  /** ISO-8601 timestamp. */
  readonly recordedAt: string
}

/** A quality/robustness degradation annotation attached to the run or a step. */
export interface DegradationNote {
  /** Step the note attaches to; omitted for a run-level note. */
  readonly stepId?: string
  readonly kind: 'quality' | 'timeout' | 'fallback' | 'coverage'
  readonly message: string
}

/** Flattened input the view consumes. A T19-B runner snapshot maps into this. */
export interface RunSummaryInput {
  readonly runId: string
  readonly status: RunStatus
  readonly steps: ReadonlyArray<StepView>
  readonly artifacts: ReadonlyArray<ArtifactView>
  readonly gates: ReadonlyArray<GateHistoryEntry>
  readonly abstentions: ReadonlyArray<AbstentionRecord>
  readonly degradations: ReadonlyArray<DegradationNote>
}

/** Derived + raw presentation model handed to the view. */
export interface RunSummary {
  readonly runId: string
  readonly status: RunStatus
  readonly steps: ReadonlyArray<StepView>
  readonly artifacts: ReadonlyArray<ArtifactView>
  readonly gates: ReadonlyArray<GateHistoryEntry>
  readonly abstentions: ReadonlyArray<AbstentionRecord>
  readonly degradations: ReadonlyArray<DegradationNote>
  /** Total step count (expected 16 for a full run). */
  readonly totalSteps: number
  /** Step count indexed by status. */
  readonly byStatus: Readonly<Record<StepStatus, number>>
  /** Total artifact registry entries. */
  readonly artifactCount: number
  /** Artifacts not invalidated. */
  readonly validArtifactCount: number
  /**
   * Steps flagged `humanGate` that are not yet resolved to passed/failed/blocked
   * — i.e. awaiting a human decision and therefore NOT auto-completed. The E2
   * human-pending prompt is built from this list.
   */
  readonly humanPending: ReadonlyArray<StepView>
  /** Whether any gate-abstention freeze was recorded. */
  readonly hasAbstention: boolean
  /** Whether any degradation annotation exists. */
  readonly hasDegradation: boolean
  /** Always true: this package renders fixture/snapshot data, never live runs. */
  readonly isMock: true
}

const EMPTY_BY_STATUS: Record<StepStatus, number> = {
  pending: 0,
  in_progress: 0,
  gated: 0,
  passed: 0,
  blocked: 0,
  failed: 0,
}

/**
 * Fold a {@link RunSummaryInput} into the derived {@link RunSummary} the view
 * renders. Pure: no I/O, no React, no clock — same input yields the same model.
 *
 * @param input - flattened run data (fixture or mapped snapshot).
 * @returns the presentation model with all derived counters and the
 *   human-pending list computed.
 */
export function toRunSummary(input: RunSummaryInput): RunSummary {
  const byStatus: Record<StepStatus, number> = { ...EMPTY_BY_STATUS }
  for (const step of input.steps) byStatus[step.status] += 1

  let validArtifactCount = 0
  for (const artifact of input.artifacts) {
    if (!artifact.invalidated) validArtifactCount += 1
  }

  const humanPending = input.steps.filter(
    step => step.humanGate
      && step.status !== 'passed'
      && step.status !== 'failed'
      && step.status !== 'blocked',
  )

  return {
    runId: input.runId,
    status: input.status,
    steps: input.steps,
    artifacts: input.artifacts,
    gates: input.gates,
    abstentions: input.abstentions,
    degradations: input.degradations,
    totalSteps: input.steps.length,
    byStatus,
    artifactCount: input.artifacts.length,
    validArtifactCount,
    humanPending,
    hasAbstention: input.abstentions.length > 0,
    hasDegradation: input.degradations.length > 0,
    isMock: true,
  }
}
