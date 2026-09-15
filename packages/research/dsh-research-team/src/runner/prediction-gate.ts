/**
 * The discipline that decides whether a claim's own words can be graded against a measurement.
 *
 * WHY THIS IS NOT PART OF THE STUDY. Everything in this module is about the CLAIM: whether its
 * prose names the quantity it declares, whether the anchor and the direction it writes agree with
 * the commitment it declares, and whether a negation leaves the sentence's force unreadable. None
 * of it knows what was measured or how. It lived inside `platoon-sim.ts`, beside a car-following
 * model, because that model was the only study this pipeline had — so a study from any other field
 * would have had to copy the discipline, or import a traffic module to reach it. A study now hands
 * its measurement in through {@link PredictionGateInput.measure} and gets a verdict back.
 *
 * WHAT IT DOES NOT DO, stated here because four rounds of audit established it the hard way:
 *  - It does not judge whether a claim is ABOUT a quantity, only whether it USED the quantity's
 *    words. See {@link MeasuredMetric.phrases}.
 *  - It does not read a number out of a sentence and grade it. The threshold is a DECLARED field;
 *    the prose is checked for agreement with it. See {@link PredictionCommitment.thresholdPct}.
 *  - It does not run the study eagerly. Every claim-level check can refuse a claim without a
 *    measurement, and `measure` is called only after all of them have passed.
 */

/**
 * Whether a larger value of a measured quantity is better or worse.
 *
 * The study consumes this, not this module: it fixes the sign of the comparison the study hands
 * back, so that {@link PredictionMeasurement.relativeImprovementPct} is positive when the study
 * moved the way a better value lies, whatever the quantity is.
 */
export type MetricDirection = 'lower-is-better' | 'higher-is-better'

/** The quantity a study measures, as a claim's words must refer to it. */
export interface MeasuredMetric {
  /** The key a claim declares to bind itself to this quantity. */
  readonly key: string
  /** Display label for evidence strings. */
  readonly label: string
  /** Whether a larger value of this quantity is better or worse. */
  readonly direction: MetricDirection
  /**
   * The phrasings a claim about this quantity must actually use.
   *
   * A declared key alone is SELF-ATTESTATION: a claim whose prose is about something else passes
   * every check if it merely declares the key of the quantity a study measures. This repository
   * had exactly that defect once (a platoon-risk claim declaring the delay key), so the key and
   * the claim's own words must agree.
   *
   * A keyword test cannot establish that a claim is ABOUT a quantity, only that it USED the words,
   * so the check is NECESSARY and not sufficient. It refuses a claim that never names the measured
   * quantity and still admits one that names it in passing. Judging relevance would take a reader
   * or a model, and this repository will not let a model's judgement of a claim stand as the
   * standard for that same claim. The limit is stated, not papered over.
   */
  readonly phrases: ReadonlyArray<string>
}

/**
 * The phrasings a claim about `declaredKey` must use, when a study measures that quantity.
 *
 * The table this replaces was keyed by metric key and closed, so a claim declaring a key the study
 * does not measure had NO phrasings and the checks that read them found nothing to read. That
 * property is preserved here rather than dropped: the caller gets `undefined`, not this study's
 * phrasings, for a claim bound to some other quantity — the C channel refuses such a claim on its
 * own key check, and the reviewer reports the disagreement, and neither should first be told that
 * the claim's prose happens to name the measured quantity's words.
 *
 * @param declaredKey - the quantity key the claim declares.
 * @param metric - the quantity the study measures.
 * @returns the metric's phrasings, or undefined when the claim declares a different quantity.
 */
export function phrasingsFor(
  declaredKey: string,
  metric: MeasuredMetric,
): ReadonlyArray<string> | undefined {
  return declaredKey === metric.key ? metric.phrases : undefined
}

/**
 * The phrasing a claim about a measured quantity uses, if it uses one.
 *
 * @param text - the claim's PREDICTION, as written.
 * @param phrases - the phrasings the measured quantity requires, or undefined when the claim
 *   declares some other quantity.
 * @returns the matched phrase, or undefined when the text names no phrasing of that quantity.
 */
export function claimTextNamesQuantity(
  text: string,
  phrases: ReadonlyArray<string> | undefined,
): string | undefined {
  if (phrases === undefined) return undefined
  const lowered = text.toLowerCase()
  return phrases.find(phrase => lowered.includes(phrase))
}

/** Why a prediction could not be adjudicated, or its verdict when it could. */
export type PredictionAdjudication =
  | {
    readonly kind: 'adjudicated'
    /** True when the measured improvement met the threshold the prediction stated. */
    readonly supportsPrediction: boolean
    readonly improvementPct: number
    readonly thresholdPct: number
    /** The direction the claim DECLARED, which is the one its threshold was graded in. */
    readonly direction: PredictionCommitment['direction']
    /** How the claim relates the threshold to the change; see {@link PredictionCommitment.bound}. */
    readonly bound: PredictionCommitment['bound']
    readonly detail: string
    /** The claim's own phrasing that binds it to the measured quantity. */
    readonly matchedPhrase: string
  }
  | { readonly kind: 'unbindable'; readonly reason: string }

