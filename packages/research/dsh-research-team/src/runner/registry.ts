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
//   - E1-format no longer IS `renderThreeLineTable`: E1 assembles the formatted
//     manuscript + reproducible package; three-line-table is only its table
//     sub-capability.
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

import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'

import { CASE_PACK_INPUT_SLUGS } from './case-pack.ts'
import { commitmentFrom } from './prediction-gate.ts'
import type { ClaimMaterial } from './redteam-review.ts'
import type { MeasuredMetric, PredictionCommitment } from './prediction-gate.ts'
import type { PlatoonStudy } from './platoon-sim.ts'
import { DEFAULT_PLAN } from './study-plan.ts'
import type { PlanSection, StudyPlan } from './study-plan.ts'

import type { StepDefinition, TrinityComponent } from '@deepseek-ai/dsh-research-core'
import { getStepDefinitions } from '@deepseek-ai/dsh-research-core'
import type { AblationDefinition, RoadmapGraph } from '@deepseek-ai/dsh-research-tools'
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
  ABLATION_VARIANT_KINDS,
  ablationRunKey,
} from '@deepseek-ai/dsh-research-tools'
import type {
  AblationExecutor,
  AblationRunRequest,
  AblationRunResult,
} from '@deepseek-ai/dsh-research-tools'
import {
  ABLATION_MODULES,
  EXPERIMENT_RULE_VERSION,
  SIMULATION_INPUTS,
  ablationStudy,
  boundaryTest,
  comparePlatoons,
  HOMOGENEOUS_PLATOON_COMPOSITION,
  measureStudy,
  MIXED_PLATOON_COMPOSITION,
  MODEL_EQUATIONS,
  experimentStudy,
  runPlatoon,
  studyFromPack,
} from './platoon-sim.ts'
import { resolveImplementation } from './implementations.ts'
import {
  RESULT_VERSION_SLUG,
  measuredFromComparison,
  readResultVersion,
  resultVersionOf,
} from './result-version.ts'
import type { MeasuredOutcome, ResultSource } from './result-version.ts'
import { sectionEvidenceFor } from './section-evidence.ts'
import { applyRevision, bodyHashOf } from './issue-patch.ts'
import { assertWellFormed, parseReply, type DiscardedExchange } from './issue-parse.ts'
import type { RevisionIssue } from './issue-patch.ts'
import type { SectionEvidence } from './section-evidence.ts'
import { assessmentsFor } from './evidence-corpus.ts'
import { argumentPlanOf, checkArgumentPlan, claimOutcomeOf, contractFor } from './argument-plan.ts'
import { checkPresentationPlan, shippedPresentationPlan } from './presentation-plan.ts'
import type { PlannedFigure } from './presentation-plan.ts'
import type { ArgumentPlan } from './argument-plan.ts'
import { compileManuscript, documentOf } from './document-compile.ts'
import type { DocumentCompiler } from './document-compile.ts'
import {
  bibliographyOf, checkCitationKeys, checkCitationUse, checkManuscriptCitations, citationUsesOf,
  citeKeyOf, renderCitationMarkers, reviewedSources,
} from './citation-bindings.ts'
import type { CitationUse } from './citation-bindings.ts'
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

  readonly runId: string
  readonly stepId: string
  readonly attemptId: number
  /** Cooperative-cancellation signal forwarded from core runStep. */
  readonly signal?: AbortSignal
  /** Read an upstream-produced artifact value (verified satisfied by canStart). */
  readonly getInput: (slug: string) => unknown
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
   * `'humanGate'` for a step no executor runs (E2-submit).
   *
   * `'humanGate'` is the level `StepOutcome.kind` uses for exactly that case, so the
   * registry table and the per-step table now say the same thing about E2. Declaring
   * it `fixture_executor` made the registry table claim a fixture executor for a step
   * whose own basis says no executor runs.
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
  /** Execute-phase timeout handed to core runStep (ms). 0 = no executor runs. */
  readonly timeoutMs: number
  /** Gate the step must satisfy (derived from the core step definition). */
  readonly gateRequirement: GateRequirement
  readonly recoveryPolicy: RecoveryPolicy
  /** E2-submit stops at the human gate (completeStep → 'gated'); no executor runs. */
  readonly humanGateStop?: boolean
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
  kind: Truthfulness,
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

/** Writer-section model shared by D2/D3/D4/E1 (paper-outline → draft →
 *  revised-draft → formatted-manuscript). Plain data; deterministic. */
interface ManuscriptSection extends PlanSection {
  readonly bodyText: string
}

// ── Producer brands (read from the tools' own id/version constants) ─────────────
const A1_PRODUCER = `${LITERATURE_SEARCH_TOOL_ID}@${LITERATURE_SEARCH_TOOL_VERSION}`

/** A1's offline gap statement, emitted only when no model writer is injected.
 *  It is a fixture constant, never a finding — the artifact labels it `fixture`. */
const FIXTURE_GAP_STATEMENT = 'SOTA minimum-time-to-collision gap for mixed platoons is unverified'
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
const B3_PRODUCER = 'platoon-sim:baseline'
const C1_PRODUCER = 'platoon-sim:mvp'
const C2_PRODUCER = 'convergence:trinity-loop'
const C3_PRODUCER = `${ABLATION_TOOL_ID}@${ABLATION_TOOL_VERSION}`
const D1_PRODUCER = `${FIGURE_TOOL_ID}@${FIGURE_TOOL_VERSION}`
const D2_PRODUCER = 'fixture:framework'
const D3_PRODUCER = 'fixture:writing'

/**
 * The statement the reviewed sources are cited for.
 *
 * A CITATION IS FOR A SENTENCE, NOT FOR A PAPER. The reviewed corpus binds each judgement to the
 * claim it was assessed against, and the sentence that states where this work sits in the literature
 * is the one those judgements answer — so every binding made here names that statement, and a later
 * revision of it is a different statement whose citations have to be re-made.
 */
