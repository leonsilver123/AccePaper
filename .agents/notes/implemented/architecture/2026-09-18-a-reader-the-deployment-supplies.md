# Agent Note: A reviewer that can only answer, and who counts as a second reader

Status: implemented

English | [中文](2026-09-18-a-reader-the-deployment-supplies.zh.md)

## Problem

`runner/statement-support.ts` and `runner/resolution-verifier.ts` state two seams — whether a passage establishes THIS sentence, and whether a revision answers the issue it was written for — and the team package carried no implementation of either. The seams existed, were checked, and had never been exercised by a real deployment: the shipped bundle named neither, so every run recorded "no sentence was read" and left every issue waiting. A seam with no provider is a design, not a capability.

## Decision

- **`LlmReviewer` is the provider, built on the prose channel.** `src/llm-reviewer.ts` sends the sentence and the passage (or the concern, the answer, the change and the body as it now stands) through the real agent loop and reads one verdict back. It is built on `LlmProseWriter` for the failure handling, not the prompt style: a turn that died mid-stream, a provider error, a session that never settles and an assembly that fails before the request is sent are already refused there with the turn's own reason.
- **The model answers one question and nothing else.** It states the verdict and the basis. `readScope` is COPIED FROM THE JUDGEMENT — a verdict cannot claim a broader reading than the passage it was given, and a reader asked how much it read would answer for the passage it was handed either way. `statementId`, both content versions, `citeKey`, `assessorVersion`, `judgedBy` and `judgedAt` are filled by the class, because a reader that could write its own provenance could certify anything.
- **No default verdict, ever.** A reply with no `SUPPORT`, no `VERDICT`, or a value outside the known set THROWS, quoting the reply's opening text. The seam exists because "nobody could read this sentence" is a different fact from "this sentence holds"; a default would erase exactly that distinction, and it would erase it in the direction of passing.
- **A VERDICT CARRIES NO IDENTITY.** The first version had `LlmReviewer` report `verifiedBy` as its own `<provider>/<model>` and had D4 refuse a verification from the author's route. The user's ruling of 2026-09-18 corrected it: a second model is not what makes a reading independent, and requiring one was a restriction the implementation had added — it made a single-model deployment unable to verify anything, while a two-model one looked independent sharing a single session and a single rulebook. `ResolutionVerdict` is now `{verdict, basis, evidenceRead}` and NOTHING else, so a reader cannot name itself and cannot be renamed past a check; `verifyPending` builds the record from what the HOST knows.
- **What independence is instead.** Four conditions, each with its own refusal: the two runs are different EXECUTIONS (`verification-same-execution` — and because the id is the host's, renaming the reader changes nothing), different SESSIONS (`verification-same-session`, because a session carries the revision's own defence forward), different RULES (`verification-wrong-role` — two roles are distinct tasks by their instructions, not by their display name), and the role itself is the verifier's (`verification-wrong-role` when a deployment hands it the author's). A decision is refused when nothing was read (`verification-no-evidence`) and when it is about a body the run has since moved (`verification-stale`), which is what binds a reading to the version it read.
- **`abstained` is the third verdict.** A reader short of evidence has to be able to say so; with only `verified` and `rejected` it would have to guess, and an abstention leaves the issue exactly where it was — a debt a reader can see, not a closure and not a refusal.
- **The model behind each execution is RECORDED, not gated.** `sharesAuthorRoute` travels on every verification, so a reader can weigh the shared-bias risk of one model writing and reviewing. It is a note; it is never a refusal.
- **The bundle enables the verifier on the same model the prose uses.** `packages/bundle/research-app/cordis.patch.yml` names `review.assessor` and `review.verifier` both on `deepseek-v4-flash`, with `minimumRounds: 2` and an `instructionsVersion` for the review rules. The comment that used to require a second route — and that made a single-model deployment unable to produce a final package — is gone, with the correction written where the false rule was.

## Alternatives considered

- **Require a second model route for the verifier.** Refused by the user's ruling: a different model may not substitute for the conditions that make a reading independent, and the same model must not be refused for being the same model.
- **Ask the model for the read scope too.** Refused: it is a fact about the reading that was made, and the reader would answer for the passage it was handed regardless. The judgement already carries it.
- **Default an unparseable verdict to `partial` or `unrelated`.** Refused: both are refusals downstream, so the default would make every unreadable reply a refused sentence — turning "the reviewer broke" into "the manuscript is bad", which is a different failure reported as a worse one.
- **Give the verifier a role-prefixed route so the old comparison passes.** Refused, and named by the user as a way of cheating the check: prefixing a string establishes no session, no permission and no reading. The identity had to stop being the reader's to state at all.
- **Let the author's own execution verify, on the grounds that it is a different call.** Refused: the same execution carries the revision's defence, so the reading is the author's own account of the change rather than the change.

## Consequences

- **`tests/llm-reviewer.spec.ts`** (9 cases, real composition): the host services are mounted as a boot provides them and a scripted adapter stands in for the vendor, so the prompt, the session and the cancellation machinery are the shipped ones. The cases assert the REQUEST ARRIVED (the adapter's own record names the sentence and the passage), that the identity and versions come from what the reviewer was given, that a model claiming `SCOPE: full-text` does not move the recorded scope, and the three refusals: no verdict stated, a verdict outside the set, and a basis missing. A failed turn is reported as a failure rather than as a verdict.
- **`tests/d4-model-revision.spec.ts`** carries both directions on the production path: one model holding both roles IS accepted (the staged writer and the reviewer share `test-provider/test-model`), with `sharesAuthorRoute: true` on the record and the host's execution, session and rules version beside it; and a verifier that decides `verified` with an empty reading list leaves its issue `pending-verification` rather than closing it.
- **What this is not.** Same-model role separation does not make two readings cognitively independent — human spot-checks and adversarial samples remain necessary, and a shared route is recorded for exactly that reason. And the assessor is one call per citing sentence, which the deployment pays for on every run; the cost is stated where the row is enabled.

## Files

- `packages/research/dsh-research-cordis/src/llm-reviewer.ts` (new), `src/index.ts` (`review` config, the two reviewer fields, the floor).
- `packages/research/dsh-research-team/src/runner/registry.ts` (`authorId`, `llmRoute`, `appliedWithVerification`).
- `packages/bundle/research-app/cordis.patch.yml` (the assessor row, the floor, and why the verifier is unnamed).
- Specs: `packages/research/dsh-research-cordis/tests/llm-reviewer.spec.ts` (new), `packages/research/dsh-research-team/tests/d4-model-revision.spec.ts`.
