// @deepseek-ai/dsh-research-team — the B channel's REAL evidence path.
//
// `anchor-fixture.ts` builds the B channel's anchor from a simulated resolver over a synthetic DOI:
// the identity chain runs for real and the SOURCE is invented, so no production run can reach a real
// B pass. This module is the other path. It takes a source that was actually retrieved and a
// judgement a reviewer actually recorded (`evidence-corpus.ts`), runs the SAME core citation identity
// chain over it, and publishes provenance that says `literature` — which is what lets the evidence
// policy admit it.
//
// WHAT THIS DOES NOT DO. It does not decide the stance. The reviewer's verdict is the input, exactly
// as the T23 fixture's stance is on the synthetic path, and core's `adjudicate('B')` decides the gate
// from the conclusion the chain returns. A module that picked the stance it wanted would be the
// defect this whole line of work exists to remove.
//
// THE ANCHOR IS ONE SOURCE, AND THE OTHERS ARE STILL REPORTED. A claim version can have several
// assessed sources, and they need not agree. The gate is handed the one the reviewer designated its
// anchor; the rest travel on {@link EvidenceAnchors.assessments} so a reader sees the material that
// was NOT adjudicated. Handing the gate a contradiction instead would block the step, and whether a
// counter-source refutes a claim is the C channel's threshold question, not this channel's.

import type {
  CitationEvidence,
  CitationId,
  CitationRef,
  ClaimId,
  VerificationResult,
} from '@deepseek-ai/dsh-research-core'
import { verifyCitation } from '@deepseek-ai/dsh-research-core'

import type { BChannelEvidence } from './anchor-fixture.ts'
import {
  anchorAssessmentFor,
  assessmentsFor,
  corpusCitationResolver,
  corpusProvenance,
  corpusSource,
} from './evidence-corpus.ts'
import type { CorpusSource, SupportAssessment } from './evidence-corpus.ts'

/** What one step attempt's B channel needs to consult the corpus. */
export interface EvidenceAnchorSpec {
  readonly claimId: ClaimId
  /** The claim sentence the run states. The reviewed judgement is bound to its digest. */
  readonly claimRef: string
  readonly stepId: string
  readonly timestamp: number
  /** The assessed source to consult. Defaults to the claim version's reviewed anchor. */
  readonly sourceDoi?: string | undefined
}

/**
 * What the corpus path decided, including the material it did not adjudicate.
 *
 * There is no T23 anchor signal here, and this type does not carry one: the stance on this path is
 * the reviewer's recorded verdict, and inventing a fixture signal to hold it would present a
 * judgement as a lookup.
 */
export interface EvidenceAnchors extends BChannelEvidence {
  /** Every reviewed judgement for this claim version, adjudicated or not. */
  readonly assessments: ReadonlyArray<SupportAssessment>
  /** The source the gate was handed, or undefined when the corpus had none to offer. */
  readonly source: CorpusSource | undefined
}

/**
 * Build the B channel's verification set from the reviewed evidence corpus.
 *
 * @param spec - the claim version, the step, and which assessed source to consult.
 * @returns the anchors, or undefined when the corpus holds no reviewed judgement for this claim
 *   version — in which case the caller must fall back rather than treat the absence as evidence.
 */
export async function buildEvidenceAnchors(
  spec: EvidenceAnchorSpec,
): Promise<EvidenceAnchors | undefined> {
  const assessments = assessmentsFor(spec.claimRef)
  if (assessments.length === 0) return undefined
  const assessment =
    spec.sourceDoi === undefined
      ? anchorAssessmentFor(spec.claimRef)
      : assessments.find(candidate => candidate.sourceDoi === spec.sourceDoi)
  if (assessment === undefined) return undefined
  const source = corpusSource(assessment.sourceDoi)
  if (source === undefined) return undefined

  const ref: CitationRef = {
    kind: 'doi',
    id: source.doi,
    title: source.title,
    authors: [...source.authors],
  }
  const evidence: CitationEvidence = {
    // The excerpt travels as the accessed text. It is the passage the reviewer read, and its
    // digest is what a reader can re-check: the corpus holds the same hash over the same string.
    originalTextAccessed: true,
    method: 'auto_openalex',
    locator: {},
    excerpt: source.excerpt,
    accessedAt: spec.timestamp,
    sourceUri: source.sourceUri,
    sourceVersion: source.sourceVersion,
    contentHash: source.excerptHash,
    retrievedAt: source.retrievedAt,
  }
  const stance =
    assessment.verdict === 'supports'
      ? { claimedConclusion: 'supported' as const, contentSupportsClaim: true }
      // A non-supporting source is expressed the way the chain reads one: the accessed text does
      // not say what the claim needs it to say. The chain returns `unsupported` with original-text
      // access, and core's B gate blocks on that.
      : { claimedConclusion: 'unsupported' as const, contentSupportsClaim: false }

  const verified: VerificationResult = await verifyCitation(
    spec.claimId,
    `evidence-${spec.stepId}` as unknown as CitationId,
    ref,
    evidence,
    corpusCitationResolver,
    spec.timestamp,
    stance,
  )
  const anchoring =
    verified.evidence.originalTextAccessed &&
    verified.evidence.method !== 'none' &&
    !verified.redLineTriggered &&
    (verified.conclusion === 'supported' || verified.conclusion === 'partially_supported')
  const counter = assessments.filter(candidate => candidate.sourceDoi !== assessment.sourceDoi)
  return {
    verifications: [verified],
    anchoring,
    provenance: corpusProvenance(source),
    basis:
      `reviewed source '${source.doi}' (${source.sourceAccess}) assessed ${assessment.verdict} by `
      + `${assessment.reviewer} → core verifyCitation over the checked-in corpus returned `
      + `conclusion=${verified.conclusion} (reasonCode=${verified.reasonCode})`
      + (counter.length === 0
        ? '; no counter-assessed source for this claim version'
        : `; ${String(counter.length)} counter-assessed source(s) for this claim version were NOT `
          + `handed to the gate: ${counter.map(candidate => `${candidate.sourceDoi} (${candidate.verdict})`).join(', ')}`
          + ' — deciding whether one of them refutes the claim is the C channel\'s threshold '
          + 'question, and is open'),
    assessments,
    source,
  }
}
