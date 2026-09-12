# T19-S — Canonical 16-Step Semantic Reconciliation Matrix

日期: 2026-09-09(凌晨轮次) · 状态: 实现前定稿(TO-BE)
业务定义唯一权威: `plan/final_execution_plan.md` A1~E2 canonical 16 步(含 DAG 与 B3-SOTA 子任务) + `dsh-research-core/src/engine/steps.ts`(与计划逐字一致)。
对照对象: `dsh-research-team/src/runner/registry.ts`(T19-B 实现)。

## 0. 用户裁定的两类问题(结论)

1. **晨报失真(报告问题)**: §7/§8 所写的 `keyword-normalize`/`derive-direction` 等"Fixture 步骤名"
   在代码中不存在 —— 属晨报誊写错误。核心 `steps.ts` 的 16 个 stepId(A1-landscape…E2-submit)与
   plan 逐字一致。→ 修晨报,不是修代码。
2. **真实语义错位(代码问题,本文件处理)**:
   - B3-baseline 的执行器调用 `runAblation` —— 消融是 **C3-boundary** 的能力,不是 baseline 的能力。
     canonical DAG 明确 B3 含 "B3-SOTA 检索子任务",baseline 是"建立 baseline 并对照 SOTA"。
   - E1-format 的执行器 = `renderThreeLineTable` —— 工具**替代**了步骤;E1 的产物应是
     "按目标期刊格式化的可投手稿 + 可复现包",三线表只是其表格子能力。
   - D2-framework / C3-boundary 是空 fixture,而 roadmap(路线图)/ablation(消融)工具闲置未接线。
   - `ARTIFACT_TYPE_BY_SLUG['baseline-results'] = 'ablation-measurement-set'` —— 错贴消融类型。

## 1. 16 步语义矩阵(TO-BE)

图例: 执行器真实性 4 级:R=real_tool_fixture_input · F=fixture_executor · M=mock_external · L=live_external(恒 0)。

| # | stepId(canonical) | canonical 业务语义 | 执行器(修复后) | kind | 主工具能力(serving step) | 关键产物形状(业务) |
|---|---|---|---|---|---|---|
| 1 | A1-landscape | 扫领域、识缺口 | a1Executor(现,保留) | R | literature-search | landscape-map{hits,outcome} + gap-list |
| 2 | A2-claim | 构造可证伪 claim | a2Executor(现,保留) | R | claim-construct | claim + falsifiable-prediction{text} |
| 3 | A3-agenda | 贡献清单+议程 | a3Executor(新:F,业务成形) | F | — | agenda{phases} + contribution-list |
| 4 | A4-venue | 选刊/scope 匹配 | a4Executor(新:F,业务成形) | F | — | venue{name,id} + venue-scope |
| 5 | B1-method | claim→方法+可测预测 | b1Executor(新:F,业务成形) | F | — | method-spec{methodId} + method-predictions |
| 6 | B2-data | 数据+画像+provenance | b2Executor(新:F,业务成形) | F | — | dataset{datasetId} + data-profile |
| 7 | B3-baseline | **建 baseline 并对照 SOTA**(B3-SOTA 检索子任务) | b3Executor(**改**:去掉 ablation) | F | literature-search(B3-SOTA 子任务,本轮 off-domain 无可锚定→gap) | baseline-results{baseline.identity=fixed-time, preRegistered 10.0s,**无 ablation 字段**} + sota-comparison |
| 8 | C1-mvp | 最小实验裁决核心预测 | c1Executor(**改**:读同一 experiment fixture) | F | —(实验运行时未接) | mvp-results{supportsPrediction,detail,reductionRate 0.091} |
| 9 | C2-trinity-loop | 三合一收敛 | c2Executor(新:F,dossier 成形) | F | gate A/B/C = 真实三通道(verdict.ts) | converged-verdict{baselineRef,experimentRef} |
| 10 | C3-boundary | **探边界/消融** | c3Executor(**改**:ablation 从 B3 迁入) | R | **ablation** | ablation-results{ranRuns,counts,aggregate} + boundary-map |
| 11 | D1-figure-map | 结果→图表映射(数据图/**三线表**/**路线图**) | d1Executor(**改**:三种图表能力全接线) | R | figure + three-line-table + roadmap | figure-plan{figures:[data-figure|three-line-table|roadmap]} |
| 12 | D2-framework | 论文框架/大纲 | d2Executor(新:F,大纲成形) | F | —(无 outline/roadmap 工具接入,roadmap 归 D1) | paper-outline{sections[{id,heading,covers}]} |
| 13 | D3-writing | 起草章节+参考文献(L0) | d3Executor(**改**:依 outline 成稿) | F | — | draft{sections:同 outline ids, bodyText} + references |
| 14 | D4-rebuttal | 对抗 rebuttal→修订稿 | d4Executor(**改**:读 draft 产 rebuttal+修订) | F | — | rebuttal{roundId,challenges/defenses} + revised-draft{sections} |
| 15 | E1-format | **按期刊格式化(版式/引用样式)** | e1Executor(**改**:装配可投手稿+可复现包) | R | three-line-table(表格子能力,非步骤本体) | formatted-manuscript{manuscript(headings+正文+表), sectionHeadings, tableMarkdown, bindingHash, reproduciblePackage.files} |
| 16 | E2-submit | 投稿(人的行为) | noExecutor(现,保留) | F/humanGate | — | 无产物,completeStep→gated |

