# Golden Set 框架骨架(S5,2026-09-08)— schema / guidelines / scorer 契约

> **仅搭建评估框架,不伪造专家标注,不声称科研验证完成。**
> 所有样例标记 `synthetic_fixture`;真实 Golden Set 仍需用户/领域专家标注后冻结。
> 阈值:不写死(90%/95% 之类一律 abstain 处理),待 pilot 后冻结。

## 1. 数据 schema(草案,待实现为 TS 类型)
```text
GoldenSet {
  schemaVersion: 1
  datasetVersion: string            // e.g. 'golden-v0-synthetic-2026-09-08'
  partition: 'pilot' | 'frozen'     // pilot 未冻结;frozen 仅专家标注后
  entries: GoldenEntry[]
}
GoldenEntry {
  entryId: string
  kind: 'retrieval' | 'claim-evidence' | 'causal-vs-correlation' | 'citation-integrity' | 'method-choice' | 'workflow'
  syntheticFixture: boolean         // 本骨架内恒 true
  prompt/input: …
  expected?: { … }                  // 标注侧
  annotation: { annotator: 'A'|'B'; …; adjudicated?: { verdict; by } }
}
```

## 2. 标注指南(annotation guideline,草案)
- 独立 A/B 标注,互不可见;差异走 expert adjudication(字段留空=未裁决)。
- 标注项:retrieval 相关(k)、claim-evidence entailment、citation 身份、unsupported-claim、abstention 恰当性。

## 3. 裁决指南(adjudication guideline,草案)
- 禁用自动多数票视为 ground truth;未裁决条目不计入 pilot 分数。
- A/B 分歧记录 inter-rater agreement(接口见下),低于阈值的维度不冻结。

## 4. Scorer / baseline 接口(契约,待实现)
```ts
interface Scorer { score(golden: GoldenSet, prediction: RunOutcome): ScoreReport }
interface ScoreReport { perEntry: EntryScore[]; aggregate: Record<Metric, number|null> }
Metric = 'retrieval recall@k' | 'precision@k' | 'citation identity acc' | 'claim-evidence entailment'
       | 'unsupported claim rate' | 'abstention appropriateness' | 'false-pass rate'
       | 'false-block rate' | 'calibration' | 'human disagreement' | 'workflow completion'
       | 'recovery success' | 'audit completeness'
interface Baseline { runBaseline(golden: GoldenSet): RunOutcome }   // 最简基线(always-pass/always-abstain)
```

## 5. 合成样例(仅验证框架;synthetic_fixture,勿当真实)
- 10 文献检索样例;20-30 claim-evidence 对;5 因果/相关混淆;5 引用虚构/原文不可达;5 方法选择;2 简化 workflow。
- 现仅预留位置与表头;条目在实现 Golden Set 轨道时以 `synthetic_fixture` 生成。

## 6. 与现有资产关系
- E2E fixtures / experiment mock 表(`fixture-mock-v1`)均为合成,与 Golden Set 无交集。
- 真实标注后:分区 pilot→frozen;冻结后才可校准 T22 阈值(minValidVotes/passThreshold)。
