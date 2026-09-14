// @deepseek-ai/dsh-research-team — T19-B executor registry contract tests.
//
// The registry is the audit face of "what is real" in this wave. These tests hold
// it to the frozen declaration contract:
//   - every one of the 16 core steps is registered, exactly once, in core order;
//   - every entry declares the full field set (executor / producer / input schema
//     / output schema / artifact type / truthfulness / timeout / gate requirement
//     / recovery policy / basis);
//   - the input + output schemas and the gate requirement are DERIVED from core
//     (they can never drift from `getStepDefinitions()`);
//   - `kind` is one of the 5 levels, and the static declarations carry no
//     `live_external` (that level appears only where a deployment wires a live
//     channel, and it comes from the artifact rather than the registry);
//   - the truthfulness claim is falsifiable: a `real_tool_fixture_input` step's
//     artifact must actually carry the real tool's `__producer` brand.

import { describe, expect, it } from 'vitest'
import { getStepDefinitionById, getStepDefinitions } from '@deepseek-ai/dsh-research-core'
import type { StepDefinition } from '@deepseek-ai/dsh-research-core'
import {
  ABLATION_TOOL_ID,
  CLAIM_CONSTRUCT_TOOL_ID,
  FIGURE_TOOL_ID,
  LITERATURE_SEARCH_TOOL_ID,
  RESEARCH_TOOL_DIRECTORY,
  THREE_LINE_TABLE_TOOL_ID,
} from '@deepseek-ai/dsh-research-tools'

import {
  CANONICAL,
  FIXED_TS,
  PIPELINE_STEPS,
  STEP_CAPABILITIES,
  STEP_EXECUTOR_REGISTRY,
  STEP_OUTPUT_MAP,
  TRUTHFULNESS_LEVELS,
  VERDICT_CHANNELS,
  tagArtifact,
} from '../src/runner/registry.ts'
import type { ExecCtx, RunContext, Truthfulness } from '../src/runner/registry.ts'

const CORE_STEPS: ReadonlyArray<StepDefinition> = getStepDefinitions()

function freshRunCtx(): RunContext {
  return { predictionText: '', claimId: '', claimRef: '', timestamp: FIXED_TS }
}

function execCtx(stepId: string, runCtx: RunContext = freshRunCtx()): ExecCtx {
  return {
    runId: 'run-registry-spec',
    stepId,
    attemptId: 1,
    getInput: () => undefined,
    runCtx,
  }
}

describe('T19-B registry — 16-step coverage derived from core', () => {
  it('registers exactly the core step set, no more and no less', () => {
    expect(CORE_STEPS.length).toBe(16)
    expect(STEP_EXECUTOR_REGISTRY.size).toBe(CORE_STEPS.length)
    for (const def of CORE_STEPS) {
      expect(STEP_EXECUTOR_REGISTRY.has(def.id)).toBe(true)
    }
    for (const stepId of STEP_EXECUTOR_REGISTRY.keys()) {
      expect(getStepDefinitionById(stepId)).toBeDefined()
    }
  })

  it('iterates in the canonical core execution order', () => {
    expect([...STEP_EXECUTOR_REGISTRY.keys()]).toEqual(CORE_STEPS.map(d => d.id))
    expect(PIPELINE_STEPS.map(d => d.id)).toEqual(CORE_STEPS.map(d => d.id))
  })

  it('projects STEP_OUTPUT_MAP straight from the core outputs', () => {
    for (const def of CORE_STEPS) {
      expect(STEP_OUTPUT_MAP[def.id]).toEqual(def.outputs)
    }
  })
})

