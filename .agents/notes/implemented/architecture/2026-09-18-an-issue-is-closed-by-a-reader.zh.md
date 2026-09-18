# Agent Note: 意见由读者关闭,不由「改了」这个动作关闭

Status: implemented

[English](2026-09-18-an-issue-is-closed-by-a-reader.md) | 中文

## 问题

2026-09-18 的流程复核把这件事列为 P0:D4 在同一次写作调用里产出了审稿关切与修订,而 `applyRevision` 按**这一轮做了什么**处置意见 —— 补丁应用成功就是 `patched`,答复非空就是 `accepted_explanation`。两者都不能证明关切被回答。补丁可以落在它所针对的那句话旁边;解释是作者对自己作品的陈述。循环随后报 `closed` 并停下,于是**最早能停的那一次,也最像已经结清**。

## 决定

- **`applyRevision` 产出两种处置,都不关闭意见。** `pending-verification` 表示这一轮产出了可供检查的东西(替换后的正文,或不改动的论证);`open` 表示什么都没产出 —— 没有这个小节、补丁写于一个已经变过的正文、或者一次不产生 diff 的「修订」。工件在 `openIssues` 旁边携带 `awaitingVerification`,因为只看到一个数字的读者分不清欠的是哪一种。
- **第三个动作由 `runner/resolution-verifier.ts` 陈述。** 部署提供 `ResolutionVerifier`;`verifyPending` 就每一条待验证意见问它,交给它关切、答复、改动与当前正文;`verifyResolution` 把它的 `verified` 变成 `answered`(**唯一**能关闭意见的处置),把 `rejected` 变回 `open` 并附上读者的理由。
- **独立性是强制的,不是请求的。** 署名等于该运行 D4 producer 的核验被拒绝(`verification-not-independent`),并且**这一步失败**而不是把它记下来:答复不能给自己发证书。对「没有任何一轮留下的意见」的核验同样被拒。
- **循环的停止原因把「等待」与「结束」分开。** 什么都不欠时是 `closed`;答复已摆在桌上而无人读过时是 `awaiting-verification`,因为再问作者只会得到同样的答复 —— 那不是预算耗尽,也不许报成预算耗尽。没有核验者的部署,它的意见就是等待。

## 考虑过的替代方案

- **保留 `patched`,旁边加一个验证标记。** 拒绝:处置本身就是关于意见的断言,而一个旁边的标记会让所有既有读者继续把 `patched` 读成已处理。
- **没有核验者时让修订作者自己核验。** 拒绝 —— 那正是缺陷。没有核验者就意味着意见**可见地**等待。
- **在 E1 而不是 D4 核验。** 拒绝:E1 要发布稿件,没法把意见退回去再来一轮,而退回去正是这次阅读的意义。

## 后果

- **`tests/resolution-verifier.spec.ts` 八条**:待验证 → 已答复;被否决 → 回到 open 并带理由;作者的核验被拒;对没有待验证意见的读法被拒;整链里,有核验者的部署让这一轮结清(`closed`,每条意见 `answered`),而**核验者就是作者时这一步失败**(`verification-not-independent`);并且核验者拿到的是改动与改后的正文,不只有论证。
- **既有 D4 用例按新事实更新**(`tests/d4-model-revision.spec.ts`):三个已应用的补丁现在读作 `pending-verification`;没有核验者的两轮循环报 `awaiting-verification` 而不是 `closed`。
- **这里不是的。** 它还没有要求**最低轮数**,也还没有阻止「修订未被核验」的运行导出草稿 —— 那条最终包条件属于下一个单元。裁定者是部署的读者;出货 bundle 不点名任何核验者,所以出货运行的每一条意见都在等待,并且它说得出来。

## 文件

- `packages/research/dsh-research-team/src/runner/issue-patch.ts`(处置、`awaitingVerification`)、`src/runner/resolution-verifier.ts`(新增)、`src/runner/registry.ts`(D4 先应用再核验;停止原因拆分)、`src/runner/types.ts`(`DriveOptions.resolutionVerifier`)、`src/runner/drive.ts`(带进去)。
- `packages/research/dsh-research-team/README.md` / `README.zh.md`。
- 用例:`tests/resolution-verifier.spec.ts`(新增)、`tests/issue-patch.spec.ts`、`tests/d4-model-revision.spec.ts`。
