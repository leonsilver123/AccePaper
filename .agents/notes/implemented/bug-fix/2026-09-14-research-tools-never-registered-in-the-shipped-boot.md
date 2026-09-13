# Agent Note: The research tools were never registered on the shipped boot

Status: implemented

English | [中文](2026-09-14-research-tools-never-registered-in-the-shipped-boot.zh.md)

## Problem

`@deepseek-ai/dsh-research-cordis` registers the seven research tools on `ctx.tools` from a nested plugin that declares `inject: ['tools']`. It mounted that plugin directly inside `[Service.init]`.

The loader starts its entries **concurrently**, not in list order, so the engine's load can — and on the shipped profile does — run before the sibling `tools` row is up. Measured on a real 1120 boot: `ctx.get('tools')` is `undefined` while `[Service.init]` runs, and an object about 50 ms later. Mounting at that moment created a fiber whose inject could never be satisfied, so the registration was skipped permanently.

The tolerant path (`requireResearchTools` unset, which is what the shipped `research-app` bundle used) caught nothing and reported nothing, because a skipped fiber is not an error. The result: **the shipped research bundle booted, served its UI, and registered zero research tools.** `ctx.agentTeams` was equally absent, since `ResearchTeamService` declares `inject: ['tools']` and was skipped the same way.

Nothing caught it. The unit specs hand-build a context in which the tools service is already present, so the mount always succeeded there. The only end-to-end evidence was a boot log that says `dsh web: http://127.0.0.1:1120/...` — which is true whether or not the tools registered.

## Decision

The engine mounts the tool plugin through `ctx.inject(['tools'], …)`, the framework's own mechanism for "run this once the dependency is available", and the pattern the rest of the repository already uses. Registration commits whenever the service appears; `ResearchEngine.toolsReady` is set only at that commit point.

When the service is already present at load time the injected fiber is awaited, so the load keeps a gate: with `requireResearchTools` set, a registration that fails its readiness check throws out of `ctx.plugin` instead of being swallowed.

`requireResearchTools` is redefined to what it can actually enforce. It is **not** "refuse to boot without a tools service" — at load time "the service is not up yet" and "the service will never exist" are indistinguishable, so no load-time check can tell them apart. It is "the service is present and registration did not produce Ours: raise instead of tolerating". The shipped `research-app` row now sets it, and the comments that claimed the stronger guarantee are corrected.

## Admission and ownership

`ResearchEngine` owns the mount and the readiness signal. Absence of the `tools` service stays tolerated: a standalone embedding is a usable `ctx.research` state machine with `toolsReady === false` and no research tools, which is what the standalone specs assert.

The fix was verified against a real boot, not a hand-built context: with the corrected bundle mounted in a scratch profile, the boot logs the seven tools as registered on `toolsCtx.tools` and the profile still serves on 1120. The regression is pinned by a spec that loads the engine on a bare context, then starts the tools plugins afterwards, and asserts the tools arrive — which is the order the loader actually uses.

## Alternatives considered

**Declare `static inject = ['tools']` on the engine.** This is the idiomatic cordis answer and would have ordered the engine after the tools row. Rejected because it makes the engine a hard dependent on the tools service, and the engine is specified to remain usable standalone, where that service does not exist.

**Wait for the service during `[Service.init]` with a bounded timeout.** Rejected: it makes startup time a deployment-varying tunable, and it turns a slow host into a failed boot rather than a late registration.

**Keep the tolerant path mounting eagerly and log the skip.** Rejected: a log line is not a contract, and the tolerant path's whole job is to make absence non-fatal, not to make a present-and-broken registration invisible.

## Consequences

The shipped bundle gains its tool surface for the first time, which is a behaviour change for any deployment that was running it: the seven `pipeline_only` tools and the `agentTeams` service now exist. Their exposure is still governed by the guards registered alongside them, so this does not widen the model-visible surface.

`packages/bundle/research-app/cordis.patch.yml` now sets `requireResearchTools: true` and configures the prose channel (`deepseek-official` / `deepseek-v4-pro`), so the shipped profile reaches a real model on the prose steps instead of emitting fixture text. That channel needs a credential for the route: with none, a prose write fails the step rather than falling back, which is the fail-closed posture the runner documents.

The mount is now asynchronous relative to `[Service.init]`, so a spec that wants to observe registration must await it rather than assume it happened during `ctx.plugin`.
