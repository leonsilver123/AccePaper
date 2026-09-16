// @deepseek-ai/dsh-research-team — T19-B shared run/drive result types.
//
// Single source of the runner's shared shapes. `drive.ts` (the driver),
// `verdict.ts` (gate-verdict construction) and `report.ts` (reporting) all import
// from here and never re-declare them, so a field can never drift between the
// driver's output and the report's input.

import type {
  CommitReceipt,
  EvidenceProfile,
  GateOutcome,
  RunStepStatus,
  StepDefinition,
  StepStatus,
  TrinityComponent,
} from '@deepseek-ai/dsh-research-core'
import type { ResearchToolInvoker, ResearchToolDeps } from '@deepseek-ai/dsh-research-tools'
import type { CasePackRunInput } from './case-pack.ts'
import type { StudyPlan } from './study-plan.ts'
import type { ResearchProseWriter, RunContext, StepExecutorFn, Truthfulness } from './registry.ts'

/** Per-artifact producer evidence for one step. */
export interface StepArtifactEvidence {
  readonly slug: string
  readonly producedBy: string
}

/** Outcome of driving one step (auditable; includes producer/kind evidence). */
export interface StepOutcome {
  readonly stepId: string
  readonly status: StepStatus
  readonly attemptId: number
  /** Truthfulness of the executor that ran, or 'humanGate' when none ran (E2). */
  readonly kind: Truthfulness | 'humanGate'
  readonly producer: string
  readonly outputSlugs: ReadonlyArray<string>
  readonly artifacts: ReadonlyArray<StepArtifactEvidence>
  readonly verdicts: Readonly<Record<string, GateOutcome>>
  /** True iff the executor was `real_tool_fixture_input` (a real tool function ran). */
  readonly usedRealTool: boolean
  /**
   * The input slugs the executor asked for, in the order it asked, as observed while it ran.
   *
   * Recorded rather than declared. A step's definition lists the edges the engine uses to decide
   * when it may run and what a rollback invalidates; an executor that reads something else takes a
   * dependency the engine cannot see, and re-declaring the same list by hand would repeat whatever
   * mistake the definition made. This is what a run actually did.
   */
  readonly readSlugs: ReadonlyArray<string>
  /** Core `runStep` outcome of the execute phase. Absent when no executor ran (E2). */
  readonly executeStatus?: RunStepStatus
  readonly executeError?: string
}

/** Full-run result. */
export interface RunResult {
  readonly runId: string
  readonly steps: ReadonlyArray<StepOutcome>
  /**
   * Failures of the per-step checkpoint, in the order they happened.
   *
   * A checkpoint that fails is REPORTED rather than thrown: the step it followed has already
   * committed and the run can continue, so stopping it would trade real work for a durability
   * warning. What must not happen is the failure going unsaid — a run whose intermediate state was
   * never written looks exactly like one that was, until the process dies.
   */
  readonly checkpointErrors?: ReadonlyArray<string>
}

