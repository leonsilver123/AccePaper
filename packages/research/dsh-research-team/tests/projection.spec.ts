// @deepseek-ai/dsh-research-team — projection.ts pure fold reducer spec.
//
// Covers the frozen T20 §5 pure-logic checklist for projection.ts:
//   - createTeamState builds an empty frozen per-team projection,
//   - member / task / rev whole-value events fold into the state by id,
//   - task and rev revisions are monotonic (stale / duplicate events drop),
//   - a deleted task is a terminal tombstone (no later event resurrects it),
//   - re-folding an already-applied log is idempotent,
//   - every stored snapshot is an independent deep-frozen clone,
//   - events targeting another team are rejected (TEAM_MISMATCH),
//   - unknown (impossible) event variants leave the state untouched.
// Every rejection is asserted by its DSH_RESEARCH_TEAM_ error code.

import { describe, expect, it } from 'vitest'
import { createTeamState, foldTeamEvents, reduceTeamState } from '../src/projection.ts'
import type { ResearchEvent, ResearchMember, ResearchRev, ResearchTask } from '../src/types.ts'
import { ResearchTeamError, TeamId, sessionId, taskId } from '../src/types.ts'

const TEAM = TeamId('team-1')
const OTHER_TEAM = TeamId('team-other')
const M1 = sessionId('member-1')
const T1 = taskId('t1')

/** Code of the ResearchTeamError thrown by `fn`, or undefined when none. */
function errorCodeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (error) {
    return error instanceof ResearchTeamError ? error.code : undefined
  }
  return undefined
}

function codeOf(fn: () => unknown): string {
  const code = errorCodeOf(fn)
  if (code === undefined) throw new Error('expected a ResearchTeamError but none was thrown')
  return code
}

function member(patch: { name?: string; phase?: ResearchMember['phase'] } = {}): ResearchMember {
  return {
    id: M1,
    name: patch.name ?? 'name-member-1',
    description: 'desc-member-1',
    provider: 'test',
    context: 'fresh',
    phase: patch.phase ?? 'active',
  }
}

function task(
  id: string,
  patch: {
    revision?: number
    status?: ResearchTask['status']
    owner?: ResearchTask['ownerId']
    blockedBy?: ReadonlyArray<string>
    writeScopes?: ReadonlyArray<string>
  } = {},
): ResearchTask {
  const owner = patch.owner === undefined ? {} : { ownerId: patch.owner }
  return {
    id: taskId(id),
    revision: patch.revision ?? 0,
    subject: `subject-${id}`,
    description: `description-${id}`,
    status: patch.status ?? 'pending',
    ...owner,
    blockedBy: (patch.blockedBy ?? []).map(id => taskId(id)),
    writeScopes: patch.writeScopes ?? [],
  }
}

function rev(artifactId: string, revision: number): ResearchRev {
  return {
    artifactId,
    revision,
    prevRevision: revision - 1,
    kind: 'file',
    path: `${artifactId}#${revision}`,
    hash: `h-${revision}`,
  }
}

const memberEvent = (teamId: ReturnType<typeof TeamId>, m: ResearchMember) => ({
  type: 'research/member' as const,
  version: 1 as const,
  teamId,
  member: m,
})
const taskEvent = (teamId: ReturnType<typeof TeamId>, t: ResearchTask) => ({
  type: 'research/task' as const,
  version: 1 as const,
  teamId,
  task: t,
})
const revEvent = (teamId: ReturnType<typeof TeamId>, r: ResearchRev) => ({
  type: 'research/rev' as const,
  version: 1 as const,
  teamId,
  rev: r,
})

describe('createTeamState', () => {
  it('builds an empty, deep-frozen state for the team', () => {
    const state = createTeamState(TEAM)
    expect(state.teamId).toBe(TEAM)
    expect(state.members).toEqual({})
    expect(state.tasks).toEqual({})
    expect(state.artifactRevs).toEqual({})
    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(state.members)).toBe(true)
    expect(Object.isFrozen(state.tasks)).toBe(true)
    expect(Object.isFrozen(state.artifactRevs)).toBe(true)
  })
})

describe('reduceTeamState — member events', () => {
  it('accumulates members by id with last snapshot winning', () => {
    const state = foldTeamEvents(createTeamState(TEAM), [
      memberEvent(TEAM, member({ name: 'first' })),
      memberEvent(TEAM, member({ name: 'renamed', phase: 'failed' })),
    ])
    expect(state.members[M1]!.name).toBe('renamed')
    expect(state.members[M1]!.phase).toBe('failed')
  })

  it('stores each member snapshot as an independent frozen clone', () => {
    const source = member()
    const state = reduceTeamState(createTeamState(TEAM), memberEvent(TEAM, source))
    const stored = state.members[M1]!
    expect(Object.isFrozen(stored)).toBe(true)
    source.name = 'mutated-after-fold'
    expect(stored.name).toBe('name-member-1')
  })
})

