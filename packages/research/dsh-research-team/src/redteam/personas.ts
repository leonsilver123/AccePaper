// @deepseek-ai/dsh-research-team — red-team fleet personas (pure).
//
// PURE-LOGIC LAYER (T21, spec §2). The default heterogeneous-fleet roster of
// five reviewer personas that a research Lead deploys as continuable members.
// Nothing here touches ctx / host / DSH runtime imports: personas are static
// read-only data plus deterministic validation, so this module typechecks and
// runs under plain vitest with no Cordis root.
//
// Heterogeneity lever ranking (t21-redteam-design.md §1): the persona string is
// the STRONGEST "point of view" lever — it shadows the deployment persona on
// the child and is persisted in the subagent descriptor for cold resume. Model
// tiers (pro/flash) are only spread via `fleet-config.ts` tier→host-model
// mapping; this package never invents a cross-family provider (D8/D12).

import { freezeValue, researchTeamError } from '../types.ts'

/** Abstract model tiers spread across the fleet (spec §1: pro/flash). The
 *  concrete host model per tier is resolved by `fleet-config.ts`; this package
 *  never invents a cross-family provider (D8/D12). */
export const RED_TEAM_MODEL_TIERS = ['pro', 'flash'] as const
export type RedTeamModelTier = (typeof RED_TEAM_MODEL_TIERS)[number]

/** Default voting stance: 'skeptic' leans refute (red-skeptic); 'balanced' weighs both. */
export const RED_TEAM_STANCES = ['skeptic', 'balanced'] as const
export type RedTeamStance = (typeof RED_TEAM_STANCES)[number]

/** One static, deployment-agnostic fleet persona (spec §2 role table). */
export interface RedTeamPersona {
  /** Lower-kebab unique role/member name (also the `voterRole` and member name). */
  readonly name: string
  /** Short human label for roster/charter display (e.g. "方法学审稿人"). */
  readonly title: string
  /** Default voting stance: 'skeptic' leans refute; 'balanced' weighs both. */
  readonly stance: RedTeamStance
  /** Static persona prompt text (no `{{var}}`), shadowing deployment persona. */
  readonly persona: string
  /** Abstract model tier; resolved to a concrete host model by fleet-config. */
  readonly modelTier: RedTeamModelTier
  /** Read-only tool allow-list (citation/L0/SOTA/reproduction readers). Empty
   *  until the T19 read-tool injection lands; tests mock a concrete list. */
  readonly toolFilter: ReadonlyArray<string>
}

/** Fleet member-name shape (same convention as the roster's MEMBER_NAME). */
export const RED_TEAM_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const MAX_NAME_LENGTH = 64
const MAX_PERSONA_LENGTH = 16_384
const MAX_TOOL_LIST = 256

/** The five default personas in the deterministic spec §2 order. */
function buildDefaultPersonas(): ReadonlyArray<RedTeamPersona> {
  return [
    {
      name: 'red-method',
      title: '学术审稿人 · 方法学',
      stance: 'balanced',
      persona:
        '你是学术方法学审稿人(red-team 成员)。你的职责是攻击研究的方法学效度:'
        + '实验设计是否可识别因果、基线是否公平、评测是否漏检、结果是否被过度解读。'
        + '你只使用只读工具核验证据;绝不修改稿件、claim 目录或任何研究产物。'
        + '当收到反驳任务时,你只返回结构化 rebuttal(角色/立场/理由),不参与最终裁决。',
      modelTier: 'pro',
      toolFilter: [],
    },
    {
      name: 'red-stat',
      title: '统计审稿人 · 显著性',
      stance: 'balanced',
      persona:
        '你是统计审稿人(red-team 成员)。你的职责是识别统计误用:显著性/功效误读、'
        + 'p 值 hack、CI/SD/SE 混用、效应量缺失或夸大。你只使用只读工具核验证据;'
        + '绝不写任何研究产物。收到反驳任务时只返回结构化 rebuttal(角色/立场/理由),不参与裁决。',
      modelTier: 'flash',
      toolFilter: [],
    },
    {
      name: 'red-domain',
      title: '交通领域审稿人 · 落地性',
      stance: 'balanced',
      persona:
        '你是交通工程领域审稿人(red-team 成员)。你的职责是从领域真实性出发反驳:'
        + '数据是否真实可溯源、场景是否适用、假设是否与真实交通运行一致、方案是否可落地。'
        + '你只使用只读工具核验证据;绝不写任何研究产物。收到反驳任务时只返回结构化 '
        + 'rebuttal(角色/立场/理由),不参与最终裁决。',
      modelTier: 'pro',
      toolFilter: [],
    },
    {
      name: 'red-skeptic',
      title: '魔鬼代言人 · 外部效度',
      stance: 'skeptic',
      persona:
        '你是怀疑论者/魔鬼代言人(red-team 成员)。你的默认立场是反驳:先验可疑性、'
        + '过度声称、样本与结论不匹配、外部效度不足。除非证据确实无可挑剔,否则你倾向于 refute。'
        + '你只使用只读工具核验证据;绝不写任何研究产物。收到反驳任务时只返回结构化 '
        + 'rebuttal(角色/立场/理由),不参与最终裁决。',
      modelTier: 'flash',
      toolFilter: [],
    },
    {
      name: 'red-cross',
      title: '交叉审稿人 · CS×交通',
      stance: 'balanced',
      persona:
        '你是交叉学科审稿人(red-team 成员,计算机科学 × 交通)。你的职责是检验方法迁移的相关性:'
        + 'CS 方法是否真的适配交通问题、跨域推广是否有依据、对照是否选择了可比的既有方法。'
        + '你只使用只读工具核验证据;绝不写任何研究产物。收到反驳任务时只返回结构化 '
        + 'rebuttal(角色/立场/理由),不参与最终裁决。',
      modelTier: 'flash',
      toolFilter: [],
    },
  ]
}