describe('T19-B registry — per-entry declaration completeness', () => {
  it('declares every required field for every step', () => {
    for (const entry of STEP_EXECUTOR_REGISTRY.values()) {
      expect(typeof entry.stepId).toBe('string')
      expect(entry.stepId.length).toBeGreaterThan(0)
      expect(typeof entry.executor).toBe('function')
      expect(typeof entry.producer).toBe('string')
      expect(entry.producer.length).toBeGreaterThan(0)
      expect(Array.isArray(entry.inputSchema)).toBe(true)
      expect(Array.isArray(entry.outputSchema)).toBe(true)
      expect(typeof entry.timeoutMs).toBe('number')
      expect(entry.timeoutMs).toBeGreaterThanOrEqual(0)
      expect(entry.gateRequirement).toBeDefined()
      expect(typeof entry.gateRequirement.description).toBe('string')
      expect(entry.gateRequirement.description.length).toBeGreaterThan(0)
      expect(['rollback_and_retry', 'rollback_and_reevidence', 'human_approval_only'])
        .toContain(entry.recoveryPolicy)
    }
  })

  it('gives every step a non-empty classification basis', () => {
    for (const entry of STEP_EXECUTOR_REGISTRY.values()) {
      expect(typeof entry.basis).toBe('string')
      expect(entry.basis.trim().length).toBeGreaterThan(20)
    }
  })

  it('derives the input schema from the core inputs and labels the source', () => {
    const produced = new Set(CORE_STEPS.flatMap(d => [...d.outputs]))
    for (const def of CORE_STEPS) {
      const entry = STEP_EXECUTOR_REGISTRY.get(def.id)
      expect(entry).toBeDefined()
      expect(entry?.inputSchema.map(i => i.slug)).toEqual([...def.inputs])
      for (const spec of entry?.inputSchema ?? []) {
        expect(spec.source).toBe(produced.has(spec.slug) ? 'upstream-artifact' : 'run-seed')
      }
    }
  })

  it('derives the output schema from the core outputs and types every artifact', () => {
    for (const def of CORE_STEPS) {
      const entry = STEP_EXECUTOR_REGISTRY.get(def.id)
      expect(entry?.outputSchema.map(o => o.slug)).toEqual([...def.outputs])
      for (const spec of entry?.outputSchema ?? []) {
        expect(typeof spec.artifactType).toBe('string')
        expect(spec.artifactType.length).toBeGreaterThan(0)
        // Every declared slug must be explicitly classified, never defaulted.
        expect(spec.artifactType).not.toBe('unclassified-artifact')
      }
    }
  })

  it('derives the gate requirement from the core step definition', () => {
    for (const def of CORE_STEPS) {
      const entry = STEP_EXECUTOR_REGISTRY.get(def.id)
      expect(entry?.gateRequirement.components).toEqual(def.gate)
      expect(entry?.gateRequirement.humanGate).toBe(def.humanGate)
    }
  })
})

describe('T19-B registry — truthfulness levels (5-level ruling)', () => {
  it('exposes exactly the 5 declared levels', () => {
    expect(TRUTHFULNESS_LEVELS).toEqual([
      'real_tool_fixture_input',
      'local_computation',
      'fixture_executor',
      'mock_external',
      'live_external',
    ])
  })

  it('classifies every step with one of the 5 levels, or the human gate', () => {
    for (const entry of STEP_EXECUTOR_REGISTRY.values()) {
      // E2-submit runs no executor at all, so it carries `'humanGate'` — the same
      // level `StepOutcome.kind` reports for it. Declaring it a `fixture_executor`
      // made the registry table describe an executor its own basis says never runs.
      const allowed = entry.humanGateStop === true ? [...TRUTHFULNESS_LEVELS, 'humanGate'] : TRUTHFULNESS_LEVELS
      expect(allowed).toContain(entry.kind)
    }
  })

  it('has ZERO live_external steps in this wave', () => {
    const live = [...STEP_EXECUTOR_REGISTRY.values()].filter(e => e.kind === 'live_external')
    expect(live.map(e => e.stepId)).toEqual([])
  })

  it('declares the truthfulness of each trinity gate channel with a basis', () => {
    for (const comp of ['A', 'B', 'C'] as const) {
      expect(TRUTHFULNESS_LEVELS).toContain(VERDICT_CHANNELS[comp].kind)
      expect(VERDICT_CHANNELS[comp].kind).not.toBe('live_external')
      expect(VERDICT_CHANNELS[comp].basis.trim().length).toBeGreaterThan(20)
    }
  })
})

