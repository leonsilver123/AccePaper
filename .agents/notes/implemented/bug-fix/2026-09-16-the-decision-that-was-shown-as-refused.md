# Agent Note: The decision that was shown as refused

Status: implemented

English | [中文](2026-09-16-the-decision-that-was-shown-as-refused.zh.md)

## Problem

Two ways the workbench told an operator their approval failed when it had succeeded.

**The save failure was dropped.** The host already returns `persisted`, `persistenceError` and
`projectionError` beside the decision, and says why in its own comment: "a failure here does NOT
un-decide anything — the run has the new status in memory — so it is reported alongside the decision
rather than turned into a refusal that would misdescribe what happened." The client's `readDecision`
read `runId`, `stepId`, `attempt`, `status`, `operator` and `snapshot`, and **nothing else**. So a
decision that existed only in the server's memory — lost by the next restart — rendered exactly like
one that reached disk, and the operator decided whether to close the page on a guess.

**A summary that failed to build replaced the decision.** After a successful decision the client
rebuilt the workbench summary. If that threw — a projection the reader could not parse — the handler
returned `{ ok: false, code: 'malformed' }`. The panel then stated a failure where the run said
`passed`, and the operator's reasonable next move was to press Approve again, which comes back
`not-pending` at best.

## Decision

The receipt carries the decision's own identity and its durability: `approvalEventId`, `decidedAt`,
`persisted`, and the two error strings when there are any. The panel states three separate facts
where it used to state one:

1. the decision and who made it (unchanged);
2. **the decision stands and was NOT saved**, with the backend's reason, when `persisted` is false;
3. **the decision stands and the page could not be refreshed**, with why, when there is no summary —
   and the reason distinguishes a backend that did not project (`projectionError`) from a client that
   could not read what it sent.

The three receipt fields are REQUIRED on the wire. A backend that omits them is reported as a client
and host that are not the same build, not defaulted: defaulting `persisted` would invent the one fact
the field exists to carry.

## Alternatives considered

**Default `persisted` to false when absent.** Rejected: it would warn every operator on a host that
predates the field. The field's whole purpose is to distinguish two states, and a default picks one
of them silently.

**Default `persisted` to true when absent.** Rejected harder: it would tell an operator their decision
survives a restart when nothing has established that.

**Report a failed summary as `ok: true` with no other trace.** Rejected: the operator would see a
stale page and no reason for it. The failure is stated — beside the receipt, not instead of it.

**Retry the decision automatically when the summary fails.** Rejected: the decision already landed.
A retry is a second decision, and the backend refuses it at best.

## Consequences

- `tests/approval-panel.dom.spec.ts` pins all three: a refused-but-applied decision shows the receipt
  AND the unsaved warning and is not shown as a failure; an unreadable refresh shows the receipt AND
  the refresh note and does not claim the decision was unsaved; and a receipt without `persisted` is
  refused as a build mismatch rather than defaulted.
- The existing assertions that the panel decides nothing by itself still hold: a refusal leaves the
  gate pending, and only the backend's returned summary replaces what is on screen.
- **What this does not do**: it does not make the decision durable. It makes the operator able to see
  that it is not. Persisting it remains the host's job, and whether an unsaved approval may gate a
  final export is the readiness question the next unit answers.
