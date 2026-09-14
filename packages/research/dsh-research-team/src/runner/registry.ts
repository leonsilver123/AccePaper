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
import type { ClaimMaterial } from './redteam-review.ts'
import type { PlatoonStudy, PredictionCommitment } from './platoon-sim.ts'

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
  constructClaim,
  mockLiteratureSearchAdapter,
  renderFigure,
  renderRoadmap,
  renderThreeLineTable,
  runAblation,
  runLiteratureSearch,
} from '@deepseek-ai/dsh-research-tools'

import { assembleManuscript } from './manuscript.ts'
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
  MEASURED_METRIC_KEY,
  SIMULATION_INPUTS,
  ablationStudy,
  boundaryTest,
  comparePlatoons,
  evaluatePrediction,
  experimentStudy,
  runPlatoon,
  studyFromPack,
  thresholdFromPrediction,
} from './platoon-sim.ts'

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
   * Which way the claim declares its quantity should move, and whether it caps the change.
   *
   * Declared by the selected Case Pack (set by the A2-claim executor). Absent means the claim
   * declared none, and the C channel then HOLDS rather than inferring a direction from the
   * prediction's prose — an inference three audit rounds showed cannot be trusted.
   */
  commitment?: PredictionCommitment
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

/** Canonical (claim, prediction) constants — match a KEEP-path row in the team's
 *  experiment fixture table (`experiment/fixture.ts`) so the C-channel adjudicates
 *  to `passed` on the happy path. */
const CANONICAL_CLAIM_ID = 'claim-mixed-platoon-following-risk'
// The claim names the quantity the experiment actually measures. It said "peak-hour
// delay" while the measurement is the DEMAND-WEIGHTED MEAN over every control
// interval, and the C gate adjudicates the prediction's threshold against that mean.
const CANONICAL_CLAIM_REF = 'inserting one AV into a three-vehicle human platoon raises the platoon minimum time-to-collision'
/**
 * The fixture claim's falsifiable prediction.
 *
 * This threshold is DEMONSTRATION DATA, not a research finding: its job is to let the
 * offline pipeline exercise a claim that the study's experiment can adjudicate. The
 * measurement is whatever the simulation produces, and the C gate's verdict follows from it
 * — including when the simulation NEGATES the prediction, which the run records as a
 * refuted claim and carries on from. A real study's threshold comes from its own claim,
 * which is what the model path and the Case Pack both produce.
 */
const CANONICAL_PREDICTION = 'the HV-AV-HV platoon minimum time-to-collision exceeds the all-HV platoon minimum by at least 20%'

/**
 * The quantity the fixture claim is about.
 *
 * It declares the study's measured key because that is what its prediction text names
 * ("demand-weighted mean delay"). A claim whose text is about something else must declare
 * something else, and then the C channel holds instead of grading it.
 */
const CANONICAL_METRIC_KEY = MEASURED_METRIC_KEY

/**
 * The study's identity fields: what is being compared, and under which name.
 *
 * This object holds NO numeric result. It used to carry `baselineDelaySeconds`,
 * `variantDelaySeconds` and `reductionRate` literals (10.0 / 9.09 / 0.091) that
 * nothing read — the executors had already moved to measuring the experiment —
 * so the file advertised numbers that did not match any run. Every delay figure a
 * reader sees is produced by {@link measureOutcome} from an actual experiment, and
 * the identity fields here are what that experiment is measuring between.
 */
export const SCENARIO = {
  baselineIdentity: 'homogeneous-HV-HV-HV',
  variantIdentity: 'mixed-HV-AV-HV',
  metric: MEASURED_METRIC_KEY,
  metricDirection: 'higher_is_better',
  venueId: 'syn-venue-trc-001',
  venueName: 'Synthetic TRC-style Transport Venue',
  // The study's own scenario file, so the fallback reference names the study's dataset
  // rather than a synthetic placeholder.
  datasetId: 'case-pack-traffic/claim.json',
  title: 'Inserting One Autonomous Vehicle Changes a Platoon Minimum Time-to-Collision',
} as const

/** Writer-section model shared by D2/D3/D4/E1 (paper-outline → draft →
 *  revised-draft → formatted-manuscript). Plain data; deterministic. */
interface OutlineSection {
  readonly id: string
  readonly heading: string
}
interface ManuscriptSection extends OutlineSection {
  readonly bodyText: string
}

/** Fallback outline used when an executor runs with empty inputs (registry spec
 *  smoke tests) — same skeleton the E2E drives with real upstream artifacts. */
