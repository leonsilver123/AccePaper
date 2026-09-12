# T22+T24 联合设计规格：judge vote 聚合 与 可证伪实验裁决（P3.3/P3.5）

> Agent: general-purpose-36 ｜ 2026-09-04 ｜ 只读侦察；仓库零改动，纯文档。依据：T21 实现 `dsh-research-team/src/redteam/{personas,fleet-config,rebuttal,orchestrator}` + `session-events.ts`、T09 core `gates/index.ts` 与 `contracts.ts`(AdjudicationVote:239/FalsifiablePrediction:248)、`t21-redteam-design.md`、decisions.md DEC-001..005、WBS 05:104/106、steps.ts gate 分配(A2=['A','C']/B1=['A','C']/C1/C2=['A','B','C']/C3=['C'])、06_test_acceptance INV-SM-5。本文件是唯一规格，≤130 行。

## 0. 复用基线（冻结，改动 0）
- A 通道计数/同族降权/阈值/弃权语义**已全部实现于 core gate A**（`adjudicate(component:'A')`，config 注入、缺省 abstain、GATE_OUTCOME_TO_INTENT 为唯一出口映射）；C 通道同（`adjudicate(component:'C')`，无 falsifiable→blocked、有预测无结果→abstain）。**T22/T24 不重复计数、不重写判定——消费 core 纯函数**，只在 team 侧做「round 上下文 + 结果语汇」的薄投影。
- T21 已交付：round 状态机（pending→submitted→completed、每 expectedRole 至多一票）+ `adjudicationVotes(round)` 字段契约与 core AdjudicationVote 逐字段对齐；`research/rebuttal` 事件 Lead-only。
- 硬约束：DEC-005（Golden Set/T36 未校准→任何阈值缺省 abstain，不写死 ≥N）、A10（复现成功≠正确）、INV-NO-TRUTH-CLAIM（gate 结果不声称 claim 为真）。

## T22 — judge vote：rebuttal round → 聚合裁决

### (a) 输入/输出
- 输入 = **已 completed 的 RebuttalRound**（roundId/claimRef/gate=判断点/expectedRoles/votes，全角色已投）+ 调用方注入 `AdjudicationConfig` + 调用方注入 `timestamp` + 可选稳定 claimId。绝不接受未完成 round。
- 输出 `ResearchVerdict`：`{ roundId; claimRef; gate; verdict:'keep'|'drop'|'abstain'; outcome:'passed'|'blocked'|'failed'|'abstained'; intent:'pass'|'rework'|'hard_fail'|'hold_abstained'; reasonCode(DSH_GATE_*); summary(聚合理由); abstentionReason?; voteTally?; sameFamilyClusters?; evidenceRefs; timestamp }`。
- 判定=**core `adjudicate` 结果的一次无歧义投影**：passed→keep、failed→drop、blocked→abstain、abstained→abstain；`intent` 经 `gateToStateMachineIntent` 携带，下游动作（rework/hold/human）由 adapter 按此 intent 执行，judge 不解释。

### (b) 阈值策略（不写死）
- judge 自身**零常量**。`keep 的 N`（=core `minValidVotes`，票数下限）与支持比例（=`passThreshold`∈[0,1]）全部是 core `AdjudicationConfig` 字段，由 host 校准源（T36 Golden Set）注入；team 侧不定义默认值。
- 实现路径：pure 函数把 config 原样透传 core；config 缺省/`{}`/非有限 → core 返回 `DSH_GATE_UNDEFINED_THRESHOLD` abstained → judge 必 abstain。任一途径都不存在"无配置也能过"。

### (c) 弃权/不一致/缺席
- 全部 abstain：core deciding=0 → abstained(INSUFFICIENT_EVIDENCE)；judge abstain，summary 聚合各 abstain rationale + abstentionReason。
- 平票/两方均未达 passT：core → blocked(AMBIGUOUS_CONVERGENCE) → judge abstain（对齐 WBS「不一致弃权」；adapter 依 intent 'rework' 处理）。
- 同族簇：core 检测+降权+上报；有效票被蚀至 <minValid → abstained(CORRELATED_ROLE_OPINIONS)。judge 原样透出 sameFamilyClusters，绝不把同族描述成真异质。
- 部分角色缺席：round 停在 submitted（allRolesVoted=false），**不得进 judge**——orchestrator 在 submitRebuttal 处即不 close；超时缺席记 audit 后 claim 保持 gated（no default pass）。judge 入口防御性校验 `status==='completed' && allRolesVoted`，违者抛 `DSH_RESEARCH_TEAM_JUDGE_ROUND_INCOMPLETE`。

### (d) 纯逻辑划分 + 验收清单
- 新纯模块 `src/redteam/judge.ts`：`judgeRound(round: RebuttalRound, config: AdjudicationConfig, timestamp: number, claimId?: string): ResearchVerdict`——构造 core `AdjudicationInput`（votes 取 `adjudicationVotes(round)`；claimId=claimId ?? claimRef 转 core ClaimId，仅类型收窄不伪造新 id）→ `adjudicate` → 投影映射 + 确定性 summary（按 cast 序 `role[position]: rationale`）。可脱离 host 单测（core gates 纯函数）。
- 纯逻辑验收：未完成 round 拒绝；`{}`/非有限 config → abstain 且无默认 pass；支持票达标 config → keep、反驳达标 → drop、平票 → abstain、全 abstain → abstain；sameFamilyClusters/abstentionReason/voteTally 透出；summary 确定性（同输入同串）；返回深度冻结。

## T24 — C 可证伪 → 实验裁决（claim 支持度）

