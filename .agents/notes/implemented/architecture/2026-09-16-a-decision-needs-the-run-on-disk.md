# Agent Note: A decision needs the run on disk, and it is refused before it is taken

Status: implemented

English | [中文](2026-09-16-a-decision-needs-the-run-on-disk.zh.md)

## Problem

`E2-submit` is this deployment's only path from `gated` to `passed`, and the decision that moves it
is durable or it is nothing: a decision that lives only in the serving process is forgotten by a
restart, and the restored run shows the gate `gated` again — asking a person to approve what they
already approved.

A run whose saves are failing was decided anyway. `submitApproval` applied the decision and then
wrote it; when the write failed it answered `persisted: false` beside a `status: passed` the run
already held in memory. [A failed checkpoint is the run's state](2026-09-16-a-failed-checkpoint-is-the-runs-state.md)
made that failure visible — the run reports it as the `error` of its persistence record and refuses
readiness — and left the approval unblocked on purpose, recording that blocking it belonged in the
approval's own precondition.

The cost of leaving it there is not a wrong report; it is the state it produces. The gate is `passed`
in a process that will forget, the snapshot says `gated`, and the caller is told its decision is not
durable with nothing it can do about it.

## Decision

**`submitApproval` reads the run's last durable write, and refuses while it reports a failure.**

- The check sits with the other preconditions — run, step, `humanGate`, current status, current
  attempt, expected revision — because that is the only place where a decision can still be
  declined. A refusal after the decision is a report about something that has already happened.
- The new code is `research/approval-save-failed`, and the message carries the deployment's own
  reason, so an operator reads the same cause the page is rendering.
- The fact read is the one the projection renders (`ResearchRunSnapshot.runPersistence`), reached
  through the same accessor (`livePersistence`). `submissionReady`, the readiness note and this
  refusal therefore cannot disagree about whether the run is on disk.
- `RememberedRun` gains `saveState`, and `persist` becomes required with it. A caller that can write
  a decision cannot forget to say whether the run it belongs to is on disk; a deployment that keeps
  no durable record answers `null`, which is a fact about the deployment rather than a failure.
- **Recovery is the run's own next write.** A refusal is never remembered (the ledger caches only
  answers), so the same command id decides once the run's saving works again. While the run is being
  driven, the next checkpoint that lands clears the failure. Once the driver has stopped, nothing in
  this process writes the run again, so a run whose LAST write failed stays refused until it is
  driven again — the refusal says so, and the operation that re-drives it is the disconnect-recovery
  work, not this one.

## Alternatives considered

**Refuse only when the run's own final write failed, and keep reporting `persisted: false` for the
rest.** This is the narrowest reading of the defect, and it splits one fact in two: a run whose
checkpoints were failing while it was driven would still be decided, be applied, and only then be
reported as not durable — the exact failure, deferred by one process's lifetime. The page already
tells the reader that such a run is not ready; the approval must say the same thing.

**Prove durability by writing before deciding.** The guard could call the run's writer and treat a
successful write as the proof, which would also heal a stale recorded failure. It costs a second
write per recovered approval, it puts a write before the decision the module documents as
persist-after, and it proves only that the deployment could write a moment ago — the decision still
has to be written after it, and that write can still fail. Reading the run's own record is the weaker
claim honestly stated: the run is on disk now, so a decision about it can be.

**Refuse and rely on the existing `persisted: false` report.** That is what shipped, and it is what
produced the state above. A report that arrives after the gate has moved cannot undo the move.

**Let the client refuse instead — the page already shows "not ready".** The page is a rendering of
the fact, not an enforcement of it. `submitApproval` is reachable from any in-process caller and
from the authenticated channel, and a rule the reader's own screen applies is not a rule the backend
has.

## Consequences

- A gate can no longer move to `passed` in a process whose snapshot still says `gated` because the
  write failed. The failure mode that remains is the reverse and is the safe one: the run is refused
  until it can be written.
- The refusal is a precondition, not a latch. `tests/approval.spec.ts` pins the fact clearing and the
  same command id then being decided; `tests/start-run.spec.ts` drives a real service through an
  unwritable directory (refused, gate untouched) and through a damaged snapshot repaired while the
  run works (the failure clears while running, and the decision is then recorded and persisted).
- `snapshotOf`'s readiness parameter is now the durable record's error rather than the checkpoint
  hook's field, so `submissionReady` and this refusal read one record. That closed a disagreement
  the previous state allowed: a stopped run whose final write failed reported "ready" while an
  approval of it would have been refused.
- The approval's writer is now required on the registry entry rather than optional, which removed the
  branch that treated "no writer" and "the writer returned null" as two paths to the same answer.
- **What this does not do**: it does not make a stopped run writable again. A run that stopped with
  its last write failed cannot be decided in this process, because nothing here writes it; the
  operator is told exactly that. Re-driving a run from its snapshot belongs to the disconnect and
  recovery work, and until that exists the remedy for such a run is outside the browser.
