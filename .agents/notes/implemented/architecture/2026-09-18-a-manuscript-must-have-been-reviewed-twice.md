# Agent Note: A manuscript must have had the review the deployment requires

Status: implemented

English | [中文](2026-09-18-a-manuscript-must-have-been-reviewed-twice.zh.md)

## Problem

`revisionRounds` bounded how many times the AUTHOR could be asked, and the cycle stopped as soon as a round closed its issues. The two were read for each other: "at most two rounds" became "one round that closed everything is enough", so a manuscript could reach a package having been read once — and the pipeline review of 2026-09-18 named it as the reason the two-round target was never actually enforced.

## Decision

- **`runner/review-policy.ts` states the floor.** `ReviewPolicy { minimumRounds }`, default two: how many COMPLETE readings a manuscript must have had. It is a deployment fact like the evidence profile, carried on the run and recorded on the artifact, because a deployment that requires one reading is making a decision it is allowed to make, and one that requires two must not be satisfied by one.
- **What counts.** A round the author answered as before (`no-progress`) is not a second reading — counting it would let a two-round policy be met by one round taken twice. An issue that is `open` or `pending-verification` is a debt, not an answer, so a review carrying either has not finished however many rounds it took.
- **D4 keeps asking while the floor is unmet.** A round that closes everything but is not the deployment's minimum gets another reading; `awaiting-verification` does NOT continue, because the answers are on the table and only a reader can settle them — asking the author again would produce the same answers. The round is RECORDED BEFORE the floor is consulted, so a reading that was taken is always a reading the record shows.
- **`checkFinalPackage` gained `review-complete`.** A manuscript whose review did not finish may be exported as the draft it is and is refused as the paper a journal receives. The evaluation is made where the rounds were taken and travels on the artifact, so the check and the run's own record cannot disagree about what happened.
- **The service reads the reviewer-side capabilities off the deployment** (`statementAssessor`, `resolutionVerifier`, `reviewPolicy`), the way it already read the compiler and the figure provider — until now they were reachable only by a test passing `DriveOptions` directly.

## Alternatives considered

- **Raise `revisionRounds` and call it a floor.** Refused: the bound counts asks and the floor counts readings, and a run whose first round closes everything asks nobody — it would satisfy the higher bound with one reading.
- **Derive the review state in `final-package` from the round count.** Refused: the policy's evaluation belongs where the rounds are taken (the artifacts already carry the outcomes), and a second derivation is a second thing that can disagree.
- **Let a deployment that reviewed once reach a final package silently.** Refused: it states one round, and the artifact says so.

## Consequences

- **`tests/review-policy.spec.ts`** (7 cases): the default is two; too few rounds refused; an open issue refused; a pending revision refused; a `no-progress` round not counted; two real rounds satisfied; a first round that found nothing still counts as a reading. **`tests/d4-model-revision.spec.ts`** gained the floor case on the production path: a first round that closes everything, under a two-round policy with a reader configured, takes a second reading. **`tests/start-run.spec.ts`** gained the refusal end to end: the same approved production run is exportable as a draft and refused as final, with `review-complete` naming why.
- **The two existing production-path cases now state their policy where the review happens** — in the process that conducts it, not the one that exports — and the success case supplies a reader, because a final package requires the revisions to have been read. The fixture's stand-in says in its own `basis` that it read nothing.
- **What this is not.** The rounds are still the D4 cycle's (one call raises the concerns and answers them); a separate reviewer producing its own `ReviewRound` is the next unit. And the floor counts rounds the run took — a deployment that wants two INDEPENDENT reviewers needs the reviewer seam, not a higher number here.

## Files

- `packages/research/dsh-research-team/src/runner/review-policy.ts` (new), `src/runner/registry.ts` (the floor, the recorded evaluation), `src/runner/final-package.ts` (`review-complete` and the fact), `src/runner/package-export.ts` (the fact is read off the rebuttal artifact), `src/runner/types.ts` / `drive.ts` (the option), `src/index.ts` (the service reads the three reviewer-side capabilities).
- Specs: `tests/review-policy.spec.ts` (new), `tests/d4-model-revision.spec.ts`, `tests/start-run.spec.ts`, `tests/fixtures/approve-restart/approve-and-exit.ts` (`--review-rounds`, `--verify`).
- `packages/research/dsh-research-team/README.md` / `README.zh.md`.
