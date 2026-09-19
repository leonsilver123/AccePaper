# Agent Note: A slug may have more than one producer

Status: implemented

English | [中文](2026-09-19-a-slug-may-have-more-than-one-producer.zh.md)

## Problem

`assertDagAndSeedSeparation` runs at module load, so a graph it rejects does not fail a test — it fails every `import` of `dsh-research-core`, in every package that depends on it, with the throw coming out of an import statement. Two of its rules assumed something the pipeline is about to stop being true of.

It recorded a slug's owner with **last writer wins** — `outputOwner.set(o, s.index)` over the steps in order — and then refused any step that consumed a slug whose owner was at or after it. That is exactly right while every slug has one producer. The manuscript is about to have three: D3 creates it, and D4 and E1 each publish a new version under the **same** slug, which is what "the run maintains one document" means at the artifact layer. Under last-writer-wins the owner of `manuscript` becomes E1's index, and D4 consuming the document it is republishing is then read as a forward edge. Measured on a synthetic graph: `step 'reviser' (index 2) consumes 'manuscript' produced by a later/equal-index step (index 3) — cycle or forward-edge (DEP-9)`.

The second rule was missing rather than wrong. `computeTransitiveDependents` walks `inputs ∩ outputs`, so a step that republishes a slug **must** consume it, or invalidating the slug's first producer leaves the republisher's artifact standing while the document it was written from is gone. Nothing said so, because nothing had ever republished a slug.

## Decision

- **The owner is the earliest producer.** The no-forward-edge property is about the step that creates a slug; later producers cannot move it, and reading them as the owner is what turned the middle producer's own consumption into a forward edge.
- **A republisher must consume what it republishes.** A step that names a slug in `outputs` and is not its first producer must also name it in `inputs`, checked at load with the reason.
- **The graph is a parameter.** `assertDagAndSeedSeparation(steps = STEPS)` — a frozen constant cannot be made to violate anything, so the rules that matter are the ones provable against a synthetic graph.

## Alternatives considered

- **Keep last-writer-wins and give the manuscript a distinct slug per step.** Rejected: that is the arrangement being removed, and it is why the document is currently split across `draft`, `revised-draft` and `formatted-manuscript` with no single version to bind a judgement to.
- **Relax the rule to "some producer is earlier than the consumer".** Rejected: it accepts a graph where the step that creates a slug is consumed before it exists, which is the property the assertion is for.
- **Make the new rule a warning rather than a throw.** Rejected: an unstated consumption is not a style problem — it is an invalidation cascade with a hole in it, and a hole that reports itself as a warning is a hole that ships.
- **Leave the assertion alone and order the new steps so last-writer-wins happens to work.** Rejected: it would hold only until the next producer was added, and its failure mode is an import error in unrelated packages.

## Consequences

- The shipped graph is unchanged by this: no slug currently has two producers, so the new rules are vacuous against `STEPS` today and the whole suite passing is the evidence that nothing moved.
- `packages/research/dsh-research-core/tests/step-graph.spec.ts` is new. It asserts the shipped graph passes, that a republished slug with a consuming republisher is accepted (the regression above — restoring last-writer-wins fails this case and only this case), that a republisher which does not consume is refused, and that the pre-existing rules still refuse a forward edge to a slug's first producer, an input with no producer, and a seedable slug in `outputs`.
- The function is still not re-exported from the package index (`RC-A`), so the spec imports `../src/engine/steps.ts` directly, like every other spec in this package.

## Files

- `packages/research/dsh-research-core/src/engine/steps.ts` — earliest-producer owner, the republisher rule, and the `steps` parameter with its JSDoc.
- `packages/research/dsh-research-core/tests/step-graph.spec.ts` — the rules, on synthetic graphs.
