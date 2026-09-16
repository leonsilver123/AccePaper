/**
 * The B channel anchors a claim on literature that was actually retrieved and actually read.
 *
 * The defect this closes (the review's R1): the B channel's only source was
 * `MockCitationResolverAdapter` over `10.0000/synthetic.t19b-anchor`. The chain around it was real —
 * the identity checks, the red lines, core's `adjudicate('B')` — so a reader could follow every step
 * and find nothing wrong, and no production run could ever reach a real B pass. The bundle's own
 * comment said as much: "Real retrieval beside a labelled synthetic anchor is the current state,
 * not a finished one."
 *
 * What replaces it is small on purpose: three sources, each retrieved once, each recorded with the
 * literal passage a reviewer judged, and one reviewed verdict per source binding it to a claim
 * sentence. The review asked for exactly that — "a few actual excerpts, with the Claim support
 * relation reviewed by hand" — and explicitly not for a literature platform.
 *
 * The three tests below are the three outcomes the review asked to see: a real B PASS, an
 * unsupported B REFUSED, and — because it is the disposition the README recorded as unreachable —
 * a source that was only available as an abstract HELD rather than admitted.
 */

import { describe, expect, it } from 'vitest'
import { admitAsEvidence, getStepDefinitionById } from '@deepseek-ai/dsh-research-core'
import type { EvidenceProfile, StepDefinition } from '@deepseek-ai/dsh-research-core'

import { createRunContext } from '../src/runner/drive.ts'
import {
  EVIDENCE_CORPUS,
  SUPPORT_ASSESSMENTS,
  assessmentsFor,
  claimRefHashOf,
  corpusCitationResolver,
  corpusSource,
  excerptHashOf,
} from '../src/runner/evidence-corpus.ts'
import { buildEvidenceAnchors } from '../src/runner/evidence-anchors.ts'
import { buildStepVerdicts } from '../src/runner/verdict.ts'
import type { VerdictBuildCtx } from '../src/runner/types.ts'
import { CANONICAL } from '../src/runner/registry.ts'
import { receiptFor } from './support/receipt.ts'

/** The reviewed source whose assessment says it SUPPORTS the study's claim. */
const SUPPORTING_DOI = '10.1109/tits.2026.3727135'
/** The reviewed source whose assessment says it does NOT. */
const AGAINST_DOI = '10.1016/j.trb.2025.103352'
/** The reviewed source that was only available as an abstract. */
const ABSTRACT_ONLY_DOI = '10.1155/2017/3082781'

/** A1's gate is `['B']` alone, so the verdict under test can only come from the B channel. */
const A1: StepDefinition | undefined = getStepDefinitionById('A1-landscape')

function ctxUnder(evidenceProfile: EvidenceProfile, evidenceSourceDoi?: string): VerdictBuildCtx {
  if (A1 === undefined) throw new Error('reviewed-evidence: A1-landscape is not a core step')
  return {
    step: A1,
    attemptId: 1,
    commit: receiptFor('A1-landscape', A1.outputs ?? []),
    // An empty `claimRef` is a run that has not stated its claim yet; `verdictB` falls back to the
    // canonical one, which is the study's. That fallback is why the corpus applies here.
    runCtx: createRunContext(),
    abstain: new Set(),
    evidenceProfile,
    evidenceSourceDoi,
  }
}

async function verdictBUnder(evidenceProfile: EvidenceProfile, evidenceSourceDoi?: string) {
  const built = await buildStepVerdicts(ctxUnder(evidenceProfile, evidenceSourceDoi))
  expect(built.map(v => v.component)).toEqual(['B'])
  return built[0]
}

