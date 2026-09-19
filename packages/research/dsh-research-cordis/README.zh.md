---
description: "把 16 步研究引擎暴露为 ctx.research、并把七个研究工具注册到宿主工具运行时上的 Cordis 适配器,供运行研究流水线的部署使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-research-cordis

[English](README.md) | 中文

## 概述

`dsh-research-cordis` 把研究引擎交给部署:`ctx.research` 承载 16 步状态机、闸门裁决与 artifact 注册表,而引擎赖以运行的通道与目录 —— 检索目录、引文解析器、prose 路由、文档工具链、绘图解释器,以及一次运行读写的位置 —— 在它的 `Config` 里一次说清。它同时把七个研究工具注册到宿主的 `ctx.tools` 上,因此一次运行既可经宿主工具运行时、也可经自己的执行器路径到达它们。profile 需要跑研究流水线时选它;`dsh-research-tools` 与 `dsh-research-core` 是它的库,不是要挂载的行。`evidenceProfile` 决定本部署的证据被允许是什么,因此同一个包既承载离线演示,也承载按投稿判定的研究。

## 目录

- [部署级配置](#deployment-level-configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

`dsh-research-core` 的 Cordis 适配器:把 16 步引擎暴露为 `ctx.research` 服务,并把七个研究工具注册到宿主真实的 `ctx.tools`。

本包是**薄适配层**:状态机委托给它,工具注册连同事务性回滚、可撤销句柄与模块私有能力一起在此实现。服务同时委托 T07/T08/T09 的纯结果面(`classifyL0` / `verifyCitation` / `evaluateGate` / `getGateIntent`),这些方法不触碰任何 run 状态。

<a id="deployment-level-configuration"></a>
## 部署级配置

每个字段代表**一个**部署级选择,由引擎一次决定、全流水线共用:

| 字段 | 决定什么 | 省略时 |
|---|---|---|
| `evidenceProfile` | 本部署的证据允许属于哪一类,以及其产物能否提交(`production` 或 `evaluation`) | `evaluation`:允许合成证据,因此该 run 的产物不可提交 |
| `literatureSearch` / `citationResolver` | 检索与引文身份链打哪个目录(`fixture` 或 `openalex`) | fixture(离线) |
| `prose` | 正文步骤走哪个提供方路由 | 正文步骤输出其 fixture 文本,不调模型 |
| `document` | 这个部署拥有哪套文档工具链(`executable`,可选 `latexEngine`) | 不编译:运行照旧导出 Markdown 稿件,并在工件上记录它没有被编译 |
| `figures` | 哪个解释器装了科研绘图库(`executable`),于是 float 是被**画出来**的而不是以源码形态发出 | 内置渲染器画,每张 float 记下没有库画过它,路线图保持 Mermaid 源码、其编译产物装不下 |
| `workspace` | 引擎创建的**每个** agent 会话的绝对工作目录 | `process.cwd()` |
| `casePackDirectory` / `packageDirectory` / `snapshotDirectory` / `manuscriptDirectory` | Case Pack、run 的可复现包、持久快照、run 的工作文档分别写到哪里 | 各自什么都不写:不加载 pack、不导出包、不持久化 run、不投影文档 |

`workspace` 不是可有可无的:`{{cwd}}` 是**严格**系统提示变量,且每个出货 bundle 的 persona 都引用它。没有工作目录的会话会在**提示装配**阶段失败 —— 在任何请求到达提供方**之前**。`prose` 行**不**重复声明目录(`ProseChannelConfig` 把它 `Omit` 掉),所以每个部署只在一处写明它。

<a id="model-experience"></a>
## 模型体验

### 已注册的七个研究工具

#### 模型看到什么

在挂载本插件的部署上,七条定义都待在共享的 `ctx.tools` 注册表里,因此每条都把自己的名字、描述与参数 schema 贡献给模型请求所携带的工具列表:`literature-search`、`citation-verify`、`claim-construct`、`ablation`、`figure`、`three-line-table` 与 `roadmap`。描述是目录的标语句后接一句暴露说明,参数则是此处声明的封闭集合 —— 例如 `figure` 的 `spec`,`three-line-table` 的 `model` 与 `target`。

##### 暴露说明句

```markdown
Model-callable (pure render over declared data).
Pipeline-only research tool (registered for discovery; not exposed to agents).
```

#### Token 影响

固定。七条定义各带一句短描述与一个小参数对象,在承载工具列表的每个请求里都要再付一次;这里没有任何东西随运行增长。

#### KV Cache 影响

前缀稳定。一次注册在插件生命期内逐字节一致,不会使复用失效;改动版本或暴露会重写这组定义,并可能从第一个改变的 token 起使复用失效。

### 仅流水线工具的拒绝

#### 模型看到什么

agent loop 对四个 `pipeline_only` 工具之一的调用会在分发前被拒绝,模型收到的是该次调用的错误结果。

##### 仅流水线工具的拒绝文本

```markdown
[<toolId>] is pipeline-only (injected-adapter/fixture input); it is registered for discovery and internal pipeline use only — not executable through the agent tool runtime
```

#### Token 影响

每次被拒的调用留一句固定文本,直到压缩把它遮蔽。

#### KV Cache 影响

仅追加;拒绝文本位于可复用请求前缀之后,不会使它失效。

### 正文与复核路由

#### 模型看到什么

产出正文的步骤与那两条复核缝,经本包在 `Config.prose` 与 `Config.review` 指定的路由上创建的 agent 会话抵达模型;请求携带组合树贡献的系统提示词与调用方自己的指令,本包不添加任何自己的提示词文本 —— 它决定会话跑在哪个提供方与模型上。

#### Token 影响

本包不带来固定 token。每个请求的花费是组合出的系统提示词与调用方指令的花费,本包决定的是路由而不是文本。

#### KV Cache 影响

每个会话彼此独立:每次调用都是自己的模型请求、自己的前缀,因此既不复用、也不使别的会话的缓存条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **工作目录装着一次 run 维护的那一份文档,而它需要一套文档工具链**(2026-09-19):`manuscriptDirectory` 与它旁边三个目录同样解析 —— 一个**部署**设置,因为 `runPipeline` 是 Remote 方法,由请求给出的路径等于让浏览器决定宿主往哪写文件。它的全部用途就是装一份人可以编辑、再交回来的文档,因此**点名它却不点名 `document` 的部署在加载时就被拒**,理由一并给出,而不是在第一次 run 的最后一步才发现。**`PandocCompiler.read` 是编译那道缝的另一个方向**:`.tex` 以文本进、`.docx` 以字节进,回来的是 Markdown 加上这次转换**没有**带回来的东西 —— Word 批注靠 OOXML 包里真实存在的 `word/comments.xml` 部件来判定,所以那是该文件确实有时才报的损失,而不是对每个 `.docx` 都宣称的损失。PDF 与 HTML 都以「读不回来的格式」被拒:一个是渲染产物,另一个不是人编辑的那份文档。**这里没有的**:这张损失表是这个读者**检测到**的东西,不是「其它什么都没丢」的证明 —— pandoc 转换错了却没丢掉的那个 Word 特性不会被点名。

- **PDF 这条路真的在要 PDF,而编译产物装不下的图会被点名而不是丢掉**(2026-09-17,R01/R02):PDF 分支此前传 `-t latex --pdf-engine=…`、取 pandoc 的 stdout 写成 `manuscript.pdf` —— 本次复核复现:**退出码 0、没有 `%PDF-` 头、内容是 LaTeX 文本**。现在它把 LaTeX 源渲染到文件、对**那个文件**跑引擎、把 `.pdf` 按**字节**读回(编译产物的 `encoding: 'base64'`),并拒绝:非零退出、什么文件都没写、或写出的头五个字节不是 `%PDF-` 的引擎。**图需要它所在格式能读懂的渲染**:HTML 内联工具画出的 SVG,LaTeX 不支持 SVG,因此内联**同一个工具、同一份 spec** 产出的 PNG,两者都作为资产随文档一起走(`assets/figure-1.png`),于是一份 `.tex` 在运行之外也能构建。**路线图不是图**:Mermaid 块是源码,因此没有静态渲染的路线图会在两种格式下都被报成 NOT EMBEDDED(`assets.dropped`),而不是被打上一个图号印出来;携带它的投稿级编译会被 `compile-asset-unembeddable` 拒绝。**这里没有的**:不点名绘图 provider 的部署,其路线图仍然只有 Mermaid 一种形态,所以它的包会把那个 float 报成文档装不下的东西。

- **Zotero 附件的文件本身可以被读出来,且要么按一个版本读、要么不读**(2026-09-19):`src/zotero-provider.ts` 新增 `readAttachment(itemKey, attachmentKey)`,返回文件的字节连同 `sha256`、`size` 与附件的 `{ key, version, contentType, filename }` —— 一个读者要证明「存下来的副本就是这次读出来的副本」所需的全部 —— 并且**除非部署打开它,否则它是关的**:`sourceLibrary.attachments`(`zotero` 通道上则是 `literatureSearch.attachments`)取 `'none' | 'local-cache'`,**省略即 `'none'`**,此时该方法以 `attachment-disabled` 拒绝,且**一个请求都不发**。**端点是报出文件在哪,不是把文件送出来** —— 对 Zotero 9.0.6 实测:`GET {apiBase}/{library}/items/{attachmentKey}/file` 回 `302` 与 `Location: file:///…/storage/<key>/<name>.pdf`、正文为空,而跟随这个重定向会被 Node 的 HTTP 层以「URL scheme must be a HTTP(S) scheme」拒绝,因此这次读是解析出位置、再到**那里**取字节;直接把字节流出来的库则按原样使用,而一个不在这台机器上的位置会被拒绝而不是被跟随。**「一个版本」这条规则就是来源那条规则**,只是用在文件上:附件的记录在取字节之前读一次、之后又读一次,两次之间版本动过的文件以 `version-moved` 拒绝 —— 这里刻意**不重试**,因为更晚版本的字节会是一份关于错文件的、自洽的记录。`sha256` 就是实际返回的那串字节的哈希,并且**没有任何路径离开这个模块**:失败句子给出错误码(`ENOENT`)而不是这块磁盘把文件放在哪 —— 理由与下面那条不变的 `.bib` 规则相同。**`.bib` 那条规则毫发无损**:这里不新增 `file = {…}` 字段、不存路径,字节的位置从不进入任何产物;覆盖它的是 `tests/zotero-attachment.spec.ts`(12 个用例:正常路径、版本移动的拒绝、非 PDF 附件、条目并不持有的 key、流式返回、非 `file://` 的位置、本地存储里已经没有的文件、只给状态不给位置、端点不可用,以及 `'none'` 的两种写法)加上 `tests/zotero-live.spec.ts` 里的一个实测用例。**这里没有的**:没有任何东西把文件存到别处 —— 把文件写到稿件旁边是 run 的事,不是 provider 的事 —— 字节自身的 `%PDF-` 头也没有被断言;这次读检查的是文献库自己记录里写的内容类型,也就是 `readPdfAttachments` 早就在用的同一条规则。

- **返回的文献条目是关于某个来源的主张,要当主张来核对**(2026-09-18,P18-07):本地 Zotero 路线喂给证据链 —— 不需要 Web API key —— 而 `src/zotero-bibliography.ts` 承担其中不需要服务器的两半:返回的条目是不是它自称的那个来源,以及一个来源的身份是什么。**身份是「文献库 + item key」**(`zotero:<type>:<id>:<key>`)—— item key 只在一个库内唯一,两个库可以各有一个同 key 的条目;citeKey 单独存放,它是**稿件印出来的**名字,由引用登记处分配。`checkBibtexEntry` 拒绝:工具失败信息被当成条目、被改名的键、错 DOI、不同标题、不一致年份、空作者字段,以及一次返回两个条目 —— 而且**什么都不修**,因为被悄悄修好的字段就是一份谁也追不回文献库的参考文献表。**解析交给 `citation-js`**(`@citation-js/core@0.8.2` + `@citation-js/plugin-bibtex@0.8.2`,精确版本;两者都不带类型,故以 `src/citation-js.d.ts` 声明被消费的那点面),正因如此 `Th{\"u}ring` 被还原成一位名叫 Thüring 的作者。**`.bib` 由解析后的结构渲染**:指明某台机器把 PDF 放在哪的 `file` 在工具返回里、不在写出器输出的字段中,所以它的缺席是构造上的;而本次运行的键走 `citation-key` —— 实测写出器**忽略 `id`**,没有它会按作者与标题自己编标签。**这里没有的**:读文献库、读全文或指定页、判断某句是否被证据段落支持,都是各自的验收;元数据与 `.bib` 的成功不代替它们。**另外,本仓库早先的一个结论是错的**:`export_bibliography` 需要 Web API 的 CSL 引擎、在本地失败,曾被读成「本地路线产不出 BibTeX」—— 元数据工具的 `bibtex` 格式是本地实现,而且能用。

- **稿件由文档模型编译而来,工具链是探测出来的而不是假定的**(2026-09-17):`src/pandoc-compiler.ts` 用 `pandoc` 渲染 E1 装配出的文档 —— 带块的章节、作为内联 SVG 的图、作为显示数学的公式、被参考文献表分配的编号替换掉的引用标记 —— 产出一份**自包含**的 HTML 与一份 LaTeX 源。公式用 MathML 而不是脚本:`--mathjax` 会拉进一个渲染器(自包含形式下实测 1.78 MB),而计划要的是断网也能读的成品,于是同一份文档编译出来是 14 KB 且由浏览器原生渲染(同样实测)。**格式是被探测的**:`PandocCompiler.probe` 去问可执行文件它们是什么,于是一台有 pandoc、没有 LaTeX 引擎的部署提供 `html` 与 `latex`、并以那条理由拒绝 `pdf`,而不是写出一个空文件 —— 出货 bundle 只写 `pandoc`、不写引擎,这正是本机的状态。这道缝是**结构化**满足的(与 prose 通道一样),所以本包仍然不依赖 research-team 包。**装着引擎的地方这条路是被走到的**:`pdf-acceptance.spec.ts` 通过这个编译器、用真实引擎编译,并用真实解析器把页面读回来 —— 页数、第一节的文字在第 1 页、第二节的在其后 —— 它写出的 DOCX 也按它本来的样子(OOXML 包)被读回。引擎是检出目录内的一份 TeX Live 安装,且没有任何出货部署点名它,所以没有引擎的机器上这条用例是 skip 而不是静默通过。**这里没有的**:编译的排版是 pandoc 默认,不是期刊模板,因为没有任何期刊模板被读过(见 TRC 清单)。

- **编译器把引擎排不了的数学写成数学,只拒绝它确实排不了的东西**(2026-09-18):一份真实稿件在正文里写了 `Δ` 与 `−38.2` —— 这是对的,因为研究算出来的就是这个 —— 而 pdfLaTeX 以 `Unicode character Δ (U+0394)` 拒绝了整份文档。`TEX_MATH` 是一张显式而短的数学字符表,表内的字符被重述为 `\ensuremath{…}`;其余一切原样保留。**不用 `$…$`**:pandoc 在收尾的 `$` 后面跟着数字时拒绝把它读成数学,于是第一版产出的是字面文本 `\$-\$38.2`(实测)。只有 pandoc 经由 LaTeX 写出的那两种格式会应用它 —— HTML 是 UTF-8、DOCX 是 OOXML,两者都用读者已有的字体排这些字符。**参考文献是数据**:`西南交通大学学报：英文版` 是 OpenAlex 返回的刊名,编译器不改写它,可选的 PDF 这条路于是带着**被点名的**字符失败(`engineFailureOf` 读引擎自己的日志,所以 batch 模式的沉默不再掩盖它),而 DOCX 与 LaTeX 两种交付格式原样带着它。经由真实引擎(TeX Live 2026,pdfTeX 1.40.29)编译那份稿件得到 86 KB 的 `%PDF-1.7`,其内容流里带着正文、以数学字形排出的减号、表格单元格与两个图像对象。

- **由部署提供的复核者,以及「独立」必须意味着什么**(2026-09-18):`src/llm-reviewer.ts` 实现了 team 包声明、却从未有部署填过的两道缝 —— 一段文字是否确立了**这一句**,以及一次修订是否答复了它为之写下的那条意见。它建在 `LlmProseWriter` 之上以取其失败处理,并且只决定两件事:判定与依据。阅读范围是从 judgement 复制的,因为判定不能声称依赖比已做的阅读更宽的阅读;身份、两个内容版本、复核者的版本与时间戳由类填写,因为一个能写下自己出处的读者能认证任何东西。**没有判定、或判定不在已知集合内的回复一律抛错**,而不是取默认值 —— 这道缝存在的理由正是「没人能读这句」与「这句成立」是两件不同的事实。**身份是路由**(`llm:<provider>/<model>`,绝不是角色标签),所以在写下答复的那条路由上配置的复核者会被 D4 的独立性检查拒绝,而不是换个名字通过。出货 bundle 启用了 assessor,并把 verifier 留空、理由写明:本部署的正文就写在同一路由上,点名它会让 D4 拒绝每一次验证。

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

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
