# Agent Note: The C gate grades a declared threshold, not a parsed number

Status: implemented

English | [中文](2026-09-14-threshold-declared-not-parsed.zh.md)

## Problem

The C gate decides whether a written prediction was met by an experiment. It graded three inputs, and two of them were declared: `metricKey`, and a `PredictionCommitment` carrying `direction` and `bound`. The third — the threshold, the "20%" in "by at least 20%" — was PARSED out of the prediction's prose. The module's own comment said so: "The gate grades two declared bits plus a parsed number."

A parsed threshold can belong to something else. A sentence states a percentage that attaches to a different quantity, and the gate grades the measured quantity against a number the claim never put on it. An auditor held the declaration byte-identical and changed only the prose number: 5% and 20% graded `supported`, 99% graded `refuted`. Another reached `supported` with `The platoon mean headway shall fall by at least 20% together with the platoon minimum time-to-collision` — the 20% belongs to headway — and with clauses ending `; that outcome is forbidden`. The reachable set is open: `while` is a clause boundary and `whilst`, its synonym, is not; `together with`, `along with`, `as well as`, `plus`, `relative to`, `compared with` and a participial adjunct with no connective at all all evade it.

Four attempts to close that class by narrowing the sentence's accepted shape were measured, and all four died on the same thing — the distinguishing material is predicate structure, and every literal proxy for it is an open class:

- **A wider clause-boundary table.** Unbounded, and it refuses honest sentences too: `The platoon minimum time-to-collision together with the platoon mean headway shall fall by at least 20%` shares one threshold between two subjects and would hold.
- **Requiring the measured phrase before the direction structure.** Refuses `The insertion of one AV shall lower the platoon minimum time-to-collision by at least 20%` — intervention as subject, measured quantity as object, the natural English for an effect claim, and a shape the shipped pack schema accepts.
- **Requiring the measured phrase to be an argument of the predicate.** Needs the compound noun premodifier that precedes it in the shipped prediction, an open class since every pack names its own platoon. And being an argument is not attachment: `The intervention shall lower the platoon minimum time-to-collision thereby reducing the platoon mean headway by at least 20%` satisfies argumenthood and binds its number to the headway.
- **Narrowing to one template.** `The minimum time-to-collision is unaffected though the mean headway shall drop by at least 20%` satisfies the template and still escapes.

## Decision

Declare the threshold. `PredictionCommitment` carries `thresholdPct` alongside `direction` and `bound`, and the verdict is a function of the declaration and the measurement alone. Where the prose put its number no longer decides anything, so the class does not need to be closed — it stops existing.

The prose keeps two jobs. It must state the declared number exactly once — an equality between two values, not a reading of the sentence — and the anchor literal and direction word it carries are still compared to the declaration by string equality. A disagreement holds.

Clause scoping stays, with its claim reduced. `measuringClause` locates the clause the literals are read FROM, because a second clause may legitimately carry its own number or anchor and a whole-sentence read refuses honest sentences that do. It is no longer a claim that a literal inside that clause is ABOUT the quantity, which is what four attempts failed to establish and what the module no longer asserts. A clause that fails to split, and a clause that splits too finely, both stop short of the verdict.

`case-pack.ts` validates the declaration at load and refuses an incomplete one with `CASE_PACK_COMMITMENT_INVALID`: a commitment that is present but missing `thresholdPct` is self-contained malformed material, not an evidence gap, and reading it as absent would hold the run for a reason the pack never stated. An unvalidated threshold was measurable: with `thresholdPct: 0` or a negative value, every movement satisfied an `at-least` claim. Declaring no commitment at all remains legal and leaves the claim ungradeable.

## Alternatives considered

**Record the escape as a known limit and change nothing.** Rejected: the evidence string the gate writes would still say "the measurement supports the prediction" while the number supporting it came from another quantity. That is a false statement the system makes about its own claim-experiment relation, which this repository's premise forbids; narrowing the wording was the fallback if the threshold could not be moved.

**Make the prose carry no number at all, so the class cannot exist.** The stronger form of the same idea, and it deletes the consistency check too. Rejected for a smaller change with the same verdict fix: three downstream consumers read the prose number (`red-stat`, `thresholdLabel`, the prompt), and a threshold absent from the prose has to be supplied to them from the declaration instead.

**Keep narrowing the accepted sentence shape.** Rejected on the four measured attempts above. Every narrowing also costs real sentences, and the cost was measured: the transitive shapes and the shared-subject coordination are honest English that the shipped schema accepts.

**Make the declaration itself verifiable against the sentence.** Not possible: it is the same problem one level up. `subject` verified against prose is the attachment question again, and attachment is what no literal rule could establish.

## Consequences

This is a persistent-format break. `PredictionCommitment` is written onto the claim artifact and read back by the resumption path, and snapshots carrying a two-field commitment resume with the C channel holding. Under the pre-release stance that is allowed, but it is a break rather than a stricter read.

One check leaves the pipeline. The old gate refused sentences whose literals attached to another quantity — as a side effect of the attachment check, not as its purpose, but it was the only thing in the pipeline refusing them. A prediction that misdescribes what was measured now reaches `red-stat`'s `found:` line, the manuscript and the export package unchallenged. Accepted here as a product-level loss, not a gate-level one.
