// @deepseek-ai/dsh-research-team — what D2 asks the writer for: the paper's title and section headings.
//
// THE OUTLINE'S IDS ARE FIXED AND ITS HEADINGS ARE NOT. The section ids and what each section covers
// are the structure every downstream step depends on, so the request names the ids and asks for one
// heading per id, in order — and D2 refuses a reply whose heading count is not the skeleton's, because
// a partial outline would drop a section the later steps write into.

import { LINE_JOIN, labelledLines, instructionOf } from './skeleton.ts'

/**
 * The instruction D2's outline is written under.
 *
 * ONE PLACEHOLDER PER HEADING THE OUTLINE NEEDS, so the declared format says HOW MANY values it wants
 * and in what order. It used to read "7 headings separated by ' | '" in prose, which a reader
 * understands and a rule cannot: a deployment's offline route answered with the separator it saw named,
 * produced two headings, and D2 refused the outline. A format line has to be answerable, not just
 * describable.
 *
 * @param input - the section ids the outline declares, in the order their headings are asked for.
 * @returns the instruction.
 */
export function frameworkInstruction(input: {
  readonly sectionIds: ReadonlyArray<string>
}): string {
  const placeholders = input.sectionIds.map(() => '<heading>').join(' | ')
  const FORMAT = [
    'Reply with exactly these two lines and nothing else:',
    labelledLines([
      ['TITLE', '<a specific paper title>'],
      ['SECTIONS', placeholders],
    ]),
    `  (one per placeholder, in this order: ${input.sectionIds.join(', ')})`,
  ].join(LINE_JOIN)
  return instructionOf({
    task: 'Write the title and section headings for the paper that reports this work.',
    output: FORMAT,
  }, LINE_JOIN)
}
