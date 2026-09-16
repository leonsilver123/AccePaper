# Agent Note: 那次绑了一个名字的批准

Status: implemented

[English](2026-09-16-the-approval-that-bound-a-name.md) | 中文

## Problem

`ApprovalRecord` 里只有这些,别的什么都没有:

```ts
{ run_id, step_id, attempt_id, principalId, approval_event_id, decision, rationale, timestamp }
```

一个人批准的是摆在他面前的那份手稿。记录只说 `E2-submit` 的第 N 次 attempt 可以继续 —— 一点内容
都没有。于是一份之后移动过的文档仍然被这条决定覆盖着:后面某个重写了它的步骤、一次在同一条批准
之下恢复了**另一份**快照工件的恢复、或者一只手。

这个包其实早就知道怎么绑内容。同一个文件里的 `submitGateVerdict` 会把判定的 `targetRefs` 与 attempt
的提交 receipt 逐字节比对,不一致就拒 `DSH_GATE_STALE_TARGET`。批准那条路什么都不比,而
`package-export.ts` 一直在为每个导出文件算 `sha256`。

## Decision

批准冻结它那一步输入的 refs,在做出决定的那一刻,**从运行自己的 registry 取,绝不取自调用方** ——
与 `bindVerdict` 遵循同一条规则,理由也相同:一个能指定自己目标的决定,可以指定它想要的那些。

`approvalStalenessOf(store, runId, stepId)` 拿冻结的 refs 与 registry 现在持有的比对,点名移动了的
那个版本,两个哈希都给出。`readinessOfRun` 对每一步问它,把第一个答案交给 `submissionReadinessOf`,
后者以一条读者能据以行动的理由拒绝就绪。

**在本次改动之前写下的记录恢复时没有 targets**,所以它的决定不绑任何东西、也不会被判过期。那是
它做出时所处的行为;在解析时替它编造 targets,等于给一条从未有过绑定的决定记上一笔绑定。

## Alternatives considered

**改为在导出时比对整包哈希。** 拒绝作为主要机制:包是在批准**之后**装配的,所以做决定的那一刻没有
东西可比。E2 上运行的输入才是本人真正被展示的东西,也才是一条决定能绑的东西。manifest 里逐文件的
`sha256` 仍然是读者拿来核对一个导出目录的东西,README 也这么写。

**要求调用方传入它认为自己正在批准的那些 refs。** 拒绝:这正是 F01 为门禁判定关掉的那个错误。一个
自带目标的调用方可以给出它想要的那些,而批准会为它拿到的东西背书。

**把 `targetRefs` 设为快照格式的必填并拒绝旧记录。** 拒绝:那会把每一份既有快照变成一个读不进来的
文件,换来的只是关于「字段存在之前做出的决定」的一层保证。它们的真实行为被记下来,而不是被改写。

**把「没有批准记录」也算过期。** 拒绝:一步**需不需要**批准是就绪判定的问题,不是这个函数的问题。
这个函数回答的是"这条决定是否仍然描述着那里的东西",而没有决定的步骤没有东西可描述。

## Consequences

- `tests/approval-binding.spec.ts` 把一次运行驱动到 E2、经 host 通道批准,然后钉住:记录带的是
  registry 自己的 ref;仍持有那个版本时不报告任何东西;版本移动、同版本内容变化、输入被删除各自
  报告自己的情形;未批准的步骤不报告任何东西。
- `tests/submission-readiness.spec.ts` 钉住那条拒绝,以及既有调用方都保住自己的答案(参数默认为缺省)。
- **仍未覆盖的**:磁盘上的导出文件。导出之后编辑 `manuscript.md` 在运行的 registry 之外,这里的任何
  比对都看不到它。
