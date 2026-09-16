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
/** Research phase. `'unknown'` reports a phase this build cannot name rather than defaulting. */
export type Phase = 'A' | 'B' | 'C' | 'D' | 'E' | 'unknown'

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
  /**
   * A status this build does not know.
   *
   * The mapping used to DEFAULT an unrecognised status to `pending`, which reported a step the
   * Host had advanced as 未开始 and folded it into a real bucket in the counts. A value the view
   * cannot name is reported as one, and `unknown` is its own bucket so nothing absorbs it.
   */
  | 'unknown'

/** Explicit gate outcome — the single source of truth for a component verdict. */
export type GateOutcome = 'passed' | 'blocked' | 'failed' | 'abstained'

/** Top-level run status surfaced in the view header. */
export type RunStatus =
  | 'running'
  /**
   * Every automatable step closed and a human gate is open.
   *
   * Its own status because it is its own thing to do: the run has NOT finished, and the reader has
   * a decision to make. Reporting it as `completed` told them the work was over while the pipeline
   * was waiting for them — and a header that says "completed" over a pending gate is the promise
   * this type exists to stop making.
   */
  | 'awaiting-approval'
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
  /**
   * The step's execution outcome, and the reason when it did not succeed.
   *
   * A step that failed mid-execution stays `in_progress` in the state machine — it is
   * rollback-able — while the outcome records that it errored. Without this the view reported the
   * run as still working and named no cause, which is the one thing a person waiting on it needs.
   */
  readonly executeStatus?: string
  readonly executeError?: string
  /** Per-component gate outcomes recorded for this step. */
  readonly gateOutcomes: ReadonlyArray<{
    readonly component: TrinityComponent
    readonly outcome: GateOutcome
  }>
  /**
   * How the run recorded this step's product being produced, e.g. `live_external`, `mock_external`,
   * `fixture_executor`.
   *
   * The view needs it to say WHERE a run's text came from. A run whose drafting steps used the
   * deployment's deterministic offline route produces demo prose, and a reader who is not told that
   * has to find it in the manuscript's own notice.
   */
  readonly executionKind?: string
}

/**
 * Which channel produced a run's manuscript prose, from the run's own per-step records.
 *
 * `model` — the deployment configured a model route and that route produced the text;
 * `deterministic` — the deployment's deterministic offline route, which calls no model;
 * `fixture` — the built-in sentences, with no prose channel running at all;
 * `unknown` — the run recorded none of the manuscript's prose steps, so this build cannot say.
 */
export type ProseChannel = 'model' | 'deterministic' | 'fixture' | 'unknown'

/**
 * The steps whose artifact is the manuscript's own narrative text.
 *
 * A deployment configures ONE prose route, and these are the steps whose product a reader of the
 * paper reads as prose. A1-landscape, A3-agenda, A4-venue and B1-method also write prose, but theirs
 * is evidence for the claim rather than manuscript text, so they are not what a reader is being told
 * about here.
 */
const MANUSCRIPT_PROSE_STEP_IDS: ReadonlyArray<string> = ['D2-framework', 'D3-writing', 'D4-rebuttal']

/**
 * The channel a run's manuscript prose came from, read from the steps that produced it.
 *
 * A `live_external` step outranks the others: one real model call is what makes the text not a demo.
 * A run that reached none of these steps reports `unknown` rather than a channel it never used.
 *
 * @param steps - the run's flattened step rows.
 * @returns the channel, or `unknown` when no manuscript prose step ran.
 */
