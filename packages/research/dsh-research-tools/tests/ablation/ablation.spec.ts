// T15 ablation (消融实验定义+执行适配+结果审计) — vitest spec.
//
// Covers the frozen T15 design contract for this fixture/adapter-only wave:
//   - definition validation (missing/invalid fields → specific AblationError codes);
//   - the injected executor is called EXACTLY ONCE per runAblation invocation
//     with an immutable (frozen) request;
//   - run statuses are a discriminated union separating planned | executed |
//     failed | partial, each run records its input origin + arm identity +
//     repetition + seed;
//   - aggregation covers EXECUTED runs only (planned/failed/partial excluded),
//     and zero-executed ablations emit a distinct empty-aggregate state, never
//     fake zeros and never a conclusion;
//   - mean + dispersion math (population stddev) is deterministic;
//   - the result is a deeply-frozen artifact carrying meta {toolId, version,
//     producedAt} and an echo of the validated definition (provenance);
//   - identical input → identical artifact (determinism);
//   - error transparency: executor throws propagate as-is; structurally-invalid
//     executor output / run results throw AblationError adapter-fault codes;
//   - defensive branches reachable only by bypassing the tool's own validation
//     are tested directly against the mock (tool validation bypassed).

import { describe, expect, it } from 'vitest'
import {
  ABLATION_TOOL_ID,
  ABLATION_TOOL_VERSION,
  AblationError,
  createMockAblationExecutor,
  mockAblationExecutor,
  runAblation,
} from '../../src/tools/ablation/index.ts'
import type {
  AblationDefinition,
  AblationExecutedRun,
  AblationExecutor,
  AblationRunRecord,
} from '../../src/tools/ablation/index.ts'
import { ablationRunKey, ablationRunSeed, ABLATION_RUN_ORIGIN, ABLATION_VARIANT_KINDS } from '../../src/tools/ablation/adapter.ts'

const TS = 1_700_000_000_000
const run = runAblation

/** Build a fresh, valid synthetic ablation definition (clearly fake identities
 *  and component names — no real model, no real benchmark). */
function makeDefinition(overrides: Record<string, unknown> = {}): AblationDefinition {
  return {
    baselineIdentity: 'Synthetic-Ablation-Baseline',
    variantIdentity: 'Synthetic-Ablation-Variant',
    removedOrReplacedComponents: [
      { component: 'Synthetic-Attention-Head', action: 'removed' },
      { component: 'Synthetic-Positional-Encoding', action: 'replaced', replacement: 'Synthetic-ALiBi-Encoding' },
    ],
    dataset: { version: 'synth-bench-v1', split: 'synth-eval', seed: 7 },
    metric: { name: 'synth-top1-accuracy', direction: 'higher_is_better' },
    repetitions: 3,
    ...overrides,
  } as AblationDefinition
}

/** Run fn and return the AblationError code (or undefined when it did not
 *  throw an AblationError). */
function errorCodeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (e) {
    return e instanceof AblationError ? e.code : undefined
  }
  return undefined
}

/** Stub executor returning a fixed list of (possibly invalid) results. */
function resultsExecutor(results: unknown[]): AblationExecutor {
  return { execute: () => results as never } as unknown as AblationExecutor
}

/** Extract the executed runs of one arm from an artifact, recomputing the
 *  reference mean/stddev the test expects (independent of the tool's own
 *  aggregation implementation). */
function referenceStats(runs: ReadonlyArray<AblationRunRecord>, kind: 'baseline' | 'variant') {
  const values = executedMeasurements(runs, kind)
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const squared = values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0)
  const stddev = values.length === 0 ? Number.NaN : Math.sqrt(squared / values.length)
  return { count: values.length, mean, stddev }
}

/** Measurements of the EXECUTED runs of one arm (type-safe narrowing). */
function executedMeasurements(
  runs: ReadonlyArray<AblationRunRecord>,
  kind: 'baseline' | 'variant',
): number[] {
  return runs
    .filter((run): run is AblationExecutedRun => run.status === 'executed')
    .filter(run => run.variant === kind)
    .map(run => run.measurement)
}

