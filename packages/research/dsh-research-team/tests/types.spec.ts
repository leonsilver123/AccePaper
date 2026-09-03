// @deepseek-ai/dsh-research-team — types.ts shared helpers spec.
//
// Pins the pure shared layer of the frozen T20 spec §1/§2:
//   - TeamId() / sessionId() / taskId() brand non-empty ids and reject empty /
//     whitespace-only input with the package error prefix,
//   - ResearchTeamError carries a globally unique `code`, a `[code] message`
//     payload and an optional `cause`,
//   - researchTeamError() throws the canonical prefixed error,
//   - freezeValue() clone-first deep-freezes structured-cloneable values so no
//     live reference escapes and the caller's object is never frozen.
// types.ts itself is excluded from the per-file coverage gate (types-only
// source), but the helper behavior it exports is what every sibling module
// builds on, so it is pinned here.

import { describe, expect, it } from 'vitest'
import {
  DSH_RESEARCH_TEAM_ERROR_PREFIX,
  ResearchTeamError,
  TeamId,
  freezeValue,
  researchTeamError,
  sessionId,
  taskId,
} from '../src/types.ts'

/** Code of the ResearchTeamError thrown by `fn`, or undefined when none. */
function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (error) {
    return error instanceof ResearchTeamError ? error.code : undefined
  }
  return undefined
}

describe('brand helpers', () => {
  it('TeamId() / sessionId() / taskId() brand their input by identity', () => {
    expect(TeamId('root-1')).toBe('root-1')
    expect(sessionId('agent-1')).toBe('agent-1')
    expect(taskId('task-1')).toBe('task-1')
  })

  it('rejects empty and whitespace-only input with the matching code', () => {
    expect(codeOf(() => TeamId(''))).toBe(`${DSH_RESEARCH_TEAM_ERROR_PREFIX}INVALID_TEAM_ID`)
    expect(codeOf(() => TeamId('   '))).toBe(`${DSH_RESEARCH_TEAM_ERROR_PREFIX}INVALID_TEAM_ID`)
    expect(codeOf(() => sessionId(''))).toBe(`${DSH_RESEARCH_TEAM_ERROR_PREFIX}INVALID_SESSION_ID`)
    expect(codeOf(() => sessionId('  '))).toBe(`${DSH_RESEARCH_TEAM_ERROR_PREFIX}INVALID_SESSION_ID`)
    expect(codeOf(() => taskId(''))).toBe(`${DSH_RESEARCH_TEAM_ERROR_PREFIX}INVALID_TASK_ID`)
    expect(codeOf(() => taskId('\t'))).toBe(`${DSH_RESEARCH_TEAM_ERROR_PREFIX}INVALID_TASK_ID`)
  })

  it('keeps surrounding whitespace in the branded value (only empties are rejected)', () => {
    expect(sessionId('  padded  ')).toBe('  padded  ')
  })
})

describe('ResearchTeamError', () => {
  it('carries the globally unique code, a bracketed message and the Error name', () => {
    const code = `${DSH_RESEARCH_TEAM_ERROR_PREFIX}REVISION_CONFLICT`
    const error = new ResearchTeamError(code, 'task t1 is stale')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(ResearchTeamError)
    expect(error.name).toBe('ResearchTeamError')
    expect(error.code).toBe(code)
    expect(error.message).toBe(`[${code}] task t1 is stale`)
  })

  it('attaches the cause only when one is provided', () => {
    const root = new Error('root cause')
    const withCause = new ResearchTeamError(`${DSH_RESEARCH_TEAM_ERROR_PREFIX}INVALID_EVENT`, 'bad event', root)
    expect(withCause.cause).toBe(root)
    const withoutCause = new ResearchTeamError(`${DSH_RESEARCH_TEAM_ERROR_PREFIX}INVALID_EVENT`, 'bad event')
    expect('cause' in withoutCause).toBe(false)
  })
})

describe('researchTeamError', () => {
  it('throws a ResearchTeamError with the prefixed suffix code', () => {
    expect(codeOf(() => researchTeamError('DEPENDENCY_CYCLE', 'blocker set closes a cycle'))).toBe(
      `${DSH_RESEARCH_TEAM_ERROR_PREFIX}DEPENDENCY_CYCLE`,
    )
  })
})

describe('freezeValue', () => {
  it('clone-first deep-freezes a nested structure and leaves the source mutable', () => {
    const source = { tags: ['a', 'b'], meta: { n: 1 } }
    const frozen = freezeValue(source)
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.tags)).toBe(true)
    expect(Object.isFrozen(frozen.meta)).toBe(true)
    expect(Object.isFrozen(source)).toBe(false)
    // The source is independent of the frozen snapshot.
    source.tags.push('c')
    expect([...frozen.tags]).toEqual(['a', 'b'])
  })

  it('freezes arrays element-deep', () => {
    const frozen = freezeValue([{ n: 1 }])
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen[0])).toBe(true)
  })

  it('passes primitives through unchanged', () => {
    expect(freezeValue(5)).toBe(5)
    expect(freezeValue('x')).toBe('x')
  })
})
