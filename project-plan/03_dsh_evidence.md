# 03 DSH 源码核验证据（A2 只读核验）

核验对象：`D:\1\deepseek-harness-master1\deepseek-harness-master`（pre-release `0.1.2-alpha.4`，`package.json:3`）。
核验日期：2026-09-02。Node：`v24.18.0`（满足 `^22.19 || >=24`）。
格式：逐项「结论｜状态｜源码位置(file:line)｜验证方法｜对计划的影响」。状态取值：已由源码确认 / 已由测试确认 / 文档声明未确认 / 当前源码不支持 / 需要PoC / 当前无法核验。

---

## 0. 总结论（结论｜类型｜证据位置｜影响｜建议动作）

结论：DSH 在 `0.1.2-alpha.4` 以 Cordis 插件树形态提供完整 agent harness 能力，§六清单中 20/22 项已由源码确认；2 项需 PoC（deepseek-v4-flash/pro 实端可调性、directory picker 崩溃根因）。阻断项：无硬阻断，但有三条高影响风险——(a) pre-release 无兼容承诺，所有 on-disk 格式/事件版本随时破坏；(b) experimental 子系统（agent-team / code-runtime-python）私有未发布，不可作为稳定依赖；(c) 本仓库为非 Git 解压副本，`pnpm run build` 必须显式导出 `DSH_CLIENT_COMMIT_HASH`，已用占位 `0000000` 验证可构建。
类型：能力矩阵 + 阻断 + 需PoC。
证据位置：见下文逐项。
影响：落地计划应以「dsh web 单端口 + 配置驱动 baseURL/模型名 + 自研插件挂载到 ctx.* 扩展点」为骨架；不得依赖 experimental seam；不得硬编码 1120/1121；不得假设 deepseek-v4-* 一定可调，须 PoC。
建议动作：先跑两项 PoC（见 §3、§4），再用 §5 的 experimental 隔离建议约束自研插件边界。

---

## 1. DSH 能力矩阵（逐项核验）

### 1.1 Cordis name/inject/apply 三件套
结论｜状态｜源码位置｜验证方法｜对计划的影响
- 插件 = 函数（带可选 `inject` 与 `apply(ctx)` 字段）或 `Service` 子类；`name`/`inject`/`apply` 是标准三件套。`inject` 声明服务依赖决定加载序，`apply` 通过 `ctx.effect()`/`ctx.on()` 挂载可逆 effect。
- 状态：已由源码确认。
- 源码位置：`docs/cordis-primer.md:8-13`（五条核心理念）、`docs/cookbook/adding-a-tool.md:14-35`（`export const name/inject` + `export function apply(ctx)` 示例）、`vendor/README.md:17`（vendored `@deepseek-ai/cordis` `4.0.0-rc.7` commit `56b3d4f7`）。
- 验证方法：读 primer + cookbook 示例 + vendor 清单。
- 对计划的影响：自研引擎须包成「`name`+`inject:['tools'|'llm'|...]`+`apply(ctx)`」函数插件才能进 dsh 树；不要直接 patch core。

### 1.2 cordis.patch.yml 加载与组合（roster vs source-overlay insert）
结论｜状态｜源码位置｜验证方法｜对计划的影响
- 层序：空根 → 各 bundle 按 `dsh.profile.bundles` 序 → profile `cordis.patch.yml` → home 层 → `--patch` overlay；`composeEntries()` 对空根单次调用 `applyEntryPatches`。patch 按 id 整体替换 config 或 `insert` 新行；`applyEntryPatches` 在加入每个 insert 行时即建索引，故后继 patch 可配置/禁用早先 insert 的行（上游一次性建索引的 bug 已本地修复）。
- 状态：已由源码确认。
- 源码位置：`packages/boot/app-boot/src/profile.ts:854-861`（`composeEntries`）、`:805-844`（`loadProfile` 层序）、`:137-158`（`PROFILE_TEMPLATES` web/headless/sdk/sdk-minimal/acp）、`vendor/README.md:43`（local mod 11，insert 即索引）、`packages/bundle/web-app/cordis.patch.yml`（`insert` 浏览器 roster + host 行）。
- 验证方法：读 profile.ts + web-app patch + vendor 本地修改日志。
- 对计划的影响：自研能力用 `insert` 进 roster（如 `dsh.client` 行），用 id-targeted patch 在 profile/home 层覆盖；不要跨 include 边界 patch。

### 1.3 source overlay 真实用法
结论｜状态｜源码位置｜验证方法｜对计划的影响
- overlay 即 profile/home/`--patch` 三个 patch 文件层；`!!js`（非 `!js`）仅允许出现在 entry `config` 与 `disabled` 下，其余元数据保持字面；`disabled: !!js` 在每次 mount 决策时按 loader 上下文求值；config 在声明注入激活后按 `ctx.serviceName` 惰性插值。
- 状态：已由源码确认。
- 源码位置：`docs/cordis-primer.md:39`（Loader Configuration）、`vendor/README.md:50`（local mod 18 `disabled` 插值）、`:47`（local mod 15 惰性 config 解析）、`AGENTS.md:99`（`!!js` 规则）、`packages/boot/app-boot/src/profile.ts:38,171-175`（`loadOverlayPatches` + patch 模板）。
- 验证方法：读 primer + vendor 日志 + profile.ts。
- 对计划的影响：用 `disabled: !!js` 做环境/部署条件装配；config 内 `!!js` 可读 `ctx.<key>`，但不要在元数据层放表达式。

