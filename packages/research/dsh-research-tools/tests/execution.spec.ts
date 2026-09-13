// Unified research-tool execution adapter (T13-R) — vitest spec.
//
// Proves executeResearchTool is the SINGLE dispatch map: for every tool it
// returns exactly what the canonical pure function returns for the same input,
// injects fixture dependencies by default where safe, demands them where they
// are real (citation-verify), rejects unknown ids, and fails structurally
// invalid input before reaching the pure function.

import { describe, expect, it } from 'vitest'
import type {
  AblationDefinition, FigureSpec, RoadmapGraph, ThreeLineTableModel,
} from '@deepseek-ai/dsh-research-tools'
import {
  ResearchToolExecutionError,
  constructClaim,
  createMockAblationExecutor,
  executeResearchTool,
  mockLiteratureSearchAdapter,
  renderFigure,
  renderRoadmap,
  renderThreeLineTable,
  runAblation,
  runLiteratureSearch,
} from '@deepseek-ai/dsh-research-tools'

const TS = 1_720_000_000_000

const FIGURE_SPEC: FigureSpec = {
  kind: 'bar',
  title: 'Latency by stage',
  width: 640,
  height: 400,
  series: [
    { name: 'p50', unit: 'ms', values: [12.5, 18.2, 9.1] },
    { name: 'p99', unit: 'ms', values: [41, 66, 28] },
  ],
  axes: {
    xLabel: 'Stage',
    categories: ['encode', 'transmit', 'decode'],
    yLabel: 'Latency',
    yUnit: 'ms',
  },
  legend: { position: 'top', title: 'Legend' },
  tokens: { palette: ['#1f77b4', '#ff7f0e'], fontFamily: 'sans-serif', fontSize: 13 },
  seed: 7,
}

const TABLE_MODEL: ThreeLineTableModel = {
  title: 'Synthetic benchmark results',
  columns: [
    { header: 'Approach' },
    { header: 'BLEU', decimals: 1 },
  ],
  rows: [
    [
      { kind: 'text', text: 'adaptive-rl' },
      { kind: 'number', value: 42.1 },
    ],
  ],
  footnotes: ['Values are synthetic.'],
}

const ROADMAP_GRAPH: RoadmapGraph = {
  nodes: [
    { id: 'input', label: '文献/数据' },
    { id: 'method', label: '方法' },
  ],
  edges: [{ from: 'input', to: 'method' }],
}

const ABLATION_DEFINITION: AblationDefinition = {
  baselineIdentity: 'Synthetic-Ablation-Baseline',
  variantIdentity: 'Synthetic-Ablation-Variant',
  removedOrReplacedComponents: [
    { component: 'Synthetic-Attention-Head', action: 'removed' },
  ],
  dataset: { version: 'synth-bench-v1', split: 'synth-eval', seed: 7 },
  metric: { name: 'synth-top1-accuracy', direction: 'higher_is_better' },
  repetitions: 3,
}

