# @deepseek-ai/dsh-research-team

[English](README.md) | 中文

`ctx.agentTeams` 服务与 T19-B 运行器:红队舰队、带 CAS 修订的任务板、写入范围守卫、会话投影,以及把 16 步驱动起来的执行器注册表(`runner/`)。

分层是显式的:纯逻辑层(`types` / `revision` / `projection` / `scope-guard` / `roster` / `redteam` / `anchor` / `experiment`)→ 薄适配层(`journal` / `task-board` / `session-events` / `research-projection` / `research-guard`)→ `index.ts` 这一个接线点(服务声明、`SessionEventMap` 注入、`ctx.effect` 生命周期)。

`runner/registry.ts` 是 16 步执行器的审计真源:每个条目声明 `stepId` / `executor` / `producer` / `truthfulness` / `timeoutMs` / `gateRequirement` / `recoveryPolicy`,且输入输出 schema 与闸门要求都从 core 的冻结定义派生,以防与 16 步定义漂移。

## 已知限制与延期工作

- **真值等级是 5 级**(2026-09-14 增补 `local_computation`)。16 步的划分:
  - `real_tool_fixture_input`(5 步,工具函数真的执行):A1 / A2 / C3 / D1 / E1;
  - `local_computation`(5 步,无工具、无外部系统,由本包代码算出真实测量):A4 / B2 / B3 / C1 / C2;
  - `fixture_executor`(5 步,默认路径):A3 / B1 / D2 / D3 / D4 —— 这五步在有 `proseWriter` 时走该 writer 的通道:`channel: 'llm'` 记为 `live_external`,出货装配的确定性通道记为 `mock_external`,标签由 `proseLabelling` 一处规则决定;
  - `humanGate`(1 步):E2。该边界由 `tests/t34-single-step.spec.ts` 与 `tests/runner-registry.spec.ts` 以断言锁定。**为什么加这一级**:报告把 `real_tool_fixture_input` 印成 "Real tool functions executed",而 B3/C1/C2 根本不执行任何工具函数 —— 把它们挂在那一级等于让报告说了一句假话。
- 产物自己声明的等级(artifact 的 `__kind`)在本步所有产物一致时,是 `StepOutcome.kind` 的来源;静态注册表条目无法知道部署事实(A1 只有在配了真实通道时才触达活目录)。
- **A4-venue 的选刊改由检索语料推导**(2026-09-14):`landscape-map` 加入 A4 的声明输入(`dsh-research-core/src/engine/steps.ts`),executor 取检索记录里出现次数最多的 `venue` 作为目标期刊,计数与选取方法写在产物上。**范围匹配的判据仍是声明**,因为本研究会读期刊的投稿指南 —— 产物用 `scopeSource: 'declared'` 明说这一点。至此 16 步**每一步都有由输入推导的产物**。
- **实验是车队跟驰仿真,不是查表**(2026-09-14 换):`runner/platoon-sim.ts` 用 IDM(Treiber/Hennecke/Helbing 2000)在声明的固定步长上积分两个车队 —— 全 HV 基线与 HV–AV–HV 变体 —— 反应延迟用环形缓冲取 leader 的延迟状态,报告最小 TTC、平均车头时距、平均 jerk 与字符串稳定性指数,全部从轨迹算出。**没有 fixture 表,也没有按 claim id 查表**。
- **本轮之前它测的是另一个研究**:C 通道曾用 Webster 延误公式测一个信号交叉口,而出货 Case Pack 讲的是车队 —— C1 的产物自己写着 `doesNotMeasure: 'platoon car-following risk …'`。那条线(`traffic-sim.ts`、`study-demand.ts`、`demand-profile.ts`、SUMOP 验证脚本及其生成器与 spec)已退役,交叉口需求推导不再有消费者。
- **两股机制是分开的,而且各自可消融**:反应延迟(leader 的过去状态)与预测(把观测到的状态向前外推一个 horizon)是两件事。第一版把 horizon 从延迟里**减掉**,于是两个"可分离机制"其实是同一根标量轴上的两点 —— 一个审计用 `{reaction:0.15,horizon:0.15}` 与 `{reaction:1.2,horizon:1.2}` 逐位相同的轨迹证明了这一点,Method 段里"AV 向前预测 0.15 s"那句话当时描述不了任何东西。
- **基线是同质车队,不是固定配时计划**:基线是 HV–HV–HV,变体是 HV–AV–HV。数字是模型输出而非实测;两个车队在同一模型内比较,所以"比较"是测量,"绝对数值"不是。
- **`proseWriter` 的生产装配点已经存在**(2026-09-14 更正):`dsh-research-cordis` 的 `Config.prose` 构造 `LlmProseWriter`,`ResearchTeamService.hostProseWriter()` 读 `ctx.research.proseWriter` 并交给 `DriveOptions`,出货 bundle 的 `research-cordis` 行也配了它(`deepseek-official` / `deepseek-v4-pro`)。此前记的"尚无装配点"在当时已不准确。**仍未验证的是这一条链在真实模型上跑通** —— 该路径需要该路由的凭据,本 checkout 未做 live 复验。
- `runner/registry.ts` 单文件约 2250 行,同时承担类型词汇表、固定数据、15 个执行器与审计投影四类职责,拆分是已识别的债。
- **本包的测试现在被 host 聚合覆盖**(2026-09-14 修复):四个 host 面的 research 测试 glob 已从 `tsconfig.host.json` 的 `exclude` 移出,`tsc -b tsconfig.host.json` 会读它们。移出时暴露出 **159 个类型错误**,已全部修完 —— 其中不全是机械问题(一个指向不存在模块的 type-only 导入、一个被 import 了从未导出过的成员的 helper、一次实参个数错误的 `isComplete` 调用)。`dsh-research-web/tests/**` **必须留在 exclude** —— 它是 client 面,纳入会把浏览器源码拖进 host 程序。详见 `.agents/notes/implemented/testing/2026-09-14-research-tests-join-the-typecheck-aggregate.md`。
- **`pnpm run lint` 对 research 包仍然是红的(改动之前就是)**:改动前实测 299 个错误,测试并入聚合后为 155,其中 research `src/` 的 62 个不受该改动影响、是既存问题;剩余 90 个测试侧错误是真实规则违反(动态 import 产生 `any` 导致的不安全赋值等),留给单独的改动。

