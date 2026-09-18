# Agent Note: 只会回答的复核者,以及谁才算第二个读者

Status: implemented

[English](2026-09-18-a-reader-the-deployment-supplies.md) | 中文

## 问题

`runner/statement-support.ts` 与 `runner/resolution-verifier.ts` 陈述了两道缝 —— 一段文字是否确立了**这一句**,以及一次修订是否答复了它为之写下的那条意见 —— 而 team 包对两者都没有实现。缝存在、被检查、却从未被任何真实部署走到:出货 bundle 两个都不点名,于是每次运行都记下「没有任何句子被读过」,并把每条意见都留在等待中。没有 provider 的缝是设计,不是能力。

## 决定

- **`LlmReviewer` 就是这个 provider,建在 prose 通道之上。** `src/llm-reviewer.ts` 把句子与段落(或意见、答复、变更与章节现在的正文)经真实 agent loop 送出,读回一个判定。它建在 `LlmProseWriter` 之上,要的是**失败处理**而不是提示风格:流中断掉的回合、provider 报错、永远不落定的会话、在请求送出前就失败的程序集装配,那些都已经在那里被拒,并带着回合自己的理由。
- **模型只回答一个问题,别的都不答。** 它给出判定与依据。`readScope` 是**从 judgement 复制**的 —— 判定不能声称依赖比它拿到的那段更宽的阅读,而一个被问「你读了多少」的读者无论如何都会照它拿到的段落作答。`statementId`、两个内容版本、`citeKey`、`assessorVersion`、`judgedBy` 与 `judgedAt` 全部由类填写,因为一个能写下自己出处的读者能认证任何东西。
- **永不使用默认判定。** 没有 `SUPPORT`、没有 `VERDICT`、或取值不在已知集合内的回复一律**抛错**,并引用回复的开头。这道缝存在的理由正是「没人能读这句」与「这句成立」是两件不同的事实;默认值会恰好抹掉这个区别,而且抹向通过的那一侧。
- **身份是路由,不是角色。** `LlmReviewer.id` 是 `llm:<provider>/<model>`,而 D4 现在把作答的路由作为作者 id 传下去(`runD4Rebuttal` 里的 `authorId`、`llmRoute(analysis)`),不再用常量 `D4_PRODUCER`。于是与 prose writer 用同一个模型的复核者会被**拒绝**,报 `verification-not-independent` —— 把两个角色叫成不同的名字,会让一个模型给自己的回复背书,而那正是这条检查唯一要抓的东西。`appliedWithVerification` 作者身份改为参数传入,不再能从模块常量读出。
- **bundle 点名 assessor 并写明下限,而**不**点名 verifier。** `packages/bundle/research-app/cordis.patch.yml` 在 `deepseek-v4-flash` 上启用 `review.assessor` 并写明 `policyVersion: sentence-vs-passage-1` 与 `minimumRounds: 2`。verifier 留空,**连同理由一起写下来**:本部署的正文就写在同一路由上,点名它会让 D4 拒绝每一次验证并让该步失败。在某个部署给复核者自己的路由之前,运行会把每次修订都留在待验证、审阅因此不满足、`checkFinalPackage` 拒绝作为期刊收到的那份论文 —— 但仍可作为草稿导出。这是诚实的状态(没人读过那些答复),不是换个标签的 profile 能抹掉的状态。

## 考虑过的替代方案

- **连阅读范围也问模型。** 拒绝:那是关于**已做过的**阅读的事实,而读者无论如何都会照它拿到的段落作答。judgement 本来就带着它。
- **把解析不出的判定默认为 `partial` 或 `unrelated`。** 拒绝:两者在下游都是拒绝,于是默认值会把每一次读不懂的回复变成一句被拒的句子 —— 把「复核者坏了」报成「稿件不行」,是另一种失败被报成了更糟的一种。
- **保留 `D4_PRODUCER` 作作者、给 verifier 一个带角色前缀的 id。** 拒绝:那正是「一个模型给自己的答复背书、而检查报告说独立」的排布。两个 id 必须可比,比较才有意义。
- **在 prose 路由上启用 `review.verifier` 并接受名义通过。** 断然拒绝 —— 那会让出货 profile 产出「答复没人读过」的包,而这正是 2026-09-18 流程复核所针对的缺陷。

## 后果

- **`tests/llm-reviewer.spec.ts`**(9 条,真实组合):宿主服务按真实启动的方式挂载,脚本化 adapter 代替厂商,所以提示、会话与取消机制都是出货的那套。用例断言**请求确实到达**(adapter 自己的记录里带着那句话与那段文字)、身份与版本来自复核者被告知的内容、模型自称 `SCOPE: full-text` 不会移动被记录的阅读范围,以及三条拒绝:没写判定、判定不在集合内、缺依据。失败的回合被报成失败,而不是报成一个判定。
- **`tests/d4-model-revision.spec.ts`** 增加了生产路径上的独立性用例:一个 verifier 上报 `verifiedBy: 'llm:test-provider/test-model'` —— 即脚本化 writer 自称的路由 —— 会让 D4 停在 `in_progress`、带 `verification-not-independent`、且不产出 rebuttal 工件。
- **这里不是的。** 出货 profile 仍然到不了最终包,因为它没有独立的复核者;那是部署的缺口,记在 `cordis.patch.yml` 里它所属的那一行旁边。而 assessor 是每句引用一次调用,每次运行都由该部署支付 —— 这个代价写在启用它的那一行,不是等着被发现。

## 文件

- `packages/research/dsh-research-cordis/src/llm-reviewer.ts`(新增)、`src/index.ts`(`review` 配置、两个复核者字段、下限)。
- `packages/research/dsh-research-team/src/runner/registry.ts`(`authorId`、`llmRoute`、`appliedWithVerification`)。
- `packages/bundle/research-app/cordis.patch.yml`(assessor 行、下限,以及 verifier 为何不点名)。
- 用例:`packages/research/dsh-research-cordis/tests/llm-reviewer.spec.ts`(新增)、`packages/research/dsh-research-team/tests/d4-model-revision.spec.ts`。
