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
  + ' `[@citeKey]`; every source listed there and no other may be cited, and every one of them must be'
  + ' cited somewhere in this manuscript.'

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
