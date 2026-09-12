# Task #13 设计注记 — 七工具 DSH `defineTool` + `ctx.tools.register` 注册

状态: **未做**(t13-tools-reg 429 残稿于 2026-09-09 12:3x 回退;本文为下次实现的精确规格)。

## 背景
- 16 步 registry(`packages/research/dsh-research-team/src/runner/registry.ts`)中真实工具执行器
  (a1-literature-search / a2-claim-construct / c3-ablation / d1-figure / e1-three-line-table)
  直接 import 并同步调用 `dsh-research-tools` 的工具函数(带 fixture 适配器/固定时间戳)。
- 现状经 T19-S 语义对齐后是**绿且经审计**的(core 审计 P1-1/P2-2/P2-3 已闭)。
- STEP_CAPABILITIES(registry.ts 导出)是工具→步骤能力映射的真源;预期 7 工具:
  literature-search / claim-construct / ablation / figure / three-line-table / baseline /
  sota-comparison(其中 sota-comparison 标记 wired:false 为 off-domain 诚实缺口,须核实)。

## 目标(本次实现的验收)
把七工具经 cordis `defineTool`(签名见 `packages/core/tools/src/schema.ts` + `index.ts`,
范式见 `packages/extensions/tool-cordis`/`packages/skill/tool-skill`)注册进 DSH 工具注册面
(`ctx.tools.register`),使工具的**注册入口**成为真源,agent-loop 可经 ctx.tools 触达;
执行器仍以 fixture/mock 语义产出 artifact。

## t13 残稿失败模式(勿重蹈)
1. **执行器 async 化 = 契约大改**:残稿把 a1/a2/c3/d1 改 `async` 并改道 `callResearchTool`
   分发,但 e1 未转、drive.ts/StepExecutorFn/326 个 team 测试大多同步断言执行器输出 →
   改动扩散到 runner+测试全层。**裁决:执行器契约不动**(注册是加层,不是改执行路径)。
2. **工具入参乱用 JsonValue**:AblationDefinition/RoadmapGraph 等强类型对象塞 JsonValue 入参
   报 TS2345(registry.ts:764/847 类)。工具 input/deps 应使用各自声明类型或 `unknown` 收窄。
3. **半成品文件污染包 tsc**:research-tools.ts 一次性引入 20+ 错(无效 import UserMessage、
   同步 artifact 当 Promise<JsonValue> 返回、未用声明)。新文件须先能独立 tsc 过再接线。

## 正确最小设计(建议)
- 在 `dsh-research-tools` 新增/扩展一个**注册模块**(纯 cordis 无关,或 cordis adapter):
  用 repo 的 `defineTool` 声明 7 工具的 name/description/input-schema/deps + handler,
  handler 内部调现有同步工具函数(或 fixture adapter),维持 4 级真实性标记语义
  (real_tool_fixture_input / fixture_executor / mock_external / live_external 恒 0)。
- 提供 `registerResearchTools(ctx)`(ctx.tools.register 逐个挂载),由
  `dsh-research-cordis` 的 apply 或名册行调用 —— 注意 core/tools 是**纯库非 Cordis 插件**
  (b73a652 已查明无 apply/name),注册入口应放在 cordis adapter 侧而非纯库。
- **执行器不改**:registry.ts 保持同步直调工具函数(那是 T19-S 审计通过的语义);
  若某步希望 agent 调用,再另起 step-capability 桥接,不在本任务扩大。
- 测试: 新增注册面测试(ctx.tools 能解析 7 工具、schema 有效、handler 调用 fixture 产生
  与执行器一致的 artifact 形状);全 research 套件(907)保持绿;tsc/oxlint 0。

## 相关文件
- `packages/research/dsh-research-tools/src/`(工具函数与类型真源)
- `packages/research/dsh-research-team/src/runner/registry.ts`(STEP_CAPABILITIES 只读真源,勿改执行语义)
- `packages/research/dsh-research-cordis/src/`(注册 apply/名册行挂载点)
- 参考: `packages/core/tools/src/{schema,index}.ts`、`packages/extensions/tool-cordis`

## 纪律
单写入者(主 Agent)提交;不 pnpm publish/push;不降覆盖率门禁;无真实网关/密钥。
子通道 429 重置 2026-09-09 15:53:52 UTC+8 后可按本文重派实现 Agent。
