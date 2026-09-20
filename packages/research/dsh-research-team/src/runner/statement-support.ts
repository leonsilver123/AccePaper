// @deepseek-ai/dsh-research-team — does the evidence support THIS sentence, or only the claim it came from?
//
// WHY THIS EXISTS. `evidence-corpus.ts` holds what a reviewer read and what they concluded, and the
// conclusion is about the CLAIM: the assessment names the claim sentence verbatim, records whether the
// source supports it, and states what it does not establish. The citation layer then attached that
// verdict to whichever sentence cited the source — so a sentence nobody had read inherited a judgement
// made about a different sentence. The pipeline review of 2026-09-18 reproduced the consequence: a
// claim-level verdict is not evidence that the sentence citing the source is supported by it, and a
// sentence that states more than the claim did is exactly the case where the difference matters.
//
// WHAT A STATEMENT ASSESSMENT RECORDS. The sentence's own identity and content version, the source it
// cites, the verdict about THAT sentence, what the verdict rests on, and who made it. It is a reading
// of one sentence against one passage, so a revision of the sentence invalidates it the same way a
// revision invalidates a citation binding — the two are versioned together and for the same reason.
//
// WHO ASSESSES. A deployment supplies an assessor, the way it supplies a prose writer and a figure
// provider: whether a machine can read a passage and judge it against a sentence is a property of the
// deployment's reviewer, not of this package. A deployment that supplies none does not inherit the
// claim's verdict — it records that the sentence was not assessed, which is a different fact from a
// sentence that was assessed and found wanting.

import { citedKeysIn } from './citation-bindings.ts'
import type { CitationReadScope, CitationSupport, SourceJudgement, Statement } from './citation-bindings.ts'

/** What one sentence's citation was found to rest on, recorded against that sentence. */
export interface StatementAssessment {
  /** The sentence this is about, named the way the manuscript names it. */
  readonly statementId: string
  /**
   * THE SENTENCE'S CONTENT VERSION when it was assessed.
   *
   * The claim-level assessment records the claim it read; this records the SENTENCE it read, for the
   * same reason: a verdict about one wording establishes nothing about another, and a revision that
   * rewrites the sentence has to be re-read rather than re-stamped.
   */
  readonly statementSha256: string
  /** The source the sentence cites, by the key the manuscript prints. */
  readonly citeKey: string
  /**
   * THE EVIDENCE VERSION: SHA-256 of the passage the assessment was made on.
   *
   * A sentence and the passage read for it are two documents, and each can change without the other.
   * Binding only the sentence meant a corpus that corrected or replaced an excerpt left every
   * assessment about the old passage standing — the pipeline review of 2026-09-18 reproduced exactly
   * that: the sentence unchanged, `quoteSha256` changed, and the cache returned the old verdict.
   */
  readonly quoteSha256: string
  /**
   * WHAT MADE THE JUDGEMENT: the assessor's own id, and the version of the rules it applied.
   *
   * A verdict is only as good as the reader that reached it. An assessor that is replaced, or whose
   * policy changes, invalidates what the old one concluded — and a timestamp cannot stand in for
   * this, because two verdicts the same day are two verdicts.
   */
  readonly assessorVersion: string
  /** How the passage read stands in relation to THIS sentence. */
  readonly support: CitationSupport
  /** How much of the source was read to reach it, which bounds what the verdict can claim. */
  readonly readScope: CitationReadScope
  /** What the verdict rests on: the passage, or why no verdict could be reached. */
  readonly basis: string
  /** Who assessed it: a person, or the deployment's own reviewer. */
  readonly judgedBy: string
  /** When, ISO 8601. A verdict with no date cannot be told from one made before the source changed. */
  readonly judgedAt: string
}

/**
 * A deployment's ability to judge one sentence against one source.
 *
 * BOTH HALVES ARE READ, because a verdict about a sentence is only checkable if a reader can see what
 * it was made on: the judgement carries the passage that was read and where it was read, and the
 * assessment says how the sentence stands against it.
 */
export interface StatementSupportAssessor {
  /** What this assessor is, for the record — a model id, or the name of the rulebook behind it. */
  readonly id: string
  /**
   * The version of the rules this assessor applies, when it has any.
   *
   * A verdict is bound to the reader that reached it. An assessor whose policy changes produces a
   * different verdict for the same pair, so its old assessments are not reused — see
   * {@link assessStatements}.
   */
  readonly policyVersion?: string
  /**
   * Judge one citing sentence against the source it cites.
   *
   * @param input - the sentence (with its content version) and the judgement about the source.
   * @returns the assessment, which may be an abstention with its reason.
   */
  assess(input: {
    readonly statement: Statement
    readonly judgement: SourceJudgement
  }): Promise<StatementAssessment>
}

