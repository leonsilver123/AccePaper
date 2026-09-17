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
      // A VERDICT ABOUT A DIFFERENT VERSION IS NOT A VERDICT ABOUT THIS ONE. It is re-assessed rather
      // than carried, which is the whole difference this module makes.
      if (already !== undefined && already.statementSha256 === statement.textSha256) continue
      assessed.push(await assessor.assess({ statement, judgement }))
    }
  }
  return assessed
}
