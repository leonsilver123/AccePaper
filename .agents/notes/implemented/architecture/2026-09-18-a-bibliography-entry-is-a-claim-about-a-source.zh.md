# Agent Note: 返回的文献条目是关于某个来源的主张，要当作主张来核对

Status: implemented

[English](2026-09-18-a-bibliography-entry-is-a-claim-about-a-source.md) | 中文

## 问题

P18-07 要的是一条真实文献链：一个 Zotero 条目经**产品自己的** MCP client 读出，它的证据支持某个句子，它的 `.bib` 条目进包，而四处指向同一个来源。读取那一半一次就成了 —— `zotero_get_item_metadata(item_key="UA5MIGG3", format="bibtex")` 经 `packages/mcp/mcp-client` 返回完整条目 —— 而顺理成章的下一步，就是把它那段文字存下来收工。

这一步正是本笔记拒绝的。流程复核点名的情形不是解析器崩掉，而是**解析得完美、却引了另一样东西**的条目：另一个论文的 DOI、文献库里没有的标题、更早版本的年份。这些每一条都渲染得出来、在纸面上看着没错，却把读者指向这份稿件从未读过的来源。

## 决定

- **两个纯的部分归 `src/zotero-bibliography.ts`，活的那个归 adapter。** 判断返回的条目是不是它自称的那个来源，以及给来源命名、使句子／引用／`.bib` 三者能被证明是同一篇 —— 这两件都不需要服务器，所以也就不靠服务器来验收。只有读文献库需要一台跑着的 Zotero。
- **身份是「文献库 + item key」。** item key 只在**一个库内**唯一：离开它所在的库，`UA5MIGG3` 什么都不指；两个库可以各有一个同 key 的条目。`literatureIdOf` 因此铸造 `zotero:<type>:<id>:<key>`，而 citeKey 单独存放 —— 它是**稿件印出来的**那个名字，由引用登记处分配并保证唯一。
- **条目与条目自己的元数据对照，而不是被信任。** `checkBibtexEntry` 拒绝：`bibtex-unparseable`（把工具失败信息当条目存下来，就是一条什么都解析不到的引用）、`bibtex-key-mismatch`、`bibtex-missing-field`、`bibtex-doi-mismatch`、`bibtex-title-mismatch`、`bibtex-year-mismatch`、`bibtex-author-unusable`。什么都**不修**：被悄悄修好的字段，就是一份谁也追不回文献库的参考文献表。
- **`citation-js` 负责解析；没有任何地方手改嵌套字段。** `@citation-js/core@0.8.2` + `@citation-js/plugin-bibtex@0.8.2`，精确版本，装在本包（消费它的那个）。它把 BibTeX 的 TeX 转义还原成真正的字符 —— 正因如此 `Th{\"u}ring` 是一位名叫 Thüring 的作者，而不是印在参考文献表里的转义串。它不带类型，所以 `src/citation-js.d.ts` 只声明本包消费的那点面。
- **`.bib` 由解析后的结构渲染，并设置 `citation-key`。** 指明这台机器把 PDF 放在哪的 `file` 字段在工具的返回里，而不在写出器会输出的字段中，所以它的缺席是**构造上的**，不是靠一条得跟着格式演进的模式。另外必须给出 `citation-key`：2026-09-18 实测，写出器**忽略 `id`**，没有 `citation-key` 时会按作者与标题自己编一个标签，于是本次运行键为 `rocheWhatHappensWhen2020` 的条目回来成了 `@article{Roche2020title,` —— 在读者顺着引用去找的那一处把来源改了名。
- **机构作者保持完整。** `World Health Organization` 以 `literal` 到达；拆成姓与名会印成 `Organization, World Health`，等于编出一个不存在的作者。

## 考虑过的替代方案

- **把工具返回的文字直接存成 `.bib`。** 拒绝：它未经核对。标题是另一篇论文的、或 DOI 漂了的回复，会被原样打包并引用。
- **用文献库的元数据去修正不一致的字段。** 拒绝：两边不一致，而哪边对不是这条检查该决定的。不一致要报给读者。
- **用写出器自编的标签。** 拒绝：它在使用处把来源改了名。本次运行分配的键走 `citation-key`。
- **索要 Zotero Web API key 让导出工具能用。** 拒绝：没有必要。`export_bibliography` 需要 CSL 引擎、在本地失败；而元数据工具在本地就能产出 BibTeX，那才是本地路线需要的能力。这是在早先一次读错工具、得出相反结论之后实测出来的。
- **用正则把 `file` 从返回文字里删掉。** 拒绝，理由正是指引里点名的：对 BibTeX 嵌套字段做正则，是标题丢掉一个花括号的常见来路。该字段之所以不在，是因为条目由一条引用该有的字段构成。

## 后果

- **`tests/zotero-bibliography.spec.ts`**（14 条）用的是真实工具逐字返回的条目：它被接受且书目字段齐全，变音符号被还原成 `Thüring`。拒绝侧覆盖工具失败信息、非 BibTeX 文本、错 DOI、被改名的键、不同标题、不一致年份、空作者字段，以及一次返回两个条目。身份用例钉住跨库碰撞，以及内部 id 在改名后依然不变。渲染用例钉住没有任何本机路径存活，以及机构作者保持完整。
- **这里没有的。** 读文献库、读全文、读指定页、以及判断某句是否被证据段落支持，都是各自的验收：元数据与 `.bib` 的成功**不**代替它们。Zotero 身份还没有绑到 core 的 `CitationRef` 或引用登记处 —— 映射已经有了，但在运行路径上还没有消费方，那是下一个单元。
- **早先的结论是错的，此处更正。** 把 `export_bibliography` 在纯本地部署里失败，读成了「本地路线产不出 BibTeX」。两个工具是不同的能力；元数据工具的 `bibtex` 格式是本地实现，而且能用。

## 文件

- `packages/research/dsh-research-cordis/src/zotero-bibliography.ts`（新增）、`src/citation-js.d.ts`（新增 —— 两个无类型依赖的声明）。
- `packages/research/dsh-research-cordis/package.json`（`@citation-js/core@0.8.2`、`@citation-js/plugin-bibtex@0.8.2`，精确版本）。
- 用例：`packages/research/dsh-research-cordis/tests/zotero-bibliography.spec.ts`（新增）。