/** Why a sentence's citation was refused. */
export type StatementSupportRefusalCode =
  /**
   * A sentence cites a source, the deployment has an assessor, and no assessment covers it.
   *
   * THE STATE THIS MODULE EXISTS TO SEPARATE from support: the sentence was never read against the
   * evidence. It used to be indistinguishable from a supported one, because both ended up carrying the
   * claim's verdict.
   */
  | 'statement-unassessed'
  /** The passage read establishes the opposite of what the sentence states. */
  | 'statement-contradicted'
  /** The passage read does not bear on what the sentence states. */
  | 'statement-unrelated'
  /** The sentence rests on a reading that cannot establish it — an abstract for a detailed claim. */
  | 'statement-beyond-scope'
  /**
   * The sentence cites a source this run never reviewed.
   *
   * THE KEY IS NOT ON THE ROSTER, so there is no passage, no reading and no judgement to check the
   * sentence against — the citation names a work that was retrieved and never read. Distinct from
   * `statement-unassessed`, which is about a reviewed source whose sentence nobody read against it:
   * this one has no source to read.
   */
  | 'statement-source-unreviewed'

/** One refusal, naming the sentence and the source it cites. */
export interface StatementSupportRefusal {
  readonly code: StatementSupportRefusalCode
  readonly statementId: string
  readonly citeKey: string
  readonly detail: string
}

/**
 * How one sentence's citation stands, given what has been assessed about it.
 *
 * THE ITERATION IS OVER THE ROSTER, which is what bounds this check's question: it asks, for each
 * source this run reviewed, whether the sentences citing it were read against it. A sentence citing a
 * key the roster does not carry never reaches the inner loop, so it is not answered by this function
 * at all — {@link checkCitationRoster} is the other direction of the same reading.
 *
 * @param assessments - every assessment this run holds.
 * @param statements - the manuscript's cited sentences.
 * @param judgements - the judgements about the sources those sentences cite.
 * @returns one refusal per sentence-and-source pair that may not stand as support.
 */
export function checkStatementSupport(
  assessments: ReadonlyArray<StatementAssessment>,
  statements: ReadonlyArray<Statement>,
  judgements: ReadonlyArray<SourceJudgement>,
): ReadonlyArray<StatementSupportRefusal> {
  const bound = new Map(assessments.map(assessment =>
    [`${assessment.statementId} ${assessment.citeKey}`, assessment]))
  const refusals: StatementSupportRefusal[] = []
  for (const statement of statements) {
    for (const judgement of judgements) {
      if (!statement.text.includes(`[@${judgement.citeKey}]`)) continue
      const assessment = bound.get(`${statement.statementId} ${judgement.citeKey}`)
      if (assessment === undefined) {
        refusals.push({
          code: 'statement-unassessed',
          statementId: statement.statementId,
          citeKey: judgement.citeKey,
          detail: `'${statement.statementId}' cites '${judgement.citeKey}' and no assessment covers`
            + ' that sentence — what was read supports the claim it came from, which is not the same'
            + ' as supporting this sentence',
        })
        continue
      }
      if (assessment.statementSha256 !== statement.textSha256) {
        refusals.push({
          code: 'statement-unassessed',
          statementId: statement.statementId,
          citeKey: judgement.citeKey,
          detail: `'${statement.statementId}' was assessed at a version of the sentence that has since`
            + ' been rewritten, so the assessment is about text nobody read',
        })
        continue
      }
      // THE PASSAGE IS THE OTHER HALF OF THE PAIR. A corpus that corrects or replaces an excerpt
      // changes what the source says without touching the manuscript, and a verdict reached on the old
      // excerpt establishes nothing about the new one — so it is refused exactly as a rewritten
      // sentence is, and for the same reason.
      if (assessment.quoteSha256 !== judgement.quoteSha256) {
        refusals.push({
          code: 'statement-unassessed',
          statementId: statement.statementId,
          citeKey: judgement.citeKey,
          detail: `'${statement.statementId}' was assessed on a passage '${judgement.citeKey}' no`
            + ' longer holds, so the verdict rests on evidence that has changed',
        })
        continue
      }
      if (assessment.support === 'supported') continue
      // EVERY OTHER VERDICT IS REFUSED AS ITSELF, so a reader can tell "the source disagrees" from
      // "the source says something else entirely" from "nobody could read enough of it to say".
      const code: StatementSupportRefusalCode = assessment.support === 'contradicted'
        ? 'statement-contradicted'
        : assessment.support === 'unrelated' ? 'statement-unrelated' : 'statement-beyond-scope'
      refusals.push({
        code,
        statementId: statement.statementId,
        citeKey: judgement.citeKey,
        detail: `'${statement.statementId}' cites '${judgement.citeKey}', which was assessed`
          + ` '${assessment.support}': ${assessment.basis}`,
      })
    }
  }
  return refusals
}

