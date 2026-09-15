# @deepseek-ai/dsh-research-team

[English](README.md) | 中文

`ctx.agentTeams` 服务与 T19-B 运行器:红队舰队、带 CAS 修订的任务板、写入范围守卫、会话投影,以及把 16 步驱动起来的执行器注册表(`runner/`)。

分层是显式的:纯逻辑层(`types` / `revision` / `projection` / `scope-guard` / `roster` / `redteam` / `anchor` / `experiment`)→ 薄适配层(`journal` / `task-board` / `session-events` / `research-projection` / `research-guard`)→ `index.ts` 这一个接线点(服务声明、`SessionEventMap` 注入、`ctx.effect` 生命周期)。

`runner/registry.ts` 是 16 步执行器的审计真源:每个条目声明 `stepId` / `executor` / `producer` / `truthfulness` / `timeoutMs` / `gateRequirement` / `recoveryPolicy`,且输入输出 schema 与闸门要求都从 core 的冻结定义派生,以防与 16 步定义漂移。

## 已知限制与延期工作

- **修订仍是一个标志,不是一份 Patch**(2026-09-16,实测):`D4-rebuttal` 把每一节都映射成 `{ ...section, revised: record.hasRevisions }`,于是一条"要求改稿"的意见会把**每一节**都标成已修订,而没有任何正文改变。一个离线探针比对 D3 与 D4 的正文,量到 `unchangedBodies: true, revisedFlags: [true, true]`。审查要的是一个 Issue–Patch–Verify 循环:只有在正文**确实**变过之后才置 `revised`,而要求改稿的意见在拿不出 diff 时不许关闭。**这是剩下最大的一个 P0,且尚未开工** —— 要做的是 D4 散文请求上的逐节 patch 格式、一步纯逻辑的"应用并验证",以及每条意见的 `disposition`(`patched` / `accepted_explanation` / `open`)。
- **A 门禁审的是 claim 材料,不是手稿**(2026-09-16,实测):`verdictA` 调的是 `reviewClaim(runCtx.claimMaterial)`,所以那三本离线规则手册判的是主张自己的字段,与 D3/D4 写了什么无关。一个离线探针改掉正文里的一个数字、删掉一节方法、跳过修订,三项都没有让 A 的票动一下。审查要的是一个绑定到 `targetVersion`、真的去读手稿及其证据的审稿任务。**尚未开工。**
- **写作者的上下文带的是标签,不是证据**(2026-09-16,实测):D3 请求的 context 键是 `field, direction, sectionId, claimRef, figureCount, citable`,最后一个是标签清单。方法规范、结果表、图数据和文献记录都在这次运行里,却一条都没有到达写作者,所以一个忠实的模型仍然写不出真实的 Results 一节。**尚未开工**;它与上面 A 门禁那条是同一个缺口的两半。
- **运行把它被解析时依据的配置记下来,重启读那条记录**(2026-09-16):`setRunSpec` 在第一步之前把研究方案、方案的来源、证据 profile 与每步预算存到运行上,受与运行输入相同的冻结约束。`resumeRunPipeline` 读那条记录,而不是从执行恢复的部署当下提供的东西里取标题、领域、方向、大纲与预算 —— 后者正是让"被恢复的运行"变成另一个研究的原因。主张那一半仍从工件覆盖,因为工件才是门禁裁断了什么的权威。**解析不出来的记录会静默回落到部署的方案**,除了快照自己的 spec 会与实际的驱动不一致 —— 格式现在要求这条记录,所以这只描述这次改动之前写下的记录。
- **运行每步之后做 checkpoint**(2026-09-16):`DriveOptions.checkpointAfterStep` 每完成一步就持久化一次快照,于是中途死掉的进程是恢复而不是从头再来。产物包仍然只在结束时导一次。失败的 checkpoint 收进 `RunResult.checkpointErrors`、运行继续 —— 那一步已经提交,失败是被**报告**而不是被抛出。
- **依赖图要对着步骤实际读的东西检查**(2026-09-16):`StepOutcome.readSlugs` 记下执行器运行时向 `getInput` 要过的每一个 slug,`tests/dependency-closure.spec.ts` 把它与声明的输入比对。两条未声明的读取是这样找出来的,现在已声明(`D2-framework` 读 `method-spec`,`E1-format` 读 `paper-outline`)。**`readSlugs` 只覆盖执行器直接调用的 `getInput`** —— 通过工具依赖去够工件的步骤不在其中,而目前没有这样的读取。
- **一次运行声明它的证据允许是什么,而出货 bundle 声明的是 `evaluation`**(2026-09-16):`DriveOptions.evidenceProfile` 由驱动器解析一次,交给每一条门通道;未声明的运行就是评估运行,它会执行、且全部输出被盖上不可投稿。B 通道现在**声明**它所构建锚的 provenance(`fixture`:一个针对合成语料的模拟解析器),而不再只在散文里描述;`verdictB` 在裁断之前调用 `admitAsEvidence`:在 `production` 下核验被扣下,由 core 自己的 `requireExternalAnchor` 产生弃权,于是锚是**扣住**门而不是通过它。`ResearchRunSnapshot` 带上 `evidenceProfile` / `submittable` / `submittabilityNote`,而 `run-summary.md` 与产物包 manifest 带上同样这三项,所以读包的人分得清演示与投稿。**`pending` 这一档还够不到端到端**:它是"真记录但全文没读"会产生的东西,而 B 通道目前还没有生产级来源。
- **一步的产物作为一个集合提交,门禁拒绝一个没有产出它们的步骤**(2026-09-16):`runStep` 不再逐 slug 写,而是调用 core 的 `commitStepOutputs` —— 它要求候选集合与该步声明的产物**恰好**相等,拒绝为"步骤已经走过去的那个 attempt"提交,并且在写任何东西**之前**就克隆并哈希每一个值。registry 条目带上 `ref`(工件 id、版本、规范化编码的 SHA-256),于是读者具名的是 revision 而不是 slug。当某个声明产物缺失、或属于另一个 attempt 时,`submitGateVerdict` 拒绝该判定。**提交 receipt 不持久化**,所以被恢复的 attempt 读不回自己的 receipt —— 重复执行仍被既有的 `DSH_STEP_ALREADY_EXECUTED` 守卫挡住,所以这个省略不会变成重复提交,但它属于 checkpoint 那项工作。
- **一次运行研究什么,由模型提出、由人确认**(2026-09-15):`@Remote('proposeDirections')` 收一个领域,答回若干候选 —— 标题、方向、主张,以及它承诺的判定标准 —— 每一个都已经过门自己那条主张级检查,所以 C 通道判不了的主张会带着理由被拒,而不是端上来再在半路弃审。客户端的运行控件打开一个对话框(`DirectionDialog.tsx`),判定标准是从方案自己声明的承诺里读出来渲染的,确认之后才按那个人确认的方案开始跑。`requirePlan`(`runner/study-plan.ts`)会拒掉从线上下来的方案 —— 缺字段、章节 id 跟骨架不一致、指标不是这项研究测的那个、或者主张门判不了 —— 而不是拿默认方案顶替:一次悄悄测了别的东西的运行,产出的工件讲的是一个没人要过的研究。
- **候选方向是写出来的,所以没有散文通道的部署提不了方向**(2026-09-15):`Config.prose` 没配写入器时 `proposeDirections` 直接拒绝,客户端的运行控件于是直接跑默认方案,而不是打开一个注定失败的对话框。对话框还会说明候选来自哪条通道,免得把确定性路由的输出当成模型的回答。**对话框自己搭了模态**:`@deepseek-ai/dsh-client-ui-primitives` 已经导出 `Modal`(portal、Escape 与遮罩关闭、设计令牌),而 `dsh-research-web` 还没依赖它,所以这个对话框没有 Escape 处理、颜色也是自己写的。换过去是机械的、只是推迟了,不是被挡住。**对话框展示候选的标题、方向、主张、预测与判定标准,但不展示它的章节标题。** 候选同样选定了章节标题 —— 它们是方案的一部分,也会进入手稿 —— 所以人确认的东西比对话框展示的多。把这一行渲染出来是小事,但还没做。
- **被测量的量仍然是研究的,不是方案的**(2026-09-15):候选的预测必须点出这次运行能测的那个量,因为能裁决"关于别的量"的主张的那个实验还不存在。指标不同的方案在边界上就被拒。把这件事解开的那一步 —— 生成并执行基准 —— 是下一个阶段。

