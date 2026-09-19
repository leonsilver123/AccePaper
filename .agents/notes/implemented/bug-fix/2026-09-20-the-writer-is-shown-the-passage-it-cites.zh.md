# Agent Note: The writer is shown the passage it is asked to cite

Status: implemented

[English](2026-09-20-the-writer-is-shown-the-passage-it-cites.md) | 中文

## 问题

一次被驱动的运行停在 `D3-writing`,而且每一次尝试都停在那里:

```
[D3-writing] [statement-beyond-scope] 'stmt-abstract-1' cites 'cite-10.1109/tits.2026.3727135',
which was assessed 'partial': The passage establishes the reaction-time-as-first-order-lag finding
and the critical lag above which no safe CCC gains exist, but says nothing about a vehicle
responding to connected vehicles farther ahead braking earlier and increasing distance.
```

写作(prose)收到的指令里写着「引用某个来源的句子,只能陈述那个来源所确立的东西,不得再多」。它没法照办:请求从来没有给它看过来源说了什么。`d3Executor` 构造引用名册时放进了 cite key、判决(`establishes`)、`readScope` 与 location,却把 `quote` —— 判决所依据的那一段原文 —— 连同 `access` 一起丢掉了。模型写了一句看起来正确的句子、挂上引用,而句子评审器(它**确实**读了那段原文)拒绝了它。闸门没有错。写作者从一开始就被摆成了必败的局面。

那条拒绝本身,就是「材料从来没进过请求、问题不在措辞」的证据。评审器驳回的那句话讲的是「一辆车对更前方联网车辆的制动做出反应、因而提前制动并加大车距」—— 这个发现在摘录里并不存在:它在该来源的评审人 `rationale` 里,而 rationale 说得比那段原文多。只拿到判决、没拿到原文的写作者,没有任何办法区分「这段话说了什么」与「关于这个来源记录了什么」。

这已经是 D3 第二次因为一个写作者无从知道是错的引用而停在这一步。上一次运行被驳回,是因为它陈述了一段原文从未得出的推论;当时的补救是在指令里加了一句 ——「只能陈述那个来源所确立的东西,不得再多」—— 而没有改动请求携带的内容。那一次把约束搬进了提示词,却没有把证据搬进请求,于是下一次运行以另一句话、同样的方式失败。

## 决定

- **引用名册带上那一段原文。** `d3Executor` 里的 `citableSources` 现在在 `citeKey`、`readScope`、`source` 之外还带 `passage`、`access` 与 `establishes`,于是作为请求 DATA 经 `citations` 送给模型的名册里,含有判决所依据的那些字。
- **`passageOf` 交出原文,否则拒绝。** `citation-bindings.ts` 的新导出取一条判决的 `quote`,先核它的 SHA-256 是否等于该判决自己的 `quoteSha256`,不等则抛 `citation-passage-version-mismatch`。这个版本本来就随引用一起流动,之后一条 `citation-evidence-changed` 的拒绝会指回它;而一段被截断、被重新折行、或从别处读来的原文,会让那个版本描述的是一段没有人看过的文字。
- **指令用规则自己的术语陈述作用域规则。** 它现在点名 `full-text`、`abstract-only` 与 `access`,并说明各自限住了什么:在 `abstract-only` 读到的来源,只能承载「摘要报告了什么」的句子,不得声称只有该来源的方法、实验或结果才能确立的东西;`access` 不是 `read` 的来源,对任何句子都不构成证据。这就是 `checkCitationUse` 的 `citation-support-beyond-scope` 与 `citation-source-unavailable`,用的是它判读时所用的那两个字面值,而不是一段要写作者去意会的转述。
- **两条写作通路记录同一份请求引用。** `requestCitationsOf` 为 fixture 通路与模型通路写出完全相同的条目 —— `citeKey`、`passage`、`evidenceVersion`。fixture 通路不调用任何模型,它记 `instruction: null`,那说的是「没有被要求任何事」;它不表示写作者看到的更少,而它的记录现在带有适配器自己的行文所依据的那段原文。
- **`PROSE_REQUEST_VERSION` 升为 `prose-request-v3`。** 指令是模型可见文本,记录的形态也变了,所以比对两次运行的读者必须能分辨手上拿的是哪一版。
- **没有任何闸门被移动。** 句子评审器、`checkCitationUse`、`checkStatementSupport` 以及各拒绝码一字未改。本次改动给请求增加了材料,并增加了一条「材料与其版本互相吻合」的断言;被拒绝的东西一件也没有变。

## 考虑过的其他做法

