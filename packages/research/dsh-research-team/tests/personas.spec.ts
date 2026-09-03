// @deepseek-ai/dsh-research-team — personas.ts pure spec (T21 §2 / §5).
//
// Pins the deterministic five-persona catalog, the lower-kebab role-name rule,
// and the read-only tool-filter validation helpers. Every violation carries a
// typed DSH_RESEARCH_TEAM_INVALID_PERSONA code; the module imports nothing
// from ctx / host, so these run under plain vitest.

import { describe, expect, it } from 'vitest'
import {
  DSH_RESEARCH_TEAM_ERROR_PREFIX,
  ResearchTeamError,
} from '../src/types.ts'
import {
  defaultFleetPersonas,
  normalizeReadOnlyTools,
  personaByRole,
  personaCharter,
  RED_TEAM_MODEL_TIERS,
  RED_TEAM_STANCES,
  requirePersonaName,
  validatePersona,
  validatePersonas,
  validateReadOnlyTools,
} from '../src/redteam/personas.ts'
import type { RedTeamPersona } from '../src/redteam/personas.ts'

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
function persona(overrides: Partial<RedTeamPersona> = {}): RedTeamPersona {
  return {
    name: 'red-scan',
    title: '自定义扫描审稿人',
    stance: 'balanced',
    persona: '你是自定义审稿人。你只核验证据,绝不写研究产物。',
    modelTier: 'pro',
    toolFilter: [],
    ...overrides,
  }
}

describe('default personas', () => {
  it('is the frozen five-persona set in the spec §2 order with unique kebab names', () => {
    const personas = defaultFleetPersonas()
    expect(personas.map(item => item.name)).toEqual([
      'red-method',
      'red-stat',
      'red-domain',
      'red-skeptic',
      'red-cross',
    ])
    // Deep-frozen and independent across reads.
    expect(Object.isFrozen(personas)).toBe(true)
    expect(Object.isFrozen(defaultFleetPersonas())).toBe(true)
    const again = defaultFleetPersonas()
    expect(again).toEqual(personas)
    expect(again[0]).not.toBe(personas[0])
  })

  it('keeps the catalog read-only at the field level', () => {
    for (const item of defaultFleetPersonas()) {
      expect(Object.isFrozen(item)).toBe(true)
      expect(Object.isFrozen(item.toolFilter)).toBe(true)
      expect(item.name.length).toBeGreaterThan(0)
      expect(item.persona.trim().length).toBeGreaterThan(0)
    }
  })

  it('exposes the model tiers and stances as literal unions', () => {
    expect(RED_TEAM_MODEL_TIERS).toEqual(['pro', 'flash'])
    expect(RED_TEAM_STANCES).toEqual(['skeptic', 'balanced'])
  })
})

describe('personaByRole', () => {
  it('finds one persona by its role name', () => {
    const found = personaByRole(defaultFleetPersonas(), 'red-method')
    expect(found?.title).toContain('方法学')
  })

  it('returns undefined for an unknown role', () => {
    expect(personaByRole(defaultFleetPersonas(), 'red-nope')).toBeUndefined()
  })
})

describe('requirePersonaName', () => {
  it('accepts a lower-kebab name and returns it trimmed as-is', () => {
    expect(requirePersonaName('red-method')).toBe('red-method')
    expect(requirePersonaName('a1-b2')).toBe('a1-b2')
  })

  it('rejects a non-string name', () => {
    expect(codeOf(() => requirePersonaName(undefined as never))).toBe(INVALID_PERSONA)
    expect(codeOf(() => requirePersonaName(42 as never))).toBe(INVALID_PERSONA)
  })

  it('rejects the reserved lead role', () => {
    expect(codeOf(() => requirePersonaName('lead'))).toBe(INVALID_PERSONA)
  })

  it('rejects an over-long name', () => {
    expect(codeOf(() => requirePersonaName('a'.repeat(65)))).toBe(INVALID_PERSONA)
  })

  it('rejects names outside the kebab shape', () => {
    for (const malformed of ['Bad-Name', 'bad_name', '-bad', 'bad-', 'red..x', 'a--b', '', 'bad name']) {
      expect(codeOf(() => requirePersonaName(malformed))).toBe(INVALID_PERSONA)
    }
  })
})

