# Agent Note: 投稿是被准备的,不是被执行的

Status: implemented

[English](2026-09-19-submission-is-prepared-not-performed.md) | 中文

## 问题

`E2-submit` 把 `submission-record` 声明为它的产出,而从没有人写过一份。它的执行器是 `noExecutor`,它会抛 `T19B registry: E2-submit has no executor — it stops at the human gate`;而驱动根本走不到它:`driveStep` 在条目带 `humanGateStop` 标记时就短路了,直接调 `completeStep` 并返回 `outputSlugs: []`、`artifacts: []`。于是每一次运行都宣称有一份投稿记录,而注册表里一份也没有 —— 这正是本仓库反复点名的同一类缺陷:一个声明出来的产出,读起来像运行产物,却没有任何东西生产它。

这个标记还带来第二笔代价。一个可以不执行就 `complete` 的步骤,需要驱动里有一条别的步骤都不走的分支,而那条分支正是流水线不再是同一台机器的地方:E2 被豁免于 `startStep → runStep → completeStep`,于是这唯一一个由人决定的步骤,也成了唯一一个没有人必须去生产它声明的产物的步骤。

## 决定

- **E2 有一个真实的执行器,它准备而不是执行。** `e2Executor` 只从这次运行的产物里建出记录 —— 零文件系统访问,所以上一次导出留在盘上的 `manuscript.docx`、它写出的包、或者被人手改过的文件,都影响不到它;用那些东西建出的记录,会为这次运行从未持有过的字节作证。它点名这次决定绑定的两个版本(`manuscript` 与 `typeset`,经 `ctx.readInputRef` 取得 —— `getInput` 只带值,带版本的是它),列出编译记录下的文档及其格式、路径、字节长度与 SHA-256,点名这个部署自己的编译器声明能产出的格式,点名排版形态是为哪个 venue 渲染的,并写明 `submitted: false`、`decision: 'pending'`。
- **记录说清了自己是什么。** 它的 `note` 是 `PREPARED, NOT SUBMITTED`:上面那些文档和版本是一份投稿会携带的东西,没有任何东西被送到 venue,这条流水线里也没有任何东西会送 —— 投稿是一个人的对外行为。`submitted` 与 `decision` 是两个字段而不是一个,因为前者说的是世界上的事实,后者说的是这件事为什么不由流水线决定。
- **E2 仍然停在 `gated`,所以批准路径没有任何变化。** 驱动的短路被去掉了,这一步和其他每一步跑同一个序列,而这才让记录成为真的。收尾阶段现在写成"一个步骤到达终态的两条路,没有第三条":空的闸门由核心的 `completeStep` 收尾,对一个闸门是人的步骤返回 `gated`;非空的闸门由判定裁断。E2 只能经宿主的批准通道到达 `passed`。
- **`humanGateStop` 是被删掉的,不是被设成 false。** 这次改动之后没有任何东西读它,而一个永远为 false 的字段,就是在谎称那是一个选项。条目保留 `kind: 'humanGate'` —— 分级命名的是**步骤**的闸门而不是它的执行器,而在这个产物旁边放一个真实度分级,会把这次准备报成关于论文的证据 —— 同时 `tagArtifact` 接受 `'humanGate'`,于是注册表表、逐步表和 E2 产出的那一个产物三者说法一致(`producer: 'human-gate:E2-submit'`)。有一处用例断言带这个分级的只有 E2 一条,所以这条许可不会变成某个步骤"拒绝说自己跑了什么"。条目的 `timeoutMs` 从 `0`(它曾经意味着"没有执行器")移到离线上限,因为这里有执行器在跑,它像其他每一步一样受限。
- **批准绑定两个 ref,而这比绑定一个产物严格更好。** 核心的 `_applyHumanApproval` 仍然从 `step.inputs` 冻结 `targetRefs`,而它现在点名 `manuscript` 和 `typeset`。只绑排版形态的批准,会让文档在一项关于它的决定底下移动;只绑文档的批准,又说不出期刊会收到哪一个文件。
- **`final-package.ts` 增加了 `manuscript-typeset` 与 `typeset-complete`,而没有让任何原本可导出的东西变成致命。** `manuscript-typeset` 只在排版形态记录的"我渲染的版本"就是这次运行当前持有的版本时通过(两个版本都从运行自己的记录里读),于是一份已作废文档的渲染形态,就是论文当初那版草稿的渲染形态。`typeset-complete` 在这个部署的编译器声明它产出的、且属于 `SUBMISSION_FORMATS`(`docx`、`latex`)的每一种格式都存在、且字节长度与摘要与产物记录一致时通过 —— 要求跟着部署自己的声明走,所以一台没有 LaTeX 引擎的机器不向任何人索取 `.tex`。`finalPackageStateOf` 只在全部检查通过时是 `'final'`,否则是 `'draft'`,所以没通过这两条中任一条的运行照样能导出,导成草稿。
- **这里没有的是:任何会投稿的东西。** 不联系任何 venue;也不存在投稿记录,因为没有发生过投稿。

