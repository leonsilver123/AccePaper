# @deepseek-ai/dsh-research-cordis

`dsh-research-core` 的 Cordis 适配器:把 16 步引擎暴露为 `ctx.research` 服务,并把七个研究工具注册到宿主真实的 `ctx.tools`。

本包是**薄适配层**:状态机委托给它,工具注册连同事务性回滚、可撤销句柄与模块私有 capability 一起在此实现。服务同时委托 T07/T08/T09 的纯结果面(`classifyL0` / `verifyCitation` / `evaluateGate` / `getGateIntent`),这些方法不触碰任何 run 状态。

## Known Limitations and Deferred Work

- 本服务**不把闸门结果自动写回 StepState**。这是刻意的设计边界(服务是纯委托层,由 driver 决定何时调用 `submitGateVerdict` / `completeStep`),而不是契约缺口——`hold_abstained` 的容身处由 core 提供(状态机把 abstained 步骤钉在 `gated` 并记 `holdReason='gate_abstained'`)。
- **工具注册改为等待 `tools` 服务出现(2026-09-14 修复)**。此前引擎在 `[Service.init]` 里直接挂载七工具插件,而 loader 是**并发**启动各 entry 的:真实 1120 boot 上实测 `ctx.get('tools')` 在引擎初始化时是 `undefined`、约 50 ms 后才出现。于是那次挂载被永久跳过,**出货 bundle 从未注册过任何一个 research 工具**,而 tolerant 分支把这个跳过吞掉了。现在改用 `ctx.inject(['tools'], …)`,注册在服务可用的那一刻提交;`ctx.research.toolsReady` 是它的提交点状态。
- `requireResearchTools` 的语义随之更正:它**不是**"没有 tools 服务就不许启动"(那个缺席在加载期无法与"还没起来"区分),而是"服务在、但注册未产出 Ours 时,抛错而不是吞掉"。出货 bundle 已设置它。
- `pipeline_only` 工具无法在不修改宿主的前提下经真实 ToolRuntime 全链执行(见 `ARCH-BLOCK-01`);红线是不得伪造 Agent、调用宿主私有方法或深度导入内部模块来绕过它。

No invariant companion is published: the adapter's effect and teardown relations are asserted by its own lifecycle and registration specs, so nothing is published as an `./invariant` companion.
