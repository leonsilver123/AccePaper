# Agent Note: A claim id the tool would refuse, and a gate that read silence as a pass

Status: implemented

[English](2026-09-16-a-claim-id-the-tool-would-refuse.md) | 中文

## Problem

两个缺陷,同一天由两种不同方法找到。形状相同:规则在一处存在,而它所约束的东西在另一处被决定。

**一个超出工具上限的派生 claim id 终结了一次运行。** 浏览器探针确认了一份模型提出的方案并启动运行;运行在 A2 失败:

```
[claim-construct] claim-construct.claimId: longer than maxLength 64
```

`claimIdFor` 把候选的整条 direction 做成 slug,没有上界。而 `claim-construct` 声明了 `maxLength: 64`。出货默认方案的 direction 产出 57 个字符,所以这条上界在模型提出一条更长的方向之前从未被触到 —— 而模型的候选不是确定性的,于是同一个探针前一晚通过、这一晚失败。这份方案通过了 `requirePlan`,而后者只校验 claim 的 id **存在**,仅此而已。于是一份流水线根本执行不了的方案,在那个"只接受可执行方案"的边界上被接受了。

**一个门把必需检查的沉默聚合成了通过。** `aggregateDisposition` 在必需检查**缺席于报告**时 block,在检查 `failed` 时 block。而一个**在场、且报告自己 `not_evaluated`**(即"我没有运行")的检查,得到的是 `allow`。该模块自己的文档在两处说了相反的话:`not_evaluated` "means a required check did not run, and is never a soft warning",聚合函数自己的文档也写 "a check that was never executed has found nothing, and its silence is not a pass"。同一件事的两种写法被当成了两件事 —— 也就是说,审查 H.1 那条要求("没运行的必需检查不得被伪装成低风险警告"),恰恰在为了执行它而写的模块里失守。

第二个是由该模块的一位独立读者找到的,不是它的测试 —— 因为测试与实现出自同一种读法,而一个把实现固定下来的 spec,找不到实现与其契约相悖的地方。

## Decision

**一个数,两边都读。** `INPUT_LIMITS.maxClaimIdChars` 声明在 `dsh-research-tools` —— 执行它的 schema 所在之处 —— 并被"必须满足它"的那个派生函数读取。`claimIdFor` 为自己的 id 设上界;会溢出的 direction 被截断到刚好放得下,并带上**整条** direction 的八位摘要,于是两条共享前缀的长方向不会撞到同一个 claim id 上。`requirePlan` 拒绝 `claim.id` 超限的方案,并同时报出长度与上限 —— 方案的问题在方案到达的地方被报告,而不是两步之后以一次执行失败的样子出现。

**必需检查上的 `not_evaluated` 与缺席一样 block。** 修法是一个 filter;实质是 `not_evaluated` 与 `not_applicable` 现在被当作它们各自**是**的两件不同的事。`not_applicable` 可以通过,因为它是关于这项工作的一个发现("这条检查在这里不适用"),而且必须写明是哪条规则豁免了它。`not_evaluated` 不可以,因为它是沉默的报告 —— 无论写成哪一种样子。策略没有要求的检查,报告什么都行。

**同一遍里的两处小修正。** `quality.ts` 的引用读取器现在对 target 的 `contentHash` 施加 `isContentHash`,与 `artifact.ts` 对同一个字段的规则一致:一个"只要是非空字符串就算"的哈希无法与存储里的内容核对,于是那份报告无法被拿去验证它所具名的 revision。而 `contentHashOf` 的拒绝语现在真的点名它所拒绝的东西 —— 此前它只列了 function、symbol、`undefined`、非有限数、bigint 与环,而编码器还会拒绝 `Map`、`Set`、`Date`、`RegExp`、typed array、`ArrayBuffer` 与类实例,于是一个被拒的产出者收到的解释讲的不是它手里那个值。

**`optionalStringField` 被删掉。** 它从 core 的入口导出,而全仓库没有任何调用者 —— 每个 parser 都内联了同一段"可选非空字符串"检查。一个没有消费者的读取器,是对设计的声明,而不是设计的一部分。

## Alternatives considered

**让工具去拒那条长 id,把它当成一次普通的步骤失败。** 拒绝:那正是已经发生的事,而它产出的是"运行在两步之后停下,报一个工具字段的 schema 错误",从中读不出**方案**才是问题。接受方案的边界,才是不该被接受的方案该待的地方。

**只截断 slug。** 拒绝:两条共享 55 字符前缀的方向会产出同一个 claim id。两项研究的工件挂在同一个 claim id 下,比一个长 id 更糟 —— 下游没有任何东西能分辨它们,而 claim id 正是 C 通道证据的键。

**拒绝那份候选,而不是给 id 设上界。** 拒绝:id 是**派生**的,不是模型提出的。模型写的是 direction;id 是这段代码的事,而"我们自己的派生放不下"就去拒绝一条好方向,是拿我们的缺陷去拒绝模型的工作。

**把 `not_evaluated` 从 `CheckDisposition` 里去掉,用"缺席"表达沉默。** 拒绝:审查 H.1 要求这个区分 —— 跑过并得出 `not_applicable` 的检查,必须与没跑过的检查可分辨,而只有 `not_evaluated` 承载这一点。缺陷在聚合函数忽略了它,不在它存在。

**让 `parseGateReportIngress` 像拒绝 `allow`+`failed` 那样,也拒绝 `allow`+`not_evaluated`。** 暂时拒绝:parser 不知道策略要求哪些检查,于是它会拒掉一份 `not_evaluated` 那条并非必需的合法报告 —— 而拒绝一条有效记录的失败,比它想防的那个更糟。知道必需集合的地方是 `aggregateDisposition`。

## Consequences

- 任意长度的模型候选方向现在都产出可用的 claim id;携带工具会拒绝的 id 的方案在 `requirePlan` 被拒,并报出那两个数。
- `tests/direction-proposals.spec.ts` 钉住上界、前缀撞车、稳定性与边界拒绝;`tests/domain/quality.spec.ts` 钉住"必需的 `not_evaluated` 会 block"、"必需的 `not_applicable` 仍可通过",以及"关于非必需检查的查询不决定这个门"。
- 浏览器探针在 2026-09-16 的那次运行到了 A2 就停在那里;正是那次失败暴露了这件事。探针会对着修复重跑。
- `packages/research` 在 91 个文件上 **1648 通过**。
