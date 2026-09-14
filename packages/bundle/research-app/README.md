# @deepseek-ai/dsh-research-app

English | [中文](README.zh.md)

The **dsh Research bundle (T30)** — the research-surface layer of the dsh profile stack. It layers over `dsh-web-app` (which layers over `dsh-base`) to package the DeepSeek Harness research-paper production system as a distributable bundle.

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

The `research-cordis` row configures four deployment-level settings, and **this bundle ships the offline posture**: `literatureSearch` and `citationResolver` are `fixture`, and `prose` is `kind: deterministic`.

| Setting | Decides |
|---|---|
| `literatureSearch` / `citationResolver` | Which catalogue the retrieval and citation-identity chains read |
| `prose` | Which provider route the text-producing steps run on |
| `casePackDirectory` | Which Case Pack drives a run: the seven versioned JSON files supplying the question, claim, experiment configuration and scenario parameters |
| `packageDirectory` | Where a finished run's reproducible package is written |

`casePackDirectory` and `packageDirectory` are **deployment settings, never request fields**: `runPipeline` is reachable as a Remote method, so a client-supplied path would let a browser choose which files the host reads and where it writes. Both resolve a relative value against the engine's `workspace`.

The offline posture is the product: the profile boots and runs a full pipeline with no model credential and no network, and every artifact is reproducible. Prose produced that way is a **demo draft** — a pure function of the request, labelled as such in its own text — and is never a model-written research finding. The real channels are the explicit opt-in; `cordis.patch.yml` ends with the replacement block to paste, and it needs both a provider credential and network egress.

## Known Limitations and Deferred Work

- The roster mounts three plugin rows. The two pure libraries (`dsh-research-core`, `dsh-research-tools`) are dependencies rather than rows, because they expose no `apply`/`name` and would crash `ctx.registry.plugin`.
- The `research-cordis` row sets `requireResearchTools: true`. Note what the flag does NOT mean: it cannot refuse to boot when the `tools` service is merely late — the loader starts rows concurrently and that is not distinguishable from absent at load time — so it makes a registration FAILURE loud rather than making registration a startup gate. `ctx.research.toolsReady` and `ctx.research.proseRouteReady` are the two commit points, both verified on a real 1120 boot.
- **An offline run stops at A2-claim, and that is the system working.** The shipped Case Pack's claim commits to a >=20% reduction in car-following risk; the study's own experiment — a Webster delay model on the measured demand profile — measures 11.09%. The C gate refuses to pass a claim its own measurement refutes. The pack describes a car-following platoon study while the pipeline's experiment measures intersection delay, so the two are different studies; reaching E2 by relaxing the gate, by editing the pack's numbers (six of its files are covered by the manifest's `hashOfInputs` and their generator is not in this tree), or by choosing a claim that fits the observed effect are all closed. See `plan/PRODUCT-CLOSURE-EXECUTION.md` under P3 for the ruling this needs.
- A run writes its package only when `packageDirectory` is configured. Every file the manifest names is really written and carries its byte count and content digest; a file whose content is empty is omitted rather than declared, so the manifest never lists a phantom.
- Port 1120 is a fallback only; an explicit `--port` flag still wins, so an operator can move the research server without editing the patch.

No invariant companion is published: this package carries no runtime behaviour of its own because its `src/index.ts` is an inert marker, so no `./invariant` entry is published alongside it.
