# Agent Note: run 在磁盘上维护一份文档

Status: implemented

[English](2026-09-19-the-run-maintains-one-document-on-disk.md) | 中文

## Problem

流水线此前到导出为止不碰磁盘。文档是工件登记处里的一个值,而人真正想要的文件 —— 期刊收的 `.docx`、作者要改的 `.tex`、它们内嵌的图 —— 只在最后写一次,写进一个没人打算修改的包里。由此产生两个没有任何测试能看见的后果。

第一,想改一句的人没有文件可改。登记处是流水线自己的存储,唯一的入口是 run。`D4-rebuttal` 与稿件修订流程都能产出替换正文,两者都要求驱动 run:一个在编辑器里花三十秒的更正,代价是一条修订请求、一份生成的候选、一轮复核和一次接受 —— 而且必须配置过复核者,否则什么都做不了。

第二才是让这件事值得做的原因:**根本没有把文件交回来的路**。一个能写出文档却读不进文档的流水线,面对「我把方法节的错字改了」只有一种回答:请模型重新生成一段人已经写好的正文。而一个**确实**有这条路的流水线 —— 读目录里碰巧存在的字节、管它叫稿件 —— 会采纳任何闸门都没见过的文本,还给它一个宣称见过的版本号。

## Decision

- **一个部署设置 `manuscriptDirectory`,与它旁边三个目录同样解析。**`<root>/<runId>/` 装 `manuscript.md`、`manuscript.docx`、`manuscript.tex`、`manuscript.pdf`(仅当编译器自己的探测声明支持 pdf)、`figures/<label>.svg`、`assets/<label>.png`、`tables/<label>.{md,csv}`、`refs-pdf/<citeKey>.pdf`,以及 `document-manifest.json`。它是**部署**设置而非请求参数,理由与 `packageDirectory` 相同:`runPipeline` 是 Remote 方法,由请求给出的路径等于让浏览器决定宿主往哪写文件 —— 而且导入是从这里读它的文件,不是从客户端给出的路径读。**配了它却没配 `document` 编译器时,加载就被拒**,理由一并给出:一个全部用途就是装「人要编辑的文档」的目录,没有工具链就没什么可装;替代方案是在第一次 run 的最后一步才发现这件事。
- **登记处仍是权威,目录只是它的投影。**`planManuscriptDirectory` 的每个文件都从 `getRunSnapshot(store, runId).registry` 构建,绝不取自执行器的返回值,因此目录描述不了任何被提交拒绝掉的东西。Markdown、图、栅格图与表格来自 `manuscript` 工件 —— run 维护的那一份文档 —— 编译出来的交付物来自 `typeset`,因为只有编译会产出 `.docx`。
- **投影在 `drive.ts` 里跑,紧跟某一步提交成功之后。**那是 driver 唯一观察到提交的地方:`runStep` 要么提交了,要么返回了非成功的状态,别的调用者只能猜是哪种。它在闸门**之前**,因为闸门并不决定工作是否存在 —— 被拦截或失败的步骤,其产物**是**提交了的,而编辑文件的人必须看到 run 真正持有的那份文档。
- **投影失败不会让该步失败,并且记录两处。**该步已经提交了,为了抱怨一份副本没落地而丢掉真实工作,是 `checkpointAfterStep` 早已拒绝的交易。这条失败以 `manuscript-projected` 追加进 run 自己的审计日志(core 的 `recordManuscriptProjectionFailure`,面板经 `ResearchRunSnapshot.manuscriptDirectory` 读它,`checkFinalPackage` 也读它),并挂在该步结果的 `projectionError` 上。**只有失败被记录**:落了地的投影就在磁盘上,那就是记录;而每次成功投影都发一个事件,等于往日志里塞十六份文件清单,给不出任何读者。
- **`document-manifest.json` 带 `manuscriptRef`(版本 + contentHash)、`documentHash`(落地那份 `manuscript.md` 的摘要)、`renderedFrom`(编译产物出自哪个排版形态)与 `files`,形状与包清单相同。**最后一项不是整洁问题:它让漂移检测就是既有的 `checkPackagedFiles` 比较,而不是在这里再写第二套。**两种漂移分开报告**,因为补救不同 —— `edited` 是磁盘上的文件不是清单记录的那串字节(重新投影),`runMoved` 是 run 持有的版本已不是目录投影的版本(重新渲染)—— 由 `describeManuscriptDirectoryDrift` 点明适用哪一种。
- **写入纪律只有一份实现。**`staged-directory.ts` 是 `writePackageFiles` 与 `publish` 的提取:先暂存、对着自己的清单校验、再整体换入,换入失败时把原目录放回去。同一条纪律此前在两个目录上各写了一遍,而第二份只能经包导出走到 —— 所以关于它的断言被搬到该 helper,而不是删掉。它还拒绝一份把同一路径列两次的计划,这是提取暴露出来的真实缺陷:一个路径上两份内容,无论哪份最后落地,那个目录都不可能是它清单说的样子。
- **往返是一次显式、带闸的操作。**`publishArtifactVersion` 是 `acceptance.ts` 论证过的第三种方式:把某个步骤已经写过的工件发布成新版本,既不是提交(没有可写入的 attempt),也不是一次裸登记处写入(没有守卫、没有生产者、没有记录)。它有自己的模块、自己的拒绝、自己的审计种类 `artifact-republished`。导入拒绝:run 并不持有的清单条目、本次 run 从未投影过的文件、与投影结果逐字节相同的文件、部署的编译器读不回来的格式,以及 run 已经离开的文档版本。**它发布的是新版本**,于是一句被改过的句子会失去绑定在它上面的判定 —— 这是机制在起作用,不是需要抹平的边角。
- **每种格式丢掉什么被记录下来,而格式之间的差别正是重点。**`.tex` 原样持有它的正文与数学;`.docx` 持有批注、交叉引用域与内嵌媒体,任何 Markdown 渲染都留不住它们,而 `PandocCompiler.read` 报出它看得见的那些 —— Word 批注靠 OOXML 包里真实存在的 `word/comments.xml` 部件判定,所以是该文件确实有时才报,而不是对每个 `.docx` 都宣称。这些损失随回执、随审计详情、也随装配自己记下的匹配结果一起走。
- **章节按标题匹配,绝不按位置。**把两节调换顺序的人就是在调换它们,而按下标匹配会把第二节的正文读进第一节的判定里。匹配不到任何章节的标题被**报告**而不是被追加:这条流水线从未写过的一节,没有论证计划义务、没有引用绑定、在提纲里也没有位置。
- **`materializeManuscript` 重新渲染排版形态,但不重跑 E1 的闸。**E1 检查的那些义务在文档被装配的地方就已了结,其判定记在那一步名下;在这里重跑等于做第二次没有任何东西记录的裁决。手改的代价在它该被兜住的地方被兜住:审批点名了它被做出时的工件版本,因此移动了文档的那次接受或导入会让审批过期,run 也就无法作为终稿导出,直到有人批准了现在确实存在的那个版本。

