// @deepseek-ai/dsh-research-team — T22 judge (pure) contract tests.

import { describe, expect, it } from 'vitest'

import { sessionId } from '../src/types.ts'
import type { ResearchRebuttal } from '../src/types.ts'
import type { RebuttalRound } from '../src/redteam/rebuttal.ts'
import { judgeRound } from '../src/redteam/judge.ts'

function vote(role: string, position: 'support' | 'refute' | 'abstain', rationale = `rationale-${role}`, family?: string): ResearchRebuttal {
  return {
    roundId: 'round-1',
    claimRef: 'claim-ref',
    gate: 'A2',
    voterRole: role,
    voterId: sessionId(`sess-${role}`),
    position,
    rationale,
    ...(family === undefined ? {} : { modelFamily: family }),
  }
}

function completedRound(roles: readonly string[], votes: ResearchRebuttal[]): RebuttalRound {
  return { roundId: 'round-1', claimRef: 'claim-ref', gate: 'A2', expectedRoles: roles, status: 'completed', votes }
}

const supportAll = (roles: readonly string[]): ResearchRebuttal[] => roles.map(r => vote(r, 'support'))
const refuteAll = (roles: readonly string[]): ResearchRebuttal[] => roles.map(r => vote(r, 'refute'))

describe('judgeRound — projection of a completed rebuttal round', () => {
  it('maps core passed -> keep / intent pass', () => {
    const v = judgeRound(completedRound(['r1', 'r2', 'r3'], supportAll(['r1', 'r2', 'r3'])), { minValidVotes: 3, passThreshold: 0.6 }, 7)
    expect(v.verdict).toBe('keep')
    expect(v.outcome).toBe('passed')
    expect(v.intent).toBe('pass')
    expect(v.roundId).toBe('round-1')
    expect(v.gate).toBe('A2')
    expect(v.timestamp).toBe(7)
    expect(v.summary).toContain('[r1] support: rationale-r1')
  })

  it('maps core failed -> drop / intent hard_fail', () => {
    const v = judgeRound(completedRound(['r1', 'r2', 'r3'], refuteAll(['r1', 'r2', 'r3'])), { minValidVotes: 3, passThreshold: 0.6 }, 7)
    expect(v.verdict).toBe('drop')
    expect(v.outcome).toBe('failed')
    expect(v.intent).toBe('hard_fail')
  })

  it('maps an ambiguous split -> abstain / intent rework', () => {
    const v = judgeRound(
      completedRound(['r1', 'r2', 'r3', 'r4'], [vote('r1', 'support'), vote('r2', 'support'), vote('r3', 'refute'), vote('r4', 'refute')]),
      { minValidVotes: 4, passThreshold: 0.6 },
      7,
    )
    expect(v.verdict).toBe('abstain')
    expect(v.outcome).toBe('blocked')
    expect(v.intent).toBe('rework')
  })

  it('abstains (with abstention reason + vote tally) when everyone abstains', () => {
    const v = judgeRound(
      completedRound(['r1', 'r2'], [vote('r1', 'abstain', 'cannot tell'), vote('r2', 'abstain', 'no evidence')]),
      { minValidVotes: 2, passThreshold: 0.6 },
      7,
    )
    expect(v.verdict).toBe('abstain')
    expect(v.outcome).toBe('abstained')
    expect(v.intent).toBe('hold_abstained')
    expect(v.abstentionReason).toBeDefined()
    expect(v.voteTally).toBeDefined()
    expect(v.summary).toContain('[r2] abstain: no evidence')
  })

  it('abstains on an uncalibrated (empty) config — NO DEFAULT PASS', () => {
    const v = judgeRound(completedRound(['r1', 'r2', 'r3'], supportAll(['r1', 'r2', 'r3'])), {}, 7)
    expect(v.verdict).toBe('abstain')
    expect(v.outcome).toBe('abstained')
    expect(v.reasonCode).toContain('UNDEFINED_THRESHOLD')
  })

  it('throws JUDGE_ROUND_INCOMPLETE for a round that is not completed', () => {
    const round = { ...completedRound(['r1'], supportAll(['r1'])), status: 'submitted' } as RebuttalRound
    expect(() => judgeRound(round, { minValidVotes: 1, passThreshold: 0.6 }, 7)).toThrow(/JUDGE_ROUND_INCOMPLETE/)
  })

  it('throws JUDGE_ROUND_INCOMPLETE when a role has not voted', () => {
    const round = completedRound(['r1', 'r2'], supportAll(['r1']))
    expect(() => judgeRound(round, { minValidVotes: 2, passThreshold: 0.6 }, 7)).toThrow(/JUDGE_ROUND_INCOMPLETE/)
  })

  it('throws JUDGE_ROUND_INCOMPLETE when the same role votes twice', () => {
    const round = completedRound(['r1', 'r2'], [vote('r1', 'support'), vote('r1', 'refute')])
    expect(() => judgeRound(round, { minValidVotes: 2, passThreshold: 0.6 }, 7)).toThrow(/JUDGE_ROUND_INCOMPLETE/)
  })

  it('is deterministic: same inputs -> byte-identical summary and verdict', () => {
    const round = completedRound(['r1', 'r2', 'r3'], supportAll(['r1', 'r2', 'r3']))
    const a = judgeRound(round, { minValidVotes: 3, passThreshold: 0.6 }, 7)
    const b = judgeRound(round, { minValidVotes: 3, passThreshold: 0.6 }, 7)
    expect(a).toEqual(b)
    expect(JSON.stringify(a.summary)).toBe(JSON.stringify(b.summary))
  })

  it('returns a deeply frozen verdict (mutation throws in strict mode)', () => {
    const v = judgeRound(completedRound(['r1', 'r2', 'r3'], supportAll(['r1', 'r2', 'r3'])), { minValidVotes: 3, passThreshold: 0.6 }, 7)
    expect(() => {
      ;(v as unknown as { summary: string }).summary = 'tampered'
    }).toThrow(TypeError)
  })

  it('accepts a stable claimId override and carries it through', () => {
    const v = judgeRound(completedRound(['r1', 'r2', 'r3'], supportAll(['r1', 'r2', 'r3'])), { minValidVotes: 3, passThreshold: 0.6 }, 7, 'claim-9')
    expect(v.claimRef).toBe('claim-ref')
    expect(v.outcome).toBe('passed')
  })

  it('propagates evidenceRefs from the core result', () => {
    const v = judgeRound(completedRound(['r1', 'r2', 'r3'], supportAll(['r1', 'r2', 'r3'])), { minValidVotes: 3, passThreshold: 0.6 }, 7)
    expect(v.evidenceRefs.length).toBeGreaterThan(0)
  })
})
