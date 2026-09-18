# Agent Note: one registry chosen by configuration, and a `.bib` that cites under the run's own keys

Status: implemented

English | [中文](2026-09-18-one-registry-chosen-by-configuration.zh.md)

## Problem

Two chains did not meet, and a third was quietly wrong.

**A source read from the library could not be cited.** The citation registry's `reviewedSources()` projected the checked-in corpus and nothing else, so a source the run had just read out of Zotero appeared in A1's ledger and could never become a `SourceRecord`. A sentence citing it was refused as `citation-unreviewed-source`. There was also no way to say WHERE a run's citable sources come from — the corpus was the only answer, which made "we cite what the library holds" unexpressible.

**There was no `.bib` export at all.** `renderBibtex` existed and had zero production call sites; the run package wrote `citations.json` and no file a journal could be handed. "The manuscript cites these works" was therefore a claim about a JSON file.

**And `renderBibtex` had been renaming every entry.** Its comment said the key travels in `citation-key`, and it does not. Measured against the installed `@citation-js/plugin-bibtex@0.8.2`: `LABEL.toSource` uses the label it is given only when `isLabelSafe` accepts it, and `isLabelSafe` rejects anything whose label falls in its unsafe set — the ranges from space through `/` and from `:` through `@`, which include `-`, `.` and `/`. Every cite key this repository mints is `cite-<identifier>` and every DOI contains all three, so the check rejected every one and the writer fell through to inventing a label from author and year. The file carried `@article{Roche2020What,` where the manuscript cites `cite-10.1016/j.aap.2020.105588`. It parsed, it looked like a bibliography, and the citation in the text named nothing in it. The existing spec called `renderBibtex` twice and never asserted the key.

## Decision

- **One registration mechanism, selected by configuration.** `SourceRegistryMode` is `zotero`, `curated` or `combined`, and `sourcesForMode` is the single place that turns a mode and what the registry offered into the sources a run may cite.
- **A zotero run whose library could not be read has NOTHING to cite.** It does not fall back to the checked-in corpus. This is the whole reason the mode and the source set travel separately: a run that silently cites a repository instead of the library it was pointed at has published a bibliography nobody asked for, and the delivered paper cannot show it.
- **`combined` is the only mode that draws on both, and it registers rather than merges.** Each record carries its own `registry`, so a reference list can state where an entry came from; a registration never overwrites a curated record of the same id, because two registries that minted one identity is a collision and preferring one would drop a source without saying so.
- **The registration carries the passage, not only the identity.** `SourceRegistration.evidence` is an `EvidenceBinding` — the item's version, the attachment and ITS version, the locator, the content hash, the route and the rule version — so what a citation of a freshly read source rests on is recorded at the moment it is read.
- **A pair read at two versions is refused.** `readRegistrations` compares the version the entry was read at against the version the page was read at and registers neither when they differ, which is the mixture `readSource` exists to refuse.
- **The bibliography is a capability the deployment supplies, declared where it is consumed.** The seam is `BibliographyWriter` in `dsh-research-team`, implemented in `dsh-research-cordis` as a structural twin — the two are siblings and neither may import the other, the same shape `matplotlib-provider.ts` and `llm-reviewer.ts` already use.
- **The writer is told to print the label it is given.** `configureBibtexLabels` sets the plugin's own `format.checkLabel` and `format.useIdAsLabel`, once, with the measurement in the comment. The alternative — rewriting the rendered text — would make the deliverable's key depend on the shape of a label this repository does not control.
- **A rendered file is checked before it is written.** `checkBibliography` refuses one carrying a local path, one omitting a key the manuscript cites, and one with no entries when the manuscript cites some; the export throws on a refusal rather than writing a file that looks like the one a journal accepts.

## Alternatives considered

