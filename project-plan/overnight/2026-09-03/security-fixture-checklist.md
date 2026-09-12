# 安全与反例 Fixture 清单(结构资产)

- 日期:2026-09-03 · 性质:**只读结构资产**,仅为 T12–T17 六工具的安全反例"用例结构"
- 本文**不含任何实际注入载荷/攻击代码**;每条只写 `用例名 / 构造思路 / 期望(行为或错误码)`,落地时在对应工具测试内细化
- 错误码前缀依据现存实现:T12 `DSH_LITERATURE_SEARCH_*`、T13 core `DSH_CITATION_*`、T14 无前缀 Error(`[claim-construct]`,风格债已知)、T15 `DSH_ABLATION_*`、T16 `DSH_FIGURE_*`、T17 `DSH_THREE_LINE_TABLE_*`
- 需求覆盖威胁面:路径穿越、符号链接、SVG script 注入、外部图片 URL、超大输入、prototype pollution、p 值星号矛盾、单位混用等

## 1. 目的

未来把 fixture 落到各工具测试时,统一以下期望形态:① 反例必须"命中具名错误码"(或记录当前缺口);② 合法载荷永不因宽松解析被接受;③ 工具产物不可被污染(深冻结 + 无活引用);④ Golden Set 前不做数值断言,只断结构/错误码。

## 2. 用例五要素

`用例名`(grep-able)`→ 构造思路`(怎么造这个坏输入,不含载荷字面)→ `期望行为` + `错误码`(可能标注"当前缺口/待实现")。

## 3. T12 literature-search

| 用例名 | 构造思路 | 期望(行为/错误码) |
|---|---|---|
| LS-TOPIC-OVERSIZE | 超长 topic(远超任何合理检索词) | 当前无长度上限=**缺口**;落地前应加 `MAX_TOPIC_LEN` 守卫并断言新码,而非静默接受 |
| LS-MAXRESULTS-HUGE | maxResults 取巨大整数 | 现接受安全整数;fixture 锁上界语义,Golden 前确认 cap 契约(≤100 候选) |
| LS-QUERY-PROTO-POLLUTION | query 携带 `__proto__`/`constructor` 等非 schema 键 | 只读声明键,忽略无关键;测试后断言全局 `Object.prototype` 无新增属性 |
| LS-ADAPTER-OVERCAP-OUTPUT | adapter 返回 hits>total 或 hits>maxResults 的越界结构 | 判定为 adapter fault → `DSH_LITERATURE_SEARCH_INVALID_ADAPTER_OUTPUT`(代码 195–209 契约) |

## 4. T13 citation-verify

| 用例名 | 构造思路 | 期望(行为/错误码) |
|---|---|---|
| CV-EMPTY-BRANDED-ID | claimId/citationId 为空串 | fail-fast → `DSH_CITATION_INVALID_REF`(工具与 core 同码) |
| CV-ID-OVERSIZE | 超长/恶意填充的 id 字符串 | 复用 core 品牌校验;尺寸上限属 Golden 语义,fixture 只锁"不崩溃、走具名错误" |
| CV-NONCLONEABLE-EVIDENCE | resolver 返回带函数属性等不可 clone 证据 | core 错误透明传播 → `DSH_CITATION_VALUE_NOT_CLONEABLE`(不重包装) |
| CV-INPUT-PROTO-POLLUTION | input 对象注入非 schema 键/`__proto__` | 只消费声明字段;产物无污染键;`Object.prototype` 不被写 |

## 5. T14 claim-construct

| 用例名 | 构造思路 | 期望(行为/错误码) |
|---|---|---|
| CC-ASSERTION-OVERSIZE | assertion 超过 `MAX_CLAIM_ASSERTION_LENGTH=2000` | 拒绝并报 `[claim-construct] ... exceeds 2000`(现无前缀 Error,风格债已记录) |
| CC-ASSERTION-NONSTRING | assertion 传非字符串(数字/对象) | 现抛裸 TypeError=**缺口**;fixture 期望改为带工具标识的错误后再锁 |
| CC-INPUT-PROTO-POLLUTION | input 注入 `__proto__`/多余键 | 只读 schema 字段;constructed claim 无多余键;原型未被污染 |

## 6. T15 ablation

| 用例名 | 构造思路 | 期望(行为/错误码) |
|---|---|---|
| AB-METRIC-DIRECTION-INVALID | 定义里 metric.direction 用非法枚举(如 middle-is-better) | `DSH_ABLATION_INVALID_METRIC_DIRECTION` |
| AB-DEFINITION-OVERSIZE | variants/components 数量巨大 | 当前无尺寸上限=**缺口**;落地前加 `MAX_VARIANTS/MAX_COMPONENTS` 并断言新码 |
| AB-EXECUTOR-UNTRUSTED | executor 返回与定义不对齐的结果结构(缺 variant/坏 metric 名) | adapter fault → `DSH_ABLATION_INVALID_ADAPTER_OUTPUT` / `DSH_ABLATION_ADAPTER_FAULT` |

## 7. T16 figure(安全面最大)

