# Agent Note: A citation is a sentence, not a source

Status: implemented

English | [中文](2026-09-18-a-citation-is-a-sentence-not-a-source.zh.md)

## Problem

The pipeline review of 2026-09-18 reproduced this against the shipped code: **a source cited by two sentences produced one binding, for whichever sentence came first.** `bindJudgements` kept a `Set<string>` of cite keys and skipped any key it had already bound, so the second sentence's citation was never bound at all — and every check that reads bindings then had nothing to read for the rest of the manuscript. A paper citing one source in the introduction and again in the discussion is the normal case, not an edge one.

`checkCitationKeys` had the same conflation from the other side: it refused **any** repeated cite key as `citation-duplicate-key` ("the manuscript cannot name one of them"), which is the right rule for one key minted to two sources and the wrong one for one source cited twice. The two mistakes held each other up — the only reason the key check did not fire on ordinary manuscripts is that the caller passes judgements (one per source) rather than bindings, so it never saw the repeats.

## Decision

- **One binding per citing sentence.** The dedup set is gone; the same key in two sentences is two bindings, each carrying **that sentence's** content version (`statementSha256`), so a rewrite invalidates its own citation and leaves the other alone.
- **Document order within a key.** Bindings sort by cite key, then by the sentence's position in the manuscript, then by content version. Sorting by `statementId` put a discussion before an introduction whenever the alphabet said so, which is a reading nobody does.
- **The other direction is checked too: `citation-statement-unbound`.** A set of bindings can be entirely sound while a sentence that cites a source has none — reachable with nobody doing anything wrong, because that is exactly what the old code produced. `checkStatementBindings` now compares the two sets (cited sentences versus bindings) rather than walking the bindings alone; a swap of two cited sentences is reported as both facts, since each node's text changed *and* each sentence's citation is unbound.
- **`checkCitationKeys` is about source identity.** A key names one source — two sources under one key print one number for two works and a reader cannot tell which a sentence means, which is still refused. Two sentences citing one source is not a collision and no longer reads as one.
- **`uncited` is unchanged in meaning and now correct**: a reviewed source is uncited when **no** sentence names it, not when the first sentence that named it has been recorded.

## Alternatives considered

- **Bind per sentence but keep the key check global.** Refused: the two rules would then disagree about the same manuscript — the binding layer emitting two uses for a key while the key layer refuses the second as a duplicate.
- **Keep one binding per key and re-bind when the sentence changes.** Refused: re-binding is the remedy R05① removed. A judgement is a reading somebody made about a sentence; a second sentence is a second reading, not a repair of the first.
- **Order bindings by statement id.** Refused on the reading, not on the mechanics: ids are `stmt-<section>-<n>` and sort alphabetically by section.

## Consequences

- **Four directions pinned** in `tests/statement-bindings.spec.ts`: one source in two sentences is two bindings with two content versions and a rewrite of the second refuses only the second; a citing sentence with no binding is refused (`citation-statement-unbound`) and accepted once bound; two cited sentences swapped report both the changed text and the unbound citation; deletion stays `citation-statement-missing` (existing case). `tests/citation-bindings.spec.ts` pins both sides of the key rule — two sources under one key refused, one source in two sentences accepted.
- **What this is not.** It does not make the judgement itself a re-derivation: who re-reads is a person or the deployment's reviewer. And it does not close the review's second citation gap — a claim-level support verdict being inherited by a new sentence rather than assessed for it — which is the next unit (`runner/statement-support.ts`).

## Files

- `packages/research/dsh-research-team/src/runner/citation-bindings.ts` (`bindJudgements`, `checkStatementBindings`, `checkCitationKeys`, the new refusal code).
- `packages/research/dsh-research-team/README.md` / `README.zh.md`.
- Specs: `tests/statement-bindings.spec.ts`, `tests/citation-bindings.spec.ts`.
