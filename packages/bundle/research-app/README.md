# @deepseek-ai/dsh-research-app

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

## Retrieval channel

The `research-cordis` row configures `literatureSearch`. It ships as `openalex`, so the mounted engine retrieves genuine catalogue records through the real adapter; setting `{ kind: fixture }` runs fully offline against the synthetic corpus. An omitted channel defaults to the fixture, so that config line is the deployment's explicit opt-in to live retrieval.

## Known Limitations and Deferred Work

- The roster mounts three plugin rows. The two pure libraries (`dsh-research-core`, `dsh-research-tools`) are dependencies rather than rows, because they expose no `apply`/`name` and would crash `ctx.registry.plugin`.
- The `research-cordis` row sets `requireResearchTools: true` and configures the three live channels (`literatureSearch`/`citationResolver`: `openalex`; `prose`: `deepseek-official`/`deepseek-v4-pro`). Verified on a real 1120 boot. Note what the flag does NOT mean: it cannot refuse to boot when the `tools` service is merely late — the loader starts rows concurrently and that is not distinguishable from absent at load time — so it makes a registration FAILURE loud rather than making registration a startup gate.
- Port 1120 is a fallback only; an explicit `--port` flag still wins, so an operator can move the research server without editing the patch.

No invariant companion is published: this package carries no runtime behaviour of its own because its `src/index.ts` is an inert marker, so no `./invariant` entry is published alongside it.
