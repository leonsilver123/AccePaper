/**
 * The record's vocabulary, in the reader's words.
 *
 * THE PROBLEM THIS SOLVES. The host records its products and its package checks under identifiers —
 * `landscape-map`, `result-version`, `every-step-closed` — and the page used to print exactly that. A
 * researcher reads `draft · D3-writing · attempt 1` or `no-refused-sections` and learns nothing about
 * what was produced or what still stands between them and a submission; the words that say it are keys
 * in the record, not words in their language.
 *
 * WHY THESE ARE TABLES AND NOT COMPOSED KEYS, which is the mistake this module was rewritten to fix.
 * The first version composed a key (`artifactName.<slug>`) and fell back to the slug when the lookup
 * answered nothing — and that fallback could never run. The locale runtime resolves a key it has no
 * entry for to THE KEY ITSELF (`locale.translate` ends in `?? key`), so an artifact this build cannot
 * name would have reached a researcher as the string `artifactName.problem_statement`: worse than the
 * slug it replaced, and invisible to every test whose translate double returned the key too. A table
 * makes the question answerable BEFORE the lookup — an identifier outside the union this build knows is
 * shown as the record wrote it, which is still true, and nothing is invented.
 */
import type { ResearchKey, ResearchT } from './locales.ts'

/**
 * The artifacts the pipeline produces, by the slug the engine records them under.
 *
 * THE UNION IS THE COMPLETENESS CHECK: it is the engine's own output roster
 * (`PIPELINE_STEPS[].outputs` in `dsh-research-core`), and the table below must answer for every member
 * because the compiler says so. A slug the pipeline gains later is a compile error here rather than a
 * row a researcher cannot read.
 */
export type ArtifactSlug =
  | 'landscape-map' | 'gap-list'
  | 'claim' | 'falsifiable-prediction'
  | 'agenda' | 'contribution-list'
  | 'venue' | 'venue-scope'
  | 'method-spec' | 'method-predictions'
  | 'dataset' | 'data-profile'
  | 'baseline-results' | 'sota-comparison'
  | 'mvp-results' | 'result-version'
  | 'converged-verdict'
  | 'ablation-results' | 'boundary-map'
  | 'figure-plan'
  | 'paper-outline'
  | 'manuscript'
  | 'rebuttal'
  | 'typeset'
  | 'submission-record'

/** What each artifact is called, in the reader's language. */
const ARTIFACT_NAME_KEYS: Readonly<Record<ArtifactSlug, ResearchKey>> = {
  'landscape-map': 'artifactName.landscape-map',
  'gap-list': 'artifactName.gap-list',
  claim: 'artifactName.claim',
  'falsifiable-prediction': 'artifactName.falsifiable-prediction',
  agenda: 'artifactName.agenda',
  'contribution-list': 'artifactName.contribution-list',
  venue: 'artifactName.venue',
  'venue-scope': 'artifactName.venue-scope',
  'method-spec': 'artifactName.method-spec',
  'method-predictions': 'artifactName.method-predictions',
  dataset: 'artifactName.dataset',
  'data-profile': 'artifactName.data-profile',
  'baseline-results': 'artifactName.baseline-results',
  'sota-comparison': 'artifactName.sota-comparison',
  'mvp-results': 'artifactName.mvp-results',
  'result-version': 'artifactName.result-version',
  'converged-verdict': 'artifactName.converged-verdict',
  'ablation-results': 'artifactName.ablation-results',
  'boundary-map': 'artifactName.boundary-map',
  'figure-plan': 'artifactName.figure-plan',
  'paper-outline': 'artifactName.paper-outline',
  manuscript: 'artifactName.manuscript',
  rebuttal: 'artifactName.rebuttal',
  typeset: 'artifactName.typeset',
  'submission-record': 'artifactName.submission-record',
}

/**
 * The conditions the final package is checked against.
 *
 * These are the answers to "why is this still a working draft", so a reader who is told that is owed
 * the sentence saying which condition is unmet — in their own language, because
 * `no-refused-sections` is the answer to a question about THEIR manuscript.
 */
