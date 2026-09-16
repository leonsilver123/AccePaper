# Agent Note: 那行写在待批门之上的「已完成」

Status: implemented

[English](2026-09-16-the-header-that-said-completed-over-a-pending-gate.md) | 中文

## Problem

`runStatusOf` 从步骤结局推导运行状态,返回四个值:

```ts
if (steps.some(step => step.status === 'failed')) return 'failed'
if (gates.some(gate => gate.outcome === 'abstained')) return 'abstained'
if (steps.some(step => step.status === 'pending' || step.status === 'in_progress')) return 'running'
return 'completed'
```

一个 `gated` 的步骤,既不是失败,也不是弃审,也不是未开始,也不是进行中。于是一次关闭了每一个可
自动完成的步骤、停在 `E2-submit` 等人看的运行,被报成**已完成**。注释甚至写出了理由,仿佛这是一个
设计选择:"一次完成了它可自动完成的工作、只剩人工门的运行是 `completed`,因为等人就是设计本身。"

**等人确实是设计。说工作结束了不是。** 页头是读者看到的第一样东西,而它说的正是那句会让他不再看
下去的话。

同一个承诺也在引导文案里:"一条主张走完 16 步才成为一篇**可投稿的**手稿。"

## Decision

`RunStatus` 增加 `awaiting-approval`:当每一个可自动完成的步骤都已关闭、而某一步是 `gated` 时返回它。
`completed` 现在就是它字面的意思:没有任何人和任何东西在等。

引导文案说出走完十六步真正产出的东西 —— 一份**材料齐备**的手稿 —— 并点明可投稿还差什么:生产证据
模式、全部门禁关闭、没有未关闭的评审意见、以及一次人工批准。

## Alternatives considered

**保留 `completed`,在旁边加一个徽标。** 拒绝:一个页头里两句话,而更响的那句是错的那句。一个停在
"已完成"上的读者,永远不会去读那个徽标。

**只在人工门是最后一步时报 `awaiting-approval`。** 拒绝:这是关于**运行**的事实,不是关于步骤序号的。
一次被更早的人工门扣住的运行同样在等,而 `humanPending` 已经点名是哪一道门。

**叫它 `blocked`。** 拒绝:没有任何东西被堵住。流水线就在它该在的地方,而动作是读者的;一个读起来
像故障的词会让人去找一个并不存在的问题。

**引导文案不动,那只是宣传语。** 拒绝:它是标题下的第一段,而且陈述了一条关于产品的、不成立的规则。
本仓库的规则是:一个关于系统做什么的说法,必须就是它所做的事。

## Consequences

- `tests/run-source.spec.ts` 钉住整套排序(失败 > 弃审 > 未完成 > 等待 > 完成),并新增一条整链用例:
  共用的 wire fixture(A1 passed、E2 gated)读作 `awaiting-approval`,而 `humanPending` 仍然点名读者
  要裁决的那道门。
- 页头、摘要面板与每一个由 locale 驱动的标签都从 `RunStatus` 派生,所以新值经既有的 `status.*` 查表
  在两语里渲染出来。
- 同一次改动在客户端孪生上声明了就绪的四件事 —— `evidenceProfile`、`profileEligible`、
  `submissionReady`、`readinessNote` —— 并在工作台页头说出模式与就绪。孪生此前没有声明它们,于是
  浏览器四条全收到、却一条也叫不出名字。
- **这不做的事**:**质量**状态(一条从未运行过的必需检查)仍然没有作为各自的事实浮出来,**批准**状态
  也没有。执行、模式与就绪现在分开了;那两件还没有。
