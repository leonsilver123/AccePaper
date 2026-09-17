# Agent Note: 指标只声明一次,而一次运行冻结它所依据的画像

Status: implemented

[English](2026-09-17-a-metric-is-declared-once-and-a-run-freezes-its-profile.md) | 中文

## 问题

流水线早就能报出一个数、并说出它往哪个方向动了。它说不出的是:这个数**是什么意思**,以及产出它的研究是在哪套配置下进行的 —— 而紧接着在它之前写出的论文质量基线,正好从论文这一侧同时发现了这两个缺口。

1. **指标的方向以散文形式活在记录里。** `baseline-results` 带着
   `metric: { name: <key>, direction: 'higher is better' }`。key 是真的登记表键;direction 是产物生产者写下的英文短语,而它身上唯一的检查是一次子串匹配(`/higher/iu`)。同一个量在它被**测量**的地方也有一个方向(`MEASURED_METRIC.direction`,枚举 `higher-is-better`),于是部署里存在同一条指标的两份声明,却没有任何规则把它们绑在一起 —— 而且没有任何地方说过一条指标的单位,或它究竟属于哪些研究类型。

2. **没有任何东西陈述这项研究是什么。** 只有一项出货研究时这不可见;一旦存在第二种研究类型,它就是配置的全部。一次运行可以是仿真研究,也可以是已发表工作的综述;可以写给这家期刊,也可以写给另一家;`min-ttc-seconds` 可以被要求,也可以根本不属于它 —— 而这些既不是一个字段,也不是一条记录,更不是一条拒绝。可达的失效是:研究在一套配置下进行、却在另一套配置下被评判 —— 这与「冻结的计划」早已为研究主题挡下的,是同一个缺陷。

两者都属于 `project-plan/architecture-review-2026-09-15/PLUGIN-PAPER-QUALITY-PLAN-TRC-2026-09-17.md` 的 Q01:论文产出所依据的配置,必须先成为一个被声明、被检查、被冻结的东西,写作、论证与排版的工作才谈得上建立在它之上。

## 决定

- **`runner/metrics.ts` 把每条指标声明一次。** `MetricDefinition` 写明 key、单位、哪个方向更好、一次变化意味着什么(一句话),以及它属于哪些研究类型。`checkMetricDeclaration` 对每处不一致返回一条拒绝 —— `metric-unknown`、`metric-unit-mismatch`、`metric-direction-mismatch` —— 并把两侧都写出来;单位只**比较**、从不换算:用毫秒报告该指标的研究,测的是一个与部署里其他任何东西都无法比较的量。
- **这条拒绝是生产拒绝,发生在运行的起点。** `requireMetricDeclaration` 在 `driveOptions` 里被调用 —— 那是 `startRun` 与 `runPipeline` 共同解析配置的唯一地方 —— 于是声明漂移过的研究在运行存在之前就被拒绝。这个检查**从部署可达**,而不只从它自己的 spec 可达:把 `MEASURED_METRIC.unit` 改成 `ms`,会让 `tests/start-run.spec.ts` 里二十四个测试带着那条拒绝失败,接线就是这样核对的。
- **`metricsFor(type)` 把 required 与 not-applicable 分开**,包清单以 `declaredMetrics` 承载结果:逐条给出指标的 key、单位、方向、含义,以及运行自己的类型是否要求它。它是从运行冻结的 spec 里**读出来**的,绝不在导出时现查,因此部署被重新配置之后导出的包,描述的仍是它所含的那项研究。没有记录画像的运行就说没有,而不是被塞进一个默认值。
- **`runner/research-profile.ts` 是一次运行所依据的配置。** 研究**类型**(`simulation-study` | `literature-review`)与**期刊**画像是两件不同的事 —— 交通指标不是规则,字数上限也不是研究类型。**没人读过的规则不算规则**:每条 `JournalRule` 都带着它读自何处(`source`),没有 source 的会被 `resolveResearchProfile` 拒绝。因此 `TRC_PROFILE` 一条规则都不带,因为这家期刊的作者指南从未取得;未核验的规格连同各自的状态列在 `project-plan/architecture-review-2026-09-15/TRC-PROFILE-SPEC-CHECKLIST-2026-09-17.md`。
- **解析发生在起点,结果被冻结。** 未知的研究类型在运行开始时就被拒绝,而不是在恰好读到它的那一步;`runSpecOf` 把解析出的画像写进运行的 spec。`hostResearchProfile()` 读的是部署 —— 绝不是请求字段,因为 `runPipeline` 从浏览器可达,而调用者不得改变自己的稿件按哪套指标评判。

