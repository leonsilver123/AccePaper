/**
 * What a step read, against what its definition declares.
 *
 * The defect: `D2-framework`'s executor read `method-spec` and `E1-format`'s read `paper-outline`,
 * and neither edge was in `STEP_DEFS.inputs`. The engine's dependency graph is THOSE edges — it is
 * how `canStart` decides what may run and how `rollback` decides what a re-run invalidates — so a
 * real read that is not declared is a dependency the engine cannot see. A rebuild of the method
 * spec did not invalidate the framework derived from it.
 *
 * These tests observe the reads rather than re-declaring them: `StepOutcome.readSlugs` is what the
 * executor asked `getInput` for while it ran. A second hand-maintained list would repeat whatever
 * mistake the first one made, and the mistake was invisible by inspection for exactly that reason.
 */

import { describe, expect, it } from 'vitest'
import { getStepDefinitions, getStepDefinitionById } from '@deepseek-ai/dsh-research-core'
import type { ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { directConsumers, forwardEdges, transitiveDependents, undeclaredReads } from '@deepseek-ai/dsh-research-core'
import { runT19B } from '../src/runner/drive.ts'

/** The slugs a run seeds before it starts; a read of one of these is not a dependency on a step. */
const SEEDS: ReadonlyArray<string> = [
  'domain-direction',
  'case-pack-claim',
  'case-pack-scenario',
  'case-pack-experiment',
  'case-pack-ablation',
  'case-pack-boundary',
  'case-pack-citations',
]

/** Drive the pipeline to the human gate and hand back what each step read while it ran. */
async function observedReads(): Promise<ReadonlyArray<{ stepId: string; readSlugs: ReadonlyArray<string> }>> {
  const store: ResearchRunStore = new Map()
  const run = await runT19B(store)
  return run.steps.map(step => ({ stepId: step.stepId, readSlugs: step.readSlugs }))
}

describe('every read an executor makes is an edge the engine can see', () => {
  it('finds no undeclared read across a full run', async () => {
    const definitions = getStepDefinitions()
    const undeclared = (await observedReads()).flatMap(step =>
      undeclaredReads(step.stepId, step.readSlugs, definitions, SEEDS),
    )
    // A slug read but not declared and not seeded is printed in full: the repair is to declare it.
    expect(undeclared).toEqual([])
  })

  it('actually observed reads, so the check above is not vacuous', async () => {
    const reads = await observedReads()
    const total = reads.reduce((count, step) => count + step.readSlugs.length, 0)
    expect(total).toBeGreaterThan(10)
    // The two edges that were missing, observed rather than asserted about the source.
    const d2 = reads.find(step => step.stepId === 'D2-framework')
    const e1 = reads.find(step => step.stepId === 'E1-format')
    expect(d2?.readSlugs).toContain('method-spec')
    expect(e1?.readSlugs).toContain('paper-outline')
  })

  it('flags a read the definition does not carry', () => {
    const definitions = getStepDefinitions()
    const found = undeclaredReads('D2-framework', ['method-spec', 'not-a-slug'], definitions, SEEDS)
    expect(found).toEqual([{ stepId: 'D2-framework', slug: 'not-a-slug', producedBySomeStep: false }])
  })

  it('does not flag a seeded input or a declared one', () => {
    const definitions = getStepDefinitions()
    expect(undeclaredReads('A1-landscape', ['domain-direction'], definitions, SEEDS)).toEqual([])
    expect(undeclaredReads('D3-writing', ['paper-outline'], definitions, SEEDS)).toEqual([])
  })
})

describe('the declared graph is the one the engine walks', () => {
  it('has no forward edge', () => {
    expect(forwardEdges(getStepDefinitions())).toEqual([])
  })

  it('puts the newly declared edges in the cascade a rebuild must take', () => {
    const definitions = getStepDefinitions()
    // Rebuilding the method spec must invalidate the framework that read it ...
    expect(directConsumers('B1-method', definitions)).toContain('D2-framework')
    // ... and the outline, which is what makes E1's read of it a real edge rather than a
    // transitive accident.
    expect(directConsumers('D2-framework', definitions)).toContain('E1-format')
    const cascade = transitiveDependents('B1-method', definitions)
    expect(cascade).toContain('D2-framework')
    expect(cascade).toContain('E1-format')
  })

  it('names each dependent once, however many paths reach it', () => {
    const definitions = getStepDefinitions()
    const cascade = transitiveDependents('A2-claim', definitions)
    expect(new Set(cascade).size).toBe(cascade.length)
    // E1 reads five artifacts and reaches A2's claim through several of them; it is one entry.
    expect(cascade.filter(id => id === 'E1-format')).toHaveLength(1)
  })

  it('keeps the human gate downstream of everything it publishes', () => {
    const definitions = getStepDefinitions()
    const cascade = transitiveDependents('A1-landscape', definitions)
    expect(cascade).toContain('E2-submit')
    expect(cascade).not.toContain('A1-landscape')
  })

  it('declares the two edges that were missing, in the definition itself', () => {
    expect(getStepDefinitionById('D2-framework')?.inputs).toContain('method-spec')
    expect(getStepDefinitionById('E1-format')?.inputs).toContain('paper-outline')
  })
})
