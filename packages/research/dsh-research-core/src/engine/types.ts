/**
 * Pure-logic type model for the 16-step research engine (v2 hardened contract).
 *
 * v2 changes vs the T05/T06 baseline (driven by the 6-critic design review):
 *  - run-keyed isolation: state lives in a {@link ResearchRunStore} keyed by runId,
 *    not a single shared StepStore (P1-5);
 *  - artifact registry: a run-level slug→{@link ArtifactRecord} map recording the
 *    producer step + attempt, so canStart can require an upstream `passed` (P1-1)
 *    and rollback can cascade-invalidate dependents (P1-7);
 *  - audit event log: every mutator appends an {@link AuditEvent} (C-1);
 *  - no `actor` string: human identity is a {@link TrustedHumanPrincipal} minted by
 *    the host trust channel (`./host` subpath), never caller-supplied (P0-1);
 *  - readonly snapshots: public returns are deep-cloned read-only views, never live
 *    internal refs (P0-2 / P1-8); caller-supplied values are deep-cloned at write
 *    time too (INV-WRITE-ISOLATION).
 *
 * No Cordis imports here — the engine is portable and unit-testable in isolation.
 * The Cordis adapter wraps it at P1.6; the host trust channel wraps approval at the
 * `./host` subpath.
 */

/** Methodology phase (v1.0 design doc). */
export type Phase = 'A' | 'B' | 'C' | 'D' | 'E'

/**
 * Judgment trinity component.
 *  A = adversarial convergence  (red-team refute + judge vote ≥ 2)
 *  B = external anchoring       (vs real literature / SOTA / venue acceptance)
 *  C = falsifiable → experiment verdict (soft judgment → falsifiable prediction → experiment adjudicates)
 */
export type TrinityComponent = 'A' | 'B' | 'C'

/** Static definition of one of the 16 steps. */
export interface StepDefinition {
  readonly id: string
  readonly index: number
  readonly phase: Phase
  readonly name: string
  readonly purpose: string
  readonly inputs: readonly string[]
  readonly outputs: readonly string[]
  readonly gate: readonly TrinityComponent[]
  readonly falsifiable: string | null
  readonly humanGate: boolean
}

/** Runtime status of one step instance. */
export type StepStatus = 'pending' | 'in_progress' | 'gated' | 'passed' | 'blocked' | 'failed'

/** Verdict of one trinity-component gate for one step. */
export interface GateVerdict {
  readonly component: TrinityComponent
  readonly passed: boolean
  readonly evidence: string
  readonly rationale: string
  readonly timestamp: number
}

/**
 * Human-approval record. Constructed ONLY inside the host trust channel
 * (`HostApprovalChannel.submit`, `./host` subpath) from a {@link TrustedHumanPrincipal}
 * — never accepted from a caller, so no public function takes an ApprovalRecord
 * argument (INV-NO-LEGACY-APPROVE). `actor: string` is gone; identity is the
 * host-attested `principalId` + `approval_event_id`.
 */
export interface ApprovalRecord {
  readonly run_id: string
  readonly step_id: string
  readonly attempt_id: number
  readonly principalId: string
  readonly approval_event_id: string
  readonly decision: 'approved' | 'rejected'
  readonly rationale?: string
  readonly timestamp: number
}

/**
 * Registry entry for one produced artifact (current valid record per slug).
 * `invalidated` is set true by rollback/cascade; recordArtifact REPLACES the entry
 * with a fresh `invalidated: false` record on re-run (DEP-4 — never mutated in place).
 */
export interface ArtifactRecord {
  readonly slug: string
  readonly producerStepId: string
  readonly producerAttemptId: number
  readonly value: unknown
  readonly producedAt: number
  readonly invalidated: boolean
}

export type AuditEventKind =
  | 'run-created'
  | 'input-seeded'
  | 'step-started'
  | 'artifact-recorded'
  | 'gate-verdict'
  | 'step-completed'
  | 'human-approval'
  | 'rollback'

