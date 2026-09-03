// @deepseek-ai/dsh-research-team — cordis service wiring (package entry).
//
// ADAPTER LAYER (T20). The single wiring point for the research-team plugin.
// Everything above this file is deliberately host-free or thin:
//   - the pure layer (types / revision / projection fold / scope-guard decide)
//     never touches ctx;
//   - the thin adapters (journal / roster / task-board / research-guard /
//     session-events / research-projection) consume specific ctx services but
//     stay composable;
//   - THIS module owns the cordis Service, the `ctx.agentTeams` augmentation,
//     projection registration, the one global write-scope guard, and the
//     resume-recovery lifecycle hooks — so the package's host surface has a
//     single construction site (mirroring `@deepseek-ai/dsh-agent-team`).
//
// Wiring responsibilities (§3 of the frozen T20 design spec):
//   1. `super(ctx, 'agentTeams')` + `declare module '@deepseek-ai/cordis'`
//      expose the service to host plugins. This index entry is what the host
//      imports, so the module augmentations that live below it (the
//      `research/*` SessionEventMap injection in session-events.ts and the
//      `researchTeam` SessionProjectionStateMap entry in
//      research-projection.ts) are always part of a referencing program.
//   2. `researchTeamProjectionDefinition` registers the durable `researchTeam`
//      fold on the root session-projection registry for the plugin lifetime.
//   3. `installResearchGuard` registers ONE global `ctx.tools.guard` on the
//      plugin context (the root in the supported load) for the plugin
//      lifetime. The guard is deny-only and evaluates each tool call live
//      against the durable projection, so a cold-resumed member is guarded
//      before its first turn without any per-activation re-install (DEC-003).
//   4. `agent/session-start` schedules a contained recovery pass so a resumed
//      Lead reconciles provisioning-only roster rows from their independently
//      durable child Sessions.
//
// Service hooks that agent-team needs (session/event mailbox wakeups,
// agent/status activity notifications) have no counterpart here: this package
// deliberately owns no mailbox or activity subsystem (§6 "明确不做"). Journal
// commits are synchronous observers only, so no event/status observer is
// needed to keep the durable fold or the guard current.

import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { ResearchJournal } from './journal.ts'
import { researchTeamProjectionDefinition } from './research-projection.ts'
import { installResearchGuard } from './research-guard.ts'
import { errorMessage, ResearchRoster } from './roster.ts'
import type { ResearchMembership, SpawnMemberRequest } from './roster.ts'
import { ResearchTaskBoard } from './task-board.ts'
import type { CreateResearchTaskRequest, UpdateResearchTaskRequest } from './task-board.ts'
import type { ResearchMemberView, ResearchTask, TeamMutationResult } from './types.ts'
import type { TeamTaskId } from './types.ts'
import type { SessionId } from './types.ts'
import { ResearchFleetOrchestrator } from './redteam/orchestrator.ts'
import type { RebuttalStartInput, RebuttalSubmitInput } from './redteam/orchestrator.ts'

// ───────────────────────────── Public re-exports ───────────────────────────
// The package entry re-exports its caller-visible brands, errors, entities,
// schemas, and request/result shapes so consumers import one specifier.

