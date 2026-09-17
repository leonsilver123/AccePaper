# Agent Note: 那条检查拒绝了它自己点名的补救办法

Status: implemented

[English](2026-09-17-the-check-refused-the-remedy-it-named.md) | 中文

## 问题

`artifacts-current` —— 「最终包描述的是运行当前所处的状态」这条检查 —— 只要上一份包读取时依据的产物已经移动,就会失败。它自己的 detail 写明了该怎么办:`these artifacts moved after this package was read: … — re-export to describe the run as it stands`。

而这个补救办法做不到。交给再次导出的版本来自**磁盘上那份包**(`previousArtifactRefsOf(directory)`,已接进 `@Remote('exportRunPackage')`),而一份产物已经移动过的包,按构造描述的就是更旧的状态 —— 于是同样的过期版本会在之后每一次导出时再次送达,`moved` 永远不会为空,**「与上一次导出不同」成了永久违法**。一个移动过、又被重新检查并重新批准的运行,依然产不出最终包。复核以 R06 记下了这一条,并要求两个方向都要有测试。

## 决定

- **被重新检查并重新批准过的移动,不是这条检查要拒绝的移动。** 这条拒绝是为**迟到导出**存在的 —— 它要替换的是一份「运行已经离开、且没有任何人重新看过」的状态的读数 —— 而证明「重新看过」的工件就是批准:批准会点名它被作出时所依据的产物版本,因此一个仍然覆盖运行当前状态的批准(`approval !== undefined && staleApproval === undefined`)正是那份证据。
- **该拒绝的方向依然成立。** 没有批准、或批准已不覆盖当前运行时,`approval-recorded` 与 `approval-current` 会失败 —— `artifacts-current` 也失败,因为两个条件都不成立。迟到导出仍然被拒绝;只是不再为同一个理由被拒绝**两次**。
- **通过的那一侧会把发生了什么说出来**,而不是报一句「一切正常」:`this package replaces a reading of <artifacts>, which the run has moved past — and the approval it carries covers the run as it stands, so this package describes the state the decision was taken on`。

## 考虑过的其他做法

- **删掉 `artifacts-current`,把整条拒绝交给 `approval-current`。** 拒绝:两者回答的是不同的问题 —— 产物是否还站得住、以及决定是否覆盖它们 —— 而一次移动完全可以不涉及任何决定(一次恢复、一次重跑、一个离线步骤),此时还没有批准存在。
- **让调用者声明这次移动是否被复核过。** 拒绝:调用者对自己材料的声明,正是这个包里的检查存在的理由所要替换掉的东西,而批准是运行自己对这件事的记录。
- **用第一次导出写下的版本、而不是磁盘上的版本来比较,从而放行第二次导出。** 拒绝:那会掩盖「被替换的那份包描述的是另一个状态」这一事实,而这恰恰是再导出的读者最需要知道的一件事。

## 后果

- **两个方向都钉在 `tests/final-package.spec.ts`**:没有任何人重新看过的移动被拒绝并报成 draft;同一个移动、配上覆盖当前运行的批准,通过全部检查并成为 `final`。
- **既有的过期用例不变**:`tests/package-export.spec.ts` 导出的是一个评估运行,它不带批准,所以 `artifacts-current` 仍然失败、包仍然是 draft。
- **这里没有覆盖的。** 调用者无法要求导出一份**更早版本**的包 —— 导出总是读运行当前的状态 —— 所以「旧版本的迟到导出」只能以「移动了却没有对应批准」的形式到达,而这正是这些测试驱动的形态。按名导出某个历史版本是另一项操作,尚未实现。

## 文件

- `packages/research/dsh-research-team/src/runner/final-package.ts`(`artifacts-current` 检查)。
- 测试:`tests/final-package.spec.ts`。
