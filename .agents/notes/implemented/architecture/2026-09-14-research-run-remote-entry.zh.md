# Agent Note: 研究运行经 Remote 调用抵达浏览器

Status: implemented

[English](2026-09-14-research-run-remote-entry.md) | 中文

## Problem

`ResearchTeamService.runPipeline` 的文档写着"the runner's production entry",而它在整个仓库里**没有任何调用方** —— 应用里没有,spec 里也没有。浏览器面把这件事暴露了出来:`ResearchWorkbench` 渲染一份运行摘要,而研究标签页只能显示 `loadFixtureSummary()`,因为没有任何东西能启动一次运行,也没有任何东西能把真实的运行交进去。此前加的那个 `summary` prop 是一个**另一侧什么都没有**的接缝。

另外两处陈述形状相同:workbench **无条件**渲染 MOCK 徽标,所以那个接缝即使拿到真实运行也仍会标"演示数据";而 `RunSummary.isMock` 声明为字面量 `true`,模型根本无法表达别的。`SummaryPanel` 自己还带了一个同样的无条件徽标。

## Decision

`ResearchTeamService` 继承 `TypertRemoteService`,把 `runPipeline` 以 `@Remote('run')` 暴露在 wire namespace `research` 下 —— 服务键仍是 `agentTeams`(宿主插件注入的就是这个名字),namespace 另取,免得客户端去够一个会和实验性 agent-team 包冲突的名字。

方法返回的是**快照**而不是驱动的 `RunResult`:运行本身、16 步目录、每一条已记录的闸门判定(含它的 evidence 与 rationale)、每个产物的元数据、以及每步的尝试次数与 hold reason。目录随行是因为客户端拿到的是以 `stepId` 为键的逐步结果,它**没有别的途径**知道某一步的序号、阶段、显示名或是否人工门 —— 否则它只能自己再声明一遍 core 的步骤定义,而那正是客户端副本发生漂移的方式。闸门证据与产物元数据随行是因为 `RunResult` 两者都不带,而在客户端重建它们等于**编造**读者拿来核对判定的那串证据。

客户端沿编译面拆分。`run-source.ts` 把 wire 载荷映射成视图模型,并且**结构化地**声明该载荷 —— 因为服务在 Host 面编译、这个模块在 Client 面,而客户端 bundle 不取跨插件值依赖。这与 runner 的 `llm-prose-writer.ts` 在同一道分界的另一侧用的是同一种孪生写法。`ResearchEntry.tsx` 把 workbench 绑到一个运行源;`client/index.ts` 用本地声明的 namespace 结构面从 `ctx.remote.research.run({})` 构造该源。workbench 增加了运行控件、去掉了无条件徽标,`RunSummaryInput` 增加 `source: 'fixture' | 'live'`,于是 `isMock` 是推导出来的而不是常量。

## Alternatives considered

**返回 `RunResult`,在客户端映射。** 否决:映射需要步骤目录,而 `RunResult` 不带它。客户端将不得不自己声明 16 步定义的副本 —— 一个属于 core 的事实的第二个家。

**把适配器放进 bundle。** `packages/bundle/research-app` 是唯一同时看得见 `dsh-research-team` 与 `dsh-research-web` 的包,`cordis.patch.yml` 也能长出代码行。否决是因为 `dsh-research-web` 以 **client 面**项目编译:在 host 面导入它会**把浏览器源码拖进 host 程序**,而这正是当初移除 bundle 对它那条 tsconfig reference 的原因。适配器反正也得结构化地声明客户端的摘要形状,所以 bundle 并不比客户端侧的映射器多得到什么 —— 却要多一个插件行、一个 boot 面,和一个只为放一个类型而存在的包。

**让客户端从文件或会话投影里读快照。** 否决:运行的 store 只在这个调用的生命周期内存在内存里,不写入会话日志,所以磁盘上和投影流里都没有可分客户端读的东西。

**手写 wire 描述符而不生成。** 否决:生成器本来就扫全 workspace 的 `@Remote` 标记,手写会把边界类型放到两个地方。

## Consequences

管线现在有了调用方,研究标签页可以渲染一次它真的启动过的运行。`pnpm run build` 为 `dsh-research-team` 生成 `typert.host.js` 与 `typert.remote-client.js`,该包的 `exports` 增加了 `./types`、`./typert`、`./remote`,让边界类型与生成产物落在公共子路径上 —— 生成器会拒绝 manifest 未声明它们的包。

**一个构建顺序缺陷在同一次改动里暴露并修掉了。** team 包的 `tsdown.config.ts` 在每一趟都 `clean: ['lib/*.js']`。Client pass 在 Host pass 之后运行且用同一份配置,于是它删掉了 Host pass 生成的 Typert 产物,而 Client pass 不会重新生成它们。clean 列表现在只列这个包真正产出的文件。任何**由两面构建**的包将来长出 Typert 面,都需要同样处理。

这次接线是 Integration-verified,不是 Runtime-verified:Host 半边由一条挂载真实服务的 spec 覆盖,客户端半边由针对打桩 namespace 的 jsdom spec 覆盖,两个 typecheck 面与两次构建都通过,真实的 `dsh web` 在 1120 上启动时插件加载成功且 remote 服务在位。**没有任何浏览器对着运行中的 Host 驱动过这个标签页** —— 这个缺口,以及一次浏览器实跑才能定论的两处陈述,记在本包 README 里。

`RunSummaryInput` 增加了一个必填字段,于是该类型的每一处字面量(fixture、客户端 spec 的两处输入)都必须说明自己从哪来。这正是重点:一份不说明来源的摘要,就是这次改动所针对的那个缺陷。