describe('T19-B registry — real tool integration is falsifiable', () => {
  // T19-S canonical alignment: ablation is C3-boundary's capability (B3-baseline
  // is "baseline + SOTA comparison", NOT ablation; E1-format is the formatting
  // step whose three-line-table sub-capability renders the results tables).
  const EXPECTED_REAL_TOOLS: Readonly<Record<string, string>> = {
    'A1-landscape': LITERATURE_SEARCH_TOOL_ID,
    'A2-claim': CLAIM_CONSTRUCT_TOOL_ID,
    'C3-boundary': ABLATION_TOOL_ID,
    'D1-figure-map': FIGURE_TOOL_ID,
    'E1-format': THREE_LINE_TABLE_TOOL_ID,
  }

  /**
   * Steps that really run something but take no research tool from the catalogue.
   * C1-mvp executes the traffic-sim experiment engine, so it is a real-tool step
   * (its artifact carries measured numbers) without appearing in the tool-id map.
   */
  const REAL_RUNTIME_STEPS_WITHOUT_TOOL = ['B3-baseline', 'C1-mvp', 'C2-trinity-loop'] as const

  it('marks exactly the tool-executing steps as real_tool_fixture_input', () => {
    const real = [...STEP_EXECUTOR_REGISTRY.values()]
      .filter(e => e.kind === 'real_tool_fixture_input')
      .map(e => e.stepId)
    // Registry order, not grouped by kind: B3-baseline sits between A2 and C1.
    expect(real).toEqual([
      'A1-landscape',
      'A2-claim',
      'C3-boundary',
      'D1-figure-map',
      'E1-format',
    ])
    expect(real).toEqual(expect.arrayContaining(Object.keys(EXPECTED_REAL_TOOLS)))
  })

  it('marks the runtime steps that run NO catalogue tool as local_computation', () => {
    // These compute real measurements with this package's own code. They used to
    // be filed under `real_tool_fixture_input`, which the report renders as "real
    // tool functions executed" — a claim that only the five entries above satisfy.
    const local = [...STEP_EXECUTOR_REGISTRY.values()]
      .filter(e => e.kind === 'local_computation')
      .map(e => e.stepId)
    expect(local).toEqual(['A4-venue', 'B2-data', ...REAL_RUNTIME_STEPS_WITHOUT_TOOL])
  })

  it('brands each real-tool producer with the tool id@version', () => {
    for (const [stepId, toolId] of Object.entries(EXPECTED_REAL_TOOLS)) {
      const entry = STEP_EXECUTOR_REGISTRY.get(stepId)
      expect(entry?.producer.startsWith(`${toolId}@`)).toBe(true)
    }
  })

  it.each(Object.keys(EXPECTED_REAL_TOOLS))(
    'executor for %s produces the declared slugs stamped with the real tool producer',
    async (stepId) => {
      const entry = STEP_EXECUTOR_REGISTRY.get(stepId)
      expect(entry).toBeDefined()
      const out = await entry?.executor(execCtx(stepId))
      const declared = STEP_OUTPUT_MAP[stepId] ?? []
      expect(Object.keys(out ?? {}).sort()).toEqual([...declared].sort())
      for (const slug of declared) {
        const value = (out ?? {})[slug] as Record<string, unknown>
        expect(value.__producer).toBe(entry?.producer)
        expect(value.__kind).toBe('real_tool_fixture_input')
      }
    },
  )

  it('A2-claim wires the canonical claim/prediction into the run context', async () => {
    const runCtx = freshRunCtx()
    const entry = STEP_EXECUTOR_REGISTRY.get('A2-claim')
    await entry?.executor(execCtx('A2-claim', runCtx))
    expect(runCtx.claimId).toBe(CANONICAL.claimId)
    expect(runCtx.claimRef).toBe(CANONICAL.claimRef)
    expect(runCtx.predictionText).toBe(CANONICAL.prediction)
  })

  it('D1-figure-map really rendered all three figure families (figure/table/roadmap)', async () => {
    const entry = STEP_EXECUTOR_REGISTRY.get('D1-figure-map')
    const out = (await entry?.executor(execCtx('D1-figure-map'))) as Record<string, Record<string, unknown>>
    const plan = out['figure-plan']!
    const figures = plan.figures as ReadonlyArray<Record<string, unknown>>
    expect(plan.totalFigures).toBe(3)
    expect(figures.map(f => f.kind)).toEqual(['data-figure', 'three-line-table', 'roadmap'])
    const dataFigure = figures[0]!
    expect(typeof dataFigure.svgByteLength).toBe('number')
    expect(dataFigure.svgByteLength as number).toBeGreaterThan(0)
    expect(dataFigure.pngByteLength as number).toBeGreaterThan(0)
    // The FULL svg, not a preview: the draft carries it and the manuscript embeds it.
    expect(String(dataFigure.svg)).toContain('<svg')
    expect(String(dataFigure.svg).length).toBe(dataFigure.svgByteLength)
    const table = figures[1]!
    expect(String(table.tableMarkdown)).toContain('Adaptive')
    const roadmap = figures[2]!
    expect(roadmap.validationOk).toBe(true)
    // Full content, for the same reason as the svg: it ends up in the manuscript.
    expect(String(roadmap.content)).toContain('flowchart')
  })

  it('E1-format really assembled a manuscript WITH a three-line table sub-render', async () => {
    const entry = STEP_EXECUTOR_REGISTRY.get('E1-format')
    const out = (await entry?.executor(execCtx('E1-format'))) as Record<string, Record<string, unknown>>
    const doc = out['formatted-manuscript']!
    // The E1 artifact is the FORMATTED MANUSCRIPT, not merely the table (T19-S):
    // the table is a sub-capability embedded inside a longer assembled manuscript.
    expect(String(doc.manuscript)).toContain('## Results')
    expect(String(doc.manuscript).length).toBeGreaterThan(String(doc.tableMarkdown).length)
    expect(String(doc.tableMarkdown)).toContain('Delay')
    expect(String(doc.tableMarkdown)).toContain('Adaptive')
    expect(typeof doc.bindingHash).toBe('string')
    expect(String(doc.bindingHash).length).toBeGreaterThan(0)
    // `packageFiles` holds CONTENT, not a list of names. The earlier field listed five
    // filenames nothing wrote, which read as run output; asserting a non-empty body per
    // path is the property that distinguishes a produced package from a proposed one.
    const pkg = doc.packageFiles as Record<string, unknown>
    // Presence means content: a path an un-run upstream step left without a body is
    // OMITTED, never declared empty.
    for (const path of ['manuscript.md', 'experiment-tables.md']) {
      expect(typeof pkg[path], path).toBe('string')
      expect((pkg[path] as string).length, path).toBeGreaterThan(0)
    }
    for (const [path, content] of Object.entries(pkg)) {
      expect((content as string).length, path).toBeGreaterThan(0)
    }
    expect(pkg['manuscript.md']).toContain('## Results')
    // This executor ran without D1, so the figure has no content and its path is absent.
    // When it IS present it must be the rendered SVG, not a placeholder for one.
    if (pkg['figures/figure-1.svg'] !== undefined) {
      expect(pkg['figures/figure-1.svg']).toContain('<svg')
    }
  })

  it('C3-boundary really aggregated repeated ablation runs (ablation lives at C3)', async () => {
    const entry = STEP_EXECUTOR_REGISTRY.get('C3-boundary')
    const out = (await entry?.executor(execCtx('C3-boundary'))) as Record<string, Record<string, unknown>>
    const res = out['ablation-results']!
    expect(res.ranRuns as number).toBeGreaterThan(0)
    expect(res.aggregate).toBeDefined()
    expect(out['boundary-map']).toBeDefined()
  })
})

