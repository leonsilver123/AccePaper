# Agent Note:引用名单欠什么,以及围绕一次模型调用的两道界

Status: implemented

[English](2026-09-20-a-roster-a-permission-and-two-bounds.md) | 中文

## Problem

研究流水线的每一次真实运行都停在 `D3-writing`,而随着上游缺陷被逐个修掉,拒绝的理由已经换过三次。幸存下来的那一类是 `statement-unrelated`,部署自己的句子评审者给出的理由是:"The passage only concerns the reaction-time lag (a first-order lag) and the critical lag value above which safe CCC gains do not exist, saying nothing about a gap-to-closing-speed ratio." 被拒的是 `stmt-introduction-1`,而那句话说的是 `The quantity at stake is the smallest gap-to-closing-speed ratio reached by any follower over the measurement window [@cite-10.1109/tits.2026.3727135]` -- 本研究自己的度量,却挂着一条段落讲的是另一回事的来源引用。

**同一条指令里的两条规则不可能同时被遵守。** D3 既要求名单上每个已评阅来源都在正文里被引用,又要求引用某个来源的句子只陈述该来源所确立的东西。当某个来源与论文需要的任何句子都无关时,满足第一条的唯一办法就是把它挂到第二条会拒绝的那句话上,于是写作者装饰了离它最近的一句。流水线把写作者摆在了必然失败的位置上,而写作者被摆在了必然被拒的位置上。

**一次拒绝就结束了整次运行。** 在这一步,拒绝是常态,因为证据常常并不确立写作者想说的东西。遇到第一次拒绝就停下的流水线,无法报告"写作者只是写错了句子"的那些运行 -- 也分不清"这个 claim 没有支撑"和"这份草稿说多了",而这是两种不同的发现。

**指令到达模型之前没有被读过。** 每一步把指令由若干部分拼起来,而每个部分陈述的规则住在该步被判定的那些模块里,但没有任何东西检查拼出来的文本是否仍然**携带**这些部分。这次之前在这套部署上发生的两次拒绝,都关乎写作者从未见过的材料 -- 没有段落的名单、没有"读到了什么"的段落 -- 而两次都是在运行停下之后靠人手找出来的。

## Decision

- **名单是许可,而义务只落在承载 claim 证据的那些来源上。** 当评审者认定某来源的段落确立了 claim 时,`judgementsFor` 把它标为 `supported`;这些就是论文自身主张所倚赖的来源,必须被引用。名单上其余的是论文"可以"引用、"并不欠"引用的既有工作。指令用句子评审者所读的那套措辞把这一点说得一字不差。
- **`citation-source-uncited` 是保留并收窄,不是被替换。** 它的代号、致命性和消息都保留;变的是它点名哪些来源。它成文的本意是"论文没有陈述其自身证据所确立的立场",而这对于"段落确立 claim"的那些来源成立 -- 也就是收窄后的集合 -- 对于论文可以讨论的既有工作则不成立。被去掉的正是过宽的那一半,也正是无法被遵守的那一半。
- **不承担义务的未引用来源仍然被报告。** `uncitedSources` 把每一句都没引用的已评阅来源带在草稿上,并且 -- 新加的 -- 一路带过 D4,而 D4 此前把这个字段丢掉了。一个没人用过的判定,要么是草稿没陈述它持有的立场,要么是来源与本文无关,而只有读者能分辨是哪一种。
- **拒绝由有界的重写轮次作答。** `D3-writing` 把评审者自己的理由原文回给写作者,在同一份证据下、同一套规则下重写,轮数由 `proseRounds` 限定(默认二;`0` 即这个循环之前的行为)。只有句子被拒的那些小节会被重写,也只有它们 -- 重写轮拿到的证据与第一轮完全相同。每一轮都记在草稿上:`told`(拒绝理由)、`wrote`、`changed`(逐节前后哈希)、`refusedAfter`,以及 `stoppedBecause`。
- **最后一轮仍由第一轮的那套检查来读。** 没有动任何一个门、评审者、阈值或 claim。最后一轮之后仍被拒的运行,会带着评审者的原话停下,与轮次存在之前完全一样 -- 而这一轮自己的记录会说明是预算用尽,而不是评审满意。
- **指令在发出之前先被读一遍,由读者读,而不是由优化器改。** `InstructionChecker` 把请求 -- 指令**与**上下文,因为有好几步把证据作为请求数据携带 -- 对着该任务所要求的部分读一遍,而 `sendCheckedProse` 是散文请求唯一的通路,所以拒绝会阻止发送。一个没有给出可用判决、或拒绝却不点名缺失部分的答复,是**失败**而不是放行。
- **检查的答案记在请求旁。** `proseRoute.instructionCheck` 与 `proseRequests[].instructionCheck` 携带判决、它点名的部分、读者版本、它所读指令的 SHA-256、以及要求的部分 -- 于是读者能分辨"这次发送被检查过"和"这次发送根本没人看过",而记录缺失意味着没做检查,不是检查通过了。
- **检查是失败即关闭的,而 spec 证明的是机制。** 拒绝会让发送停下、写作者一次也没被调用,这才使它是一道闸而不是一条观察。某个模型读得对不对不是 spec 能证明的东西,本记录也不这样声称。

