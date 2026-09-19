# Agent Note: 七类模式的清扫,以及两个谁也读不出的产出者

Status: implemented

[English](2026-09-20-seven-patterns-and-what-a-sweep-found.md) | 中文

## 问题

研究层在 2026-09-19/20 逐个修掉了七个缺陷,每一个都是一套绿灯测试看不见的。每一个都是**一类模式**,修掉一个实例并不消掉这一类。本记录写下的是"照着这一类去找其余实例"的结果:七类中有两类各有一个**还活着**的第二实例,此外清扫还找出两个根本不在清单上的缺陷。

**"快照里允许出现哪些产出者"这条规则写了两遍,而管用的那份副本是不完整的。** `run-persistence.ts` 拒绝任何不是十六个步骤之一的 `registry.*.producerStepId`,只为 `ACCEPTANCE_PRODUCER` 开了一个硬编码的口子。那个口子是在一次"被接受的稿件让快照读不出来"之后加的 —— `listRuns` 抛错,选择器空掉。那次修复只覆盖了 core 自己写的那**一个**产出者,没有覆盖 team 写的另外**两个**:`manuscript-import` 与 `materialize-manuscript`,两者都经由 `publishArtifactVersion` 发布。经服务实测:一份手工改过的文件被导入之后,`persistRun` 拒收快照,这次运行永远存不下去,而紧接着的人工批准回的是 `research/approval-save-failed` —— 整个单元存在的意义,那条往返链路,在最后一步断掉。这份文档只在下次 `tryLoad` 之前是持久的。

**期刊规则的决定被实现了两遍,而两份互相不一致。** `checkVenueRules` 在 2026-09-18 被修正成 profile 的三种结论 —— 读了且写明、读了且没写、从未读过 —— 只有最后一种才拦投稿。`final-package.ts` 里的 `journalRulesOf` 仍旧是旧的二态读法(`verification !== 'verified'`),而且自己重新数了一遍;它自己的 JSDoc 却写着 `checkVenueRules`"才是那个决定,取自规则所在之处,而不是在这里重新推导"。随包发布的 `TRC_PROFILE` 带着一条 `not_specified` 规则(`graphical-abstract`),于是 `journal-rules-verified` **拒绝**了为那本期刊写的每一份投稿:实测结果是 `1 of 9 requirement(s) ... have not been read (graphical-abstract)` —— 而那份指南是完整读过的。只有 WBS 那一层的用例注意到了它,而它断言的是另一个规则确实未读的 fixture 期刊。

**修复路径重排了排版稿,却没有重跑闸门,而且没有任何东西说明这一点。** `materializeManuscript` 是"稿件在排版后移动了"这个问题的既定答案。失效模式并不是那条限制所声称的那一种:手工改稿会移动 `manuscript`,而 `approvalStalenessOf` 确实会拒绝旧的批准。没有任何东西覆盖的,是页面实际使用的那个顺序 —— 先改稿、再修复、**然后**批准。端到端实测:修好之后的这次运行,除了证据 profile 与评审策略之外,报告不出任何问题;在生产 profile 且评审策略满足时,它会把一份**没有任何闸门审过**的文档导出成 final。

**`project-view.ts` 把"这一步会跑在什么之下"报成了"实际跑的是什么"。** `stepProducerOf` 早已引入,好让 `drive.ts` 与包的运行事实都从步骤自己的产物上读产出者,`run-summary.md` 也随之修好了。浏览器渲染的那份投影仍旧取 `entry.producer` —— 注册表声明的品牌 —— 并把它叫做 `producer`:同一个字段名,问的是另一个问题。于是面板把一份模型写出来的稿子报成了该步骤执行的那个表格渲染器产出的。

**而本该抓住这些的测试抓不住。** 对研究层用例的一次扫描找出了一批"两边解析到同一个值"的断言,以及一批**标题点了一个轴线、正文从未变动过它**的用例。三条是确定的:`closed-loop.spec.ts` 拿闸门裁决的 `targetRefs` 与 core 用来构造它的提交回执比较;`a3-agenda-derivation.spec.ts` 拿 `agenda.plan` 与 `agenda.phases` 比较,而模型分支把两者从同一个数组赋值;`convergence.spec.ts` 断言一段摘要是以"从同一个字段插值出来的前缀"开头的。`researchview-component.dom.spec.ts` 的标题写着"渲染全部九个标签页",正文是一张手写的九个标签清单,而工作台已经有十一个 —— revision 与 quality 两个面板从来没有在测试下渲染过。

## 决定

