// @deepseek-ai/dsh-research-team — the A channel's review of the MANUSCRIPT.
//
// THE DEFECT THIS EXISTS TO CLOSE. `verdictA` called `reviewClaim(runCtx.claimMaterial)`, so the
// three offline rulebooks judged the claim's own fields — its assertion, its prediction, its
// declared scope — whatever D3 or D4 had written. An offline probe changed a number in the draft,
// deleted a Method section, and skipped the revision entirely; none of it moved the A vote. The
// gate that is supposed to be the adversarial reader was reading a different document from the one
// the run produced, and the manuscript could say anything at all.
//
// WHAT THIS IS. The same rulebook discipline, applied to the artifact the step actually produced.
// Every check is a DECLARATION or an EXACT MATCH: a number is matched against the run's own measured
// record, a citation label against the float roster, a reference index against the reference list.
// Nothing here reads prose for meaning — the module that owns the claim checks states why, and four
// audit rounds agree with it.
//
// WHAT IT IS NOT. A reviewer that could judge whether a paper is any good. It finds the four things
// a pipeline can find without reading: a number nothing measured, a section nobody wrote, a
// citation to nothing, and a conclusion its own evidence contradicts.

import type { MeasuredOutcome } from './result-version.ts'
import { readResultVersion } from './result-version.ts'
import type { PredictionCommitment } from './prediction-gate.ts'
import { anchorBoundIn } from './prediction-gate.ts'
import type { ReviewFinding, RoleReview } from './redteam-review.ts'
import { review } from './redteam-review.ts'

/** One manuscript section, as the draft states it. */
export interface ManuscriptSectionInput {
  readonly id: string
  readonly heading: string
  readonly bodyText: string
}

/** Everything a manuscript check reads, taken from the run rather than from the caller's opinion. */
export interface ManuscriptReviewInput {
  readonly sections: ReadonlyArray<ManuscriptSectionInput>
  /** The run's measured result record, so a number in the prose can be traced to one. */
  readonly result: unknown
  /**
   * How the executed implementation may be NAMED in prose: its id, and the algorithm a reader
   * would know it by. Either satisfies the Method check — a section that writes
   * "Intelligent Driver Model" has named its code, and demanding the internal id would refute a
   * manuscript for using the words a paper uses.
   */
  readonly implementationNames: ReadonlyArray<string>
  /**
   * Every number the run itself declares: the implementation's parameters and the factors the two
   * arms vary in.
   *
   * A Method section states its parameters, and those values exist in the run — in `method-spec`,
   * not in the result record. Without them the number check refutes a correct manuscript for
   * quoting its own declared step size, which is the check being wrong rather than the paper.
   */
  readonly declaredNumbers: ReadonlyArray<number>
  /** The reference list the draft carries. */
  readonly referenceCount: number
  /** The float roster the draft carries, by label. */
  readonly floatLabels: ReadonlyArray<string>
  /** What the claim committed its quantity to. Absent means nothing to check a conclusion against. */
  readonly commitment?: PredictionCommitment | undefined
  /** The claim's own falsifiable prediction, quoted so an overstatement can be compared to it. */
  readonly predictionText: string
  /**
   * The phrasings the study's measured quantity requires, taken from its own metric.
   *
   * Passed in rather than imported: the quantity is a plan field, and a reader that hardcodes the
   * shipped study's wording would stop finding the measuring clause the moment a deployment states
   * a different quantity — silently, because "found no clause" reads the same as "no overstatement".
   */
  readonly metricPhrases: ReadonlyArray<string>
}

/**
 * Prose with its citations and identifiers removed.
 *
 * Every rule here is narrow, and every one was added because a real manuscript tripped it:
 *
 *  - `(Treiber, Hennecke & Helbing 2000)` is a citation, and a naive scan reads its year as a
 *    measurement of 2000;
 *  - `10.1016/j.trb.2025.103352`, `https://…`, `arXiv:2406.11508` and `[12]` are IDENTIFIERS. A
 *    references section is made of them, and the first browser run of this check refused a correct
 *    manuscript for citing 47 DOIs, `802.11` and `18051527` among the "unmeasured numbers".
 *
 * A number a section states as a result is not an identifier and is not written inside a citation.
 *
 * @param text - a section body.
 * @returns the body with its citations and identifiers blanked out.
 */
