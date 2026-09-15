# Agent Note: A run's research is proposed by a model and confirmed by a person

Status: implemented

English | [中文](2026-09-15-a-run-starts-from-a-confirmed-plan.zh.md)

## Problem

Starting a run was one click, and what it would study was a constant in the runner's source. A person could press 运行流水线 and get eight to fifteen minutes of work about a subject nobody had chosen, with the criterion it would be graded against visible only afterwards — in the manuscript, or in a hold whose reason was about a claim they had never seen.

That was tolerable while there was exactly one study. It stopped being tolerable the moment a plan could carry anything else, because the run's whole value is that a person can decide what it is about beforehand.

## Decision

**`@Remote('proposeDirections')` turns a field into confirmable proposals, the client's run control opens a dialog, and `run` starts only the plan a person confirmed.**

- `runner/direction-proposals.ts` owns the wire format (labelled lines, the same convention the pipeline's other prose steps use) and the rule that decides whether a proposal reaches a person: every candidate goes through `prediction-gate.ts`'s `claimRejectionOf`, which is the C channel's own claim-level check. A claim that would stall the run is refused with the GATE's reason rather than offered and then abandoned mid-run.
- The **measured quantity is not the model's to choose.** This run can only measure what its study measures, so it travels into the proposal request and the instruction requires the prediction to name it. A proposal about some other quantity is refused by the binding check.
- **The direction is read, not asked for.** `commitment.direction` comes from the `shall <word>` position — a wire format, not a reading, and the same function the gate uses to verify it. Asking the model to declare it as well would create a field that can contradict the sentence, and a proposal has no declaration to contradict: this is where the declaration is built. The bound and the threshold ARE asked for, and are checked against the sentence.
- `requirePlan` validates a plan at the wire boundary. Everything downstream trusts a plan completely — the manuscript's title, A1's retrieval topic, the claim the C channel grades — so a malformed one would not fail where it entered; it would produce a run whose artifacts disagree with each other. A plan that cannot be used is refused **with its reason**, never replaced by the default.
- The gate's claim-level checks became reachable without a measurement: `evaluatePrediction` was split so `claimRejectionOf` holds them, and `evaluatePrediction` calls it and then measures. A proposal has no study to run, and supplying a fake measurement to reach the checks would make the dialog depend on the half it is trying not to run.
- The dialog composes no sentence about a proposal. Every line it prints is locale copy or the model's own words, and the criterion is rendered from the plan's declared commitment — UI copy is locale-owned, and the number a person confirms has to be the one the run is graded against.

## Alternatives considered

**Ask the model for a whole `StudyPlan` as JSON.** Rejected for the reason the pipeline's other prose steps already rejected JSON: a labelled field is machine-readable by string comparison, and a JSON body fails a step over punctuation that carries no meaning. It also makes every field's absence a parse failure rather than a named gap.

**Let the model choose the metric.** Rejected as a lie about what would happen: the run measures what its study measures, so a proposal naming some other quantity would be accepted here and hold at every gate. The honest version is the instruction saying which quantity the prediction must be about, and the binding check enforcing it.

**Let the model declare the commitment's direction too.** Rejected: it is derivable from the sentence by the same function that verifies it, and a second source for one fact is the defect this batch has already removed twice.

**Fall back to the default plan when a proposal request fails.** Rejected: the run would then be about something the person did not choose, labelled as their choice. The dialog reports the failure and returns to the field step.

**Open the dialog unconditionally and let it fail on a deployment with no prose channel.** Rejected: that deployment would have no way to start a run at all. The run control starts the default directly when the host offers no proposal seam, and the workbench says which path it took.

## Consequences

**A run's first act is a confirmation, and the page can be checked against the host.** The DOM spec asserts the load-bearing property directly: the plan `onRun` receives is the plan the dialog showed. Eight cases cover the field step, the confirmation, the criterion rendered from the commitment, the channel statement, refusals being distinguishable from an empty answer, a failed request starting nothing, cancel, and the no-proposal-seam path.

**Proposals the model could not write are still reported.** An answer whose every block was refused and an answer that proposed nothing are different facts; the answer carries both lists and the dialog states each.

**A plan from the wire is now a validated boundary.** `tests/study-plan.spec.ts` drives ten refusals, including one this found: the metric key was read from the plan's `metric` object through a string-only reader, so every plan was refused as "about ''". The spec caught it on its first run.

**The browser probe failed twice, and both times it was the probe.** The first run reported that the criterion and the proposals were missing; the diagnostic dump showed the dialog sitting in `正在生成方向…`, because the wait keyed on the string `判定标准` — which the dialog's own description contains ("每个方向都带着它的可证伪预测和判定标准"). It returned on its first poll, while the request was still in flight. That is the failure mode the probe's own header calls "the probe failing open": a probe that reads the copy instead of the rendered state. The second run then reported no run at all within its five-minute deadline, while the persisted snapshot showed all sixteen steps passed and E2 approved by the browser operator at about eleven minutes — the run was simply longer than the probe's patience, which was shorter than the deployment's own `stepTimeoutMs` of 900 s. Both waits are now DOM hooks and a budget at least as long as the deployment's.

**The probe's third run is 38/39, and the one failure was another stale assertion.** It drove the whole thing: the dialog opened and nothing ran while it was open, the host proposed a gradeable direction, the criterion rendered (`判定标准:the platoon's minimum time-to-collision (s) 应不低于基线 15%`), confirming started the run, the run finished all sixteen steps, E2 was approved by the browser operator, and the export holds eleven files. The identity check passed EXACTLY — `{"proposed":"The platoon's minimum time-to-collision (s) shall rise by at least 15%.", "matchedExactly":true}` — which is this stage's acceptance: the sentence the dialog showed is the sentence the run states.

The failure was `the page shows the study's platoon composition`, and it was passing on the pack's own claim TEXT (`the HV-AV-HV platoon shall exceed…`), which a run under a person's plan no longer states. It was asserting the pack's claim reaching the page a second time, not that the study's composition is recorded; the composition is in `experiment.json` and `claim-evidence.json`, where this run's export was read by hand and carries it. The check now reads the export. **That rewrite was made after the run and the probe has not executed it** — it is the one assertion in this change whose new form is unverified, and saying so is the point of writing it down.

**The dialog is a modal the workbench renders itself, and a shared one already exists.** `@deepseek-ai/dsh-client-ui-primitives` exports `Modal` — portal to `document.body`, Escape and mask close, design tokens — and `ui-agent-preset`'s copy dialog is the pattern for a two-field form with a `footer` of buttons. This dialog hand-rolls a fixed-position backdrop instead, which means it has no Escape handling and its own colours rather than tokens. The swap is mechanical (add the workspace dependency, replace the backdrop and the footer) and is deferred only because the behaviour this change is about was verified without it; it is recorded here rather than left to be rediscovered, because "there is no modal primitive" would be a false reason to leave it.
