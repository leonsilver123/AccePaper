# Agent Note: The prediction gate is not the study's — the measured quantity is a parameter

Status: implemented

English | [中文](2026-09-15-the-prediction-gate-is-not-the-studys.zh.md)

## Problem

`runner/platoon-sim.ts` held two unrelated things. One is a car-following simulation — the Intelligent Driver Model, a ring buffer for the reaction delay, time-to-collision. The other is the discipline that decides whether a claim can be graded at all: whether its prose names the quantity it declares, whether the anchor and the direction word it wrote agree with the commitment it declared, and whether a negation leaves the sentence's force unreadable. Around six hundred of that file's fifteen hundred lines were the second thing, and none of it was about traffic.

The cost only appeared once the pipeline stopped being a single study. `evaluatePrediction` read a module-level constant for the metric key, a module-level table for the claim's required phrasings, and a module-level label for its evidence strings, and it ran the platoon comparison itself. A study from any other field could not reach the discipline without importing a car-following model, so "the study is whatever the deployment configures" was not reachable by configuration — it needed this split first.

## Decision

**The discipline moves to `runner/prediction-gate.ts` and takes the measured quantity as a parameter.**

- `MeasuredMetric` carries the declared key, the display label, whether a larger value is better, and the phrasings a claim must actually use. The four parallel constants in the study collapse into one `MEASURED_METRIC` object built from it.
- `PredictionMeasurement` replaces the study's `PlatoonComparison` as what the gate grades, and is a **closed pair**: either a comparable result (the relative improvement, plus the study's own naming of its two arms) or a reason there was none. The second variant has no `relativeImprovementPct` field at all, so "nothing to compare" cannot be represented as "no improvement" — the collapse the C channel's fail-closed hold exists to prevent.
- `PredictionGateInput.measure` is a **callback**, not a value. The gate calls it once, after every claim-level check has passed, which preserves the ordering that was already there and already audited: running the comparison first let a colliding study mask all three wording defects.
- The incomparable reason is the **study's** sentence, not the gate's. The gate does not know what a collision is or what the two arms are called, and composing a sentence about a measurement it did not take is the guessing the rest of the module exists to remove.
- The callers (`registry.ts`'s C1 executor, `verdict.ts`'s C gate) pass `measure: () => measureStudy(study)`; the red-team reviewer reads the same helpers and resolves the phrasings with `phrasingsFor(material.metricKey, MEASURED_METRIC)`.

## Alternatives considered

**Keep `evaluatePrediction` where it was and add a thin positional adapter in the study.** Rejected on the repository's pre-release stance: that is a compatibility shim, and the four positional arguments it preserved were the reason the new input is an object — `(predictionText, study, metricKey, commitment)` gave two optional trailing parameters that a caller could only tell apart by counting.

**Pass the measurement as a value rather than a callback.** Rejected, and this is the one that would have been silent: an eagerly computed measurement runs *before* the claim-level checks, so a study that produced nothing comparable would report itself instead of the claim's own defect. The order is documented and was audited; a value cannot preserve it.

**Keep the closed `METRIC_PHRASES` table keyed by metric key.** Rejected as a table, kept as a rule: `phrasingsFor(declaredKey, metric)` returns the metric's phrasings only when the claim declares that metric's key, so a claim bound to some other quantity still gets none — the property the closed table had. Making it a function rather than a record is what lets the metric be a parameter at all.

**Grade the direction word against the improvement sign, as before.** Rejected once the synthetic metric in the new spec case ran: see the consequence below. The old formula was the shipped study's own convention written as if it were the only one.

## Consequences

**A real defect surfaced, and it was a `higher-is-better` assumption.** `inClaimDirection` was computed as `direction === 'increase' ? improvementPct : -improvementPct`. That is correct only when a larger value is better: on a lower-is-better quantity, a claim saying the quantity "shall lower" was graded as asking for the opposite, so a measurement that met it was reported as refuting it. The gate now reads `MeasuredMetric.direction`. The platoon study's behaviour is unchanged — its direction is `higher-is-better`, where the two readings agree — which is exactly why the case that found it had to be a different metric.

**The parameterization is proven at the gate's interface, not end to end.** The second metric is a synthetic latency quantity in `tests/prediction-gate.spec.ts`. That case grades a real claim, a real measurement and a real ungradeable reason through the same code path, but no second study exists in this tree, so "a study from another field reaches this discipline" rests on the interface rather than on a shipped pipeline run.

**The discipline has its own spec file.** The old `tests/platoon-sim.spec.ts` pinned both halves; the 43 cases split by subject into the simulation's file and `tests/prediction-gate.spec.ts`, so a change to the gate no longer reads as a change to the model. The gate's spec gains four cases for the parameterized path, one of which is the direction defect above.

**Every reference was updated rather than re-exported.** `MEASURED_METRIC_KEY` / `_LABEL` / `_DIRECTION` / `_PHRASES` are gone; the ten sites in `registry.ts`, the two in `verdict.ts`, the reviewer, the resume reader and four spec files read `MEASURED_METRIC`'s fields. Nothing in the tree imports a name that no longer exists.
