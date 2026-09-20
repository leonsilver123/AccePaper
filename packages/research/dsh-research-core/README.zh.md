---
description: "研究运行的 16 步状态机、闸门裁决、引文身份链与运行快照存储,供驱动一次运行的适配器使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-research-core

[English](README.md) | 中文

## 概述

一次研究运行背后的状态机:五个阶段的 16 步、L0 文献分级、引文身份链、A/B/C 闸门裁决,以及让运行状态持久的快照存储。它零运行时依赖、零 Cordis —— 时钟、网络与每条闸门裁决的输入都由宿主提供 —— 所以同一内核可以跑在测试里、浏览器驱动的部署里,或一个恢复脚本里。人审批只经 `./host` 子路径可达,公共入口刻意不交出可变的步骤单例与裸的迁移动词。它的前提是 AI 生成的科学论断不可信,因此 `abstained` 的优先级高于其他任何结果,且永不可升级为 `passed`。

## 目录

- [状态机](#the-state-machine)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="the-state-machine"></a>
## 状态机

AI 科研论文生产系统的纯逻辑内核:16 步状态机、L0 文献分级、引文身份链、A/B/C 闸门裁决,以及运行状态快照存储。零运行时依赖、零 Cordis,可在任何宿主中单元测试。

设计前提是 **AI 生成的科学论断不可信**,因此状态机把"不可作弊地记录科研判断"落成约束:唯一前向迁移器、唯一闸门裁决器、`abstained` 优先级最高且永不可升级为 `passed`、人审批一次性防重放、回滚级联传递闭包、快照深克隆后深冻结。

这个包同时拥有研究层其余部分据以提交的词汇。`src/domain/` 声明一个值**由什么产出**(`sourceClass`、`sourceAccess`)以及一个部署的证据**允许是什么**(`EvidenceProfile`);产物信封及其 `ArtifactRef` 身份;任务 attempt 与授权它的 lease;绑定到它所裁断版本的 gate report;以及项目 revision 计数器。`src/engine/commit.ts` 是把一次 attempt 的产物变成运行正式工件的**唯一**位置 —— 原子地,并且在一道 attempt 围栏之下。

公共入口刻意不导出 `approveHumanGate` / `transition` / `submitHumanApproval` 与可变的步骤单例;人审批只经 `./host` 子路径可达,而该子路径只暴露受限的生产入口。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **产物会说出它产出于哪个项目版本**(2026-09-16):`ArtifactRecord`(以及快照投影出的、不含值的 `ArtifactRecordMeta`)带上 `projectRevision` —— 在发布这些产物的那次提交处写入,一路由逐条写的接缝写成运行当时的版本。**`ref.version` 替代不了它**:那个数的是**某一个**产物的第几版,于是一次提交产出的两个产物共享一个项目版本、却有着互不相关的版本号。这个字段在快照格式里是**必填**的 —— 没有它的快照会被拒绝而不是被默认填充,因为给一个产物安上一个它可能从未属于过的项目版本,会毁掉这个字段所承载的唯一事实。**三个读取者已经在用**:`runner/package-export.ts` 把它写进导出 manifest,Remote 投影把它带到浏览器,工作台把它标在运行旁边 —— 于是一个读者能分辨页面与下载说的是这份研究的同一个状态,还是两个。**仍然缺的**:还没有东西**逐个产物**地读它;产物元数据到达 wire 时没有带它。
- **批准绑定的是一个版本,而它过去绑定的是一个名字**(2026-09-16):`ApprovalRecord` 现在带 `targetRefs` —— 该步的输入,在做出决定的那一刻从运行自己的 registry 冻结,绝不取自调用方 —— 而 `approvalStalenessOf` 拿它与 registry 现在持有的比对,并点名移动了的那个版本。在这之前,记录里只有 `{run_id, step_id, attempt_id, principalId, approval_event_id, decision, timestamp}`,一点内容都没有:一个人批准的是摆在他面前的那份手稿,而记录只写着第 N 次 attempt 可以继续 —— 之后移动过的文档,仍然被一条关于**另一份**文档的决定覆盖着。同一个文件里的 `submitGateVerdict` 早就逐字节比对了,而批准那条路什么都不比。**在本次改动之前写下的记录恢复时没有 targets**,所以它的决定不绑任何东西、也不会被判过期 —— 那是它做出时所处的行为,而不是替它编造出来的 targets。
- **人也是生产者,而快照读取器现在知道这件事**(2026-09-17):接受一份候选稿曾把稿件以生产者 `human-acceptance` 发布在 E1 那一份之上,而快照解析器的规则 **那条生产者后来去了哪里**:发布现在继承它所替换版本的产出链,并把发布者记进 `publishedBy` —— 见下一条。 —— 「生产者必须命名活跃 16 步管线里的某一步」—— 恰好拒绝了这个值。于是**稿件被接受过的研究根本无法被恢复**:每一次 `tryLoad` 都抛错,`listRuns` 跟着抛错,页面上的研究列表回来是空的,而那份接受躺在磁盘上自称持久。规则现在允许 `ACCEPTANCE_PRODUCER`,目录之外别的什么都不放行 —— 这正是它本来的用途:管线从没跑过的生产者仍然是损坏。**这是浏览器探针发现的,不是测试发现的** —— 接受自己的 spec 都是从内存登记表读回稿件,而经由文件的这一趟往返直到这次才被覆盖。
- **一次发布保留它替换掉的产出链,而引擎对步骤输入只问一个问题**(2026-09-20,框架复核的 F2):`isInputSatisfied` 要求登记表记录的 `producerStepId` 命名一个状态为 `passed`、且 `attempt_id` 等于该记录 `producerAttemptId` 的步骤,而 `publishArtifactVersion`/`acceptManuscriptCandidate` 写的是发布者名字加 attempt `0` —— 于是一个被发布过的 slug **满足不了任何步骤输入**,一次导入、一次接受或一次修复之后,读它的每一步在这次运行的余生里都启动不了。`rollback` 帮不上忙(`invalidateArtifactsFor` 只动产出者与 attempt 都匹配的记录),于是唯一的恢复路径会丢掉人的编辑。**发布现在继承被替换记录的 `producerStepId`/`producerAttemptId`,并把发布者记进 `ArtifactRecord` 上新增的 `publishedBy`**,由 `ArtifactRecordMeta` 投影、由 `getRunSnapshot` 带出;继承不等于声称某一步写了这段文字,因为 `publishedBy` 与 `artifact-republished`/`manuscript-accepted` 审计记录(记下发布者、依据,以及被替换的版本与哈希)说明了是谁写的。**`unsatisfiedInputs` 按输入逐个陈述 `canStart` 本人的问题** —— `absent`、`invalidated`、`producer-not-passed`、`stale-attempt`,连同产出者及其状态 —— 驱动的 `startabilityOf` 现在渲染的就是它,而不是「它的状态与声明输入在驱动看来都可以启动」那句它偏偏为想解释的那种状态所说的话。快照读取器保留它对目录之外 `producerStepId` 的两条宽容,因为该格式会跨构建读取,去掉它们会让早期构建写下的研究无法读取。**What is not here**:恢复时除了类型之外不校验 `publishedBy`;而回滚发布所继承的那个步骤,现在会使被发布的版本失效 —— 同一条链的另一面。

- **超时现在会取消执行体,而此前不会**(2026-09-16):`runStep` 过去只在超时时结束**这次 attempt**,别的什么都不做 —— 执行体拿到的是**调用方的** signal,于是一次耗尽时间的执行无从得知这件事,继续跑下去,攥着一次模型调用、一个子进程或一次仿真,而它的结果会被当作迟到结果丢掉。现在执行体收到的是**这次 attempt 自己的** `AbortSignal`:调用方的 abort 与超时都会 abort 它,而预算作为 abort 的 reason 写明。attempt 仍然只结算一次,迟到的结果仍然被拒而不是被写入。**这不做的事**:它**不等待**执行体收尾。执行体若无视自己的 signal,那次步骤仍会在后台跑完;流水线报告超时后继续。
- **提交 receipt 不持久化**(2026-09-16):`StepState.commit` 记下是哪一次 attempt 提交的、用的哪个幂等键、产出了哪些 revision。`run-persistence` 不带它,所以被恢复的 attempt 读不回自己的 receipt。重放仍被既有的 `DSH_STEP_ALREADY_EXECUTED` 守卫挡住,所以这不会变成重复提交;持久化它属于拥有重启路径的那项 checkpoint 工作。
- **`recordArtifact` 仍是公开的单产物接缝**(2026-09-16):驱动路径经 `commitStepOutputs` 提交,但 `recordArtifact` 仍然导出,因为 `ctx.research.recordArtifact` 与恢复用 fixture 都在调它。它不是门禁旁路 —— `submitGateVerdict` 要求该 attempt 声明的整个产物集合,所以一次只写一个产物的调用方过不了一步。把两者合并,才会移除这条接缝。
- **`aggregateDisposition` 现在裁决一道真实的门,而 `domain/quality.ts` 的其余部分还没有**(2026-09-16):A 通道把它的 reviews 经 `checkDispositionOf` 映射,并按该轮声明的角色聚合,于是一条**没有运行**的必需检查会挡住一个 `judgeRound` 单独会放过的步骤。`GateReport`、`reportAnswers` 与 `parseGateReportIngress` 仍然没有生产调用者:判定按"存在 + attempt"绑定,而不是按一份签发的报告。
- `snapshot-store.ts` 目前没有生产消费方:它提供原子写盘与重放防护,但没有任何 runner 或团队代码读取它,因此会话进程级重启恢复仍未实现——底层已备,接线未做。
- 状态机记录判定,但不产出判定:闸门裁决的输入(L0 分级、引文核验、A/B/C 三通道)由调用方构造,本包不接触网络、文件系统或时钟。
- `ResearchError` 基类同时被闸门等纯逻辑兄弟模块导入。这是有意的近期安排(共享基类、无运行时环),长期应迁到中性模块以进一步解耦。

不发布不变式伴生入口:本包的跨模块不变式由其自身的 spec 直接断言,它也没有可供伴生的 `./invariant` 入口。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
