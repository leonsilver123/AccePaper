/**
 * The text seven steps put in front of a model — pinned where it is written.
 *
 * WHY THIS FILE EXISTS. Each of these instructions was an inline template string inside `registry.ts`,
 * five thousand lines from the rules it states, and nothing pinned any of them: a change to a prompt
 * was a change to model-visible text that no test could see, in a package whose whole premise is that
 * what reaches a model is recorded and reviewed. The instructions now live one per step under
 * `src/runner/prompts/` and this file pins the text verbatim, so a future change to one of them is a
 * deliberate edit to a pinned string rather than a line nobody read.
 *
 * THE PINNED STRINGS ARE THE TEXT THE INLINE TEMPLATES PRODUCED. The extraction into modules was
 * checked as a MOVE by capturing every instruction a driven run sent before and after it (a run of
 * A1/A2/A3/B1/D2/D3/D4 with a recording writer): all of them byte-identical.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_PLAN } from '../src/runner/study-plan.ts'
import { argumentPlanOf, obligationsInstructionOf } from '../src/runner/argument-plan.ts'
import { landscapeGapInstruction } from '../src/runner/prompts/a1-landscape.ts'
import { CLAIM_INSTRUCTION } from '../src/runner/prompts/a2-claim.ts'
import { AGENDA_INSTRUCTION } from '../src/runner/prompts/a3-agenda.ts'
import { METHOD_INSTRUCTION } from '../src/runner/prompts/b1-method.ts'
import { frameworkInstruction } from '../src/runner/prompts/d2-framework.ts'
import { revisionInstruction, sectionInstruction, sectionRevisionOf } from '../src/runner/prompts/d3-writing.ts'
import { D4_AUTHOR_INSTRUCTIONS_VERSION, REBUTTAL_INSTRUCTION } from '../src/runner/prompts/d4-rebuttal.ts'
import { LINE_JOIN, PROSE_JOIN, instructionOf, labelledLines } from '../src/runner/prompts/skeleton.ts'
import type { InstructionParts } from '../src/runner/prompts/skeleton.ts'

describe('the skeleton an instruction is assembled from', () => {
  it('assembles the parts it is given, in the skeleton order and not the caller\'s', () => {
    // THE ORDER IS THE SKELETON'S, so a step cannot put its rules before its task by writing the
    // object differently. Two steps that state the same five parts read the same way.
    const parts: InstructionParts = {
      task: 'TASK.',
      contract: 'CONTRACT.',
      output: 'OUTPUT.',
      evidence: 'EVIDENCE.',
      citations: 'CITATIONS.',
    }
    expect(instructionOf(parts, PROSE_JOIN)).toBe('TASK. CONTRACT. OUTPUT. EVIDENCE. CITATIONS.')
    expect(instructionOf({ task: 'TASK.', output: 'OUTPUT.', evidence: 'EVIDENCE.', citations: 'CITATIONS.' }, PROSE_JOIN))
      .toBe('TASK. OUTPUT. EVIDENCE. CITATIONS.')
    // A PART A STEP STATES NOTHING FOR IS ABSENT rather than empty in place: an empty part would put
    // two separators where a sentence group was never adjacent to another.
    expect(instructionOf({ task: 'TASK.', output: 'OUTPUT.', evidence: '' }, PROSE_JOIN))
      .toBe('TASK. OUTPUT.')
    expect(instructionOf({ task: 'ONE', output: 'TWO' }, LINE_JOIN)).toBe('ONE\nTWO')
  })

  it('states a labelled format as a format line, one field per line', () => {
    // A FORMAT LINE HAS TO BE ANSWERABLE, NOT JUST DESCRIBABLE: the label is the parser's own name for
    // the field, and the placeholder says what shape of value belongs on the line.
    expect(labelledLines([['ASSERTION', '<one sentence claim>'], ['DIFFERENCE', '<what is new>']]))
      .toBe('ASSERTION: <one sentence claim>\nDIFFERENCE: <what is new>')
  })
})

describe('the instruction each step sends', () => {
  it('pins what A1 asks for', () => {
    expect(landscapeGapInstruction({ topic: 'platoon stability' }))
      .toBe('Identify the research gaps that the following papers leave open with respect to'
        + ' "platoon stability". Return one gap per line. No numbering, no preamble, no closing'
        + ' commentary.')
  })

  it('pins what A2 asks for', () => {
    expect(CLAIM_INSTRUCTION).toBe([
      'Answer ONE of the research gaps below with a falsifiable central claim.',
      'Reply with exactly these four lines and nothing else:',
      'ASSERTION: <one sentence claim>',
      'DIFFERENCE: <what makes this essentially different from prior work>',
      'EXPERIMENT: <the experiment that would falsify it>',
      'PREDICTION: <the measurable prediction, with a numeric threshold>',
    ].join('\n'))
  })

  it('pins what A3 asks for', () => {
    expect(AGENDA_INSTRUCTION).toBe([
      'Derive the research agenda and the contribution list that the claim commits this study to delivering.',
      'Reply with exactly these two labelled blocks and nothing else:',
      'PHASES: <phase> | <phase> | <phase>',
      'CONTRIBUTIONS: <one contribution> || <another contribution>',
    ].join('\n'))
  })

  it('pins what B1 asks for', () => {
    expect(METHOD_INSTRUCTION).toBe([
      'Derive the method that makes the central claim testable.',
      'Reply with exactly these four lines and nothing else:',
      'FAMILY: <the method family, one phrase>',
      'STEPS: <step> | <step> | <step>',
      'METRIC: <the single primary metric name>',
      'DIRECTION: <"lower is better" or "higher is better">',
    ].join('\n'))
  })

  it('pins what D2 asks for, one placeholder and one id per heading it wants', () => {
    // THE COUNT AND THE ORDER ARE STATED IN THE FORMAT, which is what an offline route answered
    // wrongly when the format was prose about a separator. Three ids here, three placeholders, and
    // the parenthetical names them in order.
    expect(frameworkInstruction({ sectionIds: ['a', 'b', 'c'] })).toBe([
      'Write the title and section headings for the paper that reports this work.',
      'Reply with exactly these two lines and nothing else:',
      'TITLE: <a specific paper title>',
      'SECTIONS: <heading> | <heading> | <heading>',
      '  (one per placeholder, in this order: a, b, c)',
    ].join('\n'))
  })

  it('pins what D4 asks for', () => {
    expect(REBUTTAL_INSTRUCTION).toBe([
      'Write the review exchanges this paper must answer.',
      'Reply with one exchange per group of FOUR lines, at least two exchanges:',
      'CONCERN: <reviewer concern>',
      'SECTION: <the id of the section the concern is about>',
      'RESPONSE: <the author response, using only the measurements given in the context>',
      'PATCH: <the complete replacement body for that section, or exactly NONE when the answer changes no text>',
      'A PATCH replaces the whole section, so it must keep every sentence the section still needs.',
    ].join('\n'))
    // THE AUTHOR'S RULES VERSION WAS NOT CHANGED BY THE MOVE. It is what a verification is bound to,
    // so the value is pinned here: a run that changed the prompt without changing this would let a
    // verification taken under the old rules be read as one of the new author's.
    expect(D4_AUTHOR_INSTRUCTIONS_VERSION).toBe('d4-author-instructions-1')
  })
})

describe('the instruction D3 writes one section under', () => {
  /** The plan a draft is written under, with the run's own outcome attached to it. */
  const plan = argumentPlanOf({
    question: DEFAULT_PLAN.direction,
    claimRef: DEFAULT_PLAN.claim.ref,
    metricLabel: DEFAULT_PLAN.metric.label,
    measuredPct: -38.2,
    committedDirection: 'increase',
    thresholdPct: 20,
    sectionIds: DEFAULT_PLAN.outline.map(section => section.id),
  })

  const instruction = sectionInstruction({
    heading: 'Results',
    claimRef: DEFAULT_PLAN.claim.ref,
    plan,
    sectionId: 'results',
  })

  it('states the section\'s job and the obligations the plan attached to it', () => {
    // THE OBLIGATION IS THE PLAN'S OWN SENTENCE, not a paraphrase: E1 refuses the manuscript with
    // that sentence, so a writer that is told a different one is judged against text it never saw.
    const contract = plan.sections.find(section => section.id === 'results')
    expect(instruction).toContain('Write the "Results" section of a research paper.')
    expect(instruction).toContain('Its job in this paper\'s argument is: report the measurement,'
      + ' including what it did not show.')
    expect(instruction).toContain(obligationsInstructionOf(plan, 'results'))
    expect(instruction).toContain('state that the measurement CONTRADICTS the claim')
    expect(contract?.obligations.length).toBeGreaterThan(0)
  })

  it('names every fact the citation rules read, in the terms they read it in', () => {
    // THE ROSTER'S FIELDS ARE WHAT BOUNDS THE SENTENCE, and each is named with the rule it carries:
    // the passage, `readScope` (which `checkCitationUse` reads as `citation-support-beyond-scope`),
    // `access` (`citation-source-unavailable`) and `accessNote`, which is what tells a writer that the
    // citation names one work while the passage was read in a version of it.
    for (const field of ['passage', 'readScope', 'access', 'accessNote', 'citeKey']) {
      expect(instruction, field).toContain(field)
    }
    expect(instruction).toContain('full-text')
    expect(instruction).toContain('abstract-only')
    expect(instruction).toContain('attributes the finding to the text you were shown')
    // THE CITATION SYNTAX IS THE PARSER'S: `citedKeysIn` reads `[@key]` and nothing else.
    expect(instruction).toContain('exactly as `[@citeKey]`')
    // AND THE OBLIGATION IS OVER THE SOURCES THE PAPER'S CLAIM RESTS ON, not over the whole roster.
    // Measured on the deployment, 2026-09-20: with every reviewed source required to be cited, the
    // introduction's first cited sentence attached the anchor's key to the study's own metric — "The
    // quantity at stake is the smallest gap-to-closing-speed ratio ... [@cite-10.1109/tits.2026.3727135]"
    // — and the sentence assessor refused it, because the passage "only concerns the reaction-time lag
    // (a first-order lag) and the critical lag value above which safe CCC gains do not exist". The two
    // rules could not both be obeyed, so the rule was replaced rather than the reading.
    expect(instruction).toContain('no source outside that list may be cited')
    expect(instruction).toContain('`establishes` is `supported`')
    expect(instruction).toContain('must be cited somewhere in this manuscript')
    expect(instruction).toContain('leave that source uncited rather than attach it to a sentence it does')
    expect(instruction).not.toContain('every one of them must be cited')
  })

  it('asks for a rewrite with the reading of the last version quoted back, and changes nothing else', () => {
    // THE REWRITE IS THE SAME REQUEST WITH THE REFUSAL ADDED. Anything else — a shorter set of rules,
    // a softer one — would let a run converge by being judged differently, which is the one thing a
    // convergence path in this pipeline may not do. The refusal travels VERBATIM: what the assessor
    // wrote is what the writer is told.
    const refusal = "'stmt-introduction-1' cites 'cite-10.1109/tits.2026.3727135', which was assessed"
      + " 'unrelated': The passage only concerns the reaction-time lag (a first-order lag)."
    const rewritten = revisionInstruction({
      heading: 'Results',
      claimRef: DEFAULT_PLAN.claim.ref,
      plan,
      sectionId: 'results',
      refusals: [{ detail: refusal }],
      uncited: ['cite-10.1150/uncited-1'],
    })
    expect(rewritten).toContain('Rewrite the "Results" section')
    expect(rewritten).toContain(refusal)
    expect(rewritten).toContain("'cite-10.1150/uncited-1'")
    expect(rewritten).toContain('Return the complete replacement body for this section')
    // THE FIRST ROUND'S TEXT SURVIVES: every part except the revision is byte-identical to it.
    const first = sectionInstruction({
      heading: 'Results',
      claimRef: DEFAULT_PLAN.claim.ref,
      plan,
      sectionId: 'results',
    })
    for (const part of [
      'Its job in this paper\'s argument is: report the measurement, including what it did not show.',
      'The evidence this section must be written from is under `evidence`',
      'Each source listed under `citations` carries the `passage`',
      'Refer to the central claim as',
    ]) {
      expect(first, part).toContain(part)
      expect(rewritten, part).toContain(part)
    }
    // AND A REVISION PART WITH NOTHING TO SAY IS ABSENT rather than empty in place.
    expect(sectionRevisionOf({ refusals: [], uncited: [] })).toBe('')
  })
})
