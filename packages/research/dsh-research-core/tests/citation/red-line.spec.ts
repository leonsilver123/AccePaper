import { describe, expect, it, vi } from 'vitest'
import { verifyCitation } from '../../src/citation/index.ts'
import { CITATION_CODE_RED_LINE_NO_ORIGINAL } from '../../src/citation/verify.ts'
import { claim, citation, ev, fixtureResolver, notFoundResolver, ref } from './helpers.ts'
import type { CitationEvidence, VerificationMethod } from '../../src/contracts.ts'

const TS = 1700000000000
const REAL = ref('doi', '10.1000/real', { title: 'Real Paper', authors: ['Alice A'] })

// #6 is a HARD RED LINE: a result claiming 'supported'/'partially_supported'
// while the original text was NOT accessed (method='none' OR
// originalTextAccessed=false) MUST be conclusion='blocked' +
// redLineTriggered=true. NEVER downgradeable to a warning. This suite hammers
// bypass attempts: getter tricks, prototype pollution, input mutation.
describe('#6 RED LINE — claimed verification WITHOUT original-text access is HARD-blocked', () => {
  describe('plain triggers', () => {
    it('method=none + claimed supported => blocked + redLine', () => {
      const r = verifyCitation(claim('c1'), citation('cit1'), REAL, ev('none'), fixtureResolver(), TS, { claimedConclusion: 'supported' })
      expect(r.conclusion).toBe('blocked')
      expect(r.redLineTriggered).toBe(true)
      expect(r.reasonCode).toBe(CITATION_CODE_RED_LINE_NO_ORIGINAL)
    })
    it('method=none + claimed partially_supported => blocked + redLine', () => {
      const r = verifyCitation(claim('c1'), citation('cit1'), REAL, ev('none'), fixtureResolver(), TS, { claimedConclusion: 'partially_supported' })
      expect(r.conclusion).toBe('blocked')
      expect(r.redLineTriggered).toBe(true)
      expect(r.reasonCode).toBe(CITATION_CODE_RED_LINE_NO_ORIGINAL)
    })
    it('originalTextAccessed=false + method=manual_review + claimed supported => blocked + redLine', () => {
      const r = verifyCitation(
        claim('c1'), citation('cit1'), REAL,
        ev('manual_review', { originalTextAccessed: false }),
        fixtureResolver(), TS, { claimedConclusion: 'supported' },
      )
      expect(r.conclusion).toBe('blocked')
      expect(r.redLineTriggered).toBe(true)
      expect(r.reasonCode).toBe(CITATION_CODE_RED_LINE_NO_ORIGINAL)
    })
    it('the red line fires BEFORE softer checks (never bypassed by a real-looking resolver)', () => {
      // Even with a resolver that would otherwise confirm identity, no-original
      // access with a supportive claim is blocked FIRST.
      const r = verifyCitation(claim('c1'), citation('cit1'), REAL, ev('none'), fixtureResolver(), TS, { claimedConclusion: 'supported' })
      expect(r.conclusion).not.toBe('supported')
      expect(r.conclusion).toBe('blocked')
      expect(r.redLineTriggered).toBe(true)
    })
    it('the #6 short-circuit NEVER consults the resolver: resolverStatus stays ABSENT even when the resolver would resolve', () => {
      // resolverStatus is present ONLY when the resolver was actually contacted
      // (fabricated / outage / ambiguous / resolved all stamp it). The #6 hard
      // block happens BEFORE resolver contact, so it must carry NO resolverStatus.
      const r = verifyCitation(claim('c1'), citation('cit1'), REAL, ev('none'), fixtureResolver(), TS, { claimedConclusion: 'supported' })
      expect(r.conclusion).toBe('blocked')
      expect(r.redLineTriggered).toBe(true)
      expect(r.reasonCode).toBe(CITATION_CODE_RED_LINE_NO_ORIGINAL)
      expect(r.resolverStatus).toBeUndefined()
    })
    it('the #6 red line short-circuits with ZERO resolver calls (a contacting implementation would throw)', () => {
      // resolverStatus==undefined alone only proves the outcome field is absent —
      // a future implementation could still call the resolver and DISCARD the
      // result while leaving resolverStatus undefined, and the old test would
      // keep passing. A spy that throws on contact is the real discriminator:
      // the red line must fire BEFORE the resolver is ever consulted.
      const resolveMetadata = vi.fn(() => {
        throw new Error('resolver must not be called')
      })
      const r = verifyCitation(
        claim('c1'), citation('cit1'), REAL, ev('none'),
        { resolveMetadata }, TS, { claimedConclusion: 'supported' },
      )
      expect(resolveMetadata).not.toHaveBeenCalled()
      expect(r.conclusion).toBe('blocked')
      expect(r.redLineTriggered).toBe(true)
      expect(r.reasonCode).toBe(CITATION_CODE_RED_LINE_NO_ORIGINAL)
      expect(r.resolverStatus).toBeUndefined()
    })
    it('even an authoritative miss (not_found) cannot leak into the #6 result: reasonCode stays RED_LINE_NO_ORIGINAL', () => {
      // When both #1 (would-be fabrication) and #6 (no original access) apply,
      // the #6 discriminator must win AND the resolver outcome must not leak —
      // otherwise downstream could mis-attribute a no-access block to fabrication.
      const r = verifyCitation(claim('c1'), citation('cit1'), REAL, ev('none'), notFoundResolver(), TS, { claimedConclusion: 'supported' })
      expect(r.conclusion).toBe('blocked')
      expect(r.redLineTriggered).toBe(true)
      expect(r.reasonCode).toBe(CITATION_CODE_RED_LINE_NO_ORIGINAL)
      expect(r.resolverStatus).toBeUndefined()
    })
  })

  describe('getter tricks (method accessed via getter) — neutralized by boundary clone', () => {
    it('a getter returning none is captured as none at clone time => red line fires', () => {
      const eTricky = {
        originalTextAccessed: true,
        accessedAt: undefined,
        get method(): VerificationMethod {
          return 'none'
        },
      } as CitationEvidence
      const r = verifyCitation(claim('c1'), citation('cit1'), REAL, eTricky, fixtureResolver(), TS, { claimedConclusion: 'supported' })
      expect(r.conclusion).toBe('blocked')
      expect(r.redLineTriggered).toBe(true)
      expect(r.reasonCode).toBe(CITATION_CODE_RED_LINE_NO_ORIGINAL)
      // the returned snapshot stores the captured static value
      expect(r.evidence.method).toBe('none')
    })
    it('a method getter that flips values cannot make the verifier see two different values (clone captures ONE)', () => {
      let n = 0
      const eFlip = {
        originalTextAccessed: true,
        accessedAt: undefined,
        get method(): VerificationMethod {
          const v = n === 0 ? 'none' : 'manual_review'
          n++
          return v
        },
      } as CitationEvidence
      // structuredClone invokes the getter ONCE and stores the result; the
      // verifier then reads only that frozen static value. The captured value
      // is 'none' (first invocation), so the red line fires — no bypass.
      const r = verifyCitation(claim('c1'), citation('cit1'), REAL, eFlip, fixtureResolver(), TS, { claimedConclusion: 'supported' })
      expect(r.evidence.method).toBe('none')
      expect(r.conclusion).toBe('blocked')
      expect(r.redLineTriggered).toBe(true)
    })
  })

  describe('prototype pollution — own property is read, polluted prototype cannot mask none', () => {
    it('Object.prototype.method=manual_review does NOT override evidence.method=none', () => {
      const saved = Object.getOwnPropertyDescriptor(Object.prototype, 'method')
      ;(Object.prototype as { method?: unknown }).method = 'manual_review'
      try {
        const e = ev('none') // own prop method='none'
        const r = verifyCitation(claim('c1'), citation('cit1'), REAL, e, fixtureResolver(), TS, { claimedConclusion: 'supported' })
        expect(r.evidence.method).toBe('none')
        expect(r.conclusion).toBe('blocked')
        expect(r.redLineTriggered).toBe(true)
        expect(r.reasonCode).toBe(CITATION_CODE_RED_LINE_NO_ORIGINAL)
      } finally {
        if (saved === undefined) delete (Object.prototype as { method?: unknown }).method
        else Object.defineProperty(Object.prototype, 'method', saved)
      }
    })
    it('polluting Object.prototype.originalTextAccessed=true cannot force a pass when own prop is false', () => {
      const saved = Object.getOwnPropertyDescriptor(Object.prototype, 'originalTextAccessed')
      ;(Object.prototype as { originalTextAccessed?: unknown }).originalTextAccessed = true
      try {
        const e = ev('manual_review', { originalTextAccessed: false }) // own=false
        const r = verifyCitation(claim('c1'), citation('cit1'), REAL, e, fixtureResolver(), TS, { claimedConclusion: 'supported' })
        expect(r.evidence.originalTextAccessed).toBe(false)
        expect(r.conclusion).toBe('blocked')
        expect(r.redLineTriggered).toBe(true)
      } finally {
        if (saved === undefined) delete (Object.prototype as { originalTextAccessed?: unknown }).originalTextAccessed
        else Object.defineProperty(Object.prototype, 'originalTextAccessed', saved)
      }
    })
  })

  describe('post-call input mutation cannot retrofit a pass', () => {
    it('after a blocked red-line result, mutating the caller evidence to look accessed does NOT unblock', () => {
      const e = ev('none')
      const r = verifyCitation(claim('c1'), citation('cit1'), REAL, e, fixtureResolver(), TS, { claimedConclusion: 'supported' })
      expect(r.conclusion).toBe('blocked')
      expect(r.redLineTriggered).toBe(true)
      // Attempt to retrofit a pass: mutate caller evidence AFTER adjudication.
      ;(e as { method: string }).method = 'manual_review'
      ;(e as { originalTextAccessed: boolean }).originalTextAccessed = true
      // The returned snapshot is frozen + was cloned; it does not change.
      expect(r.conclusion).toBe('blocked')
      expect(r.redLineTriggered).toBe(true)
      expect(() => { (r as { conclusion: string }).conclusion = 'supported' }).toThrow()
    })
  })

  describe('a legitimately-supported result is NOT blocked (red line only fires on no-access)', () => {
    it('method=manual_review + originalTextAccessed=true + claimed supported => supported (NOT blocked)', () => {
      const r = verifyCitation(
        claim('c1'), citation('cit1'), REAL,
        ev('manual_review', { originalTextAccessed: true, excerpt: 'x' }),
        fixtureResolver(), TS, { claimedConclusion: 'supported' },
      )
      expect(r.conclusion).toBe('supported')
      expect(r.redLineTriggered).toBe(false)
    })
  })
})