### 1.4 workflow 状态/生命周期/中断恢复
结论｜状态｜源码位置｜验证方法｜对计划的影响
- `WorkflowEngine`（抽象 Service）`start(request)` 返回 `WorkflowRun`，其 `result` 在脚本 settle 时 resolve 且永不 reject；`WorkflowStopReason = completed|cancelled|error`；生命周期事件 `workflow/start|phase|log|agent-start|agent-end|end`（emit 模式，每监听器失败被容纳）；中断/恢复契约：取消经 cancel signal，disposal 在 `disposalTimeoutMs` 内等待子清理，`workflow/end` 恰好一次，worker 被杀过 grace 时 engine 合成 `agent-end` outcome `cancelled`；`agent()` 调用经 `ctx.subagents` 扇出。worker-thread 引擎为 provider。
- 状态：已由源码确认。
- 源码位置：`packages/workflow/workflow/src/index.ts:157-187`（Service Definition 契约）、`:36-91`（事件声明）、`packages/workflow/workflow/src/types.ts:63-131`（`WorkflowStopReason`/`WorkflowResult`/`WorkflowResultInfo`）、`docs/architecture.md:117`（Experimental Agent Teams 上层）、capability-seams `ctx.workflowEngine`（worker-thread 实现）。
- 验证方法：读 workflow Service Definition + types + architecture。
- 对计划的影响：若需多步编排，优先用 `ctx.workflowEngine`（worker-thread）而非自造；中断恢复由 engine 保证 bounded disposal + exactly-once end，但 worker 死亡后未发出 agent 数退化为 host 观测值。

### 1.5 session persistence/projection
结论｜状态｜源码位置｜验证方法｜对计划的影响
- `ctx.sessionPersistence`（JSONL 后端，一 session 一 artifact）；`ctx.sessionProjections`（fold units，`stateOf()`/`snapshot()`，turnBoundary）；`ctx.sessionProjectionCache`（按 session 检查点，throttled + turn/end/detach 强制点，冷读 ladder = cache row + persistence tail replay）；`SessionEventMap` 持久且 `SESSION_FORMAT_VERSION=0` 无兼容承诺；SQLite 用单调 `SCHEMA_VERSION`；「model-visible ⟺ logged」运行时不变式。
- 状态：已由源码确认。
- 源码位置：`docs/architecture.md:104-109`（Session log + Projection seam）、`docs/capability-seams.md`（`ctx.sessionPersistence`/`ctx.sessionProjections`/`ctx.sessionProjectionCache` 行）、`AGENTS.md:7,107`（格式版本无兼容承诺 + SessionEventMap ignorable 机制）、`docs/subsystems/workspace.md:118-122`（projection cache 冷读）。
- 验证方法：读 architecture + capability-seams + workspace 子系统。
- 对计划的影响：新 model-visible 输入必须扩 `SessionEventMap` 并从 log 渲染；冷读列表走 projection cache，勿全量读 log。

### 1.6 guard/hooks 执行阶段与调用顺序
结论｜状态｜源码位置｜验证方法｜对计划的影响
- 工具管线顺序（durable 事件 → live waterfall）：`tool/call*` → `tools/pre-execute`（allow/deny/ask 策略，waterfall）→ `ctx.tools.guard()`（单调 deny，后继 listener 不可撤销）→ `tools/execute`（deadline/retry/metrics 包裹，waterfall）→ `tools/post-execute`（替换 content/value、block、附 model 上下文）→ `tool/result*`（观测不可变归一结果）。`agent/pre-step`/`agent/request`/`llm/stream` 与三 `tools/*` 为 waterfall（须 `next()`），`agent/turn-stopping` 为 serial（无 `next()`）。guard 组：repeat-tool-reminder（advisory）+ tool-call-timeout-policy（`tools/execute` deadline，abort `exec.signal`，映射 `TOOL_TIMEOUT`）。hooks 组：hooks-claude-code/hooks-codex 把既有 `hooks.json` 桥接到 agent 事件（session start / prompt submit / tool before-after / run stopping），经 typed-Decision 拦截扩展点，hook-protocol 为共享引擎。
- 状态：已由源码确认。
- 源码位置：`docs/architecture.md:78-95`（turn flow + waterfall/serial 标注）、`docs/cookbook/adding-a-tool.md:58-59`（pre-execute/guard/execute/post-execute/result）、`packages/guard/timeout-policy/README.md`（cooperative deadline，base bundle 内置）、`packages/hooks/README.md`（桥接 Claude Code/Codex hooks）、`docs/capability-seams.md`（`ctx.tools`/`ctx.approval` 行）。
- 验证方法：读 architecture turn flow + adding-a-tool + guard/hooks README。
- 对计划的影响：自定义审批/截断走 `tools/pre-execute`（可 ask）或 `ctx.tools.guard()`（硬 deny）；超时用 timeout-policy 而非自造；复用 hooks 桥接而非重写 hook 逻辑。

### 1.7 tool 注册/限制/调用/结果事件
结论｜状态｜源码位置｜验证方法｜对计划的影响
- 注册：`ctx.tools.register(defineTool({...}))`，effect-based 可卸载，schema 自动进 system-prompt 装配。`defineTool` 在 `execute` 前按 `ParameterSchemaSpec` 校验 args（类型/required/字面量/exact-one union/嵌套），冻结 detached lossless JSON `arguments` 与 opaque `exec.token`；`execute` 返回 canonical JSON value，registry 快照+校验+冻结后交 `output.render`；throw/非法值 → `isError`，registry 容纳 schema/renderer/metadata-projector/lossless-JSON 失败。PTC 模式：`await tools.<name>(args)` 重入正常管线，成功解析为最终 canonical JSON。durable 事件 `tool/call`、`tool/result`；live waterfall `tools/pre-execute|execute|post-execute`。
- 状态：已由源码确认。
- 源码位置：`docs/cookbook/adding-a-tool.md:14-65`（minimal shape + execute 契约 + PTC）、`docs/architecture.md:88-89`（`tool/call*` → `tools/*` → `tool/result*`）、`docs/capability-seams.md`（`ctx.tools` 行，consumers 列各 tool-*）、`docs/config-catalog.md:86-114`（`dsh-agent-loop` Config 含 `maxParallelToolCalls`）。
- 验证方法：读 adding-a-tool + architecture + capability-seams + config-catalog。
- 对计划的影响：自研工具用 `defineTool`，UI card 经 `presentCall`/`presentResult` 纯投影（replay 须 pure）；长任务走 `ctx.jobs.start` 而非 `run_in_background` 自管。

