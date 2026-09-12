# 科研工具质量规则字典(结构资产)

- 日期:2026-09-03 · 性质:**只读结构资产**(schema/字典/反例结构)
- 关联实现:T17 `three-line-table` 反模式 a–f(`UNIT_MISMATCH`/`DIRECTION_CONTRADICTION`/`STAR_PVALUE_MISMATCH`/`PERCENT_DECIMAL_MIX`/`DECIMAL_CHAOS`/`SNAPSHOT_CONTRADICTION`,见 `src/tools/three-line-table/index.ts`)、T16 `figure` 输入约束(`src/tools/figure/*`)
- 依据约定:P6 Golden Set 未落盘前,本文所有**数值/阈值/单位惯例均待用户校准**,非最终规范;禁止在工具内把本字典当已验证事实读取。

## 0. 校准状态声明

1. 本文是「可校验结构的骨架」:字段名/方向语义/条目形态已定,条目值(=惯例值)是候选。
2. 任何数值阈值在 Golden Set 校准前:**不进断言、不进测试快照、不进工具实现**,只可作文档候选。
3. Golden Set 校准后:条目升级为"已验证",变更须走版本化(与工具 `TOOL_VERSION` lockstep 同步)。

## 1. 交通领域指标单位字典(候选,≥20 条)

schema:`metric / direction / unit / domain`;`direction ∈ {lower_is_better, higher_is_better}`;`unit` 为列头/轴的候选显示单位;条目值待 Golden Set 校准。

| # | metric | direction | unit(候选) | domain |
|---|--------|-----------|-------------|--------|
| 1 | RMSE | lower_is_better | 同目标量纲(速度预测为 km/h) | 交通状态估计/速度预测 |
| 2 | MAE | lower_is_better | 同目标量纲(km/h) | 同上 |
| 3 | MAPE | lower_is_better | %(0–100) | 流量/速度预测误差 |
| 4 | MSE | lower_is_better | 量纲平方((km/h)²) | 回归误差 |
| 5 | accuracy | higher_is_better | %(或 0–1 fraction) | 分类/检测 |
| 6 | precision | higher_is_better | % 或 fraction | 检测/预测 |
| 7 | recall | higher_is_better | % 或 fraction | 检测/预测 |
| 8 | F1 | higher_is_better | % 或 fraction | 检测/预测 |
| 9 | throughput | higher_is_better | veh/h(段/车道/路网) | 通行能力评估 |
| 10 | flow(车道流量) | higher_is_better | veh/h/lane | 交通流 |
| 11 | travel time | lower_is_better | min(或 s) | 行程 |
| 12 | travel time index(TTI) | lower_is_better | 无量纲(≥1 ratio) | 行程可靠性 |
| 13 | delay(车均/人均延误) | lower_is_better | s 或 min/veh | 交叉口/路网 |
| 14 | queue length | lower_is_better | veh(或 m) | 排队 |
| 15 | waiting time(乘客/行人) | lower_is_better | min | 公交/行人 |
| 16 | on-time performance | higher_is_better | % | 公交运营 |
| 17 | latency(系统/通信) | lower_is_better | ms | 系统性能 |
| 18 | cost(单程出行/运行成本) | lower_is_better | 元/行程(或 运行 $/h) | 经济性 |
| 19 | CO₂ emission | lower_is_better | g/km/veh(或路网 g/km) | 排放 |
| 20 | fuel consumption | lower_is_better | L/100 km(或 L/h) | 能耗 |
| 21 | crash rate | lower_is_better | 起/百万车公里 | 安全 |
| 22 | near-miss / conflict rate | lower_is_better | 次/h(冲突率) | 替代安全 |
| 23 | buffer index(行程可靠性) | lower_is_better | 无量纲 ratio(P95/T) | 可靠性 |
| 24 | speed(平均行程速度) | higher_is_better | km/h | 路网运行 |

共 24 条。注意:个别条目(如 #24 speed)方向与"安全"叙事冲突时,以论文声明的 `metricDirection` 为准;字典只记惯例,不裁决歧义(裁决留给 Golden Set)。

## 2. p 值与显著性星号一致性规则

- 默认阈值映射(与 T17 `THREE_LINE_TABLE_DEFAULT_SIGNIFICANCE` 对齐):`p<0.05 → *`(1)、`p<0.01 → **`(2)、`p<0.001 → ***`(3);星数 = 被击穿的阈值个数,比较用严格小于。
- 语义要点:
  1. 星号**只能由作者在单元格声明**(stars 字段),工具只做交叉核验、**永不从 p 值推导星号**(T17 忠实性约束);p=0.05(恰等于阈值)不触发 `p<0.05`,星数按严格小于计。
  2. 论文允许自定义 `significance.pLessThan` 数组覆盖默认 0.05/0.01/0.001,但表内必须全表一致。
  3. 单尾/双尾、`p=0.000` 写法、`ns`/`†`(0.10)等扩展记号**不在默认集合**,需 Golden Set 决定是否收录。
- 待校准项:阈值三元组本身、是否允许 `<0.001` 文本形态、星号列是否允许非数字记号。

## 3. CI / SD / SE 区分规则

- 结构上分三种 cell 语义,禁止混用(kind 即区分):
  - `mean±sd` / `mean (sd)`:`sd` = 样本内离散度(meanSd / meanSdParen)。
  - `ci`:`lo–hi`(可带 `point`)= 区间估计,95% 置信区间为最常见候选;**不是** `mean±sd`。
  - p 值单独 `pValue` 类型,不塞进 sd/ci 槽。
- 规则:① sd 与 se 概念不同(se=抽样误差,按 n 收缩;sd 不随 n 收缩),论文若只报 se,表内不得改标 sd;② ci 端点 `lo>hi` 直接非法(INVALID_NUMBER);③ snapshot 交叉核验按 part(`mean`/`sd`/`lo`/`hi`/`point`)寻址,证明的是"表格与绑定快照同源",不等于 sd/se 概念被校验——概念真伪属 Golden Set 语义域。
- 待校准项:CI 默认置信水平(95%?)、`±` 与 `(sd)` 两种呈现的取舍、se 是否入字典。

## 4. 百分比 vs 小数、小数位规则(呼应 T17 反模式码)

- 列级 `scale ∈ {percent, fraction}`:`percent` 表示该列数值以 0–100 记(MAPE=12.5),`fraction` 表示 0–1 记(accuracy=0.875);**同一列两种 scale 混排 → `PERCENT_DECIMAL_MIX`**。
- 列级 `decimals`(非负整数)+ `precisionRule ∈ {fixed, significant}`:
  - `fixed`:固定 N 位小数补齐;`significant`:补足后裁尾零。
  - 声明了 `decimals` 却出现超出精度的标量(`1.234` vs 2 位)→ **拒绝**(`DECIMAL_CHAOS`),工具**从不静默四舍五入**(忠实性:作者精度超声明即拒绝)。
  - 未声明 `decimals` 而同列跨 cell(含复合 cell 内部,如 `1.23 ± 0.1`)出现不一致小数位 → `DECIMAL_CHAOS`。
- 显示惯例候选(待校准):误差/回归列常 2–3 位,p 值列 3 位或 `p<0.001` 截断形态;百分比列常 1–2 位;同一表内同量纲列应同 precisionRule。

## 5. 结语

- 本字典只定义**校验结构与候选惯例**;不得被任何当前工具断言消费。
- 后续落地方式建议:Golden Set 校准后生成只读 `*.dict.json`,由工具以注入字典(adapter seam)消费——与 T12–T17 "adapter 注入、纯函数" 结构一致。
