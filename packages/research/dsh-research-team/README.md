# @deepseek-ai/dsh-research-team

`ctx.agentTeams` 服务与 T19-B 运行器:红队舰队、带 CAS 修订的任务板、写入范围守卫、会话投影,以及把 16 步驱动起来的执行器注册表(`runner/`)。

分层是显式的:纯逻辑层(`types` / `revision` / `projection` / `scope-guard` / `roster` / `redteam` / `anchor` / `experiment`)→ 薄适配层(`journal` / `task-board` / `session-events` / `research-projection` / `research-guard`)→ `index.ts` 这一个接线点(服务声明、`SessionEventMap` 注入、`ctx.effect` 生命周期)。

`runner/registry.ts` 是 16 步执行器的审计真源:每个条目声明 `stepId` / `executor` / `producer` / `truthfulness` / `timeoutMs` / `gateRequirement` / `recoveryPolicy`,且输入输出 schema 与闸门要求都从 core 的冻结定义派生,以防与 16 步定义漂移。

## Known Limitations and Deferred Work

- **真值等级是 5 级**(2026-09-14 增补 `local_computation`)。16 步的划分:
  - `real_tool_fixture_input`(5 步,工具函数真的执行):A1 / A2 / C3 / D1 / E1;
  - `local_computation`(5 步,无工具、无外部系统,由本包代码算出真实测量):A4 / B2 / B3 / C1 / C2;
  - `fixture_executor`(5 步,默认路径):A3 / B1 / D2 / D3 / D4 —— 这五步在有 `proseWriter` 时走真实模型,该路径记为 `live_external`;
  - `humanGate`(1 步):E2。该边界由 `tests/t34-single-step.spec.ts` 与 `tests/runner-registry.spec.ts` 以断言锁定。**为什么加这一级**:报告把 `real_tool_fixture_input` 印成 "Real tool functions executed",而 B3/C1/C2 根本不执行任何工具函数 —— 把它们挂在那一级等于让报告说了一句假话。
- 产物自己声明的等级(artifact 的 `__kind`)在本步所有产物一致时,是 `StepOutcome.kind` 的来源;静态注册表条目无法知道部署事实(A1 只有在配了真实通道时才触达活目录)。
- **A4-venue 的选刊改由检索语料推导**(2026-09-14):`landscape-map` 加入 A4 的声明输入(`dsh-research-core/src/engine/steps.ts`),executor 取检索记录里出现次数最多的 `venue` 作为目标期刊,计数与选取方法写在产物上。**范围匹配的判据仍是声明**,因为本研究会读期刊的投稿指南 —— 产物用 `scopeSource: 'declared'` 明说这一点。至此 16 步**每一步都有由输入推导的产物**。
- **实验的需求是测量出来的,不是写死的**:`runner/study-demand.ts` 由 `scripts/derive-demand-profile.mjs` 从真实小时交通量序列(UCI Metro Interstate Traffic Volume,CC BY 4.0)推导,序列哈希、推导步骤与全部建模假设都记录在产物里;`tests/demand-profile.spec.ts` 在数据集存在的机器上重新推导并比对,手改会失败。C1/B3/C3 的产物各带一份相同的 `demand` 证据块。
- **实验引擎是解析模型,不是微观仿真**:C 通道用 Webster 延误公式,两相位、每相位一条关键进口道、到达均匀、无排队尾部。绝对延误值是模型输出而非实测;两条控制策略在同一模型内比较,所以"比较"是测量,"绝对数值"不是。
- **解析模型已由 Eclipse SUMO 独立复跑**:`scripts/sumo-validation.mjs` 把同一组策略、同一份实测需求放进真实微观仿真,得到 17.93%(解析模型 11.09%)。方向一致、量级不同,原因与限制逐条记在 `plan/overnight/2026-09-14/sumo-validation.md`。**该脚本不接入流水线**,没有装 SUMO 的主机上一切不变。
- **基线是单一固定计划,不是分时段计划**:真实部署的 time-of-day 计划会吃掉部分降幅。这个比较对自适应有利,必须随结果一起声明。
- **`proseWriter` 的生产装配点已经存在**(2026-09-14 更正):`dsh-research-cordis` 的 `Config.prose` 构造 `LlmProseWriter`,`ResearchTeamService.hostProseWriter()` 读 `ctx.research.proseWriter` 并交给 `DriveOptions`,出货 bundle 的 `research-cordis` 行也配了它(`deepseek-official` / `deepseek-v4-pro`)。此前记的"尚无装配点"在当时已不准确。**仍未验证的是这一条链在真实模型上跑通** —— 该路径需要该路由的凭据,本 checkout 未做 live 复验。
- `runner/registry.ts` 单文件约 2250 行,同时承担类型词汇表、固定数据、15 个执行器与审计投影四类职责,拆分是已识别的债。
- **本包的测试现在被 host 聚合覆盖**(2026-09-14 修复):四个 host 面的 research 测试 glob 已从 `tsconfig.host.json` 的 `exclude` 移出,`tsc -b tsconfig.host.json` 会读它们。移出时暴露出 **159 个类型错误**,已全部修完 —— 其中不全是机械问题(一个指向不存在模块的 type-only 导入、一个被 import 了从未导出过的成员的 helper、一次实参个数错误的 `isComplete` 调用)。`dsh-research-web/tests/**` **必须留在 exclude** —— 它是 client 面,纳入会把浏览器源码拖进 host 程序。详见 `.agents/notes/implemented/testing/2026-09-14-research-tests-join-the-typecheck-aggregate.md`。
- **`pnpm run lint` 对 research 包仍然是红的(改动之前就是)**:改动前实测 299 个错误,测试并入聚合后为 155,其中 research `src/` 的 62 个不受该改动影响、是既存问题;剩余 90 个测试侧错误是真实规则违反(动态 import 产生 `any` 导致的不安全赋值等),留给单独的改动。

