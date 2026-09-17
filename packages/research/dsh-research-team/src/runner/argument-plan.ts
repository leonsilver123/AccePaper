// @deepseek-ai/dsh-research-team — what each section is FOR, and what it must not leave out.
//
// WHY THIS EXISTS. The pipeline knew what each section could be written FROM (`section-evidence.ts`)
// and nothing about what each section had to SAY. The consequence is the delivered paper: a Result
// section that reports the measurement, a Conclusion that reports it again, and no section whose job
// is to state that the study REFUTED its own claim — which it did, by −38.2% against a prediction of
// at least +20%. A paper that reports a negative result as if it were the finding it hoped for is not
// a reporting defect; it is the wrong paper.
//
// WHAT A CONTRACT CARRIES. The section's job, the evidence without which it cannot be written, and
// the OBLIGATIONS it must discharge — including the adverse ones. An obligation is stated in words a
// reader can check and, where it can be, with the check itself: the measured change and the direction
// it moved in are both mechanical facts about the run, so "the Results section states the measured
// change" is checkable rather than a matter of opinion.
//
// ADVERSE RESULTS ARE FIRST-CLASS OBLIGATIONS. The obligations below are derived from the measurement
// and from what the claim committed to: when the two disagree, the sections that report the outcome
// are obliged to say so, and a section that omits it is refused rather than warned about. A pipeline
// that only ever reports what it hoped for manufactures its results, which is the failure this whole
// layer exists to prevent.
//
// WHAT THIS IS NOT. It is not a writing template and it does not fix a section structure: the outline
// is the plan's, and this states what each of its sections owes. It is not a prose judge either — an
// obligation is discharged by stating a fact the run holds, and whether the argument around it is any
// good takes a reader.

/** What one obligation is about. */
export type ObligationKind =
  /** The section must state the measured change itself. */
  | 'measured-change'
  /** The section must state which way the measurement moved. */
  | 'direction-of-change'
  /** The section must state that the result CONTRADICTS what the claim predicted. */
  | 'adverse-result'
  /** The section must state the scope the measurement holds in and where it stops. */
  | 'boundary'
  /** The section must state an explanation other than the claim's. */
  | 'alternative-explanation'
  /** The section must state what this study does not establish. */
  | 'limitation'

/** The mechanical part of an obligation: what must appear in the section's text. */
export interface ObligationCheck {
  /**
   * The measured change, in per cent, that the section must quote.
   *
   * Compared with a tolerance, because the manuscript is allowed to round: a section stating `38.20%`
   * for a measured `38.2` has stated the measurement, and one stating `38%` has stated a different
   * number.
   */
  readonly percentWithin?: number
  /** At least one of these words must appear, for an obligation about a direction. */
  readonly anyOf?: ReadonlyArray<string>
}

/** One thing a section owes its reader. */
export interface ContractObligation {
  /** Stable id, e.g. `results-states-measured-change`. */
  readonly id: string
  readonly kind: ObligationKind
  /** What the section must say, in one sentence, for whoever reads the requirement. */
  readonly statement: string
  /** The checkable part, or absent when discharging it takes a reader. */
  readonly check?: ObligationCheck
}

/** What one section is for, written from, and obliged to say. */
export interface SectionContract {
  readonly id: string
  /** The section's job, in one sentence: what it is FOR, not what it is titled. */
  readonly job: string
  /** The evidence names this section cannot be written without. */
  readonly evidence: ReadonlyArray<string>
  readonly obligations: ReadonlyArray<ContractObligation>
}

/** What the run's measurement did to its claim. */
export type ClaimOutcome = 'supported' | 'refuted' | 'indeterminate'

/** The plan a manuscript's sections are written and checked against. */
export interface ArgumentPlan {
  /** Which revision of this plan a section was written under, recorded so a draft is reproducible. */
  readonly version: string
  /** The question the paper answers, as the study plan states it. */
  readonly question: string
  /** The claim sentence the sections argue about. */
  readonly claimRef: string
  /** What the run's own measurement did to the claim. */
  readonly outcome: ClaimOutcome
  readonly sections: ReadonlyArray<SectionContract>
}

/** Why a section was refused. */
export type ArgumentRefusalCode =
  /** A section this plan declares is not in the manuscript. */
  | 'argument-section-missing'
  /** A section the manuscript carries that this plan declares no contract for. */
  | 'argument-section-undeclared'
  /** A section did not discharge an obligation it owes. */
  | 'argument-obligation-unmet'

