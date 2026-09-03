// @deepseek-ai/dsh-research-tools — T15 ablation (消融实验定义+执行适配+结果审计), public entry.
//
// PURE tool function: given an ablation {@link AblationDefinition} + an
// injected {@link AblationExecutor} + a caller-provided timestamp, return a
// DEEPLY FROZEN {@link AblationArtifact} that records what was planned, what
// the executor reported per run, and per-variant descriptive statistics of
// EXECUTED runs only. No model runs, no network, no filesystem, no clocks, no
// hidden IO, no engine/state-machine logic (P2 rule 4) and no real evaluation
// runner — evaluation runs enter ONLY through the injected executor (this wave
// ships the fixture mock in ./mock.ts with SYNTHETIC data only).
//
// Frozen T15 scope invariants (see D:\1\plan\final_execution_plan.md §T12-T18):
//  - MEASUREMENTS ONLY, NEVER CONCLUSIONS: the artifact reports descriptive
//    statistics per arm and never emits a baseline-vs-variant difference, an
//    effect size, a causal statement, or a "which is better" judgment. There
//    is deliberately no comparison/conclusion field — ordinary metric
//    differences must not be dressed up as causal evidence, and the artifact
//    is structurally incapable of it.
//  - EXECUTOR EXACTLY ONCE: runAblation calls executor.execute(...) once with
//    an immutable request carrying a frozen snapshot of the validated
//    definition. Executor output is validated structurally but never
//    re-interpreted into conclusions.
//  - RUN STATUSES ARE A DISCRIMINATED UNION: every run carries one of
//    'planned' | 'executed' | 'failed' | 'partial' plus its input origin,
//    arm identity, repetition index and seed.
//  - AGGREGATE OVER EXECUTED RUNS ONLY: mean + population stddev per arm;
//    planned/failed/partial runs are excluded, and when NO run executed the
//    artifact emits a distinct empty-aggregate state instead of fake zeros.
//  - ERROR BASE + TRANSPARENCY: {@link AblationError} for invalid input and
//    structurally-invalid executor output; an executor that THROWS is
//    surfaced as-is (never swallowed, never remapped to an 'empty' answer).

import type { ToolArtifactMeta } from '../../shared.ts'
import { freezeArtifact } from '../../shared.ts'
import {
  ablationRunKey,
  ablationRunSeed,
  ABLATION_RUN_ORIGIN,
  ABLATION_VARIANT_KINDS,
} from './adapter.ts'
import type {
  AblationComponentChange,
  AblationDefinition,
  AblationExecutor,
  AblationMetricDirection,
  AblationRunRequest,
  AblationVariantKind,
} from './adapter.ts'

/** Stable tool id used in every artifact's meta. */
export const ABLATION_TOOL_ID = 'ablation'

/** Version of this tool's artifact schema / implementation. Kept in lockstep
 *  with the package version (0.1.2-alpha.4 at the time of writing). */
export const ABLATION_TOOL_VERSION = '0.1.2-alpha.4'

/** Globally unique, grep-able error-code prefix for this tool. */
export const ABLATION_ERROR_PREFIX = 'DSH_ABLATION_'

/** Error codes thrown by {@link runAblation}. */
export type AblationErrorCode =
  | 'DSH_ABLATION_INVALID_DEFINITION'
  | 'DSH_ABLATION_INVALID_BASELINE_IDENTITY'
  | 'DSH_ABLATION_INVALID_VARIANT_IDENTITY'
  | 'DSH_ABLATION_INVALID_COMPONENT_CHANGES'
  | 'DSH_ABLATION_INVALID_COMPONENT_ENTRY'
  | 'DSH_ABLATION_INVALID_COMPONENT_NAME'
  | 'DSH_ABLATION_INVALID_COMPONENT_ACTION'
  | 'DSH_ABLATION_INVALID_COMPONENT_REPLACEMENT'
  | 'DSH_ABLATION_INVALID_DATASET'
  | 'DSH_ABLATION_INVALID_DATASET_VERSION'
  | 'DSH_ABLATION_INVALID_DATASET_SPLIT'
  | 'DSH_ABLATION_INVALID_DATASET_SEED'
  | 'DSH_ABLATION_INVALID_METRIC'
  | 'DSH_ABLATION_INVALID_METRIC_NAME'
  | 'DSH_ABLATION_INVALID_METRIC_DIRECTION'
  | 'DSH_ABLATION_INVALID_REPETITIONS'
  | 'DSH_ABLATION_MISSING_EXECUTOR'
  | 'DSH_ABLATION_INVALID_TIMESTAMP'
  | 'DSH_ABLATION_INVALID_ADAPTER_OUTPUT'
  | 'DSH_ABLATION_ADAPTER_FAULT'

