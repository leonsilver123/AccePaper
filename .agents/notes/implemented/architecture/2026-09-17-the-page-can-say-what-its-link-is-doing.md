# Agent Note: The page can say what its link is doing

Status: implemented

English | [中文](2026-09-17-the-page-can-say-what-its-link-is-doing.zh.md)

## Problem

The follow loop already recovered from everything that can go wrong with a subscription: it re-opened a stream whose cursor the host refused, noticed a frame that did not continue the position it held, re-opened rather than applying it, and gave up after a bounded number of attempts with an error. None of that reached the reader. A page that had stopped receiving updates rendered exactly like a study that had stopped producing them — same last state, same silence — and the only difference was in a promise nobody was looking at.

The same silence decided permissions. A decision is about a project revision; a page that cannot reach the deployment cannot know the run is still at the revision it is showing. The backend refuses a stale decision, so nothing wrong was ever recorded — but the page offered the click anyway, and the way a person learned the link was down was by spending it.

## Decision

**The link's state is a named value, the loop reports it, and the page states it.**

- `connection-state.ts` holds seven phases — `idle`, `connecting`, `live`, `reconnecting`, `resyncing`, `offline`, `disposed` — and the transitions between them, as a pure function of events. The events are what actually happens to a subscription: a first open, a re-open, a frame, a refused cursor, a failure, an exhausted budget, disposal.
- **`live` requires a frame.** An open that has been requested is not a connection, and reporting one would be the page claiming a link it has not made. A frame also clears the last failure's reason: a live link with a stale reason beside it reports a problem that is over.
- **A disposed link ignores everything.** A frame already in flight must not move a page that has let go of a run back into `live`.
- **Only the disconnected phases close a revision-bound write.** Not "everything that is not live": a run followed to its rest leaves the link `disposed`, and the human gate is reached exactly there — a rule that demanded `live` would make a finished study undecidable. `idle` and `connecting` are open for the same reason in reverse: a page that has opened nothing has nothing to be stale about.
- **The page says which of the two facts it is reporting.** The line states what the link is doing, and the "may not be current" note is attached only when the page has STOPPED repairing it — `offline`. While reconnecting, the state on screen is stale too, but the page is actively fixing it, and a reader told "not current" about a repair in progress would be told the wrong thing to do about it.
- The workbench renders the phase for a run on screen only, and passes the write gate to the approval and revision panels, which disable their controls with the reason stated rather than disappearing.

## Alternatives considered

**A spinner, or a "reconnecting…" banner.** It says something is happening and not what, and it has no ending: a page that gave up after three attempts would show the same banner as one on its first retry.

**Have the panel infer the link's health from how long ago the last update arrived.** A study that is genuinely between steps is silent for as long as a broken link, so a timer would report a healthy run as disconnected — the same conflation, reached from the other side.

**Disable every control that writes while the link is not live.** It closes the gate on a finished study, which is the one state where a person must be able to act.

**Keep the phase in the follow loop and let components read the promise's state.** `pending` covers opening, reconnecting and giving up alike; the distinctions are exactly what a reader needs, and the loop is the only layer that has them.

## Consequences

- A reader can tell a study that stopped producing updates from a page that stopped receiving them, and a decision is offered only when the page can stand behind the revision it names.
- The reconnect budget now has a user-visible meaning: `MAX_FOLLOW_ATTEMPTS` is why the page says `offline` rather than "reconnecting" forever, and both modules state the same number.
- **Not done**: the phase covers the run-following link only. A page that is idle before any run, or a host that injects a summary and never follows anything, reports `idle` for its whole life — which is honest, and is not a statement about any other connection the app may hold.
