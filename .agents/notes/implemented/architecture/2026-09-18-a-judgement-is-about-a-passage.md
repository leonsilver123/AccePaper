# Agent Note: a judgement is about a passage, and three axes were carrying each other's meaning

Status: implemented

English | [中文](2026-09-18-a-judgement-is-about-a-passage.zh.md)

## Problem

The review of this pipeline's evidence handling asked for four things to be modelled separately — where a source came from, how it was obtained, what review it has had, and which words a judgement was about — and none of the four existed as a field. Each was being inferred from another:

- **"Checked into the repository" was read as "verified."** `CorpusSource` recorded `sourceAccess` and a free-text `note` saying the excerpt was retrieved by hand, and nothing recorded that a hand retrieval is a way of OBTAINING a source rather than a statement about it. The inference runs the other way too: a source read from a running library was implicitly the less certain kind, though a catalogue record and a checked-in excerpt are both `literature` and neither is checked.
- **A review was attached to a DOI.** `SupportAssessment` named its source by `sourceDoi` and its claim by `claimRefHash`, so a judgement was bound to a claim VERSION — correctly — and to a work, not to the words it was actually made from. Editing an excerpt left every judgement about it standing, and a work with two attachments or two passages had one review that spoke for both.
- **Nothing recorded where in a source the evidence was.** `SourceRecord.locator` holds what the source stated about its own volume and pages; where the REVIEWER read is a different fact, and it was not recorded anywhere. A quotation could not be checked against a place.

The three facts the guidance named as participating in invalidation — the source's own version, the attachment's version, and the content's hash — had no single record to live in, and no comparison that used them.

## Decision

- **Three axes, each stating only itself.** `SourceRegistry` (`zotero` | `curated`), `SourceAcquisition` (`live-library-read` | `retrieved-then-checked-in`) and `ReviewStatus` (`unreviewed` | `human-reviewed`) join `sourceClass` and `sourceAccess` on `Provenance`, and `admitAsEvidence` reads none of them. A spec asserts that the same class and access admit alike from either registry, that a review moves nothing, and that no axis rescues a class that may not carry a gate at all — the axes cannot be a back door to admission.
- **One binding record, not six fields on six objects.** `EvidenceBinding` holds the registry's identity, the source's version, the attachment and its version, the locator, the content hash, the route and the rule version. Six facts spread across whichever objects carry them are six facts no reader can combine and no comparison is obliged to use.
- **The identity is the registry's, never the DOI.** A DOI names a work; a work has several attachments, several passages and several readings, and a review is of one of them. The curated corpus chooses to key its records by DOI — a fact about that corpus, recorded in its own identity string `curated:<doi>` — and a registry with item keys mints `zotero:<library>:<key>` instead.
- **Every axis participates, and none implies another.** `evidenceStalenessOf` compares all six and reports WHICH moved, so "the source was edited" and "the file was replaced" are different answers. The guidance is explicit that an attachment change need not move its parent item, so a check watching only the source record would see nothing.
- **A review carries the binding it was made from, as a literal.** `SupportAssessment.evidence` is written out rather than looked up at read time. Recomputing it from the current corpus entry would make every judgement current by construction, which is precisely the state the field ends.
- **A judgement whose evidence moved is dropped, and named.** `assessmentsFor` returns only current judgements; `staleAssessmentsFor` says which dropped and what moved. Dropping rather than re-pointing is the point: re-pointing would carry a review to a passage nobody read. A run whose only anchor drops out has no anchor, which is the correct end — the claim is unsupported until somebody reads the current text.
- **A source the corpus no longer holds is not stale.** It is uncomparable, and the judgement is neither dropped nor reported as changed, because calling it changed would send a reader to re-read a source that is not there.

## Alternatives considered

- **Key the evidence by DOI and accept that passages share a review.** Rejected: it is the overwrite the guidance names, and it fails silently — the second passage inherits an approval nobody gave it.
- **Recompute each judgement's binding from the corpus on every read.** Rejected: it can never detect a change, because it defines the current state as the judgement's own. The check would always pass and the field would look like a guarantee.
- **Make `assessmentsFor` throw when a judgement is stale.** Rejected: a stale judgement is data about what happened, and a run that has lost an anchor needs to report that rather than crash. The B channel already treats a missing anchor as a hold.
- **Add the axes to `admitAsEvidence` so a reviewed source ranks higher.** Rejected: they are not ranks. A review is a statement about specific content, which is why it travels as a binding; making it promote a source would let one reviewed passage certify a work.

## Consequences

- **`tests/domain/evidence-binding.spec.ts`** (new, 10 cases) owns the separation: recognition of each vocabulary, the registry-agnostic and review-agnostic admissions, each axis moving alone, gaining or losing an attachment as a move of the same axis, and a change of identity reported as a different source rather than a stale reading.
- **`tests/reviewed-evidence.spec.ts`** gained four cases: every recorded judgement is currently consistent with the corpus — so an edited excerpt fails a test rather than silently inheriting a review — a judgement whose hash moved is dropped and `content` alone is named, a source the corpus no longer holds is uncomparable rather than stale, and two passages of one DOI are separated by the locator rather than by prose beside it.
- **`corpusProvenance` now publishes all three axes**, so a delivered artifact says where its evidence came from, that a run did not re-fetch it, and that a hand review exists — three separate statements, none of which is a trust level.
- **What this does not do.** No live library source is registered into the citation registry yet: `reviewedSources()` still reads only the checked-in corpus, so a Zotero-read source can appear in the run's ledger and cannot yet be cited. Wiring that registration, and the `.bib` export that follows from the same citations, is the next unit — and until it lands, "one identity across sentence, citation and bibliography" is asserted nowhere end to end.

## Files

- `packages/research/dsh-research-core/src/domain/evidence-binding.ts` (new) — the three axes, `EvidenceBinding`, `EvidenceAxis`, `EvidenceStaleness`, `evidenceStalenessOf`.
- `packages/research/dsh-research-core/src/domain/provenance.ts` — the three optional axes, with the header stating that `admitAsEvidence` reads none of them.
- `packages/research/dsh-research-core/src/index.ts` — both re-exported.
- `packages/research/dsh-research-team/src/runner/evidence-corpus.ts` — `SupportAssessment.evidence` frozen per judgement, `corpusBindingOf`, `assessmentStalenessOf`, `currentAssessments`, `staleAmong`, and the three provenance axes on `corpusProvenance`.
- Specs: `packages/research/dsh-research-core/tests/domain/evidence-binding.spec.ts` (new), `packages/research/dsh-research-team/tests/reviewed-evidence.spec.ts`.
