# Agent Note: The method section is the code that ran

Status: implemented

English | [中文](2026-09-16-the-method-section-is-the-code-that-ran.zh.md)

## Problem

`B1-method` asked the model for a method FAMILY and wrote the answer onto `method-spec`. That answer is what the manuscript's Method section renders. One recorded fixture response says `reinforcement-learning phase-plan policy`.

Every number downstream comes from `runner/platoon-sim.ts`, which integrates intelligent-driver-model trajectories. No code compared the two, so a paper could describe one experiment and report another. The Method section was the only place in the pipeline where free text carried weight: everywhere else a value is derived, checked, or measured, and here the most load-bearing sentence in the manuscript was whatever a model happened to write.

The same defect had a second face in the study plan. `DEFAULT_PLAN.claim.essentialDifference` read `control policy is adaptive (RL) rather than fixed-time`, and the manuscript's statement of what the two arms differ in is derived from it. Both halves were false: the car-following is IDM in both arms, and the baseline is a homogeneous platoon rather than a fixed-time signal plan.

## Decision

The algorithm, its parameters, the factors the two arms differ in, the equations, and the artifact the implementation fills are DECLARED by an implementation record (`runner/implementations.ts`, `MethodImplementation`), and every field is read out of the simulation module's own constants — `SIMULATION_INPUTS`, `DECLARED_VEHICLE_CLASSES`, `MODEL_EQUATIONS`, `EXPERIMENT_RULE_VERSION`. There is no second copy to keep in step, which is the only reason a hand-written method section stays true.

`StudyPlan.implementationId` names the implementation, and `requirePlan` (`runner/study-plan.ts`) refuses a plan naming one this runner does not have. `SUPPORTED_IMPLEMENTATIONS` holds exactly one entry, and "supported" is a claim about this process: the runner can execute it and measure its outputs. A study needing a different implementation has no runner, and the honest outcome is to say so rather than to describe it and measure something else.

What the model keeps is what it can legitimately contribute — the procedure steps and the metric's direction. Its FAMILY answer is recorded as `modelDeclaredFamily` on `method-spec` so a reader can see the model said one thing and the code did another, and it reaches the manuscript nowhere.

`DEFAULT_PLAN.claim.essentialDifference` now states the four parameters `DECLARED_VEHICLE_CLASSES` actually varies: the autonomous vehicle follows with a 0.15 s reaction delay, a 1.2 s desired headway and a 0.15 s look-ahead horizon, against the human 1.2 s delay, 2.0 s headway and no look-ahead.

## Alternatives considered

**Compare the model's answer against the implementation and refuse a mismatch.** Rejected. It leaves the algorithm as model output and makes correctness depend on a string comparison over prose a model wrote — a neighbouring answer that happens to contain the right words passes, and a right answer phrased differently fails. Deriving the text removes the disagreement instead of detecting it.

**Ask the model for the parameters too, and validate them against the simulation.** Rejected for the same reason at a worse ratio: the parameters are the one part of a method section a reader may check against the code, so they must come from the code.

**Keep `family` model-authored and record the derived algorithm beside it.** Rejected: the manuscript renders `family`, so the model would still write the Method section.

**Delete the model step from `B1-method` entirely.** Rejected as too much for this change. The procedure steps and the metric direction are genuine contributions, and B1's prose channel is also what makes the step's truthfulness tier honest.

## Consequences

- `tests/method-implementation.spec.ts` (12 tests) pins the derivation: `parameters` deep-equals `SIMULATION_INPUTS`, `varied` matches `DECLARED_VEHICLE_CLASSES`, `equations` equals `MODEL_EQUATIONS`, `version` is `EXPERIMENT_RULE_VERSION`, `family` is the implementation's algorithm, the model's own answer cannot reach `family`, and a plan naming an unknown implementation is refused at the boundary with the available id in the reason.
- The essential-difference test asserts the plan no longer matches `/RL|reinforcement/i` or `/fixed-time/i` and does contain both reaction delays. That assertion exists because the false text reached a manuscript.
- A study plan now has to name an implementation to be executable. `resolveImplementation` refuses a plan naming none, so the requirement is enforceable rather than conventional.
- **B1 cannot be driven end to end while a writer is injected**, so the model path is exercised by `b1-method-derivation.spec.ts` and the derivation by the spec above. The two are separate because a derivation test that also ran the model would be reporting the model's behaviour as the derivation's.
- The runner still has one implementation. A second study from another field cannot run until a second implementation is declared, which is the same limit `runner/prediction-gate.ts` records for its measured-quantity parameter.
