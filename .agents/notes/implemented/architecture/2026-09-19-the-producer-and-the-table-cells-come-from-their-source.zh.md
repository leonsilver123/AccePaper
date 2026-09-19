# Agent Note: 生产者与表格单元格取自它们的源头

Status: implemented

[English](2026-09-19-the-producer-and-the-table-cells-come-from-their-source.md) | 中文

## 问题

有两个读者要核对的事实,一直在从自己的一个有损副本上读取,而这两个副本都躺在期刊会收到的那个包里。

**某一步的生产者被写成了它运行在什么品牌之下。** 一次真实运行的包里,`run-summary.md` 把 `D3-writing` 的生产者报成该步声明的品牌 —— 也就是它执行的那个表格渲染能力 —— 而这次运行的手稿产物明明记录着 `proseSource: 'model'`,经由部署配置的那条通道产生。登记表条目声明的是某步运行**在什么之下**;产物记录的是谁写出了那份文档,而对每一个"通道属于部署事实"的步骤来说,这两个字符串是不同的。那一行是从条目拼出来的,于是一篇模型写出的论文被报成由某个工具生产 —— 这正是登记表的品牌检查存在的意义所要防的漂移,只是一层之上,那些检查看不见它。

**机读表格是对印刷版的重新解读。** `tables/<label>.csv` 过去经由 `parsePipeTable`(即 `markdownPipeTable` 的成文逆函数)从 `tables/<label>.md` 解析回来。这个往返在构造上就是有损的 —— 管道表以换行结束一行,所以渲染器会把单元格里的换行压成空格 —— 也就是说,那个孪生、那份给工具消费的形态,装不下印刷形态压平掉的字符。工具返回的结构化模型(`columns` / `rows`)在 D3 手上,却被丢掉了,于是包里装着同一张表的两次陈述,只有一次是可还原的。

另外两处缺口属于同一个单元。`runner/staged-directory.ts` 停在 91.5% 行 / 85% 分支,而本仓库的门槛是每文件 100%,没被覆盖的正是它的回滚。而这个包已有的每一个集成测试都用 `ctx.plugin(...)` 在手搭的服务上启动服务,那验证的是行为而不是组合:某个注入名、某个配置字段、某种插件形态不再解析得出来,对一套自己提供服务 的测试是完全不可见的。

## 决定

- **某一步的生产者改从它已提交的产物解析。** `runner/registry.ts` 的 `stepProducerOf(entry, values)` 在该步自己的产物全都一致时返回它们携带的品牌,在不一致、或该步什么都没产出时返回条目声明的品牌。`drive.ts` 经它设置 `StepOutcome.producer` —— 与 `kind` 早就在同一个地方按同样方式解析 —— `package-export.ts` 的 run facts 对每一行也这样解析,而那正是 `run-summary.md` 渲染的东西。**取值来自那一步,绝不按 slug 从登记表读**:`manuscript` 会被 D4、E1 和一次审批重新发布,而登记表每个 slug 只保留最新一份值,按 slug 读会把 D3 那一行报成更靠后某步的生产者。
- **结构化模型与它的渲染一起走。** 文档的 `table` 块新增了 `model: ThreeLineTableModel` —— 即 `three-line-table` 能力返回的归一化模型 —— 由 `composeFloats` 在渲染管道表的唯一那处填上,所以一个块的 Markdown 就是它旁边那个模型的一次渲染。跨一次重新发布它是免费带过去的:重建文档正文的那一步会按原样带走非正文块。
- **两种形态都从模型读出。** `runner/paper-format.ts` 里的 `tableCellsOf` 把模型变成表头与正文单元格;`markdownPipeTable` 为印刷版转义这些单元格,`csvRecords` 为孪生按 CSV 加引号。谁都不是从对方派生出来的。
- **`parsePipeTable` 被删除。** 它存在只是为了从一种形态造出另一种,而它自己的文档就写明了它还原不了什么。一个自称表却没有携带模型的 `table` 块根本不会被带走,而不是被发布成一张配上无法核对的渲染的标题,于是 `PackagedTable.csvRefusal` 也随之消失 —— 已经不存在"有印刷版却没有孪生"这种可能了。
- **回滚那些没被覆盖的行,靠在文件系统调用处注入失败来覆盖**,经由 `staged-directory.spec.ts` 里的 `vi.mock('node:fs')`;而"清单校验拒绝"那一条,用一个把自身条目写成清单文件的计划覆盖。调用方能造出的任何状态,都不可能让那次换入 rename 在本套件运行的所有平台上失败:前一个目录先被移到一边,所以换入发生时目标路径是空的,而两次 rename 需要同一个父目录与同一份权限。暂存目录里被打开的句柄只在 Windows 上挡住那次 rename —— 手工验证过 —— 所以一个基于真实状态的测试会让这些行在 POSIX 车道上留在未覆盖。`staged-directory.ts` 现在行、分支、函数、语句四项均为 100%。
- **组合本身有了自己的测试。** `tests/loader-composition.spec.ts` 把一份仅测试用的 `cordis.yml`(每个测试各写一份)经 Loader 启动:真实的 team 插件加一个替身引擎(`tests/fixtures/loader-boot/engine-stub.ts`),后者的两个目录来自配置,文档工具链则是组合无法提供的那一个外部依赖。它断言的是用户可见的输出 —— 一次被驱动运行的磁盘工作目录、里面的文档、编译产物,以及点名它们的清单 —— 并且没有条目被留在未加载状态。

