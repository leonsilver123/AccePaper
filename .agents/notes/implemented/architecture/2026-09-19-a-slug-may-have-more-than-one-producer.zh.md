# Agent Note: 一个 slug 可以有多个产出者

Status: implemented

[English](2026-09-19-a-slug-may-have-more-than-one-producer.md) | 中文

## 问题

`assertDagAndSeedSeparation` 在模块加载时运行，所以一张被它拒绝的图不会让某个用例失败 —— 它会让**每一次** `import 'dsh-research-core'` 失败，在所有依赖它的包里，异常从一条 import 语句里抛出来。它的两条规则建立在流水线即将不再成立的前提上。

它用**最后写入者胜**记录一个 slug 的归属 —— 按顺序对每一步执行 `outputOwner.set(o, s.index)` —— 然后拒绝任何消费了归属下标不早于自己的 slug 的步骤。在每个 slug 只有一个产出者时，这完全正确。而手稿即将有三个：D3 创建它，D4 与 E1 各自在**同一个** slug 下发布新版本 —— 这就是"这次运行维护同一个文档"在产物层面的含义。在最后写入者胜之下，`manuscript` 的归属变成 E1 的下标，于是 D4 消费自己正在重新发布的那份文档，被读成一条前向边。在一张合成图上实测：`step 'reviser' (index 2) consumes 'manuscript' produced by a later/equal-index step (index 3) — cycle or forward-edge (DEP-9)`。

第二条规则是**缺了**，不是错了。`computeTransitiveDependents` 走的是 `inputs ∩ outputs`，所以重新发布某个 slug 的步骤**必须**消费它；否则让该 slug 的第一个产出者失效时，重新发布者的产物会留在原地，而它据以撰写的那份文档已经没了。此前没有任何东西说过这件事，因为此前没有任何东西重新发布过 slug。

## 决定

- **归属取最早的产出者。** 「无前向边」这条性质说的是创建该 slug 的那一步；后来的产出者无法移动它，而把它们读成归属，正是把中间那个产出者对自己产物的消费变成前向边的原因。
- **重新发布者必须消费它所重新发布的东西。** 一个把某 slug 写进 `outputs` 而不是它第一个产出者的步骤，必须同时把它写进 `inputs`，加载时检查并给出理由。
- **图作为参数。** `assertDagAndSeedSeparation(steps = STEPS)` —— 一个冻结的常量无法被弄成违反任何规则，所以真正有价值的规则，是那些能对着合成图证明的规则。

## Alternatives considered

- **保留最后写入者胜，让手稿每一步用一个不同的 slug。** 拒绝：那正是要被去掉的安排，也正是文档目前被拆成 `draft`、`revised-draft`、`formatted-manuscript`、没有一个版本可供判定绑定的原因。
- **把规则放宽成「存在某个产出者早于消费者」。** 拒绝：它会接受一张「创建某 slug 的那一步在该 slug 存在之前就被消费」的图，而那正是这条断言要守的性质。
- **把新规则做成警告而不是抛出。** 拒绝：未声明的消费不是风格问题 —— 它是一条有洞的失效级联，而一个以警告形式汇报自己的洞，是一个会被发布出去的洞。
- **不动断言，把新步骤的顺序排成让最后写入者胜恰好能用。** 拒绝：它只在下一个产出者出现之前成立，而它的失败形态是无关包里的 import 错误。

## Consequences

- 出厂的图不因这次改动而改变：目前没有任何 slug 有两个产出者，所以新规则对 `STEPS` 是空转的，而整套用例通过就是"什么也没动"的证据。
- 新增 `packages/research/dsh-research-core/tests/step-graph.spec.ts`。它断言出厂的图通过；断言一个被重新发布、且重新发布者消费它的 slug 被接受（即上面那条回归 —— 把最后写入者胜恢复回去，只有这一条失败）；断言不消费的重新发布者被拒绝；并断言原有规则仍然拒绝「到某 slug 第一个产出者的前向边」「没有产出者的输入」「`outputs` 里的可播种 slug」。
- 该函数仍然不从包索引导出（`RC-A`），所以这个用例像本包其他用例一样直接 import `../src/engine/steps.ts`。

## Files

- `packages/research/dsh-research-core/src/engine/steps.ts` —— 最早产出者归属、重新发布者规则，以及带 JSDoc 的 `steps` 参数。
- `packages/research/dsh-research-core/tests/step-graph.spec.ts` —— 那些规则，对着合成图。