function withoutCitations(text: string): string {
  return text
    .replace(/\([^()]*(?:1[89]|20)\d{2}[^()]*\)/gu, ' ')
    .replace(/10\.\d{4,9}\/[^\s,;)]+/gu, ' ')
    .replace(/https?:\/\/\S+/gu, ' ')
    .replace(/arXiv:\s*\d{4}\.\d{4,5}/giu, ' ')
    .replace(/\[[0-9,\s–-]+\]/gu, ' ')
}

/**
 * Whether a body names an implementation, allowing for the words a paper actually uses.
 *
 * The implementation's own name is `Intelligent Driver Model car-following, three-vehicle
 * platoon`, and a Methods section writes `the Intelligent Driver Model (Treiber… 2000)`. Demanding
 * the whole string would refute a correct manuscript for phrasing; the rule is therefore that some
 * three-word run of a declared name appears in the body.
 *
 * @param body - the Method section's prose.
 * @param names - the implementation's id and algorithm.
 * @returns the name that was found, or undefined.
 */
function implementationNamedIn(body: string, names: ReadonlyArray<string>): string | undefined {
  for (const name of names) {
    if (body.includes(name)) return name
    const words = name.split(/\s+/u).filter(word => word.length > 0)
    for (let index = 0; index + 3 <= words.length; index += 1) {
      const window = words.slice(index, index + 3).join(' ')
      if (body.includes(window)) return window
    }
  }
  return undefined
}

/**
 * The numbers a piece of prose states as QUANTITIES, in order.
 *
 * @param text - a section body with its citations already blanked out.
 * @returns each quantity the prose states.
 */
function quantitiesIn(text: string): ReadonlyArray<number> {
  const found: number[] = []
  for (const match of text.matchAll(/\d+(?:\.\d+)?\s*%?/gu)) {
    const raw = match[0]
    const value = Number(raw.replace(/\s*%$/u, ''))
    if (!Number.isFinite(value)) continue
    // WHAT A QUANTITY LOOKS LIKE. A number a section states as a result carries a unit or a
    // percent sign, or is a small count it can declare — "19.58 s", "−38.20 %", "three vehicles".
    // A bare integer above that range in running prose is a citation: the real run that produced
    // this rule was refused twice, first for 47 DOIs and then for `62` and `1805`, which are the
    // volume and page of `Physical Review E 62(2):1805`. Enumerating the shapes identifiers take is
    // the losing game; saying what a measurement looks like is the winning one.
    //
    // The cost is stated rather than hidden: a fabricated bare integer above the count range —
    // "the platoon held 47 s", with no unit — is not checked. A fabricated number that carries its
    // unit, or any decimal, still is.
    const hasMarker = /%$/u.test(raw) || /\d\.\d/u.test(raw) || /\s/u.test(raw)
    if (!hasMarker && value > DECLARED_COUNT_RANGE) continue
    found.push(value)
  }
  return found
}

/**
 * The largest bare integer prose may state as a count rather than as a citation.
 *
 * A section legitimately says "three vehicles", "the two platoons", "both arms"; a page number is
 * never that small.
 */
const DECLARED_COUNT_RANGE = 20

/**
 * Every number the run's own evidence can account for.
 *
 * The record's six quantities in both their rounded and their raw form, the threshold the claim
 * committed to, and the counts a section legitimately states (how many references, how many
 * figures). A number outside this set is one no part of the run produced.
 */