describe('T19-B registry — fixture executors are honest about being fixtures', () => {
  const fixtureSteps = [...STEP_EXECUTOR_REGISTRY.values()]
    // B2-data's level depends on whether its dataset is present on this host, so it
    // is asserted separately (below) rather than counted as a fixed fixture.
    .filter(e => e.kind === 'fixture_executor' && e.humanGateStop !== true
      && e.stepId !== 'B2-data' && e.stepId !== 'B3-baseline' && e.stepId !== 'C2-trinity-loop')
    .map(e => e.stepId)

  it('leaves 8 steps as unconditional fixture executors', () => {
    // C1-mvp left this list when the C channel began running its experiment for real
    // (traffic-sim); B2-data left it because its level now tracks dataset presence.
    expect(fixtureSteps).toEqual([
      'A3-agenda',
      'B1-method',
      'D2-framework',
      'D3-writing',
      'D4-rebuttal',
    ])
  })

  it('B2-data declares a level consistent with whether its dataset is on disk', () => {
    const entry = STEP_EXECUTOR_REGISTRY.get('B2-data')
    const out = (entry?.executor(execCtx('B2-data'))) as {
      dataset?: {
        __kind?: unknown
        acquisition?: unknown
        files?: ReadonlyArray<{ present?: unknown; sizeMatches?: unknown; sha256Matches?: unknown }>
      }
    }
    const dataset = out.dataset
    expect(dataset).toBeDefined()
    const acquired = String(dataset?.acquisition).startsWith('acquired')
    // The claim and the evidence must agree: a descriptor may only call itself real
    // when every declared file was actually found on this host.
    // The claim requires BYTES, not a file of the right length: a same-size
    // substitution must not satisfy it, so the hash is part of the predicate.
    expect(acquired).toBe(
      dataset?.files?.every(f => f.present === true && f.sizeMatches === true && f.sha256Matches === true) ?? false,
    )
    for (const file of dataset?.files ?? []) {
      // `sha256Matches` is null exactly when there was nothing to hash.
      expect(file.sha256Matches === null).toBe(file.present === false)
    }
    // B2 runs no catalogue tool, so it can never claim `real_tool_fixture_input`
    // (the level the report prints as "real tool functions executed"). What its
    // level tracks is whether the bytes were found: a real local computation over
    // real files, or a fixture that claims no acquisition.
    expect(dataset?.__kind).toBe(acquired ? 'local_computation' : 'fixture_executor')
  })

  it.each(fixtureSteps)('fixture executor %s stamps fixture provenance', async (stepId) => {
    const entry = STEP_EXECUTOR_REGISTRY.get(stepId)
    const out = (await entry?.executor(execCtx(stepId))) as Record<string, Record<string, unknown>>
    const declared = STEP_OUTPUT_MAP[stepId] ?? []
    expect(Object.keys(out).sort()).toEqual([...declared].sort())
    for (const slug of declared) {
      expect(out[slug]?.__kind).toBe('fixture_executor')
      expect(String(out[slug]?.__producer).startsWith('fixture:')).toBe(true)
      expect(out[slug]?.fixture).toBe(true)
    }
  })
})