### 1.8 subagent
结论｜状态｜源码位置｜验证方法｜对计划的影响
- `ctx.subagents` seam；providers：spawn-in-process、fork-in-process、acp、codex、claude-code、dsh-sdk；consumers：tool-subagent（一次性或可继续委派）、tool-subagent-control（后续投递）、tool-ralph（需 fresh structured-output route）。service 亦持有可选 Activation-based continuation orchestration。`ctx.subagentModelSelection` 为 default-off settings namespace。
- 状态：已由源码确认。
- 源码位置：`docs/capability-seams.md`（`ctx.subagents`/`ctx.subagentModelSelection` 行）、`packages/subagent/subagent/src/`（lifecycle.ts/continuation.ts/child-agent.ts/descriptor.ts/out-of-process.ts 等）、`docs/architecture.md:115`（subagent provider 差异）。
- 验证方法：读 capability-seams + subagent src 文件清单。
- 对计划的影响：委派子代理用 `ctx.subagents` + tool-subagent；continuable 模式经 Activation；跨产品委派用 acp/codex/claude-code 后端。

### 1.9 agent-team / tool-agent-team
结论｜状态｜源码位置｜验证方法｜对计划的影响
- `ctx.agentTeams`（experimental，private opt-in coordination seam）：implicit-root roster、durable peer mailbox、shared task DAG、continuable-child lifecycle、generated Team Remote 方法。tool-agent-team 贡献 model 控件，client-ui-agent-team 挂浏览器贡献。**experimental/ 未发布，无稳定性承诺**。
- 状态：已由源码确认（experimental 性质）。
- 源码位置：`docs/architecture.md:117`（Experimental Agent Teams）、`docs/capability-seams.md`（`ctx.agentTeams` 行，consumers experimental-tool-agent-team/client-ui-agent-team）、`packages/experimental/agent-team/src/`（index/roster/mailbox/task-board/task-graph/lifecycle）、`packages/README.md:52`（experimental 私有原型）。
- 验证方法：读 architecture + capability-seams + experimental 包结构。
- 对计划的影响：**不得作为生产依赖**；若需多 agent 协作，要么等其稳定发布，要么自研基于 `ctx.subagents` + 自有 mailbox/DAG（见 §5 隔离建议）。

### 1.10 member-scope 真实能力
结论｜状态｜源码位置｜验证方法｜对计划的影响
- 任务带 `writeScopes: string[]`（CAS 修订 `revision`），`TeamTaskView` 暴露 `writeScopeWarnings`；成员 `TeamMemberView`（role `lead|teammate`，status `running|idle|inactive|provisioning|failed`，provider/model/context fresh|fork）；task action `claim|release|edit|set_dependencies|complete|reopen|reassign|delete`。即 member-scope = 任务的 write-scope 白名单 + CAS 修订 + owner 认领。**experimental**。
- 状态：已由源码确认（experimental）。
- 源码位置：`packages/experimental/agent-team/src/types.ts:71-97`（`TeamTaskStatus`/`TeamTaskSnapshot.blockedBy`/`writeScopes`/`TeamTaskView.ready`/`writeScopeWarnings`）、`:44-68`（member snapshot/view）、`:182-202`（`TeamTaskAction`/`UpdateTeamTaskRequest`）。
- 验证方法：读 agent-team types.ts。
- 对计划的影响：若自研多 agent，write-scope + CAS 修订是可借鉴的成熟模型；但勿直接复用 experimental 实现。

### 1.11 agent mailbox + 任务 DAG
结论｜状态｜源码位置｜验证方法｜对计划的影响
- mailbox：`TeamMessageSnapshot`（senderId/targetId/delivery `quiet|wakeup`/content），durable 事件 `team/message/queued`（投递前持久）+ `team/message/delivered`（目标 session 记录后）；de-dup 经 `TeamMessageSource`（`kind:'team-message'`，注入 `MessageSourceMap`）。任务 DAG：`TeamTaskSnapshot.blockedBy: TeamTaskId[]`（依赖边），`CreateTeamTaskRequest.blockedBy` 建边，`set_dependencies` 动作改边。Config 限 `maxMembers/maxTasks/maxPendingMessagesPerMember/maxMessageBytes/disposalTimeoutMs`。**experimental**。
- 状态：已由源码确认（experimental）。
- 源码位置：`packages/experimental/agent-team/src/types.ts:105-122`（mailbox snapshot/source + MessageSourceMap 注入）、`:73-83`（task DAG `blockedBy`）、`:220-236`（SessionEventMap 注入 `team/member|task|message/queued|message/delivered`）、`:131-142`（Config 限额）、`packages/experimental/agent-team/src/{mailbox,task-board,task-graph,roster}.ts`（实现文件）。
- 验证方法：读 agent-team types.ts + 文件清单。
- 对计划的影响：mailbox/DAG 模型可参考；持久化经 SessionEventMap 注入是可借鉴的 durable 模式。

