// @deepseek-ai/dsh-research-team — revision.ts pure CAS spec.
//
// Covers the frozen T20 §5 pure-logic checklist for revision.ts:
//   - CAS accept / stale-reject (assertExpectedRevision + applyTaskAction),
//   - authorization matrix (owner vs lead vs unrelated member),
//   - claim only when ready (pending + all blockers completed),
//   - writeScope normalization + overlap-only-warn semantics,
//   - blockedBy cycle detection (self / mutual / chain / dangling).
// Every rejection is asserted by its DSH_RESEARCH_TEAM_ error code.

import { describe, expect, it } from 'vitest'
import {
  applyTaskAction,
  assertExpectedRevision,
  nextSnapshot,
  normalizeScope,
  normalizeWriteScopes,
  overlapOnlyWarn,
  scopeContains,
} from '../src/revision.ts'
import type { TaskActor, TaskMutationInput } from '../src/revision.ts'
import type { ResearchTask, SessionId } from '../src/types.ts'
import { ResearchTeamError, sessionId, taskId } from '../src/types.ts'

const M1 = sessionId('member-1')
const M2 = sessionId('member-2')
const LEAD = sessionId('lead')

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

/** Build a task snapshot; ownerId present only when provided (exactOptional). */
function task(
  id: string,
  patch: {
    revision?: number
    status?: ResearchTask['status']
    owner?: SessionId
    blockedBy?: ReadonlyArray<string>
    writeScopes?: ReadonlyArray<string>
    subject?: string
  } = {},
): ResearchTask {
  const owner = patch.owner === undefined ? {} : { ownerId: patch.owner }
  return {
    id: taskId(id),
    revision: patch.revision ?? 0,
    subject: patch.subject ?? `subject-${id}`,
    description: `description-${id}`,
    status: patch.status ?? 'pending',
    ...owner,
    blockedBy: (patch.blockedBy ?? []).map(id => taskId(id)),
    writeScopes: patch.writeScopes ?? [],
  }
}

const member = (id: SessionId): TaskActor => ({ role: 'teammate', id })
const lead = (id: SessionId = LEAD): TaskActor => ({ role: 'lead', id })

function mutate(
  board: ReadonlyArray<ResearchTask>,
  input: Omit<TaskMutationInput, 'board'>,
): ResearchTask {
  return applyTaskAction({ ...input, board })
}

describe('normalizeScope', () => {
  it('trims, converts backslashes, collapses slashes and drops trailing slashes', () => {
    expect(normalizeScope('  drafts/  ')).toBe('drafts')
    expect(normalizeScope('a\\b//c/./d/')).toBe('a/b/c/d')
    expect(normalizeScope('./drafts')).toBe('drafts')
  })

  it('rejects empty results and dot segments', () => {
    expect(codeOf(() => normalizeScope(''))).toBe('DSH_RESEARCH_TEAM_INVALID_SCOPE')
    expect(codeOf(() => normalizeScope('///'))).toBe('DSH_RESEARCH_TEAM_INVALID_SCOPE')
    expect(codeOf(() => normalizeScope('.'))).toBe('DSH_RESEARCH_TEAM_INVALID_SCOPE')
  })

  it('rejects .. traversal segments', () => {
    expect(codeOf(() => normalizeScope('a/../b'))).toBe('DSH_RESEARCH_TEAM_INVALID_SCOPE')
  })

  it('rejects non-string input', () => {
    expect(codeOf(() => normalizeScope(42 as unknown as string))).toBe('DSH_RESEARCH_TEAM_INVALID_SCOPE')
  })
})

