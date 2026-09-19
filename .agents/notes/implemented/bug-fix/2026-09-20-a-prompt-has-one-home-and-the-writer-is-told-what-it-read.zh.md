# Agent Note: A prompt has one home, and the writer is told what it read

Status: implemented

[English](2026-09-20-a-prompt-has-one-home-and-the-writer-is-told-what-it-read.md) | 中文

## 问题

两个问题,同一个归属:本流水线递到模型面前的那段文字。

**那段文字没有住处。** 七个步骤会为模型组织一条指令 —— A1、A2、A3、B1、D2、D3、D4 —— 而每一条都是 `runner/registry.ts` 里的内联模板字符串,那个文件有五千行。这些指令所陈述的规则却住在模块里:`argument-plan.ts` 说明一节欠读者什么,`citation-bindings.ts` 说明一个带引用的句子可以主张什么。于是告诉写作者某条规则的那段文字,坐在运行这些步骤的文件里 —— 规则在一处被执行、在另一处被陈述,就是这么来的;而且没有任何测试钉住它,在一个以「到达模型的东西都被记录、可被复核」为前提的包里。

**D3 的写作者不知道所引的那份文本是什么。** 一次被驱动的运行以三条异议拒绝了 D3;第一条是关于归属的:

> The passage confirms the first-order-lag representation, its detrimental effect on safety, and the critical lag value above which safe CCC gains do not exist, but it was read in arXiv:2409.06884v1 rather than in the cited work, so the sentence's attribution of those findings to `cite-10.1109/tits.2026.3727135` is not established.

这次运行读的是作者的 arXiv 预印本;参考文献条目署名的是已发表文章的 DOI。`CorpusSource.accessNote` 恰好把这件事写清楚了 —— "read from the author preprint (arXiv:2409.06884v1) of the published article; the DOI is the article of record" —— 而它没有到达写作者。这已经是 D3 第三次因为「写作者从未拿到手的材料」而停住:先是一名册只带来源的判决而不带原文([那条 Agent Note](2026-09-20-the-writer-is-shown-the-passage-it-cites.zh.md) 已修),再往前则是只带约束、背后没有任何材料的指令。每一次评估者都是对的。

## 决定

**七条提示词按步分居 `src/runner/prompts/` 下的模块,共用一个骨架。** `prompts/skeleton.ts` 规定一条指令由什么装配而成,却对任何具体步骤一言不发:五个部分 —— 任务、本节所欠(`contract`)、回复格式(`output`)、证据规则、引用规则 —— 按此顺序装配,由 `PROSE_JOIN`(散文式回复)或 `LINE_JOIN`(每行一个带标签字段)连接。`instructionOf` 丢弃某步没话可说的部分,于是一个没有引用规则的步骤读起来就是「关于它自己那条回复的指令」,而不是一条夹着空小节的指令。`labelledLines` 把带标签的格式写成格式行(`ASSERTION: <one sentence claim>`),也就是把 D2 的修正变成可复用的一条:格式行必须可被回答,而不只是可被描述。

**这次抽取是一次搬移,而且是被测量出来的,不是被声称的。** 搬移前后各用一名记录型 writer 捕获了一次被驱动的 fixture 运行(A1、A2、A3、B1、D2、D3 ×7 节、D4,共十二条指令),两份捕获逐字节相同。`tests/prompts.spec.ts` 把每一条指令逐字钉住,于是日后改动其中一条,就是对一条被钉住的字符串做一次有意为之的编辑。搬移没有改变任何提示词的文本,因此没有版本常量随之移动;`D4_AUTHOR_INSTRUCTIONS_VERSION` 原值搬到 `prompts/d4-rebuttal.ts`,而 `AUTHOR_INSTRUCTIONS_VERSION` 这个名字不再存在。