/** Error thrown on invalid tool input or structurally-invalid executor output.
 *  Executor exceptions themselves are surfaced as-is, NOT wrapped here. */
export class AblationError extends Error {
  readonly code: AblationErrorCode

  constructor(code: AblationErrorCode, message: string) {
    super(`[${code}] ${message}`)
    this.name = 'AblationError'
    this.code = code
  }
}

// ── Artifact types ─────────────────────────────────────────────────────────

/** Fixed fields shared by every run record. */
export interface AblationRunRecordBase {
  /** Stable run key (`ablationRunKey(variant, repetitionIndex)`). */
  readonly key: string
  /** Input source of this run — where the planned run came from. */
  readonly origin: 'definition'
  /** Which arm this run belongs to. */
  readonly variant: AblationVariantKind
  /** The arm's identity from the definition echo (baseline or variant id). */
  readonly identity: string
  /** 0-based repetition of the arm this run is. */
  readonly repetitionIndex: number
  /** Deterministic seed assigned to this run (`dataset.seed + repetition`). */
  readonly seed: number
}

export type AblationPlannedRun = AblationRunRecordBase & { readonly status: 'planned' }
export type AblationExecutedRun = AblationRunRecordBase & {
  readonly status: 'executed'
  /** ONE usable measurement for this completed run. Present ONLY on
   *  'executed' records — failed/partial runs carry no measurement at all. */
  readonly measurement: number
}
export type AblationFailedRun = AblationRunRecordBase & {
  readonly status: 'failed'
  /** Why the executor declared the run failed (audit text; never a model
   *  judgment by this tool). */
  readonly reason: string
}
export type AblationPartialRun = AblationRunRecordBase & {
  readonly status: 'partial'
  /** Why the executor declared the run partial (audit text). */
  readonly reason: string
}

/** A single planned-or-reported run. Explicit discriminated union on `status`
 *  so the artifact can never conflate the four run states. */
export type AblationRunRecord =
  | AblationPlannedRun
  | AblationExecutedRun
  | AblationFailedRun
  | AblationPartialRun

/** Audit counts of the four run states (must match `runs`). */
export interface AblationRunCounts {
  /** Runs planned but never executed (executor reported nothing for them). */
  readonly planned: number
  readonly executed: number
  readonly failed: number
  readonly partial: number
}

/** Per-arm descriptive aggregate. `aggregated` carries ONLY a mean and a
 *  dispersion measure (population stddev) over that arm's EXECUTED runs —
 *  no difference, no effect, no conclusion. */
export type AblationVariantMeasure =
  | {
    readonly variant: AblationVariantKind
    readonly identity: string
    readonly status: 'no-executed-runs'
  }
  | {
    readonly variant: AblationVariantKind
    readonly identity: string
    readonly status: 'aggregated'
    readonly executedRuns: number
    readonly mean: number
    readonly stddev: number
  }

/** Top-level aggregation state. When NOTHING executed across the whole
 *  ablation the artifact emits `state: 'no-executed-runs'` and nothing else —
 *  a distinct empty state, never fake zeros and never a conclusion. */
export type AblationAggregate =
  | {
    readonly state: 'no-executed-runs'
  }
  | {
    readonly state: 'per-variant'
    readonly variants: ReadonlyArray<AblationVariantMeasure>
  }

/** Frozen artifact of one ablation run (produced via freezeArtifact).
 *  `definition` is an echo of the validated input (data provenance);
 *  `runs` + `counts` + `aggregate` are the audit/measurement report. */
export interface AblationArtifact {
  readonly meta: ToolArtifactMeta
  readonly definition: AblationDefinition
  readonly runs: ReadonlyArray<AblationRunRecord>
  readonly counts: AblationRunCounts
  readonly aggregate: AblationAggregate
}

// ── Validation ─────────────────────────────────────────────────────────────

function invalidDefinitionError(detail: string): never {
  throw new AblationError(
    'DSH_ABLATION_INVALID_DEFINITION',
    `runAblation: definition must be a non-null object — ${detail}`,
  )
}

