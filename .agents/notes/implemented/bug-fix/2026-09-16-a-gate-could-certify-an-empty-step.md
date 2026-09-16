# Agent Note: A gate could certify a step that produced nothing

Status: implemented

English | [中文](2026-09-16-a-gate-could-certify-an-empty-step.zh.md)

## Problem

An architecture review of the research layer (`project-plan/architecture-review-2026-09-15/`) ran six offline probes against the shipped execution path. Three of them reproduced defects that the existing tests could not see, because every one of them is about what happens when an execution goes WRONG.

**A step with no outputs could reach `passed`.** `submitGateVerdict` decided the step's status from the votes alone. Starting `A1-landscape` and submitting a formally correct B `passed` verdict over an empty registry produced `status: passed, artifacts: []`. The gate certified work that did not exist.

**A failed execution could leave partial official output.** `runStep` iterated the executor's returned map and called `recordArtifact` once per slug. When the second value could not be cloned, the throw happened after the first slug had already been written. The probe measured `status: error, reportedOutputs: []` while `landscape-map` sat in the registry.

**A superseded attempt could write under the new one.** `recordArtifact` read `state.attempt_id` at write time. The probe started attempt 1, rolled the step back, started attempt 2, then released attempt 1's executor: attempt 1's value was recorded as attempt 2's artifact and the execution returned success.

All three are the same shape: the system recorded that a step completed without any check that the work the step is defined to do had happened.

## Decision

**One commit point, and the gate reads the products it certifies.**

`engine/commit.ts` adds `commitStepOutputs(store, runId, stepId, request)`. It is the only path that writes a step's official outputs, and it enforces three rules before writing anything:

- **Complete.** The candidate set must equal the step's declared outputs exactly. A missing slug, an undeclared one, or a duplicate is refused. (`DSH_COMMIT_OUTPUTS_INCOMPLETE`, `DSH_COMMIT_OUTPUT_NOT_DECLARED`, `DSH_COMMIT_DUPLICATE_OUTPUT`.)
- **Fenced.** The request carries the attempt it was started for; a commit for an attempt the step has moved past is refused (`DSH_COMMIT_STALE_ATTEMPT`).
- **Atomic.** Every value is cloned and hashed during validation. The write phase that follows has no failure mode left in it, so a refusal leaves neither an artifact, nor a revision, nor an audit event.

`submitGateVerdict` refuses a step whose attempt has no commit receipt (`DSH_GATE_WITHOUT_COMMIT`), whose registry no longer holds what that receipt records (`DSH_GATE_COMMIT_MISMATCH`), and whose verdict does not name exactly those revisions (`DSH_GATE_STALE_TARGET` / `DSH_GATE_STALE_INPUTS` / `DSH_GATE_UNBOUND_VERDICT`). The first two were this note's change; the third closed a defect the same day reproduced — an old verdict approving a new attempt's products — and replaced the registry-presence check this note originally described. See [the gate certified work it had not read](2026-09-16-the-gate-certified-work-it-had-not-read.md). Whether a step may pass is still decided from what its ATTEMPT produced, which is what makes a rollback mean something.

**A run revision.** `RunState.revision` starts at 0 and only a commit advances it, by exactly one. A commit whose `expectedRevision` no longer matches is refused (`DSH_COMMIT_REVISION_CONFLICT`). `runStep` reads the revision at entry and commits against it, so a result computed from a state the run has left behind cannot land.

**Idempotency is a key, not a hope.** A commit carries an `idempotencyKey`; a repeat with the key this attempt already committed returns the FIRST receipt and writes nothing (`DSH_COMMIT_ALREADY_COMMITTED` for a different key on the same attempt). `runStep` derives the key from `(stepId, attemptId)`, so a retry of one attempt is a replay and a new attempt is a new key, without the caller minting anything.

**Every registry entry has an identity.** `ArtifactRecord` gains a required `ref: ArtifactRef` — artifact id, version, and the SHA-256 of the bytes. `recordArtifact` computes one too, so the registry is uniformly versioned rather than mostly. The hash is over a canonical JSON encoding (object keys sorted), because hashing `JSON.stringify` output makes two producers that build the same object in a different key order hash differently, and a reference check would then refuse a value that had not changed. A value with no canonical encoding — a function, `undefined`, `NaN`, a cycle, or a `Map`/`Set`/`Date`, which have no own enumerable keys and would encode as `{}` — has no identity and is refused (`DSH_VALUE_NOT_CANONICAL`, `DSH_COMMIT_VALUE_NOT_PERSISTABLE`).

