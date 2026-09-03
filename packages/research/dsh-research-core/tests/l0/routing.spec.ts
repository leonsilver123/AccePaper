import { describe, expect, it } from 'vitest'
import type { L0Classification, L0ClassificationStatus, L0SourceId, L0SourceType, L0Tier } from '../../src/contracts.ts'
import { ResearchError } from '../../src/engine/state-machine.ts'
import {
  classifyL0,
  createMockL0Adapter,
  mockL0Adapter,
  MOCK_L0_RULE_VERSION,
} from '../../src/l0/index.ts'
import type { L0RoutingAdapter, L0SourceInput } from '../../src/l0/index.ts'

const sid = (s: string): L0SourceId => s as L0SourceId

const PASSING = new Set<L0Tier>(['tier1', 'tier2', 'tier3'])

/** Build a source, defaulting to a journal with id 'S1' (mutable so the
 *  immutability tests can mutate it after a classify call). */
function src(
  o: Partial<L0SourceInput> = {},
): L0SourceInput {
  return {
    sourceType: 'journal',
    sourceId: sid('S1'),
    ...o,
  } as L0SourceInput
}

describe('T07 L0 — each source type routes to the correct tier via the mock fixture', () => {
  it('journal with a tier1 synthetic venue -> tier1 / low / classified', () => {
    const r = classifyL0(src({ sourceType: 'journal', venue: 'Synthetic Journal A' }), mockL0Adapter)
    expect(r.status).toBe('classified')
    expect(r.tier).toBe('tier1')
    expect(r.riskLevel).toBe('low')
    expect(r.sourceType).toBe('journal')
    expect(r.ruleVersion).toBe(MOCK_L0_RULE_VERSION)
    expect(r.preprintNotPeerReviewed).toBe(false)
  })
  it('conference with a tier1 synthetic venue -> tier1', () => {
    const r = classifyL0(src({ sourceType: 'conference', venue: 'Synthetic Conference A' }), mockL0Adapter)
    expect(r.status).toBe('classified')
    expect(r.tier).toBe('tier1')
    expect(r.sourceType).toBe('conference')
  })
  it('journal with a tier2 synthetic venue -> tier2', () => {
    const r = classifyL0(src({ sourceType: 'journal', venue: 'Synthetic Conference C' }), mockL0Adapter)
    expect(r.status).toBe('classified')
    expect(r.tier).toBe('tier2')
  })
  it('journal with a tier3 (regional) synthetic venue -> tier3 / medium', () => {
    const r = classifyL0(src({ sourceType: 'journal', venue: 'Synthetic Regional Journal A' }), mockL0Adapter)
    expect(r.status).toBe('classified')
    expect(r.tier).toBe('tier3')
    expect(r.riskLevel).toBe('medium')
  })
  it('journal with an unlisted venue -> unvetted (source known, tier unknown)', () => {
    const r = classifyL0(src({ sourceType: 'journal', venue: 'Obscure Journal' }), mockL0Adapter)
    expect(r.status).toBe('classified')
    expect(r.tier).toBe('unvetted')
    expect(r.riskLevel).toBe('medium')
  })
  it('standard with CAS partition 1 -> tier1 (injected signal, not fetched)', () => {
    const r = classifyL0(src({ sourceType: 'standard', casPartition: '1' }), mockL0Adapter)
    expect(r.status).toBe('classified')
    expect(r.tier).toBe('tier1')
  })
  it('dataset -> unvetted (no versioned rule for type)', () => {
    const r = classifyL0(src({ sourceType: 'dataset' }), mockL0Adapter)
    expect(r.status).toBe('classified')
    expect(r.tier).toBe('unvetted')
  })
  it('book -> unvetted', () => {
    const r = classifyL0(src({ sourceType: 'book' }), mockL0Adapter)
    expect(r.status).toBe('classified')
    expect(r.tier).toBe('unvetted')
  })
  it('software -> unvetted', () => {
    const r = classifyL0(src({ sourceType: 'software' }), mockL0Adapter)
    expect(r.status).toBe('classified')
    expect(r.tier).toBe('unvetted')
  })
  it('report -> unvetted', () => {
    const r = classifyL0(src({ sourceType: 'report' }), mockL0Adapter)
    expect(r.status).toBe('classified')
    expect(r.tier).toBe('unvetted')
  })
  it('preprint -> unvetted + high risk + preprintNotPeerReviewed flag', () => {
    const r = classifyL0(src({ sourceType: 'preprint' }), mockL0Adapter)
    expect(r.status).toBe('classified')
    expect(r.tier).toBe('unvetted')
    expect(r.riskLevel).toBe('high')
    expect(r.preprintNotPeerReviewed).toBe(true)
    expect(r.sourceType).toBe('preprint')
  })
})

