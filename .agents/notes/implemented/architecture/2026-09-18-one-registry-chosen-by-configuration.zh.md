# Agent Note: 一套按配置选择的登记处,以及一份按运行自己的键引用文献的 `.bib`

Status: implemented

[English](2026-09-18-one-registry-chosen-by-configuration.md) | 中文

## 问题

有两条链没有接上,还有第三条一直是错的。

**从文献库读到的来源无法被引用。** 引用登记处的 `reviewedSources()` 只投影检入语料,于是刚被这次运行从 Zotero 读出来的来源会出现在 A1 的台账里,却永远成不了 `SourceRecord`。引用它的句子被以 `citation-unreviewed-source` 拒绝。而且没有任何地方能说明一次运行的可引用来源**来自哪里** —— 语料是唯一的答案,「我们引用文献库持有的东西」根本无从表达。

**根本没有 `.bib` 导出。** `renderBibtex` 存在,却零生产调用点;运行包写出 `citations.json`,没有一份能交给期刊的文件。于是「稿件引用了这些作品」只是关于一个 JSON 文件的主张。

**而 `renderBibtex` 一直在给每一条改名字。** 它的注释说键走在 `citation-key` 里,而并不是。对着装好的 `@citation-js/plugin-bibtex@0.8.2` 实测:`LABEL.toSource` 只在 `isLabelSafe` 接受时才用给它的标签,而 `isLabelSafe` 拒绝任何落在它的不安全字符集里的标签 —— 从空格到 `/`、以及从 `:` 到 `@` 的两段范围，`-`、`.` 和 `/` 都在其中。本仓库铸造的每个引用键都是 `cite-<标识符>`,每个 DOI 都含这三者,于是检查把它们全部拒掉,写出器转而用作者和年份自己编了一个标签。文件里是 `@article{Roche2020What,`,而稿件引的是 `cite-10.1016/j.aap.2020.105588`。它能解析、看起来像一份参考文献表,而文中的引用在表里什么都指不到。既有用例调了两次 `renderBibtex`,一次也没断言过键。

## 决定

- **一套登记机制,按配置选择。** `SourceRegistryMode` 取 `zotero`、`curated` 或 `combined`,而 `sourcesForMode` 是把一个模式和登记处给出的东西变成「本次运行可引用的来源」的唯一地方。
- **文献库读不到的 zotero 运行没有东西可引。** 它不回退到检入语料。这正是模式与来源集合分开走的原因:一次运行悄悄引用了仓库、而不是它被指向的文献库,就发表了一份没人要的参考文献表,而交付的论文看不出来。
- **`combined` 是唯一同时取两者的模式,而且它是登记而不是合并。** 每条记录带着自己的 `registry`,于是参考文献表能说明一条条目的来处;登记项永不覆盖同一 id 的策展记录,因为两个登记处铸出同一个身份是一次冲突,而偏向其中一方会不声不响地丢掉一个来源。
- **登记项带着段落,不只是身份。** `SourceRegistration.evidence` 是一条 `EvidenceBinding` —— 条目版本、附件**及其自己的**版本、定位符、内容哈希、路线与规则版本 —— 于是对刚读到的来源的引用,其依据在读的那一刻就被记下。
- **两个版本上读成的一对会被拒绝。** `readRegistrations` 比较条目读到的版本与页读到的版本,两者不同就一个都不登记 —— 那正是 `readSource` 存在的意义所要拒绝的混合物。
- **参考文献是一道由部署提供的能力,声明在消费它的地方。** 缝是 `dsh-research-team` 里的 `BibliographyWriter`,由 `dsh-research-cordis` 以**结构孪生**实现 —— 两者是兄弟包,谁都不能导入谁,和 `matplotlib-provider.ts`、`llm-reviewer.ts` 已有的形状一样。
- **写出器被告知打印给它的标签。** `configureBibtexLabels` 设置插件自己的 `format.checkLabel` 与 `format.useIdAsLabel`,只设一次,注释里带着实测。另一条路 —— 改写渲染出的文本 —— 会让交付物的键取决于一个本仓库并不控制的标签形状。
- **渲染出来的文件在写之前被检查。** `checkBibliography` 拒绝带本地路径的、漏掉稿件所引某个键的、以及在稿件有引用时一条条目都没有的;导出遇到拒绝就抛错,而不是写出一份看起来像期刊收的那种文件。

## Alternatives considered

