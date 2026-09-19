import type { Phase, StepDefinition, TrinityComponent } from './types.ts'
import { forwardEdges } from '../workflow/dependency-graph.ts'

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
    id: 'A1-landscape', index: 1, phase: 'A', name: '文献调研',
    purpose: '检索本领域的近期文献,看清已经做到了什么、还缺什么',
    inputs: ['domain-direction'],
    outputs: ['landscape-map', 'gap-list'],
    gate: ['B'],
    falsifiable: null,
    humanGate: false,
  },
  {
    id: 'A2-claim', index: 2, phase: 'A', name: '提出主张',
    purpose: '提出一个能被实验推翻的中心主张,并写明它预测什么',
    inputs: ['landscape-map', 'gap-list'],
    outputs: ['claim', 'falsifiable-prediction'],
    gate: ['A', 'C'],
    falsifiable: 'claim 必须给出可证伪的预测,否则 C 闸门拒绝退出',
    humanGate: false,
  },
  {
    id: 'A3-agenda', index: 3, phase: 'A', name: '研究议程',
    purpose: '列出这项研究打算给出哪些贡献,以及先后顺序',
    inputs: ['claim'],
    outputs: ['agenda', 'contribution-list'],
    gate: ['A'],
    falsifiable: null,
    humanGate: false,
  },
  {
    id: 'A4-venue', index: 4, phase: 'A', name: '选定期刊',
    purpose: '选定目标期刊,核对它的收稿范围与投稿要求',
    // `landscape-map` carries the venues the retrieved records were published in,
    // which is the only grounded basis a venue choice has. Without it declared as an
    // input, A4 could not read the corpus at all and had to emit a literal venue.
    inputs: ['claim', 'agenda', 'landscape-map'],
    outputs: ['venue', 'venue-scope'],
    gate: ['B'],
    falsifiable: null,
    humanGate: false,
  },
  // ── Phase B: 构造 ─────────────────────────────────────────────
  {
    id: 'B1-method', index: 5, phase: 'B', name: '确定方法',
    purpose: '由主张推导出可执行的方法,并给出可以测量的预测',
    inputs: ['claim', 'falsifiable-prediction'],
    outputs: ['method-spec', 'method-predictions'],
    gate: ['A', 'C'],
    falsifiable: '方法必须产出可由实验裁决的预测',
    humanGate: false,
  },
  {
    id: 'B2-data', index: 6, phase: 'B', name: '准备数据',
    purpose: '准备实验数据,并记录它从哪来、经过了什么处理',
    inputs: ['method-spec'],
    outputs: ['dataset', 'data-profile'],
    gate: ['B'],
    falsifiable: null,
    humanGate: false,
  },
  {
    id: 'B3-baseline', index: 7, phase: 'B', name: '对照基线',
    purpose: '建立对照基线,并与本领域目前最好的做法比较',
    inputs: ['method-spec', 'dataset'],
    outputs: ['baseline-results', 'sota-comparison'],
    gate: ['B'],
    falsifiable: null,
    humanGate: false,
  },
  // ── Phase C: 迭代 ─────────────────────────────────────────────
  {
    id: 'C1-mvp', index: 8, phase: 'C', name: '首次实验',
    purpose: '跑通最小可行的一次实验,判定核心预测成立还是不成立',
    inputs: ['method-spec', 'dataset'],
    // `result-version` is what every later step measures against. The study's numbers used to be
    // recomputed by each consumer — the C gate, D1, D3, D4 and E1 each ran the simulation again —
    // so a change to the study could leave the table, the figure and the verdict describing three
    // different runs. The arithmetic was identical because the simulation is deterministic, which
    // is exactly why nothing caught it: the defect is that they were separate computations.
    outputs: ['mvp-results', 'result-version'],
    gate: ['C'],
    falsifiable: 'MVP 实验结果必须能判定核心预测 真/假',
    humanGate: false,
  },
  {
    id: 'C2-trinity-loop', index: 9, phase: 'C', name: '三方会审',
    purpose: '让三道理性检查同时认可,判定结论是否已经收敛',
    inputs: ['mvp-results', 'baseline-results', 'result-version'],
    outputs: ['converged-verdict'],
    gate: ['A', 'B', 'C'],
    falsifiable: '收敛判决须同时通过对抗/外部/可证伪三方',
    humanGate: false,
  },
  {
    id: 'C3-boundary', index: 10, phase: 'C', name: '边界实验',
    purpose: '做拆解与边界实验,找出方法在什么条件下不再成立',
    inputs: ['converged-verdict', 'result-version'],
    outputs: ['ablation-results', 'boundary-map'],
    gate: ['C'],
    falsifiable: '边界预测须被实验逐一裁决',
    humanGate: false,
  },
  // ── Phase D: 论证 ─────────────────────────────────────────────
  {
    id: 'D1-figure-map', index: 11, phase: 'D', name: '规划图表',
    purpose: '把结果规划成论文里要用的图、表与路线图',
    inputs: ['converged-verdict', 'ablation-results', 'result-version'],
    outputs: ['figure-plan'],
    gate: ['B'],
    falsifiable: null,
    humanGate: false,
  },
  {
    id: 'D2-framework', index: 12, phase: 'D', name: '搭框架',
    purpose: '搭出论文的章节结构与大纲',
    // `method-spec` is read by this step's executor and was not declared, so the dependency graph
    // did not contain the edge. That is the difference between "the closure is complete" and "the
    // closure happens to cover this case": with the edge undeclared, nothing could prove that
    // re-running B1 must also invalidate this step's output. It is declared now.
    inputs: ['claim', 'agenda', 'converged-verdict', 'method-spec'],
    outputs: ['paper-outline'],
    gate: ['A'],
    falsifiable: null,
    humanGate: false,
  },
  {
    id: 'D3-writing', index: 13, phase: 'D', name: '写作',
    purpose: '起草各章节正文,并整理出参考文献',
    inputs: ['paper-outline', 'figure-plan', 'landscape-map', 'result-version', 'method-spec'],
    // THE DOCUMENT IS ONE ARTIFACT WITH ONE VERSION COUNTER, created here and republished by every
    // later writing step. It is not a per-step product: a judgement has to bind the version of the
    // document it was made about, and three slugs for one document give it three things to bind.
    outputs: ['manuscript'],
    gate: ['A', 'B'],
    falsifiable: null,
    humanGate: false,
  },
  {
    id: 'D4-rebuttal', index: 14, phase: 'D', name: '答辩演练',
    purpose: '预演审稿人会怎么质疑,逐条回应并产出修订稿',
    // `manuscript` is BOTH an input and an output here: this step republishes the document it read,
    // which is what `assertDagAndSeedSeparation` requires of a step that is not its first producer.
    inputs: ['manuscript', 'result-version'],
    outputs: ['rebuttal', 'manuscript'],
    gate: ['A'],
    falsifiable: null,
    humanGate: false,
  },
  // ── Phase E: 落地 ─────────────────────────────────────────────
  {
    id: 'E1-format', index: 15, phase: 'E', name: '排版',
    purpose: '按目标期刊的要求排版,并套用它的引用格式',
    // `paper-outline` is read by this step's executor and was not declared — see D2-framework for
    // what an undeclared read costs.
    inputs: ['manuscript', 'venue', 'venue-scope', 'paper-outline', 'result-version'],
    // THE TYPESET FORM IS ITS OWN ARTIFACT, and the document it renders is not. Before this, one
    // slug carried the manuscript markdown, the compile report and the compiled bytes at once, so
    // "the document" and "what a compiler made of it" were one thing a reader had to take apart —
    // and the step that compiled it also assembled it, which is why a document could reach a
    // compiler in a state no other step had approved.
    outputs: ['typeset'],
    gate: ['B'],
    falsifiable: null,
    humanGate: false,
  },
  {
    id: 'E2-submit', index: 16, phase: 'E', name: '投稿确认',
    purpose: '由你来确认是否投稿 —— 这一步永远不会自动完成',
    // A PERSON APPROVES THE DOCUMENT AND WHAT WAS SET FROM IT, so an approval binds both refs: the
    // manuscript the run stands behind and the typeset form the journal would receive. Binding only
    // the typeset form would let the document move under a decision about it.
    inputs: ['manuscript', 'typeset'],
    outputs: ['submission-record'],
    gate: [],
    falsifiable: null,
    humanGate: true,
  },
]

