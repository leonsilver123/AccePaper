# Agent Note: 没人读过的规则,不是稿件已经满足的要求

Status: implemented

[English](2026-09-18-a-rule-nobody-read-is-not-a-requirement-met.md) | 中文

## 问题

此前的每一条发布条件问的都是**论文**是否完成 —— 审阅走完没有、图有没有嵌进去、交付文件写没写、批准是否仍然有效 —— 没有一条问它是不是**期刊**会收的那份文档。E1 写的是 `venueStyle: '<name> template'`,点名了一份没有任何运行读过、而编译器实际用的是 pandoc 默认的模板;计划自己对这道缺口的说法是「未知期刊规则阻断最终发布」,并诚实记下了官方指南取不到。

顺手的补救是一张表:摘要字数、引文风格、图数。它会读起来像合规,实际上什么都没量,而且顶着期刊的名字这么做。

## 决定

- **规则是一条记录,不是一个取值。** `JournalRule` 补上了一条要求必须携带的东西:它写在**哪个官方页面**、那个页面何时被读过、适用于哪种文章类型、是否已核实,以及条件 —— 或者这次尝试页面得到了什么。`'verified'` 只意味着有人在那个来源、那一天读过它。没有第三种状态,也绝不会因为「这显然吧」而标成已核实。
- **没有规则的期刊画像就是未读的指南,而 TRC 现在是八条 `unknown`。** `unreadRulesFor` 记下每本期刊指南都会回答的那些问题 —— 摘要长度、highlights、图形摘要、引文风格、图与表、稿件文件、各类声明、匿名要求 —— 每条标为 unknown,带上会陈述它的那个页面的 URL 与这次尝试的结果。这替换了画像原先带的空表:「没人读过这本指南」是真的,但不可行动,因为它没说什么东西缺着。把这些**问题**记下来不是给它们填默认值 —— 编一个字数上限会读起来像合规,而一条 `unknown` 规则会被拒绝。
- **由 `checkVenueRules` 决定,`checkFinalPackage` 新增 `journal-rules-verified`。** 画像里有任何一条未读规则即拒绝最终包,并点名规则 id,让读者知道要翻几页;画像没有规则则以「未读的指南」被拒;完全没有画像的运行以 `journal-rules-absent` 被拒。关于论文的那些条件不变 —— 这条问的是投稿。
- **读过指南的部署在运行被开展的地方声明它。** 这道缝本来就有:`resolveResearchProfile({ journal })` 把画像冻结进运行的 spec,导出从那里读,而不是自己重述它想据以发布的规则。这个单元的第一版在它旁边又加了一个 `venueRules`,而画像自己的用例抓到了这次重复 —— 一个事实,一个家。
- **E1 不再声称有模板。** `venueStyle` 原本写 `<name> template`;现在它说明编译器用的是 pandoc 默认,而该期刊的要求记录在运行的画像上、并未被应用。

## 考虑过的替代方案

- **凭记忆或二手来源硬编码 TRC 的限额。** 拒绝:没人读过的限额就是猜测,而一份满足它的稿件读起来像被核过。计划自己的要求是每条规则都带官方来源、访问日期、文章类型与验证状态。
- **把缺口留成沉默,让最后一条条件就是 `run-saved`。** 拒绝:这条流水线会在一套没人读过的规则下发布,而且什么也不说 —— 那正是这整个子系统要对付的失败模式。
- **只对「真实期刊」记录规则。** 拒绝:venue 工件本来就区分 `retrieved-corpus` 与 `declared`,两者都是指南必须被读过的期刊。声明出来的期刊不因是自己声明的就免于它自己的要求。
- **在运行时抓取指南。** 目前拒绝:检索主机是一个策略问题(一次运行去够开放网络,需要与文献通道相同的出处规则),而且实测状态是官方页面本来就拒绝这台主机。缝是期刊画像,填它是某个人去做的一次阅读。

## 后果

- **实测,2026-09-18。** 从本机尝试了 TRC 的三个官方页面 —— `sciencedirect.com/journal/transportation-research-part-c-emerging-technologies/publish/guide-for-authors`、`…/about/author-information`,以及 `elsevier.com/journals/transportation-research-part-c-emerging-technologies/0968-090X/guide-for-authors` —— 每一个都返回 HTTP 403 与一个 JavaScript 挑战页(1.2 MB),而不是指南。`TRC_PROFILE` 把这个发现记成它每一条规则的 `detail`,于是记录为自己那些 `unknown` 写下了证据。
- **`tests/venue-rules.spec.ts`**(7 条):未读指南被记成问题、每条带来源与尝试结果;据此投稿被拒并点名 id;没有画像的运行以「无从核对」被拒;画像规则表为空则以「未读的指南」被拒;全部读过的指南通过;**一条**未读就足以拒绝。
- **`tests/research-profile.spec.ts`** 钉住出货画像:八条规则,没有一条被声称为读过,每条都点名会陈述它的那个页面。
- **`tests/start-run.spec.ts`** 在生产路径上覆盖了两个方向。那次已批准的 production 运行现在有三条不满足 —— 画像、审阅、以及期刊规则 —— 用例写明为什么。成功路径重新可达,是因为**开展**这次运行的进程声明自己读过指南(夹具的 `--venue-rules-read`,提供 `journal`),而导出进程从运行里读那份被冻结的画像,不是自己提供规则。
- **这里不是的。** 本仓库里没有记录任何一本期刊的规则。出货状态是这条流水线产不出最终包,而这正是真实状态:一份投稿无法被说成满足没人读过、因而无从谈起的要求。填上这条记录是一次阅读,它是 P18-09 剩下的部分。

## 文件

- `packages/research/dsh-research-team/src/runner/research-profile.ts`(`JournalRule` 的出处字段、`unreadRulesFor`、`TRC_PROFILE`)、`src/runner/venue-rules.ts`(新增 —— 那个判定)、`src/runner/registry.ts`(E1 的 `venueStyle`)、`src/runner/final-package.ts`(`journal-rules-verified`,从冻结的 spec 读出)。
- 用例:`tests/venue-rules.spec.ts`(新增)、`tests/start-run.spec.ts`、`tests/final-package.spec.ts`、`tests/fixtures/approve-restart/approve-and-exit.ts`(`--venue-rules-read`)。
- `packages/research/dsh-research-team/README.md` / `README.zh.md`。
