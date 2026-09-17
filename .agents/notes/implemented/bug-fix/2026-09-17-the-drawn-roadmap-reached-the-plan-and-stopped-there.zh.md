# Agent Note: 画出来的路线图到了计划就停了

Status: implemented

[English](2026-09-17-the-drawn-roadmap-reached-the-plan-and-stopped-there.md) | 中文

## 问题

复核的 R02 要求把路线图渲染出来,R05② 交付了那个能力:`FigureProvider.renderDiagram` 画它,D1 把画好的图写在路线图 float 上(`diagramDrawn: true`、`svg`、`pngBase64`)。**没有任何东西消费它。**

`E1-format` 从图表计划装配稿件,它的循环无论条目上有什么,都把路线图按 `figureBlock({ mermaid })` 推出去 —— 同一个条目上的 `svg` 与 `pngBase64` 从来没被读过。`documentOf` 于是把它做成 `diagram` 块,而 `unembeddableFloats` 把**每一个** diagram 都报成没有格式能内联的 float(「a diagram is carried as its own source and no static rendering was produced for it」)。于是一个**装了**科研绘图库的部署,得到的正是加这个库要消除的结果:`compiled-document-complete` 为假、每种格式都丢掉 `Figure 2`、包卡在 `draft`。能力在自己的缝上验过,**从来没有在消费端验过**。

## 决定

- **画出来的路线图是一张图,没画出来的才是源码。** `FigurePlanEntry` 增加 `diagramDrawn`,E1 的 float 循环据此分支:`diagramDrawn === true` 且有 SVG 时,推出与数据图**同一个** `figure` 块、带同样两种渲染;否则保住 Mermaid 块。两者不是同一个 float —— 一个能被该部署产出的每种格式内联,另一个一种都不能 —— 把后者报成前者,就是文档宣称自己带了一张它其实没有的图。
- **文档的 float 列表与 Markdown 的在同一个地方构建。** `documentFloats` 由填 `figureBlocks` 的那个循环一并填,`documentOf` 收下这份列表。旧代码在循环之后**按 `kind` 重新找一遍**来重建列表(`floats.find(entry => entry.kind === 'data-figure')?.label ?? 'Figure 1'`),那是对计划的第二次读法,而两次读法可以不一致 —— 而标题印出来的那个编号,恰恰是不能不一致的东西。表格按计划给它的位置**插回原位**,于是文档按计划的顺序印 float,而不是把表格挪到末尾。
- **同一处改动顺带发现:二进制交付件被归成了 assets。** `compilation.assets` 的文档写的是「编译产物内联的一张图」,而它实际携带**每一个** base64 文件 —— 包括 `manuscript.docx` 与 `manuscript.pdf`。既然 DOCX 与 LaTeX 才是这个 fork 产出的交付件,工件现在把它们分开:`compilation.documents` 作为字节携带编译出来的文档,`compilation.assets` 携带它们内联的图;类别取自编译把它放在了哪里(它自己的 `fileName` 还是它的 `files`),而不是从路径猜。`package-export` 两份都写,所以落盘的包没有变化。
- **图资产路径由标签派生**(`figureAssetPath`):`Figure 2` → `figures/figure-2.svg`。数据图的路径此前是字面量 `figures/figure-1.svg`,那是与计划编号可能漂移的第二套编号;派生出来的路径对 `Figure 1` 与那个字面量**逐字相同**,所以没有任何东西挪位。
- **出货 bundle 说明这条通道存在。** `packages/bundle/research-app/cordis.patch.yml` 现在在 `document` 旁边点名 `figures`,写成可选追加项、解释器留给部署 —— 与「不把 `latexEngine` 写进这个文件」是同一个理由。没有这个库的部署不损失什么:内置渲染器照画,每张 float 记下没有库画过它,工件也写明路线图是它的文档装不下的 float。这是**测得的不存在**,不是失败的步骤。

## 考虑过的替代方案

- **教 `unembeddableFloats` 认识「画出来的 diagram 可以内联」。** 拒绝:那会让块类型带上一个条件,于是每个读者 —— pandoc 编译器自己的 `dropped` 列表、投稿件拒绝、最终包检查 —— 都得问一句「那它画了吗」,而不是让文档在有渲染时**就是**一张图。是渲染让它成为图;模型把这件事说一次。
- **Markdown 里保留 Mermaid,只把图放进文档模型。** 拒绝:Markdown 稿件本身是交付件,而 `figureBlock` 拒绝同时带 path 与围栏的 float。画出来的路线图按文件引用,与工具自己的 `roadmap.md` 并排,正是数据图已有的形态。
- **在 bundle 里点名解释器。** 拒绝:那是某一台机器上的虚拟环境。`cordis.patch.yml` 的注释说明这条通道并给出那一行,与它对 LaTeX 引擎的做法一致。

## 后果

- **两个方向都被钉住。** `tests/document-compile.spec.ts` 用一个记录型编译器驱动真实的 16 步运行:有绘图 provider 时 `Figure 2` 是携带 provider 的 SVG 与栅格的**图**,`floatsDropped` 为空,包里持有 `figures/figure-2.svg`、`manuscript.md` 引用它;没有 provider 时同一次运行保住 `diagram` 块,Markdown 保住 Mermaid 围栏,编译报出它装不下什么。前一个用例对着**关掉的分支**跑过并失败。
- **整条链用真实工具读了一次。** `tests/pdf-acceptance.spec.ts` 探测本机真实的 matplotlib 解释器,用它和真实 pandoc 驱动一次运行,并对**包自己的文件**断言:`floatsEmbedded.latex` 是 `['Figure 1', 'Figure 2']`、`floatsDropped` 为空、`figures/figure-2.svg` 是那个库产出的 SVG、编译出来的 DOCX 带两个 `word/media/` 部件。这个用例抬高 `timeoutMs`,因为 D1 通过库画图、E1 编译四种格式都是进程启动,registry 给离线通道的预算是装不下的。
- **`tests/package-export.spec.ts` 钉住字节。** 一个用真实 ZIP 签名与真实 PNG 签名作答的编译器:导出的包以 base64 携带 `manuscript.docx` 与 `assets/figure-1.png`,解码后头几个字节分别是 `PK` 与 PNG 魔数 —— 于是把内容文本包装过或重新编码过的写法会失败。
- **这里不是什么。** 它没有为**不点名绘图 provider** 的部署关掉 R02:那种部署的路线图仍然只有 Mermaid,它的包仍然停在 `draft` —— README 里记着的诚实状态。路线图印在第几页、是否清晰、一张 matplotlib 的方框箭头图读起来像不像方法图,是读者的判断,不是这条检查的。

## 文件

- `packages/research/dsh-research-team/src/runner/registry.ts`(`diagramDrawn`、`figureAssetPath`、float 循环、`compilation.documents`),`src/runner/package-export.ts`(两份字节列表都写)。
- `packages/bundle/research-app/cordis.patch.yml`(`figures` 通道,已写明)。
- `packages/research/dsh-research-team/README.md` / `README.zh.md`(更正 R05②/R02 的说法)。
- 用例:`tests/document-compile.spec.ts`、`tests/pdf-acceptance.spec.ts`、`tests/package-export.spec.ts`。
