---
description: "research 分组：一条 16 步的 claim 流水线，每一步都必须先通过红队投票、外部锚与可证伪实验，才能推进。"
kind: "package-group"
---

# packages/research

[English](README.md) | 中文

## 概述

本分组是这个 fork 的科研论文生产系统。它的前提是"AI 生成的科学主张不可信",所以它**不**端到端地写论文:它只驱动**一条 claim** 走完 **16 步流水线**,而每一步只有通过 **A/B/C 判决三元组**才能推进 —— A 是红队投票,B 是外部锚,C 是一条可证伪的预测,由实验来裁定。三元组无法收敛的步骤以 `abstained` / `hold` 收尾,**永远不会**变成通过。步骤分 A–E 五个阶段(从 `A1-landscape` 到 `E2-submit`),其中 `E2-submit` 是唯一的人工门,只能经 `./host` 子路径抵达,永远不能经 `ctx.research` 触发。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx key |
|---|---|---|
| [`dsh-research-core/`](dsh-research-core/README.zh.md) | 16 步状态机、L0 分层路由、引用核验、门禁裁定与持久化快照存储。零依赖。 | 库 —— 无 ctx key |
| [`dsh-research-tools/`](dsh-research-tools/README.zh.md) | 七个产物工具、它们封闭的输入 schema,以及 `ResearchToolInvoker` 接缝 | 库 —— 无 ctx key |
| [`dsh-research-cordis/`](dsh-research-cordis/README.zh.md) | 暴露 `ctx.research`,并把七个工具(含 agent-loop invoker)注册到真实的 `ctx.tools` | `ctx.research` |
| [`dsh-research-team/`](dsh-research-team/README.zh.md) | 红队编队、CAS 修订任务板、写作用域守卫与持久会话投影 | `ctx.agentTeams` |
| [`dsh-research-web/`](dsh-research-web/README.zh.md) | 双面插件:宿主面惰性,浏览器面挂载研究标签页 | 无 ctx key |

依赖是单向的:`core` ← `tools` ← {`cordis`, `team`}。`web` 不依赖其中任何一个,只经 slot 与宿主相接。可安装的组合体 —— 也就是挂载参考部署的那个补丁层 —— 是 `packages/bundle/` 下的 [`dsh-research-app`](../bundle/research-app/README.zh.md)。

-----

<a id="related-documentation"></a>
## 相关文档

- [Research 子系统](../../docs/subsystems/research.zh.md) —— 流水线、三元组、持久形式与 Cordis API。
- [架构](../../docs/architecture.zh.md) —— 轮次流转,以及新行为该放在哪里。
- [研究应用 bundle](../bundle/research-app/README.zh.md) —— 挂载本分组的纯补丁 bundle。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作要点 —— 点击展开</summary>

- **出货 profile 不会挂载这个应用。** `@deepseek-ai/dsh-research-app` **不在** `PROFILE_TEMPLATES`(`packages/boot/app-boot/src/profile.ts`)里,所以单跑 `dsh web --profile web` 不会挂载它。要把它加到 profile 的 `dsh.profile.bundles` 里、排在 `dsh-base` 与 `dsh-web-app` 之后;补丁随后会把 webserver 的兜底端口从 3080 改成 **1120**。显式传 `--port` 仍然优先。
- **服务名 `agentTeams` 与** `packages/experimental/agent-team` **共用**。两个都挂载会冲突。
- **`pipeline_only` 工具目前停在 fixture-only 证据**,原因是 `ARCH-BLOCK-01`。用伪造 `Agent`、调用私有方法、深度导入宿主内部或恢复无 agent 的直通来关闭它,都是禁止的([根指引](../../CLAUDE.md))。
- **这些包目前不满足仓库的逐文件覆盖率门禁**,导出面的 JSDoc 也不完整。两者都是已知项,登记在 `plan/REMAINING-WORK.md`,而不是被默默容忍。

</details>
