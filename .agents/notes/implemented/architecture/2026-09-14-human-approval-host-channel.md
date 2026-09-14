# Agent Note: Human approval reaches the host's trust channel

Status: implemented

English | [中文](2026-09-14-human-approval-host-channel.zh.md)

## Problem

`E2-submit` is the pipeline's only `humanGate` step. Core parks it at `gated`, and the one function that can move it on — `_applyHumanApproval` — is package-private and reachable only through the host trust channel in `dsh-research-core/host`. No host or bootstrap code called `createHostApprovalChannel`: the library had a singleton minter, a principal guard and a set of tests, and no production caller. On the browser side `ApprovalPanel` held a local `decisions` record and rendered "approved (demo)" — a decision the backend had never heard of. The two halves were shells with nothing between them.

The harder half was identity. A Typert Remote method is invoked with the decoded payload and a cancellation signal and nothing else. The Gateway's `/api` route does apply the host's browser authentication before dispatch, but that outcome is not carried into the method, so a Remote method cannot distinguish a browser holding the session cookie from any in-process caller. The only thing left to trust would have been a field in the request body, which is the one thing `ENGINEERING-CONTRACT` §8.1 forbids.

## Decision

**The identity is the transport's, not the payload's.** `dsh-research-team/src/approval.ts` registers an ordinary channel through `ctx.connection.rpc.handle('/research-approval', …)` — the host's documented "authenticated absolute channel prefix" registration, which `HostConnectionService.register` wraps in the same `requestRejection` the `/api` prefix uses. That call verifies an HMAC-signed, authority-bound, expiry-bound cookie whose only source is the per-process launch token `dsh web` prints on the host's own console. Reaching the handler is therefore proof of possession, applied by the host before any line of ours runs. A caller cannot reach `submitApproval` any other way: the module is deliberately absent from the package entry's re-export list and the service gained no Remote method, so an ordinary tool call has no name to address.

**The request body contributes four fields and nothing else.** `readSubmission` reads `runId`, `stepId`, `attempt` and `decision`, and discards every other key. `actor`, `principal`, `principalId` and `status` are never read, so a body claiming to be a human, or claiming the step is already `passed`, changes no outcome.

**Every check is a read of the store this process holds.** `submitApproval` resolves the run in a module-scoped registry (the same reason `dsh-research-cordis` keeps its store module-scoped: a TS `private` field is erased at runtime and an instance property is enumerable), then requires the step to exist, to be a `humanGate`, to be `gated` right now, and to be at the attempt the caller named. Only then does it mint a principal bound to `(runId, stepId)` with a fresh single-use event id and call `HostApprovalChannel.submit`, which is what writes the `ApprovalRecord` and the `human-approval` audit event. The response carries the run re-projected from the store, so a client renders the status the backend recorded rather than the one it had in hand.

**The panel decides nothing.** `ApprovalPanel` submits and then renders what came back — the status, the attempt, and the operator the host attested. A refusal states its reason and leaves the step pending. When no submitter is supplied — a deployment whose browser trust surface is absent — both buttons are disabled with the reason stated, rather than a decision nobody made.

## Alternatives considered

**A `@Remote('approve')` Typert method.** Rejected: Remote dispatch discards the authentication outcome, so the method would have to trust something in the payload. It would also have put an approval method on the wire surface every client already reaches.

**A plain `webServer` route calling `connection.requestRejection` itself.** Considered and nearly taken — it owns its own disposal and can re-assert the check locally. Rejected in favour of `rpc.handle` because the host then applies its own authentication policy rather than ours, the client's `connection.rpc.call` already speaks the envelope, and the route sits under a prefix the host fences rather than beside it.

**Register the endpoint from `dsh-research-web`'s host half.** Rejected: the run store and the approval channel must be reachable by the code allowed to submit, and that code must be one package. Splitting them would have required a cross-package proof of authentication, i.e. trusting a boolean from a caller.

**Mint the channel secret only from `DSH_APPROVAL_SECRET`.** The core doc names that variable, but the value is not consumed by the implementation, and an env var is *more* observable by in-process code than a value held in a closure. The variable is honoured when the deployment sets it and a process-lifetime random is minted otherwise; the channel is a singleton either way.

## Consequences

`runPipeline` now remembers the run it produced — `rememberRun(runId, store, project)` — because the gate it stops on can only be decided by addressing that store, and the plugin drops the registry when it unloads. `src/index.ts` gains one `ctx.inject(['connection'], …)`; a deployment without a browser surface keeps every other research capability and serves no approval endpoint.

The root `tsconfig.base.json` gained `"@deepseek-ai/dsh-research-core/host"`. Nothing in the tree imported that subpath before, and without the alias it resolves through `node_modules` to `lib/` — the artifact plane, which `AGENTS.md` forbids static gates from reading.

**This is not process isolation.** Same-process code holding a `Context` can still call `submitApproval`, as it can call any service, and the host cannot tell two people on one deployment apart — the cookie carries an authority and an expiry, no user id, so every authenticated browser resolves to one host-registered principal named for the mechanism rather than for a person. `host.ts` documents the same residual.

A second load of the approval module in one process fails loudly: the channel is a process singleton and `createHostApprovalChannel` refuses the second mint. That throw is left to propagate.

Evidence level: the panel and the request contract are Integration-verified by jsdom and unit specs; the approval invariants of §8.1 are covered by `tests/approval.spec.ts` against the real driver's own `gated` stop. The transport itself was exercised over a real socket against the real webserver and Connection plugin — unauthenticated 401 with the handler never running, token exchange minting the cookie, authenticated 200 recording the decision, forged cookie 401. **No browser has clicked the button against a running Host**; see the package READMEs.
