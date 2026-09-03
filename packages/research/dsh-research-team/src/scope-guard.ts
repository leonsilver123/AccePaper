// @deepseek-ai/dsh-research-team — pure global write-scope guard decision.
//
// PURE-LOGIC LAYER (T20). Mirrors the frozen T20 design spec §4: one global
// `ctx.tools.guard()` on the root context evaluates every tool call through a
// PURE decision function. Nothing here touches ctx / tools / agent internals:
// the execution is reduced to the minimal structural slice it needs
// ({@link GuardToolExecution}) and every dynamic lookup is injected through
// {@link ResearchScopePolicy}.
//
// Decision order (§4 pseudocode + P2-2 fail-closed):
//   1. no agent (host/system)            → allow
//   2. agent is provably not a member     → allow   (P-a regression)
//   2b. agent lineage cannot be proven    → deny    (P2-2: never pass through)
//   3. agent is the team lead             → allow   (U-A lead exemption)
//   4. tool is not scope-checkable        → deny    (member tool whitelist)
//   5. no path argument to check          → deny
//   6. path is outside the member's claim → deny
//   otherwise                            → allow
// Returns a human-readable deny message, or undefined to allow the call.

import type { SessionId, TeamRole } from './types.ts'

/** Minimal structural slice of a tool execution the decision consumes.
 *  `agent` is undefined for host/system-level calls. */
export interface GuardToolExecution {
  readonly agent: { readonly id: string } | undefined
  readonly name: string
  readonly arguments: Readonly<Record<string, unknown>>
}

/** Membership resolution result for one agent id. `memberId` is the member
 *  whose write claim the agent acts under (nested one-shot subagents map to
 *  their nearest research member via the resolver in the adapter round). */
export interface GuardMembership {
  readonly memberId: SessionId
  readonly role: TeamRole
}

/** Resolution of one agent id for the guard: the member to check, the literal
 *  `'unattributed'` marker when the caller's research lineage cannot be proven
 *  (P2-2 — the guard must fail closed and deny), or `undefined` when the agent
 *  is provably not a research member (P-a — pass through). */
export type GuardMembershipResolution = GuardMembership | 'unattributed' | undefined

/** Injected dynamic lookups (pure decide() stays host-free and unit-testable
 *  with a mock resolver). */
export interface ResearchScopePolicy {
  /** Map an agent id to its research membership, if any. */
  readonly resolveMembership: (agentId: string) => GuardMembershipResolution
  /** True when the tool's writes are expressible as one path to scope-check. */
  readonly isScopeCheckedTool: (toolName: string) => boolean
  /** Extract the write path from a checked tool's arguments. */
  readonly pathOf: (arguments_: Readonly<Record<string, unknown>>) => string | undefined
  /** Whether the member's active claim(s) cover this tool + path. */
  readonly memberMayWrite: (memberId: SessionId, toolName: string, path: string) => boolean
}

/** Decide whether one tool call by `exec` is allowed. Returns undefined when
 *  the call is allowed (host, non-team agent, team lead, or an in-scope member
 *  write) and a deny message otherwise. Pure and deterministic. */
export function decideResearchToolCall(
  exec: GuardToolExecution,
  policy: ResearchScopePolicy,
): string | undefined {
  if (exec.agent === undefined) return undefined
  const membership = policy.resolveMembership(exec.agent.id)
  if (membership === undefined) return undefined
  // P2-2 fail-closed: a caller whose research lineage cannot be proven (a live
  // member whose Lead is offline, a delegation worker of an unknown offline
  // parent) is denied outright — never passed through as a non-member.
  if (membership === 'unattributed') {
    return (
      `research team guard denied tool ${exec.name} for ${exec.agent.id}: `
      + 'cannot attribute the caller to a research team membership'
    )
  }
  if (membership.role === 'lead') return undefined
  if (!policy.isScopeCheckedTool(exec.name)) {
    return (
      `research team member denied tool ${exec.name}: not a scope-checked member tool`
    )
  }
  const path = policy.pathOf(exec.arguments)
  if (path === undefined) {
    return (
      `research team member denied tool ${exec.name}: no path argument to scope-check`
    )
  }
  if (!policy.memberMayWrite(membership.memberId, exec.name, path)) {
    return (
      `write out of scope for ${membership.memberId}: ${path}`
    )
  }
  return undefined
}

/** Common argument keys tried in order when extracting a write path. */
export const RESEARCH_PATH_ARG_KEYS = ['path', 'file', 'filename', 'target'] as const

/** Extract a non-empty path string from tool arguments by trying the common
 *  keys in order (first string value wins; non-strings are skipped). */
export function pathFromArgs(
  arguments_: Readonly<Record<string, unknown>>,
  keys: ReadonlyArray<string> = RESEARCH_PATH_ARG_KEYS,
): string | undefined {
  for (const key of keys) {
    const value = arguments_[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return undefined
}
