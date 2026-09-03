import type { Phase, StepDefinition, TrinityComponent } from './types.ts'

/**
 * The 16-step research pipeline (methodology v1.0, Phases A–E).
 *
 * Trinity gate mapping per step:
 *  A = adversarial convergence  (red-team refute + judge vote ≥ 2)
 *  B = external anchoring       (vs real literature / SOTA / venue acceptance patterns)
 *  C = falsifiable → experiment verdict (soft judgment → falsifiable prediction → experiment adjudicates)
 *
 * The default dependency chain is the array order; the state machine
 * (state-machine.ts) enforces that a step's `inputs` are all produced before
 * it may start, and that every component in its `gate` has passed before it
 * may exit.
 *
 * `domain-direction` (human T0 方向授权) is a pre-condition input to A1, not a step.
 */
export const STEPS: readonly StepDefinition[] = [
  // ── Phase A: 定位 ─────────────────────────────────────────────
  {
    id: 'A1-landscape', index: 1, phase: 'A', name: '版图',
    purpose: '扫描领域近期文献,识别研究缺口',
    inputs: ['domain-direction'],
    outputs: ['landscape-map', 'gap-list'],
    gate: ['B'],
    falsifiable: null,
    humanGate: false,
  },
  {
    id: 'A2-claim', index: 2, phase: 'A', name: 'claim 构造',
    purpose: '构造可证伪的中心 claim',
    inputs: ['landscape-map', 'gap-list'],
    outputs: ['claim', 'falsifiable-prediction'],
    gate: ['A', 'C'],
    falsifiable: 'claim 必须给出可证伪的预测,否则 C 闸门拒绝退出',
    humanGate: false,
  },
  {
    id: 'A3-agenda', index: 3, phase: 'A', name: '议程',
    purpose: '定义贡献清单与研究议程',
    inputs: ['claim'],
    outputs: ['agenda', 'contribution-list'],
    gate: ['A'],
    falsifiable: null,
    humanGate: false,
  },
  {
    id: 'A4-venue', index: 4, phase: 'A', name: '选刊',
    purpose: '选定目标期刊(如 TRC),匹配 scope/录用模式',
    inputs: ['claim', 'agenda'],
    outputs: ['venue', 'venue-scope'],
    gate: ['B'],
    falsifiable: null,
    humanGate: false,
  },
  // ── Phase B: 构造 ─────────────────────────────────────────────
  {
    id: 'B1-method', index: 5, phase: 'B', name: '方法推导',
    purpose: '由 claim 推导方法,产出可测预测',
    inputs: ['claim', 'falsifiable-prediction'],
    outputs: ['method-spec', 'method-predictions'],
    gate: ['A', 'C'],
    falsifiable: '方法必须产出可由实验裁决的预测',
    humanGate: false,
  },
  {
    id: 'B2-data', index: 6, phase: 'B', name: '数据',
    purpose: '获取/清洗数据,产出数据画像与 provenance',
    inputs: ['method-spec'],
    outputs: ['dataset', 'data-profile'],
    gate: ['B'],
    falsifiable: null,
    humanGate: false,
  },
  {
    id: 'B3-baseline', index: 7, phase: 'B', name: 'baseline',
    purpose: '建立 baseline 并对照 SOTA',
    inputs: ['method-spec', 'dataset'],
    outputs: ['baseline-results', 'sota-comparison'],
    gate: ['B'],
    falsifiable: null,
    humanGate: false,
  },
  // ── Phase C: 迭代 ─────────────────────────────────────────────
  {
    id: 'C1-mvp', index: 8, phase: 'C', name: 'MVP',
    purpose: '最小可行实验,对核心预测给出裁决',
    inputs: ['method-spec', 'dataset'],
    outputs: ['mvp-results'],
    gate: ['C'],
    falsifiable: 'MVP 实验结果必须能判定核心预测 真/假',
    humanGate: false,
  },
  {
    id: 'C2-trinity-loop', index: 9, phase: 'C', name: '三合一循环',
    purpose: '判断三件套迭代收敛',
    inputs: ['mvp-results', 'baseline-results'],
    outputs: ['converged-verdict'],
    gate: ['A', 'B', 'C'],
    falsifiable: '收敛判决须同时通过对抗/外部/可证伪三方',
    humanGate: false,
  },
  {
    id: 'C3-boundary', index: 10, phase: 'C', name: '边界',
    purpose: '探边界/消融,测试方法适用域',
    inputs: ['converged-verdict'],
    outputs: ['ablation-results', 'boundary-map'],
    gate: ['C'],
    falsifiable: '边界预测须被实验逐一裁决',
    humanGate: false,
  },
  // ── Phase D: 论证 ─────────────────────────────────────────────
  {
    id: 'D1-figure-map', index: 11, phase: 'D', name: '图表映射',
    purpose: '结果→图表映射(数据图/三线表/路线图)',
    inputs: ['converged-verdict', 'ablation-results'],
    outputs: ['figure-plan'],
    gate: ['B'],
    falsifiable: null,
    humanGate: false,
  },
  {
    id: 'D2-framework', index: 12, phase: 'D', name: '框架',
    purpose: '论文框架/大纲',
    inputs: ['claim', 'agenda', 'converged-verdict'],
    outputs: ['paper-outline'],
    gate: ['A'],
    falsifiable: null,
    humanGate: false,
  },
  {
    id: 'D3-writing', index: 13, phase: 'D', name: '写作',
    purpose: '起草各章节 + 添加参考文献(经 L0 过滤)',
    inputs: ['paper-outline', 'figure-plan', 'landscape-map'],
    outputs: ['draft'],
    gate: ['A', 'B'],
    falsifiable: null,
    humanGate: false,
  },
  {
    id: 'D4-rebuttal', index: 14, phase: 'D', name: 'rebuttal',
    purpose: '对抗式 rebuttal,产出修订稿',
    inputs: ['draft'],
    outputs: ['rebuttal', 'revised-draft'],
    gate: ['A'],
    falsifiable: null,
    humanGate: false,
  },
  // ── Phase E: 落地 ─────────────────────────────────────────────
  {
    id: 'E1-format', index: 15, phase: 'E', name: '格式',
    purpose: '按目标期刊格式化(版式/引用样式)',
    inputs: ['revised-draft', 'venue', 'venue-scope'],
    outputs: ['formatted-manuscript'],
    gate: ['B'],
    falsifiable: null,
    humanGate: false,
  },
  {
    id: 'E2-submit', index: 16, phase: 'E', name: '投稿',
    purpose: '投稿(人的行为)',
    inputs: ['formatted-manuscript'],
    outputs: ['submission-record'],
    gate: [],
    falsifiable: null,
    humanGate: true,
  },
]

