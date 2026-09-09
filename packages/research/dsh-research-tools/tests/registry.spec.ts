// Research tool directory (Task #13 registration surface) — vitest spec.
//
// Proves the RESEARCH_TOOL_DIRECTORY is complete, drift-free against the
// exported *_TOOL_ID / *_TOOL_VERSION constants, honest about every
// non-exposed row, and that the model-ready subset is exactly the pure renders.

import { describe, expect, it } from 'vitest'
import {
  ABLATION_TOOL_ID,
  ABLATION_TOOL_VERSION,
  CITATION_VERIFY_TOOL_ID,
  CITATION_VERIFY_TOOL_VERSION,
  CLAIM_CONSTRUCT_TOOL_ID,
  CLAIM_CONSTRUCT_TOOL_VERSION,
  FIGURE_TOOL_ID,
  FIGURE_TOOL_VERSION,
  LITERATURE_SEARCH_TOOL_ID,
  LITERATURE_SEARCH_TOOL_VERSION,
  RESEARCH_TOOL_DIRECTORY,
  ROADMAP_TOOL_ID,
  ROADMAP_TOOL_VERSION,
  THREE_LINE_TABLE_TOOL_ID,
  THREE_LINE_TABLE_TOOL_VERSION,
  assertDirectoryHonest,
  getResearchToolDirectoryEntry,
  modelReadyToolIds,
} from '@deepseek-ai/dsh-research-tools'

describe('RESEARCH_TOOL_DIRECTORY — Task #13 registration surface', () => {
  it('registers exactly the seven P2 tools (T12–T18)', () => {
    expect(RESEARCH_TOOL_DIRECTORY).toHaveLength(7)
    const ids = RESEARCH_TOOL_DIRECTORY.map(entry => entry.toolId).sort()
    expect(ids).toEqual([
      ABLATION_TOOL_ID,
      CITATION_VERIFY_TOOL_ID,
      CLAIM_CONSTRUCT_TOOL_ID,
      FIGURE_TOOL_ID,
      LITERATURE_SEARCH_TOOL_ID,
      ROADMAP_TOOL_ID,
      THREE_LINE_TABLE_TOOL_ID,
    ].sort())
  })

  it('rows never drift from the exported tool constants (id + version + name)', () => {
    const byId = new Map(RESEARCH_TOOL_DIRECTORY.map(entry => [entry.toolId, entry]))
    expect(byId.get(LITERATURE_SEARCH_TOOL_ID)?.version).toBe(LITERATURE_SEARCH_TOOL_VERSION)
    expect(byId.get(CITATION_VERIFY_TOOL_ID)?.version).toBe(CITATION_VERIFY_TOOL_VERSION)
    expect(byId.get(CLAIM_CONSTRUCT_TOOL_ID)?.version).toBe(CLAIM_CONSTRUCT_TOOL_VERSION)
    expect(byId.get(ABLATION_TOOL_ID)?.version).toBe(ABLATION_TOOL_VERSION)
    expect(byId.get(FIGURE_TOOL_ID)?.version).toBe(FIGURE_TOOL_VERSION)
    expect(byId.get(THREE_LINE_TABLE_TOOL_ID)?.version).toBe(THREE_LINE_TABLE_TOOL_VERSION)
    expect(byId.get(ROADMAP_TOOL_ID)?.version).toBe(ROADMAP_TOOL_VERSION)
    for (const entry of RESEARCH_TOOL_DIRECTORY) {
      expect(entry.name).toBe(entry.toolId)
      expect(entry.canonicalFunctions.length).toBeGreaterThan(0)
    }
  })

  it('classifies the pipeline-bound tools honestly and the pure renders as model-ready', () => {
    const exposure = new Map(RESEARCH_TOOL_DIRECTORY.map(e => [e.toolId, e.modelExposure]))
    // Injected-adapter / fixture-bound tools stay pipeline-only this wave.
    expect(exposure.get(LITERATURE_SEARCH_TOOL_ID)).toBe('pipeline_only')
    expect(exposure.get(CITATION_VERIFY_TOOL_ID)).toBe('pipeline_only')
    expect(exposure.get(CLAIM_CONSTRUCT_TOOL_ID)).toBe('pipeline_only')
    expect(exposure.get(ABLATION_TOOL_ID)).toBe('pipeline_only')
    // Pure renders over declared data are agent-loop bridgeable.
    expect(exposure.get(FIGURE_TOOL_ID)).toBe('model_ready')
    expect(exposure.get(THREE_LINE_TABLE_TOOL_ID)).toBe('model_ready')
    expect(exposure.get(ROADMAP_TOOL_ID)).toBe('model_ready')
    // Directory order is stable (batch order T12–T18).
    expect(RESEARCH_TOOL_DIRECTORY.map(e => e.toolId)).toEqual([
      'literature-search', 'citation-verify', 'claim-construct', 'ablation',
      'figure', 'three-line-table', 'roadmap',
    ])
  })

  it('records the canonical step consumers (subset-consistent with STEP_CAPABILITIES)', () => {
    const consumers = new Map(RESEARCH_TOOL_DIRECTORY.map(e => [e.toolId, e.consumedBySteps]))
    expect(consumers.get(LITERATURE_SEARCH_TOOL_ID)).toEqual(['A1-landscape', 'B3-baseline'])
    expect(consumers.get(CLAIM_CONSTRUCT_TOOL_ID)).toEqual(['A2-claim'])
    expect(consumers.get(ABLATION_TOOL_ID)).toEqual(['C3-boundary'])
    expect(consumers.get(FIGURE_TOOL_ID)).toEqual(['D1-figure-map'])
    expect(consumers.get(THREE_LINE_TABLE_TOOL_ID)).toEqual(['D1-figure-map', 'E1-format'])
    expect(consumers.get(ROADMAP_TOOL_ID)).toEqual(['D1-figure-map'])
    expect(consumers.get(CITATION_VERIFY_TOOL_ID)).toEqual([])
  })

  it('passes the honesty gate (every non-model-ready row carries a reason)', () => {
    expect(() => { assertDirectoryHonest() }).not.toThrow()
    for (const entry of RESEARCH_TOOL_DIRECTORY) {
      if (entry.modelExposure !== 'model_ready') {
        expect(entry.reason.trim().length).toBeGreaterThan(20)
      }
    }
  })

  it('lookup helpers behave', () => {
    expect(getResearchToolDirectoryEntry(FIGURE_TOOL_ID)?.name).toBe('figure')
    expect(getResearchToolDirectoryEntry('does-not-exist')).toBeUndefined()
    expect(modelReadyToolIds()).toEqual(['figure', 'three-line-table', 'roadmap'])
  })
})
