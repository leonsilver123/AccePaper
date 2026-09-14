# Research

English | [中文](research.zh.md)

The research subsystem drives one claim through a 16-step pipeline in which no step advances on a model's say-so: each step must survive a judgment triad, and a step whose triad cannot be resolved ends held rather than passed. This page records the pipeline's steps, the triad, the durable forms, and the Cordis API the group exposes. The packages' own contracts live in [`packages/research/`](../../packages/research/README.md).

## The pipeline

Sixteen steps in five phases, defined in [`dsh-research-core/src/engine/steps.ts`](../../packages/research/dsh-research-core/src/engine/steps.ts):

| Phase | Steps | What the phase settles |
|---|---|---|
| A | `A1-landscape`, `A2-claim`, `A3-agenda`, `A4-venue` | What is already known, what the claim is, what the contribution list is, and where it would be submitted |
| B | `B1-method`, `B2-data`, `B3-baseline` | How the claim would be tested, on what data, and against what baseline |
| C | `C1-mvp`, `C2-trinity-loop`, `C3-boundary` | Whether the experiment runs, what the triad decides, and where the result stops carrying |
| D | `D1-figure-map`, `D2-framework`, `D3-writing`, `D4-rebuttal` | The figures, the framework, the draft, and the response to the red team |
| E | `E1-format`, `E2-submit` | The formatted artifact, and submission |

`E2-submit` is the only step with `humanGate: true`. It is reachable through the `./host` subpath and never through `ctx.research`, so an agent cannot reach it by calling a service method.

## The judgment triad

Every step is graded by three independent channels, and the outcome is a conjunction rather than a vote:

- **A — the red team.** A fleet of roles reviews the material and returns a position per check. The fleet's verdict is durable: accepted votes are appended as `research/rebuttal` events.
- **B — the external anchor.** Claims are bound to artifacts outside the model, and the binding is checked by string equality rather than read.
- **C — the falsifiable prediction.** A prediction the claim commits to is adjudicated against an experiment this study actually ran.

A step whose channels disagree, or whose evidence is absent, ends `abstained` / `hold`. **No path turns an unresolved step into a pass**: the pipeline records what it could not establish rather than defaulting to agreement.

## Durable state

The research run's state is the session log plus a snapshot store; nothing model-visible exists only in memory.

- **Four session events** are declared in [`dsh-research-team/src/session-events.ts`](../../packages/research/dsh-research-team/src/session-events.ts) — `research/member`, `research/task`, `research/rev`, `research/rebuttal`. Each carries a whole snapshot of its subject (a member, a task, an artifact CAS revision, an accepted fleet vote). They are written to the lead session's log only.
- **`SessionProjectionStateMap.researchTeam`** is the projection entry the client reads, registered by [`dsh-research-team/src/index.ts`](../../packages/research/dsh-research-team/src/index.ts).
- **The run snapshot** (`dsh-research-core`'s snapshot store) is what a resume reads: steps, artifacts, gate verdicts, approvals, and the revision guard that refuses a second writer.

## Client surface

[`dsh-research-web`](../../packages/research/dsh-research-web/README.md) is a dual-face plugin. Its host half is inert; its browser half registers the `research` entry into the `conversation.view` slot (`id: 'research'`) and reads the projection above. Its copy is locale-owned through the `research` namespace in `LocaleNamespaceMap`.

## Cordis API

### `ctx.research` — `ResearchEngine`

The pipeline's state machine and store: `createRun`, `setRunInput`, `getRunSnapshot`, `getArtifact`, `canStart`, `startStep`, `startIfCan`, `recordArtifact`, `submitGateVerdict`, `completeStep`, `rollback`. Exposed by `dsh-research-cordis`, which also registers the seven artifact tools on the real `ctx.tools`.

### `ctx.agentTeams` — `ResearchTeamService`

The fleet and its durable board: `membership`, `spawnMember`, `createTask`, `getTask`, `listTasks`, `updateTask`, `rootOfMember`, `deployFleet`, `startRebuttal`, `submitRebuttal`, `roundVotes`, `runPipeline`. **The service name `agentTeams` is also claimed by `packages/experimental/agent-team`; mounting both collides.**

### Extension points

- Two independent `ctx.tools.guard` installers coexist: one narrows the seven research tools by `pipeline_only` / `model_ready` exposure, one enforces fleet write scope. Neither is a security boundary.
- `ctx.on('agent/session-start')` is the only base event any research package subscribes to, and it is used for recovery scheduling.
