# Agent Note: A gate could certify a step that produced nothing

Status: implemented

[English](2026-09-16-a-gate-could-certify-an-empty-step.md) | 中文

## Problem

一次针对研究层的架构审查(`project-plan/architecture-review-2026-09-15/`)用六个离线探针打了出货的执行路径。其中三个复现了既有测试看不见的缺陷 —— 它们全都关于执行**出错**时会发生什么。

**没有产物的步骤可以到达 `passed`。** `submitGateVerdict` 只看票就把步骤状态定了。启动 `A1-landscape`,在一个空的 registry 上提交一份形式上正确的 B `passed` 判定,得到 `status: passed, artifacts: []`。门禁认证了不存在的工作。

**执行失败可以留下部分正式产物。** `runStep` 遍历执行器返回的 map,逐个 slug 调 `recordArtifact`。第二个值克隆失败时,抛出发生在第一个 slug 已经写进去之后。探针量到的是 `status: error, reportedOutputs: []`,而 `landscape-map` 就躺在 registry 里。

**被取代的 attempt 能写进新的那一个。** `recordArtifact` 在写入时读 `state.attempt_id`。探针启动 attempt 1,回滚该步骤,启动 attempt 2,再释放 attempt 1 的执行器:attempt 1 的值被记成 attempt 2 的产物,执行还返回了成功。

三者是同一个形状:系统记录了某一步完成,却没有检查这一步被定义为要做的工作是否发生过。

## Decision

**一个提交点,而门禁读取它所认证的产物。**

`engine/commit.ts` 新增 `commitStepOutputs(store, runId, stepId, request)`。它是唯一会写某一步正式产物的路径,并且在写任何东西之前强制三条规则:

- **完整。** 候选集合必须与该步声明的产物**恰好**相等。缺一个 slug、多一个未声明的、或重复,都拒绝。(`DSH_COMMIT_OUTPUTS_INCOMPLETE`、`DSH_COMMIT_OUTPUT_NOT_DECLARED`、`DSH_COMMIT_DUPLICATE_OUTPUT`。)
- **围栏。** 请求带着它启动时的那个 attempt;步骤已经走过去之后再提交,拒绝(`DSH_COMMIT_STALE_ATTEMPT`)。
- **原子。** 每个值在**校验阶段**就被克隆并取哈希。其后的写入阶段不再有任何失败模式,所以一次拒绝既不留产物,也不留 revision,也不留审计事件。

`submitGateVerdict` 现在拒绝:该 attempt 没有提交 receipt(`DSH_GATE_WITHOUT_COMMIT`)、registry 不再持有 receipt 所记内容(`DSH_GATE_COMMIT_MISMATCH`)、以及判定没有**恰好**具名那些 revision(`DSH_GATE_STALE_TARGET` / `DSH_GATE_STALE_INPUTS` / `DSH_GATE_UNBOUND_VERDICT`)。前两条是这篇的改动;第三条在同一天关闭了一个被复现的缺陷 —— 旧判定批准新 attempt 的产物 —— 并取代了本篇原先描述的"registry 中存在性"检查,见[门禁认证了它没读过的产物](2026-09-16-the-gate-certified-work-it-had-not-read.zh.md)。一步能否通过,仍然由它的 **attempt** 产出了什么决定 —— 这才是让回滚有意义的那件事。

**运行 revision。** `RunState.revision` 从 0 起,**只有提交**能让它前进,且恰好加一。提交所带的 `expectedRevision` 不再匹配时拒绝(`DSH_COMMIT_REVISION_CONFLICT`)。`runStep` 在入口读一次 revision,并按它提交,所以一个从运行已经离开的状态算出来的结果无法落地。

**幂等是键,不是指望。** 提交带 `idempotencyKey`;用这个 attempt 已提交过的键重复请求,返回**第一次**的 receipt,什么都不写(同一个 attempt 上换一个键则 `DSH_COMMIT_ALREADY_COMMITTED`)。`runStep` 从 `(stepId, attemptId)` 推导键,所以同一次 attempt 的重试是重放,而新 attempt 是新键,调用方不需要自己造一个。

**每一条 registry 条目都有身份。** `ArtifactRecord` 新增必需的 `ref: ArtifactRef` —— 工件 id、版本、以及字节的 SHA-256。`recordArtifact` 也算一个,于是 registry 是**一致地**有版本的,而不是大部分有。哈希打在**规范化 JSON**编码上(对象键排序),因为对 `JSON.stringify` 的输出取哈希会让两个以不同键序构造同一对象的产出者哈希不同,引用校验随后会拒绝一个其实没变过的值。没有规范化编码的值 —— 函数、`undefined`、`NaN`、环,以及 `Map`/`Set`/`Date`(它们没有自有可枚举键,会被编码成 `{}`)—— 没有身份,一律拒绝(`DSH_VALUE_NOT_CANONICAL`、`DSH_COMMIT_VALUE_NOT_PERSISTABLE`)。

