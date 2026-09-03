// @deepseek-ai/dsh-research-tools — public-entry surface lock (main-Agent
// owned; lives with the integration commit, NOT with any single tool).
//
// Why this spec exists: the per-tool specs import their own module
// (src/tools/<name>/index.ts) directly, so they cannot catch a broken
// aggregate wiring in src/index.ts (a missed re-export, a name collision, a
// stale constant). This spec imports the PACKAGE ENTRY and locks the surface a
// future T19 registry would consume: every stable tool id/version/function is
// reachable, the three ids are distinct, and re-exports are the SAME function
// instances the tool modules export (identity — no shadow copies).
//
// Import note: the spec reaches the entry by repo-relative path ('.ts'
// suffix), the same convention the tool specs use. Name-based consumption
// ('@deepseek-ai/dsh-research-tools') is exercised once the gitignored lib/
// build exists; the exports map already routes "." -> lib.

import { describe, expect, it } from 'vitest'
import {
  ABLATION_TOOL_ID,
  ABLATION_TOOL_VERSION,
  CITATION_VERIFY_TOOL_ID,
  CITATION_VERIFY_TOOL_VERSION,
  CLAIM_CONSTRUCT_TOOL_ID,
  CLAIM_CONSTRUCT_TOOL_VERSION,
  CLAIM_SUPPORT_STATUS_NOT_CLAIMED,
  FIGURE_TOOL_ID,
  FIGURE_TOOL_VERSION,
  LITERATURE_SEARCH_ERROR_PREFIX,
  LITERATURE_SEARCH_TOOL_ID,
  LITERATURE_SEARCH_TOOL_VERSION,
  MAX_CLAIM_ASSERTION_LENGTH,
  THREE_LINE_TABLE_TOOL_ID,
  THREE_LINE_TABLE_TOOL_VERSION,
  LiteratureSearchError,
  constructClaim,
  freezeArtifact,
  mockLiteratureSearchAdapter,
  renderFigure,
  renderThreeLineTable,
  runAblation,
  runClaimConstruct,
  runLiteratureSearch,
  verifyCitationTool,
} from '../../src/index.ts'
import { constructClaim as toolLocalConstructClaim } from '../../src/tools/claim-construct/index.ts'
import { runLiteratureSearch as toolLocalRunLiteratureSearch } from '../../src/tools/literature-search/index.ts'
import { verifyCitationTool as toolLocalVerifyCitationTool } from '../../src/tools/citation-verify/index.ts'
import { runAblation as toolLocalRunAblation } from '../../src/tools/ablation/index.ts'
import { renderFigure as toolLocalRenderFigure } from '../../src/tools/figure/index.ts'
import { renderThreeLineTable as toolLocalRenderThreeLineTable } from '../../src/tools/three-line-table/index.ts'

