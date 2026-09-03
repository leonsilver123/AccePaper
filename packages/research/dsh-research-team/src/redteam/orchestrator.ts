// @deepseek-ai/dsh-research-team — red-team fleet orchestrator (adapter).
//
// ADAPTER LAYER (T21, spec §3). The host composition a research Lead drives to
// run one rebuttal round over a claim at a judgment point:
//   deploy()         — spawn the configured fleet personas as continuable
//                      members (persona text / read-only toolFilter / optional
//                      model override all persist in the child descriptor);
//   startRebuttal()  — open a round: one writeScopes=[] board task per role +
//                      one assignment message delivered to each member;
//   submitRebuttal() — the Lead (the ONLY writer) validates each returned vote,
//                      appends the durable `research/rebuttal` event, completes
//                      the member's assignment task, and closes the round once
//                      every expected role voted;
//   roundVotes()     — the gate-facing adjudication-vote projection of a round.
//
// Boundary (spec §0): the fleet only votes — no verdict is produced here.
// Adjudication is T22/judge + the pure gate-A function in dsh-research-core.
// Rounds mirror the write-scope boundary: fleet members never write the Lead
// log; they vote by messaging the Lead, who commits the events.

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId as CoreSessionId } from '@deepseek-ai/dsh-session'
import type { ResearchJournal } from '../journal.ts'
import type { ResearchRoster } from '../roster.ts'
import type { ResearchTaskBoard } from '../task-board.ts'
import { researchTeamError, sessionId, TeamId } from '../types.ts'
import type { ResearchMemberView, SessionId, TeamTaskId } from '../types.ts'
import type { ResearchMembership } from '../roster.ts'
import { personaCharter } from './personas.ts'
import type { RedTeamPersona } from './personas.ts'
import { resolveFleet } from './fleet-config.ts'
import type { RedTeamFleetConfig } from './fleet-config.ts'
import {
  adjudicationVotes,
  allRolesVoted,
  castRebuttalVote,
  closeRebuttalRound,
  createRebuttalRound,
  parseRebuttalVote,
} from './rebuttal.ts'
import type { RebuttalRound } from './rebuttal.ts'

/** One deployed fleet row: which persona role maps to which durable member. */
interface FleetRow {
  readonly role: string
  readonly memberId: SessionId
}

/** Outcome of {@link ResearchFleetOrchestrator.startRebuttal}: the open round
 *  plus one board task per role and the delivered assignment message ids. */
export interface RebuttalStartResult {
  readonly round: RebuttalRound
  readonly assignments: ReadonlyArray<{
    readonly role: string
    readonly taskId: TeamTaskId
    readonly messageId: string
  }>
}

/** Request body for opening one rebuttal round over a (claim × judgment point). */
export interface RebuttalStartInput {
  readonly claimRef: string
  readonly gate: string
  /** Ordered role subset to poll; defaults to every deployed fleet role. */
  readonly roles?: ReadonlyArray<string>
}

/** Request body for committing one fleet vote returned to the Lead. */
export interface RebuttalSubmitInput {
  readonly roundId: string
  /** Durable Session identity of the fleet member that returned the vote. */
  readonly voterId: SessionId
  /** The structured vote payload the member returned (parsed here). */
  readonly message: unknown
}

/** Composes the roster, journal, and task board into the Lead-driven fleet flow. */
export class ResearchFleetOrchestrator {
  /** Role → durable member mapping per team (in deployment order). */
  private readonly fleetByLead = new Map<string, ReadonlyArray<FleetRow>>()
  /** In-flight rounds (accepted votes are also durable Lead-log events). */
  private readonly rounds = new Map<string, RebuttalRound>()

  /**
   * @param ctx - service context (agents registry + subagent steering).
   * @param journal - authoritative Lead-log transaction owner.
   * @param roster - member spawn / membership authority.
   * @param tasks - CAS task board the assignments ride on.
   */
  constructor(
    private readonly ctx: Context,
    private readonly journal: ResearchJournal,
    private readonly roster: ResearchRoster,
    private readonly tasks: ResearchTaskBoard,
  ) {}

