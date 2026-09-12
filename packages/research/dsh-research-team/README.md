# @deepseek-ai/dsh-research-team

`ctx.agentTeams` 服务与 T19-B 运行器:红队舰队、带 CAS 修订的任务板、写入范围守卫、会话投影,以及把 16 步驱动起来的执行器注册表(`runner/`)。

分层是显式的:纯逻辑层(`types` / `revision` / `projection` / `scope-guard` / `roster` / `redteam` / `anchor` / `experiment`)→ 薄适配层(`journal` / `task-board` / `session-events` / `research-projection` / `research-guard`)→ `index.ts` 这一个接线点(服务声明、`SessionEventMap` 注入、`ctx.effect` 生命周期)。

`runner/registry.ts` 是 16 步执行器的审计真源:每个条目声明 `stepId` / `executor` / `producer` / `truthfulness` / `timeoutMs` / `gateRequirement` / `recoveryPolicy`,且输入输出 schema 与闸门要求都从 core 的冻结定义派生,以防与 16 步定义漂移。

## Known Limitations and Deferred Work

- 16 步中只有 5 步执行真实工具(A1/A2/C3/D1/E1),其余 10 步是返回硬编码数据的 fixture 执行器,另有 1 步人工门(E2)。该边界由 `tests/t34-single-step.spec.ts` 以断言锁定,漂移会失败。
- 驱动器的 `invoker` 与 `proseWriter` 注入面已接通,但**尚无生产装配点**:能同时看到 team 类型与具体实现的只有 bundle 层,而 `research-app` 目前是纯 YAML patch。真实模型路径因此未在出货路径启用。
- `runner/registry.ts` 单文件约 1600 行,同时承担类型词汇表、固定数据、15 个执行器与审计投影四类职责,拆分是已识别的债。
- 三个执行期常量(固定时间戳 `FIXED_TS`、claim 阈值 8%、`SCENARIO.reductionRate` 9.1%)彼此独立,改动一处不会带动其余。

No invariant companion is published: the team fold and authorization relations are asserted by this package's own revision, projection and scope specs, and independent observers cannot diverge here, so no `./invariant` entry is published alongside it.
