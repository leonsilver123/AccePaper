# Agent Note: 一套来源同时回答两个引用问题,而一次发布保留它替换掉的那条产出链

Status: implemented

[English](2026-09-20-one-source-set-and-a-publication-that-keeps-its-producer.md) | 中文

## Problem

两个缺陷,都出自针对 `2a8ab4d1` 的框架复核,而且属于同一类:一个检查的输入为空,而该检查把这种空读成了"通过"。

**判定一条主张是否有外部锚定的那道关卡,和写作者可引用名册,是两个不同的集合。** `verdictB` 从 `assessmentsFor(claimRef)`——编译进来的证据语料——构造锚,而 `d3Executor` 从 `judgementsFor(claimRef, ctx.sources)` 构造写作者的名册:后者读同一份语料,然后把每条评估的来源**到本次运行配置的来源映射里查一遍**。`sourcesForMode` 用 `registration.identity`(`zotero:<type>:<library>:<itemKey>`,永远不是 DOI)作键登记来源,而 `judgementsFor` 用 `assessment.sourceDoi` 去查。两个集合只在 `ctx.sources` 恰好持有语料自己那三个 DOI 时一致,而那只在 `sourceRegistryMode` 为 `'curated'` 时成立——只要部署点名了 `sourceLibrary`,`dsh-research-cordis` 就默认 `'zotero'`。实测:当一条登记的 `ref` 正是语料中某篇被评审来源的 DOI 时,`buildEvidenceAnchors` 返回 `anchoring=true, provenance=literature`,而 `judgementsFor` 返回 **0** 条判断。于是一个点名了文献库的部署,在编译语料上通过了每一道锚定关卡,写出一篇什么都不引用的稿子,并且可以把它当作期刊收到的那份包导出:一篇没有文献的论文——正是引用层存在的意义所要防的那个缺陷,符号反了过来。下游没有任何检查看得见它:`checkManuscriptCitations` 在正文不引用且参考文献列表为空时两个循环都不跑,两个空集相等,而 `FinalPackageCheckCode` 里没有任何一条问过这篇论文引没引东西。

**一个被发布过的 slug 再也不能满足任何步骤输入。** `isInputSatisfied` 要求注册表某条记录的 `producerStepId` 指向 `run.steps` 中状态为 `passed`、且 `attempt_id` 等于该记录 `producerAttemptId` 的步骤。而 `publishArtifactVersion` 写的是 `producerStepId: request.producer` 与 `producerAttemptId: 0`,`acceptManuscriptCandidate` 写的是 `ACCEPTANCE_PRODUCER` 与 `0`。没有任何步骤叫 `manuscript-import`、`materialize-manuscript` 或 `human-acceptance`,而 `0` 从来不是活的 attempt id,所以在一次导入、一次接受或一次修复之后,`canStart('D4-rebuttal')` 与 `canStart('E1-format')` 在这次运行的余生里都是 false。`rollback` 帮不上忙——`invalidateArtifactsFor` 只动产出者与 attempt 都和回滚步骤匹配的记录——于是唯一的恢复路径是回滚到 `D3-writing` 再重新提交一次,而那会覆盖掉人的编辑。更糟的是,专门为说出这个原因而写的诊断说不出来:`startabilityOf` 用 `resolveStepInput(...) === undefined` 过滤 `stepDef.inputs`,而被发布过的值是可以解析出来的,所以缺失列表为空,操作者被告知该步骤"在驱动看来可以启动"——正是 `startabilityOf` 当初要消除的那句误导。

## Decision

**登记来的来源,用它自己声明的 DOI 去引用、去判断。** 新增的 `citationIdOf`(在 `runner/citation-bindings.ts`)在 ref 是 DOI 时返回 `registration.ref.id`,否则返回 `registration.identity`;`sourceRecordOf` 用它作 `SourceRecord.id`。链上其余每一端本来就用 DOI 作键——`judgementsFor` 按 `assessment.sourceDoi` 找评估,`citeKeyOf` 用它铸写作者的标记,`bibliographyOf` 用它解析引用——所以一个键就让两个问题共用一套来源,`combined` 也从两套变成一套。注册表自己的 identity 没有丢:它是该来源 `EvidenceBinding.sourceIdentity` 的键,而部署的附件读取器正是按它解析的,规范里也断言了它还在。ref 不是 DOI 的登记保留 identity,因为这次运行里没有别的东西用 ISBN 或 arXiv id 作键。

