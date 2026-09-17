// @deepseek-ai/dsh-research-team — which study this is, and which journal it is being written for.
//
// TWO CONFIGURATIONS, KEPT APART. The research TYPE says what kind of study is being run and therefore
// which metrics it has at all. The JOURNAL profile says what a particular venue requires of the
// document. Neither belongs in the other: a traffic metric is not a rule, and a word limit is not a
// research type.
//
// A JOURNAL RULE IS ONLY A RULE IF SOMEBODY READ IT. The plan behind this module is explicit — the
// venue's author guide was not obtained, so its word limits, figure specifications and reference style
// are UNKNOWN, and an unknown must not become a default. Every rule therefore carries the source it
// came from, and a rule without one is refused rather than accepted: a profile that could state a
// rule it did not verify is a profile that would silently enforce somebody's guess. An empty profile
// is the honest state of a venue nobody has read yet, and it is what `TRC_PROFILE` is.

import { METRIC_REGISTRY, metricsFor } from './metrics.ts'
import type { MetricDefinition, ResearchType } from './metrics.ts'

/** One rule a venue states, with where it was read. */
export interface JournalRule {
  /** Stable id, e.g. `abstract-word-limit`. */
  readonly id: string
  /** The rule as the venue states it. */
  readonly statement: string
  /** Where it was read: a URL, and the date it was read. Never empty, never a guess. */
  readonly source: string
}

/** A venue's requirements, as far as anyone has verified them. */
export interface JournalProfile {
  readonly id: string
  readonly name: string
  /** The verified rules. Empty means nobody has read the guide — not that there are no rules. */
  readonly rules: ReadonlyArray<JournalRule>
}

/**
 * Transportation Research Part C, with NO rules.
 *
 * The author guide has not been obtained, so the venue's word limits, figure specifications, reference
 * style and supplementary-material rules are unknown. Listing them as fields would make every one of
 * them a default, and a default here is a claim about the venue that nobody checked.
 */
export const TRC_PROFILE: JournalProfile = {
  id: 'trc',
  name: 'Transportation Research Part C: Emerging Technologies',
  rules: [],
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
