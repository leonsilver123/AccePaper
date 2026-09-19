// @deepseek-ai/dsh-research-team — T19-S executor registry (canonical 16-step aligned).
//
// The single, auditable map of every one of the 16 pipeline steps → its executor
// + the truthfulness classification of that executor + the full per-step
// declaration required by the T19-B/T19-S task books:
//
//   stepId | executor | producer | input schema | output schema | artifact type
//          | truthfulness level | timeout | gate requirement | recovery policy
//
// T19-S reconciliation (canonical `final_execution_plan.md` A1..E2 as the ONLY
// business definition) fixed the executor↔step semantic misalignments of the
// T19-B wave:
//
//   - B3-baseline no longer runs `runAblation`: baseline = "establish the
//     baseline and compare against SOTA" (canonical B3-SOTA retrieval
//     sub-task). Ablation is C3-boundary's capability. B3 is honestly a
//     fixture this wave (its synthetic literature corpus is off-domain, so the
//     literature-search capability can anchor no real traffic-signal SOTA).
//   - C3-boundary now runs the REAL `runAblation` (variant-vs-baseline
//     boundary probing).
//   - D1-figure-map wires all three figure families its canonical purpose names
//     (数据图/三线表/路线图): real figure + three-line-table + roadmap renders.
//   - E1-format no longer IS `renderThreeLineTable`: E1 renders the document the
//     manuscript artifact carries. SUPERSEDED ON 2026-09-19: the T19-S ruling kept
//     the table inside E1 as a sub-capability, and the table has since moved to
//     D3-writing — a document that is authoritative before it is typeset has to
//     already carry its table. E1 now invokes no catalogue tool at all.
//   - `ARTIFACT_TYPE_BY_SLUG['baseline-results']` is `baseline-measurement-set`
//     (it was wrongly typed as an ablation set).
//
// The step graph itself is NOT duplicated here: `inputSchema` / `outputSchema` /
// `gateRequirement` are DERIVED from the core public accessor
// `getStepDefinitions()` at module load, so the registry can never drift from
// the frozen 16-step definition owned by core.
//
// ── Truthfulness levels (5-level ruling; supersedes the old 3-level
//    'real_tool' | 'fixture' | 'mock_external' scheme, and the 4-level ruling that
//    had no name for a step which computes a measurement without a tool) ────────
//  - `real_tool_fixture_input` : the REAL tool function executes; its INPUT is a
//    synthetic fixture. Honest reading: "the code really ran", NOT "this is real
//    science". Reports must never call this real research verification. The report
//    renders this level as "Real tool functions executed", so only steps that
//    actually invoke a catalogue tool may carry it.
//  - `local_computation`       : NO tool function and no external system — the
//    executor computes its product from its inputs with code inside this package.
//    The computation is real (B3/C1/C2 measure the experiment; B2 stats the
//    dataset files); it is not tool-mediated evidence.
//  - `fixture_executor`        : the whole executor is a deterministic fixture —
//    no tool is implemented for this step yet (or, for B3, the tool capability
//    exists but cannot anchor SOTA in this wave's synthetic corpus).
//  - `mock_external`           : real ADAPTATION logic runs against a SIMULATED
//    external system (e.g. core `verifyCitation` over
//    `MockCitationResolverAdapter`). Used by the gate channels (see verdict.ts).
//  - `live_external`           : a real external system was reached. Whether this
//    appears is a DEPLOYMENT property, not a wave property: A1 reaches a live
//    catalogue where one is configured, and D2/D3/D4 reach a real model where a
//    prose writer is. The registry's static entries declare none of it; the
//    artifacts do, and `drive.ts` takes the step's level from them.
//
// Discipline (spec §7, frozen):
//  - kind is declared honestly and matches the implementation, and every entry
//    carries a `basis` string stating WHY it is classified that way.
//  - Every artifact produced by any executor is stamped with `__producer` +
//    `__kind` so a test can prove (from the artifact alone) which executor ran —
//    no claim of real execution rests on the registry's existence alone.
//  - This file does NOT re-implement the core gate, does NOT reinterpret an
//    outcome, does NOT add a StepStatus, does NOT auto-approve E2, and preserves
//    the core runStep atomicity (rollback / new-attempt / timeout / error /
//    artifact) — it only supplies executors consumed by the drive layer via core
//    `runStep`.
//
// Real tools are consumed from the `@deepseek-ai/dsh-research-tools` package
// (declared dependency). No tools src is modified. All core engine functions used
// here come from the public `@deepseek-ai/dsh-research-core` entry.

import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'

import { CASE_PACK_INPUT_SLUGS } from './case-pack.ts'
import { commitmentFrom } from './prediction-gate.ts'
import type { ClaimMaterial } from './redteam-review.ts'
import type { MeasuredMetric, PredictionCommitment } from './prediction-gate.ts'
import type { PlatoonStudy } from './platoon-sim.ts'
import type { StudyAdapter, StudyProse } from './study-adapter.ts'
import { platoonAdapter, requireStudyAdapter } from './study-adapter.ts'
import { DEFAULT_PLAN } from './study-plan.ts'
import type { PlanSection, StudyPlan } from './study-plan.ts'

import type { ArtifactRef, StepDefinition, TrinityComponent } from '@deepseek-ai/dsh-research-core'
import { getStepDefinitions } from '@deepseek-ai/dsh-research-core'
import { DirectResearchToolInvoker } from '@deepseek-ai/dsh-research-tools'
import type { ResearchToolInvoker, ResearchToolDeps } from '@deepseek-ai/dsh-research-tools'
import {
  ABLATION_TOOL_ID,
  ABLATION_TOOL_VERSION,
  CLAIM_CONSTRUCT_TOOL_ID,
  CLAIM_CONSTRUCT_TOOL_VERSION,
  FIGURE_TOOL_ID,
  FIGURE_TOOL_VERSION,
  LITERATURE_SEARCH_TOOL_ID,
  LITERATURE_SEARCH_TOOL_VERSION,
  ROADMAP_TOOL_ID,
  ROADMAP_TOOL_VERSION,
  THREE_LINE_TABLE_TOOL_ID,
  THREE_LINE_TABLE_TOOL_VERSION,
  THREE_LINE_TABLE_DEFAULT_MISSING_TOKEN,
  constructClaim,
  mockLiteratureSearchAdapter,
  renderFigure,
  renderRoadmap,
  renderThreeLineTable,
  threeLineTableCellText,
  runAblation,
  runLiteratureSearch,
} from '@deepseek-ai/dsh-research-tools'

import { assembleManuscript } from './manuscript.ts'
import {
  citedFloats,
  equationBlock,
  equationNumber,
  figureBlock,
  formatReference,
  markdownPipeTable,
  numberFloats,
  numberedReferences,
  tableBlock,
} from './paper-format.ts'
import type { CitableFloat } from './paper-format.ts'

/**
 * The caption a rendered figure already carries in its own content.
 *
 * The figure plan's entries hold the rendering, not a caption field, so the title is read from where
 * the renderer put it: the SVG's `<title>`, or a mermaid leading `%%` comment. A figure whose
 * content states no title gets the caller's fallback rather than an empty caption.
 *
 * @param content - the rendered SVG or mermaid source.
 * @param fallback - the caption to use when the content names itself nowhere.
 * @returns the caption text.
 */
function figureCaptionFrom(content: string, fallback: string): string {
  const svgTitle = /<title>([^<]+)<\/title>/u.exec(content)
  if (svgTitle !== null && (svgTitle[1] ?? '').trim().length > 0) return (svgTitle[1] ?? '').trim()
  const mermaidTitle = /^%%\s*(.+)$/mu.exec(content)
  if (mermaidTitle !== null && (mermaidTitle[1] ?? '').trim().length > 0) return (mermaidTitle[1] ?? '').trim()
  return fallback
}

import { evaluateConvergence, summarizeConvergence } from './convergence.ts'
import type { ChannelVerdict } from './convergence.ts'
import { buildRevisionRecord } from './rebuttal.ts'
import type { RebuttalPoint } from './rebuttal.ts'
import {
  experimentStudy,
  studyFromPack,
} from './platoon-sim.ts'
import { resolveImplementation } from './implementations.ts'
import {
  RESULT_VERSION_SLUG,
  readResultVersion,
  resultVersionFrom,
} from './result-version.ts'
import type { MeasuredOutcome, ResultSource } from './result-version.ts'
import { sectionEvidenceFor } from './section-evidence.ts'
import { applyRevision, bodyHashOf } from './issue-patch.ts'
import { assertWellFormed, parseReply, type DiscardedExchange } from './issue-parse.ts'
import type { AppliedRevision, RevisionIssue } from './issue-patch.ts'
import type { SectionEvidence } from './section-evidence.ts'
import { assessmentsFor } from './evidence-corpus.ts'
import { argumentPlanOf, checkArgumentPlan, claimOutcomeOf, contractFor } from './argument-plan.ts'
import { checkPresentationPlan } from './presentation-plan.ts'
import type { ArgumentPlan } from './argument-plan.ts'
import { assessStatements, checkStatementSupport } from './statement-support.ts'
import type { StatementSupportAssessor } from './statement-support.ts'
import type { StatementAssessment } from './statement-support.ts'
import { verifyPending, verifyResolution } from './resolution-verifier.ts'
import type { ExecutionIdentity, ResolutionVerifier as ResolutionVerifierPort } from './resolution-verifier.ts'
import type { ResolutionVerifier } from './resolution-verifier.ts'
import { DEFAULT_REVIEW_POLICY, reviewSatisfaction } from './review-policy.ts'
import type { ReviewPolicy, ReviewedRound } from './review-policy.ts'
import { compileManuscriptFormats, documentOf } from './document-compile.ts'
import type {
  DocumentBlock, DocumentCompiler, DocumentReference, ManuscriptDocument,
} from './document-compile.ts'
import type { FigureProvider } from './figure-provider.ts'
import {
  bibliographyOf, bindJudgements, checkCitationKeys, checkCitationUse, checkManuscriptCitations,
  checkStatementBindings, judgementsFor, locateStatements,
  citeKeyOf, renderCitationMarkers, reviewedSources,
} from './citation-bindings.ts'
import type { CitationUse, SourceJudgement, SourceRecord } from './citation-bindings.ts'
import { evaluatePrediction } from './prediction-gate.ts'

/** Truthfulness classification of an executor / gate channel (5-level ruling). */
export type Truthfulness =
  | 'real_tool_fixture_input'
  | 'local_computation'
  | 'fixture_executor'
  | 'mock_external'
  | 'live_external'

/** The 5 levels in report order (also the runtime membership guard). */
export const TRUTHFULNESS_LEVELS: ReadonlyArray<Truthfulness> = [
  'real_tool_fixture_input',
  'local_computation',
  'fixture_executor',
  'mock_external',
  'live_external',
]

/**
 * Declared recovery path when a step's attempt does not reach `passed`.
 *  - `rollback_and_retry`      : execute-phase fault (throw / timeout / cancel /
 *    undeclared-slug). The step stays `in_progress` with NO artifact; the caller
 *    rolls back and runs a NEW attempt.
 *  - `rollback_and_reevidence` : a gate component abstained. Core holds the step
 *    at `gated` (holdReason='gate_abstained'); the ONLY legal release is
 *    rollback → new attempt WITH better evidence. Never an in-place re-submit.
 *  - `human_approval_only`     : E2-submit. The step reaches `gated` and can only
 *    be released by a trusted human principal through the core host channel.
 */
export type RecoveryPolicy = 'rollback_and_retry' | 'rollback_and_reevidence' | 'human_approval_only'

/** Where one declared input slug comes from. */
export type InputSource = 'run-seed' | 'upstream-artifact'

/** One declared input of a step (derived from the core step definition). */
export interface InputSpec {
  readonly slug: string
  readonly source: InputSource
}

/** One declared output of a step + the artifact type it carries. */
export interface OutputSpec {
  readonly slug: string
  readonly artifactType: string
}

/** The gate a step must satisfy to leave `in_progress` (derived from core). */
export interface GateRequirement {
  readonly components: ReadonlyArray<TrinityComponent>
  readonly humanGate: boolean
  /** Human-readable requirement for the report. */
  readonly description: string
}

/** Fixed caller-injected timestamp so two E2E runs are byte-for-byte deterministic. */
export const FIXED_TS = 1_700_000_000_000

/**
 * Cross-step mutable scratch populated by executors so downstream gate verdicts
 * (the C-channel) can reference the claim / prediction the real tools produced.
 */
export interface RunContext {
  /** The canonical falsifiable prediction text (set by A2-claim executor). */
  predictionText: string
  /** The claim id (set by A2-claim executor; matches the experiment fixture key). */
  claimId: string
  /** Human-readable claim reference (set by A2-claim executor). */
  claimRef: string
  /**
   * The quantity the claim is about, as the claim declares it (set by A2-claim executor).
   *
   * Empty when the claim declares none. The C channel adjudicates only when this equals the
   * quantity the experiment measures; anything else (including empty) makes the claim
   * unbindable, and an unbindable claim HOLDS rather than being graded.
   */
  metricKey: string
  /**
   * The claim material the A channel reviews, verbatim as the run states it (set by the
   * A2-claim executor).
   *
   * The A channel's votes must be DERIVED from this. They used to be three `support`
   * literals with a constant rationale, so the gate returned the same verdict whatever the
   * run contained — a constant wearing a judgment's name. Fields the claim does not state
   * stay empty strings, and the review reports the absence rather than filling it in.
   */
  claimMaterial: ClaimMaterial
  /**
   * The study the experiment runs, taken from the selected Case Pack's declared scenarios
   * when it carries them (set by the A2-claim executor).
   *
   * Every executor that measures reads it from here rather than building its own, so the
   * baseline artifact, the MVP artifact, the figures and the C gate are all the same
   * measurement of the same study. Two executors constructing their own scenario would let
   * a paper's table disagree with the verdict that approved it.
   */
  study: PlatoonStudy
  /**
   * The study this run is conducted as, resolved from the plan and carried here.
   *
   * EVERY EXECUTOR THAT REPORTS THE STUDY READS IT THROUGH THIS rather than knowing which study it
   * is: the baseline's arms, the experiment's provenance block, the figures, the table, the diagram
   * and the fallback prose all come from it, so a second study is a second adapter rather than a
   * branch in each of those four steps. See `study-adapter.ts`.
   *
   * It is set with {@link RunContext.study}, because the platoon adapter is built over the scenarios
   * that field holds; a run whose Case Pack supplies them gets an adapter over the pack's study.
   */
  adapter: StudyAdapter
  /**
   * The claim's DECLARED commitment: which way its quantity should move, whether it caps the change,
   * and by how much — the three fields the C gate grades.
   *
   * Declared by the selected Case Pack (set by the A2-claim executor). Absent means the claim
   * declared none, and the C channel then HOLDS rather than inferring a direction from the
   * prediction's prose — an inference three audit rounds showed cannot be trusted. Every write here
   * comes from `commitmentFrom` or from the A2 fixture literal; see `evaluatePrediction`'s
   * `commitment` parameter for why the grading trusts the value's shape.
   */
  commitment?: PredictionCommitment
  /**
   * The research this run carries: its title, its field and direction, its section skeleton, its
   * claim and the quantity the claim is about (seeded by the driver, refined by A2 once a Case
   * Pack or a model has supplied a claim).
   *
   * Every executor reads the study through here rather than through module constants, so the
   * manuscript, the retrieval topic and the measured quantity are the run's own.
   */
  studyPlan: StudyPlan
  /**
   * Where the plan came from.
   *
   * A caller's plan owns the claim. A Case Pack is a curated fixture input set and stays the
   * authority for the scenario this run MEASURES — and for the material's scope and sources — but a
   * claim a person confirmed is not something a fixture file may overwrite: the run would then
   * produce a manuscript stating a claim its own dialog never showed.
   */
  planSource: 'caller' | 'default'
  /** The fixed timestamp used across the run (set by the driver). */
  timestamp: number
}

/**
 * Point a run context at a study, rebuilding the adapter over it.
 *
 * THE TWO ARE ONE ASSIGNMENT because they are one fact: every step that reports the study reads it
 * through the adapter, so replacing `study` alone leaves the run measuring the study the context was
 * built over while its artifacts name the one it was given. `A2-claim` is where this happens in
 * production — the Case Pack supplies the scenarios the platoon study runs — and a caller that
 * switches studies for a scenario does the same.
 *
 * @param ctx - the run context to repoint.
 * @param study - the scenarios this run is now conducted over.
 * @throws {Error} when the plan the context carries cannot be conducted as that study.
 */
export function setRunStudy(ctx: RunContext, study: PlatoonStudy): void {
  ctx.study = study
  ctx.adapter = requireStudyAdapter(ctx.studyPlan, study)
}

/** One prose-generation request handed to a {@link ResearchProseWriter}. */
export interface ResearchProseRequest {
  readonly stepId: string
  /** What to produce, phrased for the model (never UI or transport vocabulary). */
  readonly instruction: string
  /** Upstream artifact values the produced text must stay consistent with. */
  readonly context: Readonly<Record<string, unknown>>
  readonly signal?: AbortSignal
}

/** A real-model prose result, carrying the route that produced it for provenance. */
export interface ResearchProseResult {
  readonly text: string
  readonly provider: string
  readonly model: string
}

/**
 * Optional real-model prose writer injected by the runner (T34). Steps whose artifact is
 * narrative prose (D2 outline / D3 writing / D4 rebuttal) generate their text through it
 * when present, and fall back to the built-in fixture sentences when absent, so the offline
 * pipeline stays deterministic. The runner depends only on this interface; the Cordis
 * adapter supplies the implementation that reaches a real provider.
 */
/**
 * The truthfulness level that goes with one prose source label.
 *
 * @param source - a `*Source` field's value.
 * @returns the level this file's vocabulary assigns to it.
 */
function proseKindOf(source: 'model' | 'deterministic' | 'fixture' | 'case-pack'): Truthfulness {
  // `case-pack` is on the same axis as `fixture`: the text was read from a file the deployment
  // supplied, not produced by any channel. It is listed here rather than special-cased at the call
  // site so that the level of every prose-origin label is decided in one place.
  if (source === 'fixture' || source === 'case-pack') return 'fixture_executor'
  // `model` is a deployment's configured model route; the deterministic offline route is
  // `mock_external` — real adaptation logic over a simulated model.
  return source === 'model' ? 'live_external' : 'mock_external'
}

/**
 * How a prose product is labelled, given the channel that produced it.
 *
 * One rule, one place. `'model'` means the deployment CONFIGURED a model route and that route
 * produced the text — not that a real external system was reached, which the writer cannot know.
 * The deterministic offline route calls no model at all, and saying otherwise would put a claim in
 * the artifact that the artifact's own text contradicts ("No model was called").
 *
 * @param writer - the writer this executor was handed, or undefined.
 * @returns the source label and the truthfulness level that go with it.
 */
export function proseLabelling(writer: ResearchProseWriter | undefined): {
  readonly source: 'model' | 'deterministic' | 'fixture'
  readonly kind: Truthfulness
} {
  if (writer === undefined) return { source: 'fixture', kind: 'fixture_executor' }
  // `model` states that the deployment CONFIGURED a model route and that route produced this
  // text — not that a real external system was reached, which the writer cannot know and which
  // the artifact's own provider/model fields are there to let a reader check.
  if (writer.channel === 'llm') return { source: 'model', kind: 'live_external' }
  // A deterministic provider is real adaptation logic over a SIMULATED model: the request, the
  // session and the log are real, the response is computed. That is `mock_external` by this
  // file's own vocabulary, and it is never `live_external` ("a real external system was reached").
  return { source: 'deterministic', kind: 'mock_external' }
}

export interface ResearchProseWriter {
  write(request: ResearchProseRequest): Promise<ResearchProseResult>
  /**
   * Which channel produced the text, as the deployment configured it.
   *
   * REQUIRED, not optional. The runner labels an artifact with what RAN, not with the fact that a
   * writer object exists: a deployment whose prose route is a deterministic in-process generator
   * calls no model, and labelling its products `model` puts a claim in the artifact that the
   * artifact's own text denies. An optional field would have to guess for a writer that does not
   * declare one, and the only guess available over-claims — it says a model was reached.
   */
  readonly channel: 'llm' | 'deterministic'
}

/** Context handed to every registry executor (drive layer adapts core's StepExecContext). */
export interface ExecCtx {
  /**
   * The document compiler this deployment configured, or undefined when it configured none.
   *
   * A DEPLOYMENT FACT, carried on the context the way the prose writer is: whether a machine has a
   * document toolchain is not something a step can discover for itself without spawning a process,
   * and this package does not spawn.
   */
  readonly documentCompiler?: DocumentCompiler
  /**
   * The deployment's drawing capability, when it has one.
   *
   * Absent means D1 draws with the built-in renderer — the same shape as the compiler, and the same
   * reason: whether a machine has a scientific plotting library is a deployment fact, and a run whose
   * deployment named none still draws its floats rather than failing.
   */
  readonly figureProvider?: FigureProvider
  /**
   * The deployment's ability to judge a citing sentence against the passage read for it, when it has one.
   *
   * Absent means no sentence-level reading is made — and NOT that every sentence inherits the claim's
   * verdict, which is the inheritance this field exists to end. The draft records which of the two
   * happened.
   */
  readonly statementAssessor?: StatementSupportAssessor
  /**
   * The sources this run may cite, from the registry the deployment configured.
   *
   * ABSENT MEANS THE CHECKED-IN CORPUS, which is what every run read before there was a choice. A run
   * pointed at a literature library passes what that library offered, so a sentence can be bound to a
   * source read during this run rather than only to one committed to the repository.
   */
  readonly sources?: ReadonlyMap<string, SourceRecord>
  /**
   * The deployment's revision verifier, when it has one.
   *
   * Absent means the issues a revision leaves pending stay pending — see
   * {@link DriveOptions.resolutionVerifier}. A patch that applied and an answer that argued are both
   * waiting for a reader, and without one they wait rather than closing themselves.
   */
  readonly resolutionVerifier?: ResolutionVerifier
  /**
   * How much review this deployment requires; see {@link DriveOptions.reviewPolicy}.
   *
   * THE FLOOR, not the bound: `revisionRounds` says how many times the author may be asked, and this
   * says how many actual readings a manuscript must have had before it may be published.
   */
  readonly reviewPolicy?: ReviewPolicy

  readonly runId: string
  readonly stepId: string
  readonly attemptId: number
  /** Cooperative-cancellation signal forwarded from core runStep. */
  readonly signal?: AbortSignal
  /** Read an upstream-produced artifact value (verified satisfied by canStart). */
  readonly getInput: (slug: string) => unknown
  /**
   * The reference of the artifact the run holds under `slug`, when it holds one.
   *
   * A VALUE DOES NOT KNOW ITS OWN VERSION. `getInput` answers with the value, and two steps have to
   * state which version they read: E1 records the manuscript version its typeset form renders, and
   * E2 records the two versions its submission request was prepared from. The run's registry is the
   * only home of that fact, and this is the read that reaches it.
   *
   * `undefined` means the run holds no artifact under that slug. A SEEDED INPUT IS NOT AN ARTIFACT:
   * `domain-direction` and the Case Pack files are recorded in the run's `inputs` by `setRunInput`
   * before it starts, have no version, and answer undefined here rather than an invented one.
   */
  readonly readInputRef: (slug: string) => ArtifactRef | undefined
  /** Shared cross-step scratch (claim / prediction wiring). */
  readonly runCtx: RunContext
  /**
   * Optional ResearchToolInvoker injected by the runner (T19 calibration R1).
   * When present, capability steps route tool execution through the invoker;
   * when absent, executors fall back to a default DirectResearchToolInvoker
   * (direct_call). The pipeline thus depends only on the Invoker interface.
   */
  readonly invoker?: ResearchToolInvoker
  /**
   * How many revision rounds `D4-rebuttal` may ask the author for.
   *
   * Deployment configuration rather than a constant: how many times it is worth asking a model to
   * fix a manuscript is a budget decision. Absent means {@link DEFAULT_REVISION_ROUNDS}.
   */
  readonly revisionRounds?: number
  /**
   * Optional real-model prose writer (T34). When absent, prose steps use the fixture
   * text. See {@link ResearchProseWriter}.
   */
  readonly proseWriter?: ResearchProseWriter
  /**
   * Tool dependencies handed to capability steps. The Cordis adapter assembles
   * these from its own Config (fixture corpus vs. a real retrieval channel), so a
   * step's evidence follows from the deployment rather than from a literal here.
   * When absent, steps fall back to the package's fixture deps.
   */
  readonly toolDeps?: ResearchToolDeps
}

export type StepExecutorFn = (ctx: ExecCtx) => Promise<Record<string, unknown>> | Record<string, unknown>

/** A registry entry: the full auditable declaration of how one step is executed. */
export interface StepExecutorEntry {
  readonly stepId: string
  /**
   * Truthfulness of THIS executor (not of the step's gate — see verdict.ts), or
   * `'humanGate'` for the pipeline's human gate (E2-submit).
   *
   * `'humanGate'` is the level `StepOutcome.kind` uses for exactly that case, so the
   * registry table and the per-step table say the same thing about E2. E2 HAS AN EXECUTOR AND KEEPS
   * THIS LEVEL: what runs there prepares the submission request and submits nothing, so a level that
   * names a computation would report the preparation as evidence about the paper. What makes the
   * step a gate is `gateRequirement.humanGate`, which is read off the core definition.
   */
  readonly kind: Truthfulness | 'humanGate'
  /** Why the step carries this `kind` (audit basis; required for every entry). */
  readonly basis: string
  /** Producer brand, e.g. 'literature-search@0.1.2-alpha.4' or 'fixture:baseline'. */
  readonly producer: string
  readonly executor: StepExecutorFn
  /** Declared inputs (derived from the core step definition). */
  readonly inputSchema: ReadonlyArray<InputSpec>
  /** Declared outputs + artifact type (slugs derived from the core step definition). */
  readonly outputSchema: ReadonlyArray<OutputSpec>
  /** Execute-phase timeout handed to core runStep (ms). 0 = the executor is given no bound. */
  readonly timeoutMs: number
  /** Gate the step must satisfy (derived from the core step definition). */
  readonly gateRequirement: GateRequirement
  readonly recoveryPolicy: RecoveryPolicy
}

/**
 * Stamp an artifact value with producer provenance. The wrapper is a plain
 * (non-frozen) object so the `__producer` / `__kind` fields are visible to tests
 * as artifact-level evidence that the declared executor actually ran. Frozen
 * tool artifacts are spread (their values copied) so the wrapper is writable.
 */
export interface ArtifactChannelMeta {
  /** Which invoker actually executed the capability (direct|agent-loop-toolruntime). */
  readonly provenance: string
  /** Channel truthfulness carried by the invoker (direct_call|host_tool_runtime). */
  readonly invokerTruthfulness: string
}

export function tagArtifact(
  value: unknown,
  producer: string,
  /**
   * The level this artifact is recorded under.
   *
   * `'humanGate'` is accepted for the ONE artifact the human gate's own step produces (E2's
   * submission request): it is the same level the step carries, so the registry table, the per-step
   * table and the artifact agree about what happened there.
   */
  kind: Truthfulness | 'humanGate',
  channelMeta?: ArtifactChannelMeta,
): Record<string, unknown> {
  const branded: Record<string, unknown> = (value !== null && typeof value === 'object' && !Array.isArray(value))
    ? { ...(value as Record<string, unknown>), __producer: producer, __kind: kind }
    : { value, __producer: producer, __kind: kind }
  if (channelMeta !== undefined) {
    branded.__provenance = channelMeta.provenance
    branded.__invokerTruthfulness = channelMeta.invokerTruthfulness
  }
  return branded
}

/** One tool capability that serves a pipeline step. A tool is a STEP CAPABILITY,
 *  never a step substitute (T19-S ruling). `wired:false` marks a canonical
 *  capability that is declared but not exercised this wave (honest gap). */
export interface StepCapability {
  readonly toolId: string
  readonly role: string
  readonly wired: boolean
  readonly note?: string
}

/**
 * The study's identity fields: what is being compared, and under which name.
 *
 * This object holds NO numeric result. It used to carry `baselineDelaySeconds`,
 * `variantDelaySeconds` and `reductionRate` literals (10.0 / 9.09 / 0.091) that
 * nothing read — the executors had already moved to measuring the experiment —
 * so the file advertised numbers that did not match any run. Every delay figure a
 * reader sees is produced by {@link measureOutcome} from an actual experiment, and
 * the identity fields here are what that experiment is measuring between.
 *
 * It is NOT the run's research: the title, the claim, the measured quantity and the section
 * skeleton are fields of `ctx.runCtx.studyPlan` (`runner/study-plan.ts`), which is what a
 * deployment states. What is left here is the measurement apparatus's own naming — the two
 * compositions it compares, the venue A4 falls back to, and the dataset file — which no plan
 * chooses.
 */
export const SCENARIO = {
  baselineIdentity: 'homogeneous-HV-HV-HV',
  variantIdentity: 'mixed-HV-AV-HV',
  venueId: 'syn-venue-trc-001',
  venueName: 'Synthetic TRC-style Transport Venue',
  // The study's own scenario file, so the fallback reference names the study's dataset
  // rather than a synthetic placeholder.
  datasetId: 'case-pack-traffic/claim.json',
} as const

/** Writer-section model shared by D2/D3/D4/E1 (paper-outline → manuscript →
 *  the same manuscript with its revision applied → typeset). Plain data; deterministic. */
interface ManuscriptSection extends PlanSection {
  readonly bodyText: string
}

// ── Producer brands (read from the tools' own id/version constants) ─────────────
const A1_PRODUCER = `${LITERATURE_SEARCH_TOOL_ID}@${LITERATURE_SEARCH_TOOL_VERSION}`

/** A1's offline gap statement, emitted only when no model writer is injected.
 *  It is a fixture constant, never a finding — the artifact labels it `fixture`. */
/**
 * A1's offline gap statement, NAMED BY THE RUN'S OWN SUBJECT.
 *
 * It used to be a constant about mixed platoons, so a queueing run's landscape scan reported a gap in
 * somebody else's field — and the gap is what A2 answers with its claim, so the run's whole argument
 * came from a sentence about a study it was not conducting.
 *
 * @param plan - the research this run carries.
 * @returns the gap a deployment with no writer records.
 */