describe('T07 L0 — NO-DEFAULT-PASS counterexamples (status carries the refusal, never the tier)', () => {
  it('unknown source type -> tier unknown (classified as unrecognized, NEVER a passing tier)', () => {
    const r = classifyL0(src({ sourceType: 'unknown' }), mockL0Adapter)
    expect(r.tier).toBe('unknown')
    expect(r.status).toBe('classified') // completed judgment: unrecognized type, no tier
    expect(PASSING.has(r.tier)).toBe(false)
    expect(r.sourceType).toBe('unknown')
  })
  it('extension source type (not in the union) -> unknown', () => {
    const r = classifyL0(
      src({ sourceType: 'blog' as unknown as L0SourceType }),
      mockL0Adapter,
    )
    expect(r.tier).toBe('unknown')
    expect(r.sourceType).toBe('unknown')
    expect(PASSING.has(r.tier)).toBe(false)
  })
  it('missing source id -> abstained (insufficient data) even if venue is tier1', () => {
    const r = classifyL0(
      src({ sourceId: '' as L0SourceId, sourceType: 'journal', venue: 'Synthetic Journal A' }),
      mockL0Adapter,
    )
    expect(r.status).toBe('abstained')
    expect(r.tier).toBe('unknown')
    expect(r.riskLevel).toBe('unknown')
    expect(PASSING.has(r.tier)).toBe(false)
  })
  it('rule conflict (CCF vs CORE disagree) -> abstained, tier unknown', () => {
    const r = classifyL0(
      src({ sourceType: 'journal', ccfRating: 'A', coreRank: 'unranked' }),
      mockL0Adapter,
    )
    expect(r.status).toBe('abstained')
    expect(r.tier).toBe('unknown')
    expect(r.riskLevel).toBe('unknown')
    expect(PASSING.has(r.tier)).toBe(false)
  })
  it('a hostile adapter returning tier1 for an unknown type is clamped DOWN to abstained/unknown', () => {
    const hostile: L0RoutingAdapter = {
      ruleVersion: 'hostile-v1',
      route: () => ({ tier: 'tier1', riskLevel: 'low', rationale: 'lying' }),
    }
    const r = classifyL0(src({ sourceType: 'unknown' }), hostile)
    expect(r.status).toBe('abstained')
    expect(r.tier).toBe('unknown')
    expect(r.ruleVersion).toBe('hostile-v1')
    expect(PASSING.has(r.tier)).toBe(false)
  })
  it('a hostile adapter returning tier1 for a missing source id is clamped to abstained', () => {
    const hostile: L0RoutingAdapter = {
      ruleVersion: 'hostile-v1',
      route: () => ({ tier: 'tier1', riskLevel: 'low', rationale: 'lying' }),
    }
    const r = classifyL0(
      src({ sourceId: '' as L0SourceId, sourceType: 'journal' }),
      hostile,
    )
    expect(r.status).toBe('abstained')
    expect(r.tier).toBe('unknown')
    expect(PASSING.has(r.tier)).toBe(false)
  })
  it('an adapter that throws is an adapter FAULT -> failed (never a silent pass, never a rule conflict)', () => {
    const throwing: L0RoutingAdapter = {
      ruleVersion: 'throwing-v1',
      route: () => {
        throw new Error('boom')
      },
    }
    const r = classifyL0(
      src({ sourceType: 'journal', venue: 'Synthetic Journal A' }),
      throwing,
    )
    expect(r.status).toBe('failed')
    expect(r.tier).toBe('unknown')
    expect(r.riskLevel).toBe('unknown')
    expect(r.ruleVersion).toBe('throwing-v1')
    expect(PASSING.has(r.tier)).toBe(false)
    expect(r.rationale).toMatch(/adapter fault|threw/i)
  })
  it('a hostile adapter returning an invalid tier string -> failed (corrupted adapter output)', () => {
    const hostile: L0RoutingAdapter = {
      ruleVersion: 'hostile-v1',
      route: () => ({
        tier: 'SUPER-TIER' as unknown as L0Tier,
        riskLevel: 'low',
        rationale: 'lying',
      }),
    }
    const r = classifyL0(src({ sourceType: 'journal' }), hostile)
    expect(r.status).toBe('failed')
    expect(r.tier).toBe('unknown')
    expect(PASSING.has(r.tier)).toBe(false)
  })
  it('a hostile adapter returning an explicit invalid status -> failed', () => {
    const hostile: L0RoutingAdapter = {
      ruleVersion: 'hostile-v1',
      route: () =>
        ({
          tier: 'tier1',
          status: 'telepathic',
          riskLevel: 'low',
          rationale: 'lying',
        }) as unknown as ReturnType<L0RoutingAdapter['route']>,
    }
    const r = classifyL0(src({ sourceType: 'journal' }), hostile)
    expect(r.status).toBe('failed')
    expect(r.tier).toBe('unknown')
  })
  it('a hostile adapter returning an invalid risk level is clamped to unknown risk (tier kept)', () => {
    const hostile: L0RoutingAdapter = {
      ruleVersion: 'hostile-v1',
      route: () => ({
        tier: 'unvetted',
        riskLevel: 'telepathic' as unknown as 'low',
        rationale: 'lying',
      }),
    }
    const r = classifyL0(src({ sourceType: 'journal' }), hostile)
    expect(r.status).toBe('classified')
    expect(r.tier).toBe('unvetted')
    expect(r.riskLevel).toBe('unknown')
  })
})

