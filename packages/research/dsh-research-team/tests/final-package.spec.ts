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