function fixtureGapStatement(plan: StudyPlan): string {
  return `no published SOTA figure for ${plan.metric.label} is anchored for ${plan.direction}`
}
const A2_PRODUCER = `${CLAIM_CONSTRUCT_TOOL_ID}@${CLAIM_CONSTRUCT_TOOL_VERSION}`
const A3_PRODUCER = 'fixture:agenda'
// A4 matches the venue against A1's retrieved records and B2 verifies the dataset's bytes on
// disk; both are computations THIS package performs over its inputs, not fixture tables. They
// carried `fixture:*` brands while their registry kind said `local_computation` and their own
// artifacts said `fixture: false` — the defect the B3/C1/C2 comment below describes, in the two
// entries it was not applied to. An independent audit found them by comparing the brand against
// the artifact it was stamped on.
const A4_PRODUCER = 'venue-match:most-frequent'
const B1_PRODUCER = 'fixture:method'
const B2_PRODUCER = 'dataset:on-disk-verification'
// The baseline, the MVP measurement and the convergence dossier are computed by
// THIS package's experiment and convergence modules, not by a registered tool and
// not by a fixture table. Naming them `fixture:*` understated what ran and made the
// artifact brand contradict the artifact's own `fixture: false`.
// THE STUDY STAMPS ITS OWN BRAND, and this table cannot know which study a run is conducting. These
// are the SHAPE of the brand — `<implementation>:<what it measured>` — and the executor stamps the
// adapter's, so a queueing run's baseline artifact says `service-latency-sim:baseline` rather than
// naming a simulator that did not run. A literal here would be a static declaration contradicting the
// artifact it describes, which is the drift the registry's `basis` fields exist to prevent.
const B3_PRODUCER = '<implementation>:baseline'
const C1_PRODUCER = '<implementation>:mvp'
const C2_PRODUCER = 'convergence:trinity-loop'
const C3_PRODUCER = `${ABLATION_TOOL_ID}@${ABLATION_TOOL_VERSION}`
const D1_PRODUCER = `${FIGURE_TOOL_ID}@${FIGURE_TOOL_VERSION}`
const D2_PRODUCER = 'fixture:framework'
// D3's shipped path writes its prose from this package's fixture sentences AND renders the
// manuscript's results table with the real three-line-table tool, so it is branded with the tool it
// executes rather than `fixture:*` — a `fixture:` brand beside `real_tool_fixture_input` is the
// two-sided contradiction the registry's brand check refuses (`runner-registry.spec.ts`).
const D3_PRODUCER = `${THREE_LINE_TABLE_TOOL_ID}@${THREE_LINE_TABLE_TOOL_VERSION}`

/**
 * The version of the record a prose request leaves behind.
 *
 * A LOG ENTRY IS READ AGAINST THE SHAPE THAT PRODUCED IT, so the shape carries a version: what a
 * request recorded in v1 (the instruction, the evidence names, the citation roster with the version
 * of each passage) is a different set of facts from what a later one might, and a reader comparing
 * two runs has to be able to tell which they are holding.
 */
const PROSE_REQUEST_VERSION = 'prose-request-v2'

const D4_PRODUCER = 'fixture:rebuttal'

// E1 runs no catalogue tool and is not the fixture either: it renders the document the writing steps
// produced and packages what one compile made of it, so its brand names that work. It used to carry
// the three-line-table brand, which was true while the table was rendered here and became a claim
// about a tool this step no longer invokes.
const E1_PRODUCER = 'render:typeset-package'

/**
 * The VERSION of the passage one cite key's judgement rests on, or null when nothing establishes it.
 *
 * The evidence version is what a request recorded and what a later judgement is checked against, so a
 * refusal for `citation-evidence-changed` can be traced back to the request that was answered with a
 * sentence resting on the old passage.
 *
 * @param citeKey - the key the manuscript cites.
 * @param judgements - what the reviewed corpus establishes now.
 * @returns the passage's hash, or null.
 */
function judgementVersionOf(
  citeKey: string,
  judgements: ReadonlyArray<SourceJudgement>,
): string | null {
  return judgements.find(judgement => judgement.citeKey === citeKey)?.quoteSha256 ?? null
}

/** Artifact type carried by each declared output slug (audit vocabulary). */
const ARTIFACT_TYPE_BY_SLUG: Readonly<Record<string, string>> = {
  'landscape-map': 'literature-landscape',
  'gap-list': 'research-gap-list',
  'claim': 'claim-record',
  'falsifiable-prediction': 'falsifiable-prediction',
  'agenda': 'research-agenda',
  'contribution-list': 'contribution-list',
  'venue': 'venue-selection',
  'venue-scope': 'venue-scope-match',
  'method-spec': 'method-specification',
  'method-predictions': 'measurable-prediction-set',
  'dataset': 'dataset-descriptor',
  'data-profile': 'data-profile',
  // T19-S fix: baseline-results is a BASELINE measurement set, never an ablation set.
  'baseline-results': 'baseline-measurement-set',
  'sota-comparison': 'sota-comparison-note',
  'mvp-results': 'experiment-result-set',
  // The run's measured result, written by C1 and read by every step that reports a number.
  'result-version': 'result-version',
  'converged-verdict': 'convergence-verdict',
  'ablation-results': 'ablation-measurement-set',
  'boundary-map': 'boundary-map',
  'figure-plan': 'figure-render-plan',
  'paper-outline': 'paper-outline',
  'manuscript': 'manuscript-draft',
  'rebuttal': 'rebuttal-record',
  // What E1 renders: the assembled Markdown package and what one compile produced from the
  // document. The DOCUMENT itself is `manuscript` above — one document, one slug.
  'typeset': 'typeset-package',
  'submission-record': 'submission-record',
}

// ── Core step definitions (single source of the graph; deep-frozen clones) ──────
const STEP_DEFS: ReadonlyArray<StepDefinition> = getStepDefinitions()

/** Slugs produced by SOME step — anything else in an `inputs` list is a run seed. */
const PRODUCED_SLUGS: ReadonlySet<string> = new Set(STEP_DEFS.flatMap(d => [...d.outputs]))

function inputSchemaOf(def: StepDefinition): ReadonlyArray<InputSpec> {
  return def.inputs.map(slug => ({
    slug,
    source: PRODUCED_SLUGS.has(slug) ? 'upstream-artifact' : 'run-seed',
  }))
}

function outputSchemaOf(def: StepDefinition): ReadonlyArray<OutputSpec> {
  return def.outputs.map(slug => ({
    slug,
    artifactType: ARTIFACT_TYPE_BY_SLUG[slug] ?? 'unclassified-artifact',
  }))
}

function gateRequirementOf(def: StepDefinition): GateRequirement {
  const description = def.humanGate
    ? 'human approval only (empty machine gate; NEVER auto-approved)'
    : `${def.gate.join('+')} — every component must reach outcome 'passed'`
  return { components: def.gate, humanGate: def.humanGate, description }
}

// ── Shared executor helpers ─────────────────────────────────────────────────────

/** Read an upstream artifact as a plain record (undefined when absent/primitive). */
function readInput(ctx: ExecCtx, slug: string): Record<string, unknown> | undefined {
  const value = ctx.getInput(slug)
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * Read a claim field the Case Pack supplied, failing loudly when it is absent.
 *
 * A pack that omits one of these is incomplete, and the run must stop rather than
 * continue with a claim whose falsifiability has a hole in it.
 *
 * @param claim - the `case-pack-claim` run input.
 * @param field - the field name to read.
 * @returns the field's text.
 * @throws {Error} when the field is absent or empty.
 */
function requiredClaimField(claim: Record<string, unknown>, field: string): string {
  const value = claim[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `[A2-claim] the selected Case Pack's claim is missing "${field}" `
      + '(an incomplete claim cannot be adjudicated — NO DEFAULT PASS)',
    )
  }
  return value
}

/**
 * The bar the run's claim DECLARES, as artifact text: the comparison its bound names, and the number.
 *
 * Several artifacts describe the bar the experiment has to clear. They used to hardcode "5%", the
 * fixture prediction's number, so a run whose claim committed to 11% published artifacts promising
 * 5%. The bar is whatever the claim declares — a DECLARED field, not a number read out of its
 * sentence, for the reason `PredictionCommitment.thresholdPct` gives — and a claim that declares
 * none says so here rather than having one invented for it.
 *
 * THE OPERATOR IS PART OF THE BAR, and it is read from `bound`. The three call sites used to spell
 * ">=" themselves while this returned only the number, so a pack declaring `at-most` or `within`
 * published artifacts promising "gain >= 20%" while the C gate graded "<= 20%" or "|change| <= 20%".
 * Measured by changing only `bound` on the shipped pack: the artifacts still read ">= 20%" and the
 * same −38.20% run was recorded SUPPORTED.
 *
 * @param commitment - the claim's declared commitment, or undefined when it declared none.
 * @returns the declared comparison, or a parenthesized phrase saying none was declared.
 */
function thresholdLabel(commitment: PredictionCommitment | undefined): string {
  if (commitment === undefined) return '(no declared threshold)'
  // The same message hygiene as the declaration sentence in `evaluatePrediction`: a non-finite
  // number would otherwise be printed as ">= NaN%" in three artifacts. This decides only the label:
  // the value is refused by the two readers that admit a commitment, and by the C gate's percentage
  // check after them, so a value that bypassed both never reaches anything this label describes.
  // Written as the same predicate `platoon-sim.ts` uses, so the two cannot drift.
  if (typeof commitment.thresholdPct !== 'number' || !Number.isFinite(commitment.thresholdPct)) {
    return '(no declared threshold)'
  }
  const operator =
    commitment.bound === 'at-least' ? '>=' : commitment.bound === 'at-most' ? '<=' : 'within'
  return `${operator} ${String(commitment.thresholdPct)}%`
}

/**
 * The sentence that states where this work sits in the literature, from the bindings the run holds.
 *
 * WRITTEN FROM THE REVIEWED JUDGEMENTS, NOT FROM THE RETRIEVAL. Each clause is one reviewed source
 * with the marker its citation carries, and the clause says what the reviewer found — including the
 * sources that do NOT support the claim, because a literature position that omits them is a position
 * the reader cannot check. A run with no reviewed source says so rather than asserting a position.
 *
 * @param citations - the bindings this run holds.
 * @returns the sentence, with one citation marker per source.
 */
function priorWorkSentence(judgements: ReadonlyArray<SourceJudgement>): string {
  if (judgements.length === 0) {
    return 'No reviewed source bears on the condition this study varies, so this work is not placed'
      + ' against prior findings.'
  }
  const clauses = judgements.map((judgement) => {
    const marker = `[@${judgement.citeKey}]`
    return judgement.support === 'contradicted'
      ? `a reviewed source reports the opposite of the claim under test ${marker}`
      : `a reviewed source reports the mechanism this study varies ${marker}`
  })
  return `Prior work on this quantity does not point one way: ${clauses.join(', and ')}.`
}

/**
 * The reference list D3 puts in the draft: the sources the paper's statements cite.
 *
 * IT IS DERIVED FROM CITATIONS, NOT FROM THE RETRIEVAL. This function used to be `buildReferences`,
 * which turned every record the landscape scan returned into an entry — so the delivered paper's
 * reference list was the search log, twenty-five works with no sentence citing any of them, and the
 * three works the run had actually read and judged were not necessarily in it at all. The retrieval
 * stays where it belongs, as the library a study draws from; an entry appears here because a binding
 * puts it in the manuscript.
 *
 * @param citations - the bindings this manuscript's statements rest on.
 * @returns one entry per cited source, in cite-key order, each carrying the key it is cited under.
 */
function referenceEntriesFor(
  citations: ReadonlyArray<CitationUse>,
  from?: ReadonlyMap<string, SourceRecord>,
): ReadonlyArray<Record<string, unknown>> {
  const { entries, unresolvable } = bibliographyOf(citations, from ?? reviewedSources())
  if (unresolvable.length > 0) {
    // A CITED SOURCE THE DEPLOYMENT HAS NO RECORD OF cannot be printed. Reaching here means a binding
    // names something the reviewed corpus does not hold, which the binding check refuses earlier; the
    // throw is here so a bug upstream cannot become a reference list with a hole in it.
    throw new Error(
      `[D3-writing] ${unresolvable.join(', ')} are cited but not held by the reviewed corpus`,
    )
  }
  return entries.map(source => ({
    citeKey: citeKeyOf(source),
    title: source.title,
    venue: source.venue ?? null,
    identifier: `${source.ref.kind}:${source.ref.id}`,
    authors: source.authors,
    year: source.year ?? null,
  }))
}

/**
 * The obligations one section owes, written as the instruction a writer can follow.
 *
 * AN OBLIGATION THE WRITER IS NOT TOLD IS AN OBLIGATION IT CANNOT DISCHARGE, and E1 refuses the
 * manuscript for it. The words are the obligation's own statement — the same text the refusal quotes
 * — so what the writer was asked for and what it is judged against cannot be two different things.
 *
 * @param plan - the argument plan the draft is written under.
 * @param sectionId - the section about to be written.
 * @returns one sentence per obligation, or an empty string for a section that owes none.
 */
function obligationsInstructionOf(plan: ArgumentPlan, sectionId: string): string {
  const contract = plan.sections.find(section => section.id === sectionId)
  if (contract === undefined || contract.obligations.length === 0) return ''
  return `This section must ${contract.obligations.map(o => o.statement).join('; and must ')}. `
}

/**
 * The prose route a step's text came from, as the artifact records it.
 *
 * A `*Source: 'model'` label used to be the whole claim, and it proved only that a
 * `ResearchProseWriter` object had been injected — any `{ write() }` satisfies the
 * interface, including a test stub. The writer's own result carries the provider
 * and model that produced the text, so the artifact can name the route instead of
 * asserting a category. It still does not PROVE a model ran; it records which one
 * the configuration said to use, which is what a reader can check against the
 * deployment.
 *
 * @param result - the writer's result for this step.
 * @returns the recorded route, or a phrase saying the built-in text was used.
 */
function proseRouteOf(result: { readonly provider: string; readonly model: string } | undefined): Record<string, unknown> {
  if (result === undefined) {
    return { producer: 'built-in fixture text (no prose writer configured)' }
  }
  return { producer: `configured prose writer: ${result.provider}/${result.model}` }
}

/**
 * The execution that WROTE the answers, as this side records it.
 *
 * MINTED HERE, and that is the point: `resolution-verifier.ts` compares executions, so an identity a
 * model could state for itself would be worthless — a verifier that named its own would pass any
 * check written against the name. The id and the session are this run's; the route is recorded beside
 * them so a reader can see whether a single model wrote and reviewed, which is a shared-bias risk the
 * user's ruling says to RECORD rather than to refuse.
 *
 * @param result - what the prose write resolved with.
 * @returns the author's execution identity for this round.
 */
function modelExecution(result: { readonly provider: string; readonly model: string }): ExecutionIdentity {
  return {
    executionId: `author-${randomUUID()}`,
    // THE AUTHOR'S OWN SESSION: the prose writer creates one per call, and this names the same run
    // the answers were written in. A verifier handed this session would be continuing the author's
    // own defence of the revision, which is the condition `verification-same-session` refuses.
    sessionId: `research-prose-${randomUUID()}`,
    role: 'prose-author',
    instructionsVersion: AUTHOR_INSTRUCTIONS_VERSION,
    provider: result.provider,
    model: result.model,
  }
}

/**
 * An execution identity for a round whose answers the built-in text wrote.
 *
 * The fixture route runs no model, so the identity says so: it names the fixture as the writer, and a
 * verifier sharing nothing with it is the ordinary case rather than a diversity question.
 *
 * @param producer - what wrote the answers.
 * @param instructionsVersion - the rules the author was given.
 * @returns the author's execution identity for this round.
 */
function fixtureExecution(producer: string, instructionsVersion: string): ExecutionIdentity {
  return {
    executionId: `${producer}-${randomUUID()}`,
    sessionId: `${producer}-session-${randomUUID()}`,
    role: 'prose-author',
    instructionsVersion,
    provider: 'fixture',
  }
}

/**
 * The version of the instructions the AUTHORING role is given.
 *
 * A string, not a date: "the same rules" is what makes two executions the same task, and two runs on
 * one day are two runs. A deployment that changes what it asks its author to do changes this, and
 * verifications taken under the old rules stop matching the ones the new author produces.
 */
const AUTHOR_INSTRUCTIONS_VERSION = 'd4-author-instructions-1'

/**
 * The research this run carries.
 *
 * Every executor reads the study through the run context rather than through module constants.
 * The title, the claim, the measured quantity and the section skeleton are the RUN's, which is
 * what lets a deployment state what it is producing instead of producing this file's one study.
 *
 * @param ctx - the executor or verdict context.
 * @returns the plan the run was started with.
 */
export function planOf(ctx: { readonly runCtx: RunContext }): StudyPlan {
  return ctx.runCtx.studyPlan
}

/**
 * A metric direction in the spelling the ablation tool's schema requires.
 *
 * The plan states the direction once; the tools that consume it each spell it their own way, and
 * those schemas are external contracts rather than names this module may change. Written as a
 * conversion rather than a second plan field so the two cannot disagree about the direction.
 *
 * @param metric - the quantity the claim is about.
 * @returns the direction as the ablation definition spells it.
 */
function ablationDirectionOf(metric: MeasuredMetric): 'higher_is_better' | 'lower_is_better' {
  return metric.direction === 'higher-is-better' ? 'higher_is_better' : 'lower_is_better'
}

/**
 * The plan facts every prose request carries.
 *
 * The steps already hand the writer the claim and the prediction; what none of them handed it was
 * the research the run is ABOUT, so a section could be written as though the study were someone
 * else's. Spread into each request's `context`.
 *
 * @param plan - the run's plan.
 * @returns the subject fields a writer request carries.
 */
function planContextOf(plan: StudyPlan): Record<string, unknown> {
  return { field: plan.field, direction: plan.direction }
}

/**
 * The claim identity every artifact carries, falling back to the plan's own.
 *
 * @param ctx - the executor context.
 * @returns the claim id, reference and prediction the run is committed to.
 */
function canonicalOf(ctx: ExecCtx): {
  readonly claimId: string
  readonly claimRef: string
  readonly predictionText: string
} {
  const plan = planOf(ctx)
  return {
    claimId: ctx.runCtx.claimId || plan.claim.id,
    claimRef: ctx.runCtx.claimRef || plan.claim.ref,
    predictionText: ctx.runCtx.predictionText || plan.claim.prediction,
  }
}

/** Section list of a manuscript-shaped artifact, with a deterministic fallback. */
function sectionsOf(
  input: Record<string, unknown> | undefined,
  plan: StudyPlan,
  ctx: ExecCtx,
): ReadonlyArray<ManuscriptSection> {
  const raw = input?.sections
  if (Array.isArray(raw) && raw.length > 0) {
    const sections: ManuscriptSection[] = []
    for (const item of raw) {
      const s = item as { id?: unknown; heading?: unknown; bodyText?: unknown }
      if (typeof s.id === 'string' && typeof s.heading === 'string') {
        sections.push({
          id: s.id,
          heading: s.heading,
          bodyText: typeof s.bodyText === 'string' ? s.bodyText : `(synthetic body for ${s.id})`,
        })
      }
    }
    if (sections.length > 0) return sections
  }
  return defaultBodySections(plan, ctx)
}

/**
 * The numbers this step reports, preferring the run's own `result-version` record.
 *
 * The optional `ctx` is what makes the difference: with a run context the record is read from the
 * run, and without one (a step driven alone, a pure helper) the study is measured here. The
 * returned `source` says which happened, so a consumer can state it and a test can assert it.
 */
function measureOutcomeWithSource(ctx?: ExecCtx): {
  readonly measured: MeasuredOutcome
  readonly source: ResultSource
  readonly contentHash: string
} {
  const recorded = ctx === undefined ? undefined : ctx.getInput(RESULT_VERSION_SLUG)
  const record = readResultVersion(recorded)
  if (record !== undefined) {
    return { measured: record.measured, source: 'result-version', contentHash: record.contentHash }
  }
  // No record: this step was driven without its producer, so it measures the study itself and the
  // artifact it writes says so. In a driven run this branch is a defect, and `resultSource` on the
  // artifacts is what makes it visible rather than an assumption that the numbers agree.
  const adapter = ctx?.runCtx.adapter ?? platoonAdapter(experimentStudy())
  return { measured: adapter.measure().measured, source: 'recomputed', contentHash: '' }
}

/**
 * The run's measured outcome, rounded to the precision the manuscript reports.
 *
 * @param ctx - the run, when the caller has one; the record is read from it.
 * @returns the study's measured outcome: both arms, the change between them and whatever else the
 *   implementation reported.
 */
function measureOutcome(ctx?: ExecCtx): MeasuredOutcome {
  return measureOutcomeWithSource(ctx).measured
}

/**
 * The fallback section prose, generated FROM the experiment's own parameters.
 *
 * These sentences used to be written by hand, and the method section kept describing
 * the design the experiment had BEFORE it changed: it said the two policies ran on
 * "the same cycle length", while the measured reduction comes precisely from the
 * adaptive policy being allowed a different cycle. A hand-written description of a
 * code path is a claim that expires silently, so the parameters are interpolated
 * here and the numbers come from {@link measureOutcome}.
 *
 * @param id - the section id from the outline.
 * @param plan - the run's plan, which states the claim and the prediction this text quotes.
 * @param measured - the run's measured outcome, so no section quotes a number the
 *   exhibits do not show.
 * @param referenceCount - entries the draft carries for the reference list.
 * @returns the section body.
 */
function derivedArgumentPlan(plan: StudyPlan, ctx: ExecCtx): ArgumentPlan {
  const commitment = ctx.runCtx.commitment
  return argumentPlanOf({
    question: plan.direction,
    claimRef: plan.claim.ref,
    metricLabel: plan.metric.label,
    measuredPct: measureOutcome(ctx).improvementPct,
    committedDirection: commitment?.direction ?? 'increase',
    ...(commitment === undefined ? {} : { thresholdPct: commitment.thresholdPct }),
    sectionIds: plan.outline.map(s => s.id),
  })
}

/**
 * Deterministic fallback body for every outline section id.
 *
 * The bindings default to none, and a caller that has them passes them: the fallback exists for the
 * paths that build sections without a draft (D4's revised draft reading a stored one), where a
 * citation roster would be invented rather than read.
 */
function defaultBodySections(
  plan: StudyPlan,
  ctx: ExecCtx,
  judgements: ReadonlyArray<SourceJudgement> = [],
): ReadonlyArray<ManuscriptSection> {
  return plan.outline.map(s => ({
    id: s.id,
    heading: s.heading,
    // THE STUDY WRITES ITS OWN SECTIONS. Which nouns a result sentence uses, what the method section
    // says was run, and what the experiments section reports are facts about the study — so they come
    // from the adapter rather than from a template this file would have to keep in step with it.
    bodyText: ctx.runCtx.adapter.body(s.id, proseContext(plan, ctx, judgements)),
  }))
}

/**
 * What one section's fallback prose is written from.
 *
 * The roster is the labels D1 planned, read off the figure plan the run holds: a fallback whose
 * sections named nothing would be refused by the A gate for carrying floats nothing refers to. The
 * prior-work sentence comes from the citation bindings, with one marker per source, so the fallback
 * prose cites what the run actually reviewed rather than asserting a position.
 *
 * @param plan - the research the run carries.
 * @param ctx - the step's context.
 * @param citations - the bindings this run holds, or none where this path has none.
 * @returns the input the adapter's `body` takes.
 */
function proseContext(
  plan: StudyPlan,
  ctx: ExecCtx,
  judgements: ReadonlyArray<SourceJudgement>,
): StudyProse {
  const figurePlan = readInput(ctx, 'figure-plan')
  const floats = planFloats(
    Array.isArray(figurePlan?.figures) ? (figurePlan.figures as ReadonlyArray<FigurePlanEntry>) : [],
  )
  // THE NUMBERED ITEMS THE PROSE MAY NAME: this draft's floats, then the study's equations, which
  // E1 states inside the method section. A section that names an equation names one this run's own
  // implementation computed — see `citableFloats`.
  const citable = citableFloats(floats, ctx.runCtx.adapter.implementation.equations)
  return {
    plan,
    measured: measureOutcome(ctx),
    argumentPlan: derivedArgumentPlan(plan, ctx),
    citations: judgements,
    named: (kind: string) =>
      citable.filter(item => item.label.toLowerCase().startsWith(kind))
        .map(item => item.label)
        .join(', '),
    priorWork: priorWorkSentence(judgements),
  }
}

// ── Real-tool executors (real tool function, synthetic fixture input) ───────────

/** A1-landscape: real `runLiteratureSearch` over the synthetic mock adapter. */
async function a1Executor(ctx: ExecCtx): Promise<Record<string, unknown>> {
  const invoker = ctx.invoker ?? new DirectResearchToolInvoker('a1-fixture')
  // The retrieval channel is a deployment fact: when the Cordis adapter assembled
  // real deps, A1 retrieves the live catalogue; otherwise it stays on the fixture.
  const deps = ctx.toolDeps ?? { literatureAdapter: mockLiteratureSearchAdapter }
  const liveCorpus = deps.literatureAdapter !== undefined
    && deps.literatureAdapter !== mockLiteratureSearchAdapter
  const invocation = await invoker.invoke(
    'literature-search',
    { topic: planOf(ctx).direction },
    { timestamp: FIXED_TS, deps },
  )
  if (!invocation.ok) {
    throw new Error(`[A1-landscape] literature-search invocation failed: ${invocation.message}`)
  }
  const artifact = invocation.artifact as Awaited<ReturnType<typeof runLiteratureSearch>>

  // An OUTAGE is not an empty result set. The tool already distinguishes them in
  // its own contract (`unavailable` vs `ok` with zero hits), and this step used to
  // ignore that distinction: it emitted a landscape-map and a gap list either way,
  // so a dead catalogue produced a pass whose artifact still said the corpus was
  // live. A landscape built from no records is a fabricated one, so the step fails
  // instead (NO DEFAULT PASS) — the same posture the tool itself takes.
  if (artifact.outcome === 'unavailable') {
    // THE ADAPTER'S OWN REASON TRAVELS WITH THE REFUSAL. It did not before, and the cost was a
    // browser run that failed with "the catalogue is UNAVAILABLE" and nothing a reader could act
    // on: an HTTP 403, a rate limit, a DNS failure and a refused venue filter all read identically,
    // and the reproduction from outside the app process succeeded every time. The tool already
    // distinguishes them; dropping the detail here threw that away at the last step.
    const detail = (artifact as { detail?: unknown }).detail
    throw new Error(
      '[A1-landscape] the retrieval adapter reported its catalogue UNAVAILABLE'
      + (typeof detail === 'string' && detail.length > 0 ? `: ${detail}` : '')
      + '. An outage is not "no literature found", and a landscape derived from no records would be '
      + 'invented (NO DEFAULT PASS)',
    )
  }

  // A LIVE CORPUS THAT ANSWERED AND MATCHED NOTHING IS NOT A LANDSCAPE EITHER, and the doctrine
  // above only reached the outage. A retrieval that SUCCEEDS with zero hits passed A1, and the
  // emptiness surfaced five steps later at D3-writing as a blocked step whose stated reason was a
  // missing references section: writing a bibliography is the CONSEQUENCE, and the cause — this
  // topic matched nothing in the deployment's corpus — was in no artifact at all. The remedies are
  // different, so the two facts must not read alike: an outage is the network, and this is the topic
  // or the corpus the deployment names.
  if (liveCorpus && artifact.hits.length === 0) {
    throw new Error(
      `[A1-landscape] the live catalogue answered for the topic "${artifact.query.topic}" and matched`
      + ' no records at all — the retrieval succeeded with an empty corpus (NOT an outage, so the'
      + ' network is not what to look at). Either the topic as worded matches nothing in the corpus'
      + ' this deployment names, or that corpus does not hold this literature; a landscape built from'
      + ' no records would be invented (NO DEFAULT PASS)',
    )
  }

  // A1's second product is the gap analysis, and it must derive from the records
  // just retrieved. Without a writer it stays the fixture gap so offline runs keep
  // their deterministic output; with one, the model reads the retrieved literature.
  const writer = ctx.proseWriter
  const labelling = proseLabelling(writer)
  let gaps: ReadonlyArray<string>
  let gapSource: 'model' | 'deterministic' | 'fixture'
  let gapKind: Truthfulness = labelling.kind
  let gapRoute: Record<string, unknown> = proseRouteOf(undefined)
  if (writer === undefined) {
    gaps = [fixtureGapStatement(planOf(ctx))]
    gapSource = 'fixture'
    gapKind = 'fixture_executor'
  } else {
    const analysis = await writer.write({
      stepId: 'A1-landscape',
      instruction: `Identify the research gaps that the following papers leave open with respect to "${artifact.query.topic}". Return one gap per line. No numbering, no preamble, no closing commentary.`,
      context: {
        ...planContextOf(planOf(ctx)),
        topic: artifact.query.topic,
        papers: artifact.hits.slice(0, 30).map(hit => ({ title: hit.title, venue: hit.venue })),
      },
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
    })
    gapRoute = proseRouteOf(analysis)
    gaps = analysis.text
      .split('\n')
      .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)\]])?\s*/, '').trim())
      .filter(line => line.length > 0)
    // An empty analysis is not a pass: a step whose whole product is "the gaps"
    // must not report success while carrying none (NO DEFAULT PASS).
    if (gaps.length === 0) {
      throw new Error('[A1-landscape] the gap analysis produced no gaps (NO DEFAULT PASS)')
    }
    // Labelled from the CHANNEL, not from the presence of a writer: the deterministic offline
    // route calls no model, and this artifact's own gap text says so in its first line.
    gapSource = labelling.source
    gapKind = labelling.kind
  }

  return {
    'landscape-map': tagArtifact(
      {
        topic: artifact.query.topic,
        outcome: artifact.outcome,
        hitCount: artifact.hits.length,
        // THE PRE-CAP COUNT TRAVELS WITH THE HITS. The tool derives `truncated` from the adapter's
        // own total, and this artifact dropped it, so a run's record could not tell "the catalogue
        // answered and matched nothing" apart from "the catalogue answered with matches and the
        // adapter's filters dropped every one of them" — the ambiguity that made one real incident
        // undiagnosable after the fact, five steps downstream from the retrieval that caused it.
        truncated: artifact.truncated,
        hits: artifact.hits,
        corpus: liveCorpus ? 'live-catalogue' : 'synthetic-fixture',
        note: liveCorpus
          ? 'landscape-map produced by a REAL runLiteratureSearch execution over a LIVE catalogue'
          : 'landscape-map produced by a REAL runLiteratureSearch execution over a SYNTHETIC corpus — not real literature',
      },
      A1_PRODUCER,
      // A live catalogue is an external system this host actually reached, so the
      // record says so. The static ENTRY_SPECS kind cannot know which channel the
      // deployment configured; the artifact can, and this is the one the report
      // reads.
      liveCorpus ? 'live_external' : 'real_tool_fixture_input',
      { provenance: invocation.provenance, invokerTruthfulness: invocation.truthfulness },
    ),
    'gap-list': tagArtifact(
      {
        gaps,
        gapSource,
        // The level that goes with `gapSource`, recorded beside it because this ONE artifact
        // combines two producers: the corpus (below) and the prose that wrote the gaps. A single
        // level on the artifact describes the corpus, so without this a reader had no way to see
        // that the deterministic offline route produced the text and called no model.
        gapKind,
        // Two different producers meet in this artifact and the labels keep them
        // apart: `corpusSource` says where the literature came from, `gapSource`
        // says who wrote the gaps. On the default path they DISAGREE — a live
        // corpus with fixture gaps — and a single "source" field used to paper
        // over exactly that.
        corpusSource: liveCorpus
          ? 'live catalogue via the configured retrieval adapter'
          : 'synthetic literature adapter (mockLiteratureSearchAdapter)',
        gapProducer: gapRoute,
      },
      A1_PRODUCER,
      liveCorpus ? 'live_external' : 'real_tool_fixture_input',
      { provenance: invocation.provenance, invokerTruthfulness: invocation.truthfulness },
    ),
  }
}

