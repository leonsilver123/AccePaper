# @deepseek-ai/dsh-research-team

`ctx.agentTeams` 服务与 T19-B 运行器:红队舰队、带 CAS 修订的任务板、写入范围守卫、会话投影,以及把 16 步驱动起来的执行器注册表(`runner/`)。

分层是显式的:纯逻辑层(`types` / `revision` / `projection` / `scope-guard` / `roster` / `redteam` / `anchor` / `experiment`)→ 薄适配层(`journal` / `task-board` / `session-events` / `research-projection` / `research-guard`)→ `index.ts` 这一个接线点(服务声明、`SessionEventMap` 注入、`ctx.effect` 生命周期)。

`runner/registry.ts` 是 16 步执行器的审计真源:每个条目声明 `stepId` / `executor` / `producer` / `truthfulness` / `timeoutMs` / `gateRequirement` / `recoveryPolicy`,且输入输出 schema 与闸门要求都从 core 的冻结定义派生,以防与 16 步定义漂移。

## Known Limitations and Deferred Work

- 16 步中 8 步由真实工具函数执行(A1/A2/B3/C1/C2/C3/D1/E1),7 步是 fixture 执行器(A3/A4/B1/B2/D2/D3/D4,其中 B1/B2/D2/D3/D4 在有 `proseWriter` 时走模型、无 writer 时回退),另有 1 步人工门(E2)。该边界由 `tests/t34-single-step.spec.ts` 以断言锁定,漂移会失败。
- **实验的需求是测量出来的,不是写死的**:`runner/study-demand.ts` 由 `scripts/derive-demand-profile.mjs` 从真实小时交通量序列(UCI Metro Interstate Traffic Volume,CC BY 4.0)推导,序列哈希、推导步骤与全部建模假设都记录在产物里;`tests/demand-profile.spec.ts` 在数据集存在的机器上重新推导并比对,手改会失败。C1/B3/C3 的产物各带一份相同的 `demand` 证据块。
- **实验引擎是解析模型,不是微观仿真**:C 通道用 Webster 延误公式,两相位、每相位一条关键进口道、到达均匀、无排队尾部。绝对延误值是模型输出而非实测;两条控制策略在同一模型内比较,所以"比较"是测量,"绝对数值"不是。
- 驱动器的 `invoker` 与 `proseWriter` 注入面已接通,但 `proseWriter` **尚无生产装配点**:能同时看到 team 类型与具体实现的只有 bundle 层,而 `research-app` 目前是纯 YAML patch。真实模型路径因此未在出货路径启用。
- `runner/registry.ts` 单文件约 2250 行,同时承担类型词汇表、固定数据、15 个执行器与审计投影四类职责,拆分是已识别的债。
- **本包的测试不被任何 typecheck 聚合覆盖**(`tsconfig.host.json` 的 `exclude` 列出 `packages/research/*/tests/**`),因此测试源码的类型漂移不可见。实测:把 host 面的四个 research 测试 glob 重新纳入后有 184 个类型错误(cordis 23 / core 19 / team 89 / tools 53)。`dsh-research-web/tests/**` 必须留在 exclude —— 它是 client 面。

No invariant companion is published: the team fold and authorization relations are asserted by this package's own revision, projection and scope specs, and independent observers cannot diverge here, so no `./invariant` entry is published alongside it.
