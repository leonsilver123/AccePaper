# Agent Note: 就绪只有一个含义,并且只在一个地方评估

Status: implemented

[English](2026-09-18-ready-means-one-thing.md) | 中文

## 问题

两个模块各自决定一次运行的产出是否可发布,各用一份自己的条件表。`runner/submission-readiness.ts` 回答 `SubmissionReadiness`,导出把它投影为清单里的 `submissionReady`;`runner/final-package.ts` 回答最终包必须满足的十二条检查。其中六条被写了两遍 —— profile、稿件是否产出、各步是否关闭、是否有小节被拒、是否还有未关意见、批准是否过期 —— 另有两条只写在包那一侧。

于是二者可以互相矛盾,而 2026-09-18 的流程复核找到了那个例子:一次运行的修订被答复了却没人读过,它在清单里满足就绪(`ready: true`),而导出以 `review-complete` 拒绝了它。清单的读者被告知这次运行已经就绪,而包不会产出。

## 决定

- **`checkManuscript` 就是稿件的就绪,而且是它唯一的定义。** `final-package.ts` 声明 `ManuscriptFacts` —— 关于论文的七条:profile 合格、稿件存在、每一步都关闭、没有小节因缺证据被拒、没有意见仍未关、批准未过期、编译出的文档带着每一个 float、部署要求的审阅已完成。`checkManuscript(facts)` 恰好评估这七条。
- **`checkFinalPackage` 在其上追加交付侧的条件。** `FinalPackageFacts extends ManuscriptFacts`,多出关于包而不是论文的五条:批准已有记录、包带着稿件声明的文件、包描述的是运行当前所处的状态、该状态已落盘。它通过 `FINAL_PACKAGE_CHECK_ORDER` 把两组拼起来,所以报告顺序 —— 以及 `finalPackageRefusalOf` 先点哪一条 —— 与原来完全一致。
- **`submissionReadinessOf` 是 `checkManuscript` 的一个视图。** 它取这些事实,把第一条未满足条件自己的 `detail` 作为理由报出。一个函数、两种范围:一次运行不可能在清单里就绪、却因为一条关于论文的理由被当作包拒掉。
- **事实只采集一次。** `manuscriptFactsOf(store, runId, profile)` 从运行里读出每一条稿件事实;`finalPackageFactsOf` 从它出发再补上交付侧的。导出自己那份编译读取 —— `tool`、带每个 float 原因的 `floatsDropped` —— 也移了进去,顺带修掉一个字段名:在工件写 `floatsDropped` 的地方去读 `dropped`,会让这个列表永远是空的。
- **两处理由措辞并入了检查自己的措辞。** 「an approved step's inputs changed after the decision」与「the manuscript has no X section … refused to write it rather than fill it in」现在住在 `approval-current` 与 `no-refused-sections` 上,就绪原样转述它们,而不是保留一份可能走样的副本。

## 考虑过的替代方案

- **让 `submissionReadinessOf` 构造完整的 `FinalPackageFacts` 再跑 `checkFinalPackage`。** 拒绝:就绪问的是一次**运行**,而包并不存在 —— `packagedFiles`、`artifactRefs`、`saveError` 只能凭空造,而 `required-files-present` 会因为一个从未写出的包拒绝每一次运行。
- **保留两份并在测试里断言它们一致。** 拒绝:测试钉住的是有人想到的那些情形,而复核查到的那个谁也没想到。同一事实的两处推导就是缺陷本身;那份测试只是给缺陷写说明。
- **把一切搬进一个模块、删掉另一个。** 拒绝:检查词汇表与那十二条是**包**的,就绪是**运行**的;这条分界是真的。错的不是分开,而是两边都在判定同一批条件。
- **保留就绪自己对未关意见的措辞。** 拒绝:措辞属于那条检查,同一个条件有两句话就是第二件需要同步的东西。

## 后果

- **`tests/submission-readiness.spec.ts`** 围绕事实对象重写(12 条):原有的就绪用例,加上复核点名的两条 —— 审阅没走完、编译出的文档丢了 float —— 以及「报出的理由跟随**最终包**的顺序而不是就绪自己的顺序」这一条。
- **`tests/d4-model-revision.spec.ts`** 翻转了一条断言,而这正是这次改动的要点:一次运行的修订处于 `awaiting-verification`、所有门都关闭、包也被人批准过,现在它是 `ready: false`,理由是「waiting for a reader」。它以前是 `true`。
- **`tests/final-package.spec.ts`** 与 **`tests/start-run.spec.ts`** 断言那唯一一处措辞。
- **这里不是的。** `SubmissionReadiness` 仍然只报第一条未满足的条件,因为它的读者要据此行动;完整清单是包的检查。两者也没有被合并成一个类型:只想要论文就绪的调用方不必持有包的事实。
- **`openIssuesOf` 与 `OpenIssue` 移到 `final-package.ts`**,并从 `submission-readiness.ts` 再导出,所以导入方向是单向的,也没有任何既有导入方需要改动。

## 文件

- `packages/research/dsh-research-team/src/runner/final-package.ts`(`ManuscriptFacts`、`checkManuscript`、`FINAL_PACKAGE_CHECK_ORDER`、`manuscriptFactsOf`、`compilationOf`、`reviewOf`、`openIssuesOf`)。
- `packages/research/dsh-research-team/src/runner/submission-readiness.ts`(围绕 `checkManuscript` 重写)。
- `packages/research/dsh-research-team/src/runner/package-export.ts`(移除自己那份编译读取;由事实来读)。
- 用例:`tests/submission-readiness.spec.ts`、`tests/d4-model-revision.spec.ts`、`tests/final-package.spec.ts`、`tests/start-run.spec.ts`、`tests/section-evidence.spec.ts`、`tests/scientific-credibility.spec.ts`。