/** A2-claim: real `constructClaim` producing a claim + falsifiable prediction. */
/**
 * Read one labelled field out of a model response.
 *
 * The runner asks for `LABEL: value` lines rather than JSON: a model that wraps its
 * answer in prose or a code fence still yields a parseable field, whereas a brittle
 * JSON parse would fail the step for a formatting reason that carries no meaning.
 *
 * @param text - the model's response.
 * @param label - the upper-case field label to look for.
 * @returns the trimmed value, or undefined when the label is absent or empty.
 */
/**
 * Does this value look like the template placeholder rather than an answer?
 *
 * The prompts ask for `LABEL: <what to write>`. A model that echoes the template
 * produces a non-empty value for every field, so a presence check alone accepts it
 * and the placeholder flows downstream as if it were content. Matching the
 * placeholder shape is what stops that.
 *
 * @param value - the parsed field value.
 * @returns true when the value is a bracketed placeholder or a bare filler word.
 */
export function looksLikePlaceholder(value: string): boolean {
  const trimmed = value.trim()
  if (/^<[^>]*>$/.test(trimmed)) return true
  return /^(?:tbd|todo|xxx|n\/a|none|null|\.\.\.)$/i.test(trimmed)
}

/**
 * Read one labelled field out of a model response.
 *
 * The runner asks for `LABEL: value` lines rather than JSON: a model that wraps its
 * answer in prose or a code fence still yields a parseable field, whereas a brittle
 * JSON parse would fail the step for a formatting reason that carries no meaning.
 *
 * The label must be followed by a separator (`:` or `=`), so `ASSERTIONX: stray` is
 * not read as `ASSERTION` with the value `X: stray`.
 *
 * @param text - the model's response.
 * @param label - the upper-case field label to look for.
 * @returns the trimmed value, or undefined when the label is absent or empty.
 */
export function labelledField(text: string, label: string): string | undefined {
  for (const line of text.split('\n')) {
    // Strip a leading bullet or list number, then require the label to be followed
    // by a separator: without that, `ASSERTIONX: stray` reads as ASSERTION with the
    // value `X: stray`, inventing a field from a different word.
    const trimmed = line.replace(/^\s*(?:[-*•]|\d+[.)\]])?\s*/, '').trim()
    // Models frequently emphasise the label (`**ASSERTION:**`). Accept the emphasis
    // rather than failing the step over decoration the field still carries.
    const separator = new RegExp(`^\\**\\s*${label}\\s*[:=]\\s*\\**\\s*(.*)$`, 'i').exec(trimmed)
    if (separator === null) continue
    const value = (separator[1] ?? '').trim()
    if (value.length > 0 && !looksLikePlaceholder(value)) return value
  }
  return undefined
}

async function a2Executor(ctx: ExecCtx): Promise<Record<string, unknown>> {
  const invoker = ctx.invoker ?? new DirectResearchToolInvoker('a2-fixture')

  // The claim is the answer to A1's gap, so it must be derived from that gap when a
  // model is available. With no writer it stays the fixture claim, keeping the
  // offline pipeline deterministic.
  const writer = ctx.proseWriter
  const gapsArtifact = readInput(ctx, 'gap-list')
  const gaps = Array.isArray(gapsArtifact?.gaps)
    ? (gapsArtifact.gaps as ReadonlyArray<unknown>).filter((g): g is string => typeof g === 'string')
    : []

  const plan = planOf(ctx)
  let assertion = plan.claim.assertion
  let essentialDifference = plan.claim.essentialDifference
  let experimentToFalsify = plan.claim.experimentToFalsify
  let prediction = plan.claim.prediction
  let claimSource: 'model' | 'deterministic' | 'fixture' | 'case-pack' = 'fixture'
  let claimRoute: Record<string, unknown> = proseRouteOf(undefined)
  // What the claim is ABOUT. Only a claim that declares the quantity this study measures can be
  // adjudicated by it; the plan's claim declares it because its own prediction text names it.
  let metricKey = plan.metric.key
  // The plan's declared commitment, matching the sentence it carries — see `StudyPlan.commitment`.
  let commitment: PredictionCommitment | undefined = plan.commitment

  // A SELECTED Case Pack is the authority for this run's claim. It is curated fixture
  // content, and it is preferred over the model because the pack is what the run was
  // started with: deriving a different claim from the model would make the run's product
  // disagree with its own input set. Both paths record which one supplied the claim.
  const packScenario = ctx.getInput(CASE_PACK_INPUT_SLUGS.scenario)
  const packClaim = readInput(ctx, CASE_PACK_INPUT_SLUGS.claim)
  const callerPlan = ctx.runCtx.planSource === 'caller'
  if (packClaim !== undefined && callerPlan) {
    // THE PLAN OWNS THE CLAIM; the pack is skipped. It still supplies the scenario read just above
    // and the scope and sources read below, so the run measures and reviews exactly what the pack
    // declares — what it does not do is replace the claim a person confirmed with its own.
    claimSource = writer === undefined ? 'fixture' : proseLabelling(writer).source
    claimRoute = {
      source: 'caller-plan',
      casePackId: packClaim.casePackId,
      packClaimSkipped: true,
    }
  } else if (packClaim !== undefined) {
    assertion = requiredClaimField(packClaim, 'assertion')
    essentialDifference = requiredClaimField(packClaim, 'essentialDifference')
    experimentToFalsify = requiredClaimField(packClaim, 'experimentToFalsify')
    prediction = requiredClaimField(packClaim, 'prediction')
    // A pack that declares no metric leaves the claim unbindable, and the C channel then HOLDS
    // rather than grading it. That is the honest outcome for a claim this study cannot test.
    metricKey = typeof packClaim.metricKey === 'string' ? packClaim.metricKey : ''
    // Read from the pack's declared block, validated by shape. Anything else is the claim
    // declining to say which way its quantity should move, which the C channel holds on.
    commitment = commitmentFrom(packClaim.commitment)
    claimSource = 'case-pack'
    claimRoute = {
      source: 'case-pack',
      casePackId: packClaim.casePackId,
      truthfulness: packClaim.truthfulness,
      derivedFrom: packClaim.derivedFrom,
    }
  } else if (writer !== undefined) {
    const analysis = await writer.write({
      stepId: 'A2-claim',
      instruction: [
        'Answer ONE of the research gaps below with a falsifiable central claim.',
        'Reply with exactly these four lines and nothing else:',
        'ASSERTION: <one sentence claim>',
        'DIFFERENCE: <what makes this essentially different from prior work>',
        'EXPERIMENT: <the experiment that would falsify it>',
        'PREDICTION: <the measurable prediction, with a numeric threshold>',
      ].join('\n'),
      context: { ...planContextOf(planOf(ctx)), gaps },
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
    })
    const parsed = {
      assertion: labelledField(analysis.text, 'ASSERTION'),
      essentialDifference: labelledField(analysis.text, 'DIFFERENCE'),
      experimentToFalsify: labelledField(analysis.text, 'EXPERIMENT'),
      prediction: labelledField(analysis.text, 'PREDICTION'),
    }
    // A claim without a falsifiable prediction cannot pass the C gate, so an
    // unparseable response fails the step here rather than emitting a claim that
    // downstream would have to reject (NO DEFAULT PASS).
    if (
      parsed.assertion === undefined
      || parsed.essentialDifference === undefined
      || parsed.experimentToFalsify === undefined
      || parsed.prediction === undefined
    ) {
      throw new Error(
        '[A2-claim] the model response did not carry ASSERTION/DIFFERENCE/EXPERIMENT/PREDICTION '
        + '(a claim without a falsifiable prediction cannot be adjudicated — NO DEFAULT PASS)',
      )
    }
    assertion = parsed.assertion
    essentialDifference = parsed.essentialDifference
    experimentToFalsify = parsed.experimentToFalsify
    prediction = parsed.prediction
    // From the CHANNEL, not from the writer's existence — same rule as A1.
    claimSource = proseLabelling(writer).source
    // The response format asks for four labelled fields and no metric, so a model-derived claim
    // is unbindable by construction. Widening the format is a separate change; until then the
    // C channel holds rather than grading a claim whose quantity nobody stated.
    metricKey = ''
    claimRoute = proseRouteOf(analysis)
  }

  const invocation = await invoker.invoke(
    'claim-construct',
    {
      assertion,
      claimId: plan.claim.id,
      now: FIXED_TS,
      falsifiability: { essentialDifference, experimentToFalsify },
    },
    { timestamp: FIXED_TS },
  )
  if (!invocation.ok) {
    throw new Error(`[A2-claim] claim-construct invocation failed: ${invocation.message}`)
  }
  const artifact = invocation.artifact as Awaited<ReturnType<typeof constructClaim>>
  // Wire the claim + prediction into the shared context for downstream C-gates.
  // The plan this run is now committed to: the one it was seeded with, with whatever a Case Pack
  // or the model supplied written over it. Downstream steps read the EFFECTIVE plan, so a pack's
  // claim reaches the manuscript's prose rather than only its artifacts.
  ctx.runCtx.studyPlan = {
    ...plan,
    claim: { ...plan.claim, assertion, essentialDifference, experimentToFalsify, prediction },
    metric: metricKey === plan.metric.key ? plan.metric : { ...plan.metric, key: metricKey },
    ...(commitment === undefined ? {} : { commitment }),
  }
  ctx.runCtx.claimId = plan.claim.id
  ctx.runCtx.claimRef = plan.claim.ref
  ctx.runCtx.predictionText = prediction
  ctx.runCtx.metricKey = metricKey
  if (commitment === undefined) delete ctx.runCtx.commitment
  else ctx.runCtx.commitment = commitment
  // The study the experiment will run. The Case Pack's declared scenarios are the run's
  // selected input, so they take precedence; the module's own scenarios are the fallback for a
  // run with no pack. A pack whose scenarios this study cannot read falls back too, and the
  // artifacts then record the module's scenarios rather than pretending the pack was used.
  // ...and the adapter is rebuilt over it in the same assignment, from the EFFECTIVE plan A2 just
  // wrote: a plan whose measured quantity the pack changed must not keep the adapter of the quantity
  // it no longer measures.
  setRunStudy(ctx.runCtx, studyFromPack(packScenario) ?? experimentStudy())
  // The A channel reviews THIS material, so it is populated here, before A2's own gate runs.
  // Every field is what the claim actually states: a field the pack omits stays empty and the
  // review reports the gap rather than smoothing it over.
  ctx.runCtx.claimMaterial = {
    assertion,
    prediction,
    experimentToFalsify,
    // `String(...)` on an `unknown` would stringify an object as '[object Object]' and quietly
    // put that in the material a reviewer reads. A non-string is not a value this field carries,
    // so it is a gap — which is what an empty string means here.
    scope: typeof packClaim?.scope === 'string' ? packClaim.scope : '',
    dataSource: typeof packClaim?.dataSource === 'string' ? packClaim.dataSource : '',
    essentialDifference,
    metricKey,
    truthfulness: typeof claimRoute.truthfulness === 'string' ? claimRoute.truthfulness : '',
    measuredMetricKey: plan.metric.key,
    ...(commitment === undefined ? {} : { commitment }),
    declaredSources: packClaim !== undefined && Array.isArray(packClaim.declaredSources)
      ? (packClaim.declaredSources as ReadonlyArray<string>)
      : [],
  }
  return {
    claim: tagArtifact(
      {
        ...artifact.claim,
        claimSource,
        claimKind: proseKindOf(claimSource),
        metricKey: metricKey === '' ? null : metricKey,
        // The DECLARED commitment rides on the claim, which is what a resume reads it back from.
        // Without it here the artifact would carry the quantity but not the direction, and a
        // resumed run would hold a claim whose own record says which way it moves.
        ...(commitment === undefined ? {} : { commitment }),
      },
      A2_PRODUCER,
      'real_tool_fixture_input',
      { provenance: invocation.provenance, invokerTruthfulness: invocation.truthfulness },
    ),
    'falsifiable-prediction': tagArtifact(
      {
        text: prediction,
        ref: plan.claim.id,
        supportStatus: artifact.claim.supportStatus,
        claimSource,
        // What the claim is about. The C channel adjudicates only when this equals the quantity
        // the experiment measures, so it is the field that decides whether the number below was
        // ever a test of this claim.
        metricKey: metricKey === '' ? null : metricKey,
        measuredMetricKey: plan.metric.key,
        claimRoute,
      },
      A2_PRODUCER,
      'real_tool_fixture_input',
      { provenance: invocation.provenance, invokerTruthfulness: invocation.truthfulness },
    ),
  }
}

/** A3-agenda: fixture shaped as a research agenda + contribution list. */
async function a3Executor(ctx: ExecCtx): Promise<Record<string, unknown>> {
  const { claimRef, predictionText } = canonicalOf(ctx)
  const claim = readInput(ctx, 'claim')

  // The agenda and the contribution list are what the claim commits the study to
  // delivering, so they derive from the claim when a writer is available. With none
  // they stay the built-in fixture, keeping the offline pipeline deterministic.
  const writer = ctx.proseWriter
  let phases: ReadonlyArray<string> = ['A 定位', 'B 构造', 'C 迭代', 'D 论证', 'E 落地']
  let plan: ReadonlyArray<string> = [
    'claim → method → data → baseline → mvp → trinity → boundary → figures → outline → writing → format → submit',
  ]
  // THE CONTRIBUTION IS THE CLAIM, in the run's own words: a contribution list naming another study's
  // finding is a plan for a paper nobody is writing.
  let contributions: ReadonlyArray<{ id: string; statement: string }> = [
    { id: 'c1', statement: planOf(ctx).claim.ref },
  ]
  let agendaSource: 'model' | 'deterministic' | 'fixture' = 'fixture'
  let agendaRoute: Record<string, unknown> = proseRouteOf(undefined)

  if (writer !== undefined) {
    const analysis = await writer.write({
      stepId: 'A3-agenda',
      instruction: [
        'Derive the research agenda and the contribution list that the claim commits this study to delivering.',
        'Reply with exactly these two labelled blocks and nothing else:',
        'PHASES: <phase> | <phase> | <phase>',
        'CONTRIBUTIONS: <one contribution> || <another contribution>',
      ].join('\n'),
      context: {
        ...planContextOf(planOf(ctx)),
        claim: claim?.assertion ?? claimRef,
        prediction: predictionText,
      },
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
    })
    const parsedPhases = labelledField(analysis.text, 'PHASES')
    const parsedContributions = labelledField(analysis.text, 'CONTRIBUTIONS')
    // An agenda with no stages, or a contribution list with nothing in it, is not an
    // agenda — the step fails rather than emitting empty structure (NO DEFAULT PASS).
    if (parsedPhases === undefined || parsedContributions === undefined) {
      throw new Error(
        '[A3-agenda] the model response did not carry PHASES/CONTRIBUTIONS '
        + '(an agenda with no stages and no contributions is not an agenda — NO DEFAULT PASS)',
      )
    }
    const parsedPhaseList = parsedPhases.split('|').map(p => p.trim()).filter(p => p.length > 0)
    const parsedContributionList = parsedContributions
      .split('||')
      .map(c => c.trim())
      .filter(c => c.length > 0)
    if (parsedPhaseList.length === 0 || parsedContributionList.length === 0) {
      throw new Error('[A3-agenda] the model returned an empty PHASES or CONTRIBUTIONS list (NO DEFAULT PASS)')
    }
    phases = parsedPhaseList
    contributions = parsedContributionList.map((statement, index) => ({ id: `c${index + 1}`, statement }))
    plan = parsedPhaseList
    agendaSource = proseLabelling(writer).source
    agendaRoute = proseRouteOf(analysis)
  }

  return {
    agenda: tagArtifact(
      {
        fixture: agendaSource === 'fixture',
        stepId: 'A3-agenda',
        slug: 'agenda',
        claimRef: (claim?.claimRef as string | undefined) ?? claimRef,
        phases,
        plan,
        agendaSource,
        agendaRoute,
        note: agendaSource === 'fixture'
          ? 'built-in agenda fixture — no prose writer is configured, so the stages are the canonical pipeline phases'
          : 'agenda derived from the claim and its falsifiable prediction',
      },
      A3_PRODUCER,
      proseKindOf(agendaSource),
    ),
    'contribution-list': tagArtifact(
      {
        fixture: agendaSource === 'fixture',
        stepId: 'A3-agenda',
        slug: 'contribution-list',
        contributions: contributions.map(contribution => ({
          id: contribution.id,
          claimRef,
          claim: contribution.statement,
          expectedEvidence: `${planOf(ctx).metric.label} moving ${thresholdLabel(ctx.runCtx.commitment)} (prediction: ${predictionText})`,
        })),
        agendaSource,
        note: agendaSource === 'fixture'
          ? 'built-in contribution list — claim-level, not yet literature-supported'
          : 'contribution list derived from the claim; still claim-level, not literature-supported',
      },
      A3_PRODUCER,
      proseKindOf(agendaSource),
    ),
  }
}

/** A4-venue: fixture shaped as a venue selection + scope match. */
function a4Executor(ctx: ExecCtx): Record<string, unknown> {
  const { claimRef } = canonicalOf(ctx)
  const landscape = readInput(ctx, 'landscape-map')
  const hits = Array.isArray(landscape?.hits) ? (landscape.hits as ReadonlyArray<unknown>) : []

  // WHERE the field publishes is answerable from the corpus A1 actually retrieved:
  // every record carries the venue it was published in. A4 therefore picks the venue
  // that appears most often among those records instead of naming one. Ties resolve
  // to the first venue seen, so the choice does not depend on iteration order, and a
  // corpus with no usable venue falls back to the declared study venue.
  const counts = new Map<string, number>()
  for (const raw of hits) {
    if (raw === null || typeof raw !== 'object') continue
    const venue = (raw as { venue?: unknown }).venue
    if (typeof venue !== 'string' || venue.trim() === '') continue
    counts.set(venue, (counts.get(venue) ?? 0) + 1)
  }
  let chosen: string | undefined
  let chosenCount = 0
  for (const [venue, count] of counts) {
    if (count > chosenCount) {
      chosen = venue
      chosenCount = count
    }
  }
  const venueSource: 'retrieved-corpus' | 'declared' = chosen === undefined ? 'declared' : 'retrieved-corpus'
  const venueName = chosen ?? SCENARIO.venueName
  const venueId = chosen === undefined ? SCENARIO.venueId : `retrieved:${chosen}`

  return {
    venue: tagArtifact(
      {
        fixture: venueSource === 'declared',
        stepId: 'A4-venue',
        slug: 'venue',
        venueId,
        name: venueName,
        claimRef,
        venueSource,
        // WHAT THIS VENUE REQUIRES, AND WHETHER ANYBODY HAS READ IT. A submission is measured against
        // the journal's own guide, and this run has not read one: the record states every requirement
        // it knows the guide answers, each `unknown`, with the official page it is stated on and what
        // attempting that page produced. Recording the gap is what `journal-rules-verified` refuses a
        // final package on — an invented word limit would have read as compliance.
        // The evidence for the choice, so a reader can check it against the corpus.
        evidence: {
          recordsConsidered: hits.length,
          recordsInChosenVenue: chosenCount,
          distinctVenues: counts.size,
          method: 'most frequent `venue` among the records A1 retrieved; ties resolve to the first seen',
        },
        note: venueSource === 'retrieved-corpus'
          ? 'venue DERIVED from the retrieved corpus — the venue where the field publishes, not a claim read from the venue itself'
          : 'no retrieved record carried a venue, so the declared study venue is used',
      },
      A4_PRODUCER,
      'local_computation',
    ),
    'venue-scope': tagArtifact(
      {
        fixture: true,
        stepId: 'A4-venue',
        slug: 'venue-scope',
        venueId,
        // THE SCOPE KEYWORDS COME FROM THE RUN'S OWN PLAN: the field, the direction, and the one
        // property every study here has. A fixed list described the platoon study to every venue.
        matches: [planOf(ctx).field, planOf(ctx).direction, 'falsifiable experiment'],
        rejects: ['no falsifiable experiment'],
        // The venue is measured; the scope criteria are not. Venue acceptance
        // patterns would have to be read from the venue's own author guidelines,
        // which this study does not retrieve, so the field says so.
        scopeSource: 'declared',
        note: 'scope-match criteria are DECLARED, not read from the venue: no author-guideline source is retrieved in this study',
      },
      A4_PRODUCER,
      'fixture_executor',
    ),
  }
}

/** B1-method: fixture shaped as a method spec + measurable predictions. */
async function b1Executor(ctx: ExecCtx): Promise<Record<string, unknown>> {
  const { claimRef, predictionText } = canonicalOf(ctx)
  const claimArtifact = readInput(ctx, 'claim')

  // The method is how the claim is made testable, so it must derive from the claim
  // when a model is available. With no writer the fixture spec stands, keeping the
  // offline pipeline deterministic.
  // THE METHOD'S EXECUTABLE HALF IS NOT MODEL-AUTHORED. This used to ask the model for a FAMILY
  // and write the answer onto `method-spec`, so a response naming a reinforcement-learning policy
  // became the manuscript's method while `platoon-sim.ts` integrated IDM trajectories — a method
  // section describing an experiment nobody ran (review J11). The algorithm now comes from the
  // implementation the plan declares, and the model is asked only for what it can legitimately
  // contribute: the procedure steps and the metric's direction. `resolveImplementation` is called
  // at the plan boundary too, so a plan naming an implementation this runner lacks never gets here.
  const resolved = resolveImplementation(planOf(ctx))
  if (!resolved.ok || resolved.implementation === undefined) {
    throw new Error(`[B1-method] ${resolved.reason}`)
  }
  const implementation = resolved.implementation
  const writer = ctx.proseWriter
  // What the MODEL believes the method is, when a model answered. Recorded beside the executed
  // implementation rather than instead of it: it is worth keeping for audit — a reader can see
  // that the model said one thing and the code did another — but it cannot become the method the
  // manuscript reports, because the manuscript's method must be the one that ran.
  let modelDeclaredFamily: string | undefined
  const family = `${implementation.algorithm} (${implementation.version})`
  // THE PROCEDURE IS THE IMPLEMENTATION'S, not the platoon study's: the two arms are the ones the
  // resolved implementation varies, and what is integrated is what its own module declares.
  const arms = ctx.runCtx.adapter.arms
  let steps: ReadonlyArray<string> = [
    `run the ${arms.baseline.label} arm against the ${arms.variant.label} arm`,
    `apply ${implementation.algorithm}`,
    `measure ${implementation.metric.label}`,
  ]
  let metricName: string = planOf(ctx).metric.key
  let metricDirection: string = ablationDirectionOf(planOf(ctx).metric)
  let methodSource: 'model' | 'deterministic' | 'fixture' = 'fixture'
  let methodRoute: Record<string, unknown> = proseRouteOf(undefined)

  if (writer !== undefined) {
    const analysis = await writer.write({
      stepId: 'B1-method',
      instruction: [
        'Derive the method that makes the central claim testable.',
        'Reply with exactly these four lines and nothing else:',
        'FAMILY: <the method family, one phrase>',
        'STEPS: <step> | <step> | <step>',
        'METRIC: <the single primary metric name>',
        'DIRECTION: <"lower is better" or "higher is better">',
      ].join('\n'),
      context: {
        ...planContextOf(planOf(ctx)),
        claim: claimArtifact?.assertion ?? claimRef,
        prediction: predictionText,
      },
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
    })
    const parsedFamily = labelledField(analysis.text, 'FAMILY')
    const parsedSteps = labelledField(analysis.text, 'STEPS')
    const parsedMetric = labelledField(analysis.text, 'METRIC')
    const parsedDirection = labelledField(analysis.text, 'DIRECTION')
    // A method spec missing its family, its steps, or its metric cannot be
    // implemented or measured downstream, so an incomplete response fails the step
    // rather than emitting a spec that only looks complete (NO DEFAULT PASS).
    if (
      parsedFamily === undefined
      || parsedSteps === undefined
      || parsedMetric === undefined
      || parsedDirection === undefined
    ) {
      throw new Error(
        '[B1-method] the model response did not carry FAMILY/STEPS/METRIC/DIRECTION '
        + '(an incomplete method spec cannot be implemented or measured — NO DEFAULT PASS)',
      )
    }
    const parsedStepList = parsedSteps.split('|').map(s => s.trim()).filter(s => s.length > 0)
    if (parsedStepList.length === 0) {
      throw new Error('[B1-method] the model returned an empty STEPS list (NO DEFAULT PASS)')
    }
    modelDeclaredFamily = parsedFamily
    steps = parsedStepList
    metricName = parsedMetric
    metricDirection = parsedDirection
    // From the CHANNEL, like A1/A2/A3: a deterministic route calls no model.
    methodSource = proseLabelling(writer).source
    methodRoute = proseRouteOf(analysis)
  }

  return {
    'method-spec': tagArtifact(
      {
        fixture: methodSource === 'fixture',
        stepId: 'B1-method',
        slug: 'method-spec',
        methodId: ctx.runCtx.adapter.arms.variant.identity,
        family,
        ...(modelDeclaredFamily === undefined ? {} : { modelDeclaredFamily }),
        claimRef,
        derivedFrom: 'falsifiable-prediction',
        steps,
        metric: { name: metricName, direction: metricDirection },
        methodSource,
        methodRoute,
        // The method this run EXECUTES, with the parameters and the varied factors read out of the
        // implementation rather than described: a reader can compare the Method section against
        // the code without opening it, and a change to the model changes both in one edit.
        implementation: {
          id: implementation.id,
          version: implementation.version,
          algorithm: implementation.algorithm,
          citation: implementation.citation,
          parameters: implementation.parameters,
          varied: implementation.varied,
          equations: implementation.equations,
          outputs: implementation.outputs,
        },
        note: methodSource === 'fixture'
          ? 'method spec — the algorithm, its parameters and its varied factors are the declared implementation; no method-derivation tool exists'
          : 'method spec — the algorithm comes from the declared implementation; the steps and the metric direction come from the model',
      },
      B1_PRODUCER,
      proseKindOf(methodSource),
    ),
    'method-predictions': tagArtifact(
      {
        fixture: methodSource === 'fixture',
        stepId: 'B1-method',
        slug: 'method-predictions',
        predictions: [{ id: 'p1', text: predictionText, adjudicatedBy: 'C1-mvp experiment' }],
        methodSource,
        note: 'measurable-prediction set — must be adjudicable by the C1 experiment',
      },
      B1_PRODUCER,
      proseKindOf(methodSource),
    ),
  }
}

/** B2-data: fixture shaped as a dataset descriptor + profile. */
/**
 * The real dataset this study's model is evaluated against.
 *
 * Recorded in `data/README.md` with its licence and hashes. B2 does not merely NAME
 * it: it stats the files, so a descriptor can only claim a dataset that is actually
 * on disk with the expected size.
 */
const DATASET = {
  id: 'sumo-krauss-signal-control',
  source: 'https://huggingface.co/datasets/ranjanyash543/sumo-krauss-simulation',
  license: 'Apache-2.0',
  version: 'v1',
  split: 'single-run',
  /** State + signal files that make up one simulation run. */
  files: [
    {
      path: 'H:/datasets/sumo-krauss/signal_record49999.txt',
      bytes: 1_188_890,
      kind: 'signal-state',
      sha256: '76a86401eb2705b30230278ea5694702300c178a289bcd7d24afc0ccde643fcd',
    },
    {
      path: 'H:/datasets/sumo-krauss/record49999.txt',
      bytes: 41_975_152,
      kind: 'vehicle-state',
      sha256: '2f1475fa774fcab63558eea2f9dc2d13e5f34ac9eed79c4859072df21b91a5cb',
    },
  ],
} as const

/** What one file check found. */
interface FileCheck {
  readonly path: string
  readonly kind: string
  readonly present: boolean
  readonly actualBytes: number | null
  readonly sizeMatches: boolean
  /** null when the file is absent, so nothing was hashed. */
  readonly sha256Matches: boolean | null
}

/**
 * Check each declared dataset file by SIZE AND HASH.
 *
 * The size check alone is not an identity check: `data/README.md` records a SHA-256
 * per file and this function used to compare only byte counts, so any same-size
 * substitution passed as the recorded dataset. The hash is recomputed here, which is
 * what makes "acquired" mean "these are the recorded bytes".
 *
 * Never throws: a missing file is data, not a fault.
 *
 * @returns one check per declared file, in declaration order.
 */
function checkDatasetFiles(): ReadonlyArray<FileCheck> {
  return DATASET.files.map((file) => {
    try {
      const stat = statSync(file.path)
      const sizeMatches = stat.size === file.bytes
      // Hashing a file whose size is already wrong cannot rescue the claim, and it
      // costs a full read of a 42 MB file, so the hash is only computed when the
      // cheap check passed.
      const sha256Matches = sizeMatches
        ? createHash('sha256').update(readFileSync(file.path)).digest('hex') === file.sha256
        : false
      return {
        path: file.path,
        kind: file.kind,
        present: true,
        actualBytes: stat.size,
        sizeMatches,
        sha256Matches,
      }
    } catch {
      // Absent (or unreadable) on this host: reported as absent below, which the
      // descriptor turns into an explicit "not acquired here" rather than a claim.
      return { path: file.path, kind: file.kind, present: false, actualBytes: null, sizeMatches: false, sha256Matches: null }
    }
  })
}