### 1.12 code-runtime 本地执行边界与资源隔离
结论｜状态｜源码位置｜验证方法｜对计划的影响
- `ctx.codeRuntime` seam：`run(request)` 跑 model-written 程序对 host async bindings；`abstract readonly language`（`'typescript'` 已发布 / `'python'` experimental 私有）、`abstract readonly isolation`（`'worker-thread'|'process'|'container'`，**informational，非安全声明**）。契约：bindings 结构化克隆可传，程序视为 hostile peer，runs 互相隔离，disposal 终止并 await 在途 run。`RESERVED_BINDING_GLOBALS`/`RESERVED_ERROR_MEMBERS`/`PORTABLE_RESERVED_WORDS` 为跨后端可移植标识符契约。worker-thread（`code-runtime-worker-thread`）为已发布本地 substrate；**worker-thread 共享进程，无 OS 级沙箱**，真正 confinement 须配 `ctx.sandbox`。
- 状态：已由源码确认。
- 源码位置：`packages/code-runtime/code-runtime/src/index.ts:89-136`（Service Definition + `language`/`isolation` 注释明确「not a security claim」）、`:40-87`（reserved 标识符集）、`docs/capability-seams.md`（`ctx.codeRuntime` 行，impl code-runtime-worker-thread + experimental-code-runtime-python）、`docs/capability-seams.md`（`ctx.sandbox` 行）。
- 验证方法：读 code-runtime index.ts + capability-seams。
- 对计划的影响：本地代码执行用 worker-thread；但若需真隔离/资源上限，必须叠加 `ctx.sandbox`（bwrap/Landlock/Seatbelt），不可仅靠 code-runtime 的 `isolation` 字段当安全保证。

### 1.13 Web Slots 名称/类型/注册方式
结论｜状态｜源码位置｜验证方法｜对计划的影响
- Slot 经 TypeScript declaration merging 注入 `@deepseek-ai/dsh-client-ui-slots` 的 `interface SlotMap`（空接口，插件 augment）；slot 名为点分字符串键（如 `'conversation.composer'`、`'conversation.approval.detail'`）；`SlotKind = 'single'|'list'|'keyed'|'chain'`；`SlotScope` 含 `'root'|'session'|...`（root spec 默认 `{kind:'single',scope:'root'}`）；每 slot 声明 `{kind, scope, owner/keyProps}`；i18n 经并行 `LocaleNamespaceMap` 注入。
- 状态：已由源码确认。
- 源码位置：`packages/client/ui-slots/src/index.ts:26`（`interface SlotMap {}`）、`:90`（`SlotKind`）、`:103-104`（`kind`/`scope`）、`:732`（root spec）、`packages/client/ui-approval/src/client/contract/slots.ts:29-43`（augment `SlotMap` + `LocaleNamespaceMap`，声明 `'conversation.approval.detail': {kind:'single',scope:'session',owner:...}`）。
- 验证方法：读 ui-slots index.ts + 一个真实 slot 契约。
- 对计划的影响：自研 Web 卡片用 declaration merging 注册 SlotMap 行，声明 kind/scope；UI 文案走 `LocaleNamespaceMap` + `t`，勿硬编码。

### 1.14 双面包与 dsh.client
结论｜状态｜源码位置｜验证方法｜对计划的影响
- 双面包（dual-face）：UI 插件同时出 node 半（ESM `lib/index.js`，host Loader 导入）+ client 半（CJS `lib/client.js`，浏览器）。`ctx.clientModules` 从增量 `dsh.client` 扫描装配 `__DSH_BOOT__` entry graph、serve 插件 bundle、通知 rebuilt/graph-changed。`dsh.client` 行在 patch 中以 `insert` 进 roster；package.json `dsh.client.external` 声明请求的 module-table specifiers（精确匹配，不归一）。
- 状态：已由源码确认。
- 源码位置：`packages/client/tsdown.client.ts:107-124`（`clientBundle` 出双半）、`:428-439`（client 半 `format:'cjs',platform:'browser'`）、`:216-244`（node 半 `format:'esm',platform:'node'`）、`:392-416`（`requestedExternals` 读 `dsh.client.external`）、`packages/bundle/web-app/cordis.patch.yml`（`dsh.client` rows 注释 + insert）、`docs/capability-seams.md`（`ctx.clientModules` 行）。
- 验证方法：读 tsdown.client.ts + web-app patch + capability-seams。
- 对计划的影响：自研 UI 插件须同时产 node/client 两半；client bundle 是 CJS factory，externals 必须在 `dsh.client.external` 声明，否则 purity gate 报错。

