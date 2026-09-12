# @deepseek-ai/dsh-research-tools

科研流水线的七个工具实现(文献检索 / 引文核验 / claim 构造 / 消融 / 图表 / 三线表 / 路线图),以及它们的**封闭输入 schema** 与 `ResearchToolInvoker` 接缝。本包是纯库:不依赖 Cordis,注册与宿主接线由 `dsh-research-cordis` 负责。

`RESEARCH_TOOL_DIRECTORY` 是工具的审计真源:每个工具条目标注 `modelExposure`(`pipeline_only` 或 `model_ready`)并附一条 `reason` 说明该判定为何成立。工具函数本身是纯的,外部数据只经 adapter 接缝进入。

## Known Limitations and Deferred Work

- 七个工具的**输入目前全部来自 fixture**:工具函数真实执行,但喂给它们的数据是合成的,因此产出不构成真实科研结果。这是与 `runner/registry.ts` 中 `real_tool_fixture_input` 标注对应的诚实边界。
- `citation-verify` 工具**没有生产消费者**:团队侧的 B 通道走 core 的 `verifyCitation`,而非该工具;它仍注册在目录中以满足"七个工具"的名册声明。
- 外部数据源(Crossref / OpenAlex / 分区表)一律经 adapter 接缝,仓库内不附带真实凭据或未确认许可的数据集。

No invariant companion is published: the tool contracts are frozen by the directory entries and covered by the package's own specs, so no `./invariant` entry is published alongside it.
