// @deepseek-ai/dsh-research-team — scope-guard.ts pure decision spec.
//
// Pins the frozen T20 §4 decision order (pure decide(), no ctx):
//   1. no agent (host/system)           → allow
//   2. agent is not a research member   → allow   (P-a passthrough)
//   3. agent is the team lead           → allow   (U-A lead exemption)
//   4. tool is not scope-checkable      → deny    (member tool whitelist)
//   5. no path argument to check        → deny
//   6. path is outside the member's claim → deny
//   otherwise                          → allow
// Also covers the pathFromArgs extraction helper and the canonical key list.
// The guard's dynamic lookups are injected through a mock ResearchScopePolicy,
// so every deny/allow decision is asserted without any ctx / tools wiring.

import { describe, expect, it } from 'vitest'
import {
  decideResearchToolCall,
  pathFromArgs,
  RESEARCH_PATH_ARG_KEYS,
} from '../src/scope-guard.ts'
import type { GuardMembership, GuardToolExecution, ResearchScopePolicy } from '../src/scope-guard.ts'
import { sessionId } from '../src/types.ts'
import type { SessionId, TeamRole } from '../src/types.ts'

const M = sessionId('member-1')
const LEAD = sessionId('lead-1')

const membership = (memberId: SessionId, role: TeamRole): GuardMembership => ({
  memberId,
  role,
})

/** Build a policy with defaults that allow every downstream step; callers
 *  override only the branch they are exercising. */
function policy(over: Partial<ResearchScopePolicy> = {}): ResearchScopePolicy {
  return {
    resolveMembership: over.resolveMembership ?? (() => membership(M, 'teammate')),
    isScopeCheckedTool: over.isScopeCheckedTool ?? (() => true),
    pathOf: over.pathOf ?? (args => pathFromArgs(args)),
    memberMayWrite: over.memberMayWrite ?? (() => true),
  }
}

function exec(over: Partial<GuardToolExecution> = {}): GuardToolExecution {
  return {
    agent: { id: M },
    name: 'write_file',
    arguments: { path: 'drafts/a.md' },
    ...over,
  }
}

describe('decideResearchToolCall — allowances (order steps 1-3, 6-allow)', () => {
  it('allows host/system tool calls without an agent without consulting the policy', () => {
    let resolutions = 0
    const result = decideResearchToolCall(
      { agent: undefined, name: 'write_file', arguments: { path: 'x.md' } },
      policy({ resolveMembership: () => { resolutions++; return membership(M, 'teammate') } }),
    )
    expect(result).toBeUndefined()
    expect(resolutions).toBe(0)
  })

  it('passes through agents that are not research members (P-a regression)', () => {
    const result = decideResearchToolCall(
      { agent: { id: 'outsider' }, name: 'write_file', arguments: { path: 'x.md' } },
      policy({ resolveMembership: () => undefined }),
    )
    expect(result).toBeUndefined()
  })

  it('exempts the team lead before any tool checks (U-A lead exemption)', () => {
    const touched: string[] = []
    const leadPolicy = policy({
      resolveMembership: () => membership(LEAD, 'lead'),
      isScopeCheckedTool: () => { touched.push('isScopeCheckedTool'); return true },
      pathOf: () => { touched.push('pathOf'); return 'x.md' },
      memberMayWrite: () => { touched.push('memberMayWrite'); return false },
    })
    const result = decideResearchToolCall(exec({ agent: { id: LEAD } }), leadPolicy)
    expect(result).toBeUndefined()
    expect(touched).toEqual([])
  })

  it('allows a teammate write that is in scope', () => {
    const result = decideResearchToolCall(exec(), policy())
    expect(result).toBeUndefined()
  })

  it('resolves the member and consults each check in order for a teammate', () => {
    const seen: string[] = []
    const result = decideResearchToolCall(
      exec({ agent: { id: LEAD } }),
      policy({
        resolveMembership: (agentId) => {
          seen.push(`resolve:${agentId}`)
          return membership(LEAD, 'teammate')
        },
        isScopeCheckedTool: (tool) => { seen.push(`scope:${tool}`); return true },
        pathOf: () => { seen.push('path'); return 'drafts/a.md' },
        memberMayWrite: () => { seen.push('may'); return true },
      }),
    )
    expect(result).toBeUndefined()
    expect(seen).toEqual([
      `resolve:${LEAD}`,
      'scope:write_file',
      'path',
      'may',
    ])
  })

  it('passes the resolved memberId, tool name and path to memberMayWrite', () => {
    let captured: { memberId: SessionId; tool: string; path: string } | undefined
    const result = decideResearchToolCall(
      exec(),
      policy({
        memberMayWrite: (memberId, tool, path) => {
          captured = { memberId, tool, path }
          return true
        },
      }),
    )
    expect(result).toBeUndefined()
    expect(captured).toEqual({ memberId: M, tool: 'write_file', path: 'drafts/a.md' })
  })
})

