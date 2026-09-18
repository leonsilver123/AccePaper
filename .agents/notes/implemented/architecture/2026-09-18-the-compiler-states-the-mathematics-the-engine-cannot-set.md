# Agent Note: The compiler states the mathematics its engine cannot set, and refuses only what it cannot

Status: implemented

English | [中文](2026-09-18-the-compiler-states-the-mathematics-the-engine-cannot-set.zh.md)

## Problem

A real manuscript wrote `Δ` and `−38.2` in its prose — correctly, because that is what the study computed — and pdfLaTeX refused the whole document. The measured failure named the character and nothing else: `Unicode character Δ (U+0394)`. The model had written the mathematics of its own study properly and the toolchain could not set it, so the run's PDF leg failed on a manuscript that was right.

Around it sat a second problem: batch mode prints nothing, so the refusal read `exited 1: This is pdfTeX … entering extended mode` — naming neither the file nor the character.

## Decision

- **The compiler restates a mathematical character as the mathematics it is.** `pandoc-compiler.ts` holds `TEX_MATH`, an explicit short table of characters whose meaning is mathematical and whose LaTeX is unambiguous (`Δ`→`\Delta`, `−`→`-`, `×`→`\times`, `°`→`^{\circ}`, …). A character in the table becomes `\ensuremath{…}`; anything else is left exactly as the manuscript wrote it, so a compiler that does not know a symbol sets the text rather than inventing a rendering for it.
- **`\ensuremath`, not `$…$`.** Pandoc's Markdown reader refuses to read `$…$` as mathematics when the closing `$` is followed by a digit, and a minus sign is always in that position: the first version produced the literal text `\$-\$38.2` in the LaTeX source (measured). Raw TeX passes the reader untouched, sets a symbol in text and in mathematics alike, and needs no package.
- **Only the writers that need it apply it.** HTML is UTF-8 and a DOCX is OOXML, so both set these characters out of the reader's own font; `TEX_FORMATS` is `latex` and `pdf`, the two formats pandoc writes through LaTeX. The earlier claim that the DOCX path should take it too was wrong for the same reason the `$…$` form was: it produced a broken minus in every writer.
- **Refusals name what the engine said.** `engineFailureOf` reads `<jobname>.log` and returns the `!` lines, so a failure reports `Unicode character 西 (U+897F)` rather than the engine's banner.
- **A character the table does not know stays in the document.** A reference entry carries the venue's own name — `西南交通大学学报：英文版` is what OpenAlex returned for the journal — and it is retrieved data, not prose the model composed. The compiler does not rewrite it, and the optional PDF leg then fails with the character NAMED. Both deliverables, DOCX and LaTeX, carry it verbatim either way; stripping a reference to make a PDF build would change what the paper cites.

## Alternatives considered

- **Strip non-ASCII characters from the compiled document.** Refused, and refused in the review's own words: it changes what the paper says. A reference list is part of the paper.
- **Ask the model to write around its toolchain.** Refused: the model wrote the mathematics correctly, and asking it to avoid `Δ` in a paper about `Δ` trades a correct manuscript for a toolchain's convenience.
- **Emit `$…$` and rely on the reader.** Refused by measurement: `$-$38.2` is not mathematics to pandoc and came back as escaped literal text in every writer.
- **Map the CJK character to a LaTeX command.** Refused: a CJK glyph has no pdfLaTeX command that is not a font selection, and choosing a font is the deployment's decision, not this compiler's. The refusal is honest; a silent glyph substitution is not.
- **Give up the PDF leg entirely.** Refused: it is a required deliverable for a deployment that has an engine, and it now compiles for everything the manuscript legitimately states in Latin and mathematical notation.

## Consequences

- **Real-engine evidence, 2026-09-18.** `.workbuddy/tmp/tex/TinyTeX` (TeX Live 2026, pdfTeX 3.141592653-2.6-1.40.29) compiled the manuscript through the seam: an 86 KB `%PDF-1.7` whose decompressed content stream carries `[(Results)]TJ [(The)-333(e\033ect)-333(fell)-334(b)28(y)]TJ [-333(\000)]TJ [(38.2)-333(%)-334(and)]TJ` — the prose, with the minus set as a mathematics glyph — plus the table's cells and two image objects. The LaTeX source carries `\ensuremath{-}38.2`, `\ensuremath{\Delta}`, `\begin{longtable}`, `\toprule` and `\includegraphics`.
- **`tests/pdf-and-figures.spec.ts`** gained a `describe.skipIf` block over the engine this machine has (found through `DSH_LATEX_ENGINE` or a checkout-local install): one case compiles mathematics, a table, an equation and a figure to a real PDF, and one asserts the CJK refusal names `U+897F` while the same document compiles as LaTeX carrying the name verbatim. A skipped real-tool case is distinguishable from one that passed; the stand-in engine's cases are unchanged beside them and still prove the byte handling, which the real engine cannot.
- **`tests/matplotlib-provider.spec.ts`** gave its two real-library cases an explicit budget. The chart case timed out at 5022 ms under a full parallel suite and passed alone — a defect in the case, recorded as measured, not a slow library.
- **What this is not.** The digest of `TEX_MATH` is not a completeness claim: a mathematical character outside the table reaches the PDF leg as a refusal, and the table grows by measurement. And the typography is still pandoc's default rather than a journal's — `FormatSpec`/CSL is a separate unit.

## Files

- `packages/research/dsh-research-cordis/src/pandoc-compiler.ts` (`TEX_MATH`, `asTexMath`, `TEX_FORMATS`, `engineFailureOf`).
- Specs: `packages/research/dsh-research-cordis/tests/pdf-and-figures.spec.ts`, `packages/research/dsh-research-cordis/tests/matplotlib-provider.spec.ts`.
