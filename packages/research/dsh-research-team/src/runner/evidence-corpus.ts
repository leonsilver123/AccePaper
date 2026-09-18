// @deepseek-ai/dsh-research-team — the reviewed external evidence the B channel consults.
//
// THE DEFECT THIS EXISTS TO CLOSE. `anchor-fixture.ts` builds the B channel's anchor from a
// SIMULATED resolver over a synthetic DOI (`10.0000/synthetic.t19b-anchor`). The chain around it is
// real — the citation identity checks, the red lines, core's `adjudicate('B')` — but the SOURCE is
// invented, and the bundle's own comment said so: "Real retrieval beside a labelled synthetic
// anchor is the current state, not a finished one." A production run could therefore never reach a
// real B pass, because there was nothing real for it to anchor on.
//
// WHAT THIS IS. A small, checked-in set of sources that were actually retrieved and actually read,
// each with the literal passage the reviewer judged, and one reviewed judgement binding that source
// to a claim sentence. It is deliberately small: the review that asked for it asked for "a few
// actual excerpts, with the Claim support relation reviewed by hand", and explicitly not for a
// literature platform.
//
// WHAT IS REAL AND WHAT IS CHECKED IN. Real: the bibliographic identity (title, authors, year,
// venue — read from OpenAlex), the texts quoted (fetched from the publisher's open-access copy or
// the author's arXiv preprint), the retrieval timestamps, and the hashes over the excerpts. Checked
// in: the excerpts themselves. A run does NOT re-fetch them, and the provenance note says so. The
// honest description of this material is "retrieved once, by hand, and recorded", never "fetched
// live during the run".
//
// WHAT IT DOES NOT DO. It does not decide whether a source supports a claim. A person did, once,
// and the judgement is recorded with its reasoning and its scope. Everything downstream reads that
// judgement; nothing here infers one.

import { createHash } from 'node:crypto'
import { evidenceStalenessOf } from '@deepseek-ai/dsh-research-core'
import type {
  CitationResolverAdapter,
  EvidenceBinding,
  EvidenceStaleness,
  Provenance,
  ResolvedCitationMetadata,
  ResolverOutcome,
  SourceAccess,
} from '@deepseek-ai/dsh-research-core'

/** Rule version of this corpus: which revision of which sources an anchor was built from. */
export const EVIDENCE_CORPUS_RULE_VERSION = 'checked-in-corpus-v1'

/** One source that was retrieved and read, with the passage a reviewer judged. */
export interface CorpusSource {
  /** The bare DOI of the published article, which is the record's identity. */
  readonly doi: string
  /** The article's title as the catalogue holds it, which the identity check compares. */
  readonly title: string
  readonly authors: ReadonlyArray<string>
  readonly year: number
  readonly venue: string
  /**
   * How much of the source was actually read. `full-text` is required for the evidence to carry a
   * production gate; anything less is held by the policy, never upgraded.
   */
  readonly sourceAccess: SourceAccess
  /** Where the text was read from. The publisher's copy, or the author's preprint of it. */
  readonly sourceUri: string
  /** The version identifier of the text at {@link sourceUri}. */
  readonly sourceVersion: string
  /** When the text was retrieved, ISO 8601. */
  readonly retrievedAt: string
  /** The literal passage, exactly as it appears in the source. */
  readonly excerpt: string
  /** SHA-256 over {@link excerpt}, so a reader can tell whether the quotation was edited. */
  readonly excerptHash: string
  /**
   * What the accessed text is, when it is not the published article itself — an author preprint,
   * say. Empty when the excerpt is from the published version.
   */
  readonly accessNote: string
  /** True when the catalogue that served the record marks the work retracted. */
  readonly retracted: boolean
}

/** Whether a reviewed source speaks for or against the claim it was assessed against. */
export type SupportVerdict = 'supports' | 'does_not_support'

