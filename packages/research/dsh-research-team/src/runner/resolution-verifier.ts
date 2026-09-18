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
// (`open`, with the verifier's reason recorded).
//
// WHAT INDEPENDENCE IS, AND IS NOT. An earlier version of this file compared the verifier's identity
// with the author's, both spelled `<provider>/<model>`, and refused a verification from the same
// route — so a single-model deployment could not verify anything, and a deployment with two models
// looked independent while sharing one session and one role instruction. The user's ruling of
// 2026-09-18: a different model may not substitute for the conditions below, and the same model must
// not be refused for being the same model. What is required is:
//
//   ROLE          the author and the verifier are different restricted role tasks;
//   EXECUTION     `authorExecutionId` and `verifierExecutionId` differ, and the HOST mints both —
//                 a verifier that names itself can forge one, so its verdict carries no identity at
//                 all and the record below is built here, from what the host knows;
//   SESSION       they ran in different sessions, so the verifier does not continue the author's own
//                 defence of the revision;
//   INSTRUCTIONS  the verifier has its own rules and its own version of them, recorded;
//   INPUT         the issue as raised, the change, the body as it now stands, and the evidence — a
//                 verifier that read none of it cannot close anything, and must abstain instead;
//   PERMISSION    a verifier cannot edit the paper, and an author cannot close an issue: this file's
//                 types are the enforcement — a verdict carries no revision, and the only act that
//                 disposes of an issue is the settlement below;
//   TARGET        the verification is bound to the versions it read, and a report about a body that
//                 has since moved is refused rather than applied to the new one;
//   CALL          the execution ids are the host's, so the calls can be reconstructed from its log.
//
// MODEL DIVERSITY IS RECORDED, NOT REQUIRED. Whether the two executions shared a provider and model
// is a fact a reader needs — a shared route is a shared-bias risk — and it is a note on the record,
// never a refusal.

import { createHash } from 'node:crypto'

import type { IssueDisposition, IssueOutcome, RevisionIssue, SectionChange } from './issue-patch.ts'

/** The restricted role one model execution occupied. */
export type ModelRole = 'prose-author' | 'revision-verifier'

/**
 * One model execution, as the host that started it identifies it.
 *
 * THE IDS ARE THE HOST'S. Nothing a model returns can name its own execution: a verifier that could
 * would pass any check written against a self-reported id, which is why `ResolutionVerdict` carries
 * none. `sessionId` is what makes the call reconstructable — the session log holds what the model was
 * actually asked, under which instructions.
 */
export interface ExecutionIdentity {
  /** Unique per model task, minted by the host when it starts one. */
  readonly executionId: string
  /** The session the execution ran in; different roles never share one. */
  readonly sessionId: string
  readonly role: ModelRole
  /** The version of the instructions this role was given. */
  readonly instructionsVersion: string
  /** The route that served it, recorded for the diversity note rather than for a decision. */
  readonly provider: string
  /** Absent for a human reader, which has no model to share. */
  readonly model?: string
}

/** One body as the verifier read it, so a report can be bound to the version it is about. */
export interface TargetRef {
  readonly sectionId: string
  /** SHA-256 of the section body the verifier was shown. */
  readonly contentHash: string
}

/** What one reader decided about one pending issue, and what it read to decide it. */
export interface ResolutionVerification {
  readonly issueId: string
  /**
   * `verified` answers the issue; `rejected` sends it back, still owed an answer; `abstained` says the
   * reader could not decide — most often because the evidence it needed was not there, and an
   * abstention leaves the issue where it was rather than closing it on a guess.
   */
  readonly verdict: 'verified' | 'rejected' | 'abstained'
  /** What the decision rests on: the change that was made, or why no decision could be reached. */
  readonly basis: string
  /** What the reader actually read — the concern, the diff, the evidence passages. Never empty for a
   *  `verified` or `rejected`: closing an issue on nothing read is the failure this refuses. */
  readonly evidenceRead: ReadonlyArray<string>
  /** The bodies that were in front of the reader, so a later move invalidates this report. */
  readonly targetRefs: ReadonlyArray<TargetRef>
  /** The execution that produced this — the host's, never the reader's. */
  readonly verifierExecutionId: string
  readonly verifierSessionId: string
  /** The rules the reader was given, as a version. */
  readonly verifierInstructionsVersion: string
  readonly verifierRoute: { readonly provider: string; readonly model?: string }
  /** Whether the reader shared the author's route. Recorded; never a refusal. */
  readonly sharesAuthorRoute: boolean
  /** When the host recorded it, ISO 8601. */
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
  /** The restricted role it occupies. A verifier that claims the author's role is refused. */
  readonly role: ModelRole
  /** The version of the rules it applies, recorded on every verification it produces. */
  readonly instructionsVersion: string
  /**
   * What serves this verifier, so the record can say whether it shared the author's model.
   *
   * `model` IS ABSENT FOR A PERSON, and that is not a gap: a human reader has no model to share, so
   * `sharesAuthorRoute` is false for it by construction rather than by a value somebody typed.
   */
  readonly route: { readonly provider: string; readonly model?: string }
  /**
   * Decide whether a pending issue is answered, and say what was read.
   *
   * @param input - the issue, the change it produced, and the section body as it now stands.
   * @returns the verdict, its basis, and what the reader read.
   */
  verify(input: {
    readonly issue: RevisionIssue
    readonly change?: SectionChange
    readonly revisedBody?: string
  }): Promise<ResolutionVerdict>
}