No invariant companion is published: the team fold and authorization relations are asserted by this package's own revision, projection and scope specs, and independent observers cannot diverge here, so no `./invariant` entry is published alongside it.

- **`runPipeline` 是 Remote 出口**(2026-09-14):`ResearchTeamService` 继承 `TypertRemoteService`,`@Remote('run')` 挂在 wire namespace `research` 下(服务键仍是 `agentTeams`)。它返回的是**快照** —— 运行本身 + 16 步目录 + 每条闸门判定(含 evidence/rationale)+ 产物元数据 + 每步的 attempt 与 holdReason —— 而不是 `RunResult`,因为目录与证据都不在 `RunResult` 里,客户端重建它们只能靠编造。包 `exports` 因此新增 `./types`、`./typert`、`./remote` 三条子路径。
- **人工审批的接线在 `src/approval.ts`**(2026-09-14):`E2-submit` 是唯一 `humanGate` 步,core 只经 `@deepseek-ai/dsh-research-core/host` 暴露能把 `gated` 变成 `passed` 的通道,该文件就是它的调用方。`runPipeline` 结束后把 run 的 store 与再投影函数交给 `rememberRun`,审批通道 `/research-approval` 的 `decide` 端点随后按 run / step / `humanGate` / 当前 `gated` 状态 / **当前 attempt** 逐项核对,再经 `HostApprovalChannel.submit` 让 core 写入 `ApprovalRecord` 与 `human-approval` 审计事件。**身份不取自请求体**:注册走 `ctx.connection.rpc.handle`,由宿主在自己的路由上先做浏览器认证(HMAC 签名的会话 cookie,其源头是 `dsh web` 打印的进程令牌),请求体只有 `runId` / `stepId` / `attempt` / `decision` 四个字段被读取,`actor` / `status` / `principalId` 一律不读。与 core 的 `./host` 一样,**这不是进程级隔离**:同进程内已持有 `Context` 的代码仍可直接调用;真正的隔离需要 IPC 身份,JavaScript API 给不了。
- **审批面不从包入口导出**(2026-09-14):`src/approval.ts` 故意不进 `index.ts` 的 re-export 列表,`ResearchTeamService` 上也没有对应的 Remote 方法。一个普通工具调用因此没有名字可以指过去,决定只能经那条已认证的路由到达。
- **构建顺序有坑**:`tsdown.config.ts` 的 `clean` 必须**只列本包真正产出的文件**。Client pass 在 Host pass 之后用同一份配置运行,`lib/*.js` 通配会删掉 Host pass 生成的 `typert.host.js` / `typert.remote-client.js`,而 Client pass 不会重新生成它们。