- **让一次运行读两个登记处并把它们并起来。** 拒绝:那正是指引禁止的自动合并,而且它让来源的来处恰好在最要紧的地方 —— 参考文献表里 —— 无法还原。
- **文献库不可达时回退到语料。** 拒绝:它把一次中断变成了一次带着别人证据的成功运行。实测验收断言的恰恰相反 —— 不可达的文献库是 `endpoint-unreadable`、空登记处,以及一个点名的失败。
- **后处理渲染出的 BibTeX,把运行自己的键换进去。** 拒绝:对交付物做字符串手术,只在写出器今天编出的标签是那个形状时才正确。
- **丢掉键被改名的那几条。** 拒绝:那会正文里留下指不到任何东西的引用,而检查存在的意义正是抓这个,不是造成它。
- **在读取时从 `citations.json` 写 `.bib`。** 拒绝:文件必须从被引用的来源一次写出,否则同一次运行的两次导出会得到不同的参考文献表。

## Consequences

- **`tests/zotero-live.spec.ts`**(新增,cordis)让真实文献库走产品自己的 MCP client 与生产 provider,Zotero 不应答时自动跳过。2026-09-18 对着 `ILFASAAE` 有八条通过:集合完整读出且含指定条目;来源以 `zotero:user:17529257:UA5MIGG3` 登记,附件 `PU2XWW83`,定位符在第 4 页;**修正后的分页调用返回 10 页中的第 4 页并剥掉工具头**,而原始回复完整留在审计记录里;超出末尾的页是 `passage-out-of-range`,不存在的条目被拒;身份在登记处、证据、引用键 `cite-zotero:user:17529257:UA5MIGG3` 与 `.bib` 中是同一个;`.bib` 由产品自己的解析器读回,title、year、DOI 相符且不含本地路径;三条失效轴各自独立移动;指向死端口的 provider 报 `endpoint-unreadable` 且无回退。
- **`tests/registered-sources.spec.ts`**(新增,team)守着句子那一半,用的是实测运行产出的那条登记项:各模式的选取、冲突规则、没人评估的句子以 `statement-unassessed` 被拒而不是继承主张的判定、在来源已不再持有的段落上作出的评估以那个理由被拒、被改写的句子以它自己的理由被拒。
- **`tests/bibliography-writer.spec.ts`**(新增,cordis)是旧用例缺的那条回归:渲染出的文件由 `checkBibtexEntry` —— 产品自己的读入器 —— 读回,而它的键必须是运行自己的。它还钉住转义用例(标题里的花括号、&、百分号、TeX 命令)以及没有 DOI 的用例。
- **支撑关系现在由模型跑通了。** `tests/zotero-evidence.e2e.ts` 按引擎的方式构造部署自己的 `LlmReviewer` —— 同一个类、同一条路由、走 prose 通道真正发送所用的真实 agent loop —— 拿**两句**话对着文献库返回的那一段问它。2026-09-18 在 `deepseek-v4-flash` 上实测:陈述第 4 页评分量表的那句答 `supported`,依据里引的是那一页自己的话;声称测到最小 TTC 的那句答 `unrelated`,依据点名了该页实际报告的是时距值。一个对什么都答 `supported` 的审查者只能过前一句。两条判定都带着该段落的 SHA-256 与审查者的版本。
- **实测验收仍然没有做到的。** 来自一个来源的两条判定不足以说明审查者可靠,两份文件也都没有这样声称。运行本身也还没有被驱动:这些用例是拿真实文献库在跑链的各部分,不是走产品自己的启动跑完 16 步。
- **已接线但尚未端到端演示的。** `renderBibliography` 由运行的导出调用,它的拒绝会中止导出,而 `package-export.ts` 由此写出 `bibliography.bib` —— 但还没有用例把一次完整运行驱动到一个包并检视磁盘上的那个文件。在有一个之前,这条导出路径是单元验证而不是集成验证。

## Files

- `packages/research/dsh-research-core/src/domain/evidence-binding.ts` —— `SourceRegistryMode` 与 `SourceRegistration`。
- `packages/research/dsh-research-team/src/runner/citation-bindings.ts` —— `SourceRecord` 带上它的登记处、获取方式与证据;`sourceRecordOf` 与 `sourcesForMode`。
- `packages/research/dsh-research-team/src/runner/bibliography.ts`(新增) —— `BibliographyEntry`、`BibliographyWriter`、`referenceEntriesOf`、`checkBibliography`。
- `packages/research/dsh-research-team/src/runner/package-export.ts` —— `renderBibliography` 与 `bibliography.bib` 文件。
- `packages/research/dsh-research-cordis/src/zotero-registration.ts`(新增)、`src/bibliography-writer.ts`(新增)、`src/zotero-bibliography.ts`(`configureBibtexLabels`)、`src/index.ts`(`tools` 就绪后读一次文献库;来源被发布并被等待)。
- 用例:`packages/research/dsh-research-cordis/tests/zotero-live.spec.ts`、`tests/zotero-registration.spec.ts`、`tests/bibliography-writer.spec.ts`、`packages/research/dsh-research-team/tests/registered-sources.spec.ts`、`tests/bibliography.spec.ts`。