function b2Executor(ctx: ExecCtx): Record<string, unknown> {
  const method = readInput(ctx, 'method-spec')
  const checks = checkDatasetFiles()
  // "Acquired" now means the recorded BYTES are here, not merely a file of the right
  // length: the size check alone let any same-size substitution stand in for the
  // dataset this study cites.
  const acquired = checks.every(check => check.present && check.sizeMatches && check.sha256Matches === true)

  return {
    dataset: tagArtifact(
      {
        fixture: !acquired,
        stepId: 'B2-data',
        slug: 'dataset',
        datasetId: DATASET.id,
        version: DATASET.version,
        split: DATASET.split,
        source: DATASET.source,
        license: DATASET.license,
        methodRef: (method?.methodId as string | undefined) ?? ctx.runCtx.adapter.arms.variant.identity,
        files: checks,
        // The descriptor states what is ON DISK, not what was intended.
        acquisition: acquired
          ? 'acquired — every declared file is present, size-matched and hash-matched against the record in data/README.md'
          : 'not acquired on this host — the dataset is named but its recorded bytes were not verified here',
        // What this dataset has to do with THIS run. The experiment consumes the source the study
        // declares — the Case Pack's scenario, or a trace the study builds — and not these bytes.
        // Recording the descriptor without that sentence invites a reader to take "the study's
        // dataset" for an input the experiment used, which it is not.
        //
        // WHAT THE STUDY MEASURES IS NAMED BY THE STUDY, not by this step: the sentence used to say
        // "no platoon trajectory", which is a claim about a study this run may not be conducting.
        consumedBy: 'no step of this run — this run\'s experiment reads '
          + `${ctx.runCtx.adapter.sourceRef}, which is not this dataset. No artifact of this run is `
          + 'derived from its bytes, and the quantity this study measures '
          + `(${planOf(ctx).metric.label}) is not a column of it.`,
        note: acquired
          ? 'dataset descriptor for the real SUMO signal-control run recorded in data/README.md; its bytes were verified on this host, and the verification is the whole of this step\'s claim about it'
          : 'dataset descriptor names a real, openly-licensed dataset; its bytes are not present on this host',
      },
      B2_PRODUCER,
      acquired ? 'local_computation' : 'fixture_executor',
    ),
    'data-profile': tagArtifact(
      {
        fixture: !acquired,
        stepId: 'B2-data',
        slug: 'data-profile',
        datasetId: DATASET.id,
        columns: [
          { name: 'step', type: 'integer', note: 'simulation step index (column 0)' },
          { name: 'link_state', type: 'categorical', note: 'per-controlled-link signal state (remaining columns of signal_record*)' },
        ],
        // NO `missingRate`. The field existed and was `null` on every run ever made:
        // no code computed it, and a declared-but-uncomputed metric is a claim, not an
        // observation (the same defect the audit found elsewhere). What IS claimed here
        // is the verification that ran — see `verified`.
        verified: {
          files: checks.map(check => ({
            path: check.path,
            present: check.present,
            sizeMatches: check.sizeMatches,
            sha256Matches: check.sha256Matches,
          })),
          method: 'byte length + SHA-256 of the file contents, against the values recorded in data/README.md',
        },
        provenance: acquired
          ? 'real acquisition — files present, size-verified and hash-verified (see data/README.md)'
          : 'not acquired on this host (files absent or hashes unmatched); no profile is claimed',
        note: acquired
          ? 'column meaning per the dataset record; unlabelled columns are not given an invented meaning'
          : 'no profile claimed — the dataset files are not present on this host',
      },
      B2_PRODUCER,
      acquired ? 'local_computation' : 'fixture_executor',
    ),
  }
}

/** B3-baseline: establish the baseline and compare against SOTA (canonical).
 *  Honest fixture THIS WAVE: the literature-search capability (canonical B3-SOTA
 *  retrieval sub-task) exists, but its synthetic corpus is off-domain, so it can
 *  anchor NO real traffic-signal SOTA row. The executor therefore emits a
 *  pre-registered baseline protocol + a SOTA-comparison note with zero anchored
 *  rows. Ablation is NOT here — it belongs to C3-boundary (T19-S fix). */
function b3Executor(ctx: ExecCtx): Record<string, unknown> {
  const method = readInput(ctx, 'method-spec')
  const dataset = readInput(ctx, 'dataset')
  const adapter = ctx.runCtx.adapter
  const arms = adapter.arms
  // The baseline is MEASURED, not declared: this study's baseline arm is run under the study's own
  // declared conditions, so the reference row is a number this study produced. WHICH study, and what
  // its arm is called, comes from the adapter — the step does not know.
  const { measured } = adapter.measure()
  const measuredImprovementPct = measured.improvementPct

  return {
    'baseline-results': tagArtifact(
      {
        fixture: false,
        stepId: 'B3-baseline',
        slug: 'baseline-results',
        baseline: {
          identity: arms.baseline.identity,
          protocol: `run this study's baseline arm under its declared conditions and read ${planOf(ctx).metric.key}`,
          metric: {
            name: planOf(ctx).metric.key,
            direction: planOf(ctx).metric.direction === 'higher-is-better' ? 'higher is better' : 'lower is better',
          },
          // The input this NUMBER came from. The baseline is measured by running the study over its
          // declared scenario or trace, which is not the dataset B2 registered; naming B2's
          // descriptor here would attribute the measurement to a dataset no arithmetic here touches.
          datasetRef: adapter.sourceRef,
          registeredDatasetRef: (dataset?.datasetId as string | undefined) ?? null,
          methodRef: (method?.methodId as string | undefined) ?? arms.baseline.identity,
        },
        measured: {
          // THE RECORD'S OWN SHAPE, not a per-study set of fields: the arms are named by the metric
          // and whatever else the implementation reported travels under its own names, so a reader of
          // this artifact does not have to know which study produced it.
          metricKey: measured.metricKey,
          unit: measured.unit,
          baseline: measured.baseline,
          variant: measured.variant,
          variantImprovementPct: measuredImprovementPct,
          values: measured.values,
          source: `${adapter.implementation.id} (both arms run under the declared conditions)`,
          study: adapter.describe(planOf(ctx)),
        },
        beatsBaselineWhen: `the variant's ${measured.metricKey} moves ${thresholdLabel(ctx.runCtx.commitment)} against the baseline's, in the claim's declared direction`,
        note: 'baseline MEASURED by running this study\'s baseline arm; the variant row is the same run under the same conditions, so the comparison is internally consistent. Ablation measurements are NOT part of baseline (they belong to C3-boundary)',
      },
      adapter.producers.baseline,
      'local_computation',
    ),
    'sota-comparison': tagArtifact(
      {
        fixture: false,
        stepId: 'B3-baseline',
        slug: 'sota-comparison',
        targetMetric: planOf(ctx).metric.key,
        rows: [
          {
            method: `${arms.baseline.label} (this study baseline)`,
            value: measured.baseline,
            unit: measured.unit,
            source: `measured by ${adapter.implementation.id}`,
          },
          {
            method: `${arms.variant.label} (this study variant)`,
            value: measured.variant,
            unit: measured.unit,
            measuredImprovementPct,
            source: `measured by ${adapter.implementation.id}`,
          },
        ],
        // No external SOTA row is recorded, and THAT is stated rather than filled in.
        // Published figures for this quantity are prose in papers, not machine-readable fields, so
        // a retrieved record cannot supply one without someone reading the number out
        // of the text. Recording a guess here would manufacture the comparison this
        // step exists to ground.
        anchoring: 'none',
        sotaGapClaim: `the variant's margin is compared against this study's own ${arms.baseline.label} arm; a claim against PUBLISHED SOTA remains unanchored`,
        note: 'the two rows are this study’s own measurements. No published-SOTA row is recorded: the literature channel retrieves real records, but a figure for this quantity has to be read out of a paper by a human or extracted by a reader pipeline, and inventing one would manufacture the very comparison this step grounds.',
      },
      adapter.producers.baseline,
      'local_computation',
    ),
  }
}

/** C1-mvp: the minimal experiment adjudicating the core prediction. Fixture that
 *  reads the SAME synthetic experiment fixture row the C-gate adjudicates, so the
 *  mvp artifact and the gate evidence are同源 (T19-S business coherence). */
function c1Executor(ctx: ExecCtx): Record<string, unknown> {
  const { claimId, claimRef, predictionText } = canonicalOf(ctx)
  const adapter = ctx.runCtx.adapter
  const measurement = adapter.measure()
  // The experiment is RUN, not looked up: both arms are executed against the study's declared
  // conditions and the prediction is adjudicated against the measured change. The same measurement
  // feeds the C gate (verdict.ts), so the artifact and the verdict are one run rather than two
  // tables that might disagree.
  const verdict = evaluatePrediction({
    predictionText,
    metric: planOf(ctx).metric,
    declaredMetricKey: ctx.runCtx.metricKey,
    commitment: ctx.runCtx.commitment,
    measure: () => measurement.prediction,
  })
  if (verdict.kind === 'unbindable') {
    // Fail-closed and symmetric with the C gate: an unbindable claim is not executed against,
    // because there is no measurement that could adjudicate it.
    throw new Error(
      `C1-mvp: the experiment cannot adjudicate this claim — ${verdict.reason} `
      + '(fail-closed: no adjudicable prediction ⇒ no pass)',
    )
  }
  // The record every later step measures against. Written by the step that MEASURED, read by the
  // steps that report — see `result-version.ts` for what recomputing beside it cost.
  const resultVersion = resultVersionFrom(
    measurement.measured,
    ctx.runCtx.metricKey === '' ? planOf(ctx).metric.key : ctx.runCtx.metricKey,
    measurement.ruleVersion,
    1,
    measurement.series,
  )
  return {
    'mvp-results': tagArtifact(
      {
        fixture: false,
        stepId: 'C1-mvp',
        slug: 'mvp-results',
        claimRef,
        claimId,
        predictionText,
        experiment: {
          source: `${adapter.implementation.id} (${adapter.implementation.algorithm})`,
          // What this experiment measures and what it does NOT. An artifact that states only
          // "an experiment ran" invites the reader to assume it tested the claim; naming the
          // quantity is what lets them check.
          measures: planOf(ctx).metric.key,
          doesNotMeasure: adapter.describe(planOf(ctx))['doesNotMeasure'],
          ruleVersion: measurement.ruleVersion,
          study: adapter.describe(planOf(ctx)),
        },
        outcome: {
          supportsPrediction: verdict.supportsPrediction,
          // The direction, stated as its own field. `supportsPrediction: false` reads as "the
          // experiment failed"; it here means the experiment RAN and NEGATED the prediction,
          // and every downstream reader has to be able to tell those apart.
          decisive: true,
          verdict: verdict.supportsPrediction ? 'supported' : 'refuted',
          detail: verdict.detail,
        },
        observed: {
          // THE RECORD'S OWN NUMBERS, so an experiment artifact means the same thing whatever study
          // produced it: the arms under the metric's name, the change, and whatever else the
          // implementation reported under the names it gave them.
          metricKey: measurement.measured.metricKey,
          unit: measurement.measured.unit,
          baseline: measurement.measured.baseline,
          variant: measurement.measured.variant,
          improvementPct: verdict.improvementPct,
          thresholdPct: verdict.thresholdPct,
          values: measurement.measured.values,
        },
        note: `mvp-results measured by running ${adapter.implementation.id}'s two arms under the same declared conditions; a refuted prediction is recorded as refuted and does not stop the run`,
      },
      adapter.producers.mvp,
      'local_computation',
    ),
    [RESULT_VERSION_SLUG]: tagArtifact(
      {
        fixture: true,
        stepId: 'C1-mvp',
        slug: RESULT_VERSION_SLUG,
        ...resultVersion,
        // This step MEASURED, so it is the one place `recomputed` is the honest source. Every
        // later reader reports `result-version`, and a test asserts exactly that.
        resultSource: 'recomputed',
        note: 'the run’s measured result, written by the step that measured it; every later step reports these numbers rather than measuring again',
      },
      adapter.producers.mvp,
      'local_computation',
    ),
  }
}

/** C2-trinity-loop: emits the convergence dossier. The A+B+C GATE itself is
 *  adjudicated by the genuine trinity channels (see verdict.ts); the executor
 *  only records the dossier that ties mvp results to the baseline. */
function c2Executor(ctx: ExecCtx): Record<string, unknown> {
  const { claimRef, predictionText } = canonicalOf(ctx)
  const mvp = readInput(ctx, 'mvp-results')
  const baseline = readInput(ctx, 'baseline-results')
  const mvpOutcome = mvp?.outcome as { supportsPrediction?: unknown; decisive?: unknown } | undefined
  const baselineRec = baseline?.baseline as { identity?: unknown } | undefined
  const baselineMeasured = baseline?.measured as { baselineMinTtcSeconds?: unknown } | undefined

  // Report the channels THIS step's declared inputs let it see, and let the
  // convergence rule speak for the rest. The executor receives mvp-results and
  // baseline-results, so it can read C (the experiment) and part of B (the
  // baseline); it never sees the adversarial round, so A is reported absent
  // rather than assumed. Assuming it would be the optimistic default that
  // `?? true` used to encode.
  const observed: ChannelVerdict[] = []
  // A decisive experiment is a PASSED C channel whichever way it went: the channel's question
  // is whether the claim met a falsifiable test this study could run. Reporting a decisive
  // negation as C=failed made the dossier describe a broken experiment when the experiment had
  // in fact answered the question the study asked.
  if (mvpOutcome?.decisive === true) observed.push({ component: 'C', outcome: 'passed' })
  else if (typeof mvpOutcome?.supportsPrediction === 'boolean') observed.push({ component: 'C', outcome: 'failed' })
  if (typeof baselineMeasured?.baselineMinTtcSeconds === 'number') observed.push({ component: 'B', outcome: 'passed' })
  // A is not among this step's declared inputs, so this step cannot observe it — said as its own
  // answer rather than folded into `pending`, which is what the run's own status means.
  const convergence = evaluateConvergence(observed, { unobservable: ['A'] })

  return {
    'converged-verdict': tagArtifact(
      {
        fixture: false,
        stepId: 'C2-trinity-loop',
        slug: 'converged-verdict',
        claimRef,
        predictionText,
        baselineRef: baselineRec?.identity ?? null,
        experimentRef: mvpOutcome?.supportsPrediction ?? null,
        experimentDecisive: mvpOutcome?.decisive ?? null,
        convergence: convergence.kind,
        convergenceBasis: summarizeConvergence(convergence),
        channelsObserved: observed,
        // A is structurally unavailable here; saying so is the point, because the
        // step's own A+B+C gate is what actually adjudicates convergence.
        note: 'dossier of the channels this step can observe from its declared inputs; the A+B+C gate verdicts are produced by the real trinity channels in verdict.ts, and the adversarial channel is not among this step\'s inputs',
      },
      C2_PRODUCER,
      'local_computation',
    ),
  }
}





/** C3-boundary: real `runAblation` — boundary probing (variant vs baseline).
 *  Ablation lives HERE (canonical C3), not in B3-baseline (T19-S fix). */
async function c3Executor(ctx: ExecCtx): Promise<Record<string, unknown>> {
  const verdict = readInput(ctx, 'converged-verdict')
  // WHAT THIS STUDY'S BOUNDARY IS comes from its adapter: which arm is the reference, what removing
  // one mechanism means, and which regime the claim stops carrying into are facts about a particular
  // study, and this step ablates whichever one the run is conducting.
  const boundary = ctx.runCtx.adapter.ablation()
  const definition = boundary.definition
  const invoker = ctx.invoker ?? new DirectResearchToolInvoker('c3-fixture')
  const invocation = await invoker.invoke(
    'ablation',
    { definition },
    { timestamp: FIXED_TS, deps: { ablationExecutor: boundary.executor } },
  )
  if (!invocation.ok) {
    throw new Error(`[C3-boundary] ablation invocation failed: ${invocation.message}`)
  }
  const artifact = invocation.artifact as ReturnType<typeof runAblation>
  return {
    'ablation-results': tagArtifact(
      {
        ranRuns: artifact.runs.length,
        counts: artifact.counts,
        aggregate: artifact.aggregate,
        // The tool reports a population stddev per arm. In THIS study the arm
        // executor is deterministic — the same demand goes through the same model —
        // so the repetitions exist to exercise the run/aggregate seam, and the
        // dispersion is 0 BY CONSTRUCTION rather than by measurement. Presenting it
        // without that sentence invites reading it as experimental variability.
        variability: {
          repetitions: artifact.runs.length,
          dispersionIsMeasured: false,
          note: 'the arm executor is deterministic: dispersion across repetitions is 0 by construction and is NOT an estimate of experimental variability',
        },
        // C2's dossier carries `convergence`, not `verdict`. Reading the wrong key
        // made the `??` fire on every run, so this field asserted "converged" while
        // the dossier it cites said "pending" — two constants pointing opposite
        // ways. A missing input is now reported as absent, never as converged.
        convergedRef: (verdict?.convergence as string | undefined) ?? 'not-observed',
        // The scope test the study declares, MEASURED here rather than quoted from it.
        boundary: boundary.probe,
        // What each of the study's declared mechanisms is worth, measured one at a time.
        moduleAblations: boundary.modules,
        note: `ablation-results produced by a REAL runAblation execution whose arms were MEASURED by ${ctx.runCtx.adapter.implementation.id} — ${boundary.note}`,
      },
      C3_PRODUCER,
      'real_tool_fixture_input',
      { provenance: invocation.provenance, invokerTruthfulness: invocation.truthfulness },
    ),
    'boundary-map': tagArtifact(
      {
        probed: {
          baseline: definition.baselineIdentity,
          variant: definition.variantIdentity,
          removedOrReplacedComponents: definition.removedOrReplacedComponents,
        },
        metric: definition.metric,
        aggregate: artifact.aggregate,
        study: ctx.runCtx.adapter.describe(planOf(ctx)),
        boundary: boundary.probe,
        note: `boundary-map derived from the REAL runAblation execution over ${ctx.runCtx.adapter.implementation.id}'s two arms, plus the measured scope test — an applicability claim for this declared configuration only, not a general one`,
      },
      C3_PRODUCER,
      'real_tool_fixture_input',
      { provenance: invocation.provenance, invokerTruthfulness: invocation.truthfulness },
    ),
  }
}

/** One figure-plan entry as an artifact carries it, before {@link planFloats} narrows it. */
interface FigurePlanEntry {
  /** Which renderer produced it: `data-figure`, `three-line-table` or `roadmap`. */
  readonly kind?: unknown
  /** The number the plan gave it, e.g. `Figure 1`. */
  readonly label?: unknown
  /** The caption the plan gave it. */
  readonly title?: unknown
  /** The rendered SVG, for a data figure — and for a roadmap the deployment's provider drew. */
  readonly svg?: unknown
  /** The PNG bytes, base64, when the producing tool emitted a raster of the same canvas. */
  readonly pngBase64?: unknown
  /** The rendered diagram source, for a roadmap. */
  readonly content?: unknown
  /** The diagram format, for a roadmap. */
  readonly format?: unknown
  /** Whether a roadmap was drawn as a picture, which is what decides whether it is a float or source. */
  readonly diagramDrawn?: unknown
  /** The tool's own rendering, for a table. */
  readonly tableMarkdown?: unknown
}

/**
 * Where the manuscript's own copy of a rendered float lives, derived from the label the plan gave it.
 *
 * DERIVED, NOT COUNTED: a second float must not be able to land on the first one's file, and a file
 * named after the float's number is how the manuscript and the package come to disagree about which
 * picture `Figure 2` is. `Figure 1` → `figures/figure-1.svg`.
 *
 * @param label - the float's label, as the plan assigned it.
 * @returns the path, relative to the package root.
 */
function figureAssetPath(label: string): string {
  return `figures/${label.trim().toLowerCase().replace(/\s+/gu, '-')}.svg`
}

/**
 * The floats a figure plan declared, with the label and caption the plan gave each one.
 *
 * An entry carrying neither is REFUSED rather than dropped. D1 numbers a float when it decides the
 * float exists, so an unnumbered entry means the plan and this reader disagree about what the
 * manuscript holds — and dropping it would print a figure no caption and no sentence can name.
 *
 * @param plan - the figure-plan entries, as the artifact carries them.
 * @returns the same entries, with `label` and `title` narrowed to strings.
 * @throws {Error} when an entry carries no label or no title.
 */
function planFloats(
  plan: ReadonlyArray<FigurePlanEntry>,
): ReadonlyArray<FigurePlanEntry & { readonly label: string; readonly title: string }> {
  return plan.map((entry, index) => {
    if (typeof entry.label !== 'string' || typeof entry.title !== 'string') {
      throw new Error(
        `[figure-plan] entry ${String(index)} (kind ${String(entry.kind)}) carries no label/title — `
        + 'D1-figure-map numbers a float when it decides the float exists, and a caption nothing can '
        + 'refer to is the defect that numbering prevents',
      )
    }
    return { ...entry, label: entry.label, title: entry.title }
  })
}

/**
 * The numbered items a manuscript's prose can cite: its labelled floats, then its equations.
 *
 * The equations come last because the manuscript states them inside the method section, which the
 * outline's own sections precede; the order here is the order a reader meets them.
 *
 * @param floats - the labelled floats the manuscript renders.
 * @param equations - the equations the method section states.
 * @returns one citable item per float and per equation.
 */
function citableFloats(
  floats: ReadonlyArray<CitableFloat>,
  equations: ReadonlyArray<{ readonly name: string }>,
): ReadonlyArray<CitableFloat> {
  return [
    ...floats,
    ...equations.map((equation, index) => ({
      label: equationNumber(index),
      title: equation.name,
    })),
  ]
}
/** D1-figure-map: real renders for ALL THREE figure families its canonical
 *  purpose names (数据图/三线表/路线图). figure-plan lists each figure with the
 *  evidence produced by its real tool execution. */
/**
 * The run's records a figure's values may be sourced from, keyed by slug.
 *
 * THE RECORD THE FIGURE NAMES, not everything the run holds: a check against a merged view would let
 * a figure claim a key from one record while naming another, and the point of naming a record is that
 * a reader can go and look at it. The result record travels as the shape it is written in, so the
 * keys a plan uses are the keys a reader will find.
 *
 * @param ctx - the step's context.
 * @returns the records, by slug, with the result version under its own slug.
 */
function d1RecordsOf(ctx: ExecCtx): ReadonlyMap<string, Record<string, unknown>> {
  const result = readInput(ctx, RESULT_VERSION_SLUG)
  if (result !== undefined) return new Map([[RESULT_VERSION_SLUG, result]])
  // A STEP DRIVEN ALONE MEASURED THE STUDY ITSELF (see `result-version.ts`), and the figure's values
  // are that measurement. It is written in the SAME shape the run's own record holds — the metric's
  // arms and, when the study measured one, its sequence — so the plan's keys resolve either way and
  // the plan names `recomputed-measurement` as its source. The difference is then visible on the
  // artifact rather than hidden in the control flow.
  const measurement = ctx.runCtx.adapter.measure()
  return new Map([['recomputed-measurement', {
    measured: measurement.measured,
    ...(measurement.series === undefined ? {} : { series: measurement.series }),
  }]])
}

/** The record a figure's values come from, named the way the run can account for them. */
function d1SourceSlugOf(ctx: ExecCtx): string {
  return readInput(ctx, RESULT_VERSION_SLUG) === undefined ? 'recomputed-measurement' : RESULT_VERSION_SLUG
}

async function d1Executor(ctx: ExecCtx): Promise<Record<string, unknown>> {
  const invoker = ctx.invoker ?? new DirectResearchToolInvoker('d1-fixture')
  const adapter = ctx.runCtx.adapter
  // The figures plot the SAME measurements the experiment produced, so a chart can
  // never disagree with the verdict it illustrates. "The same" is now a record the run
  // holds, not a re-measurement: see `result-version.ts`.
  const outcome = measureOutcomeWithSource(ctx)
  // The caption says what the measurement did to the claim, derived the same way the argument plan
  // derives it — a figure of a refuted claim and a figure of a supported one do not have the same
  // caption, and the caption is what a reader who skips the text reads.
  const d1Commitment = ctx.runCtx.commitment
  const d1Outcome = claimOutcomeOf(
    outcome.measured.improvementPct,
    d1Commitment?.direction ?? 'increase',
    d1Commitment?.thresholdPct,
  )
  // THE FIGURE IS PLANNED BEFORE IT IS DRAWN, AND THE STUDY PLANS IT. The plan states the question
  // this figure answers, the record its values come from, its axes and units, its uncertainty and its
  // size; the renderer spec is built from the same study, so the chart and the reason for it are one
  // object. This step knows how a float is drawn, numbered and embedded — not whether the study's
  // figure is a category comparison or a profile along a trace.
  const presentation = adapter.presentation({
    sourceSlug: d1SourceSlugOf(ctx),
    outcome: d1Outcome,
    commitmentLabel: thresholdLabel(d1Commitment),
  })
  // EVERY VALUE A FIGURE PLOTS IS RECONCILED WITH THE RUN'S OWN RECORDS BEFORE ANYTHING IS DRAWN.
  // A figure that cannot be sourced from what the study measured is refused here rather than drawn
  // from a literal.
  const presentationRefusals = checkPresentationPlan(presentation.plan, d1RecordsOf(ctx))
  if (presentationRefusals.length > 0) {
    throw new Error(
      '[D1-figure-map] the figure plan cannot be answered from this run: '
      + presentationRefusals.map(refusal => `[${refusal.code}] ${refusal.detail}`).join('; '),
    )
  }
  const { figureSpec, table: tableModel, roadmap: roadmapGraph, roadmapTitle } = presentation
  const base = { timestamp: FIXED_TS }
  const [figureInv, tableInv, roadmapInv] = await Promise.all([
    invoker.invoke('figure', figureSpec, base),
    invoker.invoke('three-line-table', { model: tableModel, target: 'markdown' }, base),
    invoker.invoke('roadmap', { graph: roadmapGraph, options: { format: 'mermaid', title: roadmapTitle } }, base),
  ])
  if (!figureInv.ok) throw new Error(`[D1-figure-map] figure invocation failed: ${figureInv.message}`)
  if (!tableInv.ok) throw new Error(`[D1-figure-map] three-line-table invocation failed: ${tableInv.message}`)
  if (!roadmapInv.ok) throw new Error(`[D1-figure-map] roadmap invocation failed: ${roadmapInv.message}`)
  const figure = figureInv.artifact as ReturnType<typeof renderFigure>
  const table = tableInv.artifact as ReturnType<typeof renderThreeLineTable>
  const roadmap = roadmapInv.artifact as ReturnType<typeof renderRoadmap>
  // THE DEPLOYMENT'S DRAWING CAPABILITY, WHEN IT HAS ONE. The built-in renderer is deterministic and
  // dependency-free, which is why it ships, and it is not a plotting library: the plan asks for a
  // mature provider, and whether a machine has one is a deployment fact. A deployment that named none
  // draws with the built-in tool and every float says which of them drew it — so a reader comparing
  // two packages can tell a figure drawn by matplotlib from one drawn by a test fixture.
  //
  // THE DIAGRAM IS DRAWN HERE TOO, IN BOTH FORMATS. A roadmap left as mermaid source is a float the
  // compiled document cannot carry — LaTeX renders it as text and no PDF reader draws it — which is
  // the dropped float this step used to report rather than a picture.
  const provider = ctx.figureProvider
  const drawn = provider === undefined
    ? undefined
    : {
      figure: await provider.renderFigure(figureSpec),
      diagram: await provider.renderDiagram(roadmapGraph),
    }
  /**
   * Which library drew one float, and the version it reported.
   *
   * READ OFF THE RENDERED FIGURE, not off the provider: it is the value that came back with the
   * picture, so a provider that reported one version while drawing with another cannot stamp its
   * floats with the wrong one — and the field has a consumer, which is what keeps it from being a
   * promise in an interface that nothing reads. A figure that came back without its own name falls
   * back to the provider's, because a deployment's provider is only shape-checked at the boundary.
   *
   * @param which - the float to name.
   * @returns the fields every float's record carries.
   */
  const drawerOf = (which: 'figure' | 'diagram'): Record<string, unknown> => {
    if (drawn === undefined) return { drawnBy: FIGURE_TOOL_ID, drawnByVersion: FIGURE_TOOL_VERSION }
    const rendered = drawn[which]
    return {
      drawnBy: rendered.tool.length > 0 ? rendered.tool : (provider?.id ?? 'unknown'),
      drawnByVersion: rendered.toolVersion.length > 0 ? rendered.toolVersion : (provider?.toolVersion ?? 'unknown'),
      replacesBuiltIn: which === 'figure',
    }
  }
  // THE FLOATS ARE NUMBERED HERE, ONCE. This step decides which floats exist, so it also decides
  // what they are called: D3 hands these labels to the prose channel (a section may then cite
  // `Table 1`) and E1 renders the captions from them. A counter in the assembler and a roster in the
  // draft are two authorities that can disagree; one pure function over one array cannot.
  const figures = numberFloats([
    {
      kind: 'data-figure',
      title: figureCaptionFrom(figure.svg.content, 'Measured comparison'),
      toolId: FIGURE_TOOL_ID,
      svgByteLength: figure.svg.byteLength,
      pngByteLength: figure.png.byteLength,
      // The FULL svg, not a preview. D3 carries it into the draft and E1 embeds
      // it, so the manuscript holds the figure the tool actually rendered
      // instead of pointing at one.
      svg: drawn?.figure.svg ?? figure.svg.content,
      // THE RASTER THE SAME RENDER PRODUCED FROM THE SAME SPEC. HTML embeds the SVG; LaTeX has no SVG
      // support and embeds this. Without it a document compiled to LaTeX or PDF would carry a figure
      // the reader cannot see, which is the loss the compile now refuses rather than reports.
      pngBase64: drawn?.figure.pngBase64 ?? figure.png.base64,
      ...drawerOf('figure'),
    },
    {
      kind: 'three-line-table',
      title: tableModel.title ?? 'Measured results',
      toolId: THREE_LINE_TABLE_TOOL_ID,
      tableMarkdown: table.render.text,
      bindingHash: table.bindingHash,
    },
    {
      kind: 'roadmap',
      title: figureCaptionFrom(roadmap.content, 'Research roadmap'),
      toolId: ROADMAP_TOOL_ID,
      format: roadmap.format,
      nodeCount: roadmap.nodeCount,
      validationOk: roadmap.validation.ok,
      // Full content, for the same reason as the svg above. The roadmap renders
      // as mermaid, which a markdown reader draws natively.
      content: roadmap.content,
      // AND AS A PICTURE, when the deployment can draw one: the compiled document carries the SVG in
      // HTML and the raster in LaTeX, so the diagram survives both formats instead of being reported
      // as a dropped float.
      ...(drawn === undefined
        ? { diagramDrawn: false }
        : {
          diagramDrawn: true,
          svg: drawn.diagram.svg,
          pngBase64: drawn.diagram.pngBase64,
          ...drawerOf('diagram'),
        }),
    },
  ])
  return {
    'figure-plan': tagArtifact(
      {
        figures,
        totalFigures: figures.length,
        // WHAT EACH FIGURE WAS FOR, with the plan's version: a reader of the run can tell what question
        // a float answered and which record its values came from, rather than reading a chart and
        // guessing.
        presentationPlan: presentation.plan,
        note: 'figure-plan derived from REAL figure + three-line-table + roadmap tool executions; the rendered svg and mermaid travel with the draft so the assembled manuscript EMBEDS the figures rather than pointing at them',
      },
      D1_PRODUCER,
      'real_tool_fixture_input',
      { provenance: figureInv.provenance, invokerTruthfulness: figureInv.truthfulness },
    ),
  }
}

