# T20 设计定稿：dsh-research-team 可实现规格（P3.1）

> Agent: general-purpose-22 ｜ 2026-09-03 ｜ 只读；产出实现规格（实现时 package.json/tsconfig/目录路径由主 Agent 独占创建）
> 依据：`t20-ctxsubagents-recon.md`(能力面) + `t20-poc-guard-timing.md`(guard 时序)。本文件是唯一规格，≤120 行。

## 0. 组合约束与全局假设
- 复用稳定层原语（experimental agent-team 同款但**不 import 它**，F-W3/X8）：`ctx.subagents.startContinuable`(subagent/src/index.ts:230) + `SessionEventMap` 扩展(`core/session/src/types.ts:259` 开放 map) + 根 Session log append+`ctx.sessions.flush` + `ctx.sessionProjections.register` 投影折叠。
- 拓扑：root Session = 科研协调 Lead Agent；成员 = durable continuable direct child；提供者用 in-process `spawn`/`fork`（全能力+prepareContinuable，spawn:index.ts:42-61/fork:index.ts:63-84）。
- write-scope 强制 = **单一 global guard**（tools 管线层），持久化 scope 数据 = 根 log 投影。
- Host 须挂（inject 序仿 agent-team index.ts:60，全稳定）：`agents, sessions, sessionPersistence, sessionProjections, subagents`；另用 `tools, scope`。
- 权威身份 = exact-live Agent（`ctx.agents.get(id)` 返回才认）。

## 1. 类型面（导出公共类型）
- `TeamId = Branded<'TeamId'>`，`TeamId(rootSessionId)`（仿 agent-team types.ts:8-17）；`TeamId` = root session id。
- `TeamRole = 'lead' | 'teammate'`；`TeamMemberPhase = 'provisioning' | 'active' | 'failed'`；`TeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'`。
- `ResearchMember { id: SessionId; name: string; description: string; provider: string; context: 'fresh'|'fork'; phase: TeamMemberPhase; error?: string }`。约束：`name` 小写唯一且**永久不重用**（含 failed）；`id` 由 T20 先 `randomUUID()` 保留 → 先落 provisioning 事件 → 再 `startContinuable({childId:id,...})`（仿 agent-team roster.ts:258-290，保跨崩溃 reconciliation）。
- `ResearchMemberView { id; name; role; status: 'running'|'idle'|'inactive'|'provisioning'|'failed'; model?; diagnostics: string[] }`（inactive=存在未加载）。
- `ResearchTask { id: TeamTaskId; revision: number; subject: string; description: string; status: TeamTaskStatus; ownerId?: SessionId; blockedBy: TeamTaskId[]; writeScopes: string[] }`。约束：写前快照不可变；每次变更 `revision+1`；`writeScopes` 为规范化路径前缀（重叠仅告警，CAS 冲突才是硬拒，语义对齐 agent-team task-board）。
- `ResearchTaskAction = 'claim'|'release'|'edit'|'set_dependencies'|'complete'|'reopen'|'reassign'|'delete'`；授权 = lead 或 owner（仿 task-board.ts:126-141）；claim 仅限 pending 且 blockedBy 全 completed。
- `ResearchRev { artifactId: string; revision: number; prevRevision: number; kind: 'file'|'claim'|'section'; path: string; hash?: string }`：CAS 修订记录（对共享 artifact 头部做 compare-and-set 追加）。
- `TeamMutationResult = {ok:true; value} | {ok:false; error:{code:'team-task-conflict'|'team-rejected'; message}}`（stale→conflict，仿 agent-team types.ts:205-213）。
- `ResearchService` 挂 `ctx.agentTeams`（仿 `declare module '@deepseek-ai/cordis'{ Context{ agentTeams: ...}}`）。

## 2. 事件面（SessionEventMap 注入形态）
`declare module '@deepseek-ai/dsh-session/types'`（对齐 agent-team types.ts:220-236）：
```ts
interface SessionEventMap {
  'research/member': { version: 1; teamId: TeamId; member: ResearchMember }   // Lead log 整值快照
  'research/task':   { version: 1; teamId: TeamId; task: ResearchTask }        // 每变更整值快照(revision 内嵌)
  'research/rev':    { version: 1; teamId: TeamId; rev: ResearchRev }          // artifact CAS 修订追加
}
```
- 全部**只写 Lead(root) Session log**；append 走 journal：`root.session.append(type,data)` + `ctx.sessions.flush(root.session)` + onCommit 通知 waiters（仿 agent-team journal.ts:60-72）；事件不进对话面。
- 投影：`ctx.root.sessionProjections.register(teamProjectionDefinition)`（仿 index.ts:117），fold 名 `'researchTeam'`，读路径 = `stateOf(root.session,'researchTeam')`；fold 为纯 reducer（事件序列→TeamState：members/tasks/byArtifact 头部），幂等，可单测。
- 事件类型 payload 校验（version/teamId/必填字段）放 `session-events.ts`，append 前校验（validation.ts 同层）。