describe('definition validation — invalid input throws AblationError with specific codes', () => {
  it('rejects a null / non-object / array definition', () => {
    expect(errorCodeOf(() => run(null as unknown as AblationDefinition, mockAblationExecutor, TS)))
      .toBe('DSH_ABLATION_INVALID_DEFINITION')
    expect(errorCodeOf(() => run(42 as unknown as AblationDefinition, mockAblationExecutor, TS)))
      .toBe('DSH_ABLATION_INVALID_DEFINITION')
    expect(errorCodeOf(() => run('text' as unknown as AblationDefinition, mockAblationExecutor, TS)))
      .toBe('DSH_ABLATION_INVALID_DEFINITION')
    expect(errorCodeOf(() => run([] as unknown as AblationDefinition, mockAblationExecutor, TS)))
      .toBe('DSH_ABLATION_INVALID_DEFINITION')
  })

  it('rejects missing / non-string / blank baselineIdentity', () => {
    for (const bad of [undefined, 42, '', '   ']) {
      const def = { ...makeDefinition(), baselineIdentity: bad } as AblationDefinition
      expect(errorCodeOf(() => run(def, mockAblationExecutor, TS)))
        .toBe('DSH_ABLATION_INVALID_BASELINE_IDENTITY')
    }
  })

  it('rejects missing / non-string / blank variantIdentity', () => {
    for (const bad of [undefined, 42, '', '   ']) {
      const def = { ...makeDefinition(), variantIdentity: bad } as AblationDefinition
      expect(errorCodeOf(() => run(def, mockAblationExecutor, TS)))
        .toBe('DSH_ABLATION_INVALID_VARIANT_IDENTITY')
    }
  })

  it('rejects a missing / non-array / empty removedOrReplacedComponents', () => {
    for (const bad of [undefined, 'x', { nope: true }, []]) {
      const def = { ...makeDefinition(), removedOrReplacedComponents: bad } as unknown as AblationDefinition
      expect(errorCodeOf(() => run(def, mockAblationExecutor, TS)))
        .toBe('DSH_ABLATION_INVALID_COMPONENT_CHANGES')
    }
  })

  it('rejects a null / non-object component-change entry', () => {
    for (const bad of [null, 42, 'entry']) {
      const def = {
        ...makeDefinition(),
        removedOrReplacedComponents: [bad],
      } as unknown as AblationDefinition
      expect(errorCodeOf(() => run(def, mockAblationExecutor, TS)))
        .toBe('DSH_ABLATION_INVALID_COMPONENT_ENTRY')
    }
  })

  it('rejects a missing / non-string / blank component name', () => {
    for (const bad of [undefined, 42, '', '   ']) {
      const def = {
        ...makeDefinition(),
        removedOrReplacedComponents: [{ component: bad, action: 'removed' }],
      } as unknown as AblationDefinition
      expect(errorCodeOf(() => run(def, mockAblationExecutor, TS)))
        .toBe('DSH_ABLATION_INVALID_COMPONENT_NAME')
    }
  })

  it('rejects an unknown component action', () => {
    for (const action of ['swapped', 1, undefined]) {
      const def = {
        ...makeDefinition(),
        removedOrReplacedComponents: [{ component: 'Synthetic-Head', action }],
      } as unknown as AblationDefinition
      expect(errorCodeOf(() => run(def, mockAblationExecutor, TS)))
        .toBe('DSH_ABLATION_INVALID_COMPONENT_ACTION')
    }
  })

  it("rejects a 'removed' change that carries a replacement", () => {
    const def = {
      ...makeDefinition(),
      removedOrReplacedComponents: [
        { component: 'Synthetic-Head', action: 'removed', replacement: 'Synthetic-Other' },
      ],
    } as unknown as AblationDefinition
    expect(errorCodeOf(() => run(def, mockAblationExecutor, TS)))
      .toBe('DSH_ABLATION_INVALID_COMPONENT_REPLACEMENT')
  })

  it("rejects a 'replaced' change with no / blank replacement", () => {
    for (const replacement of [undefined, '', '   ']) {
      const def = {
        ...makeDefinition(),
        removedOrReplacedComponents: [{ component: 'Synthetic-Head', action: 'replaced', replacement }],
      } as unknown as AblationDefinition
      expect(errorCodeOf(() => run(def, mockAblationExecutor, TS)))
        .toBe('DSH_ABLATION_INVALID_COMPONENT_REPLACEMENT')
    }
  })

  it('rejects a missing / non-object dataset', () => {
    for (const bad of [undefined, null, 42, []]) {
      const def = { ...makeDefinition(), dataset: bad } as unknown as AblationDefinition
      expect(errorCodeOf(() => run(def, mockAblationExecutor, TS)))
        .toBe('DSH_ABLATION_INVALID_DATASET')
    }
  })

  it('rejects missing / non-string / blank dataset.version', () => {
    for (const bad of [undefined, 42, '', '   ']) {
      const def = {
        ...makeDefinition(),
        dataset: { ...makeDefinition().dataset, version: bad },
      } as unknown as AblationDefinition
      expect(errorCodeOf(() => run(def, mockAblationExecutor, TS)))
        .toBe('DSH_ABLATION_INVALID_DATASET_VERSION')
    }
  })

  it('rejects missing / non-string / blank dataset.split', () => {
    for (const bad of [undefined, 42, '', '   ']) {
      const def = {
        ...makeDefinition(),
        dataset: { ...makeDefinition().dataset, split: bad },
      } as unknown as AblationDefinition
      expect(errorCodeOf(() => run(def, mockAblationExecutor, TS)))
        .toBe('DSH_ABLATION_INVALID_DATASET_SPLIT')
    }
  })

  it('rejects a non-safe-integer dataset.seed', () => {
    for (const bad of [undefined, '7', 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const def = {
        ...makeDefinition(),
        dataset: { ...makeDefinition().dataset, seed: bad },
      } as unknown as AblationDefinition
      expect(errorCodeOf(() => run(def, mockAblationExecutor, TS)))
        .toBe('DSH_ABLATION_INVALID_DATASET_SEED')
    }
  })

  it('rejects a missing / non-object metric', () => {
    for (const bad of [undefined, null, 42, []]) {
      const def = { ...makeDefinition(), metric: bad } as unknown as AblationDefinition
      expect(errorCodeOf(() => run(def, mockAblationExecutor, TS)))
        .toBe('DSH_ABLATION_INVALID_METRIC')
    }
  })

  it('rejects missing / non-string / blank metric.name', () => {
    for (const bad of [undefined, 42, '', '   ']) {
      const def = {
        ...makeDefinition(),
        metric: { ...makeDefinition().metric, name: bad },
      } as unknown as AblationDefinition
      expect(errorCodeOf(() => run(def, mockAblationExecutor, TS)))
        .toBe('DSH_ABLATION_INVALID_METRIC_NAME')
    }
  })

  it('rejects an unknown metric.direction', () => {
    for (const bad of ['left_is_better', 'HIGHER_IS_BETTER', 1, undefined]) {
      const def = {
        ...makeDefinition(),
        metric: { ...makeDefinition().metric, direction: bad },
      } as unknown as AblationDefinition
      expect(errorCodeOf(() => run(def, mockAblationExecutor, TS)))
        .toBe('DSH_ABLATION_INVALID_METRIC_DIRECTION')
    }
  })

  it('rejects repetitions < 1 or non-safe-integer', () => {
    for (const bad of [undefined, '3', 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const def = { ...makeDefinition(), repetitions: bad } as unknown as AblationDefinition
      expect(errorCodeOf(() => run(def, mockAblationExecutor, TS)))
        .toBe('DSH_ABLATION_INVALID_REPETITIONS')
    }
  })

  it('rejects a missing / malformed executor', () => {
    for (const bad of [null, undefined, 42, {}, { execute: 42 }]) {
      expect(
        errorCodeOf(() => run(makeDefinition(), bad as unknown as AblationExecutor, TS)),
      ).toBe('DSH_ABLATION_MISSING_EXECUTOR')
    }
  })

  it('rejects a non-finite / non-number timestamp', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 'now']) {
      expect(errorCodeOf(() => run(makeDefinition(), mockAblationExecutor, bad as never))).toBe(
        'DSH_ABLATION_INVALID_TIMESTAMP',
      )
    }
  })

  it('AblationError carries its code in `code` and in the message', () => {
    try {
      run(null as unknown as AblationDefinition, mockAblationExecutor, TS)
      expect.unreachable('expected runAblation to throw')
    } catch (e) {
      expect(e).toBeInstanceOf(AblationError)
      const err = e as AblationError
      expect(err.code).toBe('DSH_ABLATION_INVALID_DEFINITION')
      expect(err.message).toContain('[DSH_ABLATION_INVALID_DEFINITION]')
      expect(err.name).toBe('AblationError')
    }
  })
})

