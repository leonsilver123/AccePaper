# Research

[English](research.md) | 中文

研究子系统驱动**一条 claim** 走完 16 步流水线,其中没有任何一步凭模型的判断推进:每一步都必须通过一个判决三元组,三元组无法收敛的步骤以**保持(hold)**收尾,而不是被判为通过。本页记录流水线的步骤、三元组、持久形式,以及本分组暴露的 Cordis API。各包自己的约定见 [`packages/research/`](../../packages/research/README.zh.md)。

## 流水线

五个阶段、十六个步骤,定义在 [`dsh-research-core/src/engine/steps.ts`](../../packages/research/dsh-research-core/src/engine/steps.ts):

| 阶段 | 步骤 | 该阶段要定下什么 |
|---|---|---|
| A | `A1-landscape`、`A2-claim`、`A3-agenda`、`A4-venue` | 已有工作是什么、claim 是什么、贡献清单是什么、投向哪里 |
| B | `B1-method`、`B2-data`、`B3-baseline` | 如何检验这条 claim、用什么数据、对照什么基线 |
| C | `C1-mvp`、`C2-trinity-loop`、`C3-boundary` | 实验是否跑得起来、三元组裁定什么、结论到哪里为止 |
| D | `D1-figure-map`、`D2-framework`、`D3-writing`、`D4-rebuttal` | 图表、框架、草稿,以及对红队的回应 |
| E | `E1-format`、`E2-submit` | 成稿与投稿 |

`E2-submit` 是唯一带 `humanGate: true` 的步骤。它只能经 `./host` 子路径抵达,**永远不能**经 `ctx.research` 触发 —— 因此 agent 无法靠调用服务方法走到它。

## 判决三元组

每一步都由三个彼此独立的通道裁定,结果是**合取**而不是投票:

- **A —— 红队。** 一组角色审阅材料,并逐项给出立场。编队的裁定是持久的:被接受的投票以 `research/rebuttal` 事件追加。
- **B —— 外部锚。** 主张被绑定到模型之外的产物上,而绑定是按**字符串相等**核对的,不是"读出来"的。
- **C —— 可证伪的预测。** claim 承诺的一条预测,由本研究**真正跑过**的实验来裁定。

通道之间不一致、或证据缺失的步骤,以 `abstained` / `hold` 收尾。**没有任何路径会把未收敛的步骤变成通过**:流水线记录它没能确立的东西,而不是默认同意。

## 持久状态

研究 run 的状态是会话日志加一个快照存储;任何模型可见的东西都不会只存在于内存里。

- **四个会话事件**,声明于 [`dsh-research-team/src/session-events.ts`](../../packages/research/dsh-research-team/src/session-events.ts)—— `research/member`、`research/task`、`research/rev`、`research/rebuttal`。每个都携带其主体的**整体快照**(一个成员、一个任务、一次产物 CAS 修订、一次被接受的编队投票)。它们只写入 lead 会话的日志。
- **`SessionProjectionStateMap.researchTeam`** 是客户端读取的投影条目,由 [`dsh-research-team/src/index.ts`](../../packages/research/dsh-research-team/src/index.ts) 注册。
- **run 快照**(`dsh-research-core` 的快照存储)是 resume 读取的东西:步骤、产物、门禁裁定、审批,以及拒绝第二个写入者的修订守护。

## 客户端面

[`dsh-research-web`](../../packages/research/dsh-research-web/README.zh.md) 是双面插件。宿主面惰性;浏览器面把 `research` 条目注册进 `conversation.view` slot(`id: 'research'`),并读取上面的投影。它的文案由 `LocaleNamespaceMap` 里的 `research` 命名空间按语言提供。

## Cordis API

### `ctx.research` —— `ResearchEngine`

流水线的状态机与存储:`createRun`、`setRunInput`、`getRunSnapshot`、`getArtifact`、`canStart`、`startStep`、`startIfCan`、`recordArtifact`、`submitGateVerdict`、`completeStep`、`rollback`。由 `dsh-research-cordis` 暴露,它同时把七个产物工具注册到真实的 `ctx.tools` 上。

### `ctx.agentTeams` —— `ResearchTeamService`

编队及其持久任务板:`membership`、`spawnMember`、`createTask`、`getTask`、`listTasks`、`updateTask`、`rootOfMember`、`deployFleet`、`startRebuttal`、`submitRebuttal`、`roundVotes`、`runPipeline`。**服务名 `agentTeams` 同时被 `packages/experimental/agent-team` 占用;两者都挂载会冲突。**

### 扩展点

- 两个彼此独立的 `ctx.tools.guard` 安装器共存:一个按 `pipeline_only` / `model_ready` 暴露面收窄七个研究工具,一个强制编队写作用域。两者**都不是**安全边界。
- `ctx.on('agent/session-start')` 是任何研究包唯一订阅的基础事件,用于恢复调度。
