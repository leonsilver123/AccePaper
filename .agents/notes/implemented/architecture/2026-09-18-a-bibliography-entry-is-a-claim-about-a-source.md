# Agent Note: A returned bibliography entry is a claim about a source, and is checked as one

Status: implemented

English | [中文](2026-09-18-a-bibliography-entry-is-a-claim-about-a-source.zh.md)

## Problem

P18-07 asks for a real library to feed the evidence chain: a Zotero item read through the product's own MCP client, whose evidence supports a sentence, whose `.bib` entry is in the package, and whose identity is the same in all four places. The reading half worked on the first try — `zotero_get_item_metadata(item_key="UA5MIGG3", format="bibtex")` returned a complete entry through `packages/mcp/mcp-client` — and the tempting next step was to save its text and move on.

That is the step this note refuses. The case the pipeline review names is not a parser that crashes; it is an entry that parses perfectly and cites something else: a DOI from a different paper, a title the library does not hold, a year from an earlier version. Every one of those renders, looks right on the page, and points a reader at a source the manuscript never read.

## Decision

- **`src/zotero-bibliography.ts` owns the two pure halves; the adapter owns the live one.** Deciding whether a returned entry is the source it claims to be, and naming a source so that a sentence, a citation and a `.bib` entry can be shown to be about one paper, need no server — so they are checked without one. Only reading the library needs a running Zotero.
- **The identity is `library + item key`.** An item key is unique WITHIN ONE LIBRARY: `UA5MIGG3` names nothing without the library it came from, and two libraries can hold the same key. `literatureIdOf` mints `zotero:<type>:<id>:<key>` for that reason, and the citation key is kept separate — it is what the MANUSCRIPT prints, and it is the citation registry's to assign and to keep unique.
- **An entry is checked against the item's own metadata, not trusted.** `checkBibtexEntry` refuses `bibtex-unparseable` (a tool failure message saved as an entry is a citation resolving to nothing), `bibtex-key-mismatch`, `bibtex-missing-field`, `bibtex-doi-mismatch`, `bibtex-title-mismatch`, `bibtex-year-mismatch` and `bibtex-author-unusable`. Nothing is repaired: a field quietly fixed is a bibliography nobody can trace back to the library.
- **`citation-js` parses; nothing rewrites nested fields by hand.** `@citation-js/core@0.8.2` + `@citation-js/plugin-bibtex@0.8.2`, exact versions, in this package — the one that consumes them. It decodes BibTeX's TeX escapes into real characters, which is what makes `Th{\"u}ring` an author named Thüring rather than an escape printed in a bibliography. It ships no types, so `src/citation-js.d.ts` declares exactly the surface this package consumes and nothing else.
- **The `.bib` is rendered from the parsed structure, with `citation-key` set.** A `file` field naming where this machine keeps the PDF is in the tool's reply and not among the fields the writer emits, so it is absent by construction rather than by a pattern that has to keep up with the formats. And the writer must be given `citation-key`: measured 2026-09-18, it IGNORES `id` and invents a label from author and title without it, so an entry the run keyed `rocheWhatHappensWhen2020` came back as `@article{Roche2020title,` — a rename in the one place a reader follows the citation.
- **An institutional author is kept whole.** `World Health Organization` arrives as `literal`; splitting it into a family and a given name would print `Organization, World Health`, naming an author that does not exist.

## Alternatives considered

- **Save the tool's text as the `.bib` entry.** Refused: it is unvalidated. A reply whose title is another paper's, or whose DOI drifted, would be packaged and cited.
- **Repair a mismatched field from the library's metadata.** Refused: the two disagree, and which is right is not this check's to decide. A disagreement is reported to a reader.
- **Use the writer's generated label.** Refused: it renames the source at the point of use. The key the run assigned travels in `citation-key`.
- **Ask for a Zotero Web API key so the export tool works.** Refused: unnecessary. `export_bibliography` needs a CSL engine and fails locally; the metadata tool produces BibTeX locally, which is the capability the local route needs. This was measured after an earlier reading of this repository concluded the opposite from the wrong tool.
- **Strip `file` with a pattern over the returned text.** Refused, and the guidance names the reason: a regular expression over BibTeX's nested fields is how a title loses a brace. The field is absent because the entry is built from the fields a citation has.

## Consequences

- **`tests/zotero-bibliography.spec.ts`** (14 cases) uses the entry the real tool returned, verbatim: it is accepted with its bibliographic fields, and the umlaut is decoded to `Thüring`. The refusals cover a tool failure message, non-BibTeX text, a wrong DOI, a renamed key, a different title, a disagreeing year, an empty author field and a reply carrying two entries. The identity cases pin the cross-library collision and the stability of the internal id across a rename. The rendering cases pin that no local path survives and that an institutional author stays whole.
- **What is not here.** Reading the library, reading a full text, reading a given page, and judging a sentence against an evidence passage are separate acceptances: metadata and `.bib` succeeding does not stand in for them. Zotero's identity is not yet bound to core's `CitationRef` or to the citation registry — the mapping exists and has no consumer on the run path yet, which is the next unit.
- **The earlier reading was wrong and is corrected here.** `export_bibliography` failing in a local-only deployment was read as "the local route cannot produce BibTeX". The two tools are different capabilities; the metadata tool's `bibtex` format is local, and it works.

## Files

- `packages/research/dsh-research-cordis/src/zotero-bibliography.ts` (new), `src/citation-js.d.ts` (new — declarations for two untyped dependencies).
- `packages/research/dsh-research-cordis/package.json` (`@citation-js/core@0.8.2`, `@citation-js/plugin-bibtex@0.8.2`, exact).
- Specs: `packages/research/dsh-research-cordis/tests/zotero-bibliography.spec.ts` (new).