const DEFAULT_OUTLINE: ReadonlyArray<OutlineSection> = [
  { id: 'abstract', heading: 'Abstract' },
  { id: 'introduction', heading: 'Introduction' },
  { id: 'method', heading: 'Method' },
  { id: 'experiments', heading: 'Experiments' },
  { id: 'results', heading: 'Results' },
  { id: 'conclusion', heading: 'Conclusion' },
  { id: 'references', heading: 'References' },
]

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
 * The threshold the run's prediction actually commits to, as artifact text.
 *
 * Several artifacts describe the bar the experiment has to clear. They used to
 * hardcode "5%", which is the fixture prediction's number — so a run whose claim
 * committed to 11% still published artifacts promising 5% while the C gate
 * adjudicated against the 11% it parsed. The bar is whatever the prediction says,
 * and when it says nothing this reports that rather than inventing one.
 *
 * @param predictionText - the run's falsifiable prediction.
 * @returns the committed threshold, or a phrase saying none was stated.
 */
function thresholdLabel(predictionText: string): string {
  const threshold = thresholdFromPrediction(predictionText)
  return threshold === undefined ? 'no numeric threshold stated' : `${threshold}%`
}

/**
 * The reference list D3 is supposed to produce, built from the retrieved records.
 *
 * D3's canonical purpose is "draft the sections AND add references", and the draft
 * used to carry only a COUNT of the landscape hits with an empty reference list — so
 * the assembled manuscript announced references it did not have. Each entry here
 * keeps the identifier the corpus gave it (`doi:...` / `arxiv:...`) or says `null`,
 * and a record with no title is skipped rather than emitted half-formed.
 *
 * @param rawHits - the `hits` array off the landscape-map artifact.
 * @returns one entry per usable record, in retrieval order.
 */
