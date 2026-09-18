/**
 * Whether a revision ANSWERS the issue it was written for — decided by somebody else.
 *
 * THE PIPELINE REVIEW'S P0 ON ISSUE CLOSING. Applying a patch used to close its issue (`patched`) and
 * so did a non-empty answer (`accepted_explanation`), so the two acts that are not evidence of an
 * answer were the two acts that ended the question. These cases hold the replacement to the lifecycle
 * the review asks for: apply → pending verification → independent reading → answered or back to open.
 */
import { describe, expect, it } from 'vitest'
import { getArtifact, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { runT19B } from '../src/runner/drive.ts'
import { applyRevision, bodyHashOf } from '../src/runner/issue-patch.ts'
import type { IssueOutcome, RevisionIssue } from '../src/runner/issue-patch.ts'
import { verifyPending, verifyResolution } from '../src/runner/resolution-verifier.ts'
import type { ResolutionVerification, ResolutionVerifier } from '../src/runner/resolution-verifier.ts'

const AUTHOR = 'fixture:rebuttal'

/** One issue whose patch was applied, as `applyRevision` leaves it. */
function pendingIssue(): { issue: RevisionIssue; outcomes: ReadonlyArray<IssueOutcome> } {
  const issue: RevisionIssue = {
    issueId: 'issue-1',
    sectionId: 'method',
    concern: 'The method section names no parameters.',
    response: 'They are listed now.',
    requiresTextChange: true,
    patch: 'Both platoons are run with the Intelligent Driver Model at a fixed 0.02 s step.',
    basisHash: bodyHashOf('Both platoons are run.'),
  }
  const applied = applyRevision(
    [{ id: 'method', heading: 'Method', bodyText: 'Both platoons are run.' }],
    [issue],
  )
  return { issue, outcomes: applied.outcomes }
}

/** A verification of one issue, from a reader the caller names. */
function verification(verifiedBy: string, verdict: 'verified' | 'rejected' = 'verified'): ResolutionVerification {
  return {
    issueId: 'issue-1',
    verdict,
    basis: verdict === 'verified' ? 'the section now states the parameters' : 'the concern is not addressed',
    verifiedBy,
    verifiedAt: '2026-09-18T00:00:00.000Z',
  }
}

describe('a reader who did not write the answer decides whether it is answered', () => {
  it('turns a pending issue into an answered one', () => {
    const { outcomes } = pendingIssue()
    // APPLYING THE PATCH LEFT IT PENDING: what the applier knows is the text changed, not that the
    // concern is met.
    expect(outcomes[0]?.disposition).toBe('pending-verification')
    const settled = verifyResolution(outcomes, [verification('reviewer-2')], AUTHOR)
    expect(settled.refusals).toEqual([])
    expect(settled.outcomes[0]?.disposition).toBe('answered')
    expect(settled.outcomes[0]?.reason).toContain('verified by')
  })

  it('sends it back, still owed an answer, when the reader rejects it', () => {
    const { outcomes } = pendingIssue()
    const settled = verifyResolution(outcomes, [verification('reviewer-2', 'rejected')], AUTHOR)
    expect(settled.outcomes[0]?.disposition).toBe('open')
    expect(settled.outcomes[0]?.reason).toContain('the concern is not addressed')
  })

  it('refuses a verification from the author of the answer', () => {
    // AN ANSWER CANNOT CERTIFY ITSELF. This is the whole independence requirement, so it is refused
    // rather than recorded: a run that accepted it would have the author closing their own issues.
    const { outcomes } = pendingIssue()
    const settled = verifyResolution(outcomes, [verification(AUTHOR)], AUTHOR)
    expect(settled.refusals.map(refusal => refusal.code)).toEqual(['verification-not-independent'])
    expect(settled.outcomes[0]?.disposition).toBe('pending-verification')
  })

  it('refuses a reading of an issue nothing left pending', () => {
    const outcomes: ReadonlyArray<IssueOutcome> = [
      { issueId: 'issue-9', sectionId: 'method', disposition: 'open', reason: 'no patch was proposed' },
    ]
    const settled = verifyResolution(outcomes, [verification('reviewer-2')], AUTHOR)
    expect(settled.refusals.map(refusal => refusal.code)).toEqual(['verification-unknown-issue'])
    expect(settled.outcomes[0]?.disposition).toBe('open')
  })
})

describe('a deployment that reads revisions itself', () => {
  it('closes the round once every pending issue has been read', async () => {
    // WITHOUT A VERIFIER THE ISSUE WAITS — `awaiting-verification`. With one, the round settles, and a
    // run can tell "the review is finished" from "the review is waiting for a reader".
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { resolutionVerifier: verifying() })
    const rebuttal = getArtifact(store, run.runId, 'rebuttal') as {
      issues: ReadonlyArray<{ disposition: string }>
      stoppedBecause: string
      awaitingVerification: ReadonlyArray<string>
    }
    expect(rebuttal.awaitingVerification).toEqual([])
    expect(rebuttal.issues.every(issue => issue.disposition === 'answered')).toBe(true)
    expect(rebuttal.stoppedBecause).toBe('closed')
    expect(run.steps.find(step => step.stepId === 'D4-rebuttal')?.status).toBe('passed')
  })

  it('refuses the step when the reader is the author', async () => {
    // THE INDEPENDENCE RULE, ON THE PRODUCTION PATH: a deployment whose verifier answers as the D4
    // producer is refused, because every issue it "closed" was closed by the author of the answer.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { resolutionVerifier: verifying(AUTHOR) })
    const d4 = run.steps.find(step => step.stepId === 'D4-rebuttal')
    expect(d4?.status).toBe('in_progress')
    expect(d4?.executeError).toContain('verification-not-independent')
    expect(getArtifact(store, run.runId, 'revised-draft')).toBeUndefined()
  })
})