/** D2-framework: fixture shaped as a real paper outline derived from the claim +
 *  agenda + converged verdict (upstream references in `covers`). */
/** The canonical section skeleton and what each section is answerable to. */
const OUTLINE_SKELETON: ReadonlyArray<{ id: string; covers: ReadonlyArray<string> }> = [
  { id: 'abstract', covers: [] },
  { id: 'introduction', covers: ['claim', 'gap'] },
  { id: 'method', covers: ['method-spec'] },
  { id: 'experiments', covers: ['baseline', 'mvp', 'ablation'] },
  { id: 'results', covers: ['figures', 'tables', 'roadmap'] },
  { id: 'conclusion', covers: ['converged-verdict'] },
  { id: 'references', covers: ['landscape'] },
]

async function d2Executor(ctx: ExecCtx): Promise<Record<string, unknown>> {
  const { claimRef } = canonicalOf(ctx)
  const agenda = readInput(ctx, 'agenda')
  const verdict = readInput(ctx, 'converged-verdict')
  const claim = readInput(ctx, 'claim')
  const method = readInput(ctx, 'method-spec')

  // The outline's TITLE and HEADINGS are what make it this paper rather than a
  // skeleton: a generic "Method" heading states nothing about the work. With a
  // writer, both are derived from the claim and the method; the section IDS and
  // their `covers` links stay fixed, because they are the structure every
  // downstream step depends on.
  let title: string = planOf(ctx).title
  // The plan states the section names; `OUTLINE_SKELETON` states which upstream artifacts each
  // section consumes. Two facts, two homes — a `DEFAULT_HEADING` table here would be a third, and
  // a plan that renamed a section would silently keep the old one.
  const headings: Record<string, string> = Object.fromEntries(
    planOf(ctx).outline.map(section => [section.id, section.heading]),
  )
  let outlineSource: 'model' | 'deterministic' | 'fixture' = 'fixture'
  let outlineRoute: Record<string, unknown> = proseRouteOf(undefined)

  const writer = ctx.proseWriter
  if (writer !== undefined) {
    const analysis = await writer.write({
      stepId: 'D2-framework',
      instruction: [
        'Write the title and section headings for the paper that reports this work.',
        'Reply with exactly these two lines and nothing else:',
        'TITLE: <a specific paper title>',
        // One placeholder per heading the outline needs, so the declared format says HOW MANY
        // values it wants. It used to read "7 headings separated by ' | '" in prose, which a
        // reader understands and a rule cannot: the deployment's offline route answered with the
        // separator it saw named, produced two headings, and D2 refused the outline. A format
        // line has to be answerable, not just describable.
        `SECTIONS: ${OUTLINE_SKELETON.map(() => '<heading>').join(' | ')}`,
        `  (one per placeholder, in this order: ${OUTLINE_SKELETON.map(s => s.id).join(', ')})`,
      ].join('\n'),
      context: {
        ...planContextOf(planOf(ctx)),
        claim: claim?.assertion ?? claimRef,
        methodFamily: method?.family ?? null,
      },
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
    })
    const parsedTitle = labelledField(analysis.text, 'TITLE')
    const parsedSections = labelledField(analysis.text, 'SECTIONS')
    if (parsedTitle === undefined || parsedSections === undefined) {
      throw new Error(
        '[D2-framework] the model response did not carry TITLE/SECTIONS '
        + '(an outline without headings cannot structure the manuscript — NO DEFAULT PASS)',
      )
    }
    const parsedHeadings = parsedSections.split('|').map(s => s.trim()).filter(s => s.length > 0)
    if (parsedHeadings.length !== OUTLINE_SKELETON.length) {
      throw new Error(
        `[D2-framework] expected ${OUTLINE_SKELETON.length} section headings, got ${parsedHeadings.length} `
        + '(the skeleton is fixed; a partial outline would drop a section downstream steps depend on)',
      )
    }
    title = parsedTitle
    OUTLINE_SKELETON.forEach((section, index) => {
      headings[section.id] = parsedHeadings[index] as string
    })
    outlineSource = proseLabelling(writer).source
    outlineRoute = proseRouteOf(analysis)
  }

  const outline: ReadonlyArray<PlanSection & { covers: ReadonlyArray<string> }> =
    OUTLINE_SKELETON.map(section => ({
      id: section.id,
      heading: headings[section.id] as string,
      covers: section.covers,
    }))

  return {
    'paper-outline': tagArtifact(
      {
        fixture: outlineSource === 'fixture',
        stepId: 'D2-framework',
        slug: 'paper-outline',
        title,
        outlineSource,
        outlineRoute,
        claimRef,
        agendaRef: (agenda?.claimRef as string | undefined) ?? claimRef,
        // See C3's `convergedRef`: the key is `convergence`, and a missing dossier
        // is reported as absent rather than as a convergence nobody computed.
        convergenceRef: (verdict?.convergence as string | undefined) ?? 'not-observed',
        sections: outline,
        note: outlineSource === 'fixture'
          ? 'skeleton outline with default headings — no phrasing model was called'
          : 'title and headings derived from the claim and the method',
      },
      D2_PRODUCER,
      proseKindOf(outlineSource),
    ),
  }
}

/** D3-writing: fixture draft whose sections mirror the D2 outline ids, with
 *  deterministic body text + a landscape-derived reference list. */
async function d3Executor(ctx: ExecCtx): Promise<Record<string, unknown>> {
  const { claimRef } = canonicalOf(ctx)
  const outline = readInput(ctx, 'paper-outline')
  const figurePlan = readInput(ctx, 'figure-plan')
  const landscape = readInput(ctx, 'landscape-map')
  const rawOutline = outline?.sections
  const ids: ReadonlyArray<string> = Array.isArray(rawOutline) && rawOutline.length > 0
    ? rawOutline.map(s => (s as { id?: unknown }).id).filter((id): id is string => typeof id === 'string')
    : planOf(ctx).outline.map(s => s.id)
  const figures = figurePlan?.totalFigures as number | undefined
  const hitCount = landscape?.hitCount as number | undefined
  // The rendered figures travel with the draft so E1 can embed them. D1 owns the
  // render; the manuscript is where a reader meets it.
  const renderedFigures = Array.isArray(figurePlan?.figures)
    ? (figurePlan.figures as ReadonlyArray<FigurePlanEntry>)
    : []
  // D3's canonical purpose includes adding the references — and a reference is now what the paper's
  // statements cite, not what the search returned. THE JUDGEMENTS COME FIRST AND THE BINDINGS LATER:
  // what the reviewed corpus establishes about this claim's sources says nothing about where in a
  // manuscript a source will be cited, so a judgement made before the prose exists could only be
  // about a slot — which is what this used to be, and why a rewritten sentence kept its support.
  const judgements = judgementsFor(claimRef, ctx.sources)
  // A JUDGEMENT IS CHECKED WHERE IT IS MADE, before any of it reaches the draft: an empty passage, a
  // judgement stronger than what was read, or a source the retrieval does not hold is refused here.
  for (const judgement of judgements) {
    const refusals = checkCitationUse(judgement, reviewedSources().get(judgement.literatureRef))
    if (refusals.length > 0) {
      throw new Error(
        `[D3-writing] ${refusals.map(refusal => `[${refusal.code}] ${refusal.detail}`).join('; ')}`,
      )
    }
  }
  // WHAT THE PAPER MAY CITE, for the writer's request and for the fallback prose. Not bindings: the
  // sentences they will be attached to are written below.
  const citableSources = judgements.map(judgement => ({
    citeKey: judgement.citeKey,
    establishes: judgement.support,
    readScope: judgement.readScope,
    source: judgement.location,
  }))
  const duplicateKeys = checkCitationKeys(judgements)
  if (duplicateKeys.length > 0) {
    throw new Error(`[D3-writing] ${duplicateKeys.map(refusal => refusal.detail).join('; ')}`)
  }
  const headings: ReadonlyArray<{ id: string; heading: string }> = ids.map((id, index) => {
    const heading =
      Array.isArray(rawOutline) && typeof (rawOutline[index] as { heading?: unknown } | undefined)?.heading === 'string'
        ? ((rawOutline[index] as { heading: string }).heading)
        : planOf(ctx).outline.find(d => d.id === id)?.heading ?? id
    return { id, heading }
  })

  // WHAT THE PROSE MAY CITE. These are the plan's own labels, so a section that names `Figure 1`
  // names the caption E1 renders. Handed to the writer rather than inserted afterwards: a sentence
  // this pipeline added on its own would be prose no step wrote, and it would land in whichever
  // section happened to come last rather than in the one the figure is about.
  const citable = citableFloats(planFloats(renderedFigures), ctx.runCtx.adapter.implementation.equations)
  // WHAT EACH SECTION IS WRITTEN FROM, and what it cannot be written without. The request below
  // used to carry labels — a float roster and a claim sentence — and none of the run's data, so a
  // faithful model was asked to describe results it had never seen. A section whose required
  // evidence is absent is refused rather than filled; see `section-evidence.ts`.
  const methodSpec = readInput(ctx, 'method-spec')
  const resultRecord = readInput(ctx, RESULT_VERSION_SLUG)
  const reviewedEvidence = assessmentsFor(claimRef)
  const evidenceFor = (sectionId: string): SectionEvidence =>
    sectionEvidenceFor(sectionId, {
      metricKey: ctx.runCtx.metricKey === '' ? planOf(ctx).metric.key : ctx.runCtx.metricKey,
      metricLabel: planOf(ctx).metric.label,
      metricUnit: planOf(ctx).metric.unit,
      metricDirection: planOf(ctx).metric.direction,
      result: resultRecord,
      method: methodSpec,
      figures: figurePlan,
      landscape,
      assessments: reviewedEvidence,
    })
  // Prose path (T34): when the runner injected a prose writer, each section body comes
  // from it; otherwise the built-in fixture sentences are used so the offline pipeline
  // stays deterministic. `proseSource` records which path ran, and `proseRoute` names the
  // writer the configuration selected — the label alone only proves that SOME writer was
  // injected, which any `{ write() }` object satisfies.
  const writer = ctx.proseWriter
  let sections: ManuscriptSection[]
  let proseSource: 'fixture' | 'model' | 'deterministic'
  let proseRoute: Record<string, unknown> = proseRouteOf(undefined)
  let producer: string = D3_PRODUCER
  // Read once, for both prose paths: a draft written by a model quotes the same numbers as one
  // written by the fixture, and both have to say where those numbers came from.
  const d3Outcome = measureOutcomeWithSource(ctx)
  // WHAT EACH SECTION IS FOR, built from the run's own measurement and from what the claim committed
  // to. The contract decides what the writer is asked for and what E1 refuses to accept: a run whose
  // measurement refuted its claim obliges the sections that report the outcome to say so, and a
  // section that reports the number alone does not discharge it.
  const commitment = ctx.runCtx.commitment
  const argumentPlan = argumentPlanOf({
    question: planOf(ctx).direction,
    claimRef,
    metricLabel: planOf(ctx).metric.label,
    measuredPct: d3Outcome.measured.improvementPct,
    committedDirection: commitment?.direction ?? 'increase',
    ...(commitment === undefined ? {} : { thresholdPct: commitment.thresholdPct }),
    sectionIds: ids,
  })
  // WHAT THE MODEL WAS SHOWN, kept as the run's own record. A prose request is the one place where
  // the run's evidence reaches a model, and until now nothing recorded it: the artifact carried the
  // prose that came back, so a reader could see what was written and not what it was written FROM.
  // The entries below carry the instruction verbatim (it IS model-visible), the evidence names the
  // section required and received, the floats it was offered, and the citation roster with the
  // VERSION of each passage — so a judgement later refused for a changed passage is traceable to the
  // request that asked for the sentence resting on it.
  const proseRequests: Array<Record<string, unknown>> = []
  if (writer === undefined) {
    const prose = proseContext(planOf(ctx), ctx, judgements)
    sections = headings.map((h) => {
      const evidence = evidenceFor(h.id)
      if (evidence.missing.length > 0) return { ...h, bodyText: '' }
      proseRequests.push({
        sectionId: h.id,
        channel: 'fixture',
        // No instruction reaches a model on this path, and the field says so rather than being
        // omitted: "asked nothing" and "the record lost the request" are different facts.
        instruction: null,
        evidenceSupplied: Object.keys(evidence.supplied),
        evidenceRequired: evidence.required,
        citations: citableSources.map(source => ({
          citeKey: source.citeKey,
          evidenceVersion: judgementVersionOf(source.citeKey, judgements),
        })),
      })
      return { ...h, bodyText: ctx.runCtx.adapter.body(h.id, prose) }
    })
    proseSource = 'fixture'
  } else {
    const written = await Promise.all(
      headings.map((h) => {
        const evidence = evidenceFor(h.id)
        // A REFUSED SECTION IS NOT WRITTEN AT ALL. Asking the model for a Results section while
        // withholding the result is how a plausible number gets invented, so the request is not
        // made and the absence is recorded instead.
        if (evidence.missing.length > 0) return Promise.resolve(undefined)
        const instruction = `Write the "${h.heading}" section of a research paper. Its job in this paper's argument is: ${contractFor(h.id)?.job ?? 'undefined'}. ${obligationsInstructionOf(argumentPlan, h.id)}Refer to the central claim as ${claimRef}. Return prose only — no heading, no commentary. The numbered items this paper may refer to are listed in the context under \`citable\`; refer to one by its exact label when the section is about it. The evidence this section must be written from is under \`evidence\`: state only what it holds, and do not introduce a number, a unit or a source it does not contain. A sentence that cites a source states what that source establishes and nothing further — not a conclusion the passage does not itself draw, and not a generalization beyond the case it reports; when what you want to say is this paper's own claim rather than a source's finding, write it as the paper's claim and leave it uncited. When a sentence rests on a reviewed source listed under \`citations\`, name that source by writing its \`citeKey\` in square brackets exactly as \`[@citeKey]\`; every source listed there and no other may be cited, and every one of them must be cited somewhere in this manuscript.`
        proseRequests.push({
          sectionId: h.id,
          channel: proseLabelling(writer).source,
          instruction,
          evidenceSupplied: Object.keys(evidence.supplied),
          evidenceRequired: evidence.required,
          citations: citableSources.map(source => ({
            citeKey: source.citeKey,
            evidenceVersion: judgementVersionOf(source.citeKey, judgements),
          })),
        })
        return writer.write({
          stepId: 'D3-writing',
          instruction,
          // The evidence travels as DATA, not as prose the model has to parse. `citable` is the
          // float roster; `citations` is what the paper may cite and what each source establishes;
          // `evidence` is the run's own material for THIS section.
          context: {
            ...planContextOf(planOf(ctx)),
            sectionId: h.id,
            claimRef,
            figureCount: figures ?? 0,
            citable,
            // The section's contract travels as DATA too, so a caller reading the log can rebuild what
            // this section was asked to establish rather than inferring it from the prose.
            sectionContract: contractFor(h.id) ?? null,
            citations: citableSources,
            evidence: evidence.supplied,
            requiredEvidence: evidence.required,
          },
          ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
        })
      }),
    )
    sections = headings.map((h, i) => {
      const evidence = evidenceFor(h.id)
      const body = written[i]?.text
      return { ...h, bodyText: evidence.missing.length > 0 || body === undefined ? '' : body }
    })
    proseSource = proseLabelling(writer).source
    const first = written.find(entry => entry !== undefined)
    proseRoute = proseRouteOf(first)
    // The prefix names the channel, not an assumption about it: the deterministic route is not an
    // LLM call, and a producer string reading `llm:` beside `proseSource: 'deterministic'` is two
    // fields of one artifact contradicting each other.
    if (first !== undefined) producer = `${proseSource === 'model' ? 'llm' : 'deterministic'}:${first.provider}/${first.model}`
  }
  // WHERE EACH STATEMENT IS, AND WHAT IT IS BOUND TO — in that order.
  //
  // THE ATTACHMENT HAPPENS HERE, over prose that exists. A judgement says what a source establishes;
  // a statement says where the manuscript says it. Binding them records the CONTENT VERSION of the
  // sentence and the EVIDENCE VERSION of the passage it rests on, both as they stand now, so a
  // revision that rewrites the sentence leaves a judgement about text nobody has read — which
  // `checkStatementBindings` refuses at E1 rather than letting the citation transfer silently.
  const statements = locateStatements(sections)
  // THE SENTENCE'S OWN READING, when the deployment has a reviewer that can make one. A claim-level
  // verdict is evidence about the claim and not about the sentence citing the source, and the
  // difference is not academic: a sentence that states more than the claim did, or states it about a
  // different system, inherits a `supported` it never earned. Where an assessor is configured, every
  // citing sentence is assessed against its own text and the refusals below are fatal; where none is,
  // nothing is inherited either — the bindings carry the claim's verdict and the draft records that no
  // sentence-level reading was made, which is what `checkStatementSupport` reports.
  const assessor = ctx.statementAssessor
  const assessments = assessor === undefined
    ? []
    : await assessStatements(assessor, statements, judgements)
  // THE REFUSAL APPLIES WHERE A READING WAS POSSIBLE. A deployment with an assessor made one reading
  // per citing sentence, so a sentence it did not cover — or covered at a version that has since been
  // rewritten — is a sentence nothing verified, and that is fatal. A deployment with NO assessor is a
  // different fact and is recorded as itself (`statementAssessments: []` below): it cannot read a
  // passage against a sentence, so refusing its runs would be refusing the deployment rather than the
  // manuscript. What it must not do is the thing this unit removes — claim a sentence-level verdict
  // it never made — which is why the empty list is on the artifact rather than left to inference.
  const supportRefusals = assessor === undefined
    ? []
    : checkStatementSupport(assessments, statements, judgements)
  if (supportRefusals.length > 0) {
    throw new Error(
      `[D3-writing] [${supportRefusals[0]?.code ?? 'statement-unassessed'}] `
      + supportRefusals.map(refusal => refusal.detail).join('; '),
    )
  }
  const bound = bindJudgements(judgements, statements, assessments)
  // A REVIEWED SOURCE NO SENTENCE CITES IS REFUSED, not dropped from the reference list. The two ways
  // to reach it are a manuscript that never stated a position its own evidence supports and a source
  // that does not bear on this paper — and the second is a judgement that should not have been made,
  // which a reader has to fix rather than a list that quietly omits it. The REFERENCE LIST is derived
  // from the bindings below, so an omission here would make the defect invisible instead of refused.
  if (bound.uncited.length > 0) {
    throw new Error(
      '[D3-writing] [citation-source-uncited] '
      + `${bound.uncited.map(judgement => `'${judgement.citeKey}'`).join(', ')} `
      + 'carry a reviewed judgement about this claim and no sentence in the draft cites them — the'
      + ' paper states no position its own evidence establishes, or the judgement does not bear on it',
    )
  }
  const citations = bound.uses
  const references = referenceEntriesFor(citations, ctx.sources)
  const sectionEvidence = headings.map(h => evidenceFor(h.id))
  const refused = sectionEvidence.filter(entry => entry.missing.length > 0)

  // THE RESULTS TABLE IS PART OF THE DOCUMENT, SO IT IS RENDERED WHERE THE DOCUMENT IS WRITTEN.
  //
  // THIS REVERSES THE T19-S RULING THAT PUT IT IN E1, and the reason is what the two steps can know.
  // T19-S read the table as a FORMATTING concern — a paper gets a three-line table when it is set —
  // and the ruling stands as far as it goes: the capability belongs to the tool, not to the step, and
  // E1 never was `renderThreeLineTable`. What it missed is that a document which is authoritative
  // before it is typeset has to CONTAIN its table already. E1 could only render one by reading the
  // run's measurements itself, which made E1 the second step to decide what the paper's numbers are
  // and let the compiled document carry a table the manuscript Markdown did not. D3 writes the
  // document; the table is one of its blocks; so D3 renders it, as its own invocation of the tool.
  const tableInvoker = ctx.invoker ?? new DirectResearchToolInvoker('d3-fixture')
  const tableInvocation = await tableInvoker.invoke(
    'three-line-table',
    { model: ctx.runCtx.adapter.table(d3Outcome.measured), target: 'markdown' },
    { timestamp: FIXED_TS },
  )
  if (!tableInvocation.ok) {
    throw new Error(`[D3-writing] three-line-table invocation failed: ${tableInvocation.message}`)
  }
  const tableRender = tableInvocation.artifact as ReturnType<typeof renderThreeLineTable>
  // THE MANUSCRIPT'S OWN FLOATS, composed once here: the Markdown the package prints and the document
  // a compiler renders are two renderings of one list, and a table laid out in one of them and read
  // from the plan in the other is how the two come to describe different papers.
  const title = typeof outline?.title === 'string' ? outline.title : planOf(ctx).title
  const tableMarkdown = pipeTableOf(tableRender.table)
  const floats = composeFloats(planFloats(renderedFigures), {
    ...(tableMarkdown === undefined ? {} : { markdown: tableMarkdown }),
    raw: tableRender.render.text,
    note: tableNoteOf(ctx),
  }, '[D3-writing]')
  // THE DOCUMENT ITSELF, which every later step reads and republishes and E1 renders. It is a
  // ManuscriptDocument and not a field of this artifact: what the steps after this one hand on, check
  // and compile is the document, and the sections beside it are the writing record this step owes.
  const referenceEntries = formattedReferenceEntries(references)
  const document = documentOf({
    title,
    sections: sections.map(section => ({
      id: section.id,
      heading: section.heading,
      bodyText: section.bodyText,
    })),
    floats: floats.document,
    equations: equationBlocksOf(ctx),
    references: numberedReferenceEntries(referenceEntries),
  })

  // THE KEY IS THE OUTPUT SLUG — what `commitStepOutputs` matches against the step's declared
  // outputs (INV-OUTPUT-CONTRACT). Renaming the value's `slug` field alone leaves the commit naming
  // an artifact no step declares, which the engine refuses as `DSH_COMMIT_OUTPUT_NOT_DECLARED`.
  return {
    manuscript: tagArtifact(
      {
        fixture: proseSource === 'fixture',
        stepId: 'D3-writing',
        slug: 'manuscript',
        title: planOf(ctx).title,
        claimRef,
        sections,
        proseSource,
        proseRoute,
        // WHAT WAS READ ABOUT EACH SENTENCE — PRESENT ONLY WHEN SOMETHING COULD READ THEM. A
        // deployment with no assessor cannot judge a passage against a sentence, and the honest record
        // of that is the absence of this field rather than an empty list: an empty list would say the
        // readings were made and found nothing, which is the reading this unit exists to stop a
        // consumer from making. E1 refuses an unassessed sentence exactly when this field is present.
        ...(assessor === undefined ? {} : { statementAssessments: assessments }),
        // WHAT EACH SECTION WAS ASKED FOR, with the evidence and the versions behind it. The record
        // is what makes "which request produced the sentence whose judgement was refused" answerable
        // from the run rather than from a log nobody kept.
        proseRequests,
        proseRequestVersion: PROSE_REQUEST_VERSION,
        // WHAT EACH SECTION WAS WRITTEN FROM, and which sections could not be written. A reader
        // holding only the prose cannot tell a section backed by the run's measurement from one the
        // model filled in, and neither can a reviewer.
        sectionEvidence: sectionEvidence.map(entry => ({
          sectionId: entry.sectionId,
          required: entry.required,
          supplied: Object.keys(entry.supplied),
          missing: entry.missing,
        })),
        refusedSections: refused.map(entry => entry.sectionId),
        // WHICH numbers this draft quotes and where they came from. `result-version` means the
        // step read the run's own record; `recomputed` means it measured the study itself, which
        // in a driven run is the defect `result-version.ts` exists to make visible.
        resultSource: d3Outcome.source,
        resultRef: d3Outcome.contentHash,
        figureRef: figures ?? 0,
        landscapeRef: hitCount ?? 0,
        // WHERE THE MANUSCRIPT'S STATEMENTS ARE, each with the version of its text. The identity
        // survives a revision and the version does not, which is what lets a reader see that a node's
        // text changed and lets a judgement about the old text be refused.
        statements,
        // WHAT THIS PAPER CITES, with the passage each citation was read from AND the versions the
        // judgement was made about. The reference list below is derived from these, so a reader of the
        // draft can check that every entry rests on a sentence and every sentence on a passage
        // somebody read.
        citations,
        // THE REVIEWED SOURCES NO SENTENCE CITES. Reported rather than dropped: a judgement nobody
        // used is either a manuscript that failed to state a position it holds, or a source that does
        // not bear on this paper — and only a reader can say which.
        uncitedSources: bound.uncited.map(judgement => judgement.citeKey),
        references,
        // THE PLAN THIS DRAFT WAS WRITTEN UNDER, with its version, so the log can rebuild what each
        // section was asked for and which argument the run had when it wrote them.
        argumentPlan,
        renderedFigures,
        // THE DOCUMENT THIS STEP WROTE — sections with their blocks, the floats in the plan's order,
        // the equations the method states, and the references keyed the way the prose cites them.
        // Every later step reads THIS rather than re-deriving a document from the parts: D4 revises
        // it, E1 renders it, and the acceptance replaces it.
        document,
        // WHAT THE TABLE TOOL PRODUCED, which is not what the paper prints. The document's table
        // block carries a pipe table because that is what a Markdown reader draws; the tool's own
        // rendering is the box-drawing form the package's `experiment-tables.md` holds, and its
        // binding hash is the provenance of the render. Recorded here because this is the step that
        // invoked it, so a reader can tell a table this run rendered from one nothing produced.
        tableRender: {
          tool: `${THREE_LINE_TABLE_TOOL_ID}@${THREE_LINE_TABLE_TOOL_VERSION}`,
          markdown: tableRender.render.text,
          bindingHash: tableRender.bindingHash,
        },
        note: proseSource === 'fixture'
          ? 'synthetic manuscript draft — sections mirror the D2 outline ids; no drafting model call in this wave'
          : 'manuscript draft whose section bodies came from a real model call',
      },
      producer,
      // THE REAL three-line-table tool function ran over this draft's table, so the fixture path is
      // `real_tool_fixture_input` and not `fixture_executor`: the level names what this executor did,
      // and a step that executes a catalogue tool may not report itself as a deterministic fixture.
      // With a prose writer the artifact names the channel that wrote the text instead
      // (`live_external` / `mock_external`), which is the level this registry's own header reserves
      // for deployment-varying facts.
      proseSource === 'fixture' ? 'real_tool_fixture_input' : proseKindOf(proseSource),
    ),
  }
}

/** D4-rebuttal: fixture that reads the D3 draft, produces an adversarial rebuttal
 *  record and a revised draft (same sections, revision markers). */


/**
 * How many revision rounds the author may be asked for.
 *
 * DEPLOYMENT CONFIGURATION, not a constant inside the executor: how many times it is worth asking a
 * model to fix a manuscript is a property of the deployment's budget, and this repository requires
 * deployment-varying choices to be validated config fields rather than `DEFAULT_*` constants.
 *
 * @param ctx - the execution context.
 * @returns the configured bound, or the shipped default when the deployment set none.
 */
function revisionRoundsOf(ctx: ExecCtx): number {
  const configured = ctx.revisionRounds
  return typeof configured === 'number' && Number.isSafeInteger(configured) && configured >= 1
    ? configured
    : DEFAULT_REVISION_ROUNDS
}

/**
 * The shipped bound on revision rounds.
 *
 * TWO: one round cannot close a concern the applier refused for a reason another round could fix,
 * and a third is a model being asked the same question again. A deployment that wants a different
 * bound sets `revisionRounds`.
 */
const DEFAULT_REVISION_ROUNDS = 2

