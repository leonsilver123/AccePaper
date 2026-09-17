# Agent Note: 质量报告到达页面,并带着它的覆盖清单

Status: implemented

[English](2026-09-17-the-quality-report-reaches-the-page.md) | 中文

## 问题

质量基线的报告写好了、挂在包清单上、有测试 —— 而**看不见**。页面读的是 `ResearchRunSnapshot`,它的 `packageExport` 只带 `files`、`state`、`checks`;报告不在里面。于是**人真正会看的那个面**对「稿件有没有引用自己的图、有没有在文献里给自己定位」一无所知,而 M11(「能定位要改什么的可解释质量 UI」)没有任何数据可渲染。

## 决定

- **`ResearchPackageExport` 增加 `quality?: PaperQualityReport`**,`exportRunPackage` 从清单填它。**没有新的 `@Remote` 方法**:字段搭在已有的结果上,所以 assembly bundle 内联的那组描述符不变 —— 那正是曾经让页面报 `listRuns is not a function` 的陷阱。
- **客户端孪生也加上**(`WirePackageExport.quality`、`DeliverableView.quality`,以及报告视图类型 —— 声明在**模型模块** `summary.ts`,因为 `run-source.ts` 已经从那里 import,反过来会成环)。
- **`toRunSummary` 把报告从 deliverables 里提出来**,变成面板直接读的四个字段(`quality`、`qualityChecks`、`qualityDomainReview`、`qualitySummary`),面板不必为了一个关于稿件的事实去翻文件列表。
- **`selectQuality(summary)` 是纯选择器**(`panels.ts`,无 React、无运行期 import),`QualityPanel.tsx` 渲染三张列表:
  - **发现**,每条带代码对应的文案、规则自己的 detail、以及**逐字的证据**,让读者去核对而不是相信规则;
  - **每条检查及其结果** —— `defect-found` / `no-defect-found` / `not-applicable` / `not-executed` —— 以及答不出来时的理由,那才是读者能据以行动的东西;
  - **没有任何规则能回答的问题**,与发现并列点名,而不是留给一份空列表去代言。
- **`FINDING_LABEL` / `OUTCOME_LABEL` 是写出来的,不是拼出来的。** 字典是有类型的,所以 `quality.finding.${code}` 是 `string`,translate 函数会拒绝它 —— 这是类型系统在说:没有条目的代码会把键名本身渲染给读者。显式映射让**新增一个 finding code 在补上双语之前是编译错误**;万一有代码真的到了面板而没有文案,它会渲染成它自己,而不是一个空标签。
- **没有导出包的运行会说出来**(`quality.noPackage`),而不是渲染一份空的发现列表:「没导出」与「没问题」是两件不同的事实,而后者会为一篇没人看过的稿件背书。
- **面板放在修订闭环旁边**,因为一条发现是被「要求做不同的工作」回答的 —— 而提出要求的那个面板就在隔壁。

## 考虑过的其他做法

- **新增一个 `@Remote('qualityReport')`。** 拒绝:那要重新生成 typert 描述符并按顺序重建两个 face,而报告本来就是页面手里那份包的一部分。搭在已有导出上没有这个顺序问题。
- **只渲染发现。** 拒绝 —— 那正是 R04 存在的理由所要阻止的读法:空列表只是「能读到这份稿件的那些规则」的输出。
- **把报告的 `summary` 那句也翻译。** 拒绝:它由运行的数字组成、陈述的是这份报告**是**什么;把它改写的视图可能说出报告没说的话。它周围的标签是翻译的,那句话是**引用**的。
- **让面板对每条发现提供一个控制。** 拒绝:一条发现是被一次修订请求或一个人的判断回答的,两者都有各自的面板。在这里再加一个控制,就是第二条提出请求的路。

## 后果

- **两个方向都钉在** `tests/quality-panel.dom.spec.ts`:一份大部分检查读不到稿件的报告,会在空发现列表旁边渲染出覆盖清单、理由与领域问题;一份有发现的报告会点名对象(用论文自己的词汇,`Figure 2`)并显示它的证据;而没有包的运行说的是没有报告,不是没有发现。
- **页签数量现在就是名单自己的长度**,所以加一个面板是一处加一行,而不是去找一个数字。
- **这里不是的。** 面板只报告;它不做决定、不写任何东西。一条发现的 `where` 是论文印出来的标签,不是指向稿件的链接 —— **把一条发现定位到读者正在看的正文里**是下一步,它需要页面持有各节正文,而这份快照没有。至于基线那五条规则是不是该有的五条,是复核者的问题,报告自己也这么说。

## 文件

- `packages/research/dsh-research-team/src/types.ts`(导出字段与报告类型)、`src/index.ts`(填充它)。
- `packages/research/dsh-research-web/src/run-source.ts`(线上孪生)、`src/summary.ts`(视图类型与提出的字段)、`src/panels.ts`(`selectQuality`)、`src/client/workbench/QualityPanel.tsx`(新增)、`src/client/workbench/ResearchWorkbench.tsx`(页签)、`src/client/locales.ts`(双语文案)。
- 测试:`packages/research/dsh-research-web/tests/quality-panel.dom.spec.ts`(新增)、`tests/researchview-component.dom.spec.ts`。