/** One refusal, naming the section and the obligation. */
export interface ArgumentRefusal {
  readonly code: ArgumentRefusalCode
  readonly sectionId: string
  readonly detail: string
}

/** The plan revision the contracts below are, recorded on every draft written under them. */
export const ARGUMENT_PLAN_VERSION = 'argument-plan-v1'

/** The words each direction of movement is stated with, so a check is not a guess about phrasing. */
const ROSE_WORDS: ReadonlyArray<string> = ['rose', 'rise', 'rises', 'increased', 'increases', 'higher', 'grew', 'raise', 'raises']
const FELL_WORDS: ReadonlyArray<string> = ['fell', 'falls', 'fall', 'decreased', 'decreases', 'lower', 'lowered', 'reduced', 'reduces', 'drop', 'dropped']

/**
 * The words that STATE a contradiction with the claim.
 *
 * A DIRECTION WORD IS NOT ONE OF THEM. "The quantity fell" reports the measurement; "the measurement
 * contradicts the claim" reports what it did to the claim, and the delivered paper has the first
 * everywhere and the second nowhere. The obligation is the second, so the check is over words that
 * mean it — and the vocabulary is declared rather than guessed at, because it is also what the writer
 * is asked for.
 */
const CONTRADICTION_WORDS: ReadonlyArray<string> = [
  'contradict', 'contradicts', 'contradicted', 'contradicting',
  'refute', 'refutes', 'refuted', 'refuting',
  'against the claim', 'against the prediction', 'opposite of the claim',
  'fails to confirm', 'not confirmed', 'does not support', 'unsupported by the measurement',
  'disconfirms', 'disconfirmed',
]

/**
 * What the run's measurement did to the claim it committed to.
 *
 * THE ARGUMENT IS DETERMINED BY THIS, not by the prose that reports it. A deterministic simulation
 * that measured a fall where the claim predicted a rise has refuted its claim, and the sections that
 * report the outcome are obliged to say so — which is the obligation the delivered paper does not
 * discharge anywhere.
 *
 * @param measuredPct - the measured change of the metric, in per cent, signed in the metric's units.
 * @param committedDirection - the direction the claim declared: an increase, or a decrease.
 * @param thresholdPct - the magnitude the claim declared, or undefined when it declared none.
 * @returns what the measurement did to the claim.
 */
export function claimOutcomeOf(
  measuredPct: number,
  committedDirection: 'increase' | 'decrease',
  thresholdPct: number | undefined,
): ClaimOutcome {
  const moved = measuredPct >= 0 ? 'increase' : 'decrease'
  if (moved !== committedDirection) return 'refuted'
  const threshold = thresholdPct ?? 0
  return Math.abs(measuredPct) >= threshold ? 'supported' : 'indeterminate'
}

/**
 * The plan a manuscript's sections are written and checked against.
 *
 * ONE SECTION PER OUTLINE ID, and every outline id gets a contract — a section the plan declares and
 * the manuscript omits is refused, and so is a section the manuscript carries that the plan never
 * declared. The evidence requirements are the ones `section-evidence.ts` used to hold on its own:
 * they live here now, beside the obligations they serve, so a section's requirements are one entry
 * rather than two tables that can drift.
 *
 * @param input - the study's question and claim, the measurement, and what the claim committed to.
 * @returns the plan, with one contract per section.
 */
