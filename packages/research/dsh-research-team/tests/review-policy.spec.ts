/**
 * How much review a manuscript must have had, and what does not count toward it.
 *
 * THE PIPELINE REVIEW'S "TWO ROUNDS" P0. `revisionRounds` bounded how many times the author could be
 * asked, and the cycle stopped as soon as a round closed its issues — so ONE round that happened to
 * close everything ended the review. The target is a minimum number of complete readings, and the two
 * things that must not count are a round the author answered as before and an issue that is merely
 * waiting for a reader.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_REVIEW_POLICY, reviewSatisfaction } from '../src/runner/review-policy.ts'
import type { ReviewedRound } from '../src/runner/review-policy.ts'
import type { IssueOutcome } from '../src/runner/issue-patch.ts'

/** One round that left the issues a caller names, in the dispositions it names. */
function round(
  index: number,
  dispositions: ReadonlyArray<'open' | 'pending-verification' | 'answered'>,
  stopped = 'closed',
): ReviewedRound {
  return {
    index,
    stopped,
    outcomes: dispositions.map((disposition, at): IssueOutcome => ({
      issueId: `issue-${String(at + 1)}`,
      sectionId: 'method',
      disposition,
      reason: 'stated by the case',
    })),
  }
}

describe('the default policy is two complete readings', () => {
  it('is two rounds', () => {
    // A policy that accepted one round could not tell "reviewed twice" from "reviewed once", which is
    // the distinction the whole condition exists for.
    expect(DEFAULT_REVIEW_POLICY.minimumRounds).toBe(2)
  })
})

describe('a review that has not finished', () => {
  it('is refused when fewer complete rounds were taken', () => {
    const verdict = reviewSatisfaction([round(1, ['answered'])], { minimumRounds: 2 })
    expect(verdict.satisfied).toBe(false)
    expect(verdict.reason).toContain('1 complete review round(s)')
    expect(verdict.reason).toContain('requires 2')
  })

  it('is refused while an issue is open, however many rounds were taken', () => {
    const verdict = reviewSatisfaction(
      [round(1, ['answered']), round(2, ['open'])],
      { minimumRounds: 2 },
    )
    expect(verdict.satisfied).toBe(false)
    expect(verdict.reason).toContain('1 issue(s) are open')
  })

  it('is refused while a revision is waiting for a reader', () => {
    // THE CASE THE REVIEW NAMED: the patch applied, nobody read it, and the round called itself done.
    const verdict = reviewSatisfaction(
      [round(1, ['answered']), round(2, ['pending-verification'])],
      { minimumRounds: 2 },
    )
    expect(verdict.satisfied).toBe(false)
    expect(verdict.reason).toContain('waiting for a reader')
    expect(verdict.reason).toContain('has not finished its review')
  })
})

describe('what does not count as a round', () => {
  it('does not count a round that answered as the previous one did', () => {
    // `no-progress` means the author was asked again and said the same thing: the manuscript was read
    // once, and counting the repeat would let a two-round policy be satisfied by one round twice.
    const verdict = reviewSatisfaction(
      [round(1, ['answered']), round(2, ['answered'], 'no-progress')],
      { minimumRounds: 2 },
    )
    expect(verdict.satisfied).toBe(false)
    expect(verdict.reason).toContain('1 complete review round(s)')
  })

  it('counts two rounds that both found something, and says so when nothing is owed', () => {
    const verdict = reviewSatisfaction(
      [round(1, ['answered']), round(2, ['answered'])],
      { minimumRounds: 2 },
    )
    expect(verdict.satisfied).toBe(true)
    expect(verdict.reason).toContain('every issue answered')
  })

  it('accepts a first round that found nothing, as long as a second reading happened', () => {
    // A ROUND WITH NO ISSUES IS STILL A READING. The floor is met by rounds, not by findings, so a
    // manuscript that was clean on the first pass and read again satisfies a two-round policy.
    const empty: ReviewedRound = { index: 1, stopped: 'closed', outcomes: [] }
    const verdict = reviewSatisfaction([empty, round(2, [])], { minimumRounds: 2 })
    expect(verdict.satisfied).toBe(true)
  })
})
