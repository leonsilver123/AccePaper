---
description: "科研流水线的七个工具实现、它们的封闭输入 schema 与 ResearchToolInvoker seam,供把它们注册到宿主上的适配器使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-research-tools

[English](README.md) | 中文

## 概述

科研流水线的七个工具 —— 文献检索、引文核验、claim 构造、消融、图表、三线表与路线图 —— 每个都是纯函数,带一份封闭输入 schema,以冻结的 artifact 作答。宿主经注入的适配器提供语料,因此同一个工具无需改代码即可跑在 fixture 语料或实时目录上,`ResearchToolInvoker` 是宿主执行其中一个工具的 seam。注册到 `ctx.tools` 由 `dsh-research-cordis` 负责,因此本包不依赖 Cordis,也没有自己的 `ctx` 面。每个工具在 `RESEARCH_TOOL_DIRECTORY` 中声明其模型暴露与判定理由。

## 目录

- [工具目录](#the-tool-directory)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="the-tool-directory"></a>
## 工具目录

科研流水线的七个工具实现(文献检索 / 引文核验 / claim 构造 / 消融 / 图表 / 三线表 / 路线图),以及它们的**封闭输入 schema** 与 `ResearchToolInvoker` seam。本包是纯库:不依赖 Cordis,注册与宿主接线由 `dsh-research-cordis` 负责。

`RESEARCH_TOOL_DIRECTORY` 是工具的审计真源:每个工具条目标注 `modelExposure`(`pipeline_only` 或 `model_ready`)并附一条 `reason` 说明该判定为何成立。工具函数本身是纯的,外部数据只经适配器 seam 进入。

<a id="model-experience"></a>
## 模型体验

### 研究工具目录条目

#### 模型看到什么

目录提供宿主注册的每一条研究工具定义的名字与描述首句:`literature-search`、`citation-verify`、`claim-construct`、`ablation`、`figure`、`three-line-table` 与 `roadmap`。暴露为 `model_ready` 的三个条目以下面这些句子开头。

##### 模型可调用的条目标语

```markdown
Deterministic SVG + real-byte PNG data-figure render over a declared spec.
One structured model rendered as GitHub Markdown (3 rules) or LaTeX booktabs.
Phase-layered roadmap figure render (figure family of D1).
```

#### Token 影响

固定。七个工具名与各一句标语随工具定义在承载它们的每个请求中一起发送,目录不会随运行推进增加任何文本。

#### KV Cache 影响

前缀稳定。给定目录修订下这些名字与标语逐字节一致,不会使复用失效;改动某条 `summary` 或 `toolId` 会替换工具定义前缀的一部分,并可能从第一个改变的 token 起使复用失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **`LiteratureHit` 现在带年份**(2026-09-16):它此前**没有 year 字段**,于是每个适配器都无法交出目录已经给出的年份,而下游的渲染早已准备好读它。新字段可选,**缺失即"来源没说"**——适配器不得用占位年份填空,因为编造出来的年份会让一条无法定位的引用看起来完整。合成语料也带上年份,好让渲染分支被 fixture 而不是只被实时目录练到。
- 七个工具的**输入目前全部来自 fixture**:工具函数真实执行,但喂给它们的数据是合成的,因此产出不构成真实科研结果。这是与 `runner/registry.ts` 中 `real_tool_fixture_input` 标注对应的诚实边界。
- `citation-verify` 工具**没有生产消费方**:团队侧的 B 通道走 core 的 `verifyCitation`,而非该工具;它仍注册在目录中以满足"七个工具"的名册声明。
- 外部数据源(Crossref / OpenAlex / 分区表)一律经适配器 seam,仓库内不附带真实凭据或未确认许可的数据集。

不发布不变式伴生入口:工具约定由目录条目冻结、并由本包自己的 spec 覆盖,因此没有 `./invariant` 入口随之发布。

- **调用方式与数据来源是两个独立的事实,标签只描述前者**(2026-09-14)。`ResearchToolTruthfulness` 只有两个值:`direct_call`(研究层直接调用工具函数)与 `host_tool_runtime`(经宿主 agent-loop 铸造的工具运行时执行)。**`direct_call` 不说明数据是什么** —— 直调的不是 fixture;同理,走宿主运行时的通道也可能拿到 fixture 输入。数据是什么记录在适配器配置与产物自身的 `corpus` / `source` / `*Source` 字段上。**两个标签合起来也不等于"结论已验证"。** 四个 `pipeline_only` 工具的直调是**已接受的架构边界**,详见 `dsh-research-cordis` README。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
