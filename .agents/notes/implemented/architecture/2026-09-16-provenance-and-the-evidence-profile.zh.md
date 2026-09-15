# Agent Note: What produced a value, and what a deployment is allowed to call evidence

Status: implemented

[English](2026-09-16-provenance-and-the-evidence-profile.md) | 中文

## Problem

研究流水线把六种值混在同一张产物图里,而直到现在,它们之间的差别住在一个没有任何人**被要求**去读的字符串字段里。

`A1-landscape` 会够到 OpenAlex 目录、记录真论文。B 通道 —— 即"某条主张被外部证据锚定"的那个判定 —— 却对着 `MockCitationResolverAdapter` 解析一个合成 DOI(`10.0000/synthetic.t19b-anchor`),把得到的核验交给 `adjudicate({ component: 'B', requireExternalAnchor: true })`。那份核验通过了。它自己的 basis 串在每一次判定上都写着 `mock_external`,所以没有任何隐瞒;但也没有任何东西阻止它被当成生产证据。

架构审查把后果复现成了 `externalAnchor` 探针:A1 的 B 门禁返回 `passed`,证据里明写着 `MockCitationResolverAdapter` 与 `syn-l0-001`。一次文献为真、锚定为合成的运行,报出了一条毫无间断的批准链。

同一种混淆还朝另外两个方向跑。`fixture` 产物与 `simulation` 产物都算"不真",尽管仿真可以是合法的科研结果,而 fixture 只证明程序跑过。以及,一个被找到但从未读进去的来源,与一个全文支持该主张的来源,两者无法区分 —— 而这恰恰决定了某条引用到底能不能用。

## Decision

**两条轴,因为它们的失败方式不同而分开;以及一个决定"什么可以承载门禁"的 profile。**

`dsh-research-core/src/domain/provenance.ts` 声明它们。

**`sourceClass`** 是值**是什么**:`fixture`、`simulation`、`imported`、`measured`、`literature`、`model_generated`。封闭集合,因为一个不属于其中任何一个的产出者,没有诚实的类别可声明。

**`sourceAccess`** 是一个来源**实际被读了多少**:`full-text`、`abstract-only`、`metadata-only`、`none`。当问题不适用时它缺席 —— 仿真测量不是从任何地方读来的,给它声明一个访问级别只是噪声。

`admitAsEvidence(profile, provenance)` 返回三种处置之一,而第三种才是要紧的那个:

- **`admitted`** —— 该证据可以承载门禁。
- **`pending`** —— 来源被找到了但没读进去。这是**仍在收集**的证据,它的正确结局是 HOLD。它刻意不是一个更软的 `refused`:`refused` 会有把主张报成被反驳的风险,而事实是还没人读过那篇论文。
- **`refused`** —— 该类别根本无法承载生产门禁。

**`EvidenceProfile`** 是 `production` 或 `evaluation`。在 `production` 下,`fixture` 与 `model_generated` 直接拒绝 —— 类别先于访问级别决定,因为"我们读过一个合成记录的正文"仍然是合成的。访问级别低于 `full-text` 则得到 `pending`。`simulation`、`imported`、`measured`、`literature` 被接纳,所以一次实验是仿真的研究不会被一概拒绝:仿真是一个结果,fixture 是一次演示。

在 `evaluation` 下,一切都接纳,因为跑通流水线正是这个 profile 的用途 —— 而 `submittabilityOf('evaluation').submittable` 是 `false`。**运行的权利与发表的权利是分开的,这里就是它们被分开的地方。** 一次运行不会因为"没有含 fixture 证据"而变得可投稿;可投稿性是**部署在案声明过哪个 profile** 的属性。

**出货 bundle 声明 `evaluation`。** 它的 B 锚就是那个模拟解析器,所以这是诚实的声明;它写出的包在 manifest 与 `run-summary.md` 里写着 `submittable: NO` 及理由。运行快照把 profile 与可投稿性带进浏览器视图,于是页面无法把一次演示运行和一次生产运行渲染成同一个样子。

**`runT19B` 默认 `evaluation`。** 未声明的运行会执行,并被盖上不可投稿 —— 宽松的默认值不可能变成一份已发表的声明,因为它给的自由是**运行**的自由,永远不是提交的自由。`production` 只有声明才够得着,而这正是"部署在案"的含义。

