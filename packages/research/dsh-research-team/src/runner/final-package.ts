// @deepseek-ai/dsh-research-team — is this package the final one, or a working draft?
//
// WHY THIS IS SEPARATE FROM THE EXPORT. `planRunPackage` writes what the run holds and states in its
// manifest whether that material is submission-ready. Both facts were in the manifest, and the export
// itself refused nothing: a package of a run that stopped at A1, or of a run conducted under the
// evaluation profile, was written identically to one a person had approved, and only a reader of the
// manifest could tell them apart. The one that matters most is the manifest written when the DRIVE
// ended: it records `E2-submit: gated`, because a person had not approved yet — and the approval that
// followed never reached it. A page that offered that file as the final package offered a package of
// the state before the decision.
//
// So a package now says which of the two it is, and the FINAL one is an operation with its own
// guards: every check below runs in the operation that writes it, so hiding a button is not the
// enforcement and a direct caller is refused for the same reasons.
//
// WHAT A CHECK IS. One condition, what was observed, and whether it holds. They are computed from the
// run's own records — its step statuses, its registry, its approval, its last write — and never from
// a caller's claim about them.
//
// ONE DEFINITION OF READY, IN TWO SCOPES. Nine of the conditions below are about the MANUSCRIPT: is
// the evidence the kind that may carry a submission, was there a manuscript, is the typeset form a
// render of the document the run holds, did every step close, does it have every section, is any
// concern still open, does the approval still cover it, does the compiled document carry its floats,
// has it had the review the deployment requires. Seven are about the DELIVERY: is there an approval,
// does it still cover what the run holds, will the package carry the files the manuscript declares,
// does it carry the documents the compile produced, are those documents the ones that were compiled,
// does the package describe the state the run is in, is that state on disk. `checkManuscript`
// evaluates the first nine and `submissionReadinessOf` reports them as the manifest's
// `submissionReady`; `checkFinalPackage` evaluates all sixteen. They are the SAME function, so a run
// cannot be ready in the manifest and refused as a package for a reason about the paper — which is
// the disagreement this file and `submission-readiness.ts` used to be able to produce.