describe('normalizeWriteScopes', () => {
  it('deduplicates and sorts into a canonical frozen list', () => {
    const result = normalizeWriteScopes(['figures/', 'drafts', 'drafts'])
    expect([...result]).toEqual(['drafts', 'figures'])
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('returns an empty frozen list for no scopes', () => {
    const result = normalizeWriteScopes([])
    expect([...result]).toEqual([])
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('propagates invalid entries', () => {
    expect(codeOf(() => normalizeWriteScopes(['ok', '..']))).toBe('DSH_RESEARCH_TEAM_INVALID_SCOPE')
  })
})

describe('scopeContains / overlapOnlyWarn', () => {
  it('treats an empty parent as containing nothing', () => {
    expect(scopeContains('', 'a')).toBe(false)
  })

  it('contains equal paths and directory descendants', () => {
    expect(scopeContains('drafts', 'drafts')).toBe(true)
    expect(scopeContains('drafts', 'drafts/a.md')).toBe(true)
    expect(scopeContains('drafts/', 'drafts/a.md')).toBe(true)
  })

  it('rejects siblings and disjoint paths', () => {
    expect(scopeContains('drafts', 'drafts2')).toBe(false)
    expect(scopeContains('a', 'b')).toBe(false)
  })

  it('warns on exact overlap and on either containment direction', () => {
    expect(overlapOnlyWarn('drafts', 'drafts')).toBe(true)
    expect(overlapOnlyWarn('x/y', 'x')).toBe(true)
    expect(overlapOnlyWarn('x', 'x/y')).toBe(true)
  })

  it('stays silent on disjoint scopes', () => {
    expect(overlapOnlyWarn('a/b', 'a/c')).toBe(false)
  })
})

describe('assertExpectedRevision', () => {
  it('accepts a matching expected revision', () => {
    const current = task('t1', { revision: 3 })
    expect(assertExpectedRevision(current, 3)).toBe(current)
  })

  it('rejects a stale expected revision', () => {
    const current = task('t1', { revision: 3 })
    expect(codeOf(() => assertExpectedRevision(current, 2))).toBe('DSH_RESEARCH_TEAM_REVISION_CONFLICT')
  })

  it('rejects when no current snapshot exists', () => {
    expect(codeOf(() => assertExpectedRevision(undefined, 0))).toBe('DSH_RESEARCH_TEAM_TASK_NOT_FOUND')
  })
})

describe('nextSnapshot', () => {
  it('bumps the revision by one and deep-freezes an independent copy', () => {
    const scopes = ['drafts']
    const blockers = [taskId('b')]
    const current = task('t1', { revision: 4, owner: M1, writeScopes: scopes, blockedBy: [] })
    const next = nextSnapshot(current, { subject: 'new subject', blockedBy: blockers })
    expect(next.revision).toBe(5)
    expect(next.subject).toBe('new subject')
    expect(next.ownerId).toBe(M1)
    expect([...next.blockedBy]).toEqual([blockers[0]])
    expect(Object.isFrozen(next)).toBe(true)
    expect(Object.isFrozen(next.blockedBy)).toBe(true)
    // Freeze is a clone, not a mutating alias of the input.
    expect(Object.isFrozen(scopes)).toBe(false)
  })

  it('sets, keeps and clears the owner through the ownerId patch', () => {
    const owned = task('t1', { owner: M1, revision: 1 })
    expect(nextSnapshot(owned, { description: 'keep owner' }).ownerId).toBe(M1)
    const cleared = nextSnapshot(owned, { ownerId: null })
    expect(cleared.ownerId).toBeUndefined()
    expect('ownerId' in cleared).toBe(false)
    const retargeted = nextSnapshot(owned, { ownerId: M2 })
    expect(retargeted.ownerId).toBe(M2)
  })

  it('overrides status and replaces arrays', () => {
    const current = task('t1', { status: 'pending', writeScopes: ['a'], blockedBy: [] })
    const next = nextSnapshot(current, {
      status: 'completed',
      writeScopes: ['a', 'b'],
    })
    expect(next.status).toBe('completed')
    expect([...next.writeScopes]).toEqual(['a', 'b'])
  })
})

describe('applyTaskAction — claim', () => {
  it('claims a ready pending task for the acting member', () => {
    const t = task('t1')
    const next = mutate([t], {
      action: 'claim',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M1),
      writeScopes: ['drafts', 'figures/'],
    })
    expect(next.status).toBe('in_progress')
    expect(next.ownerId).toBe(M1)
    expect(next.revision).toBe(1)
    expect([...next.writeScopes]).toEqual(['drafts', 'figures'])
  })

  it('rejects a claim by the lead (members claim work)', () => {
    expect(codeOf(() => mutate([task('t1')], {
      action: 'claim',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: lead(),
    }))).toBe('DSH_RESEARCH_TEAM_NOT_AUTHORIZED')
  })

  it('rejects a claim on a non-pending task', () => {
    const board = [task('t1', { status: 'completed' })]
    expect(codeOf(() => mutate(board, {
      action: 'claim',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M1),
    }))).toBe('DSH_RESEARCH_TEAM_INVALID_STATUS')
  })

  it('rejects a claim whose blockers are not all completed', () => {
    const t1 = task('t1', { blockedBy: ['b1'] })
    const b1 = task('b1', { status: 'pending' })
    expect(codeOf(() => mutate([t1, b1], {
      action: 'claim',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M1),
    }))).toBe('DSH_RESEARCH_TEAM_CLAIM_NOT_READY')
  })

  it('rejects a claim whose blocker is missing from the board', () => {
    expect(codeOf(() => mutate([task('t1', { blockedBy: ['ghost'] })], {
      action: 'claim',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M1),
    }))).toBe('DSH_RESEARCH_TEAM_TASK_NOT_FOUND')
  })

  it('allows a claim when every blocker is completed', () => {
    const t1 = task('t1', { blockedBy: ['b1'] })
    const b1 = task('b1', { status: 'completed', revision: 1 })
    const next = mutate([t1, b1], {
      action: 'claim',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M1),
    })
    expect(next.status).toBe('in_progress')
    expect(next.ownerId).toBe(M1)
  })

  it('enforces one active in_progress task per member (single write task)', () => {
    const active = task('t1', { status: 'in_progress', owner: M1 })
    const ready = task('t2')
    expect(codeOf(() => mutate([active, ready], {
      action: 'claim',
      taskId: taskId('t2'),
      expectedRevision: 0,
      actor: member(M1),
    }))).toBe('DSH_RESEARCH_TEAM_ACTIVE_TASK_CONFLICT')
  })
})

