# Agent Note: 包带走论文的资源

Status: implemented

[English](2026-09-19-the-package-carries-the-papers-assets.md) | 中文

## 问题

一次运行的包带着稿件、编译出的交付物和渲染好的图,而读论文的人需要的两样东西不在里面。

结果表只以稿件里的正文、以及一个 `table` 文档块的形式存在。想要那些数字的读者只能在 Markdown 里找,也没有任何东西把它交给工具 —— 表恰恰是论文里最可能被另一个程序读的那一部分,而包里根本没有它的机读形态。

`citations.json` 里引的那段话,也无法与它出处的那份文档对照。运行记录下了那段话、它读自哪里、以及附件自己的版本 —— 却不存任何文件 —— 于是引用本该使读者能做的那件事(打开来源、读到那些字)要读者自己去找 PDF,而且无从判断找到的那份是不是判定所依据的那一份。

## 决策

- **`tables/<label>.md` 与 `tables/<label>.csv`。** 印刷的那张表(带标题,与稿件印出的形式一致)与它的机读孪生。两者都从文档持有的 `table` 块读出,经由 `parsePipeTable` —— 写它的那个模块里 `markdownPipeTable` 的成文逆函数 —— 所以 CSV 不可能描述的是一张与论文印出的不同的表。CSV 按 RFC 4180 转义:字段含逗号、引号、回车或换行时加引号,内嵌引号翻倍,记录以 `\n` 结尾(要求 `\r\n` 的读取器同样接受)。Markdown 无法被本包读回的表不写 CSV,由 `tables[].csvRefusal` 说明原因,而不是留下一份莫名缺失的文件。
- **`refs-pdf/<citeKey>.pdf`,在部署选择加入时。** `readAttachment` 自 `f8499c83` 起就存在;这次做的是从它到包的那条路。`dsh-research-cordis` 发布 `ctx.research.referenceFiles`,团队侧像读 `documentCompiler`、`figureProvider` 与参考文献写入器一样,经 `hostReferenceFiles()` 读它 —— 没有任何地方 import 那个 provider。读取器是**按阅读记录携带的身份**被请求的,绝不按路径:身份由本包铸造,而 `readRegistrations` 现在同时返回每个身份读自哪个 item key,于是这套方案不必从字符串里反解。
- **`planRunPackage` 里不读任何文件。** 它对文件系统保持纯粹:读的是调用方(`referencePdfPlanOf`,在服务里),决定包可以带什么的是导出器 —— 与参考文献早就采用的分工相同。
- **版本与阅读记录所写不一致的字节会被拒绝**,读回来的是另一个附件、或字节摘要与读取器自报的不符,同样拒绝。这份文件必须是那条引用背后那段话所读的那一份,否则一份都不存。
- **`referencePdfs: 'not-stored'` 是默认值,而且要说出来。** 空 `refs-pdf/` 与「部署不读附件文件」是两件不同的事实;清单写明是哪一件,答案是后者时不创建任何目录。
- **每份存下的文件都带 `sha256`、`bytes`、`attachmentKey`、`attachmentVersion` 与 `purpose`**,失败路径携带读取器自己的原因、不带路径 —— 与参考文献写入器遵循的规则相同,它剥掉 `file = {…}` 的规则和它的 spec 都未改动。
- **`icons/` 记为延期,不实现。** 本仓库里不存在任何图标生成者,而没有生成者的目录就是一个要读者去猜的目录。

## 考虑过的替代方案

- **解析工具自己的渲染来做 CSV。** 否: `renderThreeLineTableMarkdown` 画的是带制表符的定宽表,再写一个它的读取器就等于给「这张表说了什么」立了第二个权威。文档已经携带的管道表,正是本仓库既写又读的那个格式。
- **在导出时从运行自己的测量重新推导这张表。** 否:D3 已经定下了论文的数字,第二次计算与它一致靠的是运气而不是构造 —— 与 `result-version` 存在的理由相同。
- **把结构化模型(`columns`/`rows`)带上产物,由它来构建 CSV。** 这是更好的形态,但它需要 `registry.ts` —— 那个文件当时由另一个单元持有 —— 所以不在本次改动里。它能多出的是被 Markdown 压平的那个字符:单元格里的换行会变成空格,于是 CSV 单元格装不下印刷表所没有的文字。这一点记在 README 的限制里,而不是做一半。
- **附件读不到时拒绝整次导出。** 否:一次库故障会拿走读者本来还能用的那份包,而清单可以说出哪个来源没有文件。
- **把文件存成附件 key 而不是 cite key。** 否:包的读者认识的是引用,而清单条目两个都点名,两种做法的映射都是明确的 —— 而且「这条引用所依据的那份文件」本来就该是每个 cite key 一份。

## 后果

- 包现在带 `tables/`,并在部署选择加入时带 `refs-pdf/`;两者都出现在清单的 `files` 里并带摘要,`numberSources` 会点名每张表的数字来自哪份运行记录。
- `RunPackageManifest` 多了 `tables` 与 `referencePdfs`;`RegistrationRead` 多了 `itemKeys`;`ctx.research` 多了 `referenceFiles`,`readAttachment` 终于有了自己包之外的消费者。
- 驱动器结束时的导出现在要 await(`exportRunPackage` 变成 async),因为读附件发生在写出任何东西之前。
- `dsh-research-team` 多了 `runner/reference-files.ts` —— 消费者对这条缝的声明,以及部署侧值到达处的形状检查。
- **本次没有做的**:结构化表模型仍在 D1/D3 被丢掉,所以 CSV 单元格装不下被印刷版 Markdown 压平的字符;本仓库也没有任何部署配置 `sourceLibrary.attachments`,所以选择加入这条路由 spec 覆盖,尚未对着真实库跑过。

## 文件

- `packages/research/dsh-research-team/src/runner/package-export.ts` —— 表与引用文件的规划、`csvRecords`、`citedAttachments`、版本守卫,以及清单的新段落。
- `packages/research/dsh-research-team/src/runner/paper-format.ts` —— `parsePipeTable`,`markdownPipeTable` 的逆函数。
- `packages/research/dsh-research-team/src/runner/reference-files.ts` —— 这条缝的结构性声明与形状检查。
- `packages/research/dsh-research-team/src/index.ts` —— `hostReferenceFiles`、`referencePdfPlanOf`,以及两条导出路径接入这份计划。
- `packages/research/dsh-research-cordis/src/zotero-provider.ts` —— `ReferenceFileReaderLike`,本包提供的结构孪生。
- `packages/research/dsh-research-cordis/src/{index.ts,zotero-registration.ts}` —— `ctx.research.referenceFiles`,以及注册读取时记下的身份到 item key 的映射。
- `packages/research/dsh-research-team/README.md` 与 `.zh.md` —— 两个目录、选择加入,以及延期的那部分。
