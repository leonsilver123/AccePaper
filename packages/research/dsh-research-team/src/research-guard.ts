// @deepseek-ai/dsh-research-team — global tool-guard wiring (adapter).
//
// ADAPTER LAYER (T20). The frozen design (§4 + PoC t20-poc-guard-timing §c)
// enforces write scopes with ONE global `ctx.tools.guard()` registered on the
// research plugin's root context: lifetime = plugin lifetime, reinstalled on
// process restart before any member resumes, and evaluated live per tool call
// against the durable root-log projection — immune to the per-activation
// re-install timing gap that would otherwise leave a cold-resumed member
// unguarded. The guard is deny-only: it passes provably non-research callers
// through unchanged (host calls, unrelated forks, provider-owned workers) and
// FAILS CLOSED on a caller whose research lineage cannot be proven — a live
// member whose Lead is offline, or a worker of an unknown offline parent
// (P2-2) — by denying every tool before any scope check.
//
// The decision itself is the PURE `decideResearchToolCall` from the pure layer;
// this module only adapts the concrete runtime `ToolExecution` into the pure
// `GuardToolExecution` slice and supplies the live `ResearchScopePolicy`
// resolver (roster membership + claim-scope reads).

import type { Context } from '@deepseek-ai/cordis'
import type { ToolGuard, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { GuardMembershipResolution, GuardToolExecution, ResearchScopePolicy } from './scope-guard.ts'
import { decideResearchToolCall, pathFromArgs } from './scope-guard.ts'
import type { ResearchRoster } from './roster.ts'

/** Tool names whose writes are expressible as one path to scope-check. */
export type ResearchScopeCheckedTools = ReadonlySet<string>

/**
 * Install the global research write-scope guard on `ctx`. Returns a disposer
 * that removes exactly this contribution when the plugin is disposed.
 * @param ctx - context whose tools pipeline receives the global guard.
 * @param roster - membership and claim resolver over the durable projection.
 * @param scopeCheckedTools - write-tool allowlist expressible as one path.
 * @returns the guard disposer from `ctx.tools.guard`.
 */
export function installResearchGuard(
  ctx: Context,
  roster: ResearchRoster,
  scopeCheckedTools: ResearchScopeCheckedTools,
): () => void {
  const policy: ResearchScopePolicy = {
    resolveMembership: (agentId: string): GuardMembershipResolution => {
      const resolution = roster.classifyById(agentId)
      if (resolution === undefined) return undefined
      if (resolution.kind === 'unattributed') return 'unattributed'
      if (resolution.kind === 'not-member') return undefined
      return { memberId: resolution.membership.memberId, role: resolution.membership.role }
    },
    isScopeCheckedTool: (toolName: string): boolean => scopeCheckedTools.has(toolName),
    pathOf: (arguments_: Readonly<Record<string, unknown>>): string | undefined => {
      return pathFromArgs(arguments_)
    },
    memberMayWrite: (memberId, _toolName, path): boolean => {
      return roster.memberMayWrite(memberId, path)
    },
  }
  const guard: ToolGuard = (execution: Readonly<ToolExecution>): string | undefined => {
    return decideResearchToolCall(toGuardExecution(execution), policy)
  }
  return ctx.tools.guard(guard)
}

/** Reduce one runtime tool execution to the structural slice the pure decide needs. */
function toGuardExecution(execution: Readonly<ToolExecution>): GuardToolExecution {
  return {
    agent: execution.agent === undefined ? undefined : { id: execution.agent.id },
    name: execution.name,
    arguments: plainRecord(execution.arguments),
  }
}

/** Map `unknown` tool arguments to a read-only record (non-objects yield {}). */
function plainRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
