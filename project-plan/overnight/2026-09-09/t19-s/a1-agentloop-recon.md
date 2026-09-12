# A1 侦察 — Agent Loop 最小闭环装配证据(Phase 3)

来源: packages/core/agent-loop/tests/tool-calls.spec.ts(确定性装配配方) +
packages/core/tools(ToolRuntime)。

## 真实装配顺序(全部真实宿主服务,非伪造)

```
ctx.plugin(LlmRuntime)                       // @deepseek-ai/dsh-llm
ctx.plugin(SessionStore)                     // @deepseek-ai/dsh-session
ctx.plugin(SessionProjectionRegistry)        // @deepseek-ai/dsh-session-projection
ctx.plugin(SystemPrompt, { persona: '' })    // @deepseek-ai/dsh-system-prompt
ctx.plugin(ToolRuntime)                      // @deepseek-ai/dsh-tools
ctx.plugin(AgentRegistry)                    // @deepseek-ai/dsh-agent
ctx.plugin(AgentLoop, { agents: [] })        // @deepseek-ai/dsh-agent-loop
ctx.llm.registerAdapter(['mock'], adapter)   // MockAdapter(确定性 LLM)
agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
→ waitForIdle(ctx, agent)                    // agent/status === 'idle'
```

## 时序(真实)

MockAdapter 第一轮返回 assistant tool-call 块(tool-call id/name/args JSON)→ AgentLoop
调度 → ToolRuntime 铸造 execution(prepare)→ guard→ dispatch/execute(业务 fn)→
finalize→finish → tool 结果入 session events;第二轮 textResponse 结束轮次。

## 结论(AgentLoopResearchToolInvoker 可行性)

- model_ready 工具经真实 agent-loop 铸造可完整执行(链可观测);
- pipeline_only 若被模型调用 → guard(本插件注册,一律拒)→ 无业务执行;可作为
  “不可执行 + 零业务调用”证据;
- 不需要伪造 Agent / 深度私有方法;直接沿用上装配即可;
- timeout/abort: ToolRuntime timeoutMs + AbortSignal(宿主 API,不修改);
- 宿主包解析: 本仓库内已安装(core/tools/agent/agent-loop/llm/session/
  session-projection 等),在 research-cordis 测试侧加 node_modules junction 供
  vitest 运行时解析(诊断性,非正式证据);正式解析由 workspace lockfile 保证。

## 边界记录

- pipeline_only 仍 ARCH-BLOCK-01(无受控内部入口):仅 agent-loop(真实 Agent)可达,
  而 guard 拒之;DirectInvoker 覆盖内部 fixture 路径。
