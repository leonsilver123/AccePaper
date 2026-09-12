# T20 adapter 层只读依赖侦察报告

> Agent: general-purpose-28 | 只读侦察,零改动 | 仓库根 R=`D:/1/deepseek-harness-master1/deepseek-harness-master`
> 目标: packages/research/dsh-research-team adapter 层(package.json 依赖清单 + 关键 API 签名证据 + SessionEventMap 抄录范例)。

## (a) package.json 依赖建议清单(全部 workspace:^;仿 experimental/agent-team + research-tier 先例)

```jsonc
"dependencies": {
  // 唯一硬运行时依赖: 投影 stateSchema/事件 payload 校验(zod v4,同 agent-team)
  "zod": "^4.4.3"
},
"peerDependencies": {
  "@deepseek-ai/cordis": "workspace:^",                 // Context/Service/ctx.on/effect —— vendor/cordis
  "@deepseek-ai/dsh-agent": "workspace:^",              // ctx.agents + Agent 运行时面 + agent/* 事件 —— packages/core/agent
  "@deepseek-ai/dsh-session": "workspace:^",            // ctx.sessions + Session + SessionEventMap/Id —— packages/core/session
  "@deepseek-ai/dsh-session-projection": "workspace:^", // ctx.sessionProjections.register/stateOf —— packages/session/session-projection
  "@deepseek-ai/dsh-session-persistence": "workspace:^",// ctx.sessionPersistence(cold-resume 读持久化,同 agent-team inject) —— packages/session/session-persistence
  "@deepseek-ai/dsh-subagent": "workspace:^",           // ctx.subagents.startContinuable/drainContinuableChildren —— packages/subagent/subagent
  "@deepseek-ai/dsh-tools": "workspace:^",              // ctx.tools.guard(单一 global guard 注册点) —— packages/core/tools
  "@deepseek-ai/dsh-llm": "workspace:^",                // ContentBlock[](startContinuable request.prompt), MessageId —— packages/llm/llm
  "@deepseek-ai/dsh-brand": "workspace:^"               // 仅当需 brandString 铸 dsh-session 原生 SessionId(agent-team roster.ts:258 用法);可选
},
"devDependencies": {
  // peer 全镜像(否则 tsc --noEmit 无法解析;先例 research-cordis/agent-team),再加 host 集成测试用:
  "@deepseek-ai/dsh-subagent-spawn-in-process": "workspace:^", // provider 'spawn'(fresh)
  "@deepseek-ai/dsh-subagent-fork-in-process": "workspace:^",  // provider 'fork'(继承 lead 前缀)
  ...所有 peer + @types/node + typescript + vitest(现保留)
}
```
T20 不需要 dsh-typert-protocol(无 Remote/浏览器面)、不 import 任何 dsh-experimental-*。注入序(t20-design-spec §0)保持 `['agents','sessions','sessionPersistence','sessionProjections','subagents']`(agent-team index.ts:60);tools/scope 为 root ctx 上另取的现成服务。

## (b) 关键 API 签名级证据(文件:行号,均为包内 src)

