// @deepseek-ai/dsh-research-team — red-team fleet configuration (pure).
//
// PURE-LOGIC LAYER (T21, spec §2). Resolves a deployable fleet roster from the
// persona catalog (`personas.ts`) and a caller-supplied host model route.
// Nothing here touches ctx / host / DSH runtime imports.
//
// Heterogeneity levers (t21-redteam-design.md §1) decompose across modules:
//   ① persona text        → `personas.ts` catalog (the strong "point of view");
//   ② role task prompts   → the orchestrator adapter;
//   ③ agentOptions.model  → THIS module's tier→host-model route (pro/flash);
//   ④ provider choice     → all 'spawn'/fresh by default in the orchestrator.
// This module validates and resolves ONLY the config — which personas deploy,
// in which order, and which concrete host model each tier maps to. It never
// invents a model family or a cross-family provider (D8/D12): the route is
// caller-supplied and every unrouted tier spawns with the host default.

import { freezeValue, researchTeamError } from '../types.ts'
import {
  defaultFleetPersonas,
  personaByRole,
  RED_TEAM_MODEL_TIERS,
  validatePersonas,
} from './personas.ts'
import type {
  RedTeamModelTier,
  RedTeamPersona,
} from './personas.ts'

/** Deployment config for one red-team fleet (all optional = the frozen default). */
export interface RedTeamFleetConfig {
  /**
   * Concrete host model per abstract tier. Unknown tier keys reject
   * ({@link DSH_RESEARCH_TEAM_INVALID_MODEL}); each entry must be a non-empty
   * trimmed string. Omitted tiers spawn with the host default — this package
   * never invents a model id (D8/D12).
   */
  readonly modelRoute?: Readonly<Partial<Record<RedTeamModelTier, string>>>
  /**
   * Ordered role subset to deploy. Names must be unique and exist in the
   * persona catalog; defaults to the full catalog order.
   */
  readonly roles?: ReadonlyArray<string>
  /**
   * Complete persona catalog override. When supplied it REPLACES the default
   * five-persona catalog (the deterministic spec §2 order is the default only).
   */
  readonly personas?: ReadonlyArray<RedTeamPersona>
}

/** One deployable fleet row: the persona plus its resolved host model, when routed. */
export interface RedTeamFleetMember {
  readonly persona: RedTeamPersona
  /** Concrete host model for the persona's tier, when the route names one. */
  readonly model?: string
}

/** A fully validated, resolved fleet ready for deployment (deep-frozen). */
export interface ResolvedRedTeamFleet {
  /** Deployable rows in deployment order (the config `roles` order). */
  readonly members: ReadonlyArray<RedTeamFleetMember>
  /** Canonicalized tier→model route (frozen; partial when a tier is unrouted). */
  readonly modelRoute: Readonly<Partial<Record<RedTeamModelTier, string>>>
}

/** Validate one tier→model route; returns the canonical deep-frozen route. */
export function validateModelRoute(
  modelRoute: Readonly<Partial<Record<RedTeamModelTier, string>>> = {},
): Readonly<Partial<Record<RedTeamModelTier, string>>> {
  const canonical: Partial<Record<RedTeamModelTier, string>> = {}
  for (const rawKey of Object.keys(modelRoute)) {
    if (!RED_TEAM_MODEL_TIERS.includes(rawKey as RedTeamModelTier)) {
      researchTeamError(
        'INVALID_MODEL',
        `model route names unknown tier ${JSON.stringify(rawKey)} (expected one of ${RED_TEAM_MODEL_TIERS.join(', ')})`,
      )
    }
    const tier = rawKey as RedTeamModelTier
    const model = modelRoute[tier]
    if (typeof model !== 'string' || model.trim().length === 0) {
      researchTeamError('INVALID_MODEL', `model route for tier "${tier}" must name a non-empty host model`)
    }
    canonical[tier] = model.trim()
  }
  return freezeValue(canonical)
}

/** Resolve the model for one tier out of a canonical route (undefined = unrouted). */
export function routedModel(
  modelRoute: Readonly<Partial<Record<RedTeamModelTier, string>>>,
  tier: RedTeamModelTier,
): string | undefined {
  return modelRoute[tier]
}

/** Select the ordered role subset from a catalog (throws on empty/unknown/duplicate). */
export function resolveFleetRoles(
  personas: ReadonlyArray<RedTeamPersona>,
  roles: ReadonlyArray<string> | undefined,
): ReadonlyArray<RedTeamPersona> {
  const ordered = roles === undefined ? personas.map(persona => persona.name) : [...roles]
  if (ordered.length === 0) {
    researchTeamError('INVALID_PERSONA', 'a fleet must deploy at least one persona role')
  }
  const seen = new Set<string>()
  const selected: RedTeamPersona[] = []
  for (const role of ordered) {
    if (seen.has(role)) {
      researchTeamError('INVALID_PERSONA', `fleet roles repeat "${role}"`)
    }
    seen.add(role)
    const persona = personaByRole(personas, role)
    if (persona === undefined) {
      researchTeamError('INVALID_PERSONA', `fleet role "${role}" is not in the persona catalog`)
    }
    selected.push(persona)
  }
  return freezeValue(selected)
}

/** Resolve a full fleet config into deployable rows + canonical route. Throws
 *  {@link ResearchTeamError} on any violation; the result is deep-frozen and
 *  deterministic for a given input. */
export function resolveFleet(config: RedTeamFleetConfig = {}): ResolvedRedTeamFleet {
  const personas = config.personas === undefined
    ? defaultFleetPersonas()
    : config.personas
  validatePersonas(personas)
  const modelRoute = validateModelRoute(config.modelRoute)
  const selected = resolveFleetRoles(personas, config.roles)
  const members = selected.map((persona) => {
    const model = routedModel(modelRoute, persona.modelTier)
    return model === undefined ? { persona } : { persona, model }
  })
  return freezeValue({ members, modelRoute })
}