function adapterFault(detail: string): never {
  throw new AblationError(
    'DSH_ABLATION_ADAPTER_FAULT',
    `runAblation: executor returned a structurally invalid run result — ${detail} (adapter fault; never mapped to a measurement)`,
  )
}

function invalidAdapterOutput(detail: string): never {
  throw new AblationError(
    'DSH_ABLATION_INVALID_ADAPTER_OUTPUT',
    `runAblation: executor returned structurally invalid output — ${detail} (adapter fault; NOT an execution verdict)`,
  )
}

/** Validate one component-change entry and return its normalized form. */
function normalizeComponentChange(
  entry: AblationComponentChange,
  index: number,
): AblationComponentChange {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new AblationError(
      'DSH_ABLATION_INVALID_COMPONENT_ENTRY',
      `runAblation: removedOrReplacedComponents[${index}] must be a non-null object {component, action, replacement?}`,
    )
  }
  const component = (entry as { component?: unknown }).component
  if (typeof component !== 'string' || component.trim().length === 0) {
    throw new AblationError(
      'DSH_ABLATION_INVALID_COMPONENT_NAME',
      `runAblation: removedOrReplacedComponents[${index}].component must be a non-empty string (got ${String(component)})`,
    )
  }
  const trimmedComponent = component.trim()

  const action = (entry as { action?: unknown }).action
  if (action !== 'removed') {
    if (action !== 'replaced') {
      throw new AblationError(
        'DSH_ABLATION_INVALID_COMPONENT_ACTION',
        `runAblation: removedOrReplacedComponents[${index}].action must be 'removed' or 'replaced' (got ${String(action)})`,
      )
    }
  }

  const replacement = (entry as { replacement?: unknown }).replacement
  if (action === 'removed') {
    // A 'removed' change must not carry a replacement (an explicit
    // replacement means the caller meant 'replaced').
    if (replacement !== undefined) {
      throw new AblationError(
        'DSH_ABLATION_INVALID_COMPONENT_REPLACEMENT',
        `runAblation: removedOrReplacedComponents[${index}] is action 'removed' and must not carry a replacement`,
      )
    }
    return { component: trimmedComponent, action }
  }
  // action === 'replaced' — a replacement is mandatory.
  if (typeof replacement !== 'string' || replacement.trim().length === 0) {
    throw new AblationError(
      'DSH_ABLATION_INVALID_COMPONENT_REPLACEMENT',
      `runAblation: removedOrReplacedComponents[${index}] is action 'replaced' and must carry a non-empty replacement`,
    )
  }
  return { component: trimmedComponent, action, replacement: replacement.trim() }
}

function normalizeChanges(definition: unknown): AblationComponentChange[] {
  const changes = (definition as { removedOrReplacedComponents?: unknown }).removedOrReplacedComponents
  if (!Array.isArray(changes)) {
    throw new AblationError(
      'DSH_ABLATION_INVALID_COMPONENT_CHANGES',
      'runAblation: definition.removedOrReplacedComponents must be a non-empty array',
    )
  }
  if (changes.length === 0) {
    throw new AblationError(
      'DSH_ABLATION_INVALID_COMPONENT_CHANGES',
      'runAblation: definition.removedOrReplacedComponents must list at least one removed/replaced component (an empty change set is not an ablation)',
    )
  }
  return changes.map((entry, index) => normalizeComponentChange(
    entry as AblationComponentChange,
    index,
  ))
}

function normalizeDataset(definition: unknown): AblationDefinition['dataset'] {
  const dataset = (definition as { dataset?: unknown }).dataset
  if (dataset === null || typeof dataset !== 'object' || Array.isArray(dataset)) {
    throw new AblationError(
      'DSH_ABLATION_INVALID_DATASET',
      'runAblation: definition.dataset must be a non-null object {version, split, seed}',
    )
  }
  const version = (dataset as { version?: unknown }).version
  if (typeof version !== 'string' || version.trim().length === 0) {
    throw new AblationError(
      'DSH_ABLATION_INVALID_DATASET_VERSION',
      `runAblation: definition.dataset.version must be a non-empty string (got ${String(version)})`,
    )
  }
  const split = (dataset as { split?: unknown }).split
  if (typeof split !== 'string' || split.trim().length === 0) {
    throw new AblationError(
      'DSH_ABLATION_INVALID_DATASET_SPLIT',
      `runAblation: definition.dataset.split must be a non-empty string (got ${String(split)})`,
    )
  }
  const seed = (dataset as { seed?: unknown }).seed
  if (typeof seed !== 'number' || !Number.isSafeInteger(seed)) {
    throw new AblationError(
      'DSH_ABLATION_INVALID_DATASET_SEED',
      `runAblation: definition.dataset.seed must be a safe-integer number (got ${String(seed)})`,
    )
  }
  return { version: version.trim(), split: split.trim(), seed }
}