/** What a verifier returns. NO IDENTITY: the host attaches who ran it — see {@link ExecutionIdentity}. */
export interface ResolutionVerdict {
  readonly verdict: 'verified' | 'rejected' | 'abstained'
  readonly basis: string
  /** What it read. A `verified` or `rejected` with nothing read is refused. */
  readonly evidenceRead: ReadonlyArray<string>
}

/** Why a verification could not be accepted. */
export type VerificationRefusalCode =
  /** The verification was produced by the same execution that wrote the answer. */
  | 'verification-same-execution'
  /** The verifier occupied the author's role, so the acts are not distinct. */
  | 'verification-wrong-role'
  /** The verifier and the author ran in one session, so the revision's defence carried over. */
  | 'verification-same-session'
  /** A decision was reached without reading anything. */
  | 'verification-no-evidence'
  /** The verification is about a version of the manuscript the run no longer holds. */
  | 'verification-stale'
  /** The verification names an issue this round did not leave pending. */
  | 'verification-unknown-issue'

/** One refusal, naming the issue and the reason. */
export interface VerificationRefusal {
  readonly code: VerificationRefusalCode
  readonly issueId: string
  readonly detail: string
}

/** What {@link verifyResolution} answers with. */
export interface ResolutionSettlement {
  readonly outcomes: ReadonlyArray<IssueOutcome>
  readonly refusals: ReadonlyArray<VerificationRefusal>
  /** The refusals that are defects in the deployment rather than in one reading. */
  readonly fatal: ReadonlyArray<VerificationRefusal>
}

/** The codes that mean "this deployment's review is not what it claims", not "this reading failed". */
const FATAL_CODES: ReadonlyArray<VerificationRefusalCode> = [
  'verification-same-execution', 'verification-wrong-role', 'verification-same-session',
]

/** Whether the code is a defect in the deployment rather than in one reading. */
function isFatal(code: VerificationRefusalCode): boolean {
  return FATAL_CODES.includes(code)
}

/**
 * Apply one round of verifications to the outcomes a revision produced.
 *
 * EVERY CONDITION IS CHECKED BEFORE A SINGLE DISPOSITION MOVES, and a refused verification leaves its
 * issue exactly where it was: an issue is closed by a reading that happened, not by one that was
 * offered.
 *
 * @param outcomes - what the revision did to each issue.
 * @param verifications - what the reader decided about the pending ones, with the host's identities.
 * @param author - the execution that wrote the answers.
 * @param currentBodies - the section bodies as they now stand, so a stale report is refused.
 * @returns the outcomes as they now stand, and every verification that could not be accepted.
 */