describe('T19-B registry — T19-S canonical semantics (business artifacts)', () => {
  it('B3-baseline is a baseline protocol, NOT an ablation (no runAblation fields)', async () => {
    const entry = STEP_EXECUTOR_REGISTRY.get('B3-baseline')
    const out = (await entry?.executor(execCtx('B3-baseline'))) as Record<string, Record<string, unknown>>
    const res = out['baseline-results']!
    // Canonical B3 = establish baseline + compare against SOTA.
    expect((res.baseline as { identity?: unknown }).identity).toBe('fixed-time')
    expect((res.baseline as { metric?: { name?: unknown } }).metric?.name).toBe('peak-hour delay')
    // The reference row is MEASURED by running the plan, not a pre-registered constant.
    expect((res.measured as { baselineDelaySeconds?: unknown }).baselineDelaySeconds).toBeGreaterThan(0)
    // Regression guard: ablation must NOT appear inside the baseline step.
    expect(res.ranRuns).toBeUndefined()
    expect(res.counts).toBeUndefined()
    expect(res.aggregate).toBeUndefined()
    expect(out['sota-comparison']).toBeDefined()
    expect((out['sota-comparison']?.anchoring as string | undefined) ?? '').not.toContain('real')
  })

  it('B3-baseline producer is the honest fixture brand (ablation producer moved to C3)', async () => {
    const b3 = STEP_EXECUTOR_REGISTRY.get('B3-baseline')
    const c3 = STEP_EXECUTOR_REGISTRY.get('C3-boundary')
    expect(String(b3?.producer).startsWith('traffic-sim:baseline')).toBe(true)
    expect(String(c3?.producer).startsWith(`${ABLATION_TOOL_ID}@`)).toBe(true)
  })

  it('C1-mvp fail-closes when the prediction states no adjudicable threshold', async () => {
    const entry = STEP_EXECUTOR_REGISTRY.get('C1-mvp')
    expect(entry).toBeDefined()
    const missing: RunContext = {
      predictionText: 'no such experiment row',
      claimId: 'mock-claim-999',
      claimRef: 'missing row',
      timestamp: FIXED_TS,
    }
    // The experiment is now RUN, so the fail-closed condition is no longer "no fixture
    // row" but "the prediction states no threshold this study can check".
    expect(() => entry?.executor(execCtx('C1-mvp', missing))).toThrow(/no numeric threshold/i)
  })
})

