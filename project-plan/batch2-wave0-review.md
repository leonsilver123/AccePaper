# Batch 2 Wave 0 — 项目状态审查报告(T07/T08/T09)

**审查时间:** 2026-09-03 ~14:55(GMT+8)
**审查性质:** 只读(未修改任何跟踪/未跟踪文件;仅运行 typecheck 与定向测试)
**仓库:** `D:/1/deepseek-harness-master1/deepseek-harness-master`
**审查对象:** "已完成 Wave 0" 声明 vs 仓库实际状态,以及启动 Wave 1 前的就绪度。
**后续处置:** 用户裁决采用**路径 D**(不伪造并行分支:先修正契约语义 → 按目录拆独立提交收编现有成果)。处置已于同日执行完毕,记录见 **§9**;报告内 §4/§5/§8 原观察项均已标注处置状态。**批次2 Wave 0 结论:✅ 完成,可进入 Wave 1。**

---

## 0. 结论摘要(先看这里)

| 维度 | 状态 | 说明 |
|---|---|---|
| 冻结契约提交 | ✅ 存在 | `613521f` 仅新增 `src/contracts.ts`(246 行纯类型),13:56 提交 |
| 契约内容 vs T07/T08/T09 | ✅ 对齐 | 类型/错误码前缀/依赖关系/不变量均冻结,见 §3 |
| 契约语义修正(用户路径 D) | ✅ 完成 | 5 项 P1/P2 修正已落地并独立提交 `96ff257`,见 §9.1 |
| 基线测试(批次1回归) | ✅ 通过 | **core 子集 72 项**全绿(state-machine 53 + host 19);批次1 总数为 **78 项**(另含 Cordis lifecycle 6 项,不在本 core 测试目录) |
| core typecheck | ✅ 通过 | `tsc --noEmit` exit 0(复测确认) |
| **Wave 1 产物收编(路径 D)** | ✅ 完成 | A7/A8/A9 实现+测试按目录拆 3 独立提交(T07 `e4bcb1b` / T08 `c4d41e8` / T09 `73a8055`),不伪造并行分支 |
| 公共 API 接线(主 Agent) | ✅ 完成 | `src/index.ts` 统一导出三模块稳定公共面 `346198d` |
| per-agent 分支/worktree | ⚠️ 不适用→已替代 | 批次2协议原要求独立 branch/worktree;用户裁决以路径 D 替代(目录限定提交),偏差记录在案 |
| 基线记录文档 | ✅ 完成 | 冻结提交 `613521f` + 修正提交 `96ff257` 消息内联;本报告充当 Wave 0 记录 |
| 红线扫描(联网/密钥/污染) | ✅ 干净 | 新文件无 fetch/http/env/key;无真实分区名单(mock 已全部合成化) |
| 新模块测试(处置后) | ✅ 通过 | l0 **42** + citation **39**(verify 29 + red-line 10)+ gates **59** = **140 绿**;core 全量 **212 绿** |