**`accessNote` 到达了写作者,指令也点名了它。** `SourceJudgement` 带上 `accessNote`(取自 `corpusSource(doi).accessNote`);`CitationUse` 也带上它,因为一次引用记录的是**一份**阅读,而 `bindJudgements` 本来就把 `location` 与 `readScope` 一并带过;`d3Executor` 里的 `citableSources` 把它放进名册,`requestCitationsOf` 把它连同段落与段落版本记进请求日志。D3 的指令点名该字段,并按判定该句所用的那个词陈述规则 —— 归属:"What a passage establishes is established by the text it was read in, so a sentence resting on that passage attributes the finding to the text you were shown — naming the version you read where the sentence would otherwise credit the cited work with words nobody read there — and where that cannot be said truthfully of the text you were shown, write less rather than more." `PROSE_REQUEST_VERSION` 为 `prose-request-v4`。

**为什么两者都要,而不是其一。** 有材料没规则,是最先失败的那种搭配:`evidence-corpus.ts` 从一开始就记录了段落、评审人的 `rationale` 与 `scope`,而只带判决的名册要求写出一句没人能写的句子。有规则没材料,则是之后两次失败的搭配:一条写着「只能陈述那个来源所确立的东西」的指令,拿到手的写作者没读过那个来源,没法照办;一条写着「把结论归属给被读到的那份文本」的指令,没被告知两份文本不同的写作者,同样没法照办。名册带上事实,指令说明拿这个事实怎么办。

**`obligationsInstructionOf` 搬到了 `argument-plan.ts`** —— 它陈述的那些义务正是那里构建的 —— 并且返回的句子不再带尾随空格:skeleton 的连接负责分隔符,于是装配出的 D3 指令与原先拼接出来的一模一样。

## 考虑过的其他做法

- **只在指令里约束句子。** 这正是已经在这个地方失败过两次的做法。它也无法做得具体:一条告诉写作者「把结论归属给你读到的那份文本」、却不说哪个来源的文本读自另一个版本的指令,是在要求它小心一件它并不掌握的事实。被修的那次运行就是测量:写作者被告知只能陈述每个来源所确立的东西,它照旧写出了那句看起来正确的句子。
- **只把 `accessNote` 放进名册。** 因为反方向的同一个理由而不够。`accessNote` 读起来像出处("read from the author preprint...; the DOI is the article of record"),写作者可能把它读成关于语料的一条附注,而不是关于它那句句子的约束。名册上没有别的东西说明一次引用可以归属什么 —— 现有的范围条款之所以存在,正因为只有事实、没有规则会让写作者靠猜。
- **用一个检查机械地拒绝这种句子。** 拒绝:归属是对一句句子的**意思**的解读,而引用层自己的规矩是不用正则去扫描成稿文本还原意思 —— 句子唯一以类型化行内值携带的东西就是标记。本包没有任何检查能判定它,所以约束讲给写作者,由部署的句子评估者裁定 —— 那条异议正来自那里。
- **改送评审人的 `rationale` 或 `scope`。** 在[那条 Agent Note](2026-09-20-the-writer-is-shown-the-passage-it-cites.zh.md) 里已被拒绝,此处仍然拒绝:rationale 说得比段落多,而上一次运行正是这么被拒的。
- **请评估者接受「以预印本为据、引用已发表文章」的写法。** 直接拒绝,且未从其是非上考虑:评估者就是闸门,那条异议是对的,而说服它改变裁定的改动,是改闸门而不是改请求。
- **给每条提示词都配一个版本常量。** 拒绝:没有消费者的表面。版本常量的价值在于**有东西记录它**:D4 的版本盖在作者执行身份上,D3 的记录形态带 `PROSE_REQUEST_VERSION`。另外五个没人读的字符串,就是五件没人校验的东西,而逐条钉住的职责已经由 `tests/prompts.spec.ts` 承担。
- **写一个 `prompts.ts`、导出七个常量。** 拒绝:这次搬移的意义在于某一步的指令可被找到、其规则从其归属处读取;把七条指令塞回一个文件,等于把原来的问题缩小复刻一遍。这些模块在种类上也不同 —— A1、D2、D3 从运行自身的事实组织文本,而 A2、A3、B1、D4 不陈述任何随运行变化的东西,它们的材料作为请求 `context` 传递。

## 后果

