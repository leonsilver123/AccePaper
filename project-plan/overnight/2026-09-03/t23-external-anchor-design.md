# T23 设计规格：B 外部锚集成（L0 文献/SOTA/复现，P3.4）

> Agent: general-purpose-36 ｜ 2026-09-04 ｜ 只读；仓库零改动，纯文档。依据：WBS 05:105、`01_fact_baseline` A2(151-159)/A10(231-240)/冲突 3(266-269)、core gate B(`dsh-research-core/src/gates/index.ts:433` adjudicateB)、T12 `dsh-research-tools/src/tools/literature-search/{adapter,mock,index}.ts`、core l0 mock 模式、`t22-t24-design-spec.md`(T24 ExperimentReport/fixture 风格)、`t21-redteam-design.md` §1(注入纪律)。本文件是唯一规格，≤90 行。

## 0. 复用基线（冻结，改动 0）
- core gate B 已实现且语义=citation 身份链锚（VerificationResult，originalTextAccessed+supported/partially_supported→pass、#6 红线→blocked、无锚→abstain）。**本模块不重写 gate B、不改 contracts**；L0/SOTA/复现三类锚不是引文验证，故在 team 侧产出**外部信号**（供裁决参考），而非塞进 core B 的 verifications 输入伪造引文形状。
- 硬约束：A2「外部信号必要非充分」（有锚≠通过，缺锚≠必定失败，需与 A/C 通道及 L4 人审合判）；A10「复现成功≠结论正确」；D16 未确认许可数据零使用；DEC-005 阈值/裁决纪律沿 T22/T24。
- 注入纪律（T21 §1 同源）：外部数据只经注入 adapter 进入纯逻辑；本波 fixture 全部标注 Mock-verified，禁真实网络/库/模型。

## (a) 目标与输入/输出
- 目标：对 claim（附 L0 文献引用、SOTA/baseline 对照声明、可复现声明）给出**支持/反对/无信息**外部信号，供 T22 judge 及 B-gated 判断点（steps.ts 中 gate 含 'B' 的 claim 级收敛点 C2）作参考证据，绝不作充分证明。
- 输入 = `AnchorRequest { claimRef; predictionRef?; litQuery?; sotaCompare?: { claimedScore; metric; dataset? }; reproPredictionRef? }` + 注入的 3 个 fixture adapter + timestamp。
- 输出（每条信号）`AnchorSignal`：`{ claimRef; anchorType:'literature'|'sota'|'repro'; verdict:'support'|'contradict'|'inconclusive'; evidenceRef(锚 id/引用); detail; evidenceGrade:'mock-verified'; ruleVersion; timestamp }`。

## (b) 三类锚 Fixture 形态（全部合成 + Mock-verified）
- **文献锚 = 合成语料（复用 T12 mock 模式）**：`literature.ts` 持自有合成语料表（venue 形如 "Synthetic Journal A"，syn- 前缀 id，10.1000/synth-* 测试 DOI——禁止真实/许可未确认 venue 数据）；行带合成 venueTier(tier1..3)。可检索性核验走 T12 同款 adapter 契约（结构镜像 tools adapter，不 import 其实现）；**立场判定不靠检索存在性**——须命中 stance 表 `claimRef|predictionRef → { syn-hit-id; stance:support|contradict }` 且命中文献 tier1/tier2 才计入 usable，tier3/unknown/未命中→inconclusive（检索到≠支持本 claim）。
- **SOTA 锚 = 合成基准表**：`sota.ts` 持 `SyntheticBench v1` 表 `{ method; dataset; metric; sotaScore; licenseNote:'synthetic' }`；纯比较函数 `compareSota(claimedScore, row, margin)`：claimed ≥ sotaScore+margin→support；claimed < sotaScore→contradict；表缺行/缺 metric/margin 缺省→inconclusive。
- **复现锚 = mock 实验执行（复用 T24 experiment fixture）**：`repro.ts` 复用 T24 `ExperimentReport` 契约（source:'mock-fixture' 必带 fixtureId/version、detail 非空、拒收仅 exitCode 原始进程记录）；fixture 按 `predictionRef` 查表 `{ supportsPrediction; detail }`→supportsPrediction=true→support、false→contradict、未命中→inconclusive。语义=「外部方在合成语料中复现该结果」，非运行成功即支持（A10）。

## (c) 信号语义（外部一致≠claim 正确）
- 每信号：`{anchorType, verdict, evidenceRef}` 三元组（另带 grade/version/detail）；三类同域同语汇。聚合器产出 `ExternalAnchorOpinion { claimRef; opinion:'support'|'contradict'|'inconclusive'; tally:{support;contradict;inconclusive}; evidenceRefs[]; summary }`。
- 语义锁：`support`=存在可用合成外部证据与 claim 一致（**必要非充分**：绝不单独放行，也不升级 mock）；`contradict`=可用证据与 claim 不一致（阻断性，claim 不得仅凭此继续推进——须 rework 或 L4）；`inconclusive`=无可用信号（缺锚/全 tier3/表缺行/复现未命中）→ NO DEFAULT PASS，绝不自动 support。聚合规则确定性：任一 contradict 且其可用→contradict；否则任一 support→support；否则 inconclusive。opinion 与单信号都不含「claim 为真/假」断言。
- 供 T22 judge 参考方式：judge 纯函数签名不变（A 通道 votes 聚合）；锚意见经 adapter 作为**旁路参考证据**与 judge 裁决并列落审计，供 B-gated 判断点（C2）判定是否可推进——`opinion=contradict` 时 B 通道不满足（blocked 语义）；`support/inconclusive` 本身不产生 pass（pass 仍须 gate 各通道按冻结映射 + 已校准阈值/人审）。

