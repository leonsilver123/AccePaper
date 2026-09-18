# Agent Note: 一次运行检索什么、可以引用什么,是两个问题

Status: implemented

[English](2026-09-19-what-a-run-searches-and-what-it-may-cite.md) | 中文

## 问题

一个字段同时回答了两个问题。`literatureSearch` 既决定 A1 拿什么检索领域版图,又决定稿件可以引用哪些来源 —— 于是为了**引用**而把一次运行指向一个策展文献库的部署,顺带也把它的**检索源**换成了那个库。

2026-09-19 实测。库是 27 条接管研究的集合;研究的问题是关于车队的最小碰撞时间。A1 把它的 topic 当成一段**研究方向**传下去 —— 一个句子 —— 而 Zotero adapter 的过滤要求其中每个词都出现在标题或摘要里。一条都不匹配。空结果按设计是普通的 `ok`,于是 A1 **通过**了,而这份空在四步之后才浮出来:运行包里的 `ledger: []` 与 `citations: []`、一篇没有任何引用的草稿、一段流水线拒绝撰写而不是编造的参考文献,以及被红队检查挡住的 D3。

所有人都把这读成内容问题 —— 集合讲的是另一个题目 —— 而它有一半是。但那个集合是**为引用**而被指名的,不是为检索,而当时没有办法这样说。

## 决定

- **`sourceLibrary` 是它自己的配置。** 它指名一次运行从哪个库引用 —— 端点、本地库路径、MCP 命名空间、指定条目、登记模式、工具等待窗口 —— 并且与 `literatureSearch` 无关。
- **字段是共享的,不是复制的。** `LiteratureChannel` 的 `zotero` 变体就是 `{ kind, collectionKey } & SourceLibraryConfig`,于是一个确实想把集合**当作**版图检索源的部署只写一次就两者都有。
- **旧行为仍然可用。** 没有 `sourceLibrary` 时,`literatureSearch.kind: 'zotero'` 的运行照旧从 channel 解析它的库;既有路径一点没变。
- **失败语义未变。** 读不到的库仍然**没有**可引用来源,绝不回退到检入语料。

## Alternatives considered

- **放宽 Zotero adapter 的话题过滤,让集合不再返回空。** 对这个部署而言是错的修法:集合讲的不是这个研究的问题,放宽之后返回的是拿接管论文当车队 TTC 研究的版图 —— 那是**错的**语料而不是小的语料,而且过滤并不是让配置无法表达本意的那一环。(过滤本身的严格性另有一说 —— 研究方向不是关键词表 —— 但那是它自己的事,不能拿来代替这一条。)
- **保留一个字段,再加一个「顺便也检索它」的布尔量。** 拒绝:这两个问题的答案往往不同,而布尔量会把其中一个变成例外。
- **`sourceLibrary` 缺席时从 `literatureSearch` 推导。** 采纳了,这正是让既有一切部署继续工作的原因;要点在于**显式**指名一个库不再把检索源一起拖走。

## Consequences

- **`tests/zotero-source-readiness.spec.ts`** 增加了钉住这个分离的用例:`literatureSearch` 是 OpenAlex、`sourceLibrary` 是 Zotero 集合的运行,仍然登记了指定来源,且没有失败。
- **2026-09-19 在真实 profile 上实测**:`literatureSearch = {"kind":"openalex"}` 与指名该集合的 `sourceLibrary` 并列,部署的引擎报告 `registrationFailures: []` 并登记一条来源 —— `zotero:user:17529257:UA5MIGG3`,证据在条目版本 3408、附件 `PU2XWW83` 的第 4/10 页,哈希 `cd53a50e…`。
- **这里没有做的。** 它没有让这个接管集合变成车队研究的文献源,也没有修 Zotero adapter 的话题过滤 —— 那是给**确实**拿集合当检索源的部署用的。两件事彼此独立,而第二件现在已经是一条没有借口的缺陷:研究方向是一个句子,要求其中每个词都命中的过滤永远什么也匹配不到。

## Files

- `packages/research/dsh-research-cordis/src/tools.ts` —— 抽出 `SourceLibraryConfig`;`zotero` channel 变体成了 `{ kind, collectionKey } & SourceLibraryConfig`。
- `packages/research/dsh-research-cordis/src/index.ts` —— `Config.sourceLibrary`,一次解析进 provider、登记、登记模式与工具等待窗口。
- `packages/research/dsh-research-cordis/tests/zotero-source-readiness.spec.ts` —— 那条分离用例。
