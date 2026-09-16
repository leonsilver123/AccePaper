# Agent Note: A save that failed is retried, not re-run

Status: implemented

English | [中文](2026-09-16-a-save-is-retried-not-re-run.zh.md)

## Problem

A run whose write to its snapshot failed is not on disk: a restart loses it, and — since
[a decision needs the run on disk](2026-09-16-a-decision-needs-the-run-on-disk.md) — the human gate it
reached cannot be decided either. The refusal names the deployment's own reason and clears itself on
the run's next write, which covers a run that is still being driven. It does not cover the case the
browser actually reaches: the run has STOPPED (E2 is a human gate, so the driver has returned), its
last write failed, and nothing in the process will write it again.

The only way out that the system offered was to drive the study again. That is the wrong remedy by
construction: the run has already spent its model calls, and a second execution produces different
numbers under the same name — the paper would not be the paper that was measured.

## Decision

**The run's current state can be written again, and that write is its own command.**

- `@Remote('retryRunSave')` writes the state this process HOLDS for a run to its snapshot, and
  answers with what the write did plus the run re-projected after it.
- **It reconciles with the disk**: the base revision is read from the snapshot as it stands, so a
  file another writer moved is not overwritten blind. Every attempt also goes through the same
  serialized writer the checkpoints use, so a retry cannot interleave with one.
- **It moves the snapshot's write counter and never the run's `projectRevision`.** Those are two
  different numbers — one counts writes to the file, the other counts what the study committed — and
  rewriting the same state commits nothing. A decision taken before the retry therefore still names
  a current revision, and the binding it is held to is exactly what it was. The page re-reads the
  revision from the projection the retry answers with.
- **A run this process does not hold is refused.** A run read back from its file is already at the
  state its file records; there is nothing a second write would carry that the disk does not have,
  and re-executing it is not a save. The refusal says which of the two the caller asked for.
- **One record of durability.** The retry reports its outcome through the same `noteSave` rule the
  other writers use, so `livePersistence`, `submissionReady` and the approval's precondition all see
  the write that just landed instead of the failure it recovered from.
- The workbench offers the retry on the host's own `saveFailure` report, and renders the run the
  retry answers with. A host that cannot retry one shows no control rather than an inert button.

## Alternatives considered

**Re-run the study when its save failed.** It is the shortest path from "not on disk" to "on disk",
and it loses on what the product is for: the manuscript, the figures and the measured numbers would
describe a second execution, and the reader who approved the first would have approved something
that no longer exists. It also multiplies the cost of every disk failure by the cost of a study.

**Let the client re-send the last snapshot it read.** The page holds a projection, not the run's
state: artifacts, gate verdicts and the audit log live in the store, and a page that wrote its own
view back would be inventing a record. The write belongs where the state is.

**Do it automatically when a write fails.** A retry loop hides a deployment that cannot write, and
the failure the person needs to see — the disk is full, the directory is gone — would be reported as
a slow study. The retry is explicit, and the page states the failure until it is used.

**Store the retry's own revision so the caller can compare.** The snapshot's counter is already in
`runPersistence.revision`, and the projection carries it. A second field for the same number is a
copy that can disagree with the first.

## Consequences

- The path from "the deployment's write path broke and came back" to "the gate can be decided" is a
  save retry, and the study is never carried out twice.
- The client gained its first write command that is not a start or an approval, and it is offered on
  a host-reported fact rather than on the page's own reading of the numbers.
- **What this does not do**: it cannot recover a write whose state is gone — a restart's record is
  already the disk's own content, and a process that died after a failed write has nothing newer to
  offer. That case is the disconnect-recovery work, not this one.
