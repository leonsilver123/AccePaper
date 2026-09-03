// T13 citation-verify tool tests — run ONLY this file/dir:
//   node_modules/.bin/vitest run packages/research/dsh-research-tools/tests/citation-verify
//
// The tool under test (src/tools/citation-verify/index.ts) is a THIN delegation
// facade over T08 core verifyCitation. These tests prove the facade:
//  1. surfaces core verdicts untouched inside a frozen artifact envelope,
//  2. short-circuits the #6 red line BEFORE any resolver contact (through the
//     tool — resolver spy must never fire),
//  3. never masks resolver-confirmed fabrication as 'unverified',
//  4. distinguishes resolver availability from fabrication (per core semantics),
//  5. propagates core-style errors for empty branded ids + core runtime errors.

import { describe, expect, it, vi } from 'vitest'
import { verifyCitationTool } from '../../src/tools/citation-verify/index.ts'
import type { CitationVerifyToolDeps } from '../../src/tools/citation-verify/index.ts'
import {
  CITATION_CODE_NOT_FOUND,
  CITATION_CODE_RED_LINE_NO_ORIGINAL,
  CITATION_CODE_SUPPORTED,
  CITATION_CODE_TEMPORARILY_UNAVAILABLE,
  MockCitationResolverAdapter,
  ResearchError,
  verifyCitation as coreVerifyCitation,
} from '@deepseek-ai/dsh-research-core'
import type {
  CitationEvidence,
  CitationId,
  CitationRef,
  ClaimId,
} from '@deepseek-ai/dsh-research-core'

// ── G3 structural lock: prove THIN DELEGATION (rule5: reuse, not copy) ──────
//
// The behavioural tests above cannot distinguish "the tool delegates to core
// verifyCitation" from "the tool contains a copy of core's logic". This mock
// replaces ONLY core's verifyCitation export with a delegating spy — every
// other core export (ResearchError, MockCitationResolverAdapter, the frozen
// CITATION_CODE_* reason codes, ...) is spread through importOriginal so the
// existing fixtures/assertions in this file keep their exact semantics. The
// delegation test then asserts the tool calls core's verifyCitation exactly
// once with core's 7-argument order and wraps the returned result unchanged.
vi.mock('@deepseek-ai/dsh-research-core', async (importOriginal) => {
  const mod = (await importOriginal()) as typeof import('@deepseek-ai/dsh-research-core')
  return {
    ...mod,
    // Spy that RECORDS the call and DELEGATES to the real implementation, so
    // artifact.result stays a genuine core verdict for every existing test.
    verifyCitation: vi.fn(((...args: Parameters<typeof mod.verifyCitation>) =>
      mod.verifyCitation(...args)) as typeof mod.verifyCitation),
  }
})

const TS = 1_720_000_000_000

// ── Local fixture builders (core contracts; no core test code reused) ────────

function claim(id: string): ClaimId {
  return id as ClaimId
}
function citation(id: string): CitationId {
  return id as CitationId
}
function ref(kind: CitationRef['kind'], id: string): CitationRef {
  return { kind, id }
}

/** Evidence with the original text genuinely accessed (method !== 'none';
 *  accessedAt present per the core iff contract). */
function evidenceAccessed(extra?: { sourceUri?: string }): CitationEvidence {
  return {
    originalTextAccessed: true,
    method: 'manual_review',
    accessedAt: TS,
    ...(extra?.sourceUri !== undefined ? { sourceUri: extra.sourceUri } : {}),
  }
}

/** Evidence that NEVER accessed the original text (method === 'none';
 *  accessedAt must stay undefined). */
const EVIDENCE_NONE: CitationEvidence = {
  originalTextAccessed: false,
  method: 'none',
}

const REAL_RECORDS = {
  'doi:10.1000/real': { title: 'Real Paper', authors: ['Alice A'], retracted: false },
} as const

const fixtureResolver = (): MockCitationResolverAdapter =>
  new MockCitationResolverAdapter({ ...REAL_RECORDS })

// ── Tests ────────────────────────────────────────────────────────────────────

