# Agent Note: A section owes its reader an argument, and a refutation has to be reported as one

Status: implemented

English | [中文](2026-09-17-a-section-owes-its-reader-an-argument.zh.md)

## Problem

The shipped run REFUTED its own claim — the platoon minimum time-to-collision fell 38.2% where the claim predicted a rise of at least 20% — and no section of the manuscript it produced says so. Every section reports the measurement, the Conclusion reports it again, and the paper reads as though the study found what it hoped for. The pipeline knew what each section could be written FROM, and nothing about what each section had to SAY.

Q02 made the manuscript cite its sources. This is the other half of the same defect: a paper can cite correctly and still not report what it found. Q00's baseline found the shape of it from the paper's side — six floats nothing refers to, no literature position — and this unit is the module that makes the reporting obligation a refusal rather than an omission.

## Decision

- **`runner/argument-plan.ts` states what each section OWES.** `SectionContract` carries the section's JOB (what it has to establish for the paper's argument, not what it is titled), the evidence without which it cannot be written, and its obligations. `ArgumentPlan` is derived from the run: the question, the claim, and `claimOutcomeOf(measuredPct, committedDirection, thresholdPct)`.
- **An outcome is three facts, and a refutation is stated as one.** When the measurement moved against what the claim committed to, the sections that report it are obliged to state the measured change, the direction in words, AND that the measurement contradicts the claim — three obligations rather than one, because a section carrying `-38.20%` and nothing else tells a reader who skims nothing about what happened to the claim. `supported` and `indeterminate` are different outcomes and a different obligation set: a measurement that moved the committed way but fell short of the declared threshold is NOT a support.
- **The plan is derived from the run, never configured.** The same deterministic study under the second task's claim — the same −38.2%, a claim that committed to a decrease — is `supported`, and its sections owe a direction instead of a contradiction. A plan written for one paper would oblige the other's sections to say the opposite of what happened.
- **E1 refuses a manuscript whose sections did not discharge what they owe** (`argument-obligation-unmet`, naming the section and the obligation), one that omits a section the plan declares (`argument-section-missing`), and one carrying a section the plan never declared (`argument-section-undeclared`). A draft that carries sections and no plan is refused too: there is nothing to judge them against.
- **The plan travels with the draft** (`ARGUMENT_PLAN_VERSION`), is carried through D4, and is what E1 judges the revised draft against — a revision is judged against the plan it was written under, not against one recomputed at assembly.
- **The section's evidence requirements moved onto its contract**, so a section's requirements and its obligations are one entry rather than two tables that can drift. `section-evidence.ts` reads them from the contract and reports what is missing.

## Alternatives considered

- **Judge the obligations in the A gate (`manuscript-review`) rather than at E1.** The A gate reviews the manuscript for the red-team roles and its verdicts decide a step; the obligations are a property of the writing contract, and E1 is where the assembled manuscript exists as the artifact every later step reads. The gate wiring belongs with M09 (`Q06`).
- **Check the obligations where the sections are written (D3) and stop there.** Refused: a revision replaces section bodies, so a draft that satisfied its contract can be revised into one that does not — and the revision is written by D4, which would then have to duplicate the check. E1 sees both drafts.
- **Oblige every section to state the outcome.** Refused: it would refuse a Method section for not quoting a number it has no business quoting, and a pipeline that refuses often is one nobody runs.
- **Guess at the obligations that take a reader** (an alternative explanation, a stated limitation) with a rule over the prose. Refused: those are on the contract as statements and not as checks, because a rule that guessed at them would be a rule about wording rather than about the argument.

## Consequences

- **The defect is refused on the production path.** `tests/argument-plan-run.spec.ts` drives a run whose writer answers every step in its format and writes sections that never state the measurement: E1 reports `argument-obligation-unmet` naming the Results section and its obligation, the step stays `in_progress`, and no manuscript is published.
- **The shipped run now reports its own refutation.** Its abstract, results and conclusion each state the 38.2% change, that the quantity fell, and that the measurement contradicts the claim — read off the run's own draft in the same spec.
- **The second task family is the control**, and it is on the production path: the decrease pack's claim is supported by the same measurement, its sections owe a direction rather than a contradiction, and the manuscript it assembles says the change is what the claim predicted.
- **What this does not cover.** The obligations that take a reader — the Discussion's alternative explanation, the Conclusion's stated limitation — are recorded on the contract and never judged. A draft records the plan it was written under and the evidence each section was supplied, but not the instructions themselves: the writer's request is not a logged session event, so which skill or prompt assembled it is not reconstructable from the log yet.

## Files

- `packages/research/dsh-research-team/src/runner/argument-plan.ts` (new), `runner/section-evidence.ts` (requirements read from the contract), `runner/registry.ts` (D3 builds the plan and asks for the section's job and obligations, D4 carries it, E1 judges it; the reporting fixture bodies state the outcome).
- Specs: `tests/argument-plan.spec.ts`, `tests/argument-plan-run.spec.ts`, `tests/d4-model-revision.spec.ts` (its D3 replies and its results patch now discharge the contract, because a revision is not a way to drop an obligation).
