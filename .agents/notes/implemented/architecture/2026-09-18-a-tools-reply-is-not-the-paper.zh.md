# Agent Note: 工具的回复不是论文,DOI 也不是可引用的前提

Status: implemented

[English](2026-09-18-a-tools-reply-is-not-the-paper.md) | 中文

## 问题

有两样东西被当成了证据,而它们都不是。

**第一样是 provider 自己的输出。** `ZoteroProvider.readPassage` 接受 MCP 工具返回的任何文本,并把它当作来源自己的话去哈希。2026-09-18 对着真实文献库实测,那段文本不是论文:

- `zotero_read_pdf_pages` 的回复是 `# PDF Pages 1-1 of <标题>` / `**Item Key:** UA5MIGG3` / `**Total pages in PDF:** 10` / `## Page 1`,然后才是那一页。这层外壳是服务器自己的呈现方式,哈希整个回复就是连它一起哈希。
- `zotero_get_item_fulltext` 的回复是一段 `*Response size: ~16K tokens…*` 前言、一个 `**Type:** / **Item Key:** / **Date:** / **Authors:** / **Journal:** / **DOI:** / **ISSN:** / **URL:**` 头块、渲染后的正文,以及参考文献表。本仓库此前记作「已读」的那 65,074 字符「全文」**就是这份渲染**,不是文章。
- 在装上它的 PDF 附加组件之前,`zotero_read_pdf_pages` 的回复是 205 字符的 `PyMuPDF is required for PDF page reading. Install it with: pip install 'zotero-mcp-server[pdf]'…` 提示 —— 非空、点得出条目,而旧的读法会把它当作第 1 页写进证据链。

分页回复带着页码,这正是它读起来干净的原因:指引里的规矩是分页输出也必须检查,因为带页码不等于没有包装。

**第二样是 DOI。** `ZoteroLiteratureAdapter` 曾经拒收任何没有 DOI 的集合条目,理由是流水线按标识符引用。这是把 DOI 当成了它并不是的东西。来源的身份是文献库加 item key —— `zotero:user:17529257:UA5MIGG3` —— 本模块本来就铸造它;DOI 是**外部**标识,用于交叉核对与去重。一本书陈述 ISBN,一篇预印本陈述 arXiv 号,一份报告两者都没有,而这三者在任何期刊样式里都可引用。旧规矩把一条实现限制说成了学术规范,而更正必须讲清楚它是哪一条。

## 决定

- **回复先被分类,没被分类的回复不是证据。** `readPage` 要求回复**就是**实测中工具产出的那个形状 —— 首行 `# PDF Pages <a>-<b> of …` 且点明本页、恰好一个本页的 `## Page <n>` 标记、一行 `**Total pages in PDF:** <n>` —— 标记之后的一切才是那一页。规矩是正向要求而不是一张要剥掉的前言清单,因为黑名单在服务器第一次写出新前言时就已经错了,而上面那份安装提示正是一个「剥壳器」会照单交出去的回复。
- **回复被留下,证据被单独哈希。** `ToolReplyAudit` 原样保存回复并附它自己的 SHA-256 与长度;`contentSha256` 是对提取出的那一页算的。哈希回复会让证据的版本取决于服务器的呈现方式。
- **分不开的那条路线是导航,而它的类型就这么写。** 见下。
- **判断所依赖的每一个版本都跟着这一页走。** `itemVersion` 在元数据被编辑时移动,`attachment.version` 在文件被替换时移动,`contentSha256` 在文字改变时移动。三者互不蕴含,而指引明说附件变更不一定推动父条目。
- **必须指定页,附件的归属也必须能立起来。** 工具吃的是条目、自己挑文件,所以一个 PDF 可归属,两个不可归属;猜一个会把判断的失效绑定到错误的文件上,而它看起来还像个事实。
- **命名空间取记录自己陈述的那一个。** 依次是 `doi`、`isbn`、`arxiv`,都没有时是 `unknown` 并带上本次运行自己的身份。为此把 `LiteratureRefKind` 拓宽到 core 的 `CitationIdKind`;一个只能表达 `doi` 与 `arxiv` 的 ref 只能丢掉一本书。
- **没有 DOI 不是拒绝理由,没有标题才是,而且它被明确叫作实现限制。** 没有标题的记录既无法在参考文献表里被命名,也无法拿来做身份核对,所以读取停下,并说明这是本 adapter 的要求 —— 绝不是「这篇不可以被引用」。

