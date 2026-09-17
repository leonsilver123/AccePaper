# Agent Note: The manuscript is a document, and compiling it is a seam the deployment fills

Status: implemented

English | [中文](2026-09-17-the-manuscript-is-a-document-and-compiling-it-is-a-seam.zh.md)

## Problem

E1 assembled the manuscript by concatenating strings: a title, a `## heading` per section, the figure blocks, the numbered references. Anything that needed the document as a document had to parse that string back into parts, and the plan's compile chain (M08: structured document → HTML + PDF/TeX) had no structured document to compile. The delivered package carries `manuscript.md` and nothing a journal, a reader or a PDF engine could take.

## Decision

- **`runner/document-compile.ts` states the manuscript as parts.** `ManuscriptDocument` is a title, sections with typed blocks (prose; a figure carrying its own SVG; a table as markdown; a diagram as mermaid; an equation as LaTeX) and references keyed the way the prose cites them. The blocks are built from the parts E1 already has, so the composition is stated once instead of being re-derived by every backend.
- **Compiling is a SEAM, and nothing in the research packages spawns.** A deployment injects a `DocumentCompiler` (through `ctx.research`, read by `hostDocumentCompiler()` and handed to the drive options, the way the prose channel is). The types are re-exported from the package's public `./types` entry so a deployment can implement the seam without importing an internal path.
- **The refusals are the unit's point.** `compile-compiler-missing` (no compiler configured — the manuscript still exports), `compile-format-unavailable` (a format this deployment cannot produce: what a machine with no LaTeX engine answers for `pdf`), `compile-citation-unresolved` (a key the bibliography does not carry, refused BEFORE the compiler runs, because a compiler renders it with a warning in a log nobody reads), `compile-nothing-to-render`.
- **Nothing is written by the compile.** The content comes back for the caller to stage and publish, so a compile that fails cannot have destroyed what a previous export wrote — the plan's rule that a failed compile must not destroy the old package is structural here rather than a promise.
- **E1 records what rendered it.** The artifact carries `compilation` (tool, formats, compiled files, refusals), and the compiled files join the package when they exist; a run that could not compile says so on the artifact rather than by the absence of a file.
- **The deployment's compiler drives pandoc** (`dsh-research-cordis/src/pandoc-compiler.ts`), satisfied structurally so the package still does not depend on the research-team package. Its formats are PROBED from the executables named in the config: a deployment offers `pdf` only when a LaTeX engine actually answers.

## Alternatives considered

- **Compile the assembled Markdown string.** Refused: it is the input this unit exists to replace — every backend parses it differently, and the figures, equations and citations are already typed where they are made.
- **Spawn pandoc from the research package.** Refused: whether a machine has a toolchain is a deployment fact, and a research package that spawns a process has taken a capability the deployment owns. The seam also makes the tests deterministic without a toolchain.
- **Let the compiler resolve citations (`--citeproc` with a CSL bibliography).** Refused for now, not in principle: the run's references are a formatted entry and a cite key, not CSL JSON, and building CSL fields from a formatted string would invent the structured fields (`volume`, `page`, `container-title`) that M03 keeps as source-recorded. The numbering is the manuscript's and the compiler renders it.
- **Use `--mathjax` for the HTML.** Refused on measurement: a self-contained file with MathJax is 1.78 MB, and the plan asks for a document that reads with the network off. MathML renders natively in current browsers and the same document is 14 KB.

## Consequences

- **Verified end to end against the real tool**: a driven run under the shipped configuration (pandoc, no LaTeX engine) produced `manuscript.html` at 14 KB — self-contained, the figure inline, the equations as MathML, the citations rendered as numbers — and `manuscript.tex` at 8.8 KB with the LaTeX document class and the model's own equation, with `compilation.refusals` empty; the `pdf` leg answered that pandoc on this deployment cannot produce a PDF.
- **A deployment without pandoc fails nothing**: the run exports its Markdown manuscript and the artifact records `compile-compiler-missing`, which `tests/document-compile.spec.ts` asserts.
- **What this does not cover.** No PDF exists anywhere in this repository yet — the PDF leg is implemented and unexercised, because no deployment names a LaTeX engine. The typography is pandoc's default rather than a journal template, because no journal template has been read (the TRC checklist records the unverified rules). And the document model is thin: M08 will render from M04's statement-level contracts, which do not exist yet.

## Files

- `packages/research/dsh-research-team/src/runner/document-compile.ts` (new), `src/types.ts` (the seam re-exported), `src/runner/types.ts` and `src/runner/drive.ts` (the compiler reaches the step), `src/runner/registry.ts` (E1 builds the document, compiles and records it), `src/index.ts` (`hostDocumentCompiler`).
- `packages/research/dsh-research-cordis/src/pandoc-compiler.ts` (new), `src/index.ts` (`Config.document`, the probe), `packages/bundle/research-app/cordis.patch.yml` (the shipped profile names pandoc).
- Specs: `packages/research/dsh-research-team/tests/document-compile.spec.ts`, `packages/research/dsh-research-cordis/tests/pandoc-compiler.spec.ts` (self-skipping without pandoc; the refusal path is asserted either way).
