# Agent Note: A run is readable while it is running

Status: implemented

English | [中文](2026-09-16-a-run-is-readable-while-it-runs.zh.md)

## Problem

The research surface had one entry point, `@Remote('run')`, and it answers when the whole study is
over. Everything downstream of it inherited that: the browser's view model was built from `RunResult`,
the value a drive call returns at the end, so "what is this run doing" could not be asked about a run
that was doing it. A person pressed a button and watched a blank page for the eight to fifteen minutes
a study takes; a reload lost the only handle they had on it; and a step that failed mid-execution was
reported as `in_progress` forever, because the engine leaves a failed attempt rollback-able and the
failure existed only in the drive result that had not come back yet.

The projection could not simply be built from `RunResult` a little earlier. `RunResult` is *defined* as
the end: its `steps` are the outcomes the driver accumulated, and a step it has not reached has no
outcome to report. Fabricating one — an empty `steps`, a synthesised `StepOutcome`, a type assertion
past the missing fields — would put a claim in the product that no run made.

The checkpoint plan asked for the user-visible half of this directly: 按运行之后先弹出方案确认,确认
后**立刻**拿到 runId 并看到运行状态,而不是等整条流水线跑完。

## Decision

**A run's own records are the source of its projection, and the drive call's result is only its
result.**

`runner/project-view.ts` reads the run store's step states, its artifact registry and its
`step-executed` records, and projects **every** catalogued step:

- a step the run has not reached reports `pending` with attempt 0 — reported, not omitted and not
  defaulted into a bucket that means something else;
- a step's execution outcome comes from the LAST `step-executed` record for it, because a step can
  execute more than once (a rollback re-opens it) and the question a reader asks is how it ended;
- an execution failure travels beside the step (`executeStatus` / `executeError`), separately from
  the gate verdict, because those are two different facts about two different things.