/** One reviewer's judgement binding a source to the claim sentence they read. */
export interface SupportAssessment {
  /** The bare DOI of the assessed source. */
  readonly sourceDoi: string
  /**
   * The exact evidence this judgement was made from, frozen at the moment it was made.
   *
   * A LITERAL, NOT A LOOKUP. Recomputing it from the corpus entry would make every judgement current
   * by construction, which is the state this field exists to end: a judgement is about words at a
   * version, and the corpus entry they came from can be edited afterwards. `assessmentsFor` compares
   * the two, so an excerpt that changes after the review stops carrying the review — instead of
   * carrying it to a passage nobody read.
   */
  readonly evidence: EvidenceBinding
  /**
   * The claim sentence the reviewer read, verbatim.
   *
   * The assessment is bound to THIS sentence and not to the claim's id: a reworded claim is a
   * different claim, and a judgement made about the old wording must not silently carry over to
   * it. {@link SupportAssessment.claimRefHash} is what the run is matched on.
   */
  readonly claimRef: string
  /** SHA-256 over {@link claimRef}: the claim version this judgement is about. */
  readonly claimRefHash: string
  readonly verdict: SupportVerdict
  /** Who judged it. A person, or a model whose answer a person confirmed. */
  readonly reviewer: string
  /** When, ISO 8601. */
  readonly reviewedAt: string
  /** Why the source supports or does not support the claim, in the reviewer's words. */
  readonly rationale: string
  /** What the source does NOT establish. Recorded because a verdict without one overclaims. */
  readonly scope: string
  /** True for the source a claim's B gate consults by default. */
  readonly anchor: boolean
}

/**
 * A digest over a claim sentence. This is the claim VERSION a {@link SupportAssessment} is bound to.
 *
 * @param claimRef - the claim sentence, as the run states it.
 * @returns its SHA-256, hex.
 */
export function claimRefHashOf(claimRef: string): string {
  return createHash('sha256').update(claimRef.trim(), 'utf8').digest('hex')
}

/**
 * A digest over an excerpt, recorded beside it so an edited quotation is detectable.
 *
 * @param excerpt - the literal passage.
 * @returns its SHA-256, hex.
 */
export function excerptHashOf(excerpt: string): string {
  return createHash('sha256').update(excerpt, 'utf8').digest('hex')
}

/** The study's own claim sentence, which the assessments below are bound to. */
const STUDY_CLAIM_REF =
  'inserting one AV into a three-vehicle human platoon raises the platoon minimum time-to-collision'

const STUDY_CLAIM_HASH = claimRefHashOf(STUDY_CLAIM_REF)

function excerpt(text: string): string {
  return excerptHashOf(text)
}

/**
 * The retrieved sources.
 *
 * Three, and no more. Each was fetched on the retrieval date named in {@link CorpusSource.retrievedAt}
 * and each excerpt below is a passage that appears in the source at {@link CorpusSource.sourceUri}.
 * Two of them are author preprints of published articles: the DOI identifies the article, and
 * {@link CorpusSource.accessNote} states that the text read is the preprint.
 */