function buildReferences(rawHits: unknown): ReadonlyArray<Record<string, unknown>> {
  if (!Array.isArray(rawHits)) return []
  const out: Array<Record<string, unknown>> = []
  for (const raw of rawHits) {
    if (raw === null || typeof raw !== 'object') continue
    const hit = raw as {
      title?: unknown
      venue?: unknown
      ref?: { kind?: unknown; id?: unknown; authors?: unknown }
    }
    if (typeof hit.title !== 'string' || hit.title.trim() === '') continue
    const kind = typeof hit.ref?.kind === 'string' ? hit.ref.kind : undefined
    const identifier = typeof hit.ref?.id === 'string' ? hit.ref.id : undefined
    out.push({
      title: hit.title,
      venue: typeof hit.venue === 'string' ? hit.venue : 'unknown venue',
      identifier: kind !== undefined && identifier !== undefined ? `${kind}:${identifier}` : null,
      authors: Array.isArray(hit.ref?.authors)
        ? (hit.ref.authors as ReadonlyArray<unknown>).filter((a): a is string => typeof a === 'string')
        : [],
    })
  }
  return out
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

/** Claim identity from the run context (falls back to the canonical constants). */
function canonicalOf(ctx: ExecCtx): {
  readonly claimId: string
  readonly claimRef: string
  readonly predictionText: string
} {
  return {
    claimId: ctx.runCtx.claimId || CANONICAL_CLAIM_ID,
    claimRef: ctx.runCtx.claimRef || CANONICAL_CLAIM_REF,
    predictionText: ctx.runCtx.predictionText || CANONICAL_PREDICTION,
  }
}

/** Section list of a manuscript-shaped artifact, with a deterministic fallback. */
function sectionsOf(input: Record<string, unknown> | undefined): ReadonlyArray<ManuscriptSection> {
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
  return defaultBodySections()
}

/** Deterministic fallback body for every outline section id. */
/**
 * The run's measured outcome, rounded to the precision the manuscript reports.
 *
 * Body text and the figures/tables are generated from THIS one computation, so a
 * paper can never state a number its own exhibit contradicts. It is the same
 * measurement the C gate adjudicates.
 *
 * @returns both platoons' minimum time-to-collision plus the change between them.
 */
function measureOutcome(): {
  readonly baselineMinTtcSeconds: number
  readonly variantMinTtcSeconds: number
  /** Change in the variant relative to the baseline, %. Positive means the AV helped. */
  readonly improvementPct: number
  readonly baselineTtcRatePct: number
  readonly variantTtcRatePct: number
  readonly stringStabilityIndex: number
} {
  const round2 = (value: number): number => Math.round(value * 100) / 100
  const comparison = comparePlatoons(experimentStudy())
  return {
    baselineMinTtcSeconds: round2(comparison.baseline.minTtcSeconds),
    variantMinTtcSeconds: round2(comparison.variant.minTtcSeconds),
    improvementPct: round2(comparison.relativeImprovementPct),
    baselineTtcRatePct: round2(comparison.baseline.ttcLt1_5RatePct),
    variantTtcRatePct: round2(comparison.variant.ttcLt1_5RatePct),
    stringStabilityIndex: round2(comparison.variant.stringStabilityIndex),
  }
}

/**
 * Draft a section body.
 *
 * @param id - section id from the outline skeleton.
 * @param measured - the run's measured outcome, so no section quotes a number the
 *   exhibits do not show.
 * @returns the section's prose.
 */
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
 * @param measured - the current measurement of the study experiment.
 * @param referenceCount - entries the draft carries for the reference list.
 * @returns the section body.
 */
function bodyTextFor(
  id: string,
  measured: ReturnType<typeof measureOutcome>,
  referenceCount: number,
): string {
  const study = experimentStudy()
  const hv = study.variant.vehicleClasses.HV
  const av = study.variant.vehicleClasses.AV
  const inputs = SIMULATION_INPUTS
  const direction = measured.improvementPct >= 0 ? 'raises' : 'lowers'
  switch (id) {
    case 'abstract':
      return 'We test whether inserting a single autonomous vehicle into a three-vehicle human platoon changes the platoon\'s car-following risk, measured as its minimum time-to-collision, under a declared periodic speed disturbance. Both platoons are simulated with the Intelligent Driver Model at the Case Pack\'s declared vehicle parameters. This is a deterministic offline simulation, not field data, and it reports no crash frequency.'
    case 'introduction':
      return `This work targets the claim: ${CANONICAL_CLAIM_REF}. The falsifiable prediction is: ${CANONICAL_PREDICTION}.`
    case 'method':
      return `Both platoons are run with the SAME car-following model — the Intelligent Driver Model (Treiber, Hennecke & Helbing 2000), integrated at a fixed ${inputs.stepSeconds.toFixed(2)} s step — and differ only in composition: the baseline is HV-HV-HV and the variant is HV-AV-HV. The Case Pack declares, for each class, its reaction delay, its desired headway and its deceleration limit: the human vehicle reacts in ${hv.reactionDelaySeconds.toFixed(2)} s and wants a ${hv.desiredHeadwaySeconds.toFixed(1)} s headway; the autonomous vehicle reacts in ${av.reactionDelaySeconds.toFixed(2)} s and wants a ${av.desiredHeadwaySeconds.toFixed(1)} s headway. The look-ahead horizon is NOT declared by the pack — this study derives it as ${av.lookAheadHorizonSeconds.toFixed(2)} s, the vehicle's own reaction delay. Reaction time is applied as a real delay: a follower evaluates its leader's state as it was that delay earlier, and a vehicle with a horizon extrapolates that observed state forward over it. The leader's speed follows a declared periodic disturbance of ±${inputs.freeFlowAmplitudeMps.toFixed(1)} m/s at a ${inputs.disturbancePeriodSeconds.toFixed(1)} s period, which is the perturbation the string-stability literature uses to test whether a disturbance grows or decays down a platoon.`
    case 'experiments':
      return `Both platoons were run over ${inputs.measurementSeconds.toFixed(0)} s after a ${inputs.warmupSeconds.toFixed(0)} s warm-up, and the minimum time-to-collision (Minderhoud & Bovy 2001) was read from the simulated trajectories: ${measured.baselineMinTtcSeconds.toFixed(2)} s for the homogeneous platoon and ${measured.variantMinTtcSeconds.toFixed(2)} s for the platoon carrying the autonomous vehicle, a change of ${measured.improvementPct.toFixed(2)}%. Neither platoon entered the pack's declared TTC<1.5s band (${measured.baselineTtcRatePct.toFixed(2)}% and ${measured.variantTtcRatePct.toFixed(2)}% of vehicle-time), which bounds what that band could have shown.`
    case 'results':
      return 'The figures below carry the same measurement the C gate adjudicated: the data figure as the SVG the figure tool rendered, the roadmap as the mermaid the roadmap tool rendered, and the results table. The claim is bounded to steady free flow; the boundary probe and the ablations are reported separately, and no published-SOTA comparison is asserted.'
    case 'conclusion':
      return `Under the declared configuration the autonomous vehicle ${direction} the platoon's minimum time-to-collision by ${Math.abs(measured.improvementPct).toFixed(2)}%, measured inside the study's own car-following model. The scope is three vehicles on one lane under a declared disturbance with no stochasticity; submission remains a human act at E2.`
    case 'references':
      // The body states what the draft actually carries. It used to assert that
      // references were drawn from the landscape scan above an empty list.
      return referenceCount === 0
        ? 'No reference entries were derived: no record the landscape scan returned carried a title.'
        : `The ${String(referenceCount)} record(s) the landscape scan retrieved, listed below.`
    default:
      return 'This section carries no generated content in this wave.'
  }
}

function defaultBodySections(referenceCount = 0): ReadonlyArray<ManuscriptSection> {
  const measured = measureOutcome()
  return DEFAULT_OUTLINE.map(s => ({
    id: s.id,
    heading: s.heading,
    bodyText: bodyTextFor(s.id, measured, referenceCount),
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
    { topic: 'adaptive traffic signal control' },
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
    throw new Error(
      '[A1-landscape] the retrieval adapter reported its catalogue UNAVAILABLE: an outage '
      + 'is not "no literature found", and a landscape derived from no records would be '
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

  let assertion = 'Inserting one AV into a three-vehicle human platoon raises the platoon minimum time-to-collision.'
  let essentialDifference = 'control policy is adaptive (RL) rather than fixed-time'
  let experimentToFalsify = 'Simulate the homogeneous and the mixed platoon under the same declared disturbance and compare their minimum time-to-collision.'
  let prediction = CANONICAL_PREDICTION
  let claimSource: 'model' | 'deterministic' | 'fixture' | 'case-pack' = 'fixture'
  let claimRoute: Record<string, unknown> = proseRouteOf(undefined)
  // What the claim is ABOUT. Only a claim that declares the quantity this study measures can be
  // adjudicated by it; the fixture claim declares it because its own prediction text names it.
  let metricKey = CANONICAL_METRIC_KEY
  // The fixture claim's own declared commitment, matching the sentence it writes. A claim that
  // declares none is ungradeable, and the fixture is the pipeline's default claim.
  // `increase`, because the fixture claim's sentence says the quantity RISES ("raises the platoon
  // minimum time-to-collision"). A declared commitment that disagreed with the fixture's own words
  // would be worse than none at all.
  let commitment: PredictionCommitment | undefined = { direction: 'increase', bounded: false }

  // A SELECTED Case Pack is the authority for this run's claim. It is curated fixture
  // content, and it is preferred over the model because the pack is what the run was
  // started with: deriving a different claim from the model would make the run's product
  // disagree with its own input set. Both paths record which one supplied the claim.
  const packScenario = ctx.getInput(CASE_PACK_INPUT_SLUGS.scenario)
  const packClaim = readInput(ctx, CASE_PACK_INPUT_SLUGS.claim)
  if (packClaim !== undefined) {
    assertion = requiredClaimField(packClaim, 'assertion')
    essentialDifference = requiredClaimField(packClaim, 'essentialDifference')
    experimentToFalsify = requiredClaimField(packClaim, 'experimentToFalsify')
    prediction = requiredClaimField(packClaim, 'prediction')
    // A pack that declares no metric leaves the claim unbindable, and the C channel then HOLDS
    // rather than grading it. That is the honest outcome for a claim this study cannot test.
    metricKey = typeof packClaim.metricKey === 'string' ? packClaim.metricKey : ''
    // Read from the pack's declared block, validated by shape. Anything else is the claim
    // declining to say which way its quantity should move, which the C channel holds on.
    const declared = packClaim.commitment as { direction?: unknown; bounded?: unknown } | undefined
    commitment = declared !== undefined
      && (declared.direction === 'increase' || declared.direction === 'decrease')
      && typeof declared.bounded === 'boolean'
      ? { direction: declared.direction, bounded: declared.bounded }
      : undefined
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
      context: { gaps },
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
      claimId: CANONICAL_CLAIM_ID,
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
  ctx.runCtx.claimId = CANONICAL_CLAIM_ID
  ctx.runCtx.claimRef = CANONICAL_CLAIM_REF
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
    measuredMetricKey: MEASURED_METRIC_KEY,
    ...(commitment === undefined ? {} : { commitment }),
    declaredSources: packClaim !== undefined && Array.isArray(packClaim.declaredSources)
      ? (packClaim.declaredSources as ReadonlyArray<string>)
      : [],
  }
  return {
    claim: tagArtifact({ ...artifact.claim, claimSource, claimKind: proseKindOf(claimSource), metricKey: metricKey === '' ? null : metricKey }, A2_PRODUCER, 'real_tool_fixture_input', { provenance: invocation.provenance, invokerTruthfulness: invocation.truthfulness }),
    'falsifiable-prediction': tagArtifact(
      {
        text: prediction,
        ref: CANONICAL_CLAIM_ID,
        supportStatus: artifact.claim.supportStatus,
        claimSource,
        // What the claim is about. The C channel adjudicates only when this equals the quantity
        // the experiment measures, so it is the field that decides whether the number below was
        // ever a test of this claim.
        metricKey: metricKey === '' ? null : metricKey,
        measuredMetricKey: MEASURED_METRIC_KEY,
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
          expectedEvidence: `platoon minimum-TTC gain >= ${thresholdLabel(predictionText)} (prediction: ${predictionText})`,
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
  const writer = ctx.proseWriter
  let family = 'reinforcement-learning phase-plan policy (synthetic spec)'
  let steps: ReadonlyArray<string> = ['build both platoons', 'integrate the car-following model', 'read the minimum time-to-collision']
  let metricName: string = SCENARIO.metric
  let metricDirection: string = SCENARIO.metricDirection
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
      context: { claim: claimArtifact?.assertion ?? claimRef, prediction: predictionText },
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
    family = parsedFamily
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
        claimRef,
        derivedFrom: 'falsifiable-prediction',
        steps,
        metric: { name: metricName, direction: metricDirection },
        methodSource,
        methodRoute,
        note: methodSource === 'fixture'
          ? 'synthetic method spec — no method-derivation tool exists'
          : 'method spec derived from the claim and its falsifiable prediction',
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
 * @returns the demand evidence block attached to every experiment artifact.
 */
function studyEvidence(study: PlatoonStudy = experimentStudy()): Record<string, unknown> {
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
    measures: MEASURED_METRIC_KEY,
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
  const { predictionText } = canonicalOf(ctx)
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
          metric: { name: MEASURED_METRIC_KEY, direction: 'higher is better' },
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
          study: studyEvidence(study),
        },
        beatsBaselineWhen: `variant minimum time-to-collision exceeds the baseline's by >= ${thresholdLabel(predictionText)}`,
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
        targetMetric: MEASURED_METRIC_KEY,
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
  const verdict = evaluatePrediction(predictionText, ctx.runCtx.study, ctx.runCtx.metricKey, ctx.runCtx.commitment)
  if (verdict.kind === 'unbindable') {
    // Fail-closed and symmetric with the C gate: an unbindable claim is not executed against,
    // because there is no measurement that could adjudicate it.
    throw new Error(
      `C1-mvp: the experiment cannot adjudicate this claim — ${verdict.reason} `
      + '(fail-closed: no adjudicable prediction ⇒ no pass)',
    )
  }
  const comparison = comparePlatoons(ctx.runCtx.study)
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
          measures: MEASURED_METRIC_KEY,
          doesNotMeasure: 'field crash frequency, any external SOTA, or any road layout beyond one lane',
          ruleVersion: EXPERIMENT_RULE_VERSION,
          study: studyEvidence(ctx.runCtx.study),
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

/** The C3-boundary ablation definition: the mixed platoon vs the homogeneous one,
 *  minimum time-to-collision, 4 repetitions (real tool over a deterministic executor). */
const ABLATION_DEFINITION: AblationDefinition = {
  baselineIdentity: SCENARIO.baselineIdentity,
  variantIdentity: SCENARIO.variantIdentity,
  removedOrReplacedComponents: [
    { component: 'platoon-composition', action: 'replaced', replacement: SCENARIO.variantIdentity },
  ],
  dataset: { version: 'case-pack-traffic.v2', split: 'declared-scenario', seed: 20260909 },
  metric: { name: MEASURED_METRIC_KEY, direction: 'higher_is_better' },
  repetitions: 4,
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
  const invoker = ctx.invoker ?? new DirectResearchToolInvoker('c3-fixture')
  const invocation = await invoker.invoke(
    'ablation',
    { definition: ABLATION_DEFINITION },
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
          baseline: ABLATION_DEFINITION.baselineIdentity,
          variant: ABLATION_DEFINITION.variantIdentity,
          removedOrReplacedComponents: ABLATION_DEFINITION.removedOrReplacedComponents,
        },
        metric: ABLATION_DEFINITION.metric,
        aggregate: artifact.aggregate,
        study: studyEvidence(ctx.runCtx.study),
        boundary: boundaryProbe(ctx.runCtx.study),
        note: 'boundary-map derived from the REAL runAblation execution over simulated platoons, plus the measured stop-and-go scope test — an applicability claim for this declared scenario only, not a general one',
      },
      C3_PRODUCER,
      'real_tool_fixture_input',
      { provenance: invocation.provenance, invokerTruthfulness: invocation.truthfulness },
    ),
  }
}

/** D1-figure-map: real renders for ALL THREE figure families its canonical
 *  purpose names (数据图/三线表/路线图). figure-plan lists each figure with the
 *  evidence produced by its real tool execution. */
async function d1Executor(ctx: ExecCtx): Promise<Record<string, unknown>> {
  const { predictionText } = canonicalOf(ctx)
  const invoker = ctx.invoker ?? new DirectResearchToolInvoker('d1-fixture')
  // The figures plot the SAME measurements the experiment produced, so a chart can
  // never disagree with the verdict it illustrates.
  const comparison = comparePlatoons(ctx.runCtx.study)
  // Rounded to the precision the table column declares: the tool refuses a value
  // carrying more decimals than its column, and that guard is right to.
  const round2 = (value: number): number => Math.round(value * 100) / 100
  const measuredBaseline = round2(comparison.baseline.minTtcSeconds)
  const measuredVariant = round2(comparison.variant.minTtcSeconds)
  const figureSpec = {
    kind: 'bar',
    title: 'Platoon Minimum Time-to-Collision by Composition',
    width: 320,
    height: 240,
    series: [{ name: 'minimum TTC (s)', values: [measuredVariant, measuredBaseline] }],
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
      { id: 'reduction-outcome', label: `Minimum TTC gain >= ${thresholdLabel(predictionText)}`, kind: 'output' },
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
  return {
    'figure-plan': tagArtifact(
      {
        figures: [
          {
            kind: 'data-figure',
            toolId: FIGURE_TOOL_ID,
            svgByteLength: figure.svg.byteLength,
            pngByteLength: figure.png.byteLength,
            // The FULL svg, not a preview. D3 carries it into the draft and E1 embeds
            // it, so the manuscript holds the figure the tool actually rendered
            // instead of pointing at one.
            svg: figure.svg.content,
          },
          {
            kind: 'three-line-table',
            toolId: THREE_LINE_TABLE_TOOL_ID,
            tableMarkdown: table.render.text,
            bindingHash: table.bindingHash,
          },
          {
            kind: 'roadmap',
            toolId: ROADMAP_TOOL_ID,
            format: roadmap.format,
            nodeCount: roadmap.nodeCount,
            validationOk: roadmap.validation.ok,
            // Full content, for the same reason as the svg above. The roadmap renders
            // as mermaid, which a markdown reader draws natively.
            content: roadmap.content,
          },
        ],
        totalFigures: 3,
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

/** Default headings when no writer is injected (the skeleton's own names). */
const DEFAULT_HEADING: Readonly<Record<string, string>> = {
  abstract: 'Abstract',
  introduction: 'Introduction',
  method: 'Method',
  experiments: 'Experiments',
  results: 'Results',
  conclusion: 'Conclusion',
  references: 'References',
}

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
  let title: string = SCENARIO.title
  const headings: Record<string, string> = { ...DEFAULT_HEADING }
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

  const outline: ReadonlyArray<OutlineSection & { covers: ReadonlyArray<string> }> =
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
    : DEFAULT_OUTLINE.map(s => s.id)
  const figures = figurePlan?.totalFigures as number | undefined
  const hitCount = landscape?.hitCount as number | undefined
  // The rendered figures travel with the draft so E1 can embed them. D1 owns the
  // render; the manuscript is where a reader meets it.
  const renderedFigures = Array.isArray(figurePlan?.figures)
    ? (figurePlan.figures as ReadonlyArray<{ kind?: unknown; svg?: unknown; content?: unknown; format?: unknown; tableMarkdown?: unknown }>)
    : []
  // D3's canonical purpose includes adding the references, so the draft builds them
  // from the records A1 actually retrieved rather than reporting a count of them.
  const references = buildReferences(landscape?.hits)
  const headings: ReadonlyArray<{ id: string; heading: string }> = ids.map((id, index) => {
    const heading =
      Array.isArray(rawOutline) && typeof (rawOutline[index] as { heading?: unknown } | undefined)?.heading === 'string'
        ? ((rawOutline[index] as { heading: string }).heading)
        : DEFAULT_OUTLINE.find(d => d.id === id)?.heading ?? id
    return { id, heading }
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
  if (writer === undefined) {
    const measured = measureOutcome()
    sections = headings.map(h => ({ ...h, bodyText: bodyTextFor(h.id, measured, references.length) }))
    proseSource = 'fixture'
  } else {
    const written = await Promise.all(
      headings.map(h =>
        writer.write({
          stepId: 'D3-writing',
          instruction: `Write the "${h.heading}" section of a research paper. Refer to the central claim as ${claimRef}. Return prose only — no heading, no commentary.`,
          context: { sectionId: h.id, claimRef, figureCount: figures ?? 0 },
          ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
        }),
      ),
    )
    sections = headings.map((h, i) => ({ ...h, bodyText: written[i]?.text ?? '' }))
    proseSource = proseLabelling(writer).source
    const first = written[0]
    proseRoute = proseRouteOf(first)
    // The prefix names the channel, not an assumption about it: the deterministic route is not an
    // LLM call, and a producer string reading `llm:` beside `proseSource: 'deterministic'` is two
    // fields of one artifact contradicting each other.
    if (first !== undefined) producer = `${proseSource === 'model' ? 'llm' : 'deterministic'}:${first.provider}/${first.model}`
  }

  return {
    draft: tagArtifact(
      {
        fixture: proseSource === 'fixture',
        stepId: 'D3-writing',
        slug: 'draft',
        title: SCENARIO.title,
        claimRef,
        sections,
        proseSource,
        proseRoute,
        figureRef: figures ?? 0,
        landscapeRef: hitCount ?? 0,
        references,
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
 * Pair up CONCERN/RESPONSE lines from a model's rebuttal response.
 *
 * A CONCERN opens an exchange and the next RESPONSE closes it; a response with no
 * open concern is dropped rather than attached to the previous one, so a malformed
 * reply yields fewer exchanges instead of a mispaired one.
 *
 * @param text - the model's response.
 * @returns one point per complete pair, in the order they appeared.
 */
function parseExchanges(text: string): ReadonlyArray<RebuttalPoint> {
  const points: RebuttalPoint[] = []
  let concern: string | undefined
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/^\s*(?:[-*•]|\d+[.)\]])?\s*/, '').trim()
    const concernMatch = /^CONCERN\s*[:=]\s*(.+)$/i.exec(line)
    if (concernMatch !== null) {
      concern = concernMatch[1]?.trim()
      continue
    }
    const responseMatch = /^RESPONSE\s*[:=]\s*(.+)$/i.exec(line)
    if (responseMatch !== null && concern !== undefined && concern.length > 0) {
      points.push({ concern, response: responseMatch[1]?.trim() ?? '', requiresRevision: true })
      concern = undefined
    }
  }
  return points
}

async function d4Executor(ctx: ExecCtx): Promise<Record<string, unknown>> {
  const { claimRef } = canonicalOf(ctx)
  const draft = readInput(ctx, 'draft')
  const sections = sectionsOf(draft)
  // A revision keeps the reference list it is revising. Dropping it here is what
  // made the assembled manuscript report zero references while its own references
  // section described the landscape scan it was built from.
  const references = Array.isArray(draft?.references) ? draft.references : []
  // Same reasoning as the references: a revision keeps the figures it is revising.
  const renderedFigures = Array.isArray(draft?.renderedFigures) ? draft.renderedFigures : []
  const measured = measureOutcome()

  // The exchanges are organised by the real module, which computes the revision
  // tally from the points and refuses an empty or shell response. With a writer the
  // concerns come from the model; without one they are the questions this study's own
  // design raises, stated with the MEASURED numbers rather than a remembered constant.
  const writer = ctx.proseWriter
  let points: ReadonlyArray<RebuttalPoint>
  let rebuttalSource: 'model' | 'deterministic' | 'fixture' = 'fixture'
  let rebuttalRoute: Record<string, unknown> = proseRouteOf(undefined)
  if (writer === undefined) {
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
  } else {
    const analysis = await writer.write({
      stepId: 'D4-rebuttal',
      instruction: [
        'Write the review exchanges this paper must answer.',
        'Reply with one exchange per pair of lines, at least two exchanges:',
        'CONCERN: <reviewer concern>',
        'RESPONSE: <the author response, using only the measurements given in the context>',
      ].join('\n'),
      context: { claimRef, measured },
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
    })
    const parsed = parseExchanges(analysis.text)
    if (parsed.length === 0) {
      throw new Error(
        '[D4-rebuttal] the model response carried no CONCERN/RESPONSE pair '
        + '(a rebuttal with no exchange answers nothing — NO DEFAULT PASS)',
      )
    }
    points = parsed
    rebuttalSource = proseLabelling(writer).source
    rebuttalRoute = proseRouteOf(analysis)
  }

  const record = buildRevisionRecord(points)
  // The revision is recorded as a FLAG per section, not as a marker pasted into the
  // prose. The marker used to travel with the body all the way into the formatted
  // manuscript, so the submitted paper carried `[revised: rebuttal addressed]` after
  // every paragraph — process metadata printed as content.
  const revised: ReadonlyArray<ManuscriptSection & { readonly revised: boolean }> = sections.map(s => ({
    ...s,
    revised: record.hasRevisions,
  }))
  return {
    rebuttal: tagArtifact(
      {
        fixture: rebuttalSource === 'fixture',
        stepId: 'D4-rebuttal',
        slug: 'rebuttal',
        roundId: 't19s-rebuttal-1',
        claimRef,
        rebuttalSource,
        rebuttalRoute,
        exchanges: record.points,
        revisionCount: record.revisionCount,
        hasRevisions: record.hasRevisions,
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
        title: SCENARIO.title,
        claimRef,
        sections: revised,
        references,
        renderedFigures,
        note: 'synthetic revised draft — same section ids as the D3 draft with revision markers',
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
  const title = typeof outline?.title === 'string' ? outline.title : SCENARIO.title
  const venueName = typeof venue?.name === 'string' ? venue.name : SCENARIO.venueName
  const venueId = typeof venue?.venueId === 'string' ? venue.venueId : SCENARIO.venueId
  const rawMatches = venueScope?.matches
  const scopeMatches = Array.isArray(rawMatches)
    ? rawMatches.filter((m): m is string => typeof m === 'string')
    : []
  const sections = sectionsOf(revised)

  // Real three-line-table sub-capability: the manuscript results table, built from
  // the SAME measurements the experiment produced.
  const round2 = (value: number): number => Math.round(value * 100) / 100
  const e1Comparison = comparePlatoons(ctx.runCtx.study)
  const measuredBaseline = round2(e1Comparison.baseline.minTtcSeconds)
  const measuredVariant = round2(e1Comparison.variant.minTtcSeconds)
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
  const referenceEntries = rawRefs.map((raw) => {
    const ref = raw as { title?: unknown; venue?: unknown; identifier?: unknown; authors?: unknown }
    const authors = Array.isArray(ref.authors)
      ? (ref.authors as ReadonlyArray<unknown>).filter((a): a is string => typeof a === 'string')
      : []
    const identifier = typeof ref.identifier === 'string' ? ` ${ref.identifier}` : ''
    const byline = authors.length > 0 ? `${authors.join(', ')}. ` : ''
    const venue = typeof ref.venue === 'string' ? ` ${ref.venue}.` : ''
    return `${byline}${String(ref.title)}.${venue}${identifier}`.trim()
  })
  // Assembly is a real step of its own now: the module refuses a titleless or
  // section-less manuscript, so an empty shell cannot be assembled here.
  // The assembler renders its own `## References` block from these entries, and the
  // outline already carries a `references` section — passing both printed the heading
  // twice. The assembler's block wins because it is the one that actually holds the
  // entries, so the empty outline section is dropped here and the replacement is
  // recorded on the artifact rather than happening silently.
  const sectionsForAssembly = referenceEntries.length > 0
    ? sections.filter(section => section.id !== 'references')
    : sections
  // The manuscript carries the figures D1 actually rendered: the data figure as the
  // svg it produced, the roadmap as the mermaid block it produced, then the results
  // table. Until this, the Figures section held the table alone and the rendered
  // figure and roadmap were emitted as artifacts the paper never mentioned.
  const rendered = Array.isArray(revised?.renderedFigures)
    ? (revised.renderedFigures as ReadonlyArray<{ kind?: unknown; svg?: unknown; content?: unknown; format?: unknown }>)
    : []
  const figureBlocks: string[] = []
  // Kept separately as well as inline: the package writes each part as its own file with its
  // own source, so the figure's provenance never stands in for the table's or the roadmap's.
  let figureSvg = ''
  let roadmapMermaid = ''
  for (const entry of rendered) {
    if (entry.kind === 'data-figure' && typeof entry.svg === 'string') {
      figureSvg = entry.svg
      figureBlocks.push(entry.svg)
    }
    if (entry.kind === 'roadmap' && typeof entry.content === 'string' && entry.format === 'mermaid') {
      roadmapMermaid = entry.content.trim()
      figureBlocks.push(['```mermaid', roadmapMermaid, '```'].join('\n'))
    }
  }
  figureBlocks.push(artifact.render.text)
  const assembled = assembleManuscript({
    title,
    sections: sectionsForAssembly,
    figures: figureBlocks,
    references: referenceEntries,
  })
  // The package's OWN files, as CONTENT. E1 produces these; the run exporter adds the
  // run-level files (summary, step record, claim-evidence, citations, experiment,
  // reproducibility, manifest) and writes the whole set to disk. A path whose upstream step
  // did not run has no content and is OMITTED, never declared empty — the earlier version of
  // this artifact listed five filenames no step wrote, which read as run output.
  const pkg = nonEmptyPackageFiles({
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
  })
  return {
    'formatted-manuscript': tagArtifact(
      {
        title,
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
 *  - B: the REAL core `verifyCitation` identity chain runs against the SIMULATED
 *    `MockCitationResolverAdapter`, with the claim stance taken from the T23
 *    synthetic anchor fixture → core `adjudicate('B')`. Real adapter logic +
 *    mocked external system.
 *  - C: the REAL team `adjudicateClaimSupport` → core `adjudicate('C')` runs over a
 *    `live` experiment report MEASURED by platoon-sim over the study's declared scenario
 *    profile; the claim and its prediction are the fixture-supplied input. The
 *    measurement is this package's own code, hence `local_computation`.
 */
export const VERDICT_CHANNELS: Readonly<Record<TrinityComponent, { kind: Truthfulness; basis: string }>> = {
  A: {
    // No tool function runs here either: `judgeRound` and core `adjudicate` are
    // package code over a synthetic vote set.
    kind: 'local_computation',
    basis: 'team judgeRound → core adjudicate(\'A\') executes for real; the rebuttal round votes are synthetic fixture input',
  },
  B: {
    kind: 'mock_external',
    basis: 'core verifyCitation identity chain executes against MockCitationResolverAdapter (simulated external resolver); stance comes from the T23 synthetic anchor fixture → core adjudicate(\'B\')',
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
export const CANONICAL = {
  claimId: CANONICAL_CLAIM_ID,
  claimRef: CANONICAL_CLAIM_REF,
  prediction: CANONICAL_PREDICTION,
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