describe('reduceTeamState — task events', () => {
  it('accepts the first snapshot of a task even at revision 0, then newer revisions replace it', () => {
    const state = foldTeamEvents(createTeamState(TEAM), [
      taskEvent(TEAM, task('t1', { revision: 0, status: 'pending' })),
      taskEvent(TEAM, task('t1', { revision: 2, status: 'in_progress', owner: M1 })),
    ])
    expect(state.tasks[T1]!.status).toBe('in_progress')
    expect(state.tasks[T1]!.revision).toBe(2)
  })

  it('drops stale or duplicate snapshots — revisions only move forward', () => {
    const state = foldTeamEvents(createTeamState(TEAM), [
      taskEvent(TEAM, task('t1', { revision: 3, status: 'in_progress', owner: M1 })),
      taskEvent(TEAM, task('t1', { revision: 3, status: 'completed' })),
      taskEvent(TEAM, task('t1', { revision: 2, status: 'pending' })),
    ])
    expect(state.tasks[T1]!.revision).toBe(3)
    expect(state.tasks[T1]!.status).toBe('in_progress')
  })

  it('a deleted task is a terminal tombstone: nothing resurrects it', () => {
    const state = foldTeamEvents(createTeamState(TEAM), [
      taskEvent(TEAM, task('t1', { revision: 2, status: 'deleted' })),
      // A much newer event still cannot bring the id back to life.
      taskEvent(TEAM, task('t1', { revision: 5, status: 'pending', owner: M1 })),
    ])
    expect(state.tasks[T1]!.status).toBe('deleted')
    expect(state.tasks[T1]!.revision).toBe(2)
  })

  it('stores the task snapshot as an independent frozen clone', () => {
    const sourceScopes = ['drafts']
    const source = task('t1', { writeScopes: sourceScopes })
    const state = reduceTeamState(createTeamState(TEAM), taskEvent(TEAM, source))
    const stored = state.tasks[T1]!
    expect(Object.isFrozen(stored)).toBe(true)
    expect(Object.isFrozen(stored.blockedBy)).toBe(true)
    sourceScopes.push('mutated-after-fold')
    expect([...stored.writeScopes]).toEqual(['drafts'])
  })

  it('re-folding an already-applied log is idempotent', () => {
    const events: ReadonlyArray<ResearchEvent> = [
      memberEvent(TEAM, member()),
      taskEvent(TEAM, task('t1', { revision: 1, status: 'completed', owner: M1 })),
      taskEvent(TEAM, task('t2', { revision: 2, status: 'deleted' })),
      revEvent(TEAM, rev('doc.md', 1)),
    ]
    const empty = createTeamState(TEAM)
    const once = foldTeamEvents(empty, events)
    const twice = foldTeamEvents(once, events)
    expect(twice).toEqual(once)
  })

  it('folding an empty event list returns the same state object', () => {
    const empty = createTeamState(TEAM)
    expect(foldTeamEvents(empty, [])).toBe(empty)
  })
})

describe('reduceTeamState — rev events', () => {
  it('keeps the highest-revision head per artifact and ignores stale rev events', () => {
    const state = foldTeamEvents(createTeamState(TEAM), [
      revEvent(TEAM, rev('doc.md', 1)),
      revEvent(TEAM, rev('doc.md', 3)),
      revEvent(TEAM, rev('doc.md', 2)),
      revEvent(TEAM, rev('other.md', 1)),
    ])
    expect(state.artifactRevs['doc.md']!.revision).toBe(3)
    expect(state.artifactRevs['other.md']!.revision).toBe(1)
    expect(Object.isFrozen(state.artifactRevs['doc.md']!)).toBe(true)
  })
})

describe('reduceTeamState — team mismatch and closed union', () => {
  it('rejects member, task and rev events that target another team', () => {
    const state = createTeamState(TEAM)
    expect(codeOf(() => reduceTeamState(state, memberEvent(OTHER_TEAM, member())))).toBe(
      'DSH_RESEARCH_TEAM_TEAM_MISMATCH',
    )
    expect(codeOf(() => reduceTeamState(state, taskEvent(OTHER_TEAM, task('t1'))))).toBe(
      'DSH_RESEARCH_TEAM_TEAM_MISMATCH',
    )
    expect(codeOf(() => reduceTeamState(state, revEvent(OTHER_TEAM, rev('doc.md', 1))))).toBe(
      'DSH_RESEARCH_TEAM_TEAM_MISMATCH',
    )
  })

  it('folds unknown (impossible) event variants into an unchanged state', () => {
    const initial = createTeamState(TEAM)
    const bogus = { type: 'research/bogus', version: 1, teamId: TEAM } as unknown as ResearchEvent
    expect(reduceTeamState(initial, bogus)).toBe(initial)
  })
})