## Alternatives considered

- **让 driver 就地写文件而不是暂存。**否决:写了一半的目录与写完的目录无法区分,而正在编辑那个文件的人恰恰看不出区别 —— 上一次投影的清单会与失败那次的文件并排躺在一起。
- **把成功的投影也记下来。**否决:每次 run 往日志里克隆十六份文件清单,而磁盘上的文件本身就说明了这件事。没有失败条目就意味着「没有投影失败」;不配置目录的部署一条都没有,那是另一件事实,由配置承载。
- **让导入接收一个文件系统路径。**否决:理由与 `manuscriptDirectory` 是部署设置相同。请求只点名**格式**,路径在这里解析。
- **在 `materializeManuscript` 里重跑 E1 的检查。**否决:那些判定记在做出它们的那一步名下,在一次修复处再裁决一次,会报出一个 run 的历史并不支持的闸门结果。审批才是让手改有代价的机制。
- **在本包里解析 `.tex` 与 `.docx`。**否决:一个是 TeX,另一个是 OOXML 的 ZIP。编译那道缝已经说了「部署的工具链渲染一份文档」;把文档读回来是同一道缝的另一个方向,所以 `DocumentCompiler.read` 是那里的可选方法,而读不了某种格式的部署会以被点名的格式拒绝导入。
- **采纳文档里没有对应章节的标题。**否决:那会发布任何闸门都没见过的文本,挂在一节论证计划不管、引用绑定也不覆盖的章节下。

## Consequences

- 配置了 `manuscriptDirectory` 的部署从第一个写作步骤起就有了一份真实磁盘文档,人可以编辑它。`@Remote('importManuscript')` 与 `@Remote('materializeManuscript')` 是页面能够到的两个操作;两者也都在 `tests/manuscript-round-trip.spec.ts` 里被驱动,该用例跑的是真实流水线与真实服务,而不是手工搭的任何一个。
- **core** 新增两个审计种类(`artifact-republished`、`manuscript-projected`)与两个模块:`engine/publication.ts`(`acceptance.ts` 是它的一个特例)与 `engine/manuscript-projection.ts`(失败记录)。`appendAuditEvent` 仍未导出 —— 每个新种类只有一个窄写入者,这正是 core 入口文件头要求的。
- `AuditEventKind` 在 `run-persistence.ts` 的加载边界上有镜像,两个成员都在;本构建持久化出来的 run 能被本构建加载。
- `ResearchRunSnapshot` 新增 `manuscriptDirectory`,`StepOutcome` 新增 `projectionError`,因此 `runner-registry.spec.ts` 的形状触发器被更新 —— 它问的那个问题(「视图需要这个吗?」)对前者答是、对后者答否,而后者正是 driver 自己的结果要带它的原因。
- 本 note 的姊妹篇 `2026-09-19-one-document-one-slug.md` 里的描述仍然成立:只有一个 `manuscript` slug,而导入是它新版本的又一个发布者。
- **这里没有的**:`dsh-research-web` 的面板还没有渲染 `manuscriptDirectory`,所以该字段在线上而出货的页签不读它;工作目录里的 `manuscript.md` 由 `renderDocumentMarkdown` 从文档模型渲染,与 E1 装配出的 Markdown 不是逐字节相同 —— 于是描述同一篇论文的两个文件是它的两种渲染,而不是同一个文件写了两次。

## Files

- `packages/research/dsh-research-team/src/runner/manuscript-directory.ts` —— 目录布局、清单、投影与两种漂移事实。
- `packages/research/dsh-research-team/src/runner/staged-directory.ts` —— 两个目录共用的暂存写入。
- `packages/research/dsh-research-team/src/runner/manuscript-import.ts` —— 格式表、读者的约定、章节匹配与装配。
- `packages/research/dsh-research-team/src/runner/{drive,document-compile,package-export,types}.ts` —— 投影在哪里跑,以及 `renderDocumentMarkdown` / `compileManuscriptFormats` / `figurePathOf`、共用的表格与参考文献文件规划,和两个新选项字段。
- `packages/research/dsh-research-team/src/index.ts` —— `importManuscript`、`materializeManuscript`,以及线上快照里的工作目录。
- `packages/research/dsh-research-core/src/engine/{publication,manuscript-projection}.ts` —— 该操作与失败记录。
- `packages/research/dsh-research-cordis/src/{index,pandoc-compiler}.ts` —— 配置字段、它的加载期拒绝,以及把文档读回来。
