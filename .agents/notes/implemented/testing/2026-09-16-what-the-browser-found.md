# Agent Note: What the browser found that the suite could not

Status: implemented

English | [中文](2026-09-16-what-the-browser-found.zh.md)

## Problem

By the end of this round the research packages had 1758 passing tests across 99 files, two clean
TypeScript faces and five green documentation gates. The product could not complete a run.

That is not a coincidence and it is not a criticism of the tests. Every test in the suite drives
`runT19B` in-process with a plan built in TypeScript; the product is a browser talking to a booted
app over a generated wire protocol, with a model in the loop and a live catalogue behind it. The gap
between those two is where this round's defects lived, and none of them was reachable from inside a
test.

## What the browser found

Four separate defects, in the order they appeared. Each is fixed and pinned; the first two were
product defects and the second two were mine.

**1. A plan the pipeline could not execute, discovered four steps in.** A wire plan carries no
`implementationId` — a proposal knows what it is studying, not which code the deployment can run —
and `requirePlan` accepted one. `B1-method` then threw, `runStep` left the step `in_progress`, and
the run simply stopped with no visible error. Every browser run did this. Measured:
`{"a2":"passed","steps":5}`.

**2. The number check read a references section's identifiers as measurements.** With the run
reaching D3, `red-stat` refused a correct manuscript for citing 47 DOIs — `10.1016/j.trb.2025.103352`,
`18051527`, `802.11` — as numbers the run never measured, and blocked the step. The first fix (strip
DOI/URL/arXiv/bracket shapes) was a scheme list, which is one scheme away from the next false
refusal; the rule that holds is narrower and truer: the check reads the sections that state results,
and a reference list is not one of them.

**3. A wire-type change needs BOTH faces rebuilt.** Adding the required `MeasuredMetric.unit` broke
the browser while every in-process test passed: the client bundle's generated wire schema predated
the field, so it stripped it and the host answered
`gateway/input-invalid: typert gateway: research/run: wire field "request" failed boundary
validation`. The tab rendered its empty state and no run was created — which reads like "the run
never started", not like a schema mismatch. The identity check does not catch it: it compares the
install against the worktree's `lib/`, and both are stale together.

**4. An outage said nothing about itself.** `A1-landscape` failed with "the catalogue is
UNAVAILABLE" and no reason. `LiteratureSearchOutcome` has carried a `detail` since the seam was
written, and `buildArtifact` dropped it, so an HTTP 403, a rate limit, a DNS failure and a refused
venue filter were indistinguishable at the last step — and reproducing the same request shape from
outside the app process succeeded every time. That made the one question that mattered — is this the
environment or my change — unanswerable.

## What this changes about how the round is verified

The browser probe is not a slower version of the suite; it is the only thing that can see this class
of defect. The suite's 1758 tests say the parts work. The probe says the product works, and this
round the two answers differed four times.

The cost is real and worth stating: one probe cycle is a full build of both faces, a profile-install
refresh, a booted app, a Chrome instance and up to twenty minutes of a live model driving sixteen
steps. That is why the probe runs per delivery and not per commit, and why the closed loop in
`tests/e2e/closed-loop.spec.ts` exists beside it.

## Consequences

- All four defects are fixed, each with a test built from what the browser actually produced rather
  than from a shape invented to fail: the wire-plan fix has a driven run through B1; the identifier
  fix is pinned with the real strings (`doi:10.1016/j.trb.2025.103352`, `18051527`, `802.11p`) plus
  one that proves a measurement beside an identifier is still refused; the twin fix is a field; the
  outage detail travels from the adapter through the tool to the step's refusal.
- **The A1 outage itself is environmental and unexplained.** The adapter reports `unavailable` in the
  app process while the identical request from a plain Node process on this host answers 200 — and
  a later probe run passed A1 and retrieved its records. Two runs failed at A1 and one succeeded, on
  the same build. This repository's own plan notes record OpenAlex having rate-limited this machine
  before, and that remains the most likely explanation; it is not established.
- **A1's behaviour under that outage is correct and unchanged**: an outage fails the step rather
  than producing an empty landscape, because a landscape derived from no records is an invented one.
- **The browser loop has still not been observed reaching `E2-submit`.** The furthest a browser run
  has got is D3, and each stop so far has been a defect that is now fixed or an outage. The
  in-process closed loop is what says the chain closes; the browser has confirmed the parts of it
  that only a browser can, and that distinction is the point of this note.
