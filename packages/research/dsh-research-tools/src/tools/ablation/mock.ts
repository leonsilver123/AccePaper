// @deepseek-ai/dsh-research-tools — T15 ablation: Fixture/Mock executor.
//
// This is the batch-2 stand-in for a real evaluation runner. It performs NO
// model runs, NO network I/O and holds NO real API keys. Every per-run
// measurement is a DETERMINISTIC SYNTHETIC value derived by a fixed string
// hash over the run's (metric, arm identity, dataset, seed) — the fixture
// never claims a measurement came from a real model, and it never encodes a
// directional "effect" between the baseline and the ablated arm (no causal
// signal exists to leak: the two arms are measured by the SAME value function,
// so any observed difference is hash noise, not an engineered conclusion).
//
// Determinism: no Math.random, no clocks, no process/global state. The same
// request always yields the same result array. Measurement numbers are
// rounded to 3 decimals so snapshots stay human-readable.
//
// Failure seeding: like the resolver fixture's seeded `unavailableKeys`, the
// mock reports 'failed' / 'partial' for a run ONLY when constructed with
// { failedRunKeys } / { partialRunKeys } naming that run's key. It can also be
// constructed with `{ skipAll: true }` to return an empty result list (every
// planned run then stays 'planned' — a legitimate executor answer, never a
// fabricated measurement). Test-only seeds; the fixture never decides to fail
// on its own.

import {
  ablationRunKey,
  ablationRunSeed,
  ABLATION_VARIANT_KINDS,
} from './adapter.ts'
import type {
  AblationExecutor,
  AblationRunRequest,
  AblationRunResult,
  AblationVariantKind,
} from './adapter.ts'

/** 32-bit FNV-1a over the input's UTF-16 code units. Deterministic across
 *  runs/engines for ASCII inputs (all synthetic keys/names are ASCII);
 *  Math.imul is exact, so no float drift. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Deterministic synthetic measurement in [0, 100). Plain hash noise — it is a
 *  FIXTURE value, not a model score, and it carries no ablation-effect signal. */
function syntheticMeasurement(
  definition: AblationDefinitionLike,
  kind: AblationVariantKind,
  runSeed: number,
): number {
  const identity = kind === 'baseline'
    ? definition.baselineIdentity
    : definition.variantIdentity
  const raw = fnv1a([
    definition.metric.name,
    definition.dataset.version,
    definition.dataset.split,
    identity,
    kind,
    String(runSeed),
  ].join('|'))
  return Math.round((raw % 100000) / 100) / 1000
}

/** Structural slice of the definition the mock actually reads (kept local so
 *  the mock stays decoupled from full input validation, which is the tool's
 *  job — the tool always hands the mock a validated definition). */
interface AblationDefinitionLike {
  readonly baselineIdentity: string
  readonly variantIdentity: string
  readonly dataset: { readonly version: string; readonly split: string; readonly seed: number }
  readonly metric: { readonly name: string }
  readonly repetitions: number
}

/** Construction options. All seeds are test-only, mirroring the resolver
 *  fixture's seeded outage: the mock never invents a failure on its own. */
export interface MockAblationExecutorOptions {
  /** Run keys (ablationRunKey output) to report as 'failed' instead of
   *  'executed'. */
  readonly failedRunKeys?: ReadonlyArray<string>
  /** Run keys (ablationRunKey output) to report as 'partial' instead of
   *  'executed'. */
  readonly partialRunKeys?: ReadonlyArray<string>
  /** When true, execute nothing: every planned run stays 'planned' (the mock
   *  returns an empty result list). */
  readonly skipAll?: boolean
}

/** Deterministic Fixture/Mock {@link AblationExecutor}. Reports one
 *  {@link AblationRunResult} per planned run in deterministic arm-then-
 *  repetition order, unless a run key is seeded 'failed'/'partial' or
 *  `skipAll` is set. NEVER throws for a legitimate request and never reports a
 *  real-model measurement. */
export class MockAblationExecutor implements AblationExecutor {
  private readonly failedRunKeys: ReadonlyArray<string>
  private readonly partialRunKeys: ReadonlyArray<string>
  private readonly skipAll: boolean

  constructor(options: MockAblationExecutorOptions = {}) {
    // Clone the seed lists so later caller mutation cannot change behaviour.
    this.failedRunKeys = [...(options.failedRunKeys ?? [])]
    this.partialRunKeys = [...(options.partialRunKeys ?? [])]
    this.skipAll = options.skipAll === true
    Object.freeze(this.failedRunKeys)
    Object.freeze(this.partialRunKeys)
  }

  execute(request: AblationRunRequest): ReadonlyArray<AblationRunResult> {
    const definition = request?.definition
    if (
      request === null ||
      typeof request !== 'object' ||
      definition === null ||
      typeof definition !== 'object'
    ) {
      throw new Error(
        'MockAblationExecutor.execute: request must be a non-null object carrying a definition',
      )
    }

    if (this.skipAll) {
      return []
    }

    const results: Array<AblationRunResult> = []
    for (const kind of ABLATION_VARIANT_KINDS) {
      for (let repetitionIndex = 0; repetitionIndex < definition.repetitions; repetitionIndex += 1) {
        const key = ablationRunKey(kind, repetitionIndex)
        if (this.failedRunKeys.includes(key)) {
          results.push({
            runKey: key,
            status: 'failed',
            reason: `Synthetic run failure seeded for ${key} (fixture; no real model was run)`,
          })
        } else if (this.partialRunKeys.includes(key)) {
          results.push({
            runKey: key,
            status: 'partial',
            reason: `Synthetic partial run seeded for ${key} (fixture; incomplete run carries no usable measurement)`,
          })
        } else {
          results.push({
            runKey: key,
            status: 'executed',
            measurement: syntheticMeasurement(
              definition,
              kind,
              ablationRunSeed(definition.dataset.seed, repetitionIndex),
            ),
          })
        }
      }
    }
    return results
  }
}

/** Build a fresh mock executor instance (deterministic; seeds are read once at
 *  construction). */
export function createMockAblationExecutor(
  options: MockAblationExecutorOptions = {},
): AblationExecutor {
  return new MockAblationExecutor(options)
}

/** A ready, stateless mock executor instance (safe to share; no seeds). */
export const mockAblationExecutor: AblationExecutor = new MockAblationExecutor()
