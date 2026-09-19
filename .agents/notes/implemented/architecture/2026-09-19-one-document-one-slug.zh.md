# Agent Note: 一个文档,一个 slug

Status: implemented

[English](2026-09-19-one-document-one-slug.md) | 中文

## 问题

流水线给每个写作步骤各自一个产物:D3 的 `draft`、D4 的 `revised-draft`、E1 的 `formatted-manuscript`。一个文档三个 slug,而它代价最大的地方正是这一层最在意的那条性质 —— 判定必须绑定它作出时那份文档的版本,而三个 slug 给了它三个要绑的东西,而不是一个。

把它们合并,暴露了一个被这种拆分掩盖着的缺陷,而这才是这次改动值得做的原因,不只是整齐。`d4Executor` **从零重建**产物值。在拆分之下的后果还能承受,因为 D3 的 `draft` 还在,可以读。合成一个 slug 之后没有别处可读 —— 注册表每个 slug 只保留最新的一份值 —— 于是 D3 写过、而 D4 不再重算的每一个字段,都**从这次运行里彻底消失了**。其中一个字段是有承重的:`final-package.ts` 的 `no-refused-sections` 检查读 `refusedSections`,它对每一次运行都返回空,于是一次**确实拒绝过某个小节**的运行会被报成一次什么都没拒绝的运行。**一道不可能失败的闸门比没有闸门更糟,因为它报告的是成功。**

第二处小一些:A 通道的证据串是 `` `the ${manuscript.slug} manuscript` ``,现在会打印出 "the manuscript manuscript"。

第三处,也是最容易被漏掉的:机械改名让三处用例读了同一个 slug 两次,拿修订稿跟它自己比。它们照常通过,却什么都没在测。

## 决定

- **文档是一个 slug,`manuscript`,一个版本计数器。** `steps.ts` 声明 D3 `outputs: ['manuscript']`、D4 `inputs: ['manuscript', 'result-version'] outputs: ['rebuttal', 'manuscript']`、E1 `inputs: ['manuscript', ...]`。`nextArtifactVersion` 本来就按 slug 递增,所以每次重新发布都是一个新版本、一个新内容哈希,不需要任何新机制。
- **重新发布者要把自己不重算的东西带过去。** D4 现在从它读到的文档里带过 `proseRequests`、`proseRequestVersion`、`sectionEvidence`、`refusedSections`,与它旁边已有的 `references`／`citations`／`argumentPlan`／`renderedFigures`／`statementAssessments` 用同样显式的写法,每一条都注明了它的消费者。
- **需要修订前那一版文档的用例,去引擎留着它的地方读** —— D3 自己的尝试记录,`getRunSnapshot(store, runId).steps['D3-writing'].artifacts['manuscript']` —— 因为注册表只保留最新值。

## Alternatives considered

- **保留三个 slug,让每一步读上一步。** 拒绝:那正是要被去掉的安排,而上面的缺陷正是它掩盖的东西 —— `draft` 还在时,那个遗漏看起来像一个设计选择,而不是一次丢失。
- **让 D4 把 D3 的值复制一份、替换掉被改写的小节。** 现在的带过就是这件事,但写成一份显式清单而不是展开。展开会把字段带过去,也会把某个字段含义变化后的东西悄悄带过去;写成清单,形状一变就编译不过。
- **只改用例,因为失败里有六条「只是期望值」。** 拒绝:它们不是期望值。用例是对的,源码是错的 —— 而这正是「改规格说明」会销毁「某道闸门已经停止工作」的唯一证据的那一类情况。
- **把出现的每一处 `'draft'` 都改名。** 拒绝:`'draft'` 同时还是包状态(`FinalPackageState = 'draft' | 'final'`)和编译模式(`CompileRequest.mode`)。一次不分青红皂白的改名弄坏了这两处的十条断言,而每一条断言的主语才是分辨它们的依据。

## Consequences

- 整条流水线跑在合并后的 slug 上 —— 端到端驱动过:A1..D2 passed、D3 passed、D4 passed、E1 passed、E2 gated。
- `'draft'` 与 `'revised-draft'` 不再是产物 slug。`formatted-manuscript` 仍是 E1 的产出;把它拆成 `typeset` 产物是下一个单元,不是这一个。
- 注册表里被重新发布的 slug,其条目记的是**最后**一个产出者,所以 `happy-path-t19b.spec.ts` 的「写入每一个声明的输出 slug」现在对着最后一个声明者检查。它仍然抓得住「声明了却从未产出」和「未被声明的写入者」。
- **被挡下或失败的步骤,其输出仍然会提交进注册表** —— 提交发生在闸门之前。两处断言「被拒绝的步骤之后没有产出稿件」的用例,现在断言的是「没有更晚的步骤重新发布它」,而那才是它们一直在说的事实。
- `dsh-research-team/README.md` 两种语言都描述了旧 slug;已更正并重新记录配对。
- **这里没做**:`verdict.ts` 的 `MANUSCRIPT_SLUGS` 现在是一个单元素列表,而且判定不记录它读的是**哪一个版本**的稿件。两件都是真问题,属于下一个单元。

## Files

- `packages/research/dsh-research-core/src/engine/steps.ts` —— D3、D4、E1 上合并后的 slug。
- `packages/research/dsh-research-team/src/runner/registry.ts` —— D3 提交 `manuscript`;D4 重新发布它并带过那四个字段。
- `packages/research/dsh-research-team/src/runner/{verdict,package-export,final-package}.ts` —— 那些读取与产出者名表。
- `packages/research/dsh-research-web/src/client/{record-vocabulary.ts,locales.ts}` —— 产物词表与它的两种语言。
- `packages/research/dsh-research-team/README.md` 与 `.zh.md` —— A 门禁描述里点名的那个 slug。