不发布不变式伴生入口:团队折叠与授权关系由本包自身的修订、投影与作用域 spec 断言,且独立观察者在此不可能产生分歧,因此没有 `./invariant` 入口随之发布。

- **`runPipeline` 是 Remote 出口**(2026-09-14):`ResearchTeamService` 继承 `TypertRemoteService`,`@Remote('run')` 挂在 wire namespace `research` 下(服务键仍是 `agentTeams`)。它返回的是**快照** —— 运行本身 + 16 步目录 + 每条闸门判定(含 evidence/rationale)+ 产物元数据 + 每步的 attempt 与 holdReason —— 而不是 `RunResult`,因为目录与证据都不在 `RunResult` 里,客户端重建它们只能靠编造。包 `exports` 因此新增 `./types`、`./typert`、`./remote` 三条子路径。
- **人工审批的接线在 `src/approval.ts`**(2026-09-14):`E2-submit` 是唯一 `humanGate` 步,core 只经 `@deepseek-ai/dsh-research-core/host` 暴露能把 `gated` 变成 `passed` 的通道,该文件就是它的调用方。`runPipeline` 结束后把 run 的 store 与再投影函数交给 `rememberRun`,审批通道 `/research-approval` 的 `decide` 端点随后按 run / step / `humanGate` / 当前 `gated` 状态 / **当前 attempt** 逐项核对,再经 `HostApprovalChannel.submit` 让 core 写入 `ApprovalRecord` 与 `human-approval` 审计事件。**身份不取自请求体**:注册走 `ctx.connection.rpc.handle`,由宿主在自己的路由上先做浏览器认证(HMAC 签名的会话 cookie,其源头是 `dsh web` 打印的进程令牌),请求体只有 `runId` / `stepId` / `attempt` / `decision` 四个字段被读取,`actor` / `status` / `principalId` 一律不读。与 core 的 `./host` 一样,**这不是进程级隔离**:同进程内已持有 `Context` 的代码仍可直接调用;真正的隔离需要 IPC 身份,JavaScript API 给不了。
- **审批面不从包入口导出**(2026-09-14):`src/approval.ts` 故意不进 `index.ts` 的 re-export 列表,`ResearchTeamService` 上也没有对应的 Remote 方法。一个普通工具调用因此没有名字可以指过去,决定只能经那条已认证的路由到达。
- **构建顺序有坑**:`tsdown.config.ts` 的 `clean` 必须**只列本包真正产出的文件**。Client pass 在 Host pass 之后用同一份配置运行,`lib/*.js` 通配会删掉 Host pass 生成的 `typert.host.js` / `typert.remote-client.js`,而 Client pass 不会重新生成它们。
