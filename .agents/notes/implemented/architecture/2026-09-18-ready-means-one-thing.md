# Agent Note: Ready means one thing, evaluated in one place

Status: implemented

English | [中文](2026-09-18-ready-means-one-thing.zh.md)

## Problem

Two modules decided whether a run's output was fit to publish, each from its own copy of the conditions. `runner/submission-readiness.ts` answered `SubmissionReadiness`, which the export projects into the manifest as `submissionReady`; `runner/final-package.ts` answered the twelve checks a final package must meet. Six conditions were written twice — profile, manuscript produced, steps closed, sections refused, concerns open, approval stale — and two were written once, only on the package side.

They could therefore disagree, and the pipeline review of 2026-09-18 found the case: a run whose revisions were answered and never read satisfied readiness (`ready: true` in its manifest) while the export refused it for `review-complete`. A reader of the manifest was told the run was ready for something the package would not produce.

## Decision

- **`checkManuscript` is the manuscript's readiness, and the only definition of it.** `final-package.ts` declares `ManuscriptFacts` — the seven conditions about the paper: profile eligibility, a manuscript exists, every step closed, no section was refused for want of evidence, no concern is still open, the approval has not gone stale, the compiled document carries every float, and the review the deployment requires finished. `checkManuscript(facts)` evaluates exactly those.
- **`checkFinalPackage` adds the delivery's conditions to them.** `FinalPackageFacts extends ManuscriptFacts` with the five that are about the package rather than the paper: an approval is recorded, the package carries the files the manuscript declares, the package describes the state the run is in, and that state is on disk. It assembles the two groups through `FINAL_PACKAGE_CHECK_ORDER` so the reported order — and therefore which condition `finalPackageRefusalOf` names first — is exactly what it was.
- **`submissionReadinessOf` is a view of `checkManuscript`.** It takes the facts and reports the first unmet condition's own `detail` as its reason. One function, two scopes: a run cannot be ready in the manifest and refused as a package for a reason about the paper.
- **The facts are gathered once.** `manuscriptFactsOf(store, runId, profile)` reads every manuscript fact off the run; `finalPackageFactsOf` starts from it and adds the delivery's. The export's own compilation reading — `tool`, `floatsDropped` with each float's reason — moved into it, which also fixed a field name: reading `dropped` where the artifact writes `floatsDropped` would have reported an empty list forever.
- **Two reason wordings collapsed into the checks' own.** "An approved step's inputs changed after the decision" and "the manuscript has no X section … refused to write it rather than fill it in" now live on `approval-current` and `no-refused-sections`, and readiness reports them verbatim instead of keeping a second copy that could drift.

## Alternatives considered

- **Have `submissionReadinessOf` build full `FinalPackageFacts` and run `checkFinalPackage`.** Refused: readiness is asked about a RUN, and there is no package — `packagedFiles`, `artifactRefs` and `saveError` would have to be invented, and `required-files-present` would refuse every run for a package that was never written.
- **Keep both copies and add a test that they agree.** Refused: a test pins the cases someone thought of, and the review's case was one nobody had. Two derivations of one fact is the defect; the test would be a description of it.
- **Move everything into one module and delete the other.** Refused: the check vocabulary and the twelve conditions are a package's, and readiness is a run's; the split is real. What was wrong was that both decided the same conditions.
- **Keep readiness's own wording for an open concern.** Refused: the wording is the check's, and two sentences about one condition is a second thing to keep in step.

## Consequences

- **`tests/submission-readiness.spec.ts`** was rewritten around the facts object (12 cases): the pre-existing readiness cases, plus the two conditions the review named — a review that did not finish, and a compiled document that lost a float — and the case that the reported reason follows the FINAL PACKAGE's order rather than readiness's own.
- **`tests/d4-model-revision.spec.ts`** flipped one assertion and it is the point of the change: a run whose revisions are `awaiting-verification`, whose gates all closed and whose package a person approved, is now `ready: false` with "waiting for a reader" as the reason. It used to be `true`.
- **`tests/final-package.spec.ts`** and **`tests/start-run.spec.ts`** assert the single wording.
- **What this is not.** `SubmissionReadiness` still reports only the first unmet condition, because that is what its readers act on; the full list is the package's checks. And the two are not merged into one type: a caller that wants the paper's readiness does not have to hold a package's facts.
- **`openIssuesOf` and `OpenIssue` moved to `final-package.ts`** and are re-exported from `submission-readiness.ts`, so the import direction is one way and no existing importer changed.

## Files

- `packages/research/dsh-research-team/src/runner/final-package.ts` (`ManuscriptFacts`, `checkManuscript`, `FINAL_PACKAGE_CHECK_ORDER`, `manuscriptFactsOf`, `compilationOf`, `reviewOf`, `openIssuesOf`).
- `packages/research/dsh-research-team/src/runner/submission-readiness.ts` (rewritten around `checkManuscript`).
- `packages/research/dsh-research-team/src/runner/package-export.ts` (its own compilation reading removed; the facts read it).
- Specs: `tests/submission-readiness.spec.ts`, `tests/d4-model-revision.spec.ts`, `tests/final-package.spec.ts`, `tests/start-run.spec.ts`, `tests/section-evidence.spec.ts`, `tests/scientific-credibility.spec.ts`.
