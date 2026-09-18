# Agent Note: An issue is closed by a reader, not by the act of revising

Status: implemented

English | [中文](2026-09-18-an-issue-is-closed-by-a-reader.zh.md)

## Problem

The pipeline review of 2026-09-18 named this a P0: D4 produced its review concerns and its revisions in one writing call, and `applyRevision` disposed of an issue by what the round DID — `patched` when a patch applied, `accepted_explanation` when the answer was non-empty. Neither is evidence that the concern is answered. A patch can land beside the sentence it is about, and an explanation is prose the author wrote about their own work. The cycle then reported `closed` and stopped, so the earliest possible stop was also the one that looked most settled.

## Decision

- **`applyRevision` produces two dispositions and neither closes an issue.** `pending-verification` means the round produced something to check (a replacement body, or an argument for changing nothing); `open` means it produced neither — no such section, a patch written against a body that has since moved, or a "revision" that proposes no diff. The artifacts carry `awaitingVerification` beside `openIssues`, because a reader who saw one number could not tell which kind of debt it was.
- **`runner/resolution-verifier.ts` states the third act.** A deployment supplies a `ResolutionVerifier`; `verifyPending` asks it about every pending issue, handing it the concern, the answer, the change and the body as it now stands, and `verifyResolution` turns its `verified` into `answered` (the only disposition that closes an issue) or its `rejected` into `open` with the reader's reason.
- **Independence is enforced, not requested.** A verification whose `verifiedBy` is the run's D4 producer is refused with `verification-not-independent`, and the step fails rather than recording it: an answer cannot certify itself. A verification of an issue nothing left pending is refused as well.
- **The cycle's stop reason distinguishes waiting from finishing.** `closed` when nothing is owed; `awaiting-verification` when the answers are on the table and no reader has seen them, because asking the author again would produce the same answers — that state is not a budget exhaustion and must not be reported as one. A deployment with no verifier leaves its issues waiting.

## Alternatives considered

- **Keep `patched` but add a verification flag.** Refused: the disposition IS the claim about the issue, and a flag beside it would leave every existing reader reading `patched` as handled.
- **Let the revision author verify its own work when no verifier is configured.** Refused — that is the defect. No verifier means the issues wait, visibly.
- **Verify at E1 instead of in D4.** Refused: E1 publishes a manuscript and cannot send an issue back for another round, which is the whole point of the reading.

## Consequences

- **Eight cases in `tests/resolution-verifier.spec.ts`**: pending → answered; rejected → back to open with the reason; a verification from the author refused; a reading of an issue nothing left pending refused; through the run, a deployment with a verifier settles its round (`closed`, every issue `answered`) and ONE WHOSE VERIFIER IS THE AUTHOR FAILS THE STEP with `verification-not-independent`; and the verifier is handed the change and the resulting body, not only the argument.
- **The existing D4 cases were updated to the new truth** (`tests/d4-model-revision.spec.ts`): three applied patches now read `pending-verification`, and a two-round cycle with no verifier reports `awaiting-verification` rather than `closed`.
- **What this is not.** It does not yet require a MINIMUM number of review rounds, and it does not stop a run whose revisions are unverified from exporting a draft — the final-package condition for that is the next unit. The verdict is the deployment's reader; the shipped bundle names none, so shipped runs leave every issue waiting and say so.

## Files

- `packages/research/dsh-research-team/src/runner/issue-patch.ts` (dispositions, `awaitingVerification`), `src/runner/resolution-verifier.ts` (new), `src/runner/registry.ts` (D4 applies then verifies; the stop reason splits), `src/runner/types.ts` (`DriveOptions.resolutionVerifier`), `src/runner/drive.ts` (carried).
- `packages/research/dsh-research-team/README.md` / `README.zh.md`.
- Specs: `tests/resolution-verifier.spec.ts` (new), `tests/issue-patch.spec.ts`, `tests/d4-model-revision.spec.ts`.
