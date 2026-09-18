// @deepseek-ai/dsh-research-team — which study this is, and which journal it is being written for.
//
// TWO CONFIGURATIONS, KEPT APART. The research TYPE says what kind of study is being run and therefore
// which metrics it has at all. The JOURNAL profile says what a particular venue requires of the
// document. Neither belongs in the other: a traffic metric is not a rule, and a word limit is not a
// research type.
//
// A JOURNAL RULE IS ONLY A RULE IF SOMEBODY READ IT. Every rule carries the page it came from, the
// date it was read and the article type it applies to, and a rule without a source is refused rather
// than accepted: a profile that could state a rule it did not verify would silently enforce somebody's
// guess on every manuscript.
//
// THREE FINDINGS, AND THE DIFFERENCE BETWEEN THEM IS THE POINT. `verified` — the guide was read and
// states this. `not_specified` — the guide was READ and requires nothing, which is a finding rather
// than a gap. `unknown` — nobody has read the guide for this subject, which is what a venue whose
// guide could not be obtained leaves behind, and the only state that refuses a submission. TRC was in
// the third state until 2026-09-18, when the user obtained the official text; its rules are now read
// from it, and `unreadRulesFor` keeps the third state expressible for the next venue.

import { METRIC_REGISTRY, metricsFor } from './metrics.ts'
import type { MetricDefinition, ResearchType } from './metrics.ts'

/** One rule a venue states, with where it was read. */
export interface JournalRule {
  /** Stable id, e.g. `abstract-word-limit`. */
  readonly id: string
  /** The rule as the venue states it, or the subject it governs when nobody has read it. */
  readonly statement: string
  /** Where it was read: a URL, and the date it was read. Never empty, never a guess. */
  readonly source: string
  /** When that page was read, ISO 8601 date. */
  readonly accessedAt: string
  /** The article type this applies to, as the guide names it. */
  readonly articleType: string
  /**
   * What reading the guide established about this rule.
   *
   * `'verified'` — somebody read the requirement and `condition` states it in the guide's own terms.
   * `'unknown'` — the guide has not been read for this, usually because it could not be obtained.
   * `'not_specified'` — THE GUIDE WAS READ AND STATES NO REQUIREMENT. That is a finding, not a gap:
   * the user's guidance of 2026-09-18 requires it rather than leaving an unread rule to look the same
   * as a venue that has no rule. A rule is never `'verified'` because it seems obvious.
   */
  readonly verification: 'verified' | 'unknown' | 'not_specified'
  /** The condition a manuscript must meet, what attempting the page produced, or why nothing is stated. */
  readonly detail: string
  /** Where in the guide this was read — a heading, so a reader can check the rule against its sentence. */
  readonly readAt?: string
}

/**
 * The official guide these rules were read from, and the date they were read.
 *
 * ONE HOME FOR THE SOURCE: every rule in {@link TRC_PROFILE} cites it, so a reader checking a rule
 * against its sentence goes to one place — the retrieved text, preserved with its own provenance at
 * `plan/venue/trc-guide-for-authors.md`. Two rules read from two copies of a guide are two rules.
 */
const GUIDE =
  'https://www.sciencedirect.com/journal/transportation-research-part-c-emerging-technologies/publish/guide-for-authors'

/** The date the guide above was read; see {@link GUIDE}. */
const READ_ON = '2026-09-18'

/** A venue's requirements, as far as anyone has verified them. */
export interface JournalProfile {
  readonly id: string
  readonly name: string
  /**
   * The rules, as far as this deployment has read them.
   *
   * AN EMPTY LIST MEANS NOBODY HAS READ THE GUIDE — not that the venue requires nothing, which is a
   * different finding and is recorded per rule as `not_specified`.
   */
  readonly rules: ReadonlyArray<JournalRule>
}

/**
 * Transportation Research Part C, as its official guide states it.
 *
 * READ ON 2026-09-18, after this repository's own fetchers were refused three times: ScienceDirect's
 * `…/publish/guide-for-authors` and `…/about/author-information` and Elsevier's
 * `…/journals/…/guide-for-authors` each answered HTTP 403 with a JavaScript challenge body (1.2 MB)
 * rather than the guide. The user obtained the text from a browser and it is preserved with its source,
 * date and SHA-256 at `plan/venue/trc-guide-for-authors.md`; each rule below names the heading it was
 * read under, so it can be checked against its own sentence.
 *
 * READ FOR THE `Research Paper` ARTICLE TYPE. The guide states different criteria for an Overview
 * Article, and a review is a different research workflow rather than a relabelling of this one.
 */
