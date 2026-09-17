// @deepseek-ai/dsh-research-team — the quality baseline a paper is read against.
//
// WHY A BASELINE AND NOT A NUMBER. "The paper is better" is not checkable, and a system that grades its
// own output with a score it invented can always report progress. What IS checkable is a small set of
// defects that make a manuscript wrong in ways a reader would not notice: an object the text never
// refers to, a statement about the literature with nothing behind it, and a result described in the
// wrong direction. Each is an exact comparison against the run's own records — the same discipline the
// gates use — so the baseline reports findings rather than opinions.
//
// WHAT THIS IS NOT. It is not a review, and it does not judge science: it cannot tell whether a claim
// is interesting, whether a method suits a question, or whether the literature it cites agrees. Those
// are the reviewing roles' work, and where they need reading, this says so by staying silent.
//
// THE FIXTURES ARE THE CONTRACT. A rule that never fires on a defective manuscript and one that fires
// on every manuscript look the same without both directions tested, which is why the spec beside this
// module drives each rule with a crafted positive and a crafted negative. The shipped run is an INPUT,
// never a golden example: its own output is exactly what the baseline exists to criticise.

/** What the baseline found, and what kind of thing it is. */
export type PaperQualityFindingCode =
  /** A float, table or equation the manuscript carries and the prose never refers to. */
  | 'uncited-object'
  /** An object the prose refers to and the document does not carry. */
  | 'unrendered-object'
  /** A statement about the literature with no citation attached to it. */
  | 'unsupported-statement'
  /** A result described in a direction its own measurement contradicts. */
  | 'metric-misread'
  /** A bibliography the prose never uses: the paper carries references and cites none in its text. */
  | 'no-literature-position'

/** One defect, located and evidenced. */
export interface PaperQualityFinding {
  readonly code: PaperQualityFindingCode
  /** Where a reader would go to fix it: a section heading, or the object's name. */
  readonly where: string
  /** One sentence a reader can act on. */
  readonly detail: string
  /** The text or value the finding rests on, so it can be checked rather than believed. */
  readonly evidence: string
}

/** One section of the manuscript as the baseline reads it. */
export interface QualitySection {
  /** Stable section id, e.g. `introduction`. */
  readonly id: string
  readonly heading: string
  readonly bodyText: string
}

/** What the run recorded about the metric the paper reports. */
export interface QualityMetric {
  /** The metric's own name, as the run registered it. */
  readonly name: string
  /** Which way is better, in the run's words, e.g. `higher is better`. */
  readonly direction: string
  /**
   * The measured change, in per cent, signed in the metric's own units.
   *
   * A negative value means the metric FELL. Whether that is good or bad is what `direction` says,
   * and keeping the two apart is the whole reason this field is signed.
   */
  readonly changePct: number
}

/** Everything the baseline reads about one manuscript. */
export interface PaperQualityInput {
  readonly sections: ReadonlyArray<QualitySection>
  /** What the document carries, split by whether the prose refers to it. */
  readonly crossReferences: {
    readonly cited: ReadonlyArray<string>
    readonly uncited: ReadonlyArray<string>
  }
  /** Objects the prose refers to that the document does NOT carry. */
  readonly floatsNotRendered: ReadonlyArray<string>
  /** How many references the document carries, so "cites nothing" can be told from "has nothing". */
  readonly referenceCount: number
  /** The metric the paper reports, when the run registered one. */
  readonly metric?: QualityMetric
}

/** Statements about the literature, as verbs that claim a source rather than a result. */
const LITERATURE_CLAIM = new RegExp(
  [
    '(?:has|have|had)\\s+been\\s+(?:shown|reported|found|demonstrated|proposed|observed|established)',
    'studies\\s+(?:show|report|find|suggest|demonstrate)',
    'prior\\s+work',
    'the\\s+literature',
  ].join('|'),
  'iu',
)

