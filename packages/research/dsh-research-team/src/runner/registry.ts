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
// ── Truthfulness levels (4-level ruling; supersedes the old 3-level
//    'real_tool' | 'fixture' | 'mock_external' scheme) ─────────────────────────
//  - `real_tool_fixture_input` : the REAL tool function executes; its INPUT is a
//    synthetic fixture. Honest reading: "the code really ran", NOT "this is real
//    science". Reports must never call this real research verification.
//  - `fixture_executor`        : the whole executor is a deterministic fixture —
//    no tool is implemented for this step yet (or, for B3, the tool capability
//    exists but cannot anchor SOTA in this wave's synthetic corpus).
//  - `mock_external`           : real ADAPTATION logic runs against a SIMULATED
//    external system (e.g. core `verifyCitation` over
//    `MockCitationResolverAdapter`). Used by the gate channels (see verdict.ts).
//  - `live_external`           : a real external system. MUST be 0 in this wave
//    (asserted by the registry spec and by the report).
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

import type { StepDefinition, TrinityComponent } from '@deepseek-ai/dsh-research-core'
import { getStepDefinitions } from '@deepseek-ai/dsh-research-core'
import type { AblationDefinition, RoadmapGraph } from '@deepseek-ai/dsh-research-tools'
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
  THREE_LINE_TABLE_TOOL_ID,
  THREE_LINE_TABLE_TOOL_VERSION,
  constructClaim,
  createMockAblationExecutor,
  mockLiteratureSearchAdapter,
  renderFigure,
  renderRoadmap,
  renderThreeLineTable,
  runAblation,
  runLiteratureSearch,
} from '@deepseek-ai/dsh-research-tools'

import {
  EXPERIMENT_FIXTURE_RULE_VERSION,
  experimentFixtureKey,
  lookupExperimentFixture,
} from '../experiment/fixture.ts'

/** Truthfulness classification of an executor / gate channel (4-level ruling). */
export type Truthfulness =
  | 'real_tool_fixture_input'
  | 'fixture_executor'
  | 'mock_external'
  | 'live_external'

/** The 4 levels in report order (also the runtime membership guard). */
export const TRUTHFULNESS_LEVELS: ReadonlyArray<Truthfulness> = [
  'real_tool_fixture_input',
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
  /** The fixed timestamp used across the run (set by the driver). */
  timestamp: number
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
}

export type StepExecutorFn = (ctx: ExecCtx) => Promise<Record<string, unknown>> | Record<string, unknown>

/** A registry entry: the full auditable declaration of how one step is executed. */
export interface StepExecutorEntry {
  readonly stepId: string
  /** Truthfulness of THIS executor (not of the step's gate — see verdict.ts). */
  readonly kind: Truthfulness
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
export function tagArtifact(
  value: unknown,
  producer: string,
  kind: Truthfulness,
): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>), __producer: producer, __kind: kind }
  }
  return { value, __producer: producer, __kind: kind }
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
const CANONICAL_CLAIM_ID = 'mock-claim-001'
const CANONICAL_CLAIM_REF = 'adaptive signal control reduces peak-hour delay'
const CANONICAL_PREDICTION = 'peak-hour delay falls by at least 8% under adaptive control'

/** The synthetic scenario's single numeric source of truth (T19-S). Every
 *  downstream executor (B3 baseline row / C1 mvp / D1 figure+table / E1
 *  manuscript table) derives its numbers from here, and `reductionRate` matches
 *  the experiment fixture text "9.1% mean delay reduction" verbatim —
 *  (10.0 − 9.09) / 10.0 = 0.091. */
