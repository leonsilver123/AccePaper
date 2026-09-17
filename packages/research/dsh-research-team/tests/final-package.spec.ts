/**
 * The final package — the conditions, and what refuses.
 *
 * The export used to write one kind of package and state two facts in its manifest, so a package of a
 * run that stopped at A1, of a run under the evaluation profile, and of a run a person had approved
 * were written identically. These tests hold the split to its purpose: `final` is what every
 * condition holds, a draft says so in its own files, and the refusal names the FIRST condition that
 * failed — in the operation, so a caller that never saw a button is refused for the same reason.
 */

import { describe, expect, it } from 'vitest'
import type { ApprovalRecord } from '@deepseek-ai/dsh-research-core'
import type { FinalPackageFacts } from '../src/runner/final-package.ts'
import {
  checkFinalPackage, finalPackageApprovalOf, finalPackageRefusalOf, finalPackageStateOf,
} from '../src/runner/final-package.ts'

/** Facts for a run that satisfies every condition; each test moves exactly one of them. */
function readyFacts(overrides: Partial<FinalPackageFacts> = {}): FinalPackageFacts {
  return {
    profile: 'production',
    manuscriptProduced: true,
    unfinishedSteps: [],
    refusedSections: [],
    openIssues: [],
    approval: approval(),
    staleApproval: undefined,
    declaredFiles: ['manuscript.md', 'experiment-tables.md'],
    packagedFiles: ['manuscript.md', 'experiment-tables.md', 'run-summary.md'],
    artifactRefs: { read: ['formatted-manuscript@1'], moved: [] },
    compilation: { tool: null, dropped: [] },
    saveError: undefined,
    ...overrides,
  }
}

/** An approved decision on the human gate, with the versions it was given for. */
function approval(decision: ApprovalRecord['decision'] = 'approved'): ApprovalRecord {
  return {
    run_id: 'run-1',
    step_id: 'E2-submit',
    attempt_id: 1,
    principalId: 'operator-1',
    approval_event_id: 'event-1',
    decision,
    timestamp: 1_700_000_000_000,
    // Branded at the wire/parser boundary in production; a spec builds the ref directly, the way the
    // core's own specs do.
    targetRefs: [{
      artifactId: 'formatted-manuscript' as never,
      version: 3 as never,
      contentHash: 'abc123' as never,
    }],
  }
}

/** The check with this code, which every case below names rather than counting positions. */
function checkOf(facts: FinalPackageFacts, code: string): ReturnType<typeof checkFinalPackage>[number] {
  const found = checkFinalPackage(facts).find(check => check.code === code)
  if (found === undefined) throw new Error(`no check named '${code}'`)
  return found
}

