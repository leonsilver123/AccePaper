// @deepseek-ai/dsh-research-team — what D3 asks the writer for: one section of the manuscript.
//
// THE INSTRUCTION IS ONE PARAGRAPH IN THE SKELETON'S FIVE PARTS, and every rule in it is one the
// manuscript is judged against afterwards, stated in the terms the judgement uses: the section's job
// and its obligations come from `argument-plan.ts` (E1 refuses a section that omits one), the evidence
// rules name what `section-evidence.ts` supplied, and the citation rules name `readScope`, `access`
// and `accessNote` — the three facts `checkCitationUse` and the sentence assessor read.
//
// WHY THE ROSTER'S FIELDS ARE NAMED RATHER THAN DESCRIBED. The writer is shown the roster as request
// DATA under `citations`, and a rule stated in different words than the field it constrains is a rule
// the writer has to translate. MEASURED TWICE ON THE DEPLOYMENT: a run whose request carried a
// source's VERDICT without its passage was refused for a sentence the passage never draws; a run
// whose request carried the passage and not what the text read IS was refused because the sentence
// credited the published article with words the reviewer read in the author's preprint of it. Both
// refusals were right, and both were about material the writer had never been given.
//
// WHY THE ROSTER IS A PERMISSION AND NOT A DEBT. The instruction used to require every reviewed
// source to be cited somewhere in the manuscript, and the review of a real run on 2026-09-20 shows
// what that requirement does when a source bears on no sentence the paper needs: the writer attached
// the citation to the nearest sentence it had, and the sentence assessor refused it. Measured on that
// run, the INTRODUCTION's first cited sentence was 'The quantity at stake is the smallest
// gap-to-closing-speed ratio reached by any follower at any time over the measurement window
// [@cite-10.1109/tits.2026.3727135] ...' — the study's own metric, carrying the citation of a source
// whose passage is about the reaction-time lag, and the assessor's reason was that the passage "only
// concerns the reaction-time lag (a first-order lag) and the critical lag value above which safe CCC
// gains do not exist, saying nothing about a gap-to-closing-speed ratio". The two rules could not both
// be obeyed, and the writer obeyed the wrong one. What the roster is FOR is the other direction of the
// same check: the sources this paper may cite are the sources this run read, and no others. Being
// reviewed is not being owed a citation, so the obligation is now stated over the sources that ARE
// owed one — the ones whose claim-level judgement is `supported`, which are the evidence the paper's
// own claim rests on.

import { contractFor, obligationsInstructionOf } from '../argument-plan.ts'
import type { ArgumentPlan } from '../argument-plan.ts'
import { PROSE_JOIN, instructionOf } from './skeleton.ts'

/**
 * What may be asserted, and where it comes from.
 *
 * THE SECTION IS WRITTEN FROM THE RUN'S OWN MATERIAL and may state nothing it does not hold: a number,
 * a unit or a source that is not in `evidence` is invented, and the A gate refuses the manuscript for
 * one. What a passage establishes is bounded the same way, which is the second sentence here.
 */
const EVIDENCE_RULES = 'The evidence this section must be written from is under `evidence`: state only'
  + ' what it holds, and do not introduce a number, a unit or a source it does not contain. A sentence'
  + ' that cites a source states what that source establishes and nothing further — not a conclusion'
  + ' the passage does not itself draw, and not a generalization beyond the case it reports; when what'
  + ' you want to say is this paper\'s own claim rather than a source\'s finding, write it as the'
  + ' paper\'s claim and leave it uncited.'

/**
 * How a source is named, and what a sentence citing one may claim.
 *
 * EACH CONSTRAINTS FIELD IS NAMED WITH THE RULE IT CARRIES, because each is a fact the run holds about
 * the reading and a boundary on the sentence written from it: the passage is the text the judgement
 * was made from, `readScope` is how far the source was read, `access` is whether it could be read at
 * all, and `accessNote` is what the text read is when it is not the cited work — an author preprint of
 * the published article, most often, whose DOI is the article of record. A sentence that credits the
 * cited work with words read in a version of it states something no reading establishes.
 */
const CITATION_RULES = 'Each source listed under `citations` carries the `passage` a reviewer read'
  + ' from it, and the sentence you write for that source must be true of that passage as quoted:'
  + ' where the passage does not state what you wanted to say, write less rather than more.'
  + ' `readScope` bounds the sentence the same way — a source read `full-text` was read whole, while'
  + ' one read `abstract-only` is a source whose abstract was all that could be read, so a sentence'
  + ' resting on it may state only what an abstract reports and must not claim what only the source\'s'
  + ' method, experiment or results could establish. `access` says whether the source could be read at'
  + ' all; where it is not `read`, the source is not evidence for any sentence. `accessNote` states'
  + ' what the text you were shown is, when it is not the cited work itself: where the citation names'
  + ' a published article and the passage above was read from the author\'s preprint of it, this says'
  + ' so, and it is empty when the two are the same text. What a passage establishes is established by'
  + ' the text it was read in, so a sentence resting on that passage attributes the finding to the text'
  + ' you were shown — naming the version you read where the sentence would otherwise credit the cited'
  + ' work with words nobody read there — and where that cannot be said truthfully of the text you were'
  + ' shown, write less rather than more. When a sentence rests on a reviewed source listed under'
  + ' `citations`, name that source by writing its `citeKey` in square brackets exactly as'
  + ' `[@citeKey]`; no source outside that list may be cited. THE LIST IS WHAT THIS RUN REVIEWED, NOT'
  + ' A LIST OF CITATIONS THIS PAPER OWES: a source whose `establishes` is `supported` is evidence for'
  + ' the claim this paper argues and must be cited somewhere in this manuscript, in a sentence that'
  + ' states what its passage establishes; a source whose `establishes` is anything else is prior work'
  + ' this paper MAY cite where a sentence of yours states what its passage establishes, and it is not'
  + ' one this paper owes a citation to — where no sentence of the manuscript can say truthfully what'
  + ' that passage establishes, leave that source uncited rather than attach it to a sentence it does'
  + ' not support.'