function accountableNumbers(input: ManuscriptReviewInput, record: MeasuredOutcome | undefined): ReadonlySet<number> {
  const accountable = new Set<number>([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  accountable.add(input.referenceCount)
  accountable.add(input.floatLabels.length)
  for (const value of input.declaredNumbers) {
    accountable.add(value)
    accountable.add(Math.abs(value))
    accountable.add(Math.round(value * 100) / 100)
    accountable.add(Math.round(value * 10) / 10)
    accountable.add(Math.round(value))
  }
  if (input.commitment !== undefined) {
    accountable.add(input.commitment.thresholdPct)
    accountable.add(Math.abs(input.commitment.thresholdPct))
  }
  if (record !== undefined) {
    for (const value of [
      record.baselineMinTtcSeconds,
      record.variantMinTtcSeconds,
      record.improvementPct,
      record.baselineTtcRatePct,
      record.variantTtcRatePct,
      record.stringStabilityIndex,
    ]) {
      accountable.add(value)
      accountable.add(Math.abs(value))
      // A section may state a figure rounded to one place instead of two.
      accountable.add(Math.round(value * 10) / 10)
      accountable.add(Math.round(value))
    }
  }
  return accountable
}

/** The clause that names the measured quantity, or the whole text when it names none. */
/**
 * The sentence that STATES A FINDING about the measured quantity, or undefined when none does.
 *
 * A manuscript says two kinds of thing about its quantity, and only one is a claim about what
 * happened:
 *
 *   - the hypothesis — "we test whether the autonomous vehicle raises the platoon minimum
 *     time-to-collision", which restates the CLAIM and is evidence of nothing;
 *   - the finding — "the autonomous vehicle lowers the platoon minimum time-to-collision by
 *     38.20 %", which asserts a magnitude the run measured.
 *
 * The discriminator is the MAGNITUDE. The first version of this check read whichever sentence
 * named the quantity first, so a model's honest restatement of its claim in the abstract was
 * graded as a false finding and the step was blocked.
 *
 * @param text - the manuscript's prose.
 * @param metricPhrases - the phrasings the study's quantity requires.
 * @returns the first finding sentence, or undefined.
 */
function findingClauseOf(text: string, metricPhrases: ReadonlyArray<string>): string | undefined {
  for (const sentence of text.split(/(?<=[.!?])\s+/u)) {
    const lowered = sentence.toLowerCase()
    if (!metricPhrases.some(phrase => lowered.includes(phrase))) continue
    if (!/\d+(?:\.\d+)?\s*%/u.test(sentence)) continue
    // A PREDICTION IS NOT A FINDING, and the markers are the claim's own vocabulary rather than a
    // reading of the sentence: a commitment states its bound with "at least" / "at most" /
    // "within", and a prediction is written in the future ("shall", "will"). The shipped study's
    // own introduction states "the HV-AV-HV platoon shall exceed the all-HV platoon in minimum
    // time-to-collision by at least 20 %", which pairs the quantity with a percentage and is a
    // restatement of the claim. A Results sentence — "lowered it by 38.20 %" — carries neither.
    if (/\b(?:shall|will)\b/iu.test(sentence)) continue
    if (/\b(?:at least|at most|within)\s+\d+(?:\.\d+)?\s*%/iu.test(sentence)) continue
    return sentence
  }
  return undefined
}

/**
 * Whether the manuscript's Method section describes the code that ran.
 *
 * @param sections - the draft's sections.
 * @param implementationId - the implementation the run executed.
 * @returns the role's review.
 */
function reviewManuscriptMethod(
  sections: ReadonlyArray<ManuscriptSectionInput>,
  implementationNames: ReadonlyArray<string>,
): RoleReview {
  const findings: ReviewFinding[] = []
  const method = sections.find(section => section.id === 'method')
  if (method === undefined) {
    findings.push({
      check: 'does the manuscript state the method it ran?',
      found: 'the draft carries no Method section at all',
      position: 'refute',
    })
    return review('red-method', findings)
  }
  if (method.bodyText.trim() === '') {
    findings.push({
      check: 'does the manuscript state the method it ran?',
      found: `the Method section exists and its body is empty (heading '${method.heading}')`,
      position: 'refute',
    })
    return review('red-method', findings)
  }
  // The body must name the implementation, because that is what makes the Method section a
  // description of the executed code rather than a plausible one. A body that names none is a gap
  // rather than a contradiction: nothing in it is false, and nothing in it can be checked.
  const named = implementationNamedIn(method.bodyText, implementationNames)
  if (implementationNames.length > 0 && named === undefined) {
    findings.push({
      check: 'does the Method section name the implementation the run executed?',
      found:
        `the section body names none of ${implementationNames.join(' / ')} — a Method section that`
        + ' does not name its code cannot be checked against it',
      position: 'abstain',
    })
  }
  const empty = sections.filter(section => section.bodyText.trim() === '').map(section => section.id)
  if (empty.length > 0) {
    findings.push({
      check: 'is every section the outline declares actually written?',
      found: `sections with an empty body: ${empty.join(', ')}`,
      position: 'refute',
    })
  }
  if (findings.length === 0) {
    findings.push({
      check: 'does the manuscript state the method it ran?',
      found: `a Method section whose body names '${named ?? implementationNames[0] ?? 'the implementation'}'`,
      position: 'support',
    })
  }
  return review('red-method', findings)
}

/**
 * Whether every number in the manuscript is one the run produced.
 *
 * @param input - the manuscript and the run's record.
 * @param record - the run's measured quantities, when the run holds a record.
 * @returns the role's review.
 */
function reviewManuscriptNumbers(input: ManuscriptReviewInput, record: MeasuredOutcome | undefined): RoleReview {
  const findings: ReviewFinding[] = []
  if (record === undefined) {
    findings.push({
      check: 'can every number in the manuscript be traced to the run?',
      found: 'the run holds no result record, so no number in the prose can be traced to one',
      position: 'abstain',
    })
    // NOT EVALUATED, not abstained: this check verified nothing, because there was no record to
    // verify against. An abstention is a check that read the material and found it inconclusive.
    return review('red-stat', findings, false)
  }
  const accountable = accountableNumbers(input, record)
  const untraceable: string[] = []
  for (const section of input.sections) {
    // THE REFERENCES SECTION IS NOT PROSE. Its content is a list of identifiers, and the first
    // browser run of this check refused a correct manuscript for citing 47 DOIs — then for a bare
    // catalogue id, an IEEE standard number, a frequency and a year. Each exclusion added to the
    // stripper was a new scheme away from the next false refusal, so the rule is the narrower one:
    // this check reads the sections that state results, and the check that matters for a reference
    // list is `red-citation`, which compares what the prose cites against what the list holds.
    if (section.id === 'references') continue
    for (const [index, value] of quantitiesIn(withoutCitations(section.bodyText)).entries()) {
      if (accountable.has(value)) continue
      // The findings name the section and the value, so a reader can find the sentence. The
      // ordinal is not a quotation: quoting the sentence would put the manuscript's own text into
      // the audit trail, and the number is what a reviewer needs to look for.
      untraceable.push(`${section.id}#${String(index + 1)}=${String(value)}`)
    }
  }
  if (untraceable.length > 0) {
    findings.push({
      check: 'is every number in the manuscript one the run measured?',
      found:
        `numbers the run's record does not account for: ${untraceable.join(', ')} — the record holds `
        + `${record.baselineMinTtcSeconds}, ${record.variantMinTtcSeconds} (s), `
        + `${record.improvementPct} (%) and ${record.stringStabilityIndex}`,
      position: 'refute',
    })
  } else {
    findings.push({
      check: 'is every number in the manuscript one the run measured?',
      found: 'every decimal in the prose matches a quantity in the run’s result record',
      position: 'support',
    })
  }
  return review('red-stat', findings)
}

/**
 * Whether every float and reference the prose cites exists.
 *
 * @param input - the manuscript and the draft's rosters.
 * @returns the role's review.
 */
function reviewManuscriptCitations(input: ManuscriptReviewInput): RoleReview {
  const findings: ReviewFinding[] = []
  const labels = new Set(input.floatLabels.map(label => label.toLowerCase().replace(/\s+/gu, ' ')))
  const cited = new Set<string>()
  for (const section of input.sections) {
    for (const match of section.bodyText.matchAll(/\b(Figure|Fig\.|Table|Equation)\s*(\d+)/giu)) {
      cited.add(`${(match[1] ?? '').replace(/\.$/u, '').toLowerCase()} ${String(Number(match[2]))}`)
    }
  }
  const dangling = [...cited].filter(label => !labels.has(label) && !/^equation \d+$/u.test(label))
  if (dangling.length > 0) {
    findings.push({
      check: 'does every float the prose cites exist in the document?',
      found:
        `cited labels with no float behind them: ${dangling.join(', ')} — the draft carries `
        + input.floatLabels.join(', '),
      position: 'refute',
    })
  }
  // The reference list is checked as a count rather than as a parse: the manuscript's citations are
  // rendered by E1 from the draft's own list, so a section prose-citing `[7]` of a five-entry list
  // is the check that matters, and it is an index comparison.
  const outOfRange: string[] = []
  for (const section of input.sections) {
    for (const match of section.bodyText.matchAll(/\[(\d+)\]/gu)) {
      const index = Number(match[1])
      if (match[1] === undefined || index < 1 || index > input.referenceCount) outOfRange.push(`[${String(index)}]`)
    }
  }
  if (outOfRange.length > 0) {
    findings.push({
      check: 'does every bracketed reference the prose cites exist in the list?',
      found:
        `citations outside the ${String(input.referenceCount)}-entry reference list: `
        + outOfRange.join(', '),
      position: 'refute',
    })
  }
  if (findings.length === 0) {
    findings.push({
      check: 'does every float and reference the prose cites exist?',
      found:
        `${String(cited.size)} float label(s) cited, all present; `
        + `${String(input.referenceCount)} reference(s) available`,
      position: 'support',
    })
  }
  return review('red-citation', findings)
}

/**
 * Whether the manuscript's conclusion claims more than its evidence supports.
 *
 * Three checks, each an exact match rather than a reading: the sign of the measured change against
 * the direction the prose states, the change the prose states against the change the record holds,
 * and a claimed magnitude against the threshold the claim committed to.
 *
 * @param input - the manuscript, the record and the commitment.
 * @param record - the run's measured quantities, when the run holds a record.
 * @returns the role's review.
 */
function reviewManuscriptConclusion(
  input: ManuscriptReviewInput,
  record: MeasuredOutcome | undefined,
): RoleReview {
  const findings: ReviewFinding[] = []
  if (record === undefined) {
    findings.push({
      check: 'does the conclusion claim more than the measurement supports?',
      found: 'the run holds no result record, so nothing measures what the conclusion may claim',
      position: 'abstain',
    })
    // Same distinction as `red-stat` above: nothing was compared, so nothing was evaluated.
    return review('red-claim', findings, false)
  }
  const prose = input.sections.map(section => section.bodyText).join('\n')
  const clause = findingClauseOf(prose, input.metricPhrases)
  if (clause === undefined) {
    // Nothing states a direction with a magnitude, so there is no finding to compare against the
    // record. A gap, not a contradiction — the gate grades the two differently.
    findings.push({
      check: 'does the manuscript state the direction the measurement found?',
      found:
        'no sentence pairs the measured quantity with a percentage, so the manuscript states no '
        + `finding to compare against the record (${String(record.improvementPct)} %)`,
      position: 'abstain',
    })
    return review('red-claim', findings)
  }
  const rose = /\b(?:raise[sd]?|increase[sd]?|higher|greater|improve[sd]?|exceed[sd]?)\b/iu.test(clause)
  const fell = /\b(?:lower(?:s|ed)?|decrease[sd]?|reduc(?:e|es|ed)|less|worse|smaller)\b/iu.test(clause)
  const measuredRose = record.improvementPct > 0
  if (rose && !fell && !measuredRose) {
    findings.push({
      check: 'does the manuscript state the direction the measurement found?',
      found:
        `the prose says the quantity rises while the record measures ${String(record.improvementPct)} %`
        + ' — the direction the manuscript states is the one its own evidence contradicts',
      position: 'refute',
    })
  } else if (fell && !rose && measuredRose) {
    findings.push({
      check: 'does the manuscript state the direction the measurement found?',
      found: `the prose says the quantity falls while the record measures +${String(record.improvementPct)} %`,
      position: 'refute',
    })
  }
  // The threshold the claim committed to, and the bound it declared. A prose claim of "at least
  // N %" where N exceeds what the record supports is an overstatement by the manuscript's own
  // arithmetic, and it is checkable without reading anything.
  if (input.commitment !== undefined) {
    const bound = anchorBoundIn(input.predictionText)
    for (const value of quantitiesIn(clause)) {
      if (!/%/u.test(String(value))) continue
      if (bound === 'at-least' && value > Math.abs(record.improvementPct) && value !== input.commitment.thresholdPct) {
        findings.push({
          check: 'does the manuscript claim a change larger than the one it measured?',
          found:
            `the prose states ${String(value)} % where the record measures `
            + `${String(record.improvementPct)} % and the claim committed to at least `
            + `${String(input.commitment.thresholdPct)} %`,
          position: 'refute',
        })
        break
      }
    }
  }
  if (findings.length === 0) {
    findings.push({
      check: 'does the conclusion claim more than the measurement supports?',
      found: `the direction and the magnitude of the prose match the record (${String(record.improvementPct)} %)`,
      position: 'support',
    })
  }
  return review('red-claim', findings)
}

/**
 * Review a manuscript with every role.
 *
 * @param input - the manuscript and the run data it is checked against.
 * @returns one review per role, in a fixed order.
 */
export function reviewManuscript(input: ManuscriptReviewInput): ReadonlyArray<RoleReview> {
  const record = readResultVersion(input.result)?.measured
  return [
    reviewManuscriptMethod(input.sections, input.implementationNames),
    reviewManuscriptNumbers(input, record),
    reviewManuscriptCitations(input),
    reviewManuscriptConclusion(input, record),
  ]
}

/** The roles {@link reviewManuscript} returns, so a caller can state them without duplicating them. */
export const MANUSCRIPT_REVIEW_ROLES: ReadonlyArray<string> = [
  'red-method',
  'red-stat',
  'red-citation',
  'red-claim',
]
