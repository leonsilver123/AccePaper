# Agent Note: The header that said "completed" over a pending gate

Status: implemented

English | [中文](2026-09-16-the-header-that-said-completed-over-a-pending-gate.zh.md)

## Problem

`runStatusOf` derived the run status from the step outcomes and returned four values:

```ts
if (steps.some(step => step.status === 'failed')) return 'failed'
if (gates.some(gate => gate.outcome === 'abstained')) return 'abstained'
if (steps.some(step => step.status === 'pending' || step.status === 'in_progress')) return 'running'
return 'completed'
```

A step at `gated` is neither failed, nor abstained, nor pending, nor in progress. So a run that had
closed every automatable step and stopped at `E2-submit` — waiting for a person to look at it — was
reported as **completed**. The comment even said why, as if it were a design choice: "a run that
finished its automatable work — leaving only the human gate — is `completed`, because waiting for a
person is the design."

Waiting for a person IS the design. Saying the work is over is not. The header is the first thing a
reader sees, and it said the one thing that would make them stop looking.

The same promise was in the intro copy: "One claim becomes a **submittable** manuscript only by
surviving all 16 steps."

## Decision

`RunStatus` gains `awaiting-approval`, returned when every automatable step has closed and one is
`gated`. `completed` now means what it says: nothing is waiting for anybody.

The intro copy says what surviving the sixteen steps actually produces — a manuscript whose
**material** is complete — and names what else submittability takes: the production evidence
profile, every gate closed, no unclosed reviewer concern, and a person's approval.

## Alternatives considered

**Keep `completed` and add a badge next to it.** Rejected: two statements in one header, and the
louder one is the wrong one. A reader who stops at "completed" never reads the badge.

**Report `awaiting-approval` only when the gate is the LAST step.** Rejected: the fact is about the
run, not about the step's index. A run held at an earlier human gate is waiting just as much, and
`humanPending` already names which gate it is.

**Call it `blocked`.** Rejected: nothing is blocked. The pipeline is where it should be and the
action is the reader's; a word that reads as a fault sends them looking for something to fix.

**Leave the intro copy alone; it is marketing prose.** Rejected: it is the first paragraph under the
title, and it states a rule about the product that is false. The repository's rule is that a claim
about what a system does has to be what it does.

## Consequences

- `tests/run-source.spec.ts` pins the ranking (failure, abstention, unfinished, waiting, done) and
  adds a whole-chain case: the shared wire fixture — A1 passed, E2 gated — reads as
  `awaiting-approval`, with `humanPending` still naming the gate the reader has to decide.
- The header, the summary panel and every locale-driven label follow from `RunStatus`, so the new
  value renders through the existing `status.*` lookup in both languages.
- The same pass declares the four readiness facts on the client twin — `evidenceProfile`,
  `profileEligible`, `submissionReady`, `readinessNote` — and states the mode and the readiness in
  the workbench header. The twin had not declared them, so the browser received all four and could
  name none.
- **What this does not do**: the QUALITY state (a required check that never ran) is still not
  surfaced as its own fact, and neither is the APPROVAL state. Execution, mode and readiness are now
  distinct; those two are not.
