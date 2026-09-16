# Agent Note: The plan the pipeline could not execute, discovered four steps in

Status: implemented

[English](2026-09-16-the-plan-the-pipeline-could-not-execute.md) | 中文

## Problem

R1a 让 `B1-method` 从方案声明的实现里取算法,并在方案没声明时拒绝:

```ts
const resolved = resolveImplementation(planOf(ctx))
if (!resolved.ok || resolved.implementation === undefined) {
  throw new Error(`[B1-method] ${resolved.reason}`)
}
```

而 `requirePlan` 只在实现**存在**时才要求它:

```ts
const declared = source['implementationId']
if (declared === undefined) return { ok: true }
```

两者合起来就是一个洞,而浏览器那条路每次都从洞里走过去。模型提一个研究,人确认它,方案从线上到达 —— 而线上的方案不带 `implementationId`,因为一份提案知道自己在研究什么,不知道这个部署能跑什么代码。`requirePlan` 接受了它。运行开始了,A1 检索了实时目录,A2 推导了主张,A3 与 A4 关掉了各自的门 —— 然后 `B1-method` 抛了。`runStep` 会把执行失败的步骤留在 `in_progress`,于是运行就停在那里,读者看不到任何错误。

端到端探针抓到它两次,同一步、同一个形状:`{"a2":"passed","steps":5}`。第一次看起来像模型延迟,而第二次在 A4 结束 13 ms 后就复现了同一处停住,这才排除了那个解释。离线套件里没有任何东西能抓到它,因为套件里的每一次运行都驱动 `DEFAULT_PLAN`,而它声明了实现。

## Decision

实现在**方案边界**上被解析出来 —— 依据方案声明它测量的那个量 —— 解析结果写回方案。

`resolvePlanImplementation` 取代了 `requireImplementation`。具名 id 的方案,该 id 会与方案的指标校对 —— 关于同一个方法的两句话互相矛盾,正是一篇手稿开始描述没人跑过的实验的方式。不具名 id 的方案,取那个 `metric.key` 与方案相同的、唯一的受支持实现;没有任何实现能测的量会被拒,有歧义的也会被拒。`requirePlan` 返回的方案**总是**带着 `implementationId`,于是下游没有任何东西需要再解析一次,也不会撞见它的缺席。

`runT19B` 在第一步之前对拿到的方案调用 `requirePlan`。驱动器此前接受一个它无法执行的方案,把发现推给某一步;现在调用方在运行开始前就知道。这一条也是让解析在驱动器那里可达的原因 —— 线上那条路本来就经过 `requirePlan`,而**直接**交给 `runT19B` 的方案没有。

## Alternatives considered

**把 `implementationId` 做成线上的必填,让客户端发一个。** 拒绝:客户端没有依据去选。一份提案陈述领域、方向与主张;哪段代码能测那个主张,是**部署**的性质,猜一个的客户端是在陈述一个它看不见的进程的事实。这与 `explicitDefaulting` 命名的是同一种拆分:解析属于拥有它的实现,不属于隐藏的默认值,也不属于调用方。

**让 `B1-method` 回落到"能测该方案指标的那个实现"。** 作为唯一改动拒绝,虽然解析逻辑就住在那儿。那样只是在**注意到它的那一步**修掉症状,而流水线仍然可以跑完四道门和一次实时检索,才发现自己没有实验。拒绝应该发生在值进入的地方。

**拒绝不具名实现的方案。** 拒绝,而这是最有诱惑力的一个,因为类型就是这么说的。它对契约是忠实的,对产品是致命的:唯一具名的方案就是默认方案,于是浏览器**根本没法开始一次运行** —— 而那正是这个界面的全部用途。错的是契约,不是调用方:方案陈述它研究什么,部署陈述它能跑什么。

**从方案的主张文本推断实现。** 拒绝:指标键是方案自己对"它测量什么"的声明,而去匹配散文,正是这个仓库一再拒绝拿来做评分依据的字符串比较。

## Consequences

- `tests/method-implementation.spec.ts` 新增四条,其中包括**那一次运行**:不带 `implementationId` 的方案能驱动过 B1,而它产出的 `method-spec` 具名解析出来的实现。`tests/project-recovery.spec.ts` 记下新的事实 —— 恢复时读回的方案带着它的实现 id,于是一个受支持实现已经变过的部署,不能悄悄把这次运行当成另一次恢复。
- **拒绝移到了边界上,而且在边界上更好**:测量一个没有任何实现能测的量的方案,现在被拒时会具名那个量与可用的实现,而不是第五步抛出的一串字符串。
- **`requirePlan` 在线上那条路上现在被调用两次** —— 一次由宿主在 `runPipeline` 之前,一次由 `runT19B`。这在构造上是幂等的(已解析的方案解析回自己),代价是对一条小记录多走一遍。这也正是让驱动器的边界与线上的边界**是同一个**、而不是第二个更弱的东西的原因。
- `MeasuredMetric` 新增 `unit`。写作那一节需要它来把数字和单位一起陈述,而从展示标签里还原单位,就是拿散文做子串匹配。
- **离线套件里没有任何东西本可以抓到它**,而这正是值得留下的发现:1719 条测试、96 个文件、两个 TypeScript 面,而产品自己的路径在第五步是断的。抓到它的是端到端浏览器探针,两次,而且只是因为它的失败信息里写了步数。
