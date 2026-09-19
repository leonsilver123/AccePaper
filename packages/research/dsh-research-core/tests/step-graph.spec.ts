/**
 * The step graph's own rules, including the ones a slug with more than one producer introduces.
 *
 * WHY THIS FILE EXISTS. `assertDagAndSeedSeparation` runs at module load, so a graph it rejects does
 * not fail a test — it fails every import of this package, in every consumer, with the throw coming
 * out of an import statement. That makes its rules worth more than the graph they happen to hold
 * today, and it makes the shipped `STEPS` a poor way to test them: a frozen constant cannot be made
 * to violate anything. The function therefore takes the graph as a parameter, and the cases below
 * are synthetic graphs, with one case asserting the shipped one still passes.
 *
 * THE CASE THAT FORCED THE PARAMETER. The manuscript becomes a slug that every writing step
 * republishes: D3 creates it, D4 and E1 each publish a new version under the SAME name. Under the
 * original last-writer-wins owner map, the owner of that slug was the LAST producer's index, so the
 * middle producer consuming the slug it republishes read as "consumes a slug produced by a
 * later/equal-index step" — a forward edge that does not exist. The two rules that replace it are
 * the owner being the EARLIEST producer, and a republisher having to consume what it republishes.
 */
import { describe, expect, it } from 'vitest'
import { assertDagAndSeedSeparation, SEEDABLE_INPUTS, STEPS } from '../src/engine/steps.ts'
import type { Phase, StepDefinition } from '../src/engine/types.ts'

/** A step with everything the assertion does not read filled in. Only id/index/inputs/outputs matter. */
function step(id: string, index: number, inputs: readonly string[], outputs: readonly string[]): StepDefinition {
  return {
    id,
    index,
    phase: 'D' as Phase,
    name: id,
    purpose: 'synthetic',
    inputs,
    outputs,
    gate: [],
    falsifiable: null,
    humanGate: false,
  }
}

describe('the shipped step graph', () => {
  it('passes every rule', () => {
    // Reached on import as well; asserting it here is what makes "the constant is fine" a statement
    // this file makes rather than one it assumes.
    expect(() => { assertDagAndSeedSeparation() }).not.toThrow()
    expect(STEPS.length).toBeGreaterThan(0)
  })
})

describe('a slug with more than one producer', () => {
  // The shape the manuscript takes: created at 1, republished at 2 and 3, each republisher consuming it.
  const republished = [
    step('writer', 1, [], ['manuscript']),
    step('reviser', 2, ['manuscript'], ['manuscript']),
    step('typesetter', 3, ['manuscript'], ['manuscript', 'typeset']),
  ]

  it('is accepted, and a middle producer reading it is not a forward edge', () => {
    // THIS IS THE REGRESSION. With the owner recorded as the last producer (index 3), the reviser at
    // index 2 consuming `manuscript` is rejected as a forward edge — and because the assertion runs at
    // module load, the failure is an import error in every package that depends on this one.
    expect(() => { assertDagAndSeedSeparation(republished) }).not.toThrow()
  })

  it('is refused when a republisher does not consume what it republishes', () => {
    // An unstated consumption is a hole in the invalidation cascade: `computeTransitiveDependents`
    // walks `inputs ∩ outputs`, so invalidating the creator would leave this republisher's artifact
    // standing while the document it was written from is gone.
    const holed = [
      step('writer', 1, [], ['manuscript']),
      step('reviser', 2, [], ['manuscript']),
    ]
    expect(() => { assertDagAndSeedSeparation(holed) })
      .toThrow(/republishes 'manuscript' but does not consume it/u)
  })
})

describe('the rules the single-producer graph already had', () => {
  it('refuses a forward edge to the slug’s first producer', () => {
    // Reading the FIRST producer is what keeps this property: a step still cannot consume a slug that
    // is only created after it, however many times that slug is later republished.
    const forward = [
      step('consumer', 3, ['manuscript'], ['notes']),
      step('creator', 5, [], ['manuscript']),
    ]
    expect(() => { assertDagAndSeedSeparation(forward) })
      .toThrow(/produced by a later\/equal-index step/u)
  })

  it('refuses an input nothing produces', () => {
    expect(() => { assertDagAndSeedSeparation([step('lonely', 1, ['nowhere'], [])]) })
      .toThrow(/input 'nowhere' has no producer and is not seedable/u)
  })

  it('refuses a seedable slug in a step’s outputs', () => {
    // DEP-8: a slug that can be seeded AND produced makes seed-vs-registry precedence ambiguous.
    const seed = SEEDABLE_INPUTS[0] as string
    expect(() => { assertDagAndSeedSeparation([step('seeder', 1, [], [seed])]) })
      .toThrow(/which is a seedable input/u)
  })

  it('accepts a seedable slug as an input, which needs no producer', () => {
    const seed = SEEDABLE_INPUTS[0] as string
    expect(() => { assertDagAndSeedSeparation([step('consumer', 1, [seed], ['out'])]) }).not.toThrow()
  })
})
