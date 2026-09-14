# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Two instruction layers

`AGENTS.md` owns every repo-wide rule — commands, conventions, testing policy, gates. Read it as the base. This file adds the one thing `AGENTS.md` does not cover: the fork-specific research subsystem.

`AGENTS.md` says `CLAUDE.md` symlinks it. It does not: Git stores both files as regular files whose entire content is the nine bytes `AGENTS.md`, so a session used to load no project instructions at all. The `@AGENTS.md` import above is what reaches the base rules — keep it. Edit `AGENTS.md` for base-harness rules, this file for the research layer.

## What this fork adds

`H:\AccePaper` is a fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`, pre-release `0.1.2-alpha.4`) carrying an **AI research-paper production system**: `packages/research/*` plus the bundle `packages/bundle/research-app/`. Its premise is that AI-generated scientific claims are untrustworthy, so it does not write papers end to end. It drives one claim through a 16-step pipeline in which a step advances only by surviving an A/B/C judgment triad (A = red-team vote, B = external anchor, C = falsifiable prediction plus experiment adjudication). An unresolvable step ends `abstained`/`hold`; it never becomes a pass.

Steps, in order, phases A–E (`dsh-research-core/src/engine/steps.ts`): `A1-landscape`, `A2-claim`, `A3-agenda`, `A4-venue`, `B1-method`, `B2-data`, `B3-baseline`, `C1-mvp`, `C2-trinity-loop`, `C3-boundary`, `D1-figure-map`, `D2-framework`, `D3-writing`, `D4-rebuttal`, `E1-format`, `E2-submit`. Only `E2-submit` sets `humanGate: true`, and it is reachable only through the `./host` subpath, never through `ctx.research`.

### Packages

| Package | Role | Cordis |
|---|---|---|
| `dsh-research-core` | 16-step state machine, L0 tier routing, citation verification, gate adjudication, snapshot store. Zero deps. | no |
| `dsh-research-tools` | Seven artifact tools, their closed input schemas, and the `ResearchToolInvoker` seam. | no |
| `dsh-research-cordis` | Exposes `ctx.research`; registers the seven tools on the real `ctx.tools`, including the agent-loop invoker. | yes |
| `dsh-research-team` | Exposes `ctx.agentTeams`: red-team fleet, CAS revision task board, write-scope guard, durable session projection. | yes |
| `dsh-research-web` | Dual-face plugin; inert host half, browser half mounts a `conversation.view` tab (`id: 'research'`). | yes |
| `bundle/research-app` | Patch-only bundle: research port plus the three plugin rows. | — |

Dependencies run one way: `core` ← `tools` ← {`cordis`, `team`}. `web` depends on none of them.

### Extension points the research layer occupies

- Services `ctx.research` (`ResearchEngine`) and `ctx.agentTeams` (`ResearchTeamService`).
- `SessionEventMap` gains exactly four members — `research/member`, `research/task`, `research/rev`, `research/rebuttal` (`dsh-research-team/src/session-events.ts`). They are written to the lead session's log only, so the model-visible⟺logged rule in `AGENTS.md` still binds.
- `SessionProjectionStateMap.researchTeam`, plus a client `LocaleNamespaceMap.research` namespace.
- Two independent `ctx.tools.guard` installers coexist: one narrows the seven research tools by `pipeline_only`/`model_ready` exposure, one enforces fleet write scope. Neither is a security boundary.
- `ctx.on('agent/session-start')` is the only base event any research package subscribes to (recovery scheduling).

The service name `agentTeams` also belongs to `packages/experimental/agent-team`; mounting both collides.

### Running it

`@deepseek-ai/dsh-research-app` is **not** in the shipped `PROFILE_TEMPLATES` (`packages/boot/app-boot/src/profile.ts`), so `dsh web --profile web` alone does not mount it. Add it to the profile's `dsh.profile.bundles` after `dsh-base` and `dsh-web-app`; the patch then moves the webserver fallback port from 3080 to **1120** (an explicit `--port` still wins).

The recorded boot procedure, its four attempts, and the seed/junction steps are in `plan/overnight/2026-09-09/t30-attempts.md`. It depended on one committed fix: `ResearchTeamService.static inject` must list `'tools'`, because construction installs the tool guard.

## Commands for the research surface

Root commands are in `AGENTS.md`. The research packages carry no config of their own — they run under the root `vitest.config.ts`, and their per-package `"test": "vitest run"` scripts have no local config, so invoke them from the repo root:

```sh
./node_modules/.bin/vitest run packages/research
./node_modules/.bin/vitest run packages/research/dsh-research-core/tests/state-machine.spec.ts
```

`pnpm` has been broken on this Windows host (a corepack shim; `AGENTS.md` and the handoff both call it out), so `./node_modules/.bin/<tool>` is the reliable form. Two research runners sit deliberately outside vitest and must be invoked by hand: `dsh-research-cordis/tests/prod-import-smoke.mjs` (plain Node against built `lib/`) and `dsh-research-cordis/scripts/repro-check.mjs`.

Specs import `../src/*.ts` directly, never package names. `dsh-research-web/tests/researchview-component.dom.spec.ts` needs its `// @vitest-environment jsdom` pragma. On Windows the root config drops bash-requiring suites; no research package is on that list.

Coverage applies unchanged — per-file 100% over `packages/*/*/src`. The research packages do not currently meet it.

## Claiming completion

This fork grades work on a fixed ladder and forbids substituting one rung for another:

`Designed → Implemented → Unit-verified → Integration-verified → Runtime-verified → Clean-install verified → Audit-passed → Blocked`

Fixture evidence never upgrades to real evidence; passing tests are not completion. Independent audits log findings at P0–P3; P0/P1 are reworked and re-reviewed by the original auditor and may never be waived. `pipeline_only` tools currently stand at fixture-only because of `ARCH-BLOCK-01` — do not close it by forging an `Agent`, calling private methods, deep-importing host internals, or restoring agent-less pass-through.

## Where current state lives

The planning corpus is tracked here and is the authority on status. Each research package carries a README alongside its file-header contract comments (`ce2ed07c`, 2026-09-12, added the five; this file claimed until 2026-09-14 that there were none). None of those READMEs has a Chinese counterpart yet, so `verify-translation-pairing` lists them.

- `plan/overnight/2026-09-09/t30-attempts.md` — newest technical truth: the port-1120 boot recipe and its failure modes.
- `plan/overnight/2026-09-09/HANDOFF-2026-09-09.md` — status matrix, git topology, environment traps, prioritized next steps. Predates the successful Attempt 4.
- `project-plan/05_execution_wbs.md` — WBS tasks `T01`–`T44`; `project-plan/06_test_acceptance.md` — gates `G1`–`G18` and the execution-record format; `project-plan/overnight/<date>/` — `execution-ledger.md`, `coverage-report.md`, `audit-register.md`.
- `project-plan/overnight/2026-09-03/decisions.md` — user rulings `DEC-001`–`005`, which explain why several contracts look as they do.

Traps when reading them: `plan/overnight/...` and `project-plan/overnight/...` are different directories, neither complete alone. The documents were written from other checkouts (`G:\AccePaper-main\deepseek-harness-dev`, `C:\Users\Leon\...`), so their paths and some status claims are stale against this tree — check the code before trusting either. `morning-report.md` opens with its own corrections block; read that before its body.
