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
import type { RunContext, StepExecutorFn, Truthfulness } from './registry.ts'

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
}

/** Options for driving exactly one step. */
export interface DriveStepOptions {
  readonly runCtx: RunContext
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  readonly executorOverride?: (stepId: string) => StepExecutorFn | undefined
  readonly abstainComponents?: (stepId: string) => ReadonlyArray<TrinityComponent>
}

/** Context needed to build the gate verdicts for one step attempt. */
export interface VerdictBuildCtx {
  readonly step: StepDefinition
  readonly attemptId: number
  readonly runCtx: RunContext
  /** Components that should be injected as `abstained` (recovery scenario). */
  readonly abstain: ReadonlySet<TrinityComponent>
}
