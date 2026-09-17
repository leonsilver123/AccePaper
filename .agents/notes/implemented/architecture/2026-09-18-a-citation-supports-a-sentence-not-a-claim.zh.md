# Agent Note: 一条引用的支持是关于句子,不是关于它来自的那句主张

Status: implemented

[English](2026-09-18-a-citation-supports-a-sentence-not-a-claim.md) | 中文

## 问题

2026-09-18 的那次流程复核复现了这件事:**主张级的支持裁决被挂到了引用该来源的那句话上。**`evidence-corpus.ts` 存的是复核者读了什么、得出了什么,而那个结论是关于**主张**的 —— 评估逐字记下它读的那句主张、该来源是否支持它、以及它不确立什么。`judgementsFor(claimRef)` 把它们转成 `SourceJudgement`,`bindJudgements` 再把它们挂到句子上,于是一句没人读过的句子带着一个针对**另一句话**做出的 `supported`。一句比主张说得更多的句子 —— 或者把同一件事说成关于另一个系统的句子 —— 继承了它。

## 决定

- **一道缝,与其它部署能力同形。** `runner/statement-support.ts` 陈述 `StatementAssessment`(句子的身份与内容版本、来源、针对那句话的裁决、裁决所依据的东西、谁做的、何时)与 `StatementSupportAssessor`(`id` + `assess({statement, judgement})`)。一台机器能不能读一段话并判断它相对**某一句**意味着什么,是部署的性质,与它有没有绘图库、有没有文档工具链完全同一类。
- **D3 做评估,并拒绝它发现的东西。** 配了 assessor 时,每一句引用来源的句子都对着自己的文本被评估,读数记在草稿上,`checkStatementSupport` 拒绝 `statement-unassessed`(没有任何读数覆盖这一句,或读数针对的是已被重写的版本)、`statement-contradicted`、`statement-unrelated`、`statement-beyond-scope`。没通过这一步的运行什么都不发布:没有草稿,也就没有后续稿件。
- **E1 对修订后的稿件再查一次。** 读数是针对草稿做的,而 E1 装配出来的是修订的产物。一次没人重读的 D4 重写会在**稿件发布的地方**被拒 —— 与它旁边那条引用版本检查同一处、同一理由。
- **没有 assessor 就是没有读数 —— 这被记录下来,而不是被推断出来。** 草稿**完全省略** `statementAssessments`。写成空数组会表示「读数做了、什么也没发现」,而把它读成「没有可反对的」的消费方,做的正是这个单元要消除的那种推断。E1 对这样的运行什么都不查:字段缺席是关于部署的事实,为此拒绝该部署下每一次运行的每一条引用,等于把这个事实报成稿件的缺陷。**这是实测出来的** —— 头两次接线分别让 109 和 78 条测试失败,两次的原因都是拿空列表冒充缺失的能力。
- **`bindJudgements` 把读数作为参数收下。** 一句话有读数时,绑定携带**那句话的**裁决与阅读范围;没有时携带主张的 —— 而未评估运行的工件本来就是这个说法。段落、它的版本与来源身份两边都是来源的;不同的是有没有人把它对着**这一句**读过。

## 考虑过的替代方案

- **让主张级裁决处处弃权。** 拒绝:B 通道的锚点正当使用主张级评估,在那里弃权会毁掉那个本该通过的通道。缺陷是继承,不是主张级判断的存在。
- **在这个包里放一个基于规则的评估器。** 拒绝:判断一段话是否确立一句话就是阅读,猜的词汇规则会犯与继承同一个类别的自信错误。部署提供能读的人;这个包陈述必须记录什么。
- **在 E1 而不是 D3 评估。** 拒绝:E1 时稿件已装配,一次拒绝要赔上整次运行的正文。D3 才是句子存在、并且还能要求重写的地方。

## 后果

- **模块层三个方向**(`tests/statement-support.spec.ts`):段落与句子矛盾的、真实来源但段落与句子无关的、以及只有摘要而句子陈述细节(按超出范围拒绝而不是放行)。另有:没有读数时无论主张裁决多可靠都拒绝、版本过期的拒绝、每对「句子×来源」只问一次、重写后会再问一次。
- **运行层三个**(同一文件):有 assessor 的部署把读数连同内容版本记在草稿上;被判矛盾的句子让 `D3-writing` 停下并给出理由且什么都不发布;没有 assessor 的部署**根本不记这个字段**。
- **这里不是的。** 出货 bundle 不点名任何 assessor,所以出货运行的绑定仍带着主张的裁决,草稿也说明没有句子被读过 —— 这是诚实的缺口,而不是沉默的缺口。接一个真正的复核者(复核文件里的独立复核者角色)是下一个单元。

## 文件

- `packages/research/dsh-research-team/src/runner/statement-support.ts`(新增)、`src/runner/citation-bindings.ts`(`bindJudgements` 收下读数)、`src/runner/registry.ts`(D3 评估并拒绝;E1 再查)、`src/runner/types.ts`(`DriveOptions.statementAssessor`、`DriveStepOptions`)、`src/runner/drive.ts`(带进运行上下文)。
- `packages/research/dsh-research-team/README.md` / `README.zh.md`。
- 用例:`tests/statement-support.spec.ts`(新增)。
