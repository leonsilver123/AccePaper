# T19-A 规格草稿(2026-09-08 夜间侦察产物,待阶段0 关闭后转正式实施计划)

> 依据:batch2-t19-hold-abstained-design.md(冻结契约)+ core state-machine 现有 API + 16 步 STEPS(recon/core)。

## 0. 现状(证据)
- core 状态机已具备完整编排 API:createRun / setRunInput / getRunSnapshot / getArtifact / canStart / startStep / startIfCan / recordArtifact / submitGateVerdict / completeStep / rollback / isComplete / getAuditHistory / _applyHumanApproval(core/src/engine/state-machine.ts)。
- 16 步 STEPS 定义于 core/src/engine/steps.ts;StepStatus 六态 pending/in_progress/gated/passed/blocked/failed。
- 缺口 A(hold_abstained 冻结设计):GateVerdict 现仅 passed:boolean;`_adjudicate` 无 abstained 分支;无 holdReason;AuditEventKind 无 gate-abstention;审批无 gate_abstained guard。→ 触点见冻结设计 §7。
- 缺口 B(执行流水线):pre-execute→guard→execute→post-execute→artifact→result→audit 的编排尚不存在;T12-T17 工具是纯函数/defineTool,未接 run 上下文;16 步尚无 E2E 驱动器。

## 1. 目标(验收可量化)
1. 冻结设计六不变量(§5)全部有断言且绿;humanGate 无后门(§6,DSH_ABSTENTION_REQUIRES_ROLLBACK)。
2. 最小执行管线 API:对某 step 的 execute 支持 executor 注入(timeout/cancel/error/result-once/artifact 校验/audit)。
3. E2E-1 Happy:16 步驱动,真工具(T12-T17 对应的步骤)+Fixture(其余),E2 humanGate 停住;输出 run snapshot/artifact manifest/gate history/audit timeline(JSON+MD)。
4. E2E-2 Abstained/Failure/Recovery:abstained→gated(holdReason=gate_abstained)→下游阻断→rollback→new attempt→补证据→重新裁决→恢复;再造 tool failure/timeout 验证无假成功 artifact;最终到 E2。

## 2. 顺序(契约测试先行,TDD RED→GREEN)
- P1 冻结类型入 core engine types(纯类型+写边界拒绝)+ GateVerdict.outcome 投影;测试先行。
- P2 state-machine 变更:_adjudicate abstained 分支、齐判审计、holdReason、rollback 清 reason、_applyHumanApproval guard(DSH_ABSTENTION_REQUIRES_ROLLBACK);六不变量测试。
- P3 执行器接口(纯):PipelineExecutor 契约 + 守卫(scope/guard)、timeout/cancel/result-once/error-map/artifact 校验。放 core 纯逻辑(可单测)或独立模块,遵循"不复制 core gate 逻辑、不在 cordis 层重解释 outcome"。
- P4 驱动器:run 级 step 循环(顺序+gate)+ 工具/Fixture 路由(真工具/Fixture 显式元数据)。
- P5 两条 E2E fixture+测试+JSON/MD 报告。

## 3. 明确 Fixture/真工具划分(16 步)
| 步 | 类型 | 说明 |
|---|---|---|
| A1 landscape | Fixture | 无检索能力(真实检索=步骤1 未来接 web/L0) |
| A2 claim | 真 claim_construct(T14)/Fixture 混合 | 构造可测;可证伪由 gate 判 |
| A3 agenda | Fixture | |
| A4 venue | Fixture | |
| B1 method | Fixture(推导文本) | |
| B2 data | Fixture(小合成集) | |
| B3 baseline | 真 ablation 框架?→ Fixture | |
| C1 mvp | Fixture executor | |
| C2 trinity | gate 真实裁决 + Fixture 实验 | |
| C3 boundary | Fixture | |
| D1 figure | 真 figure 工具(T16)mock 数据出 SVG/PNG | |
| D2 framework | Fixture | |
| D3 writing | Fixture(mock 章节文本;禁伪称真论文) | |
| D4 rebuttal | Fixture | |
| E1 format | Fixture | |
| E2 submit | humanGate(不可 Agent 自动过) | |

## 4. 非目标/禁止
- 不复制 core gate 逻辑;不在 cordis 重解释 outcome;不加 'held';不伪造真实科研证据;Fixture 全部显式标注;不改 contracts.ts/公共 API 冻结面。

## 5. 里程碑 checkpoint
- P2 结束:core 冻结契约实现+六不变量绿 → checkpoint T19-A-P2
- P5 结束:两 E2E 绿 + 报告落盘 → checkpoint T19-A
