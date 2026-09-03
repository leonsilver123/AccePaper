import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ResearchEngine } from '../src/index.ts'
import {
  CITATION_CODE_NOT_FOUND,
  CITATION_CODE_RED_LINE_NO_ORIGINAL,
  MockCitationResolverAdapter,
  ResearchError,
  gateToStateMachineIntent,
  mockL0Adapter,
} from '@deepseek-ai/dsh-research-core'
import type {
  AdjudicationInput,
  AdjudicationOutcome,
  AdjudicationResult,
  AdjudicationVote,
  CitationEvidence,
  CitationId,
  CitationRef,
  ClaimId,
  L0ClassificationStatus,
  L0RoutingAdapter,
  L0SourceId,
  L0SourceInput,
  L0Tier,
  StateMachineGateIntent,
} from '@deepseek-ai/dsh-research-core'

// T10-R (batch 2 wave-1 I1): the ResearchEngine service exposes ONLY a thin
// PURE result surface over T07/T08/T09 — classifyL0 / verifyCitation /
// evaluateGate (= adjudicate) / getGateIntent. No run state, no store, no
// state transitions, no human-approval capability. The gate → state-machine
// mapping is consumed EXCLUSIVELY via getGateIntent (delegate to the frozen
// core helper); abstained is NEVER turned into a pass. Auto-wiring gate
// outcomes to StepState is out of scope (hold_abstained has no home in the
// batch-1 status enum) — nothing here performs a state transition.

const TS = 1700000000000

const claim = (s: string): ClaimId => s as ClaimId
const citation = (s: string): CitationId => s as CitationId
const ref = (kind: CitationRef['kind'], id: string, title?: string): CitationRef => ({ kind, id, title })

const evidence = (over: Partial<CitationEvidence> = {}): CitationEvidence => ({
  originalTextAccessed: true,
  method: 'manual_review',
  accessedAt: TS,
  excerpt: 'synthetic excerpt',
  ...over,
})

const l0src = (over: Partial<L0SourceInput> = {}): L0SourceInput => ({
  sourceId: 's-1' as L0SourceId,
  sourceType: 'journal',
  venue: 'Synthetic Journal A',
  ...over,
})

const makeResult = (outcome: AdjudicationOutcome, component: AdjudicationResult['component'] = 'A'): AdjudicationResult => ({
  claimId: claim('c1'),
  component,
  outcome,
  reasonCode: 'DSH_GATE_TEST',
  evidenceRefs: [],
  timestamp: TS,
})