## Alternatives considered

- **把 `humanGateStop` 设成 `false`,而不是删掉这个字段。** 拒绝:执行器存在之后没有任何东西读这个标记,把它留成一个永远为 false 的字段,等于宣传一个已经不存在的选项,而下一个读者还得去证明这个 false 不是有承重的。
- **从磁盘上的文件建出记录** —— 已导出的包,或者运行目录下编译出的 `manuscript.docx`。拒绝,用执行器自己的理由:它们都不是"这次运行产出了这份文档"的证据。用它们建出的记录会为这次运行从未持有过的字节作证,而被手改过的文件会成为投稿请求的一部分。
- **只点名 slug,不带版本。** 拒绝:一份只点名 slug 的记录说不出这项决定是关于哪一个版本的,而让记录值得准备的就是那个版本 —— 批准会冻结 `targetRefs`,而一份与冻结内容不一致的记录,会是关于同一个决定的第二份、更弱的说法。

## Consequences

- 每一次走到这一步的运行,`submission-record` 都真的被写出来了;注册表持有的和运行宣称的是同一件东西。
- E2 从没有拒绝变成有两条拒绝:`[E2-submit] the run holds no document, so there is no submission request to prepare`,以及排版形态对应的同一条。在被驱动的运行里 `canStart` 保证两者都在,而一个直接调用者会被拒绝,而不是拿到一份"投稿已就绪"却在没有东西可投时给出的记录。两个输入都被读取,尽管只有排版形态提供那些文档,因为提交收据的输入摘要是按执行器**请求过**的 slug 取的。
- `StepExecutorEntry` 不再带 `humanGateStop`;`StepOutcome` 的 `kind` 文档注释、`report.ts` 里那两行报表和真实度图例,都不再说 E2 没有执行器。
- 驱动对两种闸门只有一条收尾路径,而不是每个步骤一个特例,所以将来某个闸门为空的步骤,不会再获得一个别的步骤到不了的状态。
- 报表的真实度表把 E2 计在 `humanGate` 之下,而机器仍然永远不会完成这一步。

## Files

- `packages/research/dsh-research-team/src/runner/registry.ts` —— `noExecutor` 被 `e2Executor` 取代、`refRecordOf`、被删掉的 `humanGateStop` 字段、接受 `'humanGate'` 的 `tagArtifact`,以及条目的 basis、`timeoutMs` 与注释。
- `packages/research/dsh-research-team/src/runner/drive.ts` —— 去掉的短路、按闸门是否为空分出的收尾阶段,以及 `ExecCtx` 上的 `readInputRef`。
- `packages/research/dsh-research-team/src/runner/final-package.ts` —— `manuscript-typeset` 与 `typeset-complete` 及其事实、编码与说明句。
- `packages/research/dsh-research-core/src/engine/state-machine.ts` —— `completeStep` 对 humanGate 步骤返回 `gated`,以及 `_applyHumanApproval` 从 `step.inputs` 冻结 `targetRefs`。
- `packages/research/dsh-research-core/src/engine/steps.ts` —— 批准所冻结的那组声明输入。
- `packages/research/dsh-research-team/src/runner/{types,report}.ts` —— 那些说 E2 没有执行器的注释与报表行。
