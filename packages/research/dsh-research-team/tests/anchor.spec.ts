// @deepseek-ai/dsh-research-team — T23 external anchor (pure, fixture/mock) tests.

import { describe, expect, it } from 'vitest'
import { adjudicate } from '@deepseek-ai/dsh-research-core'
import type { ClaimId } from '@deepseek-ai/dsh-research-core'

import {
  lookupAnchor,
  anchorToVerification,
  compareSota,
  anchorKey,
  makeInconclusiveAnchorSignal,
  AnchorError,
  ANCHOR_ERROR_PREFIX,
} from '../src/anchor/index.ts'

const TS = 7

describe('lookupAnchor — L0 tier (retrieval existence is NOT support)', () => {
  it('returns support for tier1 + support stance', () => {
    const s = lookupAnchor(anchorKey('l0-tier', 'syn-l0-001'), TS)
    expect(s?.verdict).toBe('support')
  })

  it('returns contradict for tier2 + contradict stance', () => {
    const s = lookupAnchor(anchorKey('l0-tier', 'syn-l0-002'), TS)
    expect(s?.verdict).toBe('contradict')
  })

  it('degrades tier3 to inconclusive even with a support stance', () => {
    const s = lookupAnchor(anchorKey('l0-tier', 'syn-l0-003'), TS)
    expect(s?.verdict).toBe('inconclusive')
  })

  it('degrades unknown tier to inconclusive', () => {
    const s = lookupAnchor(anchorKey('l0-tier', 'syn-l0-004'), TS)
    expect(s?.verdict).toBe('inconclusive')
  })

  it('misses (fail-closed -> undefined) for an unknown ref', () => {
    expect(lookupAnchor(anchorKey('l0-tier', 'syn-l0-999'), TS)).toBeUndefined()
  })
})

describe('lookupAnchor — SOTA (synthetic bench comparison)', () => {
  it('returns support when claimed >= sota + margin', () => {
    const s = lookupAnchor(anchorKey('sota', 'syn-sota-adaptive|grid-alpha|delay'), TS)
    expect(s?.verdict).toBe('support')
  })

  it('returns contradict when claimed < sota', () => {
    const s = lookupAnchor(anchorKey('sota', 'syn-sota-greedy|grid-alpha|throughput'), TS)
    expect(s?.verdict).toBe('contradict')
  })

  it('misses (fail-closed) for an unknown bench row', () => {
    expect(lookupAnchor(anchorKey('sota', 'syn-sota-missing|x|y'), TS)).toBeUndefined()
  })

  it('compareSota is pure + deterministic', () => {
    expect(compareSota(0.91, 0.80, 0.05)).toBe('support')
    expect(compareSota(0.62, 0.70, 0.05)).toBe('contradict')
    // claimed inside (sota, sota+margin) -> inconclusive, never a default pass
    expect(compareSota(0.83, 0.80, 0.05)).toBe('inconclusive')
    // non-finite inputs -> inconclusive
    expect(compareSota(Number.NaN, 0.80, 0.05)).toBe('inconclusive')
    expect(compareSota(0.9, Number.NaN, 0.05)).toBe('inconclusive')
    expect(compareSota(0.9, 0.8, Number.NaN)).toBe('inconclusive')
  })
})

describe('lookupAnchor — reproducibility (mock re-run)', () => {
  it('returns support when the synthetic re-run supports the prediction', () => {
    const s = lookupAnchor(anchorKey('reproducibility', 'syn-repro-001'), TS)
    expect(s?.verdict).toBe('support')
  })

  it('returns contradict when the synthetic re-run contradicts the prediction', () => {
    const s = lookupAnchor(anchorKey('reproducibility', 'syn-repro-002'), TS)
    expect(s?.verdict).toBe('contradict')
  })

  it('misses (fail-closed) for an unknown prediction ref', () => {
    expect(lookupAnchor(anchorKey('reproducibility', 'syn-repro-999'), TS)).toBeUndefined()
  })
})

describe('fail-closed: miss maps to inconclusive, never support', () => {
  it('makeInconclusiveAnchorSignal is always inconclusive + never support', () => {
    for (const kind of ['l0-tier', 'sota', 'reproducibility'] as const) {
      const s = makeInconclusiveAnchorSignal('mock-claim', kind, undefined, TS)
      expect(s.verdict).toBe('inconclusive')
      expect(s.verdict).not.toBe('support')
    }
  })

  it('a missed lookup plus the fail-closed helper never yields support', () => {
    const miss = lookupAnchor(anchorKey('l0-tier', 'nope'), TS)
    expect(miss).toBeUndefined()
    const fallback = makeInconclusiveAnchorSignal('mock-claim', 'l0-tier')
    expect(fallback.verdict).toBe('inconclusive')
  })
})

