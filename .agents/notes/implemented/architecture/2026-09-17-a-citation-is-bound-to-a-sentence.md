# Agent Note: A citation is bound to a sentence, and the reference list to the citations

Status: implemented

English | [中文](2026-09-17-a-citation-is-bound-to-a-sentence.zh.md)

## Problem

The delivered paper has twenty-five real DOIs in its reference list and a body that cites none of them. Every part of that works: the retrieval returns records, the formatter formats them, the manuscript prints them. Nothing binds a sentence to a source, so nothing can tell a reference list from a search log — and the twenty-five entries were the search log, because `buildReferences` turned every record the landscape scan returned into an entry. The three works the run had actually read and judged were not even guaranteed to be in the list.

Q00's quality baseline found it from the paper's side (`no-literature-position`, on a manuscript that carries two references and cites neither). Q02 is the module that makes it impossible: a citation is a claim about one sentence, and it only means something if somebody read the passage behind it.

## Decision

- **`runner/citation-bindings.ts` records what a citation claims.** `CitationUse` carries the statement, the source, a stable `citeKey`, the location the passage was read at, the passage and a SHA-256 over it, the support relationship, how much of the source was read, and who judged it. `citeKeyOf` mints the key from the IDENTIFIER (`cite-<id>`): a key assembled from an author and a year collides for two works in one year, and one assembled from a title moves when the title is corrected.
- **The refusals are the module's point.** `checkCitationUse` refuses a binding with no passage (or one that quotes the source rather than the passage), one whose support is stronger than what was read (`abstract-only` cannot establish what only the method shows), a retracted source, a cited source the deployment holds no record of, and a support judgement about a source that could not be read at all — which is a different fact from a source that does not support the statement, and is recorded as itself. `checkCitationKeys` refuses two citations under one key.
- **The reference list is derived from the citations.** `bibliographyOf(citations, sources)` is what D3 puts in the draft, and `buildReferences` is deleted. The retrieval keeps its place as the library a study draws from — the package still ships the ledger — but an entry appears in the reference list because a sentence cites it.
- **`checkManuscriptCitations` refuses the three ways a paper cites nothing while looking like it cites something**, at E1, where the body and the reference list are both in hand before the manuscript becomes an artifact: a key the body cites that the list does not carry (`citation-target-missing`), an entry no sentence cites (`citation-entry-uncited`), and a cited source the run holds no reviewed judgement about (`citation-unreviewed-source`, which is exactly what citing one of the retrieval hits is).
- **The writer is told what it may cite and how.** D3 hands it `citations` (key, what the source establishes, how much was read, where it was read) and the instruction names the marker `[@citeKey]`. E1 prints each marker as the number the reference list assigns — the same array, the same order, so the number and the entry cannot drift. D4 carries the bindings forward, because a revision that dropped them would turn every correct citation into an unreviewed one and stop the run at assembly.

## Alternatives considered

- **Keep the retrieval-derived reference list and add the citations on top.** Refused: it is the state that produced the delivered paper. A list that is a superset of what the paper cites cannot be checked against the paper, and every entry nobody cites reads as a source the work rests on.
- **Check the citations at the A gate (`manuscript-review`) instead of at E1.** The A gate has the manuscript and a reference COUNT, not the entries: its citation check compares a label against an index range, so it can see `[7]` in a five-entry list and cannot see a five-entry list nothing cites. E1 is the first place both halves exist.
- **Make the writer cite, and let the reference list follow the body.** That is `bibliographyOf` run the other way round, and it would make `citation-entry-uncited` unreachable — the list would be computed from the citations and could never disagree with them. The check has to be able to fire, and the failure it protects against (a model that states a literature position and cites nothing) is real: it is what the run's own test drives.
- **Require a `statementId` the manuscript mints per sentence.** Deferred, not refused: it needs the section contracts M04 builds, and until they exist the statement a citation is made for is the slot the reviewed judgements actually answer (`introduction:prior-work`).

## Consequences

- **The defect is refused, and the refusal is a repo-owned test.** `tests/citation-binding-run.spec.ts` drives a run whose Introduction states the literature position and cites nothing: E1 reports `citation-entry-uncited`, the step stays `in_progress`, and `formatted-manuscript` does not exist. A second case drives a model that cites a key the corpus does not hold and gets `citation-target-missing` and `citation-unreviewed-source` together.
- **A shipped run now cites.** `npm test`-level reading of the same run's package: the body carries `[1] [2] [3]`, the reference list carries exactly three entries, and `citations.json` separates the retrieval ledger from the citations, each with its passage.
- **Q00's `no-literature-position` finding is gone from this run's package**, because the sentence that states the literature position now cites the sources it rests on. The other finding Q00 raised (six floats nothing refers to) is untouched: that is Q03/Q04's work.
- **What this does not cover.** Only the deployment's reviewed corpus can be cited, so the literature position rests on three sources a person read; `missingSourceFields` reports `locator` as absent for all of them, because the corpus records no volume, page or article number, and a run cannot cite a field nobody recorded; and the statement id is a fixed slot rather than a sentence the manuscript names.

## Files

- `packages/research/dsh-research-team/src/runner/citation-bindings.ts` (new), `runner/registry.ts` (`buildReferences` deleted, `referenceEntriesFor`, `priorWorkSentence`, D3's bindings and writer context, D4 carrying `citations`, E1's numbering and refusal), `runner/package-export.ts` (`citations` beside the ledger in `citations.json`).
- Specs: `tests/citation-bindings.spec.ts`, `tests/citation-binding-run.spec.ts`, `tests/d4-model-revision.spec.ts` (the D3 reply now cites what the request lists, which is the writer contract it was already standing in for).