/**
 * What a claim commits the study to — DECLARED, not read out of prose.
 *
 * WHY THIS IS A DECLARED FIELD. It was inferred from the prediction's words, and three rounds of
 * independent audit dismantled that reader one mechanism at a time, each time on the shipped study:
 *
 *   - a fixed comparison direction graded "shall FALL by 20%" backwards, so a measurement that
 *     satisfied the prediction was recorded as negating it, and this batch's `decisive` flag then
 *     advanced the step on that wrong conclusion;
 *   - the fix introduced a false POSITIVE — "shall NOT FALL BY MORE THAN 20%" was read as a floor,
 *     and a 38.20% fall "cleared" a 20% cap it plainly violates;
 *   - the cap was located by a character window, so `under` as an ordinary preposition ("shall
 *     increase under steady free flow by at least 20%") turned a floor into a cap and flipped the
 *     verdict — and adding "the same" to that sentence pushed the word out of the window and flipped
 *     it back;
 *   - cap phrasings outside the list ("by up to N%", "capped at") were read as floors;
 *   - the negation check matched substrings, so `no` inside `normal` or `nonlinear` held a perfectly
 *     gradeable prediction;
 *   - the clause carrying the threshold was located by digit substring, so a year in the sentence
 *     ("reported in 2020") became the carrier and the direction was read from the wrong clause.
 *
 * Every one of those is a way for a WORD TEST to decide a scientific verdict, and the auditor's
 * conclusion was that the reader could not be trusted and should be replaced by something narrower.
 * This is it: the claim DECLARES which way its quantity should move, and the gate grades that
 * declaration. Nothing about the verdict depends on parsing prose.
 *
 * WHAT THE PROSE IS STILL USED FOR, and the limits of each: it must NAME the measured quantity (a
 * keyword check, necessary and not sufficient — a claim can still name a quantity in passing), and
 * it must STATE the threshold (the first `\d+%` in it, which is unambiguous). Neither decides a
 * direction.
 *
 * A claim that declares no commitment HOLDS. That is the same fail-closed answer an unstated metric
 * key gets, and it is the same demand: a study has to say what it is testing.
 */
export type PredictionDirection = 'increase' | 'decrease'

export interface PredictionCommitment {
  /** Which way the claim says the measured quantity should move. */
  readonly direction: 'increase' | 'decrease'
  /**
   * How the stated threshold relates to the change.
   *
   * THREE VALUES, not a boolean, and the third is why. `bounded: boolean` could express "at least"
   * and "at most" and nothing else, so a claim with a TWO-SIDED tolerance — "shall stay within 20%
   * of the baseline" — had to be declared as one of them, and an audit showed the result: declared
   * `at most`, measured a 38.20% fall, graded `-38.20 <= 20` → SUPPORTED, for a claim a 38% fall
   * plainly violates. The declaration was HONEST and the model could not express it. That is the
   * only one of the audit's boundaries that produced a false positive on its own.
   *
   *   at-least : met when the change in `direction` is `>= threshold`  ("by at least 20%")
   *   at-most  : met when it is `<= threshold`                          ("by no more than 20%")
   *   within   : met when `|change| <= threshold`                       ("within 20%")
   *
   * `direction` IS A SIGN HERE, NOT A REQUIREMENT, and the three lines above are the whole of what
   * is graded. `at-most` and `within` compare a signed or an absolute value, so a change in the
   * OPPOSITE direction can satisfy the bound, and the prose is still REQUIRED to state a direction
   * word that the verdict then does not read. Measured by an audit on one −38.20% measurement:
   * declared `{increase, at-most, 20}` grades `supportsPrediction: true`, and under `within` the
   * direction word has no effect at all — "shall rise within 40%" and "shall fall within 40%" grade
   * identically. A claim that means "shall increase by at most 20%" cannot be expressed here; the
   * recording of that is this paragraph, not an implementation.
   */
  readonly bound: 'at-least' | 'at-most' | 'within'
  /**
   * The percentage the claim commits the measured quantity to move by.
   *
   * THE THIRD DECLARED FIELD, and the last one this gate needed. The threshold used to be PARSED
   * from the sentence, and a sentence can state a percentage that belongs to a different quantity:
   * with the declaration held fixed and only the prose number changed, the verdict flipped (5% and
   * 20% supported, 99% refuted), so the gate was grading a threshold the claim had never put on the
   * quantity it is about. Declaring it takes the prose out of the verdict; the prose still has to
   * state this number, and `evaluatePrediction` says why that check survives and what it is worth.
   */
  readonly thresholdPct: number
}

/**
 * What a study measured, in the only two terms this gate grades.
 *
 * A CLOSED PAIR rather than two optional fields, so that "there was nothing to compare" cannot be
 * represented without the study saying why. The reason is the STUDY's to write: this module does not
 * know what a collision is, or what the two arms are called, and inventing a sentence about either
 * would be exactly the kind of guessing the rest of this file exists to remove.
 */