describe('ok path — executor exactly once, frozen artifact, run plan', () => {
  it('runs the whole plan through the mock and reports every run as executed', () => {
    const artifact = run(makeDefinition(), mockAblationExecutor, TS)
    // 2 arms × 3 repetitions
    expect(artifact.runs).toHaveLength(6)
    expect(artifact.counts).toEqual({ planned: 0, executed: 6, failed: 0, partial: 0 })
    const executed = artifact.runs.filter((run): run is AblationExecutedRun => run.status === 'executed')
    expect(executed).toHaveLength(6)
    for (const runRecord of executed) {
      expect(runRecord.origin).toBe('definition')
      expect(typeof runRecord.measurement).toBe('number')
    }
  })

  it('assigns deterministic keys / identities / repetition indexes / seeds', () => {
    const artifact = run(makeDefinition(), mockAblationExecutor, TS)
    const keys = artifact.runs.map(r => r.key)
    expect(keys).toEqual([
      'baseline:0', 'baseline:1', 'baseline:2',
      'variant:0', 'variant:1', 'variant:2',
    ])
    for (const runRecord of artifact.runs) {
      expect(runRecord.seed).toBe(7 + runRecord.repetitionIndex)
      const expectedIdentity = runRecord.variant === 'baseline'
        ? 'Synthetic-Ablation-Baseline'
        : 'Synthetic-Ablation-Variant'
      expect(runRecord.identity).toBe(expectedIdentity)
    }
  })

  it('calls the injected executor exactly once', () => {
    let calls = 0
    let requestFrozen = false
    const countingExecutor: AblationExecutor = {
      execute(request) {
        calls += 1
        // The request must already be immutable (deep-frozen definition).
        requestFrozen = Object.isFrozen(request.definition)
          && Object.isFrozen(request.definition.removedOrReplacedComponents)
        return mockAblationExecutor.execute(request)
      },
    }
    const artifact = run(makeDefinition(), countingExecutor, TS)
    expect(calls).toBe(1)
    expect(requestFrozen).toBe(true)
    expect(artifact.runs).toHaveLength(6)
  })

  it('echoes the validated (trimmed) definition inside the artifact', () => {
    const def = makeDefinition()
    const artifact = run(def, mockAblationExecutor, TS)
    expect(artifact.definition).toEqual(def)
    // Whitespace-padded identities are normalized (trimmed) in the echo.
    const padded = makeDefinition({
      baselineIdentity: '  Synthetic-Ablation-Baseline  ',
      metric: { name: '  synth-top1-accuracy ', direction: 'lower_is_better' },
    })
    const normalized = run(padded, mockAblationExecutor, TS)
    expect(normalized.definition.baselineIdentity).toBe('Synthetic-Ablation-Baseline')
    expect(normalized.definition.metric.name).toBe('synth-top1-accuracy')
    expect(normalized.definition.metric.direction).toBe('lower_is_better')
    // Component replacement is trimmed too.
    const replacementPadded = makeDefinition({
      removedOrReplacedComponents: [
        { component: ' Synthetic-Head ', action: 'replaced', replacement: '  Synthetic-New ' },
      ],
    })
    const normalized2 = run(replacementPadded, mockAblationExecutor, TS)
    expect(normalized2.definition.removedOrReplacedComponents[0]).toEqual({
      component: 'Synthetic-Head',
      action: 'replaced',
      replacement: 'Synthetic-New',
    })
  })

  it('meta envelope carries toolId / version / producedAt', () => {
    const artifact = run(makeDefinition(), mockAblationExecutor, TS)
    expect(artifact.meta).toEqual({
      toolId: ABLATION_TOOL_ID,
      version: ABLATION_TOOL_VERSION,
      producedAt: TS,
    })
    expect(ABLATION_TOOL_ID).toBe('ablation')
    expect(ABLATION_TOOL_VERSION).toBe('0.1.2-alpha.4')
  })

  it('returns a deeply-frozen artifact (top-level and nested mutation throws)', () => {
    const artifact = run(makeDefinition(), mockAblationExecutor, TS)
    expect(Object.isFrozen(artifact)).toBe(true)
    expect(Object.isFrozen(artifact.meta)).toBe(true)
    expect(Object.isFrozen(artifact.definition)).toBe(true)
    expect(Object.isFrozen(artifact.runs)).toBe(true)
    expect(Object.isFrozen(artifact.aggregate)).toBe(true)

    expect(() => {
      (artifact.runs as unknown as unknown[]).push({} as never)
    }).toThrow(TypeError)
    const executed = artifact.runs[0] as unknown as { measurement: number }
    expect(() => {
      executed.measurement = 999
    }).toThrow(TypeError)
    expect(() => {
      (artifact.definition as { baselineIdentity: string }).baselineIdentity = 'mutated'
    }).toThrow(TypeError)
    expect(() => {
      (artifact.meta as { producedAt: number }).producedAt = 0
    }).toThrow(TypeError)
    if (artifact.aggregate.state === 'per-variant') {
      const baseline = artifact.aggregate.variants[0] as unknown as { mean: number }
      expect(() => {
        baseline.mean = 0
      }).toThrow(TypeError)
    }
  })

  it('is plain, serializable data (JSON round-trip preserves content)', () => {
    const artifact = run(makeDefinition(), mockAblationExecutor, TS)
    const roundTripped = JSON.parse(JSON.stringify(artifact))
    expect(roundTripped).toEqual(artifact)
  })

  it('aggregates over the mock fixture deterministically', () => {
    const artifact = run(makeDefinition(), mockAblationExecutor, TS)
    expect(artifact.aggregate.state).toBe('per-variant')
    if (artifact.aggregate.state !== 'per-variant') return
    expect(artifact.aggregate.variants).toHaveLength(2)
    for (const measure of artifact.aggregate.variants) {
      expect(measure.status).toBe('aggregated')
      if (measure.status !== 'aggregated') continue
      expect(measure.executedRuns).toBe(3)
      const expected = referenceStats(artifact.runs, measure.variant)
      expect(measure.mean).toBeCloseTo(expected.mean, 12)
      expect(measure.stddev).toBeCloseTo(expected.stddev, 12)
    }
  })

  it('produces an identical artifact for identical input (determinism)', () => {
    const a = run(makeDefinition(), createMockAblationExecutor(), TS)
    const b = run(makeDefinition(), createMockAblationExecutor(), TS)
    expect(a).toEqual(b)
    expect(a.meta.producedAt).toBe(TS)
    expect(executedMeasurements(a.runs, 'baseline')).toEqual(executedMeasurements(b.runs, 'baseline'))
    expect(executedMeasurements(a.runs, 'variant')).toEqual(executedMeasurements(b.runs, 'variant'))
  })
})

