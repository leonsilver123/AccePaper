# Agent Note: 面板不跟随主题,也说不出每一种运行状态

Status: implemented

[English](2026-09-19-the-panel-followed-no-theme-and-could-not-name-three-run-states.md) | 中文

## 问题

研究面板上的两个缺陷,都看得见,也都不是任何门禁够得到的。

**面板不理会应用的主题。** 它的两个样式表 `ResearchView.module.css` 与 `workbench/ResearchWorkbench.module.css` 带着 161 个 `#rrggbb` 字面量和 0 个主题变量。宿主切换暗色模式的方式是在 body 上切换 `data-ds-dark-theme`(`packages/client/ui-theme/src/boot-theme.ts`),并在同一个属性下把调色板定义成 `--dsw-alias-*` 令牌(`packages/client/ui-theme/src/styles/design-platform.css`)。开着暗色模式时,面板仍然是浅色表面和固定灰:写成十六进制值的颜色只有一个含义,没有另一个调色板可去;按角色选的令牌则有人替它选好。

**运行列表说不出宿主能产出的每一种状态。** 宿主的 `ResearchRunExecution` 有四个成员,其中一个是 `unreadable` —— 这个 id 底下盘上有东西,而**这个 build 读不懂它**;它既不是 `failed` 也不是不存在,因为"驱动抛了"和"快照是别的 schema 写的"是两件不同的事实。一个被宿主报成这个名称的存档运行,被显示成 `the host named a state this build does not know`。客户端在 `summary.ts` 里保留了自己的一份联合类型副本,只覆盖四种状态中的三种,又在 `run-source.ts` 里保留了一份列表副本,同样只覆盖那三种,于是 `RUN_EXECUTIONS.find(...) ?? null` 答 `null`,`ResearchWorkbench.tsx` 打印 `projects.stateUnknown`。两种语言的词典从头到尾都带着 `run.execution.unreadable`,根本到不了。**一条到不了的词典条目,和一条缺失的条目是同一种沉默。**

## 决定

- **每一个颜色都来自令牌,按角色选而不是按十六进制值选。** 面板现在用 `--dsw-alias-bg-module-platform`、`--dsw-alias-bg-layer-1`、`--dsw-alias-label-primary`、`--dsw-alias-label-secondary`、`--dsw-alias-border-l2`、`--dsw-alias-state-*` 一族和滚动条那一对;并且因为这张样式表会滚动、会画模块表面,它按 `ui-theme` 的 `styles/scrollbar.css` 所拥有的约定,把 `--dsh-scrollbar-thumb` / `--dsh-scrollbar-thumb-hover` 重绑到 l2 立面那一对。
- **有两处必须离开原来的颜色,而两处都是测量逼出来的,不是口味。** 琥珀色的提示墨在浅色表面上量到 2.58:1 —— 面板里唯一一处低于 WCAG 的配对 —— 所以运行的警告态从 `#b25e00` 配 `#fff4e5`,改成着色填充(`--dsw-alias-state-warn-tertiary`)配主标签墨(`--dsw-alias-label-primary`)。而 ui-cordis 的成功配色是被**刻意不**照抄的:`ui-cordis` 用 `--dsw-alias-state-success-primary`(green-500)当墨、画在 `--dsw-alias-state-success-tertiary`(green-100)上,浅色下量到 2.09:1;面板改用成功填充配 `--dsw-alias-label-primary`。中性令牌的边框从 `1px` 收窄到立面门禁要求的 `0.5px` 发丝线。
- **验证是渲染出来的,不是推出来的。** 一次对面板内每一个可见文本节点的自动扫描,在**两种**调色板下都数到 617 个节点、0 个低于 WCAG 底线。第一次探测渲染的是**旧**调色板,并且被抓了出来 —— profile 提供的是**构建后**的产物,而 CSS Modules 在构建期就被内联,所以在客户端包重建之前,源码里的改动是看不见的。
- **运行状态的清单只住一处,就在它必须覆盖的那个联合类型旁边。** `summary.ts` 导出 `RUN_EXECUTIONS`,`run-source.ts` 导入它;第二份副本被删掉,并留了一条注释写明它的代价。往联合类型里加一个状态而忘了加进清单,是一个**类型**错误 —— 这正是重复的清单永远给不出的检查:
```
type MissingExecution = Exclude<RunExecution, (typeof RUN_EXECUTIONS)[number]>
const EVERY_EXECUTION_IS_LISTED: MissingExecution extends never ? true : never = true
```
- **词典那一半是类型看不见的,所以由用例来查。** `tests/run-execution-vocabulary.spec.ts` 读那份清单和两份词典,两个方向都查:清单里的每个状态在 `en` 和 `zh` 里都有非空的 `run.execution.<state>` 条目;并且不存在清单没有携带的状态的 `run.execution.*` 键 —— 整体排序后比较,所以失败时点名的是那个孤儿,而不是一个数量。

## Alternatives considered

- **把 ui-cordis 的绿色配色照抄到面板的成功表面上。** 拒绝,理由是测量:green-500 当墨画在 green-100 上是 2.09:1,低于底线。照抄邻近面板的配色会把一处对比度不合格带进第二块表面;而留下来的那处不对称,是带着决定它的那个数字被写下来的,不会看起来像一次疏漏。
- **只修运行列表,而不合并这对孪生。** 拒绝:会漂移的正是这对孪生。一个联合类型的两份副本可以各自独立地落后于宿主,而落后的那一份并不是被读的那一份 —— 所以修好列表只会让下一个状态以完全相同的方式被漏掉。
- **保留回退文案,当作面板对未知状态的回答。** 拒绝:回退本身没有错,这个 build 不认识的线上值必须照旧上屏。错的是这个 build **认识**的状态走了那条路,而再好的回退文案也修不了它。

## Consequences

- 面板在两种调色板下都跟随应用主题。它画的颜色是角色的颜色,所以 `ui-theme` 里改一次调色板,不用改这里就能到达它。
- 运行列表说出了宿主能产出的每一种状态,`unreadable` 现在用读者自己的语言读出来,而不是读成一个未知状态。
- 往宿主的联合类型里加一个状态,只有同时加进清单和两份词典才会到屏幕上:前者是编译错误,后者是用例失败。
- 这次词表工作是宿主联合类型的客户端那一半;宿主侧没有任何变化,而宿主的四个成员就是客户端必须跟上它的东西。
- 验证的边界是被写明的,而不是被暗示的:那次扫描量的是渲染出来的页面,而它只有在客户端包重建之后才作数。

## Files

- `packages/research/dsh-research-web/src/client/workbench/ResearchWorkbench.module.css` 与 `packages/research/dsh-research-web/src/client/ResearchView.module.css` —— 每个颜色换成某个角色的令牌、两处经测量的例外,以及发丝边框。
- `packages/research/dsh-research-web/src/summary.ts` —— `RUN_EXECUTIONS` 唯一的家、`RunExecution` 的第四个成员,以及 `MissingExecution` 的穷尽性检查。
- `packages/research/dsh-research-web/src/run-source.ts` —— 删掉的第二份清单副本。
- `packages/research/dsh-research-web/tests/run-execution-vocabulary.spec.ts` —— 两种语言、两个方向的词典检查。
- `packages/research/dsh-research-web/src/client/workbench/ResearchWorkbench.tsx` —— 已知状态曾经走到的那条回退路径。
