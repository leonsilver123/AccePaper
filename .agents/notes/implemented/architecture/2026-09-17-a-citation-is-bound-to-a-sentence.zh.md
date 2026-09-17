# Agent Note: 一条引用绑定到一句话,参考文献表绑定到引用

Status: implemented

[English](2026-09-17-a-citation-is-bound-to-a-sentence.md) | 中文

## 问题

交付那篇论文的参考文献表里有 25 个真实 DOI,而正文一句都没引。这其中的每一部分都是能工作的:检索返回记录、格式化器把它们格式化、稿件把印出来。没有任何东西把一句话绑定到一个来源上,于是没有任何东西能区分「参考文献表」与「检索日志」—— 而那 25 条就是检索日志,因为 `buildReferences` 把 landscape 扫描返回的每一条记录都变成了条目。这次运行真正读过并判定过的那三篇文献,甚至都不保证在列表里。

Q00 的质量基线从论文这一侧发现了它(`no-literature-position`,出现在一份带两条参考文献、却一条都不引的稿件上)。Q02 是让它变得不可能的那个模块:引用是关于**一句话**的断言,而只有在有人读过它背后那段文本时,它才意味着什么。

## 决定

- **`runner/citation-bindings.ts` 记录一条引用到底断言了什么。** `CitationUse` 带上陈述、来源、稳定的 `citeKey`、读到那段文本的位置、那段文本及它的 SHA-256、支持关系、读了多少、以及谁判定的。`citeKeyOf` 从**标识符**铸键(`cite-<id>`):用作者加年份拼出的键会在同一年同一作者的两篇作品上撞车,用标题拼出的键会在标题被更正时移位。
- **拒绝才是这个模块的意义。** `checkCitationUse` 拒绝:没有引文的绑定(或引的是整篇文献而不是那段文本)、比「读到的范围」更强的支持判断(只读摘要无法确立只有方法才能显示的东西)、已撤稿的来源、部署没有记录的被引来源、以及对一个根本读不到的来源作出的支持判断 —— 后者与「来源不支持该陈述」是两件不同的事实,按它本身记录。`checkCitationKeys` 拒绝两引用共用一个键。
- **参考文献表由引用派生。** D3 放进草稿的是 `bibliographyOf(citations, sources)`,`buildReferences` 已删除。检索保留它本来的位置 —— 一项研究从中取材的候选库,包仍然会带上那份 ledger —— 但一条文献出现在参考文献表里,是因为有一句话引用了它。
- **`checkManuscriptCitations` 在 E1 拒绝「看起来引了、其实什么也没引」的三种形态**,那里是正文与参考文献表在稿件成为产物之前同时在手的地方:正文引了而列表没有的键(`citation-target-missing`)、没有一句话引用的条目(`citation-entry-uncited`)、以及本次运行没有复核判断的被引来源(`citation-unreviewed-source`,引用检索命中那条正是这种)。
- **写作者被告知它可以引什么、以及怎么引。** D3 交给它 `citations`(键、该来源确立了什么、读了多少、读自何处),指令写明标记 `[@citeKey]`。E1 把每个标记印成参考文献表分配的编号 —— 同一个数组、同一个顺序,所以编号与条目不可能漂移。D4 把绑定带过去,因为一次丢掉它们的修订会把每条正确的引用变成未复核的引用,并让运行在装配处停下。

## 考虑过的其他做法

- **保留检索派生的参考文献表,把引用加在它上面。** 拒绝:那正是产出交付论文的状态。一个「论文所引之物的超集」无法对着论文检查,而每一条没人引用的条目读起来都像是这项工作所依赖的来源。
- **把引用检查放在 A 闸(`manuscript-review`)而不是 E1。** A 闸手里是稿件和一个参考文献**数量**,不是那些条目:它的引用检查拿标号去比一个下标范围,所以它看得见五条列表里的 `[7]`,看不见一份没人引用的五条列表。E1 是两半同时存在的第一处。
- **让写作者去引,参考文献表跟着正文走。** 那是把 `bibliographyOf` 反过来跑,会让 `citation-entry-uncited` 不可达 —— 列表由引用算出来,就永远不可能与它们不一致。检查必须能够触发,而它防的那个失效(模型陈述了文献位置却一句不引)是真实存在的:运行自己的测试驱动的正是它。
- **要求稿件按句子铸出 `statementId`。** 这是延后,不是拒绝:它需要 M04 建立的章节契约,而在那之前,引用所针对的陈述就是复核判断真正回答的那个槽位(`introduction:prior-work`)。

## 后果

- **这个缺陷会被拒绝,而且这条拒绝是本仓库自己的测试。** `tests/citation-binding-run.spec.ts` 驱动一次运行:引言陈述了文献位置却一句不引 —— E1 报 `citation-entry-uncited`,该步骤停在 `in_progress`,`formatted-manuscript` 不存在。第二个用例驱动一个引用了语料中不存在的键的模型,同时拿到 `citation-target-missing` 与 `citation-unreviewed-source`。
- **出货运行现在真的会引。** 对同一次运行的包做同样的读法:正文带 `[1] [2] [3]`,参考文献表正好三条,而 `citations.json` 把检索 ledger 与引用分开,后者每条都带自己的引文。
- **Q00 的 `no-literature-position` 读数已从这次运行的包里消失**,因为陈述文献位置的那句话现在引用了它所依赖的来源。Q00 报的另一条(六个没人引用的 float)没有动:那是 Q03/Q04 的工作。
- **这里没有覆盖的。** 只有部署已复核的语料可以被引用,所以文献位置建立在三个人读过的来源上;`missingSourceFields` 对它们全部报 `locator` 缺失,因为语料没有记录卷、页或文章号,而一次运行无法引用一个没人记录过的字段;引用所针对的陈述目前是一个固定槽位,而不是稿件按句子命名的东西。

## 文件

- `packages/research/dsh-research-team/src/runner/citation-bindings.ts`(新增)、 `runner/registry.ts`(删除 `buildReferences`,新增 `referenceEntriesFor`、`priorWorkSentence`, D3 的绑定与写作上下文,D4 带上 `citations`,E1 的编号与拒绝)、 `runner/package-export.ts`(`citations.json` 里引用与 ledger 并列)。
- 测试:`tests/citation-bindings.spec.ts`、`tests/citation-binding-run.spec.ts`、 `tests/d4-model-revision.spec.ts`(D3 的回复现在引用请求列出的来源,那本来就是它所代扮的写作契约)。