**主张持有被评审证据、而注册表交不出任何可引用来源的运行,在 `prepareRun` 被拒。** `citableSourceRefusal(claimRef, sources)` 陈述该条件,`drive.ts` 在创建运行之前抛出它——那正是配置注册表的人还在的地方,而不是 D3:在那里写作者拿到的是一张空名单。**这个条件比"名册为空"更窄,这是刻意的**:一条根本没有被评审过评估的主张,是语料对它什么都没说的主张,B 通道自己会报告这一点(生产档下它弃权、运行挂起),而在这里拒绝它会连本仓库随附的、不是那条编译主张的每一项研究一起拒掉——包括 `second-study-run.spec.ts` 一路驱到人工门的第二项研究。被拒的是那种状态:锚定关卡会在语料上通过,而写作者一条都引不了。

**运行持有来源、而稿子什么都不引用时,在最终包处拒收,并由质量基线报告。** `FinalPackageCheckCode` 新增 `manuscript-cites-sources`,读一个新事实 `ManuscriptFacts.citations` = `{ made, held }`。`made` 数稿子各节实际携带的互异标记数;`held` 取"运行自己的 `proseRequests` 提供给写作者的 cite key 数"与 `assessmentsFor(claimRef).length`——语料为这条主张持有的被评审证据——两者中的较大者。这是唯一一条读引用**数量**而不是某条引用目标的条件,也是"无论成因为何都能抓到结果"的那一条——包括名册根本没到写作者手上这种集合比较看不见的状态。`paper-quality.ts` 的 `no-literature-position` 通过 `PaperQualityInput.sourcesHeld` 拿到同一事实:它过去要求 `referenceCount > 0`,而那正是这个缺陷抹掉的那一半,于是它把"没有参考文献表"读成"没有可引之物",恰恰对这个缺陷保持沉默。

**一次发布继承它替换掉的那条记录的 `producerStepId` 与 `producerAttemptId`,并把发布者记进新字段 `publishedBy`。** 流水线据以调度的依赖,是产出这次被替换的那个值的步骤;同一个 slug 下仍然是同一个产物。继承来的这一对正是 `canStart` 读的,所以一个人编辑过的 slug 仍然是其后步骤可以启动的输入。继承并不等于声称某个步骤写了这段文字:`publishedBy` 在读稿人所看的注册表记录上说明是谁发布的,`ArtifactRecordMeta.publishedBy` 让它穿过 `getRunSnapshot`,`ResearchArtifactMetaView.publishedBy` 让它到达面板,而发布自身的审计记录(`artifact-republished`、`manuscript-accepted`)记下发布者、依据,以及它替换掉的版本与哈希。`acceptManuscriptCandidate` 同样把 `ACCEPTANCE_PRODUCER` 记在那里,而快照读取器保留了它那两条对早期构建所写记录的宽容。

**`startabilityOf` 问的就是 `isInputSatisfied` 的问题。** core 新增 `unsatisfiedInputs(store, runId, stepId)`:与 `canStart` 判定所用同一个谓词,按输入逐个回答,原因是四者之一——`absent`、`invalidated`、`producer-not-passed`、`stale-attempt`——驱动把这些原因渲染出来,而不是声称一切看起来都正常。步骤的解释与引擎的决定再也不可能互相矛盾,因为它们本来就是同一个函数。

## Measured