### 1.15 clientBundle 与 lazy-CJS 构建要求
结论｜状态｜源码位置｜验证方法｜对计划的影响
- client bundle 是 closure-factory artifact：banner `window.__ModuleLoader__.load({ id, factory: (require) => {...} })` + footer `return module.exports; }`，externals 经注入 `require`（loader module table = cordis DI entities，无 globals/import map）解析；`format:'cjs'`，CJS 不能带 TLA（故 worker 用 `void (async)()`）。purity gate（`dsh-client-bundle-purity`）禁止跨插件 value import（@deepseek-ai/* 非 requested/非 inline-safe/非 generated-remote 即 build error）；INLINE_SAFE 白名单可内联（wire/type 层）；vendored cosmokit/schemastery 内联。define 注入 `clientBuildEnvironmentDefines(process.env)`（DSH_CLIENT_*）+ `process.env.NODE_ENV`/`import.meta.env` 替换。staticLinked 通道（`apps/web` 静态装配，`STATIC_LINKED_PLUGIN` marker）。Schemastery 的 lazy `require('@deepseek-ai/cosmokit')` 经 `exports` map（import→.mjs, require→.cjs）规避 module-hook 竞态。
- 状态：已由源码确认。
- 源码位置：`packages/client/tsdown.client.ts:566-568`（banner/footer/intro）、`:437-453`（cjs + deps neverBundle/alwaysBundle 规则）、`:476-481`（define）、`:482-500`（purity gate）、`:61-72`（INLINE_SAFE/GENERATED_REMOTE）、`:256-305`（staticLinked）、`vendor/README.md:5`（Schemastery exports map + lazy require 竞态）。
- 验证方法：读 tsdown.client.ts + vendor README。
- 对计划的影响：自研 client 插件须走 `clientBundle` preset；不得跨插件 import value（经 cordis service 协作）；CJS output 不得用 TLA/import.meta 直读（须 define 替换）。

### 1.16 Provider + 自定义 base_url + OpenAI-compatible 网关
结论｜状态｜源码位置｜验证方法｜对计划的影响
- `DeepSeekAdapter` = fetch + SSE 对 DeepSeek（OpenAI-compatible）chat-completions 端点；`baseURL` 可配（`/chat/completions` 追加），请求发 `${connection.baseURL}/chat/completions`；`apiKeyEnv`（CredentialRef）每请求解析（与端点同代快照，杜绝跨代 URL+secret 错配）；provider 名可配；models 来自配置 catalog，**harness model 名即 wire model 名**（pass-through，未在 catalog 的模型按 text-only 处理，请求仍发出）。adapter 发 DeepSeek 专属头（`x-deepseek-harness-user-id` 等）并用 `deepseekLlmApiExtensions`（plugin-contributed top-level fields），通用 OpenAI 网关会忽略未知字段但 chat-completions+SSE 核心可用。
- 状态：已由源码确认。
- 源码位置：`packages/llm/llm-deepseek/src/adapter.ts:1-10`（OpenAI-compatible 注释）、`:74-91`（`DeepSeekConnectionOptions.baseURL/apiKeyEnv/models`）、`:643`（fetch `${baseURL}/chat/completions`）、`:352,385-430`（pass-through model + `resolveModel`/`modelInfoFor` 未 catalog 则 text-only）、`:531-543`（DeepSeek 专属头）。
- 验证方法：读 adapter.ts。
- 对计划的影响：可用自定义 base_url + OpenAI-compatible 网关；但若网关不认 DeepSeek 扩展字段，extensions.accept 失败可能影响 telemetry 不影响主对话；credential 须经 `ctx.credentials`（CredentialRef），勿硬编码 key。

### 1.17 deepseek-v4-flash/pro 是 Token Meter 已知名还是当前 Provider 确实可调
结论｜状态｜源码位置｜验证方法｜对计划的影响
- **token-meter 无硬编码模型名表**（grep 全 src 无 v4-flash/v4-pro）；pricing 为 heuristic + route-based，运行时经 `ctx.llm.imageRequestPricing(provider, model)` 解析。`deepseek-v4-flash`/`deepseek-v4-pro` 仅出现于：client 测试 fixture（`fixture.ts:586-593` 定义 catalog 条目）、README（`acp/README.md:42`、`acp-app/README.md:29`「shipped row 用 deepseek-official + deepseek-v4-flash」）、test spec。即：它们是**配置 catalog model id + shipped 默认 model selection**，不是 token-meter 已知名。adapter pass-through 模型名到 wire，故「当前 Provider 是否可调」取决于配置端点是否接受这些 id——源码无法判定实端。
- 状态：需要PoC。
- 源码位置：`packages/llm/token-meter/src/`（无模型名表，见 grep）、`packages/client/connection/src/client/fixture.ts:586-593`（fixture catalog）、`packages/bundle/acp-app/README.md:29`、`packages/llm/llm-deepseek/src/adapter.ts:352,643`（pass-through）。
- 验证方法：grep v4-flash/v4/pro + 读 token-meter + adapter。
- 对计划的影响：勿假设 v4-* 一定可调；落地前须用真实 `DEEPSEEK_API_KEY` + `DEEPSEEK_BASE_URL` 跑 e2e（`pnpm run test:e2e`，无 key 自跳过）。模型名可经 patch 自由替换为网关支持的名。

### 1.18 1120 单端口承载 SPA + RPC + WS
结论｜状态｜源码位置｜验证方法｜对计划的影响
- 单一 `node:http` server 同时承载：named routes（RPC）、fallback（SPA dist）、`server.on('upgrade')`（WebSocket）——全在一个 `config.port` 上 listen。API gateway 把 WS mux 注册到 `ctx.webServer.registerUpgrade(route)`（同端口）；SPA dist 经 `registerFallback`。**端口号 1120 不是源码硬编码**，是 `WebServer.Config.port`（`z.natural().max(65535).required()`，0 = OS 分配）；web profile 经 `--port` 旗标设（README 例 `--port 8080`），默认 loopback（`--host 0.0.0.0` 被拒）。
- 状态：已由源码确认（机制）；端号 1120 为配置值非硬编码。
- 源码位置：`packages/host/webserver/src/index.ts:124-131`（Config schema）、`:220-300`（init: createServer + `server.on('upgrade')` + `listen(config.port,config.host)`）、`:180-202`（registerUpgrade/registerFallback）、`packages/api/gateway/src/index.ts:205-228`（`ctx.inject(['connection','webServer'],...)` → `webCtx.webServer.registerUpgrade(route)` 同端口 WS）、`packages/bundle/web-app/README.md:34,149`（`--port` 旗标 + 拒绝 0.0.0.0）。
- 验证方法：读 webserver index.ts + gateway index.ts + web-app README。
- 对计划的影响：单端口 SPA+RPC+WS 架构成立，可用 1120（或任意）作 `--port`；无需自建第二端口。

### 1.19 1121 辅助服务是否必要
结论｜状态｜源码位置｜验证方法｜对计划的影响
- 源码架构上**不必要**：webserver 单端口已含 SPA+RPC+WS；gateway WS 与 SPA dist 共用同 server；无第二 listener。1120/1121 两端口的设想与 DSH 单端口模型不符。
- 状态：已由源码确认（不支持必要性）。
- 源码位置：`packages/host/webserver/src/index.ts:220-300`（单 server）、`packages/api/gateway/src/index.ts:223`（WS 注册到 webServer）、grep 全仓 `1120|1121` 仅命中无关 logo path 字符串。
- 验证方法：grep 端口 + 读 webserver/gateway。
- 对计划的影响：放弃「1121 辅助服务」设想；若需旁路服务（如外部 webhook collector），那是独立进程，非 DSH 架构内必需组件。

### 1.20 experimental API 稳定性与版本锁定 + 升级成本
结论｜状态｜源码位置｜验证方法｜对计划的影响
- pre-release `0.1.2-alpha.4`：「foundation over blast radius」，首 tagged release 前移除该立场；rename/repackage 自由且须改所有引用；backends 拒绝旧 on-disk 格式；SQLite 单调 `SCHEMA_VERSION`；`SESSION_FORMAT_VERSION=0` 无兼容承诺。vendored 框架按 commit 锁定（cordis `56b3d4f7`、loader、include、group、timer、hmr、logger-console、cosmokit、schemastery），`pnpm-workspace.yaml#linkWorkspacePackages` 让保留 semver 解析 pinned workspace。升级 = sync 流程：拷 `src/` → 重应用 **19 条本地修改** → 更新 version+commit → `pnpm install && test && build`。`experimental/`、`e2b/`（POC）、`test-support/`、`runtime-diagnostics/`、`util/` 为低兼容预期。
- 状态：已由源码确认。
- 源码位置：`AGENTS.md:5-11`（pre-release 立场 + application launch 规则）、`:7,107`（格式版本无承诺）、`packages/README.md:86`（release expectations: experimental/e2b/test-support 低兼容）、`vendor/README.md:13-23`（manifest pinned commits）、`:29-51`（19 条 local mods）、`:53-62`（sync 流程）。
- 验证方法：读 AGENTS.md + packages/README + vendor/README。
- 对计划的影响：**升级成本高**（19 条本地修改须逐条重应用或废弃）；勿把 experimental 当稳定 API；自研插件依赖 Service Definition（如 `dsh-subprocess`、`dsh-tools`）而非 concrete provider，规避 provider 重命名冲击。

### 1.21 pnpm install + build 在当前环境是否仍成立（P0）
结论｜状态｜源码位置｜验证方法｜对计划的影响
- 逃生口确认：`repositoryCommitHash(root, env)` 先读 `DSH_CLIENT_COMMIT_HASH`，无则 `git rev-parse HEAD`，再校验 `^[0-9a-f]{7,40}$` 取 7 字符。`officialClientBuildEnvironment` 在 official profile 下**强制要求** `DSH_CLIENT_COMMIT_HASH` 与 `DSH_CLIENT_VERSION`（缺失即抛）。**本环境为非 Git 解压副本**（env: `Is directory a git repo: No`），故 `git rev-parse` 必失败，构建**必须显式导出 `DSH_CLIENT_COMMIT_HASH`**。已验证：构建记录 `.dsh-build/client-build-environment.json` 存在，`DSH_CLIENT_COMMIT_HASH:"0000000"` + `DSH_CLIENT_VERSION:"0.1.2-alpha.4"`，artifacts fileCount 220 + sha256 绑定——即曾用占位 commit 成功构建。lib/ 已产出（含 `host/directory-picker-native/lib/worker.cjs`）。Node `v24.18.0` 满足引擎要求且过 v2 loader 边界（24.12.0+）。
- 状态：已由源码确认 + 已由构建记录确认（逃生口）；clean repro 需导出环境变量 → 落「需要PoC」for 全新干净环境复现。
- 源码位置：`scripts/client-build-environment.ts:50-61`（`repositoryCommitHash` 逃生口）、`:139-148`（official 强制要求）、`:193-205`（`resolveClientBuildEnvironment` official 校验）、`.dsh-build/client-build-environment.json:1-11`（构建记录，commit `0000000`）、`AGENTS.md:64`（`pnpm install` 要求 node ^22.19||>=24）、`vendor/README.md:51`（local mod 19 Node 24 v2 loader）。
- 验证方法：读 client-build-environment.ts + 构建记录 + node --version + ls lib/。
- 对计划的影响（P0）：**fresh `pnpm install && pnpm run build` 须先 `export DSH_CLIENT_COMMIT_HASH=0000000` 与 `DSH_CLIENT_VERSION=0.1.2-alpha.4`（或真实 commit）**；否则 official 构建抛错。这是本环境构建的硬前置。建议在落地脚本里固化这两个 env。

---

## 2. 运行时 bug 核验：directory picker「win32 folder dialog worker exited before reporting a result」

### 2.1 现象与 throw 位置
- 用户实测错误串：`win32 folder dialog worker exited before reporting a result`。
- throw 位置：`packages/host/directory-picker-native/src/win32-dialog.ts:153-156`（`worker.on('exit', () => { settle(() => { reject(new Error('win32 folder dialog worker exited before reporting a result')) }) })`）。
- 触发条件：子进程退出（`exit` 事件）且**未先发出 `done`/`error` 消息**。注意区分：worker 的 `catch` 会发 `{kind:'error',message}`（`win32-dialog-worker.ts:48-51`）→ driver 显示 `win32 folder dialog failed: <message>`（`win32-dialog.ts:138-141`）。用户得到的是 **exit** 串而非 **failed** 串 ⇒ 子进程是**硬死亡**（native AV/segfault）或**bootstrap 阶段死亡**，未及执行 worker 的 try/catch。

### 2.2 spawn 分支与 COM 子进程
- spawn：`packages/host/directory-picker-native/src/win32-dialog-host.ts:23-31`。`spawnDialogWorker` 按 `import.meta.url.endsWith('.ts')` 选臂：源平面 → `node --import tsx/esm <win32-dialog-worker.ts>`（line 30）；构建平面 → `node <lib/worker.cjs>`（line 28）。stdio `['ignore','inherit','inherit','ipc']`（stderr 继承到 host 控制台）。
- worker：`win32-dialog-worker.ts` 顶层 `import` 两本地模块（bindings/logic），无 TLA（`void (async)()` IIFE）；`await loadWin32DialogBindings()`（动态 `import('koffi')`）在 try 内；`runFolderDialog` 经 koffi 做 COM（CoInitializeEx/CoCreateInstance/SetOptions/SetTitle/Show/GetResult/GetDisplayName/Release）。
- bindings：`win32-dialog-bindings.ts`，koffi 惰性 import（非 Windows 永不加载）；vtable slot 偏移按 `pointerSize`（x64/arm64=8, ia32=4）。
- logic：`win32-dialog-logic.ts:105-132`，`runFolderDialog` 在 `Show`（SLOT_SHOW=3）处阻塞。
- reach：`native-picker.ts:69-77`，`platform==='win32'` → `pickWin32Directory(signal)`，**无 fallback tier**（注释 line 70-74 + simplification note 2026-08-04）。
- 已知风险（feature note 2026-08-02 line 26）：「a koffi signature mistake risks a native access violation, contained to the dialog child process — the host Node process survives and the failure surfaces as-is (no fallback tier)」。
- 已修 bug（2026-08-23）：`readUtf16` UTF-16LE NUL 双零扫描（U+XX00 如 `开` U+5F00 不再截断）。

### 2.3 根因候选
1. **native access violation in COM Show（首要候选）**：koffi 签名/vtable slot/pointer-size 错配或 COM 调用 AV，在阻塞 `Show`（或 CoCreateInstance/vtable decode）处同步杀子进程。worker 的 try/catch 捕获不到 native AV（进程直接死）→ `exit` 事件，无 message。与用户串精确吻合。feature note 明确承认此风险。
2. **source-plane tsx child-load failure（次要候选）**：源平面臂 `node --import tsx/esm <worker.ts>`。若子进程的 module 解析路径上 tsx/esm hook 不可达（如子未继承 pnpm 解析/NODE_OPTIONS），node 在 worker IIFE 前即以 loader/模块错误退出 → `exit` 无 message。构建臂（worker.cjs）规避 tsx，但需先 build。**当前 lib/worker.cjs 已存在**，故若 host 从构建 lib 运行应走 worker.cjs 臂；若从源运行（tsx 臂）则此候选成立。
3. **koffi 未从子进程解析（区分性排除）**：`await import('koffi')` 在 try 内，import 抛错会被 catch 发 `error`（显示 `win32 folder dialog failed:`），**不是** exit 串。故 koffi 解析失败不产生用户所见串；除非 `koffi.load('ole32.dll')` 触发硬崩溃（罕见，通常 throw）。

### 2.4 最小 PoC 探针方案（只读诊断，不改源码）
> 全部只读/临时脚本，不修改 DSH 源码。在目标 win32 机器、与 picker 同 spawn 环境运行。
1. **arm 判定探针**：在 host 上下文打印 `import.meta.url` 是否以 `.ts` 结尾 → 确定走 tsx 臂还是 worker.cjs 臂；并查 host 控制台 stderr（stdio inherit）是否有 Node fatal/segfault 行（native AV 通常留 Windows 应用程序错误日志，可查事件查看器）。
2. **koffi-load 探针**：在与子进程相同的解析环境跑 `node --input-type=module -e "import('koffi').then(k=>{k.load('ole32.dll');k.load('user32.dll');k.load('kernel32.dll');console.log('koffi-load ok')}).catch(e=>console.error('koffi-load ERR',e))"`。若 throw → 候选 3（显示 failed 串）；若 AV 退出 → 候选 1。
3. **COM Show 探针（最直接 native-crash 复现）**：写临时脚本镜像 `win32-dialog-logic.ts` 的 COM 序列（CoInitializeEx → CoCreateInstance(FileOpenDialog) → SetOptions → SetTitle → GetCurrentThreadId → Show），用 koffi 调用，单独跑。若在 `Show` 处进程崩溃退出码非 0 且无 JS 异常 → 确证候选 1（native AV in COM Show）。
4. **worker.cjs 直跑探针**：`node packages/host/directory-picker-native/lib/worker.cjs`（设 `DSH_DIALOG_TITLE` + 模拟 IPC）观察是否 AV 退出；对比 tsx 臂。隔离 tsx-load（候选 2）与 native AV（候选 1）。
5. **pointer-size 校验探针**：临时打印 `koffi.sizeof('void *')` 与 `process.arch`，确认 slot 偏移计算与实际架构一致（ia32=4/x64=8）；错配会 AV。

预期：探针 2/3/4 中若 3 在 Show 崩溃 → 根因 = native AV in COM Show（koffi ABI 错配），修复须改 bindings（非只读，留后续）。

---

## 3. 需 PoC 清总表
| # | 项 | 状态 | 阻断? | PoC 要点 |
|---|---|---|---|---|
| 1 | deepseek-v4-flash/pro 实端可调 | 需要PoC | 否（可换模型名） | 真 `DEEPSEEK_API_KEY`+`DEEPSEEK_BASE_URL` 跑 `pnpm run test:e2e`，验证端点接受 v4-* id |
| 2 | directory picker 崩溃根因 | 需要PoC | 否（有 browse 后端可绕过） | §2.4 五探针，定位 native AV vs tsx-load |
| 3 | fresh `pnpm install && build` 全新环境 | 需要PoC（机制已确认） | 否（逃生口已证） | 干净环境导出 `DSH_CLIENT_COMMIT_HASH=0000000` + `DSH_CLIENT_VERSION=0.1.2-alpha.4` 跑 build |

---

## 4. 版本/接口风险
1. **pre-release 无兼容承诺**（`AGENTS.md:5-11`）：on-disk 格式、`SessionEventMap`、SQLite schema 随版本破坏；`SESSION_FORMAT_VERSION=0`。风险：升级后旧 session/存储可能被 backends 拒。建议：落地用当前 commit 冻结，升级前全量导出 session。
2. **vendored 框架升级成本高**（`vendor/README.md:29-51`）：19 条本地修改须逐条重应用/废弃。风险：升级 cordis/loader/include 易漏 re-apply。建议：自研插件只依赖 Service Definition，不触 vendor。
3. **experimental 未发布**（agent-team / code-runtime-python / e2b POC）：无 API 稳定承诺。风险：直接依赖会在下版本消失/改名。建议：见 §5。
4. **1120/1121 端口设想不符源码**：源码单端口 + `--port` 配置，1121 辅助非必要。风险：按双端口设计会与 webserver/gateway 共端口模型冲突。建议：改单端口。
5. **DSH_CLIENT_COMMIT_HASH 构建前置**（P0，`client-build-environment.ts:50`）：非 Git 环境构建必导出此 env。风险：CI/部署脚本漏设即 official 构建抛错。建议：落地脚本固化 env。
6. **directory picker 无 fallback tier**（`native-picker.ts:70-74` + simplification note）：win32 native AV 即 picker 全失败，无 PowerShell 回退。风险：win32 用户 picker 不可用。建议：PoC 确认根因后，临时挂 `host-directory-picker-browse` 后端（in-app browser 列表/创建）作降级。
7. **模型名 pass-through**（`adapter.ts:352`）：harness 名即 wire 名，未 catalog 按 text-only。风险：误用网关不支持的模型名会被端点拒。建议：经 patch 显式声明 catalog。

---

## 5. experimental 隔离建议
1. **不直接 import experimental 包**：自研插件勿 `import '@deepseek-ai/dsh-experimental-*'`；agent-team 的 mailbox/DAG/write-scope 模型可作设计参考，但实现自建在 `ctx.subagents` + 自有 SessionEventMap 注入之上。
2. **code-runtime-python 视为不存在**：private 未发布；本地代码执行只用 worker-thread（`code-runtime-worker-thread`）；真隔离叠 `ctx.sandbox`。
3. **e2b POC 不进生产**：远程沙箱用 `ctx.subprocess`+`ctx.fs`+`ctx.sandbox` 的本地/可替换 provider，不绑 e2b。
4. **experimental 隔离机制**：`packages/experimental/` 在官方发布中排除（`packages/README.md:52`、`AGENTS.md:48` experimental 列为 private prototypes）。建议落地 profile 的 `cordis.patch.yml` 用 `disabled: !!js` 显式禁用任何 experimental 行，防误挂载。
5. **版本锁定**：在落地 manifest 固定 `0.1.2-alpha.4` + 当前 vendored commit；升级走 vendor sync 流程并全量回归（`pnpm run test && pnpm run build`），勿跨大版本。

---

## 6. 关键文件路径索引（绝对路径）
- 逃生口：`D:\1\deepseek-harness-master1\deepseek-harness-master\scripts\client-build-environment.ts:50`
- 构建记录：`D:\1\deepseek-harness-master1\deepseek-harness-master\.dsh-build\client-build-environment.json`
- picker throw：`D:\1\deepseek-harness-master1\deepseek-harness-master\packages\host\directory-picker-native\src\win32-dialog.ts:155`
- picker spawn：`...\packages\host\directory-picker-native\src\win32-dialog-host.ts:23`
- picker worker/bindings/logic/native-picker：同目录 `win32-dialog-worker.ts`/`win32-dialog-bindings.ts`/`win32-dialog-logic.ts`/`native-picker.ts`
- patch 组合：`...\packages\boot\app-boot\src\profile.ts:854`
- web-app roster：`...\packages\bundle\web-app\cordis.patch.yml`
- webserver 单端口：`...\packages\host\webserver\src\index.ts:220`
- gateway WS 注册：`...\packages\api\gateway\src\index.ts:223`
- llm adapter/baseURL：`...\packages\llm\llm-deepseek\src\adapter.ts:643`
- workflow seam：`...\packages\workflow\workflow\src\index.ts:157`
- agent-team types：`...\packages\experimental\agent-team\src\types.ts`
- code-runtime：`...\packages\code-runtime\code-runtime\src\index.ts:102`
- ui-slots：`...\packages\client\ui-slots\src\index.ts:26`
- client bundle：`...\packages\client\tsdown.client.ts:107`
- vendor 清单：`...\vendor\README.md`