**持久化格式随之改变。** `RUN_SNAPSHOT_SCHEMA_VERSION` 升到 2:载荷带上 `run.projectRevision` 与每个 registry 条目的 `ref`,`step-committed` 进审计种类白名单。一个重启后变成 0 的 revision 会让此后每一次提交的围栏量错数 —— 拒绝诚实的提交、放进过期的提交 —— 所以这条记录是**写明**的,不是默认出来的。

## 明确没有覆盖的

**提交 receipt 不持久化。** `StepState.commit` 是内存里的事实。恢复之后 receipt 没了,而同一个 `runStep` 调用的重放会被既有的 `DSH_STEP_ALREADY_EXECUTED` 守卫挡住 —— 所以这个省略**不会**变成重复提交,但它确实意味着被恢复的 attempt 读不回自己的 receipt。持久化它属于拥有重启路径的那项 checkpoint 工作。

**`recordArtifact` 仍是公开接缝,但提交之后被关闭。** `ctx.research.recordArtifact`、恢复用 fixture 与 E2 的空门路径都在调它,它仍然写单个产物、不带完整性规则。现在有两件事让它不构成旁路:该 attempt 一旦提交它就拒绝(`DSH_ARTIFACT_AFTER_COMMIT`);而门禁要求该 attempt 的提交 **receipt**,不再从 registry 推断完整性 —— 所以逐个补齐声明输出的 attempt 过不了门。两者都在 2026-09-16 加入,见[门禁认证了它没读过的产物](2026-09-16-the-gate-certified-work-it-had-not-read.zh.md):此前一次复核复现了这条旁路 —— 替换已提交的产物,revision 停在 1,门禁照样通过。

**门禁按"存在 + attempt"绑定,不按摘要绑定** —— 这是本篇写时的状态。同一天它就被补上了:判定现在带着 `targetRefs` 与 `inputDigest`,在**构建它**的地方绑定,不匹配即拒。见[门禁认证了它没读过的产物](2026-09-16-the-gate-certified-work-it-had-not-read.zh.md)。`domain/quality.ts` 里的 `GateReport` 与 `reportAnswers` 仍是那份比 attempt 活得更久的报告的词汇。

## Alternatives considered

**保留逐 slug 写入,只在前面加一遍全量校验。** 拒绝,理由是不充分:校验一个值这件事**本身**就会失败,所以"先校验再写"必须包含克隆与取哈希,而那已经是大半个提交点了。剩下的那块 —— attempt 围栏 —— 根本无法活在一个逐 slug 的写入器里,因为它是**没有一个单一时刻**可供检查的。

**让门禁改为要求一份提交 receipt,而不是从 registry 推导完整性。** **当时**拒绝,理由是代价:它会要求改写每一个"先合法地 `recordArtifact` 再开门禁"的既有 spec,而两条规则**看起来**拒绝的是同一件事。同一天,一次复核表明它们不是同一件事 —— 逐个补齐声明输出的 attempt 能通过从 registry 推导的检查,而它没有 receipt 可供判定绑定。receipt 成了门禁的输入,spec 也随之迁移。

**给 `recordArtifact` 加一个 `expectedAttemptId` 参数,而不是新建模块。** 拒绝:那会给下一个调用方留下"忘了传"的口子,而这一整类缺陷恰恰就是"某个调用方在没有围栏的情况下写了正式产物"。

**快照里没有 revision 时默认成 0。** 拒绝:那会恢复出一个 revision 是假的运行,而围栏随后拿一个从未存在过的数去比。升 schema 版本并拒绝旧记录,才是诚实的失败。

## Consequences

- 三个探针现在在 `dsh-research-core/tests/commit.spec.ts` 里有稳定的拒绝测试:无产物、缺一个、第二个值克隆不了、被取代 attempt 的迟到完成、过期 revision、重复幂等键,以及两个针对同一 revision 准备的提交。
- `packages/research` 在 89 个文件上 **1617 通过**,其中包含被改写的过时行为断言(`pipeline.spec.ts` 曾把空产物 map 当作 `success`;happy-path 的审计词汇测试期待 `artifact-recorded`,而驱动路径已不再发它)。
- 一份升级前持久化的旧快照不再能加载。这正是"拒绝旧格式"的预期行为;出货的 snapshot 目录是 gitignore 的暂存区。
- 每步的审计轨迹现在是**一条** `step-committed` 记录、带着各产物的 revision,而不是每个 slug 一条 `artifact-recorded`。靠审计日志数产物条数的读者,得改读 receipt。
