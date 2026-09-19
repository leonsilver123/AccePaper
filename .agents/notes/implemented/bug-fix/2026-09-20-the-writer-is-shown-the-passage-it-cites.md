# Agent Note: The writer is shown the passage it is asked to cite

Status: implemented

English | [中文](2026-09-20-the-writer-is-shown-the-passage-it-cites.zh.md)

## Problem

A driven run stopped at `D3-writing`, and it stopped there on every attempt, with:

```
[D3-writing] [statement-beyond-scope] 'stmt-abstract-1' cites 'cite-10.1109/tits.2026.3727135',
which was assessed 'partial': The passage establishes the reaction-time-as-first-order-lag finding
and the critical lag above which no safe CCC gains exist, but says nothing about a vehicle
responding to connected vehicles farther ahead braking earlier and increasing distance.
```

The prose writer's instruction said "A sentence that cites a source states what that source establishes and nothing further". It could not obey: the request never showed it what a source says. `d3Executor` built the citation roster as cite key, verdict (`establishes`), `readScope` and location — and dropped `quote`, the passage the judgement was made from, along with `access`. The model wrote the sentence that seemed right, attached the citation, and the sentence assessor — which DOES read the passage — refused it. The gate was working. The writer was set up to fail.

The refusal it produced is the evidence that the material was never in the request rather than in the prompt wording. The sentence the assessor rejected concerns "a vehicle responding to connected vehicles farther ahead braking earlier and increasing distance", and that finding is not in the excerpt: it is in the reviewer's `rationale` for that source, which says more than the passage does. A writer holding the verdict and not the words had nothing to distinguish what the passage states from what was recorded about the source.

This is the second time D3 stopped on this step for a citation the writer could not have known was wrong. The earlier run was refused for stating an inference the passage never draws, and the remedy then was a clause in the instruction — "state only what that source establishes and nothing further" — with no change to what the request carried. That moved the constraint into the prompt without moving the evidence into the request, so the next run failed the same way with a different sentence.

## Decision

- **The citation roster carries the passage.** `citableSources` in `d3Executor` now holds `passage`, `access` and `establishes` beside `citeKey`, `readScope` and `source`, so the roster travelling to the model as request DATA under `citations` contains the words the judgement was made from.
- **`passageOf` hands over the passage or refuses.** The new export in `citation-bindings.ts` returns a judgement's `quote` after checking that its SHA-256 is the judgement's own `quoteSha256`, and otherwise throws `citation-passage-version-mismatch`. The version already travelled with the citation, and a later `citation-evidence-changed` refusal points back at it; a passage that was truncated, re-wrapped or read from elsewhere would leave that version describing text nobody was shown.
- **The instruction states the scope rule in the terms the rule decides in.** It now names `full-text` and `abstract-only` and `access`, and says what each bounds: a source read at `abstract-only` may carry a sentence saying what an abstract reports and not what only the source's method, experiment or results could establish, and a source whose `access` is not `read` is evidence for no sentence. That is `checkCitationUse`'s `citation-support-beyond-scope` and `citation-source-unavailable`, in the two literal values it uses, rather than a paraphrase a writer has to interpret.
- **Both prose paths record the same request citations.** `requestCitationsOf` writes one entry per source — `citeKey`, `passage`, `evidenceVersion` — for the fixture path and the model path alike. The fixture path calls no model and records `instruction: null`, which says the writer was asked nothing; it does not mean the writer was shown less, and its record now carries the passage the adapter's own prose was written from.
- **`PROSE_REQUEST_VERSION` is `prose-request-v3`.** The instruction is model-visible text and the record's shape changed, so a reader comparing two runs has to be able to tell which they hold.
- **No gate moved.** The sentence assessor, `checkCitationUse`, `checkStatementSupport` and the refusal codes are untouched. The change adds material to a request and adds an assertion that the material and its version agree; nothing about what is refused changed.

## Alternatives considered