## (d) 模块划分（纯逻辑 + adapter）
```
dsh-research-team/src/anchor/
  types.ts        # AnchorSignal/AnchorRequest/ExternalAnchorOpinion/3×Adapter 契约/错误后缀(ANCHOR_INVALID_ADAPTER/ANCHOR_UNKNOWN_KEY)
  literature.ts   # evaluateLiterature: adapter.search + stance/tier 过滤 → LiteratureAnchorSignal   ← 纯(注入 adapter)
  sota.ts         # compareSota + evaluateSota(查表) → SotaAnchorSignal                              ← 纯
  repro.ts        # evaluateRepro: 复用 ExperimentReport 校验 + fixture 查表 → ReproAnchorSignal       ← 纯
  aggregate.ts    # aggregateSignals(...) → ExternalAnchorOpinion                                    ← 纯(可单测)
  orchestrator.ts # evaluateAnchors()=依序调 3 锚 + journal 落 'research/anchor'(Lead-only)           ← adapter
  index.ts        # 纯导出 + adapter 接线导出(仿 redteam/orchestrator 模式)                           ← 仅接线
```
- fixture 静态导出 `createMockLiteratureAdapter`/`createMockSotaAdapter`/`createMockReproAdapter`，ruleVersion 缺省 `anchor-fixture-v1`/`synthetic-bench-v1`/`repro-fixture-v1`；实例深冻结、确定性、无状态（仿 tools/citation mock）。纯逻辑只 import core types + 兄弟纯模块，不 import 工具实现/host。
- 与 T22 衔接：`research/anchor` 事件携带 opinion + 单信号列表；T22 `research/verdict` 事件独立存在；B-gated 点的 adapter 裁决逻辑读两者并集（judge 不解释、anchor 不裁决，仅 signal）。

## (e) 验收清单
纯逻辑 vitest（无 host）：文献锚 stance 命中+tier1/2→support/contradict、tier3/未知/未命中→inconclusive、检索空语料→inconclusive 非 support；SOTA 边界（≥+margin support、<sota contradict、缺行/margin 缺省 inconclusive）；复现锚合法 mock→support/contradict、仅 exitCode 记录→拒收、无 fixtureId→拒收、未命中→inconclusive；聚合 tally+opinion 确定性（含全 inconclusive→inconclusive）；输出深冻结、ruleVersion/evidenceGrade 恒为 mock-verified 系；非法 adapter 输出抛 `DSH_RESEARCH_TEAM_ANCHOR_*`。
Host 集成（mock services 组合，同 T22/T24）：evaluateAnchors 三锚注入、journal 只 Lead 追加 'research/anchor'；B-gated 点 opinion=contradict→不满足 B（blocked 意图）、support 单独不 pass、缺锚→hold；`research/anchor` zod 往返 + 冷恢复可读。

## (f) 明确不做
- 不访问真实文献 API/数据库/网络、不调真实模型、不加载真实 SOTA/venue/L0 数据（D16 许可未确认→零使用）；不做真实 stance 检测/复现执行（只留 adapter 契约与 fixture）。
- 不把「检索到/运行成功/与合成表一致」当作 claim 正确的充分证明（A2/A10）；mock 证据不升级为真实复现（沿 T24 grade 纪律）。
- 不改 core gate B/contracts（T09 冻结）；不重写 T12 工具、不 import tools/cordis 实现；不为 anchor 定义 claim 通过阈值（沿 DEC-005 归 Golden Set）。
- 文献锚的立场数据由 fixture stance 表显式预置——绝不隐含"语料存在=支持"。

## 文件改动清单（实现范围）
- `types.ts`：+AnchorSignal/AnchorRequest/ExternalAnchorOpinion/`ResearchAnchorEvent`(并入 ResearchEvent)；错误后缀 +`ANCHOR_INVALID_ADAPTER`/`ANCHOR_UNKNOWN_KEY`。
- `session-events.ts`：declare module +`research/anchor` schema/校验（镜像 rebuttal/verdict 段）。
- 新 `src/anchor/{types,literature,sota,repro,aggregate,orchestrator,index}.ts` + spec；orchestrator 接线：B-gated 判断点 evaluateAnchors() 落事件、contradict 阻断、support/inconclusive 不单独放行。
- team 包对 `dsh-research-core` workspace 依赖沿用 t22-t24 规格（本模块仅取类型契约）；新增 fixture 均合成、带 version，零真实数据。

## 附：实现前是否需用户裁决
- **建议无**。三项内部默认（可回滚，DEC-004 先例）：① 外部锚定位为纯信号（必要非充分），judge/gate 语义零改动；② 三类 fixture 全 Mock-verified、零真实数据（D16）；③ 新增 `research/anchor` Lead-only durable 事件（镜像 verdict 模式）。无公共 API/产品决策变更。
