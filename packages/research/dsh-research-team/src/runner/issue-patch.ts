// @deepseek-ai/dsh-research-team — D4's Issue → Patch → Verify logic.
//
// THE DEFECT THIS EXISTS TO CLOSE. `D4-rebuttal` mapped every section to
// `{ ...section, revised: record.hasRevisions }`. One concern that said it required a revision
// therefore marked EVERY section revised while no body changed anywhere: the artifact claimed a
// revision it had not made, and the manuscript it handed on was byte-identical to the draft. An
// offline probe compared the two drafts and measured `unchangedBodies: true, revisedFlags:
// [true, true]`.
//
// WHAT A REVISION IS HERE. An ISSUE names one section and the concern about it. A PATCH is a
// replacement body for that section, written against the body the author was shown — the version it
// applies to, carried as a hash. The result is a DIFF or it is nothing:
//
//   - a patch whose basis hash is not the section's current body was written against something
//     else, and applying it would silently discard whatever happened in between → the issue stays
//     OPEN with the conflict named;
//   - a patch that reproduces the body it was written against has no diff and closes nothing →
//     OPEN;
//   - an issue that requires a text change and proposes no patch → OPEN, whatever it says;
//   - an issue the author answers without changing the text is ACCEPTED_EXPLANATION, recorded
//     separately, because that is a different outcome from a patch and a reader has to be able to
//     tell them apart.
//
// `revised` is therefore a property of a SECTION THAT CHANGED, derived from the bodies and never
// asserted. A round in which nothing changed marks nothing revised, and says so.
//
// WHAT IT IS NOT. A judge of whether the revision is good. It checks that a change happened and
// that it happened to the version the patch was written for; whether the new text answers the
// concern is what the A gate and a person are for.

import { createHash } from 'node:crypto'

/** One reviewer concern, with the section it is about and the change the author proposes. */
export interface RevisionIssue {
  readonly issueId: string
  /** The outline section this concern is about. */
  readonly sectionId: string
  readonly concern: string
  /** The author's answer, stored as written. */
  readonly response: string
  /** Whether the answer commits the author to a change in the manuscript. */
  readonly requiresTextChange: boolean
  /** The replacement body the author proposes, when the answer changes the text. */
  readonly patch?: string | undefined
  /**
   * The section body this patch was written against.
   *
   * Computed by the caller from what the writer was shown, never taken from the writer: a patch
   * that declared its own basis could claim to apply to anything.
   */
  readonly basisHash: string
}

/** How one issue ended. */
export type IssueDisposition = 'patched' | 'accepted_explanation' | 'open'

/** What became of one issue, and why. */
export interface IssueOutcome {
  readonly issueId: string
  readonly sectionId: string
  readonly disposition: IssueDisposition
  /** The reason, so an `open` issue says what would close it. */
  readonly reason: string
}

/** One section's before and after, so a reader can see the change rather than a flag. */
export interface SectionChange {
  readonly sectionId: string
  /** The body hash the patch was written against. */
  readonly basisHash: string
  /** The body hash that resulted. Equal to `basisHash` means no diff. */
  readonly resultHash: string
  readonly changed: boolean
}

/** The whole applied revision. */
export interface AppliedRevision {
  readonly sections: ReadonlyArray<{ readonly id: string; readonly heading: string; readonly bodyText: string; readonly revised: boolean }>
  readonly outcomes: ReadonlyArray<IssueOutcome>
  readonly changes: ReadonlyArray<SectionChange>
  /** Sections whose body actually changed (derived, never asserted by a caller). */
  readonly patchedSections: ReadonlyArray<string>
  /** Issues left open (derived). */
  readonly openIssues: ReadonlyArray<string>
}

/**
 * A digest over a section body: the version a patch applies to.
 *
 * @param body - the section body.
 * @returns its SHA-256, hex.
 */
export function bodyHashOf(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex')
}