export const SCENARIO = {
  baselineIdentity: 'fixed-time',
  variantIdentity: 'adaptive-rl',
  metric: 'delay',
  metricDirection: 'lower_is_better',
  baselineDelaySeconds: 10.0,
  variantDelaySeconds: 9.09,
  reductionRate: 0.091,
  venueId: 'syn-venue-trc-001',
  venueName: 'Synthetic TRC-style Transport Venue',
  datasetId: 'syn-traffic-v1',
  title: 'Adaptive Signal Control Reduces Peak-Hour Delay',
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
const A2_PRODUCER = `${CLAIM_CONSTRUCT_TOOL_ID}@${CLAIM_CONSTRUCT_TOOL_VERSION}`
const A3_PRODUCER = 'fixture:agenda'
const A4_PRODUCER = 'fixture:venue'
const B1_PRODUCER = 'fixture:method'
const B2_PRODUCER = 'fixture:data'
const B3_PRODUCER = 'fixture:baseline'
const C1_PRODUCER = 'fixture:mvp'
const C2_PRODUCER = 'fixture:trinity-loop'
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
function bodyTextFor(id: string): string {
  switch (id) {
    case 'abstract':
      return 'We study whether an adaptive (RL) signal control policy reduces peak-hour delay below the fixed-time baseline.'
    case 'introduction':
      return `This work targets the claim: ${CANONICAL_CLAIM_REF}. The falsifiable prediction is: ${CANONICAL_PREDICTION}.`
    case 'method':
      return 'Our method is an adaptive RL phase-plan policy optimising the delay metric; the controlled comparison is the fixed-time baseline.'
    case 'experiments':
      return `The mock experiment compares fixed-time (${SCENARIO.baselineDelaySeconds} s mean delay) against the adaptive policy (${SCENARIO.variantDelaySeconds} s), a ${(SCENARIO.reductionRate * 100).toFixed(1)}% reduction.`
    case 'results':
      return 'Results are reported as data figures, three-line tables and a roadmap figure; boundary probing (ablation) is summarised separately.'
    case 'conclusion':
      return 'The synthetic evidence converges on the prediction; submission remains a human act at E2.'
    default:
      return 'References are L0-filtered from the landscape scan (synthetic).'
  }
}

function defaultBodySections(): ReadonlyArray<ManuscriptSection> {
  return DEFAULT_OUTLINE.map(s => ({ id: s.id, heading: s.heading, bodyText: bodyTextFor(s.id) }))
}

// ── Real-tool executors (real tool function, synthetic fixture input) ───────────

/** A1-landscape: real `runLiteratureSearch` over the synthetic mock adapter. */
function a1Executor(): Record<string, unknown> {
  const artifact = runLiteratureSearch(
    { topic: 'adaptive traffic signal control' },
    mockLiteratureSearchAdapter,
    FIXED_TS,
  )
  return {
    'landscape-map': tagArtifact(
      {
        topic: artifact.query.topic,
        outcome: artifact.outcome,
        hitCount: artifact.hits.length,
        hits: artifact.hits,
        note: 'landscape-map produced by a REAL runLiteratureSearch execution over a SYNTHETIC corpus — not real literature',
      },
      A1_PRODUCER,
      'real_tool_fixture_input',
    ),
    'gap-list': tagArtifact(
      {
        gaps: ['SOTA delay-reduction gap under adaptive control is unverified'],
        source: 'synthetic literature adapter (mockLiteratureSearchAdapter)',
      },
      A1_PRODUCER,
      'real_tool_fixture_input',
    ),
  }
}

/** A2-claim: real `constructClaim` producing a claim + falsifiable prediction. */
function a2Executor(ctx: ExecCtx): Record<string, unknown> {
  const artifact = constructClaim({
    assertion: 'Adaptive signal control reduces peak-hour delay beyond the 8% SOTA gap.',
    claimId: CANONICAL_CLAIM_ID,
    now: FIXED_TS,
    falsifiability: {
      essentialDifference: 'control policy is adaptive (RL) rather than fixed-time',
      experimentToFalsify: 'Measure peak-hour delay under adaptive control vs a fixed-time baseline.',
    },
  })
  // Wire the claim + prediction into the shared context for downstream C-gates.
  ctx.runCtx.claimId = CANONICAL_CLAIM_ID
  ctx.runCtx.claimRef = CANONICAL_CLAIM_REF
  ctx.runCtx.predictionText = CANONICAL_PREDICTION
  return {
    claim: tagArtifact(artifact.claim, A2_PRODUCER, 'real_tool_fixture_input'),
    'falsifiable-prediction': tagArtifact(
      {
        text: CANONICAL_PREDICTION,
        ref: CANONICAL_CLAIM_ID,
        supportStatus: artifact.claim.supportStatus,
      },
      A2_PRODUCER,
      'real_tool_fixture_input',
    ),
  }
}

/** A3-agenda: fixture shaped as a research agenda + contribution list. */
function a3Executor(ctx: ExecCtx): Record<string, unknown> {
  const { claimRef, predictionText } = canonicalOf(ctx)
  const claim = readInput(ctx, 'claim')
  return {
    agenda: tagArtifact(
      {
        fixture: true,
        stepId: 'A3-agenda',
        slug: 'agenda',
        claimRef: (claim?.claimRef as string | undefined) ?? claimRef,
        phases: ['A 定位', 'B 构造', 'C 迭代', 'D 论证', 'E 落地'],
        plan: ['claim → method → data → baseline → mvp → trinity → boundary → figures → outline → writing → format → submit'],
        note: 'synthetic agenda fixture — no agenda/contribution-derivation tool exists',
      },
      A3_PRODUCER,
      'fixture_executor',
    ),
    'contribution-list': tagArtifact(
      {
        fixture: true,
        stepId: 'A3-agenda',
        slug: 'contribution-list',
        contributions: [
          {
            id: 'c1',
            claimRef,
            claim: 'adaptive control beats the fixed-time baseline on peak-hour delay',
            expectedEvidence: `delay reduction >= 8% (prediction: ${predictionText})`,
          },
        ],
        note: 'synthetic contribution list — claim-level, not yet literature-supported',
      },
      A3_PRODUCER,
      'fixture_executor',
    ),
  }
}

/** A4-venue: fixture shaped as a venue selection + scope match. */
function a4Executor(ctx: ExecCtx): Record<string, unknown> {
  const { claimRef } = canonicalOf(ctx)
  return {
    venue: tagArtifact(
      {
        fixture: true,
        stepId: 'A4-venue',
        slug: 'venue',
        venueId: SCENARIO.venueId,
        name: SCENARIO.venueName,
        claimRef,
        note: 'synthetic venue-scope record — NOT a real journal claim',
      },
      A4_PRODUCER,
      'fixture_executor',
    ),
    'venue-scope': tagArtifact(
      {
        fixture: true,
        stepId: 'A4-venue',
        slug: 'venue-scope',
        venueId: SCENARIO.venueId,
        matches: ['traffic signal control', 'empirical delay comparison', 'falsifiable experiment'],
        rejects: ['no falsifiable experiment'],
        note: 'synthetic scope-match fixture — venue acceptance patterns are not read for real',
      },
      A4_PRODUCER,
      'fixture_executor',
    ),
  }
}

/** B1-method: fixture shaped as a method spec + measurable predictions. */
function b1Executor(ctx: ExecCtx): Record<string, unknown> {
  const { claimRef, predictionText } = canonicalOf(ctx)
  return {
    'method-spec': tagArtifact(
      {
        fixture: true,
        stepId: 'B1-method',
        slug: 'method-spec',
        methodId: SCENARIO.variantIdentity,
        family: 'reinforcement-learning phase-plan policy (synthetic spec)',
        claimRef,
        derivedFrom: 'falsifiable-prediction',
        steps: ['observe intersection state', 'select phase plan', 'optimise delay'],
        metric: { name: SCENARIO.metric, direction: SCENARIO.metricDirection },
        note: 'synthetic method spec — no method-derivation tool exists',
      },
      B1_PRODUCER,
      'fixture_executor',
    ),
    'method-predictions': tagArtifact(
      {
        fixture: true,
        stepId: 'B1-method',
        slug: 'method-predictions',
        predictions: [{ id: 'p1', text: predictionText, adjudicatedBy: 'C1-mvp experiment (mock)' }],
        note: 'synthetic measurable-prediction set — must be adjudicable by the C1 experiment',
      },
      B1_PRODUCER,
      'fixture_executor',
    ),
  }
}

/** B2-data: fixture shaped as a dataset descriptor + profile. */
function b2Executor(ctx: ExecCtx): Record<string, unknown> {
  const method = readInput(ctx, 'method-spec')
  return {
    dataset: tagArtifact(
      {
        fixture: true,
        stepId: 'B2-data',
        slug: 'dataset',
        datasetId: SCENARIO.datasetId,
        version: 'v1',
        split: 'train',
        rows: 1200,
        source: 'synthetic',
        methodRef: (method?.methodId as string | undefined) ?? SCENARIO.variantIdentity,
        note: 'synthetic dataset descriptor — no data acquisition/profiling tool exists',
      },
      B2_PRODUCER,
      'fixture_executor',
    ),
    'data-profile': tagArtifact(
      {
        fixture: true,
        stepId: 'B2-data',
        slug: 'data-profile',
        datasetId: SCENARIO.datasetId,
        columns: [
          { name: 'delay_seconds', type: 'number' },
          { name: 'policy', type: 'categorical' },
        ],
        missingRate: 0.0,
        provenance: 'synthetic fixture (no real acquisition)',
        note: 'synthetic profile — data provenance is declared, not real',
      },
      B2_PRODUCER,
      'fixture_executor',
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
  return {
    'baseline-results': tagArtifact(
      {
        fixture: true,
        stepId: 'B3-baseline',
        slug: 'baseline-results',
        baseline: {
          identity: SCENARIO.baselineIdentity,
          protocol: 'measure delay under fixed-time control over the dataset split',
          metric: { name: SCENARIO.metric, direction: SCENARIO.metricDirection },
          datasetRef: (dataset?.datasetId as string | undefined) ?? SCENARIO.datasetId,
          methodRef: (method?.methodId as string | undefined) ?? SCENARIO.variantIdentity,
        },
        preRegistered: {
          baselineDelaySeconds: SCENARIO.baselineDelaySeconds,
          source: 'experiment fixture (mock)',
        },
        beatsBaselineWhen: 'variant delay < baseline delay by >= 8%',
        note: 'synthetic baseline protocol + pre-registered fixed-time reference row; NO model was run; ablation measurements are NOT part of baseline (they belong to C3-boundary)',
      },
      B3_PRODUCER,
      'fixture_executor',
    ),
    'sota-comparison': tagArtifact(
      {
        fixture: true,
        stepId: 'B3-baseline',
        slug: 'sota-comparison',
        targetMetric: SCENARIO.metric,
        rows: [
          { method: `${SCENARIO.baselineIdentity} (baseline)`, delaySeconds: SCENARIO.baselineDelaySeconds, source: 'pre-registered fixture' },
          { method: `${SCENARIO.variantIdentity} (candidate)`, delaySeconds: SCENARIO.variantDelaySeconds, expectedReductionRate: SCENARIO.reductionRate, source: 'experiment fixture mock-claim-001' },
        ],
        anchoring: 'none',
        sotaGapClaim: 'candidate must beat fixed-time by >= 8% (SOTA delay-reduction gap under adaptive control unverified)',
        note: 'synthetic SOTA comparison — the canonical B3-SOTA retrieval sub-task maps to the literature-search capability, whose synthetic corpus is off-domain this wave, so NO anchored SOTA row is recorded; external anchoring is exercised by the B-gate channel (T23)',
      },
      B3_PRODUCER,
      'fixture_executor',
    ),
  }
}

/** C1-mvp: the minimal experiment adjudicating the core prediction. Fixture that
 *  reads the SAME synthetic experiment fixture row the C-gate adjudicates, so the
 *  mvp artifact and the gate evidence are同源 (T19-S business coherence). */
function c1Executor(ctx: ExecCtx): Record<string, unknown> {
  const { claimId, claimRef, predictionText } = canonicalOf(ctx)
  const key = experimentFixtureKey(claimId, predictionText)
  const fx = lookupExperimentFixture(key)
  if (fx === undefined) {
    throw new Error(`C1-mvp: no experiment fixture row for key '${key}' — fail-closed (no experiment ⇒ no pass)`)
  }
  return {
    'mvp-results': tagArtifact(
      {
        fixture: true,
        stepId: 'C1-mvp',
        slug: 'mvp-results',
        claimRef,
        claimId,
        predictionText,
        experiment: {
          source: 'mock-fixture',
          ruleVersion: EXPERIMENT_FIXTURE_RULE_VERSION,
          key,
        },
        outcome: { supportsPrediction: fx.supportsPrediction, detail: fx.detail },
        observed: {
          baselineDelaySeconds: SCENARIO.baselineDelaySeconds,
          variantDelaySeconds: SCENARIO.variantDelaySeconds,
          reductionRate: SCENARIO.reductionRate,
        },
        note: 'mvp-results derived from the SAME synthetic experiment fixture row the C-gate adjudicates — mock-verified only, never real experiment support',
      },
      C1_PRODUCER,
      'fixture_executor',
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
  const mvpOutcome = mvp?.outcome as { supportsPrediction?: unknown } | undefined
  const baselineRec = baseline?.baseline as { identity?: unknown } | undefined
  return {
    'converged-verdict': tagArtifact(
      {
        fixture: true,
        stepId: 'C2-trinity-loop',
        slug: 'converged-verdict',
        claimRef,
        predictionText,
        baselineRef: baselineRec?.identity ?? SCENARIO.baselineIdentity,
        experimentRef: mvpOutcome?.supportsPrediction ?? true,
        verdict: 'converged (mock dossier)',
        note: 'convergence dossier only — the A/B/C gate verdicts are produced by the REAL trinity channels in verdict.ts, never by this fixture',
      },
      C2_PRODUCER,
      'fixture_executor',
    ),
  }
}

/** The C3-boundary ablation definition: adaptive-rl variant vs fixed-time
 *  baseline, delay metric, 4 repetitions (real tool over a synthetic executor). */
const ABLATION_DEFINITION: AblationDefinition = {
  baselineIdentity: 'fixed-time',
  variantIdentity: 'adaptive-rl',
  removedOrReplacedComponents: [
    { component: 'phase-plan', action: 'replaced', replacement: 'adaptive-rl' },
  ],
  dataset: { version: 'v1', split: 'train', seed: 7 },
  metric: { name: 'delay', direction: 'lower_is_better' },
  repetitions: 4,
}

/** C3-boundary: real `runAblation` — boundary probing (variant vs baseline).
 *  Ablation lives HERE (canonical C3), not in B3-baseline (T19-S fix). */
function c3Executor(ctx: ExecCtx): Record<string, unknown> {
  const verdict = readInput(ctx, 'converged-verdict')
  const artifact = runAblation(ABLATION_DEFINITION, createMockAblationExecutor(), FIXED_TS)
  return {
    'ablation-results': tagArtifact(
      {
        ranRuns: artifact.runs.length,
        counts: artifact.counts,
        aggregate: artifact.aggregate,
        convergedRef: (verdict?.verdict as string | undefined) ?? 'converged (mock dossier)',
        note: 'ablation-results produced by a REAL runAblation execution over SYNTHETIC mock measurements — boundary probing belongs to C3, not B3',
      },
      C3_PRODUCER,
      'real_tool_fixture_input',
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
        note: 'boundary-map derived from the REAL runAblation execution over SYNTHETIC mock measurements — never a real applicability claim',
      },
      C3_PRODUCER,
      'real_tool_fixture_input',
    ),
  }
}

/** D1-figure-map: real renders for ALL THREE figure families its canonical
 *  purpose names (数据图/三线表/路线图). figure-plan lists each figure with the
 *  evidence produced by its real tool execution. */
function d1Executor(): Record<string, unknown> {
  const figure = renderFigure(
    {
      kind: 'bar',
      title: 'Peak-hour Delay by Control Policy (synthetic)',
      width: 320,
      height: 240,
      series: [{ name: 'delay (s)', values: [SCENARIO.variantDelaySeconds, SCENARIO.baselineDelaySeconds] }],
      tokens: { palette: ['#1f77b4'] },
      seed: 7,
    },
    FIXED_TS,
  )
  const table = renderThreeLineTable(
    {
      title: 'Peak-hour Delay Comparison (synthetic)',
      columns: [
        { header: 'Method', decimals: 0 },
        { header: 'Delay (s)', decimals: 2, metricDirection: 'lower-is-better' },
      ],
      rows: [
        [
          { kind: 'text', text: 'Adaptive' },
          { kind: 'number', value: SCENARIO.variantDelaySeconds },
        ],
        [
          { kind: 'text', text: 'Fixed-time' },
          { kind: 'number', value: SCENARIO.baselineDelaySeconds },
        ],
      ],
    },
    'markdown',
    FIXED_TS,
  )
  const roadmapGraph: RoadmapGraph = {
    nodes: [
      { id: 'baseline-input', label: 'Fixed-time baseline', kind: 'input' },
      { id: 'adaptive-policy', label: 'Adaptive RL policy', kind: 'process' },
      { id: 'delay-experiment', label: 'Delay experiment (C1)', kind: 'gate' },
      { id: 'reduction-outcome', label: 'Delay reduction >= 8%', kind: 'output' },
    ],
    edges: [
      { from: 'baseline-input', to: 'delay-experiment', label: 'baseline' },
      { from: 'adaptive-policy', to: 'delay-experiment', label: 'variant' },
      { from: 'delay-experiment', to: 'reduction-outcome', label: 'verdict' },
    ],
  }
  const roadmap = renderRoadmap(
    roadmapGraph,
    { format: 'mermaid', title: 'Adaptive Control Research Roadmap' },
    FIXED_TS,
  )
  return {
    'figure-plan': tagArtifact(
      {
        figures: [
          {
            kind: 'data-figure',
            toolId: FIGURE_TOOL_ID,
            svgByteLength: figure.svg.byteLength,
            pngByteLength: figure.png.byteLength,
            svgPreview: figure.svg.content.slice(0, 80),
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
            contentPreview: roadmap.content.slice(0, 80),
          },
        ],
        totalFigures: 3,
        note: 'figure-plan derived from REAL figure + three-line-table + roadmap tool executions over synthetic content — 数据图/三线表/路线图 all wired (canonical D1)',
      },
      D1_PRODUCER,
      'real_tool_fixture_input',
    ),
  }
}

/** D2-framework: fixture shaped as a real paper outline derived from the claim +
 *  agenda + converged verdict (upstream references in `covers`). */
function d2Executor(ctx: ExecCtx): Record<string, unknown> {
  const { claimRef } = canonicalOf(ctx)
  const agenda = readInput(ctx, 'agenda')
  const verdict = readInput(ctx, 'converged-verdict')
  const outline: ReadonlyArray<OutlineSection & { covers: ReadonlyArray<string> }> = [
    { id: 'abstract', heading: 'Abstract', covers: [] },
    { id: 'introduction', heading: 'Introduction', covers: ['claim', 'gap'] },
    { id: 'method', heading: 'Method', covers: ['method-spec'] },
    { id: 'experiments', heading: 'Experiments', covers: ['baseline', 'mvp', 'ablation'] },
    { id: 'results', heading: 'Results', covers: ['figures', 'tables', 'roadmap'] },
    { id: 'conclusion', heading: 'Conclusion', covers: ['converged-verdict'] },
    { id: 'references', heading: 'References', covers: ['landscape'] },
  ]
  return {
    'paper-outline': tagArtifact(
      {
        fixture: true,
        stepId: 'D2-framework',
        slug: 'paper-outline',
        title: SCENARIO.title,
        claimRef,
        agendaRef: (agenda?.claimRef as string | undefined) ?? claimRef,
        convergenceRef: (verdict?.verdict as string | undefined) ?? 'converged (mock dossier)',
        sections: outline,
        note: 'synthetic paper outline — sections mirror the canonical manuscript skeleton; roadmap tooling is exercised at D1 (figure families)',
      },
      D2_PRODUCER,
      'fixture_executor',
    ),
  }
}

/** D3-writing: fixture draft whose sections mirror the D2 outline ids, with
 *  deterministic body text + a landscape-derived reference list. */
function d3Executor(ctx: ExecCtx): Record<string, unknown> {
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
  const sections: ManuscriptSection[] = ids.map((id, index) => {
    const heading =
      Array.isArray(rawOutline) && typeof (rawOutline[index] as { heading?: unknown } | undefined)?.heading === 'string'
        ? ((rawOutline[index] as { heading: string }).heading)
        : DEFAULT_OUTLINE.find(d => d.id === id)?.heading ?? id
    return { id, heading, bodyText: bodyTextFor(id) }
  })
  return {
    draft: tagArtifact(
      {
        fixture: true,
        stepId: 'D3-writing',
        slug: 'draft',
        title: SCENARIO.title,
        claimRef,
        sections,
        figureRef: figures ?? 0,
        landscapeRef: hitCount ?? 0,
        note: 'synthetic manuscript draft — sections mirror the D2 outline ids; no drafting model call in this wave',
      },
      D3_PRODUCER,
      'fixture_executor',
    ),
  }
}

/** D4-rebuttal: fixture that reads the D3 draft, produces an adversarial rebuttal
 *  record and a revised draft (same sections, revision markers). */
function d4Executor(ctx: ExecCtx): Record<string, unknown> {
  const { claimRef } = canonicalOf(ctx)
  const draft = readInput(ctx, 'draft')
  const sections = sectionsOf(draft)
  const revised: ManuscriptSection[] = sections.map(s => ({
    ...s,
    bodyText: `${s.bodyText} [revised: rebuttal addressed]`,
  }))
  return {
    rebuttal: tagArtifact(
      {
        fixture: true,
        stepId: 'D4-rebuttal',
        slug: 'rebuttal',
        roundId: 't19s-rebuttal-1',
        claimRef,
        exchanges: [
          {
            challenge: 'Is the 9.1% delay reduction robust to the boundary conditions?',
            defense: 'Boundary probing at C3 (real ablation runs over mock measurements) delimits the applicability domain.',
          },
          {
            challenge: 'Are the SOTA anchors real?',
            defense: 'No — anchoring is exercised by the B-gate (T23) and stays synthetic this wave; the manuscript marks it accordingly.',
          },
        ],
        note: 'synthetic rebuttal fixture — no rebuttal-revision model tool exists',
      },
      D4_PRODUCER,
      'fixture_executor',
    ),
    'revised-draft': tagArtifact(
      {
        fixture: true,
        stepId: 'D4-rebuttal',
        slug: 'revised-draft',
        title: SCENARIO.title,
        claimRef,
        sections: revised,
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
function e1Executor(ctx: ExecCtx): Record<string, unknown> {
  const venue = readInput(ctx, 'venue')
  const venueScope = readInput(ctx, 'venue-scope')
  const revised = readInput(ctx, 'revised-draft')
  const venueName = typeof venue?.name === 'string' ? venue.name : SCENARIO.venueName
  const venueId = typeof venue?.venueId === 'string' ? venue.venueId : SCENARIO.venueId
  const rawMatches = venueScope?.matches
  const scopeMatches = Array.isArray(rawMatches)
    ? rawMatches.filter((m): m is string => typeof m === 'string')
    : []
  const sections = sectionsOf(revised)

  // Real three-line-table sub-capability: the manuscript results table.
  const artifact = renderThreeLineTable(
    {
      title: 'Peak-hour Delay Comparison (synthetic)',
      columns: [
        { header: 'Method', decimals: 0 },
        { header: 'Delay (s)', decimals: 2, metricDirection: 'lower-is-better' },
      ],
      rows: [
        [
          { kind: 'text', text: 'Adaptive' },
          { kind: 'number', value: SCENARIO.variantDelaySeconds },
        ],
        [
          { kind: 'text', text: 'Fixed-time' },
          { kind: 'number', value: SCENARIO.baselineDelaySeconds },
        ],
      ],
    },
    'markdown',
    FIXED_TS,
  )

  const body = sections.map(s => `## ${s.heading}\n\n${s.bodyText}`).join('\n\n')
  const scopeLine = scopeMatches.length > 0 ? `Scope match: ${scopeMatches.join('; ')}.` : ''
  const manuscript = [
    `# ${SCENARIO.title}`,
    `Submission venue: ${venueName} (${venueId})`,
    '',
    body,
    '## Experiment Tables',
    '',
    artifact.render.text,
    '## References',
    '',
    '- L0-filtered references placeholder (synthetic).',
    '',
    '> Reproducibility: package manifest declared below (synthetic contents).',
  ].join('\n')

  return {
    'formatted-manuscript': tagArtifact(
      {
        title: SCENARIO.title,
        venueName,
        venueId,
        venueStyle: `${venueName} template (synthetic)`,
        scopeLine,
        manuscript,
        sectionHeadings: sections.map(s => s.heading),
        tableMarkdown: artifact.render.text,
        bindingHash: artifact.bindingHash,
        reproduciblePackage: {
          files: ['manuscript.md', 'experiment-tables.md', 'figures/figure-1.svg', 'roadmap.md', 'run-manifest.json'],
          note: 'declared reproducible package — synthetic contents; real package export is a later wave',
        },
        note: 'formatted-manuscript ASSEMBLED by the E1-format executor from the revised draft + venue scope; the results table is rendered by the REAL renderThreeLineTable sub-capability — the tool is E1\'s table capability, not the format step itself',
      },
      E1_PRODUCER,
      'real_tool_fixture_input',
    ),
  }
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
  readonly kind: Truthfulness
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
    basis: 'the REAL `runLiteratureSearch` tool function executes; its corpus is the synthetic `mockLiteratureSearchAdapter` (fixture input). Real code path, synthetic data — NOT real literature evidence',
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
    kind: 'fixture_executor',
    basis: 'no venue scope-matching tool exists; the executor emits a deterministic synthetic venue + scope-match record (NOT a real journal claim)',
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
    kind: 'fixture_executor',
    basis: 'no dataset acquisition/profiling tool exists; the executor emits a deterministic synthetic dataset descriptor + profile with declared (non-real) provenance',
    producer: B2_PRODUCER,
    timeoutMs: FIXTURE_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: b2Executor,
  },
  {
    stepId: 'B3-baseline',
    kind: 'fixture_executor',
    basis: 'T19-S: baseline = establish the baseline AND compare against SOTA (canonical B3-SOTA retrieval sub-task maps to the literature-search capability, whose synthetic corpus is off-domain this wave — it can anchor NO traffic-signal SOTA). Ablation is NOT a baseline capability and was moved to C3-boundary. The executor emits a deterministic synthetic baseline protocol + zero-anchor SOTA comparison note',
    producer: B3_PRODUCER,
    timeoutMs: FIXTURE_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: b3Executor,
  },
  {
    stepId: 'C1-mvp',
    kind: 'fixture_executor',
    basis: 'no experiment runtime is wired; the executor reads the SAME synthetic experiment fixture row the C-gate adjudicates and emits mvp-results (mock-verified only, never real experiment support)',
    producer: C1_PRODUCER,
    timeoutMs: FIXTURE_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: c1Executor,
  },
  {
    stepId: 'C2-trinity-loop',
    kind: 'fixture_executor',
    basis: 'no convergence-loop driver exists; the executor emits a deterministic convergence dossier while the step\'s A+B+C GATE is adjudicated by the genuine trinity channels (see VERDICT_CHANNELS)',
    producer: C2_PRODUCER,
    timeoutMs: FIXTURE_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: c2Executor,
  },
  {
    stepId: 'C3-boundary',
    kind: 'real_tool_fixture_input',
    basis: 'T19-S: boundary probing belongs to C3. The REAL `runAblation` tool function executes (plan → executor seam → per-variant descriptive stats) with the injected synthetic `createMockAblationExecutor()`; no real model was run. Ablation is NOT exercised at B3 anymore',
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
    kind: 'fixture_executor',
    basis: 'no outline-synthesis tool exists; the executor emits a deterministic synthetic paper outline whose sections mirror the canonical manuscript skeleton (roadmap tooling is exercised at D1)',
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
    kind: 'fixture_executor',
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
 *    synthetic complete rebuttal round (fixture input).
 *  - B: the REAL core `verifyCitation` identity chain runs against the SIMULATED
 *    `MockCitationResolverAdapter`, with the claim stance taken from the T23
 *    synthetic anchor fixture → core `adjudicate('B')`. Real adapter logic +
 *    mocked external system.
 *  - C: the REAL team `adjudicateClaimSupport` → core `adjudicate('C')` runs over
 *    a `mock-fixture` experiment report from the synthetic experiment table.
 */
export const VERDICT_CHANNELS: Readonly<Record<TrinityComponent, { kind: Truthfulness; basis: string }>> = {
  A: {
    kind: 'real_tool_fixture_input',
    basis: 'team judgeRound → core adjudicate(\'A\') executes for real; the rebuttal round votes are synthetic fixture input',
  },
  B: {
    kind: 'mock_external',
    basis: 'core verifyCitation identity chain executes against MockCitationResolverAdapter (simulated external resolver); stance comes from the T23 synthetic anchor fixture → core adjudicate(\'B\')',
  },
  C: {
    kind: 'mock_external',
    basis: 'team adjudicateClaimSupport → core adjudicate(\'C\') executes for real over a mock-fixture experiment report (evidenceGrade stays mock-verified)',
  },
}

/** Convenience: the canonical claim/prediction constants used by executors + verdicts. */
export const CANONICAL = {
  claimId: CANONICAL_CLAIM_ID,
  claimRef: CANONICAL_CLAIM_REF,
  prediction: CANONICAL_PREDICTION,
} as const

export type { StepDefinition }