describe('T07 L0 — NO TRUTH CLAIM', () => {
  it('a tier1 classification carries exactly the 7 contract fields and NO truth/verification field', () => {
    const r = classifyL0(src({ sourceType: 'journal', venue: 'Synthetic Journal A' }), mockL0Adapter)
    expect(Object.keys(r).sort()).toEqual(
      [
        'preprintNotPeerReviewed', 'rationale', 'riskLevel', 'ruleVersion',
        'sourceType', 'status', 'tier',
      ],
    )
    expect(r).not.toHaveProperty('verified')
    expect(r).not.toHaveProperty('isReal')
    expect(r).not.toHaveProperty('claimSupported')
    expect(r).not.toHaveProperty('proven')
    expect(r).not.toHaveProperty('truthful')
  })
  it('preprint flag is a RISK signal, not a truth assertion (tier is unvetted, NOT tier1)', () => {
    const r = classifyL0(src({ sourceType: 'preprint' }), mockL0Adapter)
    expect(r.preprintNotPeerReviewed).toBe(true)
    expect(r.tier).not.toBe('tier1')
    expect(r.tier).toBe('unvetted')
    expect(r.riskLevel).toBe('high')
    expect(r.rationale).toMatch(/not peer reviewed/i)
  })
  it('L0-tier1 is NOT claimable as claim-verified: no tier exposes a verification field', () => {
    const types: L0SourceType[] = [
      'journal', 'conference', 'standard', 'report', 'dataset',
      'software', 'book', 'preprint', 'unknown',
    ]
    for (const st of types) {
      const r = classifyL0(src({ sourceType: st }), mockL0Adapter)
      expect(r).not.toHaveProperty('verified')
      expect(r).not.toHaveProperty('claimVerified')
      expect(r).not.toHaveProperty('isReal')
    }
  })
})