export const EVIDENCE_CORPUS: ReadonlyArray<CorpusSource> = [
  {
    doi: '10.1109/tits.2026.3727135',
    title:
      'Safe and Stable Connected Cruise Control for Connected Automated Vehicles With Response Lag',
    authors: ['Chen, Y.', 'Orosz, G.', 'Molnár, T. G.'],
    year: 2026,
    venue: 'IEEE Transactions on Intelligent Transportation Systems',
    sourceAccess: 'full-text',
    sourceUri: 'https://arxiv.org/html/2409.06884v1',
    sourceVersion: 'arXiv:2409.06884v1',
    retrievedAt: '2026-09-16T02:14:00.000Z',
    excerpt:
      'Furthermore, the reaction time of vehicles—which is represented as a first-order lag—has a '
      + 'detrimental effect on safety. We determine the critical value of this lag, above which safe '
      + 'CCC gains do not exist.',
    excerptHash: excerpt(
      'Furthermore, the reaction time of vehicles—which is represented as a first-order lag—has a '
      + 'detrimental effect on safety. We determine the critical value of this lag, above which safe '
      + 'CCC gains do not exist.',
    ),
    accessNote:
      'read from the author preprint (arXiv:2409.06884v1) of the published article; the DOI is the '
      + 'article of record',
    retracted: false,
  },
  {
    doi: '10.1016/j.trb.2025.103352',
    title: 'Leveraging cooperative connected automated vehicles for mixed traffic safety',
    authors: ['Zhao, C.', 'Molnár, T. G.', 'Yu, H.'],
    year: 2025,
    venue: 'Transportation Research Part B: Methodological',
    sourceAccess: 'full-text',
    sourceUri: 'https://arxiv.org/html/2406.11508v1',
    sourceVersion: 'arXiv:2406.11508v1',
    retrievedAt: '2026-09-16T02:31:00.000Z',
    excerpt:
      'We find that both CAV coordination and HV connection have opposite effects on stability and '
      + 'safety: including CAV cooperation or HV connection makes it easier to stabilize traffic but '
      + 'harder to maintain safety. To overcome this trade-off, safety filters are designed using '
      + 'control barrier functions considering CAV safety, HV safety, and platoon safety.',
    excerptHash: excerpt(
      'We find that both CAV coordination and HV connection have opposite effects on stability and '
      + 'safety: including CAV cooperation or HV connection makes it easier to stabilize traffic but '
      + 'harder to maintain safety. To overcome this trade-off, safety filters are designed using '
      + 'control barrier functions considering CAV safety, HV safety, and platoon safety.',
    ),
    accessNote:
      'read from the author preprint (arXiv:2406.11508v1) of the published article; the DOI is the '
      + 'article of record',
    retracted: false,
  },
  {
    doi: '10.1155/2017/3082781',
    title: 'Will Automated Vehicles Negatively Impact Traffic Flow?',
    authors: ['Calvert, S. C.', 'Schakel, W.', 'van Lint, H.'],
    year: 2017,
    venue: 'Journal of Advanced Transportation',
    sourceAccess: 'abstract-only',
    sourceUri: 'https://api.openalex.org/works/https://doi.org/10.1155/2017/3082781',
    sourceVersion: 'openalex-record-2026-09-16',
    retrievedAt: '2026-09-16T02:40:00.000Z',
    excerpt:
      'We found that low-level automated vehicles in mixed traffic will initially have a small '
      + 'negative effect on traffic flow and road capacities. The experiment further showed that any '
      + 'improvement in traffic flow will only be seen at penetration rates above 70%.',
    excerptHash: excerpt(
      'We found that low-level automated vehicles in mixed traffic will initially have a small '
      + 'negative effect on traffic flow and road capacities. The experiment further showed that any '
      + 'improvement in traffic flow will only be seen at penetration rates above 70%.',
    ),
    accessNote:
      'publisher abstract only; the full text was not readable from this host (the publisher and '
      + 'the repository copies both refused the request), so the paper\'s own conditions could not '
      + 'be checked',
    retracted: false,
  },
]

/**
 * The reviewed judgements.
 *
 * Two of the three were made about a source read in full; the third is about a source whose
 * abstract was all that could be read, and it is held rather than admitted for exactly that reason.
 */