/** Lookup by id. */
export const STEP_BY_ID: ReadonlyMap<string, StepDefinition> = new Map(
  STEPS.map(step => [step.id, step]),
)

/** All steps in a phase, in order. */
export function stepsByPhase(phase: Phase): readonly StepDefinition[] {
  return STEPS.filter(step => step.phase === phase)
}

/** Trinity component labels (zh) for diagnostics. */
export const TRINITY_LABEL: Readonly<Record<TrinityComponent, string>> = {
  A: '对抗收敛(red-team 反驳 + judge 投票 ≥2)',
  B: '外部锚定(对照真实文献/SOTA/录用模式)',
  C: '可证伪→实验裁决',
}

/**
 * Inputs that may be seeded directly via `setRunInput` (T0 human authorization —
 * `domain-direction`). Permanent across rollback (DEP-7): seedables are never
 * invalidated by cascade, because they are human authorizations set once before the
 * run starts, not step-produced artifacts. Invariant (DEP-8): no slug in
 * SEEDABLE_INPUTS may appear in any step's `outputs` (a seed slug cannot also be a
 * produced artifact) — asserted by assertDagAndSeedSeparation at module load.
 */
export const SEEDABLE_INPUTS: readonly string[] = ['domain-direction']

/**
 * Assert the step graph is a DAG (no input references a later-indexed step's output)
 * AND that no seedable slug appears in any step's outputs. Guarantees
 * `computeTransitiveDependents` terminates and that seed-vs-registry precedence is
 * unambiguous (DEP-9, DEP-8). Called once at module load; throws on a cycle or
 * seed/production overlap.
 */
export function assertDagAndSeedSeparation(): void {
  const outputOwner = new Map<string, number>()
  for (const s of STEPS) {
    for (const o of s.outputs) {
      if (SEEDABLE_INPUTS.includes(o)) {
        throw new Error(`assertDagAndSeedSeparation: step '${s.id}' outputs '${o}' which is a seedable input (DEP-8 violation: seed slug cannot be a produced artifact)`)
      }
      outputOwner.set(o, s.index)
    }
  }
  for (const s of STEPS) {
    for (const input of s.inputs) {
      if (SEEDABLE_INPUTS.includes(input)) continue
      const owner = outputOwner.get(input)
      if (owner === undefined) {
        throw new Error(`assertDagAndSeedSeparation: step '${s.id}' input '${input}' has no producer and is not seedable`)
      }
      if (owner >= s.index) {
        throw new Error(`assertDagAndSeedSeparation: step '${s.id}' (index ${s.index}) consumes '${input}' produced by a later/equal-index step (index ${owner}) — cycle or forward-edge (DEP-9)`)
      }
    }
  }
}

assertDagAndSeedSeparation()

/**
 * Recursively Object.freeze an object/array and all nested values (RC-A runtime
 * defense-in-depth: TS `readonly`/`ReadonlyMap` are compile-time-only — without
 * `Object.freeze`, `STEP_BY_ID.get('E2-submit').humanGate = false` silently bypasses
 * every guard that reads `step.humanGate` live; frozen, it throws TypeError in strict
 * mode (ESM). Applied AFTER assertDagAndSeedSeparation so the graph is validated before
 * it is frozen. STEP_BY_ID holds the SAME frozen step object refs (built from STEPS at
 * line 171), so its values are immutable too; the Map itself is not separately frozen
 * (Map internal state is unaffected by Object.freeze), and STEP_BY_ID/STEPS are NOT
 * re-exported from the public index.ts regardless (RC-A primary fix — removal closes
 * the import path; deepFreeze is the runtime backstop).
 */
function deepFreeze(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    Object.freeze(obj)
    if (Array.isArray(obj)) {
      for (const v of obj) deepFreeze(v)
    } else {
      for (const key of Object.keys(obj)) deepFreeze(obj[key])
    }
  }
}

deepFreeze(STEPS)
deepFreeze(TRINITY_LABEL)
deepFreeze(SEEDABLE_INPUTS)