## Alternatives considered

- **从全文回复里剥掉一段固定前缀,把剩下的当证据。** 拒绝:那份文档是服务器自己拼的,本模块总体上分不出它的拼装到哪里为止。按实测前言写死的规则,在前言一变时就错了,而且它出错的方式是静默地把服务器的散文含进去,不是拒绝。
- **按「PyMuPDF is required」匹配来识别安装提示。** 拒绝:那是已知提示的黑名单,和剥已知前言是同一个错误。正向形状检查不需要点名它就拒绝了它。
- **保留 DOI 规矩,只是改叫实现限制。** 拒绝:那条限制并不存在。身份链不需要 DOI,`.bib` 导出也不需要,这条规矩只会以一条不存在的约束为名,永久排除可引用的文献。
- **通过重读并比对页数来确定是哪个附件答的。** 拒绝:工具报告的是它读到的页数,拿它去和子条目比,等于用一个巧合去认定一个文件。拒绝才说了实话。

## 后果

- **`tests/zotero-corpus.spec.ts`** 增至 23 条。它喂给 provider 的每一段回复,都是实测中真实服务器逐字符返回过的字符串 —— 分页头、安装提示,以及**连字节序标记一起**的越界句子(解析器因此会剥掉一个 BOM)。用例断言:交出来的页里不再有 `PDF Pages` / `Item Key` / `## Page`;审计记录握着整份回复并对它哈希;安装提示以 `passage-unrecognized` 被拒;超出末尾的页是 `passage-out-of-range` 并点出文件长度;两个 PDF 是 `passage-unattributable` 并点名两者;没有 DOI 的书按 ISBN 引用,没有 DOI 的报告按自己的身份引用。
- **`readPassage` 没有了**,代之以 `readPage`(证据)与 `readFullText`(导航)。这个拆分本身就是执行手段:`ZoteroNavigation` 没有页、没有内容哈希,还带一个 `notEvidence` 字段,于是任何接受证据的地方都不可能误收一份渲染。
- **2026-09-18 实测**,对着用户指定的文献库:`read_pdf_pages` 读第 1 页、第 10 页与 2-3 的跨页,返回的页文本带着上面那个头;超出末尾的页返回越界句;错误的 item key 返回 404 块;不带 `start_page` 的 `read_pdf_pages` 被服务器拒绝,这就是该参数为必填的原因。PyMuPDF 已装进 MCP 服务器自己的 venv —— 也就是它那条提示所点名的修法;此时 Zotero Desktop 已被重新启动,本地 API 应答 `200`。
- **这里没有做到的。** 页文本里仍然有 PDF 自己印上去的版式 —— 书眉、期刊行、页脚的页码 —— 因为它们印在那一页上,而抽取器按阅读顺序把它们吐出来。所以引文必须是读者能在所点明的那一页上找到的一段;定位符就是为此存在的。抽取器不会重排页面,本笔记也不声称它会。

## 文件

- `packages/research/dsh-research-cordis/src/zotero-provider.ts` —— `readPassage` 由 `readPage` 与 `readFullText` 取代;新增 `ToolReplyAudit`、`ZoteroNavigation`、`ZoteroAttachment`、`pageTextOf`、`ZOTERO_READ_RULE_VERSION` 与三个失败码。
- `packages/research/dsh-research-cordis/src/zotero-literature-adapter.ts` —— 去掉 DOI 规矩;`refOf` 取记录自己陈述的命名空间。
- `packages/research/dsh-research-tools/src/tools/literature-search/adapter.ts` —— `LiteratureRefKind` 拓宽到 core 的 `CitationIdKind`。
- 用例:`packages/research/dsh-research-cordis/tests/zotero-corpus.spec.ts`。