describe('decideResearchToolCall — denials (order steps 4-6)', () => {
  it('denies member calls to tools that are not scope-checked, before path checks', () => {
    const result = decideResearchToolCall(
      exec({ name: 'ask_user' }),
      policy({
        isScopeCheckedTool: () => false,
        pathOf: () => {
          throw new Error('pathOf must not run when the tool is not scope-checked')
        },
      }),
    )
    expect(result).toContain('not a scope-checked member tool')
  })

  it('denies a checked tool call that carries no path argument', () => {
    const result = decideResearchToolCall(
      exec({ arguments: {} }),
      policy({
        memberMayWrite: () => {
          throw new Error('memberMayWrite must not run when no path was extracted')
        },
      }),
    )
    expect(result).toContain('no path argument to scope-check')
  })

  it('denies a write whose path is outside the member claim scope', () => {
    const result = decideResearchToolCall(
      exec({ arguments: { path: 'notes/private.md' } }),
      policy({ memberMayWrite: () => false }),
    )
    expect(result).toContain(`write out of scope for ${M}`)
    expect(result).toContain('notes/private.md')
  })

  it('uses the path returned by policy.pathOf (not raw arguments) for the decision', () => {
    const result = decideResearchToolCall(
      exec({ arguments: { path: 'raw-arg.md' } }),
      policy({
        pathOf: () => 'resolved/path.md',
        memberMayWrite: () => false,
      }),
    )
    expect(result).toContain('resolved/path.md')
    expect(result).not.toContain('raw-arg.md')
  })
})

describe('pathFromArgs', () => {
  it('picks the first non-empty string value in canonical key order', () => {
    expect(pathFromArgs({ file: 'b.md', path: 'a.md' })).toBe('a.md')
    expect(pathFromArgs({ filename: 'c.md', file: 'b.md' })).toBe('b.md')
  })

  it('skips non-string values and blank strings', () => {
    expect(pathFromArgs({ path: 42, file: '   ', target: 'real.md' })).toBe('real.md')
  })

  it('returns undefined when no key holds a usable path', () => {
    expect(pathFromArgs({ path: '', target: 123 })).toBeUndefined()
    expect(pathFromArgs({})).toBeUndefined()
  })

  it('honors an explicit key order over the default list', () => {
    expect(pathFromArgs({ path: 'a.md', target: 'b.md' }, ['target', 'path'])).toBe('b.md')
    expect(pathFromArgs({ path: 'a.md' }, ['filename'])).toBeUndefined()
    expect(pathFromArgs({ any: 'x.md' }, [])).toBeUndefined()
  })

  it('pins the canonical RESEARCH_PATH_ARG_KEYS order', () => {
    expect([...RESEARCH_PATH_ARG_KEYS]).toEqual(['path', 'file', 'filename', 'target'])
  })
})
