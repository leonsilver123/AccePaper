// @deepseek-ai/dsh-research-team — fleet-config.ts pure spec (T21 §2 / §5).
//
// Pins fleet resolution: model-tier→host-model routes, ordered role subsets,
// and the persona-catalog override. The module imports nothing from ctx / host;
// every violation is a typed INVALID_MODEL / INVALID_PERSONA ResearchTeamError
// and every accepted result is deep-frozen and deterministic.

import { describe, expect, it } from 'vitest'
import {
  DSH_RESEARCH_TEAM_ERROR_PREFIX,
  ResearchTeamError,
} from '../src/types.ts'
import {
  resolveFleet,
  resolveFleetRoles,
  routedModel,
  validateModelRoute,
} from '../src/redteam/fleet-config.ts'
import { defaultFleetPersonas } from '../src/redteam/personas.ts'
import type { RedTeamFleetConfig } from '../src/redteam/fleet-config.ts'
import type { RedTeamPersona } from '../src/redteam/personas.ts'

const INVALID_MODEL = `${DSH_RESEARCH_TEAM_ERROR_PREFIX}INVALID_MODEL`
const INVALID_PERSONA = `${DSH_RESEARCH_TEAM_ERROR_PREFIX}INVALID_PERSONA`

/** Code of the ResearchTeamError thrown by `fn`, or undefined when none. */
function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (error) {
    return error instanceof ResearchTeamError ? error.code : undefined
  }
  return undefined
}

/** A canonical custom persona (fully valid) used by override tests. */
function persona(name: string): RedTeamPersona {
  return {
    name,
    title: `${name} 标题`,
    stance: 'balanced',
    persona: `你是 ${name} 审稿人。你只核验证据,绝不写研究产物。`,
    modelTier: 'pro',
    toolFilter: [],
  }
}

describe('validateModelRoute', () => {
  it('accepts an empty route and a full canonical route', () => {
    expect(validateModelRoute()).toEqual({})
    const canonical = validateModelRoute({ pro: 'model-pro', flash: 'model-flash' })
    expect(canonical).toEqual({ pro: 'model-pro', flash: 'model-flash' })
    expect(Object.isFrozen(canonical)).toBe(true)
  })

  it('trims model names to their canonical value', () => {
    expect(validateModelRoute({ pro: '  model-pro  ' })).toEqual({ pro: 'model-pro' })
  })

  it('rejects an unknown tier key', () => {
    expect(codeOf(() => validateModelRoute({ ultra: 'x' as never }))).toBe(INVALID_MODEL)
  })

  it('rejects an empty or non-string model per known tier', () => {
    expect(codeOf(() => validateModelRoute({ pro: '' }))).toBe(INVALID_MODEL)
    expect(codeOf(() => validateModelRoute({ pro: '   ' }))).toBe(INVALID_MODEL)
    expect(codeOf(() => validateModelRoute({ pro: null as never }))).toBe(INVALID_MODEL)
    expect(codeOf(() => validateModelRoute({ flash: 42 as never }))).toBe(INVALID_MODEL)
  })
})

describe('routedModel', () => {
  it('returns the routed host model for a routed tier', () => {
    const route = validateModelRoute({ pro: 'model-pro' })
    expect(routedModel(route, 'pro')).toBe('model-pro')
  })

  it('returns undefined for an unrouted tier', () => {
    const route = validateModelRoute({})
    expect(routedModel(route, 'flash')).toBeUndefined()
  })
})

describe('resolveFleetRoles', () => {
  it('defaults to the full catalog order when roles are omitted', () => {
    const personas = defaultFleetPersonas()
    const selected = resolveFleetRoles(personas, undefined)
    expect(selected.map(item => item.name)).toEqual(personas.map(item => item.name))
    expect(Object.isFrozen(selected)).toBe(true)
  })

  it('honors the caller-supplied subset order', () => {
    const selected = resolveFleetRoles(defaultFleetPersonas(), ['red-skeptic', 'red-method'])
    expect(selected.map(item => item.name)).toEqual(['red-skeptic', 'red-method'])
  })

  it('rejects an empty role list', () => {
    expect(codeOf(() => resolveFleetRoles(defaultFleetPersonas(), []))).toBe(INVALID_PERSONA)
  })

  it('rejects a duplicated role', () => {
    expect(codeOf(() => resolveFleetRoles(defaultFleetPersonas(), ['red-method', 'red-method'])))
      .toBe(INVALID_PERSONA)
  })

  it('rejects a role that is absent from the catalog', () => {
    expect(codeOf(() => resolveFleetRoles(defaultFleetPersonas(), ['red-nope'])))
      .toBe(INVALID_PERSONA)
  })
})

describe('resolveFleet', () => {
  it('resolves the default five-persona fleet without inventing models', () => {
    const fleet = resolveFleet()
    expect(fleet.members).toHaveLength(5)
    for (const member of fleet.members) {
      expect('model' in member).toBe(false)
      expect(member.persona.toolFilter).toEqual([])
    }
    expect(fleet.modelRoute).toEqual({})
    expect(Object.isFrozen(fleet)).toBe(true)
    expect(Object.isFrozen(fleet.members)).toBe(true)
    expect(Object.isFrozen(fleet.members[0])).toBe(true)
  })

  it('routes every member tier through the supplied model route', () => {
    const config: RedTeamFleetConfig = {
      roles: ['red-method', 'red-stat', 'red-domain', 'red-skeptic', 'red-cross'],
      modelRoute: { pro: 'model-pro', flash: 'model-flash' },
    }
    const fleet = resolveFleet(config)
    const models = fleet.members.map(member => member.model)
    expect(models).toEqual(['model-pro', 'model-flash', 'model-pro', 'model-flash', 'model-flash'])
    expect(fleet.modelRoute).toEqual({ pro: 'model-pro', flash: 'model-flash' })
  })

  it('applies a custom persona catalog and a role subset over it', () => {
    const catalog = [persona('red-scan'), persona('red-audit')]
    const fleet = resolveFleet({ personas: catalog, roles: ['red-audit'] })
    expect(fleet.members.map(member => member.persona.name)).toEqual(['red-audit'])
    expect(fleet.members[0]?.persona.toolFilter).toEqual([])
  })

  it('rejects an empty persona-catalog override', () => {
    expect(codeOf(() => resolveFleet({ personas: [] }))).toBe(INVALID_PERSONA)
  })

  it('rejects a duplicated persona in the catalog override', () => {
    expect(codeOf(() => resolveFleet({ personas: [persona('red-scan'), persona('red-scan')] })))
      .toBe(INVALID_PERSONA)
  })

  it('rejects an unknown tier in the model route', () => {
    expect(codeOf(() => resolveFleet({ modelRoute: { ultra: 'x' as never } })))
      .toBe(INVALID_MODEL)
  })

  it('rejects an unknown role against the catalog', () => {
    expect(codeOf(() => resolveFleet({ roles: ['red-absent'] }))).toBe(INVALID_PERSONA)
  })
})