describe('dsh-research-tools public entry (src/index.ts)', () => {
  it('re-exports the shared convention surface (freezeArtifact)', () => {
    expect(typeof freezeArtifact).toBe('function')
    const frozen = freezeArtifact({ nested: { list: [1, 2] } })
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.nested)).toBe(true)
    expect(Object.isFrozen(frozen.nested.list)).toBe(true)
  })

  it('exposes the T12 literature-search tool with its stable identity', () => {
    expect(LITERATURE_SEARCH_TOOL_ID).toBe('literature-search')
    expect(LITERATURE_SEARCH_TOOL_VERSION).toMatch(/^0\.1\./)
    expect(LITERATURE_SEARCH_ERROR_PREFIX).toBe('DSH_LITERATURE_SEARCH_')
    expect(typeof runLiteratureSearch).toBe('function')
    expect(typeof LiteratureSearchError).toBe('function')
    expect(typeof mockLiteratureSearchAdapter).toBe('object')
    // Identity: the entry routes to the exact tool-module implementation.
    expect(runLiteratureSearch).toBe(toolLocalRunLiteratureSearch)
  })

  it('exposes the T13 citation-verify tool with its stable identity', () => {
    expect(CITATION_VERIFY_TOOL_ID).toBe('citation-verify')
    expect(CITATION_VERIFY_TOOL_VERSION).toBe('0.1.0')
    expect(typeof verifyCitationTool).toBe('function')
    expect(verifyCitationTool).toBe(toolLocalVerifyCitationTool)
  })

  it('exposes the T14 claim-construct tool with its stable identity', () => {
    expect(CLAIM_CONSTRUCT_TOOL_ID).toBe('claim-construct')
    expect(CLAIM_CONSTRUCT_TOOL_VERSION).toBe('1.0.0')
    expect(MAX_CLAIM_ASSERTION_LENGTH).toBe(2000)
    expect(CLAIM_SUPPORT_STATUS_NOT_CLAIMED).toBe('not_claimed')
    expect(typeof constructClaim).toBe('function')
    expect(constructClaim).toBe(toolLocalConstructClaim)
    expect(runClaimConstruct).toBe(constructClaim)
  })

  it('exposes the T15 ablation tool with its stable identity', () => {
    expect(ABLATION_TOOL_ID).toBe('ablation')
    expect(ABLATION_TOOL_VERSION).toMatch(/^0\.1\./)
    expect(typeof runAblation).toBe('function')
    expect(runAblation).toBe(toolLocalRunAblation)
  })

  it('exposes the T16 figure tool with its stable identity', () => {
    expect(FIGURE_TOOL_ID).toBe('figure')
    expect(FIGURE_TOOL_VERSION).toMatch(/^0\.1\./)
    expect(typeof renderFigure).toBe('function')
    expect(renderFigure).toBe(toolLocalRenderFigure)
  })

  it('exposes the T17 three-line-table tool with its stable identity', () => {
    expect(THREE_LINE_TABLE_TOOL_ID).toBe('three-line-table')
    expect(THREE_LINE_TABLE_TOOL_VERSION).toMatch(/^0\.1\./)
    expect(typeof renderThreeLineTable).toBe('function')
    expect(renderThreeLineTable).toBe(toolLocalRenderThreeLineTable)
  })

  it('keeps the six tool ids mutually distinct (registry-key safety)', () => {
    const ids = [
      LITERATURE_SEARCH_TOOL_ID,
      CITATION_VERIFY_TOOL_ID,
      CLAIM_CONSTRUCT_TOOL_ID,
      ABLATION_TOOL_ID,
      FIGURE_TOOL_ID,
      THREE_LINE_TABLE_TOOL_ID,
    ]
    expect(new Set(ids).size).toBe(6)
  })

  it('produces a frozen, self-attributed artifact end-to-end through the entry (T14)', () => {
    const artifact = constructClaim({
      assertion: 'Synthetic claim produced through the public entry',
      now: 1_700_000_000_000,
    })
    expect(Object.isFrozen(artifact)).toBe(true)
    expect(Object.isFrozen(artifact.claim)).toBe(true)
    expect(artifact.meta.toolId).toBe(CLAIM_CONSTRUCT_TOOL_ID)
    expect(artifact.meta.producedAt).toBe(1_700_000_000_000)
    expect(artifact.claim.supportStatus).toBe('not_claimed')
    expect(artifact.claim.claimId.startsWith('claim-')).toBe(true)
  })

  it('produces a frozen, self-attributed artifact end-to-end through the entry (T12)', () => {
    // The synthetic mock adapter is this package's own fixture — same corpus
    // the T12 spec exercises; here we only lock the entry-level contract.
    const artifact = runLiteratureSearch(
      { topic: 'synthetic retraction', maxResults: 3 },
      mockLiteratureSearchAdapter,
      1_700_000_000_000,
    )
    expect(Object.isFrozen(artifact)).toBe(true)
    expect(artifact.meta.toolId).toBe(LITERATURE_SEARCH_TOOL_ID)
    expect(artifact.meta.producedAt).toBe(1_700_000_000_000)
    expect(['ok', 'unavailable']).toContain(artifact.outcome)
    if (artifact.outcome === 'ok') {
      expect(Array.isArray(artifact.hits)).toBe(true)
      expect(artifact.hits.length).toBeLessThanOrEqual(3)
      for (const hit of artifact.hits) expect(Object.isFrozen(hit)).toBe(true)
    }
  })
})
