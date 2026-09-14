// @deepseek-ai/dsh-research-team — T19-B shared run/drive result types.
//
// Single source of the runner's shared shapes. `drive.ts` (the driver),
// `verdict.ts` (gate-verdict construction) and `report.ts` (reporting) all import
// from here and never re-declare them, so a field can never drift between the
// driver's output and the report's input.

import type {
  GateOutcome,
  RunStepStatus,
  StepDefinition,
  StepStatus,
  TrinityComponent,
} from '@deepseek-ai/dsh-research-core'
import type { ResearchToolInvoker, ResearchToolDeps } from '@deepseek-ai/dsh-research-tools'
import type { CasePackRunInput } from './case-pack.ts'
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
  /** Core `runStep` outcome of the execute phase. Absent when no executor ran (E2). */
  readonly executeStatus?: RunStepStatus
  readonly executeError?: string
}

/** Full-run result. */
export interface RunResult {
  readonly runId: string
  readonly steps: ReadonlyArray<StepOutcome>
}

/** Per-step override / scenario hooks for the driver. */
export interface DriveOptions {
  readonly domainDirection?: string
  /** Overrides the per-step `timeoutMs` declared in the registry (fault injection). */
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
}

/** Context needed to build the gate verdicts for one step attempt. */
export interface VerdictBuildCtx {
  readonly step: StepDefinition
  readonly attemptId: number
  readonly runCtx: RunContext
  /** Components that should be injected as `abstained` (recovery scenario). */
  readonly abstain: ReadonlySet<TrinityComponent>
}
