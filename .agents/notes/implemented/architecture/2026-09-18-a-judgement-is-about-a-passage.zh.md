# Agent Note: 判断是关于某一段落落的,而三条轴一直在替彼此表态

Status: implemented

[English](2026-09-18-a-judgement-is-about-a-passage.md) | 中文

## 问题

本流水线证据处理的复核要求把四件事分开建模 —— 来源来自哪里、怎么获得的、受过什么审查、判断是关于哪些字 —— 而这四件事没有一件作为字段存在过。每一件都在被另一件推断:

- **「检入仓库」被读成了「已验证」。** `CorpusSource` 记了 `sourceAccess` 和一段自由文本 `note`,说明摘录是手工取回的,却没有任何地方记下「手工取回」是一种**获得**来源的方式,而不是关于来源的陈述。这个推断反向也成立:从正在运行的文献库读到的来源被默认为较不可信的一类,而一条目录记录和一段检入摘录都是 `literature`,两者都没有被核实过。
- **审查被挂在 DOI 上。** `SupportAssessment` 用 `sourceDoi` 指认来源、用 `claimRefHash` 指认主张,于是判断被正确地绑定在主张**版本**上,却被绑定在一**篇作品**上,而不是它实际据以作出的那些字上。改掉一段摘录,关于它的每条判断都照样成立;一篇有两个附件或两段引文的作品,只有一条审查却替两者说话。
- **没有任何地方记下证据在来源里的位置。** `SourceRecord.locator` 装的是来源自己陈述的卷期页码;审查者读的是哪里是另一件事,而它哪儿也没记。引文无法对照某个位置去核对。

指引点名参与失效的三件事 —— 来源自己的版本、附件的版本、内容的哈希 —— 没有一个统一的记录可住,也没有一次比较用到它们。

## 决定

- **三条轴,每条只陈述自己。** `SourceRegistry`(`zotero` | `curated`)、`SourceAcquisition`(`live-library-read` | `retrieved-then-checked-in`)与 `ReviewStatus`(`unreviewed` | `human-reviewed`)加入 `Provenance` 上的 `sourceClass` 与 `sourceAccess`,而 `admitAsEvidence` 一条都不读。用例断言:同样的类别与访问级别,来自哪个登记处都同样准入;审查移动不了任何东西;也没有哪条轴能救活一个本就不能承载门禁的类别 —— 这些轴不能成为准入的后门。
- **一条绑定记录,而不是六个对象上的六个字段。** `EvidenceBinding` 装着登记处的身份、来源版本、附件及其版本、定位符、内容哈希、获取路线与规则版本。散落在「碰巧携带它们的那些对象」上的六个事实,是读者合不起来、比较也没有义务去用的六个事实。
- **身份是登记处的,绝不是 DOI。** DOI 命名的是一篇作品;一篇作品有多个附件、多段引文、多次阅读,而一次审查是其中一次的。策展语料选择用 DOI 做自己的键 —— 那是**这个语料**的事实,写在它自己的身份串 `curated:<doi>` 里 —— 而一个用 item key 的登记处铸造的是 `zotero:<库>:<键>`。
- **每条轴都参与失效,且互不蕴含。** `evidenceStalenessOf` 比较全部六项并报告**是哪几项**动了,于是「来源被编辑」和「文件被替换」是两个不同的答案。指引明说附件变更不一定推动父条目,所以只盯来源记录的检查什么都看不见。
- **审查带着它作出时的那条绑定,而且是字面量。** `SupportAssessment.evidence` 是写出来的,不是读的时候查出来的。从当前语料条目现算,会让每条判断按构造就是最新的 —— 那正是这个字段要终结的状态。
- **证据动过的判断会被丢掉,并被点名。** `assessmentsFor` 只返回仍然成立的判断;`staleAssessmentsFor` 说明哪条被丢以及什么动了。丢掉而不是改指,正是要点:改指会把一次审查带到没人读过的段落上。一次运行如果唯一的锚因此掉出,它就没有锚,而这是正确的结局 —— 在有人读过当前文本之前,这条主张没有支撑。
- **语料不再持有的来源不是陈旧。** 它不可比较,于是那条判断既不被丢掉、也不被报成变更,因为把它报成变更会让读者去重读一个并不在那里的来源。

## Alternatives considered

- **按 DOI 绑定证据,接受多段引文共用一次审查。** 拒绝:那正是指引点名的覆盖,而且它静默失败 —— 第二段引文继承了一个没人给过它的批准。
- **每次读取都从语料重算判断的绑定。** 拒绝:它永远检测不出变更,因为它把当前状态定义成了判断自己的状态。这个检查会永远通过,而这个字段看起来像个保证。
- **判断陈旧时让 `assessmentsFor` 抛错。** 拒绝:陈旧判断是关于发生过什么的数据,而一次丢了锚的运行需要报告这件事而不是崩溃。B 通道本来就把缺锚当作 hold。
- **把这几条轴加进 `admitAsEvidence`,让受过审查的来源排得更高。** 拒绝:它们不是等级。审查是关于具体内容的陈述,所以它作为一条绑定随行;让它提升来源,等于让一段受审的引文给整篇作品背书。

## Consequences

- **`tests/domain/evidence-binding.spec.ts`**(新增,10 条)守着这个分离:三套词汇的识别、与登记处无关且与审查无关的准入、每条轴单独移动、增减附件算同一条轴的移动、以及身份变化被报成另一个来源而不是陈旧阅读。
- **`tests/reviewed-evidence.spec.ts`** 增加四条:每条已有判断当前都与语料一致 —— 于是改掉一段摘录会让测试失败,而不是静默继承一次审查;哈希动过的判断被丢掉且只点名 `content`;语料不再持有的来源是不可比较而不是陈旧;同一 DOI 的两段引文由定位符分开,而不是由旁边的散文分开。
- **`corpusProvenance` 现在发布全部三条轴**,于是交付的产物会说它的证据来自哪里、本次运行没有重新抓取、以及存在一次人工审查 —— 三句彼此独立的话,没有一句是可信度等级。
- **这里没有做到的。** 还没有真实文献库来源被登记进引用登记处:`reviewedSources()` 仍然只读检入语料,所以一个从 Zotero 读到的来源可以出现在运行的台账里,却还不能被引用。接上那一步登记、以及由同一批引用得出的 `.bib` 导出,是下一个单元 —— 在它落地之前,「句子、引用与书目共用一个身份」在任何地方都还不能端到端断言。

## Files

- `packages/research/dsh-research-core/src/domain/evidence-binding.ts`(新增) —— 三条轴、`EvidenceBinding`、`EvidenceAxis`、`EvidenceStaleness`、`evidenceStalenessOf`。
- `packages/research/dsh-research-core/src/domain/provenance.ts` —— 三个可选轴,并在文件头写明 `admitAsEvidence` 一条都不读。
- `packages/research/dsh-research-core/src/index.ts` —— 两者都再导出。
- `packages/research/dsh-research-team/src/runner/evidence-corpus.ts` —— 每条判断冻结的 `SupportAssessment.evidence`、`corpusBindingOf`、`assessmentStalenessOf`、`currentAssessments`、`staleAmong`,以及 `corpusProvenance` 上的三条来源轴。
- 用例:`packages/research/dsh-research-core/tests/domain/evidence-binding.spec.ts`(新增)、`packages/research/dsh-research-team/tests/reviewed-evidence.spec.ts`。