describe('applyTaskAction — authorization matrix (owner vs lead vs unrelated)', () => {
  it('edit: owner and lead may edit, unrelated member is rejected, deleted is immutable', () => {
    const owned = task('t1', { status: 'in_progress', owner: M1 })
    expect(mutate([owned], {
      action: 'edit',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M1),
      subject: 'by owner',
    }).subject).toBe('by owner')
    expect(mutate([owned], {
      action: 'edit',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: lead(),
      subject: 'by lead',
    }).subject).toBe('by lead')
    expect(codeOf(() => mutate([owned], {
      action: 'edit',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M2),
      subject: 'sneak',
    }))).toBe('DSH_RESEARCH_TEAM_NOT_AUTHORIZED')
    const deleted = task('t1', { status: 'deleted', owner: M1 })
    expect(codeOf(() => mutate([deleted], {
      action: 'edit',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: lead(),
    }))).toBe('DSH_RESEARCH_TEAM_TASK_DELETED')
  })

  it('edit: rejects unrelated members even when the task has no owner yet', () => {
    expect(codeOf(() => mutate([task('t1')], {
      action: 'edit',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M2),
      subject: 'sneak',
    }))).toBe('DSH_RESEARCH_TEAM_NOT_AUTHORIZED')
  })

  it('edit: applies a description patch', () => {
    const owned = task('t1', { status: 'in_progress', owner: M1 })
    const next = mutate([owned], {
      action: 'edit',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M1),
      description: 'description v2',
    })
    expect(next.description).toBe('description v2')
  })

  it('edit: normalizes provided writeScopes', () => {
    const owned = task('t1', { status: 'in_progress', owner: M1 })
    const next = mutate([owned], {
      action: 'edit',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M1),
      writeScopes: ['a', 'a/'],
    })
    expect([...next.writeScopes]).toEqual(['a'])
  })

  it('complete: owner/lead complete; unrelated rejected; non-in_progress rejected', () => {
    const owned = task('t1', { status: 'in_progress', owner: M1 })
    expect(mutate([owned], {
      action: 'complete',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M1),
    }).status).toBe('completed')
    expect(codeOf(() => mutate([owned], {
      action: 'complete',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M2),
    }))).toBe('DSH_RESEARCH_TEAM_NOT_AUTHORIZED')
    const pending = task('t1', { owner: M1 })
    expect(codeOf(() => mutate([pending], {
      action: 'complete',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M1),
    }))).toBe('DSH_RESEARCH_TEAM_INVALID_STATUS')
  })

  it('release: owner releases to pending and clears owner/scopes; lead may release', () => {
    const owned = task('t1', { status: 'in_progress', owner: M1, writeScopes: ['drafts'] })
    const next = mutate([owned], {
      action: 'release',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M1),
    })
    expect(next.status).toBe('pending')
    expect(next.ownerId).toBeUndefined()
    expect([...next.writeScopes]).toEqual([])
    expect(codeOf(() => mutate([owned], {
      action: 'release',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M2),
    }))).toBe('DSH_RESEARCH_TEAM_NOT_AUTHORIZED')
    expect(codeOf(() => mutate([task('t1', { owner: M1 })], {
      action: 'release',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: lead(),
    }))).toBe('DSH_RESEARCH_TEAM_INVALID_STATUS')
  })

  it('reopen: completed → pending with owner cleared; pending reopen rejected', () => {
    const completed = task('t1', { status: 'completed', owner: M1 })
    const reopened = mutate([completed], {
      action: 'reopen',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M1),
    })
    expect(reopened.status).toBe('pending')
    expect(reopened.ownerId).toBeUndefined()
    expect(codeOf(() => mutate([task('t1')], {
      action: 'reopen',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: lead(),
    }))).toBe('DSH_RESEARCH_TEAM_INVALID_STATUS')
  })

  it('reassign: owner/lead may move an in_progress task to another member', () => {
    const owned = task('t1', { status: 'in_progress', owner: M1 })
    const next = mutate([owned], {
      action: 'reassign',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: lead(),
      newOwnerId: M2,
    })
    expect(next.ownerId).toBe(M2)
    expect(codeOf(() => mutate([owned], {
      action: 'reassign',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M2),
      newOwnerId: M2,
    }))).toBe('DSH_RESEARCH_TEAM_NOT_AUTHORIZED')
    expect(codeOf(() => mutate([owned], {
      action: 'reassign',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M1),
    }))).toBe('DSH_RESEARCH_TEAM_NOT_AUTHORIZED')
    expect(codeOf(() => mutate([task('t1')], {
      action: 'reassign',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: lead(),
      newOwnerId: M2,
    }))).toBe('DSH_RESEARCH_TEAM_INVALID_STATUS')
  })

  it('reassign: target member must not already hold an active write task', () => {
    const t1 = task('t1', { status: 'in_progress', owner: M1 })
    const other = task('t2', { status: 'in_progress', owner: M2 })
    expect(codeOf(() => mutate([t1, other], {
      action: 'reassign',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M1),
      newOwnerId: M2,
    }))).toBe('DSH_RESEARCH_TEAM_ACTIVE_TASK_CONFLICT')
  })

  it('delete: owner/lead delete to a terminal tombstone; double delete rejected', () => {
    const owned = task('t1', { status: 'in_progress', owner: M1 })
    const next = mutate([owned], {
      action: 'delete',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M1),
    })
    expect(next.status).toBe('deleted')
    expect(codeOf(() => mutate([next], {
      action: 'delete',
      taskId: taskId('t1'),
      expectedRevision: 1,
      actor: member(M1),
    }))).toBe('DSH_RESEARCH_TEAM_TASK_DELETED')
    expect(codeOf(() => mutate([owned], {
      action: 'delete',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M2),
    }))).toBe('DSH_RESEARCH_TEAM_NOT_AUTHORIZED')
  })
})

