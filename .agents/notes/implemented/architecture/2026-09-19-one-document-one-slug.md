# Agent Note: One document, one slug

Status: implemented

English | [中文](2026-09-19-one-document-one-slug.zh.md)

## Problem

The pipeline gave each writing step its own artifact: `draft` from D3, `revised-draft` from D4, `formatted-manuscript` from E1. Three slugs for one document, and the property that costs is the one this layer cares about most — a judgement has to bind the version of the document it was made about, and three slugs give it three things to bind instead of one.

Merging them exposed a defect that the split had been hiding, and it is the reason the change was worth making rather than merely tidy. `d4Executor` **rebuilt** the artifact value from scratch. Under the split that was survivable, because D3's `draft` still existed to be read. Under one slug there is nowhere else to read it from — the registry keeps only the latest value per slug — so every field D3 wrote that D4 does not recompute was **gone from the run entirely**. One of those fields is load-bearing: `final-package.ts`'s `no-refused-sections` check reads `refusedSections`, which came back empty for every run, so a run that HAD refused a section was reported as one that had refused none. A gate that cannot fail is worse than a missing gate, because it reports success.

A second, smaller one: the A channel's evidence composed `` `the ${manuscript.slug} manuscript` ``, which now prints "the manuscript manuscript".

A third, and the one most likely to have gone unnoticed: the mechanical rename made three specs read the same slug twice and compare a revision with itself. They kept passing while testing nothing.

## Decision

- **The document is one slug, `manuscript`, with one version counter.** `steps.ts` declares D3 `outputs: ['manuscript']`, D4 `inputs: ['manuscript', 'result-version'] outputs: ['rebuttal', 'manuscript']`, E1 `inputs: ['manuscript', ...]`. `nextArtifactVersion` already bumps per slug, so each republish is a new version and a new content hash with no new machinery.
- **A republisher carries forward what it does not recompute.** D4 now carries `proseRequests`, `proseRequestVersion`, `sectionEvidence` and `refusedSections` from the document it read, in the same explicit style as the `references` / `citations` / `argumentPlan` / `renderedFigures` / `statementAssessments` carry-forwards already beside them, each with a comment naming its consumer.
- **A spec that needs the pre-revision document reads it where the engine keeps it** — D3's own attempt record, `getRunSnapshot(store, runId).steps['D3-writing'].artifacts['manuscript']` — because the registry holds only the latest value.

## Alternatives considered

- **Keep three slugs and have each step read the previous one.** Rejected: that is the arrangement being removed, and the defect above is what it hides — with `draft` still present the omission looked like a design choice rather than a loss.
- **Have D4 write `manuscript` as a copy of D3's value with the patched sections replaced.** This is what the carry-forwards now do, but written as an explicit list rather than a spread. A spread would have carried the fields and would also have silently carried whatever a later field's meaning changed to; the list fails to compile when the shape moves.
- **Fix only the specs, since six of the failures were "just expectations".** Rejected: they were not expectations. The specs were right and the source was wrong, which is exactly the case where editing the specification would have destroyed the only evidence that a gate had stopped working.
- **Rename `'draft'` everywhere it appears.** Rejected: `'draft'` is also the package state (`FinalPackageState = 'draft' | 'final'`) and the compile mode (`CompileRequest.mode`). A blanket rename broke ten assertions on those two, and the subject of each assertion is what tells them apart.

## Consequences

- The whole pipeline runs on the merged slug — driven end to end: A1..D2 passed, D3 passed, D4 passed, E1 passed, E2 gated.
- `'draft'` and `'revised-draft'` no longer exist as artifact slugs. `formatted-manuscript` is still E1's output; splitting it into a `typeset` artifact is the next unit, not this one.
- The registry's entry for a republished slug names its **last** producer, so `happy-path-t19b.spec.ts`'s "writes every declared output slug" now checks against the last declarer. It still catches a slug declared but never produced, and a writer that was not declared.
- **A blocked or failed step's output is committed to the registry** — the commit runs before the gate. Two specs that asserted "no manuscript was produced" after a refused step now assert that no later step republished it, which is the fact they were always about.
- `dsh-research-team/README.md` in both languages described the old slugs; corrected and the pair re-recorded.
- **Not done here**: `MANUSCRIPT_SLUGS` in `verdict.ts` is now a one-element list, and the verdict does not record WHICH version of the manuscript it read. Both are real and belong to the next unit.

## Files

- `packages/research/dsh-research-core/src/engine/steps.ts` — the merged slug on D3, D4 and E1.
- `packages/research/dsh-research-team/src/runner/registry.ts` — D3 commits `manuscript`; D4 republishes it and carries forward the four fields.
- `packages/research/dsh-research-team/src/runner/{verdict,package-export,final-package}.ts` — the reads and the producer-name table.
- `packages/research/dsh-research-web/src/client/{record-vocabulary.ts,locales.ts}` — the artifact vocabulary and its two languages.
- `packages/research/dsh-research-team/README.md` and `.zh.md` — the slug named in the A gate's description.
