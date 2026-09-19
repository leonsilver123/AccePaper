# Agent Note: The typeset form is its own artifact

Status: implemented

English | [中文](2026-09-19-the-typeset-form-is-its-own-artifact.zh.md)

## Problem

E1-format emitted one artifact, `formatted-manuscript`, that was three things at once: the manuscript's Markdown, the compile report (the tool that ran, the formats this deployment offered, the documents it produced, the floats it could not embed), and the carrier of the compiled DOCX, LaTeX, HTML and PDF bytes together with the assets they embed. A reader who wanted one of the three had to take the artifact apart, and nothing separated "the paper" from "what a compiler made of the paper".

The same arrangement put assembly and compilation inside one step. E1 invoked `three-line-table` over the run's measurements, composed the floats, built the document model, and only then handed the result to the compiler. Two consequences followed, and both are the kind this layer exists to prevent: the document a compiler received existed nowhere a reader could compare it with the paper, and E1 became the second step to decide what the paper's numbers are, so the compiled document could carry a table the manuscript Markdown did not — and a document could reach a compiler in a state no other step had approved.

## Decision

- **The document and its rendering are two artifacts, each with one owner.** `steps.ts` declares E1 `outputs: ['typeset']`. `manuscript` stays the document, created by D3 and republished by D4 with the revision applied; E2 declares `inputs: ['manuscript', 'typeset']`; `ARTIFACT_TYPE_BY_SLUG['typeset']` is `'typeset-package'` and `PACKAGED_SLUGS` carries both. `ACCEPTED_MANUSCRIPT_SLUG` (`engine/acceptance.ts`) follows to `'manuscript'`, because an acceptance publishes a new version of the DOCUMENT: a candidate assembled over the typeset artifact would be a change to a rendering, and the next thing to read the document would read the version nobody accepted.
- **E1 renders; it does not assemble.** It reads `manuscript`, takes its `document` field, and compiles that. The refusal states the missing fact rather than working around it: `[E1-format] the manuscript artifact carries no document to render`. Rendering the Markdown from the artifact's sections alone would publish a package whose compiled form describes a paper no step wrote.
- **The results table moved to D3-writing, which reverses the T19-S ruling.** The comment that recorded the old ruling was rewritten rather than deleted, and what replaced it is this: T19-S read the table as a FORMATTING concern — a paper gets a three-line table when it is set — and the ruling stands as far as it goes, because the capability belongs to the tool and never to the step; `E1-format` never was `renderThreeLineTable`. What it missed is that a document which is authoritative before it is typeset has to CONTAIN its table already. E1 could only render one by reading the run's measurements itself, which made E1 the second step to decide what the paper's numbers are. D3 writes the document, the table is one of its blocks, so D3 invokes `three-line-table` as its own capability. The registry's own header now records the supersession — `SUPERSEDED ON 2026-09-19: the T19-S ruling kept the table inside E1 as a sub-capability, and the table has since moved to D3-writing — a document that is authoritative before it is typeset has to already carry its table. E1 now invokes no catalogue tool at all.` — and `e1Executor`'s JSDoc carries the same reading: the ruling still holds where it was about the tool, and got the step wrong, because a table added at typesetting time is not part of the document a reader approves.
- **The truthfulness levels moved with the capability, because the level names what ran.** D3 is `real_tool_fixture_input` (its prose is still this package's fixture sentences, and the REAL `three-line-table` tool function executes inside it), and E1 is `local_computation` (no catalogue tool runs; the compile is a seam the deployment fills). E1's producer brand follows the same fact: `E1_PRODUCER` is `'render:typeset-package'` instead of the `three-line-table` tool id and version.
- **E1's refusals were not weakened.** The citation/reference agreement, the statement bindings, the sentence-support readings and the argument-plan obligations all still run and still refuse; they read `manuscript` instead of the old `revised-draft` slug, and none of them was relaxed to make this land.
- **The floats are composed once, where the document is written.** D3 builds the Markdown pipe table from the structured model the tool returned and composes the document's floats with it; E1 composes the package's Markdown floats with the same function over the same `renderedFigures`, and takes the table from the document rather than laying it out a second time.

## Alternatives considered

- **Keep E1 assembling and just rename the slug.** Rejected: the step that compiles the paper would still decide what the paper says, and a document could reach a compiler in a state no other step approved. A rename would have left the two artefacts — the Markdown a reader reads and the document a compiler receives — constructible only by the same step, so a disagreement between them would still be unobservable from the registry.
- **Keep E1's `three-line-table` producer brand and its `real_tool_fixture_input` level.** Rejected, in the registry's own words: the brand `was true while the table was rendered here and became a claim about a tool this step no longer invokes`. The level is not decoration — the report renders `real_tool_fixture_input` as "Real tool functions executed", so a step that invokes no catalogue tool may not carry it.
- **Leave the table in E1.** This is the arrangement the T19-S ruling produced, and reversing it is one of the two halves of this change: E1 could only render a table by re-deriving the study's numbers at typesetting time, which is exactly the second decision-maker the split removes.

## Consequences

- `formatted-manuscript` no longer exists as an artifact slug; `typeset` replaces it and `manuscript` remains the document. The compile report and the compiled bytes live under `typeset`.
- A table the document does not carry is now unrepresentable: the compiled document and the manuscript Markdown are two renderings of one float list, composed at D3.
- `documentOf` and `pandoc-compiler.ts` no longer name E1 for facts that belong to the writing step and to the compile seam; `pandoc-compiler.ts` is comment-only in this change.
- The registry table reports D3 as a step that executes a catalogue tool and E1 as one that does not. Nothing about either step's gate changed.
- Because E1 renders a document it can name, the typeset artifact records the manuscript version it rendered, and a package can be asked whether its typeset form renders the document the run holds or one the run has left behind.

## Files

- `packages/research/dsh-research-core/src/engine/steps.ts` — E1 `outputs: ['typeset']`, E2 `inputs: ['manuscript', 'typeset']`.
- `packages/research/dsh-research-team/src/runner/registry.ts` — the T19-S supersession comment, the `E1_PRODUCER` brand, the two truthfulness levels, the D3 table render and `e1Executor`'s document refusal.
- `packages/research/dsh-research-team/src/runner/{document-compile,package-export,final-package}.ts` — the reads that followed the slug, `PACKAGED_SLUGS`, and `manuscriptProduced` reading `typeset`.
- `packages/research/dsh-research-core/src/engine/acceptance.ts` — `ACCEPTED_MANUSCRIPT_SLUG` is `'manuscript'`.
- `packages/research/dsh-research-cordis/src/pandoc-compiler.ts` — two comments that named E1.
- `packages/research/dsh-research-team/README.md` and `.zh.md` — the deferred-work entry for the moved table and the two slugs.
