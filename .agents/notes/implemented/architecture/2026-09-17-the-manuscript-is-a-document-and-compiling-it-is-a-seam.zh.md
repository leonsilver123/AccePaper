# Agent Note: 稿件是一份文档,而编译是部署填的那道缝

Status: implemented

[English](2026-09-17-the-manuscript-is-a-document-and-compiling-it-is-a-seam.md) | 中文

## 问题

E1 装配稿件的方式是拼接字符串:一个标题、每节一个 `## heading`、若干图块、编号的参考文献。任何需要把稿件当作文档来用的东西,都得把这段字符串解析回部件;而计划里的编译链(M08:结构化文档 → HTML ＋ PDF／TeX)没有任何结构化文档可编译。交付的包里只有 `manuscript.md`,没有任何期刊、读者或 PDF 引擎能拿走的东西。

## 决定

- **`runner/document-compile.ts` 把稿件陈述为若干部件。** `ManuscriptDocument` 是标题、带类型块的章节(prose;自带 SVG 的 figure;作为 markdown 的 table;作为 mermaid 的 diagram;作为 LaTeX 的 equation)与按正文引用方式命名的 references。块由 E1 已有的部件构成,于是这个组合只被陈述一次,而不是被每个后端各自重新推导。
- **编译是一道缝,研究包里不 spawn 任何进程。** 部署注入一个 `DocumentCompiler`(经 `ctx.research`,由 `hostDocumentCompiler()` 读取并交给 drive options,与 prose 通道一样)。这些类型从包的公开 `./types` 入口再导出,于是部署可以实现这道缝而不必导入内部路径。
- **拒绝才是本单元的意义。** `compile-compiler-missing`(没配编译器 —— 稿件照旧导出)、`compile-format-unavailable`(本部署产不出的格式:没有 LaTeX 引擎的机器对 `pdf` 的回答)、`compile-citation-unresolved`(参考文献表不持有的键,在编译器运行**之前**被拒绝,因为编译器会把它渲染出来、警告只留在没人看的日志里)、`compile-nothing-to-render`。
- **编译本身什么都不写。** 内容返回给调用者去暂存与发布,于是一次失败的编译不可能毁掉上一次导出写下的东西 —— 计划里「编译失败不毁旧包」这条在这里是结构性的,而不是一句承诺。
- **E1 记录是什么渲染了它。** 工件携带 `compilation`(工具、可用格式、已编译文件、拒绝),编译出的文件存在时加入包;编译不了的运行在工件上说明这一点,而不是靠「文件不存在」暗示。
- **部署的编译器驱动 pandoc**(`dsh-research-cordis/src/pandoc-compiler.ts`),以结构化方式满足那道缝,所以本包仍不依赖 research-team 包。它可用的格式是**探测**出来的:只有当 LaTeX 引擎真的应答时,部署才提供 `pdf`。

## 考虑过的其他做法

- **直接编译装配好的 Markdown 字符串。** 拒绝:它正是本单元要替换掉的输入 —— 每个后端对它的解析都不同,而图、公式与引用在它们被造出来的地方就已经是有类型的了。
- **从研究包里 spawn pandoc。** 拒绝:机器有没有工具链是部署事实,而一个会 spawn 进程的研究包等于拿走了部署自己拥有的能力。这道缝也让测试在没有工具链时仍然是确定性的。
- **让编译器解析引用(用 CSL 书目走 `--citeproc`)。** 目前拒绝,不是原则上拒绝:运行的参考文献是一条已格式化的条目加一个 cite key,不是 CSL JSON,而从格式化字符串反推 CSL 字段会凭空发明 M03 作为「来源所记」保留的结构化字段(`volume`、`page`、`container-title`)。编号是稿件的,编译器只负责渲染。
- **HTML 用 `--mathjax`。** 依据实测拒绝:带 MathJax 的自包含文件是 1.78 MB,而计划要的是断网也能读的成品。MathML 在当代浏览器里原生渲染,同一份文档是 14 KB。

## 后果

- **对着真实工具端到端核验过**:按出货配置(有 pandoc、无 LaTeX 引擎)驱动的一次运行产出了 14 KB 的 `manuscript.html` —— 自包含、图内联、公式为 MathML、引用渲染成编号 —— 和 8.8 KB 的 `manuscript.tex`(带 LaTeX 文档类与模型自己的公式),`compilation.refusals` 为空;`pdf` 那条腿回答的是 pandoc 在本部署上产不出 PDF。
- **没有 pandoc 的部署什么都不会失败**:运行照旧导出 Markdown 稿件,工件记录 `compile-compiler-missing`,`tests/document-compile.spec.ts` 断言了这一点。
- **这里没有覆盖的。** 本仓库目前任何地方都还没有 PDF —— PDF 这条腿实现过、没被走到,因为没有部署写出 LaTeX 引擎。排版是 pandoc 的默认而不是期刊模板,因为没有期刊模板被读过(TRC 核验表记录了那些未核验的规则)。文档模型也很薄:M08 将来渲染的是 M04 的语句级契约,而它还不存在。

## 文件

- `packages/research/dsh-research-team/src/runner/document-compile.ts`(新增)、`src/types.ts`(再导出那道缝)、`src/runner/types.ts` 与 `src/runner/drive.ts`(编译器到达那一步)、`src/runner/registry.ts`(E1 建文档、编译并记录)、`src/index.ts`(`hostDocumentCompiler`)。
- `packages/research/dsh-research-cordis/src/pandoc-compiler.ts`(新增)、`src/index.ts`(`Config.document` 与探测)、`packages/bundle/research-app/cordis.patch.yml`(出货 profile 写出 pandoc)。
- 测试:`packages/research/dsh-research-team/tests/document-compile.spec.ts`、`packages/research/dsh-research-cordis/tests/pandoc-compiler.spec.ts`(没有 pandoc 时自跳过;拒绝路径两种情况都断言)。
