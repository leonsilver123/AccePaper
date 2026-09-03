// @deepseek-ai/dsh-research-team — roster membership + continuable provisioning.
//
// ADAPTER LAYER (T20). A research team is a star rooted at one exact live Lead
// Agent whose Session log is the durable roster. Members are durable
// continuable direct children created through `ctx.subagents.startContinuable`
// with a caller-reserved `childId`, so the durable `provisioning` row can be
// committed BEFORE the child materializes (crash-safe identity: a later
// recovery pass reconciles any provisioning-only prefix against the persisted
// child Session).
//
// Membership resolution is the resolver the global tool guard consults on
// every call (§4 of the frozen spec), via `classifyById`:
//   - only an exact-live Agent is an authority (`ctx.agents.get(id) === agent`);
//   - the durable parent chain is climbed to the nearest research member; a
//     direct child on the durable roster is a teammate (provisioning or
//     active); the top-most live agent is its own research Lead;
//   - a provider-owned child of a LIVE parent that never resolves to a roster
//     row is provably NOT a member (P2-1: today this includes one-shot
//     descendants of a member — they pass through, and the member's own
//     toolFilter is the backstop; if a member tool set ever gains delegation
//     tools, this must rise to P1 and fold to the nearest member instead);
//   - a live agent whose lineage CANNOT be proven research-free (the
//     referenced parent is not in the live registry, e.g. a resumed member
//     whose Lead is offline) classifies as `unattributed` — the guard FAILS
//     CLOSED and denies, never passing such a caller through (P2-2).

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId as CoreSessionId } from '@deepseek-ai/dsh-session'
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import type { ResearchJournal } from './journal.ts'
import { scopeContains } from './revision.ts'
import { ResearchTeamError, sessionId, TeamId } from './types.ts'
import { DSH_RESEARCH_TEAM_ERROR_PREFIX } from './types.ts'
import type { ResearchMember, ResearchMemberView, TeamId as TeamIdBrand } from './types.ts'

const MEMBER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const MAX_NAME_LENGTH = 64
const MAX_DESCRIPTION_LENGTH = 16_384
const MAX_PROVIDER_LENGTH = 200

/** Error message text extracted from one arbitrary rejection. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Caller identity resolved inside one research team. */
export interface ResearchMembership {
  /** The exact live Lead Agent owning the team log. */
  readonly root: Agent
  /** Branded root Session identity (the research team identity). */
  readonly id: TeamIdBrand
  /** The durable member Session identity this caller acts under. */
  readonly memberId: ResearchMember['id']
  readonly role: 'lead' | 'teammate'
  readonly name: string
}

/** Outcome of resolving one exact-live Agent against the durable roster.
 *  - `member`: the agent resolves to a live Lead or a roster teammate;
 *  - `not-member`: the live lineage is provably research-free (P-a passthrough);
 *  - `unattributed`: lineage cannot be proven (P2-2 — guard must fail closed). */
export type ResearchMemberResolution =
  | { readonly kind: 'member'; readonly membership: ResearchMembership }
  | { readonly kind: 'not-member' }
  | { readonly kind: 'unattributed' }

/** Request body for creating one durable research member. */
export interface SpawnMemberRequest {
  /** Immutable, lower-kebab-case, never-reused member name. */
  readonly name: string
  readonly description: string
  /** Continuation provider whose session is persisted (`spawn`/`fork` host routes). */
  readonly provider: string
  /** 'fresh' = empty context; 'fork' = inherits the Lead's prefix. */
  readonly context: 'fresh' | 'fork'
  /** Initial delegation delivered as the member's first user message. */
  readonly prompt: ContentBlock[]
  /** Cancellation governing creation only; the durable child outlives it. */
  readonly signal: AbortSignal
}

/** Owns research-team identities and the lifecycle of rostered continuable children. */
export class ResearchRoster {
  private readonly shutdown = new AbortController()

  /**
   * @param ctx - service context with Agent/Session/persistence/subagent services.
   * @param journal - authoritative Lead-log transaction owner.
   */
  constructor(
    private readonly ctx: Context,
    private readonly journal: ResearchJournal,
  ) {}

  /**
   * Resolve one exact live Agent's research role, throwing when it has none.
   * @param agent - exact live Agent used as the authority credential.
   * @returns its Lead, durable identity, role, and model-facing name.
   */
  membership(agent: Agent): ResearchMembership {
    const membership = this.tryMembership(agent)
    if (membership === undefined) {
      throw new ResearchTeamError(
        `${DSH_RESEARCH_TEAM_ERROR_PREFIX}NOT_AUTHORIZED`,
        `agent "${agent.id}" is not a research team member`,
      )
    }
    return membership
  }

