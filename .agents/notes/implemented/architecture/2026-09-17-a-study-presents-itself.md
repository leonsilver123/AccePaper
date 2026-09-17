# Agent Note: A study presents itself, and the steps that report one stop naming it

Status: implemented

English | [中文](2026-09-17-a-study-presents-itself.zh.md)

## Problem

Four executors knew this deployment's first study by name. `B3-baseline` read `SCENARIO.baselineIdentity` and called `comparePlatons`; `C1-mvp` reported the platoon's own fields (`baselineMinTtcSeconds`, `stringTtcLt1_5RatePct`); `D1-figure-map` built a bar chart of "platoon composition", a table headed "Minimum TTC (s)" and a roadmap whose nodes were a platoon's; `E1-format` assembled a second copy of that table, stated the platoon model's equations and wrote fallback prose about the Intelligent Driver Model. The gates did the same: the A channel's wording checks read every claim against `MEASURED_METRIC` and the C channel graded every claim with `measureStudy(ctx.runCtx.study)`.

The consequence was measurable rather than theoretical. A second study — a single-server queue, milliseconds, lower-is-better, over a sequence rather than two categories — could be declared, planned, simulated and measured, and then stopped at `D1-figure-map`: four executors each needed a branch on which study was running, and four branches per study is how a pipeline comes to describe a study it is not running. The same defect reached the gates, where a latency claim was reviewed against the platoon's phrasings and held, and a latency run's C verdict was computed from a platoon comparison.

## Decision

- **`runner/study-adapter.ts` is one object per study.** `StudyAdapter` carries the executable method, the two arms by name and identity, the producers B3 and C1 stamp, the source the numbers came from, the measurement (record, gate input, rule version and sequence, from ONE execution), the provenance block every experiment artifact attaches, the presentation (figure plan, renderer spec, table, diagram), the boundary C3 ablates, the sentence stating what the measurement did to the claim, and the fallback prose for each outline section.
- **The run context carries it, resolved from the plan.** `createRunContext` resolves it before the first step; `A2-claim` rebuilds it through `setRunStudy` when the Case Pack supplies the study's own scenarios; a resume rebuilds it from the recorded plan. `studyAdapterFor` resolves by the implementation the plan NAMES, falling back to the quantity it declares — which is what keeps A2's intermediate plan (a model-derived claim's metric key is empty, unbindable by construction) conducted as the study the run is configured as.
- **The executors stop naming the study.** B3 takes its arms and its measurement from the adapter; C1 writes the record's own shape (`metricKey`/`unit`/`baseline`/`variant`/`values`) instead of per-study fields; D1 renders whatever presentation the study hands it and reconciles the plan against the run's records; E1 renders the study's own table and equations and writes its own prose; C3 ablates whatever boundary the study declares.
- **A study whose measurement is a sequence is a first-class shape.** `StudySeries` travels inside the result record, `sequencePresentationPlan` plots it over a `sequence` axis with points addressed by position (`series.arms.baseline.3`), and the reconciliation reader indexes arrays by numeric path segment. The content hash covers the sequence, because two records whose arms agree and whose observations differ are two measurements.
- **A study this build can measure but has no adapter for is REFUSED**, not described by the nearest one: `SUPPORTED_IMPLEMENTATIONS` says the code can run it, and an adapter says this pipeline can write the paper about it.
- **The gates resolve the measured quantity from the material.** The A channel's wording checks read `measuredMetricKey` against the registered implementations instead of `MEASURED_METRIC`; the C channel takes the metric and the measurement from the run's adapter. Both were wrong for every run that was not the platoon study.

## Alternatives considered

- **Branch on the study inside each executor.** Refused: four branches per study, no single place stating what a study IS, and the next study adds four more.
- **Make the adapter an optional field with a platoon default.** Refused: a run whose plan names another study would silently be presented as the platoon's, which is the defect this replaces.
- **Resolve the adapter on demand in every executor.** Refused: `studyAdapterFor` builds a fresh adapter whose `measure()` runs the study again, which is exactly the recomputation `result-version.ts` exists to remove. The adapter memoizes one execution per instance, and the context carries that instance.
- **Keep the second study's ablation platoon-shaped and refuse C3 for it.** Refused, though it was the smaller change: a study that cannot be driven through its own boundary probe is a study the pipeline cannot finish, and "runs a second study" would then be false at the last third of the pipeline.

## Consequences

- **The queueing study runs all 16 steps and stops at the human gate** — `tests/second-study-run.spec.ts` drives it and asserts its own metric, unit, direction, arms, sequence, table, equations, prose and boundary, and that no platoon vocabulary reaches any of them.
- **Four defects the generalization exposed, each a real one.** A `0.9` load factor in the fallback prose is a number the run never declared, and the number check refused it. A D4 revision patch and an E1 table note carried platoon sentences into any study's manuscript. The verdict's `evaluator` line named the platoon module for every run. The A channel's wording checks had no phrasings for any claim but the platoon's.
- **What this does not cover.** `SCENARIO.venueName`/`venueId` are still deployment constants read by A1/A4/E1. The retrieval adapter is still the synthetic corpus. The figure renderer is still this repository's own tool rather than the scientific plotting provider the plan recommends. `A3-agenda`'s claim-and-evidence text remains platoon-flavoured fixture prose.
- **The research tree carries 158 pre-existing `oxlint` errors** in `dsh-research-cordis` and `dsh-research-web`, none in the files this unit changed.

## Files

- `packages/research/dsh-research-team/src/runner/study-adapter.ts` (new), `runner/service-latency-sim.ts` (parameterized trace and coalescing, module ablations, boundary regimes), `runner/result-version.ts` (`StudySeries`, `resultVersionFrom`), `runner/presentation-plan.ts` (`sequencePresentationPlan`, positional record paths), `runner/study-plan.ts` (`LATENCY_PLAN`), `runner/registry.ts`, `runner/verdict.ts`, `runner/redteam-review.ts`, `runner/drive.ts`, `src/index.ts`.
- Specs: `tests/second-study-run.spec.ts` (new), plus updates to `tests/runner-registry.spec.ts`, `tests/result-version.spec.ts`, `tests/scientific-credibility.spec.ts`, `tests/presentation-plan-run.spec.ts`, `tests/verdict-fail-closed.spec.ts`, `tests/e2e/happy-path-t19b.spec.ts`.
