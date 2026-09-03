// @deepseek-ai/dsh-research-team — red-team rebuttal round state machine (pure).
//
// PURE-LOGIC LAYER (T21, spec §0/§5). A rebuttal round groups one (claim ×
// judgment point) review: the fleet Lead opens a round for an ordered set of
// expected voter roles, each role casts at most ONE vote
// (support | refute | abstain + a non-empty rationale), and the round is
// completed once every expected role has voted. The fleet ONLY votes — it
// never adjudicates (T22/judge owns the verdict; gate A is a pure function in
// `dsh-research-core/src/gates`).
//
// State machine (idempotent at the terminal edge):
//   pending → submitted (first accepted vote) → completed (closeRound)
//   completed → completed (idempotent no-op)
// Rejections carry typed codes: a vote by a role the round does not expect is
// {@link DSH_RESEARCH_TEAM_REBUTTAL_UNKNOWN_ROLE}, a second vote by the same
// role is {@link DSH_RESEARCH_TEAM_DUPLICATE_VOTE}, and a structurally
// malformed vote / an empty-rationale vote / an illegal transition is
// {@link DSH_RESEARCH_TEAM_INVALID_REBUTTAL}.
//
// The message→vote mapping convention mirrors the `AdjudicationVote` field
// contract (`dsh-research-core/src/contracts.ts:239`): voterRole is a ROLE
// (persona name), never a model id; modelFamily is optional so same-family
// votes can be detected + downweighted by the gate; position is the three-way
// union; rationale is non-empty.

import { freezeValue, researchTeamError, sessionId } from '../types.ts'
import type { ResearchRebuttal, SessionId } from '../types.ts'
import { requirePersonaName } from './personas.ts'

/** The three allowed vote positions (runtime mirror of the domain union). */
export const REBUTTAL_POSITION_VALUES = ['support', 'refute', 'abstain'] as const
export type RebuttalPositionValue = (typeof REBUTTAL_POSITION_VALUES)[number]

/** Lifecycle of one rebuttal round. */
export const REBUTTAL_ROUND_STATUSES = ['pending', 'submitted', 'completed'] as const
export type RebuttalRoundStatus = (typeof REBUTTAL_ROUND_STATUSES)[number]

/** A single round of red-team rebuttal over one claim at one judgment point. */
export interface RebuttalRound {
  /** Stable identity grouping this (claim × judgment point) review. */
  readonly roundId: string
  /** Claim reference text/id under rebuttal. */
  readonly claimRef: string
  /** Judgment point identifier (e.g. 'A2' / 'B1' / 'C2'), caller-owned. */
  readonly gate: string
  /** Ordered roles that must each cast one vote before the round completes. */
  readonly expectedRoles: ReadonlyArray<string>
  readonly status: RebuttalRoundStatus
  /** Accepted votes, one per expected role, in cast order. */
  readonly votes: ReadonlyArray<ResearchRebuttal>
}

/** One structured vote submission before round-level checks (voterId = the
 *  durable member Session identity that returned the vote). */
export interface RebuttalVoteInput {
  readonly voterId: SessionId
  readonly voterRole: string
  readonly position: RebuttalPositionValue
  readonly rationale: string
  readonly modelFamily?: string
}

/** Structural vote fields parsed out of one raw vote message (round checks
 *  come later, against the round's expectedRoles). */
export interface ParsedRebuttalVote {
  readonly voterRole: string
  readonly position: RebuttalPositionValue
  readonly rationale: string
  readonly modelFamily?: string
}

/** Parse a raw position value against the runtime position list. */
export function parseRebuttalPosition(value: unknown): RebuttalPositionValue | undefined {
  return REBUTTAL_POSITION_VALUES.find(position => position === value)
}

/** Parse + validate the STRUCTURAL fields of one raw vote message (object
 *  shape / non-empty rationale / legal position / clean modelFamily). Role
 *  membership and duplication are round concerns, not message concerns.
 *  @throws {@link DSH_RESEARCH_TEAM_INVALID_REBUTTAL} on a malformed message. */
export function parseRebuttalVote(message: unknown): ParsedRebuttalVote {
  if (typeof message !== 'object' || message === null) {
    researchTeamError('INVALID_REBUTTAL', `rebuttal vote message must be an object (got ${String(message)})`)
  }
  const record = message as Readonly<Record<string, unknown>>
  const voterRole = requiredRoleText(record.voterRole)
  const position = parseRebuttalPosition(record.position)
  if (position === undefined) {
    researchTeamError(
      'INVALID_REBUTTAL',
      `rebuttal vote position must be one of ${REBUTTAL_POSITION_VALUES.join('|')} (got ${JSON.stringify(record.position)})`,
    )
  }
  const rationale = requiredRoleText(record.rationale)
  const modelFamily = optionalCleanText(record.modelFamily)
  return { voterRole, position, rationale, ...modelFamily === undefined ? {} : { modelFamily } }
}

/** Open one round for an ordered expected-role set.
 *  @throws {@link DSH_RESEARCH_TEAM_INVALID_REBUTTAL} on empty/malformed input. */
