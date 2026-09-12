# decision-needed.md — 待用户裁决或按 fail-closed 记录的决策点

## D1 (2026-09-09, 已按 fail-closed 记录并执行) — pipeline_only 走真实 ToolRuntime 全链

**问题**: 正式内部流水线的 pipeline_only 工具(文献检索/引文核验/claim 构造/消融)
是否必须经过真实 ToolRuntime 的 prepare→guard→dispatch→finalize→finish?

**调查证据**(core/tools/src/index.ts):
- `ToolExecutionInput.agent?: Agent` 注释 "set by the agent loop",槽类型为真实 Agent;
- `dispatchToolBody` 不变式: "only registry-minted executions reach the staged scheduler
  methods"(内部 cancellationStates 按 exec 键控,缺失即抛)→ 任意调用方无法自行驱动全链;
- `dispatchScheduledExecution` 经 `scopeTarget(this, exec.agent)` 解析 scope,需宿主可解析的
  真实 Agent;
- 运行时不向插件暴露: 不可伪造 ScopeKey / 内部 execution handle / 受控 execute API。

**阻断结论**: 在不动宿主(agent-loop/工具运行时)的前提下,插件**无法**让 pipeline_only
工具经真实 ToolRuntime 全链执行。任何自建 "agent-less/runner 标记/字符串身份" 方案均属
可伪造旁路,已否决。

**fail-closed 路径(本阶段执行)**:
1. pipeline_only guard 一律 DENY(含 agent 缺失);schema 对普通 agent 不可见;
2. T19-B 中 pipeline_only 步骤经 DirectResearchToolInvoker(truthfulness=`direct_fixture`),
   **不计入 Runtime-verified**,不构成正式 T30 门禁证据;
3. model_ready(纯渲染三工具)经真实 agent-loop 全链 → `cordis_tool_runtime`,构成 Runtime
   证据;
4. capability 设计(模块私有 WeakSet 对象同一性)已定稿于 t13r-phase11r-design.md §2,待宿主
   开放受控内部入口后激活。

**留待用户/后续**: 是否接受 "pipeline_only 维持 direct_fixture、不 Runtime-verified" 作为
T19 正式口径(推荐),或要求投入宿主 agent-loop 受控内部入口改造(计划外、跨包大改)。

## D2 (2026-09-09) — 动态 import 兼容层 vs 正式 project reference

已按"保留兼容层 + 硬化 + 技术债登记"执行(见 design §6)。正式消除需宿主决定是否调整
tsconfig.base paths(379 项)或为 research 包提供免 paths 的 base;本阶段不擅自改宿主。

## ARCH-BLOCK-01 (2026-09-09) — pipeline_only 无受控 ToolRuntime 入口

**状态**: 已记录的架构阻断项(独立架构任务处理,非本阶段关闭项)。
**表述修正(遵用户裁定)**: 模块私有 WeakSet capability 仅为**预留设计**,它不能自行创建
ToolRuntime 内部认可的 execution(铸造权在 agent-loop 内部 createExecution),**不得表述为
已解决**;AgentLoop 内 model_ready 可验完整链路;pipeline_only 仅 DirectInvoker
(direct_fixture),不计 ToolRuntime-integrated/Runtime-verified/正式 T19 完成。
**红线**: 不得伪造 Agent、调内部私有方法、深度导入内部模块、恢复 agent-less 放行;
不修改宿主 ToolRuntime 公共 API。

## 状态措辞登记(遵用户裁定, 2026-09-09)

- WeakSet capability = 预留方案(非已解决);resolved-capability 表述一律禁止。
- DirectInvoker 不计入 Runtime-verified / 正式 T19 完成度。
