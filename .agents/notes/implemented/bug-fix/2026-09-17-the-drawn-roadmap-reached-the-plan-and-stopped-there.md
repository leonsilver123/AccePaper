# Agent Note: The drawn roadmap reached the plan and stopped there

Status: implemented

English | [中文](2026-09-17-the-drawn-roadmap-reached-the-plan-and-stopped-there.zh.md)

## Problem

The review's R02 asked for the roadmap to be rendered, and R05② delivered the capability: `FigureProvider.renderDiagram` draws it, and D1 writes the picture onto the roadmap float (`diagramDrawn: true`, `svg`, `pngBase64`). What nothing did was consume it.

`E1-format` builds the manuscript from the figure plan, and its loop pushed the roadmap as `figureBlock({ mermaid })` regardless — the `svg` and `pngBase64` sitting on that same entry were never read. `documentOf` then made it a `diagram` block, and `unembeddableFloats` reports every diagram as a float no format can embed ("a diagram is carried as its own source and no static rendering was produced for it"). So a deployment **with** a scientific plotting library got exactly the outcome the library was added to remove: `compiled-document-complete` false, `Figure 2` dropped in every format, the package stuck at `draft`. The capability was verified at its own seam and never at the consumer.

## Decision

- **A drawn roadmap is a figure; an undrawn one is source.** `FigurePlanEntry` gained `diagramDrawn`, and E1's float loop branches on it: `diagramDrawn === true` with an SVG pushes the same `figure` block a data figure gets, with the same two renderings, and otherwise the Mermaid block stays. The two are not the same float — one can be embedded by every format the deployment can produce and the other by none — and reporting the second as the first is how a document comes to claim a figure it does not carry.
- **The document's floats are built where the Markdown's are.** `documentFloats` is filled in the same loop that fills `figureBlocks`, and `documentOf` takes that list. The old code rebuilt the list afterwards by re-finding each entry by `kind` (`floats.find(entry => entry.kind === 'data-figure')?.label ?? 'Figure 1'`), which is a second reading of the plan that can disagree with the first — and the label a caption prints is exactly the thing that must not. The table is spliced in at the index the plan gave it, so the document prints the floats in the plan's order instead of moving the table to the end.
- **Found by the same change: the binary deliverables were filed as assets.** `compilation.assets` was documented as "a figure the compiled document embeds" and in fact carried every base64 file — including `manuscript.docx` and `manuscript.pdf`. Since DOCX and LaTeX are the deliverables this fork produces, the artifact now splits them: `compilation.documents` carries the compiled documents as bytes and `compilation.assets` carries the figures they embed, with the kind taken from where the compile put each file (its own `fileName` versus its `files`) rather than guessed from the path. `package-export` writes both, so the package on disk is unchanged.
- **The figure asset path is derived from the label** (`figureAssetPath`): `Figure 2` → `figures/figure-2.svg`. The data figure's path was the literal `figures/figure-1.svg`, which is a second numbering that can drift from the plan's; the derived path reproduces that literal exactly for `Figure 1`, so nothing moved.
- **The shipped bundle documents the channel.** `packages/bundle/research-app/cordis.patch.yml` now names `figures` beside `document`, as an opt-in with the interpreter left to the deployment — the same reasoning that keeps `latexEngine` out of the file. A deployment that has no library loses nothing: the built-in renderer draws, each float says no library drew it, and the artifact says the roadmap is a float its documents cannot carry. Measured absence, not a failed step.

## Alternatives considered

- **Teach `unembeddableFloats` that a drawn diagram is embeddable.** Refused: it would make the block kind carry a conditional, so every reader — the pandoc compiler's own `dropped` list, the submission refusal, the final-package check — would have to ask "and was it drawn?" rather than the document simply holding a figure when one exists. The rendering is what makes it a figure; the model says so once.
- **Keep Mermaid in the Markdown and put the picture only in the document model.** Refused: the Markdown manuscript is a deliverable, and `figureBlock` refuses a float that is both a path and a fence. A drawn roadmap referenced by file, beside the tool's own `roadmap.md`, is the same shape the data figure already has.
- **Name the interpreter in the bundle.** Refused: it is a virtual environment on one machine. The `cordis.patch.yml` comment states the channel and shows the line, as it does for the LaTeX engine.

## Consequences

- **Both directions are pinned.** `tests/document-compile.spec.ts` drives the real 16-step run with a recording compiler: a drawing provider makes `Figure 2` a figure carrying the provider's SVG and raster, `floatsDropped` is empty, the package holds `figures/figure-2.svg` and `manuscript.md` refers to it; with no provider the same run keeps the `diagram` block, the Markdown keeps the Mermaid fence, and the compile reports what it could not carry. The first case was checked against a disabled branch and fails there.
- **The whole chain is read once with real tools.** `tests/pdf-acceptance.spec.ts` probes the real matplotlib interpreter, drives a run with it and the real pandoc, and asserts the package's own files: `floatsEmbedded.latex` is `['Figure 1', 'Figure 2']`, `floatsDropped` is empty, `figures/figure-2.svg` is the library's SVG, and the compiled DOCX carries two `word/media/` parts. That case raises `timeoutMs`, because D1 drawing through a library and E1 compiling four formats are process spawns the registry's offline budget does not fit.
- **`tests/package-export.spec.ts` pins the bytes.** A compiler answering with a real ZIP signature and a real PNG signature: the exported package carries `manuscript.docx` and `assets/figure-1.png` as base64 whose decoded first bytes are `PK` and the PNG magic — so a writer that text-wrapped or re-encoded them would fail.
- **What this is not.** It does not close R02 for a deployment that names no drawing provider: that deployment's roadmap is still Mermaid only, and its package still stops at `draft` — the honest state recorded in the README. The roadmap's page position, its legibility and whether a matplotlib box-and-arrow drawing reads as a methods diagram are a reader's judgements, not this check's.

## Files

- `packages/research/dsh-research-team/src/runner/registry.ts` (`diagramDrawn`, `figureAssetPath`, the float loop, `compilation.documents`), `src/runner/package-export.ts` (writes both byte lists).
- `packages/bundle/research-app/cordis.patch.yml` (the `figures` channel, documented).
- `packages/research/dsh-research-team/README.md` / `README.zh.md` (R05②/R02 claims corrected).
- Specs: `tests/document-compile.spec.ts`, `tests/pdf-acceptance.spec.ts`, `tests/package-export.spec.ts`.