async function d4Executor(ctx: ExecCtx): Promise<Record<string, unknown>> {
  const { claimRef } = canonicalOf(ctx)
  const draft = readInput(ctx, 'manuscript')
  const sections = sectionsOf(draft, planOf(ctx), ctx)
  // A revision keeps the reference list it is revising. Dropping it here is what
  // made the assembled manuscript report zero references while its own references
  // section described the landscape scan it was built from.
  const references = Array.isArray(draft?.references) ? draft.references : []
  // A REVISION KEEPS ITS CITATIONS, and this is not bookkeeping: E1 refuses a manuscript that cites a
  // source the run holds no reviewed judgement about, so a revision that dropped the bindings would
  // turn every correct citation into an unreviewed one and stop the run at the assembly.
  const citations = Array.isArray(draft?.citations) ? draft.citations : []
  // AND THE ARGUMENT PLAN, for the same reason and one more: a revision is written under the plan the
  // draft was, and a plan recomputed at assembly could oblige a section to say something it was never
  // asked for.
  const argumentPlan = draft?.argumentPlan as ArgumentPlan | undefined
  // Same reasoning as the references: a revision keeps the figures it is revising.
  const renderedFigures = Array.isArray(draft?.renderedFigures) ? draft.renderedFigures : []
  // AND WHAT D3 RECORDED ABOUT HOW IT WROTE THE DOCUMENT THIS STEP REPUBLISHES. There is ONE
  // manuscript artifact with ONE version counter now: D3 creates it and this step overwrites it
  // under the same slug, so a field dropped here is a fact the run no longer holds anywhere — there
  // is no second slug to read it from, and the reader of the current manuscript is the only reader
  // there is. `refusedSections` is the one with a consumer inside the product: `manuscriptFactsOf`
  // decides the package's `no-refused-sections` check from it, so a revision that dropped it
  // reported a run that had refused a section as one that had refused none. The other three are the
  // draft's own record of what each section was asked for and written from, which is the log a
  // refused statement or citation has to be traceable to.
  const proseRequests = Array.isArray(draft?.proseRequests) ? draft.proseRequests : []
  const proseRequestVersion = draft?.proseRequestVersion
  const sectionEvidence = Array.isArray(draft?.sectionEvidence) ? draft.sectionEvidence : []
  const refusedSections = Array.isArray(draft?.refusedSections) ? draft.refusedSections : []
  // AND THE TABLE TOOL'S OWN OUTPUT, for the same reason: this step recomputes no table, and the
  // package's `experiment-tables.md` is D3's rendering of it. A republisher that dropped it left the
  // package without the file, which is the "declared but not produced" defect stated the other way
  // round.
  const tableRender = draft?.tableRender
  // AND THE DOCUMENT THIS STEP REPUBLISHES. E1 renders it and the acceptance replaces it, so a
  // revision that dropped it would leave the typeset artifact describing the text D3 wrote — the
  // revision's own sections would be in the artifact and nowhere a compiler could see them. It is
  // REBUILT rather than carried verbatim because its prose blocks are the revised bodies; its floats,
  // equations and references are the ones it already carries, so no part of it is re-derived from
  // the plan here.
  const carriedDocument = draft?.document as ManuscriptDocument | undefined
  const d4Outcome = measureOutcomeWithSource(ctx)
  const measured = d4Outcome.measured

  // The exchanges are organised by the real module, which computes the revision
  // tally from the points and refuses an empty or shell response. With a writer the
  // concerns come from the model; without one they are the questions this study's own
  // design raises, stated with the MEASURED numbers rather than a remembered constant.
  const writer = ctx.proseWriter
  // The bodies the author is shown, keyed by section. A patch is written against one of THESE, and
  // the basis hash travels with the issue so the applier can refuse a patch aimed at a version that
  // no longer exists.
  const bodiesShown = new Map(sections.map(section => [section.id, section.bodyText]))
  let issues: ReadonlyArray<Omit<RevisionIssue, 'basisHash'>> = []
  // The exchanges a reply opened and did not complete. Non-empty only for the fixture path here —
  // the model path refuses instead — and reported on the artifact either way.
  let discardedExchanges: ReadonlyArray<DiscardedExchange> = []
  let points: ReadonlyArray<RebuttalPoint> = []
  let rebuttalSource: 'model' | 'deterministic' | 'fixture' = 'fixture'
  let rebuttalRoute: Record<string, unknown> = proseRouteOf(undefined)
  // WHO WROTE THE ANSWERS, as this side records it. An EXECUTION — its own id, its own session, the
  // role it occupied and the version of the instructions it was given — because those are what a
  // verification has to differ from. The model is recorded too, and only as a shared-bias note:
  // a deployment that writes and verifies on one model is making a decision it is allowed to make.
  let author: ExecutionIdentity = fixtureExecution('fixture:rebuttal', 'deterministic-fixture-v1')
  let applied = applyRevision(sections, [])
  // THE CYCLE'S READINGS, not the last round's. A round that closes everything it found produces no
  // verifications at all, so an audit taken from the final `applied` would report "nobody read this"
  // about a revision that was read twice.
  const verifications: Array<NonNullable<AppliedRevision['verifications']>[number]> = []
  // HOW MANY ROUNDS THIS TOOK, AND WHY IT STOPPED. One round is not a revision cycle: a concern the
  // applier refused — written against another version, changing nothing, or conflicting with another
  // patch — used to end there, with the round number hard-coded to 1 and nothing to try again.
  // `revisionRounds` bounds how many times the author may be asked; the cycle stops early when
  // another round could not change anything.
  // WHY THE CYCLE ENDED, and `awaiting-verification` is a reason of its own: the authors answered and
  // nobody has read the answers, so more rounds cannot settle it — a state a reader can act on, and a
  // different fact from an exhausted budget.
  let stoppedBecause: 'closed' | 'no-progress' | 'budget' | 'awaiting-verification' = 'closed'
  const rounds: Array<Record<string, unknown>> = []
  /**
   * What one round did, in the terms a reader needs: what it was asked, what it closed, what it
   * left, and why the cycle moved on or stopped.
   *
   * @param round - the 1-based round number.
   * @param result - the applier's outcome for it.
   * @param stopped - why the cycle did not continue past it.
   * @returns the record for the artifact.
   */
  // THE ROUNDS AS THE POLICY READS THEM, kept beside the artifact's own record: an index, what the
  // round left owed, and why the cycle moved on from it.
  const policyRounds: ReviewedRound[] = []
  const recordRound = (
    round: number,
    result: ReturnType<typeof applyRevision>,
    stopped: 'closed' | 'no-progress' | 'budget' | 'awaiting-verification',
  ): Record<string, unknown> => ({
    roundId: `t19s-rebuttal-${String(round)}`,
    opened: result.outcomes.length,
    closed: result.outcomes.filter(outcome => outcome.disposition !== 'open').length,
    /// The issues this round left open, so a reader can find them in `issues`.
    open: result.openIssues,
    /// The SECTIONS they are on — what the next round is told, and what "no progress" compares:
    /// issue ids are renumbered every round, so they cannot say whether anything moved.
    openSections: result.outcomes
      .filter(outcome => outcome.disposition === 'open')
      .map(outcome => outcome.sectionId),
    /// PER ISSUE, what this round did with it. The policy below counts rounds and asks whether the
    /// last one left anything owed, and a reader asking "what happened in round 2" needs the same
    /// thing — one field serves both rather than two that can disagree.
    dispositions: result.outcomes.map(outcome => `${outcome.issueId}:${outcome.disposition}`),
    stoppedBecause: stopped,
  })
  if (writer === undefined) {
    const resultsBody = bodiesShown.get('results') ?? ''
    points = [
      {
        concern: `Is the measured ${planOf(ctx).metric.label} change of ${measured.improvementPct.toFixed(2)}% robust at the boundary?`,
        response: 'Boundary probing at C3 re-runs the same simulation under stop-and-go forcing and reports the measured margin ratio, which delimits the applicability domain.',
        requiresRevision: false,
      },
      {
        concern: 'Are the SOTA anchors real?',
        response: `No published-SOTA row is recorded: a figure for ${planOf(ctx).metric.label} must be read out of a paper, so the comparison is against this study's own measured baseline and says so.`,
        requiresRevision: true,
      },
    ]
    issues = [
      {
        issueId: 'd4-issue-1',
        // The boundary question is answered without touching the text, which is what an
        // `accepted_explanation` is and why it is recorded apart from a patch.
        sectionId: 'results',
        concern: points[0]?.concern ?? '',
        response: points[0]?.response ?? '',
        requiresTextChange: false,
      },
      {
        issueId: 'd4-issue-2',
        sectionId: 'results',
        concern: points[1]?.concern ?? '',
        response: points[1]?.response ?? '',
        requiresTextChange: true,
        // A REAL patch: the results section gains the sentence the concern asks for. It introduces
        // no number, which is what keeps it past the A gate's number check — and it names NO
        // quantity, because the executor does not know which study it is revising: a sentence about
        // a minimum time-to-collision patched into a queueing study's results is a manuscript
        // describing a measurement its own run never took.
        patch: `${resultsBody} No published-SOTA row is recorded: a published figure for the measured quantity has to be read out of a paper, so the comparison is against this study's own measured baseline and says so.`,
      },
    ]
    applied = applyRevision(
      sections,
      issues.map(issue => ({ ...issue, basisHash: bodyHashOf(bodiesShown.get(issue.sectionId) ?? '') })),
    )
    applied = await appliedWithVerification(
      ctx, applied, issues.map(issue => ({ ...issue, basisHash: bodyHashOf(bodiesShown.get(issue.sectionId) ?? '') })),
      new Map(applied.sections.map(section => [section.id, section.bodyText])), author,
    )
    verifications.push(...applied.verifications ?? [])
    // The fixture path writes its issues once; one round IS its whole cycle, and it is recorded as
    // one rather than pretending a model was asked again.
    // A ROUND IS NOT "CLOSED" BECAUSE IT APPLIED PATCHES. The stop condition reads what is still
    // owed: nothing open AND nothing waiting for a reader. Reporting `closed` on the strength of the
    // patches alone is how a round with three unread issues looked like a settled review.
    stoppedBecause = applied.openIssues.length > 0
      ? 'budget'
      : applied.awaitingVerification.length === 0 ? 'closed' : 'awaiting-verification'
    rounds.push(recordRound(1, applied, stoppedBecause))
    policyRounds.push({ index: 1, outcomes: applied.outcomes, stopped: stoppedBecause })
  } else {
    // THE CYCLE. Each round reads what the previous one wrote and is told what it did not close, so
    // a concern the applier refused for a reason another round could fix gets that round. The bound
    // is configuration; the early exit is what keeps it from becoming a model asked the same
    // question twice.
    const maxRounds = revisionRoundsOf(ctx)
    let current = sections
    /** The SECTIONS the previous round left open; see the no-progress test below. */
    let open: ReadonlyArray<string> = []
    for (let round = 1; round <= maxRounds; round += 1) {
      const analysis = await writer.write({
        stepId: 'D4-rebuttal',
        instruction: [
          'Write the review exchanges this paper must answer.',
          'Reply with one exchange per group of FOUR lines, at least two exchanges:',
          'CONCERN: <reviewer concern>',
          'SECTION: <the id of the section the concern is about>',
          'RESPONSE: <the author response, using only the measurements given in the context>',
          'PATCH: <the complete replacement body for that section, or exactly NONE when the answer '
          + 'changes no text>',
          'A PATCH replaces the whole section, so it must keep every sentence the section still needs.',
        ].join('\n'),
        // The bodies travel so a patch can be written against them, and the section ids travel so a
        // reply can name one without inventing the outline.
        context: {
          ...planContextOf(planOf(ctx)),
          claimRef,
          measured,
          sections: current.map(section => ({ id: section.id, heading: section.heading, bodyText: section.bodyText })),
          // WHAT THE LAST ROUND LEFT. A round told nothing about its own open concerns would write
          // the same reply again and produce the same refusal.
          openIssues: open,
          round,
        },
        ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
      })
      // A MALFORMED REPLY IS REFUSED, not partially read. `assertWellFormed` names the exchanges the
      // reply did not state completely; before this, they were dropped on the floor and the step
      // passed with an empty `openIssues`, which is the difference between "the author accepted three
      // concerns" and "the model answered one of them".
      const reply = parseReply(analysis.text)
      const parsed = assertWellFormed(reply, 'D4-rebuttal')
      discardedExchanges = reply.discarded
      issues = parsed.map(issue => ({
        issueId: issue.issueId,
        sectionId: issue.sectionId,
        concern: issue.concern,
        response: issue.response,
        // `declared-none` is a conclusion: the author accepts the concern without changing the text.
        // `missing` never reaches here — `assertWellFormed` refuses it.
        requiresTextChange: issue.patchState === 'replacement',
        ...(issue.patch === undefined ? {} : { patch: issue.patch }),
      }))
      points = parsed.map(issue => ({
        concern: issue.concern,
        response: issue.response,
        requiresRevision: issue.patchState === 'replacement',
      }))
      rebuttalSource = proseLabelling(writer).source
      rebuttalRoute = proseRouteOf(analysis)
      if (rebuttalSource === 'model') author = modelExecution(analysis)

      // The basis each patch is written against is THIS round's body, not the draft's.
      const currentBodies = new Map(current.map(section => [section.id, section.bodyText]))
      applied = applyRevision(
        current,
        issues.map(issue => ({ ...issue, basisHash: bodyHashOf(currentBodies.get(issue.sectionId) ?? '') })),
      )
      applied = await appliedWithVerification(
        ctx, applied, issues.map(issue => ({ ...issue, basisHash: bodyHashOf(currentBodies.get(issue.sectionId) ?? '') })),
        new Map(applied.sections.map(section => [section.id, section.bodyText])), author,
      )
      verifications.push(...applied.verifications ?? [])
      // NO PROGRESS IS MEASURED BY SECTION, NOT BY ISSUE ID. A round numbers its issues from one, so
      // `d4-issue-1` names a different concern in every round — comparing ids would call two rounds
      // that failed on the SAME sections "progress" and spend the budget re-asking. What repeated
      // means is that the manuscript is no better off: the same sections are still open.
      // WHAT IS STILL OWED, split by what would settle it. An OPEN issue needs work, so asking the
      // author again can help. An issue waiting for a READER cannot be settled by asking again: the
      // answer is on the table and the round would get the same one, which is why the cycle stops
      // there and says so — a run that kept spending rounds on it would report a settled review (or
      // an exhausted budget) over answers nobody had read, and the review of 2026-09-18 named exactly
      // that early stop.
      const leftOpen = applied.outcomes
        .filter(outcome => outcome.disposition === 'open')
        .map(outcome => outcome.sectionId)
      const awaitingReader = applied.outcomes
        .filter(outcome => outcome.disposition === 'pending-verification')
        .map(outcome => outcome.sectionId)
      const repeated = leftOpen.length > 0
        && leftOpen.length === open.length
        && leftOpen.every(sectionId => open.includes(sectionId))
      stoppedBecause = leftOpen.length === 0
        ? (awaitingReader.length === 0 ? 'closed' : 'awaiting-verification')
        : repeated ? 'no-progress' : 'budget'
      // A CLOSED ROUND IS NOT A FINISHED REVIEW. The deployment states a MINIMUM number of complete
      // readings, so a first round that closed everything is asked for a second one — the case the
      // review named, where "the first round closed its issues" ended the review after one reading.
      // `awaiting-verification` is different and does NOT continue: the answers are on the table and
      // only a reader can settle them, so asking the author again would produce the same answers.
      // RECORD THE ROUND FIRST, whatever happens next: a reading that was taken counts, and a round
      // skipped by the floor below is still a reading the manuscript actually had.
      rounds.push(recordRound(round, applied, stoppedBecause))
      policyRounds.push({ index: round, outcomes: applied.outcomes, stopped: stoppedBecause })
      // A CLOSED ROUND IS NOT A FINISHED REVIEW. The deployment states a MINIMUM number of complete
      // readings, so a first round that closed everything is asked for a second one — the case the
      // review named, where "the first round closed its issues" ended the review after one reading.
      // `awaiting-verification` does NOT continue: the answers are on the table and only a reader can
      // settle them, so asking the author again would produce the same answers.
      const floor = reviewPolicyOf(ctx).minimumRounds
      if (stoppedBecause === 'closed' && round < floor && round < maxRounds) {
        current = applied.sections
        open = leftOpen
        continue
      }
      // A round that closed everything is done; one that repeated the previous round's open set has
      // been answered already; the last allowed round is the budget.
      if (stoppedBecause !== 'budget' || round === maxRounds) break
      current = applied.sections
      open = leftOpen
    }
  }

  // WHAT THE ROUND ACTUALLY CHANGED. Each issue is bound to the version it was written against,
  // and the applier decides: a patch applies, a conflict or an empty diff stays open, an answer
  // without a change is an accepted explanation. `revised` follows from the bodies, never from a
  // flag a caller set.
  const record = buildRevisionRecord(points)
  const revised: ReadonlyArray<ManuscriptSection & { readonly revised: boolean }> = applied.sections
  // The document as this step republishes it: the revised bodies, everything else as it read it.
  const republished = carriedDocument === undefined
    ? {}
    : {
      document: documentOf({
        title: carriedDocument.title,
        sections: revised.map(section => ({
          id: section.id,
          heading: section.heading,
          bodyText: section.bodyText,
        })),
        floats: documentFloatsOf(carriedDocument),
        equations: equationBlocksOf(ctx),
        references: carriedDocument.references,
      }),
    }
  return {
    rebuttal: tagArtifact(
      {
        fixture: rebuttalSource === 'fixture',
        stepId: 'D4-rebuttal',
        slug: 'rebuttal',
        roundId: rounds[rounds.length - 1]?.['roundId'] ?? 't19s-rebuttal-1',
        claimRef,
        rebuttalSource,
        rebuttalRoute,
        exchanges: record.points,
        revisionCount: record.revisionCount,
        hasRevisions: record.hasRevisions,
        // PER ISSUE, not per round: what became of each concern, and the before/after hashes of
        // every section a patch changed. A round that closes nothing says so with an empty
        // `patchedSections` rather than with a flag nothing supports.
        issues: applied.outcomes,
        changes: applied.changes,
        discardedExchanges,
        patchedSections: applied.patchedSections,
        openIssues: applied.openIssues,
        // AND WHAT NOBODY HAS READ. A round that applied three patches has three issues waiting for a
        // reader, and a record that showed only `openIssues: []` would read as three answered
        // concerns — the reading the review of 2026-09-18 refused.
        awaitingVerification: applied.awaitingVerification,
        // THE READINGS THEMSELVES, so "an independent reading happened" is answerable from the run's
        // own record: each names the execution, the session and the rules the host minted for it.
        verificationAudit: verifications,
        // THE CYCLE'S OWN RECORD, so a reader can see whether the author was asked once or as many
        // times as the configuration allows, and whether the last round stopped because it closed
        // everything or because asking again could not change anything.
        rounds,
        revisionRounds: revisionRoundsOf(ctx),
        stoppedBecause,
        // WHAT THE DEPLOYMENT REQUIRES AND WHAT IT GOT. A package that could only be read through the
        // rebuttal record could not tell "two complete rounds" from "one round that closed early",
        // and every later reader — the export, a reviewer, a person — would be re-deriving it.
        reviewPolicy: { minimumRounds: reviewPolicyOf(ctx).minimumRounds },
        review: reviewSatisfaction(policyRounds, reviewPolicyOf(ctx)),
        note: rebuttalSource === 'fixture'
          ? 'exchanges written from this study\'s own design questions, with measured numbers'
          : 'exchanges written by the model from the measured outcome',
      },
      D4_PRODUCER,
      proseKindOf(rebuttalSource),
    ),
    'manuscript': tagArtifact(
      {
        fixture: true,
        stepId: 'D4-rebuttal',
        slug: 'manuscript',
        title: planOf(ctx).title,
        claimRef,
        sections: revised,
        // The same per-section fact on the draft, so a reader of the manuscript alone can tell a
        // section a patch changed from one it did not.
        patchedSections: applied.patchedSections,
        openIssues: applied.openIssues,
        awaitingVerification: applied.awaitingVerification,
        citations,
        references,
        // THE DOCUMENT'S OWN WRITING RECORD TRAVELS WITH IT — see the reads above.
        proseRequests,
        ...(typeof proseRequestVersion === 'string' ? { proseRequestVersion } : {}),
        sectionEvidence,
        refusedSections,
        // THE READINGS TRAVEL WITH THE MANUSCRIPT THEY WERE MADE ABOUT. D4 rebuilt the revised draft
        // without this field, so a run under a deployment that HAD read every sentence arrived at E1
        // looking like one that could not — and E1, reading the absence as "no assessor", skipped the
        // check entirely (reproduced by the pipeline review of 2026-09-18 with a deterministic
        // assessor: 3 assessments at D3, none on the revised draft, E1 passed). A patch that rewrote a
        // sentence makes its assessment stale rather than absent: `assessStatements` re-reads exactly
        // those, so what arrives here is a reading of THIS manuscript.
        ...(ctx.statementAssessor === undefined
          ? {}
          : {
            statementAssessments: await assessStatements(
              ctx.statementAssessor,
              locateStatements(revised.map(section => ({ id: section.id, bodyText: section.bodyText }))),
              judgementsFor(claimRef, ctx.sources),
              carriedAssessments(ctx),
            ),
          }),
        ...(argumentPlan === undefined ? {} : { argumentPlan }),
        renderedFigures,
        // WHAT THIS STEP SET IS THE DOCUMENT THAT WAS REVISED — see `republished` above — and the
        // table render it carries, which this step recomputes nothing about.
        ...republished,
        ...(tableRender === undefined ? {} : { tableRender }),
        resultSource: d4Outcome.source,
        resultRef: d4Outcome.contentHash,
        note: 'revised draft — same section ids as the D3 draft, with `revised` set only on the sections a patch actually changed',
      },
      D4_PRODUCER,
      'fixture_executor',
    ),
  }
}

/**
 * The results table as a Markdown pipe table, or `undefined` when it cannot be laid out as one.
 *
 * THE TOOL'S OWN "markdown" RENDERING IS NOT THIS: it draws a fixed-width table with box-drawing
 * rules, which a Markdown reader shows as a code block rather than as a table. This is built from the
 * structured model the tool returned, not by re-parsing its text.
 *
 * @param model - the table model the three-line-table capability returned.
 * @returns the pipe table, or `undefined` when it carries no columns or a row whose width differs
 *   from the header's — the caller states that fact rather than reshaping the table.
 */
function pipeTableOf(
  model: ReturnType<typeof renderThreeLineTable>['table'],
): string | undefined {
  const header = model.columns.map(
    column => column.unit === undefined ? column.header : `${column.header} (${column.unit})`,
  )
  const rows = model.rows.map((row) => {
    const cells: string[] = []
    row.forEach((cell, index) => {
      const column = model.columns[Math.min(index, model.columns.length - 1)]
      if (column === undefined) return
      cells.push(threeLineTableCellText(cell, column, THREE_LINE_TABLE_DEFAULT_MISSING_TOKEN))
      // A pipe table cannot merge cells, so a colSpan cell is followed by empty cells to keep every
      // row the same width — `markdownPipeTable` refuses a row that disagrees with its header.
      for (let extra = 1; extra < (cell.colSpan ?? 1); extra += 1) cells.push('')
    })
    return cells
  })
  return header.length > 0 && rows.every(row => row.length === header.length)
    ? markdownPipeTable(header, rows)
    : undefined
}

/**
 * The reference list, formatted, in the order the manuscript cites its sources.
 *
 * Built from the FIELDS, not by joining whatever happened to be present: a record with no authors
 * would begin with its title, which reads as a complete citation, and one with no venue would run two
 * sentences together. `formatReference` states what is missing instead. The numbering is the array
 * position, so the entries here and the numbers an in-text marker uses are one array read twice.
 *
 * ONE FUNCTION BECAUSE IT IS ONE LIST: D3 builds the document's references with it and E1 renders the
 * numbered list the Markdown prints with it, so the citations a compiled document resolves and the
 * entries the paper prints cannot be two readings of the record.
 *
 * @param rawRefs - the reference records the manuscript carries.
 * @returns one entry per record, carrying the key it is cited under when it has one.
 */
function formattedReferenceEntries(
  rawRefs: ReadonlyArray<unknown>,
): ReadonlyArray<{ readonly citeKey: string | undefined; readonly formatted: string }> {
  return rawRefs.map((raw) => {
    const ref = raw as {
      citeKey?: unknown
      title?: unknown
      venue?: unknown
      identifier?: unknown
      authors?: unknown
      year?: unknown
    }
    return {
      citeKey: typeof ref.citeKey === 'string' ? ref.citeKey : undefined,
      formatted: formatReference({
        ...(Array.isArray(ref.authors)
          ? { authors: (ref.authors as ReadonlyArray<unknown>).filter((a): a is string => typeof a === 'string') }
          : {}),
        ...(typeof ref.title === 'string' ? { title: ref.title } : {}),
        ...(typeof ref.venue === 'string' ? { venue: ref.venue } : {}),
        ...(typeof ref.year === 'number' || typeof ref.year === 'string' ? { year: ref.year } : {}),
        ...(typeof ref.identifier === 'string' ? { identifier: ref.identifier } : {}),
      }),
    }
  })
}

/**
 * The document's reference list: the formatted entries and the number each prints under.
 *
 * @param entries - the formatted entries, in citation order.
 * @returns one reference per entry that carries a cite key, numbered from 1.
 */
function numberedReferenceEntries(
  entries: ReadonlyArray<{ readonly citeKey: string | undefined; readonly formatted: string }>,
): ReadonlyArray<DocumentReference> {
  return entries.flatMap((entry, index) =>
    entry.citeKey === undefined
      ? []
      : [{ citeKey: entry.citeKey, entry: entry.formatted, number: index + 1 }])
}

/**
 * The floats a document carries, in the order it carries them.
 *
 * THIS IS HOW A LATER REPUBLISHER REBUILDS THE DOCUMENT without re-deriving a float list: a revision
 * changes the prose, and the floats, the equations and the references it already carries are carried
 * through. Prose and equations are excluded because `documentOf` composes them itself — from the
 * section bodies the caller passes and from the equations the study declares.
 *
 * @param document - the document as the run holds it.
 * @returns its labelled floats, in order.
 */
function documentFloatsOf(document: ManuscriptDocument): ReadonlyArray<DocumentBlock> {
  return document.sections.flatMap(section =>
    section.blocks.filter(block => block.kind !== 'prose' && block.kind !== 'equation'))
}

/** The study's equations, as the document states them. */
function equationBlocksOf(ctx: ExecCtx): ReadonlyArray<{ readonly label: string; readonly latex: string }> {
  return ctx.runCtx.adapter.implementation.equations
    .map(equation => ({ label: equation.name, latex: equation.latex }))
}

/**
 * What the results table is a table OF, as the caption states it.
 *
 * NAMED BY THE RUN, NOT BY A STEP: which arms were measured and under what conditions is the study's
 * own fact, and a caption naming the platoon study's would sit under a queueing study's table.
 */
function tableNoteOf(ctx: ExecCtx): string {
  return `Measured by running ${ctx.runCtx.adapter.implementation.id}'s two arms under the same declared conditions.`
}

/**
 * The floats one manuscript carries, rendered both ways at once.
 *
 * A FLOAT LIST IS ONE FACT WITH TWO RENDERINGS: the Markdown blocks the package's `manuscript.md`
 * prints, and the document blocks a compiler renders. They used to be built by two steps from the
 * same plan — D3's document and E1's Markdown — and a label, a caption or a rendering could reach one
 * and not the other. One function returns both, so the pair cannot disagree: they are two readings of
 * one array, produced together.
 *
 * THE TABLE IS THE CALLER'S, because only the caller knows where it came from: D3 lays it out from
 * the tool's structured model the moment it invokes the capability, and E1 takes the block the
 * document already carries. A table the renderer cannot lay out is passed with no `markdown`: the
 * tool's own rendering stands in for it in the Markdown, the label is reported as not rendered, and
 * the document carries no table block — which is the same fact stated in all three places.
 *
 * @param plan - the plan's labelled floats, in plan order.
 * @param table - the table as the caller has it: its pipe Markdown when it could be laid out, the
 *   tool's own rendering either way, and the caption's second sentence.
 * @param step - the step label a refusal is raised under, e.g. `[E1-format]`.
 * @returns both float lists, the renderings the package writes as its own files, and what the plan
 *   declares that the manuscript does not carry.
 * @throws {Error} when the plan declares no three-line-table, so a table would carry a number no plan
 *   assigned.
 */
function composeFloats(
  plan: ReadonlyArray<FigurePlanEntry & { readonly label: string; readonly title: string }>,
  table: { readonly markdown?: string; readonly raw: string; readonly note: string },
  step: string,
): {
  /** The package's float blocks, in plan order, with the table last. */
  readonly markdown: ReadonlyArray<string>
  /** The document's float blocks, in plan order, with the table in the place the plan put it. */
  readonly document: ReadonlyArray<DocumentBlock>
  readonly figureSvg: string
  readonly roadmapSvg: string
  readonly roadmapMermaid: string
  readonly rendered: ReadonlyArray<CitableFloat>
  readonly notRendered: ReadonlyArray<string>
} {
  // NUMBERED, CAPTIONED, AND LINKED — the paper shapes. The number and the caption come from the
  // plan, not from a counter here: D1 assigned them when it decided which floats exist, so a caption
  // reading `Figure 1` and a sentence citing `Figure 1` cannot name different things. A figure is a
  // file or an inline diagram, never both, and `figureBlock` refuses the other cases rather than
  // rendering a broken image.
  const markdown: string[] = []
  const blocks: DocumentBlock[] = []
  // THE ROADMAP AS A PICTURE, when the deployment's provider drew one. A drawn roadmap is a FIGURE —
  // it has the same two renderings a data figure has and the formats take them the same way — while
  // an undrawn one stays the diagram source its tool produced. Treating the second as the first is
  // how a document comes to claim a figure it does not carry.
  let figureSvg = ''
  let roadmapSvg = ''
  let roadmapMermaid = ''
  // Floats the plan declares that this manuscript will not carry, named rather than passed over: a
  // reader comparing the plan with the paper would otherwise find a figure with no explanation.
  const notRendered: string[] = []
  // What the manuscript really holds, for the cross-reference report.
  const rendered: CitableFloat[] = []
  // Where the table belongs among the blocks, in the plan's order: laid out from the tool's model
  // rather than from the plan's rendered text, so it is spliced in rather than appended.
  let tableIndex = blocks.length
  for (const entry of plan) {
    if (entry.kind === 'data-figure' && typeof entry.svg === 'string') {
      figureSvg = entry.svg
      markdown.push(figureBlock({
        label: entry.label,
        title: entry.title,
        path: figureAssetPath(entry.label),
        note: 'Rendered by the figure tool from the measurements this run produced.',
      }))
      blocks.push({
        kind: 'figure',
        label: entry.label,
        caption: entry.title,
        svg: entry.svg,
        ...(typeof entry.pngBase64 === 'string' ? { pngBase64: entry.pngBase64 } : {}),
      })
      rendered.push({ label: entry.label, title: entry.title })
      continue
    }
    if (entry.kind === 'roadmap' && typeof entry.content === 'string' && entry.format === 'mermaid') {
      roadmapMermaid = entry.content.trim()
      if (entry.diagramDrawn === true && typeof entry.svg === 'string') {
        roadmapSvg = entry.svg
        markdown.push(figureBlock({
          label: entry.label,
          title: entry.title,
          path: figureAssetPath(entry.label),
          note: 'Drawn from the roadmap this run planned, by the deployment\'s figure provider.',
        }))
        blocks.push({
          kind: 'figure',
          label: entry.label,
          caption: entry.title,
          svg: entry.svg,
          ...(typeof entry.pngBase64 === 'string' ? { pngBase64: entry.pngBase64 } : {}),
        })
        rendered.push({ label: entry.label, title: entry.title })
        continue
      }
      markdown.push(figureBlock({
        label: entry.label,
        title: entry.title,
        mermaid: roadmapMermaid,
      }))
      blocks.push({
        kind: 'diagram',
        label: entry.label,
        caption: entry.title,
        mermaid: roadmapMermaid,
      })
      rendered.push({ label: entry.label, title: entry.title })
      continue
    }
    if (entry.kind === 'three-line-table') {
      tableIndex = blocks.length
      continue
    }
    notRendered.push(entry.label)
  }
  // The plan is where a manuscript learns what its table is called, so a plan that declares no table
  // means the manuscript and the plan disagree about what it holds — refused rather than papered over
  // with a number no plan assigned.
  const planned = plan.find(entry => entry.kind === 'three-line-table')
  if (planned === undefined) {
    throw new Error(
      `${step} the figure-plan declares no three-line-table, so the results table this manuscript `
      + 'carries would carry a number no plan assigned',
    )
  }
  if (table.markdown === undefined) {
    // A table whose rows do not cover its columns is one this renderer cannot lay out, so the tool's
    // own rendering is used. Stated rather than passed over, because the reader would otherwise see a
    // code block where the paper should have a table.
    markdown.push(table.raw)
    notRendered.push(planned.label)
  } else {
    markdown.push(tableBlock({
      label: planned.label,
      title: planned.title.length === 0 ? 'Measured results' : planned.title,
      markdown: table.markdown,
      note: table.note,
    }))
    blocks.splice(tableIndex, 0, {
      kind: 'table',
      label: planned.label,
      caption: planned.title,
      markdown: table.markdown,
    })
    rendered.push({ label: planned.label, title: planned.title })
  }
  return { markdown, document: blocks, figureSvg, roadmapSvg, roadmapMermaid, rendered, notRendered }
}

