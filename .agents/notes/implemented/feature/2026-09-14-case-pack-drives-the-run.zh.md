# Agent Note: Case Pack 驱动运行;当自己的证据反驳它时,运行停下

Status: implemented

[English](2026-09-14-case-pack-drives-the-run.md) | 中文

## 问题

`plan/overnight/2026-09-09/case-pack-traffic/` 里有七个带版本的 JSON 文件,描述一个交通研究案例:研究问题、中心 claim、确定性实验的配置与数据行、消融与边界配置、引文台账,以及一份可复现性清单。**仓库里没有任何东西读它们。** 一次运行由 `domain-direction` 加上编译进执行器注册表的常量驱动,于是流水线的 claim 是在 `a2Executor` 里现造的,而不是取自它号称正在运行的那个案例。

路上还挡着两个缺陷,都是**跑出来的、不是读出来的**:

- `setRunInput` 只接受 core `SEEDABLE_INPUTS` 白名单上的 slug,而那个白名单只有一项。播种一个来自 Case Pack 的 slug 会让运行以 `DSH_INPUT_NOT_SEEDABLE` 失败。
- 步骤输入读取器把 `getInput(slug)` 解析成只有 `getArtifact(...)`。于是 run 级种子输入对**声明了它的那个步骤**不可见 —— Case Pack 到达了 `setRunInput`,而下游谁都看不见它。runner 自己的词汇里早就区分了两种来源(`InputSource = 'run-seed' | 'upstream-artifact'`),而读取器只查了其中一种。

## 决定

一个**带版本的 loader**(`dsh-research-team/src/runner/case-pack.ts`)全读或全不读:缺文件、JSON 畸形、provenance 信封不完整,或 `schemaVersion` 不是 `case-pack-traffic.v1`,一律以稳定的错误码拒绝加载。loader 不读的键原样保留,因此内容更丰富的 pack 不会丢东西。

它派生的是 **run 输入**,不是注入结果:问题、claim、场景参数,以及实验/消融/边界/引文四个文件,各自作为独立输入传递,每个值都带上它来自的 `file#pointer`。core 里的 `CASE_PACK_SEED_INPUTS` 把 slug 定义在守护它们的白名单旁边;一个 spec 断言 loader 声明的每个 slug 都被引擎接受,于是两处不会静默漂移。

**pack 的目录是部署设置**,由 `ResearchEngine` 的 `casePackDirectory` 承载、由 runner 侧服务读取。它刻意**不是**请求字段:`runPipeline` 作为 Remote 方法暴露,客户端提供的路径等于让浏览器指定文件系统位置。引擎只承载这个值 —— loader 住在 `dsh-research-team`,因为依赖单向 `core` ← `tools` ← {`cordis`, `team`},`cordis` 不能反向伸手。

`a2Executor` 现在**优先取 pack 的 claim**而不是模型。pack 是这次运行启动时依据的东西;用模型再派生一个不同的 claim,会让运行的产物与它自己的输入集相矛盾。产物记录三种来源中的哪一种供给了它(`case-pack` / `model` / `fixture`)。

**provenance 按来源文件逐个读,而不是按 pack 整体。** 出货 pack 并不统一:`mock-experiment.json`、`ablation.json`、`boundary-counterexample.json` 是 `truthfulness: mock` + `provenance: synthetic_deterministic`,而问题与 claim 文件是 `direct_fixture`。loader 的第一版把 `case-pack.json` 的信封盖在每个派生值上,那等于把合成结果归因到错误的来源。一个 spec 把每个 slug 的标签钉在它自己的文件上。

## 真实 boot 上的结果

A1-landscape 通过。A2-claim 用 pack 的 claim **执行成功**、通过 A 通道,然后 **C 通道失败**:

```
C: outcome=failed (live experiment: measured 11.09% vs required 20%)
rationale: experiment (live) refutes the falsifiable prediction
```

这是系统在正常工作。pack 的 claim 承诺跟驰风险下降 **≥20%**;而本研究自己的实验 —— 在实测 UCI 需求画像上的 Webster 延误模型 —— 测到 **11.09%**。门禁拒绝通过一个被自身测量反驳的主张,运行就此停下,而不是带着一个无支撑的 claim 继续。

## 这暴露了什么,以及没有修什么

**出货 pack 与 runner 的实验是两个不同的研究。** pack 描述的是跟驰车队研究(TTC<1.5s 发生率、反应时延、车队构成);而流水线跑的实验测的是交叉口延误。pack 自身是自洽的 —— 它自己的 `mock-experiment.json` 显示 35.7% 的降幅并通过它自己的 `claimConsistency` 检查 —— 但那是 pack 生成器的测量,不是本研究的。

因此离线运行**无法**在这个 pack 上走到 E2,而且**不能**靠放松门禁来走到。下一个增量是让 pack 驱动的运行改为对 **pack 自己的数据行**做裁定 —— 从 `mock-experiment.json` 的测量**计算**出比较,并标注 `mock`/`synthetic_deterministic` —— 这样 claim 与测量就属于同一个研究。靠放松 C 通道走到 E2 不是一个选项,靠改 pack 的数字走到 E2 也不是:pack 的六个输入文件被 manifest 的 `hashOfInputs` 覆盖,而写它们的生成器不在这棵树里。

## 归属与边界

loader 拥有读取与标注;它不对运行做任何决定。`runT19B` 在第一个步骤之前播种交给它的东西,因为 `setRunInput` 拒绝一个已经在进行中的 run。`ResearchEngine` 承载部署对 pack 的选择;`ResearchTeamService` 读取并加载它。

`pack.assertedHashOfInputs` 被如实报告为**pack 自己的断言,从不被校验**。manifest 里点名的生成器(`case-pack-traffic.fixture-writer/v1`)不属于本仓库,而尝试过的任何方案都无法从文件字节复现该值。loader 记录它**实际**算出来的东西 —— 逐文件 SHA-256 —— 两者从不相混。

## 考虑过的替代方案

**把 pack 预先算好的结果当作步骤产物注入。** 否决:那会让一次运行变成对罐头数字的回放,执行器也不再是产出 artifact 的那个东西。

**让客户端指定 pack 目录。** 否决:`runPipeline` 是 Remote 方法,那等于把一个路径穿越面交给浏览器。

**把缺失的 `essentialDifference` 字段写进 pack。** 否决:pack 的六个输入文件被它自己的 manifest 哈希覆盖,而生成器不在场,改动它们就是伪造 fixture 数据。loader 改为从 pack 自己的 `baselineConfig.controller` 与 `mockExperimentConfig.adaptiveController` 复述它,并记录两个指针。

**放松 C 门禁让 pack 的 claim 通过。** 直接否决 —— 那正是本子系统存在的意义所要阻止的事。

## 后果

- 一次运行可由**选中的、带版本的**输入集复现,且 pack 参数的变化会到达运行:一个 spec 断言改动问题会改变派生输入。
- 不完整的 pack 会让运行**响亮停下**(`CASE_PACK_DATUM_MISSING`),而不是带着 claim 上的一个洞继续。
- 离线运行目前在 A2 结束,原因是**科学性的**而不是基础设施性的。在"pack 驱动的运行改以 pack 自己的实验为裁定依据"落地之前,这就是正确的停止点。
