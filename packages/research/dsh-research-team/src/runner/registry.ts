// @deepseek-ai/dsh-research-team — T19-B executor registry (real-tool integration).
//
// The single, auditable map of every one of the 16 pipeline steps → its executor
// + the truthfulness classification of that executor + the full per-step
// declaration required by the T19-B task book:
//
//   stepId | executor | producer | input schema | output schema | artifact type
//          | truthfulness level | timeout | gate requirement | recovery policy
//
// The step graph itself is NOT duplicated here: `inputSchema` / `outputSchema` /
// `gateRequirement` are DERIVED from the core public accessor
// `getStepDefinitions()` at module load, so the registry can never drift from
// the frozen 16-step definition owned by core.
//
// ── Truthfulness levels (tonight's 4-level ruling; supersedes the old 3-level
//    'real_tool' | 'fixture' | 'mock_external' scheme) ─────────────────────────
//  - `real_tool_fixture_input` : the REAL tool function executes; its INPUT is a
//    synthetic fixture. Honest reading: "the code really ran", NOT "this is real
//    science". Reports must never call this real research verification.
//  - `fixture_executor`        : the whole executor is a deterministic fixture —
//    no tool is implemented for this step yet.
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
import type { AblationDefinition } from '@deepseek-ai/dsh-research-tools'
import {
  ABLATION_TOOL_ID,
  ABLATION_TOOL_VERSION,
  CLAIM_CONSTRUCT_TOOL_ID,
  CLAIM_CONSTRUCT_TOOL_VERSION,
  FIGURE_TOOL_ID,
  FIGURE_TOOL_VERSION,
  LITERATURE_SEARCH_TOOL_ID,
  LITERATURE_SEARCH_TOOL_VERSION,
  THREE_LINE_TABLE_TOOL_ID,
  THREE_LINE_TABLE_TOOL_VERSION,
  constructClaim,
  createMockAblationExecutor,
  mockLiteratureSearchAdapter,
  renderFigure,
  renderThreeLineTable,
  runAblation,
  runLiteratureSearch,
} from '@deepseek-ai/dsh-research-tools'

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
  /** Producer brand, e.g. 'literature-search@0.1.2-alpha.4' or 'fixture:landscape'. */
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

// ── Producer brands (read from the tools' own id/version constants) ─────────────
const A1_PRODUCER = `${LITERATURE_SEARCH_TOOL_ID}@${LITERATURE_SEARCH_TOOL_VERSION}`
const A2_PRODUCER = `${CLAIM_CONSTRUCT_TOOL_ID}@${CLAIM_CONSTRUCT_TOOL_VERSION}`
const B3_PRODUCER = `${ABLATION_TOOL_ID}@${ABLATION_TOOL_VERSION}`
const D1_PRODUCER = `${FIGURE_TOOL_ID}@${FIGURE_TOOL_VERSION}`
const E1_PRODUCER = `${THREE_LINE_TABLE_TOOL_ID}@${THREE_LINE_TABLE_TOOL_VERSION}`

// Canonical claim + prediction that matches a KEEP-path row in the team's
// experiment fixture table (`experiment/fixture.ts`) so the C-channel adjudicates
// to `passed` on the happy path.
const CANONICAL_CLAIM_ID = 'mock-claim-001'
const CANONICAL_CLAIM_REF = 'adaptive signal control reduces peak-hour delay'
const CANONICAL_PREDICTION = 'peak-hour delay falls by at least 8% under adaptive control'

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
  'baseline-results': 'ablation-measurement-set',
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

const B3_DEFINITION: AblationDefinition = {
  baselineIdentity: 'fixed-time',
  variantIdentity: 'adaptive-rl',
  removedOrReplacedComponents: [
    { component: 'phase-plan', action: 'replaced', replacement: 'adaptive-rl' },
  ],
  dataset: { version: 'v1', split: 'train', seed: 7 },
  metric: { name: 'delay', direction: 'lower_is_better' },
  repetitions: 4,
}

/** B3-baseline: real `runAblation` with the injected mock (synthetic) executor. */
function b3Executor(): Record<string, unknown> {
  const artifact = runAblation(B3_DEFINITION, createMockAblationExecutor(), FIXED_TS)
  return {
    'baseline-results': tagArtifact(
      {
        ranRuns: artifact.runs.length,
        counts: artifact.counts,
        aggregate: artifact.aggregate,
        note: 'baseline-results produced by a REAL runAblation execution over SYNTHETIC mock measurements — not a real model run',
      },
      B3_PRODUCER,
      'real_tool_fixture_input',
    ),
    'sota-comparison': tagArtifact(
      {
        baseline: B3_DEFINITION.baselineIdentity,
        variant: B3_DEFINITION.variantIdentity,
        metric: B3_DEFINITION.metric.name,
        note: 'synthetic SOTA comparison note — runAblation never emits a delta/causal conclusion',
      },
      B3_PRODUCER,
      'real_tool_fixture_input',
    ),
  }
}

/** D1-figure-map: real `renderFigure` producing byte-valid SVG + PNG. */
function d1Executor(): Record<string, unknown> {
  const artifact = renderFigure(
    {
      kind: 'bar',
      title: 'Convergence Trace',
      width: 320,
      height: 240,
      series: [{ name: 'ablation', values: [3, 7, 5, 9, 6] }],
      tokens: { palette: ['#1f77b4'] },
      seed: 7,
    },
    FIXED_TS,
  )
  return {
    'figure-plan': tagArtifact(
      {
        svgByteLength: artifact.svg.byteLength,
        pngByteLength: artifact.png.byteLength,
        svgPreview: String(artifact.svg.content).slice(0, 80),
        note: 'figure-plan derived from a REAL renderFigure SVG+PNG artifact over synthetic series values',
      },
      D1_PRODUCER,
      'real_tool_fixture_input',
    ),
  }
}

