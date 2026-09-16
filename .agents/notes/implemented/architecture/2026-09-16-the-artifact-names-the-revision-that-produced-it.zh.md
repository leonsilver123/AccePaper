# Agent Note: 产物说出是哪个版本产出了它

Status: implemented

[English](2026-09-16-the-artifact-names-the-revision-that-produced-it.md) | 中文

## Problem

运行带着一个 `projectRevision` 已经有一阵了。`commitStepOutputs` 拿它与提交被准备时针对的版本比对,
不一致就拒绝 `DSH_COMMIT_REVISION_CONFLICT`,并在写入时推进它。`run-persistence` 保存与恢复它。
连产物的领域类型 —— `core/src/domain/artifact.ts` 的 `ResearchArtifact` —— 都有 `projectRevision`
字段。

而**没有任何生产路径写过它**。`ArtifactRecord`(活的 registry 条目)带的是
`{slug, producerStepId, producerAttemptId, value, producedAt, invalidated, ref}`,而 `ref` 装的是
`artifactId`、`version` 与 `contentHash`。于是一个读者能问"这是 Results 一节的第几版"并得到答案,
却完全无法问"是这份研究的哪个状态产出了它"。而第二个问题,正是包、屏幕与批准**共同**需要的那个。

`ref.version` 看起来能替代,其实不能:它数的是**某一个**产物的第几版。同一次提交写出的两个产物共享
一个项目版本,版本号却互不相关。

## Decision

`ArtifactRecord` 与 `ArtifactRecordMeta` 都带上 `projectRevision`,由两个写入者分别写:

- `commitStepOutputs` 盖的是这次提交**发布**的版本,不是它被准备时针对的那个 —— 产物成为那个版本
  所命名的状态的一部分;
- `recordArtifact` 盖的是运行**当前**的版本,因为那条接缝只写一个产物、不推进版本。声称下一个版本
  等于报告一次这次调用从未做出的改动。

这个字段在快照格式里是**必填**的。没有它的快照被拒绝,而不是被默认填充:给一个产物安上一个它可能
从未属于过的项目版本,会毁掉这个字段承载的唯一事实 —— 而它的每一个读者,存在的意义就是分辨是哪个
状态产出了某样东西。

第一个消费者是导出 manifest:`RunPackageManifest.projectRevision`,从运行读出而不是由文件推导,
于是比较两个包的读者 —— 或者拿一个包去对照某个屏幕的人 —— 能分辨它们是不是这份研究的同一个状态。

## Alternatives considered

**从 `producedAt` 推导项目版本。** 拒绝:导出器给 `generatedAt` 写的是
`new Date(0).toISOString()` —— 一个固定的时间戳,因为一个每次导出都改自己字节的包无法与它自己比较。
何况时钟本来就不是版本:两次提交可以落在同一毫秒里,而其中一次可以发生在一次把时钟拨回去的重启之后。

**把它放进 `ArtifactRef`。** 拒绝:一个 ref 是**某一个**产物的身份(`artifactId`、`version`、
`contentHash`),而且在好几处被当作相等来比较,包括 `sameTargetSet`。把项目版本塞进去,会让指向同一
份字节的两个 ref 因为产出于不同的提交而不相等 —— 那不是那些比较的意思。

**设成可选,让读者容忍它不在。** 拒绝:默认值总是朝某一个方向说谎,而这个字段存在的意义恰恰是结束
这种猜测。

**先发布字段,让 UI 以后再采用。** 拒绝:检查单说没有消费者的字段不算交付。manifest 在这次改动里
就读它。

## Consequences

- `tests/commit.spec.ts` 钉住:同一次提交的两个产物都带**发布**的那个版本(因而彼此相同),而逐条写
  的接缝带当前版本、且不移动它。
- `tests/package-export.spec.ts` 钉住 manifest 说出运行的版本,而且它不是"读不到"会产生的那个人 0。
- 在本次改动之前写下的快照会在加载时被拒。那是这个格式一贯的纪律(加载器对着活的模型校验,并且不返回
  任何部分运行),而树里没有早于这次改动的快照。
- Remote 投影把它带到浏览器,工作台把它标在运行旁边,于是一个读者能分辨页面与导出的包说的是这份研究的
  同一个状态,还是两个。
- **仍然缺的,README 里写明**:还没有东西**逐个产物**地读它。版本到达 wire 的是**运行**那一个;产物
  元数据到达 wire 时没有带它。
