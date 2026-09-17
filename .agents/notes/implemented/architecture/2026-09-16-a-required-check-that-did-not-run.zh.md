# Agent Note: 一条没有运行的必需检查

Status: implemented

[English](2026-09-16-a-required-check-that-did-not-run.md) | 中文

## Problem

`domain/quality.ts` 从写下那天起就带着这套词汇:

- `aggregateDisposition(checks, requiredCheckIds)` —— 必需检查缺席时、报了 `not_evaluated` 时、或者 失败时,一律 block;
- 它的文档写明了理由:「一条缺席的必需检查与一条通过的检查不是同一件事……**`not_evaluated` 就是 缺席**,把这个说出来正是这个函数的意义。」

**生产里没有任何东西调用它。** A 通道经 `judgeRound` 对 reviews 裁决,而 reviews 由同一个实现产出、 永远返回全部。于是这套词汇存在的那个区分 —— **一条没有运行的检查** —— 在整条流水线里没有任何表示。

更糟的是,那两件事**是同一个值**。运行里没有结果记录时,`red-stat` 与 `red-claim` 推入一条 `position: 'abstain'` 的发现 —— 「材料不足以裁决」—— 而那是一条检查**读了**材料、判定它不足以定论时 说的话。一条因为无从核验而什么都没核验的检查,说的是一模一样的话。下游要拒绝第二种,就必然连第一种 一起拒绝。

## Decision

**`RoleReview.evaluated`** —— 可选,缺席表示它跑了,`false` 表示它跑不成。由 `review(role, findings, evaluated = true)` 设置,用在两条「没有结果记录就什么都核验不了」的检查上。

**`checkDispositionOf(review)`** —— 导出,好让这个映射只有一个家,并且测试断言的是**生产函数**而不是 它的副本:

```ts
if (review.evaluated === false) return 'not_evaluated'
return review.position === 'refute' ? 'failed' : 'passed'
```

**`verdictA` 做聚合。** reviews 变成门禁检查,`aggregateDisposition` 按该轮声明的角色跑,而聚合给出的 `block` **比 `judgeRound` 更严**:该步被 `blocked`,而它本来会通过。`allow` 不改变该轮自己的判定, 所以这只会**增加**一次 block —— 注入弃权那条路仍然弃权,因为它的 reviews 全都跑了。

## Alternatives considered

**把 `abstain` 映射成 `not_evaluated`。** 拒绝,而这正是整个设计的要点:弃权是一条**发现**。那样映射 会让 A 通道挡住每一份证据只是不完整的主张 —— 而那恰恰是 `judgeRound` 的 `minValidVotes` 有意去裁决的 事 —— 两个档位又会变成一个值,只是方向相反。

**给 `ResearchRebuttalPosition` 扩第四个成员。** 以范围为由拒绝:那个类型会走进记录下来的投票、工件、 wire 与 UI,而这里新增的区分是关于**检查**的,不是关于评审者投出的那一票。一条没跑的检查仍然投票 —— 投弃权 —— 因为那是裁决器需要从它那里拿到的东西。

**让 `reviewManuscript` 在输入缺失时少返回几条检查。** 拒绝:该轮声明了它的必需角色,列表变短会让 `expectedRoles` 失败 —— 为一个现在能被精确陈述的事实制造一次更响的失败。检查照常报告;聚合决定它的 报告是什么意思。

**不接聚合,继续靠 `judgeRound`。** 拒绝:声明的角色缺席时 `judgeRound` 弃权,那是另一个档位,而且 **不点名任何一条检查**。弃权的门把该步留在开着的位置;要求是把它关上。

## Consequences

- `tests/manuscript-review.spec.ts` 驱动整条链:一份没有结果记录的 review 把 `red-stat` 与 `red-claim` 标成 `evaluated: false`,`checkDispositionOf` 把它们变成 `not_evaluated`,而按 `MANUSCRIPT_REVIEW_ROLES` 的聚合 block —— 同时**真的读了手稿**的那两条检查仍然通过。
- A 判定的 evidence 现在带上聚合的结论与理由,于是一个被挡住的步骤说出**缺的是哪条检查**,而不是它 少拿了哪一票。
- **仍然没有接上的**:`GateReport`、`reportAnswers` 与 `parseGateReportIngress`。判定按「存在 + attempt」绑定,而不是按一份签发的报告,README 也这么写。
