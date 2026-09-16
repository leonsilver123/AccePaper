# Agent Note: A revision is a diff, or it is nothing

Status: implemented

[English](2026-09-16-a-revision-is-a-diff-or-it-is-nothing.md) | 中文

## Problem

`D4-rebuttal` 是这样产出修订稿的:

```ts
const revised = sections.map(s => ({ ...s, revised: record.hasRevisions }))
```

`hasRevisions` 派生自那些来往条目,而每一条被解析出的条目都把 `requiresRevision` 置为 `true`。于是一条意见把**每一节**都标成已修订,而任何正文都没有变。一个离线探针比对 D3 与 D4 的稿子,量到 `unchangedBodies: true, revisedFlags: [true, true]`。

两个工件于是互相矛盾,而且谁也没被检查:rebuttal 说这篇论文修订过了,修订稿也这么说,而那份手稿与被它声称修订过的那份稿子**逐字节相同**。这是复核清单上最大的一个 P0,也是它的其余发现为什么不能逐个关闭的原因 —— 一条产不出修订的修订循环,让下游每一道检查都失去意义。

## Decision

`runner/issue-patch.ts` 装着 Issue → Patch → Verify 这条循环,它的规则全都是"要么是一次 diff,要么什么都不是"。

一条 **issue** 具名一个节、以及它是针对哪个版本写的。那个版本是**执行器**从作者被展示的正文算出来的哈希 —— 绝不是作者声明的值,因为一份自己声明基准的 patch 可以声称适用于任何东西。一份 **patch** 是该节的替换正文。

`applyRevision` 逐条判定:

- 该节不存在 → `open`;
- 该条不要求改正文、且带着回答 → `accepted_explanation`,它与 patch 是不同的结果,分开记录;
- 该条要求改正文、却没提出 → `open`;
- 基准哈希不是该节当前的正文 → `open`,并具名两个哈希。这份 patch 是针对一个已经不存在的版本写的,应用它会静默丢掉中间发生的一切;
- patch 复现了它所依据的正文 → `open`,因为提出不了 diff 的修订什么也没关闭;
- 否则 → `patched`,该节正文被替换。

`revised` 于是逐节派生自"它自己的正文有没有变"。什么也没改变的那一轮什么也不标,并报告 `patchedSections: []`。

`D4-rebuttal` 每条来往条目读 `CONCERN` / `SECTION` / `RESPONSE` / `PATCH`,并把 `issues`、`changes`、`patchedSections`、`openIssues` 同时写进 rebuttal 与修订稿。写作者的上下文里带着当前的各节正文与 id,于是 patch 是针对它看得见的东西写的,而一条回答可以具名一个节而不用凭空造出大纲。

两条 issue 改同一节是**冲突**,不是合并:第二条是针对一个已经不存在的正文写的,于是它留在 `open`。这就是恢复路径 —— 下一轮看见新的正文,可以针对它写 patch —— 而它优于一条没人同意过的合并规则。

## Alternatives considered

**事后 diff D3 与 D4 的稿子,由 diff 置 `revised`。** 作为机制拒绝,虽然那是最显眼的简化。它告诉你某个正文变了,却不告诉你**哪条意见**改了它,于是一条 issue 可能因为一次无关的编辑碰到了它的节而关闭,而一份没能应用的 patch 会变得不可见。基准哈希才是让"这份 patch 关闭了这条 issue"可核对的东西。

**让模型返回 diff(一段 hunk 列表),而不是替换正文。** 拒绝。替换正文可以对哈希核对,而且不可能半途应用;hunk 格式需要一个 patch 应用器、模糊匹配,以及一整套关于"部分应用意味着什么"的说法。全有或全无的替换是更小的正确的东西。

**在文档层级标 `revised`,把逐节细节记在旁边。** 拒绝:错的正是那个文档级标志。看到手稿上 `revised: true` 的读者,不会再去翻第二个限定它的字段。

**保留 `requiresRevision` 作为模型的声明,而不是从"有没有提出 patch"派生。** 拒绝:正是它让一条条目可以要求改稿却什么也不提,而那个要求读起来像一个事实。现在"是否要求改正文"派生自"是否提供了",而一条说自己需要改却不提供的条目,会被具名地留在 `open`。

**只要有 issue 留在 `open` 就让 D4 这一步失败。** 拒绝:一轮关掉了五条中的四条,那已经做了工作,拒绝它会丢掉这些。`openIssues` 被报告,步骤通过,而那些没关的在工件上看得见。

## Consequences

- `packages/research` **1749 passed / 98 files**;`tsc -b tsconfig.host.json` 干净。
- **`tests/issue-patch.spec.ts`(12 条)覆盖了这条循环与每一次拒绝**:一份被应用、且只标它自己那节的 patch;把原正文当 patch 交回来、什么也没关闭;要求改却没有 patch;空回答;被分开记录的说明性接受;针对过期基准的 patch;同一节的两份 patch;以及一条具名了草稿里没有的节的 issue。
- **被驱动的运行是照着复核自己的观察来量的。** 一条测试读两份稿子,断言正文**并非**全部相同、改变过的节恰好是 `['results']`、被标 `revised` 的节恰好是那些 —— 正是 `unchangedBodies: true, revisedFlags: [true, true]` 的反面。
- **这次修订通过它自己的 A 门。** D4 的门用新的手稿检查审 `revised-draft`,于是一份引入了运行从未测过的数字的 patch 会在那里被抓到。这才让这条循环是**可以安全运行**的,而不只是被记录下来。
- **fixture 的那几份 patch 是 fixture 的两行。** fixture 路径产出一条说明和一份 patch;模型那条路没有被端到端跑过,因为本套件里被驱动的运行没有写作者。读 `SECTION` 与 `PATCH` 的那个解析器,只经过 fixture 的 issues 被行使,而那些 issue 是在代码里构造的,不是从回答里解析出来的。
- **rebuttal 上的 `revisionCount` 与 `hasRevisions` 仍在**,它们仍然描述这一轮,因为别的读者在用。它们不再是决定 `revised` 的东西。
