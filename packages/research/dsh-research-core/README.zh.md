# @deepseek-ai/dsh-research-core

[English](README.md) | 中文

AI 科研论文生产系统的纯逻辑内核:16 步状态机、L0 文献分级、引文身份链、A/B/C 闸门裁决,以及运行状态快照存储。零运行时依赖、零 Cordis,可在任何宿主中单元测试。

设计前提是 **AI 生成的科学论断不可信**,因此状态机把"不可作弊地记录科研判断"落成约束:唯一前向迁移器、唯一闸门裁决器、`abstained` 优先级最高且永不可升级为 `passed`、人审批一次性防重放、回滚级联传递闭包、快照深克隆后深冻结。

这个包同时拥有研究层其余部分据以提交的词汇。`src/domain/` 声明一个值**由什么产出**(`sourceClass`、`sourceAccess`)以及一个部署的证据**允许是什么**(`EvidenceProfile`);产物信封及其 `ArtifactRef` 身份;任务 attempt 与授权它的 lease;绑定到它所裁断版本的 gate report;以及项目 revision 计数器。`src/engine/commit.ts` 是把一次 attempt 的产物变成运行正式工件的**唯一**位置 —— 原子地,并且在一道 attempt 围栏之下。

公共入口刻意不导出 `approveHumanGate` / `transition` / `submitHumanApproval` 与可变的步骤单例;人审批只经 `./host` 子路径可达,而该子路径只暴露受限的生产入口。

## 已知限制与延期工作

- **产物会说出它产出于哪个项目版本**(2026-09-16):`ArtifactRecord`(以及快照投影出的、不含值的 `ArtifactRecordMeta`)带上 `projectRevision` —— 在发布这些产物的那次提交处写入,一路由逐条写的接缝写成运行当时的版本。**`ref.version` 替代不了它**:那个数的是**某一个**产物的第几版,于是一次提交产出的两个产物共享一个项目版本、却有着互不相关的版本号。这个字段在快照格式里是**必填**的 —— 没有它的快照会被拒绝而不是被默认填充,因为给一个产物安上一个它可能从未属于过的项目版本,会毁掉这个字段所承载的唯一事实。**三个读取者已经在用**:`runner/package-export.ts` 把它写进导出 manifest,Remote 投影把它带到浏览器,工作台把它标在运行旁边 —— 于是一个读者能分辨页面与下载说的是这份研究的同一个状态,还是两个。**仍然缺的**:还没有东西**逐个产物**地读它;产物元数据到达 wire 时没有带它。
- **批准绑定的是一个版本,而它过去绑定的是一个名字**(2026-09-16):`ApprovalRecord` 现在带 `targetRefs` —— 该步的输入,在做出决定的那一刻从运行自己的 registry 冻结,绝不取自调用方 —— 而 `approvalStalenessOf` 拿它与 registry 现在持有的比对,并点名移动了的那个版本。在这之前,记录里只有 `{run_id, step_id, attempt_id, principalId, approval_event_id, decision, timestamp}`,一点内容都没有:一个人批准的是摆在他面前的那份手稿,而记录只写着第 N 次 attempt 可以继续 —— 之后移动过的文档,仍然被一条关于**另一份**文档的决定覆盖着。同一个文件里的 `submitGateVerdict` 早就逐字节比对了,而批准那条路什么都不比。**在本次改动之前写下的记录恢复时没有 targets**,所以它的决定不绑任何东西、也不会被判过期 —— 那是它做出时所处的行为,而不是替它编造出来的 targets。
- **超时现在会取消执行体,而此前不会**(2026-09-16):`runStep` 过去只在超时时结束**这次 attempt**,别的什么都不做 —— 执行体拿到的是**调用方的** signal,于是一次耗尽时间的执行无从得知这件事,继续跑下去,攥着一次模型调用、一个子进程或一次仿真,而它的结果会被当作迟到结果丢掉。现在执行体收到的是**这次 attempt 自己的** `AbortSignal`:调用方的 abort 与超时都会 abort 它,而预算作为 abort 的 reason 写明。attempt 仍然只结算一次,迟到的结果仍然被拒而不是被写入。**这不做的事**:它**不等待**执行体收尾。执行体若无视自己的 signal,那次步骤仍会在后台跑完;流水线报告超时后继续。
- **提交 receipt 不持久化**(2026-09-16):`StepState.commit` 记下是哪一次 attempt 提交的、用的哪个幂等键、产出了哪些 revision。`run-persistence` 不带它,所以被恢复的 attempt 读不回自己的 receipt。重放仍被既有的 `DSH_STEP_ALREADY_EXECUTED` 守卫挡住,所以这不会变成重复提交;持久化它属于拥有重启路径的那项 checkpoint 工作。
- **`recordArtifact` 仍是公开的单产物接缝**(2026-09-16):驱动路径经 `commitStepOutputs` 提交,但 `recordArtifact` 仍然导出,因为 `ctx.research.recordArtifact` 与恢复用 fixture 都在调它。它不是门禁旁路 —— `submitGateVerdict` 要求该 attempt 声明的整个产物集合,所以一次只写一个产物的调用方过不了一步。把两者合并,才会移除这条接缝。
- **门禁按"存在 + attempt"绑定,不按摘要绑定**(2026-09-16):`domain/quality.ts` 装着 `GateReport`、`aggregateDisposition` 与 `reportAnswers`,用于把判定绑到确切的版本上,但目前还没有生产路径签发它们;审查层才是它的消费者。
- `snapshot-store.ts` 目前没有生产消费方:它提供原子写盘与重放防护,但没有任何 runner 或团队代码读取它,因此会话进程级重启恢复仍未实现——底层已备,接线未做。
- 状态机记录判定,但不产出判定:闸门裁决的输入(L0 分级、引文核验、A/B/C 三通道)由调用方构造,本包不接触网络、文件系统或时钟。
- `ResearchError` 基类同时被闸门等纯逻辑兄弟模块导入。这是有意的近期安排(共享基类、无运行时环),长期应迁到中性模块以进一步解耦。

不发布不变式伴生入口:本包的跨模块不变式由其自身的 spec 直接断言,它也没有可供伴生的 `./invariant` 入口。
