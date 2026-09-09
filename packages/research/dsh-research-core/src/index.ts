/**
 * Public entry of @deepseek-ai/dsh-research-core (v2 hardened contract).
 *
 * Exports the run-keyed state-machine API + types + errors. It does NOT export any
 * human-approval capability: `approveHumanGate` and `transition` are DROPPED
 * (INV-NO-LEGACY-APPROVE, INV-NO-RAW-TRANSITION), and `submitHumanApproval` /
 * `TrustedHumanPrincipal` / `createHostApprovalChannel` live in the `./host` subpath
 * (src/host.ts) — so a humanGate step can reach 'gated' but NEVER 'passed' via this
 * main entry. The package-private `_applyHumanApproval` is likewise NOT re-exported
 * here (host.ts imports it relatively). The mutable step-definition singletons
 * (STEPS/STEP_BY_ID/stepsByPhase/TRINITY_LABEL/SEEDABLE_INPUTS/assertDagAndSeedSeparation)
 * are likewise NOT re-exported — they are deep-frozen in steps.ts (RC-A) and consumed
 * internally only, so an importer cannot mutate `step.humanGate`/`step.gate`/`step.inputs`
 * to bypass the guards that read them live (and the `./src/*` subpath hatch is removed,
 * so steps.ts is not directly importable either).
 *
 * ── T19-B orchestration surface (additive, audited) ───────────────────────────
 * Three narrow, safe additions serve the team runner WITHOUT opening the internals:
 *   - `runStep` (execute phase only): the T19-A minimal pipeline — guarded, result-once,
 *     timeout/abort-safe, all-or-nothing artifact writes, appends its own 'step-executed'
 *     audit. It NEVER adjudicates a gate and NEVER moves a step to a terminal state; the
 *     gate stays the sole province of `submitGateVerdict`/`completeStep`. It requires the
 *     step to already be `in_progress` (via `startStep`) and throws otherwise.
 *   - `getStepDefinitions()` / `getStepDefinitionById()`: read-only accessors returning
 *     deep-frozen CLONES of the 16 step definitions. The internal STEPS array / STEP_BY_ID
 *     Map are never handed out; callers cannot mutate or alias the live definitions.
 *   - NO generic `appendAuditEvent` is exported: audit records can only be produced by the
 *     engine's own functions (runStep → 'step-executed'; submitGateVerdict/completeStep →
 *     'gate-verdict'/'gate-abstention'/'step-completed'), so no caller can forge arbitrary
 *     audit history.
 */

export type {
  Phase,
  TrinityComponent,
  StepDefinition,
  StepStatus,
  GateOutcome,
  GateVerdict,
  HoldReason,
  GateAbstentionRecord,
  ApprovalRecord,
  ArtifactRecord,
  AuditEventKind,
  AuditEvent,
  AttemptRecord,
  CurrentAttemptSnapshot,
  StepState,
  StepStore,
  RunState,
  ResearchRunStore,
  StepSnapshot,
  ArtifactRecordMeta,
  RunSnapshot,
  AuditEntry,
} from './engine/types.ts'
export {
  createRun,
  setRunInput,
  getRunSnapshot,
  getArtifact,
  canStart,
  startStep,
  startIfCan,
  recordArtifact,
  submitGateVerdict,
  completeStep,
  rollback,
  isComplete,
  getAuditHistory,
} from './engine/state-machine.ts'
export { ResearchError, ResearchValueError, ResearchRunError } from './engine/state-machine.ts'

// ── Batch-2 modules (T07 L0 / T08 citation / T09 gates) ───────────────────────
// Pure-logic sibling modules, wired into the package entry by the main Agent.
// Each module owns a subpath index; the symbols below are its STABLE public
// API. ResearchError / ResearchValueError / ResearchRunError are already
// exported above and intentionally NOT duplicated here.

// T07 — L0 literature routing (source RISK + QUALITY tier, never truth).
export {
  classifyL0,
  createMockL0Adapter,
  mockL0Adapter,
  MOCK_L0_RULE_VERSION,
  L0_ERROR_PREFIX,
} from './l0/index.ts'
export type {
  L0Classification,
  L0ClassificationStatus,
  L0SourceId,
  L0SourceType,
  L0Tier,
  L0RoutingAdapter,
  L0RoutingDecision,
  L0SourceInput,
} from './l0/index.ts'

// T08 — citation identity verification (evidence chain for the B gate).
export {
  verifyCitation,
  MockCitationResolverAdapter,
  CITATION_ERROR_PREFIX,
  CITATION_CODE_RED_LINE_NO_ORIGINAL,
  CITATION_CODE_NOT_FOUND,
  CITATION_CODE_TEMPORARILY_UNAVAILABLE,
  CITATION_CODE_AMBIGUOUS,
  CITATION_CODE_REDACTED_UNMARKED,
  CITATION_CODE_RETRACTED_MARKED,
  CITATION_CODE_IDENTITY_MISMATCH,
  CITATION_CODE_CORRELATION_AS_CAUSATION,
  CITATION_CODE_UNSUPPORTED,
  CITATION_CODE_SUPPORTED,
  CITATION_CODE_PARTIALLY_SUPPORTED,
  CITATION_CODE_UNVERIFIED,
  CITATION_CODE_BLOCKED,
} from './citation/index.ts'
export type {
  ResolvedCitationMetadata,
  CitationResolverAdapter,
  ResolverOutcome,
  ResolverStatus,
  FixtureRecord,
  MockCitationResolverOptions,
  VerifyCitationOptions,
  CitationEvidence,
  VerificationMethod,
  VerificationConclusion,
  VerificationResult,
  CitationRef,
  CitationId,
  CitationIdKind,
  ClaimId,
} from './citation/index.ts'

// T09 — adjudication gates + frozen gate→state-machine intent.
export {
  adjudicate,
  gateToStateMachineIntent,
  GATE_OUTCOME_TO_INTENT,
} from './gates/index.ts'
export type {
  AdjudicationConfig,
  AdjudicationInput,
  AdjudicationOutcome,
  AdjudicationResult,
  AdjudicationVote,
  FalsifiablePrediction,
  StateMachineGateIntent,
} from './gates/index.ts'

// ── T19-B orchestration (Wave 2, additive + audited) ─────────────────────────
// `runStep` is the execute-phase pipeline (T19-A). It NEVER adjudicates gates and
// never reaches a terminal state on its own — see the module docs above. The step
// accessors return deep-frozen clones; the internal STEPS array / STEP_BY_ID Map are
// not exported, and no generic appendAuditEvent is exported (audit events originate
// only from engine functions).
export { runStep } from './engine/pipeline.ts'
export type {
  StepExecContext,
  StepExecutor,
  RunStepOptions,
  RunStepStatus,
  RunStepResult,
} from './engine/pipeline.ts'
export { getStepDefinitions, getStepDefinitionById } from './engine/steps-accessor.ts'

// ── Session-restart recovery — versioned atomic snapshot persistence ──────────
// Minimal, database-free persistence for pipeline run state. Atomic write + rename
// with fail-closed load; never returns a torn/partial snapshot. Used to resume a
// research run after a process restart, with replay protection on approval event ids.
export {
  createFileSnapshotStore,
  replayProtection,
  SnapshotStoreError,
  SnapshotNotFoundError,
  SnapshotCorruptError,
  SnapshotVersionError,
  SNAPSHOT_ERROR_CODES,
  SNAPSHOT_FILE_NAME,
} from './snapshot-store.ts'
export type {
  SnapshotPayload,
  SnapshotStep,
  SnapshotStore,
  FileSnapshotStoreOptions,
} from './snapshot-store.ts'