/**
 * Append-only run audit event. `detail` is a JSON-serializable snapshot deep-cloned
 * at append time (INV-EVENTS-IMMUTABLE); it MUST NOT hold live StepState/registry refs.
 */
export interface AuditEvent {
  readonly kind: AuditEventKind
  readonly runId: string
  readonly stepId?: string
  readonly attemptId?: number
  readonly ts: number
  readonly detail?: unknown
}

/** Superseded historical attempt snapshot (appended on rollback/cascade; never physically cleared).
 *  All fields readonly; values deep-cloned at snapshot time (INV-HISTORY-IMMUTABLE). */
export interface AttemptRecord {
  readonly attempt_id: number
  readonly status: StepStatus
  readonly artifacts: Readonly<Record<string, unknown>>
  readonly gateResults: Readonly<Partial<Record<TrinityComponent, GateVerdict>>>
  readonly approval?: Readonly<ApprovalRecord>
  readonly superseded: true
}

/** Snapshot of the current (non-superseded) attempt, returned by getAuditHistory. */
export interface CurrentAttemptSnapshot {
  readonly attempt_id: number
  readonly status: StepStatus
  readonly artifacts: Readonly<Record<string, unknown>>
  readonly gateResults: Readonly<Partial<Record<TrinityComponent, GateVerdict>>>
  readonly approval?: Readonly<ApprovalRecord>
  readonly current: true
}

/** Mutable runtime state of one step instance (internal; never returned by reference). */
export interface StepState {
  readonly stepId: string
  status: StepStatus
  attempts: number
  attempt_id: number
  artifacts: Record<string, unknown>
  gateResults: Partial<Record<TrinityComponent, GateVerdict>>
  approval?: ApprovalRecord | undefined
  history: AttemptRecord[]
  startedAt: number | undefined
  finishedAt: number | undefined
}

/** Mutable map of step runtime states, keyed by step id (within one run). */
export type StepStore = Map<string, StepState>

/**
 * One research run's state. All public API carries `runId`; runs share nothing
 * (INV-RUN-ISOLATION). `consumedApprovals` enforces approval-event single-use per
 * run (INV-REPLAY).
 */
export interface RunState {
  readonly runId: string
  inputs: Record<string, unknown>
  steps: StepStore
  registry: Record<string, ArtifactRecord>
  events: AuditEvent[]
  consumedApprovals: Set<string>
}

/** Top-level run store keyed by runId. */
export type ResearchRunStore = Map<string, RunState>

/** Read-only step snapshot (deep-cloned on return; runtime-mutable but isolated from internal state). */
export interface StepSnapshot {
  readonly stepId: string
  readonly status: StepStatus
  readonly attempts: number
  readonly attemptId: number
  readonly artifacts: Readonly<Record<string, unknown>>
  readonly gateResults: Readonly<Partial<Record<TrinityComponent, GateVerdict>>>
  readonly approval?: Readonly<ApprovalRecord>
  readonly history: ReadonlyArray<Readonly<AttemptRecord>>
  readonly startedAt?: number
  readonly finishedAt?: number
}

/** Artifact metadata (no value) for {@link RunSnapshot}; use `getArtifact` for the value (HOLE-4). */
export interface ArtifactRecordMeta {
  readonly slug: string
  readonly producerStepId: string
  readonly producerAttemptId: number
  readonly producedAt: number
  readonly invalidated: boolean
}

/** Read-only run snapshot (deep-cloned on return; artifact values excluded — fetch via getArtifact). */
export interface RunSnapshot {
  readonly runId: string
  readonly inputs: Readonly<Record<string, unknown>>
  readonly steps: Readonly<Record<string, StepSnapshot>>
  readonly registry: Readonly<Record<string, ArtifactRecordMeta>>
  readonly events: ReadonlyArray<Readonly<AuditEvent>>
}

/** One audit-history entry (superseded or current), deep-cloned on return. */
export type AuditEntry = AttemptRecord | CurrentAttemptSnapshot
