# T19-B 实施规格(2026-09-08,主 Agent 定稿,范围冻结 per 用户裁决三)

> 目标:把当前「1 真工具 + 15 Fixture」提升为「尽可能多已实现工具真实接入 + 剩余 Fixture」,
> 生成 T19-A/T19-B 对比报告。不得只靠注册表存在声称调用——每条真实执行路径须有可审计证据。

## 0. 放置决策(主 Agent 定)
- registry/runner 放 **dsh-research-team/src/runner/**(team 是顶层逻辑层,已依赖 core(本轮)/tools(peer),无环)。
- 新 E2E 放 **dsh-research-team/tests/e2e/**;tools/tests/e2e 旧版保留为 T19-A 基准不动。
- team/src/index.ts 聚合 runner 导出(主 Agent 管);package.json/tsconfig 如需增 dep 由主 Agent 改。

## 1. 执行器注册表(正式 registry)
新 `team/src/runner/registry.ts`:
```ts
export type Truthfulness = 'real_tool' | 'fixture' | 'mock_external'
export interface StepExecutorEntry {
  stepId: string
  kind: Truthfulness          // 工具函数真执行=real_tool(无论数据源 mock);确定性合成=fixture;真实工具但数据源为外部 mock 适配器=mock_external
  producer: string            // e.g. 'literature-search@0.1.2-alpha.4' 或 'fixture:landscape'
  executor: (ctx: ExecCtx) => Promise<Record<string, unknown>> | Record<string, unknown>
}
export const STEP_EXECUTOR_REGISTRY: ReadonlyMap<string, StepExecutorEntry>
```
- 约束:kind 标注与实现一致;fixture 显式;不改 core gate;不自动批 E2;不加 StepStatus;保持 rollback/new attempt/timeout/error/artifact 原子性(复用 core runStep)。

## 2. 16 步真实接入映射(逐步目标;最终表以实测证据更新)
| 步 | 真实执行器 | kind | 说明 |
|---|---|---|---|
| A1-landscape | `runLiteratureSearch`(mock adapter 数据,合成文献) | mock_external | 检索函数真实执行,数据源 mock;若其 adapter 为纯合成则亦可记 mock_external |
| A2-claim | `constructClaim` | real_tool | 真函数产出 claim artifact |
| A3-agenda | Fixture | fixture | 尚无真实工具 |
| A4-venue | Fixture | fixture | |
| B1-method | Fixture(方法推导文本) | fixture | |
| B2-data | Fixture | fixture | |
| B3-baseline | `runAblation`(fixture/mock 测量) | mock_external | ablation 真函数,executor 注入 fixture |
| C1-mvp | Fixture | fixture | |
| C2-trinity-loop | Fixture executor + 真裁决链(见 §3) | fixture(执行)+ 真 gate | 执行 fixture;gate 判定走真实 adjudicate/judge/experiment |
| C3-boundary | Fixture | fixture | |
| D1-figure-map | `renderFigure` | real_tool | 已有 |
| D2-framework | Fixture | fixture | |
| D3-writing | Fixture | fixture | |
| D4-rebuttal | Fixture | fixture | |
| E1-format | `renderThreeLineTable`?若语义对应则接;否则 Fixture | 视映射 | three-line-table 用于表格 artifact;E1 格式步如无表格语义用 fixture |
| E2-submit | humanGate(停) | — | 不自动过 |

> 真实接入必须每个有「证据」:artifact 中 producer 字段(见 §4)与 registry 断言;spec 中断言对应步 status=passed 且 artifact.producer 含工具 id。

## 3. 裁决链(不复制 core gate;复用)
- 步 gate 判定统一走 core `submitGateVerdict`(单裁决源)。
- verdict 构造:
  - C 通道组件:`adjudicateClaimSupport`(team/experiment,support.ts),report 取自 mock-fixture 表(fixture.ts;kind=mock_external)→ outcome → submitGateVerdict。
  - A 通道组件:`judgeRound`(team/redteam/judge.ts):由 fixture votes(带 expectedRoles 完整 round)构造 RebuttalRound→judgeRound→verdict→submitGateVerdict。fixture round 显式标注。
  - B 通道组件:core `adjudicate`(component 'B')+ verifications 来自 T23 anchor fixture(若 T23 已合入使用之,否则引用 team/anchor fixture 存根并标注 mock_external;未实现前 B 判定 abstain→step 卡 → 需 T23 先于 happy 通过。**安排:T23 于 T19-B 验收前合入,或用本地 anchor fixture 常量(team/anchor/fixture.ts 由 T23 轨道提供)**。
  - 无 gate 步(如部分步):completeStep(仅非 humanGate);E2 empty humanGate → gated 停。
- abstained 永不转 passed;rollback-only 解除。

## 4. 真实性标记输出
- runner 返回每步 `{ stepId, status, attemptId, producer, kind, artifacts:[{slug, producedBy}] }`;reports 与 registry 断言可核对。
- 输出文件:e2e-out-t19b/run-snapshot-{happy,recovery}.json + e2e-report-t19b.md(仓库外 .workbuddy/tmp)。

## 5. 事件(裁决三.4)
- research/verdict、research/experiment 事件类型与 session-events declare + 写入 audit(经 core appendAuditEvent 或 team journal 方式)——**接线为 Lead 层可选**:若实现成本高,降级为 runner 在每个 verdict 处调用 core `appendAuditEvent` 追加 `gate-verdict`/`step-executed`(已有)与自定义 detail(含 verdict),并在报告记录;完整事件化可记 T19-C。**本规格默认采用 appendAuditEvent detail 追加**,不引入未接线事件类型。

## 6. 两条 E2E(重跑,在 team/tests/e2e)
- happy-path-t19b.spec.ts:全 16 步至 E2 gated;断言每真实接入步 producer/kind;确定性(两次字节一致,去 ts)。
- recovery-t19b.spec.ts:abstain(引文证据不足→gate_abstained)→rollback→补证据→re-pass;executor throw;timeout;最终 E2 gated。
- 对比报告 t19a-vs-t19b.md:真实接入步数 T19-A(1)vs T19-B(N)、每步 kind、artifacts 差异、gate/audit 差异、失败/abstain/rollback 契约保持。

## 7. 禁止
复制 core gate/不重解释 outcome/不加状态/不自动批 E2/不把 mock 当真实(报告注明)/不新增第三方依赖/不改 tools 与 core src(只允许 team/src/runner + team/tests/e2e + team/src/index 聚合 + 若需 team package/tsconfig 由主 Agent 改)。禁 commit(主 Agent 提交)。TDD:先红(registry 断言)→实现→绿。

## 8. 验收
- team 全量 + research 全量绿(770+新增);tsc team 0;oxlint team 新文件 0。
- 报告列真实执行器与证据;凡 registry 声明 real_tool/mock_external 的步必须断言 producer/artifact 证据。
