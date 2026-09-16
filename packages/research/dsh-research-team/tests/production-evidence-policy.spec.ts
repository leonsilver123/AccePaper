/**
 * The B channel's anchor is a FIXTURE, and the evidence profile decides whether that may carry
 * the gate.
 *
 * The defect this pins: the production B channel — the judgment that a claim is anchored in
 * external evidence — passed on a synthetic anchor. The citation identity chain really ran, but
 * it ran against `MockCitationResolverAdapter` over `10.0000/synthetic.t19b-anchor`, and the
 * anchoring verification that reached `adjudicate({ component: 'B', requireExternalAnchor: true })`
 * was therefore produced by a simulated resolver over a corpus nobody wrote. Nothing hid this —
 * `anchor-fixture.ts` said `mock_external` in its own basis string — but nothing stopped it from
 * counting as a production gate pass either.
 *
 * The fix is a declaration the policy can read: the anchor now carries `fixture` provenance, and
 * a `production` profile refuses it. The refusal WITHHOLDS the verifications and lets core reach
 * its own `GATE_MISSING_EXTERNAL_ANCHOR` abstention, so the gate still has exactly one
 * adjudication source and no outcome is reinterpreted here.
 *
 * `A1-landscape` is the step under test because its gate is exactly `['B']`: the assertion is
 * about the B channel and cannot be satisfied by another component's outcome.
 */

import { describe, expect, it } from 'vitest'
import { admitAsEvidence, evidenceEligibilityOf, getStepDefinitionById } from '@deepseek-ai/dsh-research-core'
import type { EvidenceProfile, StepDefinition } from '@deepseek-ai/dsh-research-core'

import { createRunContext } from '../src/runner/drive.ts'
import { buildBChannelAnchors } from '../src/runner/anchor-fixture.ts'
import { buildStepVerdicts } from '../src/runner/verdict.ts'
import type { VerdictBuildCtx } from '../src/runner/types.ts'
import { receiptFor } from './support/receipt.ts'

/** A1's gate is `['B']` alone, so every verdict this spec builds comes from the B channel. */
const A1: StepDefinition | undefined = getStepDefinitionById('A1-landscape')

function ctxWith(evidenceProfile: EvidenceProfile): VerdictBuildCtx {
  if (A1 === undefined) throw new Error('production-evidence-policy: A1-landscape is not a core step')
  return {
    step: A1,
    attemptId: 1,
    commit: receiptFor('A1-landscape', A1.outputs ?? []),
    runCtx: createRunContext(),
    abstain: new Set(),
    evidenceProfile,
  }
}

/** The B verdict this step's gate produces under one profile, over the default fixture anchor. */
async function verdictBUnder(evidenceProfile: EvidenceProfile) {
  const built = await buildStepVerdicts(ctxWith(evidenceProfile))
  expect(built.map(v => v.component)).toEqual(['B'])
  return built[0]
}

describe('the B channel anchor is a fixture, and production refuses it', () => {
  it('HOLDS the step under the production profile instead of passing on the synthetic anchor', async () => {
    // The anchor this run would use is real in every respect except the one that matters: the
    // chain executed and the resolver agreed. Building it here proves the abstention below is
    // the policy's doing and not an absent or broken fixture — the SAME anchor anchors.
    const anchors = await buildBChannelAnchors({
      claimId: 'claim-x' as never,
      stepId: 'A1-landscape',
      timestamp: 1,
    })
    expect(anchors.anchoring).toBe(true)
    expect(anchors.provenance.sourceClass).toBe('fixture')

    const b = await verdictBUnder('production')
    expect(b?.outcome).toBe('abstained')
    expect(b?.passed).toBe(false)
    // The abstention has to be CORE's own missing-anchor path: it is the evidence for the claim
    // that the verifications were withheld rather than the gate being short-circuited elsewhere.
    expect(String(b?.rationale)).toContain('MISSING_EXTERNAL_ANCHOR')
  })

  it('names the policy code and reason in the evidence, so the audit says why the anchor was unusable', async () => {
    const b = await verdictBUnder('production')
    const evidence = String(b?.evidence)
    expect(evidence).toContain('DSH_EVIDENCE_NOT_PRODUCTION_GRADE')
    // The reason states which class was refused, so a reader is not left to guess whether the
    // refusal was about the resolver, the access level, or the class.
    expect(evidence).toContain("production profile refuses 'fixture' evidence")
    // ...and the anchor's own basis is still there, so the trail shows what was withheld.
    expect(evidence).toContain('MockCitationResolverAdapter')
  })

  it('refuses on the CLASS, not on the access level', async () => {
    // `sourceAccess: 'full-text'` is deliberate: the simulated resolver really does hand back
    // the text it was seeded with. If the fixture declared anything less, the refusal below
    // could be read as "the source was not read through" — a hold that more reading would
    // release — when the actual finding is that no amount of reading makes it real.
    const anchors = await buildBChannelAnchors({
      claimId: 'claim-x' as never,
      stepId: 'A1-landscape',
      timestamp: 1,
    })
    expect(anchors.provenance.sourceAccess).toBe('full-text')
    const admission = admitAsEvidence('production', anchors.provenance)
    expect(admission.disposition).toBe('refused')
    expect(admission.code).toBe('DSH_EVIDENCE_NOT_PRODUCTION_GRADE')
  })
})

describe('the evaluation profile is the demo path, and it is not a permission to submit', () => {
  it('admits the same fixture anchor, which is what the channel does today', async () => {
    // This is the demo profile: the default for a run that declares nothing, and the one every
    // existing run uses. It keeps passing here, so the production refusal above is known to be
    // the profile's doing rather than a change to the channel.
    const b = await verdictBUnder('evaluation')
    expect(b?.outcome).toBe('passed')
    expect(b?.passed).toBe(true)
    expect(String(b?.evidence)).not.toContain('DSH_EVIDENCE_NOT_PRODUCTION_GRADE')
    expect(String(b?.evidence)).not.toContain('anchor withheld')
    // This verdict passed, so it is exactly the one a reader could mistake for a production
    // anchor. Nothing in it may claim that standing.
    expect(String(b?.evidence)).not.toContain('production')
  })

  it('stamps that same passing verdict ineligible, while production stays eligible', async () => {
    // The pair matters more than either value: a function that answered `false` always would
    // satisfy an assertion on `evaluation` alone and say nothing about the profiles.
    expect(evidenceEligibilityOf('evaluation').eligible).toBe(false)
    expect(evidenceEligibilityOf('evaluation').reason).toContain('evaluation profile')
    expect(evidenceEligibilityOf('production').eligible).toBe(true)
  })
})