export function argumentPlanOf(input: {
  readonly question: string
  readonly claimRef: string
  readonly metricLabel: string
  readonly measuredPct: number
  readonly committedDirection: 'increase' | 'decrease'
  readonly thresholdPct?: number
  readonly sectionIds: ReadonlyArray<string>
}): ArgumentPlan {
  const outcome = claimOutcomeOf(
    input.measuredPct,
    input.committedDirection,
    input.thresholdPct,
  )
  const magnitude = Math.abs(input.measuredPct)
  const movedUp = input.measuredPct >= 0
  // THE OBLIGATIONS THAT FOLLOW FROM A REFUTATION. A section reporting a result that contradicts the
  // claim must say BOTH what was measured and that it runs the other way; either one alone leaves a
  // reader who skims with the impression the study found what it hoped for.
  const outcomeObligations: ReadonlyArray<ContractObligation> = outcome === 'refuted'
    ? [
      {
        id: 'states-measured-change',
        kind: 'measured-change',
        statement: `state the measured change of ${input.metricLabel}, in per cent`,
        check: { percentWithin: magnitude },
      },
      {
        id: 'states-measured-direction',
        kind: 'direction-of-change',
        statement: 'state which way the measurement moved, which was a'
          + ` ${movedUp ? 'rise' : 'fall'}`,
        check: { anyOf: movedUp ? ROSE_WORDS : FELL_WORDS },
      },
      {
        id: 'states-adverse-result',
        kind: 'adverse-result',
        statement: 'state that the measurement CONTRADICTS the claim, which predicted an'
          + ` ${input.committedDirection} of at least ${String(input.thresholdPct ?? 0)}% — saying`
          + ' only that the quantity moved does not say what that did to the claim',
        check: { anyOf: CONTRADICTION_WORDS },
      },
    ]
    : [
      {
        id: 'states-measured-change',
        kind: 'measured-change',
        statement: `state the measured change of ${input.metricLabel}, in per cent`,
        check: { percentWithin: magnitude },
      },
      {
        id: 'states-direction-of-change',
        kind: 'direction-of-change',
        statement: 'state which way the measurement moved',
        check: { anyOf: movedUp ? ROSE_WORDS : FELL_WORDS },
      },
    ]
  return {
    version: ARGUMENT_PLAN_VERSION,
    question: input.question,
    claimRef: input.claimRef,
    outcome,
    sections: input.sectionIds.map(id => sectionContractOf(id, { outcomeObligations, metricLabel: input.metricLabel })),
  }
}

/** The contract for one outline section, or a refusal-shaped one for an id this plan does not know. */
function sectionContractOf(
  id: string,
  context: {
    readonly outcomeObligations: ReadonlyArray<ContractObligation>
    readonly metricLabel: string
  },
): SectionContract {
  const declared = SECTION_CONTRACTS[id]
  if (declared === undefined) {
    // AN UNKNOWN SECTION IS REFUSED, not written from whatever is present: the outline is the plan's,
    // and a section this table does not know is one whose job nobody declared.
    return {
      id,
      job: 'undefined: the plan declares no contract for this section',
      evidence: ['section-definition'],
      obligations: [],
    }
  }
  return {
    id,
    job: declared.job,
    evidence: declared.evidence,
    obligations: [
      ...declared.obligations,
      ...(declared.reportsOutcome ? context.outcomeObligations : []),
    ],
  }
}

/**
 * What each section is for.
 *
 * The jobs are deliberately about ARGUMENT rather than about content: "the Method section describes
 * the procedure" is a content statement and a section can satisfy it while arguing nothing. Each
 * entry says what the section has to establish for the paper's argument to hold.
 *
 * `reportsOutcome` marks the sections that state the run's measurement, and is the flag that attaches
 * the outcome obligations — including, when the measurement refuted the claim, the obligation to say
 * so.
 */
const SECTION_CONTRACTS: Readonly<Record<string, {
  readonly job: string
  readonly evidence: ReadonlyArray<string>
  readonly obligations: ReadonlyArray<ContractObligation>
  readonly reportsOutcome?: boolean
}>> = {
  abstract: {
    job: 'state the question, what was measured, and what the measurement showed',
    evidence: ['claim', 'result'],
    obligations: [],
    reportsOutcome: true,
  },
  introduction: {
    job: 'state the question this study answers and where the work sits among what is already known',
    evidence: ['claim'],
    obligations: [{
      id: 'states-literature-position',
      kind: 'limitation',
      statement: 'say what is already known about the quantity, with the sources that establish it',
    }],
  },
  method: {
    job: 'describe the procedure that produced the measurement, so it could be repeated',
    evidence: ['method', 'execution'],
    obligations: [],
  },
  experiments: {
    job: 'state the conditions the measurement was taken under and what they bound',
    evidence: ['method', 'execution', 'accounting'],
    obligations: [{
      id: 'states-conditions',
      kind: 'boundary',
      statement: 'state the conditions the measurement holds under',
    }],
  },
  results: {
    job: 'report the measurement, including what it did not show',
    evidence: ['result', 'figures'],
    obligations: [],
    reportsOutcome: true,
  },
  discussion: {
    job: 'say what the measurement means, and what else could explain it',
    evidence: ['result', 'records'],
    obligations: [{
      id: 'states-alternative',
      kind: 'alternative-explanation',
      statement: 'name at least one explanation other than the claim for what was measured',
    }],
  },
  conclusion: {
    job: 'state what this study establishes, and what it does not',
    evidence: ['claim', 'result'],
    obligations: [{
      id: 'states-limitation',
      kind: 'limitation',
      statement: 'state what this study does not establish',
    }],
    reportsOutcome: true,
  },
  references: {
    job: 'list the sources the manuscript cites',
    evidence: ['records'],
    obligations: [],
  },
}