/**
 * What the reading of a previous version found, stated as the writer's own reason to write again.
 *
 * THE REFUSAL IS QUOTED, NOT SUMMARISED. Every reason below is the sentence a reader wrote when it
 * refused this text, carried verbatim: a writer told the refusal in different words is being judged
 * by rules it was never shown, and the two readings then disagree about the same manuscript forever.
 *
 * @param input - the refusals this section's sentences drew, and the sources no sentence cited.
 * @returns the revision part of a rewrite instruction, or an empty string when there is nothing to fix.
 */
export function sectionRevisionOf(input: {
  readonly refusals: ReadonlyArray<{ readonly detail: string }>
  readonly uncited: ReadonlyArray<string>
}): string {
  const found: string[] = input.refusals.map(refusal => `- ${refusal.detail}`)
  if (input.uncited.length > 0) {
    found.push(
      `- no sentence in the manuscript cites ${input.uncited.map(key => `'${key}'`).join(', ')},`
      + ' which this paper is obliged to cite because its passage is evidence for the claim.',
    )
  }
  if (found.length === 0) return ''
  return 'The version of this section you are replacing was read, and this is what that reading found:'
    + `\n${found.join('\n')}`
    + '\nWrite the section again so that every sentence of it is true of the passage its citation was'
    + ' read from. Where a refused citation cannot be stated truthfully from its passage, either move'
    + ' it to a sentence of this section that the passage does establish, or remove it — a source this'
    + ' paper is obliged to cite must still be cited somewhere in the manuscript, and a source it is'
    + ' not obliged to cite may be left uncited. Return the complete replacement body for the section.'
}

/**
 * The instruction one section of the manuscript is written under.
 *
 * THE JOB IS THE SECTION'S DECLARED JOB and the obligations are read from the PLAN, which is not an
 * inconsistency: what a section of this id is FOR is one fact about the outline, while the
 * obligations are what THIS run owes — a refutation attaches three more to the sections that report
 * the outcome, and a writer that is not told it owes "the measurement CONTRADICTS the claim" writes
 * the finding it hoped for, which E1 then refuses.
 *
 * @param input - the section about to be written, its heading, and the plan it is written under.
 * @returns the instruction.
 */
export function sectionInstruction(input: {
  readonly heading: string
  readonly claimRef: string
  readonly plan: ArgumentPlan
  readonly sectionId: string
}): string {
  return instructionOf({
    task: `Write the "${input.heading}" section of a research paper. Its job in this paper's argument`
      + ` is: ${contractFor(input.sectionId)?.job ?? 'undefined'}.`,
    contract: obligationsInstructionOf(input.plan, input.sectionId),
    output: `Refer to the central claim as ${input.claimRef}. Return prose only — no heading, no`
      + ' commentary. The numbered items this paper may refer to are listed in the context under'
      + ' `citable`; refer to one by its exact label when the section is about it.',
    evidence: EVIDENCE_RULES,
    citations: CITATION_RULES,
  }, PROSE_JOIN)
}

/**
 * The instruction one section of the manuscript is written under, when a reading refused its last one.
 *
 * THE DIFFERENCE IS THE REVISION PART AND NOTHING ELSE: the task, the obligations, the format, the
 * evidence rules and the citation rules are the same text the first round was written under, so a
 * rewrite is the same request answered again with what the last answer got wrong. A rewrite composed
 * from a second, weaker set of rules would let a run converge by being judged differently — which is
 * the one thing this pipeline may not do.
 *
 * @param input - the section, and what the reading of the version being replaced found.
 * @returns the instruction.
 */
export function revisionInstruction(input: {
  readonly heading: string
  readonly claimRef: string
  readonly plan: ArgumentPlan
  readonly sectionId: string
  readonly refusals: ReadonlyArray<{ readonly detail: string }>
  readonly uncited: ReadonlyArray<string>
}): string {
  return instructionOf({
    task: `Rewrite the "${input.heading}" section of a research paper. Its job in this paper's`
      + ` argument is: ${contractFor(input.sectionId)?.job ?? 'undefined'}.`,
    contract: obligationsInstructionOf(input.plan, input.sectionId),
    revision: sectionRevisionOf({ refusals: input.refusals, uncited: input.uncited }),
    output: `Refer to the central claim as ${input.claimRef}. Return the complete replacement body for`
      + ' this section, prose only — no heading, no commentary. The numbered items this paper may'
      + ' refer to are listed in the context under `citable`; refer to one by its exact label when the'
      + ' section is about it.',
    evidence: EVIDENCE_RULES,
    citations: CITATION_RULES,
  }, PROSE_JOIN)
}
