# Agent Note: A change request is answered by a candidate, and judged before it is believed

Status: implemented

English | [中文](2026-09-17-a-request-is-answered-by-a-candidate.zh.md)

## Problem

A change request at the human gate recorded an instruction and left the gate open. Nothing in the
system answered it. The work that would — rewriting the sections the person complained about,
checking that the rewrite introduced nothing the study does not have, and showing both to the person
— happened outside the product, in a chat or an editor, and the run never learned that it had been
asked for anything. The instruction was durable and alone.

## Decision

**The request becomes an object, a candidate answers it, and checks judge the candidate.**

- **The decision starts the loop.** The approval endpoint takes a hook, and the service implements it:
  an applied `request_changes` decision records a `RevisionRequestRecord` naming every section of the
  manuscript with the body hash it had, and the sections the instruction is about. The hook is awaited
  (so a caller that decides and immediately reads the loop sees the request), and its failures cannot
  change the answer — the decision is applied and durable before it runs.
- **A request is about something.** It carries the sections the writer should rewrite; the rest of the
  manuscript is carried in the candidate unchanged, because "tighten the claim in the results" is not
  a licence to rewrite the paper.
- **A candidate is written against the version the request read.** The basis is RE-READ at write time:
  a manuscript that moved since the person read it — another revision, a rollback, a re-format — is
  refused rather than replaced by text answering a document nobody has. A request naming a section the
  manuscript no longer has is refused, and so is a writer that returns nothing for one.
- **The writer is the deployment's own prose channel**, the seam D3 and D4 write through, so a
  candidate carries the same provenance as the manuscript it revises, and it is recorded on the
  candidate rather than assumed.
- **The checks read the run, not the text.** A changed section's numbers must be numbers the run
  declares or measured; its citation labels must be in the manuscript's reference list; the candidate
  must have exactly the sections the manuscript has. A review that took its expectations from the text
  under test would pass whatever the text said.
- **Every record is durable and version-bound.** The request, its candidates and their reviews live
  under the deployment's snapshot root (`revisions/<requestId>/`), written by write-and-rename, and a
  review names the candidate hash it judged. A restart reads the same loop, and a page that never saw
  the decision still shows what was asked, what answered it, and what the checks said.
- **What the page does not offer is an accept, and it says so.** Making a candidate the official
  manuscript needs the accepting transaction the module design describes — version comparison,
  reference validation, an atomic write over the registry, downstream invalidation — as a core
  operation with its own production caller. Until that exists the panel offers no such control and
  states the gap where a person would look for it, rather than rendering a candidate as accepted.

## Alternatives considered

**Let the page hold the loop in its own state.** It costs no durable record and it makes the request a
fact about one tab: a reload shows an empty panel over a manuscript somebody asked to change, and the
answer dies with the browser.

**Rewrite the whole manuscript for every request.** Simpler to implement — one writer call, no targets
— and it produces a different paper wearing the same title, with every section's hash moved so no
earlier review can be compared against anything.

**Take the writer's word for what changed.** A candidate could report the sections it changed and the
hashes it produced. Then a writer that claimed "nothing changed" while rewriting the results would be
believed, which is exactly the failure the basis hash exists to catch.

**Accept the candidate in this module, over the artifact registry.** `recordArtifact` writes only
inside a step's in-progress attempt and E1-format committed before anyone read the paper, so an accept
here would either be a per-slug write beside a receipt that still describes the old value — the
registry and the receipt disagreeing — or a step rolled back to `in_progress` to make room for a
hand-written manuscript. Both report the study as at a state it never reached. The accept is left out
and recorded as the gap.

## Consequences

- The loop a person's instruction opens now has a durable shape: request, candidate, diff, review —
  each bound to a version, each readable after a restart.
- **The loop does not close.** A reviewed candidate cannot become the official manuscript, so answering
  a request is still work the product cannot finish; the page says so rather than implying otherwise.
- The web package gained a tenth tab whose content is entirely host-read, and the client gained three
  Remote methods (`listRevisions`, `requestRevision`, `generateCandidate`, `reviewCandidate`) whose
  descriptors must reach the browser's Remote assembly bundle like every other method.