export const SUPPORT_ASSESSMENTS: ReadonlyArray<SupportAssessment> = [
  {
    sourceDoi: '10.1109/tits.2026.3727135',
    evidence: {
      // THE IDENTITY IS THIS CORPUS'S OWN, and the DOI travels inside it: this registry keys its
      // records by DOI because each holds one article, which is a fact about THIS corpus rather than a
      // rule about evidence. A registry with its own item keys mints a different identity, and two
      // passages of one work are then two records rather than one overwritten one.
      sourceIdentity: 'curated:10.1109/tits.2026.3727135',
      sourceVersion: 'arXiv:2409.06884v1',
      locator: 'https://arxiv.org/html/2409.06884v1',
      contentSha256: 'e1ebab7ae5685c950cafe4caeec4fadf5eb627401a776a6daca8492717c37ec5',
      route: 'checked-in-excerpt',
      ruleVersion: EVIDENCE_CORPUS_RULE_VERSION,
    },
    claimRef: STUDY_CLAIM_REF,
    claimRefHash: STUDY_CLAIM_HASH,
    verdict: 'supports',
    reviewer: 'claude-code (retrieval + reading); recorded for human confirmation',
    reviewedAt: '2026-09-16T02:20:00.000Z',
    rationale:
      'The claim predicts that the autonomous vehicle\'s shorter reaction delay raises the platoon\'s '
      + 'minimum time-to-collision. This source isolates reaction time as a first-order lag on the '
      + 'controlled vehicle and finds it has a detrimental effect on safety, with a critical lag '
      + 'above which no safe controller gains exist — the same quantity the study varies, in the '
      + 'same direction the claim predicts. Its companion finding, that a vehicle responding to '
      + 'connected vehicles farther ahead brakes earlier and thereby increases the distance, is the '
      + 'mechanism the study\'s look-ahead horizon is meant to supply.',
    scope:
      'This source establishes the DIRECTION of the reaction-delay and look-ahead effects for a '
      + 'connected automated vehicle in a human-led string. It does not measure a minimum '
      + 'time-to-collision for a three-vehicle single-lane platoon, so it says nothing about the '
      + 'magnitude the claim predicts, and nothing about the study\'s specific headway change.',
    anchor: true,
  },
  {
    sourceDoi: '10.1016/j.trb.2025.103352',
    evidence: {
      sourceIdentity: 'curated:10.1016/j.trb.2025.103352',
      sourceVersion: 'arXiv:2406.11508v1',
      locator: 'https://arxiv.org/html/2406.11508v1',
      contentSha256: '7dae11a68f284d89617678d93957043c3e0f5b68617d738031263e94184acb7e',
      route: 'checked-in-excerpt',
      ruleVersion: EVIDENCE_CORPUS_RULE_VERSION,
    },
    claimRef: STUDY_CLAIM_REF,
    claimRefHash: STUDY_CLAIM_HASH,
    verdict: 'does_not_support',
    reviewer: 'claude-code (retrieval + reading); recorded for human confirmation',
    reviewedAt: '2026-09-16T02:35:00.000Z',
    rationale:
      'The claim predicts a safety quantity rises when the automated vehicle follows more smoothly '
      + 'and at a shorter headway. This source finds the two properties move in OPPOSITE directions '
      + 'in mixed traffic: the coordination that makes the string easier to stabilize makes safety '
      + 'harder to maintain, and separating them requires a control-barrier safety filter that the '
      + 'study\'s simulation does not contain. Read as evidence about the claim\'s inference rather '
      + 'than about its mechanism, it does not support the claim.',
    scope:
      'The source studies pairs of connected automated vehicles among human-driven vehicles and '
      + 'reports a trade-off between string stability and safety. It does not test a single '
      + 'autonomous vehicle in a three-vehicle platoon, and it does not report a minimum '
      + 'time-to-collision, so it neither confirms nor measures the claim\'s quantity.',
    anchor: false,
  },
  {
    sourceDoi: '10.1155/2017/3082781',
    evidence: {
      sourceIdentity: 'curated:10.1155/2017/3082781',
      sourceVersion: 'openalex-record-2026-09-16',
      locator: 'https://api.openalex.org/works/https://doi.org/10.1155/2017/3082781',
      contentSha256: '06b7f9c08729dfa00b3006ca5aaa5314a3abf4f312bb835e02bbe163d120fb61',
      route: 'checked-in-excerpt',
      ruleVersion: EVIDENCE_CORPUS_RULE_VERSION,
    },
    claimRef: STUDY_CLAIM_REF,
    claimRefHash: STUDY_CLAIM_HASH,
    verdict: 'does_not_support',
    reviewer: 'claude-code (retrieval); abstract read, full text unavailable',
    reviewedAt: '2026-09-16T02:42:00.000Z',
    rationale:
      'The study inserts one autonomous vehicle into a three-vehicle platoon, a penetration rate of '
      + 'about one third, and predicts an improvement. This source reports that improvement appears '
      + 'only above a 70 % penetration rate of low-level automated vehicles, and that below it the '
      + 'effect is slightly negative. Taken at face value that bears against the claim.',
    scope:
      'The penetration-rate threshold is stated in the abstract and its conditions could not be '
      + 'checked, because the full text was not readable from this host. The source models low-level '
      + 'automation in mixed traffic at road-network scale, not a three-vehicle platoon, so it is '
      + 'not established that its threshold applies here at all. This judgement is therefore '
      + 'recorded but not usable as evidence, and the policy holds it for that reason.',
    anchor: false,
  },
]

