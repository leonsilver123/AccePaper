# Agent Note: The parser that could not say what it threw away

Status: implemented

English | [中文](2026-09-16-the-parser-that-could-not-say-what-it-threw-away.zh.md)

## Problem

`D4-rebuttal` reads a model's reply into `RevisionIssue` values and hands them to the Issue → Patch → Verify cycle. Every test of that cycle built its issues in TypeScript, so the cycle was covered and the parser was not — and an offline probe of it found three silent failure modes:

- `PATCH: NONE` and a `PATCH` line that is not there at all produced the same value. The applier reads that value as "the author answered the concern without changing the text", so a reply that simply did not follow the format was recorded as `accepted_explanation` and the step PASSED. The comment beside the code claimed the two were distinguishable. They were not;
- an exchange missing its `SECTION` was `return`ed out of the accumulator. A reply with three exchanges of which two were malformed produced ONE issue, `openIssues` was empty, and nothing in the run recorded that two thirds of the reply had been discarded;
- `PATCH:` with nothing after it fell into the same branch as a missing line, for the same reason as the first.

The reply each of these was measured against was one this repository wrote. What the parser could not do is refuse anything.

## Decision

The parser is its own module (`runner/issue-parse.ts`) and it can say what it discarded.

`parseReply` returns `{ issues, discarded }`. An exchange that opened but did not complete is recorded in `discarded` with its 1-based position, its `CONCERN` text and the labels it lacks — so a reader can find the block in the reply, and a count travels with the artifact. It distinguishes three patch states rather than two: `replacement`, `declared-none` (`PATCH: NONE`, a conclusion and a legitimate one) and `missing` (no `PATCH` line — NOT an acceptance).

`assertWellFormed` turns a report into a refusal. A reply whose exchanges are incomplete fails the step with the number of incomplete exchanges, their positions and the labels they lack; a reply with no `CONCERN` at all fails too, because a rebuttal with no exchange answers nothing.

The empty-value case is why the label reader returns `''` rather than `undefined`: an empty value counts as STATED and empty, which is what tells `PATCH:` apart from no `PATCH` line. That distinction is the whole point of the value and it is now in one place.

## Alternatives considered

**Keep the parser inline and add the `discarded` array to its return.** Rejected: the executor's job is to bind issues to the version they were written against and to write the artifact, and the text-to-issues step has its own contract and its own failure vocabulary. The split is also what makes the failure testable without driving a run.

**Throw inside the parser at the first malformed exchange.** Rejected: a reply that malformed two of its three exchanges should say so in one message. The step's next attempt gets all of it, and the artifact keeps the count even down the path where a caller chooses to continue.

**Read a missing `PATCH` as `declared-none` and let the applier decide.** This is the silent default under a different name. The applier cannot see the reply, so it cannot tell a deliberate `NONE` from an omission; deciding there is the same defect moved one layer down.

**Interpret a prose reply into exchanges.** Rejected, and worth stating: a parser that guesses which sentence is a concern will guess wrong on exactly the replies that matter, and every guess closes an issue. A reply that does not follow the format is refused, and the step's failure names what was expected.

## Consequences

- `tests/d4-model-revision.spec.ts` drives D3 and D4 through a writer that answers each step in that step's format. The well-formed fixture is the reply the browser run actually produced — three exchanges, all three patched, three sections revised and four not; the malformed one omits a `SECTION`.
- The applier's measurement is inverted rather than asserted: the sections whose bodies CHANGED are exactly the patched ones, and no section claims `revised` without a diff. The two lists are compared as sorted sets, because `patchedSections` follows the order the reply raised its issues and the draft's sections follow the outline — comparing them in one order would assert a coincidence.
- A malformed reply leaves the step `in_progress` with an `executeError` naming the exchange, and the run produces no `revised-draft` and no `formatted-manuscript`. Nothing downstream is built from a reply the pipeline could not read.
- The step's reply format is now a contract with a refusal behind it. A model that answers in prose fails the step; it is not silently credited with having answered.
