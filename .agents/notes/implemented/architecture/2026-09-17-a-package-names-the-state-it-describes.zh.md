# Agent Note: 包会写明自己描述的是哪个状态,而对着已移动的运行再次导出会说出来

Status: implemented

[English](2026-09-17-a-package-names-the-state-it-describes.md) | 中文

## 问题

manifest 写明了运行的 `projectRevision` 与导出的时刻,却没有写明这份包建立在哪些产物之上。一次导出之后运行又移动了 —— 后续的步骤、一次修订、一次重跑或一次手工编辑 —— 磁盘上那份包描述的就是运行已不再持有的状态,而读者无从分辨。九条最终包条件覆盖了批准与运行的落盘,没有一条覆盖「这还是不是那个运行」。

## 决定

- **manifest 携带 `artifactRefs`**,导出读取的每件产物一条,连同计划时运行持有的版本。slug 是列出来的而不是发现的:一份记录运行所持有全部产物的包,会在它从未用过的产物移动时报警。
- **`checkFinalPackage` 新增 `artifacts-current`**,而喂给它的是一次导出**真能**做的比较:`previousArtifactRefsOf(directory)` 读出磁盘上那份包所依据的版本,`@Remote('exportRunPackage')` 把它们交给计划。检查于是点名运行已经走过哪些产物,而这份包无论其他条件如何都只能是 DRAFT。
- **读不出来的 manifest 不是能做的比较。** 文件缺失或无法解析时,读取器返回空,检查陈述的是这份包读到了什么,而不是它无法支持的判定。因为一个旧文件损坏就拒绝导出,会把补救手段本身拿走。

## 考虑过的其他做法

- **拿运行的版本计数器比较,而不是逐产物版本。** 拒绝:它只会说「状态变了」而说不出**什么**变了,而补救 —— 重新导出,或者去看什么变了 —— 需要那件产物。版本计数器也分不清样式改动与结果改动。
- **上一份包过期时拒绝导出。** 拒绝:导出本身就是补救。拒绝会让读者守着那份过期包,没有拿到当前包的路。
- **把依赖图搬进包这一层。** 拒绝:哪一步的产物会让谁失效是 core 的声明式输入图,已由 stale-attempt 规则强制并在那里测试。本单元记录一次读数并比较它,不重新推导失效。

## 后果

- **生产路径上钉住了两种情况**:从某个运行导出的包记录它读到的版本并通过 `artifacts-current`;被交给一份更旧读数的计划会点名移动过的产物,并被拒绝成为 final(`tests/package-export.spec.ts`)。
- **这里没有覆盖的。** 对于从未被比较过的包,这条检查没有可比对象 —— 它的条目陈述的是自己读到了什么,而不是一个判定。依赖图本身(结果变化让草稿失效、样式变化不影响实验)属于 core,而运行冻结的画像已经保证重新配置移不动一项研究:这些都在它们各自所在之处测试,不在这里复述。

## 文件

- `packages/research/dsh-research-team/src/runner/final-package.ts`(事实字段与检查)、`src/runner/package-export.ts`(`artifactRefsOf`、`previousArtifactRefsOf`、manifest 字段、选项)、`src/index.ts`(Remote 导出与磁盘上的那份比较)。
- 测试:`tests/package-export.spec.ts`、`tests/final-package.spec.ts`。