export type PackageCheckCode =
  | 'production-evidence' | 'manuscript-produced' | 'every-step-closed'
  | 'no-refused-sections' | 'no-open-issues' | 'approval-current'
  | 'compiled-document-complete' | 'review-complete'
  | 'approval-recorded' | 'required-files-present' | 'journal-rules-verified'
  | 'artifacts-current' | 'deliverables-present' | 'run-saved'

/** What each condition is called, in the reader's language. */
const PACKAGE_CHECK_KEYS: Readonly<Record<PackageCheckCode, ResearchKey>> = {
  'production-evidence': 'packageCheck.production-evidence',
  'manuscript-produced': 'packageCheck.manuscript-produced',
  'every-step-closed': 'packageCheck.every-step-closed',
  'no-refused-sections': 'packageCheck.no-refused-sections',
  'no-open-issues': 'packageCheck.no-open-issues',
  'approval-current': 'packageCheck.approval-current',
  'compiled-document-complete': 'packageCheck.compiled-document-complete',
  'review-complete': 'packageCheck.review-complete',
  'approval-recorded': 'packageCheck.approval-recorded',
  'required-files-present': 'packageCheck.required-files-present',
  'journal-rules-verified': 'packageCheck.journal-rules-verified',
  'artifacts-current': 'packageCheck.artifacts-current',
  'deliverables-present': 'packageCheck.deliverables-present',
  'run-saved': 'packageCheck.run-saved',
}

/**
 * One identifier's dictionary key, when this build owns one for it.
 *
 * @param table - the table of known identifiers.
 * @param identifier - the identifier as the record wrote it.
 * @returns the key, or undefined when this build has no entry for that identifier.
 */
function knownKey<K extends string>(
  table: Readonly<Record<string, K>>,
  identifier: string,
): K | undefined {
  return Object.hasOwn(table, identifier) ? table[identifier] : undefined
}

/**
 * What an artifact is called.
 *
 * NO FALLBACK PAST THE TABLE, and that is the point of the table: a slug outside the union this build
 * knows is answered by the slug itself, and a slug inside it has an entry in the dictionary by
 * construction (the union and the dictionary's keys are checked against each other at compile time). A
 * `?? slug` after the lookup would be unreachable code pretending to be a safety net.
 *
 * @param slug - the artifact's slug as the host recorded it.
 * @param t - the `research` namespace translate.
 * @returns the name to show, or the slug when this build has no name for it.
 */
export function artifactName(slug: string, t: ResearchT): string {
  const key = knownKey(ARTIFACT_NAME_KEYS, slug)
  return key === undefined ? slug : t(key)
}

/**
 * What one of the final package's conditions is called.
 *
 * @param code - the check's code as the package recorded it.
 * @param t - the `research` namespace translate.
 * @returns the name to show, or the code when this build has no name for it.
 */
export function packageCheckName(code: string, t: ResearchT): string {
  const key = knownKey(PACKAGE_CHECK_KEYS, code)
  return key === undefined ? code : t(key)
}

/** Where a request to change the manuscript was made, by the identifier the record uses. */
const REVISION_SOURCE_KEYS: Readonly<Record<'panel' | 'conversation', ResearchKey>> = {
  panel: 'revision.source.panel',
  conversation: 'revision.source.conversation',
}

/**
 * Where a revision request was made, in the reader's words.
 *
 * THE PROVENANCE IS THE WHOLE POINT OF THE FIELD. A person can hand the run a requirement by typing in
 * the conversation and having the agent record it, and the panel shows that request beside the ones made
 * in its own controls — so a reader who is not told which is which cannot tell whether they have already
 * seen the request, or whether somebody else asked for it.
 *
 * A source this build has no word for is reported as the record stated it: the reader learns where it
 * came from and learns that this build does not know that place by name.
 *
 * @param source - the source as the record stated it.
 * @param t - the `research` namespace translate.
 * @returns the sentence to show.
 */
export function revisionSourceName(source: string, t: ResearchT): string {
  const key = knownKey(REVISION_SOURCE_KEYS, source)
  return key === undefined ? t('revision.source.other').replace('{source}', source) : t(key)
}