## 2. 工具→步骤能力映射(用户 §二 要求的重新表述)

> 工具是"步骤能力",不是步骤本身;任何工具产物都不等于它服务的步骤的交付物。

| 工具(toolId@ver) | 服务的步骤 | 在该步骤的角色 | 本轮接线 |
|---|---|---|---|
| literature-search@0.1.2-alpha.4 | A1-landscape | 版图文献检索 | wired(A1) |
| | B3-baseline | B3-SOTA 检索子任务(canonical 子任务) | **gap**: mock 语料 off-domain(交通领域无 SOTA 可检索)→ B3 定级 fixture,如实声明 |
| citation-verify@0.1.0 | 三合一 B 闸门 / B3-SOTA 锚定 | 外部锚定证据链 | B 闸门 wired(mock_external, T23 anchor);B3 步骤侧本轮不接线(同 gap) |
| claim-construct@0.1.2-alpha.4 | A2-claim | claim+可证伪预测构造 | wired(A2) |
| ablation@0.1.2-alpha.4 | C3-boundary | 变体 vs baseline 消融测量 | wired(C3,自 B3 迁入) |
| figure@0.1.2-alpha.4 | D1-figure-map | 数据图渲染 | wired(D1) |
| three-line-table@0.1.2-alpha.4 | D1-figure-map | 三线表图渲染 | wired(D1) |
| | E1-format | 手稿结果表(子能力) | wired(E1,嵌入装配) |
| roadmap@0.1.2-alpha.4 | D1-figure-map | 路线图渲染 | wired(D1) |
| | D2-framework | (可选)框架路线图 | 本轮不接线(无工具承载大纲写作) |

## 3. 执行器真实性构成(修复前后)

- 修复前 real=5: A1, A2, **B3(ablation,语义错)**, D1, **E1(三线表=步骤,错)**
- 修复后 real=5: A1, A2, **C3(ablation,语义对)**, D1(三种图表能力), **E1(装配+三线表子能力)**
- fixture=10(A3,A4,B1,B2,**B3**,C1,C2,D2,D3,D4);live_external=0;humanGate(E2)=1。计数不变,成员随语义对调。

## 4. artifact 类型修正

- `'baseline-results'`: `ablation-measurement-set`(错)→ `baseline-measurement-set`(对)
- `'ablation-results'`: 维持 `ablation-measurement-set`(C3 正确持有)

## 5. E2E 增强点(happy/recovery)

由"只断状态转移 + producer 品牌"增强为**逐步骤业务 artifact 断言**:
A1 版图形状 → A2 预测文本==canonical → B3 baseline.identity==fixed-time **且无 aggregate/counts(回归:不再消融)**
→ C1 supportsPrediction==true 且 reductionRate==0.091(与 experiment fixture 9.1% 一致)
→ C3 ablation-results.ranRuns>0(消融确实在 C3)→ D1 figure-plan.kinds==[data-figure,three-line-table,roadmap]
→ D2 outline.sections 覆盖写作骨架 → D3 draft.sections ids==outline ids → D4 revised-draft 非空
→ E1 manuscript 含 outline 标题 + venue 名 + 三线表行(Adaptive/Fixed-time),且 manuscript 长度 > table(证明 E1>表,步骤>能力)
→ E2 gated 不变。

## 6. 不做的事(边界)
- 不新增 stepId/StepStatus/状态机改动(core 不动)。
- 不改 C 闸门裁决源(仍为 experiment fixture;但 C1 产物改由**同一 fixture** 派生,artifact 与 gate 证据同源)。
- 不接真实网关/不建 tag/不降 Coverage 阈值。
- DSH `defineTool` 注册是 T19-S **之后**的独立任务(Task #13),本步只做语义映射与接线。