  /**
   * Resolve a caller without throwing for lifecycle observers and legacy
   * authorization paths. `unattributed` callers (lineage cannot be proven)
   * map to undefined too, but the guard MUST NOT rely on this method — it
   * consumes `classifyById` so it can tell `unattributed` from `not-member`
   * and fail closed (P2-2).
   * @param agent - candidate exact live Agent.
   * @returns research membership, or undefined for non-members, stale ids,
   * and unprovable lineages.
   */
  tryMembership(agent: Agent): ResearchMembership | undefined {
    const resolution = this.classify(agent)
    return resolution.kind === 'member' ? resolution.membership : undefined
  }

  /**
   * Classify one exact-live Agent without throwing. The guard adapter reads
   * this three-way result so a provably non-member passes through (P-a) while
   * an unattributable lineage is denied (P2-2). Non-live handles cannot be an
   * authority and return `undefined` (they cannot originate a tool call).
   * @param agentId - candidate agent Session identity.
   * @returns the classification, or undefined when the id is not live.
   */
  classifyById(agentId: string): ResearchMemberResolution | undefined {
    const agent = this.ctx.agents.get(brandString<CoreSessionId>(agentId))
    return agent === undefined ? undefined : this.classify(agent)
  }

  /**
   * Classify one exact-live Agent against the durable roster. See the module
   * header for the per-case semantics (member / not-member / unattributed).
   */
  private classify(agent: Agent): ResearchMemberResolution {
    // Only an exact-live Agent is an authority; a stale handle cannot be
    // trusted as either a member or a non-member.
    if (this.ctx.agents.get(agent.id) !== agent) return { kind: 'unattributed' }
    // Climb the durable parent chain to the nearest live research member.
    let current: Agent = agent
    for (;;) {
      const parentId = current.session.header.parentSession
      if (parentId === undefined) {
        // Top of the live chain: the agent owns its own root. A detached
        // continuation with no recorded delegating parent cannot be
        // attributed; anything else is its own Lead (the pure layer's U-A
        // lead exemption is exercised only for the coordinator).
        if (this.subagentDescriptor(current)) return { kind: 'unattributed' }
        return { kind: 'member', membership: this.leadMembership(current) }
      }
      const parent = this.ctx.agents.get(parentId)
      if (parent === undefined) {
        // The referenced parent is NOT in the live registry, so we cannot rule
        // out a research Lead above (a resumed member whose Lead is offline
        // lands here). Fail closed instead of passing the caller through.
        return { kind: 'unattributed' }
      }
      const row = this.memberRow(parent, current.id)
      if (row !== undefined && row.phase !== 'failed') {
        return {
          kind: 'member',
          membership: {
            root: parent,
            id: TeamId(parent.id),
            memberId: sessionId(current.id),
            role: 'teammate',
            name: row.name,
          },
        }
      }
      if (this.subagentDescriptor(current)) {
        // Provider-owned child of a LIVE parent that is not a roster row:
        // provably not a research member (P2-1 — one-shot descendants of a
        // member land here too and pass through, toolFilter is the backstop).
        return { kind: 'not-member' }
      }
      current = parent
    }
  }

  /**
   * Resolve membership by Session identity WITHOUT distinguishing unprovable
   * lineages (legacy parity: `unattributed` → undefined). The tool guard
   * consumes `classifyById` instead, so it can fail closed on `unattributed`.
   * @param agentId - candidate agent Session identity.
   * @returns research membership, or undefined for non-members and stale ids.
   */
  tryMembershipById(agentId: string): ResearchMembership | undefined {
    const agent = this.ctx.agents.get(brandString<CoreSessionId>(agentId))
    return agent === undefined ? undefined : this.tryMembership(agent)
  }

  /**
   * Live root Agent governing one durable member Session identity.
   * @param memberId - the member's Session identity.
   * @returns the exact live Lead Agent owning the member's team log.
   */
  rootOfMember(memberId: ResearchMember['id']): Agent | undefined {
    const agent = this.ctx.agents.get(memberId as unknown as CoreSessionId)
    if (agent === undefined) return undefined
    const parentId = agent.session.header.parentSession
    if (parentId === undefined) return undefined
    return this.ctx.agents.get(parentId)
  }

