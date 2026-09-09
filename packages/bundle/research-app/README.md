# @deepseek-ai/dsh-research-app

The **dsh Research bundle (T30)** — the research-surface layer of the dsh
profile stack. It layers over `dsh-web-app` (which layers over `dsh-base`) to
package the DeepSeek Harness research-paper production system as a distributable
bundle.

## What it does

- **Binds the research web server on port `1120`** by overriding the
  `webserver` row's `config.port` fallback (`!!js ctx.webStartup.port ?? 1120`),
  while keeping the `host`/`compression*` keys owned by the `dsh-web-app` layer.
- **Mounts the five `dsh-research-*` packages** as Cordis rows (or, for the pure
  libraries, as bundled dependencies):
  - `@deepseek-ai/dsh-research-cordis` → `ctx.research` (16-step engine service)
  - `@deepseek-ai/dsh-research-team` → `ctx.agentTeams` (fleet / red-team)
  - `@deepseek-ai/dsh-research-web` → research workbench host half
  - `@deepseek-ai/dsh-research-core`, `@deepseek-ai/dsh-research-tools` → pure
    libraries, resolved transitively by the plugin rows above.

## How it is composed

A profile stacks bundle patches in order. The `web` profile wires:

1. `dsh-base` — core rows
2. `dsh-web-app` — browser surface + webserver (default port 3080)
3. `dsh-research-app` — **this layer** (research port 1120 + research packages)

Run it with:

```bash
dsh web --profile web
```

The research bundle is added to the profile's `dsh.profile.bundles` so its
`cordis.patch.yml` is applied last.

## Layout

- `cordis.patch.yml` — the bundle patch (transport port + research roster).
- `src/index.ts` — runtime-inert module marker; all behaviour lives in the
  mounted research packages.