export type * from './types.ts'
export {
  DSH_RESEARCH_TEAM_ERROR_PREFIX,
  ResearchTeamError,
  TeamId,
  freezeValue,
  researchTeamError,
  sessionId,
  taskId,
} from './types.ts'
export { errorMessage, ResearchRoster } from './roster.ts'
export type { ResearchMembership, SpawnMemberRequest } from './roster.ts'
export { ResearchTaskBoard } from './task-board.ts'
export type { CreateResearchTaskRequest, UpdateResearchTaskRequest } from './task-board.ts'
export { researchTeamProjectionDefinition } from './research-projection.ts'
export { ResearchJournal } from './journal.ts'
// T21 red-team fleet surface: pure persona / config / rebuttal modules plus the
// orchestrator adapter. Pure modules carry zero host imports; the orchestrator
// composes the roster/journal/task-board into the Lead-driven rebuttal flow.
export { ResearchFleetOrchestrator } from './redteam/orchestrator.ts'
export type {
  RebuttalStartInput,
  RebuttalStartResult,
  RebuttalSubmitInput,
} from './redteam/orchestrator.ts'
export {
  defaultFleetPersonas,
  normalizeReadOnlyTools,
  personaByRole,
  personaCharter,
  RED_TEAM_MODEL_TIERS,
  RED_TEAM_STANCES,
  requirePersonaName,
  validatePersona,
  validatePersonas,
  validateReadOnlyTools,
} from './redteam/personas.ts'
export type {
  RedTeamModelTier,
  RedTeamPersona,
  RedTeamStance,
} from './redteam/personas.ts'
export {
  resolveFleet,
  resolveFleetRoles,
  routedModel,
  validateModelRoute,
} from './redteam/fleet-config.ts'
export type {
  RedTeamFleetConfig,
  RedTeamFleetMember,
  ResolvedRedTeamFleet,
} from './redteam/fleet-config.ts'
export {
  adjudicationVotes,
  allRolesVoted,
  castRebuttalVote,
  closeRebuttalRound,
  createRebuttalRound,
  parseRebuttalPosition,
  parseRebuttalVote,
  REBUTTAL_POSITION_VALUES,
  REBUTTAL_ROUND_STATUSES,
} from './redteam/rebuttal.ts'
export type {
  ParsedRebuttalVote,
  RebuttalPositionValue,
  RebuttalRound,
  RebuttalRoundStatus,
  RebuttalVoteInput,
} from './redteam/rebuttal.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Research-team coordination service (roster + task board + scope guard). */
    agentTeams: ResearchTeamService
  }
}

/** Deployment configuration for the research-team service. */
export interface ResearchTeamServiceConfig {
  /**
   * Write-tool allowlist whose writes are expressible as one path argument and
   * are therefore scope-checked by the global guard. Every other tool call by
   * a non-Lead member is denied. Defaults to the empty set (deny-all), which
   * is the conservative posture until the deployment configures research
   * write tools.
   */
  readonly scopeCheckedTools?: ReadonlyArray<string>
}

/** Research-team service: members, CAS tasks, and the write-scope guard. */
export class ResearchTeamService extends Service {
  static inject = ['agents', 'sessions', 'sessionPersistence', 'sessionProjections', 'subagents']

  /** The tools the global guard treats as one-path scope-checkable writes. */
  private readonly scopeCheckedTools: ReadonlySet<string>
  /** Shared cancellation for recovery passes that outlive the service. */
  private readonly disposal = new AbortController()
  private readonly journal: ResearchJournal
  private readonly roster: ResearchRoster
  private readonly tasks: ResearchTaskBoard
  /** T21 red-team fleet orchestrator composing the roster/journal/task board. */
  readonly fleet: ResearchFleetOrchestrator

  constructor(ctx: Context, config: ResearchTeamServiceConfig = {}) {
    super(ctx, 'agentTeams')
    this.scopeCheckedTools = new Set(config.scopeCheckedTools ?? [])
    // Journal commits have no cross-member waiters in this package (no mailbox
    // or activity subsystem), so the synchronous notification is intentionally
    // empty today; the journal contract keeps the seam for future observers.
    this.journal = new ResearchJournal(ctx, () => {})
    this.roster = new ResearchRoster(ctx, this.journal)
    this.tasks = new ResearchTaskBoard(this.journal)
    this.fleet = new ResearchFleetOrchestrator(ctx, this.journal, this.roster, this.tasks)

    // A resumed Lead (or member) must reconcile provisioning-only roster rows
    // before its next turn depends on them. Recovery is contained and logged,
    // never fatal to the resume path.
    ctx.on('agent/session-start', ({ agent }) => { this.scheduleRecovery(agent) })
    ctx.effect(() => {
      const disposers: Array<() => void> = [
        ctx.root.sessionProjections.register(researchTeamProjectionDefinition),
        installResearchGuard(ctx, this.roster, this.scopeCheckedTools),
      ]
      return () => {
        for (const dispose of disposers.reverse()) dispose()
        this.disposal.abort()
        this.roster.close()
      }
    }, 'researchTeam.runtime()')
  }

  /**
   * Resolve one exact live Agent's research-team role, throwing when it has
   * none. The Agent handle is the authority credential.
   */
  membership(agent: Agent): ResearchMembership {
    return this.roster.membership(agent)
  }

  /** Resolve a caller without throwing (observers and legacy membership
   *  paths; the write-scope guard consumes the roster's three-way
   *  classification directly so unprovable lineages fail closed, P2-2). */
  tryMembership(agent: Agent): ResearchMembership | undefined {
    return this.roster.tryMembership(agent)
  }