  /**
   * Whether one member's active in-progress claims cover a write path. Union
   * of every in_progress task the member owns (single-active-task enforcement
   * keeps that set at one claim in practice; the union is still the semantics
   * recorded in the frozen design decisions).
   * @param memberId - the member whose claims are consulted.
   * @param path - normalized write path to test against the claim scopes.
   */
  memberMayWrite(memberId: ResearchMember['id'], path: string): boolean {
    const root = this.rootOfMember(memberId)
    if (root === undefined) return false
    try {
      const state = this.journal.state(root)
      for (const task of Object.values(state.tasks)) {
        if (task.status !== 'in_progress' || task.ownerId !== memberId) continue
        if (task.writeScopes.some(scope => scopeContains(scope, path))) return true
      }
      return false
    } catch {
      // A latched or unregistered projection must deny writes, never allow.
      return false
    }
  }

  /**
   * Reconcile one resumed agent's provisioning state. Only the Lead pass
   * touches the durable roster; teammates resume through their continuable
   * child Session without a roster write.
   * @param agent - newly started exact live Agent.
   * @param signal - shared cancellation for persistence inspection.
   */
  async recoverFor(agent: Agent, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const membership = this.tryMembership(agent)
    if (membership !== undefined && membership.role === 'lead') {
      await this.reconcileProvisioning(membership.root, signal)
    }
  }

  /**
   * Create one named, continuable direct child of the research Lead.
   * @param caller - exact live Lead Agent.
   * @param request - immutable name, description, provider, context, prompt.
   * @returns the live roster view of the active member.
   */
  async spawnMember(caller: Agent, request: SpawnMemberRequest): Promise<ResearchMemberView> {
    const membership = this.membership(caller)
    if (membership.role !== 'lead') {
      throw new ResearchTeamError(
        `${DSH_RESEARCH_TEAM_ERROR_PREFIX}NOT_AUTHORIZED`,
        'only the research Lead can create members',
      )
    }
    const root = membership.root
    const signal = AbortSignal.any([request.signal, this.shutdown.signal])
    signal.throwIfAborted()
    const name = this.memberName(request.name)
    const description = requiredText(request.description, 'description', MAX_DESCRIPTION_LENGTH)
    const provider = requiredText(request.provider, 'provider', MAX_PROVIDER_LENGTH)
    const childRaw = randomUUID()
    const childId = brandString<CoreSessionId>(childRaw)
    const member: ResearchMember = {
      id: sessionId(childRaw),
      name,
      description,
      provider,
      context: request.context,
      phase: 'provisioning',
    }

    await this.journal.transact(root.id, async () => {
      const state = this.journal.state(root)
      if (Object.values(state.members).some(entry => entry.name === name)) {
        throw new ResearchTeamError(
          `${DSH_RESEARCH_TEAM_ERROR_PREFIX}NOT_AUTHORIZED`,
          `member name "${name}" was already used in this research team`,
        )
      }
      await this.journal.appendAndFlush(root, 'research/member', {
        version: 1,
        teamId: TeamId(root.id),
        member,
      })
    })

    try {
      await this.ctx.subagents.startContinuable({
        childId,
        provider,
        label: description,
        request: { prompt: request.prompt, parent: root },
        signal,
      })
    } catch (error: unknown) {
      const failed: ResearchMember = {
        ...member,
        phase: 'failed',
        error: errorMessage(error),
      }
      const conflict = await this.settleProvisioning(root, failed)
      await this.ctx.subagents.drainContinuableChildren(root, [childId])
      if (conflict === 'active') {
        throw new ResearchTeamError(
          `${DSH_RESEARCH_TEAM_ERROR_PREFIX}NOT_AUTHORIZED`,
          `member "${name}" became active while its creation reported failure`,
        )
      }
      throw error
    }

    const active: ResearchMember & { readonly phase: 'active' } = { ...member, phase: 'active' }
    const settled = await this.settleProvisioning(root, active)
    if (settled === 'failed') {
      await this.ctx.subagents.drainContinuableChildren(root, [childId])
      throw new ResearchTeamError(
        `${DSH_RESEARCH_TEAM_ERROR_PREFIX}NOT_AUTHORIZED`,
        `member "${name}" was reconciled as failed while creation was in progress`,
      )
    }
    return this.memberView(active)
  }

  /** Abort in-flight creation work (service teardown). */
  close(): void {
    this.shutdown.abort()
  }