/**
 * Apply one round of issues to a draft, producing the revised sections and what became of each
 * issue.
 *
 * The sections are returned in their original order with their original ids and headings. A section
 * nothing patched is returned unchanged and `revised: false`; a section a patch changed is returned
 * with the new body and `revised: true`. Two issues patching the same section is a conflict rather
 * than a merge: the second is written against a body that no longer exists, and applying it would
 * discard the first. It stays open, which is the recovery — the next round sees the new body and
 * can patch against it.
 *
 * @param sections - the draft's sections, in order.
 * @param issues - one round of issues, each already bound to a section and a basis hash.
 * @returns the revised sections, the per-issue outcomes and the per-section changes.
 */
export function applyRevision(
  sections: ReadonlyArray<{ readonly id: string; readonly heading: string; readonly bodyText: string }>,
  issues: ReadonlyArray<RevisionIssue>,
): AppliedRevision {
  const bodies = new Map<string, string>(sections.map(section => [section.id, section.bodyText]))
  const outcomes: IssueOutcome[] = []
  const changes: SectionChange[] = []
  const patched = new Set<string>()

  for (const issue of issues) {
    const current = bodies.get(issue.sectionId)
    if (current === undefined) {
      outcomes.push({
        issueId: issue.issueId,
        sectionId: issue.sectionId,
        disposition: 'open',
        reason: `the draft has no section '${issue.sectionId}', so there is nothing to revise`,
      })
      continue
    }
    if (!issue.requiresTextChange) {
      outcomes.push(
        issue.response.trim() === ''
          ? {
            issueId: issue.issueId,
            sectionId: issue.sectionId,
            disposition: 'open',
            reason: 'the issue requires no text change and carries no answer that would accept it',
          }
          : {
            issueId: issue.issueId,
            sectionId: issue.sectionId,
            disposition: 'accepted_explanation',
            reason: 'answered without a text change; recorded as an explanation, not as a patch',
          },
      )
      continue
    }
    if (issue.patch === undefined) {
      outcomes.push({
        issueId: issue.issueId,
        sectionId: issue.sectionId,
        disposition: 'open',
        reason: 'the issue requires a text change and proposes no replacement body',
      })
      continue
    }
    const currentHash = bodyHashOf(current)
    if (issue.basisHash !== currentHash) {
      outcomes.push({
        issueId: issue.issueId,
        sectionId: issue.sectionId,
        disposition: 'open',
        reason:
          `the patch was written against a different version of '${issue.sectionId}' `
          + `(basis ${issue.basisHash.slice(0, 12)}…, current ${currentHash.slice(0, 12)}…) — `
          + 'applying it would discard whatever changed in between, so it is not applied',
      })
      continue
    }
    const patchHash = bodyHashOf(issue.patch)
    if (patchHash === currentHash) {
      outcomes.push({
        issueId: issue.issueId,
        sectionId: issue.sectionId,
        disposition: 'open',
        reason:
          'the proposed body is the body it was written against, so the revision proposes no diff '
          + 'and closes nothing',
      })
      continue
    }
    bodies.set(issue.sectionId, issue.patch)
    patched.add(issue.sectionId)
    changes.push({ sectionId: issue.sectionId, basisHash: currentHash, resultHash: patchHash, changed: true })
    outcomes.push({
      issueId: issue.issueId,
      sectionId: issue.sectionId,
      disposition: 'patched',
      reason: `replaced the body of '${issue.sectionId}' (${currentHash.slice(0, 12)}… → ${patchHash.slice(0, 12)}…)`,
    })
  }

  const revisedSections = sections.map(section => ({
    id: section.id,
    heading: section.heading,
    bodyText: bodies.get(section.id) ?? section.bodyText,
    // A property of THIS section, derived from whether its own body changed. The artifact used to
    // carry one flag copied onto every section, which is a claim about a revision that no body
    // supports.
    revised: patched.has(section.id),
  }))
  return {
    sections: revisedSections,
    outcomes,
    changes,
    patchedSections: [...patched],
    openIssues: outcomes.filter(outcome => outcome.disposition === 'open').map(outcome => outcome.issueId),
  }
}
