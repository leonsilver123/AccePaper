/**
 * Whether a revision ANSWERS the issue it was written for — decided by somebody else.
 *
 * THE PIPELINE REVIEW'S P0 ON ISSUE CLOSING. Applying a patch used to close its issue (`patched`) and
 * so did a non-empty answer (`accepted_explanation`), so the two acts that are not evidence of an
 * answer were the two acts that ended the question. These cases hold the replacement to the lifecycle
 * the review asks for: apply → pending verification → independent reading → answered or back to open.
 *
 * AND THEY HOLD THE USER'S RULING OF 2026-09-18 ON WHAT INDEPENDENCE IS. An earlier version compared
 * the verifier's identity with the author's, both spelled `<provider>/<model>`, so a single-model
 * deployment could not verify anything and a two-model deployment looked independent while sharing one
 * session and one role. What is required is that the two EXECUTIONS differ — identity, session, rules
 * — and the model behind them is a recorded risk rather than a gate. The refusals below are the ones
 * the ruling names: a renamed author execution, a forged verifier identity, a stale manuscript, and a
 * decision reached on nothing read.
 */
import { describe, expect, it } from 'vitest'
import { applyRevision, bodyHashOf } from '../src/runner/issue-patch.ts'
import type { IssueOutcome, RevisionIssue } from '../src/runner/issue-patch.ts'
import { verifyPending, verifyResolution } from '../src/runner/resolution-verifier.ts'
import type { ExecutionIdentity, ResolutionVerifier } from '../src/runner/resolution-verifier.ts'

/** The execution that wrote the answers, as the host mints it. */
function author(overrides: Partial<ExecutionIdentity> = {}): ExecutionIdentity {
  return {
    executionId: 'author-exec-1',
    sessionId: 'author-session-1',
    role: 'prose-author',
    instructionsVersion: 'd4-author-instructions-1',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    ...overrides,
  }
}

/** A reader the caller names, occupying the verifier's role. */
function verifier(overrides: Partial<ResolutionVerifier> = {}): ResolutionVerifier {
  return {
    id: 'spec-reader',
    role: 'revision-verifier',
    instructionsVersion: 'revision-review-1',
    route: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    verify: () => Promise.resolve({
      verdict: 'verified' as const,
      basis: 'the section now states the parameters',
      evidenceRead: ['the concern', 'the change', 'the section as it now stands'],
    }),
    ...overrides,
  }
}

/** The execution the host starts for one round of reading — a DIFFERENT one from the author's. */
function readerExecution(overrides: Partial<ExecutionIdentity> = {}): ExecutionIdentity {
  return {
    executionId: 'verify-exec-1',
    sessionId: 'verify-session-1',
    role: 'revision-verifier',
    instructionsVersion: 'revision-review-1',
    // THE SAME MODEL ON PURPOSE: the ruling says a shared route is a risk to record, not a refusal.
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    ...overrides,
  }
}

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

/** The bodies as they stand after the patch, which is what the reader is shown. */
function revisedBodies(): ReadonlyMap<string, string> {
  const { outcomes } = pendingIssue()
  expect(outcomes[0]?.disposition).toBe('pending-verification')
  return new Map([['method', 'Both platoons are run with the Intelligent Driver Model at a fixed 0.02 s step.']])
}

/**
 * Run one round of reading over the pending issue.
 *
 * @param options - the verifier, the reader's execution, and the bodies as they now stand.
 * @returns the settlement the round produced.
 */
async function round(options: {
  readonly verifier?: ResolutionVerifier
  readonly reader?: ExecutionIdentity
  readonly bodies?: ReadonlyMap<string, string>
  readonly author?: ExecutionIdentity
} = {}) {
  const { issue, outcomes } = pendingIssue()
  const bodies = options.bodies ?? revisedBodies()
  const { verifications, fatal } = await verifyPending(outcomes, options.verifier ?? verifier(), {
    issues: [issue],
    changes: [{
      sectionId: 'method',
      basisHash: bodyHashOf('Both platoons are run.'),
      resultHash: bodyHashOf('Both platoons are run with the Intelligent Driver Model at a fixed 0.02 s step.'),
      changed: true,
    }],
    revisedBodies: bodies,
    identity: options.reader ?? readerExecution(),
    author: options.author ?? author(),
    now: () => '2026-09-18T00:00:00.000Z',
  })
  return {
    verifications,
    fatal,
    settled: verifyResolution(outcomes, verifications, options.author ?? author(), bodies),
  }
}