/**
 * Every source a sentence cites that this run never reviewed, refused.
 *
 * THE HOLE THIS CLOSES WAS AN ITERATION. {@link checkStatementSupport} walks the REVIEWED SOURCES and
 * asks which sentences cite each one; `bindJudgements` builds its bindings the same way round; and
 * `checkCitationUse` judges the roster before any prose exists. A sentence citing a key outside that
 * list is examined by none of them, so the manuscript passes D3 unchanged. MEASURED ON THE
 * DEPLOYMENT, 2026-09-20 (run `418936db`): the draft's introduction cited
 * `cite-10.1007/s40534-016-0117-3` — an OpenAlex landscape hit (W2512479688) on no roster and in no
 * writer's request — and D3 accepted the manuscript. E1 refused it one step later, as
 * `citation-target-missing` and `citation-unreviewed-source`, which is a step too late to tell the
 * writer anything and reports a citation defect as a formatting step's problem.
 *
 * IT IS NOT GATED ON THE ASSESSOR, unlike the sentence reading beside it. Whether a cited source is
 * one this run reviewed is a fact about the run's own roster rather than a verdict some reader
 * reached, so a deployment that can read no sentences may still not publish a citation to a work
 * nobody read.
 *
 * THE REFUSAL NAMES THE KEY AND SAYS WHAT IS MISSING, because the sentence it belongs to is rewritten
 * with this text quoted into the instruction: "not on the roster" alone would leave the writer
 * choosing between a citation it cannot justify and no citation at all.
 *
 * @param statements - the manuscript's cited sentences.
 * @param judgements - the sources this run reviewed.
 * @returns one refusal per cited key the roster does not carry, in the order a reader meets them.
 */
export function checkCitationRoster(
  statements: ReadonlyArray<Statement>,
  judgements: ReadonlyArray<SourceJudgement>,
): ReadonlyArray<StatementSupportRefusal> {
  const reviewed = new Set(judgements.map(judgement => judgement.citeKey))
  const refusals: StatementSupportRefusal[] = []
  for (const statement of statements) {
    for (const key of citedKeysIn(statement.text)) {
      if (reviewed.has(key)) continue
      refusals.push({
        code: 'statement-source-unreviewed',
        statementId: statement.statementId,
        citeKey: key,
        detail: `'${statement.statementId}' cites '${key}', which is not one of the sources this run`
          + ' reviewed — the work was retrieved and never read, so nothing establishes what that'
          + ' citation claims and the sentence rests on no passage. Either cite one of the sources'
          + ' listed under `citations` in a sentence that states what its passage establishes, or'
          + ' state the sentence without citing any source.',
      })
    }
  }
  return refusals
}

/**
 * What an assessor is, as a version.
 *
 * The deployment's assessor states its own id; a policy version may be added where an assessor holds
 * rules that change. Both are recorded on every verdict, so a reader can tell a verdict made by a
 * replaced reader from one made by the same reader under different rules.
 *
 * @param assessor - the deployment's assessor.
 * @returns the version string recorded on its assessments.
 */
function assessorVersionOf(assessor: StatementSupportAssessor): string {
  return assessor.policyVersion === undefined || assessor.policyVersion.length === 0
    ? assessor.id
    : `${assessor.id}@${assessor.policyVersion}`
}

/**
 * The assessment a sentence needs, for every sentence that cites something.
 *
 * ONE ASSESSMENT PER PAIR, read in document order so two readings of the same manuscript produce the
 * same list. A pair that already has one is not assessed twice: the same sentence and the same source
 * is one question, and asking it again would spend a model call to get the same answer.
 *
 * @param assessor - the deployment's assessor.
 * @param statements - the manuscript's cited sentences.
 * @param judgements - the judgements about the sources those sentences cite.
 * @param existing - assessments this run already holds.
 * @returns the assessments, existing and new, in document order.
 */
export async function assessStatements(
  assessor: StatementSupportAssessor,
  statements: ReadonlyArray<Statement>,
  judgements: ReadonlyArray<SourceJudgement>,
  existing: ReadonlyArray<StatementAssessment> = [],
): Promise<ReadonlyArray<StatementAssessment>> {
  const held = new Map(existing.map(assessment => [
    `${assessment.statementId} ${assessment.citeKey}`, assessment,
  ]))
  const assessed = [...existing]
  for (const statement of statements) {
    for (const judgement of judgements) {
      if (!statement.text.includes(`[@${judgement.citeKey}]`)) continue
      const key = `${statement.statementId} ${judgement.citeKey}`
      const already = held.get(key)
      // A VERDICT ABOUT A DIFFERENT VERSION IS NOT A VERDICT ABOUT THIS ONE — and the versions are
      // three: the sentence, the passage, and the reader. Reusing on the sentence alone was measured
      // returning the old verdict after the source's excerpt changed, which is the cache asserting
      // something nobody checked. Any of the three moving means the question is new.
      if (already !== undefined
        && already.statementSha256 === statement.textSha256
        && already.quoteSha256 === judgement.quoteSha256
        && already.assessorVersion === assessorVersionOf(assessor)) continue
      assessed.push(await assessor.assess({ statement, judgement }))
    }
  }
  return assessed
}
