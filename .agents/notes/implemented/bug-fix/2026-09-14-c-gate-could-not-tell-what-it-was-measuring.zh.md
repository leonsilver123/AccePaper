# Agent Note: C 门禁拿一个与 claim 无关的数字去和它比较

Status: implemented

[English](2026-09-14-c-gate-could-not-tell-what-it-was-measuring.md) | 中文

## 问题

C 通道用本研究自己的实验来裁定 claim 的可证伪预测。它把阈值读成**预测文本里的第一个百分比**,把证据读成实测的延误降幅:

```
thresholdFromPrediction(text)   // first /(\d+(\.\d+)?)\s*%/ in the text
evaluatePrediction(...)         // comparePolicies(scenario).relativeReductionPct
```

**没有任何东西检查这个百分比和这个测量是关于同一个量的。** 而在出货路径上它们并不是。Case Pack 的 claim 承诺的是车队 TTC<1.5s 碰撞风险率的下降;实验测的是需求加权的平均车辆延误。门禁报出:

```
C: outcome=failed (live experiment: measured 11.09% vs required 20%)
rationale: experiment (live) refutes the falsifiable prediction
```

这读起来像一次反驳,但它不是:11.09% 是延误降幅,20% 是风险阈值,而**没有任何实验检验过这个 claim**。

**这个缺陷是双向的,而"假通过"那一向才是危险的。** 独立审计(AUDIT-S #1)只把 claim 换成一个关于车队字符串稳定性指数的 claim —— 一个本研究从不测量的量 —— 阈值写 ≥5%,结果**十六步全部通过直达 E2**。一个未被检验的 claim 被报成受支持,而被这样报的,恰恰是一个以拒绝这类事情为全部存在理由的系统。另一个方向:那个看起来诚实的 A2 停止,依赖于 20 大于 11.09;一个数字恰好落在另一侧的 claim 会被裁定而不是被中止。

这是**独立审计者**发现的,不是测试发现的,而且它更正了一条本仓库已经写进文档、称为"系统在正常工作"的判断。

## 决定

**实验声明它测量什么,claim 只有声明同一个 key 才能绑定。**

`traffic-sim.ts` 公布 `MEASURED_METRIC_KEY = 'mean-delay-seconds-per-vehicle'` 及其显示标签。`evaluatePrediction(predictionText, scenario, metricKey)` 现在返回一个判别式结果:

- `{ kind: 'adjudicated', … }` —— claim 声明了被测量的 key **且**给出数值阈值。比较照旧执行。
- `{ kind: 'unbindable', reason }` —— claim 没声明 metric、声明了另一个、或没给阈值。**什么都不裁定。**

`'unbindable'` 产生的是**中止(hold),不是失败**:C 通道走它本来就有、为"无阈值预测"准备的那条 fail-closed 路径,证据里写明两个量的名字。"本研究无法检验那个 claim"不等于"那个 claim 失败了",把它报成失败只是同一个范畴错误的反方向。

`A2-claim` 负责携带这个 key:Case Pack 的 claim 若声明了就采用;模型派生的 claim 没有(其响应格式里没有这个字段 —— 拓宽格式是另一件事);fixture claim 声明被测量的 key,因为它自己的文本说的就是平均延误。两个产物都记录 `metricKey` 与 `measuredMetricKey`,于是读者不必读 runner 就能核对这次绑定。

## 同一提交里一并修的

**`gate_abstained` 的 hold 曾被驱动越过。** driver 的停止规则是 `status !== 'passed' && status !== 'gated'`,这等于把每个 `gated` 步骤都当成"停下并返回"。只有 E2 是那样;在任何其它步骤上 `gated` 是一个无法解除的 hold,继续驱动会让下一步的 `canStart` 抛 `A3-agenda cannot start — dependency order violated` —— 报告后果、掩盖 hold,与 `runT19B` 先前被修的是同一个缺陷。结果自带的 `kind` 能区分它们(只有 human gate 才是 `humanGate`),两个驱动器现在都在 hold 处停下。

## 归属与边界

metric key 归实验所有:知道自己在测什么的是研究本身,而 claim 不能靠"声明自己可测"来变得可测。`RunContext` 携带它,因为读 claim 的是 A2、读上下文的 C 门禁 —— 与预测文本本来就走的同一跳。

`CANONICAL_PREDICTION` 及其阈值**没有**被改动。它们本来就是关于平均延误的,现在只是把它们声明出来。(阈值是 5% 而非 8% 是既存事实,审批 spec 的头部现在披露了它 —— AUDIT-S #4。)

## 考虑过的替代方案

**只在证据字符串里写出被测量的量。** 否决,审计者也是这么说的:那让报告变诚实,却把假通过路径原样留着。

**用关键词去匹配预测文本里的量。** 否决:那是按词汇绑定,任何提到"delay"的 claim 都会绑定,无论它实际讲的是什么;而一个讲延误但没用这个词的 claim 则不会绑定。

**让该步失败而不是中止。** 否决:无法绑定的 claim 不是被反驳的 claim,而 §8 禁止把"无法裁定"变成一种裁定。

**要求 Case Pack 声明 metric(即改 pack 文件)。** 否决:pack 六个文件被其 manifest 的 `hashOfInputs` 覆盖且生成器不在树里,改动它们就是伪造 fixture 数据。出货 pack 不声明,于是现在中止 —— 对一个本研究无法检验的 claim,这才是诚实的结果。

## 后果

- 假通过路径被关闭:审计者的反例(字符串稳定性指数 ≥5%)现在中止,理由是 `the claim is about "platoon-string-stability-index" while this study measures "mean-delay-seconds-per-vehicle"`。
- 出货 Case Pack 的运行现在在 A2 以 **HOLD** 结束,而不是被报成一次反驳;出口处也不再抛依赖错误。
- 合法路径完好:fixture claim 声明了被测量的 key,一次运行仍能十六步走到 `E2-submit` `gated`。
- 新增回归测试在 `evaluatePrediction` 层面断言 unbindable;验收命令里加了两条真机探针 —— 一条必须中止,一条必须仍能走到 E2。
