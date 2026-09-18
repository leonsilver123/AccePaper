# Agent Note: 一个 Provider、两条本地路线，以及不能被混淆的那些状态

Status: implemented

[English](2026-09-18-one-provider-two-local-routes.md) | 中文

## 问题

P18-07 需要一条真实文献库接到证据链后面。MCP server 把集合暴露成**写给模型看的 Markdown** —— `- \`UA5MIGG3\` | What happens when… (2020-09) [PDF]` —— 建在它上面的 provider 就是在解析一个没有契约的展示决定，而参考文献表里出现一条叫 `**Item Key:**` 的条目就是这么来的。本地 HTTP API 对同一个问题给的是 JSON。

两条传输方式引出了本笔记要回答的问题：它们会不会变成两套台账？roster 走一条路、条目走另一条路，各自有自己的身份与失败状态，那就是两个系统靠运气保持一致 —— 而 P18-07 的全部要点正是「句子、引用、证据段落与 `.bib` 条目可被证明是同一篇」。

## 决定

- **一个 Provider、两条路线、一套台账。** `src/zotero-provider.ts` 用本地 JSON API 读成员关系、用 MCP client 的工具读书目条目，对外给出**一个** `ZoteroSource`：一个身份、一次版本核对、一组拒绝码 —— `readBy` 说明每一部分由哪条路线回答，读者不必让记录换形状就能分辨。
- **端点与文献库是配置，不是参数。** 能指定 URL 的调用方就能把这个 provider 指向主机够得着的任何地址。请求形状只有集合 key 与分页游标，两者都被部署自己的配置限定。
- **`users/0` 是本地别名，不是身份。** 它在每台机器上都是同一个字符串、却各指一个不同的库，所以身份由 API **返回的** library 对象铸造。别名只用来寻址本地端点。
- **集合读取要么完整，要么不算集合。** 一直翻到短页为止 —— 那是 API 自己说「没有了」的方式 —— 结果报告 `pagesRead`、`reported`、`complete`。某一页失败则以 `collection-truncated` 拒绝，并点名已经读到的东西，因为「少了几条的参考文献表」和「本来就没有那几条的语料」看起来一模一样。空集合是正常的 `ok`，是另一个值。
- **一个来源要么在同一个版本上被读完，要么不算读过。** JSON 读出条目的 `version`；BibTeX 是那次调用时库里的内容生成的。链路读元数据、读条目、再读一次元数据，有限次重试后以 `version-moved` 拒绝 —— 两个修订不是一个快照，把它们记成一个，等于把一条引用和一个从不在同一时刻存在的版本配在一起。
- **缺工具就点名，不绕开。** 没有注册 `mcp__<server>__zotero_get_item_metadata` 时以 `metadata-tool-missing` 失败。用条目自己的字段拼一个条目，会被当成 Zotero 的产物呈现，而没有任何地方记下「没有生成器跑过」。
- **每种拒绝各有自己的码。** `endpoint-unreadable`、`collection-truncated`、`metadata-tool-missing`、`bibtex-refused`（带书目拒绝明细）、`version-moved`。Zotero 没运行会以 `endpoint-unreadable` 带上原因到达，因此永远不会被读成空集合。

## 考虑过的替代方案

- **只用一个传输方式，好让代码统一。** 拒绝：唯一可用的单一传输方式是写给模型看的 Markdown，解析它会让这个 provider 的正确性取决于别处做出的一个渲染决定。
- **从 MCP 工具的 `keys_only` 输出里读 roster。** 在实测确认 JSON 路线可用之后拒绝：从 Markdown 列表里抽 key，就是给一个没有契约的格式写解析器，而且它失败的方式是返回一个更短的列表，而不是拒绝。
- **把 JSON 与 BibTeX 当作一次原子快照。** 拒绝：它们是两个时刻的两次读取，声称原子性是 provider 支持不了的主张；有限重读与拒绝才是它能给的。
- **元数据工具缺失时退回条目的 `data` 字段。** 拒绝：一个没人生成过的条目，顶着 Zotero 的名字。
- **某页失败时返回 `[]`。** 拒绝：那正是本单元要消除的混淆。

## 后果

- **`tests/zotero-provider.spec.ts`**（12 条）用脚本化的 `fetch` 与工具注册表：两页读到短页（并断言游标与页大小）；空集合是正常结果；第二页失败以 truncated 拒绝；非列表 body 被拒；来源记录 API 返回的 library 对象与 `zotero:user:1234567:UA5MIGG3`；每次都变的 version 被拒；稳定 version 被接受；DOI 冲突以 `bibtex-doi-mismatch` 拒绝；缺工具被点名；工具失败以不可解析拒绝；两个库的同 key 条目被分开；citeKey 改名后来源身份不变。
- **活的那条路线是单独实测的** —— `ILFASAAE` 里 27 条、`UA5MIGG3` 的 BibTeX 经产品自己的 client —— 这些用例**不**代替它。对着真实文献库读集合、读全文或指定页、以及判断某句是否被证据段落支持，仍然是各自的验收。
- **这里还没有的。** 运行路径上还没有消费方：它尚未接进 A1-landscape，Zotero 身份也还没绑到 core 的 `CitationRef` 或引用登记处。那一步才让「句子、引用与 `.bib` 共用一个身份」可端到端断言，它是下一个单元。

## 文件

- `packages/research/dsh-research-cordis/src/zotero-provider.ts`（新增）。
- 用例：`packages/research/dsh-research-cordis/tests/zotero-provider.spec.ts`（新增）。