describe('T07 L0 — IMMUTABLE SNAPSHOTS', () => {
  it('returned classification is frozen (Object.isFrozen)', () => {
    const r = classifyL0(src({ sourceType: 'journal', venue: 'Synthetic Journal A' }), mockL0Adapter)
    expect(Object.isFrozen(r)).toBe(true)
  })
  it('two calls return distinct frozen objects (no shared return ref)', () => {
    const a = src({ sourceType: 'journal', venue: 'Synthetic Journal A' })
    const r1 = classifyL0(a, mockL0Adapter)
    const r2 = classifyL0(a, mockL0Adapter)
    expect(r1).not.toBe(r2)
    expect(r1).toEqual(r2)
    expect(Object.isFrozen(r1)).toBe(true)
    expect(Object.isFrozen(r2)).toBe(true)
  })
  it('non-cloneable source input is rejected with DSH_L0_VALUE_NOT_CLONEABLE', () => {
    const bad = src({
      sourceType: 'journal',
      extra: { fn: () => 1 } as unknown as Readonly<Record<string, unknown>>,
    })
    expect(() => classifyL0(bad, mockL0Adapter)).toThrow(ResearchError)
    expect(() => classifyL0(bad, mockL0Adapter)).toThrow(/DSH_L0_VALUE_NOT_CLONEABLE/)
  })
  it('a hostile adapter returning a non-cloneable decision is rejected', () => {
    const hostile: L0RoutingAdapter = {
      ruleVersion: 'hostile-v1',
      route: () =>
        ({
          tier: 'tier1',
          status: 'classified',
          riskLevel: 'low',
          rationale: 'x',
          sneak: () => 1,
        }) as unknown as ReturnType<L0RoutingAdapter['route']>,
    }
    expect(() => classifyL0(src({ sourceType: 'journal' }), hostile)).toThrow(
      /DSH_L0_DECISION_NOT_CLONEABLE/,
    )
  })
  it('missing adapter throws DSH_L0_MISSING_ADAPTER', () => {
    expect(() =>
      classifyL0(src({ sourceType: 'journal' }), null as unknown as L0RoutingAdapter),
    ).toThrow(/DSH_L0_MISSING_ADAPTER/)
    expect(() =>
      classifyL0(src({ sourceType: 'journal' }), {} as unknown as L0RoutingAdapter),
    ).toThrow(/DSH_L0_MISSING_ADAPTER/)
  })
  it('non-object source throws DSH_L0_INVALID_SOURCE_INPUT', () => {
    expect(() =>
      classifyL0(null as unknown as L0SourceInput, mockL0Adapter),
    ).toThrow(/DSH_L0_INVALID_SOURCE_INPUT/)
  })
  it('input is not retained: mutating the source after classify does not change a prior result, and a re-classify reflects the mutation', () => {
    const s: {
      sourceId: L0SourceId
      sourceType: L0SourceType
      venue?: string
    } = { sourceId: sid('S1'), sourceType: 'journal', venue: 'Synthetic Journal A' }
    const r1 = classifyL0(s, mockL0Adapter)
    expect(r1.tier).toBe('tier1')
    // Mutate the caller's object after the call.
    s.venue = 'Obscure Journal'
    // r1 is an independent frozen snapshot — unchanged.
    expect(r1.tier).toBe('tier1')
    // A fresh classify reads the mutated venue (no cached/retained original ref).
    const r2 = classifyL0(s, mockL0Adapter)
    expect(r2.tier).toBe('unvetted')
  })
  it('classifyL0 uses a clone of the source: an adapter mutating its argument cannot affect the caller', () => {
    const s = src({ sourceType: 'journal', venue: 'Synthetic Journal A' })
    const mutating: L0RoutingAdapter = {
      ruleVersion: 'mut-v1',
      route: (input) => {
        // Hostile adapter mutates the object it received.
        ;(input as { venue?: string }).venue = 'Synthetic Regional Journal A'
        return { tier: 'tier1', status: 'classified', riskLevel: 'low', rationale: 'ok' }
      },
    }
    const r = classifyL0(s, mutating)
    expect(r.tier).toBe('tier1')
    // The caller's original object is untouched (the adapter got a clone).
    expect(s.venue).toBe('Synthetic Journal A')
  })
})

describe('T07 L0 — cross-run isolation (no shared mutable state between classifyL0 calls)', () => {
  it('two calls with different sources do not interfere', () => {
    const r1 = classifyL0(src({ sourceType: 'journal', venue: 'Synthetic Journal A' }), mockL0Adapter)
    const r2 = classifyL0(src({ sourceType: 'unknown' }), mockL0Adapter)
    expect(r1.tier).toBe('tier1')
    expect(r2.tier).toBe('unknown')
    // r1 unchanged after r2 ran.
    expect(r1.tier).toBe('tier1')
    expect(r1).not.toBe(r2)
  })
  it('createMockL0Adapter returns a fresh adapter each call (no shared singleton)', () => {
    const a1 = createMockL0Adapter()
    const a2 = createMockL0Adapter()
    expect(a1).not.toBe(a2)
    expect(a1.ruleVersion).toBe(a2.ruleVersion)
    const r1 = classifyL0(src({ sourceType: 'journal', venue: 'Synthetic Journal A' }), a1)
    const r2 = classifyL0(src({ sourceType: 'journal', venue: 'Synthetic Journal A' }), a2)
    expect(r1).toEqual(r2)
    expect(r1).not.toBe(r2)
  })
  it('a conflicted/abstained run does not poison a subsequent clean run', () => {
    const conflict = classifyL0(
      src({ sourceType: 'journal', ccfRating: 'A', coreRank: 'unranked' }),
      mockL0Adapter,
    )
    expect(conflict.status).toBe('abstained')
    const clean = classifyL0(src({ sourceType: 'journal', venue: 'Synthetic Journal A' }), mockL0Adapter)
    expect(clean.status).toBe('classified')
    expect(clean.tier).toBe('tier1')
  })
})

