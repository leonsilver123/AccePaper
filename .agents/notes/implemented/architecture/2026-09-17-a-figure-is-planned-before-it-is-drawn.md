# Agent Note: A figure is planned before it is drawn, and its values are reconciled with the run

Status: implemented

English | [中文](2026-09-17-a-figure-is-planned-before-it-is-drawn.zh.md)

## Problem

D1 rendered one bar chart with a fixed 320×240 canvas, a fixed title, one series and a fixed seed. Nothing anywhere said what the chart was FOR, so nothing could say whether it answered anything — and Q00's quality baseline found the consequence on the delivered paper: six floats, and no sentence in the manuscript referring to any of them. A float that answers no question is decoration, and decoration nothing cites is what a reader skips.

## Decision

- **`runner/presentation-plan.ts` states what each figure answers.** `PlannedFigure` carries the question, the record slug its values come from, its series as `{key, value}` pairs naming that record's fields, its axes and units, its uncertainty, its own canvas size and format, its caption, and whether the paper needs it — with the justification for that.
- **D1 builds the plan first and hands the renderer its spec**, so the chart a reader gets and the question somebody wrote down are one object. The canvas size is the plan's, per figure, rather than a constant.
- **Source-data reconciliation is a check** (`figure-values-unsourced`): every plotted value must be the value the run recorded under the key the figure names, in the record it names. A drifted record is refused rather than drawn from a literal. A step driven alone has no result record and measures the study itself; the plan names `recomputed-measurement` as its source in that case, so the difference is on the artifact rather than hidden in control flow.
- **The other refusals name the ways a chart claims something the run did not establish**: `figure-no-question`, `figure-sequence-missing` (a sequence axis whose points are not positions in a sequence draws a trend no measurement established), `figure-interval-missing` (a declared interval with no bounds is an uncertainty claim the run did not make), `figure-duplicate-id`.
- **The figure plan is recorded on the artifact** with its version, so a reader of the run can tell what question a float answered and where its numbers came from.

## Alternatives considered

- **Keep the fixed spec and add a caption.** Refused: a caption describing a chart nobody planned is exactly the state the delivered paper is in — the float exists and the paper never uses it.
- **Reconcile against every value the run holds rather than the record the figure names.** Refused: a figure that claims a key from a record it does not name cannot be checked by a reader, and the naming is what makes the reconciliation meaningful.
- **Refuse a figure whose uncertainty is not quantified.** Refused: this study is a deterministic simulation, so it has no sampling interval to draw — the honest state is a figure that says so, not a refusal that would block every deterministic study.

## Consequences

- **A driven run's figure is planned, sourced and drawn at the planned size** — `tests/presentation-plan-run.spec.ts` reads the two artifacts a reader would compare and asserts the plotted values are the recorded ones, and that the SVG is the canvas the plan states.
- **The second task family draws its own figure** from its own record, with a caption that states what its own measurement did to its own claim.
- **What this does not cover.** The renderer is still this repository's own SVG/PNG tool rather than the Matplotlib provider the plan recommends: this host runs Python 3.14 and has no Matplotlib, so no provider needing it is wired, and the figure's typography is the built-in renderer's. Whether a figure is legible, well-scaled and consistent with the prose is the visual review's work (M09) and is not judged here.

## Files

- `packages/research/dsh-research-team/src/runner/presentation-plan.ts` (new), `runner/registry.ts` (D1 builds the plan, reconciles it and renders from it; the artifact carries it).
- Specs: `tests/presentation-plan.spec.ts`, `tests/presentation-plan-run.spec.ts`.