export type PredictionMeasurement =
  | {
    /** The study produced a number the claim's threshold can be graded against. */
    readonly isComparable: true
    /**
     * How much better the variant is than the baseline, as a percentage of the baseline, positive
     * in the direction a better value lies. This is the ONLY number the verdict compares.
     */
    readonly relativeImprovementPct: number
    /** Both arms' measured values, named, for the verdict's detail line. */
    readonly armsDetail: string
  }
  | {
    readonly isComparable: false
    /**
     * Why the study produced nothing to compare, in the study's own terms.
     *
     * A "nothing to compare" result is NOT the same fact as "the variant is no better", and the
     * two must not collapse into one: the C channel refuses to grade an incomparable measurement
     * rather than reporting the claim as refuted by it.
     */
    readonly reason: string
  }

/**
 * The literal an anchor's text uses, and the bound it asserts.
 *
 * WHY A LITERAL AND NOT A READING. The gate grades three declared fields — direction, bound and
 * threshold — and nothing tied them to the claim's sentence — an audit demonstrated that changing
 * ONE declared field records a claim its own sentence refutes as supported, with no wordplay.
 * Its proposed fix is this: require the sentence to carry a MACHINE-READABLE anchor beside the
 * number, and compare the declared bound to that token by STRING EQUALITY. That is wire-format
 * validation, not reading: there is no heuristic here, only whether one string equals another.
 *
 * The cost is one fixture edit — the pack's sentence says "by at least 20%" and now says "≥ 20%" —
 * and the gain is that a declaration contradicting the claim's own words stops being invisible.
 */
const ANCHOR_TOKENS: ReadonlyArray<{
  readonly text: string
  readonly bound: PredictionCommitment['bound']
}> = [
  { text: '>=', bound: 'at-least' },
  { text: '≥', bound: 'at-least' },
  { text: 'at least', bound: 'at-least' },
  { text: '<=', bound: 'at-most' },
  { text: '≤', bound: 'at-most' },
  { text: 'at most', bound: 'at-most' },
  { text: 'within', bound: 'within' },
]

/**
 * Words whose presence makes a prediction UNGRADEABLE, whatever else it says.
 *
 * THE FALSE POSITIVE THIS CLOSES, and an auditor built it after I claimed the opposite. The
 * direction and bound anchors compare WORDS to a declaration, and a word test cannot see a
 * sentence's POLARITY:
 *
 *   "The insertion of one AV shall NOT cause the platoon minimum time-to-collision to FALL by
 *    ≥ 20% relative to the all-HV baseline."
 *
 * That is a PROHIBITION, and a 38.20% fall violates it. But `fall` reads as `decrease`, `≥` reads
 * as `at-least`, and BOTH agree with a declaration of `{direction: 'decrease', bound: 'at-least'}`
 * — so the gate graded the prohibition as a requirement and reported `supported`. A prohibition and
 * a requirement share the same number and the same comparison operator; only the sentence's force
 * differs, and nothing in this model carries force.
 *
 * So a negation stops the grading instead of being interpreted. It can only produce a HOLD, never
 * a verdict, which is the property the previous claim lacked — the claim was that a mismatch could
 * only make the gate stricter, and this counterexample is what refuted it.
 *
 * The word boundaries also close the reported `no`-inside-`normal` and `not`-inside-`note`
 * substring problem, which a bare `includes` had.
 *
 * THE CONSEQUENCE, stated rather than discovered: the cap anchors written as negations
 * (`no more than`, `not exceed`) are no longer reachable and are gone from the table. A claim has
 * to be a POSITIVE directional statement — "shall rise by at most 20%", not "shall not exceed
 * 20%" — and a prohibition cannot be written in the GRADED path. Two forms carry no listed
 * negation word and still reach a verdict; they are recorded under `anchorForms.prohibitionLimits`
 * on the claim artifact rather than left to be rediscovered.
 */
