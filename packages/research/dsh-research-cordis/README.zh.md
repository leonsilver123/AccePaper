# @deepseek-ai/dsh-research-cordis

[English](README.md) | 中文

`dsh-research-core` 的 Cordis 适配器:把 16 步引擎暴露为 `ctx.research` 服务,并把七个研究工具注册到宿主真实的 `ctx.tools`。

本包是**薄适配层**:状态机委托给它,工具注册连同事务性回滚、可撤销句柄与模块私有能力一起在此实现。服务同时委托 T07/T08/T09 的纯结果面(`classifyL0` / `verifyCitation` / `evaluateGate` / `getGateIntent`),这些方法不触碰任何 run 状态。

## 部署级配置

四个字段各代表**一个**部署级选择,由引擎一次决定、全流水线共用:

| 字段 | 决定什么 | 省略时 |
|---|---|---|
| `evidenceProfile` | 本部署的证据允许属于哪一类,以及其产物能否提交(`production` 或 `evaluation`) | `evaluation`:允许合成证据,因此该 run 的产物不可提交 |
| `literatureSearch` / `citationResolver` | 检索与引文身份链打哪个目录(`fixture` 或 `openalex`) | fixture(离线) |
| `prose` | 正文步骤走哪个提供方路由 | 正文步骤输出其 fixture 文本,不调模型 |
| `document` | 这个部署拥有哪套文档工具链(`executable`,可选 `latexEngine`) | 不编译:运行照旧导出 Markdown 稿件,并在工件上记录它没有被编译 |
| `workspace` | 引擎创建的**每个** agent 会话的绝对工作目录 | `process.cwd()` |

`workspace` 不是可有可无的:`{{cwd}}` 是**严格**系统提示变量,且每个出货 bundle 的 persona 都引用它。没有工作目录的会话会在**提示装配**阶段失败 —— 在任何请求到达提供方**之前**。`prose` 行**不**重复声明目录(`ProseChannelConfig` 把它 `Omit` 掉),所以每个部署只在一处写明它。

## 已知限制与延期工作

- **稿件由文档模型编译而来,工具链是探测出来的而不是假定的**(2026-09-17):`src/pandoc-compiler.ts` 用 `pandoc` 渲染 E1 装配出的文档 —— 带块的章节、作为内联 SVG 的图、作为显示数学的公式、被参考文献表分配的编号替换掉的引用标记 —— 产出一份**自包含**的 HTML 与一份 LaTeX 源。公式用 MathML 而不是脚本:`--mathjax` 会拉进一个渲染器(自包含形式下实测 1.78 MB),而计划要的是断网也能读的成品,于是同一份文档编译出来是 14 KB 且由浏览器原生渲染(同样实测)。**格式是被探测的**:`PandocCompiler.probe` 去问可执行文件它们是什么,于是一台有 pandoc、没有 LaTeX 引擎的部署提供 `html` 与 `latex`、并以那条理由拒绝 `pdf`,而不是写出一个空文件 —— 出货 bundle 只写 `pandoc`、不写引擎,这正是本机的状态。这道缝是**结构化**满足的(与 prose 通道一样),所以本包仍然不依赖 research-team 包。**这里没有的**:本仓库的任何部署目前都还没有 PDF(任何地方都没有写出 LaTeX 引擎),所以 PDF 这条腿实现过、没被走到;编译的排版是 pandoc 的默认,不是期刊模板,因为没有任何期刊模板被读过(见 TRC 核验表)。

