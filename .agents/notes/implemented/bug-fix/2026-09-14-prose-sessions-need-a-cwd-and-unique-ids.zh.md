# Agent Note: 正文会话既需要工作目录,也需要能跨重启的 id

Status: implemented

[English](2026-09-14-prose-sessions-need-a-cwd-and-unique-ids.md) | 中文

## 问题

`LlmProseWriter` 是把正文步骤(A1 缺口分析、D2 提纲、D3 写作、D4 答辩)变成模型产出文本的通道。它经 `ctx.agentLoop.create` 创建一个 agent,再从该 agent 的会话里读回 assistant 文本。部署方给它配一个 provider 路由;出货的 `research-app` bundle 就是这么配的。

**它从来没有被执行过。** 在真实 boot 上驱动它,依次暴露出四个彼此独立的缺陷,而它们**全都报成同一个字符串** —— `the model produced no text (no default pass)`。

1. **服务读取未解析。** writer 用属性代理读 `ctx.agentLoop`。该代理只为**声明了 `agentLoop` 注入**的上下文解析;writer 由研究引擎构造,引擎没有声明。读取在请求存在之前就抛错了。

2. **没有工作目录。** `agentLoop.create(id, options, meta)` 的**第三个**参数才是会话创建元数据,而 `meta.cwd` 是 `{{cwd}}` 系统提示变量的唯一来源(`ctx.systemPrompt.variable('cwd', c => c.agent?.session.header.cwd)`)。writer 与它旁边的工具 invoker 都只传了两个参数。`{{cwd}}` 是**严格**变量,且每个出货 bundle 的 persona 都引用它,于是提示装配抛出
   `prompt variable "{{cwd}}" has no value for this assembly (section "deployment:persona")`,
   **请求根本没有到达 provider** —— 一个 `assistant/*` 事件都没产生。

3. **会话 id 撞车。** 会话 id 是 `research-prose-${counter}`,一个每次启动都从零开始的进程内计数器。会话是**持久化**的,所以第二次运行时存储拒绝该 id:`session "research-prose-0" is already persisted at a different cwd`。在工作目录恰好相同的情况下,后果比报错更糟 —— 这次写入会**恢复上一轮的会话**,把它的 assistant 文本拽进本次步骤的产物。

4. **掩盖本身。** 以上每一条都让会话没有 assistant 文本,而 writer 把它们一律报成"模型没有文本"。一句中性的措辞同时盖住了解析失败、装配失败与 id 撞车,这正是这条通道长期得不到诊断的原因。

另外两处边界契约也是错的:writer 的 abort 监听器挂在若干个 await **之后**,因此**已经 abort** 的信号被完全忽略,写入会对着一个已取消的请求跑完;而它也无法区分"provider 失败"与"模型什么也没回"。

## 决定

- 两个创建会话的调用点都传绝对 `cwd`,且它在各自配置里是**必填**的,不是调用点的默认值。`ResearchEngine` 解析一次:新增 `workspace` 配置字段,经显式的 `resolveWorkspace` 步骤,相对路径会被拒,并给出比会话层更清楚的错误。`Config.prose` 类型为 `ProseChannelConfig = Omit<LlmProseWriterConfig, 'cwd'>`,于是部署方**每个部署**声明一次目录,而不是每行写一次。
- 会话 id 带 `randomUUID()`。计数器无法对持久化存储保证安全。
- writer 在第一个 await **之前**检查 `request.signal?.aborted`,命中即拒。
- 没有产出文本的写入现在区分两种结果:以错误结束的轮次用**它自己的消息**报出(`turnErrorOf` 读 `turn/end` 的 `reason.error`);只有正常结束且没有文本的轮次才报"没有产出文本"。
- `AgentLoopResearchToolInvoker` —— 同样两处缺陷,尚无生产调用方 —— 采用同样的必填 `cwd` 与唯一会话 id。

## 归属与边界

`ResearchEngine` 拥有工作目录,因为它已经拥有其它部署级选择(`toolDeps`、`proseWriter`);一个值统管引擎创建的每个会话,于是 writer 与将来的 invoker 不可能各说各话。writer 拥有失败分型:它是唯一把会话事件读回来的组件。

本 note **不声称**正文通道已达到 Runtime-verified。在本机上,请求现在到达 provider 层并停在那里,逐字报出 `llm-deepseek: no API key for provider route "deepseek-official"` —— 对一个没有凭据的部署而言这是正确的姿态。要真正产出文本,需要 `plan/PRODUCT-CLOSURE-EXECUTION.md` 中记为 P1c 的确定性离线路由。

## 考虑过的替代方案

**在各调用点内部用 `process.cwd()` 推导 `cwd`。** 否决:它把部署方的选择藏进碰巧用到它的操作里 —— 正是仓库"显式优于隐式"规则所指名的模式(模板是 `dsh-shell` 的 request/spec 拆分)。

**让 `cwd` 可选、稍后再默认。** 否决:它要防的失败是提示装配抛错,而缺值恰恰是必须响亮失败的情形。

**保留计数器,在启动时清掉持久化的正文会话。** 否决:它把 writer 耦合到一个它并不拥有的清理步骤上,而两步之间的一次崩溃就会让撞车重新出现。

**把所有空结果一律报成带最后一轮原因的错误。** 否决:正常结束且没有文本是一个真实且不同的结果(模型只回了工具调用,或什么都没回),把它说成 provider 失败属于归因错误。

## 后果

- 配置了 `prose`、但运行在引用 `{{cwd}}` 的 persona 之下的部署现在无需额外配置即可工作,因为引擎提供了目录。
- 每次正文写入都是全新会话,因此重启后的进程无法复用上一轮的正文。
- 这条通道的失败会说出自己的成因 —— 正因如此才看得见第 3、4 条缺陷:每次修复都把报出的错误往深处推进一层,而不是停在同一句中性的话上。
- 该包的测试台现在**故意**挂载一个引用 `{{cwd}}` 的 persona,于是"缺目录"这个回归会挂掉一个测试而不是一个 boot。它断言请求**到达了 adapter**,而不只是断言文本回来了 —— 正是这个断言原先的缺席掩盖了最初的缺陷。