export function proseChannelOf(steps: ReadonlyArray<StepView>): ProseChannel {
  const kinds = new Set(
    steps
      .filter(step => MANUSCRIPT_PROSE_STEP_IDS.includes(step.stepId))
      .map(step => step.executionKind),
  )
  if (kinds.has('live_external')) return 'model'
  if (kinds.has('mock_external')) return 'deterministic'
  if (kinds.has('fixture_executor')) return 'fixture'
  return 'unknown'
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
  /** The component that abstained; `'unknown'` when this build cannot name it — never coerced. */
  readonly component: TrinityComponent | 'unknown'
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
  /**
   * The project revision the host read this run at, when it names one.
   *
   * The same value the exported package's manifest carries, so a reader can tell whether the page
   * and the download describe the same state of the study.
   */
  readonly projectRevision?: number
  /** The deployment's evidence profile (`production` / `evaluation`), when the host names one. */
  readonly evidenceProfile?: string
  /** Whether that profile may ever carry a submission. A fact about the DEPLOYMENT. */
  readonly profileEligible?: boolean
  /** Whether THIS run's material is complete and its gates all closed. A fact about the RUN. */
  readonly submissionReady?: boolean
  /** Why the run is not ready, in the host's own words. */
  readonly readinessNote?: string
  /**
   * Where this summary came from.
   *
   * The view used to render a MOCK badge unconditionally, and the model declared
   * `isMock: true` as a literal — so the badge kept saying MOCK even after the
   * `summary` injection seam let a caller pass a real run in. The source is now part
   * of the input and the badge follows it.
   */
  readonly source: 'fixture' | 'live'
  readonly status: RunStatus
  readonly steps: ReadonlyArray<StepView>
  readonly artifacts: ReadonlyArray<ArtifactView>
  readonly gates: ReadonlyArray<GateHistoryEntry>
  readonly abstentions: ReadonlyArray<AbstentionRecord>
  readonly degradations: ReadonlyArray<DegradationNote>
  /**
   * What the run left on disk, as the Host reported it.
   *
   * A run writes a reproducible package and a durable snapshot; until this existed the view
   * received both and rendered neither, so a person who asked "where did it put my files" had no
   * answer in the product. Each entry is data — the label is resolved by the view's locale.
   */
  readonly deliverables: ReadonlyArray<DeliverableView>
}

/** One thing a run produced on disk, or failed to. */
export interface DeliverableView {
  /** Which output this describes; the view resolves the label from its locale. */
  readonly kind: 'package' | 'snapshot'
  /** Present when the output was written. */
  readonly files: ReadonlyArray<{ readonly path: string; readonly bytes: number }>
  /** The revision the snapshot was written at, when there is one. */
  readonly revision: number | null
  /** Set when the write was refused or failed; `files` is then empty and `revision` null. */
  readonly error?: string
  /** The directory the output was written to, so the reader can go and look. */
  readonly directory?: string
}

/** Derived + raw presentation model handed to the view. */
export interface RunSummary {
  readonly runId: string
  /** The project revision this summary describes; null when the host named none. */
  readonly projectRevision: number | null
  /**
   * The four readiness facts, kept apart on purpose.
   *
   * `evidenceProfile` is which mode the deployment runs in; `profileEligible` is what that mode may
   * EVER carry; `submissionReady` is what THIS run produced; `readinessNote` is why, when it is not
   * ready. Collapsing any two of them is how a demonstration reads as a submission — the failure
   * the readiness split was made for, at the layer where a reader actually sees it.
   *
   * `null` means the host named none, which is not `false`: a run whose readiness is unknown must
   * not be rendered as one that was checked and failed.
   */
  readonly evidenceProfile: string | null
  readonly profileEligible: boolean | null
  readonly submissionReady: boolean | null
  readonly readinessNote: string | null
  readonly status: RunStatus
  readonly steps: ReadonlyArray<StepView>
  readonly artifacts: ReadonlyArray<ArtifactView>
  readonly gates: ReadonlyArray<GateHistoryEntry>
  readonly abstentions: ReadonlyArray<AbstentionRecord>
  readonly degradations: ReadonlyArray<DegradationNote>
  /** What the run left on disk; see {@link RunSummaryInput.deliverables}. */
  readonly deliverables: ReadonlyArray<DeliverableView>
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
  /** True when this summary came from the bundled fixture rather than a real run. */
  readonly isMock: boolean
  /** Which channel produced the manuscript prose; see {@link proseChannelOf}. */
  readonly proseChannel: ProseChannel
}

const EMPTY_BY_STATUS: Record<StepStatus, number> = {
  pending: 0,
  in_progress: 0,
  gated: 0,
  passed: 0,
  blocked: 0,
  failed: 0,
  unknown: 0,
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
    // Absent stays null: a host that named no revision is reported as having named none.
    projectRevision: input.projectRevision ?? null,
    evidenceProfile: input.evidenceProfile ?? null,
    profileEligible: input.profileEligible ?? null,
    submissionReady: input.submissionReady ?? null,
    readinessNote: input.readinessNote ?? null,
    status: input.status,
    steps: input.steps,
    artifacts: input.artifacts,
    gates: input.gates,
    abstentions: input.abstentions,
    degradations: input.degradations,
    deliverables: input.deliverables,
    totalSteps: input.steps.length,
    byStatus,
    artifactCount: input.artifacts.length,
    validArtifactCount,
    humanPending,
    hasAbstention: input.abstentions.length > 0,
    hasDegradation: input.degradations.length > 0,
    isMock: input.source === 'fixture',
    proseChannel: proseChannelOf(input.steps),
  }
}