/** Per-step override / scenario hooks for the driver. */
export interface DriveOptions {
  readonly domainDirection?: string
  /**
   * The research this run carries. When absent, the default plan is used, with
   * {@link DriveOptions.domainDirection} replacing its direction.
   */
  readonly studyPlan?: StudyPlan
  /**
   * Milliseconds one step may run, overriding the per-step value the registry declares.
   *
   * The registry value fits the offline channels, which answer in milliseconds; a deployment
   * that configures a model route sets this, because the same step then takes seconds and a
   * step that overruns is recorded `timeout` rather than as a failure with a cause.
   */
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  /** Override the executor for selected steps (recovery / fault injection). */
  readonly executorOverride?: (stepId: string) => StepExecutorFn | undefined
  /** Inject `abstained` for the given components of the given step (recovery hold). */
  readonly abstainComponents?: (stepId: string) => ReadonlyArray<TrinityComponent>
  readonly fixedTimestamp?: number
  /** Stop BEFORE driving this step (returns after its predecessors). */
  readonly stopBefore?: string
  /**
   * Tool invoker handed to every capability executor. When absent, executors fall
   * back to `DirectResearchToolInvoker` (truthfulness `direct_call`); when present,
   * the caller chooses the channel — e.g. an agent-loop-backed invoker registered by
   * the Cordis adapter — and each artifact records that channel's provenance.
   */
  readonly invoker?: ResearchToolInvoker
  /**
   * Real-model prose writer handed to narrative steps (D2 outline / D3 writing /
   * D4 rebuttal). When absent those steps emit the built-in fixture text.
   */
  readonly proseWriter?: ResearchProseWriter
  /**
   * Tool dependencies for capability steps; assembled by the Cordis adapter from
   * its retrieval-channel config. When absent, steps use the fixture deps.
   */
  readonly toolDeps?: ResearchToolDeps
  /**
   * Run inputs derived from a selected Case Pack, seeded before the first step starts.
   * Inputs freeze once a run is under way, so a pack arriving later cannot be applied to
   * a run in progress. Each entry carries the file and pointer it was derived from.
   */
  readonly casePackInputs?: ReadonlyArray<CasePackRunInput>
  /**
   * What this run declares about its own evidence. A run that declares nothing is the
   * evaluation run: it executes, and its entire output is stamped unsubmittable.
   * `production` is reached only by declaring it, and it refuses synthetic evidence —
   * a fixture anchor holds the gate rather than being replaced by something that passes.
   */
  readonly evidenceProfile?: EvidenceProfile
  /**
   * Called after each step that reached a terminal outcome, so a driver can persist the run's
   * state as it goes instead of only once at the end. A run that saved only when it finished lost
   * every step it had completed when the process died — including the ones that cost model calls.
   *
   * A throw is collected into {@link RunResult.checkpointErrors} and the run continues; see that
   * field for why.
   */
  readonly checkpointAfterStep?: (runId: string, outcome: StepOutcome) => Promise<void> | void
}

/** Options for driving exactly one step. */
export interface DriveStepOptions {
  readonly runCtx: RunContext
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  readonly executorOverride?: (stepId: string) => StepExecutorFn | undefined
  readonly abstainComponents?: (stepId: string) => ReadonlyArray<TrinityComponent>
  /** Tool invoker for capability executors; see {@link DriveOptions.invoker}. */
  readonly invoker?: ResearchToolInvoker
  /** Real-model prose writer; see {@link DriveOptions.proseWriter}. */
  readonly proseWriter?: ResearchProseWriter
  /** Tool deps for capability steps; see {@link DriveOptions.toolDeps}. */
  readonly toolDeps?: ResearchToolDeps
  /**
   * The profile this run declares, carried so the gate verdicts are built under the same one the
   * driver was given; see {@link DriveOptions.evidenceProfile}.
   */
  readonly evidenceProfile?: EvidenceProfile
}

/** Context needed to build the gate verdicts for one step attempt. */
export interface VerdictBuildCtx {
  readonly step: StepDefinition
  readonly attemptId: number
  /**
   * What this attempt committed, which is what its verdicts are built AGAINST.
   *
   * The verdicts are stamped with the receipt's artifact revisions and input digest as they are
   * built, so the gate can refuse a verdict whose targets are not the revisions the attempt
   * wrote. Handing the gate a verdict without them is refused (`DSH_GATE_UNBOUND_VERDICT`), and
   * stamping them at submit time instead is exactly the defect this carries the receipt to avoid.
   */
  readonly commit: CommitReceipt
  readonly runCtx: RunContext
  /** Components that should be injected as `abstained` (recovery scenario). */
  readonly abstain: ReadonlySet<TrinityComponent>
  /**
   * The profile the run declares, already resolved by the driver — a channel that consumes
   * external evidence decides what it may use from this, so the B channel needs it here
   * rather than inferring a profile of its own.
   */
  readonly evidenceProfile: EvidenceProfile
}
