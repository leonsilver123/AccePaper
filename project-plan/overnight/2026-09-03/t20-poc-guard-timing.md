# T20-R1 PoC：guard cold-resume/activation 重装时序（只读静态判定）

> Agent: general-purpose-22 ｜ 2026-09-03 ｜ 仓库零改动；未运行探针（静态可判定，见 §(d)）
> 问题：成员 Agent cold-resume 后、首个 turn 之前，agent.ctx.tools.guard() 贡献是否被重新安装？若靠观察者注入，恢复路径是否先于首个工具调用？

## (a) 恢复时序事实（证据=文件:行号）

1. **create 与 resume 同一漏斗**：`AgentLoop.createAgent`(core/agent-loop/src/index.ts:669) 与 `resume`(:717-774，先 `sessionPersistence.prepare`) 均进入 `setupAndPublish`(:689-709)：`prepare()` → `setup?.(agent.ctx)`(:702) → `publish(source)`(:704)。source='startup'|'resume'。
2. **agent.ctx 每次 activation 全新铸造**：`ReactLoopAgent` 构造器 `this.scope = createScope(loopCtx, this); this.ctx = this.scope.ctx.extend({ agent: this })`(agent-loop/src/agent.ts:103-105)；scope 由 lifecycle owner 在 driver 退出后 unwinds(agent.ts:75-76)。即 resume=新 ctx=新 scope 链，旧贡献随旧 scope 销毁，无跨 activation 残留。
3. **发布/事件顺序**（publish，agent-loop/src/index.ts:619-633）：`sessions.enter`(:621)→`agents.enter`(:622)→`sessions.announce`(:623)→`agents.announce`(:625, 同步 emit `agent/created`，core/agent/src/index.ts:555)→`emitAgentEvent('agent/session-start',{source})`(:630)。两事件在 create 与 resume 都触发；之后才开始 turn 驱动。事件类型：runtime-types.ts:166('agent/created')、:224('agent/session-start', payload{agent,source:SessionStartSource})。
4. **continuable 成员的 resume setup 由 subagent continuation manager 拥有**：`materializeTracked` 的 `setup` 闭包对 create 与 resume **都执行** `applyChildComposition(childCtx, parent, inputs.composition)`(subagent/src/continuation.ts:1129-1137；resume/create 分支 :1141-1155)。cold resume 的 composition 从持久化 descriptor 重建：`composition:{ persona: descriptor.persona, toolFilter: descriptor.toolFilter }`(continuation.ts:1018；descriptor 折叠 :998)。
5. **composition 词汇仅 persona+toolFilter**：continuation.ts:249-250 类型、child-agent.ts:199-217 applyChildComposition（toolFilter→`childCtx.tools.restrict`）。**无 guard 槽位**——guard 不在 descriptor/持久化词汇内。
6. **tools.guard 语义**：`guard()` 将回调注册到**调用 ctx 解析出的 scope 层**——plain ctx=global 层、agent.ctx=该 agent 层(core/tools/src/index.ts:1101-1107, doc :1092-1095)；求值**先 global 后 agent 链**(guardReason :1109-1119)；单调 deny-only，位于每个 `tools/pre-execute` 之后、tool body 之前(:696-703)。ToolExecution 携带 `name/arguments/agent`(input :307 起)。

## (b) guard 重装：自动还是手动？

- **自动的部分（无需干预）**：toolFilter(工具名级) 与 persona 经 descriptor→composition→setup 在每次 resume 自动重装（证据 4、5）。所以"成员的工具可见性约束"是 durable 的。
- **非自动的部分**：`tools.guard` 若注册于**旧 activation 的 agent.ctx**，随旧 scope 销毁；新 activation 的 setup 只跑 applyChildComposition，不含 guard → **无人重装即越界写窗口**。guard 不在持久化词汇中，也无法在不改 subagent 包的前提下搭 descriptor 顺风车（仓库零改动约束）。
- **观察者注入是否先于首个工具调用**：是。`agent/created`(:625) 与 `agent/session-start`(:630) 都在 publish 内、turn 驱动前同步触发；在 `agent/created` 监听器里对 `agent.ctx.tools.guard(...)` 注册先于该成员首个 turn 的任何工具调用。但注意它只对**当次 activation** 生效——resume 时会再次 emit `agent/created`，故"每次 activation 都装"在时序上可行、但必须每次重装。

## (c) 结论：write-scope 强制的可行注入方案（设计）

**首选——单一全局 guard（推荐，免疫 R1 时序）**：
- 在 dsh-research-team 插件 root ctx 注册**一次** `ctx.tools.guard(guard)`（plain ctx→global 层，core/tools/index.ts:1101）。生命周期=插件生命周期，不随成员 activation 卸载；进程重启后插件重装即恢复，先于任何成员 resume。
- guard 每次执行时按 `exec.agent.id`（exact-live Agent）→ durable 成员表/任务 owner+writeScopes（根 session projection 读取，属 T20 CAS/owner 板）→ 判定写路径∈该成员 in-progress 任务 scope；非团队成员/无匹配 owner→`undefined`(放行)。成员离线/resume 前后**每次调用都实时判定**，无重装时序问题。
- 配合持久化的 toolFilter 将成员可见写工具限定为可结构化校验 path 的研究写工具；run_code/shell 等不可路径校验工具对成员 deny（延续 R4 不变式）。

**次选——per-activation 注入（备胎）**：root ctx `ctx.on('agent/created')` 监听器按 agent.id 匹配成员并 `agent.ctx.tools.guard(...)`。时序成立（证据 3、6）但必须每次 activation 重装、且成员表须在 announce 前就绪（fresh spawn 由团队插件先记 childId→scope 内存映射再 startContinuable；resume 时须从根 projection 同步解析）。脆弱点：任何一次漏装=该 activation 全程脱管；不推荐。

**明确不采用**：包装/shadow ctx.subagents（传输层与强制层分离）；修改 subagent 包的 composition 词汇（禁）。

## (d) PoC 判定与需验证残余

- **静态结论**：guard 在 agent.ctx 上**不自动重装**（agent.ctx 每 activation 全新，continuation setup 只重放 persona+toolFilter）；但**有先于首个工具调用的注入点**（agent/created，publish 内同步）。因首选方案是 global guard + 执行期 durable 判定，R1 时序风险**在设计上消除** → **无需运行探针**（本轮 Bash 输出通道亦不可用，未运行）。
- **仍需小 PoC（后续轮次，低危）**：P-a global guard 对全进程非团队 agent 放行路径的回归验证；P-b `exec.agent` 在嵌套 one-shot（red-team 子代理）上的 lineage 解析到最近成员。

## (e) 风险分级

- **P0**：无。静态判定 clear；有完全免疫时序的注入方案。
- **P1**：无（若弃 global 方案走 per-activation agent/created 注入，则"漏装=脱管"为 P1 候选——故列为不推荐）。
- **P2**：R4 不变式——guard 只覆盖 tools 管线内调用；成员工具面须由持久化 toolFilter 收窄（该项工具名级自动重装，已证实）。全局 guard 的判定须读根 projection，需成员表在 lead resume 后可读（lead 先于成员 resume，由 mailbox recoverFor 驱动，成立）。
- **P3**：per-call durable 读的延迟/一致性（投影在 append+flush 后即一致，单进程内无并发 split-brain）。
