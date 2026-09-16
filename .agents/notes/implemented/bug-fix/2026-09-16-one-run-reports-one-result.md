# Agent Note: One run reports one result

Status: implemented

English | [中文](2026-09-16-one-run-reports-one-result.zh.md)

## Problem

The study's numbers were recomputed wherever they were needed. The C gate measured the study, `C1-mvp` measured it, `B3-baseline` measured it, `D1-figure-map` built the figure from another comparison, `D3-writing` wrote the prose from a third, `D4-rebuttal` revised against a fourth and `E1-format` rendered the manuscript's table from a fifth.

Nothing compared them, and nothing needed to: `comparePlatoons` is deterministic over the same study, so every recomputation agreed. That is exactly why the arrangement survived review — the numbers matched, so no one looked at whether they came from the same computation. The consequence is a change to the study having to move all of them in step, with the first to drift being the one nobody re-read. Two of those sites are the exhibits the paper is judged on: a figure and a results table that could disagree with the prose beside them and with the verdict it illustrates, while each one's own comment said it could not.

## Decision

`C1-mvp` writes `result-version` (`runner/result-version.ts`, `ResultVersion`): the six measured quantities, the rule version that produced them, the metric the claim binds to, and a SHA-256 over all of it. It is a declared output of `C1-mvp` and a declared input of every step that reports the numbers — `C2-trinity-loop`, `C3-boundary`, `D1-figure-map`, `D3-writing`, `D4-rebuttal`, `E1-format`.

`measureOutcomeWithSource(ctx)` reads that record and returns which of the two it came from. Recomputation cannot be removed from a pure function, so it is made DETECTABLE instead: `D3-writing` records `resultSource` and `resultRef` on `draft`, `D4-rebuttal` on `revised-draft`, and `D1-figure-map` and `E1-format` build their table from the record's numbers directly. A step driven without its producer measures the study itself and says `recomputed`; in a driven run that branch is unreachable, because the record is a declared input and the driver refuses to start a step whose inputs the run does not hold.

`B3-baseline` still measures the study. It runs before `C1-mvp`, so there is no record to read, and establishing the baseline is its job. That is the one remaining measurement, and it is the one that is first by construction.

## Alternatives considered

**Delete the recomputation from every reader and pass the numbers down as parameters.** Rejected: the call graph is wide, and a parameter that reaches four executors is a value nothing records — the failure mode is losing the numbers between steps rather than disagreeing about them. The record is a run artifact, so it is addressable, hashed, persisted, and named by every artifact that used it.

**Compare the recomputed value against the record and refuse a mismatch.** Rejected as the primary mechanism, though it is the strongest form of detection. A refusal can only fire when a step reads the record, so it does nothing for a reader that never asks; `resultSource` records the fact for every reader either way. Comparing also costs a measurement per step, which is the thing being removed.

**Record the numbers instead of the record.** Rejected: the numbers alone cannot say which rule version produced them, so two runs under different `EXPERIMENT_RULE_VERSION`s would compare as equal when they should not. The rule version is in the hash.

**Make `resultSource` required on every artifact rather than on the reporting ones.** Rejected: fifteen steps would carry a field fourteen of them cannot fill. It is on the artifacts whose text states a number.

## Consequences

- `tests/result-version.spec.ts` (11 tests) pins the record's numbers against `mvp-results`, the two prose steps' `resultSource: 'result-version'` and `resultRef` against the record's hash, the declared dependency edges, and the hash's sensitivity to the measurement.
- **The exhibit test has teeth and was measured to have them**: it drives a run to `D1-figure-map`, then hands D1 a study whose two arms are identical — which measures a 0 % change against the record's −38.2 % — and asserts the rendered three-line table carries the record's numbers. Restoring `comparePlatoons(ctx.runCtx.study)` at that site makes the test fail, which is how the assertion was verified rather than assumed.
- A second test drives `D3-writing` on a run holding no record and asserts the driver refuses it, naming `result-version`. That refusal is what makes the `recomputed` branch unreachable by driving, and it is falsifiable: the input declaration is the only thing producing it.
- `result-version` is a new artifact in every package export, and `ARTIFACT_TYPE_BY_SLUG` maps it to its own type. A reader of a package can now see the run's one measured result and the rule version that produced it without reconstructing either from the prose.
- **Three doc blocks that documented nothing were removed from `runner/registry.ts`** while threading the context through: one stale duplicate of `bodyTextFor`'s contract, one whose subject had been renamed, and one my own edit had stacked on top of a live block. `defaultBodySections` and `sectionsOf` now take the step context, which they need to read the record.
- **The record is not a validation.** It states what the run measured; whether those numbers support the claim is the C gate's question, and whether they are correct is nobody's yet.