describe('an issue is closed by a reading that happened', () => {
  it('answers it when a different execution read it and found it answered', async () => {
    const { settled, fatal } = await round()
    expect(fatal).toEqual([])
    expect(settled.refusals).toEqual([])
    expect(settled.outcomes[0]?.disposition).toBe('answered')
    expect(settled.outcomes[0]?.reason).toContain('verify-exec-1')
  })

  it('sends it back when the reader rejected the answer', async () => {
    const { settled } = await round({
      verifier: verifier({
        verify: () => Promise.resolve({
          verdict: 'rejected' as const,
          basis: 'the section still reports the old baseline',
          evidenceRead: ['the section as it now stands'],
        }),
      }),
    })
    expect(settled.outcomes[0]?.disposition).toBe('open')
    expect(settled.outcomes[0]?.reason).toContain('sent back')
  })

  it('leaves it exactly where it was when the reader abstained', async () => {
    // AN ABSTENTION IS NOT A CLOSURE AND NOT A REFUSAL. A reader short of evidence has to be able to
    // say so; without the third verdict its only replies would be "answered" and "not answered", and
    // it would have to guess at one.
    const { settled } = await round({
      verifier: verifier({
        verify: () => Promise.resolve({
          verdict: 'abstained' as const,
          basis: 'the full text of the cited source was not available',
          evidenceRead: [],
        }),
      }),
    })
    expect(settled.refusals).toEqual([])
    expect(settled.outcomes[0]?.disposition).toBe('pending-verification')
    expect(settled.outcomes[0]?.reason).toContain('abstained')
  })
})

describe('what independence requires, and what it does not', () => {
  it('accepts the SAME MODEL in two executions — a shared route is a risk to record', async () => {
    // THE USER'S RULING: a different model may not substitute for the conditions below, and the same
    // model must not be refused for being the same model. Both executions here are deepseek-v4-flash,
    // and what makes the reading valid is that they are different executions with their own rules.
    const { settled, verifications, fatal } = await round()
    expect(fatal).toEqual([])
    expect(settled.outcomes[0]?.disposition).toBe('answered')
    // AND THE SHARED ROUTE IS ON THE RECORD, where a reader can weigh it.
    expect(verifications[0]?.sharesAuthorRoute).toBe(true)
    expect(verifications[0]?.verifierRoute.model).toBe('deepseek-v4-flash')
  })

  it('refuses the author\'s own execution however it is named', async () => {
    // "同一个作者 execution 被重命名仍拒绝." The identity is the host's, so renaming changes nothing:
    // what the check compares is the execution, and this verification came from the author's.
    const { fatal } = await round({
      verifier: verifier({ id: 'a-completely-different-reviewer' }),
      reader: author(),
    })
    expect(fatal[0]?.code).toBe('verification-same-execution')
    expect(fatal[0]?.detail).toContain('cannot certify itself')
    expect(fatal[0]?.detail).not.toContain('display')
  })

  it('refuses a reading taken inside the author\'s own session', async () => {
    // A DIFFERENT EXECUTION IS NOT ENOUGH: a session carries the revision's defence forward, so a
    // reader continuing it has read the author's account of the change rather than the change.
    const { fatal } = await round({
      reader: readerExecution({ sessionId: 'author-session-1' }),
    })
    expect(fatal[0]?.code).toBe('verification-same-session')
    expect(fatal[0]?.detail).toContain("author's own session")
  })

  it('refuses a verifier given the author\'s instructions', async () => {
    // THE ROLE IS THE INSTRUCTIONS. Two readers with one rulebook are one task done twice, whatever
    // the role is called.
    const { fatal } = await round({
      verifier: verifier({ instructionsVersion: 'd4-author-instructions-1' }),
      reader: readerExecution({ instructionsVersion: 'd4-author-instructions-1' }),
    })
    expect(fatal[0]?.code).toBe('verification-wrong-role')
  })

  it('refuses a verifier that claims the author\'s role outright', async () => {
    const { fatal, verifications } = await round({
      verifier: verifier({ role: 'prose-author' }),
    })
    expect(fatal[0]?.code).toBe('verification-wrong-role')
    // AND NOTHING WAS ASKED. A deployment whose verifier occupies the author's role is a
    // misconfiguration, so no reading is sent rather than one being taken and discarded.
    expect(verifications).toEqual([])
  })
})

