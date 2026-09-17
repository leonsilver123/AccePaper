# Agent Note: A metric is declared once, and a run freezes the profile it was conducted under

Status: implemented

English | [中文](2026-09-17-a-metric-is-declared-once-and-a-run-freezes-its-profile.zh.md)

## Problem

The pipeline could already report a number and say which way it moved. What it could not do was say
what the number MEANS, or under which configuration the study that produced it was conducted — and
the paper-quality baseline written just before this found both gaps from the paper's own side.

1. **A metric's direction lived in prose, in records.** `baseline-results` carries
   `metric: { name: <key>, direction: 'higher is better' }`. The key is a real registry key; the
   direction is an English phrase written by the artifact's producer, and the only check on it was a
   substring match (`/higher/iu`). The same quantity also has a direction where it is MEASURED
   (`MEASURED_METRIC.direction`, the enum `higher-is-better`), so the deployment held two
   declarations of one metric with no rule binding them — and nothing anywhere said a metric's unit,
   or which research types it belongs to at all.

2. **Nothing stated what the study WAS.** With one shipped study this was invisible; the moment a
   second research type exists it is the whole configuration. A run could be a simulation study or a
   review of published work, be written for one venue or another, and have `min-ttc-seconds` required
   of it or not part of it at all — and none of that was a field, a record, or a refusal. The
   reachable failure is a run conducted under one configuration and judged under another, which is
   the same defect the frozen plan already prevents for the study's subject.

Both are Q01 of `project-plan/architecture-review-2026-09-15/PLUGIN-PAPER-QUALITY-PLAN-TRC-2026-09-17.md`:
the configuration a paper is produced under has to be a declared, checked, frozen thing before any
of the writing, argument or layout work can be built on it.

## Decision

- **`runner/metrics.ts` declares each metric once.** `MetricDefinition` states the key, the unit,
  which direction is better, what a movement means in one sentence, and the research types it belongs
  to. `checkMetricDeclaration` returns one refusal per disagreement — `metric-unknown`,
  `metric-unit-mismatch`, `metric-direction-mismatch` — naming both sides, and the unit is COMPARED
  and never converted: a study reporting the metric in milliseconds measured a quantity nothing else
  in the deployment can be compared against.
- **The refusal is a production refusal, at the start of the run.** `requireMetricDeclaration` is
  called in `driveOptions` — the one place `startRun` and `runPipeline` both resolve their
  configuration — so a study whose declaration drifted from the registry is refused before the run
  exists. The check is reachable from a deployment rather than only from its own spec: editing
  `MEASURED_METRIC.unit` to `ms` fails twenty-four tests in `tests/start-run.spec.ts` with that
  refusal, and that is how the wiring was verified.
- **`metricsFor(type)` separates required from not-applicable**, and the package manifest carries the
  result as `declaredMetrics`: per metric, its key, unit, direction, interpretation, and whether the
  run's own type required it. It is READ out of the run's frozen spec, never looked up at export
  time, so a package exported after the deployment was reconfigured still describes the study it
  contains. A run that recorded no profile states none, rather than being given the default.
- **`runner/research-profile.ts` is the configuration a run is conducted under.** The research TYPE
  (`simulation-study` | `literature-review`) and the JOURNAL profile are separate facts — a traffic
  metric is not a rule, and a word limit is not a research type. **A journal rule is only a rule if
  somebody read it**: every `JournalRule` carries the `source` it was read from, and
  `resolveResearchProfile` refuses one without it. `TRC_PROFILE` therefore carries no rules at all,
  because the venue's author guide was never obtained; the unverified specifications are listed with
  their status in `project-plan/architecture-review-2026-09-15/TRC-PROFILE-SPEC-CHECKLIST-2026-09-17.md`.
- **Resolution is at the start, and the result is frozen.** An unknown research type is refused at
  the start of the run rather than at the step that happens to read it, and `runSpecOf` writes the
  resolved profile into the run's spec. `hostResearchProfile()` reads the deployment — never a
  request field, because `runPipeline` is reachable from a browser and a caller must not be able to
  change which metrics its own manuscript is judged against.

## Alternatives considered

- **Check the metric declaration at the step that reads it.** Refused: the value is a deployment
  fact, so failing at B3 leaves a run that has already spent steps and left artifacts behind, and the
  deployment learns about its own misconfiguration from a study that half-ran.
- **Refuse an unregistered metric generically and accept any new one as declared by the study.** That
  is what the deployment had before this change, and it is the arrangement the registry exists to
  replace: with the study's own field as the only statement of what a metric means, a direction that
  drifted has nothing to be compared against. A study from another field therefore has to declare its
  metric — which the plan's domain adapter is where that belongs — rather than having the pipeline
  adopt its meaning silently.
- **Resolve the profile at each step that needs it.** Refused: the deployment can be reconfigured
  while a study is under way, which would change which metrics the manuscript is judged against
  halfway through and leave the run's own records describing two configurations.
- **Fill `TRC_PROFILE` with the venue's known-looking requirements.** Refused: the author guide was
  never obtained, so every rule would be a guess enforced on every manuscript, indistinguishable
  downstream from one somebody read. An empty list is the honest state.
- **Give the package's `declaredMetrics` the profile looked up at export time.** Refused: it would
  describe a reconfigured deployment rather than the study in the package, and it is the frozen spec
  that makes the difference observable.

## Consequences

- **The metric check bites from the deployment, and that was verified by counter-check**: editing
  `MEASURED_METRIC.unit` to `ms` fails twenty-four tests in `tests/start-run.spec.ts` with
  `[metric-unit-mismatch] 'min-ttc-seconds' is declared in 'ms' and this deployment defines it in
  's'`, and restoring it returns the suite to green.
- **Nothing reads a metric's interpretation where a sentence is written.** The quality baseline's
  direction-word branch reads the sign of the measurement; only the valence branch ("an improvement")
  reads the direction, and the shipped run's prose states no valence word. A judgement that turns on
  a metric's meaning is therefore not exercised end to end, and that is recorded rather than implied
  to work.
- **One research type is implemented.** `literature-review` resolves, carries `citation-coverage` and
  is frozen into a run's spec — and no pipeline step behaves differently under it: the 16 steps, the
  experiment and the manuscript still run as the simulation study. Its required/not-applicable split
  is therefore a fact about a configuration, not yet about a run.
- **Two `pipeline_only` steps remain fixture-only** (`ARCH-BLOCK-01`), unchanged by this work.
- **The venue profile has no rules.** Any statement that a manuscript "meets TRC requirements" would
  be a claim about a document nobody has read.

## Files

- `packages/research/dsh-research-team/src/runner/metrics.ts` (new),
  `runner/research-profile.ts` (new), `runner/drive.ts` (`runSpecOf` freezes the profile),
  `runner/types.ts` (`DriveOptions.researchProfile`), `index.ts` (`hostResearchProfile`,
  `driveOptions` carries the profile and the metric check, `runPipeline` reads the shared
  resolution instead of hand-listing it), `runner/package-export.ts` (`declaredMetrics`).
- Specs: `tests/metrics.spec.ts`, `tests/research-profile.spec.ts`, `tests/start-run.spec.ts`
  (the frozen profile, its refusal, and the reconfiguration that does not move it),
  `tests/package-export.spec.ts` (the package's declared metrics, both types, and none without a
  profile).
