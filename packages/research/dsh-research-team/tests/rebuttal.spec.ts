// @deepseek-ai/dsh-research-team — rebuttal.ts pure spec (T21 §0 / §5).
//
// Pins the message→AdjudicationVote contract and the round state machine
// pending → submitted → completed (idempotent at the terminal edge): unknown
// roles, duplicate votes, malformed payloads, and empty-round closes all carry
// typed ResearchTeamError codes. The module imports nothing from ctx / host.

import { describe, expect, it } from 'vitest'
import {
  DSH_RESEARCH_TEAM_ERROR_PREFIX,
  sessionId,
} from '../src/types.ts'
import type { ResearchTeamErrorSuffix } from '../src/types.ts'
import {
  adjudicationVotes,
  allRolesVoted,
  castRebuttalVote,
  closeRebuttalRound,
  createRebuttalRound,
  parseRebuttalPosition,
  parseRebuttalVote,
  REBUTTAL_POSITION_VALUES,
  REBUTTAL_ROUND_STATUSES,
} from '../src/redteam/rebuttal.ts'
import type { RebuttalRound } from '../src/redteam/rebuttal.ts'

const PREFIX = DSH_RESEARCH_TEAM_ERROR_PREFIX

/** Expect `fn` to throw a ResearchTeamError with one exact suffix code. */
function expectCode(fn: () => unknown, suffix: ResearchTeamErrorSuffix): void {
  expect(fn).toThrow(expect.objectContaining({ code: `${PREFIX}${suffix}` }))
}

/** A structurally valid raw vote message body. */
function voteMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    voterRole: 'red-method',
    position: 'support',
    rationale: '方法学设计无致命缺陷',
    ...overrides,
  }
}

/** A canonical pending round over two roles, like the orchestrator opens. */
function openRound(overrides: Partial<RebuttalRound> = {}): RebuttalRound {
  return createRebuttalRound({
    roundId: 'round-1',
    claimRef: 'claim-X',
    gate: 'A2',
    expectedRoles: ['red-method', 'red-stat'],
    ...overrides,
  })
}

describe('constants', () => {
  it('mirrors the domain union and round statuses at runtime', () => {
    expect(REBUTTAL_POSITION_VALUES).toEqual(['support', 'refute', 'abstain'])
    expect(REBUTTAL_ROUND_STATUSES).toEqual(['pending', 'submitted', 'completed'])
  })
})

describe('parseRebuttalPosition', () => {
  it('accepts every legal position', () => {
    for (const position of REBUTTAL_POSITION_VALUES) {
      expect(parseRebuttalPosition(position)).toBe(position)
    }
  })

  it('rejects an illegal position with undefined', () => {
    expect(parseRebuttalPosition('maybe')).toBeUndefined()
    expect(parseRebuttalPosition(undefined)).toBeUndefined()
    expect(parseRebuttalPosition(42)).toBeUndefined()
  })
})

describe('parseRebuttalVote', () => {
  it('parses a structurally valid vote message', () => {
    const parsed = parseRebuttalVote(voteMessage())
    expect(parsed).toEqual({
      voterRole: 'red-method',
      position: 'support',
      rationale: '方法学设计无致命缺陷',
    })
  })

  it('trims text fields and carries an optional modelFamily', () => {
    const parsed = parseRebuttalVote(voteMessage({
      voterRole: '  red-stat  ',
      rationale: '  统计方法稳健  ',
      modelFamily: ' deepseek-v3 ',
    }))
    expect(parsed).toEqual({
      voterRole: 'red-stat',
      position: 'support',
      rationale: '统计方法稳健',
      modelFamily: 'deepseek-v3',
    })
  })

  it('rejects a non-object message', () => {
    expectCode(() => parseRebuttalVote('nope'), 'INVALID_REBUTTAL')
    expectCode(() => parseRebuttalVote(null), 'INVALID_REBUTTAL')
  })

  it('rejects a missing or empty voterRole', () => {
    expectCode(() => parseRebuttalVote(voteMessage({ voterRole: undefined })), 'INVALID_REBUTTAL')
    expectCode(() => parseRebuttalVote(voteMessage({ voterRole: '' })), 'INVALID_REBUTTAL')
    expectCode(() => parseRebuttalVote(voteMessage({ voterRole: 7 })), 'INVALID_REBUTTAL')
  })

  it('rejects an illegal position', () => {
    expectCode(() => parseRebuttalVote(voteMessage({ position: 'maybe' })), 'INVALID_REBUTTAL')
  })

  it('rejects a missing, empty, or non-string rationale', () => {
    expectCode(() => parseRebuttalVote(voteMessage({ rationale: undefined })), 'INVALID_REBUTTAL')
    expectCode(() => parseRebuttalVote(voteMessage({ rationale: '   ' })), 'INVALID_REBUTTAL')
    expectCode(() => parseRebuttalVote(voteMessage({ rationale: false })), 'INVALID_REBUTTAL')
  })

  it('rejects a malformed optional modelFamily', () => {
    expectCode(() => parseRebuttalVote(voteMessage({ modelFamily: '' })), 'INVALID_REBUTTAL')
    expectCode(() => parseRebuttalVote(voteMessage({ modelFamily: 42 })), 'INVALID_REBUTTAL')
  })
})

