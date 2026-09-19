// @deepseek-ai/dsh-research-team — the parts every prose instruction is assembled from.
//
// WHY THIS EXISTS. Seven steps ask a model to write something, and each composed its request as an
// inline template string inside `registry.ts`: the role, the obligation the section owes, the rules
// bounding what may be asserted, and the format the reply must take were one literal, in the file
// that runs the steps. The rules a step is judged BY already live in modules — `argument-plan.ts`
// states what a section owes, `citation-bindings.ts` decides what a citation may claim — so the text
// that TELLS a writer about a rule had no home of its own, and a constraint stated in one place and
// enforced in another is how the two come to disagree. MOVING THE TEXT HERE IS A MOVE AND NOT A
// REWRITE: every prompt's own words are unchanged by it, which is what lets the next change to one of
// them be read as the change it is.
//
// WHAT THE SKELETON IS. One instruction is five parts, each answering one question a writer has:
// what to write and for what it is; what this section owes its reader; the format the reply must be
// in; what may be asserted and what a passage somebody read does and does not establish; and how a
// source is named. A step with nothing to say in a part states no part, and the instruction is the
// parts it does have joined in the order above — so a step with no citation rules reads as an
// instruction about its own reply rather than as one carrying an empty section.
//
// It is not a template language. The parts are the step's own words; this module states the ORDER and
// the JOIN, and nothing about any step.

/**
 * The parts of one prose instruction, in the order they are assembled.
 *
 * The order is the order every instruction already read in: what to write, what it owes, what the
 * reply must look like, what may be asserted, and how a source is named. `output` sits before the two
 * rules parts because a writer reads its format before the rules its sentences are judged against.
 */
export interface InstructionParts {
  /** What to write, and what this run's own material is. */
  readonly task: string
  /** What the section owes its reader — an obligation the writer is not told is one it cannot discharge. */
  readonly contract?: string
  /**
   * The format the reply must be in, stated as a format.
   *
   * A FORMAT HAS TO BE ANSWERABLE AND NOT ONLY DESCRIBABLE, which is what {@link labelledLines}
   * exists for: an instruction that says how many values it wants, and in what order, can be answered
   * by a reader that does not already know the task, and one that describes the shape in prose cannot.
   */
  readonly output: string
  /** What may be asserted, and what a passage a reviewer read does and does not establish. */
  readonly evidence?: string
  /** How a source is named, which sources may be named, and what a citing sentence may claim. */
  readonly citations?: string
}

/** What separates two parts when the reply is running prose. */
export const PROSE_JOIN = ' '

/** What separates two parts when the reply is one labelled field per line. */
export const LINE_JOIN = '\n'

/**
 * Assemble one instruction from its parts.
 *
 * A PART THE STEP STATES NOTHING FOR IS ABSENT, not empty in place: its separator would otherwise
 * stand between two sentences that were never adjacent, and a reader of the log would see the seam.
 *
 * @param parts - the parts; they are assembled in {@link InstructionParts}' own order, not in the
 * order a caller happens to write them.
 * @param separator - what stands between two parts: {@link PROSE_JOIN} for an instruction answered in
 * prose, {@link LINE_JOIN} for one answered as a labelled field per line.
 * @returns the instruction.
 */
export function instructionOf(parts: InstructionParts, separator: string): string {
  return [parts.task, parts.contract, parts.output, parts.evidence, parts.citations]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(separator)
}

/**
 * One labelled field of a reply, stated as the format the writer is to answer in.
 *
 * THE LABEL IS THE PARSER'S, so a format line and the reader that reads it back cannot drift: the
 * steps below parse with `labelledField(text, 'ASSERTION')`, and the line asks for `ASSERTION:`.
 *
 * @param label - the field's name, exactly as the step reads it back.
 * @param placeholder - what belongs on the line, as a placeholder rather than as prose about it.
 * @returns the format line, e.g. `ASSERTION: <one sentence claim>`.
 */
export function labelledLine(label: string, placeholder: string): string {
  return `${label}: ${placeholder}`
}

/**
 * Several labelled fields, one per line, as the format block of an instruction.
 *
 * A FORMAT LINE HAS TO BE ANSWERABLE, NOT JUST DESCRIBABLE. D2's instruction described its own format
 * in prose ("7 headings separated by ' | '"), a deployment's offline route answered with the separator
 * it saw named and produced two headings, and D2 refused the outline — the format was never stated in
 * a form a rule could be answered against. The placeholders below are that correction: a field, and
 * the shape of the value that goes in it. See `d2-framework.ts`, where the count and the order are
 * stated for the same reason.
 *
 * @param fields - the label and placeholder of each field, in the order the reply must state them.
 * @returns the format block, one field per line.
 */
export function labelledLines(fields: ReadonlyArray<readonly [string, string]>): string {
  return fields.map(([label, placeholder]) => labelledLine(label, placeholder)).join(LINE_JOIN)
}