export function verifyResolution(
  outcomes: ReadonlyArray<IssueOutcome>,
  verifications: ReadonlyArray<ResolutionVerification>,
  author: ExecutionIdentity,
  currentBodies: ReadonlyMap<string, string>,
): ResolutionSettlement {
  const pending = new Set(outcomes
    .filter(outcome => outcome.disposition === 'pending-verification')
    .map(outcome => outcome.issueId))
  const byIssue = new Map<string, ResolutionVerification>()
  const refusals: VerificationRefusal[] = []
  for (const verification of verifications) {
    const refuse = (code: VerificationRefusalCode, detail: string): void => {
      refusals.push({ code, issueId: verification.issueId, detail })
    }
    if (!pending.has(verification.issueId)) {
      refuse('verification-unknown-issue',
        `'${verification.issueId}' is not awaiting verification, so this reading is about something`
        + ' no revision left open')
      continue
    }
    // THE HOST'S IDS, COMPARED AS THEY ARE. A verifier that renamed itself keeps its execution id and
    // is still refused; one that forged an id never had the chance, because it cannot state one.
    if (verification.verifierExecutionId === author.executionId) {
      refuse('verification-same-execution',
        `'${verification.issueId}' was verified by execution '${verification.verifierExecutionId}',`
        + ' which is the execution that wrote the answer — an answer cannot certify itself, whatever'
        + ' it is called')
      continue
    }
    if (verification.verifierSessionId === author.sessionId) {
      refuse('verification-same-session',
        `'${verification.issueId}' was verified inside the author\'s own session`
        + ` ('${author.sessionId}'), so the reading continued the revision's defence instead of`
        + ' standing apart from it')
      continue
    }
    // A DIFFERENT ROLE IS A DIFFERENT SET OF PERMITTED ACTS, not a different display name: the author
    // proposes text, the verifier disposes of issues, and neither may do the other's work.
    if (verification.verifierInstructionsVersion.trim() === author.instructionsVersion.trim()) {
      refuse('verification-wrong-role',
        `'${verification.issueId}' was verified under the author's instructions`
        + ` ('${author.instructionsVersion}'), so the verifier was given the same task the author was`)
      continue
    }
    // A DECISION REACHED ON NOTHING READ IS NOT A DECISION. An abstention is how a reader says it
    // could not get what it needed; anything else with an empty reading list is refused rather than
    // allowed to close an issue.
    if (verification.verdict !== 'abstained' && verification.evidenceRead.length === 0) {
      refuse('verification-no-evidence',
        `'${verification.issueId}' was decided '${verification.verdict}' without reading anything — a`
        + ' reader that could not read what the decision needs must abstain, and the issue stay owed')
      continue
    }
    // THE REPORT IS ABOUT A VERSION. A body that has moved since makes the reading a report on
    // something the run no longer holds, so it is refused rather than applied to the new one.
    // THE BODIES ARRIVE AS TEXT AND THE REFS ARE HASHES, so the comparison hashes the body it holds.
    // Comparing the two directly would call every section moved — which is what this did first, and
    // what the spec caught: a refusal that fires on every reading is a refusal nobody can distinguish
    // from a rule that never passes.
    const moved = verification.targetRefs.find(ref =>
      currentBodies.has(ref.sectionId)
      && sha256(currentBodies.get(ref.sectionId) ?? '') !== ref.contentHash)
    if (moved !== undefined) {
      refuse('verification-stale',
        `'${verification.issueId}' was verified against '${moved.sectionId}' as it stood at`
        + ` ${moved.contentHash.slice(0, 12)}…, which is not the body the run holds — re-read it`)
      continue
    }
    byIssue.set(verification.issueId, verification)
  }
  const settled: IssueOutcome[] = outcomes.map((outcome) => {
    const verification = byIssue.get(outcome.issueId)
    if (verification === undefined) return outcome
    // AN ABSTENTION LEAVES THE ISSUE WHERE IT WAS. It is not an answer and it is not a refusal of one:
    // the reader could not get what it needed, so the debt stands and a reader can see why.
    if (verification.verdict === 'abstained') {
      return {
        issueId: outcome.issueId,
        sectionId: outcome.sectionId,
        disposition: outcome.disposition,
        reason: `${outcome.reason}; '${verification.verifierExecutionId}' abstained: ${verification.basis}`,
      }
    }
    const disposition: IssueDisposition = verification.verdict === 'verified' ? 'answered' : 'open'
    return {
      issueId: outcome.issueId,
      sectionId: outcome.sectionId,
      disposition,
      reason: verification.verdict === 'verified'
        ? `verified by execution '${verification.verifierExecutionId}': ${verification.basis}`
        : `sent back by execution '${verification.verifierExecutionId}': ${verification.basis}`,
    }
  })
  return { outcomes: settled, refusals, fatal: refusals.filter(refusal => isFatal(refusal.code)) }
}

/**
 * Ask a verifier about every issue a revision left pending, and build the records.
 *
 * ONE READING PER PENDING ISSUE, in the order the revision produced them, so two readings of the same
 * revision produce the same list. THE HOST BUILDS EACH RECORD: the execution identity, the session,
 * the rules version, the target hashes and the timestamp are all facts this side knows, and a
 * verifier that supplied them could certify anything.
 *
 * @param outcomes - what the revision did.
 * @param verifier - the deployment's verifier.
 * @param input - the issues as raised, the changed bodies, and the host's identity for this round.
 * @returns the verifications, in the order the issues were left pending.
 */