## 3. 模块划分（文件树 + 职责 + 依赖方向）
```
dsh-research-team/src/
  types.ts          # 公共类型+brand+TeamId()（§1）           ← 零依赖
  session-events.ts # declare module 注入 + payload 校验        →types
  revision.ts       # 纯 CAS：assertExpectedRevision/applyTaskAction/nextSnapshot/normalizeWriteScopes/overlapOnlyWarn →types（无 ctx，可单测）
  journal.ts        # per-root transact 队列 + appendAndFlush    →types;依赖 ctx(agents/sessions)【薄适配器】
  projection.ts     # fold reducer + TeamState + register(def)   →types,revision
  roster.ts         # membership(agent.id→{root,role,name})/spawn 编排(startContinuable)/name 表 →journal,projection;依赖 ctx.subagents
  task-board.ts     # create/get/list/update(CAS) 走 journal.transact + 授权(owner/lead) →journal,revision
  scope-guard.ts    # ScopeResolver 接口 + 纯判定 decide() + guard 闭包工厂 →types,projection
  index.ts          # TeamService(cordis):inject/Config/agentTeams/registerProjection+guard+生命周期(session/event, agent/session-start, agent/status)→全部【仅接线】
```
依赖方向：**纯逻辑**(types/revision/projection fold/scope 判定)不依赖 host；**适配器**(journal/roster/task-board)依赖 ctx 服务但薄；**index 唯一接线点**。无环。

## 4. global guard 设计
注册（插件 root ctx，一次性，生命周期=插件；plain ctx→global 层，tools/src/index.ts:1101-1107；求值先 global 后 agent 链 :1109-1119）：
```ts
const disposer = ctx.tools.guard(exec => decide(exec, resolver))   // ToolGuard=(exec)=>string|undefined(index.ts:704)
```
执行期判定伪代码（`decide` 为纯函数，注入 `resolver` 以单测）：
```
if (exec.agent === undefined) return undefined                 // host/系统调用放行
m = roster.tryMembership(exec.agent)                           // 含嵌套子代理 lineage→最近成员(走 session.header.parentSession 链)
if (m === undefined) return undefined                          // P-a:非团队 agent 一律放行
if (m.role === 'lead') return undefined                        // 协调者豁免(见裁决 U-A)
if (!SCOPE_CHECKED_TOOLS.has(exec.name)) return `research team member denied tool ${exec.name}: 非 scope 可校验工具`
path = pathArg(exec.arguments)                                 // 解析写路径
if (!resolver.memberMayWrite(m.memberId, exec.name, path)) return `write out of scope for ${m.name}: ${path}`
return undefined
```
- `resolver.memberMayWrite` 读 Lead 根 session 的 `researchTeam` 投影：成员有 `in_progress` 且 `ownerId===成员` 且 `writeScopes` 覆盖 path 的任务 → 放行（覆盖集合为并集，见裁决 U-B）。
- 嵌套 one-shot（red-team 子代理）写操作归最近成员 scope。
- 注册恰一次、进程重启后插件重装即恢复（先于任何成员 resume），无 per-activation 重装问题（t20-poc §c）。

## 5. 验收清单
纯逻辑单测（vitest，无 host）：
- revision.ts：CAS 接受/拒绝 stale revision；claim/release/complete/reassign 授权矩阵（owner vs lead vs 无关者）；claim 仅 ready；writeScopes 规范化+重叠告警；blockedBy 环检测。
- projection fold：事件序列→TeamState 幂等、deleted tombstone、revision 单调。
- scope `decide()`：注入 mock resolver 的 allow/deny 矩阵 + 非团队/lead/host 放行回归（P-a）。
- journal 串行化：mock append+flush，两并发 transact 严格排队。
Host 集成测试（假 services 组合：agents+sessions+持久化 mock+projection+subagents；mock 边界=仿 `packages/subagent/subagent/tests/service.spec.ts:66` 的 `{ctx, subagents: ctx.subagents}`，agent-loop factory 用 mock）：
- spawn：provisioning 事件先行→startContinuable→active 边；name 重用拒绝；失败 reconcile。
- cold-resume 回归（P1 目标）：持久化成员日志→重启组合→resume Lead→global guard 仍生效→越界工具调用被拒。
- CAS 冲突：同 root 并发两个成员 updateTask→一成功一 conflict（per-root 串行化）。
- E2E（T35 后）：16 步流程成员读写全部落在 claim scope。

## 6. 明确不做
- 不改 subagent 包 / continuation 语义 / descriptor 词汇（仓库零改动，禁）。
- 不 import 任何 `@deepseek-ai/dsh-experimental-*`（F-W3/X8）；只参考语义。
- 不 shadow / 包装 `ctx.subagents`（传输层与强制层分离）。
- 不做跨进程/多 host/多租户并发（X4）；guard 只覆盖 tools 管线内调用——非管线旁路写超范围，成员工具面须由 spawn `request.toolFilter` 收窄（工具名级持久且 resume 自动重装，已证实），只保留 research 写/读工具。
- 不实现 P2 工具本体（T12-T18）与状态机（T06）；本包只做 team 协调层。

## 附：裁决请求
- U-A（建议默认）：Lead 是否豁免 write-scope？建议豁免（协调者组装终稿）。
- U-B（建议默认）：成员可同时持有多个 in_progress 写任务（scope=并集）还是单任务？建议**单写任务并发**以最小化重叠冲突。
- U-C（建议默认）：`research/rev` 与 `research/task` 是否保留为两个 CAS 跟踪对象（task=认领工作单元，rev=artifact 内容修订线）？建议保留（task 管 owner/权限，rev 管稿件/claim 逐版 CAS）。
