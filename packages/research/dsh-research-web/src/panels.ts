/**
 * Pure, React-free derivations for the T27–T29 research workbench panels.
 *
 * Every selector takes the same flattened {@link RunSummary} the T26 summary view
 * consumes and returns a presentation-ready slice for one sub-panel. Keeping these
 * here (no React, no `@deepseek-ai/*` runtime imports) means the panel data
 * contracts are unit-testable in isolation and the browser bundle stays pure,
 * matching the T26 model convention.
 */
import type {
  AbstentionRecord, ArtifactView, GateHistoryEntry, Phase, RunSummary, StepView,
  TrinityComponent,
} from './summary.ts'

/** Coarse artifact category the Figures/Tables panels group by. */
export type ArtifactKind = 'figure' | 'table' | 'other'

/** Canonical phase order for roadmap/pipeline projection (A → E). */
export const PHASE_ORDER: readonly Phase[] = ['A', 'B', 'C', 'D', 'E']

/**
 * Classify an artifact into a coarse kind for the Figures/Tables panels.
 * Heuristic on the slug + summary text only — the fixture/model carries no
 * explicit kind, so this keeps the split deterministic and mock-honest.
 * @param artifact - the artifact row to classify.
 * @returns `'figure'` | `'table'` | `'other'`.
 */
export function classifyArtifact(artifact: ArtifactView): ArtifactKind {
  const hay = `${artifact.slug} ${artifact.summary}`.toLowerCase()
  if (hay.includes('figure') || hay.includes('-fig') || hay.includes('chart')) {
    return 'figure'
  }
  if (hay.includes('table') || hay.includes('tabulation')) {
    return 'table'
  }
  return 'other'
}

/** One phase-grouped pipeline slice consumed by the Pipeline panel. */
export interface PipelinePhaseSlice {
  readonly phase: Phase
  readonly steps: ReadonlyArray<StepView>
}

/**
 * Project the run's steps as a phase-grouped pipeline in canonical A→E order.
 * Steps with no steps in a phase are omitted (the panel shows its empty state
 * only when the whole run has no steps).
 * @param summary - the flattened run summary.
 * @returns phase-grouped step rows in canonical order.
 */
export function selectPipeline(summary: RunSummary): ReadonlyArray<PipelinePhaseSlice> {
  return PHASE_ORDER
    .map(phase => ({
      phase,
      steps: summary.steps.filter(step => step.phase === phase),
    }))
    .filter(slice => slice.steps.length > 0)
}

/** One phase rollup row consumed by the Roadmap panel. */
export interface RoadmapPhaseSlice {
  readonly phase: Phase
  readonly passed: number
  readonly failed: number
  readonly gated: number
  readonly blocked: number
  readonly total: number
}

/**
 * Roll the run's steps up per phase (A→E). The Roadmap panel renders one cell
 * per phase with the four status buckets it labels; `total` backs the per-phase
 * summary line.
 * @param summary - the flattened run summary.
 * @returns one rollup row per canonical phase.
 */
export function selectRoadmap(summary: RunSummary): ReadonlyArray<RoadmapPhaseSlice> {
  return PHASE_ORDER.map((phase) => {
    const steps = summary.steps.filter(step => step.phase === phase)
    return {
      phase,
      passed: steps.filter(step => step.status === 'passed').length,
      failed: steps.filter(step => step.status === 'failed').length,
      gated: steps.filter(step => step.status === 'gated').length,
      blocked: steps.filter(step => step.status === 'blocked').length,
      total: steps.length,
    }
  })
}

/** The adversarial slice consumed by the red-team panel. */
export interface AdversarialSlice {
  /** Steps whose judgment touches trinity component A (adversarial). */
  readonly steps: ReadonlyArray<{
    readonly stepId: string
    readonly index: number
    readonly name: string
    readonly status: StepView['status']
  }>
  /** Component-A gate verdicts recorded on the run. */
  readonly gates: ReadonlyArray<{
    readonly stepId: string
    readonly component: TrinityComponent
    readonly outcome: GateHistoryEntry['outcome']
    readonly rationale: string
  }>
  /** Artifacts produced by the adversarial-touched steps. */
  readonly artifacts: ReadonlyArray<{
    readonly slug: string
    readonly summary: string
  }>
  /** Component-A gate-abstention freeze records. */
  readonly abstentions: ReadonlyArray<AbstentionRecord>
}

/**
 * Everything touching judgement component A (the adversarial red team): the
 * steps whose gate history includes an A verdict, the A verdicts themselves,
 * the artifacts those steps produced, and any A-abstention freezes. Never
 * silently collapses an abstention into a failure — the panel shows each freeze.
 * @param summary - the flattened run summary.
 * @returns the focused adversarial review slice.
 */
export function selectAdversarial(summary: RunSummary): AdversarialSlice {
  const adversarialStepIds = new Set(
    summary.steps
      .filter(step => step.gateOutcomes.some(outcome => outcome.component === 'A'))
      .map(step => step.stepId),
  )
  return {
    steps: summary.steps
      .filter(step => adversarialStepIds.has(step.stepId))
      .map(step => ({
        stepId: step.stepId,
        index: step.index,
        name: step.name,
        status: step.status,
      })),
    gates: summary.gates
      .filter(gate => gate.component === 'A')
      .map(gate => ({
        stepId: gate.stepId,
        component: gate.component,
        outcome: gate.outcome,
        rationale: gate.rationale,
      })),
    artifacts: summary.artifacts
      .filter(artifact => adversarialStepIds.has(artifact.producerStepId))
      .map(artifact => ({ slug: artifact.slug, summary: artifact.summary })),
    abstentions: summary.abstentions.filter(record => record.component === 'A'),
  }
}

/**
 * Select the run's artifacts of one coarse kind (figure or table), mock-sorted
 * by slug for a stable presentation order. Invalidated rows are kept (the panel
 * renders them struck-through) so rollback state stays visible.
 * @param summary - the flattened run summary.
 * @param kind - the coarse artifact kind to present.
 * @returns the matching artifact rows.
 */
export function selectArtifacts(
  summary: RunSummary,
  kind: ArtifactKind,
): ReadonlyArray<ArtifactView> {
  return summary.artifacts
    .filter(artifact => classifyArtifact(artifact) === kind)
    .sort((a, b) => a.slug.localeCompare(b.slug))
}

/** The recovery snapshot slice consumed by the Recovery panel. */
export interface RecoverySlice {
  readonly runId: string
  readonly status: RunSummary['status']
  readonly totalSteps: number
  readonly artifactCount: number
  readonly validArtifactCount: number
  readonly hasAbstention: boolean
  readonly hasDegradation: boolean
}

/**
 * Describe the run snapshot for the recovery panel: the identifiers the panel
 * shows plus the robustness flags (abstention freeze, degradation) that decide
 * the mock restore notes. Reads whatever `RunSummary` it is given so a
 * local-only "restore" swap re-derives immediately.
 * @param summary - the flattened run summary (current or restored mock).
 * @returns the snapshot descriptor slice.
 */
export function selectRecovery(summary: RunSummary): RecoverySlice {
  return {
    runId: summary.runId,
    status: summary.status,
    totalSteps: summary.totalSteps,
    artifactCount: summary.artifactCount,
    validArtifactCount: summary.validArtifactCount,
    hasAbstention: summary.hasAbstention,
    hasDegradation: summary.hasDegradation,
  }
}
