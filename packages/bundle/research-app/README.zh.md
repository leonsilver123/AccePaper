# @deepseek-ai/dsh-research-app

[English](README.md) | 中文

**dsh 研究组合包(T30)** —— dsh profile 栈中的研究表层。它叠加在 `dsh-web-app`(后者叠加在 `dsh-base` 上)之上,把 DeepSeek Harness 的科研论文生产系统打包成一个可分发的组合包。

## 它做什么

- **把研究 web 服务器绑定到 `1120` 端口**,做法是覆盖 `webserver` 行的 `config.port` 兜底值(`!!js ctx.webStartup.port ?? 1120`),同时把 `host` / `compression*` 这些键留给 `dsh-web-app` 层。
- **挂载三条插件行**,两个纯库则作为随行依赖被传递解析:
  - `@deepseek-ai/dsh-research-cordis` → `ctx.research`(16 步引擎服务)
  - `@deepseek-ai/dsh-research-team` → `ctx.agentTeams`(编队 / 红队)
  - `@deepseek-ai/dsh-research-web` → 研究工作台宿主半边
  - `@deepseek-ai/dsh-research-core`、`@deepseek-ai/dsh-research-tools` → 纯库

## 它如何被组合

一个 profile 按顺序叠加组合包补丁。`web` profile 的接线是:

1. `dsh-base` —— 核心行
2. `dsh-web-app` —— 浏览器表层 + webserver(默认端口 3080)
3. `dsh-research-app` —— **本层**(研究端口 1120 + 研究包)

这样运行:

```bash
dsh web --profile web
```

研究组合包被加进 profile 的 `dsh.profile.bundles`,因此它的 `cordis.patch.yml` 最后应用。

## 布局

- `cordis.patch.yml` —— 组合包补丁(传输端口 + 研究名册)。
- `src/index.ts` —— 运行时惰性的模块标记;所有行为都在被挂载的研究包里。

## 通道配置

`research-cordis` 行配置四个部署级设置,而且**本组合包出货的是离线姿态**:`literatureSearch` 与 `citationResolver` 是 `fixture`,`prose` 是 `kind: deterministic`。

| 设置 | 决定什么 |
|---|---|
| `literatureSearch` / `citationResolver` | 检索与引文身份链读哪个目录 |
| `prose` | 正文产出步骤跑在哪条提供方路由上 |
| `casePackDirectory` | 哪个 Case Pack 驱动一次运行:七个带版本的 JSON 文件,提供问题、claim、实验配置与场景参数 |
| `packageDirectory` | 一次完成的运行把可复现包写到哪里 |

`casePackDirectory` 与 `packageDirectory` 是**部署设置,永远不是请求字段**:`runPipeline` 是可经 Remote 抵达的方法,所以由客户端提供的路径会让浏览器决定宿主读哪些文件、写到哪里。两者都把相对值解析到引擎的 `workspace` 上。

离线姿态就是产品本身:profile 在没有模型凭据、没有网络的情况下启动并跑完整个流水线,且每份产物都可复现。这样产出的正文是**演示草稿** —— 一个关于请求的纯函数,并在自己的文本里如此标注 —— 永远不是模型写出的研究发现。真实通道是显式的选择加入;`cordis.patch.yml` 结尾就是可直接粘贴的替换块,它同时需要提供方凭据与网络出口。

## 已知限制与延期工作

- 名册挂载三条插件行。两个纯库(`dsh-research-core`、`dsh-research-tools`)是依赖而不是行,因为它们不暴露 `apply`/`name`,挂上去会让 `ctx.registry.plugin` 崩溃。
- `research-cordis` 行设置 `requireResearchTools: true`。注意这个标志**不**代表什么:它无法在 `tools` 服务只是迟到时拒绝启动 —— loader 并发启动各行,那在加载期与缺席无法区分 —— 所以它让注册**失败**变得响亮,而不是让注册成为启动门禁。`ctx.research.toolsReady` 与 `ctx.research.proseRouteReady` 是两个提交点,都在真实的 1120 boot 上验证过。
- **一次离线运行会停在 A2-claim,而这正是系统在正常工作。** 出货 Case Pack 的 claim 承诺把跟驰风险降低 >=20%;而本研究自己的实验 —— 在实测需求剖面上跑的 Webster 延误模型 —— 测得 11.09%。C 闸门拒绝让一条被自身测量反驳的 claim 通过。该 pack 描述的是车队跟驰研究,而流水线的实验测的是交叉口延误,所以两者是不同的研究;靠放宽闸门、改 pack 里的数字(它六个文件被 manifest 的 `hashOfInputs` 覆盖,而它们的生成器不在这棵树里)、或挑一条与观测效应相符的 claim 走到 E2,这些路都被封死了。这条需要裁决,见 `plan/PRODUCT-CLOSURE-EXECUTION.md` 的 P3。
- 只有配置了 `packageDirectory` 时,一次运行才会写出它的包。manifest 点名的每个文件都真的被写出,并带字节数与内容摘要;内容为空的文件被略过而不是被声明,因此 manifest 从不列出幻影。
- 1120 端口只是兜底;显式传 `--port` 仍然优先,所以运维可以在不编辑补丁的情况下挪动研究服务器。

不发布不变式伴生入口:本包不携带任何自己的运行时行为,因为它的 `src/index.ts` 是一个惰性标记,因此没有 `./invariant` 入口随之发布。