## Alternatives considered

- **彻底去掉 `citation-source-uncited`,让参考文献表就等于正文引用到的东西。** 拒绝:那是 `citation-entry-uncited` 的职责,而且这样一来,一篇主张某 claim 却不引用任何确立该 claim 的证据的论文,就没有任何东西去拒绝它了。这条拒绝背后有一个真实的缺陷 -- 交付的论文参考文献表里是二十五条检索命中,正文一条都没引 -- 而收窄后的集合正是那个缺陷里确实是缺陷的那一部分。
- **保留它覆盖整份名单,让写作者自己拒绝。** 拒绝:"每个已评阅来源都必须被引用"不是一条关于论文的规则。一次运行若评阅了三十个来源、写了六个小节,就得把三十个全引上,而这是一条保证产生评审者所拒的那种装饰的规则。
- **让写作者丢掉一条引用并记下原因。** 拒绝:那条记录会是模型关于自己选择的一句话,而这正是这条流水线存在的目的所不接受的一类断言 -- 而决定一个段落确立什么的那次阅读,其主体是评审者,不是写作者。
- **让轮次跑到不动点而不是有界。** 拒绝:一个被第四次问同一个问题的模型,就是被问同一个问题的模型。界是配置(`proseRounds`),而循环在一轮什么都没改时也会停下。
- **让检查去改写或补全指令。** 直接拒绝:一条每次运行都变的指令,是夹在该步与它被判定的文本之间的一层不可审计的东西,而这一层的前提是:没有人能重读的断言就是没有人能检查的断言。检查只读并拒绝,从不编辑。
- **让检查只警告而不阻止。** 拒绝:那是戴着闸的名字的观察。2026-09-20 在部署上实测:开启的检查在一次运行中把 `D2-framework` 拦下了,理由是 "the instruction is missing the constraints on what may be asserted, which this task requires" -- 这是关于 D2 指令的一条发现,而不是关于这项检查的。

## Consequences

- 写作者说多了的运行现在可以被作答,而不是被终止。收敛是有界的、被记录的,而且每一轮都由同一次阅读来判;不收敛的运行仍然停下,并且仍然说明原因。
- 在发送之前读指令的部署,少碰到一类缺陷 -- 指令从未携带写作者被判定的那份材料 -- 代价是每次散文发送多一次模型调用。出厂 bundle 不点任何检查器,因此出厂的运行不做检查,并把这个缺失记录下来。
- 收窄后的拒绝意味着草稿现在可以只引用所评阅内容的一部分。必须引用的,是自身 claim 的证据;没被引用的来源会被点名记在草稿上,而不是被丢掉。
- D4 现在会把 `uncitedSources` 与 `proseRounds` 带下去。两者此前都被那个重新发布草稿的步骤丢掉了,而这与当初为 `statementAssessments` 补上携带逻辑时属于同一类缺陷。
- 这项检查还没有被证明在真实部署上判得正确。有一次运行在真实阅读下于 D2 被拦下,这是"它确实会拒绝"的证据;那次拒绝对不对,是关于 D2 指令的判断,而把它关掉 -- 给 D2 补一个约束部分 -- 是留待后续的工作,不是这次顺手做的改动。

## Files

- `packages/research/dsh-research-team/src/runner/prompts/d3-writing.ts` -- 名单被写成带义务的许可、`sectionRevisionOf`、以及 `revisionInstruction`。
- `packages/research/dsh-research-team/src/runner/prompts/skeleton.ts` -- `revision` 部分,以及它参与拼接的顺序。
- `packages/research/dsh-research-team/src/runner/registry.ts` -- D3 的写/读/重写循环、`proseRewriteRoundsOf`、`DEFAULT_PROSE_ROUNDS`、收窄后的 `citation-source-uncited`、草稿上的 `proseRounds`,以及 `proseRouteOf(result, check)`。
- `packages/research/dsh-research-team/src/runner/instruction-check.ts` -- `InstructionChecker`、`InstructionCheck`、`REQUIRED_INSTRUCTION_PARTS` 与 `sendCheckedProse`。
- `packages/research/dsh-research-cordis/src/llm-instruction-check.ts` -- `LlmInstructionChecker`,部署点名的模型通路。
- `packages/research/dsh-research-cordis/src/index.ts` -- `Config.instructionCheck`、`InstructionCheckChannel`,以及团队读取的那个引擎属性。
- `packages/research/dsh-research-team/src/index.ts`、`src/runner/types.ts`、`src/runner/drive.ts` -- 驱动选项与步骤上下文上的 `instructionCheck` 与 `proseRounds`。
- `packages/research/dsh-research-team/tests/d3-convergence.spec.ts` -- 一个收敛的运行、一个用尽预算后停下的运行,以及 `proseRounds: 0`。
- `packages/research/dsh-research-team/tests/instruction-check.spec.ts` -- 答案被记在请求旁,以及"写作者从未被调用"所证明的阻止。
- `packages/research/dsh-research-cordis/tests/llm-instruction-check.spec.ts` -- 模型通路对着脚本化 provider 的读取。
- `packages/research/dsh-research-team/tests/citation-binding-run.spec.ts` -- 收窄后的拒绝,以及那个引用了自家证据、却没引既有工作的运行。
