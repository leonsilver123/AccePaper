# @deepseek-ai/dsh-research-cordis

`dsh-research-core` 的 Cordis 适配器:把 16 步引擎暴露为 `ctx.research` 服务,并把七个研究工具注册到宿主真实的 `ctx.tools`。

本包是**薄适配层**:状态机委托给它,工具注册连同事务性回滚、可撤销句柄与模块私有 capability 一起在此实现。服务同时委托 T07/T08/T09 的纯结果面(`classifyL0` / `verifyCitation` / `evaluateGate` / `getGateIntent`),这些方法不触碰任何 run 状态。

## Known Limitations and Deferred Work

- 本服务**不把闸门结果自动写回 StepState**。这是刻意的设计边界(服务是纯委托层,由 driver 决定何时调用 `submitGateVerdict` / `completeStep`),而不是契约缺口——`hold_abstained` 的容身处由 core 提供(状态机把 abstained 步骤钉在 `gated` 并记 `holdReason='gate_abstained'`)。
- `requireResearchTools` 能令工具注册成为启动硬要求,但**出货的 `research-app` bundle 并未设置该 flag**,因此挂载后走 tolerant 分支,注册失败被静默吞掉。关闭它需要给 bundle 的 `research-cordis` 行加 `config`,并重新验证 1120 boot。
- `pipeline_only` 工具无法在不修改宿主的前提下经真实 ToolRuntime 全链执行(见 `ARCH-BLOCK-01`);红线是不得伪造 Agent、调用宿主私有方法或深度导入内部模块来绕过它。

No invariant companion is published: the adapter's effect and teardown relations are asserted by its own lifecycle and registration specs, so nothing is published as an `./invariant` companion.
