# Agent Note: The Case Pack drives the run, and the run stops when its own evidence refutes it

Status: implemented

English | [中文](2026-09-14-case-pack-drives-the-run.zh.md)

## Problem

`plan/overnight/2026-09-09/case-pack-traffic/` holds seven versioned JSON files describing a traffic research case: the question, the central claim, the deterministic experiment's configuration and rows, the ablation and boundary configs, the citation ledger, and a reproducibility manifest. **Nothing in the repository read them.** A run was driven by `domain-direction` plus constants compiled into the executor registry, so the pipeline's own claim was manufactured in `a2Executor` rather than taken from the case it was supposedly running.

Two further defects sat in the way, both found by running rather than reading:

- `setRunInput` accepts only slugs on core's `SEEDABLE_INPUTS` allowlist, which held exactly one entry. Seeding a pack-derived slug failed the run with `DSH_INPUT_NOT_SEEDABLE`.
- The step-input reader resolved `getInput(slug)` to `getArtifact(...)` only. A run-seeded input was therefore invisible to the step that declared it — the pack reached `setRunInput` and nothing downstream could see it. The runner already distinguishes the two sources in its own vocabulary (`InputSource = 'run-seed' | 'upstream-artifact'`); the reader consulted one of them.

## Decision

A **versioned loader** (`dsh-research-team/src/runner/case-pack.ts`) reads all seven files or none: a missing file, malformed JSON, an incomplete provenance envelope, or a `schemaVersion` other than `case-pack-traffic.v1` refuses the load with a stable code. Keys the loader does not read are preserved, so a richer pack loses nothing.

It derives **run inputs** rather than injecting results: the question, the claim, the scenario parameters, and the experiment, ablation, boundary and citation files each travel as their own input, every value carrying the `file#pointer` it came from. `CASE_PACK_SEED_INPUTS` in core names the slugs next to the allowlist that guards them; a spec asserts every slug the loader declares is accepted by the engine, so the two homes cannot drift silently.

The **pack's directory is a deployment setting**, carried on `ResearchEngine` as `casePackDirectory` and read by the runner-side service. It is deliberately not a request field: `runPipeline` is exposed as a Remote method, and a client-supplied path would let a browser name a filesystem location. The engine only carries the value — the loader lives in `dsh-research-team`, because dependencies run `core` ← `tools` ← {`cordis`, `team`} and `cordis` must not reach into `team`.

`a2Executor` now prefers the pack's claim over the model. The pack is what the run was started with; deriving a different claim from a model would make the run's product disagree with its own input set. The artifact records which of the three sources supplied it (`case-pack` / `model` / `fixture`).

**Provenance is read per source file, not per pack.** The shipped pack is not uniform: `mock-experiment.json`, `ablation.json` and `boundary-counterexample.json` are `truthfulness: mock` with `provenance: synthetic_deterministic`, while the question and claim files are `direct_fixture`. The first version of the loader stamped `case-pack.json`'s envelope onto every derived value, which would have attributed a synthetic result to the wrong source. A spec pins each slug's label to its own file.

## The result, on a real boot

A1-landscape passes. A2-claim **executes successfully** with the pack's claim, passes the A channel, and **fails the C channel**:

```
C: outcome=failed (live experiment: measured 11.09% vs required 20%)
rationale: experiment (live) refutes the falsifiable prediction
```

This is the system working. The pack's claim commits to a ≥20% reduction in car-following risk; the study's own experiment — a Webster delay model on the measured UCI demand profile — measures 11.09%. The gate refuses to pass a claim its own measurement refutes, and the run stops there rather than continuing on an unsupported claim.

## What this exposes, and what it does not fix

**The shipped pack and the runner's experiment are different studies.** The pack describes a car-following platoon study (TTC<1.5s rate, reaction delays, platoon composition); the experiment the pipeline runs measures intersection delay. The pack is internally consistent — its own `mock-experiment.json` shows a 35.7% reduction and passes its own `claimConsistency` check — but that is the pack's generator's measurement, not this study's.

So an offline run cannot reach E2 on this pack, and it must not be made to by loosening the gate. The next increment is to let a pack-driven run adjudicate against **the pack's own rows** — computing the comparison from `mock-experiment.json`'s measurements, labelled `mock`/`synthetic_deterministic` — so the claim and the measurement belong to the same study. Reaching E2 by relaxing the C channel is not an option, and reaching it by editing the pack's numbers is not one either: the pack's six input files are covered by the manifest's `hashOfInputs` and the generator that wrote them is not in this tree.

## Admission and ownership

The loader owns reading and labelling; it does not decide anything about a run. `runT19B` seeds what it is handed, before the first step, because `setRunInput` refuses a run already under way. `ResearchEngine` carries the deployment's choice of pack; `ResearchTeamService` reads it and loads it.

`pack.assertedHashOfInputs` is reported as **the pack's own assertion, never verified**. The generator named in the manifest (`case-pack-traffic.fixture-writer/v1`) is not part of this repository, and no scheme tried reproduces the value from the file bytes. The loader records what it actually computed — a per-file SHA-256 — and the two are never conflated.

## Alternatives considered

**Inject the pack's pre-computed results as step products.** Rejected: it would make a run a replay of canned numbers, and the executors would stop being the thing that produces the artifacts.

**Let the client name the pack directory.** Rejected: `runPipeline` is a Remote method, so that is a path-traversal surface handed to a browser.

**Author the missing `essentialDifference` claim field into the pack.** Rejected: the pack's six input files are covered by its manifest hash and their generator is absent, so editing them would falsify fixture data. The loader restates it from the pack's own `baselineConfig.controller` and `mockExperimentConfig.adaptiveController`, recording both pointers.

**Weaken the C gate so the pack's claim passes.** Rejected outright — that is the one thing this subsystem exists to prevent.

## Consequences

- A run is reproducible from a selected, versioned input set, and a changed pack parameter reaches the run: a spec asserts a changed question changes the derived input.
- An incomplete pack stops the run loudly (`CASE_PACK_DATUM_MISSING`) rather than continuing with a hole in the claim.
- An offline run currently ends at A2 with a scientific reason, not an infrastructure one. That is the correct stopping point until the pack's own experiment is what a pack-driven run adjudicates against.