const POLARITY_WORDS = /\b(?:not|no|never|without)\b|n['’]t/iu

/**
 * Whether a prediction carries a negation, read over the WHOLE sentence.
 *
 * The C gate holds on this, and the red team abstains on the same condition, so both read it from
 * here rather than keeping a second copy of the word list. Scoping it to the clause that names the
 * measured quantity was tried and refuted: a prohibition keeps the required shape inside that clause
 * ("…shall fall by at least 20%") and can put its negation anywhere else, which reached a verdict of
 * SUPPORTED on a measured 38.20% fall. See `POLARITY_WORDS` for the word list, and
 * `evaluatePrediction` for the honest sentences this whole-sentence read refuses.
 *
 * @param predictionText - the falsifiable prediction, whole.
 * @returns true when any listed negation word appears in it.
 */
export function carriesNegation(predictionText: string): boolean {
  return POLARITY_WORDS.test(predictionText)
}

/**
 * The shape a prediction must have for its direction to be gradeable: `shall <direction word>`.
 *
 * WHY A SHAPE, NOT A LONGER LIST. The guard above is a BLACKLIST, and an auditor showed it cannot
 * be complete: it folded no case, so `Not fall` and `NOT FALL` walked past it — an emphasised
 * prohibition ran the pipeline to a `supported` verdict while the lower-case form was held. Fixing
 * the case left what that auditor then pointed at: "shall REFRAIN FROM falling by at least 20%" is
 * a prohibition with no word on any list, and no list enumerates every way English forbids
 * something.
 *
 * So the polarity is not DETECTED, it is REQUIRED: the direction word must come immediately after
 * `shall`. `shall not fall`, `shall never fall` and `shall refrain from falling` fail the shape and
 * are HELD. It is a wire format, checkable by string comparison, and it needs no understanding of
 * the sentence.
 *
 * THE JUSTIFICATION I FIRST WROTE FOR THIS WAS WRONG, and an auditor refuted it by answering the
 * question I had set it: I claimed a prohibition "has to negate and the negation would occupy that
 * position", so no prohibition could satisfy the shape. English can negate the SUBJECT instead, and
 * then the direction word still follows `shall`:
 *
 *   "Neither platoon shall fall short of the baseline minimum time-to-collision by at least 20%."
 *
 * That is a prohibition, `fall` follows `shall`, no word on the negation list appears, and the
 * declared commitment agrees — so a 38.20% fall was graded as MEETING it. A prohibition APPENDED as
 * a second clause ("…; that outcome is forbidden") evades the shape the same way.
 *
 * These two are KNOWN LIMITS, not open work, and the auditor's reasoning is why: this is a check on
 * the SHAPE of a sentence, not an analysis of its polarity, and extending the word list for
 * `neither` / `nor` / `none` would repeat the mistake the list was abandoned for. What must be
 * right is the STATEMENT, not the mechanism — so the two shapes are recorded here, beside the cost,
 * where the next reader finds them instead of rediscovering them.
 *
 * WHY IT IS STILL WORTH HAVING. Every failure of this check produces a HOLD: a missing direction
 * word, a wrong inflection, an unexpected phrasing, a negated subject — all stop the C channel
 * without a verdict. It cannot hand out a pass for a sentence it failed to understand; the only
 * escapes are the two shapes above, which need a claim deliberately written as a prohibition in
 * one of those two forms. That is a much narrower failure than the reader this batch deleted, whose
 * errors reached a `supports` value from ordinary phrasing.
 *
 * THE COST, stated: a claim reads "<subject> shall <rise|fall|…> … by <anchor> <n>%". Every claim in
 * this repository is written that way; one that is not holds, which is the safe direction, and the
 * hold names the required form.
 */
const REQUIREMENT_SHAPE = /\bshall\s+([a-z]+)/iu

/**
 * The words that commit a prediction to a direction, and which one.
 *
 * THE SYMMETRIC HALF OF THE ANCHOR, and both auditors reached it independently: the anchor bound
 * the THRESHOLD but not the DIRECTION, so a claim whose sentence says the quantity rises could
 * declare `decrease` and be graded as a fall. One auditor ran it end to end — a pack declaring
 * `{direction: 'decrease', bound: 'at-least'}` against the sentence "shall exceed … by ≥ 20%"
 * returned `supports: true` and `verdict: supported` on a measurement of −38.20%. That is the same
 * class as the truthfulness pair the loader now refuses, in the same file, describing the same
 * material.
 *
 * WHAT THIS CAN AND CANNOT DO, corrected. I wrote here that every outcome of this check was either
 * agreement or a HOLD, "so a false match can only make the gate stricter, never hand out a pass" —
 * and an auditor refuted it: a PROHIBITION whose words agree with the declaration was graded as a
 * requirement and PASSED. The claim was false, and the counterexample is recorded at
 * `POLARITY_WORDS` where the guard against it lives.
 *
 * What survives is narrower and is the reason this check is still worth having: it verifies the
 * declaration against the claim's own words, and a disagreement holds. It does NOT establish what
 * the sentence means, and it cannot.
 */
const DIRECTION_TOKENS: ReadonlyArray<{ readonly text: string; readonly direction: PredictionDirection }> = [
  // BASE FORMS ONLY. `shall` takes the infinitive, so a third-person or participle entry can
  // never match the word that follows it: the first version of this table held 18 entries of which
  // 12 (`exceeds`, `rising`, `falls`, `decreases`, …) were unreachable, implying a coverage the
  // gate does not have. An auditor counted them. What remains is what `shall <word>` can actually
  // produce, plus three base forms that were MISSING while their inflected forms sat in the table
  // — `shall reduce`, `shall raise` and `shall drop` all held, and `reduces` was useless.
  { text: 'exceed', direction: 'increase' },
  { text: 'rise', direction: 'increase' },
  { text: 'increase', direction: 'increase' },
  { text: 'grow', direction: 'increase' },
  { text: 'raise', direction: 'increase' },
  { text: 'fall', direction: 'decrease' },
  { text: 'decrease', direction: 'decrease' },
  { text: 'lower', direction: 'decrease' },
  { text: 'reduce', direction: 'decrease' },
  { text: 'drop', direction: 'decrease' },
]

/**
 * The direction the prediction commits to, read from the `shall <word>` position.
 *
 * Searching the whole sentence for a direction word was not enough: an auditor's prohibition
 * ("shall NOT cause the … to FALL by ≥ 20%") contains `fall` and agrees with a `decrease`
 * declaration, so it was graded as a requirement and passed. Reading the word that FOLLOWS `shall`
 * is what makes the difference, because a prohibition's negation occupies that position.
 *
 * @param predictionText - the prediction as written.
 * @returns the direction, or undefined when the sentence does not state one after `shall`.
 */
export function requirementDirectionIn(predictionText: string): PredictionDirection | undefined {
  const match = REQUIREMENT_SHAPE.exec(predictionText)
  if (match === null) return undefined
  const word = match[1]?.toLowerCase()
  return DIRECTION_TOKENS.find(token => token.text === word)?.direction
}

/**
 * The anchor the prediction states beside its threshold, if it states one.
 *
 * The anchor must sit NEAR the number — the twenty characters before it — because an anchor
 * elsewhere in the sentence is not the one the threshold is bound by.
 *
 * @param clause - the clause of the prediction that names the measured quantity.
 * @returns the bound the anchor asserts, or undefined when no single anchor is present.
 */
export function anchorBoundIn(clause: string): PredictionCommitment['bound'] | undefined {
  const lowered = clause.toLowerCase()
  const found = ANCHOR_TOKENS.filter(token => lowered.includes(token.text))
  const distinct = new Set(found.map(token => token.bound))
  // MORE THAN ONE DISTINCT BOUND IS A GAP, NOT A GUESS. The previous version took the first hit by
  // TABLE ORDER inside a 20-character window, so "…by at most, at least 20%" resolved by array
  // position rather than by anything the sentence said. Requiring uniqueness removes that and the
  // character cliff that pushed a correct anchor out of the window ("by at least an additional
  // 20%" held). Both failure directions are HOLD.
  return distinct.size === 1 ? [...distinct][0] : undefined
}

/**
 * Every distinct percentage the prediction states, in order.
 *
 * The verdict does not grade any of them — the threshold is DECLARED. What this supports is the
 * consistency check: the sentence must state the declared number, exactly once. "Over 20% of the
 * simulated interval, the … shall exceed the baseline by at least 35%" states two, so which one the
 * claim meant is a guess, and a guess is a HOLD.
 *
 * @param predictionText - the prediction as written.
 * @returns the percentages, in the order they appear.
 */
export function percentagesIn(predictionText: string): ReadonlyArray<number> {
  return [...predictionText.matchAll(/(\d+(?:\.\d+)?)\s*%/gu)].map(match =>
    Number(match[1]),
  )
}

/**
 * Where one clause ends and the next begins.
 *
 * Punctuation, plus the conjunctions that introduce a new clause. A period between digits is not a
 * boundary, so a decimal or a version is not mistaken for a sentence break.
 */
const CLAUSE_BOUNDARY = /[;,]|(?<!\d)\.(?!\d)|\b(?:while|whereas|because|although|and|but)\b/iu

/**
 * The clause of a prediction that names the quantity this study measures.
 *
 * WHAT THIS IS FOR NOW — scope, not soundness. The anchor, the direction word and the percentage are
 * read from this clause, and NOT from the whole sentence, because a sentence's second clause may
 * legitimately carry its own number or anchor: read over the whole prediction, "…shall fall by at
 * least 20%, and the headway stays within its band" states two anchors and holds, and "…shall rise
 * while the minimum time-to-collision shall fall by at least 20%" is refused for the direction of
 * the WRONG clause. An independent audit measured all three of those as new false refusals of
 * honest sentences, and they are why this function survived.
 *
 * WHAT IT IS NOT. It is not a claim that a literal inside this clause is ABOUT this quantity, and
 * the module no longer makes that claim. Four measured attempts to establish where a number
 * attaches — a wider boundary table, requiring the phrase before the direction structure, requiring
 * it to be an argument of the predicate, and narrowing to one template — all died on the same
 * thing: the distinguishing material is predicate structure, and every literal proxy for it is an
 * open class. `whilst` and `though` are synonyms of two listed boundaries and split nothing; a
 * participial adjunct needs no connective at all; and "…shall lower the platoon minimum
 * time-to-collision thereby reducing the platoon mean headway by at least 20%" is an argument AND
 * binds its number elsewhere.
 *
 * So clause splitting is a heuristic and can cut in the wrong place. When it cuts too finely the
 * literals land in different segments and the result is a HOLD; when it does not cut at all, the
 * number the prose states is still required to EQUAL the declared threshold, and the verdict grades
 * the declaration rather than any number read from the sentence. Both failure directions stop short
 * of the verdict. `PredictionCommitment.thresholdPct` is where the graded number comes from.
 *
 * @param predictionText - the prediction as written.
 * @param phrases - the phrasings the measured quantity requires, or undefined when the claim
 *   declares some other quantity. Absent phrasings select no clause, which is a HOLD.
 * @returns the clause naming the quantity, or undefined when no clause does.
 */
export function measuringClause(
  predictionText: string,
  phrases: ReadonlyArray<string> | undefined,
): string | undefined {
  if (phrases === undefined) return undefined
  return predictionText
    .split(CLAUSE_BOUNDARY)
    .map(part => part.trim())
    .find((part) => {
      const lowered = part.toLowerCase()
      return phrases.some(phrase => lowered.includes(phrase))
    })
}

/**
 * Read a declared commitment out of an artifact, validating its shape.
 *
 * Anything else is the claim declining to say which way its quantity should move, or by how much —
 * which the C channel holds on — rather than a partially-read commitment this function would have
 * to guess at. A commitment without a threshold is not read as the old two-field commitment: the
 * threshold is what the verdict grades, and defaulting it would put a number back into the gate
 * that the claim never declared.
 *
 * @param value - the value found on the claim artifact.
 * @returns the commitment, or undefined when the value is not one.
 */
export function commitmentFrom(value: unknown): PredictionCommitment | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const direction = record['direction']
  const bound = record['bound']
  const thresholdPct = record['thresholdPct']
  if (direction !== 'increase' && direction !== 'decrease') return undefined
  if (bound !== 'at-least' && bound !== 'at-most' && bound !== 'within') return undefined
  if (typeof thresholdPct !== 'number' || !Number.isFinite(thresholdPct) || thresholdPct <= 0) {
    return undefined
  }
  return { direction, bound, thresholdPct }
}

