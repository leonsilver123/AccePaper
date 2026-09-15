# Agent Note: A restart drives the run it was running, from a graph the steps actually read

Status: implemented

English | [中文](2026-09-16-a-restart-drives-the-run-it-was-running.zh.md)

## Problem

Three findings from the architecture review (`project-plan/architecture-review-2026-09-15/`) share one theme: the engine's picture of a run was not the run.

**A resumed run was not the run that stopped** (J04). `resumeRunPipeline` rebuilt the cross-step context from the artifacts the run had recorded — the claim, the prediction, the metric key — and took everything else from the plan and config the RESUMING deployment supplies. The plan's title, field, retrieval direction and section skeleton are in no artifact, so a resume after a deployment changed its plan wrote a manuscript about a study its own gates had not graded. The per-step budget was not carried either: a run driven through a model route resumed under the registry's offline budget recorded `timeout` on its first long step.

**A run saved only when it finished** (J03). `runPipeline` called `recordRun` once, after `runT19B` returned. A process that died mid-run lost every step it had completed, including the ones that cost model calls. The snapshot store's own lock and revision guard cannot compensate for a checkpoint that never happened.

**Two executors read inputs their definitions did not declare** (J06). `D2-framework` read `method-spec`; `E1-format` read `paper-outline`. A step's declared `inputs` ARE the engine's dependency graph — `canStart` reads them to decide what may run, and `rollback` walks them to decide what a re-run invalidates — so an undeclared read is a real dependency nothing can see. Re-running the method derivation did not invalidate the framework derived from it.

## Decision

**The run records the configuration it was resolved against, and a restart reads that record.**

`setRunSpec(store, runId, spec)` stores an opaque record on the run, under the same freeze as the run's inputs: it is refused once any step has started, because a plan that changed under a running study describes a run that never happened. Core does not interpret the record. `runT19B` writes `{ studyPlan, planSource, evidenceProfile, stepTimeoutMs }` into it before the first step, and `resumeRunPipeline` reads it back — validating the plan through `requirePlan`, the same check a plan arriving off the wire gets, and falling back to the deployment's own plan only when the record carries none.

The claim half is still overlaid from the artifacts afterwards, and deliberately: the artifacts are the authority for what the gates actually graded, so a run whose claim was re-derived mid-flight cannot end up with gates that judged one claim and prose that describes another.

**The run checkpoints after each step.** `DriveOptions.checkpointAfterStep` is called with the run id and the finished step; `runPipeline` and `resumeRunPipeline` pass a persister. It writes the SNAPSHOT only — the reproducible package is a finished run's product, and re-exporting it after every step would write a directory of partial artifacts sixteen times over.

A failing checkpoint is collected into `RunResult.checkpointErrors` and the run CONTINUES. The step it followed has already committed, so stopping would trade real work for a durability warning; but the failure cannot go unsaid, because a run whose intermediate state was never written looks exactly like one that was, until the process dies. `run-manifest`-style reporting reads that field.

The record is version 3 of the run snapshot: `run.spec` and each step's `commit` receipt join `run.projectRevision` and each registry entry's `ref`. Carrying the receipt is what makes the idempotency key survive a restart — without it a replay after a crash reads as a first commit.

**The dependency graph is checked against what the steps READ.** The driver records every slug an executor asks `getInput` for (`StepOutcome.readSlugs`) and resolves their versions at commit time, which is also what makes the receipt's `inputDigest` name a state rather than a placeholder. `workflow/dependency-graph.ts` compares that observed list with the definition (`undeclaredReads`), states the rollback closure (`transitiveDependents`) and the cycle check (`forwardEdges`) as functions a spec can assert against, and `steps.ts` now declares both missing edges.

The check is observed rather than re-declared on purpose: a second hand-maintained list of "what this executor reads" would repeat whatever mistake the first one made, and the first one was invisible by inspection for exactly that reason.

## Alternatives considered

**Persist the plan in a field core knows about.** Rejected: core owns the 16-step engine and has no vocabulary for a study plan, and giving it one to store an opaque blob would put the research layer's concepts into the portable kernel. The record is `Record<string, unknown>` on purpose — core stores it, the team interprets it.

**Make the resume refuse any run whose spec was not recorded.** Rejected: it would refuse runs that were legitimately driven without one, and the honest fallback is the deployment's plan plus the fact that it was used. The record is required in the format now, so "not recorded" describes only records written before this change.

**Fail the run when a checkpoint fails.** Rejected: durability is a property of the state, and stopping a run that has already done the work would destroy the very thing the checkpoint exists to preserve.

**Checkpoint inside `commitStepOutputs`.** Rejected: core would need a filesystem, and the commit point's whole value is that it is a pure in-memory transaction. The checkpoint is the DRIVER's concern, which is where it now lives.

**Record reads by declaring them on the registry entry.** Rejected for the reason above — that is the mechanism that already failed. What the registry entry needs is the executor; what the observation needs is the call it made.

**Add `not_applicable` to the run status and a `WorkflowRecipe` now.** Deferred, not rejected: the review's recipe vocabulary (`required / optional / not_applicable` per paper type) needs a run status that is neither pending nor passed, which is a state-machine change with its own acceptance tests. Shipping the type before the status would be a vocabulary with no reader, which is the failure this repository's own rules name.

## Consequences

- A restart drives the plan, the profile and the budget the run was started with. `tests/project-recovery.spec.ts` saves a run driven under a plan that is nobody's default, loads it in a fresh persistence, and reads the plan back through the resume's own validation.
- `run-spec-set` and the receipt are in the on-disk format; `RUN_SNAPSHOT_SCHEMA_VERSION` is 3, so records written by version 2 no longer load. That is the intended behaviour of a rejected old format, and the shipped snapshot directory is gitignored scratch.
- Every read the shipped executors make is now declared: `tests/dependency-closure.spec.ts` drives the full pipeline, compares the observed reads with the definitions, and fails if a third undeclared read appears.
- `E1-format` now declares four inputs where it declared three, and `D2-framework` four where it declared three. The cascade a rollback takes is unchanged for the linear pipeline — both steps were already transitively downstream — so what changed is that the closure is now provable rather than incidental.
- The receipt's `inputDigest` is computed from the versions the attempt actually read. It was previously the digest of "no inputs recorded" for every step.
