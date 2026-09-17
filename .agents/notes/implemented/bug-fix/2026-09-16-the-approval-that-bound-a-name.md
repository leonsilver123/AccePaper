# Agent Note: The approval that bound a name

Status: implemented

English | [中文](2026-09-16-the-approval-that-bound-a-name.zh.md)

## Problem

`ApprovalRecord` held this and nothing else:

```ts
{ run_id, step_id, attempt_id, principalId, approval_event_id, decision, rationale, timestamp }
```

A person approved the manuscript that was in front of them. The record said that attempt N of `E2-submit` might proceed — and no content of any kind. So a document that moved afterwards was still covered by the decision: a later step that rewrote it, a recovery that restored a different snapshot's artifact under the same approval, or a hand.

The package already knew how to bind content. `submitGateVerdict`, in the same file, compares a verdict's `targetRefs` against the attempt's commit receipt byte-for-byte and refuses `DSH_GATE_STALE_TARGET` when they differ. The approval path compared nothing, and `package-export.ts` had been computing a `sha256` per exported file all along.

## Decision

An approval freezes the refs of its step's inputs, at the moment of the decision, **from the run's own registry and never from the caller** — the same rule `bindVerdict` follows, and for the same reason: a decision that named its own targets could name the ones it wanted.

`approvalStalenessOf(store, runId, stepId)` compares the frozen refs with what the registry holds now and names the revision that moved, with both hashes. `readinessOfRun` asks it for every step and hands the first answer to `submissionReadinessOf`, which refuses readiness with a reason a reader can act on.

**A record written before this restores with no targets**, so its decision binds nothing and cannot be called stale. That is the behaviour it was made under; inventing targets for it at parse time would credit a decision with a binding it never had.

The decision also names the revision the READER saw. `ApprovalSubmission.expectedProjectRevision` is required and compared against the run before anything is decided: a page that moved under the reader — a second tab, a step that landed, a recovery — cannot get a decision recorded against a document nobody read. The two checks cover the same mismatch from either side of the moment.

## Alternatives considered

**Compare a package hash at export time instead.** Rejected as the primary mechanism: the package is assembled AFTER the approval exists, so there is nothing to compare against at the moment the decision is made. The run's inputs at E2 are what the person was actually shown, and they are what a decision can bind. The manifest's per-file `sha256` remains the thing a reader checks an exported directory against, and the README says so.

**Require the caller to pass the refs it believes it is approving.** Rejected: this is exactly the mistake F01 closed for gate verdicts. A caller that supplies its own targets can supply the ones it wants, and the approval would certify whatever it was handed.

**Make `targetRefs` mandatory in the snapshot format and reject old records.** Rejected: it would turn every existing snapshot into an unloadable file to gain a guarantee about decisions that were made before the field existed. Their behaviour is recorded instead.

**Treat "no approval on record" as stale.** Rejected: whether a step needs an approval is readiness's question, not this function's. This one answers "does the decision still describe what is there", and a step with no decision has nothing to describe.

## Consequences

- `tests/approval-binding.spec.ts` drives a run to E2, approves it through the host channel, and then pins: the record carries the registry's own ref; nothing is reported while it holds; a moved version, a changed hash at the same version, and a deleted input each report their own case; and an unapproved step reports nothing.
- `tests/submission-readiness.spec.ts` pins the refusal and that every existing caller keeps its answer (the parameter defaults to absent).
- **What is still not covered**: the exported files on disk. Editing `manuscript.md` after the export is outside the run's registry, and no comparison here sees it.
