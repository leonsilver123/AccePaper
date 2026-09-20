// @deepseek-ai/dsh-research-team — what D2 asks the writer for: the paper's title and section headings.
//
// THE OUTLINE'S IDS ARE FIXED AND ITS HEADINGS ARE NOT. The section ids and what each section covers
// are the structure every downstream step depends on, so the request names the ids and asks for one
// heading per id, in order — and D2 refuses a reply whose heading count is not the skeleton's, because
// a partial outline would drop a section the later steps write into.
//
// THE TITLE IS A CLAIM, AND THE RUN HAS A RULE ABOUT WHICH CLAIMS IT MAY STATE. A later quality role
// reads the title's direction words against the run's own record and refuses a headline that asserts
// the finding the study refuted; D2 is where that headline is written, so the rule and the record it
// reads are stated here. An instruction that said nothing about it left the writer to contradict a
// rule it was never shown, which is exactly the defect measured on the deployment on 2026-09-20: a
// pre-send reading of this instruction refused it as carrying nothing that limits what the title and
// the headings may assert.

import { LINE_JOIN, labelledLines, instructionOf } from './skeleton.ts'
import type { ClaimOutcome } from '../argument-plan.ts'

/**
 * The run's own measurement, as the constraint on the title and the headings reads it.
 *
 * The same facts the plan states to the sections that report the outcome — the measured change, what
 * it did to the claim, and what the claim committed to — because the title is graded against the
 * record and not against the prose.
 */
export interface OutlineMeasurement {
  /** The quantity the study measures, as the run's plan labels it. */
  readonly metricLabel: string
  /**
   * The measured change, in per cent, signed the way the quality role reads it: positive is a rise.
   *
   * `improvementPct` rather than a second reading of the measurement, for the reason the study
   * adapter's own movement sentence uses it: one number decides both what the record says and which
   * direction words agree with it.
   */
  readonly measuredPct: number
  /** What the run's own measurement did to the claim — the plan's judgement, not a second one. */
  readonly outcome: ClaimOutcome
  /** The direction the claim committed to, which is the direction the measurement may refute. */
  readonly committedDirection: 'increase' | 'decrease'
  /** The magnitude the claim committed to, in per cent, or undefined when it committed to none. */
  readonly thresholdPct?: number
}

/**
 * What the title and the section headings may assert, in the terms the quality role reads them.
 *
 * THE RULE IS THE PIPELINE'S OWN AND NOT A HOUSE STYLE. `red-claim` reads the direction words in the
 * title against the run's record and refuses a title that states the direction the measurement
 * contradicts — the delivered paper's own defect, a headline claiming a rise printed above a study
 * that measured a fall. The run's record is stated here for the same reason D3 states its evidence:
 * a rule the writer cannot apply to the material it has is a rule the writer is judged by and never
 * shown, and the title is the one sentence every reader reads.
 *
 * THE RULE IS STATED AT THE STRENGTH THE CHECK APPLIES IT, and no stronger. `red-claim` refuses a
 * direction the record contradicts, so the constraint forbids that and permits a title that states
 * the direction the record found; a constraint that forbade every direction word would refuse titles
 * the check accepts, which is a rule the pipeline does not have.
 *
 * @param measurement - the run's own measurement and what the claim committed to.
 * @returns the constraint, as the instruction states it.
 */
function assertionRules(measurement: OutlineMeasurement): string {
  const rose = measurement.measuredPct >= 0
  const committed = measurement.committedDirection
  const commitment = measurement.thresholdPct === undefined
    ? `a claim that committed to an ${committed} with no threshold stated`
    : `a claim that committed to an ${committed} of at least ${String(measurement.thresholdPct)}%`
  const RULE = 'The title and the section headings may state a direction only where the run\'s own'
    + ' record found that direction. The direction words in the title are read against that record'
    + ' and a title that asserts the direction the measurement contradicts is refused — a headline'
    + ' claiming the quantity rose above a study that measured it falling is a defect this pipeline'
    + ' refuses rather than a matter of emphasis. A heading is a claim like the title, read the same'
    + ' way: state the direction the record found, or state no direction at all.'
  const RECORD = `This run's record measures a change of ${String(measurement.measuredPct)}% in the`
    + ` ${measurement.metricLabel} — it ${rose ? 'rose' : 'fell'} — against ${commitment}.`
  const VERDICT = measurement.outcome === 'refuted'
    ? `The measurement CONTRADICTS the claim, so a title or a heading that states an ${committed}`
      + ' asserts the finding this study refuted.'
    : measurement.outcome === 'supported'
      ? `The measurement supports the claim, so a title stating an ${committed} states what this`
        + ' study found.'
      : `The measurement moved in the ${committed} the claim committed to, but by less than the`
        + ' threshold the claim committed to, so a title may state that direction and must not state'
        + ' that this study confirmed the claim.'
  return `${RULE} ${RECORD} ${VERDICT}`
}

/**
 * The instruction D2's outline is written under.
 *
 * ONE PLACEHOLDER PER HEADING THE OUTLINE NEEDS, so the declared format says HOW MANY values it wants
 * and in what order. It used to read "7 headings separated by ' | '" in prose, which a reader
 * understands and a rule cannot: a deployment's offline route answered with the separator it saw named,
 * produced two headings, and D2 refused the outline. A format line has to be answerable, not just
 * describable.
 *
 * @param input - the section ids the outline declares, in the order their headings are asked for, and
 * the run's own measurement, which bounds what the title and the headings may assert.
 * @returns the instruction.
 */
export function frameworkInstruction(input: {
  readonly sectionIds: ReadonlyArray<string>
  readonly measurement: OutlineMeasurement
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
    evidence: assertionRules(input.measurement),
  }, LINE_JOIN)
}
