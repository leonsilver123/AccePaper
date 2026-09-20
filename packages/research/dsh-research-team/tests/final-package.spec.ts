/**
 * The final package — the conditions, and what refuses.
 *
 * The export used to write one kind of package and state two facts in its manifest, so a package of a
 * run that stopped at A1, of a run under the evaluation profile, and of a run a person had approved
 * were written identically. These tests hold the split to its purpose: `final` is what every
 * condition holds, a draft says so in its own files, and the refusal names the FIRST condition that
 * failed — in the operation, so a caller that never saw a button is refused for the same reason.
 */

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createRun, getArtifact, getRunSnapshot, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import type { DocumentCompiler } from '../src/runner/document-compile.ts'
import { runT19B } from '../src/runner/drive.ts'
import type { ApprovalRecord } from '@deepseek-ai/dsh-research-core'
import type { FinalPackageFacts, TypesetDocument } from '../src/runner/final-package.ts'
import {
  checkFinalPackage, finalPackageApprovalOf, finalPackageFactsOf, finalPackageRefusalOf,
  finalPackageStateOf, manuscriptFactsOf,
} from '../src/runner/final-package.ts'
import { TRC_PROFILE, resolveResearchProfile, unreadRulesFor } from '../src/runner/research-profile.ts'
import { checkVenueRules } from '../src/runner/venue-rules.ts'

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
    artifactRefs: { read: ['typeset@1'], moved: [] },
    compilation: { tool: null, dropped: [] },
    // THE PAPER CITES THE SOURCES IT HELD, which is what every other condition in this file assumes
    // and what makes this fixture the case where nothing is wrong. The cases about the citation
    // count itself move this, and nothing else here does.
    citations: { made: 3, held: 3 },
    // THE TYPESET FORM IS A RENDER OF THE DOCUMENT THE RUN HOLDS, and this deployment declared no
    // submission format it produces — the case where it compiles nothing, which the cases below move.
    typeset: {
      renderedManuscriptVersion: 3,
      manuscriptVersion: 3,
      declaredFormats: [],
      documents: [],
      repairedFromVersion: undefined,
    },
    // NO DELIVERABLES, because this deployment compiles nothing: the case that says "no document is
    // claimed" is the one below, and every other case here moves exactly one condition.
    deliverables: { produced: [], carried: [] },
    // EVERY RULE READ, because this is the case where every condition holds: the state in which the
    // journal's requirements were never established is the one the case below moves.
    journalRules: { venueName: 'A journal', read: 8, total: 8, unverified: [] },
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
      artifactId: 'typeset' as never,
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
      readyFacts({ staleApproval: "'typeset' moved from version 3 to version 4" }),
      'approval-current',
    )
    expect(check.passed).toBe(false)
    expect(check.detail).toContain('changed after the decision')
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

