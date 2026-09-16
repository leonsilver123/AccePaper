# Agent Note: The closed loop, asserted at once

Status: implemented

English | [中文](2026-09-16-the-closed-loop-asserted-at-once.zh.md)

## Problem

The review's R5 asked for one acceptance path: real material → a manuscript constrained by that
material → an injected error → the revision that fixes it → a person's approval of the exact package.

R1 through R4 built the pieces and each has its own tests. That is the problem this note is about.
Every part of a loop can pass on its own while the loop does not close, and that is exactly what the
round before this one looked like: 1665 tests green, both TypeScript faces clean, and every browser
run stopping at `B1-method` because a plan off the wire carried no implementation id. A per-part test
suite cannot see a gap between the parts, because the gap is where no test is.

## Decision

`tests/e2e/closed-loop.spec.ts` asserts the chain as one thing, on the production profile. Four facts,
each false at the start of this round:

1. **A production run reaches the human gate on evidence that exists.** All sixteen steps, `E2-submit`
   `gated`, no submission record. Its B gates anchor on `reviewed source` rather than on
   `MockCitationResolverAdapter`, and its draft records `refusedSections: []` and the evidence each
   section was written from.
2. **An injected error is caught where it is read.** A wrapped D3 executor appends `The improvement
   was 12.5%` — a plausible decimal the run never measured — and the run stops at `D3-writing` with
   `verdicts.A: 'blocked'`. No revised draft, no manuscript, not ready: the number reached no reader.
3. **The revision is re-reviewed.** `D3-writing` and `D4-rebuttal` both pass an A gate whose evidence
   names the manuscript, and the D4 verdict's `targetRefs` are exactly that attempt's commit refs —
   so a report cannot be read as approving a different draft from the one it saw.
4. **Readiness is not approval.** `profileEligible: true`, `submissionReady: false`, the manuscript
   present, and the reason naming `E2-submit` rather than a missing artifact.

The file also pins the negative case, which is the one a pipeline is most likely to have quietly
broken: the shipped study's own measurement REFUTES its predicted direction (−38.2 % where the claim
predicts a rise), and the run completes anyway, with `mvp-results.outcome.verdict: 'refuted'` and
`decisive: true`. Those are two different facts — the experiment ran and spoke against the claim,
rather than failing to run — and a pipeline that cannot tell them apart is one that only finishes on
positive results.

## Alternatives considered

**Treat R1–R4's per-unit tests as the acceptance evidence.** Rejected, and it is the whole reason this
file exists. The per-unit suite was green while the product could not complete a run. The review asked
for a closed-loop acceptance because "each part passes" and "the loop closes" are different claims,
and only one of them is checkable from inside a part.

**Run the acceptance only through the browser probe.** Rejected as the only form, though the probe is
what FOUND the wire-plan defect. It needs a live model, a booted app, a Chrome instance and twenty
minutes, so it cannot be the check that runs on every commit — and a check that runs rarely is one
whose failures are discovered late. Both exist now: this file for every commit, the probe for the
deployment.

**Assert the injected error through a hand-built verdict context rather than a driven run.** Rejected:
the earlier R3 tests already do that, and it is the weaker claim. Wrapping the real executor means
the injection travels the real path — the executor produces the artifact, the driver commits it, the
gate reads what was committed — and the assertion that the run STOPS is only meaningful there.

## Consequences

- `packages/research` is at **1758 passed / 99 files**; `tsc -b tsconfig.host.json` is clean.
- **The browser probe has not re-run to completion since the wire-plan fix.** It found the defect —
  three checks failing, the run stopping at `B1-method` with `{"a2":"passed","steps":5}` — and its
  evidence is what identified the cause: the recorded run spec carried `implementationId: undefined`.
  Three later attempts stalled waiting on a run that now completes all fifteen steps with real model
  calls, which is longer than the harness's first wait. That is a statement about the harness's
  patience and about this machine's model latency, and it is NOT evidence that the fixed build works
  in the browser. The in-process closed loop above is what says the fix holds; an independent browser
  run is still owed.
- **Approval invalidation is asserted elsewhere.** A decision naming an attempt the step has moved
  past is refused by the approval channel (`tests/approval.spec.ts`), and the report half — a verdict
  whose targets are not the attempt's commit — is refused by core's `submitGateVerdict`. This file
  pins the binding those two depend on rather than re-testing them.
- **A refuted prediction is a completed run.** That was already true and had no end-to-end test;
  it has one now, which matters because the shipped study is the refuted case.
