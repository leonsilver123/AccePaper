# Agent Note: The research run reaches the browser over a Remote call

Status: implemented

English | [中文](2026-09-14-research-run-remote-entry.zh.md)

## Problem

`ResearchTeamService.runPipeline` was documented as "the runner's production entry" and had no caller anywhere in the repository — not in the app, not in a spec. The browser surface made that visible: `ResearchWorkbench` renders a run summary and the research tab could only ever show `loadFixtureSummary()`, because nothing could start a run and nothing could hand a real one in. The `summary` prop added earlier was a seam with nothing on the other side.

Two smaller statements had the same shape. The workbench rendered a MOCK badge unconditionally, so the seam would have kept saying "demo data" over a real run, and `RunSummary.isMock` was declared as the literal `true`, so the model could not express anything else. And `SummaryPanel` carried its own unconditional badge.

## Decision

`ResearchTeamService` extends `TypertRemoteService` and exposes `runPipeline` as `@Remote('run')` under the wire namespace `research` — the service key stays `agentTeams`, which is what host plugins inject, and the namespace is chosen so a client does not reach for a name that collides with the experimental agent-team package.

The method returns a **snapshot**, not the runner's `RunResult`: the run, the 16-step catalogue, every recorded gate verdict with its evidence and rationale, every artifact's metadata, and each step's attempt and hold reason. The catalogue travels because a client gets per-step outcomes keyed by `stepId` and has no other way to learn a step's index, phase, display name, or human-gate flag — it would otherwise re-declare core's step definitions and drift. The gate evidence and artifact metadata travel because `RunResult` carries neither, and rebuilding them client-side would mean inventing the evidence strings a reader checks a verdict against.

The client side splits along the compiler faces. `run-source.ts` maps the wire payload into the view model and declares the payload **structurally**, because the service compiles in the Host face and this module in the Client face and the client bundle takes no cross-plugin value dependency. This is the same twin the runner's `llm-prose-writer.ts` uses on the other side of the same divide. `ResearchEntry.tsx` binds the workbench to one run source; `client/index.ts` builds that source from `ctx.remote.research.run({})` through a locally declared structural face of the namespace. The workbench gained a run control and lost its unconditional badge, and `RunSummaryInput` gained `source: 'fixture' | 'live'` so `isMock` is derived rather than constant.

## Alternatives considered

**Return `RunResult` and map it in the client.** Rejected: the mapping needs the step catalogue, and `RunResult` does not carry it. The client would have to declare its own copy of the 16 step definitions — a second home for a fact core owns.

**Put the adapter in the bundle.** `packages/bundle/research-app` is the only package that sees both `dsh-research-team` and `dsh-research-web`, and `cordis.patch.yml` could grow a code row for it. Rejected because `dsh-research-web` compiles as a **client-face** project: a host-face import of it drags browser sources into the host program, which is why the bundle's tsconfig reference to it was removed in the first place. The adapter would have had to declare the client's summary shape structurally anyway, so the bundle buys nothing the client-side mapper does not already do — and it would add a plugin row, a boot surface, and a package that exists only to hold a type.

**Have the client read the snapshot from a file or a session projection.** Rejected: the run's store is in-memory for the lifetime of the call and is not written to the session log, so there is nothing on disk or in a projected stream for a client to read.

**Ship a hand-written wire descriptor instead of the generated one.** Rejected: the generator already scans the workspace for `@Remote` markers, and hand-writing the descriptor would put the boundary type in two places.

## Consequences

The pipeline now has a caller, and the research tab can render a run it actually started. `pnpm run build` emits `typert.host.js` and `typert.remote-client.js` for `dsh-research-team`, and the package's `exports` gained `./types`, `./typert` and `./remote` so the boundary types and the generated artifacts sit on public subpaths — the generator refuses a package whose manifest does not declare them.

**A build-order defect surfaced and was fixed in the same change.** The team package's `tsdown.config.ts` cleaned `lib/*.js` on every pass. The Client pass runs after the Host pass and uses that same config, so it deleted the Typert artifacts the Host pass had generated, and the Client pass does not regenerate them. The clean list now names what the package emits. Anything else that grows a Typert surface on a package built by both faces needs the same treatment.

The wiring is Integration-verified, not Runtime-verified: the Host half is exercised by a spec that mounts the real service, the client half by jsdom specs against a stubbed namespace, both typecheck faces and both builds pass, and a real `dsh web` boot on 1120 loads the plugin with the remote service present. **No browser has driven the tab against a running Host** — see the package README for that gap and for the two remaining statements that a browser run would settle.

`RunSummaryInput` gained a required field, so every literal of that type — the fixture, the client spec's two inputs — had to say where it came from. That is the point: a summary that does not state its source is the defect this change is about.