- **在部署上实测,2026-09-20,`H:/dsh-boot-t30r` 上两次被驱动的运行。** 事实到达了写作者:部署写下的会话日志里存有按原样发出的请求,而被评估者拒绝的那一条旁边的名册条目写着 `"readScope": "full-text", "access": "read", "accessNote": "read from the author preprint (arXiv:2406.11508v1) of the published article; the DOI is the article of record", "source": "https://arxiv.org/html/2406.11508v1 (arXiv:2406.11508v1)"`;带归属条款的那条指令也在同一份日志里。两次运行都没有因为「把读自预印本的文字记到所引工作名下」而被拒,而第二次的异议清单是完整打印的:九条拒绝,没有一条关于归属。第一次的清单在 400 字符处被截断打印,因此只有它的第一条可比 —— `[statement-beyond-scope] 'stmt-conclusion-2' cites 'cite-10.1016/j.trb.2025.103352' … says nothing establishing the scope qualifier that the trade-off applies to coordinated CAVs among human-driven vehicles rather than to the single autonomous vehicle`,一个范围限定语,不是归属。两次运行都停在 12/16,`D3-writing: in_progress`;第二次的第一条拒绝是:
  > `[D3-writing] [statement-unrelated] 'stmt-introduction-1' cites 'cite-10.1109/tits.2026.3727135', which was assessed 'unrelated': The passage only concerns the reaction-time lag (a first-order lag) and the critical lag value above which safe CCC gains do not exist, saying nothing about a gap-to-closing-speed ratio, a minimum over a measurement window, or a platoon of one automated vehicle with two human-driven ones.`
- **这两次运行没有定论的东西,以及没有被追的东西。** D3 仍然拒绝,拒绝的类别与本次改动之前相同:一句话在报告**本研究**自己的方法 —— 它的 IDM 车队、它的随机种子、它的方程、它自己的指标 —— 同时挂着一个对这些东西一无所知的来源的引用。那是评估者对它所读句子作出的正确判断,不是本次改动引入的缺陷,也没有被去追:评估者、闸门与主张都原样未动,没有任何阈值为了让运行通过而被搬动。两次运行也不能定论那条归属异议是消失了、还是只是恰好没出现 —— 换一个模型轮次就会写出不同的句子 —— 所以这里记下的是证据支持的那个更窄的说法:在这两次运行中,附注进了名册、条款进了指令之后,评估者没有提出它。
- **提示词的改动现在是可见的改动。** 模型可见文本在一个 spec 里被逐字钉住,每条指令住在以步骤命名的模块里。日后一次既改提示词、又需要版本号前进的改动,只有一个地方要做。
- **`CitationUse` 多了一个没有检查读它的字段。** 绑定上的 `accessNote` 是给人读的,不是给代码读的:它在那里,是因为引用记录正是读者用来复核的东西,而 `location` 只给出一个 URI,不说明该 URI 相对 key 所指的工作是什么。代价是 `bindJudgements` 要把这个字段从判决里拷贝过来并保持为真。
- **D3 请求按该附注的长度变大** —— 随包语料中两个读自预印本的来源,每个来源约 200 字符。语料固定为三个来源,增长随之有界。
- **提示词没有动态部分的步骤导出指令本身**(A2、A3、B1、D4),而提示词点名运行所提供之物的步骤导出组合它的函数(A1、D2、D3)。这一不对称本身是事实,不是漏掉的抽取:另外四步的材料作为请求 `context` 传递,而一个不接收参数的函数并不会说出常量之外的话。

## Testing

- `tests/prompts.spec.ts` —— 骨架的装配顺序、某步无话可说的部分缺席、带标签格式的辅助函数,以及七条指令逐字钉住(含 D4 的作者指令版本)。
- `tests/citation-binding-run.spec.ts` —— 被驱动运行发出的名册为每个来源带上 `accessNote`,与语料自身的附注相等,且 D3 的指令含点名该字段的条款。
- `tests/statement-bindings.spec.ts` —— `judgementsFor` 带上语料的 `accessNote`;段落读自预印本的判决会说明这一点、并说明哪个 DOI 是记录中的文章;记录下来的 `proseRequests` 条目带上该附注;`proseRequestVersion` 为 `prose-request-v4`。
- 两项关于抽取的断言在测试套之外被测量:搬移前后各捕获一次被驱动的 fixture 运行,指令逐字节相同;上面那次部署运行则把该事实从会话日志里读了回来。