describe('mean / dispersion math on known measurements', () => {
  it('computes mean + population stddev per arm over executed runs', () => {
    const def = makeDefinition({ repetitions: 2 })
    const executor = resultsExecutor([
      { runKey: 'baseline:0', status: 'executed', measurement: 2 },
      { runKey: 'baseline:1', status: 'executed', measurement: 4 },
      { runKey: 'variant:0', status: 'executed', measurement: 6 },
      { runKey: 'variant:1', status: 'executed', measurement: 8 },
    ])
    const artifact = run(def, executor, TS)
    expect(artifact.aggregate).toEqual({
      state: 'per-variant',
      variants: [
        {
          variant: 'baseline',
          identity: 'Synthetic-Ablation-Baseline',
          status: 'aggregated',
          executedRuns: 2,
          mean: 3,
          stddev: 1,
        },
        {
          variant: 'variant',
          identity: 'Synthetic-Ablation-Variant',
          status: 'aggregated',
          executedRuns: 2,
          mean: 7,
          stddev: 1,
        },
      ],
    })
  })

  it('repetitions = 1 is accepted and yields stddev 0 for a single executed run', () => {
    const def = makeDefinition({ repetitions: 1 })
    const executor = resultsExecutor([
      { runKey: 'baseline:0', status: 'executed', measurement: 10 },
      { runKey: 'variant:0', status: 'executed', measurement: 12 },
    ])
    const artifact = run(def, executor, TS)
    if (artifact.aggregate.state !== 'per-variant') throw new Error('expected per-variant aggregate')
    expect(artifact.aggregate.variants[0]).toMatchObject({
      variant: 'baseline',
      status: 'aggregated',
      executedRuns: 1,
      mean: 10,
      stddev: 0,
    })
  })
})

