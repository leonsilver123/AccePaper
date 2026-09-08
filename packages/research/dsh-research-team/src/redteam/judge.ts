// @deepseek-ai/dsh-research-team — T22 judge (pure): rebuttal round → verdict.
//
// PURE-LOGIC LAYER. The judge consumes the CORE gate-A adjudicator
// (`dsh-research-core/src/gates` `adjudicate`) as the SINGLE decision source:
// it never recounts votes, never re-weights, never re-interprets an outcome.
// Its only job is a thin, deterministic projection of one completed
// rebuttal round into a ResearchVerdict, plus defensive rejection of
// incomplete rounds and uncalibrated configs (no threshold constants live
// here — calibration is injected by the host via AdjudicationConfig).
//
// Mapping (single interpretation point is core's GATE_OUTCOME_TO_INTENT):
//   passed → keep (intent pass)
//   failed → drop (intent hard_fail)
//   blocked/abstained → abstain (intent rework / hold_abstained)

import type {
  AdjudicationConfig,
  AdjudicationInput,
  AdjudicationResult,
  StateMachineGateIntent,
} from '@deepseek-ai/dsh-research-core'
import { adjudicate, gateToStateMachineIntent } from '@deepseek-ai/dsh-research-core'

import { freezeValue, researchTeamError } from '../types.ts'
import type { RebuttalRound } from './rebuttal.ts'

/** Final verdict over one (claim × judgment point) rebuttal round. */
export interface ResearchVerdict {
  readonly roundId: string
  readonly claimRef: string
  readonly gate: string
  readonly verdict: 'keep' | 'drop' | 'abstain'
  readonly outcome: 'passed' | 'blocked' | 'failed' | 'abstained'
  readonly intent: StateMachineGateIntent
  readonly reasonCode: string
  readonly summary: string
  readonly abstentionReason?: string
  readonly voteTally?: Readonly<Record<string, number>>
  readonly sameFamilyClusters?: readonly string[]
  readonly evidenceRefs: readonly string[]
  readonly timestamp: number
}

const VERDICT_BY_OUTCOME = {
  passed: 'keep',
  failed: 'drop',
  blocked: 'abstain',
  abstained: 'abstain',
} as const

/** Deterministic, role-ordered summary (cast order — stable across runs). */
function buildSummary(round: RebuttalRound): string {
  return round.votes
    .map(v => `[${v.voterRole}] ${v.position}: ${v.rationale}`)
    .join(' | ')
}

/**
 * Project one COMPLETED rebuttal round into a ResearchVerdict via the core
 * gate-A adjudicator. Throws DSH_RESEARCH_TEAM_JUDGE_ROUND_INCOMPLETE unless
 * the round is completed with exactly one accepted vote per expected role.
 * Config thresholds are NOT interpreted here: an empty/uncalibrated config
 * makes core abstain (NO DEFAULT PASS) and the judge abstains too.
 */
export function judgeRound(
  round: RebuttalRound,
  config: AdjudicationConfig,
  timestamp: number,
  claimId?: string,
): Readonly<ResearchVerdict> {
  if (round.status !== 'completed') {
    researchTeamError('JUDGE_ROUND_INCOMPLETE', `judgeRound: round '${round.roundId}' is ${round.status}, not 'completed'`)
  }
  const expected = new Set(round.expectedRoles)
  const counts = new Map<string, number>()
  for (const v of round.votes) counts.set(v.voterRole, (counts.get(v.voterRole) ?? 0) + 1)
  if (round.votes.length !== expected.size || round.expectedRoles.some(role => counts.get(role) !== 1)) {
    researchTeamError(
      'JUDGE_ROUND_INCOMPLETE',
      `judgeRound: round '${round.roundId}' must have exactly one accepted vote per expected role (allRolesVoted)`,
    )
  }

  const input: AdjudicationInput = {
    claimId: (claimId ?? round.claimRef) as AdjudicationInput['claimId'],
    component: 'A',
    votes: round.votes.map(v => ({
      voterRole: v.voterRole,
      ...(v.modelFamily === undefined ? {} : { modelFamily: v.modelFamily }),
      position: v.position,
      rationale: v.rationale,
    })),
    config,
    timestamp,
  }

  const result: AdjudicationResult = adjudicate(input)
  const outcome = result.outcome
  return freezeValue<ResearchVerdict>({
    roundId: round.roundId,
    claimRef: round.claimRef,
    gate: round.gate,
    verdict: VERDICT_BY_OUTCOME[outcome],
    outcome,
    intent: gateToStateMachineIntent(outcome),
    reasonCode: result.reasonCode,
    summary: buildSummary(round),
    ...(result.abstentionReason === undefined ? {} : { abstentionReason: result.abstentionReason }),
    ...(result.voteTally === undefined ? {} : { voteTally: result.voteTally }),
    ...(result.sameFamilyClusters === undefined ? {} : { sameFamilyClusters: result.sameFamilyClusters }),
    evidenceRefs: result.evidenceRefs,
    timestamp,
  })
}
