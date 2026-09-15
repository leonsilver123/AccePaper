# Agent Note: The study is the run's data, not the runner's source

Status: implemented

English | [中文](2026-09-15-the-study-is-the-runs-data.zh.md)

## Problem

The runner carried its research as module constants. A claim id, a reference sentence, a prediction, a metric key, a section skeleton and a default heading table lived in `runner/registry.ts`; A1 retrieved literature for the literal topic `'adaptive traffic signal control'`; A2 started from a fixture assertion, a fixture difference, a fixture falsifying experiment and a fixture prediction. A run could therefore only ever produce one paper, and no deployment or person could say otherwise.

The literals had also drifted, in a way the file recorded about itself: the study the pipeline measured is platoon car-following while the topic A1 searched was signal control, so a run's retrieval corpus, its venue match and its method section were about a subject its only measurement was not. `drive.ts` seeded a `domain-direction` run input that no step read, while the topic A1 actually used was a literal beside it.

That the constants were reachable at all was only because this pipeline has one study. Making the pipeline able to carry a second one — a field, a direction, an outline and a threshold that a person confirms — requires the study to stop being source.

## Decision

**A `StudyPlan` in `runner/study-plan.ts` is the run's research, and the run context carries one.**

- The plan holds the manuscript title, the field, the retrieval direction, the section skeleton, the claim (id, reference sentence, assertion, essential difference, falsifying experiment, prediction) and the measured quantity, with the declared commitment.
- `RunContext.studyPlan` is seeded by `createRunContext` and refined **in place** by A2 once a Case Pack or a model has supplied a claim, so the steps after A2 read the plan the run is actually committed to rather than the one it started with.
- `DriveOptions.studyPlan` states one; `DriveOptions.domainDirection` replaces the default's direction only, because that value is also the seeded `domain-direction` input and the two must not be able to disagree.
- A1's retrieval topic is `plan.direction`. **The default plan's direction is the study's own subject**, not the signal-control literal: a run whose literature is about a different subject than its measurement is the inconsistency above, and with one home for the value it cannot recur.
- `DEFAULT_HEADING` is deleted. It restated `plan.outline`'s headings, so a plan that renamed a section would have kept the old name.
- Every `proseWriter.write` request spreads `planContextOf(plan)` — field and direction — into its `context`. The steps already handed the writer the claim and the prediction; what none handed it was the research the run is about.
- `SCENARIO` keeps only what no plan chooses: the two platoon compositions, the fallback venue, and the dataset file. It is the measurement apparatus's naming.

## Alternatives considered

**Add a plan field for every constant, including `wantsExperiment` and the scenario spec.** Rejected on the repository's own rule that an abstraction needs a current consumer: nothing branches on an experiment switch yet, and the scenarios come from a run input the plan does not own. Both land with the executor that reads them.

**Keep `CANONICAL_*` as the fallbacks and let a plan override them.** Rejected as the shape the defect already had: two homes for one fact is what let the retrieval topic drift from the study. The constants are gone and `CANONICAL` is derived from `DEFAULT_PLAN`.

**Give `SCENARIO.title` to the plan but leave the venue and the compositions.** That is what shipped, but as a decision rather than an omission: a title is the paper's and a composition is the apparatus's, and only the first is something a person would choose.

**Persist the plan now.** Rejected for this change and recorded as a limitation instead. The claim half is rebuilt on resume from artifacts the run already records; the title, field, direction and outline are not in any artifact. Persisting a plan belongs with the change that lets a person supply one, because only then can a plan differ from the deployment's default and only then does a resume's fallback become visible as a wrong paper.

## Consequences

**A run can now be about something else, and the machinery that would let it is a default plan away.** The four new cases in `tests/runner-registry.spec.ts` drive A1, A2 and D2 with a plan whose field, direction, title and section names are all different, and assert the artifacts carry them — plus the guard that the default plan still reproduces the fixture claim every other case in that file drives.

**A1's retrieval topic changed for every existing run.** The default plan's direction is `mixed platoon car-following with an autonomous vehicle` where the literal was `adaptive traffic signal control`. The mock adapter is topic-independent, so no artifact's content changed; what changed is that the topic is now derived from the study rather than stated beside it.

**Two hand-built run contexts in the specs gained a `studyPlan`.** `tests/a3-agenda-derivation.spec.ts` and `tests/runner-registry.spec.ts` construct `RunContext` literals rather than calling `createRunContext`; a required field is what makes such a literal fail loudly instead of silently taking a default.

**The shipped app was driven end to end and still passes.** `.workbuddy/tmp/verify-browser-b.mjs` — an independent browser probe that boots the `web` profile, opens the token URL in Chrome and cross-checks the page against the backend — reports **31/31**, the same count as before this change. It ran against the built and installed tree whose content is commit `8a25e587` plus this change, and no source file was edited between the build and the run. The probe's own precondition is that the installed copy equals the build under test; a stale install fails it rather than verifying the wrong code.

**The prose channel now sees the field and the direction.** This is a model-visible change: a request that previously carried only the claim and the prediction now carries two more fields. It required no session event, because the request is constructed inside the step rather than read from the log.
