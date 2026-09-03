// @deepseek-ai/dsh-research-tools — T14 claim-construct tests.

import { describe, expect, it } from 'vitest'
import {
  CLAIM_CONSTRUCT_TOOL_ID,
  CLAIM_CONSTRUCT_TOOL_VERSION,
  CLAIM_SUPPORT_STATUS_NOT_CLAIMED,
  MAX_CLAIM_ASSERTION_LENGTH,
  constructClaim,
  runClaimConstruct,
} from '../../src/tools/claim-construct/index.ts'
import type { ClaimConstructInput } from '../../src/tools/claim-construct/index.ts'

const ASSERTION = 'Stable optical lattices can confine ultracold atoms with sub-micron precision'

function baseInput(overrides: Partial<ClaimConstructInput> = {}): ClaimConstructInput {
  return { assertion: ASSERTION, now: 1_700_000_000_000, ...overrides }
}

describe('claim-construct', () => {
  it('constructs a claim: branded-string claimId, preserved assertion, supportStatus === not_claimed', () => {
    const artifact = constructClaim(baseInput())
    const { claim, meta } = artifact

    expect(typeof claim.claimId).toBe('string')
    expect(claim.claimId.length).toBeGreaterThan(0)
    expect(claim.claimId).toMatch(/^claim-/)

    expect(claim.assertion).toBe(ASSERTION)
    expect(claim.supportStatus).toBe('not_claimed')
    expect(claim.supportStatus).toBe(CLAIM_SUPPORT_STATUS_NOT_CLAIMED)
    expect(claim.constructedAt).toBe(1_700_000_000_000)
    expect(meta.toolId).toBe(CLAIM_CONSTRUCT_TOOL_ID)
    expect(meta.version).toBe(CLAIM_CONSTRUCT_TOOL_VERSION)

    // Every construction path carries the frozen literal — never anything else.
    const variants = [
      baseInput({ falsifiability: {} }),
      baseInput({ falsifiability: { experimentToFalsify: 'cool the lattice below 1 nK' } }),
      baseInput({ note: 'draft', claimId: 'manual-id' }),
    ]
    for (const variant of variants) {
      expect(constructClaim(variant).claim.supportStatus).toBe('not_claimed')
    }
  })

  it('deep-freezes the artifact so nested mutation throws or no-ops', () => {
    const artifact = constructClaim(
      baseInput({
        falsifiability: { essentialDifference: 'order-of-magnitude tighter confinement' },
      }),
    )

    expect(Object.isFrozen(artifact)).toBe(true)
    expect(Object.isFrozen(artifact.meta)).toBe(true)
    expect(Object.isFrozen(artifact.claim)).toBe(true)
    expect(Object.isFrozen(artifact.claim.falsifiability)).toBe(true)

    // ESM is strict mode, so writes to frozen objects must throw. The casts
    // strip the compile-time readonly so the RUNTIME freeze is what we test.
    expect(() => {
      ;(artifact.claim as { assertion: string }).assertion = 'mutated'
    }).toThrow()
    expect(() => {
      ;(artifact.claim.falsifiability as { essentialDifference: string })
        .essentialDifference = 'mutated'
    }).toThrow()
    expect(() => {
      ;(artifact.meta as { producedAt: number }).producedAt = 0
    }).toThrow()
  })

  it('is deterministic: same input twice yields identical claimId and content', () => {
    const first = constructClaim(baseInput())
    const second = constructClaim(baseInput())

    expect(second.claim.claimId).toBe(first.claim.claimId)
    expect(second).toEqual(first)
    expect(second.claim).toEqual(first.claim)
    expect(second.meta).toEqual(first.meta)
  })

  it('derives a stable claimId from the assertion alone', () => {
    const derived = constructClaim(baseInput()).claim.claimId
    const withFalsifiability = constructClaim(
      baseInput({ falsifiability: { cognitionChange: 'rewrites lattice physics' } }),
    ).claim.claimId
    const withNote = constructClaim(baseInput({ note: 'anything' })).claim.claimId

    // Optional blocks and notes must not perturb the derived id.
    expect(withFalsifiability).toBe(derived)
    expect(withNote).toBe(derived)
    // Whitespace-only differences in the assertion collapse to the same claim.
    expect(constructClaim(baseInput({ assertion: `  ${ASSERTION}\n` })).claim.claimId).toBe(derived)
    // Distinct assertions yield distinct ids.
    expect(constructClaim(baseInput({ assertion: 'A completely different assertion' })).claim.claimId)
      .not.toBe(derived)
  })

  it('honors a caller-supplied claimId', () => {
    const artifact = constructClaim(baseInput({ claimId: 'caller-provided-id' }))
    expect(artifact.claim.claimId).toBe('caller-provided-id')

    const other = constructClaim(baseInput({ claimId: '  padded-caller-id  ' }))
    expect(other.claim.claimId).toBe('padded-caller-id')

    const derivedDefault = constructClaim(baseInput()).claim.claimId
    expect(artifact.claim.claimId).not.toBe(derivedDefault)
  })

  it('rejects empty or whitespace-only assertions', () => {
    expect(() => constructClaim(baseInput({ assertion: '' }))).toThrow()
    expect(() => constructClaim(baseInput({ assertion: '   \n\t  ' }))).toThrow()
  })

  it('rejects over-long assertions at the sane cap', () => {
    const tooLong = 'x'.repeat(MAX_CLAIM_ASSERTION_LENGTH + 1)
    expect(() => constructClaim(baseInput({ assertion: tooLong }))).toThrow()

    const atCap = 'x'.repeat(MAX_CLAIM_ASSERTION_LENGTH)
    expect(constructClaim(baseInput({ assertion: atCap })).claim.assertion).toBe(atCap)
  })

  it('treats falsifiability as optional: absent/null becomes null, present is preserved readonly', () => {
    expect(constructClaim(baseInput()).claim.falsifiability).toBeNull()
    expect(constructClaim(baseInput({ falsifiability: null })).claim.falsifiability).toBeNull()

    const scaffold = {
      essentialDifference: 'sub-micron vs micron-scale confinement',
      cognitionChange: 'lattice trapping precision limits',
      experimentToFalsify: 'interferometric position measurement below 100 nm',
    }
    const artifact = constructClaim(baseInput({ falsifiability: scaffold }))
    expect(artifact.claim.falsifiability).toEqual(scaffold)

    // Partially-filled scaffold preserves exactly the supplied fields.
    const partial = constructClaim(baseInput({ falsifiability: { experimentToFalsify: 'X' } }))
    expect(partial.claim.falsifiability).toEqual({ experimentToFalsify: 'X' })

    // No live reference escapes: mutating the caller's scaffold afterwards is inert.
    scaffold.cognitionChange = 'mutated after construction'
    expect(artifact.claim.falsifiability?.cognitionChange).toBe(
      'lattice trapping precision limits',
    )
  })

  it('records note only when provided', () => {
    expect(constructClaim(baseInput()).claim.note).toBeUndefined()
    expect(constructClaim(baseInput({ note: null })).claim.note).toBeUndefined()
    expect(constructClaim(baseInput({ note: 'author memo' })).claim.note).toBe('author memo')
  })

  it('emits meta with present toolId/version and a numeric producedAt', () => {
    const artifact = constructClaim(baseInput({ now: 123_456 }))
    expect(artifact.meta.toolId).toBe(CLAIM_CONSTRUCT_TOOL_ID)
    expect(artifact.meta.version).toBe(CLAIM_CONSTRUCT_TOOL_VERSION)
    expect(typeof artifact.meta.producedAt).toBe('number')
    expect(artifact.meta.producedAt).toBe(123_456)
  })

  it('exposes runClaimConstruct as an alias of constructClaim', () => {
    expect(runClaimConstruct).toBe(constructClaim)
    const artifact = runClaimConstruct(baseInput())
    expect(artifact.claim.supportStatus).toBe('not_claimed')
    expect(Object.isFrozen(artifact)).toBe(true)
  })

  it('falls back to the literal slug claim when the assertion yields an empty ASCII slug', () => {
    // Pure-CJK (no ASCII alnum) — slugify strips every char, so the derived id
    // must use the 'claim' fallback while the stable hash keeps it unique.
    const artifact = constructClaim(baseInput({ assertion: '量子计算能在多项式时间内模拟量子系统' }))
    expect(artifact.claim.claimId).toMatch(/^claim-claim-[0-9a-f]{8}$/)
  })

  it('rejects a non-object falsifiability scaffold', () => {
    for (const bad of ['nope', 42, []]) {
      expect(() =>
        constructClaim(baseInput({ falsifiability: bad as unknown as ClaimConstructInput['falsifiability'] })),
      ).toThrow(/\[claim-construct\] falsifiability must be a plain object/)
    }
  })

  it('rejects a whitespace-only caller-supplied claimId', () => {
    for (const blank of ['   ', '\t\n ']) {
      expect(() => constructClaim(baseInput({ claimId: blank }))).toThrow(
        /\[claim-construct\] claimId must be a non-empty string when provided/,
      )
    }
  })

  it('rejects a null / non-object input', () => {
    expect(() => constructClaim(null as unknown as ClaimConstructInput)).toThrow(
      /\[claim-construct\] input must be an object/,
    )
    expect(() => constructClaim(42 as unknown as ClaimConstructInput)).toThrow(
      /\[claim-construct\] input must be an object/,
    )
  })

  it('falls back to the wall clock when now is omitted (producedAt === constructedAt)', () => {
    const before = Date.now()
    const artifact = constructClaim({ assertion: ASSERTION }) // no `now`
    const after = Date.now()

    expect(artifact.meta.producedAt).toBe(artifact.claim.constructedAt)
    expect(typeof artifact.claim.constructedAt).toBe('number')
    expect(Number.isFinite(artifact.claim.constructedAt)).toBe(true)
    // One clock read, within the call window (±10 s margin for slow CI).
    expect(artifact.claim.constructedAt).toBeGreaterThan(before - 10_000)
    expect(artifact.claim.constructedAt).toBeLessThan(after + 10_000)
  })

  it('locks the current error style: guard paths throw a BARE Error (no typed subclass, no code)', () => {
    // Unlike T12/T13, T14 today has no typed error class and no code taxonomy —
    // every validation path throws a plain `Error` whose only contract is the
    // '[claim-construct] ' message prefix. Locking the SHAPE (name stays
    // 'Error', no `.code`) makes any future migration to a ClaimConstructError
    // a deliberate, test-visible change rather than a silent one.
    const thrown = (fn: () => unknown): Error => {
      try {
        fn()
      } catch (e) {
        return e as Error
      }
      throw new Error('expected the call to throw')
    }

    const cases: Error[] = [
      // Non-object input (null and a bare number both hit the input guard).
      thrown(() => constructClaim(null as unknown as ClaimConstructInput)),
      thrown(() => constructClaim(42 as unknown as ClaimConstructInput)),
      // Empty/over-long assertions.
      thrown(() => constructClaim(baseInput({ assertion: '' }))),
      thrown(() => constructClaim(baseInput({ assertion: 'x'.repeat(MAX_CLAIM_ASSERTION_LENGTH + 1) }))),
      // Non-object falsifiability scaffold.
      thrown(() =>
        constructClaim(
          baseInput({ falsifiability: 'nope' as unknown as ClaimConstructInput['falsifiability'] }),
        ),
      ),
      // Whitespace-only caller-supplied claimId.
      thrown(() => constructClaim(baseInput({ claimId: '   ' }))),
    ]

    for (const error of cases) {
      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe('Error')
      expect(error.message).toMatch(/^\[claim-construct\] /)
      expect((error as Error & { code?: unknown }).code).toBeUndefined()
    }
  })

  it('locks the current bare TypeError for a non-string / missing assertion (no prefix yet)', () => {
    // constructClaim validates the INPUT object but not the assertion TYPE:
    // a number (or an absent) assertion reaches `input.assertion.trim()` and
    // throws a bare TypeError WITHOUT the '[claim-construct] ' prefix — unlike
    // T12/T13's uniformly-prefixed errors. Recorded so a future type guard /
    // typed error is a deliberate, test-visible change.
    const thrown = (fn: () => unknown): unknown => {
      try {
        fn()
      } catch (e) {
        return e
      }
      return undefined
    }

    const numberErr = thrown(() => constructClaim(baseInput({ assertion: 42 as unknown as string })))
    expect(numberErr).toBeInstanceOf(TypeError)

    const missingErr = thrown(() => constructClaim({} as unknown as ClaimConstructInput))
    expect(missingErr).toBeInstanceOf(TypeError)
  })
})
