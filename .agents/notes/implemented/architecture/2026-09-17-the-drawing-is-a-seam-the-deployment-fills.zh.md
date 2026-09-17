# Agent Note: 绘图是部署填的一道缝,而图是一张画

Status: implemented

[English](2026-09-17-the-drawing-is-a-seam-the-deployment-fills.md) | 中文

## 问题

这条流水线产出的每一张 float 都有两个事实。它全部用本仓库自己的 SVG/PNG 工具画 —— 确定性、零依赖,这正是它出货的理由,而它不是绘图库:它的字体、刻度与坐标轴布局都是一个小渲染器的,于是一篇论文的图读起来像测试夹具。而且它只画图:路线图是以 mermaid **源码**形式随行的,LaTeX 把它渲染成文本、任何 PDF 阅读器都不会把它画出来 —— 于是编译产出的文档根本装不下那张图,包只能报一个被丢弃的 float,而不是一张画。计划要求接一个成熟的科研绘图 provider;而编译完整性那一步早就把「缺这张图」记成了出货包停在 draft 的原因。

## 决定

- **`runner/figure-provider.ts` 陈述这道缝**(`FigureProvider`):一个 id、它向机器问来的库版本、`renderFigure(spec)` 与 `renderDiagram(graph)`。**两个方法都要**,因为一篇论文两样都带 —— 「只画图、把路线图留成源码」正是本仓库此前的状态。**一次渲染出两种格式**(SVG 与 base64 PNG),因为 HTML 稿件内联矢量、而 LaTeX 只能带栅格,所以只产一种的 provider 会在一半格式里丢掉这张图。
- **`dsh-research-cordis/src/matplotlib-provider.ts` 是部署侧的 provider。** 它通过部署点名的解释器(虚拟环境的,绝不是系统的)运行一段内置脚本,取回两种格式,并**检查答案**:不是 SVG 的标记、不是 PNG 签名开头的字节、或不是结果 JSON 的输出,都作为 provider 故障被拒绝,而不是当作图被内联进去。库在构造时**被探测**,所以没有它的机器不提供 provider,而不是在 D1 才失败 —— 那已经是前面几道闸门都关上之后的第五步了。
- **它的配置方式与编译器一致**:cordis 插件里的 `Config.figures`,在引擎构造函数里探测,由 `ResearchTeamService.hostFigureProvider()` 读取(在部署面值到达处做形状检查),再交给 `DriveOptions.figureProvider → ExecCtx.figureProvider`。没有点名的部署用内置渲染器画。
- **D1 通过被配置的那个 provider 画图与画路线图**,每张 float 记下是哪个库画的(`drawnBy`、`drawnByVersion`)。有人画时,路线图 float 带着它的 SVG 与栅格;没人画时记 `diagramDrawn: false` —— 这是诚实的状态,而不是一个没人点名的被丢弃 float。

## 考虑过的其他做法

- **不接 provider,而是把内置渲染器做好。** 拒绝:「图看起来像绘图库画的」是一个库的属性,而计划要的就是一个库;无限改进一个小渲染器是同一件事,只是天花板更低。
- **保留 mermaid,另外把它的 SVG 栅格化。** 两重拒绝:本机没有 SVG 栅格化器(`cairosvg` 需要一个没装的 libcairo DLL),而且这张图无论如何都是一张画 —— 让 provider 直接画它。
- **provider 只画图、路线图回退到内置工具。** 拒绝:那会掩盖哪张 float 是哪个库画的,而路线图恰恰是编译产物一直在丢的那一张。
- **在 D1 才惰性探测。** 拒绝:那样一个解释器画不出来的部署会在前面几道闸门都关上之后的第五步失败,而这正是编译器的探测已经用来避免的失败形态。

## 后果

- **对着真库验证过**,不只是替身:`dsh-research-cordis/tests/matplotlib-provider.spec.ts` 用 matplotlib 3.11.2 真画了一张图与一张路线图,断言标记与 PNG 签名;替身用例钉住 provider 发什么、接受什么、拒绝什么。真库那几条用 `describe.skipIf` 挂在本机是否有的解释器上 —— 解释器由 `DSH_MATPLOTLIB_PYTHON` 或某个 venv 路径找到,所以没有它的机器报的是 skipped,而不是悄悄通过。
- **运行级接线也被钉住**:`tests/statement-bindings.spec.ts` 用注入的 provider 驱动一次运行,断言 float 带着它的标记、id 与版本;没有 provider 的那次则断言内置渲染器画了图、且 `diagramDrawn` 为 false。
- **这里没有覆盖的。** provider 还没有进出货 profile 的 `cordis.yml`,而且本仓库至今没有任何一份包是用 matplotlib 画出来的 —— 那个解释器住在本次检出自己的 venv 里,部署配置要自己点名它。一张图是否易读、比例是否合适、与正文是否一致,仍属视觉复核(M09)。PDF 路径没有变化:本机没有装任何 LaTeX 引擎,所以 `pdf` 仍以「本部署产不出该格式」被拒。

## 文件

- `packages/research/dsh-research-team/src/runner/figure-provider.ts`(新增)、`runner/registry.ts`(D1 通过它画并记录画者)、`runner/drive.ts`、`runner/types.ts`、`src/index.ts`。
- `packages/research/dsh-research-cordis/src/matplotlib-provider.ts`(新增)、`src/index.ts`(`Config.figures`、探测、`figureProvider`)。
- 测试:`packages/research/dsh-research-cordis/tests/matplotlib-provider.spec.ts`(新增)、`packages/research/dsh-research-team/tests/statement-bindings.spec.ts`。
