# Agent Note: 编译器把引擎排不了的数学写成数学,只拒绝它确实排不了的东西

Status: implemented

[English](2026-09-18-the-compiler-states-the-mathematics-the-engine-cannot-set.md) | 中文

## 问题

一份真实稿件在正文里写了 `Δ` 与 `−38.2` —— 这是对的,因为研究算出来的就是这个 —— 而 pdfLaTeX 拒绝了整份文档。实测到的失败只说了那个字符:`Unicode character Δ (U+0394)`。模型把它自己研究的数学写对了,工具链排不了,于是这次运行的 PDF 这条路,栽在一份本来正确的稿件上。

旁边还有第二个问题:batch 模式什么都不打印,于是拒绝信息读作 `exited 1: This is pdfTeX … entering extended mode` —— 既没说是哪个文件,也没说是哪个字符。

## 决定

- **编译器把数学字符重述为它本就是的那个数学。** `pandoc-compiler.ts` 持有 `TEX_MATH`:一张显式而短的表,每一项都是含义确定无疑、LaTeX 写法唯一确定的数学字符(`Δ`→`\Delta`、`−`→`-`、`×`→`\times`、`°`→`^{\circ}`、…)。表内的字符变成 `\ensuremath{…}`;其余一切**原样保留**,于是一个不认识某个符号的编译器是照排那段文字,而不是为它编一个渲染法。
- **用 `\ensuremath`,不用 `$…$`。** pandoc 的 Markdown 读取器在收尾的 `$` 后面跟着数字时拒绝把它读成数学,而减号永远处在这个位置:第一版在 LaTeX 源里产出的是字面文本 `\$-\$38.2`(实测)。裸 TeX 穿过读取器不受影响,在正文与数学里同样成立,且不需要任何宏包。
- **只有需要它的写出器才应用。** HTML 是 UTF-8、DOCX 是 OOXML,两者都用读者已有的字体排这些字符;`TEX_FORMATS` 是 `latex` 与 `pdf` —— pandoc 经由 LaTeX 写出的那两种格式。此前「DOCX 那条路也该做这件事」的说法是错的,理由与 `$…$` 那个错法相同:它在每一种写出器里都产出坏掉的减号。
- **拒绝信息说出引擎说过的话。** `engineFailureOf` 读 `<jobname>.log` 并返回其中的 `!` 行,于是一次失败报的是 `Unicode character 西 (U+897F)`,而不是引擎的横幅。
- **表里没有的字符留在文档里。** 一条参考文献带着期刊自己的名字 —— `西南交通大学学报：英文版` 就是 OpenAlex 返回的刊名 —— 那是检索到的数据,不是模型撰写的正文。编译器不改写它,可选的 PDF 这条路于是带着**被点名的**字符失败。两种交付格式(DOCX 与 LaTeX)无论如何都原样带着它;为了让 PDF 编过而删掉一条参考文献,会改变这篇论文引用了什么。

## 考虑过的替代方案

- **从编译产物里剥掉非 ASCII 字符。** 拒绝,而且是用复核自己的话拒绝的:那会改变论文说了什么。参考文献表是论文的一部分。
- **让模型绕开自己的工具链来写。** 拒绝:模型把数学写对了,而在一篇关于 `Δ` 的论文里要求它避开 `Δ`,是拿一份正确的稿件去换工具链的方便。
- **产出 `$…$` 并指望读取器。** 实测拒绝:`$-$38.2` 对 pandoc 不是数学,并且在每一种写出器里都变回了被转义的字面文本。
- **把中日韩字符映射成 LaTeX 命令。** 拒绝:一个中日韩字形没有任何不属于「选字体」的 pdfLaTeX 命令,而选字体是部署的决定,不是这个编译器的。拒绝是诚实的,静默替换字形不是。
- **索性放弃 PDF 这条路。** 拒绝:对一台有引擎的部署它是必需的交付格式,而对稿件用拉丁文与数学记号正当写出的东西,它现在编得出来。

## 后果

- **真实引擎证据,2026-09-18。** `.workbuddy/tmp/tex/TinyTeX`(TeX Live 2026,pdfTeX 3.141592653-2.6-1.40.29)经由这道缝编译了稿件:一份 86 KB 的 `%PDF-1.7`,其解压后的内容流里带着 `[(Results)]TJ [(The)-333(e\033ect)-333(fell)-334(b)28(y)]TJ [-333(\000)]TJ [(38.2)-333(%)-334(and)]TJ` —— 正文,减号是以数学字形排出的 —— 加上表格的单元格与两个图像对象。LaTeX 源里带着 `\ensuremath{-}38.2`、`\ensuremath{\Delta}`、`\begin{longtable}`、`\toprule` 与 `\includegraphics`。
- **`tests/pdf-and-figures.spec.ts`** 增加了一个针对本机引擎的 `describe.skipIf` 块(通过 `DSH_LATEX_ENGINE` 或检出目录内的安装找到):一条把数学、表格、公式与图编译成真实 PDF,另一条断言中日韩字符的拒绝里点名了 `U+897F`,而同一份文档作为 LaTeX 编译时原样带着那个刊名。被跳过的真实工具用例与通过的是可区分的;替身引擎的用例原样留在旁边,它们证明的字节处理是真实引擎证明不了的。
- **`tests/matplotlib-provider.spec.ts`** 给它那两条真实库用例写了明确的预算。绘图那条在整套并行负载下于 5022 ms 超时、单独跑却通过 —— 这是用例自己的缺陷,按实测记下,不是库慢。
- **这里不是的。** `TEX_MATH` 的表并不声称完整:表外的数学字符走到 PDF 那条路就是一次拒绝,而这张表靠实测增长。排版仍是 pandoc 默认而不是期刊模板 —— `FormatSpec`/CSL 是另一个单元。

## 文件

- `packages/research/dsh-research-cordis/src/pandoc-compiler.ts`(`TEX_MATH`、`asTexMath`、`TEX_FORMATS`、`engineFailureOf`)。
- 用例:`packages/research/dsh-research-cordis/tests/pdf-and-figures.spec.ts`、`packages/research/dsh-research-cordis/tests/matplotlib-provider.spec.ts`。