- **产出者名册从运行里读,不留在 core 里。** `parseRegistry` 现在接受一个非步骤产出者,条件是这次运行自己的审计日志里存在一条 `artifact-republished` 事件,点名**那一个** slug 与**那一个**产出者。另一条路 —— 在 `run-persistence.ts` 里放一个常量清单 —— 正是已经错过一次的那个东西:它只能点名 core 知道的产出者,而部署自己加的那些恰恰就是出事的那些。接受稿件的 `manuscript-accepted` 是另一种事件,所以 `ACCEPTANCE_PRODUCER` 作为并列的显式子句保留。`parseRunSnapshotPayload` 现在先解析事件,再把它传进去。
- **期刊决定住在规则所在之处。** `journalRulesOf` 调用 `checkVenueRules`,把它的拒绝带进 `FinalPackageFacts.journalRules`,而检查项报告的是那条拒绝自己的句子,不是一段转述。`established` 改成 `read` —— 有人读过多少条规则,不管那次阅读找到了要求还是找到了"没有要求";`passed` 读的是 `refusal`,因为光靠计数表达不出 `checkVenueRules` 会拒绝的"指南是空表"那一种情形。
- **被修复过的排版稿是一条调用方必须处理掉的显式拒绝。** 新增第十六个条件 `manuscript-gated`,只要排版产物带着修复的 `materializedAt` 标记就不通过:没有任何闸门审过这次运行持有的文档,而排版步骤的裁决仍旧站在它替换掉的那一版上。补救办法写在句子里,因为修复不可能变成"通过"的 —— `submitGateVerdict` 拒绝重新裁决一个已经判定的尝试(INV-VERDICT-IMMUTABLE)。这份文档仍旧可以作为它本来就是的工作草稿导出。
- **两个字段,两个名字。** `StepProjection.producer` 现在由 `stepProducerOf` 在步骤声明的输出上解析,`StepProjection.declaredProducer` 是注册表条目的品牌。读的是声明的输出,而不是注册表自己的分组 —— 因为一份被人在其上发布过的产物会归到 `human-acceptance` 名下,否则就会从它本来就属于的那个步骤里掉出去。
- **"两边同一个值"的比较,靠找出一个独立的另一边来修,绝不用删掉断言来修。** 闸门裁决现在与**注册表**比较,那才是这次运行持有的东西;`agenda.plan` 与模型回复写明的阶段比较;哈希那两处与测试自己挪动过的值比较。当轴线确实属于另一层时,就把名字改成正文实际确立的东西并加一条指针 —— `counts not_applicable as a reported exemption, with or without the detail`(做出这个区分的是解析器,它的用例就在同一个文件里),以及 `records the inputs it binds, as the registry held them`。
- **用例遍历的名册就是这个组件自己的名册。** `ResearchWorkbench.tsx` 导出 `WORKBENCH_TABS`;覆盖用例读它而不是留一份副本,断言它的大小,并把每一条都点一遍。

## 考虑过的替代方案

- **把那两个 team 产出者加进 `run-persistence.ts` 的常量里。** 拒绝:这就是已经失败过一次的那个修法。core 不能导入 team 的常量(依赖方向是 `core ← team`),所以这里的任何常量都是一份"得有人告诉 core"的名册,而下一个由部署定义的操作会把这个缺陷重新引进来。运行自己的日志,是唯一一个**由构造而成**就完整的来源。
- **`journalRulesOf` 继续自己推导,只把 `!==` 改成 `=== 'unknown'`。** 拒绝:那只是让两者今天一致,同时把同一个判断的两份实现留在原地。空指南那一种就说明了为什么 —— `checkVenueRules` 会用一条 `unverified` 为空的拒绝来表示它,而任何重新推导出来的计数都表达不了这一点,所以那份推导会让一个没人看过指南的期刊通过。
- **在 `materializeManuscript` 里重跑 E1 的闸门。** 拒绝:那是一次没有任何尝试记录的裁决,引擎也拒绝它 —— 已经判定的尝试永远不会被重新提交。把这次修复的后果讲清楚,是够得着的那一半里诚实的那一半。
- **拒绝修复本身,或者去掉修复路径。** 拒绝:修复是 `manuscript-typeset` 的正当答案,而正是它拒绝一份渲染着已被取代的文档的排版稿。缺的是第二个问题,不是第一个答案。
- **把 `producer` 改名,而不是加一个字段。** 拒绝:从驱动开始记录产出者的那天起,线上就带着这个名字,而读一个步骤的人关心的是**实际跑了什么**。声明品牌是新名字,因为它就是新问题。
- **照清扫的建议给那几个含义过载的标识符改名。** 拒绝,理由是这次清扫自己带着的约束:`'draft'` 是三种东西,而一次笼统的改名已经打破过十条断言。凡是含义确实含糊的地方,就在读它的那段 JSDoc 里写明。