describe('the evidence corpus is a record of what was retrieved', () => {
  it('holds three sources, each with a real identifier and a hash over its own quotation', () => {
    expect(EVIDENCE_CORPUS).toHaveLength(3)
    for (const source of EVIDENCE_CORPUS) {
      expect(source.doi, source.title).toMatch(/^10\.\d{4,}\//u)
      expect(source.authors.length).toBeGreaterThan(0)
      expect(source.title.trim().length).toBeGreaterThan(10)
      expect(source.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
      // The hash is over the excerpt AS STORED. A quotation edited after review changes the hash
      // and this fails, which is the only reason recording one is worth anything.
      expect(source.excerptHash, source.doi).toBe(excerptHashOf(source.excerpt))
      expect(source.excerpt.length).toBeGreaterThan(80)
    }
  })

  it('says how much of each source was read, and where the text came from', () => {
    expect(corpusSource(SUPPORTING_DOI)?.sourceAccess).toBe('full-text')
    expect(corpusSource(AGAINST_DOI)?.sourceAccess).toBe('full-text')
    expect(corpusSource(ABSTRACT_ONLY_DOI)?.sourceAccess).toBe('abstract-only')
    // Two of the three were read as the author's preprint of the published article. The record
    // says so rather than letting the DOI imply the published text was read.
    expect(corpusSource(SUPPORTING_DOI)?.accessNote).toContain('preprint')
    expect(corpusSource(ABSTRACT_ONLY_DOI)?.accessNote).toContain('full text was not readable')
  })

  it('binds every judgement to the claim SENTENCE it was made about', () => {
    for (const assessment of SUPPORT_ASSESSMENTS) {
      expect(assessment.claimRefHash).toBe(claimRefHashOf(assessment.claimRef))
      expect(assessment.rationale.length).toBeGreaterThan(80)
      // A verdict without a stated scope overclaims; the field is required by the type and
      // non-empty by this assertion.
      expect(assessment.scope.length).toBeGreaterThan(80)
    }
    expect(assessmentsFor(CANONICAL.claimRef).length).toBe(3)
    expect(assessmentsFor('a claim nobody reviewed')).toHaveLength(0)
  })

  it('resolves a DOI it holds, and refuses to call an unknown one fabricated', async () => {
    const held = await corpusCitationResolver.resolveMetadata({ kind: 'doi', id: SUPPORTING_DOI })
    expect(held.status).toBe('resolved')
    const unknown = await corpusCitationResolver.resolveMetadata({ kind: 'doi', id: '10.9999/not-held' })
    // `not_found` means "this work does not exist" to the chain, and this resolver searched only
    // its own shelf. Reporting a miss it never established is how a real paper gets called
    // fabricated, so an unknown DOI is an outage-shaped answer instead.
    expect(unknown.status).toBe('temporarily_unavailable')
  })
})

describe('a real B pass', () => {
  it('anchors the study’s claim on a retrieved source under the production profile', async () => {
    const b = await verdictBUnder('production')
    expect(b?.outcome).toBe('passed')
    expect(b?.passed).toBe(true)
    const evidence = String(b?.evidence)
    expect(evidence).toContain('anchoring=true')
    expect(evidence).toContain(SUPPORTING_DOI)
    expect(evidence).toContain(`(${String(corpusSource(SUPPORTING_DOI)?.sourceAccess)})`)
    // Nothing was withheld: this is the profile that refuses synthetic evidence, and the anchor
    // came through it.
    expect(evidence).not.toContain('anchor withheld')
  })

  it('records the claim version’s other reviewed sources on the verdict', async () => {
    const b = await verdictBUnder('production')
    const evidence = String(b?.evidence)
    // A counter-assessed source that nothing adjudicates and nothing reports is indistinguishable
    // from one that was never retrieved. It is named, with the question left open.
    expect(evidence).toContain(`${AGAINST_DOI}=does_not_support`)
    expect(evidence).toContain(`${ABSTRACT_ONLY_DOI}=does_not_support`)
    expect(evidence).toContain('NOT handed to the gate')
  })

  it('carries provenance the policy admits, and the access level of the source it read', async () => {
    const anchors = await buildEvidenceAnchors({
      claimId: CANONICAL.claimId as never,
      claimRef: CANONICAL.claimRef,
      stepId: 'A1-landscape',
      timestamp: 1,
    })
    expect(anchors?.provenance.sourceClass).toBe('literature')
    expect(anchors?.provenance.sourceAccess).toBe('full-text')
    expect(anchors?.source?.doi).toBe(SUPPORTING_DOI)
    expect(admitAsEvidence('production', anchors!.provenance).disposition).toBe('admitted')
  })
})

describe('an unsupported B is refused', () => {
  it('blocks the gate when the consulted source does not support the claim', async () => {
    const b = await verdictBUnder('production', AGAINST_DOI)
    // Not `abstained` and not `passed`: the evidence was readable, it was admitted, and it spoke
    // against the claim. That is core's EXTERNAL_CONTRADICTION, and it is the outcome the review
    // asked to see produced by a real source rather than by a fixture row.
    expect(b?.outcome).toBe('blocked')
    expect(b?.passed).toBe(false)
    expect(String(b?.rationale)).toContain('EXTERNAL_CONTRADICTION')
    expect(String(b?.evidence)).toContain(AGAINST_DOI)
  })
})

describe('a source that could not be read is held, not admitted', () => {
  it('holds the step when the only consulted source was available as an abstract', async () => {
    const b = await verdictBUnder('production', ABSTRACT_ONLY_DOI)
    // `pending` is what an unread source produces, and it is the disposition the README recorded
    // as unreachable end to end. It is a HOLD: the policy cannot say the claim is wrong, only that
    // this material cannot carry it.
    expect(b?.outcome).toBe('abstained')
    expect(String(b?.evidence)).toContain('DSH_EVIDENCE_PENDING_SOURCE_ACCESS')
    expect(String(b?.rationale)).toContain('MISSING_EXTERNAL_ANCHOR')
  })

  it('admits the same unread source under the demo profile, where it still speaks', async () => {
    // The pair is the point: the abstention above is the policy reading `sourceAccess`, not a
    // property of this claim. What the demo profile does with the material afterwards is a
    // separate question and it is answered honestly — `evaluation` admits every class, so the
    // reviewer's `does_not_support` reading reaches the gate and contradicts the claim.
    const b = await verdictBUnder('evaluation', ABSTRACT_ONLY_DOI)
    expect(b?.outcome).toBe('blocked')
    expect(String(b?.rationale)).toContain('EXTERNAL_CONTRADICTION')
  })
})

describe('a judgement is about one claim sentence, and a reworded claim is a different claim', () => {
  it('declines the corpus when the run states a claim nobody assessed', async () => {
    if (A1 === undefined) throw new Error('unreachable')
    const built = await buildStepVerdicts({
      step: A1,
      attemptId: 1,
      commit: receiptFor('A1-landscape', A1.outputs ?? []),
      runCtx: { ...createRunContext(), claimRef: 'a claim nobody reviewed raises the minimum TTC' },
      abstain: new Set(),
      evidenceProfile: 'production',
    })
    const b = built[0]
    // It falls back to the synthetic anchor, and production refuses THAT. The failure mode being
    // prevented is the opposite one: a judgement about the old wording silently counting for the
    // new one.
    expect(await buildEvidenceAnchors({
      claimId: CANONICAL.claimId as never,
      claimRef: 'a claim nobody reviewed raises the minimum TTC',
      stepId: 'A1-landscape',
      timestamp: 1,
    })).toBeUndefined()
    expect(b?.outcome).toBe('abstained')
    expect(String(b?.evidence)).toContain('DSH_EVIDENCE_NOT_PRODUCTION_GRADE')
  })
})
