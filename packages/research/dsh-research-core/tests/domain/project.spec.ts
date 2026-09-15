/**
 * Tests for the project header: the ingress parser that reads one off a stored record, and the
 * revision advance that is the whole concurrency control two commits contend on.
 *
 * The acceptance requirement these cases are evidence for is that an unknown vocabulary at a file
 * boundary is refused: a paper type or status this build does not know names stages it cannot run,
 * and a missing recipe version names a workflow the run was not conducted under.
 */

import { describe, expect, it } from 'vitest'

import type { ProjectRevision } from '../../src/domain/ids.ts'
import { PAPER_TYPES, nextProjectRevision, parseProjectIngress } from '../../src/domain/project.ts'
import type { ResearchProject } from '../../src/domain/project.ts'

function validRecord(): Record<string, unknown> {
  return {
    projectId: 'project-1',
    revision: 7,
    paperType: 'experimental',
    recipeId: 'dsh-research',
    recipeVersion: 'recipe-v3',
    status: 'active',
    createdAt: 1_760_000_000_000,
  }
}

/** The valid record with one field replaced, for the field-specific refusals. */
function withField(field: string, value: unknown): Record<string, unknown> {
  return { ...validRecord(), [field]: value }
}

/** Parse the record, failing the case when it was accepted instead of refused. */
function refusalOf(value: unknown) {
  const parsed = parseProjectIngress(value)
  if (parsed.ok) throw new Error('fixture: the project record was accepted and should have been refused')
  return parsed
}

/** Parse the record, failing the case when it was refused instead of accepted. */
function acceptProject(value: unknown): ResearchProject {
  const parsed = parseProjectIngress(value)
  if (!parsed.ok) throw new Error(`fixture: project refused with ${parsed.code}: ${parsed.reason}`)
  return parsed.value
}

describe('parseProjectIngress refuses a record it cannot read', () => {
  const refusals: ReadonlyArray<{
    label: string
    value: unknown
    code: string
    names: readonly string[]
  }> = [
    {
      label: 'a value that is not an object',
      value: 'project',
      code: 'DSH_DOMAIN_NOT_AN_OBJECT',
      names: ['not an object'],
    },
    { label: 'an array', value: [], code: 'DSH_DOMAIN_NOT_AN_OBJECT', names: ['not an object'] },
    {
      label: 'no projectId',
      value: withField('projectId', ''),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['projectId'],
    },
    {
      label: 'no revision',
      value: withField('revision', undefined),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['revision'],
    },
    {
      label: 'a revision that is not an integer',
      value: withField('revision', 7.5),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['revision'],
    },
    {
      label: 'a negative revision',
      value: withField('revision', -1),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['revision'],
    },
    {
      label: 'an unknown paperType',
      value: withField('paperType', 'nonsense'),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['paperType', 'experimental'],
    },
    {
      label: 'a paperType that is absent',
      value: withField('paperType', undefined),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['paperType'],
    },
    {
      label: 'a paperType that differs only in case',
      value: withField('paperType', 'Experimental'),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['paperType'],
    },
    {
      label: 'no recipeId',
      value: withField('recipeId', ''),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['recipeId'],
    },
    {
      label: 'no recipeVersion',
      value: withField('recipeVersion', undefined),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['recipeVersion'],
    },
    {
      label: 'an empty recipeVersion',
      value: withField('recipeVersion', ''),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['recipeVersion'],
    },
    {
      label: 'an unknown status',
      value: withField('status', 'archived'),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['status', 'active', 'stopped'],
    },
    {
      label: 'no createdAt',
      value: withField('createdAt', undefined),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['createdAt'],
    },
    {
      label: 'a createdAt that is not a number',
      value: withField('createdAt', '2026-01-01'),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['createdAt'],
    },
  ]

  for (const testCase of refusals) {
    it(`refuses ${testCase.label}`, () => {
      const failure = refusalOf(testCase.value)
      expect(failure.code).toBe(testCase.code)
      for (const name of testCase.names) expect(failure.reason).toContain(name)
    })
  }
})

describe('parseProjectIngress accepts a declared header', () => {
  it('reads every field of a valid record', () => {
    const project = acceptProject(validRecord())
    expect(project.projectId).toBe('project-1')
    expect(project.revision).toBe(7)
    expect(project.paperType).toBe('experimental')
    expect(project.recipeId).toBe('dsh-research')
    expect(project.recipeVersion).toBe('recipe-v3')
    expect(project.status).toBe('active')
    expect(project.createdAt).toBe(1_760_000_000_000)
  })

  it('accepts every declared paper type and both statuses', () => {
    for (const paperType of PAPER_TYPES) {
      expect(acceptProject(withField('paperType', paperType)).paperType, paperType).toBe(paperType)
    }
    for (const status of ['active', 'stopped'] as const) {
      expect(acceptProject(withField('status', status)).status, status).toBe(status)
    }
  })
})

describe('nextProjectRevision advances by exactly one', () => {
  it('returns the next revision and leaves its argument alone', () => {
    const current = 7 as ProjectRevision
    expect(nextProjectRevision(current)).toBe(8)
    expect(current).toBe(7)
    expect(nextProjectRevision(0 as ProjectRevision)).toBe(1)
  })

  it('is a pure function: two readers of one revision compute the same next one', () => {
    // This is what lets a store refuse the second of two commits that read the same revision —
    // the two compute one value, and only one of them can write it.
    const read = 12 as ProjectRevision
    expect(nextProjectRevision(read)).toBe(nextProjectRevision(read))
    expect(nextProjectRevision(nextProjectRevision(read))).toBe(14)
  })
})