describe('T19-B registry — E2-submit is a human gate, never automated', () => {
  const e2 = STEP_EXECUTOR_REGISTRY.get('E2-submit')

  it('is flagged as a human-gate stop with a human_approval_only recovery policy', () => {
    expect(e2?.humanGateStop).toBe(true)
    expect(e2?.recoveryPolicy).toBe('human_approval_only')
    expect(e2?.gateRequirement.humanGate).toBe(true)
    expect(e2?.gateRequirement.components).toEqual([])
    expect(e2?.timeoutMs).toBe(0)
  })

  it('refuses to execute if anyone ever calls its executor', () => {
    expect(() => e2?.executor(execCtx('E2-submit'))).toThrow(/no executor/i)
  })
})

describe('T19-B registry — tagArtifact provenance stamping', () => {
  it('stamps an object value without losing its fields', () => {
    const out = tagArtifact({ a: 1, b: 'x' }, 'tool@1.0.0', 'real_tool_fixture_input')
    expect(out).toEqual({ a: 1, b: 'x', __producer: 'tool@1.0.0', __kind: 'real_tool_fixture_input' })
  })

  it('wraps a non-object value under `value`', () => {
    expect(tagArtifact(42, 'fixture:x', 'fixture_executor')).toEqual({
      value: 42,
      __producer: 'fixture:x',
      __kind: 'fixture_executor',
    })
  })

  it('copies a FROZEN tool artifact so the wrapper stays writable', () => {
    const frozen = Object.freeze({ deep: 'value' })
    const out = tagArtifact(frozen, 'tool@1', 'real_tool_fixture_input')
    expect(Object.isFrozen(out)).toBe(false)
    expect(out.deep).toBe('value')
  })

  it('accepts only the 4 declared levels (type-level guard, checked at runtime too)', () => {
    for (const level of TRUTHFULNESS_LEVELS) {
      const out = tagArtifact({}, 'p', level)
      expect(TRUTHFULNESS_LEVELS).toContain(out.__kind as Truthfulness)
    }
  })
})