describe('validatePersona', () => {
  it('accepts a canonical persona record', () => {
    expect(() => { validatePersona(persona()) }).not.toThrow()
  })

  it('rejects an invalid role name', () => {
    expect(codeOf(() => { validatePersona(persona({ name: 'Lead' })) })).toBe(INVALID_PERSONA)
  })

  it('rejects an empty or non-string title', () => {
    expect(codeOf(() => { validatePersona(persona({ title: '' })) })).toBe(INVALID_PERSONA)
    expect(codeOf(() => { validatePersona(persona({ title: '  ' })) })).toBe(INVALID_PERSONA)
    expect(codeOf(() => { validatePersona(persona({ title: 0 as never })) })).toBe(INVALID_PERSONA)
  })

  it('rejects an empty or non-string persona text', () => {
    expect(codeOf(() => { validatePersona(persona({ persona: '' })) })).toBe(INVALID_PERSONA)
    expect(codeOf(() => { validatePersona(persona({ persona: ' \t ' })) })).toBe(INVALID_PERSONA)
    expect(codeOf(() => { validatePersona(persona({ persona: null as never })) })).toBe(INVALID_PERSONA)
  })

  it('rejects an over-long persona text', () => {
    expect(codeOf(() => { validatePersona(persona({ persona: 'x'.repeat(16_385) })) }))
      .toBe(INVALID_PERSONA)
  })

  it('rejects a malformed read-only tool list', () => {
    expect(codeOf(() => { validatePersona(persona({ toolFilter: [''] })) })).toBe(INVALID_PERSONA)
  })
})

describe('validatePersonas', () => {
  it('accepts the default persona set', () => {
    expect(() => { validatePersonas(defaultFleetPersonas()) }).not.toThrow()
  })

  it('rejects an empty set', () => {
    expect(codeOf(() => { validatePersonas([]) })).toBe(INVALID_PERSONA)
  })

  it('rejects a duplicated role name', () => {
    const duplicate = [persona(), persona()]
    expect(codeOf(() => { validatePersonas(duplicate) })).toBe(INVALID_PERSONA)
  })

  it('rejects when one persona is structurally invalid', () => {
    expect(codeOf(() => { validatePersonas([persona({ name: 'bad..name' })]) })).toBe(INVALID_PERSONA)
  })
})

describe('validateReadOnlyTools', () => {
  it('accepts an empty list and a bounded clean list', () => {
    expect(() => { validateReadOnlyTools('red-method', []) }).not.toThrow()
    expect(() => { validateReadOnlyTools('red-method', ['read_file', 'cite_check']) }).not.toThrow()
  })

  it('rejects more than the 256-entry ceiling', () => {
    const tooMany = Array.from({ length: 257 }, (_, index) => `tool-${index}`)
    expect(codeOf(() => { validateReadOnlyTools('red-method', tooMany) })).toBe(INVALID_PERSONA)
  })

  it('rejects a malformed entry (non-string, empty, or un-trimmed)', () => {
    expect(codeOf(() => { validateReadOnlyTools('red-method', [0 as never]) })).toBe(INVALID_PERSONA)
    expect(codeOf(() => { validateReadOnlyTools('red-method', ['   ']) })).toBe(INVALID_PERSONA)
    expect(codeOf(() => { validateReadOnlyTools('red-method', [' read_file ']) })).toBe(INVALID_PERSONA)
  })

  it('rejects a repeated entry', () => {
    expect(codeOf(() => { validateReadOnlyTools('red-method', ['read_file', 'read_file']) }))
      .toBe(INVALID_PERSONA)
  })
})

describe('normalizeReadOnlyTools', () => {
  it('dedupes, sorts, and deep-freezes the allow list', () => {
    const canonical = normalizeReadOnlyTools(['cite_check', 'read_file', 'cite_check'])
    expect(canonical).toEqual(['cite_check', 'read_file'])
    expect(Object.isFrozen(canonical)).toBe(true)
  })

  it('returns an empty frozen list for an empty input', () => {
    expect(normalizeReadOnlyTools([])).toEqual([])
  })

  it('rejects malformed input through the shared validator', () => {
    expect(codeOf(() => { normalizeReadOnlyTools(['', 'read_file']) })).toBe(INVALID_PERSONA)
  })
})

describe('personaCharter', () => {
  it('marks a skeptic persona with its default refute stance', () => {
    const charter = personaCharter(persona({ name: 'red-skeptic', stance: 'skeptic' }))
    expect(charter).toContain('[red-team:red-skeptic]')
    expect(charter).toContain('默认反驳立场')
    expect(charter).toContain('你是自定义审稿人')
  })

  it('marks a balanced persona with the balanced stance', () => {
    const charter = personaCharter(persona({ name: 'red-method', stance: 'balanced' }))
    expect(charter).toContain('平衡立场')
  })
})
