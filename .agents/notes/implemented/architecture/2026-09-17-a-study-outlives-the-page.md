# Agent Note: A study outlives the page that started it

Status: implemented

English | [中文](2026-09-17-a-study-outlives-the-page.zh.md)

## Problem

The only handle the deployment ever handed out for a study was the run id, and the page kept it in its own storage. Everything else about a run was on disk — the snapshot, the artifacts, the gate verdicts — so a person who closed the tab, reloaded, or opened the application on another machine had a deployment full of finished and unfinished studies and no way to name any of them. The run control said nothing had been run in this session, which was true of the session and false of the deployment.

The disconnect-recovery work needs the same read: the acceptance it must pass is that a study being driven is still found after a reload, and that a page opened after a service restart shows the study as interrupted rather than absent. Neither can be answered by anything the page remembered, because a fresh page remembers nothing.

## Decision

**The deployment answers what studies it holds, and the workbench offers them as a list to pick from.**

- `@Remote('listRuns')` returns one entry per study, newest first. An entry carries the id, the execution state, the project revision, how many steps passed of how many the pipeline catalogues, whether the run is submission-ready, and the two failure facts a person needs to act on: why the last save did not land, and why a driver stopped.
- **A run this process holds is reported from its live state; a run it does not hold is reported from its file as `stopped`.** One run appears exactly once even when it is both held and stored, because the live state is the state its own readers see. `stopped` says only that nothing in this process drives it — the entry also carries the steps that were in flight when the snapshot was taken, which is what makes an interrupted study distinguishable from one that finished.
- **The order is the id's, not the revision's.** A revision counts what one study committed and cannot order two studies against each other; the directory listing's order belongs to the filesystem. Ids are UUIDs, so ordering by them is stable across calls and across processes.
- **A list that could not be read is reported, not rendered as "no studies".** The client rejects with the host's own reason where a reader can see it. "This deployment holds no study" and "I could not ask" have different remedies, and one of them is not "your work is gone".
- The picker is offered only by a host that can both list studies and open one; opening performs the same follow the run control performs, and remembers the id, so a reload lands on the same study.

## Alternatives considered

**Remember the run id in `localStorage` instead of session storage.** The cheapest repair, and it answers the wrong question: a handle that outlives the tab comes back on the NEXT visit, and a day-old run would be opened and reported `stopped` to a reader who did not come back for it. Remembering what this visit was watching is a session fact; finding a study is a deployment read.

**Keep a per-browser "recent studies" list on the host.** It makes the deployment remember which browser started what, which the deployment has no reason to know, and it still shows nothing to the browser that did not start the run — the case the acceptance is about.

**Open the newest study automatically on a page with nothing on screen.** It puts a reader who came for one thing inside a study they did not choose, and it turns an empty page into a claim about which study matters. The list states what exists and lets the reader pick.

**Derive the list from the snapshot directory listing alone.** It leaves out exactly the study a person is most likely looking for: a run this process is driving has no snapshot directory of its own yet.

## Consequences

- A study is findable by a browser that knows nothing about it, which is what the reload, close-and- reopen, and service-restart acceptances need.
- The page gained its first read that is not about a run it already names, and its first control whose absence is meaningful: a host that cannot list studies shows no picker rather than an empty one.
- **A new `@Remote` method has to reach four places, and the last one is a build artifact.** The method must exist in the source, in the host's generated registry, in its own package's `lib/`, and in the Remote assembly bundle the browser actually calls through (`dsh-api-remotes/lib/client.js`), which INLINES each package's generated descriptors. A build that bundled before the generator rewrote them leaves the page a method behind, and the page reports it as `listRuns is not a function` — which reads like a mounting or caching bug and is neither. The browser acceptance probe now refuses to run against an assembly that lacks a method it calls.
- **What this does not do**: it lists studies, and says nothing about which one a person was watching. Restoring that is the page's own remembered handle, unchanged by this note.
