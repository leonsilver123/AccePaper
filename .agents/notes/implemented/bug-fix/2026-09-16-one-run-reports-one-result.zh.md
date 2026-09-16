# Agent Note: One run reports one result

Status: implemented

[English](2026-09-16-one-run-reports-one-result.md) | 中文

## Problem

这项研究的数字,在被需要的地方各自重算了一遍。C 门禁量了一次研究,`C1-mvp` 量了一次,`B3-baseline` 量了一次,`D1-figure-map` 用另一次比较画图,`D3-writing` 用第三次写正文,`D4-rebuttal` 拿第四次修订,`E1-format` 又用第五次渲染手稿里的表格。

没有任何东西比对过它们,而且也不需要:对同一份研究,`comparePlatoons` 是确定性的,所以每一次重算都一致。这正是这个安排能通过复核的原因 —— 数字对得上,于是没人去看它们是不是来自同一次计算。后果是:研究一旦改变,这六处必须一起动,而第一个漂掉的那处,正是没人会重读的那处。其中两处是论文被评判时看的展品:一张图与一张结果表,它们可以和旁边的正文、以及它们所illustrate的判定互相矛盾,而每一处自己的注释都说这不可能。

## Decision

`C1-mvp` 写 `result-version`(`runner/result-version.ts` 的 `ResultVersion`):六个测量量、产出它们的规则版本、主张绑定的指标,以及覆盖这一切的 SHA-256。它是 `C1-mvp` 声明的输出,也是每一个报告这些数字的步骤声明的输入 —— `C2-trinity-loop`、`C3-boundary`、`D1-figure-map`、`D3-writing`、`D4-rebuttal`、`E1-format`。

`measureOutcomeWithSource(ctx)` 读这条记录,并返回它来自两者中的哪一个。重算无法从一个纯函数里删掉,所以它被改成**可检出**的:`D3-writing` 把 `resultSource` 与 `resultRef` 记在 `draft` 上,`D4-rebuttal` 记在 `revised-draft` 上,而 `D1-figure-map` 与 `E1-format` 直接用记录里的数字建表。没有产出者时被驱动的步骤会自己量这份研究并写 `recomputed`;在一次被驱动的运行里那个分支不可达,因为这条记录是声明的输入,而驱动器拒绝启动一个运行里没有其输入的步骤。

`B3-baseline` 仍然自己量这份研究。它跑在 `C1-mvp` 之前,没有记录可读,而确立基线正是它的职责。这是仅剩的一次测量,也是构造上就排在第一位的那次。

## Alternatives considered

**把重算从每个读取者里删掉,改成把数字当参数往下传。** 拒绝:调用图很宽,而一个到达四个执行器的参数是一个没有任何东西记录的值 —— 失败模式会从"对数字有分歧"变成"数字在步骤之间丢了"。记录是一条运行产物,所以它可以被寻址、有哈希、会持久化,并被每一个用过它的产物具名。

**把重算出来的值与记录比对,不一致就拒。** 作为主要机制拒绝,虽然那是检测的最强形式。一条拒绝只在一个步骤**读了记录**时才能触发,所以对一个从不去问的读取者毫无作用;而 `resultSource` 无论哪条路都把这个事实记下来。比对还让每一步多付一次测量,而那次测量正是要拿掉的东西。

**只记数字,不记记录。** 拒绝:光有数字说不出是哪个规则版本产出它们的,于是两次在不同 `EXPERIMENT_RULE_VERSION` 下的运行会被当成相等,而它们不该。规则版本在哈希里。

**把 `resultSource` 做成每个工件的必填,而不只是报告数字的那些。** 拒绝:十五个步骤会带上一个其中十四个填不了的字段。它长在正文陈述了数字的那些工件上。

## Consequences

- `tests/result-version.spec.ts`(11 条)钉住:记录的数字与 `mvp-results` 一致、两个散文步骤的 `resultSource: 'result-version'` 与 `resultRef` 对上记录的哈希、声明的依赖边、以及哈希对测量的敏感性。
- **展品那条测试是有牙齿的,而且是量出来的**:它把一次运行驱动到 `D1-figure-map`,然后交给 D1 一份两个实验臂完全相同的研究 —— 它对记录里的 −38.2 % 量出 0 % 的变化 —— 并断言渲染出的三线表带的是记录里的数字。把该处的 `comparePlatoons(ctx.runCtx.study)` 还原回去,这条测试就会失败;这条断言是这样被验证的,不是被假设的。
- 第二条测试在一个没有记录的运行上驱动 `D3-writing`,断言驱动器拒绝它,并在理由里具名 `result-version`。这条拒绝正是让 `recomputed` 分支经驱动不可达的东西,而且它可证伪:产生它的只有那条输入声明。
- `result-version` 是每个产物包里新增的一条工件,`ARTIFACT_TYPE_BY_SLUG` 把它映射到自己的类型。包的读者现在能看见这次运行唯一的那次测量结果、以及产出它的规则版本,而不必从正文里反推任何一样。
- **`runner/registry.ts` 里删掉了三个谁也没在文档的文档块**:一份 `bodyTextFor` 契约的过期副本、一份主语已被改名的、以及一份我自己的改动叠在活块之上的。`defaultBodySections` 与 `sectionsOf` 现在接收步骤上下文 —— 读记录需要它。
- **记录不是一次校验。** 它陈述这次运行量到了什么;这些数字是否支撑主张是 C 门禁的问题,而它们是否正确,目前谁都还没有回答。