/** A bracketed citation label, as the manuscript writes one. */
/**
 * What counts as a citation in a section's text.
 *
 * TWO SYNTAXES, ONE FACT. A section the writer produced carries the cite key it was told to emit
 * (`[@cite-10.1016/...]`) and E1 prints those as the numbers the reference list assigns (`[1]`), so
 * the same sentence reads one way in the draft and another in the assembled manuscript. A baseline
 * that knew only the numbers reported this run's Introduction as citing nothing — two findings
 * against a paper that cites three sources — because it was reading the draft.
 */
const CITATION_LABEL = /(?:\[\d+\]|\[@[^[\]\s]+\])/u

/** A percentage in the prose, with its sign written either as a word or by the verb around it. */
const PERCENT = /(\d+(?:\.\d+)?)\s*%/gu

/** Words that say the metric ROSE, and words that say it FELL. */
// `up` and `down` ALONE ARE NOT DIRECTION WORDS: the first run of this baseline against the shipped
// manuscript flagged a correct sentence reporting a -38.20% change, because it said the platoons were
// run after a 120 s warm-`up`. A rule that reads compounds as measurements is a rule a reader learns
// to ignore, so the bare prepositions are gone and only verbs and comparatives remain.
const ROSE = /\b(?:raise[sd]?|raising|increase[sd]?|increasing|higher|rose|rises?|grew|grows)\b/iu
const FELL = /\b(?:lower(?:s|ed|ing)?|reduce[sd]?|reducing|decrease[sd]?|decreasing|fell|falls?|drop(?:s|ped)?)\b/iu

/** Words that say the change is GOOD, and words that say it is BAD, for the metric's direction. */
const BETTER = /\b(?:improve[sd]?|improving|better|safer|gains?|gained|beneficial)\b/iu
const WORSE = /\b(?:worse|worsen(?:s|ed|ing)?|degrade[sd]?|degrading|harmful|riskier)\b/iu

/** Split a section body into sentences, near enough for a rule that reads one at a time. */
function sentencesOf(text: string): ReadonlyArray<string> {
  return text
    .split(/(?<=[.!?])\s+/u)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length > 0)
}

/**
 * Judge one manuscript against the records behind it.
 *
 * @param input - the manuscript, the objects it carries, and the metric it reports.
 * @returns one finding per defect, in the order the sections appear. An empty list means the baseline
 *   found nothing — never that the paper is good.
 */
export function reviewPaperQuality(input: PaperQualityInput): ReadonlyArray<PaperQualityFinding> {
  const findings: PaperQualityFinding[] = []

  // OBJECTS THE DOCUMENT CARRIES AND THE TEXT NEVER USES. A figure nobody refers to is not a figure:
  // it is decoration a reader has to interpret alone, and it is usually a sign that the section it
  // was meant to serve lost its argument.
  for (const object of input.crossReferences.uncited) {
    findings.push({
      code: 'uncited-object',
      where: object,
      detail: `the manuscript carries ${object} and no sentence in it refers to that object`,
      evidence: `uncited: ${input.crossReferences.uncited.join(', ')}`,
    })
  }

  // OBJECTS THE TEXT USES AND THE DOCUMENT DOES NOT CARRY. The opposite defect, and the worse one:
  // the reader is sent to something that is not there.
  for (const object of input.floatsNotRendered) {
    findings.push({
      code: 'unrendered-object',
      where: object,
      detail: `the prose refers to ${object} and the document does not carry it`,
      evidence: `not rendered: ${input.floatsNotRendered.join(', ')}`,
    })
  }

  // A PAPER THAT CARRIES A BIBLIOGRAPHY AND USES NONE OF IT HAS NOT POSITIONED ITSELF. This is the
  // defect the baseline found in the shipped pipeline's own output — a References section with works
  // in it, and not one sentence anywhere in the text that draws on them. It is not a formatting
  // problem: a reader cannot tell what the work builds on or what it is answering, and no amount of
  // citation-style checking can see it. The rule needs both halves: a bibliography to have, and a
  // text that never uses it.
  const citesInText = input.sections
    .filter(section => section.id !== 'references' && section.heading.toLowerCase() !== 'references')
    .some(section => CITATION_LABEL.test(section.bodyText))
  if (input.referenceCount > 0 && !citesInText) {
    findings.push({
      code: 'no-literature-position',
      where: 'the manuscript',
      detail: `the document carries ${String(input.referenceCount)} reference(s) and no sentence in the`
        + ' text cites any of them, so the paper never says what it builds on',
      evidence: `references: ${String(input.referenceCount)}, citations in text: 0`,
    })
  }

  for (const section of input.sections) {
    // THE REFERENCES LIST IS WHERE CITATIONS LIVE, not where they are claimed.
    if (section.id === 'references' || section.heading.toLowerCase() === 'references') continue
    for (const sentence of sentencesOf(section.bodyText)) {
      // A STATEMENT ABOUT THE LITERATURE HAS TO POINT AT SOMETHING. The rule reads verbs, not meaning:
      // it fires when a sentence claims what prior work showed and carries no label, and it stays
      // silent about everything else — a false positive here would train a reader to ignore it.
      if (LITERATURE_CLAIM.test(sentence) && !CITATION_LABEL.test(sentence)) {
        findings.push({
          code: 'unsupported-statement',
          where: section.heading,
          detail: 'this sentence says what prior work showed and cites nothing',
          evidence: sentence,
        })
      }

      const misread = metricMisread(sentence, input.metric)
      if (misread !== undefined) {
        findings.push({
          code: 'metric-misread',
          where: section.heading,
          detail: misread.detail,
          evidence: sentence,
        })
      }
    }
  }

  return findings
}

