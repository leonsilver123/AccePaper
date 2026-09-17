# Agent Note: 图先被计划,再被画出来,数值与运行对账

Status: implemented

[English](2026-09-17-a-figure-is-planned-before-it-is-drawn.md) | 中文

## 问题

D1 只画一张固定 320×240 画布、固定标题、单 series、固定 seed 的柱状图。没有任何地方说过这张图**为了什么**,于是也没有任何东西能说它究竟回答了什么 —— 而 Q00 的质量基线在交付那篇论文上发现了后果:六个 float,正文里没有一句话引用其中任何一个。一个不回答任何问题的 float 是装饰,而没人引用的装饰正是读者会跳过的。

## 决定

- **`runner/presentation-plan.ts` 陈述每张图回答什么。** `PlannedFigure` 带上那个问题、数值来自哪份记录(record slug)、以 `{key, value}` 命名该记录字段的 series、坐标轴与单位、不确定性、它自己的画布尺寸与格式、caption,以及论文是否需要它 —— 连同这样判断的理由。
- **D1 先建计划、再把 spec 交给渲染器**,于是读者拿到的图与有人写下的那个问题是同一个对象。画布尺寸属于计划(逐图),而不是常量。
- **数值对账是一项检查**(`figure-values-unsourced`):绘制的每个值,都必须是运行在图所点名的键、所点名的记录下记下的那个值。漂移过的记录会被拒绝,而不是照字面值画出来。单独驱动的步骤没有结果记录、会自己测量研究,此时计划把来源写成 `recomputed-measurement`,于是这个差别在工件上,而不是藏在控制流里。
- **其余拒绝点名了「图声称了运行没有确立的东西」的各种形态**:`figure-no-question`、`figure-sequence-missing`(横轴是序列而点不是序列中的位置,画出的趋势没有测量支撑)、`figure-interval-missing`(声明区间却不带上下界,是运行没有做出的不确定性主张)、`figure-duplicate-id`。
- **figure plan 连版本一起记在工件上**,于是运行的读者能看出某个 float 回答了什么问题、它的数字从哪来。

## 考虑过的其他做法

- **保留固定 spec,加一个 caption。** 拒绝:给一张没人计划过的图写 caption,正是交付论文所处的状态 —— float 存在,论文从不用它。
- **对着运行持有的所有值对账,而不是对着图点名的那份记录。** 拒绝:一张声称的键不属于它所点名的记录的图,读者无法核查,而「点名」正是让对账有意义的东西。
- **拒绝任何「不确定性未被量化」的图。** 拒绝:本研究是确定性仿真,没有可画出的抽样区间 —— 诚实的状态是图自己说明这一点,而不是一条会挡下所有确定性研究的拒绝。

## 后果

- **出货运行的图是被计划、被对账、并按计划尺寸画出的** —— `tests/presentation-plan-run.spec.ts` 读读者本来就会对照的那两个工件,断言绘制的值就是记录的值、SVG 的宽高等于计划所述。
- **第二个任务族用自己的记录画出自己的图**,caption 说的是它自己的测量对它自己的主张做了什么。
- **这里没有覆盖的。** 渲染器仍是本仓库自己的 SVG/PNG 工具,而不是计划推荐的 Matplotlib provider:本机是 Python 3.14 且没有 Matplotlib,所以没有任何需要它的 provider 被接进来,图的字体也是内置渲染器的。一张图是否易读、比例是否合适、与正文是否一致,属视觉复核(M09),这里不判定。

## 文件

- `packages/research/dsh-research-team/src/runner/presentation-plan.ts`(新增)、`runner/registry.ts`(D1 建计划、对账、按计划渲染;工件携带它)。
- 测试:`tests/presentation-plan.spec.ts`、`tests/presentation-plan-run.spec.ts`。