export const TRC_PROFILE: JournalProfile = {
  id: 'trc',
  name: 'Transportation Research Part C: Emerging Technologies',
  rules: [
    {
      id: 'abstract-length',
      statement: 'the abstract does not exceed 250 words',
      source: GUIDE,
      accessedAt: READ_ON,
      articleType: 'Research Paper',
      verification: 'verified',
      detail: 'concise and factual, does not exceed 250 words; it states the purpose, the procedures, the main findings with their statistical significance where applicable, and the principal conclusions, and it stands alone',
      readAt: 'Abstract',
    },
    {
      id: 'keywords',
      statement: '1 to 7 English keywords',
      source: GUIDE,
      accessedAt: READ_ON,
      articleType: 'Research Paper',
      verification: 'verified',
      detail: '1 to 7 keywords for indexing, in English, avoiding multi-word keys built with "and" or "of"',
      readAt: 'Keywords',
    },
    {
      id: 'highlights',
      statement: '3 to 5 bullet points, each at most 85 characters including spaces',
      source: GUIDE,
      accessedAt: READ_ON,
      articleType: 'Research Paper',
      verification: 'verified',
      detail: 'REQUIRED at submission, as a separate editable file whose name contains "highlights"',
      readAt: 'Highlights',
    },
    {
      id: 'graphical-abstract',
      statement: 'encouraged, not required',
      source: GUIDE,
      accessedAt: READ_ON,
      articleType: 'Research Paper',
      verification: 'not_specified',
      detail: 'the guide ENCOURAGES a graphical abstract and states no requirement to provide one, so a manuscript without it is not refused; preferred files are TIFF, EPS, PDF or MS Office',
      readAt: 'Graphical abstract',
    },
    {
      id: 'reference-style',
      statement: 'the journal applies its own reference style at proof stage',
      source: GUIDE,
      accessedAt: READ_ON,
      articleType: 'Research Paper',
      verification: 'verified',
      detail: "the guide names no style for the author to apply and states that the journal's style is"
        + ' applied after acceptance, at proof stage; every citation must appear in the reference list'
        + ' and vice versa, and a CSL template is available for reference managers',
      readAt: 'References',
    },
    {
      id: 'figures-and-tables',
      statement: 'editable source files; at least 300 dpi for halftones, 1000 dpi for line art',
      source: GUIDE,
      accessedAt: READ_ON,
      articleType: 'Research Paper',
      verification: 'verified',
      detail: 'artwork in separate files with a caption each; halftone minimum 300 dpi (single column 1063 px, full page 2244 px), line art 1000 dpi (3543 / 7480 px); tables and equations as editable text, numbered consecutively, tables cited in the text and free of vertical rules',
      readAt: 'Figures, images and other artwork; Tables; Math formulae',
    },
    {
      id: 'manuscript-file',
      statement: 'editable Word (.doc/.docx) or LaTeX (.tex) source; a PDF is not acceptable',
      source: GUIDE,
      accessedAt: READ_ON,
      articleType: 'Research Paper',
      verification: 'verified',
      detail: 'editable source files for the entire submission including figures and tables; Word in a single-column layout, double-column only for LaTeX; sections numbered 1, 1.1, 1.1.1',
      readAt: 'Submission checklist; Preparing your manuscript',
    },
    {
      id: 'declarations',
      statement: 'competing interests, and a declaration of generative AI use, are required',
      source: GUIDE,
      accessedAt: READ_ON,
      articleType: 'Research Paper',
      verification: 'verified',
      detail: 'the declarations tool must always be completed; a Declaration of generative AI and AI-assisted technologies section is required where such tools were used in preparation, and acknowledgements go in a separate section directly before the reference list',
      readAt: 'Declaration of competing interests; Declaration of generative AI use; Acknowledgements',
    },
    {
      id: 'anonymity',
      statement: 'single anonymized review - the manuscript is NOT anonymized by the author',
      source: GUIDE,
      accessedAt: READ_ON,
      articleType: 'Research Paper',
      verification: 'verified',
      detail: 'the journal follows a SINGLE anonymized review process, in which the reviewers are not identified to the authors; the author names and affiliations stay on the title page, so removing them would be the error here rather than the requirement',
      readAt: 'Peer review',
    },
  ],
}

