# Agent Note: A reviewer that can only answer, and who counts as a second reader

Status: implemented

English | [中文](2026-09-18-a-reader-the-deployment-supplies.zh.md)

## Problem

`runner/statement-support.ts` and `runner/resolution-verifier.ts` state two seams — whether a passage establishes THIS sentence, and whether a revision answers the issue it was written for — and the team package carried no implementation of either. The seams existed, were checked, and had never been exercised by a real deployment: the shipped bundle named neither, so every run recorded "no sentence was read" and left every issue waiting. A seam with no provider is a design, not a capability.

## Decision

- **`LlmReviewer` is the provider, built on the prose channel.** `src/llm-reviewer.ts` sends the sentence and the passage (or the concern, the answer, the change and the body as it now stands) through the real agent loop and reads one verdict back. It is built on `LlmProseWriter` for the failure handling, not the prompt style: a turn that died mid-stream, a provider error, a session that never settles and an assembly that fails before the request is sent are already refused there with the turn's own reason.
- **The model answers one question and nothing else.** It states the verdict and the basis. `readScope` is COPIED FROM THE JUDGEMENT — a verdict cannot claim a broader reading than the passage it was given, and a reader asked how much it read would answer for the passage it was handed either way. `statementId`, both content versions, `citeKey`, `assessorVersion`, `judgedBy` and `judgedAt` are filled by the class, because a reader that could write its own provenance could certify anything.
- **No default verdict, ever.** A reply with no `SUPPORT`, no `VERDICT`, or a value outside the known set THROWS, quoting the reply's opening text. The seam exists because "nobody could read this sentence" is a different fact from "this sentence holds"; a default would erase exactly that distinction, and it would erase it in the direction of passing.
- **Identity is the ROUTE, not the role.** `LlmReviewer.id` is `llm:<provider>/<model>`, and D4 now passes the answering route as the author id (`authorId` in `runD4Rebuttal`, `llmRoute(analysis)`) instead of the constant `D4_PRODUCER`. A reviewer configured on the same model the prose writer uses is therefore REFUSED with `verification-not-independent` — naming the two roles differently let one model verify its own reply, which is the one thing that check exists to catch. `appliedWithVerification` takes the author identity as a parameter; it is no longer readable from a module constant.
- **The bundle names the assessor and states the floor, and does NOT name a verifier.** `packages/bundle/research-app/cordis.patch.yml` enables `review.assessor` on `deepseek-v4-flash` with `policyVersion: sentence-vs-passage-1` and `minimumRounds: 2`. The verifier is left unnamed WITH its reason written down: this deployment writes its prose on the same route, so naming it would make D4 refuse every verification and fail the step. Until a deployment gives the reviewer its own route, the run leaves every revision pending, the review is unsatisfied, and `checkFinalPackage` refuses the paper a journal would receive while still exporting the draft. That is the honest state — nobody read the answers — and it is not one a relabelled profile can make go away.

## Alternatives considered

- **Ask the model for the read scope too.** Refused: it is a fact about the reading that was made, and the reader would answer for the passage it was handed regardless. The judgement already carries it.
- **Default an unparseable verdict to `partial` or `unrelated`.** Refused: both are refusals downstream, so the default would make every unreadable reply a refused sentence — turning "the reviewer broke" into "the manuscript is bad", which is a different failure reported as a worse one.
- **Keep `D4_PRODUCER` as the author and give the verifier a role-prefixed id.** Refused: that is the arrangement in which one model certifies its own answer while the check reports independence. The ids have to be comparable to be worth comparing.
- **Enable `review.verifier` on the prose route and accept the nominal pass.** Refused outright — it would make the shipped profile produce a package whose revisions nobody read, which is the defect the pipeline review of 2026-09-18 is about.

## Consequences

- **`tests/llm-reviewer.spec.ts`** (9 cases, real composition): the host services are mounted as a boot provides them and a scripted adapter stands in for the vendor, so the prompt, the session and the cancellation machinery are the shipped ones. The cases assert the REQUEST ARRIVED (the adapter's own record names the sentence and the passage), that the identity and versions come from what the reviewer was given, that a model claiming `SCOPE: full-text` does not move the recorded scope, and the three refusals: no verdict stated, a verdict outside the set, and a basis missing. A failed turn is reported as a failure rather than as a verdict.
- **`tests/d4-model-revision.spec.ts`** gained the independence case on the production path: a verifier reporting `verifiedBy: 'llm:test-provider/test-model'` — the route the staged writer states — leaves D4 `in_progress` with `verification-not-independent` and no rebuttal artifact.
- **What this is not.** The shipped profile still cannot reach a final package, because it has no independent verifier; that is a deployment gap, recorded in `cordis.patch.yml` beside the row it belongs to. And the assessor is one call per citing sentence, which the deployment pays for on every run — the cost is stated where the row is enabled, not discovered.

## Files

- `packages/research/dsh-research-cordis/src/llm-reviewer.ts` (new), `src/index.ts` (`review` config, the two reviewer fields, the floor).
- `packages/research/dsh-research-team/src/runner/registry.ts` (`authorId`, `llmRoute`, `appliedWithVerification`).
- `packages/bundle/research-app/cordis.patch.yml` (the assessor row, the floor, and why the verifier is unnamed).
- Specs: `packages/research/dsh-research-cordis/tests/llm-reviewer.spec.ts` (new), `packages/research/dsh-research-team/tests/d4-model-revision.spec.ts`.
