# @deepseek-ai/dsh-research-tools

[English](README.md) | 中文

科研流水线的七个工具实现(文献检索 / 引文核验 / claim 构造 / 消融 / 图表 / 三线表 / 路线图),以及它们的**封闭输入 schema** 与 `ResearchToolInvoker` seam。本包是纯库:不依赖 Cordis,注册与宿主接线由 `dsh-research-cordis` 负责。

`RESEARCH_TOOL_DIRECTORY` 是工具的审计真源:每个工具条目标注 `modelExposure`(`pipeline_only` 或 `model_ready`)并附一条 `reason` 说明该判定为何成立。工具函数本身是纯的,外部数据只经 适配器 seam进入。

## 已知限制与延期工作

- 七个工具的**输入目前全部来自 fixture**:工具函数真实执行,但喂给它们的数据是合成的,因此产出不构成真实科研结果。这是与 `runner/registry.ts` 中 `real_tool_fixture_input` 标注对应的诚实边界。
- `citation-verify` 工具**没有生产消费方**:团队侧的 B 通道走 core 的 `verifyCitation`,而非该工具;它仍注册在目录中以满足"七个工具"的名册声明。
- 外部数据源(Crossref / OpenAlex / 分区表)一律经 适配器 seam,仓库内不附带真实凭据或未确认许可的数据集。

不发布不变式伴生入口:工具约定由目录条目冻结、并由本包自己的 spec 覆盖,因此没有 `./invariant` 入口随之发布。

- **调用方式与数据来源是两个独立的事实,标签只描述前者**(2026-09-14)。`ResearchToolTruthfulness` 只有两个值:`direct_call`(研究层直接调用工具函数)与 `host_tool_runtime`(经宿主 agent-loop 铸造的工具运行时执行)。**`direct_call` 不说明数据是什么** —— 直调的不是 fixture;同理,走宿主运行时的通道也可能拿到 fixture 输入。数据是什么记录在适配器配置与产物自身的 `corpus` / `source` / `*Source` 字段上。**两个标签合起来也不等于"结论已验证"。** 四个 `pipeline_only` 工具的直调是**已接受的架构边界**,详见 `dsh-research-cordis` README。
