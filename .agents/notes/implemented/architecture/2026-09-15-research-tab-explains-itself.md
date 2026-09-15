# Agent Note: The research tab says what it is, what to do with it, and what wrote the text

Status: implemented

English | [中文](2026-09-15-research-tab-explains-itself.zh.md)

## Problem

The research tab could not be used by someone who had not read the design documents.

Measured on the page a browser drove before this change: the tab rendered `科研`, a source badge, a `运行流水线` button and nine tab labels. Nothing on it said what a run does, where its products are written, which step it stops at, or that the numbers on screen were a built-in demo snapshot rather than a run. A user's report was that the plugin's use was not understandable at all.

A second, separate defect turned up while answering the first. The wire carries each step's `kind` — the truthfulness level the run recorded for it — and the view read exactly one value out of it (`fixture_executor`, as a degradation note). So a run whose manuscript prose came from the deployment's deterministic offline route was labelled `真实运行` and said nothing about its text, while the manuscript that run exported opened with a notice saying no model was called. The badge and the artifact disagreed, and the page was the one that over-claimed.

## Decision

**The workbench explains itself, and its claims are derived rather than written.**

An orientation block sits above the run control on every render, carrying three things: what the pipeline is (one claim through 16 steps, phases A–E, each step advancing only through the A/B/C judgment trinity, an unjudgeable step ending `abstained`), how to use it (press Run; the run stops at the E2-submit human gate and waits for a decision; the products and their directory are under Summary → Written to disk), and what to do next.

**The next action is derived from the summary** by `selectNextAction` in `panels.ts`, ordered by what blocks the reader: demo data outranks everything, because while the page shows the bundled snapshot there is no run to act on whatever states the demo contains; a failed step outranks a human wait, because a run that stopped on an error is not one a person can approve; a human wait outranks work in flight, because the run cannot leave the gate without a decision.

**The channel that wrote the manuscript's prose is stated, from the run's own records.** `proseChannelOf` in `summary.ts` reads the `executionKind` of the steps whose artifact is manuscript text (D2-framework, D3-writing, D4-rebuttal) and reports `model` / `deterministic` / `fixture` / `unknown`. One `live_external` step makes the run a model run. The step rows carry `executionKind` from the wire's `kind`, which `run-source.ts` now maps instead of discarding.

Before a run the same slot says the page is showing the built-in demo snapshot and that no run has been started in this session. After a run it names the channel instead.

## Alternatives considered

**Ask the deployment for its channel with a second Remote method, so the page can state it before the run.** Rejected: `run` is the namespace's only Remote method, and adding one needs the Typert generator plus a profile reinstall to publish it. It would also be the weaker source — a configured channel is what a deployment *would* use, while the run records what actually RAN, which is the same distinction that made the prose labelling read `channel` off the writer rather than assume it.

**Leave the pre-run state to the `演示数据 (MOCK)` badge.** Rejected: the badge states where the displayed numbers came from, not that nothing has been run. Those are different facts, and the second is the one a person needs to know before pressing a button that drives a 16-step pipeline and writes files.

**Write the orientation copy from the panels' own state instead of adding a block.** Rejected: the panels show state, they do not state the procedure. A run that has not started has no panel that can say what starting it would do.

**Assert the orientation copy verbatim in the browser probe.** Rejected: client copy is locale-owned, so a verbatim assertion pins English (or Chinese) text in a probe. The component publishes `data-research-intro`, `data-research-source-note` and `data-research-next-action`, the probe reads those, and it then checks that the copy covers the topics the requirement names.

## Consequences

**The next-action line is the page's own claim about run state.** It is derived from the same summary the panels render, so it cannot disagree with them, but it is only as right as the recorded step statuses: a step whose recorded status is wrong produces a wrong next action as well as a wrong row. It states nothing the panels do not.

**`proseChannelOf` knows its steps by id.** A build that renames `D2-framework`, `D3-writing` or `D4-rebuttal` reports `unknown` — "this build cannot say" — rather than naming a channel the run never used.

**The orientation block is not part of the exported artifact.** A reader of the manuscript alone still meets the demo notice inside the manuscript; this change is what tells them before they start.