- **键控分歧,改前与改后。** 在 `sourceRegistryMode: 'zotero'` 且某条登记的 `ref` 是语料中被评审来源的 DOI 时:改前 `judgementsFor` 返回 **0** 条判断,而 `buildEvidenceAnchors` 返回 `anchoring=true, provenance=literature`;改后 `judgementsFor` 在 cite key `cite-10.1109/tits.2026.3727135` 下返回语料的那条判断,带语料自己的 `support`、`judgedBy` 与段落。`tests/registered-sources.spec.ts` 断言两个方向,而把 `citationIdOf` 退回 `registration.identity` 会让该文件里五个用例、以及 `citation-bindings.spec.ts` 里一个用例失败。
- **发布链,改前与改后。** `tests/publication.spec.ts` 驱动一次运行:D3 已通过,`manuscript` 被 `manuscript-import` 发布覆盖。改前,那条记录写的是 `manuscript-import`、attempt `0`,`canStart('D4-rebuttal')` 为 false,`unsatisfiedInputs` 报 `producer-not-passed`;改后,记录写的是 `D3-writing` 及其自己的 attempt,`publishedBy` 是 `manuscript-import`,而 `D4-rebuttal` 与 `E1-format` 都可启动、没有未满足的输入。把继承改回去,该 describe 下三个用例全失败。
- **不引用即拒,改前与改后。** `tests/package-export.spec.ts` 驱动一次真实的 16 步运行,并在 `manuscript` 上发布同一份文档、去掉其中每一个 `[@cite-…]` 标记。包检查 `manuscript-cites-sources` 失败、manifest 状态为 `draft`;把该检查的条件强制为真,这个用例就失败。同一文件里那次真实运行(稿子是引用的)则通过它——该条件确实能区分"什么都不引"与"引了"。
- **驱动的解释,改前与改后。** `tests/e2e/recovery-t19b.spec.ts` 用一次门弃权把 `A1-landscape` 挂住(于是它的产物已提交、产出者状态是 `gated` 而非 `passed`),再驱动 `A2-claim`。改前,驱动说该步骤"在驱动看来可以启动";改后,它说 `'landscape-map' was produced by 'A1-landscape', which is 'gated' rather than 'passed'`。

## Alternatives considered

- **让 `verdictB` 接收 `ctx.sources`,使两个问题读同一张映射。** 作为较弱的一半被拒:不可达的那一端是登记本身,而一个去读运行文献库的 `verdictB` 仍然找不到语料评估对应的判断——那次运行于是连锚也没有了,这只是把引用缺陷换成 B 关卡弃权,把配置错误晚一步藏起来,而不是点出它。
- **同时用 identity 和 DOI 作键登记来源。** 拒:一篇作品两个键就是同一 DOI 两条参考文献条目,而 `checkCitationKeys` 只会在它们铸出来之后才以 `citation-duplicate-key` 拒掉。映射按链上其余部分解析的那一个名字作键。
- **照复核的写法,只要主张交不出可引用来源就在 `prepareRun` 拒。** 作为过宽被拒,且有实测:`LATENCY_PLAN`——本仓库随附的第二项研究,存在的意义就是"一次运行可以作为不是 platoon 研究的另一件事来跑"——产出 0 条评估、0 条判断,那种读法会在运行开始时拒掉它,连同 `second-study-run.spec.ts`。一条没有被评审过评估的主张不是配置错误的注册表,而是 B 通道自己会报告的主张。这里实现的条件,是复核实测到的那个分歧:存在被评审证据,却无法引用。
- **把"不引用即拒"按复核的措辞放进 `checkManuscriptCitations`("正文没有引用标记,且 `reviewedKeys` 非空")。** 拒,因为它恰好在需要它的地方是空洞的:那个调用点的 `reviewedKeys` 是 `revised.citations`——绑定——而在名册为空的那种结果里绑定同样是空的,于是这个守卫只在缺陷不存在时触发。绑定非空、正文无标记的稿子,在 E1 已经会通过 `citation-entry-uncited` 被拒。这条拒收需要名册,而名册是 `ctx.sources`,那个函数拿不到;加一个必填字段就意味着改动 `runner/registry.ts` 里的调用点,而那份文件在本改动写作期间被另一项改动占用着。
- **把发布记录的 `producerStepId` 写成该 slug "属于"的那个步骤。** 拒:slug 属于哪个步骤无法从 slug 得知,而一张 slug→步骤 的映射会是流水线依赖图的第二份拷贝。被替换的那条记录才是"这个值从哪来"的权威,继承它是精确的。
- **从 `isInputSatisfied` 的比较里去掉 `producerAttemptId`,让 attempt 0 的发布满足它。** 拒:那个比较正是阻止被取代 attempt 的产物满足重跑步骤的东西,削弱它会让陈旧产物在回滚后仍可读。
- **把 `publishedBy` 设为 `ArtifactRecord` 的必填字段。** 拒:被提交的产物没有发布者,所以 `undefined` 是事实而不是遗漏,必填会让早期构建写下的每一份快照都被拒。

## Consequences

