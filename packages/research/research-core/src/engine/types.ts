/**
 * Pure-logic type model for the 16-step research engine.
 *
 * No Cordis imports here — the engine is portable and unit-testable in isolation.
 * Ported into @deepseek-ai/dsh-research-core (wrapped with the Cordis plugin
 * three-piece: name / inject / Config / apply + service declaration) at P1.6.
 */

/** Methodology phase (v1.0 design doc). */
export type Phase = 'A' | 'B' | 'C' | 'D' | 'E'

/**
 * Judgment trinity component.
 *
 * - A = adversarial convergence: red-team refute + judge vote ≥ 2 to keep a claim.
 * - B = external anchoring: cross-check against real literature / SOTA / venue acceptance patterns.
 * - C = falsifiable → experiment verdict: turn a soft judgment into a falsifiable prediction, let experiment results adjudicate.
 *
 * A step's `gate` lists which components must pass before the step may exit.
 */
export type TrinityComponent = 'A' | 'B' | 'C'

/** Static definition of one of the 16 steps. */
export interface StepDefinition {
  /** Stable slug, e.g. 'A1-landscape'. */
  readonly id: string
  /** 1-based ordinal. */
  readonly index: number
  /** Methodology phase. */
  readonly phase: Phase
  /** Human label (zh). */
  readonly name: string
  /** What this step produces. */
  readonly purpose: string
  /** Artifact slugs consumed (dependencies on prior step outputs). */
  readonly inputs: readonly string[]
  /** Artifact slugs produced. */
  readonly outputs: readonly string[]
  /** Trinity components that must pass before the step may exit. */
  readonly gate: readonly TrinityComponent[]
  /**
   * The falsifiable prediction this step must yield (drives trinity C), or null
   * when the step is not itself a prediction-producing step.
   */
  readonly falsifiable: string | null
  /** Whether exiting this step requires human approval (only E2-submit). */
  readonly humanGate: boolean
}

/** Runtime status of one step instance. */
export type StepStatus = 'pending' | 'in_progress' | 'gated' | 'passed' | 'blocked' | 'failed'

/** Verdict of one trinity component gate for one step. */
export interface GateVerdict {
  readonly component: TrinityComponent
  readonly passed: boolean
  /** Evidence: citations / experiment results / red-team vote tally. */
  readonly evidence: string
  readonly rationale: string
  readonly timestamp: number
}

/** Mutable runtime state of one step instance. */
export interface StepState {
  readonly stepId: string
  status: StepStatus
  attempts: number
  /** Produced artifact refs keyed by output slug. */
  artifacts: Record<string, unknown>
  /** Gate verdicts keyed by trinity component. */
  gateResults: Partial<Record<TrinityComponent, GateVerdict>>
  startedAt: number | undefined
  finishedAt: number | undefined
}
