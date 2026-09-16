# Agent Note: Every write is based on the revision the last landed write moved

Status: implemented

English | [中文](2026-09-17-every-write-is-based-on-the-last-landed-write.zh.md)

## Problem

The revision loop worked, step by step, and three defects survived every test it had: 960 research
tests, the acceptance refusals, the jsdom specs of the panel, and the recovery probes. Each defect
lives where two separately-correct parts meet, and each was found only by driving the whole loop from
a browser against a real deployment.

1. **A candidate was written under the id `''`.** `generateCandidate` took `request.candidateId` from
   its caller, and the page has no candidate to name when it asks for one — it sends the empty
   string. Every candidate of every request therefore shared one id: one `candidate-.json` per
   request with the second candidate overwriting the first, `review-.json` meaning whichever candidate
   was judged last, and a page whose review and accept controls all named the same candidate. The
   wire type already said what should happen — "ignored when writing one, which mints its own" — so
   the defect was the implementation disagreeing with its own declared contract, which is the kind
   nothing type-checks.

2. **An acceptance was written against the wrong counter.** The snapshot store's compare-and-set
   compares a SNAPSHOT revision: a write counter that moves on every save, checkpoints included. The
   acceptance based its write on the run's `projectRevision`, which counts what the study committed
   and does not move when a checkpoint writes. The two counters drift apart on any run that has been
   checkpointed, and they start further apart still on a run this process ADOPTED. The acceptance was
   recorded, its `persisted` said false with the store's reason, and the manuscript it published never
   reached the file: the page showed an accepted manuscript, and a restart would have shown E1's.

3. **A write did not note itself.** `persistRun` moved the file and told nobody, so the base this
   process held for the NEXT write was one revision behind — which is how defect 2 was triggered: an
   approval wrote the run, and the acceptance after it was refused, "the persisted snapshot is at
   revision 25 but this write is based on revision 24".

## Decision

- **The deployment mints a candidate's id.** `generateCandidate` does not read the caller's field, and
  `buildCandidate` mints one when it is given none. Every later read goes through that id: the record
  file is named for it, a review is looked up by it, an acceptance names it, and the page pins each
  control to it.
- **Every write bases itself on `active.savedRevision`** — the field each landed write updates.
  `persistRun` notes its own result (success or failure) into it, a checkpoint's callback stores the
  revision its checkpoint wrote, and adopting a stored run seeds it from the snapshot it read.
- **The read is of the FIELD, never of the last write's record.** A record describes one path's write:
  a checkpoint moves the file without going through `persistRun`, so a base read from that record says
  nothing about the other path.

## Alternatives considered

**Keep taking the caller's `candidateId` and have the page mint one.** The page would have to invent an
id for a record it does not own, and two tabs asking at once would mint two ids for two candidates of
one request — the thing the id exists to prevent. The minting belongs where the record is written.

**Base the acceptance on the project revision and relax the store's guard.** The guard is what keeps
two writers from silently replacing each other's state, and a write that named the wrong counter would
still be refused the next time a checkpoint ran. The counter was wrong, not the guard.

**Read the snapshot file before every write to get a fresh base.** This is what `retryRunSave`
deliberately does, and it is right for a retry: the write reconciles with the disk rather than trusting
a remembered number. For an ordinary write it would make a run's own decisions race an external writer
for a revision the process already knows — and the process knows it precisely because it is the one
writing.

## Consequences

- The id defect is guarded by a unit test in the module that mints it (removing the mint fails it). The
  other two are guarded by the browser probe: the acceptance branch reads the manuscript back off the
  disk as `version 2 / producer human-acceptance`, which is exactly the reading that failed before.
- **Two things remain unverified and are recorded as such**: no spec covers the acceptance's
  service-side wiring (a fixture that reaches the gate with a manuscript needs a run the offline route
  cannot produce), and no reading exists of a MODEL-written candidate passing review — the loop was
  driven with the deployment's deterministic writer, whose text it labels as such.
- **A product fact this exposed, not fixed**: the `numbers` check is one-directional. It rejects a
  number nothing in the run measured and does not require the numbers the run holds to survive a
  revision, so a candidate that deletes every measurement in a section passes all three checks. A
  stricter rule needs its own unit and its own tests.