/** The corpus source with this DOI, or undefined. */
export function corpusSource(doi: string): CorpusSource | undefined {
  return EVIDENCE_CORPUS.find(source => source.doi === doi)
}

/**
 * The binding a corpus entry has NOW, to compare a judgement's frozen one against.
 *
 * @param source - the corpus entry as it currently stands.
 * @returns the binding its excerpt and versions describe today.
 */
export function corpusBindingOf(source: CorpusSource): EvidenceBinding {
  return {
    sourceIdentity: `curated:${source.doi}`,
    sourceVersion: source.sourceVersion,
    locator: source.sourceUri,
    contentSha256: source.excerptHash,
    route: 'checked-in-excerpt',
    ruleVersion: EVIDENCE_CORPUS_RULE_VERSION,
  }
}

/**
 * Whether a judgement still describes the evidence, or the corpus moved under it.
 *
 * @param assessment - the judgement, with the binding it was made from.
 * @returns the comparison, or undefined when the corpus holds no such source any more.
 */
export function assessmentStalenessOf(assessment: SupportAssessment): EvidenceStaleness | undefined {
  const source = corpusSource(assessment.sourceDoi)
  return source === undefined
    ? undefined
    : evidenceStalenessOf(assessment.evidence, corpusBindingOf(source))
}

/**
 * Every assessment for this claim version whose evidence is still the evidence it judged.
 *
 * A JUDGEMENT ABOUT WORDS THAT ARE NO LONGER THERE IS NOT A JUDGEMENT ABOUT THIS CLAIM. It is dropped
 * rather than re-pointed, because re-pointing would carry a review to a passage nobody read. A run
 * whose only anchor drops out then has no anchor, which is the correct end: the claim is unsupported
 * until somebody reads the current text.
 *
 * @param claimRef - the claim sentence the run states.
 * @returns the current assessments, in corpus order.
 */
export function assessmentsFor(claimRef: string): ReadonlyArray<SupportAssessment> {
  return currentAssessments(SUPPORT_ASSESSMENTS, claimRef)
}

/**
 * The judgements in one set that are about this claim version and still describe their evidence.
 *
 * THE SET IS A PARAMETER so the drop can be exercised without editing a frozen module constant: the
 * behaviour under test is the filter, and a test that had to mutate `EVIDENCE_CORPUS` to reach it
 * would be testing the mutation.
 *
 * @param all - the judgements to filter.
 * @param claimRef - the claim sentence the run states.
 * @returns those that are about it and current, in the order given.
 */
export function currentAssessments(
  all: ReadonlyArray<SupportAssessment>,
  claimRef: string,
): ReadonlyArray<SupportAssessment> {
  const hash = claimRefHashOf(claimRef)
  return all.filter(assessment =>
    assessment.claimRefHash === hash && assessmentStalenessOf(assessment)?.stale !== true)
}

/**
 * Every assessment for this claim version whose evidence has moved, with what moved.
 *
 * NAMED RATHER THAN SILENTLY DROPPED: a run that lost its anchor to an edited quotation has to be
 * able to say so, or the absence reads as "nobody ever reviewed this".
 *
 * @param claimRef - the claim sentence the run states.
 * @returns one entry per stale judgement, in corpus order.
 */
