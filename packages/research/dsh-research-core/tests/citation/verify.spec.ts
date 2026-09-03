import { describe, expect, it } from 'vitest'
import type { CitationEvidence } from '../../src/contracts.ts'
import { ResearchError } from '../../src/engine/state-machine.ts'
import { verifyCitation } from '../../src/citation/index.ts'
import {
  CITATION_CODE_AMBIGUOUS,
  CITATION_CODE_CORRELATION_AS_CAUSATION,
  CITATION_CODE_IDENTITY_MISMATCH,
  CITATION_CODE_NOT_FOUND,
  CITATION_CODE_PARTIALLY_SUPPORTED,
  CITATION_CODE_REDACTED_UNMARKED,
  CITATION_CODE_RETRACTED_MARKED,
  CITATION_CODE_SUPPORTED,
  CITATION_CODE_TEMPORARILY_UNAVAILABLE,
  CITATION_CODE_UNVERIFIED,
  CITATION_CODE_UNSUPPORTED,
} from '../../src/citation/verify.ts'
import {
  claim, citation, ev, fixtureResolver, malformedResolver, notFoundResolver,
  outageResolver, ambiguousResolver, ref,
} from './helpers.ts'

const TS = 1700000000000
const REAL = ref('doi', '10.1000/real', { title: 'Real Paper', authors: ['Alice A'] })

// ── #1 fabricated literature (resolver CONFIRMS not_found) ─────────────────
describe('#1 fabricated literature -> blocked + redLineTriggered (NEVER unverified)', () => {
  it('resolver not_found => conclusion blocked (never "unverified" — no double meaning)', () => {
    const r = verifyCitation(
      claim('c1'), citation('cit1'), ref('doi', '10.1000/ghost'), ev('manual_review', { originalTextAccessed: true }),
      notFoundResolver(), TS, { claimedConclusion: 'supported' },
    )
    expect(r.conclusion).toBe('blocked')
    expect(r.redLineTriggered).toBe(true)
    expect(r.reasonCode).toBe(CITATION_CODE_NOT_FOUND)
    expect(r.resolverStatus).toBe('not_found')
  })
  it('fabrication is a hard block even when the claim honestly asserts unverified', () => {
    const r = verifyCitation(
      claim('c1'), citation('cit1'), ref('doi', '10.1000/ghost'), ev('manual_review', { originalTextAccessed: true }),
      notFoundResolver(), TS, { claimedConclusion: 'unverified' },
    )
    expect(r.conclusion).toBe('blocked')
    expect(r.redLineTriggered).toBe(true)
    expect(r.reasonCode).toBe(CITATION_CODE_NOT_FOUND)
  })
  it('a resolver outage is NOT fabrication: temporarily_unavailable => unverified, NO red line', () => {
    const r = verifyCitation(
      claim('c1'), citation('cit1'), REAL, ev('manual_review', { originalTextAccessed: true }),
      outageResolver(), TS, { claimedConclusion: 'supported' },
    )
    expect(r.conclusion).toBe('unverified')
    expect(r.redLineTriggered).toBe(false)
    expect(r.reasonCode).toBe(CITATION_CODE_TEMPORARILY_UNAVAILABLE)
    expect(r.resolverStatus).toBe('temporarily_unavailable')
  })
  it('an ambiguous resolver response => unverified, NO red line (not fabrication, not identity fraud)', () => {
    const r = verifyCitation(
      claim('c1'), citation('cit1'), REAL, ev('manual_review', { originalTextAccessed: true }),
      ambiguousResolver(), TS, { claimedConclusion: 'supported' },
    )
    expect(r.conclusion).toBe('unverified')
    expect(r.redLineTriggered).toBe(false)
    expect(r.reasonCode).toBe(CITATION_CODE_AMBIGUOUS)
    expect(r.resolverStatus).toBe('ambiguous')
  })
  it('a structurally malformed resolver outcome => unverified, NO red line (adapter fault, never fabrication)', () => {
    const r = verifyCitation(
      claim('c1'), citation('cit1'), REAL, ev('manual_review', { originalTextAccessed: true }),
      malformedResolver(), TS, { claimedConclusion: 'supported' },
    )
    expect(r.conclusion).toBe('unverified')
    expect(r.redLineTriggered).toBe(false)
    expect(r.reasonCode).toMatch(/DSH_CITATION_RESOLVER_FAILED/)
  })
})