**`@Remote('startRun')` creates a run, persists it, and answers with its id before the study has
finished.** The order is the guarantee: the id is written to disk *before* the driver starts, so a
deployment whose snapshot directory cannot be written gets an error rather than a success it could
not keep — and the caller can retry safely, because nothing was begun. The driver then runs under the
service (`void driveRun(...).then(...)` with a rejection handler that records `execution: 'failed'`
and the driver's own message), so the page closing does not cancel the study and no promise is left
unheld.

**`@Remote('runSnapshot')` answers with `execution`, a fact about THIS PROCESS.** `running` means a
driver is on the run here and now; it is never read back from a record written by a process that is
gone. A query for a run this process does not hold restores it from its checkpoints and reports
`stopped`, naming the steps that were in flight — the honest "可恢复或已中断" answer, and the reason
the field is not persisted: a restart has no drivers, so a stored `running` would be a lie.

**`commandId` names the command, not the request.** A client that never read its response — a
timeout, a reload — sends the same id and is handed the run it already started instead of spending a
second study. A different id is a different study.

**The client follows rather than waits.** `startRun` → `runSnapshot` → render → repeat until nothing
is driving the run; each snapshot is handed to the workbench as it is read, and the workbench states
the run's id and execution state beside the readiness badges.

## What is not an event channel

The transport is polling on a fixed client interval, so there is no cursor, no dedup, no ordering
rule and no gap recovery. An earlier plan item ("first snapshot carries a cursor usable for event
handoff") describes a channel this delivery does not build.

**The machinery for that channel already exists here, and this is not a claim that it does not.**
`@Remote({ mode: 'stream' })` is a supported Remote form, the client has `RemoteJournal`
("snapshot-first opening, ordered live delivery, pagination, and repair over a reconnecting Remote
stream", with the opening frame carrying a cursor and a page), and `session-controller`'s `follow`
already drives it. Adopting it for a run's progress is wiring rather than construction, and it is the
path to the acceptance items this delivery leaves undone.

What the delivery does guarantee is that the first snapshot is readable *before* the first step
completes, and that every snapshot is a consistent read of the run's own records rather than a delta
a reader could miss.

## Alternatives considered

**Build the projection from a `RunResult` the driver publishes incrementally.** The driver would have
to emit a partial result after each step. It loses because `RunResult` means "the outcomes the driver
accumulated", and a partial one is a value that will be contradicted: a reader holding it cannot tell
a step that has not been reached from one that is missing, and the artifact registry and verdicts it
would carry are already recorded in the store, so the partial result is a second copy of the truth
that can drift from the first.

**Keep one entry point and add a progress event beside it.** The `run` call would stay the way a run
is created and a separate channel would report progress. It loses because creating a run is exactly
what must answer early: the caller needs the id before it can ask anything about the run, and an
entry point that answers late cannot be repaired by a progress channel added next to it.

**Return the run id immediately but keep the run's state in a service-owned cache, not on disk.**
This is what makes the id useful within one process and useless across a restart — a reload would
meet a service that has no such run, and the honest answer would be "it is gone" about a study whose
checkpoints are on the disk. It loses on the requirement it fails: a restart must be able to locate
the original run.

**Report a restored run as `running` while a resumed driver is not yet attached.** It loses because
the field exists to answer "is anything working on this": between a restart and a resume, nothing is,
and a reader told otherwise would wait instead of acting.

## Consequences

- `runPipeline` gained `checkpointAfterStep` in the same change. It had been missing since checkpoints
  landed, so a run started through the new path would have written nothing until it ended — and a
  restart would have found nothing to restore. The two entry points now differ only in when they
  answer.
- `persistRun` takes a run id instead of a `RunResult`. It only ever read `run.runId` from it, and
  demanding a drive result for an id is what pushes a caller toward fabricating one — which is
  precisely what a mid-run approval would have had to do to persist its own decision.
- A run that finished under `startRun` exports its package through the same `recordRun` the
  synchronous path uses, so the two paths produce the same artifacts.
- **The run's on-disk revision is derived by one rule, and that is because two copies cost a
  decision.** The browser probe found it: the snapshot reported the finished write's revision while
  the approval's persistence was based on the last CHECKPOINT's, so an approval at E2 was applied and
  then refused (`the persisted snapshot is at revision 18 but this write is based on revision 17`) —
  the decision in memory, not on disk. `savedRevisionOf` is now the single answer to "which revision
  is this run at", read by the snapshot and by every writer. The in-process suite cannot reach the
  approval's own write (it needs a run parked at the gate); what it pins is that the reported
  revision is the file's and that a write based on it is accepted.
- **The in-process tests are the evidence for the states, and the browser probe is the evidence for
  the wire.** `tests/start-run.spec.ts` holds a real run inside a real step with a literature adapter
  that does not answer until the test releases it, and reads the projection from there — no sleeps,
  and a `startRun` that waited for the study would hang rather than pass. The restart case boots a
  second service over the same snapshot root and reads the run the first one left. The probe
  (`verify-browser-b.mjs`, run against the shipped `web` profile on port 1120 with a real browser and
  a live model) reports **44/44**, and two of its checks are this decision's: the page
  states that something is driving the run WHILE the backend confirms it has passed no step yet —
  visible before the first step ends — and the page and the backend agree on the run's id.
- **Restoring the run after a reload is asserted at the DOM level only.** `verify-browser-b.mjs` does
  not check it, because reloading through CDP takes the debugging endpoint with it: measured twice,
  `127.0.0.1:9334` stopped listening, every later read hung, and the second attempt ended the probe
  without a summary. A check a probe dies on cannot report, so it is absent rather than green — the
  DOM specs assert the run id comes back and that a browser with nothing to resume says so, and the
  implementation record states which evidence exists for which item.
- **The probe had to be taught the new semantics.** It waited for a snapshot FILE to appear and read
  the run out of it, which was right while the snapshot was written once, at the end. A run's id is
  now durable before its first step, so that wait returned immediately and read an empty run as a
  finished one; the wait is now on the run's own execution state, read through the same method the
  page polls.