  /**
   * Deploy the configured fleet personas as continuable members of the Lead's
   * team. Every row is spawned through the roster, which persists the persona
   * text / read-only toolFilter / model override into each child's descriptor.
   * Redeploying the same team rejects on the roster's name-reuse rule.
   * @param caller - exact live research Lead Agent.
   * @param config - fleet config (defaults to the frozen five personas).
   * @param provider - continuation provider name ('spawn' default).
   * @returns the live member views, in deployment order.
   */
  async deploy(
    caller: Agent,
    config: RedTeamFleetConfig = {},
    provider = 'spawn',
  ): Promise<ReadonlyArray<ResearchMemberView>> {
    const membership = this.requireLead(caller)
    const fleet = resolveFleet(config)
    const rows: FleetRow[] = []
    const views: ResearchMemberView[] = []
    for (const entry of fleet.members) {
      const persona = entry.persona
      const view = await this.roster.spawnMember(caller, {
        name: persona.name,
        description: this.charterLabel(persona),
        provider,
        context: 'fresh',
        prompt: [this.text(personaCharter(persona))],
        signal: new AbortController().signal,
        persona: persona.persona,
        ...entry.model === undefined ? {} : { agentOptions: { model: entry.model } },
        ...persona.toolFilter.length === 0
          ? {}
          : { toolFilter: { allow: [...persona.toolFilter] } },
      })
      rows.push({ role: persona.name, memberId: view.id })
      views.push(view)
    }
    this.fleetByLead.set(membership.root.id, rows)
    return views
  }

  /**
   * Open one rebuttal round over a (claim × judgment point): create one
   * writeScopes=[] board task per polled role, deliver the assignment message
   * to each member, and register the pending round.
   * @param caller - exact live research Lead Agent.
   * @param input - claim reference, judgment point, and optional role subset.
   * @returns the pending round plus its board tasks and delivered message ids.
   */
  async startRebuttal(caller: Agent, input: RebuttalStartInput): Promise<RebuttalStartResult> {
    const membership = this.requireLead(caller)
    const rows = this.requireFleet(membership.root.id)
    const roles = input.roles === undefined
      ? rows.map(row => row.role)
      : [...input.roles]
    const expected = rows.filter(row => roles.includes(row.role))
    if (expected.length !== roles.length) {
      const deployed = rows.map(row => row.role).join(', ')
      researchTeamError(
        'FLEET_NOT_DEPLOYED',
        `rebuttal round polls a role that is not deployed in this team (deployed: ${deployed})`,
      )
    }
    const round = createRebuttalRound({
      roundId: randomUUID(),
      claimRef: input.claimRef,
      gate: input.gate,
      expectedRoles: expected.map(row => row.role),
    })
    const assignments: Array<{ role: string; taskId: TeamTaskId; messageId: string }> = []
    for (const row of expected) {
      const task = await this.tasks.create(membership, {
        subject: `rebuttal:${round.roundId}:${row.role}`,
        description: `assignment for ${row.role} in rebuttal round ${round.roundId}`,
        writeScopes: [],
      })
      const messageId = await this.ctx.subagents.sendMessage(
        caller,
        brandString<CoreSessionId>(row.memberId),
        [this.text(this.assignmentText(round, row.role))],
        { signal: new AbortController().signal },
      )
      assignments.push({ role: row.role, taskId: task.id, messageId })
    }
    this.rounds.set(round.roundId, round)
    return { round, assignments }
  }

  /**
   * Commit one fleet vote returned to the Lead. Validates the message into the
   * vote contract, appends the durable `research/rebuttal` event, completes
   * the member's assignment task, and closes the round once every expected
   * role has voted. Only the research Lead may record rebuttal events.
   * @param caller - exact live research Lead Agent.
   * @param input - the round, the voting member, and the returned payload.
   * @returns the updated round (submitted, or completed when the last role voted).
   */
  async submitRebuttal(caller: Agent, input: RebuttalSubmitInput): Promise<RebuttalRound> {
    const membership = this.requireLead(caller)
    const round = this.rounds.get(input.roundId)
    if (round === undefined) {
      researchTeamError('ROUND_NOT_FOUND', `rebuttal round "${input.roundId}" is not open`)
    }
    const parsed = parseRebuttalVote(input.message)
    const row = this.requireFleet(membership.root.id)
      .find(entry => entry.role === parsed.voterRole)
    if (row === undefined) {
      researchTeamError(
        'FLEET_NOT_DEPLOYED',
        `vote role "${parsed.voterRole}" is not deployed in this team`,
      )
    }
    if (row.memberId !== input.voterId) {
      researchTeamError(
        'NOT_AUTHORIZED',
        `vote role "${parsed.voterRole}" is assigned to member "${row.memberId}", not "${input.voterId}"`,
      )
    }
    const modelFamily = this.ctx.agents
      .get(brandString<CoreSessionId>(input.voterId))?.options.model
    const next = castRebuttalVote(round, {
      voterId: sessionId(input.voterId),
      voterRole: parsed.voterRole,
      position: parsed.position,
      rationale: parsed.rationale,
      ...modelFamily === undefined ? {} : { modelFamily },
    })
    const root = membership.root
    const accepted = next.votes[next.votes.length - 1]
    // v8 ignore next 3 -- castRebuttalVote always appends exactly one record
    // to an open round, so this guard is provably unreachable in-process.
    if (accepted === undefined) {
      researchTeamError('INVALID_REBUTTAL', `round "${round.roundId}" accepted no vote`)
    }
    await this.journal.appendAndFlush(root, 'research/rebuttal', {
      version: 1,
      teamId: TeamId(root.id),
      rebuttal: accepted,
    })
    await this.completeAssignmentTask(membership, round.roundId, input.voterId)
    const settled = allRolesVoted(next) ? closeRebuttalRound(next) : next
    this.rounds.set(input.roundId, settled)
    return settled
  }

