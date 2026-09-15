# @deepseek-ai/dsh-research-core

[English](README.md) | 中文

AI 科研论文生产系统的纯逻辑内核:16 步状态机、L0 文献分级、引文身份链、A/B/C 闸门裁决,以及运行状态快照存储。零运行时依赖、零 Cordis,可在任何宿主中单元测试。

设计前提是 **AI 生成的科学论断不可信**,因此状态机把"不可作弊地记录科研判断"落成约束:唯一前向迁移器、唯一闸门裁决器、`abstained` 优先级最高且永不可升级为 `passed`、人审批一次性防重放、回滚级联传递闭包、快照深克隆后深冻结。

这个包同时拥有研究层其余部分据以提交的词汇。`src/domain/` 声明一个值**由什么产出**(`sourceClass`、`sourceAccess`)以及一个部署的证据**允许是什么**(`EvidenceProfile`);产物信封及其 `ArtifactRef` 身份;任务 attempt 与授权它的 lease;绑定到它所裁断版本的 gate report;以及项目 revision 计数器。`src/engine/commit.ts` 是把一次 attempt 的产物变成运行正式工件的**唯一**位置 —— 原子地,并且在一道 attempt 围栏之下。

公共入口刻意不导出 `approveHumanGate` / `transition` / `submitHumanApproval` 与可变的步骤单例;人审批只经 `./host` 子路径可达,而该子路径只暴露受限的生产入口。

## 已知限制与延期工作

- **提交 receipt 不持久化**(2026-09-16):`StepState.commit` 记下是哪一次 attempt 提交的、用的哪个幂等键、产出了哪些 revision。`run-persistence` 不带它,所以被恢复的 attempt 读不回自己的 receipt。重放仍被既有的 `DSH_STEP_ALREADY_EXECUTED` 守卫挡住,所以这不会变成重复提交;持久化它属于拥有重启路径的那项 checkpoint 工作。
- **`recordArtifact` 仍是公开的单产物接缝**(2026-09-16):驱动路径经 `commitStepOutputs` 提交,但 `recordArtifact` 仍然导出,因为 `ctx.research.recordArtifact` 与恢复用 fixture 都在调它。它不是门禁旁路 —— `submitGateVerdict` 要求该 attempt 声明的整个产物集合,所以一次只写一个产物的调用方过不了一步。把两者合并,才会移除这条接缝。
- **门禁按"存在 + attempt"绑定,不按摘要绑定**(2026-09-16):`domain/quality.ts` 装着 `GateReport`、`aggregateDisposition` 与 `reportAnswers`,用于把判定绑到确切的版本上,但目前还没有生产路径签发它们;审查层才是它的消费者。
- `snapshot-store.ts` 目前没有生产消费方:它提供原子写盘与重放防护,但没有任何 runner 或团队代码读取它,因此会话进程级重启恢复仍未实现——底层已备,接线未做。
- 状态机记录判定,但不产出判定:闸门裁决的输入(L0 分级、引文核验、A/B/C 三通道)由调用方构造,本包不接触网络、文件系统或时钟。
- `ResearchError` 基类同时被闸门等纯逻辑兄弟模块导入。这是有意的近期安排(共享基类、无运行时环),长期应迁到中性模块以进一步解耦。

不发布不变式伴生入口:本包的跨模块不变式由其自身的 spec 直接断言,它也没有可供伴生的 `./invariant` 入口。
