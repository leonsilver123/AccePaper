// @deepseek-ai/dsh-research-team — session-events.ts wire-seam spec.
//
// Covers the research event vocabulary bridge (T20 §5 + T21 §3):
//   - isResearchEvent recognizes the four research/* discriminants,
//   - researchEventFromSession decodes a persisted member / task / rev /
//     rebuttal payload back into the pure fold vocabulary (re-branding ids),
//   - non-research session events decode to undefined,
//   - malformed persisted research payloads throw DSH_RESEARCH_TEAM_INVALID_EVENT,
//   - validateResearchEventPayload round-trips a research/rebuttal payload
//     (the T21 addition) through its strict snapshot schema.

import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import {
  isResearchEvent,
  researchEventFromSession,
  validateResearchEventPayload,
} from '../src/session-events.ts'
import type {
  ResearchMember,
  ResearchRebuttal,
  ResearchRev,
  ResearchTask,
} from '../src/types.ts'
import {
  ResearchTeamError,
  TeamId,
  sessionId,
  taskId,
} from '../src/types.ts'

const TEAM_RAW = 'team-wire-1'
const TEAM = TeamId(TEAM_RAW)

/** Raw persisted payload shapes (un-branded, as stored on the wire). */
const memberPayload = {
  version: 1,
  teamId: TEAM_RAW,
  member: {
    id: 'member-wire-1',
    name: 'wire-member',
    description: 'desc',
    provider: 'spawn',
    context: 'fresh',
    phase: 'active',
  },
}
const taskPayload = {
  version: 1,
  teamId: TEAM_RAW,
  task: {
    id: 'task-wire-1',
    revision: 3,
    subject: 'wire task',
    description: 'wire description',
    status: 'completed',
    ownerId: 'member-wire-1',
    blockedBy: ['task-wire-0'],
    writeScopes: [],
  },
}
const revPayload = {
  version: 1,
  teamId: TEAM_RAW,
  rev: {
    artifactId: 'draft.tex',
    revision: 5,
    prevRevision: 4,
    kind: 'file',
    path: 'draft.tex#5',
    hash: 'h-5',
  },
}
const rebuttalPayload = {
  version: 1,
  teamId: TEAM_RAW,
  rebuttal: {
    roundId: 'round-wire-1',
    claimRef: 'claim-wire-1',
    gate: 'A2',
    voterRole: 'red-method',
    voterId: 'member-wire-1',
    position: 'refute',
    rationale: '基线不具可比性',
    modelFamily: 'model-pro',
  },
}

/** One core session event carrying a research-domain payload. */
function sessionEvent(type: string, data: unknown): SessionEvent {
  return { type, seq: 1, time: 0, data } as unknown as SessionEvent
}

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

const expectedMember = memberPayload.member as ResearchMember
const expectedTask = { ...taskPayload.task } as ResearchTask
const expectedRev = revPayload.rev as ResearchRev
const expectedRebuttal = rebuttalPayload.rebuttal as ResearchRebuttal

/** Branded `research/rebuttal` wire payload (the shape the validator expects). */
const rebuttalWire = rebuttalPayload as unknown as SessionEventMap['research/rebuttal']
const missingRationaleWire = {
  ...rebuttalPayload,
  rebuttal: { ...rebuttalPayload.rebuttal, rationale: '' },
} as unknown as SessionEventMap['research/rebuttal']

describe('isResearchEvent', () => {
  it('recognizes the four research/* discriminants', () => {
    for (const type of ['research/member', 'research/task', 'research/rev', 'research/rebuttal']) {
      expect(isResearchEvent(sessionEvent(type, {}))).toBe(true)
    }
  })

  it('rejects non-research session events', () => {
    expect(isResearchEvent(sessionEvent('member/created', {}))).toBe(false)
    expect(isResearchEvent(sessionEvent('subagent/descriptor', {}))).toBe(false)
  })
})

describe('researchEventFromSession — decode bridge', () => {
  it('decodes a persisted research/member payload into the pure event', () => {
    const decoded = researchEventFromSession(sessionEvent('research/member', memberPayload))
    expect(decoded).toEqual({
      type: 'research/member',
      version: 1,
      teamId: TEAM,
      member: {
        ...expectedMember,
        id: sessionId('member-wire-1'),
      },
    })
  })

  it('decodes a persisted research/task payload, re-branding task ids', () => {
    const decoded = researchEventFromSession(sessionEvent('research/task', taskPayload))
    expect(decoded).toEqual({
      type: 'research/task',
      version: 1,
      teamId: TEAM,
      task: {
        ...expectedTask,
        id: taskId('task-wire-1'),
        ownerId: sessionId('member-wire-1'),
        blockedBy: [taskId('task-wire-0')],
      },
    })
  })

  it('decodes a persisted research/rev payload', () => {
    const decoded = researchEventFromSession(sessionEvent('research/rev', revPayload))
    expect(decoded).toEqual({
      type: 'research/rev',
      version: 1,
      teamId: TEAM,
      rev: expectedRev,
    })
  })

  it('decodes a persisted research/rebuttal payload (T21)', () => {
    const decoded = researchEventFromSession(sessionEvent('research/rebuttal', rebuttalPayload))
    expect(decoded).toEqual({
      type: 'research/rebuttal',
      version: 1,
      teamId: TEAM,
      rebuttal: {
        ...expectedRebuttal,
        voterId: sessionId('member-wire-1'),
      },
    })
  })

  it('returns undefined for non-research session events', () => {
    expect(researchEventFromSession(sessionEvent('member/created', {}))).toBeUndefined()
  })

  it('throws INVALID_EVENT when a persisted research payload is malformed', () => {
    const malformed = { ...memberPayload, member: { ...memberPayload.member, id: 42 } }
    expect(codeOf(() => {
      researchEventFromSession(sessionEvent('research/member', malformed))
    })).toBe('DSH_RESEARCH_TEAM_INVALID_EVENT')
    // The schema failure is preserved as the ResearchTeamError cause.
    const caught = errorCodeOf(() => {
      researchEventFromSession(sessionEvent('research/rebuttal', { ...rebuttalPayload, rebuttal: { ...rebuttalPayload.rebuttal, position: 'maybe' } }))
    })
    expect(caught).toBe('DSH_RESEARCH_TEAM_INVALID_EVENT')
  })
})

describe('validateResearchEventPayload — durable log seam', () => {
  it('round-trips a research/rebuttal payload (T21)', () => {
    const canonical = validateResearchEventPayload('research/rebuttal', rebuttalWire)
    expect(canonical.teamId).toBe(TEAM)
    expect(canonical.rebuttal.voterId).toBe(sessionId('member-wire-1'))
  })

  it('rejects a rebuttal payload missing a required field', () => {
    expect(codeOf(() => {
      validateResearchEventPayload('research/rebuttal', missingRationaleWire)
    })).toBe('DSH_RESEARCH_TEAM_INVALID_EVENT')
  })
})