- **失败的轮次现在就是失败的写入,不管它吐了多少文本**(2026-09-16):失败检查曾经坐在 `LlmProseWriter.write` 的**零长度分支里**,于是一次吐出几句之后死掉的会话 —— 流中途的 provider 错误、被取消的请求、再也没回来的工具调用 —— 把那几句话当作该步的产物返回,该步也就认证了一段没有任何轮次写完的散文。现在先查失败,消息里同时带上原因与被拒的未完成文本长度。失败读的是**最后一条** `turn/end`:更早一轮失败而更后一轮成功,是一个恢复了的会话,不是一个失败的会话。
- **引用条目现在带年份,而这一条链曾经只缺提供者**(2026-09-16)。`LiteratureHit` 曾**没有 year 字段**,于是 `OpenAlexLiteratureAdapter` 把目录已经给出的 `publication_year` 丢掉 —— 一份真实运行的导出里,25 条参考文献每条都有 venue、作者与 DOI,**没有一条有年份**。渲染侧早已就绪:E1 会从每个条目读 `year`、`paper-format.ts` 的 `formatReference` 会渲染它;缺的只是提供它的人。现在 `LiteratureHit.year` 是可选字段,`toHit` 读目录的那个字段,**读不出可信年份时留空而不是编造**(`null`、`forthcoming`、五位数一律算「目录没说」),因为一个被编造出来的年份不是缺失字段,而是一条错误引用。
- 本服务**不把闸门结果自动写回 StepState**。这是刻意的设计边界(服务是纯委托层,由 driver 决定何时调用 `submitGateVerdict` / `completeStep`),而不是约定缺口——`hold_abstained` 的容身处由 core 提供(状态机把 abstained 步骤钉在 `gated` 并记 `holdReason='gate_abstained'`)。
- **工具注册改为等待 `tools` 服务出现(2026-09-14 修复)**。此前引擎在 `[Service.init]` 里直接挂载七工具插件,而 loader 是**并发**启动各 entry 的:真实 1120 boot 上实测 `ctx.get('tools')` 在引擎初始化时是 `undefined`、约 50 ms 后才出现。于是那次挂载被永久跳过,**出货 bundle 从未注册过任何一个 research 工具**,而 tolerant 分支把这个跳过吞掉了。现在改用 `ctx.inject(['tools'], …)`,注册在服务可用的那一刻提交;`ctx.research.toolsReady` 是它的提交点状态。
- `requireResearchTools` 的语义随之更正:它**不是**"没有 tools 服务就不许启动"(那个缺席在加载期无法与"还没起来"区分),而是"服务在、但注册未产出 Ours 时,抛错而不是吞掉"。出货 bundle 已设置它。
- **`pipeline_only` 工具的调用不走宿主运行时 —— 这是已接受的架构边界,不是待修的缺陷**(2026-09-14 用户裁定)。
  - 四个工具(`literature-search` / `citation-verify` / `claim-construct` / `ablation`)由**研究层直接调用**。它们**没有**进入宿主工具运行时,因此**不在**宿主的权限检查、沙箱与执行记录覆盖范围内。研究层保留自己的输入输出关联与错误记录 —— 但那**不等于**"经过宿主统一管理",**不得这样表述**。
  - **不影响它们干活,也不影响数据真假**:这四个工具照常执行,也可以处理真实数据(检索通道由 `cordis.yml` 配置,配了活目录就打到活目录)。缺的只是宿主那一层的统一管理。
  - **两条独立的事实,标签只描述其中一条**:调用方式记录在产物的 `invokerTruthfulness`(`direct_call` / `host_tool_runtime`);数据来源记录在适配器配置与产物自身的 `corpus` / `source` / `*Source` 字段。**直接调用不等于 fixture;用真实数据也不等于结论已验证** —— 两个标签合起来也不构成"这个结论被验证过"。
  - **何时再动它**:当确实需要让不可信插件、多用户或独立任务统一受权限 / 取消 / 超时 / 审计控制时,再单独启动宿主接口扩展(`packages/core/tools` 的公共接口)。**是否接真实模型不构成改造它的理由** —— 那两件事互相独立。
  - 红线不变:不得伪造 Agent、调用宿主私有方法、深度导入内部模块、恢复 agent-less 放行。

不发布不变式伴生入口:适配器的效果与拆除关系由其自身的生命周期与注册 spec 断言,因此没有任何东西作为 `./invariant` 伴生入口发布。
