# Agent Note: A deterministic offline prose route, and the offline bundle posture

Status: implemented

English | [中文](2026-09-14-deterministic-offline-prose-route.zh.md)

## Problem

The prose channel (`LlmProseWriter`) needs a provider route to send its request to, and the only route the repository ships is `deepseek-official`, which needs a credential. A deployment with no credential therefore fails every prose step; a deployment with one makes the run non-reproducible and network-dependent.

The shipped `research-app` bundle configured exactly that: `prose: { provider: deepseek-official, model: deepseek-v4-pro }`, plus `literatureSearch: openalex`. On this host neither works — there is no key, and OpenAlex answers 429 because the configuration identifies itself to nobody. So the shipped default could not run a pipeline at all, and the offline case had no provider to run it on.

There was also nothing in between. `@deepseek-ai/dsh-llm-replay` replays recorded chunks from a session log, which cannot answer a request that was never recorded, and no recorded research prose exists.

## Decision

`dsh-research-cordis` ships a **deterministic offline provider** (`src/deterministic-llm.ts`) and `Config.prose` becomes a discriminated channel:

- `kind: 'llm'` — a real provider route, exactly as before.
- `kind: 'deterministic'` — the engine registers its own adapter on the real `ctx.llm` and points the writer at it.

The adapter is a real one: a prose request travels the normal path (agent loop → `LlmRuntime` → adapter → session log), and the route answers with text that is a **pure function of the request**. It is not a mock of the loop, and it is not a fixture in place of the request: the request, the session and the log are real, and only the response is computed.

The shipped bundle switches to the offline posture — `fixture` retrieval and the deterministic prose route — because that posture is what the product is meant to be on a host with no credential and no egress, and because the previous default could not boot to a working run. The live channels remain one paste away: `cordis.patch.yml` ends with the replacement block, and the bundle README states that it needs a credential and network egress.

**Labeling is part of the contract.** The default response body opens with `DEMO DRAFT` and states that no model was called. The text is a step's product and travels downstream into artifacts and a draft, so a reader who finds it must be able to tell what it is without consulting a plan document. A deployment may replace the template, but the offline route's text must never be presented as model-generated research.

## Admission and ownership

`ResearchEngine` owns the registration because it already owns the other deployment-level choices (`toolDeps`, `proseWriter`, `sessionCwd`), and it is the component that knows which channel the deployment selected. Registration is an effect owned by the engine's fiber, so a re-mount cannot leave a duplicate route behind.

The provider is assembled as a plain object rather than an `LlmAdapter` subclass: the base class is behind the package's non-literal dynamic-import seam, and `registerAdapter` is a typed same-process boundary, so the structural surface (`providerInfo`, `providerRetryPolicy`, `prepareCall`, `stream`) is the whole contract. It lives in this package rather than `packages/llm/` for a toolchain reason recorded in the module header: adding a workspace package needs a package-manager install to create its lockfile entry and dependency links, and the only install path available on this host re-creates the whole modules tree.

Like the tool registration beside it, the binding goes through `ctx.inject(['llm'], …)`. The loader starts its entries concurrently: on a real 1120 boot `ctx.get('llm')` is undefined while the engine loads, so reading it eagerly failed the entire boot with `prose.kind is "deterministic" but the host provides no llm service`. `ctx.research.proseRouteReady` is the commit point, and a spec pins the order the loader actually uses.

## Alternatives considered

**Register a scripted adapter from the test side and leave production alone.** Rejected: the deployment is the thing that needs a working route, and a test-only adapter would leave the shipped bundle unable to run — the defect this change exists to remove.

**Add the provider as a new workspace package under `packages/llm/`.** Architecturally the right home — it is a Provider role in the LLM capability seam, not a Consumer detail. Rejected for now on toolchain grounds: it needs a lockfile entry and dependency links, and `pnpm install` on this host refuses to proceed without re-creating `node_modules`, which risks taking the repository down with it. Recorded in the module header as the change to make once an install can be run safely.

**Make the deterministic route answer the labelled-field instructions too** (A2 asks for `ASSERTION:`/`DIFFERENCE:`/`EXPERIMENT:`/`PREDICTION:`). Rejected: it would have a placeholder generator invent a falsifiable research claim by parsing an instruction template, which is the "let the model decide the science" pattern this subsystem exists to refuse. Structured step content belongs to the selected Case Pack.

**Keep the shipped bundle on the live channels and document the offline override.** Rejected: it makes the reproducible, credential-free configuration the opt-in and ships a default that cannot complete a run.

## Consequences

- A deployment with no credential runs the full prose path. Verified on a real 1120 boot: `ctx.research.proseWriter` produces text whose `Task:` line is the caller's instruction and whose route is `research-deterministic / deterministic-prose-v1`.
- A1-landscape passes inside a real remote run. The run now stops at A2-claim, which is the honest boundary: A2 wants structured fields and no channel supplies them yet.
- The derivation reads past the agent loop's trailing runtime-context snapshot. The first version read the **last** user message, which is that snapshot, so the draft restated the sandbox policy as its task — a wrong product that still looked plausible. A spec pins the message shapes copied from a real session dump.
- Text from this route is reproducible, so a snapshot or an assertion can pin it. Two writes of the same request produce byte-identical output.
