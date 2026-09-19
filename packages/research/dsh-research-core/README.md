---
description: "The 16-step research state machine, gate adjudication, citation identity chain and run snapshot store, for the adapter that drives a run."
kind: "package-reference"
---

# @deepseek-ai/dsh-research-core

English | [中文](README.zh.md)

## Summary

The state machine behind a research run: 16 steps in five phases, L0 literature tiering, the citation identity chain, A/B/C gate adjudication, and the snapshot store that keeps a run's state durable. It has zero runtime dependencies and zero Cordis — a host supplies the clock, the network, and the inputs to every gate verdict — so the same kernel runs in a test, in a browser-driven deployment, or in a recovery script. Human approval is reachable only through the `./host` subpath, and the public entry point withholds the mutable step singletons and the raw transition verbs. Its premise is that AI-generated scientific claims are untrustworthy, so `abstained` outranks every other outcome and never upgrades to `passed`.

## Table of Contents

- [The state machine](#the-state-machine)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="the-state-machine"></a>
## The state machine

The pure-logic kernel of the AI research-paper production system: the 16-step state machine, L0 literature tiering, the citation identity chain, A/B/C gate adjudication, and the run-state snapshot store. Zero runtime dependencies, zero Cordis, unit-testable in any host.

The design premise is that **AI-generated scientific claims are untrustworthy**, so the state machine turns "recording research judgments without being able to cheat" into constraints: a single forward transitioner, a single gate adjudicator, `abstained` taking highest precedence and never upgradable to `passed`, one-shot replay protection for human approval, rollback cascading to a transitive closure, and snapshots deep-cloned then deep-frozen.

The public entry point deliberately does not export `approveHumanGate` / `transition` / `submitHumanApproval` or the mutable step singletons; human approval is reachable only through the `./host` subpath, and that subpath exposes only the restricted production entry points.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **An artifact names the project revision it was produced under** (2026-09-16): `ArtifactRecord` (and the value-free `ArtifactRecordMeta` a snapshot projects) carry `projectRevision`, written at the commit that published the artifacts and by the one-artifact seam as the run's current revision. **`ref.version` could not stand in for it**: that counts revisions of ONE artifact, so two artifacts from one commit share a project revision while having unrelated version numbers. The field is REQUIRED in the snapshot format — a snapshot without it is refused rather than defaulted, because naming a project revision an artifact may never have belonged to destroys the only fact the field carries. **Three readers consume it**: `runner/package-export.ts` writes it into the export manifest, the Remote projection carries it to the browser, and the workbench names it beside the run — so a reader can tell whether the page and the download describe one state of the study or two. **What is still missing**: nothing reads it PER ARTIFACT yet; the artifact metadata reaches the wire without it.
- **An approval binds a revision, and it used to bind a name** (2026-09-16): `ApprovalRecord` now carries `targetRefs` — the step's inputs, frozen at the moment of the decision from the run's own registry and never taken from the caller — and `approvalStalenessOf` compares them with what the registry holds now, naming the revision that moved. Before this the record held `{run_id, step_id, attempt_id, principalId, approval_event_id, decision, timestamp}` and no content at all, so a person approved the manuscript in front of them and the record said only that attempt N might proceed: a document that moved afterwards was still covered by a decision about a different one. The same file already compared byte-for-byte in `submitGateVerdict`; the approval path compared nothing. **A record written before this restores with no targets**, so its decision binds nothing and cannot be called stale — the behaviour it was made under, rather than targets invented for it.
- **A person is a producer, and the snapshot reader now knows it** (2026-09-17): accepting a candidate publishes the manuscript over E1's with the producer `human-acceptance`, and the snapshot parser's rule — "a producer names a step of the live 16-step pipeline" — refused exactly that value. So a study whose manuscript had been accepted could not be restored at all: every `tryLoad` threw, `listRuns` threw with it, and the page's list of studies came back empty while the acceptance sat on disk claiming to be durable. The rule now allows `ACCEPTANCE_PRODUCER` and nothing else outside the catalogue, which is what it was for: a producer the pipeline never ran is still corruption. **Found by a browser probe, not by a test** — the acceptance's own specs read the manuscript back through the in-memory registry, and the round trip through the file had no coverage until this.
- **A timeout now cancels the executor, and it did not before** (2026-09-16): `runStep` used to end the ATTEMPT on timeout and nothing else — the executor was handed the CALLER's signal, so an attempt that ran out of time could not learn it and kept running, holding a model call, a subprocess or a simulation whose result would be discarded as late. The executor now receives the attempt's own `AbortSignal`, which both the caller's abort and the timeout abort, with the budget stated as the abort reason. The attempt still settles exactly once and a late result is still refused rather than written. **What this does not do**: it does not WAIT for the executor to finish unwinding. A step whose executor ignores its signal still runs to completion in the background; the pipeline reports the timeout and moves on.
- **The commit receipt is not durable** (2026-09-16): `StepState.commit` records which attempt committed, under which idempotency key, and the revisions it produced. `run-persistence` does not carry it, so a restored attempt cannot read its own receipt back. A replay is still refused by the pre-existing `DSH_STEP_ALREADY_EXECUTED` guard, so this cannot become a double commit; persisting it belongs with the checkpoint work that owns the restart path.
- **`recordArtifact` remains a public one-artifact seam** (2026-09-16): the driven path commits through `commitStepOutputs`, but `recordArtifact` is still exported because `ctx.research.recordArtifact` and the recovery fixtures call it. It is not a gate bypass — `submitGateVerdict` requires the attempt's whole declared output set, so a caller writing one artifact at a time cannot pass a step. Collapsing the two is what removes the seam.
- **`aggregateDisposition` now decides a real gate, and the rest of `domain/quality.ts` does not** (2026-09-16): the A channel maps its reviews through `checkDispositionOf` and aggregates them over the roles the round declares, so a required check that did not run BLOCKS a step that `judgeRound` alone would have passed. `GateReport`, `reportAnswers` and `parseGateReportIngress` still have no production caller: a verdict binds by presence and attempt rather than by a minted report.
- `snapshot-store.ts` has no production consumer yet: it provides atomic writes and replay protection, but no runner or team code reads it, so process-level restart recovery for a Session is still unimplemented — the substrate is ready, the wiring is not.
- The state machine records adjudications but does not produce them: the inputs to a gate verdict (L0 tiering, citation verification, the A/B/C channels) are constructed by the caller, and this package touches no network, filesystem, or clock.
- The `ResearchError` base class is also imported by sibling pure-logic modules such as the gate. This is a deliberate near-term arrangement (a shared base class, no runtime cycle); in the long run it should move to a neutral module to decouple further.

No invariant companion is published: this package's cross-module invariants are asserted directly by its own specs, and it ships no `./invariant` entry for one to accompany.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