| 用例名 | 构造思路 | 期望(行为/错误码) |
|---|---|---|
| FG-PATH-TRAVERSAL-DOTDOT | 输出路径含 `../` 逃逸 | `DSH_FIGURE_PATH_TRAVERSAL` |
| FG-PATH-TRAVERSAL-WIN | 反斜杠形态 `..\` 混合分隔符 | 先规范化再判,`DSH_FIGURE_PATH_TRAVERSAL`(Windows 风格同规则) |
| FG-PATH-ABSOLUTE-ESCAPE | 绝对路径/盘符 `C:`/UNC 前缀 | `DSH_FIGURE_PATH_TRAVERSAL` |
| FG-PATH-OUTSIDE-ROOT | 形态合法但不在 allowlist 根下 | `DSH_FIGURE_PATH_OUTSIDE_ALLOWLIST` |
| FG-PATH-CONTROL-CHAR | 路径含 NUL/控制字符 | `DSH_FIGURE_PATH_INVALID` |
| FG-SYMLINK-ESCAPE | 目标位于允许根内、但解析后是符号链接指向根外 | 工具 path guard 是纯文本层(不碰 FS);fixture 落在**下游持久化 adapter 契约**:写前 realpath 复查,越界拒绝(映射 `PATH_OUTSIDE_ALLOWLIST` 或 adapter 自有码) |
| FG-SVG-SCRIPT-INJECT | 标题/series.name/category 文本含 script 形态标记 | 文本经 `escapeXml`;断言产物不含任何可执行标记(tag/关键字) |
| FG-SVG-EVENT-ATTR-INJECT | 文本含事件属性/引号逃逸形态 | 同上被转义为纯文本;不产生 on* 属性 |
| FG-SVG-EXTERNAL-REF | 文本含外部 URL/协议跳转/javavascript 形态 | builder 永不产出 image/a/href/foreignObject;断言产物无外部引用(**外部图片 URL 一并覆盖**:图内不引用任何远程资源) |
| FG-SVG-NONASCII-CTRL | 文本含非打印/控制/非 ASCII 字符 | `DSH_FIGURE_INVALID_TEXT` / `DSH_FIGURE_INVALID_TITLE`(仅 printable ASCII 通过) |
| FG-INPUT-OVERSIZE | values>64、series>8、canvas>4096、title/series/axis 文本超 maxLen | 各自命中 `DSH_FIGURE_INVALID_SERIES`/`_CANVAS`/`_TITLE`/`_TEXT` 等 |
| FG-SPEC-PROTO-POLLUTION | spec 携带 `__proto__`/`constructor` 等非 schema 键或 NaN 数值 | 只消费声明键、数值槽全部 finite 检查 → `DSH_FIGURE_NON_FINITE_NUMERIC`/`INVALID_SPEC`;产物无污染 |

## 8. T17 three-line-table

| 用例名 | 构造思路 | 期望(行为/错误码) |
|---|---|---|
| TT-STAR-PVALUE-CONTRADICT | p 值低(如显著)却标 0 星,或 p 不显著却标 3 星 | `DSH_THREE_LINE_TABLE_STAR_PVALUE_MISMATCH` |
| TT-STAR-PVALUE-BOUNDARY | p 恰等于阈值(如 0.05)仍标 1 星 | 星数按"严格小于"计,边界不通过 → 同上错误 |
| TT-UNIT-MIX-COLUMN | 列声明单位与某 cell 的 `unit` 不一致 | `DSH_THREE_LINE_TABLE_UNIT_MISMATCH` |
| TT-DIRECTION-CONTRADICT | `lower_is_better` 列却把最大值标 `best` | `DSH_THREE_LINE_TABLE_DIRECTION_CONTRADICTION` |
| TT-PERCENT-FRACTION-MIX | 同一列既有 percent 记法又有 fraction 记法 | `DSH_THREE_LINE_TABLE_PERCENT_DECIMAL_MIX` |
| TT-DECIMAL-OVERRUN | 列声明 decimals=2,某值却需 >2 位表示 | `DSH_THREE_LINE_TABLE_DECIMAL_CHAOS`(拒绝,永不静默舍入) |
| TT-DECIMAL-RAGGED | 未声明 decimals,同列跨 cell(含 `mean ± sd` 内部)小数位不一致 | `DSH_THREE_LINE_TABLE_DECIMAL_CHAOS` |
| TT-SNAPSHOT-CONTRADICT | dataSnapshot.recorded 与 cell 实际标量不一致 | `DSH_THREE_LINE_TABLE_SNAPSHOT_CONTRADICTION`;形状非法 → `INVALID_SNAPSHOT` |
| TT-INPUT-PROTO-POLLUTION | model 带 `__proto__` 键/坏形状 cell | 运行时 shape 复查(类型不可信) → `INVALID_MODEL`/`INVALID_CELL`;产物无污染 |

## 9. 落地说明

- 上表 35 条 fixture 当前只到"结构";注入载荷与具体数据在对应工具测试内实现时再细化,本文不落攻击字面。
- 标"缺口/待实现"的用例(T12 topic 上限、T15 尺寸上限、T14 错误风格):落地时先补守卫/改风格,再断言具名错误码。
- 所有 fixture 共用后置断言:**产物深冻结、meta 三件套齐全、无活引用、错误必带工具前缀**(T14 例外为已知债)。
