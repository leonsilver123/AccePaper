// @deepseek-ai/dsh-research-team — what A2 asks the writer for: a falsifiable claim over the gaps.
//
// THE FORMAT IS THE STEP'S CONTRACT. A2 parses `ASSERTION`, `DIFFERENCE`, `EXPERIMENT` and
// `PREDICTION` back out of the reply, and it refuses a reply that does not state all four: a claim
// without a falsifiable prediction cannot be adjudicated, and a step that answered with three of them
// would hand the C channel a claim nothing can test (NO DEFAULT PASS). The gaps the claim answers
// travel as request context, so the instruction is the same text for every run of this step.

import { LINE_JOIN, labelledLines, instructionOf } from './skeleton.ts'

/** The reply's format: four labelled lines, in the order A2 reads them back. */
const FORMAT = [
  'Reply with exactly these four lines and nothing else:',
  labelledLines([
    ['ASSERTION', '<one sentence claim>'],
    ['DIFFERENCE', '<what makes this essentially different from prior work>'],
    ['EXPERIMENT', '<the experiment that would falsify it>'],
    ['PREDICTION', '<the measurable prediction, with a numeric threshold>'],
  ]),
].join(LINE_JOIN)

/** The instruction A2's claim is derived under. */
export const CLAIM_INSTRUCTION = instructionOf({
  task: 'Answer ONE of the research gaps below with a falsifiable central claim.',
  output: FORMAT,
}, LINE_JOIN)
