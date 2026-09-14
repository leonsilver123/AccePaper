# Agent Note: The C gate compared a claim to a number it was never about

Status: implemented

English | [中文](2026-09-14-c-gate-could-not-tell-what-it-was-measuring.zh.md)

## Problem

The C channel adjudicates a claim's falsifiable prediction against the study's own experiment. It read the threshold as **the first percentage in the prediction's prose** and the evidence as the measured delay reduction:

```
thresholdFromPrediction(text)   // first /(\d+(\.\d+)?)\s*%/ in the text
evaluatePrediction(...)         // comparePolicies(scenario).relativeReductionPct
```

Nothing checked that the percentage and the measurement were **about the same quantity**. They were not, on the shipped path. The Case Pack's claim commits to a reduction in a platoon's TTC<1.5s collision-risk rate; the experiment measures demand-weighted mean vehicle delay. The gate reported

```
C: outcome=failed (live experiment: measured 11.09% vs required 20%)
rationale: experiment (live) refutes the falsifiable prediction
```

which reads as a refutation and is not one: 11.09% is a delay reduction, 20% is a risk threshold, and no experiment tested the claim.

**The defect runs both ways, and the false-pass direction is the dangerous one.** An independent audit (AUDIT-S #1) replaced only the claim with one about the platoon string-instability index — a quantity this study never measures — at ">=5%", and **all sixteen steps passed to E2**. An untested claim was reported as supported, by a system whose entire purpose is to refuse exactly that. In the other direction, the honest-looking A2 stop was contingent on 20 being above 11.09: a claim whose stated number happened to fall the other side would have been graded rather than held.

This was found by an independent auditor, not by the tests, and it corrected a claim this repository had already written down as "the system working".

## Decision

**The experiment declares what it measures, and a claim binds to it by declaring the same key.**

`traffic-sim.ts` publishes `MEASURED_METRIC_KEY = 'mean-delay-seconds-per-vehicle'` and its display label. `evaluatePrediction(predictionText, scenario, metricKey)` now returns a discriminated result:

- `{ kind: 'adjudicated', … }` — the claim declared the measured key AND states a numeric threshold. The comparison runs as before.
- `{ kind: 'unbindable', reason }` — the claim declared no metric, declared a different one, or stated no threshold. **Nothing is graded.**

`'unbindable'` produces a **hold, not a failure**: the C channel takes the same fail-closed path it already had for a threshold-less prediction, and the evidence names the two quantities. "This study cannot test that claim" is not "that claim failed", and reporting it as a failure would be the same category error in the other direction.

`A2-claim` carries the key: the Case Pack's claim supplies one if it declares it, a model-derived claim supplies none (its response format has no field for one — widening that format is a separate change), and the fixture claim declares the measured key because its own text names mean delay. Both artifacts record `metricKey` and `measuredMetricKey`, so a reader can check the binding without reading the runner.

## Also fixed in the same commit

**A `gate_abstained` hold was driven past.** The driver's stop rule was `status !== 'passed' && status !== 'gated'`, which treats every `gated` step as "stop and return". Only E2 is that; on any other step `gated` is a hold that cannot be released, and driving on made the next step's `canStart` guard throw `A3-agenda cannot start — dependency order violated` — reporting the consequence and hiding the hold, which is the same defect `runT19B` was fixed for earlier. The outcome's own `kind` distinguishes them (`humanGate` only for the human gate), and both drivers now stop on a hold.

## Admission and ownership

The metric key is experiment-owned: the study is what knows what it measures, and a claim cannot declare its way into being measurable. `RunContext` carries it because A2 is what reads the claim and the C gate is what reads the context — the same one-hop the prediction text already took.

`CANONICAL_PREDICTION` and its threshold were **not** changed. They were already about mean delay; they now declare it. (That the threshold is 5% rather than 8% is pre-existing, and the approval spec's header now discloses it — AUDIT-S #4.)

## Alternatives considered

**Name the measured quantity inside the evidence string only.** Rejected, and the auditor said so explicitly: it makes the report honest and leaves the false-pass path open.

**Match the quantity by keyword against the prediction's prose.** Rejected: it binds by vocabulary, so a claim that mentions "delay" anywhere would bind however it is actually about, and a claim about delay phrased without that word would not.

**Fail the step instead of holding it.** Rejected: an unbindable claim is not a refuted one, and §8 forbids turning an inability to adjudicate into a verdict.

**Require the Case Pack to declare a metric (editing the pack).** Rejected: six of the pack's files are covered by its manifest's `hashOfInputs` and the generator is not in this tree, so editing them would falsify fixture data. The shipped pack declares none, which now holds — the honest outcome for a claim this study cannot test.

## Consequences

- The false-pass path is closed: the auditor's counterexample (string-instability index at >=5%) now holds with `the claim is about "platoon-string-stability-index" while this study measures "mean-delay-seconds-per-vehicle"`.
- The shipped Case Pack run now ends in a HOLD at A2 rather than a reported refutation, and it no longer throws a dependency error on the way out.
- The legitimate path is intact: the fixture claim declares the measured key, and a run still reaches `E2-submit` `gated` in sixteen steps.
- A regression test asserts the unbindable case at the `evaluatePrediction` level, and the acceptance commands add two real-boot probes — one that must hold, one that must still reach E2.