// ── #2 DOI/title/author identity mismatch ─────────────────────────────────
describe('#2 identity mismatch -> identity_mismatch', () => {
  it('title mismatch => identity_mismatch', () => {
    const r = verifyCitation(
      claim('c1'), citation('cit1'), ref('doi', '10.1000/real', { title: 'Wrong Title', authors: ['Alice A'] }),
      ev('manual_review', { originalTextAccessed: true }), fixtureResolver(), TS, { claimedConclusion: 'supported' },
    )
    expect(r.conclusion).toBe('identity_mismatch')
    expect(r.redLineTriggered).toBe(false)
    expect(r.reasonCode).toBe(CITATION_CODE_IDENTITY_MISMATCH)
    expect(r.resolverStatus).toBe('resolved')
  })
  it('author mismatch (no shared author) => identity_mismatch', () => {
    const r = verifyCitation(
      claim('c1'), citation('cit1'), ref('doi', '10.1000/real', { title: 'Real Paper', authors: ['Nobody'] }),
      ev('manual_review', { originalTextAccessed: true }), fixtureResolver(), TS, { claimedConclusion: 'supported' },
    )
    expect(r.conclusion).toBe('identity_mismatch')
    expect(r.reasonCode).toBe(CITATION_CODE_IDENTITY_MISMATCH)
  })
})

// ── #3 literature content does not support the claim ──────────────────────
describe('#3 content does not support the claim -> unsupported', () => {
  it('claimed supported + contentSupportsClaim=false => unsupported (no redLine; original WAS accessed)', () => {
    const r = verifyCitation(
      claim('c1'), citation('cit1'), REAL, ev('manual_review', { originalTextAccessed: true, excerpt: '...' }),
      fixtureResolver(), TS, { claimedConclusion: 'supported', contentSupportsClaim: false },
    )
    expect(r.conclusion).toBe('unsupported')
    expect(r.redLineTriggered).toBe(false)
    expect(r.reasonCode).toBe(CITATION_CODE_UNSUPPORTED)
  })
})

// ── #4 retracted literature ────────────────────────────────────────────────
describe('#4 retracted literature', () => {
  it('retracted + NOT explicitly marked => retracted + redLineTriggered (REDACTED_UNMARKED hard block)', () => {
    const r = verifyCitation(
      claim('c1'), citation('cit1'), ref('doi', '10.1000/retracted', { title: 'Retracted Paper', authors: ['Carol C'] }),
      ev('manual_review', { originalTextAccessed: true }), fixtureResolver(), TS, { claimedConclusion: 'supported' },
    )
    expect(r.conclusion).toBe('retracted')
    expect(r.redLineTriggered).toBe(true)
    expect(r.reasonCode).toBe(CITATION_CODE_REDACTED_UNMARKED)
  })
  it('retracted + explicitly marked => retracted, no redLine (retraction surfaced)', () => {
    const r = verifyCitation(
      claim('c1'), citation('cit1'), ref('doi', '10.1000/retracted', { title: 'Retracted Paper', authors: ['Carol C'] }),
      ev('manual_review', { originalTextAccessed: true }), fixtureResolver(), TS,
      { claimedConclusion: 'supported', retractionExplicitlyMarked: true },
    )
    expect(r.conclusion).toBe('retracted')
    expect(r.redLineTriggered).toBe(false)
    expect(r.reasonCode).toBe(CITATION_CODE_RETRACTED_MARKED)
  })
})

// ── #5 correlation written as causation ────────────────────────────────────
describe('#5 correlation as causation -> unsupported + redLineTriggered', () => {
  it('correlationAsCausation=true => unsupported (hard block, overstatement)', () => {
    const r = verifyCitation(
      claim('c1'), citation('cit1'), REAL, ev('manual_review', { originalTextAccessed: true }),
      fixtureResolver(), TS, { claimedConclusion: 'supported', correlationAsCausation: true },
    )
    expect(r.conclusion).toBe('unsupported')
    expect(r.redLineTriggered).toBe(true)
    expect(r.reasonCode).toBe(CITATION_CODE_CORRELATION_AS_CAUSATION)
  })
})