describe('synthetic marker + auditability', () => {
  it('every resolved signal is synthetic, fixture-sourced, ruleVersion-stamped, frozen', () => {
    const keys = [
      anchorKey('l0-tier', 'syn-l0-001'),
      anchorKey('sota', 'syn-sota-adaptive|grid-alpha|delay'),
      anchorKey('reproducibility', 'syn-repro-001'),
    ]
    for (const key of keys) {
      const s = lookupAnchor(key, TS)
      expect(s).toBeDefined()
      expect(s!.synthetic).toBe(true)
      expect(s!.source).toBe('fixture')
      expect(typeof s!.ruleVersion).toBe('string')
      expect(s!.ruleVersion.length).toBeGreaterThan(0)
      expect(Object.isFrozen(s)).toBe(true)
    }
  })

  it('rule versions carry the synthetic fixture prefixes', () => {
    expect(lookupAnchor(anchorKey('l0-tier', 'syn-l0-001'), TS)!.ruleVersion.startsWith('anchor-fixture')).toBe(true)
    expect(lookupAnchor(anchorKey('sota', 'syn-sota-adaptive|grid-alpha|delay'), TS)!.ruleVersion.startsWith('synthetic-bench')).toBe(true)
    expect(lookupAnchor(anchorKey('reproducibility', 'syn-repro-001'), TS)!.ruleVersion.startsWith('repro-fixture')).toBe(true)
  })
})

describe('determinism', () => {
  it('same key yields identical verdicts across calls', () => {
    const a = lookupAnchor(anchorKey('l0-tier', 'syn-l0-002'), TS)
    const b = lookupAnchor(anchorKey('l0-tier', 'syn-l0-002'), TS)
    expect(a).toEqual(b)
    expect(a?.verdict).toBe(b?.verdict)
  })
})

describe('error handling — malformed / unknown keys throw, data misses return undefined', () => {
  function expectAnchorError(fn: () => unknown, codeFragment: string): void {
    try {
      fn()
      expect.unreachable(`expected ${fn} to throw AnchorError`)
    } catch (e) {
      expect(e).toBeInstanceOf(AnchorError)
      expect((e as AnchorError).code).toContain(codeFragment)
    }
  }

  it('throws AnchorError on a key without a kind prefix', () => {
    expect(() => lookupAnchor('no-colon-key', TS)).toThrow(AnchorError)
    expectAnchorError(() => lookupAnchor('no-colon-key', TS), 'UNKNOWN_KEY')
  })

  it('throws AnchorError on an unknown anchor kind', () => {
    expect(() => lookupAnchor('bogus:ref', TS)).toThrow(AnchorError)
    expectAnchorError(() => lookupAnchor('bogus:ref', TS), 'UNKNOWN_KEY')
  })

  it('error code is DSH_RESEARCH_TEAM_ANCHOR_-prefixed', () => {
    expectAnchorError(() => lookupAnchor('bogus:ref', TS), ANCHOR_ERROR_PREFIX)
  })
})

describe('anchorToVerification — core VerificationResult SHAPE, NO auto-upgrade', () => {
  it('maps verdict -> conclusion and marks the result as NOT a usable external anchor', () => {
    const support = lookupAnchor(anchorKey('l0-tier', 'syn-l0-001'), TS)!
    const vr = anchorToVerification(support)
    expect(vr.conclusion).toBe('supported')
    // Critical: a mock fixture never claims original-text access.
    expect(vr.evidence.originalTextAccessed).toBe(false)
    expect(vr.evidence.method).toBe('none')
    expect(vr.redLineTriggered).toBe(false)
    expect(vr.reasonCode.startsWith(ANCHOR_ERROR_PREFIX)).toBe(true)
  })

  it('maps contradict -> unsupported and inconclusive -> unverified', () => {
    const contradict = lookupAnchor(anchorKey('l0-tier', 'syn-l0-002'), TS)!
    expect(anchorToVerification(contradict).conclusion).toBe('unsupported')
    const inconc = makeInconclusiveAnchorSignal('c', 'l0-tier')
    expect(anchorToVerification(inconc).conclusion).toBe('unverified')
  })

  it('a mock anchor can NEVER upgrade a claim to passed via core gate B', () => {
    const verdicts = ['support', 'contradict', 'inconclusive'] as const
    for (const v of verdicts) {
      const sig = v === 'inconclusive'
        ? makeInconclusiveAnchorSignal('mock-claim', 'l0-tier')
        : lookupAnchor(anchorKey('l0-tier', v === 'support' ? 'syn-l0-001' : 'syn-l0-002'), TS)!
      const vr = anchorToVerification(sig)
      const res = adjudicate({
        claimId: 'mock-claim' as ClaimId,
        component: 'B',
        verifications: [vr],
        config: {},
        timestamp: TS,
      })
      // The mock evidence is never counted as a usable external anchor by gate B.
      expect(res.outcome).not.toBe('passed')
      expect(res.outcome).toBe('abstained')
    }
  })

  it('even with requireExternalAnchor, a mock anchor yields abstained, not passed', () => {
    const vr = anchorToVerification(lookupAnchor(anchorKey('l0-tier', 'syn-l0-001'), TS)!)
    const res = adjudicate({
      claimId: 'mock-claim' as ClaimId,
      component: 'B',
      verifications: [vr],
      config: { requireExternalAnchor: true },
      timestamp: TS,
    })
    expect(res.outcome).toBe('abstained')
    expect(res.reasonCode).toContain('MISSING_EXTERNAL_ANCHOR')
  })
})