describe('a final package is what every condition holds', () => {
  it('passes every check, and only then is the state final', () => {
    const checks = checkFinalPackage(readyFacts())
    expect(checks.filter(check => !check.passed)).toEqual([])
    expect(finalPackageStateOf(checks)).toBe('final')
    expect(finalPackageRefusalOf(checks)).toBeUndefined()
  })

  it('refuses evaluation material posing as a production package', () => {
    const check = checkOf(readyFacts({ profile: 'evaluation' }), 'production-evidence')
    expect(check.passed).toBe(false)
    // The sentence names the profile, so the reader knows what they are holding and what would change it.
    expect(check.detail).toContain('evaluation')
  })

  it('refuses a package of a run that has not finished, and names the steps', () => {
    const check = checkOf(readyFacts({ unfinishedSteps: ['D3-writing (blocked)', 'E2-submit (gated)'] }), 'every-step-closed')
    expect(check.passed).toBe(false)
    expect(check.detail).toContain('D3-writing (blocked)')
    expect(check.detail).toContain('E2-submit (gated)')
  })

  it('refuses a manuscript with a section the pipeline refused to write', () => {
    expect(checkOf(readyFacts({ refusedSections: ['results'] }), 'no-refused-sections').passed).toBe(false)
  })

  it('refuses while a revision round has a concern open', () => {
    const check = checkOf(
      readyFacts({ openIssues: [{ issueId: 'R2', sectionId: 'results', reason: 'the patch changed nothing' }] }),
      'no-open-issues',
    )
    expect(check.passed).toBe(false)
    expect(check.detail).toContain('R2')
    expect(check.detail).toContain('results')
  })

  it('refuses a gate nobody decided, and one a person rejected', () => {
    const undecided = checkOf(readyFacts({ approval: undefined }), 'approval-recorded')
    expect(undecided.passed).toBe(false)
    expect(undecided.detail).toContain('no decision on record')

    const rejected = checkOf(readyFacts({ approval: approval('rejected') }), 'approval-recorded')
    expect(rejected.passed).toBe(false)
    expect(rejected.detail).toContain('rejected')
  })

  it('refuses an approval that is about another version', () => {
    // THE MIXED-VERSION CASE: the decision was made about refs the run no longer holds, so the
    // package would carry a manuscript this person never approved under their name.
    const check = checkOf(
      readyFacts({ staleApproval: "'formatted-manuscript' moved from version 3 to version 4" }),
      'approval-current',
    )
    expect(check.passed).toBe(false)
    expect(check.detail).toContain('another version')
    expect(check.detail).toContain('moved from version 3 to version 4')
  })

  it('refuses a package missing a file the manuscript declares', () => {
    const check = checkOf(
      readyFacts({ declaredFiles: ['manuscript.md', 'figures/figure-1.svg'], packagedFiles: ['manuscript.md'] }),
      'required-files-present',
    )
    expect(check.passed).toBe(false)
    expect(check.detail).toContain('figures/figure-1.svg')
  })

  it('refuses when the manuscript declares no files at all', () => {
    // An empty declaration is not "nothing to check": a package that declares no files cannot be
    // shown to carry the paper, so it is a draft by construction.
    expect(checkOf(readyFacts({ declaredFiles: [] }), 'required-files-present').passed).toBe(false)
  })

  it('refuses a package of a run whose last write did not land', () => {
    const check = checkOf(readyFacts({ saveError: 'the disk is full' }), 'run-saved')
    expect(check.passed).toBe(false)
    expect(check.detail).toContain('the disk is full')
  })

  it('reports every failing condition, not only the first', () => {
    // The page renders them beside the control, and fixing one must not hide the next.
    const checks = checkFinalPackage(readyFacts({ profile: 'evaluation', approval: undefined }))
    expect(checks.filter(check => !check.passed).map(check => check.code))
      .toEqual(['production-evidence', 'approval-recorded'])
    // The refusal, however, is one sentence: the first condition to fix.
    expect(finalPackageRefusalOf(checks)).toContain('[final-package-refused] production-evidence:')
  })
})

describe('the approval a package carries', () => {
  it('records who decided and the versions they read', () => {
    const recorded = finalPackageApprovalOf(approval())
    expect(recorded).toEqual({
      operator: 'operator-1',
      decision: 'approved',
      approvalEventId: 'event-1',
      decidedAt: 1_700_000_000_000,
      targets: [{ artifactId: 'formatted-manuscript', version: 3, contentHash: 'abc123' }],
    })
  })

  it('is absent for a decision that was not an approval, and for no decision at all', () => {
    // A package whose gate recorded `request_changes` or `rejected` must not carry an approval block:
    // a reader comparing two packages tells them apart by whether one is there.
    expect(finalPackageApprovalOf(approval('request_changes'))).toBeUndefined()
    expect(finalPackageApprovalOf(approval('rejected'))).toBeUndefined()
    expect(finalPackageApprovalOf(undefined)).toBeUndefined()
  })
})