**The durable format changed with it.** `RUN_SNAPSHOT_SCHEMA_VERSION` is 2: the payload carries `run.projectRevision` and each registry entry's `ref`, and `step-committed` joins the audit-kind allow-list. A revision that survived a restart as 0 would make every later commit's fence measure against the wrong number, which refuses honest commits and admits stale ones, so the record states it rather than defaulting it.

## What is deliberately not covered

**The commit receipt is not persisted.** `StepState.commit` is an in-memory fact. After a restore, the receipt is gone and a replay of the same `runStep` call is refused by the pre-existing `DSH_STEP_ALREADY_EXECUTED` guard instead — so the omission cannot become a double commit, but it does mean a restored attempt cannot read its own receipt back. Persisting it belongs with the checkpoint work that owns the restart path.

**`recordArtifact` remains a public seam, closed after a commit.** It is what `ctx.research.recordArtifact`, the recovery fixtures and E2's empty-gate path call, and it still writes one artifact without the completeness rule. Two things now make it not a bypass: it refuses once the attempt has committed (`DSH_ARTIFACT_AFTER_COMMIT`), and the gate requires the attempt's commit RECEIPT rather than inferring completeness from the registry — so an attempt that pads its declared outputs one at a time cannot pass. Both were added on 2026-09-16 in [the gate certified work it had not read](2026-09-16-the-gate-certified-work-it-had-not-read.md), after a review reproduced the bypass: replacing a committed artifact left the revision at 1 and the gate still passed.

**The gate binds by presence and attempt, not by digest** — as of this note. That was closed the same day: a verdict now carries `targetRefs` and `inputDigest`, bound where it is built, and the gate refuses a mismatch. See [the gate certified work it had not read](2026-09-16-the-gate-certified-work-it-had-not-read.md). `GateReport` and `reportAnswers` in `domain/quality.ts` remain the vocabulary for a report that outlives the attempt.

## Alternatives considered

**Keep the per-slug writes and validate the whole set first.** Rejected as insufficient: validating a value is exactly what can fail, so "validate then write" must include the clone and the hash, and that is already most of a commit point. The remaining piece — the attempt fence — cannot live in a per-slug writer at all, because there is no single instant it is checked at.

**Make the gate require a commit receipt rather than deriving completeness from the registry.** Rejected FOR NOW, on cost: it would have required rewriting every existing spec that legitimately drives `recordArtifact` then a gate, and the two rules appeared to refuse the same thing. The same day, a review showed they do not — an attempt that pads its declared outputs one at a time passes a registry-derived check and has no receipt to bind a verdict to. The receipt became the gate's input, and the specs were migrated.

**Add an `expectedAttemptId` parameter to `recordArtifact` instead of a new module.** Rejected: it would have left the door open for the next caller to omit it, and the defect class is precisely "a caller wrote to official output without the fence".

**Default the run revision to 0 when a snapshot lacks it.** Rejected: it restores a run whose revision is a lie, and the fence then compares against a number that never existed. Bumping the schema version and rejecting the old record is the honest failure.

## Consequences

- The three probes now have stable refusal tests in `dsh-research-core/tests/commit.spec.ts`: no outputs, a partial set, a second value that cannot be cloned, a late completion from a superseded attempt, a stale revision, a repeated idempotency key, and two commits prepared against the same revision.
- `packages/research` is 1617 passing across 89 files, including the specs whose obsolete behaviour assertions were rewritten (`pipeline.spec.ts` accepted an empty artifact map as `success`; the happy-path audit-vocabulary test expected `artifact-recorded`, which the driven path no longer emits).
- An existing persisted snapshot from before the bump no longer loads. That is the intended behaviour of a rejected old format; the shipped snapshot directory is gitignored scratch.
- The step-level audit trail is now one `step-committed` record per step carrying the revisions, rather than one `artifact-recorded` per slug. A reader who counted artifacts from the audit log has to read the receipt instead.
