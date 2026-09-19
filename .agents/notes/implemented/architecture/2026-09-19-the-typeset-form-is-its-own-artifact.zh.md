# Agent Note: 排版形态是它自己的产物

Status: implemented

[English](2026-09-19-the-typeset-form-is-its-own-artifact.md) | 中文

## 问题

E1-format 只产出一个 `formatted-manuscript`,而它同时是三样东西:稿件的 Markdown、编译报告(跑的是哪个工具、这个部署提供哪些格式、产出了哪些文档、哪些浮动体嵌不进去),以及已编译的 DOCX、LaTeX、HTML、PDF 字节和它们内嵌资源的载体。想要其中任一样的人,都得把这个产物拆开;而且没有任何东西把"论文"和"编译器对论文做了什么"分开。

同一套安排还把组装和编译放进了同一个步骤。E1 拿这次运行测出来的量去调 `three-line-table`,组合浮动体,建出文档模型,然后才把结果交给编译器。两个后果随之而来,而两个都正是这一层存在的意义所在:编译器收到的文档,在任何读者能拿它跟论文对照的地方都不存在;E1 成了第二个决定论文里那些数字是什么的步骤,于是编译出的文档可以带一张 Markdown 稿件没有的表 —— 而一份文档可以以一种没有任何其它步骤批准过的状态到达编译器。

## 决定

- **文档和它的渲染形态是两个产物,各有唯一的拥有者。** `steps.ts` 声明 E1 `outputs: ['typeset']`。`manuscript` 仍是文档,由 D3 创建、D4 带着修订重新发布;E2 声明 `inputs: ['manuscript', 'typeset']`;`ARTIFACT_TYPE_BY_SLUG['typeset']` 是 `'typeset-package'`,`PACKAGED_SLUGS` 两者都带。`ACCEPTED_MANUSCRIPT_SLUG`(`engine/acceptance.ts`)跟着改成 `'manuscript'`,因为一次接受发布的是**文档**的一个新版本:把候选稿组装到排版产物上,那是对一个渲染形态做修改,而接下来读文档的东西会读到没有人接受过的那个版本。
- **E1 渲染,不再组装。** 它读 `manuscript`,取它的 `document` 字段,编译那一个。拒绝语句说的是缺失的那个事实,而不是绕开它:`[E1-format] the manuscript artifact carries no document to render`。只凭产物的 sections 去渲染 Markdown,会发布一个包,而它的编译形态描述的是没有任何步骤写过的论文。
- **结果表移到了 D3-writing,这推翻了 T19-S 的裁定。** 记录旧裁定的注释是被改写而不是被删掉的,替换上去的是这样一段:T19-S 把表格当成一件**排版**事务 —— 论文在被排版时才获得三线表 —— 而这条裁定在它管得到的范围内成立,因为能力属于工具,从不属于步骤;`E1-format` 从来就不是 `renderThreeLineTable`。它漏掉的是:一份在排版之前就具有权威性的文档,必须**已经**含有它的表。E1 只能靠自己去读这次运行的测量值来渲染一张表,这就让 E1 成了第二个决定论文里那些数字是什么的步骤。文档是 D3 写的,表是它的一个块,所以由 D3 把 `three-line-table` 当作自己的能力来调用。注册表自己的文件头现在记着这次取代 —— `SUPERSEDED ON 2026-09-19: the T19-S ruling kept the table inside E1 as a sub-capability, and the table has since moved to D3-writing — a document that is authoritative before it is typeset has to already carry its table. E1 now invokes no catalogue tool at all.` —— 而 `e1Executor` 的 JSDoc 带着同样的读法:这条裁定在它谈的是工具的地方仍然成立,弄错的是它把这件事归给了哪个步骤,因为排版时才加进去的表不是读者批准的那份文档的一部分。
- **真实度分级随能力一起移动,因为分级命名的是实际跑了什么。** D3 是 `real_tool_fixture_input`(它的正文仍是本包的固定句子,而**真实**的 `three-line-table` 工具函数在其中执行),E1 是 `local_computation`(没有目录里的工具在跑;编译是部署去填的接缝)。E1 的产出者署名跟着同一个事实走:`E1_PRODUCER` 从 `three-line-table` 的工具 id 与版本改成 `'render:typeset-package'`。
- **E1 的拒绝一条都没有被削弱。** 引用与参考文献的一致性、陈述绑定、句子支撑读数、论证计划的义务,全部照旧执行、照旧拒绝;它们读的是 `manuscript` 而不是旧的 `revised-draft` slug,没有一条为了让这次改动落地而被放松。
- **浮动体只在文档被写下的地方组合一次。** D3 从工具返回的结构化模型建出 Markdown 管道表,并用它组合文档的浮动体;E1 用同一个函数、对着同一份 `renderedFigures` 组合包的 Markdown 浮动体,而表是从文档里取的,不再排第二遍。

