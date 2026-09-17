# Agent Note: The PDF is read page by page, on a real engine

Status: implemented

English | [中文](2026-09-17-the-pdf-is-read-page-by-page.zh.md)

## Problem

The review's R01 recorded what the PDF branch did: it ran `pandoc -t latex --pdf-engine=…`, captured stdout as UTF-8 text, wrote it to `manuscript.pdf`, and reported success — exit code 0, no `%PDF-`, LaTeX source. The path was fixed (pandoc writes `.tex`, the engine runs over that file, the bytes are read back and the header is checked), and the review set the bar for closing it: a real engine must compile it and the pages must be inspected. **A `%PDF-` header is not that bar either** — a file that begins correctly and holds one empty page passes a header check.

Nothing produced a PDF at all. No LaTeX engine was installed on this host, and E1 compiled only `html` and `latex`, so a deployment that *had* an engine still recorded no PDF on its artifact.

## Decision

- **A real TeX Live is installed here** (CTAN, `scheme-minimal` plus `pdftex` and the packages pandoc's template needs), at `.workbuddy/tmp/texlive/tex` — a deployment toolchain, not source: it is outside the repository's tracked tree and no path to it is committed. The engine is found through `DSH_LATEX_ENGINE` or that checkout-local install.
- **E1 compiles `pdf` when the deployment can produce one** — from the compiler's own probed `formats`, so a machine with no engine is never asked for a PDF it would refuse. The three formats are rendered from the SAME document model, so they cannot describe different manuscripts; leaving PDF out made "this deployment has an engine" unverifiable from a package.
- **`tests/pdf-acceptance.spec.ts` reads the pages.** It compiles a document through the seam's own entry point (`compileManuscript`), writes the returned **base64** bytes, checks the header, and then reads the document the way a reader does — with a real parser (`pypdf`) — and asserts:
  - more than one page, which is what "the engine paginated it" means and what an exit code cannot say;
  - page 1 carries the first section's heading AND its text;
  - page 1 does **not** carry the second section's text, and a later page does.
  
  That last pair is what separates a real document from a file whose pages are empty or all the same page. The fixture is long enough to paginate, because a one-page document cannot show that the pages are real.
- **It runs only where an engine is installed** (`describe.skipIf`), and says so where one is not: an engine is a deployment toolchain, not a dependency of this package, and a skipped real-tool case is distinguishable from one that passed.

## Alternatives considered

- **Assert the header and the page count from the byte stream.** Refused as the whole check: counting `/Type /Page` occurrences says nothing about what is on them, and the review's bar is the document, not its structure.
- **Use a stand-in engine.** Refused by the review in as many words, and rightly: the defect being closed was a path that reported success from a file that was not a PDF, which a stand-in reproduces rather than catches.
- **Wait for a LaTeX engine to be configured and leave the PDF route unverified.** Refused: R01 stays open until a real engine compiles it, and "no engine here" was an environment fact rather than a property of the code.
- **Vendor the engine into the repository.** Refused: a TeX distribution is a toolchain a deployment has, and committing one would make the repository carry a platform-specific binary tree.

## Consequences

- **Measured**: pandoc 2.12 → pdfTeX 3.141592653-2.6-1.40.29 (TeX Live 2026) → a multi-page PDF, with the per-page assertions above green.
- **What this does not cover.** The acceptance compiles a synthetic document; no *package built by the shipped profile* has been compiled to PDF yet, because the profile names no engine (a deployment adds `latexEngine:`). Figures in the PDF are not asserted page-by-page here — the raster is embedded and `compiled-document-complete` governs whether a float was lost, but "the figure is on page 3" is not checked. The engine lives outside the repository, so this case skips on any machine that has not installed one.

## Files

- `packages/research/dsh-research-team/src/runner/registry.ts` (E1 compiles `pdf` when the compiler offers it).
- Specs: `packages/research/dsh-research-team/tests/pdf-acceptance.spec.ts` (new).