describe('T07 L0 — configurable routing (adapter-driven, not a closed switch)', () => {
  it('two different adapters produce different ruleVersions + decisions for the same source', () => {
    const alt: L0RoutingAdapter = {
      ruleVersion: 'alt-fixture-v2',
      route: s => ({
        tier: s.sourceType === 'journal' ? 'tier2' : 'unknown',
        status: 'classified',
        riskLevel: 'low',
        rationale: 'alt rules',
      }),
    }
    const rMock = classifyL0(src({ sourceType: 'journal', venue: 'Synthetic Journal A' }), mockL0Adapter)
    const rAlt = classifyL0(src({ sourceType: 'journal', venue: 'Synthetic Journal A' }), alt)
    expect(rMock.ruleVersion).toBe(MOCK_L0_RULE_VERSION)
    expect(rAlt.ruleVersion).toBe('alt-fixture-v2')
    expect(rMock.tier).toBe('tier1')
    expect(rAlt.tier).toBe('tier2')
  })
  it('the versioned ruleVersion is carried through to the classification', () => {
    const r = classifyL0(src({ sourceType: 'journal', venue: 'Synthetic Journal A' }), mockL0Adapter)
    expect(r.ruleVersion).toBe('fixture-mock-v1')
  })
  it('every classification is auditable (carries tier + status + ruleVersion + rationale)', () => {
    const cases: Array<{ input: Partial<L0SourceInput>; expected: { tier: L0Tier; status: L0ClassificationStatus } }> = [
      { input: { sourceType: 'journal', venue: 'Synthetic Journal A' }, expected: { tier: 'tier1', status: 'classified' } },
      { input: { sourceType: 'preprint' }, expected: { tier: 'unvetted', status: 'classified' } },
      { input: { sourceType: 'unknown' }, expected: { tier: 'unknown', status: 'classified' } },
      {
        input: { sourceType: 'journal', ccfRating: 'A', coreRank: 'unranked' },
        expected: { tier: 'unknown', status: 'abstained' },
      },
    ]
    for (const { input, expected } of cases) {
      const r: L0Classification = classifyL0(src(input), mockL0Adapter)
      expect(r.tier).toBe(expected.tier)
      expect(r.status).toBe(expected.status)
      expect(typeof r.ruleVersion).toBe('string')
      expect(r.ruleVersion.length).toBeGreaterThan(0)
      expect(typeof r.rationale).toBe('string')
      expect(r.rationale.length).toBeGreaterThan(0)
    }
  })
})

// ── Contract shape guards: tier and adjudication-status are SEPARATED ────────
// (P1 fix: 'abstained' is NOT a tier value; downstream MUST branch on `status`.
//  The @ts-expect-error lines are compile-time guards — if the unions regress,
//  tsc --noEmit fails with "unused '@ts-expect-error'" and the suite stops.)

describe('T07 L0 — tier/status separation guards (L0Tier excludes abstained)', () => {
  it('compile-time: L0Tier must NOT accept abstained as a tier', () => {
    // @ts-expect-error — 'abstained' is adjudication state, never a tier level
    const badTier: L0Tier = 'abstained'
    // compile-time-only guard: if the union regresses, tsc --noEmit fails with
    // "Unused '@ts-expect-error' directive" and this suite stops at typecheck.
    void badTier
  })
  it('compile-time: L0ClassificationStatus must NOT accept a passing intent', () => {
    // @ts-expect-error — 'passed' is a gate/state-machine intent, not an L0 status
    const badStatus: L0ClassificationStatus = 'passed'
    void badStatus
  })
  it('runtime: a classification always carries a status from the 3-value union', () => {
    const seen = new Set<L0ClassificationStatus>(['classified', 'abstained', 'failed'])
    for (const st of (['journal', 'preprint', 'unknown', 'dataset'] as L0SourceType[])) {
      const r = classifyL0(src({ sourceType: st }), mockL0Adapter)
      expect(seen.has(r.status)).toBe(true)
    }
  })
  it('runtime: only classified is a completed adjudication; abstained/failed never describe a tier decision', () => {
    // abstained = insufficient data / rule conflict; failed = adapter fault.
    const abst = classifyL0(src({ sourceType: 'journal', ccfRating: 'A', coreRank: 'unranked' }), mockL0Adapter)
    expect(abst.status).toBe('abstained')
    expect(abst.tier).toBe('unknown')
    const throwing: L0RoutingAdapter = {
      ruleVersion: 'throwing-v1',
      route: () => { throw new Error('boom') },
    }
    const failed = classifyL0(src({ sourceType: 'journal' }), throwing)
    expect(failed.status).toBe('failed')
    expect(failed.tier).toBe('unknown')
    // Neither status may be treated as a passing tier by downstream consumers.
    for (const r of [abst, failed]) {
      expect(PASSING.has(r.tier)).toBe(false)
      expect(r.status).not.toBe('classified')
    }
  })
})