**B 通道在证据被使用的那个地方执行它。** `buildBChannelAnchors` 现在把 `provenance` 作为数据返回,而不再只在散文里描述;`verdictB` 在裁断之前调用 `admitAsEvidence`。处置不是 `admitted` 时,核验被**扣下**,由 core 自己的 `requireExternalAnchor` 产生弃权。core 门禁仍是唯一的裁断来源,结局是对主张的 HOLD 而不是一个关于它的发现,证据串则点名策略代码与理由。

**提交点需要的领域词汇。** `src/domain/` 另外新增:`ids.ts`(branded 身份,版本与 id 分开)、`artifact.ts`(`ArtifactRef` 三元组、规范化 JSON 内容哈希、产物信封及其入口解析器)、`task.ts`(attempt、lease、预算、执行 receipt,以及 lease 与 attempt 的交叉检查)、`quality.ts`(绑定到目标引用与输入摘要的 `GateReport`,外加 `aggregateDisposition` 与 `reportAnswers`)、以及 `project.ts`(项目头部与 revision 计数器)。入口解析器只**拒绝**,不做强制转换:未知 `schemaVersion`、缺内容哈希、无法解析的引用,以及解析到**不同内容**的引用。

## 明确没有覆盖的

**没有 `Decision` 对象。** 审查的领域模型里有它,但目前没有消费者。一个没有读者的类型,是对设计的声明,而不是设计的一部分。

**B 通道没有生产级来源。** 在 `production` 下,今天的 B 通道会把每一次运行都扣在 A1。这是能力缺口的正确暴露,不是 bug —— 但它意味着 `pending` 这条路径(找到了真记录、全文未读)今晚只在策略层被检验过。给 B 一条真实证据图的文献工作,才会端到端地检验它。

**`simulation` 被接纳为生产证据**,依据是审查自己的区分("simulation 可以是合法科研结果")。目前还没有东西检查一个 `simulation` 产物的产出规则版本是否就是方法所具名的那个;那属于"方法—结果一致性"的工作。

## Alternatives considered

**默认 `production`,让安全的那一面成为隐含值。** 在权衡过默认值**实际**保护什么之后拒绝。以 `production` 为默认,每一个既有测试与出货 bundle 都必须声明 `evaluation` 才能继续跑 —— 一个大 diff,却不改变任何结局,因为按最终选择,可投稿性本来就默认是 `false`。要紧的性质是"未声明的运行无法被发表",而默认 `evaluation` 守住了它,同时让 diff 保持诚实。

**把 mock 改名,让它看起来不像 mock。** 直接拒绝:审查把这条点名为"不改任何东西而过关"的路子,而且标注从来不是缺陷所在。缺陷是**标注没有决定任何事**。

**把 profile 做成请求字段。** 拒绝:`runPipeline` 是暴露出去的 Remote 方法,浏览器不该能把自己的运行提拔成生产。

**把锚定为 `blocked` 而不是扣下它。** 拒绝:`blocked` 的含义是"证据可用且反对该主张"。不可用的锚说的是"我们无法裁断",把它报成矛盾,正是 C 门禁被修掉的那同一种范畴错误。

**把 provenance 放到引用链自己的 `VerificationResult` 上。** 拒绝:引用链报告的是它核验了什么,而 provenance 是**组装输入的那个人**的声明。让组装者声明它,才能让两者不被混淆。

## Consequences

- B 通道再也不能在生产运行里靠一个合成锚通过;而通过了的评估运行会在它自己的 manifest 里说明这一点。
- `packages/research` 在 89 个文件上 **1617 通过**,其中包含 `production-evidence-policy.spec.ts`(B 门禁上 production/evaluation 的分歧)、五个 `tests/domain/` spec(入口拒绝)、以及 `evidence-profile.spec.ts`(配置校验)。
- 一个今天就在跑的生产部署会在 A1 停下,`gate_abstained`,理由点名证据类别。那是运行在报告能力缺口,而不是在报成功。
- core 的包入口多出一个 `domain` 面。它的模块不 import `engine/` 里的任何东西,而 `engine/commit.ts` import `domain/`,所以方向是单向的。