import { createHash } from 'node:crypto'
import { approvalStalenessOf, getArtifact, getRunSnapshot, getStepDefinitions } from '@deepseek-ai/dsh-research-core'
import type { ApprovalRecord, EvidenceProfile, ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { checkVenueRules } from './venue-rules.ts'
import type { VenueRuleRefusalCode } from './venue-rules.ts'
import type { JournalProfile } from './research-profile.ts'

/**
 * The formats a submission is handed in.
 *
 * DOCX AND LATEX ARE THE DELIVERABLES: most journals' submission systems take a Word file and some
 * want the LaTeX source, and the same document model produces both (`document-compile.ts`). A PDF this
 * pipeline compiles was never the submission — a machine without a LaTeX engine simply has none — and
 * HTML is the self-contained preview.
 */
const SUBMISSION_FORMATS: ReadonlyArray<string> = ['docx', 'latex']

/** Why a final package was refused, or why it may be written. */
export type FinalPackageCheckCode =
  | 'production-evidence'
  | 'manuscript-produced'
  | 'every-step-closed'
  | 'no-refused-sections'
  | 'no-open-issues'
  | 'approval-recorded'
  | 'approval-current'
  | 'required-files-present'
  | 'artifacts-current'
  | 'compiled-document-complete'
  /** The manuscript has not had the review the deployment requires. */
  | 'review-complete'
  /** A document the compile produced is not in the package. */
  | 'deliverables-present'
  /** The typeset form is a render of a superseded document, so it is not this paper's submission. */
  | 'manuscript-typeset'
  /** The typeset form was re-rendered by the repair path, so no gate has judged this document. */
  | 'manuscript-gated'
  /** A submission format the deployment declared has no document, or one that does not survive it. */
  | 'typeset-complete'
  /** The target journal's requirements have not been read, so nothing was checked against them. */
  | 'journal-rules-verified'
  | 'run-saved'

/** One condition a final package must meet, with what the run recorded about it. */
export interface FinalPackageCheck {
  readonly code: FinalPackageCheckCode
  readonly passed: boolean
  /** One sentence, naming what was observed — the remedy when it failed. */
  readonly detail: string
}

/** Whether a package is the final one or a working draft. */
export type FinalPackageState = 'draft' | 'final'

/** The approval a final package carries, as the manifest records it. */
export interface FinalPackageApproval {
  /** Who decided, as the host attested them. */
  readonly operator: string
  readonly decision: string
  readonly approvalEventId: string
  /** Millisecond timestamp of the decision. */
  readonly decidedAt: number
  /** The artifacts as they stood when the decision was made, and the versions the person read. */
  readonly targets: ReadonlyArray<{ readonly artifactId: string; readonly version: number; readonly contentHash: string }>
}

/** One concern a revision round did not close, with the reason the applier gave. */
export interface OpenIssue {
  readonly issueId: string
  readonly sectionId: string
  readonly reason: string
}

/**
 * The issues a revision round left open.
 *
 * A round that closed every concern it raised says so with an empty list; a round that left one open
 * says which and why, and the rebuttal artifact already carries both. Read here rather than
 * summarised, because "3 issues" is not something a reader can act on and "the patch for `results`
 * was written against a different version" is.
 *
 * @param rebuttal - the `rebuttal` artifact, when the run produced one.
 * @returns the open issues, in the order the round recorded them.
 */
export function openIssuesOf(rebuttal: unknown): ReadonlyArray<OpenIssue> {
  if (rebuttal === null || typeof rebuttal !== 'object') return []
  const outcomes = (rebuttal as { issues?: unknown }).issues
  if (!Array.isArray(outcomes)) return []
  return outcomes.flatMap((outcome): OpenIssue[] => {
    if (outcome === null || typeof outcome !== 'object') return []
    const record = outcome as { issueId?: unknown; sectionId?: unknown; disposition?: unknown; reason?: unknown }
    if (record.disposition !== 'open') return []
    return [{
      issueId: typeof record.issueId === 'string' ? record.issueId : 'unknown issue',
      sectionId: typeof record.sectionId === 'string' ? record.sectionId : 'unknown section',
      reason: typeof record.reason === 'string' ? record.reason : 'no reason recorded',
    }]
  })
}

/** One document this run's compile produced, and whether it survives the record that carries it. */
export interface TypesetDocument {
  readonly format: string
  readonly path: string
  /** True when the artifact carries the document — its bytes, or its text under `packageFiles`. */
  readonly present: boolean
  /**
   * True when what the artifact carries is the document it recorded.
   *
   * THE DIGEST AND LENGTH ARE THE RECORD, AND THE BYTES ARE THE FACT. A truncated base64 payload, a
   * hand-edited entry, a document whose content moved while its digest did not: all three pass a
   * presence check and none of them is the file the compile produced. Recomputed here from the bytes
   * the artifact holds — never from a file on disk, which is a different thing that may agree.
   */
  readonly intact: boolean
}

/** The typeset form as the run holds it: which document it renders, and what the compile produced. */
export interface TypesetFacts {
  /** The manuscript version the typeset form records it rendered, when it records one. */
  readonly renderedManuscriptVersion: number | undefined
  /** The version of the manuscript the run holds now, when it holds one. */
  readonly manuscriptVersion: number | undefined
  /** The formats this deployment's compile was asked for here, as it declared them. */
  readonly declaredFormats: ReadonlyArray<string>
  readonly documents: ReadonlyArray<TypesetDocument>
  /**
   * The document version this form was RE-RENDERED from, when a repair produced it.
   *
   * THE REPAIR RE-RENDERS WITHOUT RE-TAKING THE GATES. `materializeManuscript` exists so a form that
   * renders a superseded document can be brought up to date, and it does not run E1's gates over the
   * document it renders: re-running them there would be an adjudication nothing records. So a form
   * carrying this marker was produced by an operation no gate judged, which is a different fact from
   * a form E1's own execution wrote — and `no-refused-sections`-style silence about it is how a
   * hand-edited document could be approved and packaged as though the gates had seen it.
   *
   * Undefined means E1's own execution produced this form, which is the only state in which every
   * condition about the manuscript has been decided by the pipeline.
   */
  readonly repairedFromVersion: number | undefined
}

/** Everything the conditions about the MANUSCRIPT read, gathered from the run. */
export interface ManuscriptFacts {
  readonly profile: EvidenceProfile
  readonly manuscriptProduced: boolean
  /** Steps that have not reached `passed`, as `id (status)`. */
  readonly unfinishedSteps: ReadonlyArray<string>
  readonly refusedSections: ReadonlyArray<string>
  readonly openIssues: ReadonlyArray<OpenIssue>
  /** The first artifact that moved after an approved decision, when one did. */
  readonly staleApproval: string | undefined
  /**
   * The typeset form, and whether it is a render of the document the run holds.
   *
   * ONE DOCUMENT, ONE SLUG, MANY VERSIONS: D3 creates `manuscript`, D4 republishes it, and a person
   * may publish an accepted candidate over it. The typeset form names the version it was rendered
   * from, so a render of a superseded document is told apart from a render of the document the run
   * holds — which is the difference between submitting this paper and submitting the draft it was.
   */
  readonly typeset: TypesetFacts
  /**
   * What the run's compile produced, as the artifact recorded it.
   *
   * `dropped` names the floats the compiled document does NOT carry — a figure LaTeX could not embed,
   * a diagram nobody rendered — because a submission whose figures are missing is not the paper, while
   * a deployment that compiles nothing states that instead (see the check).
   */
  readonly compilation: {
    readonly tool: string | null
    readonly dropped: ReadonlyArray<string>
  }
  /**
   * What the last review left, as the rebuttal artifact recorded it.
   *
   * ABSENT WHEN THE RUN HAS NO REBUTTAL ARTIFACT, which is a run that never reached D4 — and a run
   * that never reached D4 has not been reviewed, so the conditions below refuse it on `unfinishedSteps`
   * rather than on this. Recording it here rather than deriving it from round counts keeps one home
   * for the fact: the review policy's own evaluation, made where the rounds were taken.
   */
  readonly review?: { readonly satisfied: boolean; readonly reason: string }
}

/** Everything the checks read, gathered from the run rather than asserted by a caller. */
export interface FinalPackageFacts extends ManuscriptFacts {
  /** The approval on the human gate, when one was made. */
  readonly approval: ApprovalRecord | undefined
  /** Files the run's own manuscript declares, and which of them the package will carry. */
  readonly declaredFiles: ReadonlyArray<string>
  readonly packagedFiles: ReadonlyArray<string>
  /**
   * The DOCUMENTS this run's compile produced, and which of them the package carries.
   *
   * A JOURNAL IS HANDED A DOCUMENT, not the Markdown it was built from. `manuscript.md` is in the
   * package either way and its presence proves nothing about the `.docx` a submission system takes —
   * the compiled files are written as BYTES, so they are not among the manuscript's declared text
   * files and nothing else here can see whether they arrived.
   *
   * `produced` is empty for a deployment that named no compiler, which the check reads as "no
   * document is claimed" rather than as a document that went missing.
   */
  readonly deliverables: {
    readonly produced: ReadonlyArray<string>
    readonly carried: ReadonlyArray<string>
  }
  /**
   * Whether this manuscript may be published under the rules that were read.
   *
   * THE PROFILE IS THE RUN'S OWN, frozen into its spec, and the rules in it state where each was read,
   * when, for which article type, and whether it was established. `checkVenueRules` is the decision,
   * taken where the profile lives rather than re-derived here.
   */
  readonly journalRules?: {
    readonly venueName: string
    /** The rules somebody read, whether the reading found a requirement or found none stated. */
    readonly read: number
    readonly total: number
    /** The rules nobody has read, by id — empty for a guide that states nothing about a subject. */
    readonly unverified: ReadonlyArray<string>
    /**
     * What the venue-rules decision refused, when it refused something.
     *
     * CARRIED RATHER THAN RE-DERIVED. `checkVenueRules` owns the three findings — read and stated,
     * read and not stated, and never read — and only the last stands in the way of a submission. A
     * check that re-counted the rules here would be a second opinion about which findings count, and
     * the two disagreed: this file read "not verified" as "not read", so a guide that had been read
     * in full and states nothing about one subject refused every submission of a paper written for
     * that journal. The refusal is taken where the rules live and read here as the answer it is.
     */
    readonly refusal?: { readonly code: VenueRuleRefusalCode; readonly detail: string }
  }
  /**
   * The artifact versions this package was read from, and which of them the run has moved past.
   *
   * AN EXPORT IS A READING OF ONE STATE. A later step, a revision, a re-run or a hand edit moves an
   * artifact the package was built from, and a package that still called itself final would be
   * attesting to a document the run no longer holds. `moved` is empty when every ref still stands.
   */
  readonly artifactRefs: {
    readonly read: ReadonlyArray<string>
    readonly moved: ReadonlyArray<string>
  }
  /** The run's last write to its snapshot, when it failed. */
  readonly saveError: string | undefined
}

/**
 * The conditions about the MANUSCRIPT, in the order a reader meets them.
 *
 * THE MANUSCRIPT'S OWN READINESS, and the one definition of it. `submissionReadinessOf` reports
 * whether these all hold; `checkFinalPackage` adds the conditions about the delivery to them. A run
 * therefore cannot be ready here and refused as a package for a reason about the paper.
 *
 * @param facts - what the run records about its manuscript.
 * @returns one entry per condition, in a fixed order.
 */
export function checkManuscript(facts: ManuscriptFacts): ReadonlyArray<FinalPackageCheck> {
  return [
    {
      code: 'production-evidence',
      passed: facts.profile === 'production',
      detail: facts.profile === 'production'
        ? 'the run was conducted under the production evidence profile'
        : `the run was conducted under the '${facts.profile}' profile: its material may be read and`
          + ' exported as a working draft, and may not be published as a production package',
    },
    {
      code: 'manuscript-produced',
      passed: facts.manuscriptProduced,
      detail: facts.manuscriptProduced
        ? 'the run produced a formatted manuscript'
        : 'the run produced no formatted manuscript, so there is no paper to package',
    },
    {
      // THE TYPESET FORM MUST BE A RENDER OF THE DOCUMENT THE RUN HOLDS. A journal is handed the
      // typeset form, and the run's document can move after it was rendered — a later step, a re-run,
      // or a person publishing an accepted candidate over it — so a form of a superseded version is a
      // submission of a manuscript the run no longer stands behind. Both versions are read off the
      // run's own records: the typeset artifact names what it rendered, and the registry holds what
      // the document is now.
      code: 'manuscript-typeset',
      passed: facts.typeset.renderedManuscriptVersion !== undefined
        && facts.typeset.renderedManuscriptVersion === facts.typeset.manuscriptVersion,
      detail: facts.typeset.renderedManuscriptVersion === undefined
        ? 'the run holds no typeset form that records the document it rendered, so there is no'
          + ' submission that binds this manuscript'
        : facts.typeset.renderedManuscriptVersion === facts.typeset.manuscriptVersion
          ? `the typeset form renders the document the run holds (version ${String(facts.typeset.manuscriptVersion)})`
          : `the typeset form renders manuscript version ${String(facts.typeset.renderedManuscriptVersion)}`
            + ` and the run holds version ${String(facts.typeset.manuscriptVersion ?? 0)}`
            + ' — the document moved after it was typeset, so this form is a render of the draft the'
            + ' paper was',
    },
    {
      // A SUBMISSION IS HANDED A DOCUMENT, IN THE FORMATS THE DEPLOYMENT SAID IT PRODUCES. Both the
      // document and its digest have to hold: a document that is absent, and one whose bytes do not
      // match the digest recorded beside them, are the same failure to a reader — there is nothing to
      // send. The requirement follows the deployment's OWN declaration (`formats`), which is what E1
      // recorded, so a machine with no LaTeX engine asks nobody for `.tex` and a deployment that
      // compiles nothing is held to nothing.
      code: 'typeset-complete',
      passed: missingDocuments(facts.typeset).length === 0 && brokenDocuments(facts.typeset).length === 0,
      detail: documentDetail(facts.typeset),
    },
    {
      // NO GATE HAS JUDGED A DOCUMENT THIS RUN RE-RENDERED. `manuscript-typeset` above asks whether
      // the form renders the document the run holds; this asks the question that repair does not
      // answer: did any gate judge that document. The repair re-renders and does not re-take them, so
      // a form it produced carries `materializedFrom` and every step's verdict still stands on the
      // document it replaced — `every-step-closed` reads those verdicts as closed, and a person's
      // approval binds a document version rather than a judgement. Approving is therefore a way to
      // publish a paper nothing in this pipeline examined, which is the one thing the gates exist to
      // prevent. REFUSED rather than reported, and refused HERE rather than in the repair, because
      // the repair is also the legitimate answer to a form that fell behind its document.
      //
      // THE REMEDY IS RUNNING THE PIPELINE OVER THE DOCUMENT. E1's gates are adjudicated inside a
      // step attempt and a settled attempt is never re-submitted (INV-VERDICT-IMMUTABLE), so a repair
      // cannot become a passing one — the study is conducted again, and this sentence says so rather
      // than leaving a reader to infer it.
      code: 'manuscript-gated',
      passed: facts.typeset.repairedFromVersion === undefined,
      detail: facts.typeset.repairedFromVersion === undefined
        ? 'the typeset form is the one the format step produced, so its gates judged this document'
        : 'the typeset form was re-rendered from document version'
          + ` ${String(facts.typeset.repairedFromVersion)}, and no gate has judged the document the run`
          + ` holds (version ${String(facts.typeset.manuscriptVersion ?? 0)}) — the format step's`
          + ' verdicts stand on the document it replaced, so this manuscript has to go through the'
          + ' pipeline again before it may be published as the paper a journal receives',
    },
    {
      code: 'every-step-closed',
      passed: facts.unfinishedSteps.length === 0,
      detail: facts.unfinishedSteps.length === 0
        ? 'every step the pipeline declares reached `passed`'
        : `these steps did not pass: ${facts.unfinishedSteps.join(', ')} — a package of a run that`
          + ' has not finished is a draft of wherever it stopped',
    },
    {
      code: 'no-refused-sections',
      passed: facts.refusedSections.length === 0,
      detail: facts.refusedSections.length === 0
        ? 'the manuscript carries every section the pipeline writes'
        : `the manuscript has no ${facts.refusedSections.join(', ')} section: the run held none of`
          + ' the evidence that section is written from, and the pipeline refused to write it rather'
          + ' than fill it in',
    },
    {
      code: 'no-open-issues',
      passed: facts.openIssues.length === 0,
      detail: facts.openIssues.length === 0
        ? 'no revision round left a concern open'
        : `the revision left ${facts.openIssues.map(issue => `${issue.issueId} on '${issue.sectionId}'`).join('; ')} open`,
    },
    {
      // AN APPROVAL BINDS THE DOCUMENT THAT WAS IN FRONT OF THE PERSON. This is the one home for that
      // fact: the check says it here, and readiness reports the same sentence rather than a second
      // wording that could drift from it.
      code: 'approval-current',
      passed: facts.staleApproval === undefined,
      detail: facts.staleApproval === undefined
        ? 'the approval still covers the artifacts the run holds'
        : `an approved step's inputs changed after the decision: ${facts.staleApproval}. The approval`
          + ' was given for the revision that was in front of the person, and this is not it',
    },
    {
      // A SUBMISSION WHOSE FIGURES ARE MISSING IS NOT THE PAPER. The compiled document is what a
      // journal receives, and a float it could not embed — a diagram nobody rendered, a figure with no
      // raster — is a figure the reader will not see. A deployment that compiles nothing is not held
      // to this: its manuscript is complete as Markdown and its artifact says it was not compiled,
      // which is a different fact from a document that claims to carry a figure it lost.
      code: 'compiled-document-complete',
      passed: facts.compilation.tool === null || facts.compilation.dropped.length === 0,
      detail: facts.compilation.tool === null
        ? 'this deployment compiles no document, so no compiled document is claimed'
        : facts.compilation.dropped.length === 0
          ? `'${facts.compilation.tool}' embedded every float the manuscript carries`
          : `the compiled document does not carry: ${facts.compilation.dropped.join(', ')}`
            + ' — a submission whose figures are missing is not the paper',
    },
    {
      // A MANUSCRIPT WHOSE REVIEW DID NOT FINISH IS NOT THE PAPER EITHER. The deployment states how
      // many complete readings it requires and what "complete" means; a run that has not met it — too
      // few rounds, an issue still open, or a revision nobody has read — may be exported as the draft
      // it is, and may not be published as the manuscript a journal receives. The `where` is the
      // review policy's own evaluation, taken where the rounds were, so this check and the run's
      // record cannot disagree about what happened.
      code: 'review-complete',
      passed: facts.review === undefined || facts.review.satisfied,
      detail: facts.review === undefined
        ? 'the run produced no rebuttal record, so no review is claimed'
        : facts.review.satisfied
          ? facts.review.reason
          : `${facts.review.reason} — the manuscript may be exported as the draft it is and not as`
            + ' the paper a journal receives',
    },
  ]
}

/**
 * The submission formats this run's compile was asked for, and did not produce.
 *
 * THE DEPLOYMENT'S OWN DECLARATION SETS THE REQUIREMENT. `declaredFormats` is what its compiler said
 * it can produce on THIS machine, recorded by E1 — so a deployment with no LaTeX engine is asked for
 * no `.tex`, and one that compiles nothing is asked for nothing. Holding either of them to a format
 * it never claimed would refuse a package for a document it was never going to have.
 *
 * @param typeset - the typeset facts.
 * @returns the declared submission formats with no document at all.
 */
function missingDocuments(typeset: TypesetFacts): ReadonlyArray<string> {
  return requiredDocuments(typeset).filter(document => !document.present).map(document => document.format)
}

/**
 * The declared submission documents the artifact does not carry intact.
 *
 * @param typeset - the typeset facts.
 * @returns the formats whose document is present but does not match the record that carries it.
 */
function brokenDocuments(typeset: TypesetFacts): ReadonlyArray<string> {
  return requiredDocuments(typeset).filter(document => document.present && !document.intact).map(document => document.format)
}

/** The per-format documents this run owes: the submission formats this deployment declared. */
function requiredDocuments(typeset: TypesetFacts): ReadonlyArray<TypesetDocument> {
  return typeset.declaredFormats
    .filter(format => SUBMISSION_FORMATS.includes(format))
    .map(format => typeset.documents.find(document => document.format === format)
      ?? { format, path: '', present: false, intact: false })
}

/** The sentence a reader of `typeset-complete` acts on, naming what is missing and what is wrong. */
function documentDetail(typeset: TypesetFacts): string {
  const required = requiredDocuments(typeset)
  const missing = missingDocuments(typeset)
  const broken = brokenDocuments(typeset)
  if (required.length === 0) {
    return 'this deployment declared no submission format it produces, so no document is claimed'
  }
  if (missing.length > 0) {
    return `the compile produced no ${missing.join(' or ')} for a deployment that declared it — a`
      + ' journal is handed a document, and there is none to hand it'
  }
  if (broken.length > 0) {
    return `${broken.join(' and ')} do not carry the bytes the compile recorded for them (a digest or`
      + ' length that does not match): what is in the package is not the document that was compiled'
  }
  return 'every submission format this deployment declared is present and intact'
    + ` (${required.map(document => `${document.format}: ${document.path}`).join(', ')})`
}

/**
 * The order a package's conditions are reported in.
 *
 * FIXED, AND NOT DERIVED FROM THE TWO GROUPS ABOVE. `finalPackageRefusalOf` names the FIRST unmet
 * condition, so a reader's next action depends on this order; assembling by group would silently
 * reorder it. The list is the order this file has always reported, with the manuscript's conditions
 * where they have always sat among the delivery's.
 */
const FINAL_PACKAGE_CHECK_ORDER: ReadonlyArray<FinalPackageCheckCode> = [
  'production-evidence',
  'manuscript-produced',
  'manuscript-typeset',
  'manuscript-gated',
  'every-step-closed',
  'no-refused-sections',
  'no-open-issues',
  'approval-recorded',
  'approval-current',
  'required-files-present',
  'deliverables-present',
  'typeset-complete',
  'compiled-document-complete',
  'review-complete',
  'journal-rules-verified',
  'artifacts-current',
  'run-saved',
]

/**
 * Judge one run's package against every condition a final package must meet.
 *
 * EVERY CHECK RUNS, rather than stopping at the first failure: the page states all of them beside the
 * export control, and a reader deciding what to do next needs the whole list — a run can be under the
 * evaluation profile AND unapproved, and fixing one does not reveal the other.
 *
 * @param facts - what the run recorded.
 * @returns one entry per condition, in a fixed order.
 */
export function checkFinalPackage(facts: FinalPackageFacts): ReadonlyArray<FinalPackageCheck> {
  const missingFiles = facts.declaredFiles.filter(path => !facts.packagedFiles.includes(path))
  const missingDeliverables = facts.deliverables.produced
    .filter(path => !facts.deliverables.carried.includes(path))
  const delivery: ReadonlyArray<FinalPackageCheck> = [
    {
      code: 'approval-recorded',
      passed: facts.approval?.decision === 'approved',
      detail: facts.approval === undefined
        ? 'the human gate has no decision on record: a final package is the one a person approved'
        : facts.approval.decision === 'approved'
          ? `approved by ${facts.approval.principalId}`
          : `the human gate recorded '${facts.approval.decision}': only an approval makes a package final`,
    },
    {
      code: 'required-files-present',
      passed: facts.declaredFiles.length > 0 && missingFiles.length === 0,
      detail: facts.declaredFiles.length === 0
        ? 'the run\'s manuscript declares no package files, so there is nothing to check for presence'
        : missingFiles.length === 0
          ? `every file the manuscript declares is in the package (${facts.declaredFiles.length})`
          : `these declared files are not in the package: ${missingFiles.join(', ')}`,
    },
    {
      // THE LAST QUESTION IS WHETHER THIS IS THE DOCUMENT THE JOURNAL ACCEPTS, and the only honest
      // answer available is what the run recorded about that journal's guide. A rule nobody read is
      // not a rule the manuscript satisfies: publishing under it would mean the paper was measured
      // against nothing while carrying the journal's name. Recorded rules that were READ satisfy
      // this; a record in which every rule is `unknown` does not, which is the state measured on
      // 2026-09-18 when three official pages answered HTTP 403 to this host.
      code: 'journal-rules-verified',
      passed: facts.journalRules !== undefined && facts.journalRules.refusal === undefined,
      detail: facts.journalRules === undefined
        ? "this run carries no record of the target journal's requirements, so nothing about the"
          + ' manuscript was checked against them'
        : facts.journalRules.refusal === undefined
          ? `every requirement recorded for '${facts.journalRules.venueName}' was read at its source`
            + ` (${String(facts.journalRules.read)} of ${String(facts.journalRules.total)})`
          // THE DECISION'S OWN SENTENCE, so a reader acts on the reason the decision was taken:
          // `checkVenueRules` distinguishes an absent profile, a guide nobody read, and the rules
          // still awaiting a reading, and this file cannot restate those three without becoming the
          // second opinion that used to refuse a guide that had been read in full.
          : facts.journalRules.refusal.detail,
    },
    {
      // AN EXPORT IS A READING OF ONE STATE, and a state that has moved since is not the state the
      // package describes: a later step, a revision, a re-run or a hand edit replaces an artifact the
      // package was built from, and the manifest still carries the older one's digest.
      //
      // A MOVE THAT WAS RE-CHECKED AND RE-APPROVED IS NOT A MOVE THIS CHECK REFUSES. The refusal is
      // for a LATE export — one that would replace a reading of a state the run has left behind
      // nobody re-examined — and the artifact that proves it was re-examined is the approval: an
      // approval names the artifact versions it was taken on, so one that still covers the run as it
      // stands is exactly the evidence that the move was looked at. Without this the check refused
      // the remedy it names ("re-export to describe the run as it stands"): a re-export over a moved
      // run handed back the previous package's versions, which could never come to match again, so
      // "differs from the previous export" was permanently illegal — found by the review as R06.
      code: 'artifacts-current',
      passed: facts.artifactRefs.moved.length === 0
        || (facts.approval !== undefined && facts.staleApproval === undefined),
      detail: facts.artifactRefs.read.length === 0
        ? 'this package names no artifact versions, so nothing can be said about whether they stand'
        : facts.artifactRefs.moved.length === 0
          ? `every artifact this package was read from still stands (${facts.artifactRefs.read.length})`
          : facts.approval !== undefined && facts.staleApproval === undefined
            ? `this package replaces a reading of ${facts.artifactRefs.moved.join(', ')}, which the run`
              + ' has moved past — and the approval it carries covers the run as it stands, so this'
              + ' package describes the state the decision was taken on'
            : `these artifacts moved after this package was read: ${facts.artifactRefs.moved.join(', ')}`
              + ' — re-export to describe the run as it stands',
    },
    {
      // A JOURNAL IS HANDED A DOCUMENT. The compiled `.docx` and `.pdf` are written as BYTES and so
      // are not among the manuscript's declared text files: `manuscript.md` is in the package whether
      // or not the compile succeeded, and a package carrying only the Markdown is not the submission
      // a deployment that has a compiler promised. A deployment that named none produces no document
      // and is not held to this.
      code: 'deliverables-present',
      passed: missingDeliverables.length === 0,
      detail: facts.deliverables.produced.length === 0
        ? 'this deployment compiled no document, so no deliverable is claimed'
        : missingDeliverables.length === 0
          ? `the package carries every document the compile produced (${facts.deliverables.produced.join(', ')})`
          : `the package does not carry ${missingDeliverables.join(', ')}, which this deployment's`
            + ' compile produced — a journal is handed the compiled document, not only the Markdown it'
            + ' was built from',
    },
    {
      code: 'run-saved',
      passed: facts.saveError === undefined,
      detail: facts.saveError === undefined
        ? 'the run\'s state is on disk'
        : `the run's last write did not land (${facts.saveError}): a package of state that is not on`
          + ' disk describes a study that a restart would not find',
    },
  ]
  const byCode = new Map<FinalPackageCheckCode, FinalPackageCheck>(
    [...checkManuscript(facts), ...delivery].map(check => [check.code, check]),
  )
  return FINAL_PACKAGE_CHECK_ORDER.flatMap((code) => {
    const check = byCode.get(code)
    // A CONDITION WITH NO CHECK IS A DEFECT IN THIS FILE, not a package that passes: every code is
    // either in `checkManuscript` or in `delivery`, and a missing one would leave the order quietly
    // short. Stated rather than skipped.
    if (check === undefined) throw new Error(`[final-package] no check was built for '${code}'`)
    return [check]
  })
}

/**
 * The state a package is in, given its checks.
 *
 * @param checks - what {@link checkFinalPackage} found.
 * @returns `final` only when every condition holds.
 */
export function finalPackageStateOf(checks: ReadonlyArray<FinalPackageCheck>): FinalPackageState {
  return checks.every(check => check.passed) ? 'final' : 'draft'
}

/**
 * The refusal message for a final export, or undefined when it may be written.
 *
 * @param checks - what {@link checkFinalPackage} found.
 * @returns one sentence naming the first unmet condition, or undefined.
 */
export function finalPackageRefusalOf(checks: ReadonlyArray<FinalPackageCheck>): string | undefined {
  const failed = checks.find(check => !check.passed)
  return failed === undefined ? undefined : `[final-package-refused] ${failed.code}: ${failed.detail}`
}

/** The approval as the manifest records it, from the run's own record. */
export function finalPackageApprovalOf(approval: ApprovalRecord | undefined): FinalPackageApproval | undefined {
  return approval === undefined || approval.decision !== 'approved'
    ? undefined
    : {
      operator: approval.principalId,
      decision: approval.decision,
      approvalEventId: approval.approval_event_id,
      decidedAt: approval.timestamp,
      targets: approval.targetRefs.map(ref => ({
        artifactId: ref.artifactId,
        version: ref.version,
        contentHash: ref.contentHash,
      })),
    }
}

/**
 * Read every fact the checks need off one run.
 *
 * @param store - the run store, still live at this point.
 * @param runId - the run being packaged.
 * @param profile - the deployment's evidence profile.
 * @param packagedFiles - the paths the package will carry.
 * @param saveError - the run's last write failure, when one was reported.
 * @param artifactRefs - the artifact versions this package was read from, and which have moved.
 * @returns the facts, or a reason they could not be read.
 */
export function finalPackageFactsOf(
  store: ResearchRunStore,
  runId: string,
  profile: EvidenceProfile,
  packagedFiles: ReadonlyArray<string>,
  saveError: string | undefined,
  artifactRefs: { readonly read: ReadonlyArray<string>; readonly moved: ReadonlyArray<string> },
): FinalPackageFacts {
  const snapshot = getRunSnapshot(store, runId)
  const definitions = getStepDefinitions()
  const humanGate = definitions.find(definition => definition.humanGate)
  return {
    ...manuscriptFactsOf(store, runId, profile),
    // THE ONE FACT THE MANUSCRIPT'S CONDITIONS DO NOT READ: whether a person decided. Read off the
    // registry rather than from the caller, like every other fact here.
    approval: humanGate === undefined ? undefined : snapshot.steps[humanGate.id]?.approval,
    declaredFiles: declaredPackageFilesOf(store, runId),
    packagedFiles,
    deliverables: {
      produced: compiledDeliverablesOf(store, runId),
      // WHAT THE EXPORT SAYS IT WILL WRITE, not what it has written: the checks run before the files
      // land, so the caller's own list is the fact — and it is the same list `required-files-present`
      // is given, so the two cannot disagree about what the package holds.
      carried: packagedFiles,
    },
    ...journalRulesOf(store, runId),
    artifactRefs,
    saveError,
  }
}

/**
 * The journal's requirements as the run's frozen spec carries them.
 *
 * READ FROM THE SPEC, not from an artifact: the profile is resolved once at the start of the run and
 * frozen, so a deployment reconfigured afterwards cannot change what rules this study was conducted
 * under — which is the same reason the study plan is read from there.
 *
 * @param store - the run store.
 * @param runId - the run to read.
 * @returns the record, or nothing when the run carries no profile.
 */
function journalRulesOf(
  store: ResearchRunStore,
  runId: string,
): { readonly journalRules?: NonNullable<FinalPackageFacts['journalRules']> } {
  const profile = getRunSnapshot(store, runId).spec['researchProfile'] as
    { readonly journal?: unknown } | undefined
  const journal = profile?.journal
  if (journal === null || typeof journal !== 'object') return {}
  const venue = journal as JournalProfile
  if (!Array.isArray(venue.rules)) return {}
  // THE DECISION IS TAKEN WHERE THE RULES LIVE. `checkVenueRules` is the one implementation of
  // "which findings stand between this manuscript and publication", and this read hands it the
  // profile rather than counting the rules again — see {@link FinalPackageFacts.journalRules}.
  const refusals = checkVenueRules(venue)
  const unverified = refusals.flatMap(refusal => [...refusal.unverified])
  return {
    journalRules: {
      venueName: typeof venue.name === 'string' ? venue.name : 'the target journal',
      total: venue.rules.length,
      read: venue.rules.length - unverified.length,
      unverified,
      ...(refusals[0] === undefined
        ? {}
        : { refusal: { code: refusals[0].code, detail: refusals[0].detail } }),
    },
  }
}

/**
 * Read every fact about the MANUSCRIPT off one run.
 *
 * THE ONE PLACE THESE ARE GATHERED. `submissionReadinessOf` and `checkFinalPackage` both start from
 * this, so the manifest's `submissionReady` and the final package's conditions are decided from the
 * same reads as well as by the same function.
 *
 * @param store - the run store, still live at this point.
 * @param runId - the run being read.
 * @param profile - the deployment's evidence profile.
 * @returns what the run recorded about its manuscript.
 * @throws {Error} when the store holds no such run.
 */
export function manuscriptFactsOf(
  store: ResearchRunStore,
  runId: string,
  profile: EvidenceProfile,
): ManuscriptFacts {
  const snapshot = getRunSnapshot(store, runId)
  const definitions = getStepDefinitions()
  return {
    profile,
    // THE TYPESET ARTIFACT, which is what a journal is handed: the document itself lives under
    // `manuscript`, and a run whose writing steps passed but whose formatting did not would have a
    // paper and no submission.
    manuscriptProduced: snapshot.registry['typeset'] !== undefined,
    typeset: typesetFactsOf(snapshot, readArtifact(store, runId, 'typeset')),
    unfinishedSteps: definitions
      .filter(definition => (snapshot.steps[definition.id]?.status ?? 'pending') !== 'passed')
      .map(definition => `${definition.id} (${snapshot.steps[definition.id]?.status ?? 'pending'})`),
    refusedSections: refusedSectionsOf(store, runId),
    openIssues: openIssuesOf(readArtifact(store, runId, 'rebuttal')),
    staleApproval: definitions
      .map(definition => approvalStalenessOf(store, runId, definition.id))
      .find(reason => reason !== undefined),
    compilation: compilationOf(store, runId),
    ...reviewOf(store, runId),
  }
}

/**
 * A field as a plain record, or an empty one.
 *
 * THE FIELD IS `unknown` UNTIL IT IS READ. An artifact written by an earlier version of this package,
 * or by a hand, is not the shape the writer promises — and a record that reached into it would throw
 * where a check should state what it found. Absence is an empty record: a lookup on it answers
 * undefined, which is what every reader below already treats as "not recorded".
 *
 * @param value - the field, as the artifact carries it.
 * @returns it as a record, or an empty record.
 */
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * The typeset form as the run records it, with every document checked against what carries it.
 *
 * READ FROM THE ARTIFACT, NEVER FROM THE FILESYSTEM. A `.docx` in the package directory may be the one
 * this run compiled or a copy someone put there, and the checks decide whether a package is the paper;
 * they read the run's own record of what it produced, and recompute a document's digest from the bytes
 * that record carries rather than from a file that may agree with it.
 *
 * @param snapshot - the run's snapshot, for the version the manifest holds of the document.
 * @param value - the `typeset` artifact's value, or null when the run holds none.
 * @returns the facts, all of them stating an absence rather than a value when nothing was recorded.
 */
function typesetFactsOf(snapshot: ReturnType<typeof getRunSnapshot>, value: unknown): TypesetFacts {
  const record = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
  const compilation = asRecord(record?.compilation)
  const packageFiles = asRecord(record?.packageFiles)
  const rendered = asRecord(record?.manuscriptRef)
  return {
    renderedManuscriptVersion: typeof rendered.version === 'number' ? rendered.version : undefined,
    manuscriptVersion: snapshot.registry['manuscript']?.ref.version,
    // WRITTEN ONLY BY THE REPAIR, and its absence is what makes a form E1's own execution. A number
    // is not required for the FACT — the marker's presence is the fact — so a repair that had no
    // earlier rendering to name (`materializedFrom: null`) still reports that it was a repair.
    repairedFromVersion: typeof record?.materializedAt === 'string'
      ? (typeof record.materializedFrom === 'number' ? record.materializedFrom : 0)
      : undefined,
    declaredFormats: (Array.isArray(compilation.formats) ? compilation.formats : [])
      .filter((format): format is string => typeof format === 'string'),
    documents: (Array.isArray(compilation.documents) ? compilation.documents : [])
      .flatMap((entry): TypesetDocument[] => {
        if (entry === null || typeof entry !== 'object') return []
        const { format, path, bytes, sha256, base64 } = entry as {
          readonly format?: unknown
          readonly path?: unknown
          readonly bytes?: unknown
          readonly sha256?: unknown
          readonly base64?: unknown
        }
        if (typeof path !== 'string' || path.length === 0) return []
        // WHAT THE ARTIFACT CARRIES for this document, which is its bytes when they are binary and its
        // text in `packageFiles` when they are not. The digest below is taken from THIS, so a document
        // whose content and record disagree is caught rather than reconciled.
        const text = packageFiles[path]
        const carried = typeof base64 === 'string' && base64.length > 0
          ? Buffer.from(base64, 'base64')
          : typeof text === 'string'
            ? Buffer.from(text, 'utf8')
            : undefined
        return [{
          format: typeof format === 'string' ? format : '',
          path,
          present: carried !== undefined,
          intact: carried !== undefined
            && typeof sha256 === 'string'
            && typeof bytes === 'number'
            && carried.length === bytes
            && createHash('sha256').update(carried).digest('hex') === sha256,
        }]
      }),
  }
}

/**
 * What the run's compile produced, as the manuscript artifact recorded it.
 *
 * A DEPLOYMENT THAT NAMED NO COMPILER RECORDS `tool: null`, which the check reads as "no compiled
 * document is claimed" — a different fact from a document that lost a float. Each dropped entry is
 * reported WITH the compiler's reason, because "Figure 2" is not something a reader can act on and
 * "Figure 2 (a diagram is carried as its own source…)" is.
 *
 * @param store - the run store.
 * @param runId - the run to read.
 * @returns the tool that compiled, and the floats it did not carry.
 */
function compilationOf(
  store: ResearchRunStore,
  runId: string,
): { readonly tool: string | null; readonly dropped: ReadonlyArray<string> } {
  const value = readArtifact(store, runId, 'typeset')
  if (value === null || typeof value !== 'object') return { tool: null, dropped: [] }
  const recorded = (value as { compilation?: unknown }).compilation
  if (recorded === null || typeof recorded !== 'object') return { tool: null, dropped: [] }
  const { tool, floatsDropped } = recorded as { tool?: unknown; floatsDropped?: unknown }
  return {
    tool: typeof tool === 'string' ? tool : null,
    dropped: Array.isArray(floatsDropped)
      ? floatsDropped.flatMap((entry): string[] => {
        const { label, reason } = (entry ?? {}) as { label?: unknown; reason?: unknown }
        if (typeof label !== 'string') return []
        return [`${label} (${typeof reason === 'string' ? reason : 'not embedded'})`]
      })
      : [],
  }
}

/**
 * The compiled DOCUMENTS a run produced, as paths.
 *
 * THE ASSETS ARE NOT DELIVERABLES. `compilation.compiled` names everything one compile produced,
 * including the figure a document embeds; subtracting `compilation.assets` leaves the documents
 * themselves, which are what a journal is handed. A deployment that compiled nothing records an
 * empty list and is asked for nothing.
 *
 * @param store - the run store.
 * @param runId - the run to read.
 * @returns the document paths, in the order the compile produced them.
 */
function compiledDeliverablesOf(store: ResearchRunStore, runId: string): ReadonlyArray<string> {
  const value = readArtifact(store, runId, 'typeset')
  if (value === null || typeof value !== 'object') return []
  const recorded = (value as { compilation?: unknown }).compilation
  if (recorded === null || typeof recorded !== 'object') return []
  const { compiled, assets } = recorded as { compiled?: unknown; assets?: unknown }
  if (!Array.isArray(compiled)) return []
  const assetPaths = new Set(Array.isArray(assets)
    ? assets.flatMap((entry): string[] => {
      const path = (entry as { path?: unknown } | null)?.path
      return typeof path === 'string' ? [path] : []
    })
    : [])
  return compiled.flatMap((entry): string[] => {
    if (typeof entry !== 'string') return []
    return assetPaths.has(entry) ? [] : [entry]
  })
}

/** The review state the run recorded, when its rebuttal artifact carries one. */
function reviewOf(
  store: ResearchRunStore,
  runId: string,
): { readonly review?: { readonly satisfied: boolean; readonly reason: string } } {
  const recorded = (readArtifact(store, runId, 'rebuttal') as
    { review?: { satisfied?: unknown; reason?: unknown } } | undefined)?.review
  if (recorded === undefined || typeof recorded.satisfied !== 'boolean') return {}
  // A REASON THAT IS NOT A STRING IS NOT ONE THIS CHECK MAY RENDER: `String(value)` would print
  // `[object Object]` into a refusal a reader is supposed to act on, so it is reported as the absence
  // it is. The writer is this package, so a non-string here is a defect in the artifact, not input.
  const reason = recorded.reason
  return {
    review: {
      satisfied: recorded.satisfied,
      reason: typeof reason === 'string' ? reason : 'the record states no reason',
    },
  }
}

/** The files the run's own manuscript artifact declares, in its own order. */
function declaredPackageFilesOf(store: ResearchRunStore, runId: string): ReadonlyArray<string> {
  const value = readArtifact(store, runId, 'typeset')
  if (value === null || typeof value !== 'object') return []
  const files = (value as { packageFiles?: unknown }).packageFiles
  return files !== null && typeof files === 'object' && !Array.isArray(files) ? Object.keys(files) : []
}

/** The sections the run's draft recorded as refused. */
function refusedSectionsOf(store: ResearchRunStore, runId: string): ReadonlyArray<string> {
  const value = readArtifact(store, runId, 'manuscript')
  if (value === null || typeof value !== 'object') return []
  const refused = (value as { refusedSections?: unknown }).refusedSections
  return Array.isArray(refused) ? refused.filter((id): id is string => typeof id === 'string') : []
}

/**
 * One artifact's value, or null when the run recorded none.
 *
 * `getArtifact` throws for a run this store does not hold, and a check about a run that is not there
 * is answered by its other checks — every step reads `pending` — rather than by an exception from a
 * helper. The catch is one statement and can only see that lookup.
 */
function readArtifact(store: ResearchRunStore, runId: string, slug: string): unknown {
  try {
    return getArtifact(store, runId, slug)
  } catch {
    return null
  }
}