export function createRebuttalRound(input: {
  readonly roundId: string
  readonly claimRef: string
  readonly gate: string
  readonly expectedRoles: ReadonlyArray<string>
}): RebuttalRound {
  const roundId = requiredRoleText(input.roundId)
  const claimRef = requiredRoleText(input.claimRef)
  const gate = requiredRoleText(input.gate)
  const roles = [...input.expectedRoles]
  if (roles.length === 0) {
    researchTeamError('INVALID_REBUTTAL', 'a rebuttal round must expect at least one voter role')
  }
  const seen = new Set<string>()
  for (const role of roles) {
    requirePersonaName(role)
    if (seen.has(role)) {
      researchTeamError('INVALID_REBUTTAL', `rebuttal round ${JSON.stringify(roundId)} repeats expected role "${role}"`)
    }
    seen.add(role)
  }
  return freezeValue({
    roundId,
    claimRef,
    gate,
    expectedRoles: [...seen],
    status: 'pending',
    votes: [],
  } satisfies RebuttalRound)
}

/** Cast one role's vote into the round. Rejects an unknown role
 *  ({@link DSH_RESEARCH_TEAM_REBUTTAL_UNKNOWN_ROLE}), a duplicate vote by the
 *  same role ({@link DSH_RESEARCH_TEAM_DUPLICATE_VOTE}), a vote on a completed
 *  round, and a structurally malformed vote
 *  ({@link DSH_RESEARCH_TEAM_INVALID_REBUTTAL}). Accepting the first vote
 *  moves the round pending → submitted. */
export function castRebuttalVote(round: RebuttalRound, vote: RebuttalVoteInput): RebuttalRound {
  if (round.status === 'completed') {
    researchTeamError('INVALID_REBUTTAL', `rebuttal round "${round.roundId}" is completed and accepts no more votes`)
  }
  if (!round.expectedRoles.includes(vote.voterRole)) {
    researchTeamError(
      'REBUTTAL_UNKNOWN_ROLE',
      `rebuttal round "${round.roundId}" does not expect role "${vote.voterRole}" (expected ${round.expectedRoles.join(', ')})`,
    )
  }
  if (round.votes.some(accepted => accepted.voterRole === vote.voterRole)) {
    researchTeamError(
      'DUPLICATE_VOTE',
      `rebuttal round "${round.roundId}" already received a vote from role "${vote.voterRole}"`,
    )
  }
  const rationale = requiredRoleText(vote.rationale)
  const modelFamily = optionalCleanText(vote.modelFamily)
  const accepted: ResearchRebuttal = {
    roundId: round.roundId,
    claimRef: round.claimRef,
    gate: round.gate,
    voterRole: vote.voterRole,
    voterId: sessionId(vote.voterId),
    position: vote.position,
    rationale,
    ...modelFamily === undefined ? {} : { modelFamily },
  }
  return freezeValue({
    ...round,
    status: 'submitted',
    votes: [...round.votes, accepted],
  })
}

/** Close a round once it has accepted votes (submitted → completed). Completed
 *  is terminal and idempotent: closing an already-completed round returns it
 *  unchanged. A round with no accepted vote cannot close — the fleet output is
 *  insufficient and the round must stay blocked (never entered into judge). */
export function closeRebuttalRound(round: RebuttalRound): RebuttalRound {
  if (round.status === 'completed') return round
  if (round.votes.length === 0) {
    researchTeamError(
      'INVALID_REBUTTAL',
      `rebuttal round "${round.roundId}" has no votes; an empty round is blocked, not completed`,
    )
  }
  return freezeValue({ ...round, status: 'completed' })
}

/** Whether every expected role has already voted (round is fully populated). */
export function allRolesVoted(round: RebuttalRound): boolean {
  return round.expectedRoles.every(role => round.votes.some(vote => vote.voterRole === role))
}

/** The adjudication-vote projection of a round's accepted votes — the exact
 *  field contract the future T22/judge gate consumes (voterRole / modelFamily?
 *  / position / rationale). Round bookkeeping fields are dropped. */
export function adjudicationVotes(round: RebuttalRound): ReadonlyArray<{
  readonly voterRole: string
  readonly modelFamily?: string
  readonly position: RebuttalPositionValue
  readonly rationale: string
}> {
  return round.votes.map(vote => ({
    voterRole: vote.voterRole,
    position: vote.position,
    rationale: vote.rationale,
    ...vote.modelFamily === undefined ? {} : { modelFamily: vote.modelFamily },
  }))
}

/** Require a non-empty trimmed role/id text field. */
function requiredRoleText(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    researchTeamError('INVALID_REBUTTAL', `expected a non-empty string, got ${JSON.stringify(value)}`)
  }
  return value.trim()
}

/** Require an optional non-empty trimmed text field (empty → undefined). */
function optionalCleanText(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    researchTeamError('INVALID_REBUTTAL', `expected an optional non-empty string, got ${JSON.stringify(value)}`)
  }
  return value.trim()
}