  /** Settle provisioning-only members from their independently durable child Sessions. */
  private async reconcileProvisioning(root: Agent, signal: AbortSignal): Promise<void> {
    const provisioning = Object.values(this.journal.state(root).members)
      .filter(member => member.phase === 'provisioning')
    for (const member of provisioning) {
      signal.throwIfAborted()
      // A live child means creation is still completing in this process.
      if (this.ctx.agents.get(member.id as unknown as CoreSessionId) !== undefined) continue
      let phase: 'active' | 'failed' = 'failed'
      let failure = 'provisioning did not leave a resumable child Session'
      try {
        const loaded = await this.ctx.sessionPersistence.inspect(
          member.id as unknown as CoreSessionId,
          signal,
        )
        const suffix = loaded.events.slice(loaded.inheritedEventCount)
        const descriptor = foldSubagentDescriptor(suffix)
        if (loaded.meta.parentSession === root.id
          && descriptor?.mode === 'continuable'
          && descriptor.provider === member.provider) {
          phase = 'active'
        } else {
          failure = 'persisted child Session does not match the provisioned continuation'
        }
      } catch (error: unknown) {
        failure = `child Session recovery failed: ${errorMessage(error)}`
      }
      signal.throwIfAborted()
      await this.journal.transact(root.id, async () => {
        signal.throwIfAborted()
        const current = Object.values(this.journal.state(root).members)
          .find(candidate => candidate.id === member.id)
        if (current === undefined || current.phase !== 'provisioning') return
        const settled: ResearchMember = {
          ...current,
          phase,
          ...phase === 'failed' ? { error: failure } : {},
        }
        await this.journal.appendAndFlush(root, 'research/member', {
          version: 1,
          teamId: TeamId(root.id),
          member: settled,
        })
      })
    }
  }

  /** Roster row for one active member with the live agent's runtime status. */
  private memberView(member: ResearchMember & { readonly phase: 'active' }): ResearchMemberView {
    const live = this.ctx.agents.get(member.id as unknown as CoreSessionId)
    return {
      id: member.id,
      name: member.name,
      role: 'teammate',
      status: live?.status ?? 'inactive',
      ...live?.options.model === undefined ? {} : { model: live.options.model },
      diagnostics: [],
    }
  }

  /** Append one terminal provisioning edge unless recovery already settled it. */
  private async settleProvisioning(
    root: Agent,
    terminal: ResearchMember,
  ): Promise<'active' | 'failed'> {
    return this.journal.transact(root.id, async () => {
      const current = Object.values(this.journal.state(root).members)
        .find(member => member.id === terminal.id)
      // v8 ignore next 3 -- the append-only provisioning event is committed by
      // the spawner before settlement can be reached.
      if (current === undefined) {
        throw new ResearchTeamError(
          `${DSH_RESEARCH_TEAM_ERROR_PREFIX}INVALID_EVENT`,
          `provisioned member "${terminal.id}" disappeared`,
        )
      }
      if (current.phase !== 'provisioning') return current.phase
      await this.journal.appendAndFlush(root, 'research/member', {
        version: 1,
        teamId: TeamId(root.id),
        member: terminal,
      })
      return terminal.phase === 'active' ? 'active' : 'failed'
    })
  }

  /** Whether one Session's own suffix identifies a provider-owned subagent child. */
  private subagentDescriptor(agent: Agent): boolean {
    return foldSubagentDescriptor(agent.session.ownEvents()) !== undefined
  }

  /** Roster row for one child Session id inside a candidate root's projection. */
  private memberRow(parent: Agent, childId: CoreSessionId): ResearchMember | undefined {
    try {
      const row = this.journal.state(parent).members[childId as unknown as string]
      return row
    } catch {
      return undefined
    }
  }

  /** Lead membership for the top-most live agent of its own root. */
  private leadMembership(root: Agent): ResearchMembership {
    return {
      root,
      id: TeamId(root.id),
      memberId: sessionId(root.id),
      role: 'lead',
      name: 'lead',
    }
  }

  /** Validate a never-reused model-facing member name. */
  private memberName(value: string): string {
    if (!MEMBER_NAME.test(value) || value.length > MAX_NAME_LENGTH || value === 'lead') {
      throw new TypeError(
        `member name must be lower-kebab-case, at most ${String(MAX_NAME_LENGTH)} characters, and not "lead"`,
      )
    }
    return value
  }
}

/** Require a trimmed, bounded text field (malformed caller input). */
function requiredText(value: string, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} is required`)
  }
  return value.trim().slice(0, maxLength)
}