export async function verifyPending(
  outcomes: ReadonlyArray<IssueOutcome>,
  verifier: ResolutionVerifier,
  input: {
    readonly issues: ReadonlyArray<RevisionIssue>
    readonly changes: ReadonlyArray<SectionChange>
    readonly revisedBodies: ReadonlyMap<string, string>
    /** The execution the host started for this round's reading, for every issue it settles. */
    readonly identity: ExecutionIdentity
    /** The execution that wrote the answers, so the diversity note can be recorded. */
    readonly author: ExecutionIdentity
    /** The host's clock, so a spec can pin it. */
    readonly now: () => string
  },
): Promise<{ readonly verifications: ReadonlyArray<ResolutionVerification>; readonly fatal: VerificationRefusal[] }> {
  const issueOf = new Map(input.issues.map(issue => [issue.issueId, issue]))
  const changeOf = new Map(input.changes.map(change => [change.sectionId, change]))
  const verifications: ResolutionVerification[] = []
  const fatal: VerificationRefusal[] = []
  // THE ROLE COMES FIRST, BEFORE ANYTHING IS ASKED. A verifier configured into the author's role, or
  // into the author's session, is a misconfiguration of the deployment — not a reading that went
  // wrong — so it is reported once and nothing is sent.
  if (verifier.role !== 'revision-verifier') {
    fatal.push({
      code: 'verification-wrong-role',
      issueId: input.issues[0]?.issueId ?? 'none',
      detail: `the configured verifier occupies the '${verifier.role}' role, so its verdicts would be`
        + " the author's work under another name",
    })
    return { verifications: [], fatal }
  }
  // THE THREE WAYS THE HOST CAN HAND THE VERIFIER THE AUTHOR'S OWN TASK, each refused as itself so a
  // reader can tell one execution from one session from one rulebook. A role check that reported all
  // three as "not independent" would send the operator to the wrong configuration.
  const conflated = input.identity.executionId === input.author.executionId
    ? {
      code: 'verification-same-execution' as const,
      detail: `the host started the reading as execution '${input.identity.executionId}', which is the`
        + ' execution that wrote the answers — an answer cannot certify itself, whatever the reader is'
        + ' called',
    }
    : input.identity.sessionId === input.author.sessionId
      ? {
        code: 'verification-same-session' as const,
        detail: "the host ran the reading inside the author's own session"
          + ` ('${input.author.sessionId}'), so it continued the revision's defence instead of standing`
          + ' apart from it',
      }
      : verifier.instructionsVersion.trim() === input.author.instructionsVersion.trim()
        ? {
          code: 'verification-wrong-role' as const,
          detail: `the verifier applies the author's own rules ('${verifier.instructionsVersion}'),`
            + ' so the two roles are one task performed twice',
        }
        : undefined
  if (conflated !== undefined) {
    fatal.push({ ...conflated, issueId: input.issues[0]?.issueId ?? 'none' })
    return { verifications: [], fatal }
  }
  for (const outcome of outcomes) {
    if (outcome.disposition !== 'pending-verification') continue
    const issue = issueOf.get(outcome.issueId)
    if (issue === undefined) continue
    const change = changeOf.get(issue.sectionId)
    const verdict = await verifier.verify({
      issue,
      ...(change === undefined ? {} : { change }),
      ...(input.revisedBodies.has(issue.sectionId)
        ? { revisedBody: input.revisedBodies.get(issue.sectionId) ?? '' }
        : {}),
    })
    const body = input.revisedBodies.get(issue.sectionId)
    verifications.push({
      issueId: outcome.issueId,
      verdict: verdict.verdict,
      basis: verdict.basis,
      evidenceRead: verdict.evidenceRead,
      // THE HOST'S OWN HASHES OF WHAT IT HANDED OVER, not a version the reader reported.
      targetRefs: body === undefined
        ? []
        : [{ sectionId: issue.sectionId, contentHash: sha256(body) }],
      verifierExecutionId: input.identity.executionId,
      verifierSessionId: input.identity.sessionId,
      verifierInstructionsVersion: verifier.instructionsVersion,
      verifierRoute: {
        provider: input.identity.provider,
        ...input.identity.model === undefined ? {} : { model: input.identity.model },
      },
      // A SHARED ROUTE IS A RISK NOTE, NEVER A REFUSAL — and a person shares nothing, because there
      // is no model behind it to be the same one.
      sharesAuthorRoute: input.identity.model !== undefined
        && input.identity.provider === input.author.provider
        && input.identity.model === input.author.model,
      verifiedAt: input.now(),
    })
  }
  return { verifications, fatal }
}

/**
 * SHA-256 of a section body, as the target refs record it.
 *
 * @param text - the body.
 * @returns the hex digest.
 */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