- **Hand the writer the reviewer's `rationale` or `scope` instead of the passage.** Refused: the rationale says more than the passage does, which is precisely how the run under repair failed. The frozen rationale for `cite-10.1109/tits.2026.3727135` names the companion finding the excerpt does not contain, so sending it would ask the writer to state what the corpus RECORDED about the source rather than what the source establishes — and the assessor would refuse it again, correctly.
- **Truncate the passage to a token budget.** Refused: it breaks the agreement the version exists for. The binding layer already bounds a quote at `MAX_QUOTE_LENGTH` (2000 characters) and refuses a longer one as `citation-no-passage`, so any passage that reaches a writer has already been bounded where the judgement was made.
- **Say "do not overclaim" without naming the scope values.** Refused: `checkCitationUse` decides with `full-text`, `abstract-only` and `access`, and a constraint stated in different words than the rule is judged by is the arrangement that failed twice. The instruction names the same three facts the rule reads.
- **Drop `establishes` and let the passage speak for itself.** Refused: two of the three shipped judgements are `contradicted`, and a writer that is not told the passage bears against the claim can only cite it as support — which is the refusal `statement-contradicted` exists to make.
- **Compute the version from the text being sent, instead of sending the judgement's own `quoteSha256`.** Refused: `checkCitationUse` and `checkStatementBindings` compare the version a record carries against the judgement's, so a version minted at the request would be a second reading of one passage and the request would stop matching the judgement it recorded. The check belongs on the way out, not a new arithmetic.

## Consequences

- **Measured on the deployment, 2026-09-20.** A driven run over `H:/dsh-boot-t30r` reached `D3-writing` (12 of 16) and was still refused. The refusal is no longer the one this note is about. On `cite-10.1109/tits.2026.3727135` the assessor now answers that "The passage confirms the first-order-lag representation, its detrimental effect on safety, and the critical lag value above which safe CCC gains do not exist" and refuses the sentence for a different reason: it "was read in arXiv:2409.06884v1 rather than in the cited work, so the sentence's attribution of those findings to cite-10.1109/tits.2026.3727135 is not established". Two further sentences were refused as `statement-beyond-scope` for stating an absence the passage cannot establish and for a comparative clause about this paper's own simulator. The writer was shown the passage: the request's `citations` entry carried the excerpt verbatim beside `establishes`, `readScope`, `access` and `source`, and the sessions on disk hold that text as sent.
- **What the measurement does not settle.** The substance objection is gone and the surviving refusals are about what a QUOTED passage can establish — an attribution, an absence, a comparison — rather than about a writer that had nothing to read. Whether the preprint-versus-DOI objection would refuse a sentence written from a full read of the published article is not something this run answers, and the record holds the fact that would settle it (`CorpusSource.accessNote`) without that fact reaching the writer. Neither remaining refusal was chased: the assessor is right about what it was given, and a change that argued it out of its verdict would be a change to the gate rather than to the request.
- **A request that carries the passages is larger.** Three shipped sources add roughly 700 characters of passage to each D3 request, and both the request text and the artifact record grow by that much. The corpus is bounded by `MAX_QUOTE_LENGTH` where the judgements are made, so the growth is bounded with it.
- **A corpus whose excerpt and hash disagree now stops a run at D3.** `passageOf` refuses a judgement whose passage does not hash to its recorded version, and this is a new failure mode on a path where nothing previously read the two fields against each other: every existing check compares a version against another version. `statement-bindings.spec.ts` asserts the agreement over the whole shipped `EVIDENCE_CORPUS`, so the refusal cannot fire on the shipped path, and it fires exactly where it should — a corpus that corrected its words and kept its hash would otherwise hand a writer text the request's version does not describe.
- **The fixture prose path records the passage without gaining an instruction.** Its `instruction` stays `null`, because no model is called; a reader comparing a fixture request against a model request sees the same evidence and no prompt.

## Files

- `packages/research/dsh-research-team/src/runner/citation-bindings.ts` — `passageOf`.
- `packages/research/dsh-research-team/src/runner/registry.ts` — the citation roster, `requestCitationsOf`, the D3 instruction, `PROSE_REQUEST_VERSION`.
- `packages/research/dsh-research-team/tests/statement-bindings.spec.ts`, `tests/citation-binding-run.spec.ts` — the passage in the recorded request, the version that hashes to it, and the instruction's scope clause.
