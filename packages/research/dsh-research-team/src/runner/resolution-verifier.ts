// @deepseek-ai/dsh-research-team — whether a revision actually answers the issue it was written for.
//
// WHY THIS IS SEPARATE FROM APPLYING A PATCH. `applyRevision` knows what it did to the text: a body
// was replaced, or an answer proposed no change. It cannot know whether the concern is answered, and
// the two dispositions it used to hand back said it could — `patched` closed an issue because a patch
// applied, and `accepted_explanation` closed one because the author wrote something. The pipeline
// review of 2026-09-18 named both: a patch can land beside the sentence it is about, and an
// explanation is prose the author wrote about their own work.
//
// SO A THIRD ACT, BY SOMEBODY ELSE. A revision leaves its issues `pending-verification`; a reader who
// did not write the answer decides, per issue, whether it is ANSWERED (`answered`) or still owed one
// (`open`, with the verifier's reason recorded). The independence is not a convention here: the
// verifier's id is compared with the author's, and a verification that names the author is refused.
//
// WHO VERIFIES. A deployment supplies a verifier, the way it supplies a prose writer, a figure
// provider and an assessor — whether a machine can read a revision and judge it against the issue is
// a property of the deployment's reviewer, not of this package. A deployment that supplies none leaves
// its issues pending, which is a state a reader can see rather than a silence.

import type { IssueDisposition, IssueOutcome, RevisionIssue, SectionChange } from './issue-patch.ts'

/** What one reader decided about one pending issue. */
export interface ResolutionVerification {
  readonly issueId: string
  /** `verified` answers the issue; `rejected` sends it back, still owed an answer. */
  readonly verdict: 'verified' | 'rejected'
  /** What the decision rests on: the change that was made, or why the answer does not hold. */
  readonly basis: string
  /** Who decided. Must not be the author of the answer — see {@link verifyResolution}. */
  readonly verifiedBy: string
  /** When, ISO 8601. */
  readonly verifiedAt: string
}

/**
 * A deployment's ability to check a revision against the issue it was written for.
 *
 * IT IS GIVEN WHAT THERE IS TO READ: the issue as raised (the concern and the author's answer), the
 * change the round made to that section when it made one, and the body the section now has. A
 * verifier that could not see the diff could only judge the argument.
 */
export interface ResolutionVerifier {
  /** What this verifier is, for the record — a role id, a model id, or a person. */
  readonly id: string
  /**
   * Decide whether a pending issue is answered.
   *
   * @param input - the issue, the change it produced, and the section body as it now stands.
   * @returns the verification, which may reject the answer with its reason.
   */
  verify(input: {
    readonly issue: RevisionIssue
    readonly change?: SectionChange
    readonly revisedBody?: string
  }): Promise<ResolutionVerification>
}

/** Why a verification could not be accepted. */
export type VerificationRefusalCode =
  /** The verifier is the author of the answer, so nothing independent checked it. */
  | 'verification-not-independent'
  /** The verification names an issue this round did not leave pending. */
  | 'verification-unknown-issue'

/** One refusal, naming the issue and the reason. */
export interface VerificationRefusal {
  readonly code: VerificationRefusalCode
  readonly issueId: string
  readonly detail: string
}

/**
 * Apply one round of verifications to the outcomes a revision produced.
 *
 * @param outcomes - what the revision did to each issue.
 * @param verifications - what the reader decided about the pending ones.
 * @param authorId - who wrote the answers, so a verification from that same source can be refused.
 * @returns the outcomes as they now stand, and every verification that could not be accepted.
 */
export function verifyResolution(
  outcomes: ReadonlyArray<IssueOutcome>,
  verifications: ReadonlyArray<ResolutionVerification>,
  authorId: string,
): { readonly outcomes: ReadonlyArray<IssueOutcome>; readonly refusals: ReadonlyArray<VerificationRefusal> } {
  const pending = new Set(outcomes
    .filter(outcome => outcome.disposition === 'pending-verification')
    .map(outcome => outcome.issueId))
  const byIssue = new Map<string, ResolutionVerification>()
  const refusals: VerificationRefusal[] = []
  for (const verification of verifications) {
    if (!pending.has(verification.issueId)) {
      refusals.push({
        code: 'verification-unknown-issue',
        issueId: verification.issueId,
        detail: `'${verification.issueId}' is not awaiting verification, so this reading is about`
          + ' something no revision left open',
      })
      continue
    }
    if (verification.verifiedBy.trim() === authorId.trim()) {
      refusals.push({
        code: 'verification-not-independent',
        issueId: verification.issueId,
        detail: `'${verification.issueId}' was verified by '${verification.verifiedBy}', who also wrote`
          + ' the answer — an answer cannot certify itself',
      })
      continue
    }
    byIssue.set(verification.issueId, verification)
  }
  const settled: IssueOutcome[] = outcomes.map((outcome) => {
    const verification = byIssue.get(outcome.issueId)
    if (verification === undefined) return outcome
    const disposition: IssueDisposition = verification.verdict === 'verified' ? 'answered' : 'open'
    return {
      issueId: outcome.issueId,
      sectionId: outcome.sectionId,
      disposition,
      reason: verification.verdict === 'verified'
        ? `verified by '${verification.verifiedBy}': ${verification.basis}`
        : `sent back by '${verification.verifiedBy}': ${verification.basis}`,
    }
  })
  return { outcomes: settled, refusals }
}

/**
 * Ask a verifier about every issue a revision left pending.
 *
 * ONE READING PER PENDING ISSUE, in the order the revision produced them, so two readings of the same
 * revision produce the same list.
 *
 * @param outcomes - what the revision did.
 * @param verifier - the deployment's verifier.
 * @param input - the issues as raised, and the changed bodies, so the verifier has something to read.
 * @returns the verifications, in the order the issues were left pending.
 */
export async function verifyPending(
  outcomes: ReadonlyArray<IssueOutcome>,
  verifier: ResolutionVerifier,
  input: {
    readonly issues: ReadonlyArray<RevisionIssue>
    readonly changes: ReadonlyArray<SectionChange>
    readonly revisedBodies: ReadonlyMap<string, string>
  },
): Promise<ReadonlyArray<ResolutionVerification>> {
  const issueOf = new Map(input.issues.map(issue => [issue.issueId, issue]))
  const changeOf = new Map(input.changes.map(change => [change.sectionId, change]))
  const verifications: ResolutionVerification[] = []
  for (const outcome of outcomes) {
    if (outcome.disposition !== 'pending-verification') continue
    const issue = issueOf.get(outcome.issueId)
    if (issue === undefined) continue
    const change = changeOf.get(issue.sectionId)
    verifications.push(await verifier.verify({
      issue,
      ...(change === undefined ? {} : { change }),
      ...(input.revisedBodies.has(issue.sectionId)
        ? { revisedBody: input.revisedBodies.get(issue.sectionId) ?? '' }
        : {}),
    }))
  }
  return verifications
}