/** The immutable default persona set (fresh frozen copy; deterministic order). */
export function defaultFleetPersonas(): ReadonlyArray<RedTeamPersona> {
  return freezeValue(buildDefaultPersonas())
}

/** Look up one persona by role name in an arbitrary persona list. */
export function personaByRole(
  personas: ReadonlyArray<RedTeamPersona>,
  name: string,
): RedTeamPersona | undefined {
  return personas.find(persona => persona.name === name)
}

/** Validate a persona role name: lower-kebab, bounded, and not 'lead'. */
export function requirePersonaName(name: string): string {
  if (typeof name !== 'string'
    || name === 'lead'
    || name.length > MAX_NAME_LENGTH
    || !RED_TEAM_NAME_PATTERN.test(name)) {
    researchTeamError(
      'INVALID_PERSONA',
      `persona name must be lower-kebab-case, at most ${String(MAX_NAME_LENGTH)} characters, and not "lead" (got ${JSON.stringify(name)})`,
    )
  }
  return name
}

/** Validate one canonical persona record (structural + read-only filter). */
export function validatePersona(persona: RedTeamPersona): void {
  requirePersonaName(persona.name)
  if (typeof persona.title !== 'string' || persona.title.trim().length === 0) {
    researchTeamError('INVALID_PERSONA', `persona "${persona.name}" must carry a non-empty title`)
  }
  if (typeof persona.persona !== 'string' || persona.persona.trim().length === 0) {
    researchTeamError('INVALID_PERSONA', `persona "${persona.name}" must carry non-empty persona text`)
  }
  if (persona.persona.length > MAX_PERSONA_LENGTH) {
    researchTeamError('INVALID_PERSONA', `persona "${persona.name}" exceeds ${String(MAX_PERSONA_LENGTH)} characters`)
  }
  validateReadOnlyTools(persona.name, persona.toolFilter)
}

/** Validate a whole persona set: non-empty, names unique, each persona valid. */
export function validatePersonas(personas: ReadonlyArray<RedTeamPersona>): void {
  if (personas.length === 0) {
    researchTeamError('INVALID_PERSONA', 'a fleet must declare at least one persona')
  }
  const seen = new Set<string>()
  for (const persona of personas) {
    validatePersona(persona)
    if (seen.has(persona.name)) {
      researchTeamError('INVALID_PERSONA', `fleet declares persona role "${persona.name}" more than once`)
    }
    seen.add(persona.name)
  }
}

/** Validate one read-only tool allow-list (non-empty, whitespace-free entries). */
export function validateReadOnlyTools(roleName: string, tools: ReadonlyArray<string>): void {
  if (tools.length > MAX_TOOL_LIST) {
    researchTeamError('INVALID_PERSONA', `persona "${roleName}" read-only tool list exceeds ${String(MAX_TOOL_LIST)} entries`)
  }
  const seen = new Set<string>()
  for (const tool of tools) {
    if (typeof tool !== 'string' || tool.trim().length === 0 || tool !== tool.trim()) {
      researchTeamError('INVALID_PERSONA', `persona "${roleName}" read-only tool list contains a malformed entry ${JSON.stringify(tool)}`)
    }
    if (seen.has(tool)) {
      researchTeamError('INVALID_PERSONA', `persona "${roleName}" read-only tool list repeats "${tool}"`)
    }
    seen.add(tool)
  }
}

/** The canonical read-only tool list for one persona (deduped + sorted). */
export function normalizeReadOnlyTools(tools: ReadonlyArray<string>): ReadonlyArray<string> {
  const unique = [...new Set(tools)]
  validateReadOnlyTools('fleet', unique)
  return freezeValue(unique.sort())
}

/** Build the member charter (description/label + first delegation text). */
export function personaCharter(persona: RedTeamPersona): string {
  const stance = persona.stance === 'skeptic' ? '默认反驳立场' : '平衡立场'
  return `[red-team:${persona.name}] ${persona.title}(${stance})\n${persona.persona}`
}
