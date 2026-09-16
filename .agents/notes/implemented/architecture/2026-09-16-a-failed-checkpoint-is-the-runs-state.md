# Agent Note: A checkpoint that failed is the run's state, not the driver's note

Status: implemented

English | [中文](2026-09-16-a-failed-checkpoint-is-the-runs-state.zh.md)

## Problem

A checkpoint that could not be written was collected by the driver into `RunResult.checkpointErrors`
— a value a RUNNING run has not produced yet. So while a study was working, nothing a reader could
see said that the work was not reaching the disk: the steps advanced, the gates closed, and the only
record of the failure was in a result that would exist at the end. The delivery record admitted it
as a known limitation, and a review put it above the streaming work: "用户可能看到研究继续推进,
却不知道最新成果没有保存".

## Decision

**The failure is recorded on the run, reported where saving is reported, and refuses readiness.**

- `ActiveRun.checkpointError` is set by the checkpoint hook and CLEARED by the next checkpoint that
  lands — so it describes the run's saving now, not a failure it has since recovered from. The hook
  rethrows, because the driver's own accounting (`RunResult.checkpointErrors`) is still the record of
  what each step's save did, and the run continues: its step has already committed.
- `livePersistence` carries it as the `error` of the run's persistence, beside the `revision` that
  stopped moving. The browser already renders that field, so the page shows the deployment's own
  reason without a new wire field.
- **Readiness refuses.** `submissionReady` is `readiness.ready && checkpointFailure === undefined`,
  and the note names the failure. Readiness is a claim about material that exists and can be produced
  again; material the deployment could not write is neither, and a reader told "ready" about it would
  be told to submit something nobody can produce twice.

## Alternatives considered

**Leave it in `RunResult` and let the end of the run report it.** It is what the code did, and it
loses on the case the review named: the reader who most needs the fact is the one watching the study
that is still going, and they are exactly the reader who cannot see a result that does not exist yet.

**Add a wire field for it.** The persistence record already has an `error` field that the page
renders, and a run's saving is one fact with one home. A second field for the same failure would be a
copy that can disagree with the first.

**Refuse the run entirely once a checkpoint fails.** Stopping a study because a disk hiccuped would
throw away the model calls its finished steps already paid for. The steps HAVE committed, the failure
is reported, and readiness refuses — which is what "do not publish what you cannot reproduce" needs,
without killing work that is still recoverable if the directory comes back.

## Consequences

- The failure clears itself: the next checkpoint that lands deletes it, so a transient outage does
  not leave a run permanently unready.
- **The approval is blocked by it too** — in the approval's own precondition, before anything is
  decided ([a decision needs the run on disk](2026-09-16-a-decision-needs-the-run-on-disk.md)). This
  note left it unblocked and named where the guard belonged; that change is where it landed.
