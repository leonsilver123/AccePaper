/**
 * Turning a model's answer into research proposals a person can confirm.
 *
 * WHY THIS IS A SEPARATE STEP FROM THE RUN. A run is committed to one claim, and everything after
 * A2 is about testing it. A proposal is the opposite: it is what a person is asked to CHOOSE from,
 * and it exists before any run does. The two share one rule — a claim that cannot be graded is not
 * a claim — and the way that rule is shared here is that every proposal is put through the gate's
 * own claim-level check (`prediction-gate.ts`'s `claimRejectionOf`) before a person sees it. A
 * proposal that would stall the C channel is REFUSED WITH ITS REASON rather than offered and then
 * abandoned mid-run.
 *
 * WHAT THE MODEL DECIDES AND WHAT IT DOES NOT. It proposes the title, the direction, the section
 * headings, the claim, the prediction and the criterion. It does not choose the measured quantity:
 * the run can only measure what its study measures, so the quantity travels INTO the request and
 * the instruction requires the prediction to name it. A proposal whose prediction is about some
 * other quantity is refused by the binding check, which is the same check that would hold its run.
 *
 * THE DIRECTION IS READ, NOT ASKED FOR. `commitment.direction` is taken from the `shall <word>`
 * position, which is a wire format rather than a reading — the same function the gate uses to
 * verify it. Asking the model to declare it as well would only create a field that can contradict
 * the sentence, and a proposal has no declaration to contradict: this is where the declaration is
 * built. Every OTHER declared field — the bound and the threshold — is stated by the model and
 * checked against its own sentence.
 */

import type { MeasuredMetric, PredictionCommitment } from './prediction-gate.ts'
import { claimRejectionOf, percentagesIn, requirementDirectionIn } from './prediction-gate.ts'
import type { PlanClaim, PlanSection, StudyPlan } from './study-plan.ts'

/** One direction a person may confirm, as the fields a plan needs. */
export interface DirectionProposal {
  readonly title: string
  readonly direction: string
  readonly outline: ReadonlyArray<PlanSection>
  readonly claim: PlanClaim
  readonly commitment: PredictionCommitment
}

/** What a proposal request needs to know about the run it would become. */
export interface ProposalRequest {
  /**
   * The domain the person stated, or an empty string when they stated none.
   *
   * Empty is a legitimate request — "propose something in this study's own field" — and the
   * instruction says so rather than leaving the model to guess what an empty field means.
   */
  readonly field: string
  /** The quantity this run's study measures. A proposal's prediction must name it. */
  readonly metric: MeasuredMetric
  /**
   * The section ids the pipeline depends on, with the headings a proposal may replace.
   *
   * The IDS are fixed: later steps consume named sections, and D2 refuses an outline whose section
   * count differs from the skeleton. A proposal chooses the headings and nothing else.
   */
  readonly skeleton: ReadonlyArray<PlanSection>
}

/** Why one block of the model's answer did not become a proposal. */
export interface RejectedProposal {
  /** What was wrong, in the gate's own words where the gate is what refused it. */
  readonly reason: string
  /** The block as the model wrote it, so a reader can see what was refused. */
  readonly block: string
}

/** The outcome of reading one model answer: what it proposed, and what was refused. */
export interface ProposalOutcome {
  readonly proposals: ReadonlyArray<DirectionProposal>
  readonly rejected: ReadonlyArray<RejectedProposal>
}

/** How many proposals one answer is asked for. */
export const PROPOSALS_PER_REQUEST = 3

/** The separator between one proposal's block and the next. */
const BLOCK_SEPARATOR = /^\s*-{3,}\s*$/mu

/**
 * The instruction one proposal request sends.
 *
 * The labelled-line format is the same wire format the pipeline's other prose steps use, for the
 * same reason: a labelled field is machine-readable by string comparison, while a JSON body fails
 * a step over punctuation that carries no meaning.
 *
 * @param request - the field to propose within and the quantity the prediction must name.
 * @returns the instruction text.
 */