describe('run status separation + aggregation over executed runs only', () => {
  it('records failed / partial / planned statuses distinctly and excludes them from aggregates', () => {
    const def = makeDefinition()
    // Seed failures and partials, and DROP one result entirely so that run
    // stays 'planned' — all four statuses present in one artifact.
    const seeded = createMockAblationExecutor({
      failedRunKeys: ['baseline:0'],
      partialRunKeys: ['variant:0'],
    })
    const executor: AblationExecutor = {
      execute(request) {
        return seeded.execute(request).filter(result => result.runKey !== 'variant:2')
      },
    }
    const artifact = run(def, executor, TS)

    expect(artifact.counts).toEqual({ planned: 1, executed: 3, failed: 1, partial: 1 })

    const byStatus = (status: AblationRunRecord['status']) => artifact.runs.filter(r => r.status === status).map(r => r.key)
    expect(byStatus('failed')).toEqual(['baseline:0'])
    expect(byStatus('partial')).toEqual(['variant:0'])
    expect(byStatus('planned')).toEqual(['variant:2'])
    expect(byStatus('executed')).toEqual(['baseline:1', 'baseline:2', 'variant:1'])

    // None of the excluded runs may carry a measurement.
    for (const runRecord of artifact.runs) {
      if (runRecord.status === 'executed') {
        expect(typeof runRecord.measurement).toBe('number')
      } else {
        expect(runRecord).not.toHaveProperty('measurement')
        if (runRecord.status !== 'planned') {
          expect(typeof runRecord.reason).toBe('string')
        } else {
          expect(runRecord).not.toHaveProperty('reason')
        }
      }
    }

    // Aggregates reflect ONLY the executed runs of each arm.
    expect(artifact.aggregate.state).toBe('per-variant')
    if (artifact.aggregate.state !== 'per-variant') return
    const baseline = artifact.aggregate.variants.find(v => v.variant === 'baseline')
    const variant = artifact.aggregate.variants.find(v => v.variant === 'variant')
    expect(baseline).toMatchObject({ status: 'aggregated', executedRuns: 2 })
    expect(variant).toMatchObject({ status: 'aggregated', executedRuns: 1 })
    if (baseline?.status === 'aggregated' && variant?.status === 'aggregated') {
      const expectedBaseline = referenceStats(artifact.runs, 'baseline')
      const expectedVariant = referenceStats(artifact.runs, 'variant')
      expect(baseline.mean).toBeCloseTo(expectedBaseline.mean, 12)
      expect(variant.mean).toBeCloseTo(expectedVariant.mean, 12)
    }
  })

  it('an arm with zero executed runs reports no-executed-runs (per-variant state), never zeros', () => {
    const def = makeDefinition()
    // Execute only the baseline arm; the whole variant arm stays planned.
    const executor: AblationExecutor = {
      execute(request) {
        const results: { runKey: string; status: 'executed'; measurement: number }[] = []
        for (let repetitionIndex = 0; repetitionIndex < request.definition.repetitions; repetitionIndex += 1) {
          results.push({
            runKey: ablationRunKey('baseline', repetitionIndex),
            status: 'executed',
            measurement: 5,
          })
        }
        return results
      },
    }
    const artifact = run(def, executor, TS)
    expect(artifact.counts).toEqual({ planned: 3, executed: 3, failed: 0, partial: 0 })
    expect(artifact.aggregate.state).toBe('per-variant')
    if (artifact.aggregate.state !== 'per-variant') return
    expect(artifact.aggregate.variants).toEqual([
      {
        variant: 'baseline',
        identity: 'Synthetic-Ablation-Baseline',
        status: 'aggregated',
        executedRuns: 3,
        mean: 5,
        stddev: 0,
      },
      {
        variant: 'variant',
        identity: 'Synthetic-Ablation-Variant',
        status: 'no-executed-runs',
      },
    ])
  })
})