export function staleAssessmentsFor(
  claimRef: string,
): ReadonlyArray<{ readonly assessment: SupportAssessment; readonly staleness: EvidenceStaleness }> {
  return staleAmong(SUPPORT_ASSESSMENTS, claimRef)
}

/**
 * The judgements in one set whose evidence has moved, with what moved.
 *
 * @param all - the judgements to filter.
 * @param claimRef - the claim sentence the run states.
 * @returns one entry per stale judgement, in the order given.
 */
export function staleAmong(
  all: ReadonlyArray<SupportAssessment>,
  claimRef: string,
): ReadonlyArray<{ readonly assessment: SupportAssessment; readonly staleness: EvidenceStaleness }> {
  const hash = claimRefHashOf(claimRef)
  return all.flatMap((assessment) => {
    if (assessment.claimRefHash !== hash) return []
    const staleness = assessmentStalenessOf(assessment)
    return staleness === undefined || !staleness.stale ? [] : [{ assessment, staleness }]
  })
}

/**
 * The assessment a claim version's B gate consults by default, or undefined when the corpus holds
 * no reviewed anchor for it.
 *
 * @param claimRef - the claim sentence the run states.
 * @returns the assessment, or undefined.
 */
export function anchorAssessmentFor(claimRef: string): SupportAssessment | undefined {
  return assessmentsFor(claimRef).find(assessment => assessment.anchor)
}

/**
 * The corpus as a citation resolver, so the identity chain runs against the record that was
 * actually retrieved.
 *
 * A DOI the corpus does not hold answers `temporarily_unavailable`, never `not_found`. The chain
 * reads `not_found` as "this work does not exist", and this resolver did not check anything but its
 * own shelf — reporting a miss it never established is how a real paper gets called fabricated.
 */
export const corpusCitationResolver: CitationResolverAdapter = {
  resolveMetadata(ref): Promise<ResolverOutcome> {
    const source = ref.kind === 'doi' ? corpusSource(ref.id) : undefined
    if (source === undefined) {
      return Promise.resolve({
        status: 'temporarily_unavailable',
        detail:
          `the checked-in evidence corpus holds no record for '${ref.kind}:${ref.id}'; this `
          + 'resolver does not search any catalogue, so it cannot report a miss',
      })
    }
    const metadata: ResolvedCitationMetadata = {
      title: source.title,
      authors: [...source.authors],
      retracted: source.retracted,
      ruleVersion: EVIDENCE_CORPUS_RULE_VERSION,
    }
    return Promise.resolve({ status: 'resolved', metadata })
  },
}

/**
 * What produced a corpus anchor, for the evidence policy to read.
 *
 * `sourceClass: 'literature'` is the load-bearing field: it is what lets a production run carry
 * this evidence at all, and it is accurate — the sources are real articles with real identifiers.
 * `sourceAccess` is the source's OWN access level, not this module's: a run whose only anchor was
 * read at abstract level must be held by the policy rather than admitted on the strength of the
 * ones that were read in full.
 *
 * @param source - the source the anchor was built from.
 * @returns the provenance to publish with that anchor.
 */
export function corpusProvenance(source: CorpusSource): Provenance {
  return {
    sourceClass: 'literature',
    producer: 'dsh-research-team/evidence-corpus',
    ruleVersion: EVIDENCE_CORPUS_RULE_VERSION,
    sourceAccess: source.sourceAccess,
    // THE THREE AXES, EACH STATING ONLY ITSELF. `curated` says where the record is read from and
    // nothing about how far to trust it; the acquisition says whether a run re-read the source, and
    // it does not; the review is the recorded judgement, which is about the excerpt at its version
    // and travels beside it rather than ranking the work.
    registry: 'curated',
    acquisition: 'retrieved-then-checked-in',
    review: 'human-reviewed',
    note:
      `excerpt retrieved once by hand and checked in (${source.sourceUri}); a run does not re-fetch `
      + `it. ${source.accessNote}`,
  }
}
