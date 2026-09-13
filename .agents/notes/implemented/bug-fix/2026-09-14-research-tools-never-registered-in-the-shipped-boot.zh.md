# Agent Note: 出货 boot 上研究工具从未注册过

Status: implemented

[English](2026-09-14-research-tools-never-registered-in-the-shipped-boot.md) | 中文

## Problem

`@deepseek-ai/dsh-research-cordis` 经由一个声明了 `inject: ['tools']` 的嵌套插件,把七个研究工具注册到 `ctx.tools` 上。它直接在 `[Service.init]` 里挂载了这个插件。

loader **并发**启动各 entry,不按列表顺序 —— 所以在出货 profile 上,引擎的加载可以(而且确实)跑在兄弟行 `tools` 起来之前。真实 1120 boot 上实测:`[Service.init]` 运行时 `ctx.get('tools')` 是 `undefined`,约 50 ms 后才是对象。在那个时刻挂载,创建出的 fiber 其 inject 永远无法被满足,注册因此被永久跳过。

tolerant 路径(`requireResearchTools` 未设,正是出货 `research-app` bundle 的用法)什么也捕不到、什么也不报,因为被跳过的 fiber 不是错误。结果:**出货的研究 bundle 启动了、提供了 UI,却注册了零个研究工具。** `ctx.agentTeams` 同样不存在 —— `ResearchTeamService` 也声明 `inject: ['tools']`,以同样的方式被跳过。

没有任何东西抓到它。单测手工构造的上下文里 tools 服务已经就绪,所以那里的挂载永远成功。唯一的端到端证据是一行启动日志 `dsh web: http://127.0.0.1:1120/...` —— 而无论工具有没有注册,这行都成立。

## Decision

引擎改为经 `ctx.inject(['tools'], …)` 挂载工具插件 —— 这是框架自带的"依赖可用时再跑"机制,也是仓库其余部分早就在用的写法。注册在服务出现的时刻提交;`ResearchEngine.toolsReady` 只在该提交点被置位。

当服务在加载时已经就绪,被注入的 fiber 会被 await,因此加载期仍然保留一道门:设置了 `requireResearchTools` 时,注册未通过就绪检查会从 `ctx.plugin` 抛出,而不是被吞掉。

`requireResearchTools` 被重新定义为它真正能强制的东西。它**不是**"没有 tools 服务就不许启动" —— 加载期无法区分"服务还没起来"和"服务永远不会存在",没有任何加载期检查能分辨二者。它是"服务在、但注册未产出 Ours:抛错而不是容忍"。出货的 `research-app` 行现在设置它,那些声称更强保证的注释已更正。

## Admission and ownership

`ResearchEngine` 拥有挂载与就绪信号。`tools` 服务的缺席仍被容忍:独立内嵌场景下引擎仍是一个可用的 `ctx.research` 状态机,`toolsReady === false` 且没有研究工具 —— 这正是独立模式测试所断言的行为。

修复是在**真实 boot** 上验证的,不是在手工构造的上下文里:把更正后的 bundle 放进临时 profile,启动日志报告七个工具已注册到 `toolsCtx.tools`,profile 仍在 1120 上提供服务。回归被一条 spec 钉住:先在裸上下文上加载引擎,随后才启动工具插件,断言工具最终到达 —— 这正是 loader 实际使用的顺序。

## Alternatives considered

**在引擎上声明 `static inject = ['tools']`。** 这是 cordis 的惯用答案,会把引擎排到 tools 行之后。否决:它把引擎变成 tools 服务的硬依赖,而引擎被规定必须能在没有该服务时独立使用。

**在 `[Service.init]` 里用有界超时等待服务。** 否决:这让启动时长成为一个随部署变化的可调项,而且把"主机慢"变成"启动失败",而不是"注册较晚"。

**保留 tolerant 路径的即时挂载,只加一行日志。** 否决:日志不是契约;tolerant 路径的职责是让缺席不致命,不是让"服务在但注册坏了"变得不可见。

## Consequences

出货 bundle 第一次真正拥有它的工具面,这对任何已经在跑它的部署都是行为变化:七个 `pipeline_only` 工具与 `agentTeams` 服务现在存在了。它们的暴露面仍由随它们一同注册的守卫管辖,所以并没有放宽模型可见面。

`packages/bundle/research-app/cordis.patch.yml` 现在设置 `requireResearchTools: true`,并配置了 prose 通道(`deepseek-official` / `deepseek-v4-pro`),因此出货 profile 在 prose 步骤上会走真实模型,而不是输出 fixture 文本。该通道需要该路由的凭据:没有凭据时,一次 prose 写入会让该步失败,而不是回退 —— 这正是 runner 记录的 fail-closed 姿态。

挂载现在相对于 `[Service.init]` 是异步的,因此想观察注册的 spec 必须 await 它,不能假定它已在 `ctx.plugin` 期间发生。