/** A verifier that accepts every pending issue, attributed to whoever the caller names. */
function verifying(verifiedBy = 'reviewer-2'): ResolutionVerifier {
  return {
    id: verifiedBy,
    verify(input) {
      return Promise.resolve({
        issueId: input.issue.issueId,
        verdict: 'verified',
        basis: 'the section now states what the concern asked for',
        verifiedBy,
        verifiedAt: '2026-09-18T00:00:00.000Z',
      })
    },
  }
}

describe('a verifier is given what there is to read', () => {
  it('sees the issue, the change it produced and the body as it now stands', async () => {
    const { issue, outcomes } = pendingIssue()
    const seen: string[] = []
    const spy: ResolutionVerifier = {
      id: 'spy',
      verify(input) {
        const body = input.revisedBody ?? ''
        seen.push(`${input.issue.issueId}|${input.change?.sectionId ?? 'no-change'}|${body.length > 0 ? 'body' : 'none'}`)
        return Promise.resolve(verification('spy'))
      },
    }
    const bodies = new Map([['method', 'Both platoons are run with the Intelligent Driver Model at a fixed 0.02 s step.']])
    const applied = applyRevision(
      [{ id: 'method', heading: 'Method', bodyText: 'Both platoons are run.' }],
      [issue],
    )
    const verifications = await verifyPending(outcomes, spy, {
      issues: [issue], changes: applied.changes, revisedBodies: bodies,
    })
    expect(verifications).toHaveLength(1)
    // THE DIFF AND THE RESULTING BODY, not only the argument: a reader that could see neither could
    // judge nothing but the author's prose.
    expect(seen).toEqual(['issue-1|method|body'])
  })

  it('is not asked about issues the round left open', async () => {
    const outcomes: ReadonlyArray<IssueOutcome> = [
      { issueId: 'issue-1', sectionId: 'method', disposition: 'open', reason: 'no patch proposed' },
    ]
    const asked: string[] = []
    const spy: ResolutionVerifier = {
      id: 'spy',
      verify(input) {
        asked.push(input.issue.issueId)
        return Promise.resolve(verification('spy'))
      },
    }
    const verifications = await verifyPending(outcomes, spy, {
      issues: [], changes: [], revisedBodies: new Map(),
    })
    expect(verifications).toEqual([])
    expect(asked).toEqual([])
  })
})