/**
 * Lookup by id — a FUNCTION over the deep-frozen `STEPS` array, deliberately NOT
 * a mutable `Map`.
 *
 * Why (independent core-API audit P1-1, fixed here): every state-machine guard
 * (canStart / startStep / runStep / submitGateVerdict / completeStep /
 * _applyHumanApproval / isComplete) reads a step definition LIVE before deciding.
 * A exported `Map` is a mutable indirection: `Object.freeze` does NOT protect a
 * Map's internal state, so any code that reached that symbol could
 * `STEP_BY_ID.set('E2-submit', { ...def, humanGate: false })` and every guard
 * would then trust the replacement — silently clearing the E2 human gate, the one
 * red line of this system (it was reproduced end-to-end via a file-path import of
 * a build chunk, which the package `exports` map cannot block).
 *
 * Scanning the frozen `STEPS` array removes the indirection entirely: there is no
 * mapping to swap and the values are frozen, so the definition set is immutable
 * by construction. The public accessor `getStepDefinitionById()` reads the SAME
 * array, so the two accessors can never disagree (they did before: the Map could
 * be poisoned while `STEPS` stayed clean).
 */
export function lookupStep(stepId: string): StepDefinition | undefined {
  return STEPS.find(step => step.id === stepId)
}

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
/**
 * Run inputs a Case Pack seeds.
 *
 * These live here, next to {@link SEEDABLE_INPUTS}, because they are part of the
 * pipeline's own input vocabulary — the runner and the Case Pack loader both read them
 * from this one place, so a slug cannot drift between the allowlist and the loader.
 *
 * `scenario` carries the pack's scenario parameters (vehicle parameters, seed, road
 * grade) so an executor consumes the pack's numbers rather than a compiled-in constant,
 * which is what makes a change to the pack change the run.
 */