/** Everything the gate needs to judge a claim, with no measurement required. */
export interface PredictionClaimInput {
  /** The claim's falsifiable prediction, whole. */
  readonly predictionText: string
  /** The quantity the study measures. */
  readonly metric: MeasuredMetric
  /**
   * The quantity key the claim DECLARED, if it declared one.
   *
   * Absent, or different from {@link MeasuredMetric.key}, means nothing binds the claim to this
   * study's measurement — and the gate refuses to grade it rather than comparing an unrelated
   * number to a threshold.
   */
  readonly declaredMetricKey?: string | undefined
  /**
   * The claim's DECLARED commitment. PRECONDITION: every write comes from `commitmentFrom` (the
   * Case Pack path and the resume path) or from the A2 fixture literal, so a present commitment is
   * a well-formed one. `case-pack.ts`'s `requireDeclaredCommitment` refuses a malformed pack FILE
   * at load, but it does not write this field — the pack's value still passes `commitmentFrom`
   * before it is assigned. This gate trusts all of that: it checks the declaration against the
   * sentence, not the declaration against its own shape. A caller that ever read one straight off
   * an artifact without going through `commitmentFrom` would be the first to need the shape checks
   * here — and the first for which `no usable threshold` is user-facing.
   */
  readonly commitment?: PredictionCommitment | undefined
}