function normalizeMetric(definition: unknown): AblationDefinition['metric'] {
  const metric = (definition as { metric?: unknown }).metric
  if (metric === null || typeof metric !== 'object' || Array.isArray(metric)) {
    throw new AblationError(
      'DSH_ABLATION_INVALID_METRIC',
      'runAblation: definition.metric must be a non-null object {name, direction}',
    )
  }
  const name = (metric as { name?: unknown }).name
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new AblationError(
      'DSH_ABLATION_INVALID_METRIC_NAME',
      `runAblation: definition.metric.name must be a non-empty string (got ${String(name)})`,
    )
  }
  const direction = (metric as { direction?: unknown }).direction
  if (direction !== 'lower_is_better') {
    if (direction !== 'higher_is_better') {
      throw new AblationError(
        'DSH_ABLATION_INVALID_METRIC_DIRECTION',
        `runAblation: definition.metric.direction must be 'lower_is_better' or 'higher_is_better' (got ${String(direction)})`,
      )
    }
  }
  return { name: name.trim(), direction: direction as AblationMetricDirection }
}

/** Validate the whole definition and return a normalized plain snapshot
 *  (strings trimmed, invalid optional keys dropped). Never coerces a field it
 *  cannot validate.
 *  @throws {AblationError} on invalid input. */
function normalizeDefinition(definition: unknown): AblationDefinition {
  if (definition === null || typeof definition !== 'object' || Array.isArray(definition)) {
    invalidDefinitionError(`got ${String(definition)}`)
  }

  const baselineIdentity = (definition as { baselineIdentity?: unknown }).baselineIdentity
  if (typeof baselineIdentity !== 'string' || baselineIdentity.trim().length === 0) {
    throw new AblationError(
      'DSH_ABLATION_INVALID_BASELINE_IDENTITY',
      `runAblation: definition.baselineIdentity must be a non-empty string (got ${String(baselineIdentity)})`,
    )
  }
  const variantIdentity = (definition as { variantIdentity?: unknown }).variantIdentity
  if (typeof variantIdentity !== 'string' || variantIdentity.trim().length === 0) {
    throw new AblationError(
      'DSH_ABLATION_INVALID_VARIANT_IDENTITY',
      `runAblation: definition.variantIdentity must be a non-empty string (got ${String(variantIdentity)})`,
    )
  }

  const changes = normalizeChanges(definition)
  const dataset = normalizeDataset(definition)
  const metric = normalizeMetric(definition)

  const repetitions = (definition as { repetitions?: unknown }).repetitions
  if (typeof repetitions !== 'number' || !Number.isSafeInteger(repetitions) || repetitions < 1) {
    throw new AblationError(
      'DSH_ABLATION_INVALID_REPETITIONS',
      `runAblation: definition.repetitions must be a safe integer >= 1 (got ${String(repetitions)})`,
    )
  }

  return {
    baselineIdentity: (baselineIdentity as string).trim(),
    variantIdentity: (variantIdentity as string).trim(),
    removedOrReplacedComponents: changes,
    dataset,
    metric,
    repetitions,
  }
}

function validateExecutor(executor: AblationExecutor): void {
  if (
    executor === null ||
    typeof executor !== 'object' ||
    typeof (executor as { execute?: unknown }).execute !== 'function'
  ) {
    throw new AblationError(
      'DSH_ABLATION_MISSING_EXECUTOR',
      'runAblation: executor must be an object with an execute() function',
    )
  }
}

function validateTimestamp(timestamp: number): void {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    throw new AblationError(
      'DSH_ABLATION_INVALID_TIMESTAMP',
      `runAblation: timestamp must be a finite epoch-ms number (got ${String(timestamp)})`,
    )
  }
}

// ── Run planning + executor-result merging ─────────────────────────────────

/** Identity string of an arm inside a normalized definition. */
function identityOf(definition: AblationDefinition, kind: AblationVariantKind): string {
  return kind === 'baseline' ? definition.baselineIdentity : definition.variantIdentity
}

/** The full deterministic plan of base fields for one definition:
 *  baseline arm first (repetition 0..repetitions-1), then the variant arm.
 *  Every planned run originates from the definition (provenance). */
