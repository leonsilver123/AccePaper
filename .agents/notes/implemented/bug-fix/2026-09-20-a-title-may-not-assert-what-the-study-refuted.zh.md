# Agent Note: 标题不得断言研究已推翻的结论,D2 的指令现在这样讲

Status: implemented

[English](2026-09-20-a-title-may-not-assert-what-the-study-refuted.md) | 中文

## Problem

把发送前指令检查在一个真实部署上打开后,它读到的第一次运行停在了 `D2-framework`,拒绝原文如下:

> [instruction-check] D2-framework: the instruction is missing the constraints on what may be asserted, which this task requires: The instruction carries its subject (the work described by the context's claim and methodFamily) and spells out the output format (exactly two lines, TITLE and SECTIONS with the seven ordered placeholders), but it states nothing limiting what the title and headings may assert

这是关于指令的发现,不是关于检查的发现。`frameworkInstruction` 只组装了两个部分 —— 任务与输出格式 —— 骨架里"可以断言什么"的那一部分是缺的,而 `REQUIRED_INSTRUCTION_PARTS` 要求它是对的:按"它自己带了哪些部分"去检查的步骤,对什么都会通过。

**指令缺的那条规则本来就有,只是住在读产物的那个模块里。** `runner/manuscript-review.ts` 的 `reviewManuscriptConclusion` 发布质量角色 `red-claim`,它的第一项检查把稿子**标题**里的方向词读向本次运行自己的记录,凡是断言了测量结果相反方向的标题一律拒绝。它之所以存在,是因为一篇已经交付的论文:标题以 "Raising Minimum Time-to-Collision …" 开头,印在一项测出 38.2% 下降的研究之上,而它下面的 Results 小节报的正是这个推翻。这个仓库给这类缺陷起了名字、写了识别它的正则、也写下了引用它的拒绝 —— 而那条要求模型写标题的指令对此一字未提,于是写作者只能去猜一条从没给它看过的规则。

**这与本流水线反复遇到的是同一类缺陷。** 规则在一个模块里执行、在另一个模块里陈述,正是 D3 那些拒绝的成因:名册没有段落、段落没有说明它读的是什么。`red-claim` 是同一类的又一处,只是早了一步,而发送前检查让它在运行还在进行时就暴露出来,而不是等运行停下之后。

## Decision

**D2 的指令带上骨架的约束部分,材料取自本次运行自己的测量。** `frameworkInstruction` 现在接收一个 `OutlineMeasurement` —— 研究测的哪个量、按质量角色读它的口径带符号的测量变化、这个变化对 claim 做了什么、claim 承诺的方向与幅度 —— 并把它组装成指令的 `evidence` 部分,排在格式之后、引用规则之前。指令原来的两个部分一字未动,所以这是一次增加而不是重写。

**约束按 `red-claim` 读它的同一个词陈述,按 `red-claim` 施加的同一个强度陈述,一点不多。** 该角色拒绝的是方向词与其记录相矛盾的标题;指令说的正是这一点,并且说明:陈述记录所测方向的标题正是标题该做的事。一条一律禁止方向词的约束 —— "不要陈述方向" —— 会拒绝该检查本会通过的标题,那就成了本流水线没有的规则,写作者也就会被两条互相矛盾的规则同时评判。标题之外也点了小节标题,因为小节标题同样是一条断言,读法相同。

**运行的记录写在指令里,而不是放在请求上下文里。** `red-claim` 拿标题去比的是一个带符号的数和一个阈值,所以约束就陈述这个带符号的数与这个阈值:"a change of -38.2% in the minimum time-to-collision — it fell — against a claim that committed to an increase of at least 20%",后面接上这对 claim 做了什么。没有声明阈值的 claim 会如实这么说,而不是被报成声明了 0%。这是 D3 那些拒绝教过、本笔记不再重推的一课:有材料没规则和有规则没材料都是会失败的安排,而 D2 犯的是第二种。

**结论用的是计划自己的判断,不是第二份判断。** `d2Executor` 从 `claimOutcomeOf` 读它 —— 也就是 `argumentPlanOf` 调用的那个函数,它的结果正是 D3 各项义务所依据的 `outcome` —— 所以讲给标题写作者的推翻与讲给各小节写作者的推翻,不可能是一次运行的两个不同事实。

**`PROSE_REQUEST_VERSION` 为 `prose-request-v6`。** 在 D2 陈述其约束之前写下的请求,不会被当成在约束之下写下的请求来读。

**检查在部署配置里重新打开,它此前是被关掉的。** 它是一个部署设置(`Config.instructionCheck`,散文路由上的一个 `LlmInstructionChecker`),而随包发布的 bundle 不设置它,所以在 bundle 下的运行不检查就发送、并记录下"没有做过检查"。它此前被关掉,是为了测量 D3 那个问题;一个产品够不到的检查不是检查,所以该部署重新点名了它。

## 在部署上的测量

- **部署自己的读者放行 D2 的指令。** 检查打开时,指令没法越过 A1 到达 D2(见下),所以直接问了读者:启动该 profile,用各步骤自己组装的同一个模块组装两条指令,并以 `REQUIRED_INSTRUCTION_PARTS` 和各步骤实际发送的请求上下文调用 `research.instructionCheck.check`。D2 的答案是 `COMPLETE: true`,依据是 "The instruction carries the run's measured finding (-38.2% change in minimum time-to-collision, i.e. a fall) as the evidence to write from, the constraints on what may be asserted (a title or heading may state a direction only where the record found it, and an increase would be refused), and the exact output format"。
- **A1 是保真对照,而它复现了它被放进来复现的那条拒绝。** 同一个探针读了 A1 的指令 —— 本次工作没有动过它 —— 答案是 `COMPLETE: false`、`MISSING: constraints on what may be asserted`,依据是 "The instruction names its evidence ("the following papers", supplied as the request's `papers` field) and its output format ("one gap per line. No numbering, no preamble, no closing commentary"), but its only stated limits are formal ones about the reply's shape, carrying no constraint on what may be claimed about the papers." 一个复现不出运行已经做出的拒绝的探针,测的就不是运行测到的东西。
- **在检查打开的情况下真跑了两次,两次都没到 D2。** 第一次停在 `A1-landscape`:``[instruction-check] A1-landscape: the instruction is missing constraints on what may be asserted, which this task requires: The instruction names the evidence (the context's `papers`, referred to as "the following papers") and fixes the output format ("one gap per line. No numbering, no preamble, no closing commentary"), but places no stated limit on what the writer may claim about those papers' o…`` —— 省略号是日志自己的 400 字截断,完整文本在上面那条探针里。第二次**通过了 A1 与 A2**,停在 `A3-agenda`:`[instruction-check] A3-agenda: the instruction is missing constraints on what may be asserted, which this task requires: The instruction draws its evidence from the context's claim/prediction and fixes the reply shape (PHASES/CONTRIBUTIONS blocks), but it names no limit on what the derived agenda or contributions may assert.` 两条拒绝都不关 D2 的事,两条对它点名的指令都是正确的陈述,也都没有靠削弱任何东西来回答。
- **为了让运行走到 D2 而没有做的事。** A1、A2、A3 与 B1 各自都没有陈述"可以断言什么"的约束;给四条提示词各补一个约束部分,得到的将是一次"靠哪几条判定恰好放行"才走到 D2 的运行。那是四个提示词决定,每一个都关乎这一步可以断言什么,它们属于调用方,而不属于本笔记 —— 尤其不该在一次等待通过的运行面前顺手做掉。
- **同一个探针读全部七条指令,给出的是检查如今拒绝什么的地图。** 按它们真实的请求上下文来读:`A2-claim`、`D2-framework`、`D3-writing` 与 `D4-rebuttal` 为 `COMPLETE`。`A1-landscape` 因为 "the constraints on what may be asserted" 被拒(与第一次运行拒绝它的那一部分相同)。`A3-agenda` 与 `B1-method` 因为 "the evidence the task must be written from" 被拒 —— 该读者认为 claim 与 prediction 是要推导出的断言,而不是供写作的证据;D3 的请求带一个 `evidence` 字段,满足的正是这条判断。D2 在这份放行名单里,而在引出本次工作的那次运行里被拒,那正是本笔记所说改动的地方;A1、A3 与 B1 是仍然敞着的发现。

## Alternatives considered

- **让检查去补全或修复指令。** 在[名册笔记](../feature/2026-09-20-a-roster-a-permission-and-two-bounds.zh.md)里已经否掉,这里因为同一个理由再否一次:被读者改写过的指令,是一条每次运行都不一样的指令,而这一层的前提是没人能重读的断言就是没人能核对的断言。检查只读并拒绝;修复是对提示词模块的一次改动,照常改、照常钉住。
- **把约束放进请求上下文,不动指令文本。** 否掉:拒绝点名的就是指令 —— "it states nothing limiting what the title and headings may assert" —— 而它已有的材料(claim 与 method family)本来就走在上下文里。评判写作者的规则属于指令,那是 `tests/prompts.spec.ts` 钉住的文本,也是会话日志的读者能重读的文本。
- **只陈述规则,不带本次运行的数字。** 否掉:"陈述记录所测方向、或者不陈述方向"对一个没被告知记录测到了哪个方向的写作者来说是无法执行的,那样一来约束又成了一条"在一处陈述、在另一处执行"的规则。这些数字是本次运行自己的,也正是该角色拿来比标题的那几个。
- **一律禁止标题里出现方向词。** 否掉,过严:`red-claim` 拒绝的是与记录相矛盾的标题,放行的是陈述了记录所测方向的标题。一条比检查禁止得更多的指令,会让写作者去满足一条没人执行的规则,而听话的运行会印出一个什么都没说的标题。
- **留给 `red-claim` 在最后说,把发送前的拒绝当成噪声。** 否掉:`red-claim` 读的是组装好的稿子,到那时标题已经写完、各小节已经照着它写完,剩下的补救要么是重写全稿要么是停下 —— 还是 D3 那些缺陷一样的"运行停下之后靠人手发现"。
- **为了这次运行再把检查关掉,就像测量 D3 时那样关着。** 否掉:产品够不到的能力不是检查,而它这次给出的发现是对的。检查保持打开,运行停在哪一步就引用哪一步的理由,而不是绕过去。
- **在同一次改动里给其余散文步骤都补上约束部分。** 否掉,属于范围外:A1 那条拒绝是一条真发现,它有自己的决定要下(关于一组论文留下的空白可以断言什么,与关于一次运行自己的测量可以断言什么,是两回事);为了把一次运行送到 D2 而一口气回答四个这样的问题,就是针对闸门的输出做改动,而不是针对闸门点名的那处缺陷做改动。

## Consequences

- **标题再也不能在入口处与记录相矛盾。** `red-claim` 在最后施加的那条规则,现在写在标题被写下的地方,带着本次运行自己的数字,所以一次测量推翻了自己 claim 的运行,在写标题之前就被告知它的标题可以陈述哪个方向。
- **指令长了大约七百个字符**,长在 D2 每次运行只发一次的请求上。
- **发送前检查在它瞄准的那一步的前一步找到了真缺陷,而这条发现是敞着的。** A1 与 A3 的指令都没有约束部分。两条都记在本笔记与 README 里而没有修;在修好之前,该部署下的运行会停在读者先拒绝的那一条上。
- **同一个指令,读者的判定在不同运行之间并不稳定。** 同一条没动过的 A1 指令,第一次运行拒绝、第二次运行放行,探针又以第三种措辞给出了同一个依据。这是关于"由模型充当的读者"的事实,不是关于指令的事实,而且这里如实记下而不去抹平:检查是 fail-closed 的,所以答案会漂移的读者会让流水线比确定性读者更频繁地停下,而任何一次"它过了"都不能定下检查对一条指令的看法。
- **这里没有的东西**:D2 处没有任何东西机械地执行这条约束。指令把它陈述出来,`red-claim` 在组装好的稿子上裁定它;一个以该角色正则读不出的方式与记录相矛盾的标题 —— 用了它词表之外的说法陈述方向 —— 两边都不拒绝。该角色的词表是它自己的,这次改动没有把它加宽。
- **随包发布的 bundle 依然不点名任何检查器。** 那里的 `Config.instructionCheck` 未设置,所以 bundle 下的运行不检查就发送、并且不记录任何检查;这是读者可以据以行动的事实,而不是一次放行。本笔记改动的是测出问题的那次部署,不是默认值。

## Files

- `packages/research/dsh-research-team/src/runner/prompts/d2-framework.ts` —— `OutlineMeasurement`、`assertionRules`,以及组装出来的指令。
- `packages/research/dsh-research-team/src/runner/registry.ts` —— D2 的请求用 `measureOutcome` 与 `claimOutcomeOf` 构建测量;`PROSE_REQUEST_VERSION` 为 `prose-request-v6`。
- `packages/research/dsh-research-team/src/runner/manuscript-review.ts` —— `red-claim`,也就是指令现在与之取得一致的那个角色;本次未改动它。
- `packages/research/dsh-research-team/tests/prompts.spec.ts` —— 逐字钉住 D2 的指令,以及它可以陈述的三种结论。
- `packages/research/dsh-research-team/tests/statement-bindings.spec.ts` —— 记录下来的 `proseRequestVersion`。
- `H:/dsh-boot-t30r/profiles/web/cordis.patch.yml` —— 该部署的 `instructionCheck` 行,属于部署本地、不在本仓库内。

## Testing

- `tests/prompts.spec.ts` 为一个被推翻的 claim 逐字钉住组装出的 D2 指令,并检查这条约束必须区分的两种情况:测量支持 claim 时,它允许标题陈述记录所测的方向;claim 没声明阈值时,它如实这么说。
- 上文那次部署测量在测试套件之外:一次对部署自己读者的探针(读两条指令),外加两次真实运行。套件证明的是组装出的文本以及组装它的那些事实;某个模型对它的读法对不对,不是规格能证明的东西。