describe('executeResearchTool — single dispatch map', () => {
  it('literature-search matches the direct call (fixture adapter injected by default)', async () => {
    const input = { topic: 'adaptive traffic signal control' }
    const viaAdapter = await executeResearchTool('literature-search', input, undefined, TS)
    const direct = await runLiteratureSearch(input, mockLiteratureSearchAdapter, TS)
    expect(viaAdapter).toEqual(direct)
    expect(viaAdapter).toHaveProperty('meta.toolId', 'literature-search')
  })

  it('claim-construct matches the direct call', async () => {
    const input = { assertion: 'Adaptive control reduces delay.', now: TS }
    const viaAdapter = await executeResearchTool('claim-construct', input, undefined, TS)
    const direct = constructClaim(input)
    expect(viaAdapter).toEqual(direct)
  })

  it('figure matches the direct call (pure render)', async () => {
    const viaAdapter = await executeResearchTool('figure', FIGURE_SPEC, undefined, TS)
    const direct = renderFigure(FIGURE_SPEC, TS)
    expect(viaAdapter).toEqual(direct)
    expect(viaAdapter).toHaveProperty('meta.toolId', 'figure')
  })

  it('three-line-table matches the direct call', async () => {
    const input = { model: TABLE_MODEL, target: 'markdown' }
    const viaAdapter = await executeResearchTool('three-line-table', input, undefined, TS)
    const direct = renderThreeLineTable(TABLE_MODEL, 'markdown', TS)
    expect(viaAdapter).toEqual(direct)
  })

  it('roadmap matches the direct call (mermaid default render)', async () => {
    const input = { graph: ROADMAP_GRAPH }
    const viaAdapter = await executeResearchTool('roadmap', input, undefined, TS)
    const direct = renderRoadmap(ROADMAP_GRAPH, {}, TS)
    expect(viaAdapter).toEqual(direct)
  })

  it('ablation matches the direct call (fixture executor injected by default)', async () => {
    const input = { definition: ABLATION_DEFINITION }
    const viaAdapter = await executeResearchTool('ablation', input, undefined, TS)
    const direct = runAblation(ABLATION_DEFINITION, createMockAblationExecutor(), TS)
    expect(viaAdapter).toEqual(direct)
    expect(viaAdapter).toHaveProperty('meta.toolId', 'ablation')
  })

  it('citation-verify refuses to run without its injected resolver dependency', async () => {
    const validInput = { claimId: 'c1', citationId: 'cit1', ref: { title: 'R' }, evidence: { text: 'E' }, options: {} }
    // The dispatch is asynchronous, so the refusal surfaces as a rejection.
    await expect(executeResearchTool('citation-verify', validInput, undefined, TS))
      .rejects.toThrow(ResearchToolExecutionError)
    await expect(executeResearchTool('citation-verify', validInput, undefined, TS))
      .rejects.toThrow(/citationDeps/)
  })

  it('rejects unknown tool ids before touching anything', async () => {
    await expect(executeResearchTool('no-such-tool', {}, undefined, TS))
      .rejects.toThrow(ResearchToolExecutionError)
    await expect(executeResearchTool('no-such-tool', {}, undefined, TS))
      .rejects.toThrow(/unknown research tool/)
  })

  it('fails structurally invalid business input before the pure function', async () => {
    await expect(executeResearchTool('literature-search', { topic: '' }, undefined, TS))
      .rejects.toThrow(/topic/)
    await expect(executeResearchTool('ablation', {}, undefined, TS))
      .rejects.toThrow(/definition/)
    // Figure: strict schema rejects a non-object spec before any render.
    await expect(executeResearchTool('figure', null, undefined, TS))
      .rejects.toThrow(/figure/)
  })
})

it('is TOCTOU-safe: a hostile mutating input cannot change data between validation and business read', async () => {
  const input: Record<string, unknown> = {}
  let reads = 0
  Object.defineProperty(input, 'topic', {
    get() {
      reads += 1
      // First read (single snapshot pass) is the short legal topic; any
      // subsequent re-read would exceed the schema length and fail — so if the
      // adapter re-read the live object, validation or execution would break.
      return reads === 1 ? 'adaptive traffic signals' : 'x'.repeat(600)
    },
    enumerable: true,
    configurable: true,
  })
  const artifact = await executeResearchTool('literature-search', input, undefined, TS) as {
    query?: { topic?: string }
  }
  // Business saw exactly the snapshotted (first-read) topic.
  expect(artifact.query?.topic).toBe('adaptive traffic signals')
  // Mutating the caller's object afterwards must NOT affect the result.
  Object.defineProperty(input, 'topic', { value: 'corrupted-after-call' })
  const again = await executeResearchTool('literature-search', { topic: 'adaptive traffic signals' }, undefined, TS) as {
    query?: { topic?: string }
  }
  expect(again.query?.topic).toBe('adaptive traffic signals')
})
