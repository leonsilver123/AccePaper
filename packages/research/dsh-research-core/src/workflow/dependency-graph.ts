/**
 * What a step actually consumed, against what its definition declares.
 *
 * A step's declared `inputs` are the edges the engine uses: `canStart` reads them to decide when a
 * step may run, and `rollback` walks them to decide what a re-run invalidates. An executor that
 * reads a slug it did not declare therefore takes a real dependency that the engine cannot see —
 * the step still runs, and a rebuild of its input does NOT invalidate it, so it keeps an output
 * derived from a version that no longer exists. Two such edges were found this way in the shipped
 * runner (`D2-framework` read `method-spec`, `E1-format` read `paper-outline`) and are declared
 * now.
 *
 * The check is OBSERVED, not declared twice: the driver records the slugs each executor asks for
 * while it runs, and {@link undeclaredReads} compares that list with the definition. A second
 * hand-maintained list of "what this executor reads" would have the same defect as the first one.
 *
 * Seedable run inputs are not edges. `domain-direction` and the Case Pack seeds are set before the
 * run and never invalidated, so a step reading one takes no dependency on another step's output.
 */

import type { StepDefinition } from '../engine/types.ts'

/** Why one read is not covered by the step's declaration. */
export interface UndeclaredRead {
  readonly stepId: string
  readonly slug: string
  /** True when the slug is produced by a step at all; false means nothing in the pipeline makes it. */
  readonly producedBySomeStep: boolean
}

/**
 * The reads a step made that its definition does not declare and no seed satisfies.
 *
 * @param stepId - the step that read.
 * @param readSlugs - the slugs its executor asked for, in the order it asked.
 * @param definitions - the pipeline's step definitions.
 * @param seedable - slugs the run seeds before it starts; a read of one of these is not an edge.
 * @returns one entry per undeclared slug, first-read order, at most once per slug. Empty means
 *   every read the executor made is an edge the engine can see.
 */
export function undeclaredReads(
  stepId: string,
  readSlugs: ReadonlyArray<string>,
  definitions: ReadonlyArray<StepDefinition>,
  seedable: ReadonlyArray<string>,
): ReadonlyArray<UndeclaredRead> {
  const self = definitions.find(definition => definition.id === stepId)
  if (self === undefined) return []
  const declared = new Set(self.inputs)
  const produced = new Set<string>()
  for (const definition of definitions) {
    for (const output of definition.outputs) produced.add(output)
  }
  const seen = new Set<string>()
  const out: UndeclaredRead[] = []
  for (const slug of readSlugs) {
    if (declared.has(slug) || seedable.includes(slug) || seen.has(slug)) continue
    seen.add(slug)
    out.push({ stepId, slug, producedBySomeStep: produced.has(slug) })
  }
  return out
}

/**
 * The steps that consume a given step's output, directly.
 *
 * @param stepId - the producing step.
 * @param definitions - the pipeline's step definitions.
 * @returns the ids of the steps that declare one of its outputs as an input, in definition order.
 */
export function directConsumers(
  stepId: string,
  definitions: ReadonlyArray<StepDefinition>,
): ReadonlyArray<string> {
  const producer = definitions.find(definition => definition.id === stepId)
  if (producer === undefined) return []
  return definitions
    .filter(definition => definition.inputs.some(input => producer.outputs.includes(input)))
    .map(definition => definition.id)
}

/**
 * Every step a rollback of `stepId` must also invalidate, transitively.
 *
 * The engine's own cascade walks this same relation; this export exists so a spec can state what
 * the cascade is expected to contain and check the two against each other, rather than asserting
 * the cascade against itself.
 *
 * @param stepId - the step being rolled back.
 * @param definitions - the pipeline's step definitions.
 * @returns the dependent step ids, each once, breadth-first.
 */
export function transitiveDependents(
  stepId: string,
  definitions: ReadonlyArray<StepDefinition>,
): ReadonlyArray<string> {
  const out: string[] = []
  const visited = new Set<string>()
  const queue: string[] = [stepId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const consumer of directConsumers(current, definitions)) {
      if (visited.has(consumer)) continue
      visited.add(consumer)
      out.push(consumer)
      queue.push(consumer)
    }
  }
  return out
}

/**
 * Every declared input edge that points at a step which runs at or after the consumer.
 *
 * A forward edge is a cycle in disguise: the consumer's `canStart` could never be satisfied from a
 * linear pass. THIS IS THE ONLY IMPLEMENTATION OF THAT RULE — `assertDagAndSeedSeparation` in
 * `engine/steps.ts` calls it rather than repeating it. The two used to be separate, and when a slug
 * gained a second producer only one of them was corrected, so the module-load assertion accepted a
 * graph that this function reported as a forward edge. One home for the rule is what stops that.
 *
 * A SLUG'S PRODUCER IS ITS EARLIEST PRODUCER. A slug may be republished — the manuscript is created
 * by D3 and republished by D4 and E1 under one name and one version counter — and the step that
 * republishes it must consume it. Reading the LAST producer instead makes the middle producer's
 * consumption of its own output look like an edge pointing forward, which is not a cycle and not a
 * fact about the graph.
 *
 * @param definitions - the pipeline's step definitions.
 * @returns the offending `consumer -> input` pairs, in definition order.
 */
export function forwardEdges(
  definitions: ReadonlyArray<StepDefinition>,
): ReadonlyArray<{ readonly consumer: string; readonly input: string; readonly producerIndex: number }> {
  const producerIndex = new Map<string, number>()
  for (const definition of definitions) {
    for (const output of definition.outputs) {
      if (!producerIndex.has(output)) producerIndex.set(output, definition.index)
    }
  }
  const out: Array<{ consumer: string; input: string; producerIndex: number }> = []
  for (const definition of definitions) {
    for (const input of definition.inputs) {
      const index = producerIndex.get(input)
      if (index !== undefined && index >= definition.index) {
        out.push({ consumer: definition.id, input, producerIndex: index })
      }
    }
  }
  return out
}
