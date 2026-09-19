// @deepseek-ai/dsh-research-team — what A1 asks the writer for: the gaps the retrieved papers leave.
//
// THE GAPS ARE THIS STEP'S PRODUCT and the retrieved records travel beside them as request context,
// so the instruction is about the papers it is shown rather than about a corpus: the topic is the
// run's, and a gap reported for a topic the retrieval did not answer for is a finding about somebody
// else's field.

import { PROSE_JOIN, instructionOf } from './skeleton.ts'

/** The reply's format: one gap per line, and nothing around them. */
const FORMAT = 'Return one gap per line. No numbering, no preamble, no closing commentary.'

/**
 * The instruction A1's gap analysis is written under.
 *
 * @param input - the topic the run's retrieval answered for.
 * @returns the instruction.
 */
export function landscapeGapInstruction(input: { readonly topic: string }): string {
  return instructionOf({
    task: `Identify the research gaps that the following papers leave open with respect to "${input.topic}".`,
    output: FORMAT,
  }, PROSE_JOIN)
}