describe('createRebuttalRound', () => {
  it('opens a pending round preserving the expected-role order', () => {
    const round = openRound()
    expect(round.status).toBe('pending')
    expect(round.expectedRoles).toEqual(['red-method', 'red-stat'])
    expect(round.votes).toEqual([])
    expect(Object.isFrozen(round)).toBe(true)
    expect(Object.isFrozen(round.expectedRoles)).toBe(true)
  })

  it('rejects empty identity fields', () => {
    expectCode(() => openRound({ roundId: '' }), 'INVALID_REBUTTAL')
    expectCode(() => openRound({ claimRef: '' }), 'INVALID_REBUTTAL')
    expectCode(() => openRound({ gate: ' ' }), 'INVALID_REBUTTAL')
  })

  it('rejects an empty expected-role set', () => {
    expectCode(() => openRound({ expectedRoles: [] }), 'INVALID_REBUTTAL')
  })

  it('rejects an invalid or reserved role name', () => {
    expectCode(() => openRound({ expectedRoles: ['lead'] }), 'INVALID_PERSONA')
    expectCode(() => openRound({ expectedRoles: ['Bad-Role'] }), 'INVALID_PERSONA')
  })

  it('rejects a duplicated expected role', () => {
    expectCode(
      () => openRound({ expectedRoles: ['red-method', 'red-method'] }),
      'INVALID_REBUTTAL',
    )
  })
})

describe('castRebuttalVote', () => {
  it('accepts the first vote and moves the round pending → submitted', () => {
    const round = openRound()
    const next = castRebuttalVote(round, {
      voterId: sessionId('member-1'),
      voterRole: 'red-method',
      position: 'refute',
      rationale: '基线不公平',
    })
    expect(next.status).toBe('submitted')
    expect(next.votes).toHaveLength(1)
    expect(next.votes[0]).toMatchObject({
      roundId: 'round-1',
      claimRef: 'claim-X',
      gate: 'A2',
      voterRole: 'red-method',
      voterId: sessionId('member-1'),
      position: 'refute',
      rationale: '基线不公平',
    })
    // Immutable: the previous snapshot was not mutated.
    expect(round.status).toBe('pending')
    expect(round.votes).toHaveLength(0)
    expect(Object.isFrozen(next)).toBe(true)
  })

  it('records an optional modelFamily on the accepted vote', () => {
    const next = castRebuttalVote(openRound(), {
      voterId: sessionId('member-1'),
      voterRole: 'red-method',
      position: 'support',
      rationale: '设计合理',
      modelFamily: 'deepseek-v3',
    })
    expect(next.votes[0]?.modelFamily).toBe('deepseek-v3')
  })

  it('rejects a vote on an already-completed round', () => {
    const completed = closeRebuttalRound(
      castRebuttalVote(openRound(), {
        voterId: sessionId('member-1'),
        voterRole: 'red-method',
        position: 'support',
        rationale: 'x',
      }),
    )
    expectCode(
      () => castRebuttalVote(completed, {
        voterId: sessionId('member-2'),
        voterRole: 'red-stat',
        position: 'support',
        rationale: 'y',
      }),
      'INVALID_REBUTTAL',
    )
  })

  it('rejects a vote from a role the round does not expect', () => {
    expectCode(
      () => castRebuttalVote(openRound(), {
        voterId: sessionId('member-1'),
        voterRole: 'red-cross',
        position: 'support',
        rationale: 'z',
      }),
      'REBUTTAL_UNKNOWN_ROLE',
    )
  })

  it('rejects a duplicate vote from the same role', () => {
    const submitted = castRebuttalVote(openRound(), {
      voterId: sessionId('member-1'),
      voterRole: 'red-method',
      position: 'support',
      rationale: '第一次投票',
    })
    expectCode(
      () => castRebuttalVote(submitted, {
        voterId: sessionId('member-1'),
        voterRole: 'red-method',
        position: 'refute',
        rationale: '第二次投票',
      }),
      'DUPLICATE_VOTE',
    )
  })

  it('rejects an empty rationale and a malformed modelFamily', () => {
    const round = openRound()
    expectCode(
      () => castRebuttalVote(round, {
        voterId: sessionId('member-1'),
        voterRole: 'red-method',
        position: 'support',
        rationale: '',
      }),
      'INVALID_REBUTTAL',
    )
    expectCode(
      () => castRebuttalVote(round, {
        voterId: sessionId('member-1'),
        voterRole: 'red-method',
        position: 'support',
        rationale: 'ok',
        modelFamily: ' ',
      }),
      'INVALID_REBUTTAL',
    )
  })
})