export function proposalInstruction(request: ProposalRequest): string {
  const { field, metric, skeleton } = request
  const better = metric.direction === 'higher-is-better' ? 'larger' : 'smaller'
  return [
    `Propose ${String(PROPOSALS_PER_REQUEST)} distinct research directions`
    + (field.trim().length === 0
      ? ' in the field this study belongs to.'
      : ` in the field: ${field.trim()}.`),
    `The one quantity this study can measure is ${metric.label} (key "${metric.key}"), where a ${better} value is better.`,
    'Each proposal must commit to a claim about THAT quantity: a claim about anything else cannot be tested here.',
    '',
    `Reply with exactly ${String(PROPOSALS_PER_REQUEST)} blocks separated by a line containing only three dashes. Each block is exactly these lines and nothing else:`,
    'TITLE: <a specific paper title, not a topic>',
    'DIRECTION: <the research direction, one phrase>',
    'CLAIM: <the claim itself, one sentence>',
    `PREDICTION: <a falsifiable prediction about ${metric.label}: it must name that quantity, state its direction as "shall rise" or "shall fall", and carry "at least", "at most" or "within" immediately before one percentage>`,
    'BOUND: <"at-least", "at-most" or "within" — the same word the prediction uses>',
    'THRESHOLD: <the same percentage the prediction states, as a bare number>',
    `SECTIONS: ${skeleton.map(() => '<heading>').join(' | ')}`,
    `  (one heading per placeholder, in this order: ${skeleton.map(s => s.id).join(', ')})`,
  ].join('\n')
}

/** One labelled value out of a proposal block, or undefined when the label is absent or empty. */
function labelled(block: string, label: string): string | undefined {
  const pattern = new RegExp(`^\\**\\s*${label}\\s*[:=]\\s*\\**\\s*(.*)$`, 'imu')
  const value = pattern.exec(block)?.[1]?.trim()
  return value === undefined || value.length === 0 ? undefined : value
}

/** A stable id for a proposed claim, derived from its own direction. */
function claimIdFor(direction: string): string {
  const slug = direction
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return slug.length === 0 ? 'claim-proposed' : `claim-${slug}`
}

/**
 * Read one model answer into proposals a person can confirm.
 *
 * A block is REFUSED, with its reason, when a labelled field is missing, when the bound or the
 * threshold is not one of the accepted values, when the section count does not match the skeleton
 * the pipeline depends on, or when the gate's own claim-level check refuses the claim. Refusals are
 * returned rather than dropped: an answer whose every block was refused must be distinguishable
 * from an answer that proposed nothing, or a caller cannot say which happened.
 *
 * @param text - the model's answer.
 * @param request - the same request the answer was produced for.
 * @returns the proposals, and the blocks that were refused with why.
 */
