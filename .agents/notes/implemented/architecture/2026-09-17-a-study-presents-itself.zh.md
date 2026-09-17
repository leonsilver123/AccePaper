# Agent Note: 研究自己呈现自己,报告它的步骤不再点名它

Status: implemented

[English](2026-09-17-a-study-presents-itself.md) | 中文

## 问题

四个执行器把本部署的第一个研究当作名字来认识。`B3-baseline` 读 `SCENARIO.baselineIdentity`、呼叫 `comparePlatoons`;`C1-mvp` 报告编队自己的字段(`baselineMinTtcSeconds`、`baselineTtcLt1_5RatePct`);`D1-figure-map` 画的是「platoon composition」的柱状图、表头写着「Minimum TTC (s)」、路线图的节点属于一个车队;`E1-format` 又建了同一张表的第二份拷贝、陈述编队模型的方程、写出关于 Intelligent Driver Model 的兜底正文。门禁也一样:A 通道的措辞检查把每条主张都对着 `MEASURED_METRIC` 读,C 通道用 `measureStudy(ctx.runCtx.study)` 给每条主张评分。

后果是可测量的,不是理论上的。第二个研究 —— 单服务器队列、毫秒、越小越好、数据是序列而不是两个类别 —— 可以被声明、被计划解析、被模拟、被度量,然后停在 `D1-figure-map`:四个执行器各自需要一条「现在是哪个研究」的分支,而每个研究四条分支,正是一条流水线开始描述一个它并没有在跑的研究的方式。同一个缺陷也到了门禁:一条延迟主张被拿编队的措辞去读、于是被挂起,而一次延迟运行的 C 判决是从一份编队比较算出来的。

## 决定

- **`runner/study-adapter.ts` 是每个研究一个对象。** `StudyAdapter` 带着:可执行的方法、两条臂的名字与身份、B3 与 C1 盖的生产者品牌、数字的来源、测量结果(记录、门禁输入、规则版本、序列,都来自**同一次**执行)、每个实验工件附带的来源块、呈现(图计划、渲染器 spec、表、图)、C3 所消融的边界、陈述「测量对主张做了什么」的那句话,以及每个章节的兜底正文。
- **运行上下文携带它,由计划解析而来。** `createRunContext` 在第一步之前解析;Case Pack 提供研究自己的场景时,`A2-claim` 通过 `setRunStudy` 重建;恢复运行时按记录下来的计划重建。`studyAdapterFor` 先按计划**点名**的实现解析,其次按它声明的量 —— 这正是让 A2 的中间计划(模型推导出的主张,其 metric key 为空、按构造不可绑定)仍然按运行被配置成的那个研究来进行的机制。
- **执行器不再点名研究。** B3 从适配器拿两条臂与测量;C1 写记录自己的形状(`metricKey`/`unit`/`baseline`/`variant`/`values`),而不是每个研究一套字段;D1 渲染研究交给它的呈现、并对着运行的记录对账;E1 渲染研究自己的表与方程、写研究自己的正文;C3 消融研究所声明的边界。
- **「测量是一条序列」是一等形状。** `StudySeries` 随结果记录同行,`sequencePresentationPlan` 把它画在 `sequence` 轴上、点按位置寻址(`series.arms.baseline.3`),对账读取器按数字路径段索引数组。内容哈希覆盖序列:两条臂相同而观测不同的两份记录,是两次测量。
- **本构建能测量、却没有适配器的研究会被拒绝**,而不是由最近的那个来描述:`SUPPORTED_IMPLEMENTATIONS` 说代码能跑它,适配器说这条流水线能写出关于它的论文。
- **门禁从材料里解析被测量的量。** A 通道的措辞检查对着已注册的实现读 `measuredMetricKey`,而不是 `MEASURED_METRIC`;C 通道从运行的适配器取指标与测量。对每一次不是编队研究的运行,这两处此前都是错的。

## 考虑过的其他做法

- **在每个执行器里对研究取分支。** 拒绝:每个研究四条分支,没有任何一处陈述研究**是**什么,下一个研究再加四条。
- **把适配器做成可选字段、缺省用编队。** 拒绝:计划点名了另一个研究的运行会被静默地当作编队来呈现,而这正是本条要替换掉的缺陷。
- **在每个执行器里按需解析适配器。** 拒绝:`studyAdapterFor` 建出的新适配器,其 `measure()` 会重新跑一遍研究 —— 那正是 `result-version.ts` 存在的理由所要消除的重算。适配器对每个实例只记忆一次执行,由上下文携带那个实例。
- **把第二个研究的消融继续做成编队形状、并对它拒绝 C3。** 拒绝,尽管那是更小的改动:一个跑不完自己边界探测的研究,是流水线无法完成的研究,而「能跑第二个研究」在流水线的最后三分之一处就会变成假话。

## 后果

- **队列研究跑完 16 步、停在人工闸门** —— `tests/second-study-run.spec.ts` 驱动它,并断言它自己的指标、单位、方向、臂、序列、表、方程、正文与边界,且没有任何编队词汇到达其中任何一处。
- **通用化暴露出的四个缺陷,每一个都是真缺陷。** 兜底正文里一个 `0.9` 的负载率,是运行从未声明的数字,被数字检查拒绝。D4 的一条修订补丁与 E1 的一处表注,会把编队句子带进任何研究的稿件。判决的 `evaluator` 一行对每次运行都点名编队模块。A 通道的措辞检查对除编队外任何主张都没有短语表。
- **这里没有覆盖的。** `SCENARIO.venueName`/`venueId` 仍是 A1/A4/E1 读的部署常量。检索适配器仍是合成语料。图渲染器仍是本仓库自己的工具,而不是计划推荐的科研绘图 provider。`A3-agenda` 的主张与证据文本仍是编队味道的兜底正文。
- **研究树里有 158 条既存的 `oxlint` 报错**,分布在 `dsh-research-cordis` 与 `dsh-research-web`,本单元改动的文件里一条都没有。

## 文件

- `packages/research/dsh-research-team/src/runner/study-adapter.ts`(新增)、`runner/service-latency-sim.ts`(参数化的 trace 与 coalescing、模块消融、边界两种工况)、`runner/result-version.ts`(`StudySeries`、`resultVersionFrom`)、`runner/presentation-plan.ts`(`sequencePresentationPlan`、记录路径按位置寻址)、`runner/study-plan.ts`(`LATENCY_PLAN`)、`runner/registry.ts`、`runner/verdict.ts`、`runner/redteam-review.ts`、`runner/drive.ts`、`src/index.ts`。
- 测试:`tests/second-study-run.spec.ts`(新增),以及 `tests/runner-registry.spec.ts`、`tests/result-version.spec.ts`、`tests/scientific-credibility.spec.ts`、`tests/presentation-plan-run.spec.ts`、`tests/verdict-fail-closed.spec.ts`、`tests/e2e/happy-path-t19b.spec.ts` 的更新。
