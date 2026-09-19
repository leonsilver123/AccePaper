// @deepseek-ai/dsh-research-team — what D4 asks the writer for: the review exchanges to answer.
//
// THE REPLY IS ONE EXCHANGE PER FOUR LINES, and a malformed one is refused rather than partially read:
// an exchange the reply did not state completely used to be dropped on the floor, which is the
// difference between "the author accepted three concerns" and "the model answered one of them". The
// section bodies, the open concerns of the previous round, and the run's measurements travel as
// request context.

import { LINE_JOIN, labelledLines, instructionOf } from './skeleton.ts'

/**
 * The version of the instructions the AUTHORING role is given.
 *
 * A string, not a date: "the same rules" is what makes two executions the same task, and two runs on
 * one day are two runs. A deployment that changes what it asks its author to do changes this, and
 * verifications taken under the old rules stop matching the ones the new author produces.
 */
export const D4_AUTHOR_INSTRUCTIONS_VERSION = 'd4-author-instructions-1'

/** The reply's format: one exchange per four labelled lines, in the order D4 reads them back. */
const FORMAT = [
  'Reply with one exchange per group of FOUR lines, at least two exchanges:',
  labelledLines([
    ['CONCERN', '<reviewer concern>'],
    ['SECTION', '<the id of the section the concern is about>'],
    ['RESPONSE', '<the author response, using only the measurements given in the context>'],
    ['PATCH', '<the complete replacement body for that section, or exactly NONE when the answer changes no text>'],
  ]),
  'A PATCH replaces the whole section, so it must keep every sentence the section still needs.',
].join(LINE_JOIN)

/** The instruction D4's review exchanges are written under. */
export const REBUTTAL_INSTRUCTION = instructionOf({
  task: 'Write the review exchanges this paper must answer.',
  output: FORMAT,
}, LINE_JOIN)