  /** The gate-facing adjudication-vote projection of one round.
   *  @param roundId - the open or closed round identity. */
  roundVotes(roundId: string): ReadonlyArray<{
    readonly voterRole: string
    readonly modelFamily?: string
    readonly position: 'support' | 'refute' | 'abstain'
    readonly rationale: string
  }> {
    const round = this.rounds.get(roundId)
    if (round === undefined) {
      researchTeamError('ROUND_NOT_FOUND', `rebuttal round "${roundId}" is not open`)
    }
    return adjudicationVotes(round)
  }

  /** Require the caller to be the exact live research Lead of its team. */
  private requireLead(caller: Agent): ResearchMembership {
    const membership = this.roster.membership(caller)
    if (membership.role !== 'lead') {
      researchTeamError(
        'NOT_AUTHORIZED',
        `fleet orchestration requires the research Lead (caller "${membership.memberId}" is "${membership.role}")`,
      )
    }
    return membership
  }

  /** Require a deployed fleet ledger for one team. */
  private requireFleet(rootId: string): ReadonlyArray<FleetRow> {
    const rows = this.fleetByLead.get(rootId)
    if (rows === undefined || rows.length === 0) {
      researchTeamError('FLEET_NOT_DEPLOYED', 'no red-team fleet has been deployed for this Lead')
    }
    return rows
  }

  /** Complete the polled role's assignment task once the member claimed it.
   *  A vote the member returned without claiming its task is still recorded;
   *  the task stays pending for the member's own later close-out. */
  private async completeAssignmentTask(
    membership: ResearchMembership,
    roundId: string,
    voterId: SessionId,
  ): Promise<void> {
    const state = this.journal.state(membership.root)
    const task = Object.values(state.tasks).find(candidate =>
      candidate.status === 'in_progress'
      && candidate.ownerId === voterId
      && candidate.subject.startsWith(`rebuttal:${roundId}:`))
    if (task === undefined) return
    const completed = await this.tasks.update(membership, {
      taskId: task.id,
      expectedRevision: task.revision,
      action: 'complete',
    })
    // v8 ignore next 3 -- the CAS intent read the task snapshot in the same
    // serialized tick as this completion, so a stale revision is unreachable.
    if (!completed.ok) {
      researchTeamError(
        'INVALID_REBUTTAL',
        `could not complete rebuttal assignment task "${task.id}": ${completed.error.message}`,
      )
    }
  }

  /** Short stable label describing one fleet member's role. */
  private charterLabel(persona: RedTeamPersona): string {
    return `[red-team:${persona.name}] ${persona.title}`
  }

  /** One content block carrying text. */
  private text(value: string): ContentBlock {
    return { type: 'text', text: value }
  }

  /** The assignment prompt text polled to one role in a round. */
  private assignmentText(round: RebuttalRound, role: string): string {
    return `[rebuttal] round ${round.roundId}\nclaim: ${round.claimRef}\ngate: ${round.gate}\n`
      + `role: ${role}\n\n用只读工具核验证据,并只返回如下 JSON vote(不要写入任何研究产物):\n`
      + `{"voterRole": ${JSON.stringify(role)}, "position": "support|refute|abstain", "rationale": "你的理由"}`
  }
}
