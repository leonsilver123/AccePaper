# Agent Note: A judgement is about a version of a sentence, not about a slot

Status: implemented

English | [中文](2026-09-17-a-judgement-is-about-a-version.zh.md)

## Problem

`CitationUse.statementId` carried the comment that stated the property this layer needed — "it names the sentence in the manuscript the source is cited FOR, so … a revision that rewrites the sentence can invalidate the citation that supported it" — and the value it was given was the constant `introduction:prior-work`. Every draft of every run bound every source to the same slot. A revision rewrote the text under the slot and the judgement followed it silently: the delivered paper could have carried a literature position asserting the opposite of what the reviewed passages establish, with three citations attached and nothing able to see it.

Two things were wrong and only one of them was the constant. The bindings were also made BEFORE the prose existed — `citationUsesOf({claimRef, statementId})` ran at the top of D3, from the reviewed corpus — so the only thing a binding could name was a slot. "A citation is for a sentence" requires the sentence to exist first.

Wiring a hash of the scanned sentence into the existing binding would not have fixed it. That records the version and still lets the judgement be re-derived from it: scan, hash, compare, and when the sentence moved, re-bind and carry the old support across. The judgement is a reading a person made about a particular sentence and a particular passage, and nothing about a rewrite makes that reading apply to the new text.

## Decision

- **Four things are recorded separately**, because they are four different questions:
  - `Statement.statementId` — the NODE's identity. Minted once, from the section and the sentence's ordinal among CITED sentences, so a rewrite keeps the node and an inserted uncited sentence shifts nothing.
  - `Statement.textSha256` — the CONTENT VERSION of what the node currently says.
  - `CitationUse.quoteSha256` — the EVIDENCE VERSION: the passage the judgement rests on, as the corpus holds it now.
  - `CitationUse.statementSha256` — the content version the judgement was made about.
- **The order changed: judgements first, attachment second.** `judgementsFor(claimRef)` returns what the reviewed corpus establishes, unattached. D3 writes the sections. `locateStatements(sections)` finds where each cited sentence is — LOCATING, not identifying. `bindJudgements(judgements, statements)` attaches each judgement to the statement that cites its source, recording both versions as they stand at that moment.
- **`checkStatementBindings` refuses three ways a judgement outlives what it was about**, and re-binding is not the remedy for any of them: `citation-statement-missing` (the sentence is gone), `citation-statement-changed` (it says something else), `citation-evidence-changed` (the passage is not the one the source now holds). E1 runs it over the REVISED draft, which is where a rebuttal's rewrite lands.
- **A reviewed source no sentence cites is refused at D3** (`citation-source-uncited`), not dropped from the reference list: the list is derived from the bindings, so an omission would make the defect invisible rather than reported.
- **D3 records what each section was asked for** (`proseRequests`, `proseRequestVersion`): the instruction verbatim, the evidence names required and supplied, and the citation roster with the version of each passage. A judgement refused for a changed passage is then traceable to the request that was answered with a sentence resting on it. On the offline path no instruction was sent, and the record says `instruction: null` rather than omitting the field.

## Alternatives considered

- **Hash the located sentence into the existing binding and re-bind on mismatch.** Refused: that is inheritance by another route — the judgement is re-derived from a sentence nobody read, which is the defect.
- **Derive the statement id from the sentence text.** Refused: a rewrite would read as one statement deleted and another created, and a reader comparing two drafts could not see that this node's text changed.
- **Refuse a changed statement at D4 rather than at E1.** Refused as the only place: D4 is one writer of the body, and a hand edit, a recovery or another step's revision reaches E1 without passing through it. E1 is where the body and the bindings are last in hand together.
- **Keep `statementId` a constant and add the versions beside it.** Refused: the id names a slot, so the "which sentence" half of the record would still be a lie.

## Consequences

- **The two directions are pinned**: `tests/statement-bindings.spec.ts` drives a rewritten sentence (refused), a removed sentence (refused), a corrected passage with an untouched manuscript (refused), and the unchanged case (accepted) — plus the request log.
- **The production path refuses it too**: `tests/citation-binding-run.spec.ts` drives E1's executor with a real run's artifacts and one edit to the cited sentence, and the assembly is refused with `citation-statement-changed`.
- **One refusal moved earlier.** A manuscript citing none of its reviewed sources used to reach E1 (the reference list existed whatever the body said); it is now refused at D3. The affected spec was updated to assert the earlier stop and its reason.
- **What this is not.** The judgement itself is still a recorded verdict, not a re-derivation: this layer can say that a judgement no longer applies, and cannot say what the right one is. Who re-reads the sentence is a person or the deployment's reviewer, and the model-visible half of the log lives on the run's artifacts rather than in a session event.

## Files

- `packages/research/dsh-research-team/src/runner/citation-bindings.ts` (`Statement`, `SourceJudgement`, `locateStatements`, `judgementsFor`, `bindJudgements`, `checkStatementBindings`, three new refusal codes), `runner/registry.ts` (D3's order, the request log, E1's check).
- Specs: `tests/statement-bindings.spec.ts` (new), `tests/citation-binding-run.spec.ts`, `tests/citation-bindings.spec.ts`, `tests/runner-registry.spec.ts`.