/** E1-format: real `renderThreeLineTable` rendering the manuscript results table. */
function e1Executor(): Record<string, unknown> {
  const artifact = renderThreeLineTable(
    {
      title: 'Peak-hour Delay (synthetic table data)',
      columns: [
        { header: 'Method', decimals: 0 },
        { header: 'Delay (s)', decimals: 1, metricDirection: 'lower-is-better' },
      ],
      rows: [
        [
          { kind: 'text', text: 'Adaptive' },
          { kind: 'number', value: 7.2 },
        ],
        [
          { kind: 'text', text: 'Fixed-time' },
          { kind: 'number', value: 9.1 },
        ],
      ],
    },
    'markdown',
    FIXED_TS,
  )
  return {
    'formatted-manuscript': tagArtifact(
      {
        tableMarkdown: artifact.render.text,
        bindingHash: artifact.bindingHash,
        note: 'formatted-manuscript rendered by a REAL renderThreeLineTable execution over SYNTHETIC table data',
      },
      E1_PRODUCER,
      'real_tool_fixture_input',
    ),
  }
}

/** Default deterministic fixture executor for any step without a real tool. */
function fixtureExecutor(
  stepId: string,
  label: string,
  slugs: ReadonlyArray<string>,
): StepExecutorFn {
  const producer = `fixture:${label}`
  return () => {
    const out: Record<string, unknown> = {}
    for (const slug of slugs) {
      out[slug] = tagArtifact(
        {
          fixture: true,
          stepId,
          slug,
          note: 'synthetic E2E fixture artifact — NOT real literature/science/model output',
        },
        producer,
        'fixture_executor',
      )
    }
    return out
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
  readonly executor?: StepExecutorFn
  readonly humanGateStop?: boolean
  readonly fixtureLabel?: string
}

const REAL_TOOL_TIMEOUT_MS = 5_000
const FIXTURE_TIMEOUT_MS = 2_000

function fixtureSpec(stepId: string, label: string, why: string): EntrySpec {
  return {
    stepId,
    kind: 'fixture_executor',
    basis: `no tool is implemented for this step yet — ${why}; the executor emits a deterministic synthetic artifact and is never presented as real research output`,
    producer: `fixture:${label}`,
    timeoutMs: FIXTURE_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    fixtureLabel: label,
  }
}

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
  fixtureSpec('A3-agenda', 'agenda', 'no agenda/contribution derivation tool exists'),
  fixtureSpec('A4-venue', 'venue', 'no venue scope-matching tool exists'),
  fixtureSpec('B1-method', 'method', 'no method-derivation tool exists'),
  fixtureSpec('B2-data', 'data', 'no dataset acquisition/profiling tool exists'),
  {
    stepId: 'B3-baseline',
    kind: 'real_tool_fixture_input',
    basis: 'the REAL `runAblation` tool function executes (plan → executor seam → per-variant descriptive stats); measurements come from the injected synthetic `createMockAblationExecutor()`. No real model was run',
    producer: B3_PRODUCER,
    timeoutMs: REAL_TOOL_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: b3Executor,
  },
  fixtureSpec('C1-mvp', 'mvp', 'no experiment runtime is wired'),
  fixtureSpec(
    'C2-trinity-loop',
    'trinity-loop',
    'no convergence-loop driver exists; note that this step\'s A+B+C GATE is adjudicated by the genuine trinity channels (see VERDICT_CHANNELS)',
  ),
  fixtureSpec('C3-boundary', 'boundary', 'no boundary-probing tool exists'),
  {
    stepId: 'D1-figure-map',
    kind: 'real_tool_fixture_input',
    basis: 'the REAL `renderFigure` tool function executes and emits a byte-valid SVG + PNG; the plotted series are synthetic values',
    producer: D1_PRODUCER,
    timeoutMs: REAL_TOOL_TIMEOUT_MS,
    recoveryPolicy: 'rollback_and_retry',
    executor: d1Executor,
  },
  fixtureSpec('D2-framework', 'framework', 'no outline-synthesis tool exists'),
  fixtureSpec('D3-writing', 'writing', 'no drafting tool exists (no model call in this wave)'),
  fixtureSpec('D4-rebuttal', 'rebuttal', 'no rebuttal-revision tool exists'),
  {
    stepId: 'E1-format',
    kind: 'real_tool_fixture_input',
    basis: 'the REAL `renderThreeLineTable` tool function executes and emits the manuscript results table (markdown, exactly 3 rules) with a binding hash; the table data is synthetic',
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
    const executor =
      spec.executor ?? fixtureExecutor(spec.stepId, spec.fixtureLabel ?? spec.stepId, def.outputs)
    map.set(spec.stepId, {
      stepId: spec.stepId,
      kind: spec.kind,
      basis: spec.basis,
      producer: spec.producer,
      executor,
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

/** The authoritative 16-step executor registry (spec §1/§2 + tonight's fields). */
export const STEP_EXECUTOR_REGISTRY: ReadonlyMap<string, StepExecutorEntry> = buildRegistry()

/** The 16 core step definitions in canonical execution order (deep-frozen clones). */
export const PIPELINE_STEPS: ReadonlyArray<StepDefinition> = STEP_DEFS

/** Step → declared output slugs (convenience projection for reports/tests). */
export const STEP_OUTPUT_MAP: Readonly<Record<string, ReadonlyArray<string>>> = Object.fromEntries(
  STEP_DEFS.map(d => [d.id, d.outputs]),
)

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
