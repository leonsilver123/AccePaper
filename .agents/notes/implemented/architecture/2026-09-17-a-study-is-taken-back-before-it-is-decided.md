# Agent Note: A study a previous process left is taken back before it is decided

Status: implemented

English | [中文](2026-09-17-a-study-is-taken-back-before-it-is-decided.zh.md)

## Problem

An approval is refused for a run this process does not hold, and the refusal is right: a decision has
to be written into the run's state, and only the process holding that state can write it. What the
rule left behind was a study that had reached the human gate, stopped there, and survived a restart.
A page could FIND it (the deployment lists what it holds), OPEN it (following reads it), and never
DECIDE it: the reader saw the paper, pressed the decision, and the backend reported that this process
holds no such run.

`resumeRunPipeline` is not the way in either: it drives a run from its first non-terminal step, and a
run whose every step is settled — which is what a study waiting at the gate looks like — has nothing
to resume. It refuses, correctly, and the study stays undecidable.

## Decision

**`@Remote('openStoredRun')` takes a stored study into this process without driving it.**

- **It drives nothing.** The snapshot is loaded into memory, the run is registered with the approval
  channel, and it is reported `stopped` — the fact about THIS PROCESS, which stays true until someone
  resumes the study. Whether to carry the study further remains a decision, and the operation that
  carries it is the resume.
- **Adopting twice is refused.** The second call would replace the state a reader is watching with a
  copy of what was on disk, and any decision taken in between would be lost with it.
- **A run the deployment does not hold is refused**, rather than adopted into existence.
- **A snapshot that loaded and whose last write failed keeps that fact**: opening a run is not a
  write, so it cannot clear the record that says the run is not on disk — and the approval path reads
  that record before it decides anything.
- **The page offers the control where it can work**: on a study the deployment reports `stopped`, and
  only when the host provides the operation. Opening and adopting are different acts, so they are
  different buttons: opening reads a study, adopting is what makes a decision possible.
- **The adopted run is written through the same serialized writer every other write uses**, with the
  revision this process read, so a decision taken on it is as durable as one taken on a run this
  process started.

## Alternatives considered

**Let the approval endpoint load the run it is asked to decide.** It removes the second operation and
it makes a decision able to arrive with no prior read: the endpoint would load whatever is on disk at
the moment of the click, and the revision the reader actually saw would stop being part of the
decision. Adoption is a separate, explicit act that the page performs when it opens the study.

**Make the page call `resumeRunPipeline` instead.** For a gate-stopped run it throws "no step left to
resume", and for a run with work left it would DRIVE the study — a click on a list row would spend
model calls. Adopting and resuming are different intents and now have different entry points.

**Hold every stored run the deployment can see, at boot.** A deployment with many studies would drive
nothing but would hold all of them, and every decision would be taken against a state nobody had
looked at. The page adopts the one it opened.

**Report an adopted run as `running`.** It is not: nothing here drives it. `stopped` is what a reader
needs, and the resume is what changes it.

## Consequences

- A study that reached the human gate and survived a restart can be decided again, which is the one
  thing the gate exists for. This closes the gap the S6 acceptance hit: the loop's five steps could
  not be driven in a browser because the only run available at a gate belonged to a dead process.
- The deployment's `activeRuns` now grows by adoption as well as by starting and resuming, and it
  still has no eviction — a deployment that adopts many studies holds them for the life of the
  process. That is the same known limitation the start-command registry carries, and it is recorded
  rather than papered over.
- **Not done**: nothing resumes an adopted run from the page either. Adoption makes a decision
  possible; carrying a stopped study further is `resumeRunPipeline`, which still has no browser entry
  point.