/**
 * E1-format: RENDERS the document the run holds, and packages what one compile produced.
 *
 * THE DOCUMENT IS AUTHORITATIVE BEFORE THIS STEP RUNS. D3 writes it, D4 republishes it with the
 * revision applied, and this step takes the `document` field off that artifact and compiles THAT.
 * It does not assemble a document from parts; the run's own records reach it only for the packaging
 * around the document — the venue's scope line, the numbering of the reference list, and the
 * cross-reference report about the prose.
 *
 * WHAT THIS REPLACED, AND WHY. Until this unit E1 built the document itself: it invoked the
 * three-line-table capability over the run's measurements, composed the floats and only then handed
 * the result to the compiler. Two consequences followed. The document a compiler received existed
 * nowhere a reader could compare it with the paper; and E1 became the second step to decide what the
 * paper's numbers are, so the compiled document and the manuscript Markdown could describe tables no
 * single step had produced. The T19-S ruling — "E1 is the format STEP, not the table tool" — still
 * holds: the table is a capability of the TOOL, and D3 now invokes it as its own. What the ruling got
 * wrong was the step it belonged to: a table added at typesetting time is not part of the document a
 * reader approves.
 *
 * @param ctx - the execution context.
 * @returns the `typeset` artifact: the assembled Markdown package, and everything the deployment's
 *   compiler produced from the document.
 * @throws {Error} when the manuscript artifact carries no document, when the compiler's request is
 *   refused, or when one of the manuscript's citation, statement-binding, sentence-support or
 *   argument-plan obligations is not discharged.
 */
async function e1Executor(ctx: ExecCtx): Promise<Record<string, unknown>> {
  const { claimRef } = canonicalOf(ctx)
  const venue = readInput(ctx, 'venue')
  const venueScope = readInput(ctx, 'venue-scope')
  const revised = readInput(ctx, 'manuscript')
  const outline = readInput(ctx, 'paper-outline')
  // The manuscript carries the outline's title, so the assembled document is this
  // paper rather than a generic skeleton.
  const title = typeof outline?.title === 'string' ? outline.title : planOf(ctx).title
  const venueName = typeof venue?.name === 'string' ? venue.name : SCENARIO.venueName
  const venueId = typeof venue?.venueId === 'string' ? venue.venueId : SCENARIO.venueId
  const rawMatches = venueScope?.matches
  const scopeMatches = Array.isArray(rawMatches)
    ? rawMatches.filter((m): m is string => typeof m === 'string')
    : []
  const sections = sectionsOf(revised, planOf(ctx), ctx)
  // WHAT THIS STEP RENDERS, AND THE REFUSAL THAT SAYS SO. A manuscript without a document is one no
  // writing step produced — rendering the Markdown from its sections alone would publish a package
  // whose compiled form describes a paper no step wrote, which is the state this artifact exists to
  // rule out rather than to create.
  const carriedDocument = revised?.document
  if (carriedDocument === null || typeof carriedDocument !== 'object') {
    throw new Error('[E1-format] the manuscript artifact carries no document to render')
  }
  const document = carriedDocument as ManuscriptDocument
  // WHICH VERSION OF THE DOCUMENT THIS RENDER IS OF. The pipeline writes one document under one slug
  // (D3 creates it, D4 republishes it, a person may publish an accepted candidate over it), so an
  // artifact that named only the slug would say "a manuscript" rather than which one — and the
  // question a package asks ("is this typeset form a render of the document the run holds, or of one
  // it has left behind") could not be answered at all. Read off the registry, not off the value: a
  // value does not know its own version.
  const manuscriptRef = ctx.readInputRef('manuscript')
  // WHAT D3'S INVOCATION OF THE TABLE TOOL PRODUCED. The document carries the table as a block; the
  // tool's own rendering and its binding hash are the record of the render, and the package's
  // `experiment-tables.md` is that rendering. Read from the manuscript rather than by running the
  // tool again: a second invocation is a second table, and this step did not render it.
  const tableRecord = (revised?.tableRender ?? {}) as {
    readonly markdown?: unknown
    readonly bindingHash?: unknown
  }

  const scopeLine = scopeMatches.length > 0 ? `Scope match: ${scopeMatches.join('; ')}.` : ''
  // The references come from the draft, which built them from the retrieved
  // records. This line used to pass a literal empty array, so every assembled
  // manuscript reported zero references while its own references section described
  // a landscape scan — the document contradicted itself.
  const rawRefs = (revised?.references as ReadonlyArray<unknown> | undefined) ?? []
  // Rendered by the SAME function D3 built the document's reference list with, so the numbered list
  // this Markdown prints and the entries the compiled document resolves a citation against are one
  // construction of one array.
  const referenceEntries = formattedReferenceEntries(rawRefs)
  // WHAT THE PAPER CITES AND WHAT IT PRINTS MUST BE THE SAME SET, and this is the last place both
  // are in hand before the manuscript is published as an artifact. A sentence citing a key the list
  // does not carry cannot be resolved by a reader; an entry nothing cites is a search result wearing
  // the clothes of a reference list; a cited source with no reviewed judgement is a work that was
  // retrieved and never read. All three are REFUSED here rather than reported, because the assembled
  // manuscript is what every later step, the package and a referee read.
  const reviewedKeys = (Array.isArray(revised?.citations) ? revised.citations : [])
    .flatMap((raw) => {
      const key = (raw as { citeKey?: unknown }).citeKey
      return typeof key === 'string' ? [key] : []
    })
  const citationRefusals = checkManuscriptCitations({
    bodyText: sections.map(section => section.bodyText).join('\n\n'),
    entries: referenceEntries.flatMap(entry =>
      entry.citeKey === undefined ? [] : [{ citeKey: entry.citeKey }]),
    reviewedKeys,
  })
  if (citationRefusals.length > 0) {
    throw new Error(
      '[E1-format] the manuscript\'s citations and its reference list disagree: '
      + citationRefusals.map(refusal => `[${refusal.code}] ${refusal.detail}`).join('; '),
    )
  }
  // AND WHETHER EACH JUDGEMENT STILL HOLDS ABOUT WHAT IS THERE NOW. This is where a revision's
  // consequences land: the draft's bindings were made against the text the draft carried, and the
  // manuscript assembled here is the REVISED one. A sentence D4 rewrote leaves a judgement about text
  // nobody read, and a correction to the corpus leaves one about a passage the source no longer holds.
  // Both are REFUSED, because the alternative is a citation that transfers its support to a sentence
  // no reviewer saw — which is the defect this whole chain exists to prevent. Re-binding is not the
  // remedy: a judgement is a reading somebody made, and only another reading can replace it.
  const statementRefusals = checkStatementBindings(
    (Array.isArray(revised?.citations) ? revised.citations : []) as ReadonlyArray<CitationUse>,
    locateStatements(sections.map(section => ({ id: section.id, bodyText: section.bodyText }))),
    judgementsFor(claimRef, ctx.sources),
  )
  if (statementRefusals.length > 0) {
    throw new Error(
      '[E1-format] a citation no longer holds against what the manuscript says: '
      + statementRefusals.map(refusal => `[${refusal.code}] ${refusal.detail}`).join('; '),
    )
  }
  // AND WHETHER WHAT EACH SENTENCE RESTS ON STILL HOLDS. The bindings above cover the SOURCE and the
  // sentence's version; this covers the reading that was made about the sentence — a D4 revision that
  // rewrote a sentence leaves its assessment about text nobody read, and a run under a deployment that
  // reads sentences (which is the only case this fires in) has to re-read before the manuscript is
  // published. Checked HERE rather than only where the assessment was made, because the manuscript
  // assembled at this step is the revised one.
  // WHAT DECIDES WHETHER A READING IS REQUIRED IS THE RUN'S POLICY, NOT THE ARTIFACT'S FIELDS. The
  // step before this one carried the readings forward, so an empty list here means the deployment
  // cannot read sentences — a fact about the deployment — while a deployment that CAN read them and
  // arrives with none or with stale ones is refused. Reading the absence of the field as "no
  // assessor" is what let a revision drop every reading and still pass (measured, 2026-09-18).
  const readingsRequired = ctx.statementAssessor !== undefined
  const readings = Array.isArray(revised?.statementAssessments)
    ? (revised.statementAssessments as ReadonlyArray<StatementAssessment>)
    : []
  const supportRefusals = readingsRequired
    ? checkStatementSupport(
      readings,
      locateStatements(sections.map(section => ({ id: section.id, bodyText: section.bodyText }))),
      judgementsFor(claimRef, ctx.sources),
    )
    : []
  if (supportRefusals.length > 0) {
    throw new Error(
      '[E1-format] a sentence cites a source the deployment never read it against: '
      + supportRefusals.map(refusal => `[${refusal.code}] ${refusal.detail}`).join('; '),
    )
  }
  // AND WHAT EACH SECTION OWED ITS READER. A section that reports the measurement without saying what
  // it did to the claim leaves a reader who skims with the impression the study found what it hoped
  // for — which is the delivered paper, and the reason this is refused rather than reported. The plan
  // is read off the REVISED draft: a revision is written under the plan the draft was, and a plan that
  // was recomputed here could oblige a section under a different argument than the one it was written
  // under. A draft carrying NEITHER sections nor a plan is the fallback path, and the plan for it is
  // derived the same way its sections were.
  const argumentPlan = (revised?.argumentPlan as ArgumentPlan | undefined)
    ?? (Array.isArray(revised?.sections) ? undefined : derivedArgumentPlan(planOf(ctx), ctx))
  if (argumentPlan === undefined) {
    throw new Error(
      '[E1-format] the draft records no argument plan, so no section can be judged against the'
      + ' obligations it was written under',
    )
  }
  const argumentRefusals = checkArgumentPlan(
    argumentPlan,
    sections.map(section => ({ id: section.id, bodyText: section.bodyText })),
  )
  if (argumentRefusals.length > 0) {
    throw new Error(
      '[E1-format] a section did not discharge what the argument plan obliges it to: '
      + argumentRefusals.map(refusal => `[${refusal.code}] ${refusal.detail}`).join('; '),
    )
  }
  const numberByKey = new Map<string, number>()
  referenceEntries.forEach((entry, index) => {
    if (entry.citeKey !== undefined) numberByKey.set(entry.citeKey, index + 1)
  })
  // THE READER SEES A NUMBER AND THE PAPER CARRIES A KEY. A cite key is this manuscript's internal
  // name for a source and means nothing outside it, so the bodies are rendered with the numbers the
  // reference list assigns — the same array, the same order, so the two cannot drift. A marker with
  // no entry keeps its key rather than being dropped, and the check above has already refused the
  // manuscript for it.
  const citedSections = sections.map(section => ({
    ...section,
    bodyText: renderCitationMarkers(section.bodyText, numberByKey),
  }))
  // Assembly is a real step of its own now: the module refuses a titleless or
  // section-less manuscript, so an empty shell cannot be assembled here.
  // The assembler renders its own `## References` block from these entries, and the
  // outline already carries a `references` section — passing both printed the heading
  // twice. The assembler's block wins because it is the one that actually holds the
  // entries, so the empty outline section is dropped here and the replacement is
  // recorded on the artifact rather than happening silently.
  // THE MODEL'S EQUATIONS GO IN THE METHOD SECTION, which is where a reader looks for them. They
  // are the study's own computation (the adapter's equations), not decoration, and the section is
  // extended rather than replaced so the prose the draft wrote stays where it is.
  const equations = equationBlock(ctx.runCtx.adapter.implementation.equations)
  const withEquations = citedSections.map(section =>
    section.id === 'method' && equations.length > 0
      ? { ...section, bodyText: `${section.bodyText}\n\n${equations}` }
      : section)
  const sectionsForAssembly = referenceEntries.length > 0
    ? withEquations.filter(section => section.id !== 'references')
    : withEquations
  // THE MANUSCRIPT'S FLOATS, AS THE PACKAGE PRINTS THEM. Composed by the SAME function D3 composed
  // the document's floats with, over the same `renderedFigures` the document was built from, so the
  // Markdown the package carries and the compiled document are two renderings of one list rather
  // than two constructions of it. The table is not re-laid out here: it is the block the DOCUMENT
  // carries, and the tool's own rendering of it travels beside the document's as the package's
  // `experiment-tables.md`.
  const rendered = Array.isArray(revised?.renderedFigures)
    ? (revised.renderedFigures as ReadonlyArray<FigurePlanEntry>)
    : []
  const documentTable = document.sections
    .flatMap(section => section.blocks)
    .find(block => block.kind === 'table')
  const plannedFloats = planFloats(rendered)
  const floats = composeFloats(plannedFloats, {
    ...(documentTable === undefined ? {} : { markdown: documentTable.markdown }),
    raw: typeof tableRecord.markdown === 'string' ? tableRecord.markdown : '',
    note: tableNoteOf(ctx),
  }, '[E1-format]')
  const figureBlocks = floats.markdown
  const { figureSvg, roadmapSvg, roadmapMermaid, notRendered: floatsNotRendered } = floats
  const renderedFloats = floats.rendered
  const assembled = assembleManuscript({
    title,
    sections: sectionsForAssembly,
    figures: figureBlocks,
    references: numberedReferences(referenceEntries.map(entry => entry.formatted)),
  })
  // WHICH NUMBERED ITEMS THE PROSE ACTUALLY NAMES. The captions are rendered by this step, so a
  // manuscript can carry Table 1 and never refer to it — a fact about the draft, which this records
  // rather than repairs: a sentence inserted here would be prose no step wrote.
  //
  // READ THE DRAFT'S OWN SECTIONS, not the assembled ones. This step appends the equations to the
  // method section, so scanning the assembled body would count each equation's own label as a
  // reference to it and report a manuscript that cites every equation it states.
  const crossReferences = citedFloats(
    sections.map(section => section.bodyText).join('\n\n'),
    citableFloats(renderedFloats, ctx.runCtx.adapter.implementation.equations),
  )
  // The package's OWN files, as CONTENT. E1 produces these; the run exporter adds the
  // run-level files (summary, step record, claim-evidence, citations, experiment,
  // reproducibility, manifest) and writes the whole set to disk. A path whose upstream step
  // did not run has no content and is OMITTED, never declared empty — the earlier version of
  // this artifact listed five filenames no step wrote, which read as run output.
  // EVERY FILE ONE COMPILE PRODUCED, EACH WITH WHAT IT IS — and the pass itself lives in
  // `document-compile.ts`, because the repair after a hand acceptance re-renders the same document
  // and a second copy of this loop is how the `.docx` and the `.tex` come to be renderings of
  // different format sets. A DRAFT, at this point in the run: that document has not been approved by
  // a person yet, so what it compiles is a working document. A float that cannot be embedded is
  // recorded there and REFUSED when a submission-grade compile is asked for at export time.
  const compile = await compileManuscriptFormats(document, ctx.documentCompiler, 'draft')
  const compiled = compile.files
  const compileRefusals = compile.refusals
  const embeddedFloats = compile.embedded
  const droppedFloats = compile.dropped
  const pkg = nonEmptyPackageFiles({
    // The compiled DOCUMENTS are text, so they belong with the other text files.
    ...Object.fromEntries(compiled
      .filter(file => file.encoding !== 'base64')
      .map(file => [
        file.path,
        {
          content: file.content,
          source: `${ctx.documentCompiler?.tool ?? 'no compiler'} (compiled from the document model)`,
        },
      ])),
    'manuscript.md': {
      content: assembled.markdown,
      source: 'assembleManuscript(manuscript + venue scope + references)',
    },
    // THE TOOL'S OWN RENDERING of the table, which is not the pipe table the paper prints: this file
    // is the run's record of what the three-line-table capability produced at D3, carried here so a
    // reader can compare the render with the form it took in the document.
    'experiment-tables.md': {
      content: typeof tableRecord.markdown === 'string' ? tableRecord.markdown : '',
      source: `${THREE_LINE_TABLE_TOOL_ID}@${THREE_LINE_TABLE_TOOL_VERSION} (invoked at D3-writing)`,
    },
    ...(figureSvg.length === 0
      ? {}
      : {
        [figureAssetPath(plannedFloats.find(entry => entry.kind === 'data-figure')?.label ?? 'Figure 1')]: {
          content: figureSvg,
          source: `${FIGURE_TOOL_ID}@${FIGURE_TOOL_VERSION}`,
        },
      }),
    // THE ROADMAP'S OWN PICTURE, when the deployment drew one — the same bytes the compiled document
    // embeds, so the Markdown manuscript's `![Figure 2: …](figures/figure-2.svg)` resolves inside the
    // package instead of pointing at a file only the run's memory had.
    ...(roadmapSvg.length === 0
      ? {}
      : {
        [figureAssetPath(plannedFloats.find(entry => entry.kind === 'roadmap')?.label ?? 'Figure 2')]: {
          content: roadmapSvg,
          source: `${ROADMAP_TOOL_ID}@${ROADMAP_TOOL_VERSION} (drawn by the deployment's figure provider)`,
        },
      }),
    'roadmap.md': {
      content: roadmapMermaid.length > 0 ? ['```mermaid', roadmapMermaid, '```'].join('\n') : '',
      source: `${ROADMAP_TOOL_ID}@${ROADMAP_TOOL_VERSION}`,
    },
    'manuscript.html': {
      content: compiled.find(file => file.path === 'manuscript.html')?.content ?? '',
      source: compiled.some(file => file.path === 'manuscript.html')
        ? `${ctx.documentCompiler?.tool ?? 'no compiler'} (from the document model, not the assembled markdown)`
        : 'NOT COMPILED by this deployment',
    },
    'manuscript.tex': {
      content: compiled.find(file => file.path === 'manuscript.tex')?.content ?? '',
      source: compiled.some(file => file.path === 'manuscript.tex')
        ? `${ctx.documentCompiler?.tool ?? 'no compiler'} (from the document model, not the assembled markdown)`
        : 'NOT COMPILED by this deployment',
    },
  })
  return {
    'typeset': tagArtifact(
      {
        title,
        // THE DOCUMENT THIS RENDER IS OF, by version. A journal, a reader or a check comparing this
        // form with the run's current document needs to know which version it was rendered from; the
        // slug alone would answer "the manuscript", which is true of every version of it.
        manuscriptRef: manuscriptRef === undefined ? null : { ...manuscriptRef },
        // WHAT RENDERED IT, AND WHAT COULD NOT. A package that named only `manuscript.html` would
        // leave a reader unable to tell a compiled document from a copy of the Markdown — and a run
        // that could not compile says so here rather than by the absence of a file.
        compilation: {
          tool: ctx.documentCompiler?.tool ?? null,
          formats: ctx.documentCompiler?.formats ?? [],
          compiled: compiled.map(file => file.path),
          // THE COMPILED DOCUMENTS, ONE PER FORMAT THE COMPILE PRODUCED, WITH WHAT EACH ONE IS. A
          // DOCX and a PDF are binary, so neither is in the package's text files — and a reader looking
          // for the manuscript a journal receives must not have to find it under `assets`, which names
          // the things the document carries rather than the document. A BINARY DOCUMENT CARRIES ITS
          // BYTES HERE; a text one (HTML, LaTeX) has its content in `packageFiles` under the same path,
          // because one file has one home and the base64 of text is not the text.
          //
          // EVERY ENTRY SAYS WHICH FORMAT IT IS, HOW LONG ITS BYTES ARE, AND THEIR DIGEST. A person
          // asked to send this file, a package that writes it and a check comparing the two all need
          // the same three facts, and an entry carrying only its bytes would leave each of them to
          // recompute or guess it.
          documents: compiled
            .filter(file => file.kind === 'document')
            .map(file => ({
              format: file.format ?? null,
              path: file.path,
              ...digestsOf(file.content, file.encoding),
              ...(file.encoding === 'base64' ? { base64: file.content } : {}),
            })),
          // THE ASSETS, AS BYTES. A figure the compiled document embeds is not text, and a package
          // that carried it as base64 text would ship a file that looks written and is not the asset.
          assets: compiled
            .filter(file => file.kind === 'asset')
            .map(file => ({ path: file.path, base64: file.content })),
          // WHAT IS IN THE COMPILED DOCUMENT AND WHAT IS NOT. A float that could not be embedded is
          // named with its reason; a submission-grade compile refuses when this list is not empty.
          floatsEmbedded: embeddedFloats,
          floatsDropped: droppedFloats,
          refusals: compileRefusals,
        },
        venueName,
        venueId,
        // WHAT STYLE WAS APPLIED, SAID WITHOUT OVER-CLAIMING. This used to read
        // `${venueName} template`, which named a template no run has read; the compiler applies
        // pandoc's default, and the run's record of what the venue requires is its venue profile.
        venueStyle: `${venueName} (pandoc default; the journal's own requirements are recorded,
          not applied — see the run's venue profile)`,
        scopeLine,
        // Which outline sections the assembly replaced, and by what. Empty means the
        // outline's own sections all survive into the manuscript.
        sectionsReplaced: referenceEntries.length > 0 ? ['references'] : [],
        manuscript: assembled.markdown,
        manuscriptCounts: {
          sections: assembled.sectionCount,
          figures: assembled.figureCount,
          references: assembled.referenceCount,
        },
        // Which numbered items the prose names, and which it leaves unmentioned.
        crossReferences,
        // Floats the plan declares that this manuscript does not carry, by label.
        floatsNotRendered,
        sectionHeadings: sections.map(s => s.heading),
        // THE TABLE TOOL'S OWN OUTPUT, and where it came from. D3 invoked the capability and the
        // manuscript records the render and its binding hash; this artifact carries them forward
        // because the package's `experiment-tables.md` is that same rendering, and a reader of the
        // typeset form is who compares it with the table the document prints.
        tableMarkdown: typeof tableRecord.markdown === 'string' ? tableRecord.markdown : '',
        bindingHash: typeof tableRecord.bindingHash === 'string' ? tableRecord.bindingHash : '',
        // The package's OWN files, as CONTENT. E1 produces exactly these four; the run
        // exporter adds the run-level files (summary, step record, claim-evidence,
        // citations, experiment, reproducibility, manifest) and writes the whole set to
        // disk. A file appears here only when its content is really produced below — the
        // earlier version of this field listed five filenames that no step wrote, which
        // read as run output beside a produced manuscript.
        packageFiles: pkg.files,
        packageSources: pkg.sources,
        note: 'typeset RENDERED by the E1-format executor from the document the manuscript artifact carries + venue scope; the results table is the document\'s own block, rendered by the real three-line-table capability at D3-writing',
      },
      E1_PRODUCER,
      'local_computation',
    ),
  }
}

/**
 * A file's byte length and digest, over the bytes it is MADE OF.
 *
 * A BASE64 ENTRY IS NOT TEXT. Measuring or hashing the encoded string reports the length of the
 * encoding rather than of the file, and a digest taken that way can never be compared with one taken
 * from the written file — which is what a package does when it verifies what it wrote, and what a
 * submission request has to state about the file it is asking a person to send.
 *
 * @param content - the file's content, in the encoding it is carried in.
 * @param encoding - how that content is encoded; absent means it is text.
 * @returns the byte length and the sha256 hex digest of those bytes.
 */
function digestsOf(
  content: string,
  encoding: 'utf8' | 'base64' | undefined,
): { readonly bytes: number; readonly sha256: string } {
  const bytes = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8')
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}

/**
 * Select the package files this run actually produced.
 *
 * A file whose content is empty is OMITTED rather than declared: an upstream step that did
 * not run leaves E1 with nothing for that path, and a declared-but-empty file is exactly the
 * "listed but not produced" defect this replaced. Presence therefore means content.
 *
 * @param candidates - each path's content and the producer that supplied it.
 * @returns the non-empty paths mapped to their content, plus a parallel source map.
 */
function nonEmptyPackageFiles(
  candidates: Readonly<Record<string, { readonly content: string; readonly source: string }>>,
): { readonly files: Readonly<Record<string, string>>; readonly sources: Readonly<Record<string, string>> } {
  const files: Record<string, string> = {}
  const sources: Record<string, string> = {}
  for (const [path, entry] of Object.entries(candidates)) {
    if (entry.content.length === 0) continue
    files[path] = entry.content
    sources[path] = entry.source
  }
  return { files, sources }
}

/**
 * The readings this run already holds, read off the draft D4 is revising.
 *
 * @param ctx - the D4 execution context.
 * @returns the assessments the draft carries, or an empty list when it carries none.
 */
function carriedAssessments(ctx: ExecCtx): ReadonlyArray<StatementAssessment> {
  const draft = readInput(ctx, 'manuscript')
  return Array.isArray(draft?.statementAssessments)
    ? (draft.statementAssessments as ReadonlyArray<StatementAssessment>)
    : []
}

/**
 * Let the deployment's verifier read what the round produced, and settle what it decides.
 *
 * THE INDEPENDENT READ, and the reason a revision no longer closes its own issues. Without a verifier
 * the round's issues stay `pending-verification`: applying a patch and arguing for no change are both
 * things the AUTHOR did, and neither answers the concern it was written for.
 *
 * WHO THE TWO EXECUTIONS ARE IS THE HOST'S TO SAY. This function mints the verifier's identity and
 * hands it, with the author's, to `verifyPending`, which builds each record from what the host knows.
 * A verifier cannot name itself, so renaming one changes nothing; what is compared is the execution,
 * the session and the rules version — not the model, which is recorded as a shared-bias note.
 *
 * @param ctx - the D4 execution context.
 * @param applied - what the round did to the manuscript.
 * @param issues - the round's issues, as raised.
 * @param revisedBodies - the section bodies as they now stand.
 * @param author - the execution that wrote the answers, as this side recorded it.
 * @returns the revision with its outcomes settled as far as they can be.
 * @throws {Error} when a refusal is a defect in the deployment rather than in one reading.
 */
async function appliedWithVerification(
  ctx: ExecCtx,
  applied: AppliedRevision,
  issues: ReadonlyArray<RevisionIssue>,
  revisedBodies: ReadonlyMap<string, string>,
  author: ExecutionIdentity,
): Promise<AppliedRevision> {
  const verifier = ctx.resolutionVerifier
  if (verifier === undefined) return applied
  const identity = verifierIdentityOf(verifier)
  const { verifications, fatal } = await verifyPending(applied.outcomes, verifier, {
    issues, changes: applied.changes, revisedBodies, identity, author,
    now: () => new Date().toISOString(),
  })
  const settled = verifyResolution(applied.outcomes, verifications, author, revisedBodies)
  // A READING THAT FAILED IS NOT A DEPLOYMENT THAT FAILED. A verifier that decided on nothing read,
  // or reported on a body that has moved, is refused — and its issue stays exactly where it was, so
  // the round's record shows a debt rather than a closure. The three codes in `fatal` are different:
  // they mean this deployment's review is not the two-role review it claims, and a run that carried
  // on would be publishing a reading that never stood apart from the revision.
  const stopped = [...fatal, ...settled.fatal]
  if (stopped.length > 0) {
    throw new Error(
      `[D4-rebuttal] [${stopped[0]?.code ?? 'verification-not-independent'}] `
      + stopped.map(refusal => refusal.detail).join('; '),
    )
  }
  return {
    ...applied,
    outcomes: settled.outcomes,
    openIssues: settled.outcomes.filter(outcome => outcome.disposition === 'open').map(outcome => outcome.issueId),
    awaitingVerification: settled.outcomes
      .filter(outcome => outcome.disposition === 'pending-verification')
      .map(outcome => outcome.issueId),
    refusals: settled.refusals,
    // WHAT WAS READ, BY WHOM, UNDER WHICH RULES. Accepted readings only: a refused one changed nothing
    // and is recorded as the refusal it is.
    verifications: verifications.filter(verification => settled.outcomes.some(outcome =>
      outcome.issueId === verification.issueId
      && (outcome.disposition === 'answered' || outcome.disposition === 'open'))),
  }
}

/**
 * The execution the host starts for one round of verification.
 *
 * MINTED HERE, NOT ASKED FOR. Every field is a fact this side holds: the id is random and unique, the
 * session is its own — so the verifier never continues the author's session — and the rules version
 * comes from the verifier's own declaration. The route is recorded because a reader needs to see
 * whether the two executions shared a model, which is a risk note and not a decision.
 *
 * @param verifier - the deployment's verifier.
 * @returns the identity the verifications of this round are recorded under.
 */
function verifierIdentityOf(verifier: ResolutionVerifierPort): ExecutionIdentity {
  return {
    executionId: `verify-${randomUUID()}`,
    sessionId: `research-verify-${randomUUID()}`,
    role: verifier.role,
    instructionsVersion: verifier.instructionsVersion,
    provider: verifier.route.provider,
    ...verifier.route.model === undefined ? {} : { model: verifier.route.model },
  }
}

/**
 * The review policy this deployment stated, or the default one.
 *
 * @param ctx - the execution context.
 * @returns the policy the run is held to.
 */
function reviewPolicyOf(ctx: ExecCtx): ReviewPolicy {
  return ctx.reviewPolicy ?? DEFAULT_REVIEW_POLICY
}

/**
 * E2-submit: THE SUBMISSION REQUEST, PREPARED. A person decides it; nothing here submits.
 *
 * WHY THIS STEP HAS AN EXECUTOR AT ALL. It declared `submission-record` as its output and nothing
 * wrote one: the step stopped at the gate with an empty executor, so the run advertised a submission
 * record that did not exist — the same defect as a package listing files no step wrote. The record
 * below is what the person at the gate is deciding about, and the pipeline still does not decide it.
 *
 * IT READS THE ARTIFACT AND NOT THE FILESYSTEM. A `manuscript.docx` on disk, a package a previous
 * export wrote, a file a hand edited: none of them is evidence that THIS run produced the document,
 * and a record built from them would attest to bytes the run never held. Every fact below comes from
 * the run's own artifacts, so the versions named are the ones the decision binds.
 *
 * @param ctx - the execution context.
 * @returns the `submission-record` — the request, and what it states about the state it was prepared
 *   from.
 * @throws {Error} when the run holds no document or no typeset form, which are the two inputs there
 *   is nothing to prepare a submission from.
 */