**核心判断:** Wave 0 的"契约冻结"部分是真实完成的;但审查时仓库状态与"Wave 0 完成、即将启动 Wave 1"的预期不一致——三路实现产物以未跟踪文件形式堆在 master 工作树上(违反批次2协议 Wave 0 #4 / Wave 1 文件规则)。经用户裁决采用**路径 D** 处置完毕:保留现有实现,先修正契约语义(5 项 P1/P2),再按目录拆成独立提交,不事后伪造并行分支历史。**Wave 0 至此完成,仓库处于 Wave 1 就绪状态。**

---

## 1. 审查范围与方法

- 定位真实 git 仓库(排除同名 zip 解压副本与批次1 smoke 拷贝目录)。
- 逐项对照批次2指令 Wave 0 五步检查表核对。
- 通读 `contracts.ts`(冻结契约)与全部未跟踪实现/测试文件(约 3,000 行)。
- 红线静态扫描 + 定向运行:`tsc --noEmit`、`vitest run packages/research/dsh-research-core/tests`。
- 工作树/禁改区/锁文件漂移审计(`git status`)。

---

## 2. 仓库事实基线

- 主仓库:`deepseek-harness-master1/deepseek-harness-master`,分支 `master`,审查时 HEAD = **`613521f`** `batch 2 wave-0: freeze T07/T08/T09 cross-module contracts (src/contracts.ts)`(13:56:54)。
- 上一基线:批次1 收尾链 `d0065a7 → 3f9fc67 → 0e7133a → 93d9064 → 5a795af …`;批次1 基线 commit `c6731f7`。
- 同目录易混淆项(均已排除):
  - `D:/1/deepseek-harness-master`、`deepseek-harness-master1`(外层)= zip 解压目录,无 `.git`;
  - `D:/1/dsh-clean-wt-0e7133a/5a795af/93d9064`、`wt-3f9fc67-check` = 批次1 的 clean-worktree **拷贝**目录(无 `.git`,非 git worktree)。
- 审查时 `git status`:仅 6 个未跟踪目录,无任何已跟踪文件改动:
  `src/{l0,citation,gates}/`、`tests/{l0,citation,gates}/`。
- 禁改区确认无漂移:engine/、host*.ts、index.ts、Cordis 包、package.json、pnpm-lock、tsconfig.base 均未修改。

---

## 3. 冻结契约审查(613521f → src/contracts.ts)

Wave 0 #1/#2(确认实现状态、冻结类型/错误码/IO/依赖)完成情况:

- **T07 L0:** `L0SourceType`(9 类含 `unknown`,非 11 类硬编码)、`L0Tier`(tier1–3/unvetted/unknown;冻结版含 `abstained` → §9 P1-1 已分离修正)、`L0Classification`(sourceType/tier/riskLevel/rationale/`preprintNotPeerReviewed` 风险旗标/`ruleVersion` 版本化;修正后新增 `status` 字段)、branded `L0SourceId`。✔
- **T08 引文:** `CitationRef`(kind: doi/arxiv/isbn/standard/unknown)、`CitationEvidence`(originalTextAccessed/method 含 `none`/locator/excerpt/accessedAt iff;修正后新增 `sourceUri/sourceVersion/contentHash/retrievedAt` 溯源字段)、7 结论枚举(含 `blocked`)、`VerificationResult` 带 `redLineTriggered` + `DSH_CITATION_*` reasonCode + 注入 timestamp(修正后新增可选 `resolverStatus`)。✔
- **T09 gate:** 4 结果(`passed/blocked/failed/abstained`)、`AdjudicationVote`(voterRole 与 modelFamily 分离,支持同族检测)、`FalsifiablePrediction`、`AdjudicationConfig`(阈值可缺省→弃权)、`AdjudicationResult`(reasonCode/evidenceRefs/timestamp/abstentionReason/voteTally/sameFamilyClusters);修正后新增冻结映射 `GATE_OUTCOME_TO_INTENT` + `StateMachineGateIntent`。✔
- **跨模块解耦:** 三个模块只允许 import contracts + `engine/types.ts`(TrinityComponent 纯类型)+ `engine/state-machine.ts`(ResearchError 基类);gate B 通过 contracts 的 `VerificationResult` **类型**消费 A8,不 import A8 实现。✔
- **错误码:** `DSH_L0_` / `DSH_CITATION_` / `DSH_GATE_` 三前缀全局唯一。✔
- **不变量头:** 不可变快照、no-default-pass、no-truth-claim、纯函数、可审计、sk-xxx。✔
- 冻结提交消息声明 "typecheck exit 0;core 72 regression tests green" —— **复测属实**(core 子集 72;批次1 总数为 78,含 Cordis lifecycle 6 项)。

Wave 0 #3(基线/工作树/测试结果记录):提交消息内联记录 ✔;无独立 wave-0 状态文档 → **本报告充当**,且 §9 记录了处置执行证据。

Wave 0 #4(独立 branch/worktree):❌ 未执行 → **由用户裁决的路径 D 替代**(§9),偏差记录在案。
Wave 0 #5(公共文件主 Agent 独占):✔ 无越界;处置后 `src/index.ts` 由主 Agent 统一接线(`346198d`)。

---

## 4. 未跟踪实现的三模块质量审查(视作 Wave 1 候选产物)

> 以下为对工作树中未提交实现的代码走查结论。整体质量高、与冻结契约贴合;但注意它们**不是**按协议在独立分支上产生的(已由路径 D 收编,§9)。

### A7 — src/l0/(routing.ts 374 行 + types.ts 84 行 + index.ts)
- 路由委托给注入的 versioned `L0RoutingAdapter`(mock fixture 独立于 router),**无**对类型 union 的硬编码业务 switch;运行时用只读 Set 做输入/输出守卫。
- No-default-pass 钳制(只降不升):缺 sourceId→unknown(硬,覆盖 adapter);adapter 冲突→abstained;adapter 抛异常→修正后按 **adapter fault → failed**(与规则冲突 abstained 分离);未知/扩展类型被恶意 adapter 判为 passing/unvetted→钳回 unknown。
- 边界克隆(非 cloneable→`DSH_L0_VALUE_NOT_CLONEABLE`)、返回冻结、preprint 仅风险旗标(绝不等于 tier1/真实)。
- 观察项(已处置):mock fixture 原使用真实刊物名(Nature/Science/NeurIPS/ICML/CVPR/ACL/PAMI/JMLR/JACS 等映射 tier1),按路径 D 已**全部替换为合成名**(Synthetic Journal A / Synthetic Conference A / Synthetic Regional Journal A 等),消除"真实分区名单"混淆(§9.1-F)。

### A8 — src/citation/(verify.ts ~600 行 + adapter.ts 49 行 + fixture.ts 82 行)
- **#6 硬红线最优先判定**,claimed supported/partial 且原文未访问→`blocked` + redLineTriggered,不可降级;getter/原型污染/事后改输入由边界 `snapshot()`(structuredClone+deepFreeze)一次性固化对抗。
- **#1 虚构(resolver 确认 not_found)→ 修正后直接 `blocked` + redLineTriggered=true + CITATION_CODE_NOT_FOUND**,绝不落到 `unverified`(§9.1 P1-2);resolver 输出为判别联合:`resolved / not_found / temporarily_unavailable / ambiguous`——服务暂不可用 ≠ 文献虚构,歧义与故障各自独立暴露。
- #2 身份不符;@#4 撤稿(未标记=redLine,已标记=surface);#5 相关作因果→unsupported+redLine;#3 内容不支持→unsupported;其余走 claimed。
- adapter 契约(网络查询只定义契约)、Fixture/Mock 无网络、无真密钥;`MockCitationResolverAdapter` 支持 unavailableKeys/ambiguousKeys 选项。
- 设计观察(已处置):原 #1 虚构文献结论语义混合(`unverified`+redLine)→ 修正为硬块 `blocked`,下游不可能把虚构误读为非硬块。

### A9 — src/gates/index.ts(564 行)
- A:多角色投票/反驳;阈值缺省/非有限/越界→abstained(Golden Set 未校准不硬编码);法定票数不足→abstained;同族检测+降权(权重**纯配置**,未校准→abstain,无隐含常量),降权后有效票不足→abstained 且上报 `sameFamilyClusters`(C3,不把同族说成真异质性);歧义→blocked。
- B:消费 T08 `VerificationResult[]`;redLine 任何一条→blocked;可用锚(原文已访问+supported/partial)→passed;无锚且 requireExternalAnchor→abstained,否则 abstained(no-default-pass)。
- C:无可证伪预测→blocked;有预测无实验→abstained;supportsPrediction 非 bool→abstained。
- 新增冻结映射:`gateToStateMachineIntent` 读取 `GATE_OUTCOME_TO_INTENT`(Object.freeze),passed→pass / blocked→rework / failed→hard_fail / abstained→hold_abstained,**abstained 永不升级为 pass**;Cordis/T10-R 不得自行重解释。
- 全部结果经 clone+deepFreeze(seal)返回;audit 字段齐备。
- 观察项(已记录):cloneValue 抛 `ResearchValueError('DSH_VALUE_NOT_CLONEABLE')`(与状态机共用全局码);gates 依赖 `engine/state-machine.ts` **仅为错误基类** —— 该循环依赖风险已在 contracts.ts 与 gates 头注释记录(§9.1 P2-5),长期应将错误基类移入中立模块(engine/errors.ts)。

### 测试(处置后 140 个新用例,全绿)
- `tests/l0/routing.spec.ts` 42:9 类型路由、no-default-pass 反例(unknown/缺 id/规则冲突/恶意 adapter 钳制/抛异常 adapter→failed)、no-truth-claim、快照冻结、非 cloneable 拒绝、**tier/status 分离类型级守卫**(`@ts-expect-error` 保证 L0Tier 不含 abstained)。
- `tests/citation/verify.spec.ts` 29 + `red-line.spec.ts` 10:六类阻断(含 not_found/outage/ambiguous/malformed 判别)+ happy path + 输入校验(accessedAt iff、provenance 字段校验)+ getter/原型污染/事后修改等红线绕过对抗。
- `tests/gates/gates.spec.ts` 59:A 通过/失败/阻断/弃权 + 同族降权 + B 锚策略 + C 裁决矩阵 + **冻结映射契约测试**(表冻结、abstained 永不为 pass、helper 全函数、端到端)。

---

## 5. 主要偏差与处置状态(全部已处置,见 §9)

| 编号 | 偏差(审查时) | 状态 |
|---|---|---|
| D-1 | 三模块实现+测试未跟踪于 master 工作树,无 per-agent commit/分支隔离 | ✅ 已处置:路径 D 按目录拆 **3 个独立提交**(T07/T08/T09),不伪造并行分支历史 |
| D-2 | `src/index.ts` 未接线导出新模块(审查时正确未做) | ✅ 已处置:主 Agent 统一导出稳定公共 API(`346198d`) |
| D-3 | 无独立 wave-0 记录文档(仅 commit message 内联) | ✅ 已处置:本报告充当 Wave 0 记录,§9 含执行证据 |
| D-4 | 工作树残留 `src/citation/tsconfig.tsbuildinfo`、`src/gates/tsconfig.tsbuildinfo` | ✅ 已处置:已删除(未跟踪产物,不入库) |
| D-5(低) | l0/citation/gates 目录内独立 `tsconfig.json`(共 3 个)+ `tests/citation/tsconfig.local-test.json` 将随模块提交入库 | ✅ 已处置:4 个模块级 tsconfig 全部删除,不提交(与仓库根 tsconfig 布局保持一致) |

---

## 6. 复测证据

| 检查 | 命令 | 结果 |
|---|---|---|
| core typecheck | `tsc --noEmit`(core 目录,同 package.json 脚本) | exit 0(审查时 + 处置后复测均为 0) |
| core 定向测试全量 | `vitest run packages/research/dsh-research-core/tests`(仓库根) | **6 文件 / 212 用例全绿**(批次1 core 子集 72 + 处置后新模块 140;批次1 总数 78 含 Cordis lifecycle 6 项,不在本目录) |
| 静态红线扫描 | grep(fetch/axios/http/key/env/require) | 无命中 |
| 工作树/锁文件/禁改区 | `git status --porcelain` | 审查时仅 6 个未跟踪目录;处置后 **工作树干净(0 变更)** |

---

## 7. 处置路径决策(用户裁决)

审查后给出三路建议(A 分支化合规 / B 轻量收编 / C 先补审计),**用户否决机械选择 A/B/C**,裁决采用**路径 D**:

> 保留现有实现,**先修正契约语义**,再**按目录拆成 3 个独立提交**(不伪造并行分支历史),随后主 Agent 改 `src/index.ts` 统一导出,报告充当 Wave 0 记录。

执行结果见 §9;原 A/B/C 提案保留为历史参考。

---

## 8. 剩余风险(更新至处置后)

1. ~~#1 虚构文献结论语义(`unverified`+redLine vs `blocked`)~~ → **已关闭**:修正为直接 `blocked` + CITATION_CODE_NOT_FOUND,见 §9.1 P1-2。
2. ~~mock fixture 使用真实刊物名~~ → **已关闭**:全部替换为合成名,见 §9.1-F。
3. 未提交实现缺少与 Q1 测试矩阵(批次2 §2 Q1 项)的系统比对——矩阵尚未产出,**是 Wave 1 剩余工作**(下一步:Q1 差距分析)。
4. 路径 D 以目录限定提交替代 per-agent 分支:无逐 Agent commit hash 交付;归属审计依赖提交消息与目录边界,较分支化弱——**已由用户接受**,审计时以"模块归属 = 提交边界"为准。
5. gates 对 `engine/state-machine.ts` 的错误基类依赖(仅错误类):已记录,长期移入中立 `engine/errors.ts`(非阻塞,随 Wave 1/2 处置)。

---

## 9. 路径 D 处置执行记录(2026-09-03,用户批准后执行)

### 9.1 契约语义修正(5 项 P1/P2 → 提交 `96ff257`,contracts.ts only)

| # | 级别 | 修正内容 | 落地方式 |
|---|---|---|---|
| P1-1 | P1 | `L0Tier` 移除 `abstained`,tier 与裁决状态分离 | 新增 `L0ClassificationStatus = 'classified' \| 'abstained' \| 'failed'`;`L0Classification` 增 `status`;l0/routing 返回 `{tier, status}` 二元组;adapter 抛错→`failed`,数据不足/冲突→`abstained`,未知类型→`classified+tier unknown` |
| P1-2 | P1 | 虚构文献不得返回 `unverified+redLine`,必须直接 `blocked`;resolver 区分事实原因 | resolver 输出判别联合 `resolved/not_found/temporarily_unavailable/ambiguous`;not_found→`blocked`+redLine+CITATION_CODE_NOT_FOUND;outage/ambiguous→`unverified`(无 redLine);删除 CITATION_CODE_FABRICATED,新增 NOT_FOUND/_TEMPORARILY_UNAVAILABLE/_AMBIGUOUS |
| P1-3 | P1 | Gate→状态机映射冻结,禁止 `abstained→passed`,禁止外部自由解释 | contracts 增 `StateMachineGateIntent` + `GATE_OUTCOME_TO_INTENT`(Object.freeze 运行时冻结);gates 增 `gateToStateMachineIntent()` 唯一解释点;契约测试覆盖表冻结/总函数/端到端 |
| P1-4 | P1 | 同族降权不得隐含硬编码常量,全部纯配置;未校准→abstain | gates A 门 `sameFamilyDownweight` 缺省/非有限→abstained(UNDEFINED_THRESHOLD),无任何硬编码权重;既有 59 项测试含未校准弃权用例 |
| P2-5 | P2 | 错误基类依赖风险记录 | contracts.ts 分层错误注释 + gates 头注释声明"仅取 ResearchError 基类",长期移入中立 errors 模块;非阻塞 |

另:F 类清理 —— mock 真实刊物名(Nature/Science/NeurIPS 等)全部替换为合成名;删除 4 个模块级 tsconfig + 2 个 tsbuildinfo(§5 D-4/D-5)。

### 9.2 路径限定提交(收编现有实现,不伪造并行分支)

| 顺序 | commit | 内容 | 路径限定 |
|---|---|---|---|
| 1 | `96ff257` | 契约语义修正(§9.1,5 项 P1/P2) | `src/contracts.ts` |
| 2 | `e4bcb1b` | T07 L0 routing(实现+测试 4 文件,1019 行) | `src/l0/` `tests/l0/` |
| 3 | `c4d41e8` | T08 citation verification(7 文件,1373 行) | `src/citation/` `tests/citation/` |
| 4 | `73a8055` | T09 gates adjudication + 冻结映射(2 文件,1136 行) | `src/gates/` `tests/gates/` |
| 5 | `346198d` | 主 Agent 统一 `src/index.ts` 导出三模块稳定公共 API | `src/index.ts` |

提交链:`613521f(冻结) → 96ff257(契约修正) → e4bcb1b(T07) → c4d41e8(T08) → 73a8055(T09) → 346198d(主入口)`,每步 `git add` 限定目录;lefthook pre-commit(lint/whitespace/vendor-guard)全程通过;**最终工作树干净(0 变更)**。

### 9.3 处置后验证证据

- core `tsc --noEmit`:exit 0。
- 全量 vitest:`6 文件 / 212 用例全绿` —— state-machine 53 + host 19(批次1 core 子集 72)+ routing 42 + verify 29 + red-line 10 + gates 59(新模块 140)。
- 表述更正:批次1 **core 子集 = 72 项**;批次1 **总数 = 78 项**(含 Cordis lifecycle 6 项,位于 Cordis 包测试,不在 core 测试目录)。

### 9.4 Wave 0 完成状态

- ✅ 冻结契约修正落地并记录(§9.1)
- ✅ 三模块现有成果按目录收编为独立提交(§9.2)
- ✅ 公共 API 冻结到包面(346198d)
- ✅ 质量产物清理(tsconfig/tsbuildinfo/合成名)
- ✅ 测试 + typecheck 全绿,工作树干净(§9.3)
- ⏭️ **下一步(Wave 1)**:Q1 对现有 212 项做差距分析 → 缺失测试退回模块补充 → 主 Agent 汇合 → 启动 I1(T10-R,Cordis 增量)→ 启动单一 C1 独立审计
- ✅ **Q1 差距分析已执行**(2026-09-03 15:30,见 `plan/batch2-wave1-q1-gap.md`):矩阵覆盖"近乎逐条";补 red-line +2(→214 全绿)、移除契约死旋钮 `requireFalsifiableResult`;静态类移交 C1,I1 验收含 Cordis 消费冻结映射准则
- ✅ **Q1 正式关闭**(2026-09-03,`a4c7dc3`):按用户复核意见补"resolver 零调用"短路测试(vi.fn 抛错 + `not.toHaveBeenCalled()`),真正锁定 #6 先于 resolver 接触短路(core 215 全绿)
- ✅ **I1(T10-R 薄适配)已执行**(2026-09-03,`4d31a40` + `eabc3d2`,见 §9.5):ResearchEngine 增 classifyL0 / verifyCitation / evaluateGate(=adjudicate) / getGateIntent 五个纯委托;结果冻结、零 run 状态、无状态迁移(hold_abstained 契约缺口暂缓自动接线);core 215 + cordis 18 = **233 全绿**,双包 tsc 干净
- ✅ **C1 独立审计已完成**(2026-09-03,见 `plan/batch2-wave1-c1-audit.md`):单一只读 Agent,仅审计新增 adapter diff(`4d31a40`+`eabc3d2`),未重审批次1/整个 core;**判定 PASS、无阻塞发现**(边界诚实:engine/ 与 contracts.ts 零改动;5 委托方法全为单表达式转发;getGateIntent 唯一映射面逐字委托;无 switch/自动转迁/_apply;store 不可达、无 trust 能力外泄)
- **至此 Wave 0 + Q1 + I1 + C1 全链闭合**(提交链见 §9.5;core 215 + cordis 18 = 233 测试全绿)

---

*审查阶段未改动仓库;处置阶段(§9)按用户路径 D 裁决执行,改动全部落入上述 commit。运行产生的唯一副作用:typecheck/tsdown 可能刷新 `.gitignore` 覆盖的 lib/tsbuildinfo,无已跟踪文件变更。*

### 9.5 I1(T10-R 薄适配)执行记录 — 2026-09-03

- **提交** `4d31a40`(core:gates/index.ts + src/index.ts 补 T09 Adjudication* 类型导出面,纯类型变更)+ `eabc3d2`(cordis:src/index.ts 五个纯委托方法 + tests/delegation.spec.ts 12 项)。
- **范围遵循**:薄委托与结果暴露;调用 core 已有函数;返回冻结结果;`getGateIntent` 唯一映射面、逐字委托 `gateToStateMachineIntent`(abstained→hold_abstained,永不为 pass);无 switch(result.outcome)、无自动状态迁移、无 `_apply`、无 store/Map/channel/principal/human-approval 暴露、不复制核心判断、批次1 状态机零改动、未触碰 T12–T19。
- **暂缓项**:gate 计算后自动改变 StepState 未实现 —— `hold_abstained` 无法落入 pending/in_progress/gated/passed/blocked/failed 枚举(真实契约缺口),留待单独设计(候选:保持 gated+记录 abstention / 显式 outcome / 新增 held / abstention 作为独立审计事件),不做临时选择。
- **验证**:core 215 + cordis 18 = 233 vitest 全绿;core/cordis `tsc --noEmit` 均 exit 0;core lib 本地重建(tsdown + tsc d.ts,gitignored 无跟踪 diff)。

---

### 9.6 P2 第一组(T12/T13/T14)落地记录 — 2026-09-03

**用户裁决(本节依据)**:Q1/I1/C1 正式关闭,不再重复审计;`hold_abstained` 定案为组合方案 —— 显式 `outcome:'abstained'` + Step 保持/进入 `gated` + 追加不可变 abstention 审计事件;不新增 `held` 态;Cordis 不自转状态;解除弃权唯一路径 = rollback → 新 attempt → 补证据 → 重新裁决;非 `humanGate` 步骤不得靠人工审批跳过证据门。**本轮只冻结设计、不改批次1状态机**,自动接线留 T19。正式授权 P2 第一组(A12/A13/A14 并行 + H1 只读冻结设计 + Q2 只读测试矩阵),执行约束:独占目录、主 Agent 独占公共 index.ts/注册/package/tsconfig/锁文件、Fixture/Mock-only、T13 委托 T08 禁复制、T14 只构造不宣称支持、artifact-only 不推状态机、无真实密钥、不触碰批次1状态机/Host trust channel/B-PICK/VSDX;汇合后只启动一个独立审计 Agent。

**H1 冻结设计(只读架构 Agent 产出,主 Agent 复核通过)**:`plan/batch2-t19-hold-abstained-design.md` —— GateVerdict 增显式判别 `outcome: GateOutcome('passed'|'blocked'|'failed'|'abstained')`(`passed` 降为写时投影,缺 outcome 的写入在引擎边界即拒);`holdReason?: 'human_gate'|'gate_abstained'`(仅 gated 出现);AuditEventKind 增 'gate-abstention' 存 `GateAbstentionRecord`;六条不变量 → 验收断言(§5 表);审批 guard `DSH_ABSTENTION_REQUIRES_ROLLBACK`(humanGate 无后门);contracts.ts/Cordis 映射面零改动;StepStatus 冻结不加 'held'。**本阶段零实现**,仅作 T19 前置契约。

**P2 工具落地(路径限定提交 ×4,均 lefthook 通过,工作树干净)**:
- `07a1e77` **T12 literature-search**(19 tests):纯 `runLiteratureSearch(query, adapter, timestamp)`;NO-DEFAULT-PASS——adapter outage→`outcome:'unavailable'`(零 hits)永不为空 ok;adapter 恰调一次、抛错原样上抛;合成语料 mock(无许可未确认数据)。
- `528135c` **T13 citation-verify**(6 tests):薄委托壳 `verifyCitationTool(input, deps)`——仅验非空 branded id → 7 参直通 core `verifyCitation` → freezeArtifact;零本地裁决逻辑(#6 红线/虚构 not_found→blocked 等全部在 core),错误透明。
- `d33e424` **T14 claim-construct**(11 tests):`constructClaim`/`runClaimConstruct` 纯构造;`supportStatus` 冻结常量 'not_claimed'(单一赋值路径,永不宣称文献支持);确定性 claimId = `claim-<slug48>-<fnv1a8>`;断言上限 2000。
- `ebed4cf` **集成出口(主 Agent)**:`src/index.ts` 聚合三工具 + shared(`freezeArtifact`/`ToolArtifactMeta`),flat `export *`(无跨模块名冲突);**刻意不引入 T19 注册表**(meta.toolId/version 自描述,注册形状归 T19 设计);新增 `tests/entry/public-surface.spec.ts` 入口锁定 7 tests(稳定 id/版本常量、三 id 互异、identity 断言 entry 导出 === 工具模块同一实例、端到端深冻结)。

**验证**:tools/core/cordis 三包 `tsc --noEmit` exit 0;**全量 vitest 12 文件 276 用例全绿**(core 215 + cordis 18 + tools 43 = 19+6+11+7)。

**Q2(进行中)**:只读 Agent 编写跨工具测试矩阵 → `plan/batch2-q2-tools-test-matrix.md`。

**下一步**:Q2 汇合 → 启动**单一独立审计 Agent**(只审 P2 wave-1 增量 07a1e77..ebed4cf 对冻结约束的合规)→ 汇报状态表。

### 9.7 P2 第一组收口(审计 + 覆盖门禁修复)— 2026-09-03

- **Q2 跨工具测试矩阵**(只读 Agent):`plan/batch2-q2-tools-test-matrix.md`,52 行(41 覆盖/3 部分/8 缺口),G1–G9 低-中优先、无 P0/P1 语义空洞。
- **C2 独立审计**(单一独立审计 Agent):`plan/batch2-wave1-p2-tools-audit.md` —— 9 条冻结约束全 ✅;43/43 测试 + tsc 独立复验绿;**CONDITIONAL-BLOCKER**:根 vitest 配置 per-file 100% 覆盖门禁全局作用于 research 包(实测 4 个 src 文件 <100%,20 处未覆盖,含 Q2 遗漏的防御分支),该车道 FAIL。
- **收口裁定与修复**(commit `17c77bf`,纯测试 +14 用例 43→57,src 零改动零 v8-ignore):G1 六条 + outcome 非对象、mock 防御 2 条、T13/T14 时钟兜底、claim-construct 五个防御分支 → 四文件 per-file **100/100/100/100**;tsc 三包 clean;全量 **290/290 绿**(core 215 + cordis 18 + tools 57);树 clean。
- **P2 第一组终局:PASS**(审计见 `batch2-wave1-p2-tools-audit.md` §6)。残留非阻断补测债:G2 mock fixture 契约直测、G3 T13 薄委托结构锁、版本字符串一致性、T14 错误风格(§4 obs),记入 Q2 矩阵待后续 wave。
- **下一步**:汇报状态表 → 等待用户授权 P2 第二组(T15 消融 / T16 绘图 / T17 三线表);`hold_abstained` 冻结设计(`plan/batch2-t19-hold-abstained-design.md`)留作 T19 前置契约(临近 T19 再集中改状态机 + 定向审计)。
- **提交链勘误(2026-09-03)**:P2 第一组合计 **6 个提交** —— `b25947e`(scaffold)→ `07a1e77`(T12)→ `528135c`(T13)→ `d33e424`(T14)→ `ebed4cf`(集成出口)→ `17c77bf`(覆盖收口);此前汇报标题"7 个提交"系笔误(表内实列 6 项),特此更正。2026-09-03 用户授权 P2 第二组并行启动(T15 消融 / T16 绘图 / T17 三线表)+ QD 测试债支线(G2/G3,仅改 wave-1 测试);T18、T19/hold_abstained 接线暂不启动。