describe('a manuscript that cites nothing', () => {
  it('is refused when the run held sources it could have cited', () => {
    // THE DEFECT EVERY CITATION CHECK PASSES BY EMPTINESS. They compare two sets — what the body
    // cites and what the reference list carries — and two empty sets are equal, so a manuscript with
    // no markers and no bibliography satisfied all of them. This is the count, and the run's own
    // record is what says it held something to cite.
    const check = checkOf(readyFacts({ citations: { made: 0, held: 3 } }), 'manuscript-cites-sources')
    expect(check.passed).toBe(false)
    expect(check.detail).toContain('cites nothing')
    expect(check.detail).toContain('held 3 source(s)')
    expect(finalPackageStateOf(checkFinalPackage(readyFacts({ citations: { made: 0, held: 3 } })))).toBe('draft')
  })

  it('is NOT refused when the run held nothing, which is a different fact', () => {
    // A STUDY WITH NO LITERATURE IS NOT A DEFECT IN THE PAPER. The run's own record says it had
    // nothing to cite, and refusing it would refuse runs the pipeline is allowed to produce.
    const check = checkOf(readyFacts({ citations: { made: 0, held: 0 } }), 'manuscript-cites-sources')
    expect(check.passed).toBe(true)
    expect(check.detail).toContain('held no source to cite')
  })

  it('passes a manuscript that cites, and says how many', () => {
    const check = checkOf(readyFacts({ citations: { made: 2, held: 5 } }), 'manuscript-cites-sources')
    expect(check.passed).toBe(true)
    expect(check.detail).toContain('cites 2 source(s)')
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
      targets: [{ artifactId: 'typeset', version: 3, contentHash: 'abc123' }],
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

  it('is refused as final when the package does not carry a document the compile produced', () => {
    // A JOURNAL IS HANDED A DOCUMENT, NOT THE MARKDOWN IT WAS BUILT FROM. `manuscript.md` is in the
    // package either way, so its presence says nothing about the `.docx` a submission system takes —
    // and the compiled files are written as BYTES, so they are not among the manuscript's declared
    // text files and `required-files-present` cannot see them.
    const checks = checkFinalPackage(readyFacts({
      compilation: { tool: 'pandoc', dropped: [] },
      deliverables: {
        produced: ['manuscript.html', 'manuscript.tex', 'manuscript.docx'],
        carried: ['manuscript.html', 'manuscript.tex', 'run-summary.md'],
      },
    }))
    const check = checks.find(entry => entry.code === 'deliverables-present')
    expect(check?.passed).toBe(false)
    expect(check?.detail).toContain('manuscript.docx')
    expect(check?.detail).toContain('not only the Markdown')
    expect(finalPackageStateOf(checks)).toBe('draft')
    // THE DOCX IS NOT IN `declaredFiles` — that is the whole reason this condition exists — so the
    // case is only meaningful if the other file condition passes while this one refuses.
    expect(checks.find(entry => entry.code === 'required-files-present')?.passed).toBe(true)
  })

  it('passes for a deployment that compiles nothing, which claims no compiled document', () => {
    const checks = checkFinalPackage(readyFacts({ compilation: { tool: null, dropped: [] } }))
    expect(checks.find(entry => entry.code === 'compiled-document-complete')?.detail)
      .toContain('compiles no document')
    // AND IT IS ASKED FOR NO DELIVERABLE EITHER: `produced` is empty because the deployment named no
    // compiler, which is a different fact from a document that went missing.
    expect(checks.find(entry => entry.code === 'deliverables-present')?.detail)
      .toContain('no deliverable is claimed')
    expect(finalPackageStateOf(checks)).toBe('final')
  })
})

describe('a package that replaces a moved reading, re-checked and re-approved', () => {
  // THE REVIEW'S R06, both directions. A late export of a state the run has left, with nobody having
  // re-examined the move, is refused; the same move, re-checked and re-approved, must let a normal
  // export through. Without the second half the check refused the remedy it recommends, and a package
  // that differed from the previous export could never be final again.

  /** The state of a run whose artifacts have moved since the package on disk was read. */
  const moved = { read: ['typeset@1', 'figure-plan@1'], moved: ['typeset'] }

  it('refuses a late export of an old version, naming the artifact that moved', () => {
    // NOBODY RE-EXAMINED THE MOVE. The package would replace a reading of an artifact the run has
    // left, and nothing in what it carries says the move was looked at.
    const facts = readyFacts({ artifactRefs: moved, approval: undefined })
    const check = checkOf(facts, 'artifacts-current')
    expect(check.passed).toBe(false)
    expect(check.detail).toContain('typeset')
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
      staleApproval: "'typeset' moved from version 3 to version 4",
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
    expect(check.detail).toContain('typeset')
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


/** One compiled document as the facts state it: what the artifact carries, and whether it survives. */
function typesetDocument(
  format: string,
  overrides: Partial<TypesetDocument> = {},
): TypesetDocument {
  return {
    format,
    path: format === 'docx' ? 'manuscript.docx' : `manuscript.${format}`,
    present: true,
    intact: true,
    ...overrides,
  }
}

describe("a typeset form that is not this run's submission", () => {
  it('refuses a typeset form rendered from a document the run has moved past', () => {
    // ONE DOCUMENT, MANY VERSIONS: D4 republishes it, a person may publish an accepted candidate over
    // it, and the typeset form names the version it rendered. A form of a superseded version is a
    // submission of the draft the paper was, so it is a draft here rather than a final package.
    const facts = readyFacts({
      typeset: { renderedManuscriptVersion: 2, manuscriptVersion: 3, declaredFormats: [], documents: [], repairedFromVersion: undefined },
    })
    const check = checkOf(facts, 'manuscript-typeset')
    expect(check.passed).toBe(false)
    expect(check.detail).toContain('version 2')
    expect(check.detail).toContain('version 3')
    expect(finalPackageStateOf(checkFinalPackage(facts))).toBe('draft')
  })

  it('refuses a run that holds no typeset form at all', () => {
    // `undefined === undefined` would be a pass, so the case where the run rendered nothing is stated
    // rather than left to an equality that holds between two absences.
    const facts = readyFacts({
      typeset: {
        renderedManuscriptVersion: undefined,
        manuscriptVersion: undefined,
        declaredFormats: [],
        documents: [],
        repairedFromVersion: undefined,
      },
    })
    expect(checkOf(facts, 'manuscript-typeset').passed).toBe(false)
  })

  it('refuses a form the repair re-rendered, because no gate judged that document', () => {
    // THE REPAIR ANSWERS `manuscript-typeset` AND LEAVES A QUESTION IT CANNOT ANSWER. Re-rendering
    // brings the form up to date with the document; it does not run E1's gates over that document,
    // and it cannot — a settled attempt is never re-adjudicated. The two conditions are therefore
    // separate, and a run whose only failure was the stale render used to become FINAL once it was
    // repaired and approved: measured through the service, a hand-edited and repaired run reported
    // nothing wrong but its profile and its review policy.
    const repaired = readyFacts({
      typeset: {
        renderedManuscriptVersion: 4,
        manuscriptVersion: 4,
        declaredFormats: [],
        documents: [],
        repairedFromVersion: 3,
      },
    })
    // The render IS of the document the run holds — this is not `manuscript-typeset` again.
    expect(checkOf(repaired, 'manuscript-typeset').passed).toBe(true)
    const check = checkOf(repaired, 'manuscript-gated')
    expect(check.passed).toBe(false)
    expect(check.detail).toContain('no gate has judged the document the run holds')
    expect(check.detail).toContain('re-rendered from document version 3')
    expect(finalPackageStateOf(checkFinalPackage(repaired))).toBe('draft')

    // AND THE STATE IT CONTRASTS WITH, so this is a condition about a repair rather than about every
    // form: one E1 produced itself passes it, which is the case every other test here holds.
    expect(checkOf(readyFacts(), 'manuscript-gated').passed).toBe(true)
  })

  it('refuses a declared submission format the compile produced no document for', () => {
    // THE DEPLOYMENT DECLARED IT, so it is asked for it: `latex` was in this compiler's `formats` and
    // no `.tex` came out. A journal that wants LaTeX source would be handed nothing.
    const facts = readyFacts({
      typeset: {
        renderedManuscriptVersion: 3,
        manuscriptVersion: 3,
        declaredFormats: ['html', 'latex', 'docx'],
        documents: [typesetDocument('docx')],
        repairedFromVersion: undefined,
      },
    })
    const check = checkOf(facts, 'typeset-complete')
    expect(check.passed).toBe(false)
    expect(check.detail).toContain('latex')
    expect(finalPackageStateOf(checkFinalPackage(facts))).toBe('draft')
  })

  it('refuses a document that is present but is not the one that was compiled', () => {
    // A DIGEST IS A RECORD AND THE BYTES ARE THE FACT. A document whose content moved while the digest
    // recorded beside it did not is not the file that was compiled, and a submission carrying it would
    // carry something else under the name of the paper.
    const facts = readyFacts({
      typeset: {
        renderedManuscriptVersion: 3,
        manuscriptVersion: 3,
        declaredFormats: ['docx'],
        documents: [typesetDocument('docx', { intact: false })],
        repairedFromVersion: undefined,
      },
    })
    const check = checkOf(facts, 'typeset-complete')
    expect(check.passed).toBe(false)
    expect(check.detail).toContain('do not carry the bytes')
  })

  it('asks a deployment for nothing it did not declare it produces', () => {
    // A MACHINE WITH NO LATEX ENGINE asks nobody for `.tex`, and a deployment that compiles nothing is
    // asked for nothing: the requirement follows the compiler's own declaration, which E1 recorded.
    const facts = readyFacts({
      typeset: {
        renderedManuscriptVersion: 3,
        manuscriptVersion: 3,
        declaredFormats: ['html'],
        documents: [typesetDocument('html')],
        repairedFromVersion: undefined,
      },
    })
    const check = checkOf(facts, 'typeset-complete')
    expect(check.passed, check.detail).toBe(true)
    expect(check.detail).toContain('declared no submission format')
    expect(finalPackageStateOf(checkFinalPackage(facts))).toBe('final')
  })

  it('passes when both declared deliverables are present and intact', () => {
    const facts = readyFacts({
      typeset: {
        renderedManuscriptVersion: 3,
        manuscriptVersion: 3,
        declaredFormats: ['latex', 'docx'],
        documents: [typesetDocument('docx'), typesetDocument('latex')],
        repairedFromVersion: undefined,
      },
    })
    const check = checkOf(facts, 'typeset-complete')
    expect(check.passed, check.detail).toBe(true)
    expect(check.detail).toContain('manuscript.docx')
  })
})

describe('the facts a real run records about its typeset form', () => {
  it('recomputes each document digest from the bytes the artifact carries', async () => {
    // THE CHECK IS ONLY AS GOOD AS THE READ. A digest compared against a field copied from the entry
    // it is testing proves nothing, so the digests are recomputed here from the bytes the artifact
    // holds — and the outcome is asserted for a run that really compiled one.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { documentCompiler: stubCompiler() })
    const facts = manuscriptFactsOf(store, run.runId, 'production')
    const snapshot = getRunSnapshot(store, run.runId)
    expect(facts.typeset.renderedManuscriptVersion).toBe(snapshot.registry['manuscript']?.ref.version)
    expect(facts.typeset.declaredFormats).toEqual(['html', 'latex', 'docx'])
    const docx = facts.typeset.documents.find(entry => entry.format === 'docx')
    expect(docx?.present).toBe(true)
    expect(docx?.intact).toBe(true)
    // AND THE DIGEST IS THE ONE OVER THE BYTES, not over the base64 text that carries them.
    const carried = (getArtifact(store, run.runId, 'typeset') as {
      compilation: { documents: ReadonlyArray<{ path: string; base64: string; sha256: string; bytes: number }> }
    }).compilation.documents.find(entry => entry.path === 'manuscript.docx')
    const bytes = Buffer.from(carried?.base64 ?? '', 'base64')
    expect(carried?.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(carried?.bytes).toBe(bytes.length)
  })
})

describe('the journal conditions a run states', () => {
  /**
   * A run whose frozen spec carries `profile` as its research profile.
   *
   * The spec is written directly because that is what the read under test reads: a deployment's
   * profile is resolved once at the start of a run and frozen there, and every later reader — this
   * check, the export, a restart — is meant to take the frozen copy rather than today's
   * configuration.
   *
   * @param profile - the profile to freeze into the run's spec.
   * @returns a store holding one run, and its id.
   */
  function runUnder(profile: unknown): { readonly store: ResearchRunStore; readonly runId: string } {
    const store: ResearchRunStore = new Map()
    const runId = createRun(store)
    const run = store.get(runId)
    /* c8 ignore next -- createRun always leaves the run it just created in the store */
    if (run === undefined) throw new Error('the run was not created')
    run.spec['researchProfile'] = profile
    return { store, runId }
  }

  it('reads the venue decision rather than counting the rules a second time', () => {
    // THE TWO IMPLEMENTATIONS DISAGREED. `checkVenueRules` was corrected on 2026-09-18 to the three
    // findings the profile records — read and stated, read and NOT stated, and never read — while
    // this read still asked only whether a rule was `verified`. The shipped profile therefore
    // reported its one `not_specified` rule as unread, and `journal-rules-verified` refused EVERY
    // submission of a paper written for that journal: measured through the service, the check came
    // back `1 of 9 requirement(s) ... have not been read (graphical-abstract)` on a guide that had
    // been read in full. The assertion is the agreement itself, over the profile a deployment that
    // configures no journal is actually given.
    const { store, runId } = runUnder(resolveResearchProfile({}))
    const facts = finalPackageFactsOf(store, runId, 'production', [], undefined, { read: [], moved: [] })
    expect(checkVenueRules(TRC_PROFILE)).toEqual([])
    expect(facts.journalRules?.refusal).toBeUndefined()
    expect(facts.journalRules?.unverified).toEqual([])
    expect(facts.journalRules?.read).toBe(TRC_PROFILE.rules.length)
    const check = checkOf(facts, 'journal-rules-verified')
    expect(check.passed, check.detail).toBe(true)
  })

  it('refuses an unread guide, and an empty one, in the decision own words', () => {
    // THE OTHER TWO FINDINGS, so the agreement above is not the only thing pinned: a guide nobody
    // read refuses, and a profile recording NO rules is an unread guide rather than a venue that
    // requires nothing — a fact the counts alone cannot express, which is why the refusal travels
    // with them instead of being re-derived from `unverified.length`.
    const unreadJournal = {
      id: 'x',
      name: 'An unread journal',
      rules: unreadRulesFor('https://example.invalid/g', '2026-01-01', 'timed out'),
    }
    const unread = runUnder(resolveResearchProfile({ journal: unreadJournal }))
    const unreadFacts = finalPackageFactsOf(unread.store, unread.runId, 'production', [], undefined, { read: [], moved: [] })
    const unreadCheck = checkOf(unreadFacts, 'journal-rules-verified')
    expect(unreadCheck.passed).toBe(false)
    // THE DECISION'S OWN SENTENCE, not a paraphrase of it: a reader acting on this refusal is acting
    // on the same reason `checkVenueRules` gives, so the two cannot drift into naming different
    // remedies for one state.
    expect(unreadCheck.detail).toBe(checkVenueRules(unreadJournal)[0]?.detail)

    const emptyJournal = { id: 'x', name: 'No rules', rules: [] }
    const empty = runUnder(resolveResearchProfile({ journal: emptyJournal }))
    const emptyFacts = finalPackageFactsOf(empty.store, empty.runId, 'production', [], undefined, { read: [], moved: [] })
    const emptyCheck = checkOf(emptyFacts, 'journal-rules-verified')
    expect(emptyCheck.passed).toBe(false)
    expect(emptyCheck.detail).toBe(checkVenueRules(emptyJournal)[0]?.detail)
    expect(emptyCheck.detail).toContain('no requirement recorded')
  })
})

/**
 * A compiler that answers with a DOCX (bytes, a ZIP) and text for the other formats.
 *
 * @returns the compiler, as `DriveOptions.documentCompiler` takes it.
 */
function stubCompiler(): DocumentCompiler {
  return {
    tool: 'stub',
    formats: ['html', 'latex', 'docx'],
    compile(request) {
      return Promise.resolve(request.format === 'docx'
        ? {
          format: request.format,
          fileName: 'manuscript.docx',
          content: Buffer.from([0x50, 0x4b, 0x03, 0x04]).toString('base64'),
          encoding: 'base64' as const,
          tool: 'stub@1',
          assets: { embedded: [], dropped: [] },
          files: [],
        }
        : {
          format: request.format,
          fileName: `manuscript.${request.format === 'latex' ? 'tex' : 'html'}`,
          content: `<document>${request.document.title}</document>`,
          encoding: 'utf8' as const,
          tool: 'stub@1',
          assets: { embedded: [], dropped: [] },
          files: [],
        })
    },
  }
}