| API | 证据 |
|---|---|
| `ctx.sessions` | core/session/src/index.ts:37 `sessions: SessionStore`(declare cordis) |
| `Session.append` | core/session/src/index.ts:668 `append<T extends SessionEventType>(type: T, data: SessionEventMap[T], ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent] : [])`(research/* 非 surface → 无 opts 直接 append) |
| `ctx.sessions.flush` | core/session/src/index.ts:1086 `async flush(session: Session): Promise<boolean>` |
| `ctx.sessions.get` | core/session/src/index.ts:1119 `get(id: SessionId): Session | undefined` |
| journal 用法范例 | experimental/agent-team/src/journal.ts:60-72 `appendAndFlush`(= `root.session.append` 绑定 + `ctx.sessions.flush(root.session)` + onCommit) |
| `Session.ownEvents/header` | core/session/src/index.ts:615 `ownEvents()`;:443 `readonly header: SessionHeader`(header.parentSession types.ts:106);types.ts:17 `SessionId = Branded<'SessionId'>` |
| `ctx.sessionProjections` | session/session-projection/src/index.ts:32 declare;register 重载 :233-252 → 返回 `() => void` disposer;stateOf :319 `stateOf<K>(session, key)` |
| `ProjectionDefinition` | session-projection/src/index.ts:48-93: `{key: K; stateSchema: ZodType<S>; init(header, inheritedEventCount); apply(state, event); stateVersion: number; wire?}`;host-only 需 declare `SessionProjectionStateMap`(types.ts:24 空表) |
| 注册/折叠范例 | experimental/agent-team/src/projection.ts:158-162 declare map;:308-317 `teamProjectionDefinition satisfies ProjectionDefinition<'agentTeam', TeamProjectionState>`(host-only,无 wire) |
| `ctx.agents.get` | core/agent/src/index.ts:577 `get(id: SessionId): Agent | undefined`(:249 class AgentRegistry;:27-29 declare);exact-live 判据用法 agent-team roster.ts:92 `if (this.ctx.agents.get(agent.id) !== agent) return undefined` |
| Agent 形态 | core/agent/src/types.ts:12 `Agent { readonly id: SessionId }`;运行时面(并入 dsh-agent 根) runtime-types.ts:72-82 `options/session/inbox/status/ctx`(:18 `export * from './runtime-types.ts'`) |
| `ctx.subagents.startContinuable` | subagent/subagent/src/index.ts:230 `async startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>`(:136-138 declare) |
| `ContinuableStartSpec` | subagent/subagent/src/continuation.ts:92-110: `{provider: string; label: string; childId?: SessionId; request: Omit<SubagentStartRequest,'label'|'signal'|'outputSchema'>; signal: AbortSignal}`;`:113-118 ContinuableStart {childId: SessionId; messageId: MessageId}` |
| `SubagentStartRequest`(部分) | subagent/subagent/src/types.ts:101+: 必填 `prompt: ContentBlock[]`、`parent: Agent`;另有 agentOptions/outputSchema/depthLimit/toolFilter |
| 真实调用范例 | experimental/agent-team/src/roster.ts:281-290 `startContinuable({childId, provider: request.provider, label: description, request: { prompt, parent: root }, signal})`;teardown :241 `drainContinuableChildren(root, childIds)`(subagent index.ts:324) |
| 事件订阅 | `agent/session-start` 声明 runtime-types.ts:224 payload `{agent; source}`;订阅范例 agent-team index.ts:111 `ctx.on('agent/session-start', ({agent}) => …)`;`agent/created` 声明 runtime-types.ts:166 payload `{agent}`,emit core/agent/src/index.ts:555;`agent/status` :185;`session/event`(session,event) 声明 core/session/src/index.ts:74,订阅 agent-team index.ts:110 |
| guard 注册 | core/tools/src/index.ts:129-131 `tools: ToolRuntime`;:1101 `guard(guard: ToolGuard): () => void`;:704 `ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined`;ToolExecutionInput :307-318(name :314, arguments: unknown :316, agent?: Agent :318) |

## (c) SessionEventMap declare 范例(可直接抄;来自真实包 agent-team types.ts:220-236,含 import 前置)

```ts
// import type { Branded } from '@deepseek-ai/dsh-brand'
// import type { SessionId } from '@deepseek-ai/dsh-session/types'
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole teammate lifecycle value, stored only in the Team Lead Session. */
    'team/member': { version: 1; teamId: TeamId; member: TeamMemberSnapshot }
    /** Whole shared-task value, stored only in the Team Lead Session. */
    'team/task': { version: 1; teamId: TeamId; task: TeamTaskSnapshot }
  }
}
```
SessionEventMap 宿主开放声明: core/session/src/types.ts:259(merge 式),`:366 SessionEventType = keyof SessionEventMap`。research-team 用同一模式以 `'research/member' | 'research/task' | 'research/rev'` 注入;声明文件放 src/session-events.ts 且必须被 index.ts 引用以使 declare 进入产物 .d.ts。

## (d) 风险

- **P0**: 无阻塞项。adapter 仅依赖稳定层(dsh-* core/session/subagent/projection/tools),仓库零改动成立。
- **P1-1 品牌摩擦**: 纯层 types.ts:24/27/30 的私有 unique-symbol 品牌 `TeamId/SessionId` 与 `dsh-session` 的 `Branded<'SessionId'>`(dsh-brand 共享符号)结构互斥;`ctx.sessions.get(id)`、`startContinuable({childId})`、`stateOf(session,…)`、append payload 在边界需显式桥接(adapter 内 `toHostId`/cast),否则 tsc 报错。
- **P1-2 投影缓存契约**: 注册进 `sessionProjections` 的 state 须 plain JSON + `stateSchema: ZodType`;纯层 TeamState 已 structuredClone 冻结(plain),但 zod schema `.strict().parse` 返回非冻结对象,fold 自持不可变语义的单元测试边界需对齐 `stateOf` 返回"live、勿改"契约(projection index.ts:313-314)。
- **P1-3 事件 augmentation 可见性**: session-events.ts 的 `declare module` 仅在编译图含该文件时生效;append 调用文件必须 import session-events(或经 index)使 `'research/*'` 出现在 `SessionEventMap`,否则 `append('research/member', data)` 类型失败。
- **P2-1**: provider 名字 'spawn'/'fork' 是宿主侧安装 dsh-subagent-*-in-process 的配置(默认值),team 包只传 provider 字符串,不 import 它们——仅测试需要 → 放 devDeps。
- **P2-2**: 若无需 peer mailbox/浏览器端,不要引入 dsh-typert-protocol/dsh-experimental-*;Config 若不需要 schemastery 可省(agent-team 用它仅为了 Service Config 声明)。