describe('no executed runs → distinct empty-aggregate state (never fake zeros, never a conclusion)', () => {
  it('an executor reporting zero results leaves every run planned and emits no aggregate', () => {
    const artifact = run(makeDefinition(), resultsExecutor([]), TS)
    expect(artifact.runs).toHaveLength(6)
    for (const runRecord of artifact.runs) {
      expect(runRecord.status).toBe('planned')
      expect(runRecord).not.toHaveProperty('measurement')
    }
    expect(artifact.counts).toEqual({ planned: 6, executed: 0, failed: 0, partial: 0 })
    // The empty state carries NO variants / mean / stddev and no conclusion.
    expect(artifact.aggregate).toEqual({ state: 'no-executed-runs' })
    expect(artifact.aggregate).not.toHaveProperty('variants')
    expect(artifact.aggregate).not.toHaveProperty('mean')
    expect(JSON.stringify(artifact)).not.toMatch(/"(mean|stddev|difference|effect|conclusion|delta)"/)
  })

  it('the mock skipAll seed produces the same distinct empty state', () => {
    const artifact = run(makeDefinition(), createMockAblationExecutor({ skipAll: true }), TS)
    expect(artifact.aggregate).toEqual({ state: 'no-executed-runs' })
    expect(artifact.counts).toEqual({ planned: 6, executed: 0, failed: 0, partial: 0 })
  })

  it('failed + partial runs with NO executed run still produce no aggregate', () => {
    const executor = resultsExecutor([
      { runKey: 'baseline:0', status: 'failed', reason: 'fixture failure' },
      { runKey: 'variant:0', status: 'partial', reason: 'fixture partial' },
    ])
    const artifact = run(makeDefinition({ repetitions: 1 }), executor, TS)
    expect(artifact.aggregate).toEqual({ state: 'no-executed-runs' })
    expect(artifact.counts).toEqual({ planned: 0, executed: 0, failed: 1, partial: 1 })
  })
})

