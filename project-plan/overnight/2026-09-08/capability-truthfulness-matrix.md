# Capability truthfulness matrix(S11,2026-09-08 晨间基线)

可信等级:L0 文档/空骨架 · L1 纯函数+单测 · L2 Mock 集成 · L3 本地运行时 · L4 真实外部系统 · L5 Golden Set/专家 · L6 生产

| 任务/模块 | 源码 | 单测 | 集成/E2E | 16步E2E内 | Fixture/Mock | 真实运行 | 真实模型 | GoldenSet | 人工验收 | 可信等级 |
|---|---|---|---|---|---|---|---|---|---|---|
| core 状态机(16 步 API/hold_abstained) | ✅ | ✅ | ✅ | ✅ | 部分 | vitest 本地 | — | — | — | L2 |
| pipeline.runStep | ✅ | ✅ | ✅ | ✅ | — | vitest 本地 | — | — | — | L2 |
| L0/引文/gate A·B·C(core) | ✅ | ✅ | ⚠️(单包) | 部分(gate 经 verdict) | 是 | vitest 本地 | — | — | — | L2 |
| 6 科研工具(T12-T17) | ✅ | ✅ | ⚠️ | D1 figure 真入 E2E | 部分 mock 数据 | vitest 本地 | — | — | — | L2 |
| red-team rebuttal 状态机(T21) | ✅ | ✅ | — | — | 是(mock 轮) | vitest 本地 | ❌ 无真实对抗 | — | — | L1 |
| judge vote(T22,本轮) | ✅ | ✅ | — | — | 判定消费 core | vitest 本地 | ❌ | — | — | L1 |
| experiment 裁决(T24,本轮) | ✅ | ✅ | — | — | mock-fixture 表 | vitest 本地 | ❌ | — | — | L1 |
| 16 步 Mock 纵向闭环(T19-A E2E) | ✅ | ✅(spec) | ✅ | ✅ | 15 fixture+1 真工具 | vitest 本地跑通 | — | — | — | L2 |
| 抽象裁决/外部锚(T23) | ❌ | — | — | — | — | — | — | — | — | L0 |
| roadmap/T18 | ❌(计划) | — | — | — | — | — | — | — | — | L0 |
| web/T26-T29 | ❌(计划) | — | — | — | — | — | — | — | — | L0 |
| T02 真实网关 / T33 真实模型 | ❌ 阻塞 | — | — | — | — | — | ❌ | — | — | L0 |
| Golden Set | ❌ 骨架未建(计划 S5) | — | — | — | — | — | — | — | — | L0 |
| 科研有效性(claim 为真等) | — | — | — | — | — | — | — | — | — | 未开始 |

**明确声明**:758 个测试均为纯逻辑/unit/mock-集成,对应 L1-L2;不得视作 L4+。16 步 E2E 含 1 个真实工具调用(figure 渲染),其余 15 步 Fixture——"跑通"= 编排正确性,不构成科研有效性证据。

## API surface diff 初稿(7ce683b → aa85f32,第五项裁决-1;权威 diff 由审计-5 出具)
- dsh-research-core index ADDED: GateOutcome / HoldReason / GateAbstentionRecord(3 类型;T19 hold_abstained 冻结设计 §3 要求;无删除、无 renamed export)。
- dsh-research-tools index ADDED: export * from './tools/roadmap'(T18:renderRoadmap/validateRoadmap/topoLayers/RoadmapGraph 等)。
- dsh-research-cordis / dsh-research-team index:0 顶层变化(T22/T24 纯逻辑未聚合至 index,记录:待 T19-B 决定是否聚合)。
- 类型成员增量(不改变 index 顶层、但属公共类型面):core AuditEventKind +'step-executed'/'gate-abstention';StepState/StepSnapshot +outputs;StepExecutedRecord;GateVerdict.outcome+holdReason 等。冻结核心映射(contracts GATE_OUTCOME_TO_INTENT、StepStatus 六态)零变化。
- 注:工具函数/team judge 等在模块层 export(经 tools/team 内部 index 而非顶层),最终清单以审计-5 的权威 diff 为准。