## 考虑过的其他做法

- **在读取该指标的那一步才检查声明。** 拒绝:这是部署事实,在 B3 才失败会让一次已经花掉若干步、留下产物的运行停在那里,而部署是从一项跑到一半的研究里得知自己配错了。
- **笼统地拒绝未登记的指标,并接受任何由研究自己声明的新指标。** 这正是本次改动之前的样子,也正是登记表要替换掉的安排:当研究自己的字段是「这条指标是什么意思」的唯一陈述时,一个漂移过的方向没有任何东西可以对照。因此来自另一个领域的研究必须声明它的指标 —— 那是计划里领域适配器的位置 —— 而不是让流水线默默采纳它的含义。
- **在每一个需要它的步骤里各解析一次画像。** 拒绝:部署可以在研究进行中被重新配置,那会让稿件在跑到一半时换一套评判指标,并让运行自己的记录同时描述两套配置。
- **给 `TRC_PROFILE` 填上看样子像那么回事的期刊要求。** 拒绝:作者指南从未取得,于是每条规则都会成为施加在每份稿件上的猜测,而在下游与「有人读过的规则」无法区分。空列表才是诚实的状态。
- **让包里的 `declaredMetrics` 在导出时现查画像。** 拒绝:它描述的会是重新配置后的部署,而不是包里那项研究,而正是「冻结的 spec」让这个差别可观测。

## 后果

- **指标检查从部署这一侧真的会触发,这一点由反证核对过**:把 `MEASURED_METRIC.unit` 改成 `ms`,`tests/start-run.spec.ts` 里二十四个测试会带着 `[metric-unit-mismatch] 'min-ttc-seconds' is declared in 'ms' and this deployment defines it in 's'` 失败,改回来则整套回到全绿。
- **没有任何东西在写句子时读指标的含义。** 质量基线的方向词那一支读的是测量的符号;只有褒贬那一支(「an improvement」)读方向,而出货运行的文字不含褒贬词。于是「一个取决于指标含义的判定」还没有端到端被走到过 —— 这是记录下来的事实,而不是「应当能工作」的暗示。
- **只实现了一种研究类型。** `literature-review` 能解析、带着 `citation-coverage`、并被冻结进运行的 spec —— 而没有任何流水线步骤在它之下行为不同:16 步、实验与稿件仍按仿真研究跑。因此它的 required/not-applicable 之分是关于一份配置的事实,还不是关于一次运行的事实。
- **两个 `pipeline_only` 步骤仍是仅夹具级**(`ARCH-BLOCK-01`),本次工作没有改变这一点。
- **期刊画像没有任何规则。** 任何「符合 TRC 要求」的说法,都是关于一份没人读过的文档的断言。

## 文件

- `packages/research/dsh-research-team/src/runner/metrics.ts`(新增)、
  `runner/research-profile.ts`(新增)、`runner/drive.ts`(`runSpecOf` 冻结画像)、
  `runner/types.ts`(`DriveOptions.researchProfile`)、`index.ts`(`hostResearchProfile`、
  `driveOptions` 承载画像与指标检查、`runPipeline` 改读共享解析而不是自己再列一遍)、
  `runner/package-export.ts`(`declaredMetrics`)。
- 测试:`tests/metrics.spec.ts`、`tests/research-profile.spec.ts`、`tests/start-run.spec.ts`
  (冻结的画像、它的拒绝、以及移不动它的重新配置)、`tests/package-export.spec.ts`
  (包声明的指标、两种类型、以及没有画像时说没有)。
