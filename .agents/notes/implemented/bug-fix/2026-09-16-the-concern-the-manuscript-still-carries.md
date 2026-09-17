# Agent Note: The concern the manuscript still carries

Status: implemented

English | [中文](2026-09-16-the-concern-the-manuscript-still-carries.zh.md)

## Problem

`D4-rebuttal` records what became of every concern its round raised. An issue is `patched` when a patch changed the body, `accepted_explanation` when the author answered without changing it, and `open` when the applier refused — the patch was written against another version, replaced the body with the same text, or conflicted with another patch to the same section.

`openIssues` was written onto the rebuttal artifact and **read by nobody**. It did not stop `D4-rebuttal` from advancing, and it did not reach `submissionReadinessOf`, which reads only a draft's `refusedSections`. So a run could close every gate, be approved by a person, and export a package — while carrying a concern a reviewer raised that the manuscript never answered. The count existed; nothing acted on it.

## Decision

`openIssuesOf` reads the per-issue outcomes off the `rebuttal` artifact, and `submissionReadinessOf` refuses readiness while the list is non-empty, naming each issue, its section and the applier's reason. `readinessOfRun` reads the artifact and passes it in, next to the refused sections it already passed.

The reason names the issues rather than counting them: "3 issues" is not something a reader can act on, and "`d4-issue-1` on 'method' (the patch replaced the body with the same text)" is.

## Alternatives considered

**Make `D4-rebuttal` fail while an issue is open.** Rejected for now: a revision round that closes most of what it raised is a working round, and failing the step discards the patches it did apply. What is wrong is claiming the RUN is finished, which is readiness's judgement to make. Making the step fail is the right shape only once there is a second round to try — see below.

**Count them instead of naming them.** Rejected: the whole point of the list is that each entry is a specific unanswered concern with a specific cause, and a count throws that away at the last step.

**Only refuse when the open issue is on a section that exists.** Rejected as unnecessary: an issue names a section the applier could not patch, and whether that section exists is already recorded in the outcome's reason. Agreeing with the applier is not this reader's job.

## Consequences

- `tests/d4-model-revision.spec.ts` drives a real revision through the model path where one patch replaces the Method body with the text D3 already wrote, so the applier refuses it as no-diff and leaves that issue open. The step still passes, the run reaches E2, and after a person approves the package readiness is STILL false with `left 1 concern(s) open` and the issue named.
- `openIssuesOf` is tested against the shapes it must not misread: an outcome with no reason is reported as having none rather than invented into a plausible sentence, a closed outcome is not an open issue, and a missing artifact yields an empty list.
- Every existing run keeps its answer: the parameter defaults to empty, so a round that closed everything — which is what the closed loop does — is unaffected.
- **Still missing, and named in the README**: there is no round counter and no revision budget. `roundId` is hard-coded `t19s-rebuttal-1`, so "two rounds of the same failure become a human decision" has nothing to count, and a refusal is reported rather than retried.
