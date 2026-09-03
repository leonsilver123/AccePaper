// @deepseek-ai/dsh-research-tools — T15 ablation (消融实验定义+执行适配+结果审计).
//
// Adapter SEAM (EXTERNAL EXECUTION SEAM). The tool (./index.ts) is PURE: it
// performs no model runs, no network/filesystem I/O and holds no API keys.
// Actual evaluation runs enter ONLY through an {@link AblationExecutor}
// implementation whose real wiring lives OUTSIDE this pure module. This wave
// ships a Fixture/Mock implementation (./mock.ts) whose per-run measurements
// are deterministic SYNTHETIC values — nothing here is a real model run and no
// measurement is ever dressed up as evidence about a real system.
//
// Scope guard (frozen T15 constraint): this tool is an "ablation-run
// definition + execution adaptation + result audit" tool. It records what was
// planned, what the executor reported per run, and per-variant descriptive
// statistics of EXECUTED runs only. It NEVER compares baseline vs variant,
// NEVER emits a delta/effect/difference and NEVER draws a causal or
// conclusion-style statement — ordinary metric differences are not causal
// evidence, and the tool's artifact is structurally incapable of saying
// otherwise. There is no engine / state-machine coupling here (P2 rule 4).
//
// The tool calls the executor EXACTLY ONCE per runAblation invocation with an
// immutable {@link AblationRunRequest} (a frozen snapshot of the validated
// definition). The executor answers with one per-run {@link AblationRunResult}
// per run it attempted; runs it does not report on remain 'planned' in the
// artifact (planned but never executed — never guessed, never filled in).

/** A component change an ablation applies on top of its baseline:
 *  either removed outright, or replaced by {@link replacement}. */
export interface AblationComponentChange {
  readonly component: string
  readonly action: AblationComponentAction
  /** Required (non-empty) when action === 'replaced'; must be ABSENT when
   *  action === 'removed'. */
  readonly replacement?: string
}

/** Whether an ablation component is dropped or swapped for another. */
export type AblationComponentAction = 'removed' | 'replaced'

/** Dataset an ablation evaluates against: version + split identify the exact
 *  frozen data, `seed` the deterministic evaluation seed. */
export interface AblationDatasetSpec {
  readonly version: string
  readonly split: string
  readonly seed: number
}

/** Metric the caller fixed IN the definition. Never auto-selected by the tool
 *  (no metric-picking / tuning machinery anywhere). `direction` is carried as
 *  provenance only — the tool does not interpret it. */
export type AblationMetricDirection = 'lower_is_better' | 'higher_is_better'

export interface AblationMetricSpec {
  readonly name: string
  readonly direction: AblationMetricDirection
}

/** The role of an ablation arm: the unmodified baseline vs the ablation
 *  variant (baseline with {@link AblationComponentChange}s applied). */
export type AblationVariantKind = 'baseline' | 'variant'

/** The two ablation arms, in deterministic artifact order. */
export const ABLATION_VARIANT_KINDS: ReadonlyArray<AblationVariantKind> = ['baseline', 'variant']

/** Where every planned run originates in this design: the validated tool input
 *  definition. A future pipeline could inject other origins through the same
 *  seam without changing the run-record shape. */
export type AblationRunOrigin = 'definition'
export const ABLATION_RUN_ORIGIN: AblationRunOrigin = 'definition'

/**
 * Frozen tool input: an ablation-run definition. Carries explicit baseline and
 * variant identities, the exact removed/replaced components, the exact dataset
 * and metric, and the repetition count. Plain, structured-cloneable data.
 */
export interface AblationDefinition {
  /** Identity of the unmodified baseline arm (opaque, non-empty). */
  readonly baselineIdentity: string
  /** Identity of the ablated arm (opaque, non-empty, != baseline). */
  readonly variantIdentity: string
  /** The ablation change set — at least ONE component must be removed or
   *  replaced (an empty change set is not an ablation). */
  readonly removedOrReplacedComponents: ReadonlyArray<AblationComponentChange>
  readonly dataset: AblationDatasetSpec
  readonly metric: AblationMetricSpec
  /** How many times each arm is run (>= 1 safe integer). */
  readonly repetitions: number
}

/** Immutable run request handed to the {@link AblationExecutor}. Carries only
 *  the frozen validated definition snapshot — no live references, no clocks,
 *  nothing the executor could reinterpret as a caller instruction beyond the
 *  definition itself. */
export interface AblationRunRequest {
  readonly definition: AblationDefinition
}

/** Stable, deterministic identifier of one planned run: `<variant>:<rep>`.
 *  Shared by the tool (plan/audit) and the mock executor so both sides can
 *  never disagree on run identity. */
export function ablationRunKey(variant: AblationVariantKind, repetitionIndex: number): string {
  return `${variant}:${repetitionIndex}`
}

/** Deterministic evaluation seed assigned to one repetition of an arm:
 *  dataset.seed + repetitionIndex (0-based). Pure audit metadata on each run
 *  record; the tool itself never uses it to compare arms. */
export function ablationRunSeed(datasetSeed: number, repetitionIndex: number): number {
  return datasetSeed + repetitionIndex
}

/** One per-run answer the executor reports for a run it ATTEMPTED. 'planned'
 *  is deliberately not a legal executor status: an executor reports only what
 *  it did — runs it does not report on stay 'planned' in the artifact.
 *
 *  Discriminated on `status`:
 *   - 'executed' -> the run completed and produced ONE usable measurement;
 *   - 'failed'   -> the run errored; NO measurement is carried (a measurement
 *                   that cannot be aggregated must not be attachable here);
 *   - 'partial'  -> the run did not complete cleanly; NO measurement is
 *                   carried (partial data is never aggregated, so it is never
 *                   emitted in a usable position).
 */
export type AblationRunResult =
  | {
    readonly runKey: string
    readonly status: 'executed'
    readonly measurement: number
  }
  | {
    readonly runKey: string
    readonly status: 'failed'
    readonly reason: string
  }
  | {
    readonly runKey: string
    readonly status: 'partial'
    readonly reason: string
  }

/** The four artifact-visible run statuses (explicit discriminated union, see
 *  {@link AblationRunRecord}). */
export type AblationRunStatus = 'planned' | 'executed' | 'failed' | 'partial'

/**
 * Executes one ablation definition. PURE in this wave (Fixture/Mock); real
 * implementations live outside the pure module and MUST perform no
 * network/filesystem I/O inside the tool boundary.
 *
 * Adapter contract (enforced / documented in ./index.ts):
 *  - the executor receives an immutable {@link AblationRunRequest} snapshot;
 *  - it MUST return a plain, structured-cloneable ARRAY of per-run
 *    {@link AblationRunResult}s (possibly empty — then every planned run stays
 *    'planned' and the artifact emits NO performance aggregate);
 *  - a result MUST reference a run the definition actually plans
 *    (`ablationRunKey(variant, repetition)` for repetition < definition.repetitions),
 *    MUST NOT repeat a runKey, and MUST satisfy its own status's payload
 *    contract above. Anything else is an adapter fault, never silently mapped;
 *  - it MUST NOT throw to express "no usable measurement" (a 'failed' result
 *    is the declared way); a throw is surfaced to the caller as-is.
 */
export interface AblationExecutor {
  execute(request: AblationRunRequest): ReadonlyArray<AblationRunResult>
}
