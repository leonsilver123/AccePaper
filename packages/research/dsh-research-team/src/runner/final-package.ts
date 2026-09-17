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

import { approvalStalenessOf, getArtifact, getRunSnapshot, getStepDefinitions } from '@deepseek-ai/dsh-research-core'
import type { ApprovalRecord, EvidenceProfile, ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { openIssuesOf } from './submission-readiness.ts'
import type { OpenIssue } from './submission-readiness.ts'

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

/** Everything the checks read, gathered from the run rather than asserted by a caller. */
export interface FinalPackageFacts {
  readonly profile: EvidenceProfile
  readonly manuscriptProduced: boolean
  /** Steps that have not reached `passed`, as `id (status)`. */
  readonly unfinishedSteps: ReadonlyArray<string>
  readonly refusedSections: ReadonlyArray<string>
  readonly openIssues: ReadonlyArray<OpenIssue>
  /** The approval on the human gate, when one was made. */
  readonly approval: ApprovalRecord | undefined
  /** The first artifact that moved after an approved decision, when one did. */
  readonly staleApproval: string | undefined
  /** Files the run's own manuscript declares, and which of them the package will carry. */
  readonly declaredFiles: ReadonlyArray<string>
  readonly packagedFiles: ReadonlyArray<string>
  /** The run's last write to its snapshot, when it failed. */
  readonly saveError: string | undefined
}

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
  const checks: FinalPackageCheck[] = [
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
          + ' the evidence that section is written from, and the pipeline refused to fill it in',
    },
    {
      code: 'no-open-issues',
      passed: facts.openIssues.length === 0,
      detail: facts.openIssues.length === 0
        ? 'no revision round left a concern open'
        : `the revision left ${facts.openIssues.map(issue => `${issue.issueId} on '${issue.sectionId}'`).join('; ')} open`,
    },
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
      code: 'approval-current',
      passed: facts.staleApproval === undefined,
      detail: facts.staleApproval === undefined
        ? 'the approval still covers the artifacts the run holds'
        : `the approval is about another version: ${facts.staleApproval}`,
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
      code: 'run-saved',
      passed: facts.saveError === undefined,
      detail: facts.saveError === undefined
        ? 'the run\'s state is on disk'
        : `the run's last write did not land (${facts.saveError}): a package of state that is not on`
          + ' disk describes a study that a restart would not find',
    },
  ]
  return checks
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
 * @returns the facts, or a reason they could not be read.
 */
export function finalPackageFactsOf(
  store: ResearchRunStore,
  runId: string,
  profile: EvidenceProfile,
  packagedFiles: ReadonlyArray<string>,
  saveError: string | undefined,
): FinalPackageFacts {
  const snapshot = getRunSnapshot(store, runId)
  const definitions = getStepDefinitions()
  const humanGate = definitions.find(definition => definition.humanGate)
  const manuscript = snapshot.registry['formatted-manuscript']
  const declared = declaredPackageFilesOf(store, runId)
  return {
    profile,
    manuscriptProduced: manuscript !== undefined,
    unfinishedSteps: definitions
      .filter(definition => (snapshot.steps[definition.id]?.status ?? 'pending') !== 'passed')
      .map(definition => `${definition.id} (${snapshot.steps[definition.id]?.status ?? 'pending'})`),
    refusedSections: refusedSectionsOf(store, runId),
    openIssues: openIssuesOf(readArtifact(store, runId, 'rebuttal')),
    approval: humanGate === undefined ? undefined : snapshot.steps[humanGate.id]?.approval,
    staleApproval: definitions
      .map(definition => approvalStalenessOf(store, runId, definition.id))
      .find(reason => reason !== undefined),
    declaredFiles: declared,
    packagedFiles,
    saveError,
  }
}

/** The files the run's own manuscript artifact declares, in its own order. */
function declaredPackageFilesOf(store: ResearchRunStore, runId: string): ReadonlyArray<string> {
  const value = readArtifact(store, runId, 'formatted-manuscript')
  if (value === null || typeof value !== 'object') return []
  const files = (value as { packageFiles?: unknown }).packageFiles
  return files !== null && typeof files === 'object' && !Array.isArray(files) ? Object.keys(files) : []
}

/** The sections the run's draft recorded as refused. */
function refusedSectionsOf(store: ResearchRunStore, runId: string): ReadonlyArray<string> {
  const value = readArtifact(store, runId, 'draft')
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
