# @deepseek-ai/dsh-research-cordis

[English](README.md) | 中文

`dsh-research-core` 的 Cordis 适配器:把 16 步引擎暴露为 `ctx.research` 服务,并把七个研究工具注册到宿主真实的 `ctx.tools`。

本包是**薄适配层**:状态机委托给它,工具注册连同事务性回滚、可撤销句柄与模块私有 capability 一起在此实现。服务同时委托 T07/T08/T09 的纯结果面(`classifyL0` / `verifyCitation` / `evaluateGate` / `getGateIntent`),这些方法不触碰任何 run 状态。

## 部署级配置

三个字段各代表**一个**部署级选择,由引擎一次决定、全流水线共用:

| 字段 | 决定什么 | 省略时 |
|---|---|---|
| `literatureSearch` / `citationResolver` | 检索与引文身份链打哪个目录(`fixture` 或 `openalex`) | fixture(离线) |
| `prose` | 正文步骤走哪个 provider 路由 | 正文步骤输出其 fixture 文本,不调模型 |
| `workspace` | 引擎创建的**每个** agent 会话的绝对工作目录 | `process.cwd()` |

`workspace` 不是可有可无的:`{{cwd}}` 是**严格**系统提示变量,且每个出货 bundle 的 persona 都引用它。没有工作目录的会话会在**提示装配**阶段失败 —— 在任何请求到达 provider **之前**。`prose` 行**不**重复声明目录(`ProseChannelConfig` 把它 `Omit` 掉),所以每个部署只在一处写明它。

## 已知限制与延期工作

- 本服务**不把闸门结果自动写回 StepState**。这是刻意的设计边界(服务是纯委托层,由 driver 决定何时调用 `submitGateVerdict` / `completeStep`),而不是契约缺口——`hold_abstained` 的容身处由 core 提供(状态机把 abstained 步骤钉在 `gated` 并记 `holdReason='gate_abstained'`)。
- **工具注册改为等待 `tools` 服务出现(2026-09-14 修复)**。此前引擎在 `[Service.init]` 里直接挂载七工具插件,而 loader 是**并发**启动各 entry 的:真实 1120 boot 上实测 `ctx.get('tools')` 在引擎初始化时是 `undefined`、约 50 ms 后才出现。于是那次挂载被永久跳过,**出货 bundle 从未注册过任何一个 research 工具**,而 tolerant 分支把这个跳过吞掉了。现在改用 `ctx.inject(['tools'], …)`,注册在服务可用的那一刻提交;`ctx.research.toolsReady` 是它的提交点状态。
- `requireResearchTools` 的语义随之更正:它**不是**"没有 tools 服务就不许启动"(那个缺席在加载期无法与"还没起来"区分),而是"服务在、但注册未产出 Ours 时,抛错而不是吞掉"。出货 bundle 已设置它。
- **`pipeline_only` 工具的调用不走宿主运行时 —— 这是已接受的架构边界,不是待修的缺陷**(2026-09-14 用户裁定)。
  - 四个工具(`literature-search` / `citation-verify` / `claim-construct` / `ablation`)由**研究层直接调用**。它们**没有**进入宿主工具运行时,因此**不在**宿主的权限检查、沙箱与执行记录覆盖范围内。研究层保留自己的输入输出关联与错误记录 —— 但那**不等于**"经过宿主统一管理",**不得这样表述**。
  - **不影响它们干活,也不影响数据真假**:这四个工具照常执行,也可以处理真实数据(检索通道由 `cordis.yml` 配置,配了活目录就打到活目录)。缺的只是宿主那一层的统一管理。
  - **两条独立的事实,标签只描述其中一条**:调用方式记录在产物的 `invokerTruthfulness`(`direct_call` / `host_tool_runtime`);数据来源记录在适配器配置与产物自身的 `corpus` / `source` / `*Source` 字段。**直接调用不等于 fixture;用真实数据也不等于结论已验证** —— 两个标签合起来也不构成"这个结论被验证过"。
  - **何时再动它**:当确实需要让不可信插件、多用户或独立任务统一受权限 / 取消 / 超时 / 审计控制时,再单独启动宿主接口扩展(`packages/core/tools` 的公共接口)。**是否接真实模型不构成改造它的理由** —— 那两件事互相独立。
  - 红线不变:不得伪造 Agent、调用宿主私有方法、深度导入内部模块、恢复 agent-less 放行。

不发布不变式伴生入口:适配器的效果与拆除关系由其自身的生命周期与注册 spec 断言,因此没有任何东西作为 `./invariant` 伴生入口发布。
