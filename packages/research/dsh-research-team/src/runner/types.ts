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
import type { ResearchProfile } from './research-profile.ts'
import type { ResearchProseWriter, RunContext, StepExecutorFn, Truthfulness } from './registry.ts'
import type { DocumentCompiler } from './document-compile.ts'
import type { FigureProvider } from './figure-provider.ts'
import type { StatementSupportAssessor } from './statement-support.ts'
import type { SourceRecord } from './citation-bindings.ts'
import type { ResolutionVerifier } from './resolution-verifier.ts'
import type { ReviewPolicy } from './review-policy.ts'

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
  /** Truthfulness of the executor that ran, or 'humanGate' for the step whose executor is the gate (E2). */
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
  /** Core `runStep` outcome of the execute phase. Absent when the step declared no executor. */
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
   * The research type, the venue profile and the metrics this run is conducted under.
   *
   * FROZEN INTO THE RUN'S SPEC by the driver, so a deployment reconfigured while a study is under way
   * does not change what that study is. Absent means the deployment stated none, and the driver's
   * default (`simulation-study`) is used — which is a configuration, not a silent fallback: the
   * service resolves it before the run starts.
   */
  readonly researchProfile?: ResearchProfile
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
   * The document compiler the deployment configured, handed to E1-format.
   *
   * INJECTED, NOT SPAWNED HERE. Whether a machine has a document toolchain is a deployment fact, so
   * the deployment states it; a run under a deployment that configured none still exports its
   * manuscript and records that it was not compiled rather than failing.
   */
  readonly documentCompiler?: DocumentCompiler
  /**
   * The deployment's drawing capability, handed to `D1-figure-map`.
   *
   * Absent means the built-in renderer draws the floats, which is what every offline run does. A
   * deployment that names a provider gets that provider's output, and each float records which one
   * drew it — see {@link FigureProvider}.
   */
  readonly figureProvider?: FigureProvider
  /**
   * The deployment's ability to judge a citing SENTENCE against the passage read for it.
   *
   * A CAPABILITY LIKE THE OTHERS, and absent for the same reason: whether a machine can read a passage
   * and decide what it establishes about a particular sentence is a property of the deployment's
   * reviewer. A deployment that names none inherits no verdict from the claim — the draft records that
   * no sentence-level reading was made, which is a fact a reader can act on rather than a silence.
   */
  readonly statementAssessor?: StatementSupportAssessor
  /**
   * The sources this run may cite, when the deployment configured a registry to draw them from.
   *
   * Absent means the checked-in corpus. Present, it is what the configured registry offered — and a
   * registry that could not read its library offers NOTHING rather than falling back, so a run
   * pointed at a library cannot silently cite the repository instead.
   */
  readonly sources?: ReadonlyMap<string, SourceRecord>
  /**
   * The deployment's ability to check a revision against the issue it was written for.
   *
   * Absent means the issues a revision leaves pending stay pending: nothing closes them, which is a
   * state a reader can see. Present, each pending issue is read by somebody other than the author of
   * the answer, and only then is it `answered`.
   */
  readonly resolutionVerifier?: ResolutionVerifier
  /**
   * How much review this deployment requires before a manuscript may be published.
   *
   * Absent means {@link DEFAULT_REVIEW_POLICY}: two complete rounds. A deployment that requires one is
   * stating that one reading is enough for its purposes, which is a decision it is allowed to make and
   * is recorded on the run.
   */
  readonly reviewPolicy?: ReviewPolicy
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
   * Which of the claim's reviewed sources the B channel consults.
   *
   * Absent means the corpus's own anchor for this claim version — a normal run needs no value here.
   * A caller names one to ask what the gate does when the evidence it consults is the assessed
   * source that does NOT support the claim.
   */
  readonly evidenceSourceDoi?: string | undefined
  /**
   * How many revision rounds `D4-rebuttal` may ask the author for.
   *
   * Deployment configuration: how many times it is worth asking a model to fix a manuscript is a
   * budget decision, and the executor ships a default. Absent here means that default, the same way
   * an absent timeout means the registry's.
   */
  readonly revisionRounds?: number | undefined
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
  /** The document compiler; see {@link DriveOptions.documentCompiler}. */
  readonly documentCompiler?: DocumentCompiler
  /** The drawing capability; see {@link DriveOptions.figureProvider}. */
  readonly figureProvider?: FigureProvider
  /** The sentence-level reviewer; see {@link DriveOptions.statementAssessor}. */
  readonly statementAssessor?: StatementSupportAssessor
  /** The citable sources; see {@link DriveOptions.sources}. */
  readonly sources?: ReadonlyMap<string, SourceRecord>
  /** The revision verifier; see {@link DriveOptions.resolutionVerifier}. */
  readonly resolutionVerifier?: ResolutionVerifier
  /**
   * How much review this deployment requires before a manuscript may be published.
   *
   * Absent means {@link DEFAULT_REVIEW_POLICY}: two complete rounds. A deployment that requires one is
   * stating that one reading is enough for its purposes, which is a decision it is allowed to make and
   * is recorded on the run.
   */
  readonly reviewPolicy?: ReviewPolicy
  /** Tool deps for capability steps; see {@link DriveOptions.toolDeps}. */
  readonly toolDeps?: ResearchToolDeps
  /**
   * The profile this run declares, carried so the gate verdicts are built under the same one the
   * driver was given; see {@link DriveOptions.evidenceProfile}.
   */
  readonly evidenceProfile?: EvidenceProfile
  /** The assessed source the B channel consults; see {@link VerdictBuildCtx.evidenceSourceDoi}. */
  readonly evidenceSourceDoi?: string | undefined
  /** See {@link DriveOptions.revisionRounds}. */
  readonly revisionRounds?: number | undefined
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
  /**
   * The assessed source the B channel consults, when a caller names one.
   *
   * Absent means the corpus's own reviewed anchor for this claim version, so a normal run needs no
   * value here. A caller names one to drive a scenario — "what does this gate do when the evidence
   * it consults is the source that does NOT support the claim" — which is a fact about the source,
   * not a bypass: the gate still adjudicates whatever the citation chain returns from it.
   */
  readonly evidenceSourceDoi?: string | undefined
  /**
   * Read an artifact of the run being judged, by slug, or undefined when the run holds none.
   *
   * A gate that grades the step's OUTPUT needs the output. The commit receipt carries refs, which
   * name a revision but not its content, so the A channel's manuscript review reads through here —
   * the same resolution the executor used, so a verdict and the step it judges cannot disagree
   * about what the run contains.
   */
  readonly readInput?: ((slug: string) => unknown) | undefined
}