- **把评审人的 `rationale` 或 `scope` 交给写作者,而不是原文。** 不采纳:rationale 说得比原文多,正在修的这次失败恰恰就是这么来的。`cite-10.1109/tits.2026.3727135` 那条冻结的 rationale 点名了摘录里并不存在的伴随发现,把它送过去等于要求写作者陈述「语料库关于这个来源记录了什么」,而不是「这个来源确立了什么」—— 评审器会再一次、且正确地驳回它。
- **按 token 预算截断原文。** 不采纳:那会破坏这个版本存在的理由。绑定层在判决产生处已经用 `MAX_QUOTE_LENGTH`(2000 字符)限过一次,超长即按 `citation-no-passage` 拒绝,所以任何能到达写作者的原文,都早已在它被判决的地方被限过。
- **只说「不要过度声称」,不点名作用域取值。** 不采纳:`checkCitationUse` 是用 `full-text`、`abstract-only` 与 `access` 判读的,而用另一套措辞陈述约束、再用这套规则去判它,正是失败了两次的那个安排。指令点名的是这条规则所读的同样三个事实。
- **去掉 `establishes`,让原文自己说话。** 不采纳:随包发布的三条判决里有两条是 `contradicted`,而一个不知道这段原文与主张相悖的写作者,只能把它当支持来引用 —— 那正是 `statement-contradicted` 存在的理由。
- **在出口处就送出的文字重新算一个版本,而不是送判决自己的 `quoteSha256`。** 不采纳:`checkCitationUse` 与 `checkStatementBindings` 拿一条记录携带的版本去和判决自己的版本比,所以在请求处新铸一个版本等于同一段原文有两次判读,请求会不再匹配它所记录的那条判决。要加的是出口处的核对,不是另一次算术。

## 后果

- **实测于 2026-09-20,在部署上。** 一次被驱动的运行跑在 `H:/dsh-boot-t30r` 上,走到 `D3-writing`(16 步中的第 12 步)仍被拒绝。这条拒绝已经不是本记录所讲的那一条了。对 `cite-10.1109/tits.2026.3727135`,评审器现在答复「The passage confirms the first-order-lag representation, its detrimental effect on safety, and the critical lag value above which safe CCC gains do not exist」,并以另一个理由拒绝那句话:它「was read in arXiv:2409.06884v1 rather than in the cited work, so the sentence's attribution of those findings to cite-10.1109/tits.2026.3727135 is not established」。另有两句话按 `statement-beyond-scope` 被拒:一句陈述了那段原文无法确立的「不存在」,一句写了关于本论文自己那个模拟器的比较从句。写作者确实看到了那段原文:请求的 `citations` 条目原样带着摘录,旁边是 `establishes`、`readScope`、`access` 与 `source`,而磁盘上的会话里存着发出时的那段文字。
- **实测没有回答的问题。** 实质性的那条反对消失了,活下来的拒绝讲的是「一段被引用的原文能确立什么」—— 一次署名、一个「没有」、一个比较 —— 而不是讲一个手里什么都没得读的写作者。至于「预印本对 DOI」这条反对,是否会拒绝一句依据已发表正版全文写出的句子,这次运行回答不了;而能定谳的那个事实,记录里是有的(`CorpusSource.accessNote`),只是它没有到达写作者。剩下两条拒绝都没有去追:评审器对它所拿到的东西判断得没错,而一次「说服它改变裁决」的改动,改的是闸门而不是请求。
- **携带原文的请求更大。** 三条随包来源给每个 D3 请求增加约 700 个字符的原文,请求文本与产物记录都按这个幅度增长。语料在判决产生处已被 `MAX_QUOTE_LENGTH` 限住,所以增长也是有界的。
- **摘录与它自己的哈希不一致的语料,现在会让运行停在 D3。** `passageOf` 会拒绝一段哈希对不上记录版本的判决,而这是一条新出现的失败路径:在这条路径上,此前没有任何东西把这两个字段互相比对 —— 现存的每一处检查都是拿一个版本比另一个版本。`statement-bindings.spec.ts` 对整份随包 `EVIDENCE_CORPUS` 断言了这条吻合,所以该拒绝不可能在随包路径上触发;它恰恰在该触发的地方触发 —— 一份改了字却留着旧哈希的语料,否则会把请求版本并不描述的文字交到写作者手上。
- **fixture 写作通路记录了原文,却没有因此得到一条指令。** 它的 `instruction` 仍然是 `null`,因为没有模型被调用;把 fixture 请求与模型请求并排看的读者,看到的是同样的证据和一份空缺的提示词。

## 文件

- `packages/research/dsh-research-team/src/runner/citation-bindings.ts` —— `passageOf`。
- `packages/research/dsh-research-team/src/runner/registry.ts` —— 引用名册、`requestCitationsOf`、D3 指令、`PROSE_REQUEST_VERSION`。
- `packages/research/dsh-research-team/tests/statement-bindings.spec.ts`、`tests/citation-binding-run.spec.ts` —— 记录下来的请求里的原文、与它哈希相符的版本、以及指令中的作用域子句。