describe('applyTaskAction — stale CAS rejection', () => {
  it('rejects any mutation built on a stale revision', () => {
    const current = task('t1', { status: 'in_progress', owner: M1, revision: 4 })
    expect(codeOf(() => mutate([current], {
      action: 'release',
      taskId: taskId('t1'),
      expectedRevision: 3,
      actor: member(M1),
    }))).toBe('DSH_RESEARCH_TEAM_REVISION_CONFLICT')
    expect(codeOf(() => mutate([], {
      action: 'release',
      taskId: taskId('missing'),
      expectedRevision: 0,
      actor: member(M1),
    }))).toBe('DSH_RESEARCH_TEAM_TASK_NOT_FOUND')
  })
})

describe('applyTaskAction — blockedBy cycle detection', () => {
  it('accepts acyclic dependency chains', () => {
    const a = task('a')
    const b = task('b', { blockedBy: ['a'] })
    const c = task('c', { blockedBy: ['b'] })
    const next = mutate([a, b, c], {
      action: 'set_dependencies',
      taskId: taskId('c'),
      expectedRevision: 0,
      actor: lead(),
      blockedBy: ['a', 'b'],
    })
    expect([...next.blockedBy]).toEqual([taskId('a'), taskId('b')])
  })

  it('rejects a self-dependency', () => {
    const a = task('a')
    expect(codeOf(() => mutate([a], {
      action: 'set_dependencies',
      taskId: taskId('a'),
      expectedRevision: 0,
      actor: lead(),
      blockedBy: ['a'],
    }))).toBe('DSH_RESEARCH_TEAM_DEPENDENCY_CYCLE')
  })

  it('rejects a mutual cycle', () => {
    const t1 = task('t1')
    const t2 = task('t2', { blockedBy: ['t1'] })
    expect(codeOf(() => mutate([t1, t2], {
      action: 'set_dependencies',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: lead(),
      blockedBy: ['t2'],
    }))).toBe('DSH_RESEARCH_TEAM_DEPENDENCY_CYCLE')
  })

  it('rejects missing and deleted blockers', () => {
    const t = task('t1')
    expect(codeOf(() => mutate([t], {
      action: 'set_dependencies',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: lead(),
      blockedBy: ['ghost'],
    }))).toBe('DSH_RESEARCH_TEAM_TASK_NOT_FOUND')
    const deleted = task('gone', { status: 'deleted' })
    expect(codeOf(() => mutate([t, deleted], {
      action: 'set_dependencies',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: lead(),
      blockedBy: ['gone'],
    }))).toBe('DSH_RESEARCH_TEAM_TASK_DELETED')
  })

  it('rejects set_dependencies on a deleted task and by unrelated members', () => {
    const deleted = task('gone', { status: 'deleted' })
    expect(codeOf(() => mutate([deleted], {
      action: 'set_dependencies',
      taskId: taskId('gone'),
      expectedRevision: 0,
      actor: lead(),
    }))).toBe('DSH_RESEARCH_TEAM_TASK_DELETED')
    const owned = task('t1', { status: 'in_progress', owner: M1 })
    expect(codeOf(() => mutate([owned], {
      action: 'set_dependencies',
      taskId: taskId('t1'),
      expectedRevision: 0,
      actor: member(M2),
    }))).toBe('DSH_RESEARCH_TEAM_NOT_AUTHORIZED')
  })

  it('tolerates a dangling blocker on an unrelated task (no cycle from it)', () => {
    // t2 carries a stale blocker on a task id that is not on the board; the
    // cycle walk must terminate on the dangling id instead of recursing.
    const t4 = task('t4')
    const t5 = task('t5', { blockedBy: ['ghost'] })
    const next = mutate([t4, t5], {
      action: 'set_dependencies',
      taskId: taskId('t4'),
      expectedRevision: 0,
      actor: lead(),
      blockedBy: ['t5'],
    })
    expect([...next.blockedBy]).toEqual([taskId('t5')])
  })

  it('clears the blocker set when no blockedBy list is supplied', () => {
    const a = task('a', { blockedBy: ['b'] })
    const b = task('b')
    const next = mutate([a, b], {
      action: 'set_dependencies',
      taskId: taskId('a'),
      expectedRevision: 0,
      actor: lead(),
    })
    expect([...next.blockedBy]).toEqual([])
  })
})
