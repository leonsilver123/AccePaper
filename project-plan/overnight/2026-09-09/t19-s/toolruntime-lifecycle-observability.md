# ToolRuntime 生命周期可观测性证据(Phase 3 part B)

审计 agentloop-closed-loop.spec.ts 与 agentloop-invoker.spec.ts 在真实 AgentLoop 链上
对七工具(经 research-cordis 注册)逐项判定。规则: 可观测则给断言证据;宿主 API 无法
从会话事件观察的 hook 标 **Not observable** 并给出源码锚,禁止伪造断言。

## 可观测(有真实断言证据)

| 项 | 证据 |
|---|---|
| model_ready 经真实 ToolRuntime 全链执行 | agentloop-closed-loop.spec.ts: tool/result isError:false,JSON 产物 meta.toolId='three-line-table';agentloop-invoker.spec.ts 同(经 invoker 返回 artifact) |
| guard 先于业务、拒绝时 execute 为零 | closed-loop: pipeline_only(literature-search) 被模型调用 → tool/result 为错误文案,不可 JSON.parse 成 artifact,无 bindingHash;guard 返回前业务函数不执行 |
| schema 拒绝时业务为零 | input-schema.spec 'schema failure means ZERO business-function calls'(executeResearchTool 校验先行);invoker/agentloop 均先 validate |
| execute/exactly-once(会话事件层) | 单 tool-call → 单 tool/result(tool-calls 事件 seq 一一对应);closed-loop 无重复 tool/result |
| unload 后不可调用 | tools-hardening: RESEARCH_TOOL_UNLOADED(stale def.execute 拒)+ 跨实例句柄拒 |
| AgentLoop 悬挂/超时(harness 层) | agent-loop-invoker runThroughAgentLoop 15s idle 超时兜底(可观测: 超时→ok:false RESEARCH_TOOL_AGENTLOOP_FAILED,代码内) |

## Not observable(宿主不向插件暴露,附源码锚)

| hook | 判定 | 源码锚 |
|---|---|---|
| prepare 阶段单点 | Not observable(不产生会话事件;为内部 scheduled stage) | packages/core/tools/src/index.ts:790 `prepare: exec => this.prepareScheduledExecution(exec)`;1450 private |
| dispatch/execute 分界 | Not observable(事件面只有 tool/call 与 tool/result) | agent-loop/src/tool-calls.ts:264/282 append('tool/call')/append('tool/result');tools index.ts:1340 dispatchScheduledExecution 内部 |
| finalize/finish 分界 | Not observable(同上;finalize/finish 为 definition-owned 内容 finalize,无会话事件) | tools index.ts:450/452 公共方法仅 scheduler 内部调用 |
| 真 10s timeout 触达 | Not observable(七工具纯同步渲染,执行体不可能悬挂到 timeoutMs=10_000;host timeout 路径属 ToolRuntime,对同步 fn 不触发) | tools.ts definition timeoutMs:10_000;render 纯同步 |
| abort/cancel 取消中产物 | Not observable(无悬挂业务 fn 可取消;AgentLoop 侧 cancel 走宿主,本插件无异步体) | agent-loop-invoker stream abort 检查存在但本工具同步完成 |

结论: 可观测面已断言(成功链、guard 零执行、schema 零执行、unload 拒、exactly-once);
内部 staged hook 分界与真超时对同步纯渲染工具不可达 —— 标注 Not observable + 证据,
不伪造。真实超时/取消的插件级验证需引入会悬挂的工具(host 能力),记 decision-needed D3。