function buildPlannedBases(definition: AblationDefinition): AblationRunRecordBase[] {
  const bases: AblationRunRecordBase[] = []
  for (const kind of ABLATION_VARIANT_KINDS) {
    const identity = identityOf(definition, kind)
    for (let repetitionIndex = 0; repetitionIndex < definition.repetitions; repetitionIndex += 1) {
      bases.push({
        key: ablationRunKey(kind, repetitionIndex),
        origin: ABLATION_RUN_ORIGIN,
        variant: kind,
        identity,
        repetitionIndex,
        seed: ablationRunSeed(definition.dataset.seed, repetitionIndex),
      })
    }
  }
  return bases
}

/** Validate ONE executor-reported result against its base and build the
 *  artifact run record. The raw result is guaranteed a non-null object by
 *  {@link mergeResults}. Throws AblationError (adapter fault) on any structural
 *  violation — never silently mapped to a measurement. */
function toRunRecord(base: AblationRunRecordBase, rawResult: object): AblationRunRecord {
  const status = (rawResult as { status?: unknown }).status
  if (status === 'executed') {
    const measurement = (rawResult as { measurement?: unknown }).measurement
    if (typeof measurement !== 'number' || !Number.isFinite(measurement)) {
      adapterFault(
        `an 'executed' result for '${base.key}' must carry a finite numeric measurement (got ${String(measurement)})`,
      )
    }
    return { ...base, status, measurement }
  }
  if (status === 'failed' || status === 'partial') {
    const reason = (rawResult as { reason?: unknown }).reason
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      adapterFault(
        `a '${status}' result for '${base.key}' must carry a non-empty reason (got ${String(reason)})`,
      )
    }
    return { ...base, status, reason }
  }
  adapterFault(
    `run result for '${base.key}' has unknown status ${String(status)} (expected executed|failed|partial)`,
  )
}

/** Merge the executor's result array onto the planned bases. Results are keyed
 *  by run key; a planned run with NO executor result stays 'planned'. Unknown
 *  or duplicated run keys are adapter faults. */
function mergeResults(
  bases: ReadonlyArray<AblationRunRecordBase>,
  results: ReadonlyArray<unknown>,
): ReadonlyArray<AblationRunRecord> {
  const baseByKey = new Map<string, AblationRunRecordBase>()
  for (const base of bases) {
    baseByKey.set(base.key, base)
  }

  const replacedByKey = new Map<string, AblationRunRecord>()
  for (const raw of results) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      adapterFault('each run result must be a non-null object')
    }
    const rawResult = raw as object
    const rawKey = (rawResult as { runKey?: unknown }).runKey
    if (typeof rawKey !== 'string' || rawKey.trim().length === 0) {
      adapterFault('each run result must carry a non-empty string runKey')
    }
    const base = baseByKey.get(rawKey)
    if (base === undefined) {
      adapterFault(`run result references unknown run key '${rawKey}' (not part of this definition's plan)`)
    }
    if (replacedByKey.has(rawKey)) {
      adapterFault(`run result repeats run key '${rawKey}' (one result per planned run)`)
    }
    replacedByKey.set(rawKey, toRunRecord(base, rawResult))
  }

  return bases.map(base => replacedByKey.get(base.key) ?? { ...base, status: 'planned' })
}

// ── Aggregation (executed runs only; never a conclusion) ───────────────────

function computeMean(values: ReadonlyArray<number>): number {
  let sum = 0
  for (const value of values) {
    sum += value
  }
  return sum / values.length
}

/** Population standard deviation of the executed measurements (dispersion
 *  measure). Deterministic; a single executed run yields 0, which is honest
 *  "no observed dispersion" — never a fake fill-in. */
function computeStddev(values: ReadonlyArray<number>, mean: number): number {
  let squaredSum = 0
  for (const value of values) {
    const deviation = value - mean
    squaredSum += deviation * deviation
  }
  return Math.sqrt(squaredSum / values.length)
}

function variantMeasure(
  executedRuns: ReadonlyArray<AblationExecutedRun>,
  definition: AblationDefinition,
  kind: AblationVariantKind,
): AblationVariantMeasure {
  const identity = identityOf(definition, kind)
  const ofKind = executedRuns.filter(run => run.variant === kind)
  if (ofKind.length === 0) {
    return { variant: kind, identity, status: 'no-executed-runs' }
  }
  const values = ofKind.map(run => run.measurement)
  const mean = computeMean(values)
  const stddev = computeStddev(values, mean)
  return {
    variant: kind,
    identity,
    status: 'aggregated',
    executedRuns: ofKind.length,
    mean,
    stddev,
  }
}

