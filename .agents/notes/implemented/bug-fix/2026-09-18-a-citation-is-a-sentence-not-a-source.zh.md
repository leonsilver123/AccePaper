# Agent Note: 引用是一句话,不是一条来源

Status: implemented

[English](2026-09-18-a-citation-is-a-sentence-not-a-source.md) | 中文

## 问题

2026-09-18 的那次流程复核在出货代码上复现了这件事:**同一来源被两句正文引用时,只为先出现的那一句生成绑定。**`bindJudgements` 拿着一个 `Set<string>` 装 citeKey,遇到已经绑过的键就跳过,于是第二句的引用根本没有绑定 —— 而所有读绑定的检查在那之后都没有东西可读。一篇论文在引言里引一条来源、在讨论里再引一次,是常态而不是边角情形。

`checkCitationKeys` 从另一侧犯了同一个混淆:它把**任何**重复的 citeKey 都当成 `citation-duplicate-key` 拒绝(「稿件没法点名其中一条」)—— 对「一个键被铸给两条来源」这是对的,对「一条来源被引两次」这是错的。两个错误互相支撑:键检查之所以没有在普通稿件上开火,只是因为调用方传的是 judgements(每条来源一条),它从来没见过那些重复。

## 决定

- **每一句引用它的句子各得一条绑定。** 去重集合去掉了;同一个键出现在两句里就是两条绑定,各自携带**那句话自己的**内容版本(`statementSha256`),于是一次重写只让自己的那条引用失效,另一条不受影响。
- **同键内按正文顺序排列。** 绑定先按 citeKey、再按句子在稿件中的位置、最后按内容版本排序。按 `statementId` 排会在字母序说该如此时把讨论排到引言前面 —— 那是没有人会用的读法。
- **反方向也检查:`citation-statement-unbound`。** 一组绑定可以条条成立,而某一句引用了来源却一条都没有 —— 而且不需要任何人做错事就会发生,因为旧代码产出的正是这个样子。`checkStatementBindings` 现在比较**两个集合**(被引句子 vs 绑定),而不是只走绑定;两句被引句子互换时,两件事都被报出来:每个节点的文本变了,**而且**每一句的引用都没有绑定覆盖。
- **`checkCitationKeys` 管的是来源身份。** 一个键命名一条来源 —— 两条来源共用一个键,就是把一个编号印给两份不同的作品,读者无法判断某一句指的是哪一份,这仍然拒绝。同一来源被两句引用不是冲突,也不再被读成冲突。
- **`uncited` 的含义没变,现在才真的成立**:一条已复核来源在**没有任何**句子点名它时才算未被引用,而不是「第一句点名它的记录已经写下了」。

## 考虑过的替代方案

- **按句绑定,但键检查保持全局。** 拒绝:两层规则会就同一份稿件给出互相矛盾的判断 —— 绑定层为同一个键产出两条用途,而键层把第二条当重复拒绝。
- **保留一键一绑定,句子变了就重新绑定。** 拒绝:重新绑定正是 R05① 取消掉的那种补救。判断是某个人对某一句做出的阅读;第二句是**第二次阅读**,不是对第一次的修理。
- **绑定按 statementId 排序。** 拒绝的理由在读法而不在机制:id 形如 `stmt-<小节>-<序号>`,按字母序排。

## 后果

- **四个方向都有用例**(`tests/statement-bindings.spec.ts`):一条来源出现在两句里 → 两条绑定、两个内容版本,重写第二句只拒绝第二条;引用了来源而没有绑定的句子被拒(`citation-statement-unbound`),绑定之后通过;两句被引句子互换 → 文本变化与未绑定**两件事都报**;句子被删仍是 `citation-statement-missing`(原有用例)。`tests/citation-bindings.spec.ts` 钉住键规则的两侧:两条来源共用一个键被拒,一条来源被两句引用被接受。
- **这里不是的。** 它没有把判断本身变成重新推导:谁来重读是个人或部署自己的复核者。它也没有关掉复核指出的第二个引用缺口 —— 主张级的支持判定被新句子**继承**而不是针对该句评估 —— 那是下一个单元(`runner/statement-support.ts`)。

## 文件

- `packages/research/dsh-research-team/src/runner/citation-bindings.ts`(`bindJudgements`、`checkStatementBindings`、`checkCitationKeys`,以及新的拒绝码)。
- `packages/research/dsh-research-team/README.md` / `README.zh.md`。
- 用例:`tests/statement-bindings.spec.ts`、`tests/citation-bindings.spec.ts`。
