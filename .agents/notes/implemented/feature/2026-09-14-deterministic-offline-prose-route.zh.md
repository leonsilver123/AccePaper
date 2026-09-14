# Agent Note: 确定性离线正文路由,以及离线 bundle 姿态

Status: implemented

[English](2026-09-14-deterministic-offline-prose-route.md) | 中文

## 问题

正文通道(`LlmProseWriter`)需要一个 provider 路由来投递请求,而仓库唯一出货的路由是 `deepseek-official`,它需要凭据。于是没有凭据的部署每个正文步骤都失败;有凭据的部署则让这一次运行不可复现且依赖网络。

出货的 `research-app` bundle 正是这么配的:`prose: { provider: deepseek-official, model: deepseek-v4-pro }`,外加 `literatureSearch: openalex`。在本机上两者都不工作 —— 没有密钥,而 OpenAlex 返回 429,因为它没向任何人标识自己。所以出货默认值根本跑不起流水线,而离线场景也没有可用的 provider。

中间也没有别的东西可用。`@deepseek-ai/dsh-llm-replay` 从会话日志回放录下的分片,它无法回答一个从未被录下的请求,而研究正文从来就没有录音。

## 决定

`dsh-research-cordis` 出货一个**确定性离线 provider**(`src/deterministic-llm.ts`),并把 `Config.prose` 改为判别式通道:

- `kind: 'llm'` —— 真实 provider 路由,与原先一致。
- `kind: 'deterministic'` —— 引擎在真实的 `ctx.llm` 上注册自己的适配器,并让 writer 指向它。

这是一个**真实**适配器:正文请求走的是常规路径(agent loop → `LlmRuntime` → adapter → 会话日志),路由以**请求的纯函数**作答。它不是把 loop 换成 mock,也不是用 fixture 顶替请求:请求、会话与日志都是真的,**只有响应是算出来的**。

出货 bundle 切换到离线姿态 —— `fixture` 检索 + 确定性正文路由 —— 因为在一个没有凭据、没有出网的宿主上,这个姿态**就是产品本来的样子**,也因为此前的默认值无法启动到一次可用的运行。真实通道仍只差一次粘贴:`cordis.patch.yml` 末尾就是替换块,bundle README 写明它需要凭据与出网。

**标记是契约的一部分。** 默认响应体以 `DEMO DRAFT` 开头,并声明没有调用任何模型。这段文本会成为某个步骤的产物,并向下游流入 artifact 与草稿,所以拿到它的人必须**不必查阅任何计划文档**就能知道它是什么。部署可以替换模板,但离线路由的文本**绝不能**被当作模型生成的研究结论呈现。

## 归属与边界

`ResearchEngine` 拥有这次注册,因为它已经拥有其它部署级选择(`toolDeps`、`proseWriter`、`sessionCwd`),而且它是知道部署选了哪条通道的组件。注册是由引擎 fiber 拥有的 effect,因此重新挂载不会留下重复路由。

provider 以**普通对象**组装,而不是 `LlmAdapter` 子类:基类在该包的非字面量动态导入缝后面,而 `registerAdapter` 是同进程的类型化边界,所以结构面(`providerInfo`、`providerRetryPolicy`、`prepareCall`、`stream`)就是全部契约。它放在本包而非 `packages/llm/`,原因记在模块头里:新增 workspace 包需要包管理器安装来创建 lockfile 条目与依赖链接,而本机唯一可用的安装路径会重建整棵 modules 树。

与旁边的工具注册一样,绑定走 `ctx.inject(['llm'], …)`。loader **并发**启动各 entry:真实 1120 boot 上,引擎加载时 `ctx.get('llm')` 是 `undefined`,直接读取会让整个 boot 以 `prose.kind is "deterministic" but the host provides no llm service` 失败。`ctx.research.proseRouteReady` 是提交点,并有 spec 钉住 loader 实际使用的顺序。

## 考虑过的替代方案

**在测试侧注册脚本化适配器,生产代码不动。** 否决:需要可用路由的是**部署**,测试专用适配器会让出货 bundle 依然跑不起来 —— 而这正是本次要移除的缺陷。

**把 provider 作为新 workspace 包放进 `packages/llm/`。** 架构上这才是正确的家 —— 它是 LLM capability seam 的 Provider 角色,不是 Consumer 的细节。此次因工具链原因否决:它需要 lockfile 条目与依赖链接,而本机的 `pnpm install` 不重建 `node_modules` 就不肯继续,风险是把整个仓库一起拖下水。已记在模块头里,作为"安装能安全运行后的正确改动"。

**让确定性路由也回答带标签字段的指令**(A2 要求 `ASSERTION:`/`DIFFERENCE:`/`EXPERIMENT:`/`PREDICTION:`)。否决:那等于让一个占位符生成器通过解析指令模板去**编造可证伪的研究论断**,正是本子系统存在的意义所要拒绝的"让模型决定科学"模式。结构化步骤的内容属于被选中的 Case Pack。

**保持出货 bundle 走真实通道,只把离线覆盖写进文档。** 否决:那会把可复现、免凭据的配置变成需要主动开启的选项,而出货的默认值仍然跑不完一次运行。

## 后果

- 没有凭据的部署可以跑通整条正文路径。真实 1120 boot 已验证:`ctx.research.proseWriter` 产出的文本里 `Task:` 行是调用方的指令,路由是 `research-deterministic / deterministic-prose-v1`。
- A1-landscape 在一次真实 remote 运行中**通过**。该运行随后停在 A2-claim,这是诚实的边界:A2 要结构化字段,而目前没有任何通道提供它们。
- 派生逻辑会**越过** agent loop 追加的运行时上下文快照。第一版读的是**最后**一条 user 消息,而那条正是快照,于是草稿把沙箱策略当成自己的任务复述了一遍 —— 一个错误但看着仍然像样的产物。已用从真实会话 dump 抄来的消息形状写了 spec 钉住。
- 这条路由的文本可复现,因此快照或断言可以钉住它。同一请求两次写入产出逐字节相同的结果。
