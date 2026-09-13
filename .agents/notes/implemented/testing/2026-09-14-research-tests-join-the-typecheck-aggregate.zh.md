# Agent Note: 研究测试并入 typecheck 聚合

Status: implemented

[English](2026-09-14-research-tests-join-the-typecheck-aggregate.md) | 中文

## Problem

`tsconfig.host.json` 把 `packages/research/*/tests/**` 排除在所有 typecheck 程序之外。TypeScript 因此从不读那 68 个 spec 文件,别的门禁也不读:`pnpm run lint` 通过同一个程序解析规则集,于是程序之外的文件按默认编译选项分析,产出一堆没人能处理的假阳性。

这条排除在"让 `pnpm run typecheck` 通过"的意义上是承重的,在"没有任何门禁说明它藏了什么"的意义上是不可见的。写这份 note 当天实测:把 host 面的四个 glob 重新纳入,暴露出 **159 个类型错误**,而且不全是机械问题:

- `dsh-research-core/tests/orchestration.spec.ts` 从 `../../src/index.ts` 导入类型,比包的 src 高一级。该导入是 type-only,运行时被擦除,所以这个文件从来没在运行时失败过。
- `dsh-research-tools/tests/e2e/helpers/imports.ts` 被 import 了一个它从未导出的 `StepExecutor`。
- `host-integration.spec.ts` 调用 `isComplete(store, runId)` —— 该函数一直要 `stepId`;两参调用从来不可能编译通过。
- 同一文件把某个成员声明成 `release: Promise<void>`,随后又用 `release()` 调用它。
- `e2e/helpers/report.ts` 有两个字段的声明比代码实际写入的值更窄(`'pending'` 与 `'missing'` 对 `GateOutcome` 与 `StepStatus`)。

每一条都是关于代码的陈述,而它们错的方式只有编译器会注意到。

## Decision

四个 host 面的 glob 从 `tsconfig.host.json` 的 `exclude` 中移出。`packages/research/dsh-research-web/tests/**` 保留:它是 client 面包,纳入 host 聚合会把浏览器源码拖进一个不该看到它们程序。

159 个错误在测试源码内修完,遵循一条规则:**改类型,绝不改断言**。四个包并行处理 —— 每包一个 agent、目录互不相交、写入与提交决定由主 Agent 持有 —— 每个 agent 单独报告:任何只能在 `src/` 里修的问题、任何它判断为"测试本身确实写错"的问题、以及它做的每一处非空断言改动。

不接受任何 `as any`、`@ts-ignore`、或新增的 `@ts-expect-error`。保留了两处 `as unknown as`,两处都是测试**故意**递给实现一个违反其静态类型的对象,以证明运行时检查会拒绝它;双重断言是"故意越界"的诚实写法,其周围的断言一字未动。

## Admission and ownership

`tsconfig.host.json` 拥有这个聚合。常设规则:研究测试文件与其他 host 面测试文件由**同一个程序**检查;将来若再要排除,需要写下理由,而不只是"跑绿了"。

并行拆分是这件事可行的原因,它与 runner 自己的 P6 是同一形状:独立模块、每个共享入口只有一个写入者。agent 没有提交权,所以门禁不会被一个尚未复核的 agent 改动。

## Alternatives considered

**保留排除,把缺口记录下来。** 否决:一个被记录下来的盲区仍然是盲区。那 159 个错误不是噪声 —— 其中包含一个指向不存在模块的 type-only 导入、一个被 import 了从未存在过的导出的 helper、以及一次实参个数错误的 `isComplete` 调用。把这些记录下来而不是修掉,只会让 README 对一个缺陷的描述变准确,而缺陷留在原地。

**单独建一个 `tsconfig.research-tests.json` 聚合。** 在修错误的阶段用作工作面,但否决它作为长期形态:第二个程序就是第二件需要与第一个保持同步的事,而 `pnpm run lint` 是通过 host 聚合解析规则的,测试仍然会在没有程序的情况下被分析。那个临时配置已随修复一并删除。

**只修看起来实质的错误,放掉机械的那些。** 否决:没有程序就没有办法分辨哪些是哪种。cordis spec 里的 `as never` 看起来像噪声,直到发现它在压制一个真实的签名不匹配;而那些看起来没用的 `possibly undefined` 报告,旁边就挨着真正不可达的调用。

**把这四个 glob 走 client 聚合。** 否决:它们是 host 面的包;这一组里唯一的 client 面 glob 恰恰是必须留在 host 程序之外的那个。

## Consequences

`pnpm run typecheck` 现在会读研究测试,那 159 个错误消失了:把 glob 纳入后 `tsc -b tsconfig.host.json` exit 0。

**lint 闸仍然是红的,而且在改动之前就是红的。** `pnpm run lint` 在改动前的树上报 299 个错误;把测试放进程序之后报 155。其中 research `src/` 的 62 个不受本次改动影响 —— 它们是既存的,而且 62 这个数字落在 research 源码而不是测试上。测试侧从 234 降到 90,因为文件一旦有了程序,假阳性就消失;剩下的 90 条是真实的规则违反(非字面量动态 import 产生 `any` 导致的不安全赋值、不必要条件、返回 void 的简写箭头),留给另一次改动。这份 note 把数字记下来,是为了下一个读者不必重新测一遍,也为了不让人把剩下的计数误当成这次改动引入的。

`agentTeams` 的名字冲突现在在 host 聚合里可见:`packages/experimental/agent-team` 与 `dsh-research-team` 都用不同类型声明了 `Context.agentTeams`,TypeScript 静默择一。`host-integration.spec.ts` 在那唯一一处赋值点做了 cast,两个程序里都成立。冲突本身已在 `CLAUDE.md` 记录;这次改动把它从潜在事实变成了编译期事实。
