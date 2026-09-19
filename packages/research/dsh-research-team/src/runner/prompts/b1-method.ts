// @deepseek-ai/dsh-research-team — what B1 asks the writer for: the method that makes the claim testable.
//
// ALL FOUR FIELDS ARE PARSED BACK and all four are needed downstream: a method spec missing its
// family, its steps or its metric cannot be implemented or measured, so B1 refuses an incomplete reply
// rather than emitting a spec that only looks complete (NO DEFAULT PASS). The claim and its prediction
// travel as request context.

import { LINE_JOIN, labelledLines, instructionOf } from './skeleton.ts'

/** The reply's format: four labelled lines, in the order B1 reads them back. */
const FORMAT = [
  'Reply with exactly these four lines and nothing else:',
  labelledLines([
    ['FAMILY', '<the method family, one phrase>'],
    ['STEPS', '<step> | <step> | <step>'],
    ['METRIC', '<the single primary metric name>'],
    ['DIRECTION', '<"lower is better" or "higher is better">'],
  ]),
].join(LINE_JOIN)

/** The instruction B1's method spec is derived under. */
export const METHOD_INSTRUCTION = instructionOf({
  task: 'Derive the method that makes the central claim testable.',
  output: FORMAT,
}, LINE_JOIN)