describe('allRolesVoted and closeRebuttalRound', () => {
  function fullyVotedRound(): RebuttalRound {
    return castRebuttalVote(
      castRebuttalVote(openRound(), {
        voterId: sessionId('member-1'),
        voterRole: 'red-method',
        position: 'support',
        rationale: '一票',
      }),
      {
        voterId: sessionId('member-2'),
        voterRole: 'red-stat',
        position: 'abstain',
        rationale: '二票',
      },
    )
  }

  it('reports false while any expected role has not voted', () => {
    const partial = castRebuttalVote(openRound(), {
      voterId: sessionId('member-1'),
      voterRole: 'red-method',
      position: 'support',
      rationale: '一票',
    })
    expect(allRolesVoted(partial)).toBe(false)
  })

  it('reports true once every expected role has voted', () => {
    expect(allRolesVoted(fullyVotedRound())).toBe(true)
  })

  it('closes a fully populated round as completed (submitted → completed)', () => {
    const completed = closeRebuttalRound(fullyVotedRound())
    expect(completed.status).toBe('completed')
    expect(completed.votes).toHaveLength(2)
  })

  it('is idempotent on an already-completed round', () => {
    const completed = closeRebuttalRound(fullyVotedRound())
    expect(closeRebuttalRound(completed)).toBe(completed)
  })

  it('refuses to close an empty round (blocked, not completed)', () => {
    expectCode(() => closeRebuttalRound(openRound()), 'INVALID_REBUTTAL')
  })
})

describe('adjudicationVotes', () => {
  it('projects the accepted votes onto the gate-facing AdjudicationVote contract', () => {
    const submitted = castRebuttalVote(openRound(), {
      voterId: sessionId('member-1'),
      voterRole: 'red-method',
      position: 'refute',
      rationale: '内部效度不足',
      modelFamily: 'deepseek-v3',
    })
    expect(adjudicationVotes(submitted)).toEqual([
      {
        voterRole: 'red-method',
        modelFamily: 'deepseek-v3',
        position: 'refute',
        rationale: '内部效度不足',
      },
    ])
  })

  it('drops the modelFamily key entirely when the member had none', () => {
    const submitted = castRebuttalVote(openRound(), {
      voterId: sessionId('member-1'),
      voterRole: 'red-method',
      position: 'abstain',
      rationale: '证据不足以判断',
    })
    const vote = adjudicationVotes(submitted)[0]
    expect(vote).toEqual({
      voterRole: 'red-method',
      position: 'abstain',
      rationale: '证据不足以判断',
    })
    expect('modelFamily' in (vote as Record<string, unknown>)).toBe(false)
  })
})