describe('a package whose compiled document is missing a figure', () => {
  it('is refused as final, naming the float it does not carry', () => {
    // A SUBMISSION WHOSE FIGURES ARE MISSING IS NOT THE PAPER: the compiled document is what a journal
    // receives, and a diagram nobody rendered is a figure the reader will not see. The condition is
    // read from what the run's compile recorded, so it holds without a second compile.
    const checks = checkFinalPackage(readyFacts({
      compilation: { tool: 'pandoc', dropped: ['Figure 2 (no static rendering)'] },
    }))
    const check = checks.find(entry => entry.code === 'compiled-document-complete')
    expect(check?.passed).toBe(false)
    expect(check?.detail).toContain('Figure 2')
    expect(finalPackageStateOf(checks)).toBe('draft')
  })

  it('passes for a deployment that compiles nothing, which claims no compiled document', () => {
    const checks = checkFinalPackage(readyFacts({ compilation: { tool: null, dropped: [] } }))
    expect(checks.find(entry => entry.code === 'compiled-document-complete')?.detail)
      .toContain('compiles no document')
    expect(finalPackageStateOf(checks)).toBe('final')
  })
})

describe('a package that replaces a moved reading, re-checked and re-approved', () => {
  // THE REVIEW'S R06, both directions. A late export of a state the run has left, with nobody having
  // re-examined the move, is refused; the same move, re-checked and re-approved, must let a normal
  // export through. Without the second half the check refused the remedy it recommends, and a package
  // that differed from the previous export could never be final again.

  /** The state of a run whose artifacts have moved since the package on disk was read. */
  const moved = { read: ['formatted-manuscript@1', 'figure-plan@1'], moved: ['formatted-manuscript'] }

  it('refuses a late export of an old version, naming the artifact that moved', () => {
    // NOBODY RE-EXAMINED THE MOVE. The package would replace a reading of an artifact the run has
    // left, and nothing in what it carries says the move was looked at.
    const facts = readyFacts({ artifactRefs: moved, approval: undefined })
    const check = checkOf(facts, 'artifacts-current')
    expect(check.passed).toBe(false)
    expect(check.detail).toContain('formatted-manuscript')
    expect(check.detail).toContain('re-export')
    // AND THE STATE IS DRAFT: a reading of a state the run has left is not the package to hand anyone.
    expect(finalPackageStateOf(checkFinalPackage(facts))).toBe('draft')
  })

  it('refuses the same export when the approval no longer covers the run', () => {
    // The other reason a late export is late: the artifacts moved past the decision, so the approval
    // that would justify the replacement no longer covers the run. `approval-current` names it, so the
    // refusal does not rest on this check alone.
    const facts = readyFacts({
      artifactRefs: moved,
      staleApproval: "'formatted-manuscript' moved from version 3 to version 4",
    })
    expect(checkOf(facts, 'approval-current').passed).toBe(false)
    expect(checkOf(facts, 'artifacts-current').passed).toBe(false)
    expect(finalPackageStateOf(checkFinalPackage(facts))).toBe('draft')
  })

  it('lets the re-export through once the run was re-checked and re-approved', () => {
    // THE SAME MOVE, RE-EXAMINED. The package replaces a reading of artifacts the run has moved past,
    // and the approval it carries covers the run as it stands — so it describes the state the decision
    // was taken on, and every other condition holds.
    const facts = readyFacts({ artifactRefs: moved })
    const checks = checkFinalPackage(facts)
    expect(checks.filter(check => !check.passed)).toEqual([])
    expect(finalPackageStateOf(checks)).toBe('final')
    const check = checkOf(facts, 'artifacts-current')
    expect(check.detail).toContain('formatted-manuscript')
    expect(check.detail).toContain('covers the run as it stands')
  })

  it('does not let an unapproved run through on the same move', () => {
    // The half that must not weaken: the move is what makes a final export need re-examination, and a
    // run with no approval at all is refused by `approval-recorded` whatever this check says.
    const facts = readyFacts({ artifactRefs: moved, approval: undefined })
    expect(checkOf(facts, 'approval-recorded').passed).toBe(false)
    expect(finalPackageStateOf(checkFinalPackage(facts))).toBe('draft')
  })
})