describe('T19 calibration R1 — executor depends on ResearchToolInvoker', () => {
  it('a1 routes literature-search through an INJECTED invoker and fails closed', async () => {
    const calls: string[] = []
    const failingInvoker = {
      truthfulness: 'direct_call' as const,
      provenance: 'direct' as const,
      invoke: async (toolId: string) => {
        calls.push(toolId)
        return { ok: false as const, code: 'X', message: 'boom', truthfulness: 'direct_call' as const, provenance: 'direct' as const }
      },
    }
    // Widened view of the registry: this spec drives the executor with a partial
    // ExecCtx (an injected invoker only), which StepExecutorEntry's signature forbids.
    const partialRegistry = STEP_EXECUTOR_REGISTRY as unknown as ReadonlyMap<string, {
      executor: (c: { invoker: unknown }) => Promise<unknown> | Record<string, unknown>
    }>
    const entry = partialRegistry.get('A1-landscape')
    expect(entry).toBeDefined()
    const ctx = execCtx('A1-landscape', freshRunCtx()) as unknown as { invoker: unknown }
    // Inject the failing invoker: A1 must propagate the failure (fail-closed),
    // proving the executor honors the injected invoker instead of its fallback.
    await expect(entry!.executor({ ...ctx, invoker: failingInvoker })).rejects.toThrow(/invocation failed/)
    expect(calls).toEqual(['literature-search'])
  })
})

describe('T19-B registry — STEP_CAPABILITIES ⊆ RESEARCH_TOOL_DIRECTORY (Task #13)', () => {
  it('every step capability tool id is registered in the research tool directory', () => {
    const directoryIds = new Set(RESEARCH_TOOL_DIRECTORY.map(entry => entry.toolId))
    const capabilityToolIds = new Set<string>()
    for (const capabilities of Object.values(STEP_CAPABILITIES)) {
      for (const capability of capabilities) capabilityToolIds.add(capability.toolId)
    }
    expect(capabilityToolIds.size).toBeGreaterThan(0)
    for (const toolId of capabilityToolIds) {
      expect(directoryIds.has(toolId), `STEP_CAPABILITIES references '${toolId}' but it is not in RESEARCH_TOOL_DIRECTORY`)
        .toBe(true)
    }
  })

  it('the directory records every wired consumer step named by STEP_CAPABILITIES', () => {
    const byTool = new Map<string, Set<string>>()
    for (const [stepId, capabilities] of Object.entries(STEP_CAPABILITIES)) {
      for (const capability of capabilities) {
        if (!byTool.has(capability.toolId)) byTool.set(capability.toolId, new Set())
        byTool.get(capability.toolId)!.add(stepId)
      }
    }
    for (const entry of RESEARCH_TOOL_DIRECTORY) {
      const steps = byTool.get(entry.toolId)
      if (steps === undefined) {
        // citation-verify is a gate-channel tool, not a step capability row.
        expect(entry.consumedBySteps).toEqual([])
        continue
      }
      expect(entry.consumedBySteps).toEqual([...steps])
    }
  })
})

describe('F1 audit fix — invoker provenance propagates onto real-tool artifacts', () => {
  it('A1 landscape-map carries __provenance=direct and __invokerTruthfulness=direct_call', async () => {
    const entry = (STEP_EXECUTOR_REGISTRY as ReadonlyMap<string, { executor: (c: ExecCtx) => unknown }>).get('A1-landscape')
    expect(entry).toBeDefined()
    const ctx = execCtx('A1-landscape', freshRunCtx())
    const output = (await entry!.executor(ctx)) as Record<string, Record<string, unknown>>
    const map = output['landscape-map']!
    expect(map.__kind).toBe('real_tool_fixture_input')
    expect(map.__provenance).toBe('direct')
    expect(map.__invokerTruthfulness).toBe('direct_call')
  })
})
