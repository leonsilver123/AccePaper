# Agent Note: Derive the C-channel experiment's demand from a measured series

Status: implemented

English | [中文](2026-09-14-measured-demand-profile-for-the-c-experiment.zh.md)

## Problem

The C channel decides whether a falsifiable prediction survived an experiment, and the experiment ran the two control policies against a demand array written into `runner/traffic-sim.ts`: `[[950, 250], [450, 350], [980, 220], …]`. No dataset produced those numbers and no computation connected them to one, so a C verdict was a statement about a demand someone had invented for it. The repository had already acquired two openly-licensed datasets and recorded them in `data/README.md`, but no byte of either reached a calculation.

The comparison had a second defect. Both policies ran against the same fixed cycle and differed only in the green split, so the adaptive policy could win only by splitting differently — and on the study's own profile the split it chose was nearly the split the baseline had already planned. The measurement was real arithmetic over an invented input, and the mechanism it measured was thin.

## Decision

`runner/demand-profile.ts` derives the experiment's demand from a real hourly vehicle-count series. `scripts/derive-demand-profile.mjs` runs that derivation over UCI's Metro Interstate Traffic Volume series (48 204 rows, 1 214 complete calendar days, CC BY 4.0) and writes `runner/study-demand.ts`, which is committed so the pipeline is deterministic on hosts and CI that do not carry the dataset bytes.

The derivation averages the volume per hour-of-day over complete calendar days, cuts the day into six four-hour control intervals, scales the whole curve once so the busiest interval carries the declared design volume, and splits each interval between the two phases by a declared constant. Measured and assumed are recorded separately on the profile: the shape of the day is measured; the scale that maps a multi-lane interstate count onto one two-phase intersection, and the per-phase share, are assumptions the series cannot state. `designTotalVehPerHour()` computes the design volume from the saturation flow, the design cycle and the design degree of saturation rather than naming a number.

The two policies now differ in **which demand they plan from**, not in what they compute. `selectPlan()` is one rule — Webster's optimum cycle inside a declared band, split proportional to observed demand inside declared bounds — and `runFixedTimePolicy` feeds it the design interval's demand once and holds the result, while `runAdaptivePolicy` feeds it each interval's own demand. The comparison is therefore between two control strategies, and the reduction is attributable to adaptivity rather than to two different algorithms.

`tests/traffic-sim.spec.ts` pins the property that makes that attribution valid (both policies select the same plan for the same demand), the mechanism the reduction comes from (the cycle a quiet interval can run), and the falsifiable direction (a perfectly steady profile yields exactly zero). `demand-profile.spec.ts` re-derives the committed profile from the dataset bytes when they are present and fails on a mismatch, so a hand-edit cannot pass unnoticed on a host that carries the series.

Measured outcome on the derived profile: fixed-time 27.28 s/veh against adaptive 24.26 s/veh, an 11.09 % reduction, against a prediction committing to 5 %.

## Admission and ownership

`runner/traffic-sim.ts` owns the experiment: the delay model, the plan-selection rule, the two policies and the verdict. `runner/demand-profile.ts` owns the derivation and is a pure function of the series text — no clock, no randomness, no module-level state. `runner/study-demand.ts` is generated and carries the series SHA-256, so the committed numbers can always be traced back to the measurement they came from. `runner/registry.ts` attaches one shared `demand` evidence block to the C1, B3 and C3 artifacts, so the three cannot describe different inputs.

A dropped row is counted, never defaulted to zero: a zero would enter the diurnal mean as a real quiet hour and lower the profile. A series with no positive hourly volume, an interval count that does not divide 24, a non-positive design volume, or a share outside `(0, 1)` all throw rather than produce a profile.

The experiment remains an analytic Webster model, not a microsimulation. The absolute delay values are model output, not field data; what the measurement establishes is the difference between the two policies inside one model. This bounds the claim's scope and is stated on the artifact and in the package README.

## Alternatives considered

**Reading the series at run time instead of committing the profile.** Rejected: the pipeline's numbers would then depend on whether a host carries the dataset, so the same claim would be adjudicated differently in CI than on a developer machine. Committing a generated module with its input hash keeps the run deterministic while keeping the provenance checkable.

**Deriving the per-phase split from the SUMO krauss signal records.** Rejected on evidence. That dataset describes a four-phase, nine-link junction, not the two-phase intersection the study models, and its recording step length is not published — the ratio of observed displacement to the recorded speed column does not resolve it, so any cycle length read out of it would rest on an assumption presented as a measurement. The phase structure is real but does not transfer.

**Unpickling the dataset's `map_info` geometry to assign vehicles to approaches.** Rejected: it requires executing code embedded in an untrusted external file, which is not a risk worth taking for an input the study does not need.

**Designing the fixed-time baseline at the run's mean demand instead of the design interval.** Rejected: real fixed-time practice designs for the design-hour flow, and a plan built for the mean is infeasible at the peak. The baseline the adaptive policy beats is the one a practitioner would actually install.

## Consequences

`SCENARIO` no longer carries `baselineDelaySeconds`, `variantDelaySeconds` or `reductionRate`. Those literals (10.0 / 9.09 / 0.091) were read by nothing — the executors had already moved to measuring the experiment — so the file advertised numbers no run produced. `SCENARIO.datasetId` now names the measured series, which is what the fallback reference should have named all along.

The package README's real-versus-fixture boundary was stale at five real steps; the registry has eight. Corrected there, along with the new statement that the experiment's demand is measured and its delay model is analytic.

`runner/registry.ts` is now about 2 250 lines and carries four responsibilities. Splitting it remains the identified debt; this change adds to the pressure rather than relieving it.
