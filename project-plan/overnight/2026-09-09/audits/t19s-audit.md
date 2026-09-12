# T19-S 独立审计报告(只读审计 Agent)

审计对象: commit `fd99f3a`(canonical 16 步语义对齐),diff = `registry.ts`(+944)、`tests/e2e/happy-path-t19b.spec.ts`(+110)、`tests/runner-registry.spec.ts`(+82)
权威: `plan/final_execution_plan.md` §13 DAG(345–374 行)+ core `src/engine/steps.ts`
性质: 只读审计,未修改文件。P2 项由主 Agent 闭环于 commit `98d3db4`。

## 逐焦点 verdict

| 焦点 | 裁定 | 关键证据 |
|---|---|---|
| 1.1 B3 不再调 runAblation | PASS | `registry.ts:631` b3Executor 无 runAblation;产物仅 baseline/preRegistered/beatsBaselineWhen/note;note 明示 "ablation measurements are NOT part of baseline (they belong to C3-boundary)";`STEP_CAPABILITIES['B3-baseline']` literature-search `wired:false` + off-domain note |
| 1.2 C3 真实 runAblation | PASS | `registry.ts:760` 调 `runAblation(ABLATION_DEFINITION, createMockAblationExecutor(), FIXED_TS)`;producer=ablation@0.1.2-alpha.4 |
| 1.3 D1 三图家族 | PASS | `registry.ts:793–878` renderFigure+renderThreeLineTable+renderRoadmap 真实执行;figures 三项各带真渲染证据;与 core `steps.ts:114` purpose "结果→图表映射(数据图/三线表/路线图)" 对应 |
| 1.4 E1 装配而非渲染表 | PASS | `registry.ts:1005–1079` 读 venue/venue-scope/revised-draft,三线表为子能力;note "the tool is E1's table capability, not the format step itself";断言 manuscript.length > tableMarkdown.length |
| 1.5 artifact 类型 | PASS | `registry.ts:309` baseline-results = 'baseline-measurement-set' |
| 2.1 C1 与 C 闸门同源 | PASS(+P2-1) | `c1Executor`(registry.ts:682)与 `verdictC`(verdict.ts:167)同用 experimentFixtureKey+lookupExperimentFixture;但 verdictC 未命中时回退 supportsPrediction:true,与 C1 throw 不对称 |
| 2.2 D2→D3→D4→E1 骨架 | PASS | outline.sections ids(abstract/introduction/method/experiments/results/conclusion/references)→ draft.sections 镜像 → revised-draft 同 ids → manuscript 含各 heading |
| 3 数字链一致 | PASS | SCENARIO 0.091 = (10.0−9.09)/10.0,与 fixture "9.1% mean delay reduction"(`experiment/fixture.ts:29`)逐字一致 |
| 4 测试质量 | PASS | 断言绑定具体 slug/字段/数值(B3 无消融字段、C1 9.1%、C3 ranRuns>0、D1 三图、E1 manuscript>table);未发现宽松断言;recovery 仍验 core 契约 |
| 5 诚实性 | PASS | team 包无把 synthetic 表述为真实科研验证的注释/输出;仅命中 redteam/personas.ts:81–82(角色要求挑战数据真实性,合法)与 report.ts:234(否定句) |
| 6 回归 | 部分 PASS(+P2-2) | 324/324;tsc 0;oxlint src 0,但 tests 16 errors(本轮引入 1 处 `recovery-t19b.spec.ts:97`) |

## P2 问题表与处置

| id | 项 | 证据 | 处置 |
|----|----|----|----|
| P2-1 | C 闸门 fail-open 回退与 C1 fail-closed 不对称 | verdict.ts:178–183 vs registry.ts:684 | `98d3db4`: verdictC 未命中即弃权(无报告 ⇒ abstained ⇒ core 保持 gate_abstained);新增 `tests/verdict-fail-closed.spec.ts`(2 测试) |
| P2-2 | 本轮引入 1 处 `no-unnecessary-type-assertion`;提交信息"oxlint 0"过宽 | recovery-t19b.spec.ts:97 | `98d3db4`: 删除多余 `!`;更正措辞并登记包内存量 |
| P2-3 | B3-SOTA 能力 wired:false(本波缺位,依赖 T23 在 B 闸门补锚) | registry.ts:1306 / 657–673 | 观察项: 接真实文献工具时转 wired:true |

## 总裁定: 条件通过(CONDITIONAL PASS)

T19-S 真实消除了 executor↔canonical 语义错位(B3↔C3 消融职责归位、D1 三图、E1 装配、artifact 类型与数字链一致),测试由状态迁移升级为业务 artifact 断言,未引入不诚实表述;全量通过。两项 P2 不阻塞语义对齐,已闭环。core API(c98e648)独立审计另行归档。

## 审计后基线(主 Agent 复核,commit 98d3db4)
team 包 **326/326**;tsc exit 0;本轮改动文件 oxlint 0;包内存量 15 处(projection.spec.ts 13 + host-integration.spec.ts 2)非本轮引入 → P3。
