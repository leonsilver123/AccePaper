// @deepseek-ai/dsh-research-team — what A3 asks the writer for: the agenda and the contributions.
//
// BOTH LISTS ARE PARSED BACK OUT, and both are needed: an agenda with no stages, or a contribution
// list with nothing in it, is not an agenda, and A3 refuses that reply rather than emitting empty
// structure (NO DEFAULT PASS). The claim and its prediction travel as request context.

import { LINE_JOIN, labelledLines, instructionOf } from './skeleton.ts'

/** The reply's format: two labelled blocks, in the order A3 reads them back. */
const FORMAT = [
  'Reply with exactly these two labelled blocks and nothing else:',
  labelledLines([
    ['PHASES', '<phase> | <phase> | <phase>'],
    ['CONTRIBUTIONS', '<one contribution> || <another contribution>'],
  ]),
].join(LINE_JOIN)

/** The instruction A3's agenda is derived under. */
export const AGENDA_INSTRUCTION = instructionOf({
  task: 'Derive the research agenda and the contribution list that the claim commits this study to delivering.',
  output: FORMAT,
}, LINE_JOIN)
