---
description: "The research-surface profile layer over dsh-web-app: binds the research web server on port 1120 and mounts the five research packages, for users composing or customizing a profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-research-app

English | [中文](README.zh.md)

## Summary

Adding this layer to a profile gains the research surface: `ctx.research`, `ctx.agentTeams`, the browser workbench, and a web server bound on port 1120 instead of the web app's 3080 fallback. It layers over `dsh-web-app`, which layers over `dsh-base`, and the shipped `web` profile does not list it — a profile adds `@deepseek-ai/dsh-research-app` to `dsh.profile.bundles` after those two. The layer carries no runtime behaviour of its own: its module is an inert marker and its content is the patch document that inserts the rows and overrides the transport port. What a run reads and writes, and which channel its text is produced on, are deployment settings on the `research-cordis` row.

## Table of Contents

- [What it does](#what-it-does)
- [How it is composed](#how-it-is-composed)
- [Layout](#layout)
- [Channel configuration](#channel-configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## What it does

- **Binds the research web server on port `1120`** by overriding the `webserver` row's `config.port` fallback (`!!js ctx.webStartup.port ?? 1120`), while keeping the `host`/`compression*` keys owned by the `dsh-web-app` layer.
- **Mounts three plugin rows**, while the two pure libraries ride along as bundled dependencies resolved transitively:
  - `@deepseek-ai/dsh-research-cordis` → `ctx.research` (16-step engine service)
  - `@deepseek-ai/dsh-research-team` → `ctx.agentTeams` (fleet / red-team)
  - `@deepseek-ai/dsh-research-web` → research workbench host half
  - `@deepseek-ai/dsh-research-core`, `@deepseek-ai/dsh-research-tools` → pure libraries

## How it is composed

A profile stacks bundle patches in order. The `web` profile wires:

1. `dsh-base` — core rows
2. `dsh-web-app` — browser surface + webserver (default port 3080)
3. `dsh-research-app` — **this layer** (research port 1120 + research packages)

Run it with:

```bash
dsh web --profile web
```

The research bundle is added to the profile's `dsh.profile.bundles` so its `cordis.patch.yml` is applied last.

## Layout

- `cordis.patch.yml` — the bundle patch (transport port + research roster).
- `src/index.ts` — runtime-inert module marker; all behaviour lives in the mounted research packages.

## Channel configuration

The `research-cordis` row configures the channels and directories this deployment runs on. The shipped posture reaches a live catalogue and a model route.

| Setting | Decides |
|---|---|
| `literatureSearch` / `citationResolver` | Which catalogue the retrieval and citation-identity chains read; the shipped row names `openalex`, so a record in an artifact is a real paper and a fabricated DOI is an authoritative `not_found` rather than a fixture verdict |
| `prose` | Which provider route the text-producing steps run on; the shipped row names `deepseek-official` / `deepseek-v4-flash`, and a run with no credential for that route fails at its first prose step instead of falling back to fixture text |
| `review` | Which route reads a sentence against the passage behind its citation and which verifies a revision, with each role's rules version and the minimum number of review rounds this deployment requires |
| `document` | Which document toolchain this deployment has; the shipped row names `pandoc` and no LaTeX engine, so `html`, `latex` and `docx` are offered and `pdf` only where a probe found an engine |
| `figures` | Which interpreter has a scientific plotting library; the shipped row names none, so the built-in renderer draws and each float records that no library drew it |
| `casePackDirectory` | Which Case Pack drives a run: the seven versioned JSON files supplying the question, claim, experiment configuration and scenario parameters |
| `packageDirectory` / `snapshotDirectory` / `manuscriptDirectory` | Where a finished run's reproducible package, its durable snapshot, and the document it maintains on disk are written |

`casePackDirectory`, `packageDirectory`, `snapshotDirectory` and `manuscriptDirectory` are **deployment settings, never request fields**: `runPipeline` is reachable as a Remote method, so a client-supplied path would let a browser choose which files the host reads and where it writes. Each resolves a relative value against the engine's `workspace`, and an omitted one writes nothing at all — no pack is loaded, no package is exported, no run is persisted, no document is projected.

Two further settings say what this deployment may claim. `evidenceProfile` is `evaluation` in the shipped row: an evaluation run may be driven on any evidence class and its whole output is stamped unsubmittable, so a demonstration cannot carry the standing of a submission. `stepTimeoutMs` is raised to `900000`, because the registry's per-step budget is written for the offline prose route that answers in milliseconds while a model route takes seconds per step.

<a id="model-experience"></a>
## Model Experience

Indirectly, through each inserted plugin row, whose package owns that row's model-facing behavior.

#### KV Cache effect

The bundle adds no request prefix of its own. The port override it makes is transport configuration and never reaches a model request, so any cache effect belongs to the inserted rows' packages.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The roster mounts three plugin rows. The two pure libraries (`dsh-research-core`, `dsh-research-tools`) are dependencies rather than rows, because they expose no `apply`/`name` and would crash `ctx.registry.plugin`.
- The `research-cordis` row sets `requireResearchTools: true`. Note what the flag does NOT mean: it cannot refuse to boot when the `tools` service is merely late — the loader starts rows concurrently and that is not distinguishable from absent at load time — so it makes a registration FAILURE loud rather than making registration a startup gate. `ctx.research.toolsReady` and `ctx.research.proseRouteReady` are the two commit points, both verified on a real 1120 boot.
- **A run of the shipped Case Pack stops at A2-claim, and that is the system working.** The shipped Case Pack's claim commits to a >=20% reduction in car-following risk; the study's own experiment — a Webster delay model on the measured demand profile — measures 11.09%. The C gate refuses to pass a claim its own measurement refutes. The pack describes a car-following platoon study while the pipeline's experiment measures intersection delay, so the two are different studies; reaching E2 by relaxing the gate, by editing the pack's numbers (six of its files are covered by the manifest's `hashOfInputs` and their generator is not in this tree), or by choosing a claim that fits the observed effect are all closed. See `plan/PRODUCT-CLOSURE-EXECUTION.md` under P3 for the ruling this needs.
- A run writes its package only when `packageDirectory` is configured. Every file the manifest names is really written and carries its byte count and content digest; a file whose content is empty is omitted rather than declared, so the manifest never lists a phantom.
- Port 1120 is a fallback only; an explicit `--port` flag still wins, so an operator can move the research server without editing the patch.

No invariant companion is published: this package carries no runtime behaviour of its own because its `src/index.ts` is an inert marker, so no `./invariant` entry is published alongside it.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