function e2Executor(ctx: ExecCtx): Record<string, unknown> {
  // BOTH INPUTS ARE READ, not only the one the documents come from: the commit receipt's input digest
  // is taken from the slugs this executor ASKED FOR, so a record naming the manuscript's version
  // without reading the manuscript would attest to a state its own receipt does not cover.
  const manuscript = readInput(ctx, 'manuscript')
  const typeset = readInput(ctx, 'typeset')
  // The two refusals this step has: E2 declares `manuscript` and `typeset` as its inputs, so `canStart`
  // guarantees both exist — and a direct caller that reached here without them would otherwise be
  // handed a record saying a submission is ready when there is nothing to submit.
  if (manuscript === undefined) {
    throw new Error('[E2-submit] the run holds no document, so there is no submission request to prepare')
  }
  if (typeset === undefined) {
    throw new Error('[E2-submit] the run holds no typeset form, so there is no submission request to prepare')
  }
  const compilation = (typeset.compilation ?? {}) as {
    readonly formats?: unknown
    readonly documents?: unknown
  }
  // WHAT A SUBMISSION WOULD CARRY, as the compile recorded it: one entry per document, with the
  // format it was compiled to and the length and digest of its bytes. Read, not recomputed — this
  // step did not compile anything, and a digest taken here would be this step's reading of the
  // document rather than the one the package and the person would both check against.
  const documents = (Array.isArray(compilation.documents) ? compilation.documents : [])
    .flatMap((entry): Array<Record<string, unknown>> => {
      if (entry === null || typeof entry !== 'object') return []
      const { format, path, sha256, bytes } = entry as {
        readonly format?: unknown
        readonly path?: unknown
        readonly sha256?: unknown
        readonly bytes?: unknown
      }
      if (typeof path !== 'string' || path.length === 0) return []
      return [{
        format: typeof format === 'string' ? format : null,
        path,
        sha256: typeof sha256 === 'string' ? sha256 : null,
        bytes: typeof bytes === 'number' ? bytes : null,
      }]
    })
  return {
    'submission-record': tagArtifact(
      {
        // THE TWO VERSIONS THE DECISION BINDS, read off the run's registry: the document a person is
        // approving the submission of, and the typeset form a journal would receive. The approval
        // freezes both (core's `_applyHumanApproval` takes them from this step's declared inputs), so
        // a record that named only the slugs could not say which version that was.
        manuscript: refRecordOf(ctx, 'manuscript'),
        typeset: refRecordOf(ctx, 'typeset'),
        // THE FILES, and which formats this deployment compiled: `formats` is what the deployment's
        // compiler said it can produce HERE, which is why a machine with no LaTeX engine asks nobody
        // for `.tex` rather than reporting a document that went missing.
        documents,
        declaredFormats: (Array.isArray(compilation.formats) ? compilation.formats : [])
          .filter((format): format is string => typeof format === 'string'),
        // WHERE IT WOULD GO, as the typeset form records the venue it was rendered for.
        venue: {
          name: typeof typeset.venueName === 'string' ? typeset.venueName : null,
          venueId: typeof typeset.venueId === 'string' ? typeset.venueId : null,
          scopeLine: typeof typeset.scopeLine === 'string' ? typeset.scopeLine : null,
        },
        // NOTHING HAS BEEN SENT, AND NOTHING HERE CAN SEND IT. Two facts rather than one: the first is
        // what this record states about the world, and the second is why the decision is a person's.
        submitted: false,
        decision: 'pending',
        note: 'PREPARED, NOT SUBMITTED. This is the request a person is asked to decide: the documents'
          + ' and versions above are what the run holds and what a submission would carry. Nothing has'
          + ' been sent to the venue, and nothing in this pipeline sends one — a submission is an'
          + ' external act by a person, which is why E2-submit reaches `passed` only through the host\'s'
          + ' approval channel and never through this executor.',
      },
      'human-gate:E2-submit',
      'humanGate',
    ),
  }
}

/**
 * One artifact's reference as a plain record, or null when the run holds none.
 *
 * `null` rather than an absent field: a reader of the record compares this with the version the run
 * holds now, and "there was none" is a fact that has to survive JSON.
 *
 * @param ctx - the execution context.
 * @param slug - the artifact slug.
 * @returns the reference, detached from the registry's own object.
 */
function refRecordOf(ctx: ExecCtx, slug: string): Record<string, unknown> | null {
  const ref = ctx.readInputRef(slug)
  return ref === undefined ? null : { artifactId: ref.artifactId, version: ref.version, contentHash: ref.contentHash }
}

// ── Registry (16-step map) ──────────────────────────────────────────────────────
// `kind` reflects the EXECUTOR truthfulness. A step whose GATE uses the real
// trinity adjudication but whose executor is a fixture (e.g. C2) is still
// `fixture_executor` here; its gate channel truthfulness is declared separately
// in VERDICT_CHANNELS (and implemented in verdict.ts).

interface EntrySpec {
  readonly stepId: string
  /** See {@link StepExecutorEntry.kind}: `'humanGate'` for the pipeline's human gate (E2). */
  readonly kind: Truthfulness | 'humanGate'
  readonly basis: string
  readonly producer: string
  readonly timeoutMs: number
  readonly recoveryPolicy: RecoveryPolicy
  readonly executor: StepExecutorFn
}

const REAL_TOOL_TIMEOUT_MS = 5_000
const FIXTURE_TIMEOUT_MS = 2_000

const ENTRY_SPECS: ReadonlyArray<EntrySpec> = [
  {
    stepId: 'A1-landscape',
    kind: 'real_tool_fixture_input',
    basis: 'the REAL `runLiteratureSearch` tool function executes. WHICH corpus it reaches is a DEPLOYMENT fact, not a property of this step: with no configured channel it is the synthetic `mockLiteratureSearchAdapter`, and with a real one it is a live catalogue. The artifact records which ran, and an adapter outage FAILS the step instead of producing a landscape from no records',
    producer: A1_PRODUCER,
    timeoutMs: REAL_TOOL_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: a1Executor,
  },
  {
    stepId: 'A2-claim',
    kind: 'real_tool_fixture_input',
    basis: 'the REAL `constructClaim` tool function executes over a synthetic assertion + falsifiability pair; the produced claim always carries supportStatus="not_claimed" (never literature support)',
    producer: A2_PRODUCER,
    timeoutMs: REAL_TOOL_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: a2Executor,
  },
  {
    stepId: 'A3-agenda',
    kind: 'fixture_executor',
    basis: 'no agenda/contribution-derivation tool exists; the executor emits a deterministic synthetic agenda + contribution list shaped from the claim (never real research direction)',
    producer: A3_PRODUCER,
    timeoutMs: FIXTURE_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: a3Executor,
  },
  {
    stepId: 'A4-venue',
    // The venue is COMPUTED from the retrieved corpus (no tool, no external system);
    // the scope criteria beside it remain declared.
    kind: 'local_computation',
    basis: 'the venue is DERIVED from the records A1 retrieved: the venue they were most often published in, with the counts recorded on the artifact. The scope-match criteria beside it are DECLARED, not read from the venue, because this study retrieves no author guidelines',
    producer: A4_PRODUCER,
    timeoutMs: FIXTURE_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: a4Executor,
  },
  {
    stepId: 'B1-method',
    kind: 'fixture_executor',
    basis: 'no method-derivation tool exists; the executor emits a deterministic synthetic method spec + measurable prediction set that the C1 experiment can adjudicate',
    producer: B1_PRODUCER,
    timeoutMs: FIXTURE_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: b1Executor,
  },
  {
    stepId: 'B2-data',
    // No tool function runs: the executor stats the dataset files and computes the
    // descriptor from what it finds. Which level it earns therefore follows the
    // FILESYSTEM, not this line — `local_computation` when the declared files are
    // present at their recorded sizes, `fixture_executor` when they are not (and
    // then it claims no acquisition at all).
    kind: 'local_computation',
    basis: 'no dataset acquisition/profiling tool exists. The executor stats each declared dataset file and the descriptor reports what is ON DISK: present at the recorded size, or absent. With the files present it is a `local_computation` over real bytes; with them absent it degrades to `fixture_executor` and claims no acquisition',
    producer: B2_PRODUCER,
    timeoutMs: FIXTURE_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: b2Executor,
  },
  {
    stepId: 'B3-baseline',
    // No tool function runs here and no external system is touched: the executor
    // computes the baseline with THIS package's experiment module. Calling that
    // `real_tool_fixture_input` made the report print it among the "real tool
    // functions executed", which it is not.
    kind: 'local_computation',
    basis: 'the baseline is MEASURED: the study\'s own baseline arm is run under its declared conditions (see C1-mvp for the full study declaration) and its measured value is the reference row. The arm, the quantity and the code that ran are the STUDY\'s, named by the run\'s adapter; this entry states the shape rather than one study\'s. Ablation is NOT a baseline capability and was moved to C3-boundary. The SOTA comparison still records NO published-SOTA row, because a published figure for a quantity has to be read out of a paper by a human or a reader pipeline — recording one here would manufacture the comparison this step exists to ground',
    producer: B3_PRODUCER,
    timeoutMs: FIXTURE_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: b3Executor,
  },
  {
    stepId: 'C1-mvp',
    kind: 'local_computation',
    basis: 'the study\'s own experiment engine RUNS both of its arms under its declared conditions — every input is recorded on the artifact through the adapter\'s provenance block — and measures the quantity the study declares. No model was called and no measured dataset stands behind the numbers, so this is "the experiment really ran on the declared scenario", not "the claim is proven"',
    producer: C1_PRODUCER,
    timeoutMs: FIXTURE_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: c1Executor,
  },
  {
    stepId: 'C2-trinity-loop',
    kind: 'local_computation',
    basis: 'the convergence dossier is COMPUTED from the channels this step\'s declared inputs let it see (C from mvp-results, part of B from baseline-results) by the same rule the gate uses; the adversarial channel is not among its inputs, so it is reported absent rather than assumed — the step\'s A+B+C GATE is what actually adjudicates convergence (see VERDICT_CHANNELS). Inputs remain fixture-supplied.',
    producer: C2_PRODUCER,
    timeoutMs: FIXTURE_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: c2Executor,
  },
  {
    stepId: 'C3-boundary',
    kind: 'real_tool_fixture_input',
    basis: 'T19-S: boundary probing belongs to C3. The REAL `runAblation` tool function executes (plan → executor seam → per-variant descriptive stats), and its executor MEASURES both arms by running the traffic simulation (fixed-time vs adaptive) over the MEASURED demand profile rather than reading a mock. Ablation is NOT exercised at B3 anymore',
    producer: C3_PRODUCER,
    timeoutMs: REAL_TOOL_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: c3Executor,
  },
  {
    stepId: 'D1-figure-map',
    kind: 'real_tool_fixture_input',
    basis: 'canonical D1 = 结果→图表映射(数据图/三线表/路线图): the REAL renderFigure + renderThreeLineTable + renderRoadmap tool functions all execute over synthetic values/table/roadmap, and figure-plan lists all three with real render evidence',
    producer: D1_PRODUCER,
    timeoutMs: REAL_TOOL_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: d1Executor,
  },
  {
    stepId: 'D2-framework',
    // Declared for the DEFAULT path (no writer): the skeleton with generic headings.
    // With a prose writer the executor returns real_tool_fixture_input instead, and
    // the artifact's own `outlineSource` says which ran.
    kind: 'fixture_executor',
    basis: 'default path emits the canonical section skeleton with generic headings; with a prose writer the title and headings are derived from the claim and method, and the artifact records outlineSource accordingly',
    producer: D2_PRODUCER,
    timeoutMs: FIXTURE_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: d2Executor,
  },
  {
    stepId: 'D3-writing',
    // The prose is a fixture in this wave and the DOCUMENT is where the table is now rendered: the
    // executor runs the REAL `three-line-table` tool over the study's own measurements, so the shipped
    // path executes a catalogue tool and may not report itself as a deterministic fixture. The level
    // names what ran; the artifact names the channel that wrote the prose (`proseSource`), because a
    // deployment with a writer is a deployment fact the artifact carries and the registry cannot.
    kind: 'real_tool_fixture_input',
    basis: 'no drafting tool exists (no model call in this wave), so the section bodies are this package\'s fixture sentences; the REAL `three-line-table` tool function runs inside this step to render the manuscript\'s results table, which becomes the document\'s table block — a table belongs to the document, and the document is written here',
    producer: D3_PRODUCER,
    timeoutMs: FIXTURE_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: d3Executor,
  },
  {
    stepId: 'D4-rebuttal',
    kind: 'fixture_executor',
    basis: 'no rebuttal-revision tool exists; the executor emits a deterministic synthetic rebuttal record + revised draft (same section ids as the draft, revision markers)',
    producer: D4_PRODUCER,
    timeoutMs: FIXTURE_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: d4Executor,
  },
  {
    stepId: 'E1-format',
    // NO CATALOGUE TOOL RUNS HERE ANY MORE. E1 renders the document the manuscript artifact carries
    // and drives the deployment's compile seam; the results table is a block of that document, put
    // there by D3. It used to be filed as `real_tool_fixture_input` because it invoked
    // `renderThreeLineTable` itself, and that line is what this unit removed — the step that renders
    // the table is the step that writes the paper, not the step that typesets it.
    kind: 'local_computation',
    basis: 'E1 is the format STEP: the executor ASSEMBLES the reproducible package and renders the Markdown from the DOCUMENT the manuscript artifact carries. No research tool from the catalogue runs — the document, and the table inside it, were rendered at D3-writing — and the compile is a seam the deployment fills, so the step\'s own product is computed by this package\'s code over its inputs',
    producer: E1_PRODUCER,
    timeoutMs: REAL_TOOL_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: e1Executor,
  },
  {
    stepId: 'E2-submit',
    // THE ONE STEP A MACHINE NEVER COMPLETES. Its `kind` is the human gate rather than a truthfulness
    // level because what runs here prepares a request and judges nothing: a `local_computation` beside
    // this step's artifact would report the preparation as evidence about the paper. Its executor
    // writes the request a person decides, and the step still reaches only `gated` — the host's
    // approval channel is the only route to `passed` (INV-APPROVAL-STATE).
    kind: 'humanGate',
    basis: 'submission is a human act: the executor PREPARES the request (the manuscript and typeset versions, the documents with their digests, the venue) and submits nothing. The step reaches `gated` via completeStep (empty machine gate + humanGate) and is never auto-approved',
    producer: 'human-gate:E2-submit',
    // AN EXECUTOR RUNS HERE, so it is bounded like every other: it reads the run\'s own artifacts and
    // reaches no external system, which is what the offline budget covers.
    timeoutMs: FIXTURE_TIMEOUT_MS,
    recoveryPolicy: 'human_approval_only',
    executor: e2Executor,
  },
]

function buildRegistry(): Map<string, StepExecutorEntry> {
  const map = new Map<string, StepExecutorEntry>()
  for (const spec of ENTRY_SPECS) {
    const def = STEP_DEFS.find(d => d.id === spec.stepId)
    if (def === undefined) {
      throw new Error(`T19B registry: '${spec.stepId}' is not a core pipeline step`)
    }
    map.set(spec.stepId, {
      stepId: spec.stepId,
      kind: spec.kind,
      basis: spec.basis,
      producer: spec.producer,
      executor: spec.executor,
      inputSchema: inputSchemaOf(def),
      outputSchema: outputSchemaOf(def),
      timeoutMs: spec.timeoutMs,
      gateRequirement: gateRequirementOf(def),
      recoveryPolicy: spec.recoveryPolicy,
    })
  }
  if (map.size !== STEP_DEFS.length) {
    throw new Error(
      `T19B registry: ${map.size} entries for ${STEP_DEFS.length} core steps — every step must be registered`,
    )
  }
  return map
}

/** The authoritative 16-step executor registry (spec §1/§2 + T19-S reconciliation). */
export const STEP_EXECUTOR_REGISTRY: ReadonlyMap<string, StepExecutorEntry> = buildRegistry()

/** The 16 core step definitions in canonical execution order (deep-frozen clones). */
export const PIPELINE_STEPS: ReadonlyArray<StepDefinition> = STEP_DEFS

/** Step → declared output slugs (convenience projection for reports/tests). */
export const STEP_OUTPUT_MAP: Readonly<Record<string, ReadonlyArray<string>>> = Object.fromEntries(
  STEP_DEFS.map(d => [d.id, d.outputs]),
)

/**
 * Tool → step CAPABILITY map (T19-S §2). Tools serve steps as capabilities;
 * a tool is never a step substitute. `wired:false` entries are declared,
 * auditable gaps for this wave.
 */
export const STEP_CAPABILITIES: Readonly<Record<string, ReadonlyArray<StepCapability>>> = {
  'A1-landscape': [{ toolId: LITERATURE_SEARCH_TOOL_ID, role: 'landscape retrieval', wired: true }],
  'A2-claim': [{ toolId: CLAIM_CONSTRUCT_TOOL_ID, role: 'claim + falsifiable-prediction construction', wired: true }],
  'A3-agenda': [],
  'A4-venue': [],
  'B1-method': [],
  'B2-data': [],
  'B3-baseline': [
    {
      toolId: LITERATURE_SEARCH_TOOL_ID,
      role: 'B3-SOTA retrieval sub-task (canonical)',
      wired: false,
      note: 'synthetic corpus is off-domain (no traffic-signal SOTA) → executor stays an honest fixture',
    },
  ],
  'C1-mvp': [],
  'C2-trinity-loop': [],
  'C3-boundary': [{ toolId: ABLATION_TOOL_ID, role: 'boundary probing (variant-vs-baseline ablation runs)', wired: true }],
  'D1-figure-map': [
    { toolId: FIGURE_TOOL_ID, role: 'data-figure render', wired: true },
    { toolId: THREE_LINE_TABLE_TOOL_ID, role: '三线表 render (figure family)', wired: true },
    { toolId: ROADMAP_TOOL_ID, role: '路线图 render (figure family)', wired: true },
  ],
  'D2-framework': [],
  'D3-writing': [],
  'D4-rebuttal': [],
  'E1-format': [
    {
      toolId: THREE_LINE_TABLE_TOOL_ID,
      role: 'results-table sub-capability inside manuscript formatting',
      wired: true,
    },
  ],
  'E2-submit': [],
}

/**
 * Truthfulness of each trinity GATE channel (implemented in verdict.ts). Declared
 * here so the registry stays the single audit face for "what is real".
 *  - A: the REAL team `judgeRound` → core `adjudicate('A')` runs; the votes are a
 *    synthetic complete rebuttal round (fixture input). No TOOL runs, so this is
 *    `local_computation`, not `real_tool_fixture_input`.
 *  - B: the REAL core `verifyCitation` identity chain runs against the reviewed evidence corpus
 *    (`runner/evidence-corpus.ts`: articles retrieved once by hand, with the passage a reviewer
 *    judged) when the run's claim version has one, and against the SIMULATED
 *    `MockCitationResolverAdapter` (+ the T23 synthetic anchor fixture) when it does not → core
 *    `adjudicate('B')`. The `live_external` label below describes the corpus path, which is the
 *    one a run of the default study takes; the fallback is labelled where it is built.
 *  - C: the REAL team `adjudicateClaimSupport` → core `adjudicate('C')` runs over a
 *    `live` experiment report MEASURED by the study's own engine over its declared conditions
 *    profile; the claim and its prediction are the fixture-supplied input. The
 *    measurement is this package's own code, hence `local_computation`.
 */
export const VERDICT_CHANNELS: Readonly<Record<TrinityComponent, { kind: Truthfulness; basis: string }>> = {
  A: {
    // No tool function runs here either: `judgeRound` and core `adjudicate` are package code over
    // votes this package DERIVED. The three rulebooks read the material under review — the
    // manuscript once a draft exists, the claim material before that — and each check computes its
    // own position, so a vote against the work is reachable and a driven run reaches it. What no
    // part of this channel does is call a model, so the votes are not a second opinion.
    kind: 'local_computation',
    basis: 'reviewManuscript → reviewClaim rulebooks over the material under review → team judgeRound → core adjudicate(A); deterministic checks, no model votes',
  },
  B: {
    // An external system WAS consulted: the sources are real articles, retrieved once by hand and
    // checked in with the passage a reviewer read. What this label does NOT claim is that the run
    // fetched them live — it does not, and each source's provenance note says so.
    kind: 'live_external',
    basis: 'core verifyCitation identity chain executes against the reviewed evidence corpus (retrieved sources + recorded reviewer verdicts) → core adjudicate(\'B\'); falls back to MockCitationResolverAdapter + the T23 synthetic anchor fixture for a claim version the corpus does not hold',
  },
  C: {
    // The measurement is made by this package's experiment module, not by a tool.
    kind: 'local_computation',
    // The experiment RUNS (the study's engine runs both arms over the declared
    // demand profile; the report carries source 'live' and grades 'locally-measured' — which
    // names the channel, not a level of verification).
    // Its INPUT — the claim and its prediction — is fixture-supplied on the default
    // path, which is what keeps this short of `live_external`.
    basis: 'team adjudicateClaimSupport → core adjudicate(`C`) executes for real over an experiment MEASURED by the study\'s own engine: both of its arms are run under the declared conditions, and every reported number is computed from that run (the artifact records the inputs through the adapter\'s provenance block). Report source is the literal `live` — the experiment ran HERE, not against an external system — and evidenceGrade is `locally-measured`, derived from that literal by equality: it distinguishes which channel ran and grades nothing. The claim and prediction it adjudicates come from the selected Case Pack, and the claim is recorded as REFUTED when the measurement negates it',
  },
}

/** Convenience: the canonical claim/prediction constants used by executors + verdicts. */
/**
 * The default plan's claim identity.
 *
 * A caller that wants the values a run with no plan supplied will carry — the fixtures the specs
 * assert against — reads them here rather than restating them.
 */
export const CANONICAL = {
  claimId: DEFAULT_PLAN.claim.id,
  claimRef: DEFAULT_PLAN.claim.ref,
  prediction: DEFAULT_PLAN.claim.prediction,
} as const

export type { StepDefinition }


// ── T19 semantic calibration (A3/R2): explicit research TASK per step ───────
// Each canonical step first expresses its RESEARCH task; tool capabilities serve
// it (STEP_CAPABILITIES) — a tool is never a step substitute. These labels are
// asserted (non-empty, distinct from every tool id) so a step can never be
// mistaken for, or replaced by, a tool.

/** 16 步研究语义任务(语义先行)。键=canonical stepId。 */
export const SEMANTIC_TASKS: Readonly<Record<string, string>> = {
  'A1-landscape': '领域与文献景观扫描: 界定研究域并盘点相关文献(交通自适应信号控制)',
  'A2-claim': '构造可证伪的研究 claim: 明确断言与可证伪预言(超越 SOTA 差距的实验判定)',
  'A3-agenda': '研究议程与扩展: 规划多阶段研究任务与依赖(非关键词处理)',
  'A4-venue': '期刊与审稿标准: 依中科院分区∪CCF 双体系确定目标投稿域与格式约束',
  'B1-method': '方法推导: 从研究问题推导可执行方法(自适应策略形式化)',
  'B2-data': '数据与复现基础: 声明数据来源/版本/种子与复现协议(mock 显式标记)',
  'B3-baseline': 'baseline 与指标: 建立对照基线并定义评估指标(固定配时的实测延误)',
  'C1-mvp': '方法 MVP: 最小可行实现并产出首轮实验结果(自适应变体)',
  'C2-trinity-loop': '迭代实验与三一收敛: 以 A/B/C 三组件收敛 claim 判定',
  'C3-boundary': '边界与反例: 以消融探测 claim 成立边界与反例',
  'D1-figure-map': 'claim→图表映射: 为结果产出数据图/三线表/路线图',
  'D2-framework': '论文结构: 由 claim 与证据组织论文骨架(与写作并行)',
  'D3-writing': '由内向外写作: 从证据/图表生成论文正文段落(数字可追溯)',
  'D4-rebuttal': 'rebuttal 演练: 生成可辩护的答辩意见(引用对应 claim/实验)',
  'E1-format': '格式与复现包: 装配投稿格式稿件与可复现包(三线表为子能力)',
  'E2-submit': '投稿前人工门禁: 由可信人工审阅后才允许提交(绝不自动)',
}

/** 语义诚实断言: 16 项全覆盖、非空、且任何一步的语义任务都不得是某工具。 */
export function assertSemanticTasksHonest(): void {
  const stepIds = new Set(PIPELINE_STEPS.map(step => step.id))
  const capabilityToolIds = new Set<string>()
  for (const capabilities of Object.values(STEP_CAPABILITIES)) {
    for (const capability of capabilities) capabilityToolIds.add(capability.toolId)
  }
  const missing = [...stepIds].filter(id => SEMANTIC_TASKS[id] === undefined)
  if (missing.length > 0) throw new Error(`SEMANTIC_TASKS missing: ${missing.join(',')}`)
  for (const [stepId, task] of Object.entries(SEMANTIC_TASKS)) {
    if (!stepIds.has(stepId)) throw new Error(`SEMANTIC_TASKS unknown step '${stepId}'`)
    if (task.trim().length === 0) throw new Error(`SEMANTIC_TASKS empty for '${stepId}'`)
    if (capabilityToolIds.has(stepId)) {
      throw new Error(`step '${stepId}' collides with a tool id — tools are capabilities, never steps`)
    }
  }
}

/** 每步执行通道口径(静态,当前代码事实): direct|fixture|human。 */
export function stepChannelBreakdown(): ReadonlyArray<{ stepId: string; channel: string }> {
  const modelReadySteps = new Set(['D1-figure-map'])
  return PIPELINE_STEPS.map(step => ({
    stepId: step.id,
    channel: step.id === 'E2-submit' ? 'human' : modelReadySteps.has(step.id) ? 'direct(model-ready-capable)' : 'direct|fixture',
  }))
}

// ── R3: per-step invocation channel (planned vs ACTUAL, R3 corrected) ──────
export type StepChannel = 'direct' | 'fixture' | 'human' | 'agent-loop'
export type InvokerKind = 'DirectResearchToolInvoker' | 'AgentLoopResearchToolInvoker' | 'none(fixture)' | 'none(human-gate)'

export interface StepInvocationChannel {
  readonly stepId: string
  /** Channel the step WOULD use when an AgentLoop invoker is injected (capability). */
  readonly plannedChannel: StepChannel
  /** Channel actually used in the current run/context (E2E defaults to Direct). */
  readonly actualChannel: StepChannel
  /** Which invoker implementation actually ran the tool capability (or none). */
  readonly invokerKind: InvokerKind
  /** Host ToolRuntime execution id when actualChannel=agent-loop; else undefined. */
  readonly toolRuntimeExecutionId: string | undefined
  readonly truthfulness: string
  /** Why actual != planned, or why no invoker was used. */
  readonly fallbackReason: string | undefined
}

const STEP_TRUTHFULNESS: Readonly<Record<string, string>> = {
  'A1-landscape': 'real_tool_fixture_input',
  'A2-claim': 'real_tool_fixture_input',
  'C3-boundary': 'real_tool_fixture_input',
  'D1-figure-map': 'real_tool_fixture_input',
  'E1-format': 'real_tool_fixture_input',
  'E2-submit': 'live human (offline: pending)',
}

/**
 * Per-step channel table reflecting REALITY for the current invocation mode.
 * Today no AgentLoop invoker is injected into the T19 drive path, so D1's
 * actualChannel is 'direct' (default DirectResearchToolInvoker), with the
 * agent-loop capability recorded only in plannedChannel + fallbackReason.
 * @param mode - 'e2e-default' (no invoker injection) | 'agent-loop-injected'.
 */
export function perStepInvocationChannels(
  mode: 'e2e-default' | 'agent-loop-injected' = 'e2e-default',
): ReadonlyArray<StepInvocationChannel> {
  const wired = new Set(['A1-landscape', 'A2-claim', 'C3-boundary', 'D1-figure-map', 'E1-format'])
  const agentLoopInjected = mode === 'agent-loop-injected'
  return PIPELINE_STEPS.map((step) => {
    if (step.id === 'E2-submit') {
      return {
        stepId: step.id,
        plannedChannel: 'human' as const,
        actualChannel: 'human' as const,
        invokerKind: 'none(human-gate)' as const,
        truthfulness: STEP_TRUTHFULNESS[step.id] ?? 'fixture_executor',
        toolRuntimeExecutionId: undefined,
        fallbackReason: undefined,
      }
    }
    if (!wired.has(step.id)) {
      return {
        stepId: step.id,
        plannedChannel: 'fixture' as const,
        actualChannel: 'fixture' as const,
        invokerKind: 'none(fixture)' as const,
        truthfulness: 'fixture_executor',
        toolRuntimeExecutionId: undefined,
        fallbackReason: undefined,
      }
    }
    const planned: StepChannel = step.id === 'D1-figure-map' ? 'agent-loop' : 'direct'
    const actual: StepChannel = step.id === 'D1-figure-map' && !agentLoopInjected ? 'direct' : planned
    const truthfulness = STEP_TRUTHFULNESS[step.id] ?? 'real_tool_fixture_input'
    return {
      stepId: step.id,
      plannedChannel: planned,
      actualChannel: actual,
      invokerKind: actual === 'agent-loop'
        ? 'AgentLoopResearchToolInvoker'
        : 'DirectResearchToolInvoker',
      // No real ToolRuntime execution id is observable from session events
      // (audit F1-P2-3): the field stays undefined — never a fabricated id.
      toolRuntimeExecutionId: undefined,
      truthfulness,
      fallbackReason: planned !== actual
        ? 'no AgentLoop invoker injected into the T19 drive path; default DirectResearchToolInvoker (direct_call)'
        : undefined,
    }
  })
}

export interface ChannelStat {
  readonly channel: StepChannel
  readonly count: number
  readonly stepIds: ReadonlyArray<string>
}
export function invocationChannelSummary(): ReadonlyArray<ChannelStat> {
  const byChannel: Record<StepChannel, string[]> = { direct: [], fixture: [], human: [], 'agent-loop': [] }
  for (const row of perStepInvocationChannels('e2e-default')) {
    byChannel[row.actualChannel].push(row.stepId)
  }
  return (Object.keys(byChannel) as StepChannel[])
    .map(channel => ({ channel, count: byChannel[channel].length, stepIds: byChannel[channel] }))
    .filter(stat => stat.count > 0)
}
