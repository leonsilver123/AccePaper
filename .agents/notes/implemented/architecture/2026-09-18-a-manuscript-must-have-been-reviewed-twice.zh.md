# Agent Note: 稿件必须有过部署要求的那些审阅

Status: implemented

[English](2026-09-18-a-manuscript-must-have-been-reviewed-twice.md) | 中文

## 问题

`revisionRounds` 限的是**能问作者几次**,而循环一旦某轮关闭了自己的意见就停。两者被互相读成了对方:「至多两轮」变成了「关光一切的那一轮就够了」,于是一份稿件可能只被读过一次就进了包 —— 2026-09-18 的流程复核把这一点列为两轮目标从未真正落实的原因。

## 决定

- **`runner/review-policy.ts` 陈述下限。** `ReviewPolicy { minimumRounds }`,默认两轮:一份稿件必须有过多少次**完整**阅读。它与证据画像一样是部署事实,随运行携带并记在工件上 —— 只要求一轮的部署是在做一个它有权做的决定,而要求两轮的部署不能被一轮满足。
- **什么算数。** 作者照旧答复的一轮(`no-progress`)不是第二次阅读 —— 把它算上,两轮策略就能靠同一轮做两遍来满足。`open` 或 `pending-verification` 的意见是欠账而不是答复,所以带着其中任何一种的审阅无论跑了几轮都还没走完。
- **下限未达时 D4 继续要。** 关闭了一切但没到部署下限的一轮会再得到一次阅读;`awaiting-verification` **不**继续,因为答复已摆在桌上、只有读者能结清 —— 再问作者只会得到同样的答复。轮次是**先记录再判断下限**的,所以真的发生过的阅读一定会出现在记录里。
- **`checkFinalPackage` 新增 `review-complete`。** 审阅没走完的稿件可以按它本来的样子作为草稿导出,**不能**作为期刊收到的那份论文。评估是在轮次发生的地方做出的、随工件旅行,所以这条检查与运行自己的记录不可能就「发生了什么」给出不同答案。
- **服务从部署读复核侧能力**(`statementAssessor`、`resolutionVerifier`、`reviewPolicy`),与它此前读编译器、绘图 provider 同一方式 —— 在此之前它们只有测试直接传 `DriveOptions` 才够得着。

## 考虑过的替代方案

- **抬高 `revisionRounds` 并称之为下限。** 拒绝:那个数数的是「问了几次」,下限数的是「读了几遍」,而第一轮就关光一切的运行谁也没问 —— 它会用一次阅读满足更高的次数上限。
- **在 `final-package` 里从轮次数量推导审阅状态。** 拒绝:策略的评估属于轮次发生的地方(工件本来就带着结果),第二次推导就是第二件可能与之矛盾的东西。
- **让只审一轮的部署静默地拿到最终包。** 拒绝:它声明了一轮,工件也这么写着。

## 后果

- **`tests/review-policy.spec.ts`**(7 条):默认是两轮;轮次太少被拒;有 open 被拒;有待验证被拒;`no-progress` 不计;两个真实轮次满足;第一轮什么都没发现也算一次阅读。**`tests/d4-model-revision.spec.ts`** 增加了生产路径上的下限用例:配置了读者、策略要求两轮时,关光一切的第一轮会再读一次。**`tests/start-run.spec.ts`** 增加了端到端的拒绝读数:同一次已批准的生产运行可以导出草稿,作为最终包被拒并点名 `review-complete`。
- **既有两个生产路径用例现在在「审阅发生的地方」声明策略** —— 在开展它的那个进程里,而不是导出的那个 —— 且成功路径配了一个读者,因为最终包要求修订被**读过**。夹具里的替身在它自己的 `basis` 里说明它什么都没读。
- **这里不是的。** 轮次仍然是 D4 循环的(一次调用既提意见又答复);由独立复核者产出自己的 `ReviewRound` 是下一个单元。而下限数的是运行真的做过的轮次 —— 想要两位**独立**复核者的部署需要的是复核者缝,而不是把这里的数字调大。

## 文件

- `packages/research/dsh-research-team/src/runner/review-policy.ts`(新增)、`src/runner/registry.ts`(下限与记录下来的评估)、`src/runner/final-package.ts`(`review-complete` 与那条事实)、`src/runner/package-export.ts`(事实从 rebuttal 工件读出)、`src/runner/types.ts` / `drive.ts`(选项)、`src/index.ts`(服务读那三项复核侧能力)。
- 用例:`tests/review-policy.spec.ts`(新增)、`tests/d4-model-revision.spec.ts`、`tests/start-run.spec.ts`、`tests/fixtures/approve-restart/approve-and-exit.ts`(`--review-rounds`、`--verify`)。
- `packages/research/dsh-research-team/README.md` / `README.zh.md`。