## 后果

- 文档被导入或被重排过的运行,现在能存下去、也能读回来,人可以批准它。手工改过的运行遇到的拒绝不再是 `research/approval-save-failed`。
- 随包发布的生产 profile 能产出 final 包了:对一份完整读过的指南,`journal-rules-verified` 成立,包括它没有写任何要求的那一个主题。
- 修好之后的运行可以作为草稿导出,作为期刊收到的那个包则被拒绝,理由写在句子里。`start-run.spec.ts` 的人工批准那个用例现在期望两个未满足条件,过去期望三个 —— 第三个,也就是期刊那一个,正是这次修好的。
- 面板与 `run-summary.md` 现在对"一个步骤的产出者"说法一致,因为两者都从产物上读;声明品牌以它自己的名字摆在旁边。
- 五个用例文件是被**加强**的,不是被删减的。原本是恒真式的那些测试,现在在它们的主旨坏掉时会失败,而过去不会 —— 每一条都通过"把修复退回去、看它失败"验证过。
- 验证的边界是说明的,不是暗示的:`packages/research/dsh-research-web/tests/package-check-vocabulary.spec.ts` 正是逼出 `manuscript-gated` 那条客户端词条的东西,所以一个新的条件要么在屏幕上以两种语言被叫出名字,要么根本到不了。`packages/research/dsh-research-team/README.md` 里有**两处表述** —— 由另一位写手在本次工作推进期间提交(`edc5a636`),归那位写手所有 —— 现在已经过时,留给那位写手处理:"What is not here"那一段还写着 `materializeManuscript` 重排排版稿却不重跑 E1 的闸门、"手工改稿的代价由批准来兜住",而那正是 `manuscript-gated` 之前的状态;期刊那一段把 `checkVenueRules` 说成那个决定,却没有写明 `final-package.ts` 现在是去读它、而不是自己把规则再数一遍。

## 文件

- `packages/research/dsh-research-core/src/run-persistence.ts` —— `republishedProducersOf`、三子句的产出者规则,以及"先事件、后注册表"的解析顺序。
- `packages/research/dsh-research-core/tests/run-persistence.spec.ts` —— 被重新发布过的产出者被接受,而同一个产出者若被记在另一个 slug 上则被拒绝。
- `packages/research/dsh-research-team/src/runner/final-package.ts` —— `manuscript-gated`、`TypesetFacts.repairedFromVersion`、委托给 `checkVenueRules` 的 `journalRulesOf`,以及 `journalRules` 的事实形状。
- `packages/research/dsh-research-team/src/runner/project-view.ts` —— `producer` 从产物解析,`declaredProducer` 摆在旁边。
- `packages/research/dsh-research-team/tests/manuscript-repair-gate.spec.ts` —— 经由服务走完整条"改稿、修复、批准"的链路,断言那条拒绝,以及 final 导出确实执行它。
- `packages/research/dsh-research-team/tests/final-package.spec.ts` —— `manuscript-gated` 那一条,以及把期刊决定对着 `checkVenueRules` 读。
- `packages/research/dsh-research-team/tests/step-producer.spec.ts` —— 投影的两个产出者字段,经由一个真实模型的写作器驱动。
- `packages/research/dsh-research-web/src/client/record-vocabulary.ts` 与 `client/locales.ts` —— `manuscript-gated` 进两份词典。
- `packages/research/dsh-research-web/src/client/workbench/ResearchWorkbench.tsx` —— 导出 `WORKBENCH_TABS`。
- `packages/research/dsh-research-team/tests/{e2e/closed-loop,a3-agenda-derivation,convergence,manuscript-review,e2e/happy-path-t19b,second-study}.spec.ts`、`packages/research/dsh-research-core/tests/{commit,approval-binding,domain/quality}.spec.ts`、`packages/research/dsh-research-cordis/tests/{zotero-bibliography,tools-hardening}.spec.ts`、`packages/research/dsh-research-tools/tests/literature-search/mock.spec.ts`、`packages/research/dsh-research-web/tests/researchview-component.dom.spec.ts` —— 那些拿一个值和它自己比较的断言,以及那些标题点了一个正文从未变动过的轴线的用例。