describe('a decision has to rest on something', () => {
  it('refuses a verdict reached without reading anything', async () => {
    // "未读必要证据不得关闭问题." The reader still has a way to answer honestly — `abstained` — and
    // this is the reply that is refused instead.
    const { settled } = await round({
      verifier: verifier({
        verify: () => Promise.resolve({
          verdict: 'verified' as const,
          basis: 'looks fine to me',
          evidenceRead: [],
        }),
      }),
    })
    expect(settled.refusals[0]?.code).toBe('verification-no-evidence')
    expect(settled.outcomes[0]?.disposition).toBe('pending-verification')
  })

  it('refuses a report about a body the run no longer holds', async () => {
    // "验证陈旧稿件拒绝." The host records the hashes it handed over; a manuscript that has moved
    // since makes the reading a report on something else, and it is refused rather than applied.
    const { verifications } = await round()
    expect(verifications[0]?.targetRefs[0]?.sectionId).toBe('method')
    const moved = new Map([['method', 'A different method section, written since the reading.']])
    const settled = verifyResolution(pendingIssue().outcomes, verifications, author(), moved)
    expect(settled.refusals[0]?.code).toBe('verification-stale')
    expect(settled.outcomes[0]?.disposition).toBe('pending-verification')
  })

  it('refuses a verification of an issue nothing left pending', async () => {
    const { outcomes } = pendingIssue()
    const settled = verifyResolution(outcomes, [{
      issueId: 'issue-nobody-raised',
      verdict: 'verified',
      basis: 'read it',
      evidenceRead: ['something'],
      targetRefs: [],
      verifierExecutionId: 'verify-exec-1',
      verifierSessionId: 'verify-session-1',
      verifierInstructionsVersion: 'revision-review-1',
      verifierRoute: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      sharesAuthorRoute: true,
      verifiedAt: '2026-09-18T00:00:00.000Z',
    }], author(), revisedBodies())
    expect(settled.refusals[0]?.code).toBe('verification-unknown-issue')
  })
})

describe('the record the host builds', () => {
  it('takes every identity field from the host, not from the reader', async () => {
    // A READER THAT COULD STATE ITS OWN IDENTITY COULD FORGE ONE, and a check written against a
    // self-reported name is a check a renamed reader passes. The reader's return type carries no
    // identity at all; everything below is the host's.
    const lying: ResolutionVerifier = {
      ...verifier(),
      // An extra property a returned verdict might carry: nothing reads it.
      verify: () => Promise.resolve({
        verdict: 'verified' as const,
        basis: 'read it',
        evidenceRead: ['the change'],
        verifiedBy: 'someone-else-entirely',
        verifierExecutionId: 'forged',
      } as never),
    }
    const { verifications } = await round({ verifier: lying })
    expect(verifications[0]?.verifierExecutionId).toBe('verify-exec-1')
    expect(verifications[0]?.verifierSessionId).toBe('verify-session-1')
    expect(verifications[0]?.verifierInstructionsVersion).toBe('revision-review-1')
    expect(verifications[0]?.verifiedAt).toBe('2026-09-18T00:00:00.000Z')
  })

  it('records a human reader as sharing nothing, because there is no model behind it', async () => {
    // The host mints the identity from the verifier's own declaration, so a person's carries no model
    // and shares nothing with the author by construction rather than by a value somebody typed.
    const { verifications } = await round({
      verifier: verifier({ route: { provider: 'human' } }),
      reader: {
        executionId: 'verify-exec-human',
        sessionId: 'verify-session-human',
        role: 'revision-verifier',
        instructionsVersion: 'revision-review-1',
        provider: 'human',
      },
    })
    expect(verifications[0]?.sharesAuthorRoute).toBe(false)
    expect(verifications[0]?.verifierRoute.model).toBeUndefined()
  })
})