/**
 * Whether one sentence describes the measured change in a direction the measurement contradicts.
 *
 * IT READS ONE NUMBER: the sentence must quote the change the run measured, in per cent, or it is not
 * about that result at all. That is what keeps the rule from firing on the threshold, on a baseline
 * value, or on any other figure the manuscript is entitled to state.
 *
 * @param sentence - one sentence of the manuscript.
 * @param metric - the metric the run registered, when it registered one.
 * @returns the reason it misreads the metric, or undefined.
 */
function metricMisread(
  sentence: string,
  metric: QualityMetric | undefined,
): { readonly detail: string } | undefined {
  if (metric === undefined) return undefined
  const quotes = [...sentence.matchAll(PERCENT)].map(match => Number.parseFloat(match[1] ?? ''))
  if (!quotes.some(value => Math.abs(Math.abs(value) - Math.abs(metric.changePct)) < 0.05)) return undefined

  const betterIsUp = /higher/iu.test(metric.direction)
  const measuredUp = metric.changePct > 0
  const saysRose = ROSE.test(sentence)
  const saysFell = FELL.test(sentence)
  const saysBetter = BETTER.test(sentence)
  const saysWorse = WORSE.test(sentence)

  // A direction word that contradicts the measurement: the sentence says the metric went up and the
  // record says it went down.
  if (saysRose && !saysFell && !measuredUp) {
    return {
      detail: `this sentence says ${metric.name} rose, and the run measured it falling by `
        + `${Math.abs(metric.changePct).toFixed(2)}%`,
    }
  }
  if (saysFell && !saysRose && measuredUp) {
    return {
      detail: `this sentence says ${metric.name} fell, and the run measured it rising by `
        + `${Math.abs(metric.changePct).toFixed(2)}%`,
    }
  }
  // A valence word, which is where the real damage is: a change in the wrong direction described as
  // an improvement. `higher is better` plus a fall is not an improvement, however the sentence reads.
  const improved = measuredUp === betterIsUp
  const moved = `${metric.name} moved ${Math.abs(metric.changePct).toFixed(2)}%`
  if (saysBetter && !saysWorse && !improved) {
    return {
      detail: `this sentence calls the change an improvement, and ${moved} in the direction the`
        + ` metric says is worse (${metric.direction})`,
    }
  }
  if (saysWorse && !saysBetter && improved) {
    return {
      detail: `this sentence calls the change a worsening, and ${moved} in the direction the`
        + ` metric says is better (${metric.direction})`,
    }
  }
  return undefined
}
