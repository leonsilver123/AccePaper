# Agent Note: 只会回答的复核者,以及谁才算第二个读者

Status: implemented

[English](2026-09-18-a-reader-the-deployment-supplies.md) | 中文

## 问题

`runner/statement-support.ts` 与 `runner/resolution-verifier.ts` 陈述了两道缝 —— 一段文字是否确立了**这一句**,以及一次修订是否答复了它为之写下的那条意见 —— 而 team 包对两者都没有实现。缝存在、被检查、却从未被任何真实部署走到:出货 bundle 两个都不点名,于是每次运行都记下「没有任何句子被读过」,并把每条意见都留在等待中。没有 provider 的缝是设计,不是能力。

## 决定

- **`LlmReviewer` 就是这个 provider,建在 prose 通道之上。** `src/llm-reviewer.ts` 把句子与段落(或意见、答复、变更与章节现在的正文)经真实 agent loop 送出,读回一个判定。它建在 `LlmProseWriter` 之上,要的是**失败处理**而不是提示风格:流中断掉的回合、provider 报错、永远不落定的会话、在请求送出前就失败的程序集装配,那些都已经在那里被拒,并带着回合自己的理由。
- **模型只回答一个问题,别的都不答。** 它给出判定与依据。`readScope` 是**从 judgement 复制**的 —— 判定不能声称依赖比它拿到的那段更宽的阅读,而一个被问「你读了多少」的读者无论如何都会照它拿到的段落作答。`statementId`、两个内容版本、`citeKey`、`assessorVersion`、`judgedBy` 与 `judgedAt` 全部由类填写,因为一个能写下自己出处的读者能认证任何东西。
- **永不使用默认判定。** 没有 `SUPPORT`、没有 `VERDICT`、或取值不在已知集合内的回复一律**抛错**,并引用回复的开头。这道缝存在的理由正是「没人能读这句」与「这句成立」是两件不同的事实;默认值会恰好抹掉这个区别,而且抹向通过的那一侧。
- **判定不带身份。** 第一版让 `LlmReviewer` 把 `verifiedBy` 报成自己的 `<provider>/<model>`,并让 D4 拒绝来自作者路由的验证。用户 2026-09-18 的裁定纠正了它:第二个模型并不是让一次阅读独立的那个东西,而"要求第二条路由"是实现自己加的限制 —— 它让单模型部署什么都验证不了,却让双模型部署在共享同一个会话、同一套指令的情况下"看起来独立"。现在 `ResolutionVerdict` 只有 `{verdict, basis, evidenceRead}`,**别的什么都没有**,于是读者无法给自己命名,也就无法靠改名绕过任何检查;记录由 `verifyPending` 依据**宿主**知道的事实构造。
- **那么独立是什么。** 四条条件,各有自己的拒绝码:两次运行是不同的**执行**(`verification-same-execution` —— 因为 id 是宿主的,给读者改名不起任何作用);不同的**会话**(`verification-same-session`,会话会把修订自己的辩护带下去);不同的**规则**(`verification-wrong-role` —— 两个角色是靠指令区分的不同任务,不是靠显示名);以及角色本身属于复核者(部署把作者的角色交给它时报 `verification-wrong-role`)。没读就下结论会被拒(`verification-no-evidence`),针对运行已经不再持有的正文的报告也会被拒(`verification-stale`)—— 后者正是把一次阅读绑在它读过的那个版本上。
- **`abstained` 是第三种判定。** 拿不到必要证据的读者必须能说出来;只有 `verified` 与 `rejected` 时它只能猜,而弃权把 issue 留在原地 —— 那是一笔看得见的欠账,既不是关闭也不是打回。
- **每个执行背后的模型是被记录的,不是被门禁的。** `sharesAuthorRoute` 随每一次验证一起走,读者据此权衡"同一个模型既写又审"的共享偏差风险。它是备注,永远不是拒绝。
- **bundle 在 prose 所用的同一个模型上启用 verifier。** `packages/bundle/research-app/cordis.patch.yml` 让 `review.assessor` 与 `review.verifier` 都写在 `deepseek-v4-flash` 上,并写明 `minimumRounds: 2` 与复核规则的 `instructionsVersion`。此前那条要求第二条路由、并且让单模型部署产不出最终包的注释已经删掉,更正就写在原来那条错规则的地方。

## 考虑过的替代方案

- **为 verifier 要求第二条模型路由。** 按用户裁定拒绝:不同模型不能替代让一次阅读独立的那些条件,同模型也不应因为同模型而被拒。
- **连阅读范围也问模型。** 拒绝:那是关于**已做过的**阅读的事实,而读者无论如何都会照它拿到的段落作答。judgement 本来就带着它。
- **把解析不出的判定默认为 `partial` 或 `unrelated`。** 拒绝:两者在下游都是拒绝,于是默认值会把每一次读不懂的回复变成一句被拒的句子 —— 把「复核者坏了」报成「稿件不行」,是另一种失败被报成了更糟的一种。
- **给 verifier 一个带角色前缀的路由,好让旧比较通过。** 拒绝,而且用户点名这是绕过检查的手法:给字符串加前缀没有建立任何会话、权限或阅读。身份必须不再由读者自己声明。
- **让作者自己的执行来做验证,理由是「那也是一次不同的调用」。** 拒绝:同一个执行带着修订的辩护,于是这次阅读是作者对自己改动的陈述,而不是改动本身。

## 后果

- **`tests/llm-reviewer.spec.ts`**(9 条,真实组合):宿主服务按真实启动的方式挂载,脚本化 adapter 代替厂商,所以提示、会话与取消机制都是出货的那套。用例断言**请求确实到达**(adapter 自己的记录里带着那句话与那段文字)、身份与版本来自复核者被告知的内容、模型自称 `SCOPE: full-text` 不会移动被记录的阅读范围,以及三条拒绝:没写判定、判定不在集合内、缺依据。失败的回合被报成失败,而不是报成一个判定。
- **`tests/d4-model-revision.spec.ts`** 在生产路径上覆盖了两个方向:一个模型兼任两个角色**被接受**(脚本化 writer 与复核者共享 `test-provider/test-model`),记录上带着 `sharesAuthorRoute: true`,旁边是宿主的执行、会话与规则版本;而一个把 `verified` 下在空阅读清单上的 verifier,会让它的 issue 留在 `pending-verification` 而不是关闭它。
- **这里不是的。** 同模型的角色隔离并不让两次阅读在认知上独立 —— 人工抽查与对抗样本仍然必要,共享路由被记录下来正是因为这个。而 assessor 是每句引用一次调用,每次运行都由该部署支付;这个代价写在启用它的那一行。

## 文件

- `packages/research/dsh-research-cordis/src/llm-reviewer.ts`(新增)、`src/index.ts`(`review` 配置、两个复核者字段、下限)。
- `packages/research/dsh-research-team/src/runner/resolution-verifier.ts`(`ExecutionIdentity`、`ResolutionVerdict`、五条拒绝、`abstained`)、`src/runner/registry.ts`(`modelExecution`、`verifierIdentityOf`、`appliedWithVerification`、`verificationAudit`)。
- `packages/bundle/research-app/cordis.patch.yml`(assessor 行、下限、verifier 行与 `instructionsVersion`,以及那条错规则的更正)。
- 用例:`packages/research/dsh-research-cordis/tests/llm-reviewer.spec.ts`(新增)、`packages/research/dsh-research-team/tests/d4-model-revision.spec.ts`。