/**
 * The contract one section id carries, or undefined when the plan does not declare it.
 *
 * The evidence requirements live HERE, on the contract, and the writing step reads them from here —
 * a section's obligations and its required evidence are facts about the same section, and two tables
 * would let one be updated without the other.
 *
 * @param sectionId - the outline's section id.
 * @returns the contract, or undefined for a section this plan does not declare.
 */
export function contractFor(sectionId: string): SectionContract | undefined {
  const declared = SECTION_CONTRACTS[sectionId]
  return declared === undefined
    ? undefined
    : { id: sectionId, job: declared.job, evidence: declared.evidence, obligations: declared.obligations }
}

/**
 * What a section owes, and whether it discharged it.
 *
 * A SECTION THAT OMITS AN OBLIGATION IS REFUSED, and the two that matter most are stated here: the
 * measured change (a section that reports a result without stating it) and the adverse result (a
 * section that reports a refutation as a finding). Only obligations with a mechanical check are
 * judged here; one that takes a reader is recorded on the contract and left to the reviewing roles,
 * because a rule that guessed at it would be a rule about prose.
 *
 * @param contract - the section's contract.
 * @param bodyText - the section as written.
 * @returns one refusal per unmet obligation, or an empty list.
 */
export function checkSectionContract(
  contract: SectionContract,
  bodyText: string,
): ReadonlyArray<ArgumentRefusal> {
  const text = bodyText.toLowerCase()
  const refusals: ArgumentRefusal[] = []
  for (const obligation of contract.obligations) {
    const check = obligation.check
    if (check === undefined) continue
    const percent = check.percentWithin
    const statesPercent = percent === undefined || [...bodyText.matchAll(/(\d+(?:\.\d+)?)\s*%/gu)]
      .some(match => Math.abs(Number.parseFloat(match[1] ?? '') - percent) < 0.05)
    const statesDirection = check.anyOf === undefined
      || check.anyOf.some(word => new RegExp(`\\b${word}\\b`, 'u').test(text))
    if (statesPercent && statesDirection) continue
    // THE MESSAGE NAMES WHAT IS MISSING IN THE READER'S TERMS, not the rule's: an obligation about the
    // direction says so, and one about the contradiction does not borrow that word.
    const wants = obligation.kind === 'adverse-result' ? 'the contradiction' : 'the direction'
    refusals.push({
      code: 'argument-obligation-unmet',
      sectionId: contract.id,
      detail: `the '${contract.id}' section owes '${obligation.id}': ${obligation.statement}`
        + (statesPercent ? '' : ` — it does not state ${String(percent)}%`)
        + (statesDirection ? '' : ` — it does not state ${wants} (${(check.anyOf ?? []).join(' | ')})`),
    })
  }
  return refusals
}

/**
 * Require a manuscript's sections to be the plan's sections, or refuse it.
 *
 * A MISSING SECTION AND AN UNDECLARED ONE ARE BOTH REFUSED. The first leaves an obligation nobody
 * discharges; the second is a section whose job nobody declared, which is written from whatever the
 * writer felt like and cannot be checked against anything.
 *
 * @param plan - the plan the manuscript is written under.
 * @param sections - the manuscript's sections.
 * @returns one refusal per missing or undeclared section, or an empty list.
 */
export function checkArgumentPlan(
  plan: ArgumentPlan,
  sections: ReadonlyArray<{ readonly id: string; readonly bodyText: string }>,
): ReadonlyArray<ArgumentRefusal> {
  const declared = new Map(plan.sections.map(contract => [contract.id, contract]))
  const refusals: ArgumentRefusal[] = []
  for (const section of sections) {
    const contract = declared.get(section.id)
    if (contract === undefined) {
      refusals.push({
        code: 'argument-section-undeclared',
        sectionId: section.id,
        detail: `the manuscript carries a '${section.id}' section that the argument plan for outcome`
          + ` '${plan.outcome}' does not declare`,
      })
      continue
    }
    refusals.push(...checkSectionContract(contract, section.bodyText))
  }
  for (const contract of plan.sections) {
    if (!sections.some(section => section.id === contract.id)) {
      refusals.push({
        code: 'argument-section-missing',
        sectionId: contract.id,
        detail: `the argument plan declares a '${contract.id}' section (${contract.job}) that the`
          + ' manuscript does not carry',
      })
    }
  }
  return refusals
}