- **研究是这次运行的数据,不是这个包源码里的常量**(2026-09-15):`runner/study-plan.ts` 装着 `StudyPlan` —— 手稿标题、领域、检索方向、章节骨架、主张(id、一句话引用、断言、本质差异、证伪实验、预测)以及被测量的量 —— 原先读 `CANONICAL_CLAIM_ID` / `CANONICAL_CLAIM_REF` / `CANONICAL_PREDICTION` / `CANONICAL_METRIC_KEY` / `DEFAULT_OUTLINE` / `DEFAULT_HEADING` 这些常量的地方,现在都读它。A1 的检索题目是 `plan.direction`,而同一个值也种进运行的 `domain-direction` 输入:这两者以前是两个值,而且题目是个没有任何输入喂给它的字面量,于是一次运行的文献可以是关于一个跟它的测量无关的题目。默认方案的方向因此就是这项研究自己的题目,而不再是 `adaptive traffic signal control`。`SCENARIO` 只留下没有任何方案会选择的东西 —— 两个编队、兜底 venue 和数据集文件。
- **方案还不是持久的,也没有面向部署的配置能声明它**(2026-09-15):一次运行从 `DriveOptions.studyPlan` 拿方案,拿不到就用默认方案、并让 `domainDirection` 替换该默认方案的方向;`dsh-research-cordis` 的 `Config` 里还没有方案字段。**恢复**会从运行已经记下的工件里重建方案的**主张**那一半(主张 id、引用、预测、指标键、承诺),但标题、领域、方向和大纲不在任何工件里,所以被恢复的运行从"执行恢复的那个部署"给的方案里拿这四项。默认方案下这是精确的;一个部署声明自己的方案、又去恢复另一个部署的运行时,就不精确。把方案持久化,属于"让人能给出方案"那次改动。
- **每个散文请求都带上这次运行的主题**(2026-09-15):每个 `proseWriter.write` 请求都往 `context` 里摊入 `planContextOf(plan)` —— 领域与方向;另外 D2 的章节名从 `plan.outline` 派生,而不是从一张 `DEFAULT_HEADING` 表。没有后者的话,方案改了一个章节的名字,输出里还会是旧名字。