describe('structurally-invalid executor output → adapter fault codes', () => {
  it('non-array executor output throws DSH_ABLATION_INVALID_ADAPTER_OUTPUT', () => {
    for (const bad of [null, undefined, 42, { status: 'ok' }, 'results']) {
      expect(errorCodeOf(() => run(makeDefinition(), resultsExecutor([bad]), TS))).toBe(
        'DSH_ABLATION_ADAPTER_FAULT',
      )
    }
    expect(errorCodeOf(() => run(makeDefinition(), resultsExecutor(null as unknown as unknown[]), TS))).toBe(
      'DSH_ABLATION_INVALID_ADAPTER_OUTPUT',
    )
    expect(errorCodeOf(() => run(makeDefinition(), resultsExecutor(42 as unknown as unknown[]), TS))).toBe(
      'DSH_ABLATION_INVALID_ADAPTER_OUTPUT',
    )
    expect(errorCodeOf(() => run(makeDefinition(), resultsExecutor({ status: 'ok' } as unknown as unknown[]), TS))).toBe(
      'DSH_ABLATION_INVALID_ADAPTER_OUTPUT',
    )
  })

  it('a null / non-object run result is an adapter fault', () => {
    for (const bad of [null, 42, 'x']) {
      expect(errorCodeOf(() => run(makeDefinition(), resultsExecutor([bad]), TS))).toBe(
        'DSH_ABLATION_ADAPTER_FAULT',
      )
    }
  })

  it('a missing / empty / non-string runKey is an adapter fault', () => {
    for (const key of [undefined, '', '   ', 7]) {
      expect(errorCodeOf(() => run(
        makeDefinition(),
        resultsExecutor([{ runKey: key, status: 'executed', measurement: 1 }]),
        TS,
      ))).toBe('DSH_ABLATION_ADAPTER_FAULT')
    }
  })

  it('an unknown run key (not in the definition plan) is an adapter fault', () => {
    expect(errorCodeOf(() => run(
      makeDefinition(),
      resultsExecutor([{ runKey: 'variant:9', status: 'executed', measurement: 1 }]),
      TS,
    ))).toBe('DSH_ABLATION_ADAPTER_FAULT')
  })

  it('a duplicated run key is an adapter fault', () => {
    expect(errorCodeOf(() => run(
      makeDefinition(),
      resultsExecutor([
        { runKey: 'baseline:0', status: 'executed', measurement: 1 },
        { runKey: 'baseline:0', status: 'executed', measurement: 2 },
      ]),
      TS,
    ))).toBe('DSH_ABLATION_ADAPTER_FAULT')
  })

  it("an 'executed' result must carry a finite numeric measurement", () => {
    for (const measurement of [undefined, Number.NaN, Number.POSITIVE_INFINITY, '5', null]) {
      expect(errorCodeOf(() => run(
        makeDefinition(),
        resultsExecutor([{ runKey: 'baseline:0', status: 'executed', measurement }]),
        TS,
      ))).toBe('DSH_ABLATION_ADAPTER_FAULT')
    }
  })

  it("'failed' / 'partial' results must carry a non-empty reason", () => {
    for (const status of ['failed', 'partial']) {
      for (const reason of [undefined, '', '   ', 42]) {
        expect(errorCodeOf(() => run(
          makeDefinition(),
          resultsExecutor([{ runKey: 'baseline:0', status, reason }]),
          TS,
        ))).toBe('DSH_ABLATION_ADAPTER_FAULT')
      }
    }
  })

  it('an unknown per-run status is an adapter fault', () => {
    for (const status of ['planned', 'scheduled', 'maybe']) {
      expect(errorCodeOf(() => run(
        makeDefinition(),
        resultsExecutor([{ runKey: 'baseline:0', status, measurement: 1 }]),
        TS,
      ))).toBe('DSH_ABLATION_ADAPTER_FAULT')
    }
  })
})

