# T13-R Phase 1.1-R — 授权模型与调用链设计(一页)

状态: 2026-09-09 定稿。范围: pipeline_only 授权矛盾、schema 硬化、
注册事务性、可复现性、动态 import 兼容层。实施者/审计者须以此为准。

## 1. 事实证据(ToolRuntime 授权面调查)

- `ToolExecutionInput.agent?: Agent` —— 注释 "set by the agent loop";slot 类型为真实
  Agent,非任意对象。
- 全链路 `prepare→guard→dispatch→finalize→finish` 的 body 侧有**运行时不变式**:
  "only registry-minted executions reach the staged scheduler"(`cancellationStates`
  按 exec 键控,缺失即抛)—— 任意调用方直接调 dispatch 无法绕过。
- `dispatch` 经 `scopeTarget(this, exec.agent)` 解析 scope;agent 槽必须是宿主可解析的
  真实 Agent。
- **不存在**对第三方开放的: 不可伪造 ScopeKey、内部 execution handle、受控 execute API。
  完整链路仅 agent-loop 经内部 `createExecution`(registry 铸造 token)可达 ⇒ 运行时
  自身具备不可伪造属性(执行身份 = 铸造 token + 真实 Agent),但**不向插件开放**。

## 2. 授权模型(pipeline_only 矛盾裁决 — fail-closed)

| 通道 | 是否可走真实 ToolRuntime 全链 | 裁决 |
|---|---|---|
| 外部/伪造/空/复制/缺失 agent | 否(guard 一律拒 + 运行时不铸执行) | **DENY** |
| agent-loop(真实 Agent) | 是(registry 铸造) | model_ready 可执行;pipeline_only 经 guard 拒 |
| 内部正式流水线(pipeline_only) | **当前不可行**(无受控内部入口) | → DirectResearchToolInvoker(truthfulness=`direct_fixture`),**不计 Runtime-verified** |

- guard 规则: `pipeline_only` → 无条件 DENY(不信任任何字段,含 agent 缺失);
  `model_ready` → 放行(仍只在显式 allowlist 授权的 agent scope 可见)。
- 阻断证据与决议见 decision-needed.md #D1: 若要 pipeline_only 走真实全链,需宿主在
  agent-loop 提供受控内部执行入口(计划外,不本阶段改宿主)。
- capability 设计(防后续宿主开放): 模块私有 `WeakSet<object>` 内部 token;guard 仅认
  **对象同一性**(复制/序列化/跨实例均不可入会);不导出、不入 schema、不入 ctx.research。
  本阶段因全链内部入口缺失不激活,随 D1 决议。

## 3. 调用链(T19-B 集成,Phase 2)

```
StepExecutor (registry, T19-B)
   └─ ResearchToolInvoker.invoke(toolId, input, ctx)      // 唯一依赖面
        ├─ DirectResearchToolInvoker   → executeResearchTool(纯适配器)
        │      truthfulness='direct_fixture';仅单元/离线 fixture;不进正式门禁
        └─ CordisResearchToolInvoker   → 真实 ToolRuntime 全链
               (agent-loop Mock Session: prepare→guard→dispatch→finalize→finish)
               truthfulness='cordis_tool_runtime';model_ready 集合可走
```

- 步骤语义与工具能力分离: 7 工具 ≠ 16 步;STEP_CAPABILITIES 只声明能力,不声明步骤。

## 4. Schema 硬化(逐工具严格 JSON Schema)

- `additionalProperties:false`;参数封闭白名单;字符串长度上限;数组元素数上限;
  数值上下界;枚举白名单;路径参数禁绝对路径/`..`/NUL;图表/表格/文献/实验输入
  总尺寸预算(嵌套深度+序列化字节预算);非 JSON-safe 值(undefined/BigInt/函数/
  Buffer)注册与执行两侧拒绝;禁止空 parameters/any/无界 object。边界/超限/穿越/
  深嵌套/大输入测试齐备。

## 5. 注册事务性与生命周期

- 七工具全注册成功才提交,第 N 个失败回滚前 N-1(事务性);
- readiness = **实际注册集合 == 预期七项**(逐个 get 校验),非仅 onReady;
- 重复启动/重复注册/双卸载/失败后重试 → 确定性;
- unload 后旧 ToolDefinition/invoker/disposer 无有效执行能力;
- require=true: 缺 ToolRuntime/少注册/重复 ID/API 版本不兼容 → 启动失败。

## 6. 可复现性与动态 import(工程债)

- package.json/lockfile importer/workspace 路径/exports 一致性校验(脚本化);
- junction 仅为诊断 stand-in,非生产/非验收证据;
- pnpm 恢复后: 无 junction 全新目录 frozen install → build/typecheck/test/pack/
  解包 consumer smoke;完成前该项 = CONDITIONAL;
- 动态 import 兼容层: 固定唯一模块标识;校验 defineTool 及实际使用 API;兼容版本/
  能力集合校验;错误码+诊断消息;missing/wrong-version/missing-field/wrong-type
  测试;pack 解包 smoke;技术债条目(后续 project reference/types adapter 消除)。

## 7. 完成度标尺(每项必须区分)

Implemented / Unit-verified / Runtime-verified / Audit-passed。
测试数量 ≠ 完成度。双审计(P0/P1 返工→定向回归→原审计 Agent 复审)未过不进 T30-R。
