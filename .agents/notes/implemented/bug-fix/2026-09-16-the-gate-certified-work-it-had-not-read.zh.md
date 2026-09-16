# Agent Note: The gate certified work it had not read

Status: implemented

[English](2026-09-16-the-gate-certified-work-it-had-not-read.md) | 中文

## Problem

一位独立复核者对第一轮交付(`project-plan/architecture-review-2026-09-15/FOLLOWUP-2026-09-16.md`)用**运行代码**而不是读代码的方式复现了四个缺陷。四个与之前那几个形状相同:代码声称的保证,它并没有兑现。

**F01 —— 旧判定批准了新 attempt 的产物。** A1 的 attempt 1 提交产物并通过 B 门。步骤回滚;attempt 2 提交**不同**的值。重新提交**同一个判定对象**,得到 attempt 2 的 `passed`。先前加的输出绑定检查只确认了"当前 attempt 产出了它声明的全部输出",从未确认"**这份**判定审查了它们"。`GateVerdict` 没有任何字段具名它关于什么,而 `reportAnswers` / `aggregateDisposition` / `parseGateReportIngress` 在研究链路上没有调用者。

**F02 —— "唯一提交点"有一条公开旁路。** `runStep` 提交 A1 的产物之后,`recordArtifact` 替换了 `landscape-map`,而项目 revision 停在 1。runner 已经不走那条路了,所以浏览器路径不受影响;但"唯一写正式产物的路径"描述的是**驱动器恰好怎么做**,不是**代码允许什么**。

**F03 —— checkpoint 可能被告知错误的那次运行。** 回调拿到的是 `runIdOf(store)` —— store 的第一个 key。当一个 store 里有两个 run(恢复测试本来就会产生这种形状)时,第二个 run 的 checkpoint 收到的是第一个 run 的 id。

**F04 —— 被阻挡的 production 运行导出 `submittable: true`。** `submittabilityOf('production')` 算的是"这个 profile 的证据**是否有可能**承载投稿",字段却叫 `submittable`,导出又把它直接投进 manifest。一次在 A1 就停住的 production 运行,交付了一个说自己可投稿的包。那次运行没有任何一处是就绪的。

## Decision

**F01 —— 判定带着它所审查的东西,门禁比对它。** `GateVerdict` 新增 `targetRefs` 与 `inputDigest`,而 `bindVerdict(verdict, receipt)` 是唯一会设置它们的函数。绑定发生在判定**被构建**的地方(`buildStepVerdicts`,依据该 attempt 的提交 receipt),**绝不在提交时**:在到达时盖章的判定会说它审查了它恰好落在一旁的那些输出 —— 而那正是让旧判定奏效的那种主张。`submitGateVerdict` 把判定的目标与当前 receipt 比对:不匹配就拒(`DSH_GATE_STALE_TARGET`),输入摘要不同就拒(`DSH_GATE_STALE_INPUTS`),什么都不具名也拒(`DSH_GATE_UNBOUND_VERDICT`)。

**F02 —— 提交就是正式写入。** `recordArtifact` 在该 attempt 已提交之后拒绝(`DSH_ARTIFACT_AFTER_COMMIT`),而门禁要求该 attempt 的提交 **receipt**(`DSH_GATE_WITHOUT_COMMIT`),不再从 registry 推断完整性。一个逐个补齐声明输出的 attempt 过不了门 —— 这正是上一轮那篇 Note 声称的性质。registry 还会与 receipt 对照(`DSH_GATE_COMMIT_MISMATCH`),所以就算一个值以别的方式被替换进去,也会被抓到。

这次迁移就是那约一百处 spec 调用点存在的理由:想要走到门的测试,现在和驱动器一样**提交**。

**F03 —— 驱动器把自己正在驱动的那次运行 id 传下去。** `checkpoint(runId, …)` 从 `runT19B` / `driveRemaining` 取它,`runIdOf` 已被删除。

**F04 —— 资格与就绪是两件事。** `submittabilityOf` 改名 `evidenceEligibilityOf`,返回 `{ eligible, reason }`:这是 profile 的性质,与任何具体运行无关。一次运行**是否就绪**是 `submissionReadinessOf`(team),从运行自己的状态算出 —— profile 合格、手稿存在、每一步都到过 `passed`。manifest 与运行摘要同时带上 `profileEligible`、`submissionReady` 与理由,于是读者能把演示、投稿、被阻挡的运行三者分开。

**持久化的判定保留它的目标。** `parseGateResults` 带上 `targetRefs` 与 `inputDigest`,`parseLooseArtifactRef` 读一个**不是 registry key** 的引用(判定的目标具名的是别的工件的 revision,所以那个按 key 校对的读取器不适用)。没有这一条,一次在重启前已经裁断过某步的运行,回来之后说不清那次裁断是关于什么的。

## Alternatives considered

**在提交时用当前目标给判定盖章。** 拒绝,而且复核报告明确点名了它:那会让旧判定与新判定无法区分,而这正是缺陷本身。绑定必须是一个判定的**输入**,不是门禁的**输出**。

**把 `targetRefs` 做成 `GateVerdict` 的必填字段。** 拒绝作为主要机制。这些值来自一份调用方**必须读过**的 receipt;把它们变成类型必填,只是把合法地从 fixture 构造判定的调用方的失败提前到编译期,而对"用今天的目标构造一个背后没有任何审查的判定"的调用方毫无作用。真正执行这条规则的是门禁处的拒绝;类型保持是描述。

**彻底删掉 `recordArtifact` 并迁移全部调用方。** 暂时拒绝:`ctx.research.recordArtifact` 是 cordis 服务上已发布的方法,恢复用 fixture 在用它,而 E2 人工门那条路径给一个空门、无提交的步骤写产物是合法的。**在提交之后**关闭它,移除了架构上的旁路(F02 说的就是这件事),而没有移掉一条仍有用户的接缝。声称得比代码多的那篇 Note 改成了与实际一致。

**保留 `submittabilityOf` 再加一个字段。** 拒绝:缺陷就是这个名字造成的。看到 `submittable: true` 的读者不会再去翻第二个限定它的字段。

**让导出拒绝为被阻挡的运行写包。** 拒绝:被阻挡运行的包是有用的 —— 人正是靠它看见运行停在哪里。不该发生的是那个包说自己就绪,而这一点现在是两个具名事实,不是一个含糊的。

## Consequences

- 四个复现的缺陷各自在**执行它的那一层**有了拒绝测试:`tests/commit.spec.ts`(F01 回滚后重放同一个判定对象、F02 提交后替换)、`tests/project-recovery.spec.ts`(F03 一个 store 里两个 run)、`tests/submission-readiness.spec.ts` 与 `tests/package-export.spec.ts`(F04)。
- `packages/research` 在 92 个文件上 **1665 通过**,两个 TypeScript 面构建干净。
- 门禁现在更严,并且改变了调用方必须做的事:不带 receipt 构建的判定会被拒。`helpers.ts` 新增 `commitAll` / `bindTo` / `submitBound`,让 spec 与 fixture 按驱动器的方式提交与绑定。
- `RUN_SNAPSHOT_SCHEMA_VERSION` 保持 3:持久化的判定新增的是可选字段,没有它们写下的记录仍能加载。
- 依赖闭包那条结论不受影响 —— 改的是门禁的**输入**,不是依赖图。
- **仍未关闭,并且写明而不是暗示**:复核者的 F 清单关闭了,但它那份六单元计划没有。真实 B 证据、方法—结果一致、证据驱动的写作、审查真实手稿、真实修订,全都没有建,而且没有一件比这四个更小。
