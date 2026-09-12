# T20 ctx.subagents 能力侦察 + 设计验证（P3.1，只读）

> Agent: general-purpose-22 ｜ 日期：2026-09-03 ｜ 仓库：`D:\1\deepseek-harness-master1\deepseek-harness-master`（只读）
> 约束依据：WBS §〇 F-W3 / §九 X8 / §十二 openQuestion#7。未改动仓库任何文件。

## (a) ctx.subagents 真实能力面（签名级）

`ctx.subagents` = `SubagentRuntime`，通过 `declare module '@deepseek-ai/cordis' { interface Context { subagents: SubagentRuntime } }` 注入
（`packages/subagent/subagent/src/index.ts:136-138`）；类定义 `index.ts:191`。

| 能力 | 签名/关键语义 | 位置 |
|---|---|---|
| 启动 one-shot | `start(name, request: SubagentStartRequest): Promise<SubagentRun>`；request 含 prompt/parent/signal/agentOptions/outputSchema/maxDepth/toolFilter/persona | index.ts:550 |
| 启动 durable continuable 成员 | `startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>`；spec=provider+label+可选 childId+request(`Omit<SubagentStartRequest,'label'\|'signal'\|'outputSchema'>`)+signal；返回 childId+messageId；成员=独立持久 Session+私有 FIFO inbox | index.ts:230 / continuation.ts:92-118 |
| 相邻消息投递 | `sendMessage(sender: Agent, targetId, content, options): Promise<MessageId>`——仅 direct parent↔direct child | index.ts:248 |
| 中断/排干/释放 | `interrupt(id, authority)`(index.ts:293)、`drainContinuableDescendants/Children`(index.ts:307/324)、remote `prompt`(410)/`interruptByParent`(476) | — |
| 枚举 | `listChildren(parentId)(index.ts:347)`、`listDescendants(rootId)(index.ts:366)` | — |
| Provider 注册 | `registerProvider(provider: SubagentProvider)(505)`/`getProvider`(528)/`list`(536)；6 个稳定 provider（in-process spawn/fork、acp、claude-code、codex、dsh-sdk），spawn/fork 均全能力(agentOptions/outputSchema/depthLimit/toolFilter/persona)+prepareContinuable | spawn:index.ts:42-61 fork:index.ts:63-84 |
| 成员子级组合钩子 | continuation 组装子 Agent 时应用 agentOptions(`child-agent.ts:98 resolveChildAgentOptions`)、persona+toolFilter→`childCtx.tools.restrict`(`child-agent.ts:199-217 applyChildComposition`) | continuation.ts:440-497 |
| 生命周期事件 | `subagent/start`(index.ts:164)、`subagent/end`(index.ts:173)，scope-filtered 按 delegating parent 派发 | — |

**结论：ctx.subagents 提供成员生成/durable 会话/消息收发/生命周期/深度+tool 名级约束，但无任何 workspace/file-path write-scope 或 owner/member 语义参数。** tools 层约束仅 `ToolRestriction` 按**工具名**过滤（`core/tools/src/index.ts:673`）。

## (b) experimental agent-team 机制对照（只读）

| durable 语义 | agent-team（experimental，不可 import） | ctx.subagents/稳定层 是否等价 |
|---|---|---|
| 成员模型 | 星型：root=Lead，teammate=`ctx.subagents.startContinuable` 的 durable child（`roster.ts:281-290`） | ✅ ctx.subagents 原生支持 |
| 成员注册表 | Lead Session log 存 `team/member` 快照（roster.ts:268-277） | ⚠️ 需自建事件类型，见 (c) |
| 消息信箱 | Lead log 记 queued/delivered 事件 + 目标 live `inject`/`followup`/离线 `queueHostSubagentPrompt`（mailbox.ts:55-339,265）；按 messageId 去重，先 flush 再记 delivered | ✅ 传输即 subagent continuation；持久语义需自建事件 |
| 任务板 CAS | 整值快照事件(`team/task`)+monotonic `revision`，`expectedRevision` 不符拒(`task-board.ts:119-124`)；per-root `journal.transact` 串行化（journal.ts:42-52） | ⚠️ 自建：SessionEventMap 注入+根 session log 即可复现 |
| owner/认领 | `ownerId` 存任务快照；非 lead 须 owner 才可改（task-board.ts:126-141） | ⚠️ 自建（同 CAS） |
| write-scope | 仅任务上 `writeScopes: string[]` **advisory 重叠告警，不阻断**（task-board.ts:266-294） | ❌ ctx.subagents 无此概念；需自建强制层 |
| 事件持久化 | SessionEventMap 扩展(`types.ts:220-236`)+Lead session log append+`ctx.sessions.flush`+projection fold(`agentTeam`)；注入依赖全为稳定服务(`index.ts:60`: agents/sessions/sessionPersistence/sessionProjections/subagents)；需挂 `dsh-session-persistence-jsonl`（稳定包）才激活 | ✅ 全部稳定层能力 |
| 恢复 | `agent/session-start` 触发 roster+mailbox recoverFor（index.ts:111,300-303） | ✅ ctx 事件原生支持 |

