# Agent Note: 手稿仍然带着的那条意见

Status: implemented

[English](2026-09-16-the-concern-the-manuscript-still-carries.md) | 中文

## Problem

`D4-rebuttal` 记下它那一轮提出的每一条意见变成了什么。一条 issue 是 `patched`(某份补丁改动了
正文)、`accepted_explanation`(作者不改正文就回答了)、或者 `open`(应用器拒绝了 —— 补丁是针对另
一个版本写的、用相同的文本替换了正文、或与同一节的另一份补丁冲突)。

`openIssues` 被写进 rebuttal 工件,而**没有人读它**。它不阻止 `D4-rebuttal` 步进,也没有到达
`submissionReadinessOf` —— 后者只读草稿的 `refusedSections`。于是一次运行可以关闭每一道门、由人
批准、导出产物包,而它**仍然带着一条评审者提出、手稿从未回答的意见**。计数一直都在,只是没有任何
东西依据它行动。

## Decision

`openIssuesOf` 从 `rebuttal` 工件读逐条 issue 的结局,而 `submissionReadinessOf` 在清单非空时拒绝
就绪,逐条点名 issue、它所在的节、以及应用器给出的原因。`readinessOfRun` 读那个工件并传进去,与它
本来就在传的 `refusedSections` 并列。

理由点名而不是计数:"3 条 issue" 不是一个读者能据以行动的东西,而
"`d4-issue-1` 在 'method' 上(补丁用相同的文本替换了正文)" 是。

## Alternatives considered

**让 `D4-rebuttal` 在还有 issue 未关闭时失败。** 暂拒:一轮修订关闭了它提出的大部分,就是一轮能
工作的修订,而让该步失败会丢掉它确实应用了的那些补丁。真正错的是声称**这次运行**完成了 —— 那是就绪
判定的判断。只有当存在第二轮可以再试的时候,让该步失败才是对的形状 —— 见下。

**只计数,不点名。** 拒绝:这份清单的全部意义就在于每一条都是一个具体的、未被回答的意见,带着一个
具体的原因;在最后一步把它换成一个数字,等于把它扔掉。

**只在该 issue 所在的节确实存在时才拒绝。** 拒绝,没有必要:一条 issue 具名的节正是应用器无法打补丁
的那一节,而那个节是否存在,已经记在结局的 reason 里。与应用器保持一致不是这个读者的职责。

## Consequences

- `tests/d4-model-revision.spec.ts` 经模型路径驱动一次真实修订,其中一份补丁用 D3 已经写过的文本
  替换 Method 正文,于是应用器以 no-diff 拒绝它、把那条 issue 留成 open。该步仍然通过,运行到达
  E2,而在有人批准这个包之后,**就绪仍然是 false**,理由是 `left 1 concern(s) open` 并点名了那条
  issue。
- `openIssuesOf` 对**不得误读**的形状有测试:没有 reason 的结局被报成"没有记录原因",而不是被编成
  一句像样的话;已关闭的结局不是未关闭的 issue;工件缺失得到空清单。
- 既有的每一次运行都保住自己的答案:参数默认为空,所以一轮关闭了全部(闭环正是如此)的运行不受影响。
- **仍然缺的,README 里写明**:没有轮次计数、没有修订预算。`roundId` 硬编码在 `t19s-rebuttal-1`,
  所以「两轮同样的失败转人决」没有东西可数,而一次拒绝是被报告,不是被重试。