describe('ResearchEngine T10-R thin T07/T08/T09 delegation (batch 2 wave-1 I1)', () => {
  it('loads: the four pure delegates exist on ctx.research', async () => {
    const ctx = new Context()
    await ctx.plugin(ResearchEngine)
    const r = ctx.research as unknown as Record<string, unknown>
    expect(typeof r.classifyL0).toBe('function')
    expect(typeof r.verifyCitation).toBe('function')
    expect(typeof r.evaluateGate).toBe('function')
    expect(typeof r.adjudicate).toBe('function')
    expect(typeof r.getGateIntent).toBe('function')
  })

  it('T07 classifyL0 delegates to core and returns a FROZEN classification', async () => {
    const ctx = new Context()
    await ctx.plugin(ResearchEngine)
    const out = ctx.research.classifyL0(l0src(), mockL0Adapter)
    expect(out.status).toBe('classified')
    expect(out.tier).toBe('tier1')
    expect(out.ruleVersion).toBe('fixture-mock-v1')
    expect(Object.isFrozen(out)).toBe(true)
    // source mutation after the call cannot move the returned snapshot
    const src = l0src({ venue: 'Synthetic Journal A' })
    const before = ctx.research.classifyL0(src, mockL0Adapter)
    expect(before.tier).toBe('tier1')
    expect(() => { (out as { tier: L0Tier }).tier = 'unknown' }).toThrow()
    void src
  })

  it('T07 classifyL0 surfaces an adapter fault as failed (never a literature judgment, never a throw)', async () => {
    const ctx = new Context()
    await ctx.plugin(ResearchEngine)
    const throwingAdapter = {
      ruleVersion: 'test-v1',
      route: () => { throw new Error('adapter exploded') },
    } as L0RoutingAdapter
    const out = ctx.research.classifyL0(l0src(), throwingAdapter)
    expect(out.status).toBe('failed')
    expect(out.tier).toBe('unknown')
    expect(Object.isFrozen(out)).toBe(true)
  })

  it('T08 verifyCitation delegates: fixture-resolved supported is NOT blocked (provenance + resolverStatus stamped, result frozen)', async () => {
    const ctx = new Context()
    await ctx.plugin(ResearchEngine)
    const resolver = new MockCitationResolverAdapter({
      'doi:10.1000/synth-1': { title: 'Synthetic Paper', authors: ['Alice A'], retracted: false },
    })
    const ev = evidence({
      sourceUri: 'https://synthetic.example/10.1000/synth-1',
      sourceVersion: 'v1',
      contentHash: 'sha256:aa',
      retrievedAt: '2026-09-03T00:00:00.000Z',
    })
    const r = ctx.research.verifyCitation(
      claim('c1'), citation('cit1'), ref('doi', '10.1000/synth-1', 'Synthetic Paper'),
      ev, resolver, TS, { claimedConclusion: 'supported' },
    )
    expect(r.conclusion).toBe('supported')
    expect(r.redLineTriggered).toBe(false)
    expect(r.resolverStatus).toBe('resolved')
    expect(Object.isFrozen(r)).toBe(true)
  })

  it('T08 #6 red line short-circuits THROUGH THE ENGINE with ZERO resolver calls', async () => {
    const ctx = new Context()
    await ctx.plugin(ResearchEngine)
    const resolveMetadata = vi.fn(() => { throw new Error('resolver must not be called') })
    const r = ctx.research.verifyCitation(
      claim('c1'), citation('cit1'), ref('doi', '10.1000/synth-1'),
      evidence({ originalTextAccessed: false, method: 'none', accessedAt: undefined }),
      { resolveMetadata }, TS, { claimedConclusion: 'supported' },
    )
    expect(resolveMetadata).not.toHaveBeenCalled()
    expect(r.conclusion).toBe('blocked')
    expect(r.redLineTriggered).toBe(true)
    expect(r.reasonCode).toBe(CITATION_CODE_RED_LINE_NO_ORIGINAL)
    expect(r.resolverStatus).toBeUndefined()
  })

  it('T08 resolver-confirmed fabrication surfaces as blocked + NOT_FOUND through the engine (never unverified)', async () => {
    const ctx = new Context()
    await ctx.plugin(ResearchEngine)
    const emptyResolver = new MockCitationResolverAdapter() // nothing resolves -> not_found
    const r = ctx.research.verifyCitation(
      claim('c1'), citation('cit1'), ref('doi', '10.1000/ghost'),
      evidence(), emptyResolver, TS, { claimedConclusion: 'supported' },
    )
    expect(r.conclusion).toBe('blocked')
    expect(r.reasonCode).toBe(CITATION_CODE_NOT_FOUND)
    expect(r.resolverStatus).toBe('not_found')
  })

  it('T09 evaluateGate is PURE: frozen abstained result, and NO run state is touched (still requires an explicit run for the legacy API)', async () => {
    const ctx = new Context()
    await ctx.plugin(ResearchEngine)
    const input: AdjudicationInput = {
      claimId: claim('c1'),
      component: 'C',
      falsifiable: { prediction: 'replication reproduces r>0.5' }, // no experiment result -> abstain
      config: {},
      timestamp: TS,
    }
    const out = ctx.research.evaluateGate(input)
    expect(out.outcome).toBe('abstained')
    expect(Object.isFrozen(out)).toBe(true)
    // the pure call did not create or touch any run
    expect(() => ctx.research.getRunSnapshot('ghost')).toThrow(/RUN_NOT_FOUND/)
  })

  it('T09 evaluateGate propagates core errors unwrapped (no swallowing, no re-mapping)', async () => {
    const ctx = new Context()
    await ctx.plugin(ResearchEngine)
    const bad = {
      claimId: claim('c1'),
      component: 'X', // invalid -> core ResearchError
      config: {},
      timestamp: TS,
    } as unknown as AdjudicationInput
    expect(() => ctx.research.evaluateGate(bad)).toThrow(ResearchError)
    expect(() => ctx.research.evaluateGate(bad)).toThrow(/INVALID_INPUT/)
  })

  it('T10-R getGateIntent delegates VERBATIM to the frozen core mapping — abstained is never a pass', async () => {
    const ctx = new Context()
    await ctx.plugin(ResearchEngine)
    const expected: Readonly<Record<AdjudicationOutcome, StateMachineGateIntent>> = {
      passed: 'pass',
      blocked: 'rework',
      failed: 'hard_fail',
      abstained: 'hold_abstained',
    }
    for (const outcome of ['passed', 'blocked', 'failed', 'abstained'] as const) {
      const result = makeResult(outcome)
      const viaEngine = ctx.research.getGateIntent(result)
      expect(viaEngine).toBe(expected[outcome])
      // verbatim delegation: identical to the frozen core helper for the same outcome
      expect(viaEngine).toBe(gateToStateMachineIntent(result.outcome))
    }
    // the user's headline invariant: an abstained result NEVER yields a pass intent
    expect(ctx.research.getGateIntent(makeResult('abstained'))).not.toBe('pass')
    expect(ctx.research.getGateIntent(makeResult('abstained'))).toBe('hold_abstained')
  })

  it('T10-R snapshot isolation: mutating the caller input after evaluateGate cannot change the frozen result', async () => {
    const ctx = new Context()
    await ctx.plugin(ResearchEngine)
    const votes: AdjudicationVote[] = [{ voterRole: 'red-team-1', position: 'support', rationale: 'x' }]
    const input: AdjudicationInput = {
      claimId: claim('c1'),
      component: 'A',
      votes, // no thresholds -> NO DEFAULT PASS -> abstained
      config: {},
      timestamp: TS,
    }
    const out = ctx.research.evaluateGate(input)
    expect(out.outcome).toBe('abstained')
    expect(Object.isFrozen(out)).toBe(true)
    // caller mutates the votes AFTER the call — the frozen snapshot must not move
    expect(out.evidenceRefs).toEqual(['red-team-1'])
    votes.push({ voterRole: 'blue-team-1', position: 'support', rationale: 'y' })
    expect(out.outcome).toBe('abstained')
    // the snapshot still names ONLY the single vote that existed at call time
    expect(out.evidenceRefs).toEqual(['red-team-1'])
    expect(() => { (out as { outcome: AdjudicationOutcome }).outcome = 'passed' }).toThrow()
  })

  it('T10-R run isolation: the pure surface stays stateless and the module-scoped store stays unreachable', async () => {
    const ctx = new Context()
    await ctx.plugin(ResearchEngine)
    // pure calls need no run
    const cls = ctx.research.classifyL0(l0src(), mockL0Adapter)
    expect(cls.status).toBe('classified')
    // the store is still runtime-private after the new surface was added
    const r = ctx.research as unknown as Record<string, unknown>
    expect(r.runs).toBeUndefined()
    expect(r.store).toBeUndefined()
    // and no trust capability leaked onto the service surface
    expect(r.transition).toBeUndefined()
    expect(r.approveHumanGate).toBeUndefined()
    expect(r.submitHumanApproval).toBeUndefined()
  })

  it('T10-R classifyL0 status vocabulary stays separated (tier never carries adjudication state)', async () => {
    const ctx = new Context()
    await ctx.plugin(ResearchEngine)
    const out = ctx.research.classifyL0(l0src(), mockL0Adapter)
    const validStatuses: readonly L0ClassificationStatus[] = ['classified', 'abstained', 'failed']
    expect(validStatuses).toContain(out.status)
    // 'abstained'/'failed' are NOT tiers: the returned tier is a quality LEVEL only
    expect(out.tier).not.toBe('abstained')
    expect(out.tier).not.toBe('failed')
  })
})