- **判决门与具体研究是分开的,被测量的量是参数**(2026-09-15):`runner/prediction-gate.ts` 装着"一条主张到底能不能被判决"的那套纪律 —— 把主张绑到研究测的那个量上、把它写下的锚与方向词拿去和它自己声明的承诺对质、遇到否定就停手 —— 并把那个量当作参数(`MeasuredMetric`:主张声明的键、给人看的标签、值越大是否越好、以及主张必须真的用到的那些措辞)。在此之前它长在 `runner/platoon-sim.ts` 里、挨着一个跟车模型,别的领域的研究要够到它就得先 import 一个交通模块。现在研究通过 `PredictionGateInput.measure` 把自己的测量交进来,而那是一个回调:门只在每一道主张级检查都过了之后才调它 —— 正是这一点让一次跑坏的测量没法把措辞缺陷盖住。**这套参数化是由 `tests/prediction-gate.spec.ts` 里一个合成的延迟指标验证的,不是由第二份真的研究验证的**:这棵树里还没有第二份研究,所以"别的领域的研究够得到这套纪律"是在门自己的接口上被证明的,不是端到端被证明的。
- **只拿研究的符号去判方向词,是 `higher-is-better` 的假定**(2026-09-15):门直接从改进量的符号算出 `inClaimDirection`,于是在一个"越小越好"的量上,一条"shall lower the latency"的主张被判成要的是反方向,并被一个其实满足它的测量报成被反驳。现在读的是 `MeasuredMetric.direction`;车队那个场景行为不变,因为它的方向就是 `higher-is-better`,两种读法在那里一致。这个缺陷是上面那个合成指标的用例找出来的,不是出货的研究找出来的。

- **真值等级是 5 级**(2026-09-14 增补 `local_computation`)。16 步的划分:
  - `real_tool_fixture_input`(5 步,工具函数真的执行):A1 / A2 / C3 / D1 / E1;
  - `local_computation`(5 步,无工具、无外部系统,由本包代码算出真实测量):A4 / B2 / B3 / C1 / C2;
  - `fixture_executor`(5 步,默认路径):A3 / B1 / D2 / D3 / D4 —— 这五步在有 `proseWriter` 时走该 writer 的通道:`channel: 'llm'` 记为 `live_external`,出货装配的确定性通道记为 `mock_external`,标签由 `proseLabelling` 一处规则决定;
  - `humanGate`(1 步):E2。该边界由 `tests/t34-single-step.spec.ts` 与 `tests/runner-registry.spec.ts` 以断言锁定。**为什么加这一级**:报告把 `real_tool_fixture_input` 印成 "Real tool functions executed",而 B3/C1/C2 根本不执行任何工具函数 —— 把它们挂在那一级等于让报告说了一句假话。
- 产物自己声明的等级(artifact 的 `__kind`)在本步所有产物一致时,是 `StepOutcome.kind` 的来源;静态注册表条目无法知道部署事实(A1 只有在配了真实通道时才触达活目录)。
- **A4-venue 的选刊改由检索语料推导**(2026-09-14):`landscape-map` 加入 A4 的声明输入(`dsh-research-core/src/engine/steps.ts`),executor 取检索记录里出现次数最多的 `venue` 作为目标期刊,计数与选取方法写在产物上。**范围匹配的判据仍是声明**,因为本研究会读期刊的投稿指南 —— 产物用 `scopeSource: 'declared'` 明说这一点。至此 16 步**每一步都有由输入推导的产物**。
- **实验是车队跟驰仿真,不是查表**(2026-09-14 换):`runner/platoon-sim.ts` 用 IDM(Treiber/Hennecke/Helbing 2000)在声明的固定步长上积分两个车队 —— 全 HV 基线与 HV–AV–HV 变体 —— 反应延迟用环形缓冲取 leader 的延迟状态,报告最小 TTC、平均车头时距、平均 jerk 与字符串稳定性指数,全部从轨迹算出。**没有 fixture 表,也没有按 claim id 查表**。
- **本轮之前它测的是另一个研究**:C 通道曾用 Webster 延误公式测一个信号交叉口,而出货 Case Pack 讲的是车队 —— C1 的产物自己写着 `doesNotMeasure: 'platoon car-following risk …'`。那条线(`traffic-sim.ts`、`study-demand.ts`、`demand-profile.ts`、SUMOP 验证脚本及其生成器与 spec)已退役,交叉口需求推导不再有消费方。
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
