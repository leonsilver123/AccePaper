# Agent Note: 判断是关于某个版本的句子,不是关于一个槽位

Status: implemented

[English](2026-09-17-a-judgement-is-about-a-version.md) | 中文

## 问题

`CitationUse.statementId` 带着一句陈述本层所需性质的注释 —— 「它点名稿件里那条来源**为其**被引用的句子,于是……一次重写该句子的修订可以让支持它的引用失效」—— 而赋给它的值是常量 `introduction:prior-work`。每次运行的每一份草稿,都把每条来源绑到同一个槽位上。一次修订重写了槽位下的文本,判断便悄悄跟着走了:交付那篇论文完全可能带着一个与被复核段落所确立的内容相反、却挂着三条引用的文献位置,而没有任何东西看得出来。

错的有两件事,常量只是其中一件。引用还是**在正文存在之前**铸造的 —— `citationUsesOf({claimRef, statementId})` 在 D3 开头就从已复核语料跑完 —— 于是一条绑定唯一能点名的东西就是槽位。「引用是为了一句话」要求那句话先存在。

把扫描到的句子做哈希、塞进现有绑定,并不能修好它。那样只是记下了版本,而判断仍然可以从它重新推导出来:扫描、哈希、比对,句子移动了就重新绑定、把旧的支持继承过去。判断是一个人针对某一句特定的话、某一段特定的文本做出的**阅读**,而重写这件事本身,没有任何一部分能让那次阅读适用于新文本。

## 决定

- **四件事分开记录**,因为它们是四个不同的问题:
  - `Statement.statementId` —— **节点**的身份。铸一次,来自小节与「该句在被引用句子中的序号」,于是一次重写保留节点、插入一句未被引用的句子也不会让后面全部移位。
  - `Statement.textSha256` —— 节点当前所述内容的**内容版本**。
  - `CitationUse.quoteSha256` —— **证据版本**:判断所依据的那段文本,按语料当前持有的样子。
  - `CitationUse.statementSha256` —— 该判断被作出时所针对的那个内容版本。
- **顺序改了:先有判断,后有挂载。** `judgementsFor(claimRef)` 返回已复核语料所确立的内容,**未挂载**。D3 写各小节。`locateStatements(sections)` 找出每条被引句子在**哪里** —— 这是**定位**,不是识别。`bindJudgements(judgements, statements)` 把每条判断挂到引用其来源的那条 statement 上,并记下**那一刻**的两个版本。
- **`checkStatementBindings` 拒绝判断比它所关于的东西活得更久的三种形态**,而重新绑定对任何一种都不是补救:`citation-statement-missing`(那句话没了)、`citation-statement-changed`(它说的是别的了)、`citation-evidence-changed`(那段文本不是来源现在持有的那段)。E1 在**修订稿**上跑这条 —— 那正是 rebuttal 重写落地的地方。
- **没有任何一句话引用的已复核来源,在 D3 就被拒绝**(`citation-source-uncited`),而不是从参考文献表里悄悄去掉:列表由绑定派生,所以省略只会让缺陷隐形,而不是被报出来。
- **D3 记录每个小节被要求了什么**(`proseRequests`、`proseRequestVersion`):指令原文、该节要求与收到的证据名、以及带每段文本版本的引用名册。于是一条因「文本变了」被拒的判断,可以追溯到那个「被回答了一句依赖旧文本的话」的请求。离线路径上没有发出任何指令,记录写的是 `instruction: null`,而不是省略该字段。

## 考虑过的其他做法

- **把定位到的句子做哈希塞进现有绑定、不匹配就重新绑定。** 拒绝:那是换一条路的继承 —— 判断从一句没人读过的文本重新推导出来,正是要修的缺陷。
- **从句子文本派生 statement id。** 拒绝:一次重写会读成「一条 statement 被删除、另一条被创建」,比较两份草稿的读者就看不出**这个节点的文本变了**。
- **把「句子变了」的拒绝放在 D4 而不是 E1。** 拒绝作为唯一位置:D4 只是正文的其中一个写入者,而一次手工编辑、一次恢复、或别的步骤的修订都会绕过它到达 E1。E1 是正文与绑定最后一次同时在手的地方。
- **保留常量 `statementId`、在旁边加版本。** 拒绝:id 点名的仍是槽位,于是「是哪一句话」这一半记录依旧是假的。

## 后果

- **两个方向都被钉住**:`tests/statement-bindings.spec.ts` 驱动重写过的句子(拒绝)、被删掉的句子(拒绝)、稿件未动而语料更正了的段落(拒绝)、以及未变化的情形(通过)—— 外加请求日志。
- **生产路径同样拒绝**:`tests/citation-binding-run.spec.ts` 拿一次真实运行的工件、只改被引句子,直接驱动 E1 的执行器,组装以 `citation-statement-changed` 被拒。
- **一条拒绝提前了。** 「一句已复核来源都没引」的稿件此前会走到 E1(无论正文说什么,参考文献表都存在);现在在 D3 就被拒绝。受影响的用例改成断言更早的停点与理由。
- **这里不是的。** 判断本身仍是一条被记录下来的裁决,而不是被重新推导出来的:这一层能说「某条判断不再适用」,说不出正确的那条是什么。谁来重读那句话,是一个人或者部署自己的复核者;而日志中「模型可见」的那一半,住在运行的工件上,而不是某条会话事件里。

## 文件

- `packages/research/dsh-research-team/src/runner/citation-bindings.ts`(`Statement`、`SourceJudgement`、`locateStatements`、`judgementsFor`、`bindJudgements`、`checkStatementBindings`,三条新拒绝码)、`runner/registry.ts`(D3 的顺序、请求日志、E1 的检查)。
- 测试:`tests/statement-bindings.spec.ts`(新增)、`tests/citation-binding-run.spec.ts`、`tests/citation-bindings.spec.ts`、`tests/runner-registry.spec.ts`。