## Alternatives considered

- **保留 E1 组装,只把 slug 改个名字。** 拒绝:那样编译论文的步骤仍然决定论文说了什么,而且一份文档仍然可以以一种没有任何其它步骤批准过的状态到达编译器。改个名字会留下这两个产物 —— 读者读的 Markdown 和编译器收到的文档 —— 仍然只能由同一个步骤构造,于是它们之间的不一致从注册表上依然看不出来。
- **保留 E1 的 `three-line-table` 产出者署名和它的 `real_tool_fixture_input` 分级。** 拒绝,用注册表自己的话:这个署名"was true while the table was rendered here and became a claim about a tool this step no longer invokes"。分级不是装饰 —— 报告把 `real_tool_fixture_input` 渲染成"真实工具函数已执行",所以一个不调用任何目录工具的步骤不能带它。
- **把表留在 E1。** 这正是 T19-S 裁定产生的安排,而推翻它就是这次改动的两半之一:E1 只能靠排版时重新推导研究的数字来渲染一张表,而这恰恰是这次拆分要去掉的那个第二决策者。

## Consequences

- `formatted-manuscript` 不再是产物 slug;`typeset` 取代它,`manuscript` 仍是文档。编译报告和已编译的字节住在 `typeset` 下。
- 文档不含的表现在无法表示:编译出的文档和 Markdown 稿件是同一份浮动体清单的两种渲染,在 D3 组合。
- `documentOf` 与 `pandoc-compiler.ts` 不再为属于写作步骤和编译接缝的事实点名 E1;`pandoc-compiler.ts` 在本次改动里只有注释变化。
- 注册表把 D3 报为一个执行目录工具的步骤,把 E1 报为一个不执行的步骤。两个步骤的闸门都没有任何变化。
- 因为 E1 渲染的是一份它能点名的文档,排版产物就记下了它渲染的是哪个稿件版本,而一个包也就能被问:它的排版形态渲染的是这次运行持有的文档,还是它已经抛在身后的那一份。

## Files

- `packages/research/dsh-research-core/src/engine/steps.ts` —— E1 `outputs: ['typeset']`、E2 `inputs: ['manuscript', 'typeset']`。
- `packages/research/dsh-research-team/src/runner/registry.ts` —— T19-S 被取代的注释、`E1_PRODUCER` 署名、两个真实度分级、D3 的表渲染,以及 `e1Executor` 的文档拒绝。
- `packages/research/dsh-research-team/src/runner/{document-compile,package-export,final-package}.ts` —— 跟着 slug 走的那些读取、`PACKAGED_SLUGS`,以及读 `typeset` 的 `manuscriptProduced`。
- `packages/research/dsh-research-core/src/engine/acceptance.ts` —— `ACCEPTED_MANUSCRIPT_SLUG` 是 `'manuscript'`。
- `packages/research/dsh-research-cordis/src/pandoc-compiler.ts` —— 两处点名 E1 的注释。
- `packages/research/dsh-research-team/README.md` 与 `.zh.md` —— 关于移走的表和两个 slug 的延期工作条目。