/** Everything the gate needs to adjudicate one claim. */
export interface PredictionGateInput extends PredictionClaimInput {
  /**
   * Run the study and report what it measured.
   *
   * A CALLBACK, not a value, and that is a property this gate depends on: every claim-level check
   * above can refuse a claim without a measurement, and the measurement is compared LAST. Running
   * it eagerly let a broken run MASK a wording defect — measured against a colliding study, all
   * three wording defects reported the collision instead of themselves. It is also the expensive
   * step in every study this gate has graded. The gate calls it at most once, and only after every
   * claim-level check has passed.
   */
  readonly measure: () => PredictionMeasurement
}

/**
 * Why this claim cannot be graded at all, or undefined when it can.
 *
 * THE CLAIM-LEVEL HALF OF {@link evaluatePrediction}, exported because a caller can need it
 * without a measurement. The direction proposal a person is about to confirm is exactly that
 * caller: it has no study to run, and it must refuse an ungradeable claim BEFORE a person commits
 * to it rather than after a run stalls on it. Supplying a fake measurement to reach these checks
 * would make that caller depend on the measurement half it is trying not to run.
 *
 * Every check here reads the claim and nothing else: the binding, the metric's words, the clause
 * that carries them, the declared commitment, the stated threshold, the polarity, the anchor and
 * the direction. A returned reason is a HOLD — the same fail-closed answer the C channel gives,
 * never a verdict.
 *
 * @param input - the claim, the quantity it is graded against, and what it declares.
 * @returns the reason it cannot be graded, or undefined when it can.
 */
