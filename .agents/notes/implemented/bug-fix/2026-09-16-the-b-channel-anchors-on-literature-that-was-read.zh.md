# Agent Note: The B channel anchors on literature that was read

Status: implemented

[English](2026-09-16-the-b-channel-anchors-on-literature-that-was-read.md) | 中文

## Problem

B 通道判定一条主张是否锚在外部证据上。它的链条是真的:`verifyCitation` 跑身份校验、红线、撤稿规则;core 的 `adjudicate('B')` 从结论决定门禁。**来源**不是。每一条锚定验证都来自 `MockCitationResolverAdapter`,表里只有一条记录,键是 `doi:10.0000/synthetic.t19b-anchor`,`sourceUrl: mock://anchor/t19b/${stepId}`,`contentHash: 'deadbeef00'`。

没有任何东西藏它 —— 模块自己的 basis 串写着 `mock_external` —— 也没有任何东西依据它行动。`production` 拒掉那个锚的 `fixture` 类别、步骤弃审,这是对的,也正是**任何 production 运行都到不了真实的 B 通过**的原因,更不必说第一次真实闭环。bundle 的配置把这件事写在注释里:"真实检索旁边立着一个有标签的合成锚,是当前状态,不是完成状态"。

复核的 R1 要的是把这个缺口关掉的最小东西:少量**真实**的来源片段、**人工复核过的** Claim 支持关系、一条真实 B 通过、一条不支持 B 拒绝 —— 明确**不**包括一个文献搜索平台。

## Decision

`runner/evidence-corpus.ts` 存取回的材料:三篇真实文献,每篇带着 DOI 与目录里的规范标题、作者,来源**自己**的访问级别,文本读自哪里、何时读的,评审者读过的**原文段落**,覆盖该段落的 SHA-256,以及(两篇以作者预印本读的)一条说明此事的注记。`SUPPORT_ASSESSMENTS` 存每条来源一条复核过的判定:它针对的**主张句子**及其哈希、结论、评审者、日期、理由,以及这条来源**没有**确立什么。

`runner/evidence-anchors.ts` 用它建锚。它跑与合成路径同一条 core `verifyCitation`,以评审者的结论作为 claimed conclusion,并发布 `sourceClass: 'literature'` 与来源**自己**的 `sourceAccess`。当语料库持有该运行主张句子的判定时 `verdictB` 用它,否则回落到 T23 fixture;门禁、profile、`requireExternalAnchor` 一律未改,所以弃审、阻断、通过三条路仍然是 core 的。

复核要的三个结果钉在 `tests/reviewed-evidence.spec.ts`:

- **一条真实 B 通过。** production 下 A1 的 B 门返回 `passed`、`anchoring=true`,锚是 `10.1109/tits.2026.3727135`。一次 production 运行现在能跑完十五步,停在 `E2-submit`。
- **一条不支持 B 拒绝。** 指向被判定为 `does_not_support` 的来源时,门返回 `blocked`,`EXTERNAL_CONTRADICTION` —— 出自真实材料,不是 fixture 行。
- **读不到全篇的来源被**扣住。只有摘要可读的那条来源产出 `pending`(`DSH_EVIDENCE_PENDING_SOURCE_ACCESS`):任何能投稿的 profile 都不接纳它,于是该步弃审。README 曾把 `pending` 记为**端到端不可达**,现在可达了。

同一个决定还带来两处配套。`BChannelAnchors` 拆成 `BChannelEvidence`(门禁消费的部分:verifications、anchoring、provenance、basis)与 `BChannelAnchors`(再加 T23 信号),因为语料库路径**没有** T23 信号,为了装下评审者的结论而造一个,会把一份判断呈现成一次查表。`VERDICT_CHANNELS.B.kind` 从 `mock_external` 改成 `live_external` —— 那是报告的读者看到的东西。

## Alternatives considered

**运行时从 OpenAlex 实时抓取。** 这次改动里拒绝,理由是复核自己的话("无需先做完整文献搜索平台");对 B 通道而言理由还包括:一个在门禁时刻依赖网络调用的锚,会让门的结论取决于第三方有没有应答。材料取回一次、记录下来;关于这件事的诚实描述就是 provenance 里写的那些,而"实时检索加缓存"属于写作通道 —— 那里的语料更宽,而且什么都不裁断。

**出厂路径保留合成锚,把语料库只当测试 fixture。** 拒绝:出厂路径仍然到不了真实的 B 通过,而那正是整个发现。它覆盖的 claim 版本默认就走语料库。

**把所有被评估的来源都交给门,包括不支持主张的那些。** 拒绝,而这是最可能被重新讨论的一个决定。`adjudicateB` 会因为一条外部矛盾阻断,而且它**压过**支持性锚,所以把两者都交上去会阻断每一步、终止运行。一条反向来源是否**驳倒**主张是一个阈值问题,阈值住在 C 通道的 commitment 里 —— B 门自己发明一个,就是这个系统为了显得严谨而编规则。所以反向来源被**写在判定上**(`... NOT handed to the gate: ...`),问题留着,缺口记成一条限制,而不是用一条没人同意过的规则关掉。

**要求每个 claim 都必须有语料库,没有复核证据的运行一律拒绝。** 拒绝:那会让演示 profile 对任何别的研究都不可用,而回落路径本来就是诚实的 —— fixture 路径声明自己,production 拒它。

**加一个 `confidence` 字段,让评审者能记"我没法核对"。** 目前拒绝。这个字段在这里只有一种诚实用法 —— 一条从摘要读出、其条件无从核对的 `does_not_support` —— 而访问级别已经替策略承载了这个事实。它多出来的是一种**压制某条读取**的能力,而现在没有任何东西为它辩护。`scope` 字段把保留意见记成散文;下游不依据它行动这件事,已写成一条限制。

## Consequences

- `packages/research` **1700 passed / 95 files**;`tsc -b tsconfig.host.json` 干净。
- 三条 spec 因为它们钉的是旧来源而改动,每一条都改写成新的事实而不是放宽:`e2e/happy-path-t19b.spec.ts` 现在按 DOI 断言语料库锚、并断言判定上写着反向来源;`runner-registry.spec.ts` 不再断言"没有通道是 `live_external`"(B 就是),改为断言哪两个通道是 `local_computation`、以及 B 的 basis 必须具名什么;`production-evidence-policy.spec.ts` 通过给它的运行一句语料库里没有的主张句子,变成**回落路径**的 spec。
- `package-export.spec.ts` 多了一条用例,因为原来的那条已经不是在讲被阻断的运行:有了真实锚,一次 production 运行会走到人工门,于是"合格但不就绪"现在被钉了两次 —— 一次是停在第一步的运行,一次是产出了手稿、在等人批准的运行。
- **一次 production 运行现在停在 `E2-submit`,不是停在 `A1`。** manifest 报 `profileEligible: true`、`submissionReady: false`,理由具名那道未批准的门。这是这条流水线第一次把一个主张从检索带到手稿,而所依据的证据是**存在的** —— 它就是 R2 需要的输入。
- `packages/bundle/research-app/cordis.patch.yml` 保持 `evidenceProfile: evaluation`,注释现在说明这是一次**选择**而不是后果:把出厂 bundle 移到 `production` 属于发布门,不属于这一行。
- **语料库是代码。** 一条来源被撤稿或被取代,运行不会知道,而 `retracted` 是评审者设的值、不是运行去查的东西。周期性重取、比对哈希、在片段变化时拒绝,属于写作通道的文献工作。
- **片段哈希盖的是存下来的那个字符串。** 它能检出对引文的修改;它检不出这段引文从来不在来源里 —— 那是取回记录的职责。