// ── happy paths ────────────────────────────────────────────────────────────
describe('happy paths (chain checks pass)', () => {
  it('supported: original accessed, identity ok, not retracted => supported', () => {
    const r = verifyCitation(
      claim('c1'), citation('cit1'), REAL,
      ev('manual_review', { originalTextAccessed: true, excerpt: 'supports', provenance: { sourceUri: 'https://doi.example/10.1000/real', sourceVersion: 'v1', contentHash: 'abc123', retrievedAt: '2026-09-03T00:00:00Z' } }),
      fixtureResolver(), TS, { claimedConclusion: 'supported' },
    )
    expect(r.conclusion).toBe('supported')
    expect(r.redLineTriggered).toBe(false)
    expect(r.reasonCode).toBe(CITATION_CODE_SUPPORTED)
    expect(r.resolverStatus).toBe('resolved')
    // Provenance survives the immutable snapshot.
    expect(r.evidence.sourceUri).toBe('https://doi.example/10.1000/real')
    expect(r.evidence.contentHash).toBe('abc123')
  })
  it('partially_supported => partially_supported', () => {
    const r = verifyCitation(
      claim('c1'), citation('cit1'), REAL, ev('specialist_agent', { originalTextAccessed: true }),
      fixtureResolver(), TS, { claimedConclusion: 'partially_supported' },
    )
    expect(r.conclusion).toBe('partially_supported')
    expect(r.reasonCode).toBe(CITATION_CODE_PARTIALLY_SUPPORTED)
  })
  it('unsupported (claimed) => unsupported (legit acknowledgement)', () => {
    const r = verifyCitation(
      claim('c1'), citation('cit1'), REAL, ev('manual_review', { originalTextAccessed: true }),
      fixtureResolver(), TS, { claimedConclusion: 'unsupported' },
    )
    expect(r.conclusion).toBe('unsupported')
    expect(r.redLineTriggered).toBe(false)
    expect(r.reasonCode).toBe(CITATION_CODE_UNSUPPORTED)
  })
  it('unverified (claimed, resolver ok, original not accessed but NOT claiming supported) => unverified', () => {
    // method=none is fine here because the claim does not assert supported.
    const r = verifyCitation(
      claim('c1'), citation('cit1'), REAL, ev('none'), fixtureResolver(), TS, { claimedConclusion: 'unverified' },
    )
    expect(r.conclusion).toBe('unverified')
    expect(r.redLineTriggered).toBe(false)
    expect(r.reasonCode).toBe(CITATION_CODE_UNVERIFIED)
    expect(r.resolverStatus).toBe('resolved')
  })
})

// ── sad paths / input validation ───────────────────────────────────────────
describe('input validation (NO DEFAULT PASS — reject malformed inputs)', () => {
  it('rejects non-cloneable evidence (function property) with DSH_CITATION_VALUE_NOT_CLONEABLE', () => {
    const bad = { originalTextAccessed: true, method: 'manual_review', accessedAt: 1, fn: () => 1 } as unknown as CitationEvidence
    expect(() =>
      verifyCitation(claim('c1'), citation('cit1'), REAL, bad, fixtureResolver(), TS, { claimedConclusion: 'supported' }),
    ).toThrow(ResearchError)
    expect(() =>
      verifyCitation(claim('c1'), citation('cit1'), REAL, bad, fixtureResolver(), TS, { claimedConclusion: 'supported' }),
    ).toThrow(/DSH_CITATION_VALUE_NOT_CLONEABLE/)
  })
  it('rejects invalid ref.kind', () => {
    expect(() =>
      verifyCitation(claim('c1'), citation('cit1'), ref('magically' as never, 'x'), ev('manual_review', { originalTextAccessed: true }), fixtureResolver(), TS, { claimedConclusion: 'supported' }),
    ).toThrow(/DSH_CITATION_INVALID_REF/)
  })
  it('rejects invalid evidence.method', () => {
    const e = { originalTextAccessed: true, method: 'psychic' as never, accessedAt: 1 }
    expect(() =>
      verifyCitation(claim('c1'), citation('cit1'), REAL, e as never, fixtureResolver(), TS, { claimedConclusion: 'supported' }),
    ).toThrow(/DSH_CITATION_INVALID_EVIDENCE/)
  })
  it('rejects method=none with accessedAt present (contract iff violation)', () => {
    const e = { originalTextAccessed: false, method: 'none' as const, accessedAt: 1 }
    expect(() =>
      verifyCitation(claim('c1'), citation('cit1'), REAL, e as never, fixtureResolver(), TS, { claimedConclusion: 'unverified' }),
    ).toThrow(/DSH_CITATION_INVALID_EVIDENCE/)
  })
  it('rejects method!=none with accessedAt undefined (contract iff violation)', () => {
    const e = { originalTextAccessed: true, method: 'manual_review' as const }
    expect(() =>
      verifyCitation(claim('c1'), citation('cit1'), REAL, e as never, fixtureResolver(), TS, { claimedConclusion: 'supported' }),
    ).toThrow(/DSH_CITATION_INVALID_EVIDENCE/)
  })
  it('rejects a non-string provenance field (sourceUri must be a string when present)', () => {
    const e = {
      originalTextAccessed: true, method: 'manual_review' as const, accessedAt: 1,
      sourceUri: 42,
    }
    expect(() =>
      verifyCitation(claim('c1'), citation('cit1'), REAL, e as unknown as CitationEvidence, fixtureResolver(), TS, { claimedConclusion: 'supported' }),
    ).toThrow(/DSH_CITATION_INVALID_EVIDENCE/)
  })
  it('rejects invalid adapter', () => {
    expect(() =>
      verifyCitation(claim('c1'), citation('cit1'), REAL, ev('manual_review', { originalTextAccessed: true }), null as never, TS, { claimedConclusion: 'supported' }),
    ).toThrow(/DSH_CITATION_INVALID_ADAPTER/)
  })
  it('rejects invalid options.claimedConclusion', () => {
    expect(() =>
      verifyCitation(claim('c1'), citation('cit1'), REAL, ev('manual_review', { originalTextAccessed: true }), fixtureResolver(), TS, { claimedConclusion: 'maybe' as never }),
    ).toThrow(/DSH_CITATION_INVALID_OPTIONS/)
  })
  it('rejects non-finite timestamp', () => {
    expect(() =>
      verifyCitation(claim('c1'), citation('cit1'), REAL, ev('manual_review', { originalTextAccessed: true }), fixtureResolver(), NaN, { claimedConclusion: 'supported' }),
    ).toThrow(/DSH_CITATION_INVALID_OPTIONS/)
  })
})