- **Let a run read both registries and pool them.** Rejected: it is the auto-merge the guidance forbids, and it makes a source's origin unrecoverable exactly where it matters, in the reference list.
- **Fall back to the corpus when the library is unreachable.** Rejected: it turns an outage into a successful run with someone else's evidence. The live acceptance asserts the opposite — an unreachable library is `endpoint-unreadable`, an empty registry, and a named failure.
- **Post-process the rendered BibTeX to swap in the run's keys.** Rejected: string surgery on a deliverable, correct only while the writer's invented label has the shape it has today.
- **Drop the entries whose keys the writer renames.** Rejected: it would leave citations in the body naming nothing, which is the failure the check exists to catch, not to cause.
- **Write the `.bib` from `citations.json` at read time.** Rejected: the file has to be written once, from the cited sources, or two exports of one run produce different bibliographies.

## Consequences

- **`tests/zotero-live.spec.ts`** (new, cordis) runs the real library through the product's own MCP client and its production provider, self-skipping when Zotero is not answering. Eight cases passed against `ILFASAAE` on 2026-09-18: the collection reads in full and holds the designated item; the source registers at `zotero:user:17529257:UA5MIGG3` with attachment `PU2XWW83` and a page-4 locator; **the corrected pagination call returns page 4 of 10 with the tool's header removed** while the raw reply is kept in the audit record; a page past the end is `passage-out-of-range` and an absent item is refused; the identity is the same at the registration, at the evidence, in the citation key `cite-zotero:user:17529257:UA5MIGG3` and in the `.bib`; the `.bib` is read back by the product's own parser with matching title, year and DOI and carries no local path; all three invalidation axes move independently; and a provider aimed at a dead port reports `endpoint-unreadable` with no fallback.
- **`tests/registered-sources.spec.ts`** (new, team) owns the sentence half, over the registration the live run produced: each mode's selection, the collision rule, an unread sentence refused as `statement-unassessed` rather than inheriting the claim's verdict, a sentence assessed on a passage the source no longer holds refused for that reason, and a rewritten sentence refused for its own.
- **`tests/bibliography-writer.spec.ts`** (new, cordis) is the regression the old spec lacked: the rendered file is read back by `checkBibtexEntry` — the product's own reader — and its key must be the run's. It also pins the escaping case (braces, an ampersand, a percent, a TeX command in the title) and the no-DOI case.
- **What the live acceptance does not do.** Whether a passage establishes a sentence is a reviewer's judgement, and this machine has no model key configured, so `registered-sources.spec.ts` supplies the verdict and says so. The retrieval, the evidence, the binding, the identity chain, the invalidation and the export are all real; the SUPPORT RELATION itself is not yet exercised by a model through this chain.
- **What is wired but not yet demonstrated end to end.** `renderBibliography` is called by the run's export and its refusals stop the export, and `package-export.ts` writes `bibliography.bib` from it — but no case yet drives a whole run to a package and inspects the file on disk. Until one does, the export path is unit-verified rather than integration-verified.

## Files

- `packages/research/dsh-research-core/src/domain/evidence-binding.ts` — `SourceRegistryMode` and `SourceRegistration`.
- `packages/research/dsh-research-team/src/runner/citation-bindings.ts` — `SourceRecord` carries its registry, acquisition and evidence; `sourceRecordOf` and `sourcesForMode`.
- `packages/research/dsh-research-team/src/runner/bibliography.ts` (new) — `BibliographyEntry`, `BibliographyWriter`, `referenceEntriesOf`, `checkBibliography`.
- `packages/research/dsh-research-team/src/runner/package-export.ts` — `renderBibliography` and the `bibliography.bib` file.
- `packages/research/dsh-research-cordis/src/zotero-registration.ts` (new), `src/bibliography-writer.ts` (new), `src/zotero-bibliography.ts` (`configureBibtexLabels`), `src/index.ts` (the library is read once `tools` exists; the sources are published and awaited).
- Specs: `packages/research/dsh-research-cordis/tests/zotero-live.spec.ts`, `tests/zotero-registration.spec.ts`, `tests/bibliography-writer.spec.ts`, `packages/research/dsh-research-team/tests/registered-sources.spec.ts`, `tests/bibliography.spec.ts`.