/**
 * The requirements every journal's guide states, none of them read.
 *
 * THE STATE A GUIDE THAT COULD NOT BE OBTAINED IS IN, kept because a venue whose rules nobody has read
 * must be distinguishable from one whose rules were read and state nothing, and because the refusal it
 * produces names what to go and read. `TRC_PROFILE` no longer uses it: the official guide was obtained
 * on 2026-09-18 and its rules are recorded above.
 *
 * @param source - the official page that states them.
 * @param accessedAt - the date that page was attempted, ISO 8601.
 * @param observed - what the attempt produced, so the record carries its own evidence.
 * @returns one unread rule per subject, in the order a guide states them.
 */
export function unreadRulesFor(
  source: string,
  accessedAt: string,
  observed: string,
): ReadonlyArray<JournalRule> {
  const subjects: ReadonlyArray<readonly [string, string]> = [
    ['abstract-length', 'the abstract and its word limit'],
    ['highlights', 'whether highlights are required, how many, and their character limit'],
    ['graphical-abstract', 'whether a graphical abstract is required and in what format'],
    ['reference-style', 'the reference style the journal names and the form of an entry'],
    ['figures-and-tables', 'how many figures and tables are accepted and in what formats'],
    ['manuscript-file', 'the LaTeX or Word source the journal accepts, and any template'],
    ['declarations', 'the required declarations: CRediT, competing interests, data availability'],
    ['anonymity', 'whether the review is anonymised and what must be removed'],
  ]
  return subjects.map(([id, statement]) => ({
    id,
    statement,
    source,
    accessedAt,
    // THE ARTICLE TYPE IS PART OF THE RULE, and this record does not know it either: a journal states
    // different limits for a review than for a research paper, so a rule read without its article
    // type is a rule that cannot be applied.
    articleType: 'unstated — the guide was not read',
    verification: 'unknown' as const,
    detail: observed,
  }))
}

/** The research types this deployment can be configured as, in the order they are tried. */
export const RESEARCH_TYPES: ReadonlyArray<ResearchType> = ['simulation-study', 'literature-review']

/** What a run is: which kind of study, for which venue, with which metrics. */
export interface ResearchProfile {
  readonly researchType: ResearchType
  readonly journal: JournalProfile
  /** The metrics this type requires, and those belonging to other types. */
  readonly metrics: {
    readonly required: ReadonlyArray<MetricDefinition>
    readonly notApplicable: ReadonlyArray<MetricDefinition>
  }
}

/** Why a research profile was refused. */
export type ProfileRefusalCode =
  | 'profile-unknown-research-type'
  | 'profile-rule-unsourced'
  | 'profile-unknown-journal'

/** A refusal, naming what is wrong and what the deployment can do about it. */
export interface ProfileRefusal {
  readonly code: ProfileRefusalCode
  readonly detail: string
}

/**
 * Resolve the deployment's configuration into the profile a run is driven with.
 *
 * MISCONFIGURATION FAILS HERE, at the earliest point that can tell — not at the step that happens to
 * read the value, and never by silently falling back to a default. A deployment that names a research
 * type this build does not know is a deployment whose runs would be driven under rules nobody chose.
 *
 * @param config - the deployment's stated configuration.
 * @returns the resolved profile.
 * @throws {Error} when the configuration names something this build cannot honour.
 */
export function resolveResearchProfile(config: {
  readonly researchType?: string
  readonly journal?: JournalProfile
}): ResearchProfile {
  const researchType = config.researchType ?? 'simulation-study'
  if (!RESEARCH_TYPES.includes(researchType as ResearchType)) {
    throw new Error(
      `[research-profile] '${researchType}' is not a research type this build knows: it drives`
      + ` ${RESEARCH_TYPES.join(' | ')}`,
    )
  }
  const journal = config.journal ?? TRC_PROFILE
  const unsourced = journal.rules.filter(rule => rule.source.trim() === '')
  if (unsourced.length > 0) {
    throw new Error(
      `[research-profile] journal '${journal.id}' states ${unsourced.map(rule => rule.id).join(', ')}`
      + ' with no source: a rule nobody read is a guess, and a guess must not be enforced',
    )
  }
  return {
    researchType: researchType as ResearchType,
    journal,
    metrics: metricsFor(researchType as ResearchType),
  }
}

/**
 * Every metric the deployment declares, for a caller that has to name one.
 *
 * @returns the registry, so a consumer reads the definitions rather than restating them.
 */
export function declaredMetrics(): ReadonlyArray<MetricDefinition> {
  return METRIC_REGISTRY
}