export function claimRejectionOf(input: PredictionClaimInput): string | undefined {
  const { predictionText, metric, declaredMetricKey, commitment } = input
  // The binding is checked FIRST. A prediction about a quantity this study does not measure
  // cannot be adjudicated however many percentages it states, and grading it would report an
  // untested claim as supported or refuted.
  if (
    declaredMetricKey === undefined ||
    declaredMetricKey === '' ||
    declaredMetricKey !== metric.key
  ) {
    return declaredMetricKey === undefined || declaredMetricKey === ''
      ? `the claim declares no metric, so nothing binds it to the quantity this study measures (${metric.label})`
      : `the claim is about "${declaredMetricKey}" while this study measures "${metric.key}" (${metric.label}), so the measurement cannot adjudicate it`
  }
  if (claimTextNamesQuantity(predictionText, metric.phrases) === undefined) {
    return `the claim declares the metric "${declaredMetricKey}" but the prediction it commits to does not name `
      + `that quantity (no phrasing of ${metric.label} appears in it), so the declaration `
      + 'is unverified and the measurement cannot adjudicate it'
  }
  // The literals are read from the clause naming the measured quantity, not from the whole
  // sentence: a second clause may legitimately carry its own number or anchor, and an audit measured
  // three honest sentences that a whole-sentence read refuses. See `measuringClause` for what this
  // scoping is and, more importantly, what it is NOT — the verdict grades the declaration, so a
  // number the prose attached elsewhere no longer reaches it.
  const clause = measuringClause(predictionText, metric.phrases)
  if (clause === undefined) {
    // UNREACHABLE AS THE TABLES STAND, and kept for when that stops being true. The check above
    // matched a phrase from the same list this call searches, and no phrase contains a
    // CLAUSE_BOUNDARY match, so the split cannot cut the matched phrase in two — measured: 0 of 9
    // phrases are splittable, and a 66-text sweep found no text where the two disagree. It stays
    // because the phrase list and the boundary table are edited independently: a phrase that ever
    // gains a boundary word makes this call return undefined, and without the branch the caller
    // would throw on `percentagesIn(undefined)` instead of HOLDING. The spec pins the list.
    return `the measurement cannot adjudicate the prediction: no clause of it names ${metric.label}`
  }

  // The commitment is DECLARED, not inferred. See `PredictionCommitment` for why the inference was
  // removed rather than narrowed again.
  if (commitment === undefined) {
    return `the claim is about ${metric.label} and states a threshold, but declares no `
      + 'commitment, so nothing says which way the quantity is supposed to move — a study has to '
      + 'state what it is testing, exactly as it has to declare the quantity itself'
  }
  const { direction, bound, thresholdPct } = commitment
  // The prose must STATE the declared threshold, exactly once. This is an equality between two
  // values, not a reading of the sentence — which is why it survives the deletion above. It can see
  // that the number the claim wrote is the number the claim declared; it cannot see which quantity
  // that number was written about, and after four measured attempts neither can any literal rule.
  // A prose number that differs contradicts the declaration; none at all means the claim never
  // committed in writing.
  const statedPercentages = percentagesIn(clause)
  // The declared number as the sentence may state it. A commitment that reached here without one
  // would otherwise be described as "a threshold of undefined%" — a sentence about a number the run
  // never had. The parameter type says that cannot happen; this is what the message reads if a value
  // off the durable boundary ever gets past the reader that validates it.
  // A bare `typeof === 'number'` is too weak: NaN and Infinity would render as "a threshold of
  // NaN%", the sentence this exists to remove. The predicate is the doors' ONE TEST SHORT OF ITS
  // POSITIVITY CLAUSE — `typeof === number && Number.isFinite`, without `> 0` — because a finite
  // non-positive number is printed as itself: it is a number the claim did declare, and the doors
  // are what refuse it. What this guard is, exactly: MESSAGE HYGIENE, not a second line of boundary
  // defence — a value that bypassed those readers is refused by the percentage check below
  // (`statedPercentages[0] !== thresholdPct` holds, so the function returns `unbindable`), and it
  // never reaches the graded comparison. This decides only what the message says.
  const declaredThreshold =
    typeof thresholdPct === 'number' && Number.isFinite(thresholdPct)
      ? `${String(thresholdPct)}%`
      : 'no usable threshold'
  if (statedPercentages.length !== 1 || statedPercentages[0] !== thresholdPct) {
    return `the claim declares ${declaredThreshold}, while its own prediction states `
      + `${statedPercentages.length === 0 ? 'none' : `${statedPercentages.map(String).join(', ')}%`} `
      + '— the declaration and the sentence contradict each other, so the claim is not gradeable as stated'
  }
  // POLARITY FIRST. A negation makes the sentence ungradeable whatever its words say, because the
  // model cannot tell a prohibition from a requirement — see `POLARITY_WORDS` for the counterexample
  // that refuted the previous claim that a mismatched anchor could only ever be stricter.
  // NOT SCOPED TO THE CLAUSE, and that was measured rather than assumed. Reading this over the
  // clause alone was tried, to admit a negation in a SECOND clause ("…shall rise by at least 20%,
  // and the mean headway must not exceed its band"). An audit refuted it with three shapes — the
  // negation BEFORE the measuring clause, AFTER a semicolon, and in a TRAILING clause — where the
  // prohibition kept its required shape inside the clause and the gate reported
  // `supportsPrediction: true` on a measured 38.20% FALL. A whole-sentence read refuses those
  // honest sentences too, and that is the correct direction: a false refusal is a HOLD the author
  // fixes by writing positively, while a false pass publishes a refuted claim as supported.
  if (carriesNegation(predictionText)) {
    return 'the prediction contains a negation, so whether it states a requirement or a PROHIBITION '
      + 'cannot be read from it — this model can only grade a positive statement of the direction '
      + 'the quantity should move'
  }

  // The declaration must agree with the claim's OWN anchor literal, compared as strings. This is
  // the wire-format check an audit proposed in place of reading the sentence: it needs no
  // comprehension, and a mismatch is a positive contradiction — the same class as a declared
  // metric that disagrees with the measured one — so the claim is not gradeable as stated.
  const anchorBound = anchorBoundIn(clause)
  if (anchorBound === undefined) {
    return 'the prediction carries no anchor, or carries more than one '
      + `(accepted: ${ANCHOR_TOKENS.map(token => token.text).join(', ')}), so nothing in the claim's `
      + 'own words says how the number relates to the change'
  }
  if (anchorBound !== bound) {
    return `the claim declares bound "${bound}" while its own prediction anchors the threshold with `
      + `"${anchorBound}" — the declaration and the sentence contradict each other, so the claim is `
      + 'not gradeable as stated'
  }
  // ...and the DIRECTION must agree with the sentence too. Absent or ambiguous is a gap; a
  // disagreement is the contradiction. Neither can produce a verdict, which is the property that
  // separates this from the reader this batch deleted.
  const namedDirection = requirementDirectionIn(clause)
  if (namedDirection === undefined) {
    return 'the prediction does not state its direction in the required form ("shall rise", "shall '
      + 'fall" and the other direction words), so whether it requires a change or PROHIBITS one '
      + 'cannot be read from it — a claim has to be a positive statement'
  }
  if (namedDirection !== direction) {
    return `the claim declares direction "${direction}" while its own prediction says the quantity `
      + `should ${namedDirection} — the declaration and the sentence contradict each other, so the `
      + 'claim is not gradeable as stated'
  }
  return undefined
}

