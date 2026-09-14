---
description: "The research group: a 16-step claim pipeline whose every step must survive a red-team vote, an external anchor, and a falsifiable experiment before it advances."
kind: "package-group"
---

# packages/research

English | [中文](README.zh.md)

## Summary

This group is the fork's research-paper production system. Its premise is that AI-generated scientific claims are untrustworthy, so it does not write a paper end to end: it drives **one claim** through a **16-step pipeline** in which a step advances only by surviving an **A/B/C judgment triad** — A is a red-team vote, B an external anchor, C a falsifiable prediction adjudicated against an experiment. A step whose triad cannot be resolved ends `abstained` / `hold`; it never becomes a pass. The steps run in phases A–E (`A1-landscape` through `E2-submit`), and `E2-submit` is the only human gate, reachable through the `./host` subpath and never through `ctx.research`.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`dsh-research-core/`](dsh-research-core/README.md) | The 16-step state machine, L0 tier routing, citation verification, gate adjudication, and the durable snapshot store. Zero dependencies. | library — no ctx key |
| [`dsh-research-tools/`](dsh-research-tools/README.md) | The seven artifact tools, their closed input schemas, and the `ResearchToolInvoker` seam | library — no ctx key |
| [`dsh-research-cordis/`](dsh-research-cordis/README.md) | Exposes `ctx.research` and registers the seven tools on the real `ctx.tools`, including the agent-loop invoker | `ctx.research` |
| [`dsh-research-team/`](dsh-research-team/README.md) | The red-team fleet, the CAS revision task board, the write-scope guard, and the durable session projection | `ctx.agentTeams` |
| [`dsh-research-web/`](dsh-research-web/README.md) | Dual-face plugin: an inert host half, and a browser half that mounts the research tab | no ctx key |

Dependencies run one way: `core` ← `tools` ← {`cordis`, `team`}. `web` depends on none of them and reaches the host through slots alone. The installable composition — the patch layer that mounts the reference deployment — is [`dsh-research-app`](../bundle/research-app/README.md) under `packages/bundle/`.

-----

<a id="related-documentation"></a>
## Related documentation

- [Research subsystem](../../docs/subsystems/research.md) — the pipeline, the triad, the durable forms, and the Cordis API.
- [Architecture](../../docs/architecture.md) — the turn flow and where new behavior goes.
- [Research application bundle](../bundle/research-app/README.md) — the patch-only bundle that mounts this group.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

- **The app is not mounted by the shipped profiles.** `@deepseek-ai/dsh-research-app` is absent from `PROFILE_TEMPLATES` (`packages/boot/app-boot/src/profile.ts`), so `dsh web --profile web` alone does not mount it. Add it to the profile's `dsh.profile.bundles` after `dsh-base` and `dsh-web-app`; the patch then moves the webserver fallback port from 3080 to **1120**. An explicit `--port` still wins.
- **The service name `agentTeams` is shared** with `packages/experimental/agent-team`. Mounting both collides.
- **`pipeline_only` tools stand at fixture-only evidence** because of `ARCH-BLOCK-01`. Closing that by forging an `Agent`, calling private methods, deep-importing host internals, or restoring agent-less pass-through is prohibited ([root guidance](../../CLAUDE.md)).
- **The packages do not meet the repository's per-file coverage gate**, and their export JSDoc is incomplete. Both are known and are tracked in `plan/REMAINING-WORK.md` rather than silently tolerated.

</details>