### (a) 输入/输出
- 输入 = `{ claimRef; prediction?: { text; ref? }; report?: ExperimentReport; timestamp }`。`ExperimentReport`：`{ source:'live'|'mock-fixture'; supportsPrediction: boolean; detail(非空,可审计); fixtureId?/fixtureVersion?（mock 必填）; evaluator?（live 必填=host 注入求值器名）}`。
- 输出 `ClaimSupportRecord`：`{ claimRef; predictionRef?; verdict:'supported'|'refuted'|'undetermined'; outcome:'passed'|'failed'|'blocked'|'abstained'; evidenceGrade:'live-verified'|'mock-verified'|'unverified'; reasonCode; summary; fixtureId?; fixtureVersion?; timestamp }`。
- **不得「运行成功=实验支持」**：`supportsPrediction` 只允许来自两类被授权来源——(1) mock-fixture 查找表；(2) live 路径的 host `evaluator`（把观测值对照 prediction 语义判定的独立求值器）。纯模块**拒收**原始进程记录（如仅 `exitCode/status:0`）——结构上 `INVALID_EXPERIMENT` 抛错，绝不静默转 abstain/pass。verdict 语义=「该可证伪预测获本次实验支持/被证伪/无法判定」，不声称 claim 为真（A10/NO-TRUTH-CLAIM）。

### (b) 与 T20 成员 / T22 judge 的衔接（claim 在哪个 gate 触发）
- claim 由 T20 成员产出/修订（rev kind='claim'）；一个**带 C-gate 的判断点**（steps.ts：A2/B1 的 ['A','C']、C1/C2/C3 的 ['C']）退出前须先跑其 C 通道裁决（INV-SM-5）。顺序：T21 rebuttal round 完成 → T22 judge(A 通道,仅 C2 等含 A 的点) → T24 C 通道裁决 → 依各通道 outcome+intent 决定 step 是否可退出；A/B 阶段真实实验尚不存在时，T24 仅接受 fixture 或 abstain。
- 事件落 audit：Lead 以唯一写者追加 `research/experiment`（每条=一次 claim 支持度裁决），judge 追加 `research/verdict`；均镜像 `research/rebuttal`（只写 Lead log、不进对话面、不折叠进 TeamState）。

### (c) Fixture 边界（mock 注入）
- 真实实验不可用（未接线 code-runtime / 无真实数据）→ 纯 `mock-fixture` 查找表：key=`claimRef|predictionRef` → `{supportsPrediction, detail}`，ruleVersion 默认 `'fixture-mock-v1'`；未命中 key=无报告=abstain（untested，fail-closed）。命中即 `evidenceGrade:'mock-verified'`，fixtureId/version 落记录。
- **mock 不升级**：evidenceGrade='mock-verified' 的 supported 仅供内部对抗自检/CI，下游不得视作真实复现；稿件终态（真实提交/E2 面）不得仅凭 mock 通过——由 adapter 检查 grade 拦截。

### (d) 纯逻辑划分 + 验收清单
- 新纯目录 `src/experiment/`：`support.ts`（`adjudicateClaimSupport(input): ClaimSupportRecord`：缺 prediction→blocked/undetermined；有预测无报告→abstain/undetermined；report 结构非法→抛 INVALID_EXPERIMENT；合法→构造 core `FalsifiablePrediction{experimentResult}` 调 `adjudicate('C')`→passed=supported/failed=refuted/else undetermined）+ `fixture.ts`（确定性 mock 表，仿 citation fixture：深克隆、无状态、版本可审计）。可脱离 host 单测。
- 验收：空预测 blocked；预测无报告 abstain（不默认 pass）；mock 命中 supportsPrediction=true/false → supported/refuted 且 grade=mock-verified；`{exitCode:0}` 原样进程记录 → INVALID_EXPERIMENT 拒收；live 无 evaluator → 拒收；mock 无 fixtureId → 拒收；事件 zod 往返校验。

### (e) 明确不做
- 不调真实模型、不运行真实外部实验/不实现 live evaluator 本体（只留契约与必填校验）；不把工具 run success 当证据；不写死任何支持度阈值；不实现 B 外部锚（T23）；不改 core gates/contracts（T09 冻结）；不 import P2 工具实现（T14/T15 只作为 falsifiable/观测的生产者）。

## 文件改动清单（实现范围，git 恢复后执行）
- `types.ts`：+`ResearchVerdict`/`ResearchVerdictEvent`、+`ClaimSupportRecord`/`ExperimentReport`/`ResearchExperimentEvent` 并入 ResearchEvent 联合；错误后缀 +`JUDGE_ROUND_INCOMPLETE`/`INVALID_EXPERIMENT`。
- `session-events.ts`：declare module +`research/verdict`、`research/experiment` 两事件 schema/校验（镜像 rebuttal 段）。
- `package.json`+`tsconfig.json`：team 包新增 workspace 依赖 `@deepseek-ai/dsh-research-core`（dep+devDep，仿 dsh-research-cordis 先例）+ project reference。
- 新 `src/redteam/judge.ts`、`src/experiment/{support,fixture}.ts` + 对应 spec；orchestrator/index 仅作 Lead 接线：submitRebuttal close 后 judgeRound(...) 追加 verdict、C 点跑 adjudicateClaimSupport 追加 experiment。
- 新增 error 引用仅出现在 team 内部（code 前缀 `DSH_RESEARCH_TEAM_*`），不触碰 core。

## 附：实现前是否还需用户裁决
- **建议无**。三项均为内部设计参数且可回滚（DEC-004 先例）：① 复用 core gate A/C、不重复计数；② 新增两个 durable 事件 `research/verdict`+`research/experiment`（镜像 rebuttal 模式）；③ team 包新增对 dsh-research-core 的 workspace 依赖（cordis/tools 已有先例）。阈值与 mock 判定语义均沿冻结契约，无公共 API/产品决策变更。
