---
description: "叠加在 dsh-web-app 之上的研究表层 profile 层:把研究 web 服务器绑定到 1120 端口并挂载五个研究包,供组合或定制 profile 的用户使用。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-research-app

[English](README.md) | 中文

## 概述

把一个 profile 加上这一层就得到研究表层:`ctx.research`、`ctx.agentTeams`、浏览器工作台,以及绑定在 1120 端口而不是 web app 的 3080 兜底端口上的 web 服务器。它叠加在 `dsh-web-app` 上,后者叠加在 `dsh-base` 上;出货的 `web` profile 并不列出它 —— profile 要把 `@deepseek-ai/dsh-research-app` 加进 `dsh.profile.bundles`,排在那两者之后。本层不携带任何自己的运行时行为:它的模块是一个惰性标记,内容是那份插入各插件行、覆盖传输端口的补丁文档。一次运行读什么写什么、它的正文在哪条通道上产出,都是 `research-cordis` 行上的部署设置。

## 目录

- [它做什么](#what-it-does)
- [它如何被组合](#how-it-is-composed)
- [布局](#layout)
- [通道配置](#channel-configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="what-it-does"></a>
## 它做什么

- **把研究 web 服务器绑定到 `1120` 端口**,做法是覆盖 `webserver` 行的 `config.port` 兜底值(`!!js ctx.webStartup.port ?? 1120`),同时把 `host` / `compression*` 这些键留给 `dsh-web-app` 层。
- **挂载三条插件行**,两个纯库则作为随行依赖被传递解析:
  - `@deepseek-ai/dsh-research-cordis` → `ctx.research`(16 步引擎服务)
  - `@deepseek-ai/dsh-research-team` → `ctx.agentTeams`(编队 / 红队)
  - `@deepseek-ai/dsh-research-web` → 研究工作台宿主半边
  - `@deepseek-ai/dsh-research-core`、`@deepseek-ai/dsh-research-tools` → 纯库

<a id="how-it-is-composed"></a>
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

<a id="layout"></a>
## 布局

- `cordis.patch.yml` —— 组合包补丁(传输端口 + 研究名册)。
- `src/index.ts` —— 运行时惰性的模块标记;所有行为都在被挂载的研究包里。

<a id="channel-configuration"></a>
## 通道配置

`research-cordis` 行配置本部署赖以运行的通道与目录。出货姿态会触及实时目录与一条模型路由。

| 设置 | 决定什么 |
|---|---|
| `literatureSearch` / `citationResolver` | 检索与引文身份链读哪个目录;出货行填的是 `openalex`,因此 artifact 里的记录是真实论文,伪造的 DOI 是权威的 `not_found` 而不是 fixture 判定 |
| `prose` | 正文产出步骤跑在哪条提供方路由上;出货行填的是 `deepseek-official` / `deepseek-v4-flash`,没有该路由凭据的运行会在它第一个正文步骤失败,而不是退回 fixture 文本 |
| `review` | 由哪条路由把句子与它引文背后的段落对读、由哪条路由复核一次修订,连同每个角色的规则版本与本部署要求的评审轮次下限 |
| `document` | 本部署拥有哪套文档工具链;出货行填的是 `pandoc` 而没有 LaTeX 引擎,因此提供 `html`、`latex` 与 `docx`,只有探测到引擎时才提供 `pdf` |
| `figures` | 哪个解释器装有科学绘图库;出货行没有填,因此由内置渲染器绘制,每个浮动体都记录没有库绘制它 |
| `casePackDirectory` | 哪个 Case Pack 驱动一次运行:七个带版本的 JSON 文件,提供问题、claim、实验配置与场景参数 |
| `packageDirectory` / `snapshotDirectory` / `manuscriptDirectory` | 一次完成的运行把可复现包、它的持久快照、以及它在磁盘上维护的那份文档写到哪里 |

`casePackDirectory`、`packageDirectory`、`snapshotDirectory` 与 `manuscriptDirectory` 是**部署设置,永远不是请求字段**:`runPipeline` 是可经 Remote 抵达的方法,所以由客户端提供的路径会让浏览器决定宿主读哪些文件、写到哪里。每个都把相对值解析到引擎的 `workspace` 上,而省略某个就什么都不写 —— 不加载 pack、不导出包、不持久化运行、不投影文档。

另有两个设置说明本部署可以主张什么。`evidenceProfile` 在出货行里是 `evaluation`:评估型运行可以用任何证据类别驱动,而它的全部产出都被标记为不可投稿,因此演示无法携带投稿的身份。`stepTimeoutMs` 被抬到 `900000`,因为注册表里的单步预算是照离线正文路由写的(它在毫秒级作答),而模型路由每步要花几秒。

<a id="model-experience"></a>
## 模型体验

通过每一条插入的插件行间接产生影响,由各包负责其行的模型可见行为。

#### KV Cache 影响

本组合包不添加任何自己的请求前缀。它做的端口覆盖是传输配置,永远不会进入模型请求,因此任何缓存影响都属于那些插入行所属的包。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 名册挂载三条插件行。两个纯库(`dsh-research-core`、`dsh-research-tools`)是依赖而不是行,因为它们不暴露 `apply`/`name`,挂上去会让 `ctx.registry.plugin` 崩溃。
- `research-cordis` 行设置 `requireResearchTools: true`。注意这个标志**不**代表什么:它无法在 `tools` 服务只是迟到时拒绝启动 —— loader 并发启动各行,那在加载期与缺席无法区分 —— 所以它让注册**失败**变得响亮,而不是让注册成为启动门禁。`ctx.research.toolsReady` 与 `ctx.research.proseRouteReady` 是两个提交点,都在真实的 1120 boot 上验证过。
- **出货 Case Pack 的一次运行会停在 A2-claim,而这正是系统在正常工作。** 出货 Case Pack 的 claim 承诺把跟驰风险降低 >=20%;而本研究自己的实验 —— 在实测需求剖面上跑的 Webster 延误模型 —— 测得 11.09%。C 闸门拒绝让一条被自身测量反驳的 claim 通过。该 pack 描述的是车队跟驰研究,而流水线的实验测的是交叉口延误,所以两者是不同的研究;靠放宽闸门、改 pack 里的数字(它六个文件被 manifest 的 `hashOfInputs` 覆盖,而它们的生成器不在这棵树里)、或挑一条与观测效应相符的 claim 走到 E2,这些路都被封死了。这条需要裁决,见 `plan/PRODUCT-CLOSURE-EXECUTION.md` 的 P3。
- 只有配置了 `packageDirectory` 时,一次运行才会写出它的包。manifest 点名的每个文件都真的被写出,并带字节数与内容摘要;内容为空的文件被略过而不是被声明,因此 manifest 从不列出幻影。
- 1120 端口只是兜底;显式传 `--port` 仍然优先,所以运维可以在不编辑补丁的情况下挪动研究服务器。

不发布不变式伴生入口:本包不携带任何自己的运行时行为,因为它的 `src/index.ts` 是一个惰性标记,因此没有 `./invariant` 入口随之发布。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