## 考虑过的替代方案

- **在一行里同时报两个品牌。** 否掉:在同一行里并排写着"某步运行在什么之下"和"它实际由什么运行",等于要求读者自己知道该信哪个字段。该步自己的记录只回答一个问题 —— 这是谁生产的 —— 而产物的品牌就是它的答案。
- **在块上携带已经压平的单元格(`header` / `rows`)而不是模型。** 否掉:单元格本身就是一种渲染 —— 单位被追加到表头、跨列被补成空格 —— 携带它们就是在模型旁边再放一个"这张表的列是什么"的权威,而一个需要列的 unit、decimals 或 metric direction 的格式,最终还是得回到模型去重新推导。
- **保留 `parsePipeTable` 作为"块没带模型"时的兜底。** 否掉:没有任何一步会写出这样的块,所以这条兜底只有测试够得着 —— 而且它保活的恰恰是那种无法服务它本该服务的场景的读法。
- **用真实状态让换入 rename 失败。** 实测之后否掉:在 Windows 上,暂存目录里一个被打开的句柄会挡住对它父目录的 rename(在本机验证过),但同一个句柄在 POSIX 上不挡,而目标路径在两边都已被"移到一边"清空。依赖 Windows 行为的测试会让每文件门槛在 Linux 车道上失败。
- **用现有的 `ctx.plugin(...)` 套件来断言投影。** 否掉:那些套件正是这个缺口存在的原因。Loader 启动带来的不是更多行为覆盖,而是组合本身 —— 注入名、配置 schema,以及服务在加载时拿部署目录做了什么。

## 后果

- 包的步骤表现在点名每一步真正的生产通道,部署的 prose writer 产生的 `llm:<provider>/<model>` 会出现在写出正文那一步的 `run-summary.md` 与 `steps.json` 里。走离线路径的步骤不变,从未运行过的步骤仍然报它条目声明的品牌。
- `DocumentBlock` 的 `table` 变体新增了必填的 `model`,所以每个对文档块做模式匹配的消费者都看得见它;编译器渲染它旁边的 Markdown、忽略它。
- CSV 孪生携带模型所陈述的内容,包括印刷版画不出来的字符:单元格里的换行会被整段加引号,而印刷形态画的是空格。
- `PackagedTable.csv` 变为必填,`csvRefusal` 消失;`dsh-research-team` 的中英 README 都不再声称模型没有被携带。
- 持久化运行的文档格式变了:在这次构建之前持久化的运行,其 `table` 块没有模型,而这次构建的读取器不会从它们那里带走任何表,而不是发布一张配上无法核对的渲染的标题。
- **这里没有做**:`dsh-research-web` 的面板既不渲染 `stepProducerOf` 的值,也不渲染表格模型;这些字段在线上,而出货的那个页签不读它们。`runner/project-view.ts` 对某一步仍然报条目声明的品牌,它自己的文档把它描述为"该步将运行在什么之下"。

## 文件

- `packages/research/dsh-research-team/src/runner/registry.ts` —— `stepProducerOf`、改从模型读单元格的 `pipeTableOf`,以及把模型带到块上的 `composeFloats`。
- `packages/research/dsh-research-team/src/runner/{drive,package-export}.ts` —— 某步生产者的两个读取处,以及从模型写出的两种表形态。
- `packages/research/dsh-research-team/src/runner/{paper-format,document-compile}.ts` —— `tableCellsOf`,以及 `table` 块必填的 `model`。
- `packages/research/dsh-research-team/tests/{staged-directory,step-producer,loader-composition}.spec.ts` 与 `tests/fixtures/loader-boot/engine-stub.ts` —— 回滚、一次真实模型运行报出的生产者,以及经 Loader 启动的组合。