describe('citation-verify tool: delegation + artifact envelope', () => {
  it('resolved + original accessed + claimed supported => supported, artifact frozen', () => {
    const artifact = verifyCitationTool(
      {
        claimId: claim('c1'),
        citationId: citation('cit1'),
        ref: ref('doi', '10.1000/real'),
        evidence: evidenceAccessed({ sourceUri: 'https://doi.example/10.1000/real' }),
        timestamp: TS,
        options: { claimedConclusion: 'supported' },
      },
      { resolver: fixtureResolver() },
    )

    // Delegated core verdict surfaced untouched.
    expect(artifact.result.conclusion).toBe('supported')
    expect(artifact.result.redLineTriggered).toBe(false)
    expect(artifact.result.reasonCode).toBe(CITATION_CODE_SUPPORTED)
    expect(artifact.result.resolverStatus).toBe('resolved')
    expect(artifact.result.evidence.sourceUri).toBe('https://doi.example/10.1000/real')

    // Meta envelope present and auditable.
    expect(artifact.meta).toBeDefined()
    expect(artifact.meta.toolId).toBe('citation-verify')
    expect(artifact.meta.version).toBe('0.1.0')
    expect(artifact.meta.producedAt).toBe(TS)

    // Artifact is deeply frozen (top, meta, result, nested evidence).
    expect(Object.isFrozen(artifact)).toBe(true)
    expect(Object.isFrozen(artifact.meta)).toBe(true)
    expect(Object.isFrozen(artifact.result)).toBe(true)
    expect(Object.isFrozen(artifact.result.evidence)).toBe(true)
    expect(() => {
      ;(artifact as { result: { conclusion: string } }).result.conclusion = 'unsupported'
    }).toThrow()
    expect(() => {
      ;(artifact.meta as { toolId: string }).toolId = 'mutated'
    }).toThrow()
    expect(() => {
      ;(artifact.result.evidence as { method: string }).method = 'none'
    }).toThrow()
  })

  it('#6 red line short-circuits BEFORE resolver contact (through the tool)', () => {
    // A resolver that EXPLODES if contacted — proves the tool + core never
    // reach it when the #6 red line fires first.
    const resolveMetadata = vi.fn((_ref: CitationRef): never => {
      throw new Error('resolver MUST NOT be contacted when method=none claims supported')
    })

    const artifact = verifyCitationTool(
      {
        claimId: claim('c1'),
        citationId: citation('cit1'),
        ref: ref('doi', '10.1000/real'),
        evidence: EVIDENCE_NONE,
        timestamp: TS,
        options: { claimedConclusion: 'supported' },
      },
      { resolver: { resolveMetadata } },
    )

    expect(artifact.result.conclusion).toBe('blocked')
    expect(artifact.result.redLineTriggered).toBe(true)
    expect(artifact.result.reasonCode).toBe(CITATION_CODE_RED_LINE_NO_ORIGINAL)
    // Core never consults the resolver on this path => no resolverStatus.
    expect(artifact.result.resolverStatus).toBeUndefined()
    expect(resolveMetadata).not.toHaveBeenCalled()
  })

  it('fabricated literature (resolver-confirmed miss) => blocked + NOT_FOUND, never unverified', () => {
    const artifact = verifyCitationTool(
      {
        claimId: claim('c1'),
        citationId: citation('cit1'),
        ref: ref('doi', '10.1000/fabricated'), // absent from the fixture table
        evidence: evidenceAccessed(),
        timestamp: TS,
        options: { claimedConclusion: 'supported' },
      },
      { resolver: fixtureResolver() },
    )

    expect(artifact.result.conclusion).toBe('blocked')
    expect(artifact.result.redLineTriggered).toBe(true)
    expect(artifact.result.reasonCode).toBe(CITATION_CODE_NOT_FOUND)
    expect(artifact.result.resolverStatus).toBe('not_found')
    // A fabricated citation must NEVER read as "not yet verified".
    expect(artifact.result.conclusion).not.toBe('unverified')
  })

  it('resolver availability (seeded unavailable key) => unverified, NO red line, NOT found', () => {
    // Core semantics (verify.ts branch #1): 'temporarily_unavailable' is a
    // service fault, NOT a literature judgment => 'unverified', no red line,
    // and never misread as fabricated (not_found).
    const resolver = new MockCitationResolverAdapter(
      { ...REAL_RECORDS },
      { unavailableKeys: ['doi:10.1000/real'] },
    )

    const artifact = verifyCitationTool(
      {
        claimId: claim('c1'),
        citationId: citation('cit1'),
        ref: ref('doi', '10.1000/real'),
        evidence: evidenceAccessed(),
        timestamp: TS,
        options: { claimedConclusion: 'supported' },
      },
      { resolver },
    )

    expect(artifact.result.conclusion).toBe('unverified')
    expect(artifact.result.redLineTriggered).toBe(false)
    expect(artifact.result.reasonCode).toBe(CITATION_CODE_TEMPORARILY_UNAVAILABLE)
    expect(artifact.result.resolverStatus).toBe('temporarily_unavailable')
    // NOT blocked, NOT found — an outage is not fabrication and not a hard block.
    expect(artifact.result.conclusion).not.toBe('blocked')
    expect(artifact.result.reasonCode).not.toBe(CITATION_CODE_NOT_FOUND)
  })

  it('empty branded ids throw the core ResearchError (code DSH_CITATION_INVALID_REF)', () => {
    const deps: CitationVerifyToolDeps = { resolver: fixtureResolver() }
    const base = {
      ref: ref('doi', '10.1000/real'),
      evidence: evidenceAccessed(),
      timestamp: TS,
      options: { claimedConclusion: 'supported' as const },
    }

    expect(() =>
      verifyCitationTool({ ...base, claimId: '' as ClaimId, citationId: citation('cit1') }, deps),
    ).toThrow(ResearchError)
    expect(() =>
      verifyCitationTool({ ...base, claimId: '' as ClaimId, citationId: citation('cit1') }, deps),
    ).toThrow(/DSH_CITATION_INVALID_REF/)

    expect(() =>
      verifyCitationTool({ ...base, claimId: claim('c1'), citationId: '' as CitationId }, deps),
    ).toThrow(ResearchError)
    expect(() =>
      verifyCitationTool({ ...base, claimId: claim('c1'), citationId: '' as CitationId }, deps),
    ).toThrow(/DSH_CITATION_INVALID_REF/)
  })

  it('core runtime errors propagate unwrapped (no reinterpretation at the tool layer)', () => {
    // Non-cloneable evidence (function property) is rejected by core AFTER the
    // tool's id check; the tool must not swallow or re-wrap the failure.
    const badEvidence = {
      originalTextAccessed: true,
      method: 'manual_review',
      accessedAt: TS,
      fn: (): void => undefined,
    } as unknown as CitationEvidence

    const run = (): ReturnType<typeof verifyCitationTool> =>
      verifyCitationTool(
        {
          claimId: claim('c1'),
          citationId: citation('cit1'),
          ref: ref('doi', '10.1000/real'),
          evidence: badEvidence,
          timestamp: TS,
          options: { claimedConclusion: 'supported' },
        },
        { resolver: fixtureResolver() },
      )

    expect(run).toThrow(ResearchError)
    expect(run).toThrow(/DSH_CITATION_VALUE_NOT_CLONEABLE/)
  })

  it('falls back to the wall clock when timestamp is omitted (producedAt === result.timestamp)', () => {
    // Same supported path as the first test, but WITHOUT the caller-injected
    // timestamp — the tool's Date.now() fallback must stamp both the artifact
    // meta and the delegated core result with one identical clock value.
    const before = Date.now()
    const artifact = verifyCitationTool(
      {
        claimId: claim('c1'),
        citationId: citation('cit1'),
        ref: ref('doi', '10.1000/real'),
        evidence: evidenceAccessed({ sourceUri: 'https://doi.example/10.1000/real' }),
        options: { claimedConclusion: 'supported' },
      },
      { resolver: fixtureResolver() },
    )
    const after = Date.now()

    expect(artifact.meta.producedAt).toBe(artifact.result.timestamp)
    expect(typeof artifact.meta.producedAt).toBe('number')
    expect(Number.isFinite(artifact.meta.producedAt)).toBe(true)
    // The single clock read must sit within the call window (±10 s margin for
    // slow CI), not some unrelated far-future/past epoch.
    expect(artifact.meta.producedAt).toBeGreaterThan(before - 10_000)
    expect(artifact.meta.producedAt).toBeLessThan(after + 10_000)
    expect(artifact.result.conclusion).toBe('supported')
  })

  it('delegates to core verifyCitation EXACTLY ONCE, in core 7-argument order, and wraps the result', () => {
    // The top-level `verifyCitation` import is the mocked delegating spy.
    const spy = coreVerifyCitation as unknown as ReturnType<typeof vi.fn>
    spy.mockClear()

    const input = {
      claimId: claim('c1'),
      citationId: citation('cit1'),
      ref: ref('doi', '10.1000/real'),
      evidence: evidenceAccessed({ sourceUri: 'https://doi.example/10.1000/real' }),
      timestamp: TS,
      options: { claimedConclusion: 'supported' as const },
    }
    const deps: CitationVerifyToolDeps = { resolver: fixtureResolver() }

    const artifact = verifyCitationTool(input, deps)

    // Thin delegation: one and only one core call (no retry / no fallback /
    // no copied adjudication path that would bypass core).
    expect(spy).toHaveBeenCalledTimes(1)

    // The tool must pass core's EXACT 7-argument order — the same positional
    // order as verify.ts exports — forwarding the caller's values untouched.
    const args = spy.mock.calls[0]
    expect(args).toHaveLength(7)
    expect(args[0]).toBe(input.claimId) // claimId
    expect(args[1]).toBe(input.citationId) // citationId
    expect(args[2]).toBe(input.ref) // ref
    expect(args[3]).toBe(input.evidence) // evidence
    expect(args[4]).toBe(deps.resolver) // resolver adapter seam
    expect(args[5]).toBe(input.timestamp) // timestamp
    expect(args[6]).toBe(input.options) // options

    // The returned artifact wraps that same core verdict, attributed to this tool.
    expect(artifact.meta.toolId).toBe('citation-verify')
    expect(artifact.result).toEqual(spy.mock.results[0].value)
    expect(artifact.result.conclusion).toBe('supported')
    expect(artifact.result.reasonCode).toBe(CITATION_CODE_SUPPORTED)
  })
})