## (c) T20 自建可行路径（仅设计建议）

1. **复用星型拓扑**：root=科研协调 Agent；成员=`ctx.subagents.startContinuable`（in-process `fork`/`spawn`，全能力），每人独立 durable Session+FIFO inbox；不 import experimental，只参考其语义。
2. **SessionEventMap 注入**（openQuestion 所问核心）：仿 agent-team 在 `@deepseek-ai/dsh-session/types` 上 `declare module` 增 `research/member`、`research/task`(含 revision+ownerId+writeScopes)、`research/rev`(稿件/claim 修订) 事件；根 Session log 为权威 store，append+flush+projection fold 读取；`dsh-session-persistence-jsonl` 提供 on-disk durable。
3. **CAS 修订**：整值快照事件 + revision 单调增；per-root 事务队列串行化写；expectedRevision 不符即冲突拒绝（复刻 task-board/journal 模式，语义自研）。
4. **member write-scope 强制注入层**：ctx.subagents 不是正确的强制点 → 放 **tools guard/waterfall 层**：
   - 语义层：scope 归属存 durable `research/task.writeScopes`+owner；
   - 运行时：按成员在 `agent.ctx.tools.guard()`（index.ts:1101，deny-only monotonic，`core/tools/src/index.ts:704` 签名 `(exec: Readonly<ToolExecution>)=>string|undefined`，exec 含 name/arguments/agent）或 `tools/pre-execute`(index.ts:130 waterfall，可 deny) 校验写路径∈成员 scope。
   - 生效时机：经 `agent/session-start`/activation 观察者注入；每次 cold-resume 需重装（agent.ctx 贡献随 dispose 失效）。
5. **不包装/不 shadow ctx**：ctx.subagents 仅作成员传输与所有权层；owner 认领权限判定以 durable 数据为准、以调用方 exact-live Agent（`ctx.agents.get`）为身份凭据。

## (d) openQuestion#7 初步回答 + 需 PoC 验证点

**可复现**：agent-team 的 durable 语义全部建立于稳定层原语之上（SessionEventMap 开放扩展 `core/session/src/types.ts:259`、根 session append+flush `core/session/src/index.ts:670`、sessionProjections、continuation 成员、exact-live Agent 权威），experimental 只是其上的组合（mailbox.ts:265 直接调 `dsh-subagent/internal` 的 queueHostSubagentPrompt）。T20 以 SessionEventMap 注入 + 根 log 快照事件自建 CAS/owner/持久化，语义上可行。

**仍需 PoC**：
- P1 写入强制：agent.ctx 的 guard 每 activation/resume 重装时序（恢复先于首个 turn）；experimental 因 write-scope 仅 advisory 而无此负担——这是 T20 超出 experimental 的部分。
- P2 durable 激活：bundle 挂 `dsh-session-persistence-jsonl`；崩溃/重启后 projection fold 正确重放 `research/*` 事件。
- P3 root 离线边界：`markDelivered` 需 live root Agent 才能 append 根 log——成员消息在 Lead 离线时的 cold-resume 路径需验证。
- P4 单进程并发：CAS 串行化依赖 per-root 事务队列（单进程事件循环）；跨进程/多 host 不支持（与 X4 不并发一致）。
- P5 强制不变式：所有写须走 tools 管线内已注册工具（guard 才能拦截）；code-runtime/shell 等旁路写需另行界定。

## (e) 风险分级

- **P0**：无阻断。ctx.subagents 能力面完整覆盖 experimental 传输需求；无稳定 API 缺口。
- **P1（候选）**：R1 guard 重装缺失→成员脱管可越界写（高，PoC P1 必须过）；依赖 F-W4 pre-release 无兼容承诺（写稳定 Service Definition 不触 vendor）。
- **P2**：R2 根 log 整值快照事件增长无 compaction（experimental 亦如此，P7 需策略）；R3 projection 注册须先于 resume 首次读（时序 PoC）。
- **P3**：R4 guard 只覆盖 tools 管线（旁路写约束需设计边界说明）。
