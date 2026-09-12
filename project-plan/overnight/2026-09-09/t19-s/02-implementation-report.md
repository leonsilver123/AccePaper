# T19-S 实现与验证报告(02)

commit: `fd99f3a`(master,单写入者主 Agent)
时间: 2026-09-09 上午轮次
关联: `01-canonical-matrix.md`(TO-BE 定稿,逐条落地)

## 落地核对(对照 01 matrix)
- [x] B3-baseline 去 ablation: 执行器改 fixture,产物 `baseline-results`(baseline.identity=fixed-time, preRegistered 10.0s)+ `sota-comparison`(anchoring='none');**无** ranRuns/counts/aggregate 消融字段
- [x] C3-boundary 接入真实 `runAblation`(producer=ablation@0.1.2-alpha.4)→ ablation-results + boundary-map
- [x] D1-figure-map 三图家族接线: renderFigure + renderThreeLineTable + renderRoadmap 真实执行;figure-plan.figures 三种 kind + 各自 render 证据
- [x] E1-format 装配语义: formatted-manuscript 含标题/venue/章节正文/三线表/reproducible files;E2E 断言 manuscript.length > tableMarkdown.length(步骤>能力)
- [x] ARTIFACT_TYPE_BY_SLUG['baseline-results'] = 'baseline-measurement-set'
- [x] C1 mvp-results 与 C 闸门同源(同一 experiment fixture 行;reductionRate 0.091 与 fixture 文本 9.1% 一致)
- [x] D2 outline → D3 draft → D4 revised-draft → E1 manuscript 同一章节骨架传递(section ids 相等,E2E 断言)
- [x] 新增 SCENARIO 单一数字源 + STEP_CAPABILITIES(tool→step 能力表,wired/wired:false 如实)
- [x] A3/A4/B1/B2/D2 等 fixture 业务成形;producer 全以 fixture: 前缀如实

## 测试与质量闸门
| 门禁 | 结果 |
|---|---|
| runner-registry.spec.ts | 43/43(新增 C1 fail-closed 分支、B3 非消融语义、C3 真实聚合、E1 装配断言) |
| happy-path-t19b.spec.ts | 25/25(新增 T19-S business-artifact describe: A2→B3→C1→C3→D1→D2..E1→E2 逐步断言) |
| recovery-t19b.spec.ts | 13/13(新 executors 下 core 契约不弱化) |
| team 包全量 | 324/324(15 files) |
| tsc --noEmit | exit 0 |
| oxlint | 0 warnings / 0 errors |

## 诚实性红线(自检)
- 全仓 grep 无把 synthetic fixture 表述为真实科研验证/真实模型运行/真实投稿的注释与输出;E1/B3/C3/D1 产物 note 均含 synthetic/fixture/NOT real 字样。
- 报告计数(真实构成) = real 5(A1/A2/C3/D1/E1)/ fixture 10 / live 0 / humanGate 1;B3 不再是"假真实工具"。

## 独立审计结论(T19-S,只读审计 Agent,2026-09-09 上午)

**总裁定: 条件通过(CONDITIONAL PASS);无 P0 / 无 P1 / P2×2(已闭环)。**

审计逐焦点复核结论(独立取 文件:行号 证据):
- executor↔canonical 语义 **PASS**: B3 无 runAblation 调用(registry.ts:631)、C3 真实 runAblation(760)、D1 三工具真渲染(793–878)、E1 装配而非渲染表(1005–1079)、baseline-results 类型(309)。
- artifact 依赖 **PASS**: C1 与 verdictC 同用 `experimentFixtureKey`+`lookupExperimentFixture` 同一 fixture 行;D2→D3→D4→E1 同 section ids。
- 数字链 **PASS**: SCENARIO 0.091 = (10.0−9.09)/10.0 与 fixture "9.1%" 逐字一致。
- 测试质量 **PASS**: 断言绑定具体 slug/字段/数值,未发现"怎么改都过"的宽松断言。
- 诚实性 **PASS**: team 包无把 synthetic 表述为真实科研验证的注释/输出。
- 回归 **部分 PASS**: 324/324、tsc 0;oxlint 非 0(本轮引入 1 处,已在 98d3db4 清理)。

### P2 闭环记录
| id | 问题 | 处置 | 提交 |
|---|---|---|---|
| P2-1 | `verdictC` 在 experiment fixture 未命中时回退 `supportsPrediction:true`(fail-open),与 C1 执行器 `throw`(fail-closed)不对称 | `verdict.ts` 改为未命中即弃权(无报告 ⇒ abstained ⇒ core 保持 gate_abstained);新增 `tests/verdict-fail-closed.spec.ts` 双测(未命中→abstained 且不含 exp-fixture-synthetic 兜底;命中→passed) | `98d3db4` |
| P2-2 | 本轮引入 1 处 `no-unnecessary-type-assertion`(`recovery-t19b.spec.ts:97` `better[0]!`);上一提交信息"oxlint 0"表述过宽 | 删除多余断言;更正措辞并诚实登记包内存量 | `98d3db4` |
| P2-3(观察) | B3-SOTA 能力 `wired:false` 本波缺位,依赖 T23 外部锚在 B 闸门补全;`anchoring='none'` 已如实声明 | 接受现状;接真实文献工具时转 wired:true | — |

### 诚实更正
- 上一提交(fd99f3a)信息中"oxlint 0"仅覆盖当时受检的 3 个文件。team 包 `oxlint` 实际仍有 **15 处**存量错误,全部位于 `tests/projection.spec.ts`(13)与 `tests/host-integration.spec.ts`(2),**非 T19-S 引入**,列 P3 存量待办。
- 审计后基线: team 包 **326/326**,tsc exit 0,本轮改动文件 oxlint 0。

## 遗留(后续任务)
- 独立审计(Task #12)第二项: core API(c98e648)只读审计进行中,回传后归档。
- 七工具 DSH 注册(Task #13): 本步 executors 仍直接 import 工具函数;`defineTool` + `ctx.tools.register` 走 pre-execute/guard/execute/post-execute/result 流水线为下一任务,须等两项审计均通过后实施。