/**
 * Adjudicate one prediction against what the study measured.
 *
 * This is the single source the C1 executor and the C gate both consume, so the artifact and the
 * verdict can never disagree: they are the same measurement.
 *
 * @param input - the claim, the quantity it is graded against, and how to run the study.
 * @returns the verdict, or why the prediction could not be adjudicated.
 */
export function evaluatePrediction(
  input: PredictionGateInput,
): PredictionAdjudication {
  const { predictionText, metric, commitment, measure } = input
  const rejection = claimRejectionOf(input)
  if (rejection !== undefined) return { kind: 'unbindable', reason: rejection }
  // Past the claim-level checks, so the metric's words are present and the declaration agrees with
  // the sentence. `claimRejectionOf` returned undefined, which means the phrase is there; this
  // recomputes it rather than widening that function's return to carry the verdict's own fields.
  const matched = claimTextNamesQuantity(predictionText, metric.phrases) as string
  const { direction, bound, thresholdPct } = commitment as PredictionCommitment

  // THE MEASUREMENT IS COMPARED LAST, AFTER EVERY CLAIM-LEVEL CHECK. Two reasons, and the second
  // is the one that matters: it is the expensive step in every study, and it is the only check here
  // whose defect is not the claim's. A sentence that declares no commitment, or contradicts its own
  // declaration, is ungradeable whatever the experiment did — the same principle the metric-binding
  // check states at the top of this function ("cannot be adjudicated however many percentages it
  // states"). Running the comparison first let a collision MASK those defects: measured against the
  // colliding fixture in the specs, all three wording defects reported the collision instead.
  const measurement = measure()
  if (!measurement.isComparable) {
    // Fail-closed: this study produced nothing the threshold can be graded against, so there is no
    // ratio to test it with. Grading it would report "the prediction was refuted" for a measurement
    // that never happened. The study says why, in its own terms.
    return { kind: 'unbindable', reason: measurement.reason }
  }
  const improvementPct = measurement.relativeImprovementPct
  // What is graded is the change the CLAIM asked for, in the claim's own direction. The study signs
  // `relativeImprovementPct` so that a positive number is a move toward a better value, which is a
  // fact about the QUANTITY — so a claim's direction word and the study's sign only agree when the
  // metric's own direction is taken into account. Reading the direction word against the improvement
  // sign directly is the shipped study's convention (`higher-is-better`) written as if it were the
  // only one: a "shall lower the latency" claim on a lower-is-better metric would have been graded as
  // asking for the opposite, and reported refuted by a measurement that met it.
  const towardsBetter =
    (direction === 'increase') === (metric.direction === 'higher-is-better')
  // This is the line whose absence let the gate report a met prediction as a negated one.
  const inClaimDirection = towardsBetter ? improvementPct : -improvementPct
  // A CAPPED prediction is met by staying under the cap, not by clearing it. Grading both the same
  // way reported a prediction that a 38.20% fall plainly violates as SUPPORTED.
  const supportsPrediction =
    bound === 'at-least'
      ? inClaimDirection >= thresholdPct
      : bound === 'at-most'
        ? inClaimDirection <= thresholdPct
        : // A two-sided tolerance, which `bounded: boolean` could not express at all.
        Math.abs(inClaimDirection) <= thresholdPct
  return {
    kind: 'adjudicated',
    matchedPhrase: matched,
    supportsPrediction,
    improvementPct,
    thresholdPct,
    direction,
    bound,
    detail:
      `the study ${supportsPrediction ? 'met' : 'missed'} the stated threshold: the claim predicts the ` +
      `quantity should ${direction} (threshold ${bound}), and the measurement moved ${improvementPct.toFixed(2)}% ` +
      `(i.e. ${inClaimDirection.toFixed(2)}% in the direction the claim asked for) against the required ` +
      `${String(thresholdPct)}% of ${metric.label} ` +
      `(${measurement.armsDetail})`,
  }
}
