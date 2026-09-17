# Agent Note: The gate reads what the paper carries — its floats, and its title

Status: implemented

English | [中文](2026-09-17-the-gate-reads-what-the-paper-carries.zh.md)

## Problem

Two defects of the delivered paper survived every check the pipeline had, because no check looked at them.

1. **Six floats nothing refers to.** Figure 1, Figure 2, Table 1 and three equations, and no sentence in the manuscript names any of them. `red-citation` checked the other direction — a label the prose cites that no float carries — so a float nobody cited was invisible.
2. **A title that claims the finding the study refuted.** The delivered title is `Raising Minimum Time-to-Collision in Three-Vehicle Platoons via V2V-Enabled Adaptive Inter-Vehicle Gap Control`, above a manuscript reporting that the quantity FELL by 38.2%. The gate graded the sections and never read the one sentence every reader reads first.

Both are the same shape: the rules were written against the manuscript's body, and the paper's headline and its objects are outside it.

## Decision

- **`red-citation` refuses a draft that carries a float its prose never names.** A draft that carries a float has decided the float belongs; a draft whose prose never names it has not used it. The rule reads the roster the review is handed (`floatLabels`) against the labels the sections mention, and names what it found.
- **`red-claim` refuses a title that asserts a direction the measurement contradicts.** The title reaches the review off the MANUSCRIPT artifact (not off the plan), so a title rewritten mid-flight is graded on what it says. The rule reads a declared vocabulary of direction words in both directions, and a title that claims no direction — `Inserting One Autonomous Vehicle Changes a Platoon Minimum Time-to-Collision`, which is what the truth looks like when the measurement went against the claim — passes.
- **The pipeline's own output passes both**, which is the other half of the unit: the fixture prose now names the floats it carries (the Results section points at the figure and the table, the Method section at the equations it states), so the shipped run and the second task assemble manuscripts that survive the rules they would otherwise be refused by.
- **The quality baseline reads both citation syntaxes.** A draft carries `[@citeKey]` and E1 prints `[1]`; a rule that knew only the second reported this run's Introduction as citing nothing — two findings against a paper that cites three sources.

## Alternatives considered

- **Report an uncited float as a warning rather than a refusal.** Refused: the plan's own checklist makes it machine-decidable and the delivered paper is what the warning looks like after four audit rounds. A pipeline that carries floats nobody uses should stop, not annotate.
- **Check the title at E1 instead of at the gate.** Refused: the gate is where a manuscript the run has already written is judged, and the title is one of its sentences. E1 already refuses the citations and the argument obligations.
- **Read the title off the study plan rather than off the artifact.** Refused: the delivered run's title came from the model route and differs from the plan's; grading the plan's title would grade a sentence the paper does not carry.
- **Require the equations to be cited at the gate too.** Not now: the equations are appended to the Method section by E1, after the sections the gate reviews, so the gate's roster cannot see them. The baseline sees the assembled manuscript and reports them, which is where that belongs.

## Consequences

- **Both refusals are on the production path**, and both are reachable in a driven run: a writer whose prose names no float blocks D3, and the delivered paper's title blocks the claim role.
- **`qualityFindings` is empty for the shipped run and for the second task** — the same baseline that reported six unreferenced objects and no literature position on this pipeline's earlier output now reports nothing, on both a run whose claim was refuted and one whose claim was supported.
- **What this does not cover.** The title rule reads direction words, not meaning: a title asserting a finding in words outside the declared vocabulary passes, and whether a title is *good* takes a reader. The uncited-float rule covers the roster the gate holds — figures, the table and the diagram — and not the equations, which E1 appends after the gate has run.

## Files

- `packages/research/dsh-research-team/src/runner/manuscript-review.ts` (both rules), `src/runner/verdict.ts` (the title reaches the review), `src/runner/paper-quality.ts` (both citation syntaxes), `src/runner/registry.ts` (the fixture prose names its floats).
- Specs: `tests/manuscript-review.spec.ts` (both directions of both rules), and the writers in `tests/d4-model-revision.spec.ts`, `tests/citation-binding-run.spec.ts` and `tests/argument-plan-run.spec.ts` now name the floats their prose carries, because the gate refuses a draft that does not.