- **一套来源现在同时回答锚定问题与引用问题**,这正是复核要的;代价是:DOI 恰为语料某个 DOI 的文献库登记会采用签入记录而不是库里的那份——既有的"登记永不覆盖 curated 记录"规则,作用在两者现在共享的那个键上。
- **`publishedBy` 可选且读取宽容。** `parseRegistry` 保留它对"`producerStepId` 不是步骤"的两条宽容,因为该格式会跨构建读取,去掉它们会让早期构建写下的研究无法读取;`RUN_SNAPSHOT_SCHEMA_VERSION` 不变,因为这个新增在两个方向上都可读,读取器不会拒绝它以前接受的任何东西。
- **回滚发布所继承的那个步骤,现在会使被发布的版本失效**,而改前不会动它。这是同一条链的另一面:记录说这个产物是哪个步骤的工作,撤回那个步骤就撤回它。另一种选择是本笔记所修的那个状态——没有任何步骤能启动,唯一的恢复路径会丢掉编辑。
- **What is not here**:没有任何东西判定一篇论文的引用选得对不对。`manuscript-cites-sources` 读一个数量,一篇只引一条来源却持有二十条来源的论文照样通过它——逐个来源的义务是 D3 的 `owedCiteKeys` 与 E1 的 `citation-*`,而这个条件之所以存在,是因为那些看不见空集这种情况。
- **What is not here**:因注册表不可引用而在 `prepareRun` 被拒的一次运行,不能靠恢复它救回来——拒发生在运行创建时,补救是部署配置。注册表变更时已经在途的运行不会被重新检查,因为来源是部署能力而不是运行被冻结的字段;对这样的运行,仍然成立的是包条件。
- **What is not here**:`dsh-research-web` 的面板给这个新条件起了名字,除此之外没有变化;客户端没有提供修复"什么都不引用的稿子"的控件,因为修复是写作者必须做的一次重写。

## Files

- `packages/research/dsh-research-team/src/runner/citation-bindings.ts` — `citationIdOf`、`SourceRecord.id`、`sourcesForMode` 的键控、`citableSourceRefusal`。
- `packages/research/dsh-research-team/src/runner/drive.ts` — `prepareRun` 的守卫;`startabilityOf` 与 `describeBlockedInput`。
- `packages/research/dsh-research-team/src/runner/final-package.ts` — `ManuscriptFacts.citations`、`citationFactsOf`、`manuscript-cites-sources` 条件。
- `packages/research/dsh-research-team/src/runner/paper-quality.ts` — `PaperQualityInput.sourcesHeld` 与放宽后的 `no-literature-position`。
- `packages/research/dsh-research-core/src/engine/publication.ts`、`acceptance.ts`、`types.ts`、`state-machine.ts`、`run-persistence.ts`、`index.ts` — 继承的产出链、`publishedBy`、`unsatisfiedInputs`。
- `packages/research/dsh-research-team/src/index.ts`、`src/types.ts` — `ResearchArtifactMetaView.publishedBy`。
- `packages/research/dsh-research-web/src/client/locales.ts`、`record-vocabulary.ts` — 新条件在两种语言里的名字。
- `packages/research/dsh-research-team/tests/registered-sources.spec.ts`、`final-package.spec.ts`、`paper-quality.spec.ts`、`package-export.spec.ts`、`e2e/recovery-t19b.spec.ts`、`start-run.spec.ts`、`packages/research/dsh-research-core/tests/publication.spec.ts`、`acceptance.spec.ts` — 上述用例。

## Testing

- `registered-sources.spec.ts`:文献库登记在语料 DOI 下携带语料的判断;空文献库不携带;`prepareRun` 拒掉交不出来的注册表,放行交得出来的。
- `publication.spec.ts`:发布继承产出链、记下 `publishedBy`、让 `D4-rebuttal` 与 `E1-format` 保持可启动且无未满足输入,并在第二次发布时继续继承。
- `final-package.spec.ts` 与 `paper-quality.spec.ts`:运行持有来源时该拒收触发,不持有时不触发;参考文献规则过去报 `not-applicable` 的地方现在报 `defect-found`。
- `package-export.spec.ts`:真实运行的包拒收一份标记被抹掉的稿子,而抹掉之前的那次运行通过。
- `e2e/recovery-t19b.spec.ts`:挂起步骤已提交的产物产出的消息点名产出者的状态,而不再声称该步骤看起来可启动。
- 以上每一项都在把修复改回去之后跑过,没有修复即失败;`vitest run packages/research` 为 168 个文件、2611 个用例、零失败,两个 `tsc -b` face 都退出 0。