export const CASE_PACK_SEED_INPUTS = {
  claim: 'case-pack-claim',
  scenario: 'case-pack-scenario',
  experiment: 'case-pack-experiment',
  ablation: 'case-pack-ablation',
  boundary: 'case-pack-boundary',
  citations: 'case-pack-citations',
} as const

/** One of {@link CASE_PACK_SEED_INPUTS}'s values. */
export type CasePackSeedInput = (typeof CASE_PACK_SEED_INPUTS)[keyof typeof CASE_PACK_SEED_INPUTS]

export const SEEDABLE_INPUTS: readonly string[] = [
  'domain-direction',
  ...Object.values(CASE_PACK_SEED_INPUTS),
]

/**
 * Assert the step graph is a DAG (no input references a later-indexed step's output)
 * AND that no seedable slug appears in any step's outputs. Guarantees
 * `computeTransitiveDependents` terminates and that seed-vs-registry precedence is
 * unambiguous (DEP-9, DEP-8). Called once at module load; throws on a cycle or
 * seed/production overlap.
 *
 * A SLUG MAY HAVE MORE THAN ONE PRODUCER, and then two further things have to hold. The manuscript is
 * the case that forced this: every writing step republishes the SAME document under one slug, so a
 * single slug has three producers and one continuous version counter. What breaks without saying so
 * is that the owner of a slug is no longer a single number — last-writer-wins would record the LAST
 * producer's index and then read the middle producer's own consumption of that slug as a forward
 * edge, failing the module load of every importer of this package. The two rules that replace it:
 *
 *   - the owner is the EARLIEST producer, which is the step that creates the slug and the only index
 *     the no-forward-edge property is about;
 *   - a step that republishes a slug must also CONSUME it, because `computeTransitiveDependents`
 *     walks `inputs ∩ outputs` and an unstated consumption is an invalidation cascade with a hole in
 *     it — invalidating the first producer would leave the republisher's artifact standing.
 *
 * @param steps - the graph to check. Defaults to the shipped `STEPS`; parameterized so a spec can
 *   exercise the multi-producer rules against a synthetic graph, which the frozen constant cannot be
 *   made to violate.
 * @throws {Error} on a cycle, a forward edge, a seed/production overlap, a slug with no producer, or
 *   a republished slug its republisher does not consume.
 */
export function assertDagAndSeedSeparation(steps: readonly StepDefinition[] = STEPS): void {
  const firstProducer = new Map<string, number>()
  const producers = new Map<string, string[]>()
  for (const s of steps) {
    for (const o of s.outputs) {
      if (SEEDABLE_INPUTS.includes(o)) {
        throw new Error(`assertDagAndSeedSeparation: step '${s.id}' outputs '${o}' which is a seedable input (DEP-8 violation: seed slug cannot be a produced artifact)`)
      }
      if (!firstProducer.has(o)) firstProducer.set(o, s.index)
      producers.set(o, [...(producers.get(o) ?? []), s.id])
    }
  }
  for (const s of steps) {
    for (const input of s.inputs) {
      if (SEEDABLE_INPUTS.includes(input)) continue
      if (!firstProducer.has(input)) {
        throw new Error(`assertDagAndSeedSeparation: step '${s.id}' input '${input}' has no producer and is not seedable`)
      }
    }
  }
  // THE FORWARD-EDGE RULE HAS ONE HOME. `forwardEdges` states it as a function so a spec can assert
  // the expected graph without re-running the module; this call is what makes the module-load check
  // and the spec the same rule rather than two copies of it. They were two copies, and when a slug
  // gained a second producer only one was corrected — the assertion passed a graph the spec's
  // function reported as broken.
  for (const edge of forwardEdges(steps)) {
    throw new Error(`assertDagAndSeedSeparation: step '${edge.consumer}' consumes '${edge.input}' produced by a later/equal-index step (index ${edge.producerIndex}) — cycle or forward-edge (DEP-9)`)
  }
  for (const [slug, ids] of producers) {
    if (ids.length < 2) continue
    for (const s of steps) {
      if (!s.outputs.includes(slug)) continue
      if (s.index === firstProducer.get(slug)) continue
      if (!s.inputs.includes(slug)) {
        throw new Error(`assertDagAndSeedSeparation: step '${s.id}' (index ${s.index}) republishes '${slug}' but does not consume it — the invalidation cascade would stop here (DEP-9)`)
      }
    }
  }
}

assertDagAndSeedSeparation()

/**
 * Recursively Object.freeze an object/array and all nested values (RC-A runtime
 * defense-in-depth: TS `readonly`/`ReadonlyMap` are compile-time-only — without
 * `Object.freeze`, a live step object's `humanGate` assignment silently bypasses
 * every guard that reads `step.humanGate` live; frozen, it throws TypeError in strict
 * mode (ESM). Applied AFTER assertDagAndSeedSeparation so the graph is validated before
 * it is frozen. `lookupStep()` reads THIS frozen array — the mutable STEP_BY_ID Map was
 * removed (audit P1-1) because `Object.freeze` cannot protect a Map's internal state,
 * so a swapped entry would have silently redefined E2-submit's human gate. STEPS is NOT
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