function buildAggregate(
  runs: ReadonlyArray<AblationRunRecord>,
  definition: AblationDefinition,
): AblationAggregate {
  const executedRuns = runs.filter((run): run is AblationExecutedRun => run.status === 'executed')
  if (executedRuns.length === 0) {
    // Distinct empty-aggregate state: NOTHING was executed, so no mean /
    // dispersion / performance statement may exist anywhere in the artifact.
    return { state: 'no-executed-runs' }
  }
  const variants = ABLATION_VARIANT_KINDS.map(kind => variantMeasure(executedRuns, definition, kind))
  return { state: 'per-variant', variants }
}

function buildCounts(runs: ReadonlyArray<AblationRunRecord>): AblationRunCounts {
  let planned = 0
  let executed = 0
  let failed = 0
  let partial = 0
  for (const run of runs) {
    if (run.status === 'planned') {
      planned += 1
    } else if (run.status === 'executed') {
      executed += 1
    } else if (run.status === 'failed') {
      failed += 1
    } else {
      partial += 1
    }
  }
  return { planned, executed, failed, partial }
}

/**
 * Run one ablation definition and return a deeply-frozen
 * {@link AblationArtifact}. PURE: validates the definition, calls the injected
 * executor EXACTLY ONCE with an immutable request carrying a frozen snapshot of
 * the validated definition, records every planned/reported run, and aggregates
 * mean + population stddev per arm over EXECUTED runs only.
 *
 * The tool reports measurements only: no baseline-vs-variant difference, no
 * effect size, no causal/conclusion field exists anywhere in the artifact, and
 * the metric in the definition is never auto-selected or reinterpreted.
 *
 * Adapter faults are NOT swallowed: an executor that throws propagates its own
 * error as-is; an executor returning structurally-invalid output or an invalid
 * run result throws {@link AblationError} (adapter fault) — never silently
 * mapped to a measurement or an empty answer.
 *
 * @param definition the ablation definition (frozen input type).
 * @param executor the {@link AblationExecutor} to run the ablation through.
 * @param timestamp caller-injected epoch ms (auditable; lands in meta.producedAt).
 * @throws {AblationError} on invalid definition / missing executor / invalid
 *   timestamp / structurally-invalid executor output or run result.
 */
export function runAblation(
  definition: AblationDefinition,
  executor: AblationExecutor,
  timestamp: number,
): AblationArtifact {
  const normalized = normalizeDefinition(definition)
  validateExecutor(executor)
  validateTimestamp(timestamp)

  // Immutable request: a deep-frozen snapshot of the validated definition.
  // The executor receives this frozen object and nothing else.
  const definitionSnapshot = freezeArtifact<AblationDefinition>(normalized)
  const request: AblationRunRequest = { definition: definitionSnapshot }

  // Call the executor EXACTLY ONCE (no retry, no fallback executor).
  const rawOutcome: unknown = executor.execute(request)

  if (!Array.isArray(rawOutcome)) {
    invalidAdapterOutput(
      `expected an array of per-run results (got ${String(rawOutcome)})`,
    )
  }

  const bases = buildPlannedBases(normalized)
  const runs = mergeResults(bases, rawOutcome as ReadonlyArray<unknown>)

  const meta: ToolArtifactMeta = {
    toolId: ABLATION_TOOL_ID,
    version: ABLATION_TOOL_VERSION,
    producedAt: timestamp,
  }
  return freezeArtifact<AblationArtifact>({
    meta,
    definition: definitionSnapshot,
    runs,
    counts: buildCounts(runs),
    aggregate: buildAggregate(runs, normalized),
  })
}

// ── Public re-exports (single import surface for consumers) ────────────────
export { createMockAblationExecutor, mockAblationExecutor } from './mock.ts'
export type { MockAblationExecutorOptions } from './mock.ts'
export type {
  AblationComponentAction,
  AblationComponentChange,
  AblationDatasetSpec,
  AblationDefinition,
  AblationExecutor,
  AblationMetricDirection,
  AblationMetricSpec,
  AblationRunOrigin,
  AblationRunRequest,
  AblationRunResult,
  AblationVariantKind,
} from './adapter.ts'
