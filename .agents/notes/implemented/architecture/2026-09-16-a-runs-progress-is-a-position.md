# Agent Note: A run's progress is a position, not a poll

Status: implemented

English | [中文](2026-09-16-a-runs-progress-is-a-position.zh.md)

## Problem

The page held a running study the only way the unary entry point allowed: it re-read the whole
projection every 1500 ms. That answers "what is this run doing" — which is what the previous change
made possible at all — but it cannot answer "what has happened", and it has no position to resume
from. A page that dropped its connection had to take a fresh snapshot and hope nothing in between
mattered, and a reader who came back could not tell whether the screen had missed a step.

The plan's §7.2 names the shape it wants instead: a snapshot and a cursor that point at the SAME
sequence point, a subscription that continues from that cursor, an explicit re-sync when the cursor
cannot be served, and no gap between the snapshot and the subscription.

## Decision

**A run is followed through a stream Remote, addressed by a cursor that is its event index.**

- `@Remote({ mode: 'stream' }) followRun({ runId, cursor? })` yields a `snapshot` frame, then one
  `event` frame per appended event, then a closing `snapshot` when nothing is driving the run.
- The cursor is `<runId>#<sequence>`, where the sequence is the event's INDEX in `run.events`. The
  run's audit events carry no sequence field and their `ts` is `Date.now()` — two events appended in
  the same millisecond share it — so the index is the only strictly monotonic key the run has.
  Entries are only ever pushed and nothing trims, reorders or compacts the array, which is what makes
  an index name the same event for the life of the run.
- The cursor carries its run so a cursor presented for a different run is REFUSED (`resync`) rather
  than read as a position in that run's history — the plan's cross-run counter-example.
- `resync` is also what an unreachable position gets. The log is never trimmed, so no cursor this
  deployment produced becomes unservable on its own; a build that introduces trimming owes this frame
  a second reason, and the type says so.

## Why the snapshot frame makes "no gap" true by construction

The opening frame's cursor is the position its snapshot was read at — both are read in one
synchronous step — and the log only grows. So the snapshot already contains the effect of every event
at or before that cursor: a reader that reconnects is handed a state that INCLUDES what it missed,
and the frames after it are exactly the events appended since. There is no interval between "the
snapshot" and "the subscription" in which an event could be lost, because they are the same read.

**The page renders the service's projection, not its own.** Each batch of events is followed by a
snapshot at the position the batch reached, so a client never has to replay events into a second
projection that could disagree with the service's — a rule this repository states as "derive caches
and UI echoes from one authoritative source". What the events are for on the client is ORDER: the
page knows which position it holds and refuses to apply a frame that does not continue it.

## Alternatives considered

**Keep polling, and treat the events as a change signal.** It is what the client did before this
change. It loses on the requirement it cannot meet: a signal says "something changed" without saying
where the reader is, so a page that missed a signal cannot tell whether it missed one — and the plan
asks for a position precisely so that question has an answer.

**Replay events into a client-side projection.** The page would fold the envelopes into its own view
model, and the snapshot would only be the starting point. It loses because the service already owns
that projection: a second implementation in the client would be a copy that drifts, and the failing
case is silent — a screen that agrees with the host's events and disagrees with its state.

**`RemoteSnapshotStream` (baseline plus replacement) instead of a cursor.** It is the cheaper
mechanism in this repository, used by the workspace controller, and it would give "the screen is
current" with no cursor at all. It loses on the acceptance the plan writes down: with no position
there is nothing to refuse when a reader's window is not this run's history, and "no gap" cannot be
stated as a property — only hoped for. `RemoteJournalStream` was the other candidate and remains the
maintained path if this needs pagination or gap repair over a page method; a run's log is small and
fully served by one opening plus its tail, so the repair machinery has nothing to do here yet.

## Consequences

- **The last frame states why the stream ended.** The run's execution state moves AFTER the batch that
  finished it, so the snapshot beside that batch can still say `running` — and since the stream ends
  there, a follower would be left reading `running` about a run with no driver. A closing snapshot is
  emitted for a run this process drove; a run it never drove needs none, because its opening snapshot
  was already read at that position and already says `stopped`.
- **The stream is read-only.** §7.2 puts version-sensitive commands on the authenticated unary path,
  so a stream a page can open is not a way to write; the plan's "no unauthenticated write" case has
  no surface here to fail on.
- **`detail` is not on the envelope.** The first build was refused by the typert generator:
  "Remote boundary contains unconstrained unknown data". The generator is right — a bare `unknown`
  has no place on a wire boundary — and what a subscriber needs from an event is which event it was
  and where it sits. A consumer that needs a specific payload gets a typed field for it.
- **The host still observes its own log on a 250 ms tick.** Core publishes nothing: `appendAuditEvent`
  writes into an array and the journal's notification seam is an empty callback. So the stream polls
  the log the way the page did, but from a POSITION rather than from nothing — the delivery is ordered
  and resumable, which the polling never was.
- **The projection now reports the step's CURRENT attempt.** A superseded attempt's record can be
  appended after the new attempt's (a timeout or cancellation is emitted from the attempt that was
  started, without re-checking whether the step moved on), and keying the lookup on the step alone
  let it overwrite the new attempt's outcome. Keyed by `(stepId, attemptId)`, a step that has moved
  on reports no outcome until its new attempt produces one.
