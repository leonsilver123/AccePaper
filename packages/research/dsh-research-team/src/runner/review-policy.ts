// @deepseek-ai/dsh-research-team — how much review a manuscript must have had before it is published.
//
// WHY A POLICY AND NOT A RETRY BOUND. `revisionRounds` bounded how many times the author could be
// asked, and the cycle stopped as soon as a round closed its issues — so ONE round that happened to
// close everything ended the review, and a manuscript could reach a package having been read once.
// The target is the opposite: a MINIMUM number of complete rounds, each of which actually read the
// manuscript. The bound and the floor are different numbers with different jobs, and reading one for
// the other is how "at most two" became "one is enough".
//
// WHAT COUNTS AS A ROUND. A pass that read the manuscript and produced its own set of issues. Two
// things do NOT count: a round whose issues are the previous round's, unchanged (the author was asked
// again and answered the same way — that is one reading, taken twice), and a round that produced
// nothing at all would count but cannot occur: D4 refuses a reply with no exchanges.
//
// WHAT "COMPLETE" MEANS FOR THE MANUSCRIPT. Every issue is `answered` — the two dispositions that are
// not answers (`open`, and `pending-verification`) are both debts, and a manuscript carrying either
// has not finished its review whatever the round count says.

import type { IssueOutcome } from './issue-patch.ts'

/** How much review a deployment requires before a manuscript may be published. */
export interface ReviewPolicy {
  /**
   * The minimum number of COMPLETE review rounds.
   *
   * Two by default, because the target is two independent readings: one round can close everything it
   * found and still have missed what a second reading would see, and a policy that accepts one round
   * cannot tell "reviewed twice" from "reviewed once".
   */
  readonly minimumRounds: number
}

/** The policy a deployment that states none is held to. */
export const DEFAULT_REVIEW_POLICY: ReviewPolicy = { minimumRounds: 2 }

/** One round as the policy reads it: which round it was, and what it left behind. */
export interface ReviewedRound {
  /** The round's index, counting from one. */
  readonly index: number
  /** The sections the round left open, and the ones left waiting for a reader. */
  readonly outcomes: ReadonlyArray<IssueOutcome>
  /** Why the cycle moved on from this round, as the driver recorded it. */
  readonly stopped: string
}

/**
 * Whether a review satisfies a policy.
 *
 * @param rounds - every round the run took, in order.
 * @param policy - what the deployment requires.
 * @returns whether it is satisfied, and when it is not, what is missing.
 */
export function reviewSatisfaction(
  rounds: ReadonlyArray<ReviewedRound>,
  policy: ReviewPolicy,
): { readonly satisfied: boolean; readonly reason: string } {
  // A ROUND THAT FOUND NOTHING NEW IS NOT A SECOND READING. `no-progress` means the author was asked
  // again and answered as before, so the manuscript was read once and the second pass added nothing —
  // counting it would let a run satisfy a two-round policy with one round repeated.
  const counted = rounds.filter(round => round.stopped !== 'no-progress')
  if (counted.length < policy.minimumRounds) {
    return {
      satisfied: false,
      reason: `the manuscript has had ${String(counted.length)} complete review round(s) and this`
        + ` deployment requires ${String(policy.minimumRounds)}`,
    }
  }
  const outstanding = rounds.flatMap(round => round.outcomes)
    .filter(outcome => outcome.disposition === 'open' || outcome.disposition === 'pending-verification')
  if (outstanding.length > 0) {
    const waiting = outstanding.filter(outcome => outcome.disposition === 'pending-verification')
    const open = outstanding.length - waiting.length
    return {
      satisfied: false,
      reason: `${String(open)} issue(s) are open and ${String(waiting.length)} are waiting for a`
        + ' reader, so the last revision has not finished its review',
    }
  }
  return {
    satisfied: true,
    reason: `${String(counted.length)} complete review round(s), every issue answered`,
  }
}