  /**
   * Create one named, continuable direct child of the research Lead.
   * @param caller - exact live Lead Agent (only the Lead may spawn).
   * @param request - immutable name/description/provider/context/prompt.
   * @returns the live roster view of the active member.
   */
  async spawnMember(caller: Agent, request: SpawnMemberRequest): Promise<ResearchMemberView> {
    return await this.roster.spawnMember(caller, request)
  }

  /**
   * Create one unowned pending task in the research Lead log.
   * @param caller - exact live research-team member.
   * @param request - task text, blockers, and advisory write scopes.
   * @returns the committed revision-one task snapshot.
   */
  async createTask(caller: Agent, request: CreateResearchTaskRequest): Promise<ResearchTask> {
    return await this.tasks.create(this.roster.membership(caller), request)
  }

  /**
   * Return one task snapshot, including a deleted tombstone.
   * @param caller - exact live research-team member.
   * @param id - team-local task identity.
   */
  getTask(caller: Agent, id: TeamTaskId): ResearchTask {
    return this.tasks.get(this.roster.membership(caller), id)
  }

  /** List current non-deleted task snapshots.
   *  @param caller - exact live research-team member. */
  listTasks(caller: Agent): ResearchTask[] {
    return this.tasks.list(this.roster.membership(caller))
  }

  /**
   * Compare-and-set one authorized task transition. Research-domain denials
   * (stale revision, unauthorized action, illegal claim…) return a typed
   * `{ ok: false, error }` envelope; unexpected failures still throw.
   * @param caller - exact live research-team member authorizing the mutation.
   * @param request - CAS intent (task id, expected revision, action).
   */
  async updateTask(caller: Agent, request: UpdateResearchTaskRequest): Promise<TeamMutationResult> {
    return await this.tasks.update(this.roster.membership(caller), request)
  }

  /** Read the member identity that backs one exact live Agent, if any.
   *  @param memberId - durable member Session identity.
   *  @returns the member's live Lead Agent, or undefined when not resolvable. */
  rootOfMember(memberId: SessionId): Agent | undefined {
    return this.roster.rootOfMember(memberId)
  }

  /** Deploy the red-team fleet personas as continuable members (T21).
   *  @param caller - exact live research Lead Agent.
   *  @param config - fleet config (defaults to the frozen five personas).
   *  @param provider - continuation provider name ('spawn' default). */
  async deployFleet(
    caller: Agent,
    config: Parameters<ResearchFleetOrchestrator['deploy']>[1] = {},
    provider: Parameters<ResearchFleetOrchestrator['deploy']>[2] = 'spawn',
  ): Promise<ReadonlyArray<ResearchMemberView>> {
    return await this.fleet.deploy(caller, config, provider)
  }

  /** Open one red-team rebuttal round over a (claim × judgment point) (T21).
   *  @param caller - exact live research Lead Agent.
   *  @param input - claim reference, judgment point, and optional role subset. */
  startRebuttal(
    caller: Agent,
    input: RebuttalStartInput,
  ): ReturnType<ResearchFleetOrchestrator['startRebuttal']> {
    return this.fleet.startRebuttal(caller, input)
  }

  /** Commit one fleet vote returned to the research Lead (T21).
   *  @param caller - exact live research Lead Agent.
   *  @param input - the round, the voting member, and the returned payload. */
  submitRebuttal(
    caller: Agent,
    input: RebuttalSubmitInput,
  ): ReturnType<ResearchFleetOrchestrator['submitRebuttal']> {
    return this.fleet.submitRebuttal(caller, input)
  }

  /** The gate-facing adjudication-vote projection of one round (T21).
   *  @param roundId - the open or closed round identity. */
  roundVotes(roundId: string): ReturnType<ResearchFleetOrchestrator['roundVotes']> {
    return this.fleet.roundVotes(roundId)
  }

  /** Queue one contained recovery pass after publication has unwound. */
  private scheduleRecovery(agent: Agent): void {
    queueMicrotask(() => {
      if (this.disposal.signal.aborted) return
      void this.recoverFor(agent).catch((error: unknown) => {
        if (this.disposal.signal.aborted) return
        this.ctx.logger.warn(`research-team recovery for "${agent.id}" failed: ${errorMessage(error)}`)
      })
    })
  }

  /** Reconcile one resumed agent's provisioning state against durable Sessions. */
  private async recoverFor(agent: Agent): Promise<void> {
    await this.roster.recoverFor(agent, this.disposal.signal)
  }
}

export default ResearchTeamService