// ── immutability + non-retention ───────────────────────────────────────────
describe('IMMUTABLE SNAPSHOTS (INV-SNAPSHOT)', () => {
  it('returned VerificationResult is frozen (top + nested evidence + locator)', () => {
    const r = verifyCitation(
      claim('c1'), citation('cit1'), REAL,
      ev('manual_review', { originalTextAccessed: true, locator: { page: 42 } }),
      fixtureResolver(), TS, { claimedConclusion: 'supported' },
    )
    expect(Object.isFrozen(r)).toBe(true)
    expect(Object.isFrozen(r.evidence)).toBe(true)
    expect(Object.isFrozen(r.evidence.locator as object)).toBe(true)
  })
  it('caller cannot mutate the returned result', () => {
    const r = verifyCitation(claim('c1'), citation('cit1'), REAL, ev('manual_review', { originalTextAccessed: true }), fixtureResolver(), TS, { claimedConclusion: 'supported' })
    expect(() => { (r as { conclusion: string }).conclusion = 'unsupported' }).toThrow()
  })
  it('caller input mutation after the call does NOT change the result (input not retained)', () => {
    const e = ev('manual_review', { originalTextAccessed: true })
    const r = verifyCitation(claim('c1'), citation('cit1'), REAL, e, fixtureResolver(), TS, { claimedConclusion: 'supported' })
    expect(r.conclusion).toBe('supported')
    // Mutate the caller's original evidence AFTER the call.
    ;(e as { method: string }).method = 'none'
    ;(e as { originalTextAccessed: boolean }).originalTextAccessed = false
    // The already-returned snapshot is unaffected (it was cloned at the boundary).
    expect(r.evidence.method).toBe('manual_review')
    expect(r.evidence.originalTextAccessed).toBe(true)
    expect(r.conclusion).toBe('supported')
  })
  it('caller ref mutation after the call does NOT change the result', () => {
    const rf = ref('doi', '10.1000/real', { title: 'Real Paper', authors: ['Alice A'] })
    const r = verifyCitation(claim('c1'), citation('cit1'), rf, ev('manual_review', { originalTextAccessed: true }), fixtureResolver(), TS, { claimedConclusion: 'supported' })
    ;(rf as { id: string }).id = '10.1000/ghost'
    expect(r.ref.id).toBe('10.1000/real')
  })
})

// ── cross-run isolation (no shared mutable state) ───────────────────────────
describe('cross-run isolation', () => {
  it('two independent calls do not share state; fixture unchanged across calls', () => {
    const resolver = fixtureResolver()
    const r1 = verifyCitation(claim('c1'), citation('cit1'), REAL, ev('none'), resolver, TS, { claimedConclusion: 'supported' })
    const r2 = verifyCitation(claim('c2'), citation('cit2'), REAL, ev('manual_review', { originalTextAccessed: true }), resolver, TS, { claimedConclusion: 'supported' })
    expect(r1.conclusion).toBe('blocked') // #6 red line (method none, claimed supported)
    expect(r1.redLineTriggered).toBe(true)
    expect(r2.conclusion).toBe('supported')
    expect(r2.redLineTriggered).toBe(false)
    // fixture still resolves the same record (state not consumed/mutated)
    const r3 = verifyCitation(claim('c3'), citation('cit3'), REAL, ev('manual_review', { originalTextAccessed: true }), resolver, TS, { claimedConclusion: 'supported' })
    expect(r3.conclusion).toBe('supported')
  })
})