export function parseDirectionProposals(
  text: string,
  request: ProposalRequest,
): ProposalOutcome {
  const proposals: DirectionProposal[] = []
  const rejected: RejectedProposal[] = []
  const blocks = text
    .split(BLOCK_SEPARATOR)
    .map(block => block.trim())
    .filter(block => block.length > 0)
  const refuse = (block: string, reason: string): void => {
    rejected.push({ reason, block })
  }

  for (const block of blocks) {
    const title = labelled(block, 'TITLE')
    const direction = labelled(block, 'DIRECTION')
    const claimText = labelled(block, 'CLAIM')
    const prediction = labelled(block, 'PREDICTION')
    const bound = labelled(block, 'BOUND')
    const thresholdText = labelled(block, 'THRESHOLD')
    const sectionsText = labelled(block, 'SECTIONS')
    const missing = [
      ['TITLE', title],
      ['DIRECTION', direction],
      ['CLAIM', claimText],
      ['PREDICTION', prediction],
      ['BOUND', bound],
      ['THRESHOLD', thresholdText],
      ['SECTIONS', sectionsText],
    ].filter(([, value]) => value === undefined).map(([label]) => label)
    if (missing.length > 0) {
      refuse(block, `the block states no ${missing.join(', ')}`)
      continue
    }

    // The bound and the threshold are DECLARED by the model and then checked against its own
    // sentence by the gate below. An unrecognised bound is refused here rather than passed on as a
    // string the gate would have to guess at.
    if (bound !== 'at-least' && bound !== 'at-most' && bound !== 'within') {
      refuse(block, `BOUND is "${bound}", which is not "at-least", "at-most" or "within"`)
      continue
    }
    const thresholdPct = Number(thresholdText)
    if (!Number.isFinite(thresholdPct) || thresholdPct <= 0) {
      refuse(block, `THRESHOLD is "${thresholdText}", which is not a positive number`)
      continue
    }

    const headings = (sectionsText as string).split('|').map(h => h.trim()).filter(h => h.length > 0)
    if (headings.length !== request.skeleton.length) {
      refuse(
        block,
        `SECTIONS states ${String(headings.length)} headings where this pipeline's skeleton has `
        + `${String(request.skeleton.length)} (${request.skeleton.map(s => s.id).join(', ')})`,
      )
      continue
    }
    const outline: ReadonlyArray<PlanSection> = request.skeleton.map((section, index) => ({
      id: section.id,
      heading: headings[index] as string,
    }))

    // The direction is READ from the `shall <word>` position rather than asked for, because this is
    // where the declaration is built. See this module's header.
    const declaredDirection = requirementDirectionIn(prediction as string)
    if (declaredDirection === undefined) {
      refuse(
        block,
        'the prediction does not state its direction in the required form ("shall rise", "shall '
        + 'fall" and the other direction words)',
      )
      continue
    }
    const commitment: PredictionCommitment = {
      direction: declaredDirection,
      bound,
      thresholdPct,
    }

    // THE GATE'S OWN CHECK, before a person is offered the claim. Everything above is shape; this is
    // the rule the run itself will apply, so a proposal that reaches a person is one the C channel
    // can grade.
    const rejection = claimRejectionOf({
      predictionText: prediction as string,
      metric: request.metric,
      declaredMetricKey: request.metric.key,
      commitment,
    })
    if (rejection !== undefined) {
      refuse(block, rejection)
      continue
    }

    proposals.push({
      title: title as string,
      direction: direction as string,
      outline,
      claim: {
        id: claimIdFor(direction as string),
        ref: claimText as string,
        assertion: claimText as string,
        // The model is not asked for these two: a proposal is a claim and the criterion that would
        // settle it, and a field invented to fill a slot would be prose no step meant.
        essentialDifference: '',
        experimentToFalsify: '',
        prediction: prediction as string,
      },
      commitment,
    })
  }

  return { proposals, rejected }
}

/**
 * The plan a confirmed proposal becomes.
 *
 * The plan's field is the person's, not the proposal's: the proposal was asked for within that
 * field, so restating it as the proposal's own would give the model authorship of a choice it was
 * given.
 *
 * @param proposal - the proposal the person confirmed.
 * @param field - the field the person stated.
 * @param metric - the quantity this run's study measures.
 * @returns the plan the run will carry.
 */
export function planFromProposal(
  proposal: DirectionProposal,
  field: string,
  metric: MeasuredMetric,
): StudyPlan {
  return {
    title: proposal.title,
    field,
    direction: proposal.direction,
    outline: proposal.outline,
    claim: proposal.claim,
    metric,
    commitment: proposal.commitment,
  }
}

/**
 * The percentages a proposal's prediction states, for a caller that wants to show them.
 *
 * Exported because the dialog shows the criterion a person is confirming, and reading it out of the
 * sentence with the gate's own extractor is what keeps the two from disagreeing about which number
 * is the criterion.
 *
 * @param proposal - the proposal to read.
 * @returns the percentages its prediction states, in order.
 */
export function proposalThresholds(proposal: DirectionProposal): ReadonlyArray<number> {
  return percentagesIn(proposal.claim.prediction)
}