const STATEMENT_LITERATURE_POSITION = 'introduction:prior-work'
const D4_PRODUCER = 'fixture:rebuttal'
const E1_PRODUCER = `${THREE_LINE_TABLE_TOOL_ID}@${THREE_LINE_TABLE_TOOL_VERSION}`

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
  'draft': 'manuscript-draft',
  'rebuttal': 'rebuttal-record',
  'revised-draft': 'manuscript-draft',
  'formatted-manuscript': 'formatted-manuscript',
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
function priorWorkSentence(citations: ReadonlyArray<CitationUse>): string {
  if (citations.length === 0) {
    return 'No reviewed source bears on the condition this study varies, so this work is not placed'
      + ' against prior findings.'
  }
  const clauses = citations.map((citation) => {
    const marker = `[@${citation.citeKey}]`
    return citation.support === 'contradicted'
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
): ReadonlyArray<Record<string, unknown>> {
  const { entries, unresolvable } = bibliographyOf(citations, reviewedSources())
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
  const comparison = comparePlatoons(ctx?.runCtx.study ?? experimentStudy())
  return { measured: measuredFromComparison(comparison), source: 'recomputed', contentHash: '' }
}

/**
 * The run's measured outcome, rounded to the precision the manuscript reports.
 *
 * @param ctx - the run, when the caller has one; the record is read from it.
 * @returns both platoons' minimum time-to-collision plus the change between them.
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
/**
 * The sentence that states what the run measured and what it did to the claim.
 *
 * ONE SENTENCE, DERIVED FROM THE MEASUREMENT, and the same sentence in every section that reports the
 * outcome. The delivered paper's sections each described the result in their own words and none of
 * them said the measurement contradicted the claim, so the words here come from the run: the sign of
 * the change, its magnitude, and what the argument plan says it did to the claim.
 *
 * @param argumentPlan - the plan this manuscript is written under.
 * @param measured - the run's own measurement.
 * @returns the sentence, without a trailing period.
 */
function outcomeSentence(
  argumentPlan: ArgumentPlan,
  measured: ReturnType<typeof measureOutcome>,
): string {
  const percent = Math.abs(measured.improvementPct).toFixed(2)
  const movement = measured.improvementPct >= 0 ? 'rose' : 'fell'
  const verdict = argumentPlan.outcome === 'refuted'
    ? 'which contradicts the claim this study committed to test'
    : argumentPlan.outcome === 'supported'
      ? 'which is the change the claim predicted'
      : 'which falls short of the change the claim predicted'
  return `the platoon minimum time-to-collision ${movement} by ${percent}%, ${verdict}`
}

function bodyTextFor(
  id: string,
  plan: StudyPlan,
  measured: ReturnType<typeof measureOutcome>,
  citations: ReadonlyArray<CitationUse>,
  argumentPlan: ArgumentPlan,
  citable: ReadonlyArray<CitableFloat>,
): string {
  // THE PROSE NAMES THE FLOATS THE DRAFT CARRIES. A float nothing refers to is a float the paper did
  // not need — the delivered paper carries six of them — and the A gate refuses a draft whose prose
  // never names one it carries. A section that reports results therefore points at the figure, the
  // table and the diagram it is reporting, and the Method section points at the equations it states.
  const named = (kind: string): string =>
    citable.filter(item => item.label.toLowerCase().startsWith(kind))
      .map(item => item.label)
      .join(', ')
  const study = experimentStudy()
  const hv = study.variant.vehicleClasses.HV
  const av = study.variant.vehicleClasses.AV
  const inputs = SIMULATION_INPUTS
  switch (id) {
    case 'abstract':
      return 'We test whether inserting a single autonomous vehicle into a three-vehicle human platoon changes the platoon\'s car-following risk, measured as its minimum time-to-collision, under a declared periodic speed disturbance. Both platoons are simulated with the Intelligent Driver Model at the Case Pack\'s declared vehicle parameters. This is a deterministic offline simulation, not field data, and it reports no crash frequency. Under the declared configuration '
        + `${outcomeSentence(argumentPlan, measured)}.`
    case 'introduction':
      // THE LITERATURE POSITION IS A SENTENCE, NOT A REFERENCE LIST. This section used to state the
      // claim and the prediction and say nothing about what is already known — the quality baseline
      // reported exactly that, on this paper, as `no-literature-position`.
      return `This work targets the claim: ${plan.claim.ref}. The falsifiable prediction is: ${plan.claim.prediction}. ${priorWorkSentence(citations)}`
    case 'method':
      return `Both platoons are run with the SAME car-following model — the Intelligent Driver Model (Treiber, Hennecke & Helbing 2000), integrated at a fixed ${inputs.stepSeconds.toFixed(2)} s step — and differ only in composition: the baseline is HV-HV-HV and the variant is HV-AV-HV. The Case Pack declares, for each class, its reaction delay, its desired headway and its deceleration limit: the human vehicle reacts in ${hv.reactionDelaySeconds.toFixed(2)} s and wants a ${hv.desiredHeadwaySeconds.toFixed(1)} s headway; the autonomous vehicle reacts in ${av.reactionDelaySeconds.toFixed(2)} s and wants a ${av.desiredHeadwaySeconds.toFixed(1)} s headway. The look-ahead horizon is NOT declared by the pack — this study derives it as ${av.lookAheadHorizonSeconds.toFixed(2)} s, the vehicle's own reaction delay. Reaction time is applied as a real delay: a follower evaluates its leader's state as it was that delay earlier, and a vehicle with a horizon extrapolates that observed state forward over it. The leader's speed follows a declared periodic disturbance of ±${inputs.freeFlowAmplitudeMps.toFixed(1)} m/s at a ${inputs.disturbancePeriodSeconds.toFixed(1)} s period, which is the perturbation the string-stability literature uses to test whether a disturbance grows or decays down a platoon. The equations this section states (${named('equation')}) are the model's own, and the parameters they carry are the ones the Case Pack declares.`
    case 'experiments':
      return `Both platoons were run over ${inputs.measurementSeconds.toFixed(0)} s after a ${inputs.warmupSeconds.toFixed(0)} s warm-up, and the minimum time-to-collision (Minderhoud & Bovy 2001) was read from the simulated trajectories: ${measured.baseline.toFixed(2)} s for the homogeneous platoon and ${measured.variant.toFixed(2)} s for the platoon carrying the autonomous vehicle, a change of ${measured.improvementPct.toFixed(2)}%. Neither platoon entered the pack's declared TTC<1.5s band (${(measured.values['baselineTtcRatePct'] ?? 0).toFixed(2)}% and ${(measured.values['variantTtcRatePct'] ?? 0).toFixed(2)}% of vehicle-time), which bounds what that band could have shown.`
    case 'results':
      return `The comparison the claim is about is drawn in ${named('figure')} and its two values are listed in ${named('table')}; ${named('figure 2') === '' ? 'the research roadmap' : named('figure 2')} shows how the study reaches it. The measurement is that `
        + `${outcomeSentence(argumentPlan, measured)}. The claim is bounded to steady free flow; the boundary probe and the ablations are reported separately, and no published-SOTA comparison is asserted.`
    case 'conclusion':
      return `Under the declared configuration ${outcomeSentence(argumentPlan, measured)}, measured inside the study's own car-following model. The scope is three vehicles on one lane under a declared disturbance with no stochasticity; submission remains a human act at E2.`
    case 'references':
      // The body states what the draft actually carries. It used to describe the LANDSCAPE SCAN's
      // record count, which is what the reference list used to be; the list is now the sources the
      // paper cites, and the sentence says that.
      return citations.length === 0
        ? 'No source is cited: this run holds no reviewed judgement binding one to its statements.'
        : `The ${String(citations.length)} reviewed source(s) this paper cites, listed below.`
    default:
      return 'This section carries no generated content in this wave.'
  }
}

/**
 * The argument plan for a manuscript assembled from the outline rather than from a draft.
 *
 * A DRAFT WITH SECTIONS AND NO PLAN IS REFUSED at E1, because there is nothing to judge its sections
 * against; a draft with NEITHER is the fallback path, and this is the plan its sections are written
 * under. Both readers — the fallback body writer and E1's check — call this, so the plan a section was
 * written under cannot differ from the plan it is judged by.
 *
 * @param plan - the study plan.
 * @param ctx - the step's context, which carries the measurement and what the claim committed to.
 * @returns the plan, derived from the run rather than configured.
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
  citations: ReadonlyArray<CitationUse> = [],
): ReadonlyArray<ManuscriptSection> {
  const measured = measureOutcome(ctx)
  const argumentPlan = derivedArgumentPlan(plan, ctx)
  return plan.outline.map(s => ({
    id: s.id,
    heading: s.heading,
    bodyText: bodyTextFor(
      s.id,
      plan,
      measured,
      citations,
      argumentPlan,
      // The roster this path's prose is written against: the same labels D1 planned, read off the
      // figure plan the run holds. A fallback whose sections named nothing would be refused by the
      // A gate for carrying floats nothing refers to.
      citableFloats(
        planFloats(Array.isArray(readInput(ctx, 'figure-plan')?.figures)
          ? (readInput(ctx, 'figure-plan')?.figures as ReadonlyArray<FigurePlanEntry>)
          : []),
        MODEL_EQUATIONS,
      ),
    ),
  }))
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
    gaps = [FIXTURE_GAP_STATEMENT]
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
  ctx.runCtx.study = studyFromPack(packScenario) ?? experimentStudy()
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
  let contributions: ReadonlyArray<{ id: string; statement: string }> = [
    { id: 'c1', statement: 'the mixed platoon changes the platoon minimum time-to-collision relative to the homogeneous platoon' },
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
          expectedEvidence: `platoon minimum-TTC change ${thresholdLabel(ctx.runCtx.commitment)} (prediction: ${predictionText})`,
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
        matches: ['car-following simulation', 'mixed-platoon safety comparison', 'falsifiable experiment'],
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
  let steps: ReadonlyArray<string> = [
    `build the two platoons (${HOMOGENEOUS_PLATOON_COMPOSITION.join('-')} against ${MIXED_PLATOON_COMPOSITION.join('-')})`,
    `integrate ${implementation.algorithm} at ${String(implementation.parameters['stepSeconds'])} s steps`,
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
        methodId: SCENARIO.variantIdentity,
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

/**
 * The provenance of the demand every experiment executor runs against.
 *
 * The traffic experiment used to run on a demand array written into the source, so
 * an artifact reporting a measured reduction said nothing about where the demand
 * came from. Each experiment artifact now carries this block, which names the
 * measured series, its hash, and the split between what the series measured and
 * what the study assumed on top of it. It is the same object in C1, B3 and C3, so
 * the three cannot describe different inputs.
 *
 * @param plan - the run's plan, which states the quantity this study measures.
 * @param study - the scenarios the measurement ran.
 * @returns the demand evidence block attached to every experiment artifact.
 */
function studyEvidence(
  plan: StudyPlan,
  study: PlatoonStudy = experimentStudy(),
): Record<string, unknown> {
  return {
    source: 'declared-scenario',
    study: {
      baselineComposition: study.baseline.composition,
      variantComposition: study.variant.composition,
      initialSpeedMps: study.variant.initialSpeedMps,
      desiredSpeedMps: study.variant.desiredSpeedMps,
      initialGapM: study.variant.initialGapM,
      vehicleClasses: study.variant.vehicleClasses,
      leader: study.variant.leader,
    },
    designInputs: SIMULATION_INPUTS,
    // WHICH PARAMETERS CAME FROM THE PACK AND WHICH THIS STUDY DERIVED. The pack's vehicle rows
    // carry a reaction delay, a desired headway and a deceleration limit; they carry NO look-ahead
    // horizon, so `studyFromPack` derives one as the vehicle's own reaction delay. Saying "each
    // class carries the pack's declared parameters" over that derivation attributed a
    // loader-invented number to the pack — and once the horizon became a real mechanism rather
    // than a subtraction, it was worth 0.72 s of the measured effect. An audit found the wording.
    derivedParameters: ['lookAheadHorizonSeconds (the vehicle\'s own reaction delay; the pack declares no horizon)'],
    ruleVersion: EXPERIMENT_RULE_VERSION,
    // What this measurement is and what it is NOT. An artifact that states only "an
    // experiment ran" invites the reader to assume it tested the claim; naming both is what
    // lets them check, and the previous study's artifact had to say its measurement was
    // about an intersection while its claim was about a platoon.
    measures: plan.metric.key,
    alsoMeasured: ['ttc-lt-1.5s-rate-pct', 'mean-time-headway-seconds', 'mean-jerk-mps3', 'string-stability-index'],
    doesNotMeasure: 'field crash frequency, any external SOTA, or any quantity outside the declared simulation',
    note:
      'the scenario is DECLARED by the Case Pack and the simulation inputs are declared '
      + 'constants; there is no measured dataset behind these numbers, and no parameter '
      + 'was fitted to the experiment outcome',
  }
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
        methodRef: (method?.methodId as string | undefined) ?? SCENARIO.variantIdentity,
        files: checks,
        // The descriptor states what is ON DISK, not what was intended.
        acquisition: acquired
          ? 'acquired — every declared file is present, size-matched and hash-matched against the record in data/README.md'
          : 'not acquired on this host — the dataset is named but its recorded bytes were not verified here',
        // What this dataset has to do with THIS run. The platoon study's experiment consumes
        // the Case Pack's declared scenario, not these bytes: the SUMO run is a signal-control
        // trace, so it carries no mixed-platoon trajectory the study could measure against.
        // Recording the descriptor without that sentence invites a reader to take "the study's
        // dataset" for an input the experiment used, which it is not.
        consumedBy: 'no step of this run — this run\'s experiment reads the Case Pack\'s declared '
          + 'scenario. The trace is a signal-control run, so it holds no platoon trajectory to '
          + 'measure against, and no artifact of this run is derived from its bytes.',
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
  const study = ctx.runCtx.study
  // The baseline is MEASURED, not declared: the homogeneous platoon is simulated under the
  // study's own declared conditions, so the reference row is a number this study produced.
  const comparison = comparePlatoons(study)
  const measuredImprovementPct = comparison.relativeImprovementPct

  return {
    'baseline-results': tagArtifact(
      {
        fixture: false,
        stepId: 'B3-baseline',
        slug: 'baseline-results',
        baseline: {
          identity: SCENARIO.baselineIdentity,
          protocol: 'simulate the homogeneous platoon under the study’s declared disturbance and read its minimum time-to-collision',
          metric: { name: planOf(ctx).metric.key, direction: 'higher is better' },
          // The input this NUMBER came from. The baseline is measured by running the
          // simulation over the Case Pack's declared scenario, which is not the dataset B2
          // registered; naming B2's descriptor here would attribute the measurement to a
          // dataset no arithmetic in this step touches.
          datasetRef: SCENARIO.datasetId,
          registeredDatasetRef: (dataset?.datasetId as string | undefined) ?? null,
          methodRef: (method?.methodId as string | undefined) ?? SCENARIO.baselineIdentity,
        },
        measured: {
          baselineMinTtcSeconds: comparison.baseline.minTtcSeconds,
          variantMinTtcSeconds: comparison.variant.minTtcSeconds,
          variantImprovementPct: measuredImprovementPct,
          baselineTtcLt1_5RatePct: comparison.baseline.ttcLt1_5RatePct,
          variantTtcLt1_5RatePct: comparison.variant.ttcLt1_5RatePct,
          source: 'platoon-sim (both platoons simulated under the declared disturbance)',
          study: studyEvidence(planOf(ctx), study),
        },
        beatsBaselineWhen: `variant minimum time-to-collision moves ${thresholdLabel(ctx.runCtx.commitment)} against the baseline's, in the claim's declared direction`,
        note: 'baseline MEASURED by simulating the homogeneous platoon; the variant row is the same run under the same conditions, so the comparison is internally consistent. Ablation measurements are NOT part of baseline (they belong to C3-boundary)',
      },
      B3_PRODUCER,
      'local_computation',
    ),
    'sota-comparison': tagArtifact(
      {
        fixture: false,
        stepId: 'B3-baseline',
        slug: 'sota-comparison',
        targetMetric: planOf(ctx).metric.key,
        rows: [
          { method: 'HV-HV-HV (this study baseline)', minTtcSeconds: comparison.baseline.minTtcSeconds, source: 'measured by platoon-sim' },
          { method: 'HV-AV-HV (this study variant)', minTtcSeconds: comparison.variant.minTtcSeconds, measuredImprovementPct, source: 'measured by platoon-sim' },
        ],
        // No external SOTA row is recorded, and THAT is stated rather than filled in.
        // Published minimum-TTC figures are prose in papers, not machine-readable fields, so
        // a retrieved record cannot supply one without someone reading the number out
        // of the text. Recording a guess here would manufacture the comparison this
        // step exists to ground.
        anchoring: 'none',
        sotaGapClaim: "the variant's margin is compared against this study's own homogeneous platoon; a claim against PUBLISHED SOTA remains unanchored",
        note: 'the two rows are this study’s own measurements. No published-SOTA row is recorded: the literature channel retrieves real records, but a minimum-TTC figure has to be read out of a paper by a human or extracted by a reader pipeline, and inventing one would manufacture the very comparison this step grounds.',
      },
      B3_PRODUCER,
      'local_computation',
    ),
  }
}

/** C1-mvp: the minimal experiment adjudicating the core prediction. Fixture that
 *  reads the SAME synthetic experiment fixture row the C-gate adjudicates, so the
 *  mvp artifact and the gate evidence are同源 (T19-S business coherence). */
function c1Executor(ctx: ExecCtx): Record<string, unknown> {
  const { claimId, claimRef, predictionText } = canonicalOf(ctx)
  // The experiment is RUN, not looked up: both policies are executed against the
  // study's demand profile and the prediction is adjudicated against the measured
  // reduction. The same call feeds the C gate (verdict.ts), so the artifact and the
  // verdict are the same measurement rather than two tables that might disagree.
  const verdict = evaluatePrediction({
    predictionText,
    metric: planOf(ctx).metric,
    declaredMetricKey: ctx.runCtx.metricKey,
    commitment: ctx.runCtx.commitment,
    measure: () => measureStudy(ctx.runCtx.study),
  })
  if (verdict.kind === 'unbindable') {
    // Fail-closed and symmetric with the C gate: an unbindable claim is not executed against,
    // because there is no measurement that could adjudicate it.
    throw new Error(
      `C1-mvp: the experiment cannot adjudicate this claim — ${verdict.reason} `
      + '(fail-closed: no adjudicable prediction ⇒ no pass)',
    )
  }
  const comparison = comparePlatoons(ctx.runCtx.study)
  // The record every later step measures against. Written by the step that MEASURED, read by the
  // steps that report — see `result-version.ts` for what recomputing beside it cost.
  const resultVersion = resultVersionOf(
    comparison,
    ctx.runCtx.metricKey === '' ? planOf(ctx).metric.key : ctx.runCtx.metricKey,
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
          source: 'platoon-sim (Intelligent Driver Model, three-vehicle platoon)',
          // What this experiment measures and what it does NOT. An artifact that states only
          // "an experiment ran" invites the reader to assume it tested the claim; naming the
          // quantity is what lets them check.
          measures: planOf(ctx).metric.key,
          doesNotMeasure: 'field crash frequency, any external SOTA, or any road layout beyond one lane',
          ruleVersion: EXPERIMENT_RULE_VERSION,
          study: studyEvidence(planOf(ctx), ctx.runCtx.study),
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
          baselineMinTtcSeconds: comparison.baseline.minTtcSeconds,
          variantMinTtcSeconds: comparison.variant.minTtcSeconds,
          improvementPct: verdict.improvementPct,
          thresholdPct: verdict.thresholdPct,
          baselineTtcLt1_5RatePct: comparison.baseline.ttcLt1_5RatePct,
          variantTtcLt1_5RatePct: comparison.variant.ttcLt1_5RatePct,
          meanTimeHeadwaySeconds: comparison.variant.meanTimeHeadwaySeconds,
          meanJerkMps3: comparison.variant.meanJerkMps3,
          stringStabilityIndex: comparison.variant.stringStabilityIndex,
        },
        note: 'mvp-results measured by simulating both platoons under the same declared disturbance; a refuted prediction is recorded as refuted and does not stop the run',
      },
      C1_PRODUCER,
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
      C1_PRODUCER,
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

/**
 * The measured effect of removing each of the AV's two mechanisms, one at a time.
 *
 * The Case Pack names both ablations; this runs them. Each row removes exactly one mechanism
 * and keeps the rest, so the difference against the full variant is attributable to that
 * mechanism. The numbers are measured, and the Case Pack's own mock ablation figures are
 * NOT cited here — they belong to no run.
 *
 * @param study - the study to ablate.
 * @returns one row per declared module, plus the full variant for comparison.
 */
function moduleAblations(study: PlatoonStudy): Record<string, unknown> {
  const full = runPlatoon(study.variant)
  const rows = ABLATION_MODULES.map((moduleRemoved) => {
    const ablated = ablationStudy(study, moduleRemoved)
    const measured = ablated === undefined ? undefined : runPlatoon(ablated.variant)
    return {
      moduleRemoved,
      measured: measured !== undefined,
      minTtcSeconds: measured?.minTtcSeconds ?? null,
      // Positive means removing the module RAISED the safety margin, i.e. the module was
      // costing margin. A reader must be able to see the sign without doing arithmetic.
      changeVsFullVariantSeconds: measured === undefined ? null : measured.minTtcSeconds - full.minTtcSeconds,
      stringStabilityIndex: measured?.stringStabilityIndex ?? null,
    }
  })
  return {
    fullVariantMinTtcSeconds: full.minTtcSeconds,
    rows,
    note: 'each row removes ONE mechanism from the variant platoon and re-simulates; the baseline platoon is untouched by an ablation',
  }
}

/**
 * The scope test the Case Pack's boundary file states, measured rather than quoted.
 *
 * The pack asserts that the claim is limited to steady free flow and that stop-and-go breaks
 * it. That is a falsifiable statement about the study, so it is checked by re-running the
 * variant under stop-and-go forcing and comparing the two margins. The result is whatever it
 * is, and the artifact reports both numbers and the ratio so a reader can see the arithmetic.
 *
 * @param study - the study whose variant is re-run.
 * @returns the free-flow and stop-and-go margins, their ratio, and whether the scope binds.
 */
function boundaryProbe(study: PlatoonStudy): Record<string, unknown> {
  const probe = boundaryTest(study)
  return {
    freeFlowMinTtcSeconds: probe.freeFlow.minTtcSeconds,
    stopAndGoMinTtcSeconds: probe.stopAndGo.minTtcSeconds,
    marginRatio: probe.marginRatio,
    scopeLimited: probe.scopeLimited,
    rule: `scope is limited to steady free flow when the stop-and-go margin falls below ${SIMULATION_INPUTS.boundaryMarginRatio.toFixed(2)}x the free-flow margin`,
    note: 'both margins are MEASURED by the same simulator under two declared forcings; the ratio is arithmetic on them and neither number is quoted from the pack',
  }
}

/**
 * The C3-boundary ablation definition: the mixed platoon vs the homogeneous one, over the
 * quantity the run's claim is about, 4 repetitions (real tool over a deterministic executor).
 *
 * @param metric - the quantity the claim is about. The ablation tool validates the direction
 *   against its own closed set, so the plan's direction is converted rather than restated.
 * @returns the definition the ablation tool is invoked with.
 */
function ablationDefinition(metric: MeasuredMetric): AblationDefinition {
  return {
    baselineIdentity: SCENARIO.baselineIdentity,
    variantIdentity: SCENARIO.variantIdentity,
    removedOrReplacedComponents: [
      { component: 'platoon-composition', action: 'replaced', replacement: SCENARIO.variantIdentity },
    ],
    dataset: { version: 'case-pack-traffic.v2', split: 'declared-scenario', seed: 20260909 },
    metric: { name: metric.key, direction: ablationDirectionOf(metric) },
    repetitions: 4,
  }
}

/**
 * The ablation's execution seam, implemented for real.
 *
 * Both arms are MEASURED by simulating the two platoons: the baseline arm is the homogeneous
 * platoon, the variant arm the mixed one. The measurement is therefore the same car-following
 * model the C channel adjudicates against, so a boundary claim and an experiment claim come
 * from one source rather than two.
 *
 * @param study - the study whose two platoons the arms run.
 * @returns an executor that runs both arms for every declared repetition.
 */
function platoonAblationExecutor(study: PlatoonStudy): AblationExecutor {
  return {
    execute(request: AblationRunRequest): ReadonlyArray<AblationRunResult> {
      const results: AblationRunResult[] = []
      for (let repetition = 0; repetition < request.definition.repetitions; repetition++) {
        for (const arm of ABLATION_VARIANT_KINDS) {
          const measured = arm === 'baseline'
            ? runPlatoon(study.baseline)
            : runPlatoon(study.variant)
          results.push({
            runKey: ablationRunKey(arm, repetition),
            status: 'executed',
            measurement: measured.minTtcSeconds,
          })
        }
      }
      return results
    },
  }
}

/** C3-boundary: real `runAblation` — boundary probing (variant vs baseline).
 *  Ablation lives HERE (canonical C3), not in B3-baseline (T19-S fix). */
async function c3Executor(ctx: ExecCtx): Promise<Record<string, unknown>> {
  const verdict = readInput(ctx, 'converged-verdict')
  const definition = ablationDefinition(planOf(ctx).metric)
  const invoker = ctx.invoker ?? new DirectResearchToolInvoker('c3-fixture')
  const invocation = await invoker.invoke(
    'ablation',
    { definition },
    { timestamp: FIXED_TS, deps: { ablationExecutor: platoonAblationExecutor(ctx.runCtx.study) } },
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
        // The scope test the Case Pack's boundary file states, MEASURED here rather than
        // quoted from it: the variant is re-run under stop-and-go forcing and its margin is
        // compared with the free-flow one.
        boundary: boundaryProbe(ctx.runCtx.study),
        // What each of the AV's two declared mechanisms is worth, measured one at a time.
        moduleAblations: moduleAblations(ctx.runCtx.study),
        note: 'ablation-results produced by a REAL runAblation execution whose arms were MEASURED by the platoon simulation (homogeneous vs mixed platoon) — boundary probing belongs to C3, not B3',
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
        study: studyEvidence(planOf(ctx), ctx.runCtx.study),
        boundary: boundaryProbe(ctx.runCtx.study),
        note: 'boundary-map derived from the REAL runAblation execution over simulated platoons, plus the measured stop-and-go scope test — an applicability claim for this declared scenario only, not a general one',
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
  /** The rendered SVG, for a data figure. */
  readonly svg?: unknown
  /** The PNG bytes, base64, when the producing tool emitted a raster of the same canvas. */
  readonly pngBase64?: unknown
  /** The rendered diagram source, for a roadmap. */
  readonly content?: unknown
  /** The diagram format, for a roadmap. */
  readonly format?: unknown
  /** The tool's own rendering, for a table. */
  readonly tableMarkdown?: unknown
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
function d1RecordsOf(
  ctx: ExecCtx,
  measured: { readonly baselineSeconds: number; readonly variantSeconds: number },
): ReadonlyMap<string, Record<string, unknown>> {
  const result = readInput(ctx, RESULT_VERSION_SLUG)
  if (result !== undefined) return new Map([[RESULT_VERSION_SLUG, result]])
  // A STEP DRIVEN ALONE MEASURED THE STUDY ITSELF (see `result-version.ts`), and the figure's values
  // are that measurement. The plan names `recomputed-measurement` as its source in that case, so the
  // plan and the reconciliation agree about where the numbers came from instead of the check being
  // skipped — and the difference is visible on the artifact rather than hidden in the control flow.
  return new Map([['recomputed-measurement', {
    measured: {
      baseline: measured.baselineSeconds,
      variant: measured.variantSeconds,
    },
  }]])
}

/** The record a figure's values come from, named the way the run can account for them. */
function d1SourceSlugOf(ctx: ExecCtx): string {
  return readInput(ctx, RESULT_VERSION_SLUG) === undefined ? 'recomputed-measurement' : RESULT_VERSION_SLUG
}

async function d1Executor(ctx: ExecCtx): Promise<Record<string, unknown>> {
  const invoker = ctx.invoker ?? new DirectResearchToolInvoker('d1-fixture')
  // The figures plot the SAME measurements the experiment produced, so a chart can
  // never disagree with the verdict it illustrates. "The same" is now a record the run
  // holds, not a re-measurement: see `result-version.ts`.
  const outcome = measureOutcomeWithSource(ctx)
  const measuredBaseline = outcome.measured.baseline
  const measuredVariant = outcome.measured.variant
  // The caption says what the measurement did to the claim, derived the same way the argument plan
  // derives it — a figure of a refuted claim and a figure of a supported one do not have the same
  // caption, and the caption is what a reader who skips the text reads.
  const d1Commitment = ctx.runCtx.commitment
  const d1Outcome = claimOutcomeOf(
    outcome.measured.improvementPct,
    d1Commitment?.direction ?? 'increase',
    d1Commitment?.thresholdPct,
  )
  // THE FIGURE IS PLANNED BEFORE IT IS DRAWN. The plan states the question this figure answers, the
  // record its values come from, its axes and units, its uncertainty and its size; the renderer is
  // handed that spec, so the chart and the reason for it are one object. Before this, the size, the
  // title and the single series were fixed here, and nothing said what the chart was FOR — which is
  // how the delivered paper came to carry floats no sentence refers to.
  const presentationPlan = shippedPresentationPlan({
    sourceSlug: d1SourceSlugOf(ctx),
    // THE RECORD'S OWN KEYS, which are the metric's two arms rather than the shipped study's field
    // names: the figure reconciliation refused these values until they were named the way the record
    // holds them, and that refusal is what a stale key looks like.
    baselineKey: 'measured.baseline',
    variantKey: 'measured.variant',
    baselineSeconds: measuredBaseline,
    variantSeconds: measuredVariant,
    metricUnit: planOf(ctx).metric.unit,
    outcome: d1Outcome,
  })
  // EVERY VALUE A FIGURE PLOTS IS RECONCILED WITH THE RUN'S OWN RECORDS BEFORE ANYTHING IS DRAWN.
  // A figure that cannot be sourced from what the study measured is refused here rather than drawn
  // from a literal.
  const presentationRefusals = checkPresentationPlan(
    presentationPlan,
    d1RecordsOf(ctx, { baselineSeconds: measuredBaseline, variantSeconds: measuredVariant }),
  )
  if (presentationRefusals.length > 0) {
    throw new Error(
      '[D1-figure-map] the figure plan cannot be answered from this run: '
      + presentationRefusals.map(refusal => `[${refusal.code}] ${refusal.detail}`).join('; '),
    )
  }
  const planned = presentationPlan.figures[0] as PlannedFigure
  const figureSpec = {
    kind: 'bar',
    title: planned.caption.length > 0 ? planned.answers : 'Figure',
    width: planned.size.width,
    height: planned.size.height,
    series: planned.series.map(series => ({
      name: series.name,
      values: series.points.map(point => point.value),
    })),
    tokens: { palette: ['#1f77b4'] },
    seed: 7,
  }
  const tableModel = {
    title: 'Platoon Minimum Time-to-Collision Comparison',
    columns: [
      { header: 'Method', decimals: 0 },
      { header: 'Minimum TTC (s)', decimals: 2, metricDirection: 'higher-is-better' },
    ],
    rows: [
      [
        { kind: 'text', text: 'HV-AV-HV' },
        { kind: 'number', value: measuredVariant },
      ],
      [
        { kind: 'text', text: 'HV-HV-HV' },
        { kind: 'number', value: measuredBaseline },
      ],
    ],
  }
  const roadmapGraph: RoadmapGraph = {
    nodes: [
      { id: 'baseline-input', label: 'Homogeneous platoon (HV-HV-HV)', kind: 'input' },
      { id: 'adaptive-policy', label: 'Mixed platoon (HV-AV-HV)', kind: 'process' },
      { id: 'delay-experiment', label: 'Platoon experiment (C1)', kind: 'gate' },
      { id: 'reduction-outcome', label: `Minimum TTC change ${thresholdLabel(ctx.runCtx.commitment)}`, kind: 'output' },
    ],
    edges: [
      { from: 'baseline-input', to: 'delay-experiment', label: 'baseline' },
      { from: 'adaptive-policy', to: 'delay-experiment', label: 'variant' },
      { from: 'delay-experiment', to: 'reduction-outcome', label: 'verdict' },
    ],
  }
  const base = { timestamp: FIXED_TS }
  const [figureInv, tableInv, roadmapInv] = await Promise.all([
    invoker.invoke('figure', figureSpec, base),
    invoker.invoke('three-line-table', { model: tableModel, target: 'markdown' }, base),
    invoker.invoke('roadmap', { graph: roadmapGraph, options: { format: 'mermaid', title: 'Adaptive Control Research Roadmap' } }, base),
  ])
  if (!figureInv.ok) throw new Error(`[D1-figure-map] figure invocation failed: ${figureInv.message}`)
  if (!tableInv.ok) throw new Error(`[D1-figure-map] three-line-table invocation failed: ${tableInv.message}`)
  if (!roadmapInv.ok) throw new Error(`[D1-figure-map] roadmap invocation failed: ${roadmapInv.message}`)
  const figure = figureInv.artifact as ReturnType<typeof renderFigure>
  const table = tableInv.artifact as ReturnType<typeof renderThreeLineTable>
  const roadmap = roadmapInv.artifact as ReturnType<typeof renderRoadmap>
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
      svg: figure.svg.content,
      // THE RASTER THE SAME TOOL PRODUCED FROM THE SAME SPEC. HTML embeds the SVG; LaTeX has no SVG
      // support and embeds this. Without it a document compiled to LaTeX or PDF would carry a figure
      // the reader cannot see, which is the loss the compile now refuses rather than reports.
      pngBase64: figure.png.base64,
    },
    {
      kind: 'three-line-table',
      title: tableModel.title,
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
        presentationPlan,
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
  // statements cite, not what the search returned. The bindings below are this claim version's
  // reviewed sources with the passage that was read; the reference list and the citation roster the
  // writer is handed both come from them, so the two cannot name different sources.
  const citations = citationUsesOf({ claimRef, statementId: STATEMENT_LITERATURE_POSITION })
  // A BINDING IS CHECKED WHERE IT IS MADE, before any of it reaches the draft: an empty passage, a
  // judgement stronger than what was read, or a source the retrieval does not hold is refused here.
  for (const citation of citations) {
    const refusals = checkCitationUse(citation, reviewedSources().get(citation.literatureRef))
    if (refusals.length > 0) {
      throw new Error(
        `[D3-writing] ${refusals.map(refusal => `[${refusal.code}] ${refusal.detail}`).join('; ')}`,
      )
    }
  }
  const duplicateKeys = checkCitationKeys(citations)
  if (duplicateKeys.length > 0) {
    throw new Error(`[D3-writing] ${duplicateKeys.map(refusal => refusal.detail).join('; ')}`)
  }
  const references = referenceEntriesFor(citations)
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
  const citable = citableFloats(planFloats(renderedFigures), MODEL_EQUATIONS)
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
  if (writer === undefined) {
    const measured = d3Outcome.measured
    sections = headings.map((h) => {
      const evidence = evidenceFor(h.id)
      return evidence.missing.length > 0
        ? { ...h, bodyText: '' }
        : { ...h, bodyText: bodyTextFor(h.id, planOf(ctx), measured, citations, argumentPlan, citable) }
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
        return writer.write({
          stepId: 'D3-writing',
          instruction: `Write the "${h.heading}" section of a research paper. Its job in this paper's argument is: ${contractFor(h.id)?.job ?? 'undefined'}. ${obligationsInstructionOf(argumentPlan, h.id)}Refer to the central claim as ${claimRef}. Return prose only — no heading, no commentary. The numbered items this paper may refer to are listed in the context under \`citable\`; refer to one by its exact label when the section is about it. The evidence this section must be written from is under \`evidence\`: state only what it holds, and do not introduce a number, a unit or a source it does not contain. When a sentence rests on a reviewed source listed under \`citations\`, name that source by writing its \`citeKey\` in square brackets exactly as \`[@citeKey]\`; every source listed there and no other may be cited, and every one of them must be cited somewhere in this manuscript.`,
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
            citations: citations.map(citation => ({
              citeKey: citation.citeKey,
              establishes: citation.support,
              readScope: citation.readScope,
              source: citation.location,
            })),
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
  const sectionEvidence = headings.map(h => evidenceFor(h.id))
  const refused = sectionEvidence.filter(entry => entry.missing.length > 0)

  return {
    draft: tagArtifact(
      {
        fixture: proseSource === 'fixture',
        stepId: 'D3-writing',
        slug: 'draft',
        title: planOf(ctx).title,
        claimRef,
        sections,
        proseSource,
        proseRoute,
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
        // WHAT THIS PAPER CITES, with the passage each citation was read from. The reference list
        // below is derived from these, so a reader of the draft can check that every entry rests on a
        // sentence and every sentence on a passage somebody read.
        citations,
        references,
        // THE PLAN THIS DRAFT WAS WRITTEN UNDER, with its version, so the log can rebuild what each
        // section was asked for and which argument the run had when it wrote them.
        argumentPlan,
        renderedFigures,
        note: proseSource === 'fixture'
          ? 'synthetic manuscript draft — sections mirror the D2 outline ids; no drafting model call in this wave'
          : 'manuscript draft whose section bodies came from a real model call',
      },
      producer,
      proseKindOf(proseSource),
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
  const draft = readInput(ctx, 'draft')
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
  let applied = applyRevision(sections, [])
  // HOW MANY ROUNDS THIS TOOK, AND WHY IT STOPPED. One round is not a revision cycle: a concern the
  // applier refused — written against another version, changing nothing, or conflicting with another
  // patch — used to end there, with the round number hard-coded to 1 and nothing to try again.
  // `revisionRounds` bounds how many times the author may be asked; the cycle stops early when
  // another round could not change anything.
  let stoppedBecause: 'closed' | 'no-progress' | 'budget' = 'closed'
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
  const recordRound = (
    round: number,
    result: ReturnType<typeof applyRevision>,
    stopped: 'closed' | 'no-progress' | 'budget',
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
    stoppedBecause: stopped,
  })
  if (writer === undefined) {
    const resultsBody = bodiesShown.get('results') ?? ''
    points = [
      {
        concern: `Is the ${measured.improvementPct.toFixed(2)}% minimum-TTC change robust at the boundary?`,
        response: 'Boundary probing at C3 re-runs the same simulation under stop-and-go forcing and reports the measured margin ratio, which delimits the applicability domain.',
        requiresRevision: false,
      },
      {
        concern: 'Are the SOTA anchors real?',
        response: 'No published-SOTA row is recorded: a minimum-TTC figure must be read out of a paper, so the comparison is against this study\'s own measured baseline and says so.',
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
        // no number, which is what keeps it past the A gate's number check.
        patch: `${resultsBody} No published-SOTA row is recorded: a minimum time-to-collision figure has to be read out of a paper, so the comparison is against this study's own measured baseline and says so.`,
      },
    ]
    applied = applyRevision(
      sections,
      issues.map(issue => ({ ...issue, basisHash: bodyHashOf(bodiesShown.get(issue.sectionId) ?? '') })),
    )
    // The fixture path writes its issues once; one round IS its whole cycle, and it is recorded as
    // one rather than pretending a model was asked again.
    stoppedBecause = applied.openIssues.length === 0 ? 'closed' : 'budget'
    rounds.push(recordRound(1, applied, stoppedBecause))
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

      // The basis each patch is written against is THIS round's body, not the draft's.
      const currentBodies = new Map(current.map(section => [section.id, section.bodyText]))
      applied = applyRevision(
        current,
        issues.map(issue => ({ ...issue, basisHash: bodyHashOf(currentBodies.get(issue.sectionId) ?? '') })),
      )
      // NO PROGRESS IS MEASURED BY SECTION, NOT BY ISSUE ID. A round numbers its issues from one, so
      // `d4-issue-1` names a different concern in every round — comparing ids would call two rounds
      // that failed on the SAME sections "progress" and spend the budget re-asking. What repeated
      // means is that the manuscript is no better off: the same sections are still open.
      const leftOpen = applied.outcomes
        .filter(outcome => outcome.disposition === 'open')
        .map(outcome => outcome.sectionId)
      const repeated = leftOpen.length > 0
        && leftOpen.length === open.length
        && leftOpen.every(sectionId => open.includes(sectionId))
      stoppedBecause = leftOpen.length === 0 ? 'closed' : repeated ? 'no-progress' : 'budget'
      rounds.push(recordRound(round, applied, stoppedBecause))
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
        // THE CYCLE'S OWN RECORD, so a reader can see whether the author was asked once or as many
        // times as the configuration allows, and whether the last round stopped because it closed
        // everything or because asking again could not change anything.
        rounds,
        revisionRounds: revisionRoundsOf(ctx),
        stoppedBecause,
        note: rebuttalSource === 'fixture'
          ? 'exchanges written from this study\'s own design questions, with measured numbers'
          : 'exchanges written by the model from the measured outcome',
      },
      D4_PRODUCER,
      proseKindOf(rebuttalSource),
    ),
    'revised-draft': tagArtifact(
      {
        fixture: true,
        stepId: 'D4-rebuttal',
        slug: 'revised-draft',
        title: planOf(ctx).title,
        claimRef,
        sections: revised,
        // The same per-section fact on the draft, so a reader of the manuscript alone can tell a
        // section a patch changed from one it did not.
        patchedSections: applied.patchedSections,
        openIssues: applied.openIssues,
        citations,
        references,
        ...(argumentPlan === undefined ? {} : { argumentPlan }),
        renderedFigures,
        resultSource: d4Outcome.source,
        resultRef: d4Outcome.contentHash,
        note: 'revised draft — same section ids as the D3 draft, with `revised` set only on the sections a patch actually changed',
      },
      D4_PRODUCER,
      'fixture_executor',
    ),
  }
}

/** E1-format: ASSEMBLES the formatted manuscript + reproducible package from the
 *  revised draft + venue scope. three-line-table is the REAL table sub-capability
 *  inside the assembly — E1 is the format STEP, not the table tool (T19-S fix). */
async function e1Executor(ctx: ExecCtx): Promise<Record<string, unknown>> {
  const venue = readInput(ctx, 'venue')
  const venueScope = readInput(ctx, 'venue-scope')
  const revised = readInput(ctx, 'revised-draft')
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

  // Real three-line-table sub-capability: the manuscript results table, built from
  // the SAME measurements the experiment produced — read off the run's record, so the
  // table and the prose cannot come from two different computations.
  const e1Outcome = measureOutcomeWithSource(ctx)
  const measuredBaseline = e1Outcome.measured.baseline
  const measuredVariant = e1Outcome.measured.variant
  const invoker = ctx.invoker ?? new DirectResearchToolInvoker('e1-fixture')
  const invocation = await invoker.invoke(
    'three-line-table',
    {
      model: {
        title: 'Platoon Minimum Time-to-Collision Comparison',
        columns: [
          { header: 'Method', decimals: 0 },
          { header: 'Minimum TTC (s)', decimals: 2, metricDirection: 'higher-is-better' },
        ],
        rows: [
          [
            { kind: 'text', text: 'HV-AV-HV' },
            { kind: 'number', value: measuredVariant },
          ],
          [
            { kind: 'text', text: 'HV-HV-HV' },
            { kind: 'number', value: measuredBaseline },
          ],
        ],
      },
      target: 'markdown',
    },
    { timestamp: FIXED_TS },
  )
  if (!invocation.ok) {
    throw new Error(`[E1-format] three-line-table invocation failed: ${invocation.message}`)
  }
  const artifact = invocation.artifact as ReturnType<typeof renderThreeLineTable>

  const scopeLine = scopeMatches.length > 0 ? `Scope match: ${scopeMatches.join('; ')}.` : ''
  // The references come from the draft, which built them from the retrieved
  // records. This line used to pass a literal empty array, so every assembled
  // manuscript reported zero references while its own references section described
  // a landscape scan — the document contradicted itself.
  const rawRefs = (revised?.references as ReadonlyArray<unknown> | undefined) ?? []
  // Built from the FIELDS, not by joining whatever happened to be present. The previous version
  // omitted an absent field silently: a record with no authors began with its title, which reads as
  // a complete citation, and a record with no venue ran two sentences together. `formatReference`
  // states what is missing instead, and `numberedReferences` at the assembler gives each entry the
  // number an in-text marker uses — the SAME number, because the key mapping below is built from the
  // same array in the same order.
  const referenceEntries = rawRefs.map((raw) => {
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
  // are the module's own computation (see MODEL_EQUATIONS), not decoration, and the section is
  // extended rather than replaced so the prose the draft wrote stays where it is.
  const equations = equationBlock(MODEL_EQUATIONS)
  const withEquations = citedSections.map(section =>
    section.id === 'method' && equations.length > 0
      ? { ...section, bodyText: `${section.bodyText}\n\n${equations}` }
      : section)
  const sectionsForAssembly = referenceEntries.length > 0
    ? withEquations.filter(section => section.id !== 'references')
    : withEquations
  // The manuscript carries the figures D1 actually rendered: the data figure as the
  // svg it produced, the roadmap as the mermaid block it produced, then the results
  // table. Until this, the Figures section held the table alone and the rendered
  // figure and roadmap were emitted as artifacts the paper never mentioned.
  const rendered = Array.isArray(revised?.renderedFigures)
    ? (revised.renderedFigures as ReadonlyArray<FigurePlanEntry>)
    : []
  const figureBlocks: string[] = []
  // Kept separately as well as inline: the package writes each part as its own file with its
  // own source, so the figure's provenance never stands in for the table's or the roadmap's.
  let figureSvg = ''
  // The raster the figure tool produced for the same spec, carried so a LaTeX or PDF document can
  // embed the figure rather than drop it.
  let figurePngBase64 = ''
  let roadmapMermaid = ''
  // NUMBERED, CAPTIONED, AND LINKED — the paper shapes. Before this the data figure was pushed as
  // raw inline SVG with no number and no caption, and the roadmap as an unlabelled mermaid block, so
  // nothing in the prose could refer to either. A figure is a file or an inline diagram, never both;
  // `figureBlock` refuses the other cases rather than rendering a broken image.
  //
  // THE NUMBER AND THE CAPTION COME FROM THE PLAN, not from a counter here: D1 assigned them when it
  // decided which floats exist and D3 offered the same labels to the prose channel, so a caption
  // reading `Figure 1` and a sentence citing `Figure 1` cannot name different things.
  const floats = planFloats(rendered)
  // Floats the plan declares that this manuscript will not carry, named rather than passed over: a
  // reader comparing the plan with the paper would otherwise find a figure with no explanation.
  const floatsNotRendered: string[] = []
  // What the manuscript really holds, for the cross-reference report below.
  const renderedFloats: CitableFloat[] = []
  for (const entry of floats) {
    if (entry.kind === 'data-figure' && typeof entry.svg === 'string') {
      figureSvg = entry.svg
      if (typeof entry.pngBase64 === 'string') figurePngBase64 = entry.pngBase64
      figureBlocks.push(figureBlock({
        label: entry.label,
        title: entry.title,
        path: 'figures/figure-1.svg',
        note: 'Rendered by the figure tool from the measurements this run produced.',
      }))
      renderedFloats.push({ label: entry.label, title: entry.title })
      continue
    }
    if (entry.kind === 'roadmap' && typeof entry.content === 'string' && entry.format === 'mermaid') {
      roadmapMermaid = entry.content.trim()
      figureBlocks.push(figureBlock({
        label: entry.label,
        title: entry.title,
        mermaid: roadmapMermaid,
      }))
      renderedFloats.push({ label: entry.label, title: entry.title })
      continue
    }
    // The table is laid out after this loop, from the structured model the tool returned rather than
    // from the plan's rendered text, so it is not a miss here.
    if (entry.kind === 'three-line-table') continue
    floatsNotRendered.push(entry.label)
  }
  // THE TABLE, AS A TABLE. The tool's own "markdown" rendering draws box-drawing rules, which a
  // Markdown reader shows as a code block; a paper needs a pipe table. Built from the structured
  // model the tool returned, not by re-parsing its text.
  const tableModel = artifact.table
  const tableHeader = tableModel.columns.map(
    column => column.unit === undefined ? column.header : `${column.header} (${column.unit})`,
  )
  const tableRows = tableModel.rows.map((row) => {
    const cells: string[] = []
    row.forEach((cell, index) => {
      const column = tableModel.columns[Math.min(index, tableModel.columns.length - 1)]
      if (column === undefined) return
      const renderedCell = threeLineTableCellText(cell, column, THREE_LINE_TABLE_DEFAULT_MISSING_TOKEN)
      cells.push(renderedCell)
      // A pipe table cannot merge cells, so a colSpan cell is followed by empty cells to keep every
      // row the same width — `markdownPipeTable` refuses a row that disagrees with its header.
      for (let extra = 1; extra < (cell.colSpan ?? 1); extra += 1) cells.push('')
    })
    return cells
  })
  const tableMarkdown = tableHeader.length > 0 && tableRows.every(row => row.length === tableHeader.length)
    ? markdownPipeTable(tableHeader, tableRows)
    : undefined
  // The plan is where this step learns what the table it renders is called, so a plan that declares
  // no table means the two disagree about what the manuscript holds — reported rather than papered
  // over with a number this step made up.
  const plannedTable = floats.find(entry => entry.kind === 'three-line-table')
  if (plannedTable === undefined) {
    throw new Error(
      '[E1-format] the figure-plan declares no three-line-table, so the results table this step '
      + 'renders would carry a number no plan assigned',
    )
  }
  if (tableMarkdown === undefined) {
    // A table whose rows do not cover its columns is one this renderer cannot lay out, so the tool's
    // own rendering is used. Stated here rather than passed over, because the reader would otherwise
    // see a code block where the paper should have a table.
    figureBlocks.push(artifact.render.text)
    floatsNotRendered.push(plannedTable.label)
  } else {
    figureBlocks.push(tableBlock({
      label: plannedTable.label,
      title: plannedTable.title.length === 0 ? 'Measured results' : plannedTable.title,
      markdown: tableMarkdown,
      note: 'Measured by simulating both platoons under the same declared disturbance.',
    }))
    renderedFloats.push({ label: plannedTable.label, title: plannedTable.title })
  }
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
    citableFloats(renderedFloats, MODEL_EQUATIONS),
  )
  // The package's OWN files, as CONTENT. E1 produces these; the run exporter adds the
  // run-level files (summary, step record, claim-evidence, citations, experiment,
  // reproducibility, manifest) and writes the whole set to disk. A path whose upstream step
  // did not run has no content and is OMITTED, never declared empty — the earlier version of
  // this artifact listed five filenames no step wrote, which read as run output.
  // THE DOCUMENT, AND THE COMPILE CHAIN. The parts this step assembled are handed to a compiler as a
  // DOCUMENT — sections with their blocks, floats with their labels, equations as display mathematics,
  // references keyed the way the prose cites them — so a backend renders the document rather than
  // re-parsing the assembled Markdown. The compile is a seam the deployment fills: this package spawns
  // nothing, and a deployment that configured no compiler records that fact instead of failing a run
  // that still holds a complete Markdown manuscript.
  const document = documentOf({
    title,
    sections: sections.map(section => ({
      id: section.id,
      heading: section.heading,
      bodyText: section.bodyText,
    })),
    floats: [
      ...(figureSvg.length > 0
        ? [{
          kind: 'figure' as const,
          label: floats.find(entry => entry.kind === 'data-figure')?.label ?? 'Figure 1',
          caption: floats.find(entry => entry.kind === 'data-figure')?.title ?? '',
          svg: figureSvg,
          ...(figurePngBase64 === '' ? {} : { pngBase64: figurePngBase64 }),
        }]
        : []),
      ...(tableMarkdown === undefined
        ? []
        : [{
          kind: 'table' as const,
          label: plannedTable.label,
          caption: plannedTable.title,
          markdown: tableMarkdown,
        }]),
      ...(roadmapMermaid.length === 0
        ? []
        : [{
          kind: 'diagram' as const,
          label: floats.find(entry => entry.kind === 'roadmap')?.label ?? 'Figure 2',
          caption: floats.find(entry => entry.kind === 'roadmap')?.title ?? '',
          mermaid: roadmapMermaid,
        }]),
    ],
    equations: MODEL_EQUATIONS.map(equation => ({ label: equation.name, latex: equation.latex })),
    references: referenceEntries.flatMap((entry, index) =>
      entry.citeKey === undefined
        ? []
        : [{ citeKey: entry.citeKey, entry: entry.formatted, number: index + 1 }]),
  })
  const compiled: Array<{ readonly path: string; readonly content: string; readonly encoding?: 'utf8' | 'base64' }> = []
  const compileRefusals: string[] = []
  // WHICH FLOATS THE COMPILED DOCUMENT ACTUALLY CARRIES, per format: a figure that could not be
  // embedded is a figure the reader will not see, and the artifact says so rather than leaving it to
  // be inferred from the presence of a file.
  const embeddedFloats: Record<string, ReadonlyArray<string>> = {}
  const droppedFloats: Array<{ readonly label: string; readonly reason: string; readonly format: string }> = []
  for (const format of ['html', 'latex'] as const) {
    // A DRAFT, at this point in the run: the manuscript this step assembles has not been approved, so
    // what it compiles is a working document. A float that cannot be embedded is recorded here and
    // REFUSED when a submission-grade compile is asked for at export time.
    const result = await compileManuscript({ document, format, mode: 'draft' }, ctx.documentCompiler)
    if (result.ok) {
      compiled.push({
        path: result.compiled.fileName,
        content: result.compiled.content,
        encoding: result.compiled.encoding,
      })
      // THE ASSETS THE DOCUMENT EMBEDS travel beside it, as bytes, so the compiled file is buildable
      // outside this run and the figures can be reconciled by their labels rather than by a count.
      for (const asset of result.compiled.files) {
        compiled.push({ path: asset.path, content: asset.base64, encoding: 'base64' })
      }
      embeddedFloats[format] = result.compiled.assets.embedded
      droppedFloats.push(...result.compiled.assets.dropped.map(entry => ({ ...entry, format })))
      continue
    }
    // NOT A FAILED STEP: the manuscript this run produced is complete without a compiled form, and a
    // deployment without a compiler is a fact about the deployment. It is recorded, with the reason,
    // so a reader of the package can tell "not compiled" from "compiled badly".
    compileRefusals.push(...result.refusals.map(refusal => `[${refusal.code}] ${refusal.detail}`))
  }
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
      source: 'assembleManuscript(revised-draft + venue scope + references)',
    },
    'experiment-tables.md': {
      content: artifact.render.text,
      source: `${THREE_LINE_TABLE_TOOL_ID}@${THREE_LINE_TABLE_TOOL_VERSION}`,
    },
    'figures/figure-1.svg': {
      content: figureSvg,
      source: `${FIGURE_TOOL_ID}@${FIGURE_TOOL_VERSION}`,
    },
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
    'formatted-manuscript': tagArtifact(
      {
        title,
        // WHAT RENDERED IT, AND WHAT COULD NOT. A package that named only `manuscript.html` would
        // leave a reader unable to tell a compiled document from a copy of the Markdown — and a run
        // that could not compile says so here rather than by the absence of a file.
        compilation: {
          tool: ctx.documentCompiler?.tool ?? null,
          formats: ctx.documentCompiler?.formats ?? [],
          compiled: compiled.map(file => file.path),
          // THE ASSETS, AS BYTES. A figure the compiled document embeds is not text, and a package
          // that carried it as base64 text would ship a file that looks written and is not the asset.
          assets: compiled
            .filter(file => file.encoding === 'base64')
            .map(file => ({ path: file.path, base64: file.content })),
          // WHAT IS IN THE COMPILED DOCUMENT AND WHAT IS NOT. A float that could not be embedded is
          // named with its reason; a submission-grade compile refuses when this list is not empty.
          floatsEmbedded: embeddedFloats,
          floatsDropped: droppedFloats,
          refusals: compileRefusals,
        },
        venueName,
        venueId,
        venueStyle: `${venueName} template`,
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
        tableMarkdown: artifact.render.text,
        bindingHash: artifact.bindingHash,
        // The package's OWN files, as CONTENT. E1 produces exactly these four; the run
        // exporter adds the run-level files (summary, step record, claim-evidence,
        // citations, experiment, reproducibility, manifest) and writes the whole set to
        // disk. A file appears here only when its content is really produced below — the
        // earlier version of this field listed five filenames that no step wrote, which
        // read as run output beside a produced manuscript.
        packageFiles: pkg.files,
        packageSources: pkg.sources,
        note: 'formatted-manuscript ASSEMBLED by the E1-format executor from the revised draft + venue scope; the results table is rendered by the REAL renderThreeLineTable sub-capability — the tool is E1\'s table capability, not the format step itself',
      },
      E1_PRODUCER,
      'real_tool_fixture_input',
      { provenance: invocation.provenance, invokerTruthfulness: invocation.truthfulness },
    ),
  }
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

/** E2-submit runs no executor at all (human gate stop). */
function noExecutor(): Record<string, unknown> {
  throw new Error('T19B registry: E2-submit has no executor — it stops at the human gate')
}

// ── Registry (16-step map) ──────────────────────────────────────────────────────
// `kind` reflects the EXECUTOR truthfulness. A step whose GATE uses the real
// trinity adjudication but whose executor is a fixture (e.g. C2) is still
// `fixture_executor` here; its gate channel truthfulness is declared separately
// in VERDICT_CHANNELS (and implemented in verdict.ts).

interface EntrySpec {
  readonly stepId: string
  /** See {@link StepExecutorEntry.kind}: `'humanGate'` for the step no executor runs. */
  readonly kind: Truthfulness | 'humanGate'
  readonly basis: string
  readonly producer: string
  readonly timeoutMs: number
  readonly recoveryPolicy: RecoveryPolicy
  readonly executor: StepExecutorFn
  readonly humanGateStop?: boolean
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
    basis: 'the baseline is MEASURED: the homogeneous platoon is simulated under the study\'s declared scenario (see C1-mvp for the full study declaration) and its minimum time-to-collision is the reference row. Ablation is NOT a baseline capability and was moved to C3-boundary. The SOTA comparison still records NO published-SOTA row, because a published minimum-TTC figure has to be read out of a paper by a human or a reader pipeline — recording one here would manufacture the comparison this step exists to ground',
    producer: B3_PRODUCER,
    timeoutMs: FIXTURE_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: b3Executor,
  },
  {
    stepId: 'C1-mvp',
    kind: 'local_computation',
    basis: 'the platoon-sim experiment engine RUNS both platoons under the study\'s declared scenario (composition, vehicle parameters and disturbance all recorded on the artifact) and measures each one\'s minimum time-to-collision. No model was called and no measured dataset stands behind the numbers, so this is "the experiment really ran on the declared scenario", not "the claim is proven"',
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
    kind: 'fixture_executor',
    basis: 'no drafting tool exists (no model call in this wave); the executor emits a deterministic synthetic draft whose section ids mirror the D2 outline',
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
    kind: 'real_tool_fixture_input',
    basis: 'T19-S: E1 is the format STEP — the executor ASSEMBLES the formatted manuscript + reproducible package from the revised draft and venue scope; the REAL renderThreeLineTable sub-capability renders the results tables inside the assembly (a tool is a capability, never the step itself)',
    producer: E1_PRODUCER,
    timeoutMs: REAL_TOOL_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: e1Executor,
  },
  {
    stepId: 'E2-submit',
    kind: 'humanGate',
    basis: 'NO executor runs and NO artifact is produced: submission is a human act. The step reaches `gated` via completeStep (empty machine gate + humanGate) and is never auto-approved',
    producer: 'human-gate:E2-submit',
    timeoutMs: 0,
    recoveryPolicy: 'human_approval_only',
    executor: noExecutor,
    humanGateStop: true,
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
      ...(spec.humanGateStop === true ? { humanGateStop: true } : {}),
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
 *    `live` experiment report MEASURED by platoon-sim over the study's declared scenario
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
    // The experiment RUNS (platoon-sim simulates both platoons over the declared
    // demand profile; the report carries source 'live' and grades 'locally-measured' — which
    // names the channel, not a level of verification).
    // Its INPUT — the claim and its prediction — is fixture-supplied on the default
    // path, which is what keeps this short of `live_external`.
    basis: 'team adjudicateClaimSupport → core adjudicate(`C`) executes for real over an experiment MEASURED by platoon-sim: both platoons are simulated under the Case Pack\'s declared scenario, and every reported number is computed from the simulated trajectories (the artifact records the composition, the vehicle parameters and the disturbance). Report source is the literal `live` — the experiment ran HERE, not against an external system — and evidenceGrade is `locally-measured`, derived from that literal by equality: it distinguishes which channel ran and grades nothing. The claim and prediction it adjudicates come from the selected Case Pack, and the claim is recorded as REFUTED when the measurement negates it',
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
