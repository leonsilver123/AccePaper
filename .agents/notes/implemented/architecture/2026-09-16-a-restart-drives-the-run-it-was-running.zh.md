# Agent Note: A restart drives the run it was running, from a graph the steps actually read

Status: implemented

[English](2026-09-16-a-restart-drives-the-run-it-was-running.md) | 中文

## Problem

架构审查(`project-plan/architecture-review-2026-09-15/`)里的三条发现共用一个主题:引擎对一次运行的画像,不是那次运行本身。

**被恢复的运行不是停下来的那次运行**(J04)。`resumeRunPipeline` 从运行已记录的工件里重建跨步上下文 —— 主张、预测、指标键 —— 其余全部取自**执行恢复的那个部署**所提供的方案与配置。方案的标题、领域、检索方向与章节骨架不在任何工件里,所以一个部署改过方案之后再恢复,写出来的手稿讲的是一个它自己的门禁没有裁断过的研究。每步预算也没有带过来:一次走模型路由的运行,以注册表里那条离线预算恢复,第一个长步骤就被记成 `timeout`。

**运行只在结束时保存一次**(J03)。`runPipeline` 只在 `runT19B` 返回之后调一次 `recordRun`。中途死掉的进程会丢掉它已经完成的每一步,包括那些花了模型额度的步骤。快照存储自己的锁与版本守卫,补不上一次**从未发生**的 checkpoint。

**两个执行器读了它们定义里没有声明的输入**(J06)。`D2-framework` 读 `method-spec`;`E1-format` 读 `paper-outline`。一步声明的 `inputs` **就是**引擎的依赖图 —— `canStart` 读它决定什么可以跑,`rollback` 沿它决定重跑要作废什么 —— 所以一条未声明的读取是一条**没有东西看得见**的真实依赖。重跑方法推导不会作废从它派生的框架。

## Decision

**运行把它被解析时依据的配置记下来,重启读那条记录。**

`setRunSpec(store, runId, spec)` 在运行上存一条不透明记录,受与运行输入相同的冻结约束:任何一步开始之后就被拒 —— 一个在运行中的研究底下变过的方案,描述的是一个从未发生过的运行。core 不解释这条记录。`runT19B` 在第一步之前写入 `{ studyPlan, planSource, evidenceProfile, stepTimeoutMs }`,`resumeRunPipeline` 把它读回来 —— 方案经 `requirePlan` 校验,与一份从线上下来的方案所受的检查相同 —— 只有记录里没有时才回落到部署自己的方案。

主张那一半随后仍会从工件覆盖,而且是有意的:工件才是"门禁实际裁断了什么"的权威,所以一次中途重导过主张的运行,不会落成"门禁判的是一个主张、正文描述的是另一个"。

**运行每步之后做 checkpoint。** `DriveOptions.checkpointAfterStep` 拿到运行 id 与刚结束的步骤;`runPipeline` 与 `resumeRunPipeline` 各传一个持久化器。它只写**快照** —— 可复现产物包是一次**完成**运行的产物,每步都重导会在一个目录里写十六遍半成品。

失败的 checkpoint 被收进 `RunResult.checkpointErrors`,运行**继续**。它紧随的那一步已经提交,停下来等于拿真实的工作去换一个持久性警告;但这个失败不能不说出来,因为"中间状态从未写盘"的运行,和"写了"的运行看起来一模一样 —— 直到进程死掉。

记录是运行快照的版本 3:`run.spec` 与每步的 `commit` receipt,与 `run.projectRevision`、每条 registry 条目的 `ref` 并列。带上 receipt,幂等键才能跨重启存活 —— 没有它,崩溃后的一次重放会被读成第一次提交。

**依赖图要对着步骤**实际读的东西**检查。** 驱动器记下执行器向 `getInput` 要过的每一个 slug(`StepOutcome.readSlugs`),并在提交时解析它们的版本 —— 这也让 receipt 的 `inputDigest` 具名一个状态,而不是占位符。`workflow/dependency-graph.ts` 把这份**观测到的**清单与定义比对(`undeclaredReads`),并把回滚闭包(`transitiveDependents`)与环检查(`forwardEdges`)写成 spec 可以据以断言**预期图**的函数;`steps.ts` 现在声明了缺失的那两条边。

检查刻意是**观测**而不是再声明一遍:第二份手工维护的"这个执行器读什么"清单,只会重复第一份犯过的错 —— 而第一份的错之所以长期看不出来,正是这个原因。

## Alternatives considered

**把方案持久化到 core 认识的字段里。** 拒绝:core 拥有的是 16 步引擎,它没有"研究方案"的词汇;为了存一个不透明块而给它造一个,等于把研究层的概念塞进可移植内核。记录刻意是 `Record<string, unknown>` —— core 存它,team 解释它。

**让恢复拒绝任何没有记录 spec 的运行。** 拒绝:那会连合法地没有 spec 的运行一起拒掉,而诚实的回落是"用部署的方案,并把这件事说出来"。格式现在要求这条记录,所以"没有记录"只描述这次改动之前写下的记录。

**checkpoint 失败就终止运行。** 拒绝:持久性是状态的性质,而停掉一个已经做完工作的运行,会毁掉 checkpoint 本来要保住的那个东西。

**在 `commitStepOutputs` 里做 checkpoint。** 拒绝:那会让 core 需要文件系统,而提交点的全部价值就在于它是一次纯内存事务。checkpoint 是**驱动器**的事,现在也在那里。

**用注册表条目声明的方式记录读取。** 拒绝,理由同上 —— 那正是已经失败过的机制。注册表条目需要的是执行器,观测需要的是它发出的那次调用。

**现在就加 `not_applicable` 运行状态和 `WorkflowRecipe`。** 推迟,不是拒绝:审查的配方词汇(按论文类型的 `required / optional / not_applicable`)需要一个既不是 pending 也不是 passed 的运行状态,那是一次自带验收测试的状态机改动。先发类型、后有读者,正是本仓库自己的规则点名的失败。

## Consequences

- 重启会按运行启动时的方案、profile 与预算驱动它。`tests/project-recovery.spec.ts` 保存一次以"不可能是任何人默认值"的方案驱动的运行,在新的持久化里加载,并用恢复自己的那份校验把方案读回来。
- `run-spec-set` 与 receipt 进入落盘格式;`RUN_SNAPSHOT_SCHEMA_VERSION` 升到 3,所以版本 2 写下的记录不再加载。这正是"拒绝旧格式"的预期行为,而出货的 snapshot 目录是 gitignore 的暂存区。
- 出货执行器发出的每一次读取现在都有声明:`tests/dependency-closure.spec.ts` 驱动完整流水线,把观测到的读取与定义比对,再出现第三条未声明的读取就会失败。
- `E1-format` 现在声明四个输入(原先三个),`D2-framework` 四个(原先三个)。线性流水线下回滚闭包没有变化 —— 这两步本来就在传递下游 —— 变的是闭包现在**可证明**,而不是碰巧成立。
- receipt 的 `inputDigest` 现在由该 attempt 实际读到的版本算出。此前它对每一步都是"未记录输入"的摘要。