describe('error transparency', () => {
  it('an executor that throws propagates as-is (never swallowed, never remapped)', () => {
    const executor: AblationExecutor = {
      execute: () => {
        throw new Error('ablation runner exploded')
      },
    }
    let caught: unknown
    try {
      run(makeDefinition(), executor, TS)
      expect.unreachable('expected runAblation to throw')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught).not.toBeInstanceOf(AblationError)
    expect((caught as Error).message).toBe('ablation runner exploded')
  })
})

describe('mock executor — direct defensive branches (tool validation bypassed)', () => {
  it('executes the full plan deterministically with synthetic values in [0, 100)', () => {
    const executor = createMockAblationExecutor()
    const def = makeDefinition()
    const first = executor.execute({ definition: def })
    const second = executor.execute({ definition: def })
    expect(first).toHaveLength(6)
    expect(first).toEqual(second)
    for (const result of first) {
      expect(result.status).toBe('executed')
      if (result.status === 'executed') {
        expect(result.measurement).toBeGreaterThanOrEqual(0)
        expect(result.measurement).toBeLessThan(100)
      }
    }
    expect(first.map(r => r.runKey)).toEqual([
      'baseline:0', 'baseline:1', 'baseline:2',
      'variant:0', 'variant:1', 'variant:2',
    ])
  })

  it('a seeded failed / partial run key changes only that run', () => {
    const executor = createMockAblationExecutor({
      failedRunKeys: ['baseline:0'],
      partialRunKeys: ['variant:1'],
    })
    const results = executor.execute({ definition: makeDefinition() })
    expect(results.find(r => r.runKey === 'baseline:0')).toMatchObject({ status: 'failed' })
    expect(results.find(r => r.runKey === 'variant:1')).toMatchObject({ status: 'partial' })
    expect(results.find(r => r.runKey === 'baseline:1')).toMatchObject({ status: 'executed' })
    expect(results.find(r => r.runKey === 'variant:0')).toMatchObject({ status: 'executed' })
  })

  it('the shared stateless mock instance reports identical results across calls', () => {
    const def = makeDefinition()
    const a = mockAblationExecutor.execute({ definition: def })
    const b = mockAblationExecutor.execute({ definition: def })
    expect(a).toEqual(b)
  })

  it('throws its own Error for a structurally invalid request (direct-call guard)', () => {
    const executor = createMockAblationExecutor()
    expect(() => executor.execute(null as never)).toThrow('request must be a non-null object')
    expect(() => executor.execute(undefined as never)).toThrow('request must be a non-null object')
    expect(() => executor.execute({ definition: null } as never)).toThrow('request must be a non-null object')
    expect(() => executor.execute({ definition: 42 } as never)).toThrow('request must be a non-null object')
  })

  it('skipAll returns an empty result list', () => {
    const executor = createMockAblationExecutor({ skipAll: true })
    expect(executor.execute({ definition: makeDefinition() })).toEqual([])
  })
})

describe('run key / seed canonicalization (adapter helpers)', () => {
  it('ablationRunKey and ablationRunSeed are deterministic and shared', () => {
    expect(ablationRunKey('baseline', 0)).toBe('baseline:0')
    expect(ablationRunKey('variant', 2)).toBe('variant:2')
    expect(ablationRunSeed(7, 0)).toBe(7)
    expect(ablationRunSeed(7, 2)).toBe(9)
    expect(ABLATION_RUN_ORIGIN).toBe('definition')
    expect(ABLATION_VARIANT_KINDS).toEqual(['baseline', 'variant'])
  })
})
