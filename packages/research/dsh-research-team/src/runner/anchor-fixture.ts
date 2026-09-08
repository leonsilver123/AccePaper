// @deepseek-ai/dsh-research-team — T19-B B-channel anchor construction (mock_external).
//
// Truthfulness level: `mock_external` — REAL adaptation logic against a SIMULATED
// external system. Nothing here hand-writes a `VerificationResult`:
//
//   1. Claim stance comes from the T23 external-anchor fixture
//      (`../anchor/fixture.ts` → `lookupAnchor`). A miss is fail-closed
//      (`makeInconclusiveAnchorSignal`) — never a default support.
//   2. The T23 signal is bridged through T23's own `anchorToVerification` and
//      carried as AUDIT evidence. By T23's contract that bridge sets
//      `originalTextAccessed: false` / `method: 'none'`, so core's
//      `isExternalAnchor` predicate rejects it: a mock anchor can NEVER by itself
//      anchor a claim.
//   3. The anchoring `VerificationResult` is produced by the REAL core citation
//      identity chain `verifyCitation(...)` running against a SIMULATED resolver
//      (`MockCitationResolverAdapter`). The full chain executes for real —
//      red line #6, resolver triage (#1 fabricated / outage / ambiguous),
//      retraction #4, identity mismatch #2, causation #5, content support #3.
//   4. That anchoring verification is only requested when the T23 stance is
//      `support`. A non-support stance yields the audit bridge ALONE, so core
//      `adjudicate('B')` abstains (NO DEFAULT PASS).
//
// This is a simulated resolver over a synthetic corpus. It is NEVER real
// literature verification and must never be reported as such.

import type {
  CitationEvidence,
  CitationId,
  CitationRef,
  ClaimId,
  VerificationResult,
} from '@deepseek-ai/dsh-research-core'
import { MockCitationResolverAdapter, verifyCitation } from '@deepseek-ai/dsh-research-core'

import type { AnchorSignal } from '../anchor/types.ts'
import {
  anchorKey,
  anchorToVerification,
  lookupAnchor,
  makeInconclusiveAnchorSignal,
} from '../anchor/index.ts'

/** Rule version of this simulated resolver (auditable; never a real partition id). */
export const ANCHOR_FIXTURE_RULE_VERSION = 't19b-anchor-mock-v1'

/** T23 L0 fixture row with tier1 + `support` stance (the happy-path anchor). */
export const B_CHANNEL_ANCHOR_REF = 'syn-l0-001'
/** T23 L0 fixture row with tier2 + `contradict` stance (fail-closed scenario). */
export const B_CHANNEL_CONTRADICT_REF = 'syn-l0-002'

const SYNTHETIC_TITLE = 'Synthetic Adaptive Signal Control Study (mock corpus)'
const SYNTHETIC_AUTHORS: ReadonlyArray<string> = ['Fixture, A.', 'Fixture, B.']
const SYNTHETIC_DOI = '10.0000/synthetic.t19b-anchor'

/**
 * The SIMULATED external resolver. One synthetic record, keyed the way
 * `MockCitationResolverAdapter` keys its table (`${kind}:${normalized-id}`).
 */
export const anchorResolver = new MockCitationResolverAdapter(
  {
    [`doi:${SYNTHETIC_DOI}`]: {
      title: SYNTHETIC_TITLE,
      authors: [...SYNTHETIC_AUTHORS],
      retracted: false,
    },
  },
  { ruleVersion: ANCHOR_FIXTURE_RULE_VERSION },
)

export interface AnchorVerificationSpec {
  readonly claimId: ClaimId
  readonly stepId: string
  readonly timestamp: number
  /** T23 L0 fixture ref to consult (defaults to the tier1/support row). */
  readonly anchorRef?: string
}

/** What the B channel feeds into core `adjudicate('B')`, plus its audit trail. */
export interface BChannelAnchors {
  /** Verifications handed to core `adjudicate('B')` (audit bridge + optional anchor). */
  readonly verifications: ReadonlyArray<VerificationResult>
  /** The T23 anchor signal that decided whether to seek an anchoring verification. */
  readonly anchorSignal: AnchorSignal
  /** True when a core-usable external anchor was produced. */
  readonly anchoring: boolean
  /** Human-readable basis for the report / gate evidence string. */
  readonly basis: string
}

/**
 * Run the REAL core citation identity chain against the SIMULATED resolver to
 * obtain an anchoring {@link VerificationResult}. The outcome is whatever the
 * chain decides — this function does not post-process or override it.
 */
function verifyAgainstMockResolver(spec: AnchorVerificationSpec): VerificationResult {
  const ref: CitationRef = {
    kind: 'doi',
    id: SYNTHETIC_DOI,
    title: SYNTHETIC_TITLE,
    authors: [...SYNTHETIC_AUTHORS],
  }
  const evidence: CitationEvidence = {
    originalTextAccessed: true,
    method: 'auto_crossref',
    locator: { page: 1 },
    excerpt: 'synthetic excerpt from the mock corpus (mock_external — not real literature)',
    accessedAt: spec.timestamp,
    sourceUri: `mock://anchor/t19b/${spec.stepId}`,
    sourceVersion: ANCHOR_FIXTURE_RULE_VERSION,
    contentHash: 'deadbeef00',
    retrievedAt: new Date(spec.timestamp).toISOString(),
  }
  return verifyCitation(
    spec.claimId,
    `anchor-${spec.stepId}` as unknown as CitationId,
    ref,
    evidence,
    anchorResolver,
    spec.timestamp,
    { claimedConclusion: 'supported', contentSupportsClaim: true },
  )
}

/**
 * Build the B-channel verification set for one step attempt. See the module
 * header for the four-stage chain. The core B gate — not this function — decides
 * pass / abstain / block.
 */
export function buildBChannelAnchors(spec: AnchorVerificationSpec): BChannelAnchors {
  const ref = spec.anchorRef ?? B_CHANNEL_ANCHOR_REF
  const key = anchorKey('l0-tier', ref)
  const signal =
    lookupAnchor(key, spec.timestamp) ??
    makeInconclusiveAnchorSignal(
      ref,
      'l0-tier',
      'synthetic fixture: T23 L0 lookup missed (fail-closed → inconclusive)',
      spec.timestamp,
    )
  // T23's bridge is audit-only: originalTextAccessed=false / method='none' means
  // core `isExternalAnchor` rejects it. It can never anchor on its own.
  const bridged = anchorToVerification(signal)

  if (signal.verdict !== 'support') {
    return {
      verifications: [bridged],
      anchorSignal: signal,
      anchoring: false,
      basis:
        `T23 anchor '${key}' verdict=${signal.verdict} → no anchoring verification requested ` +
        '(fail-closed; core adjudicate(\'B\') abstains — NO DEFAULT PASS)',
    }
  }

  const verified = verifyAgainstMockResolver(spec)
  const anchoring =
    verified.evidence.originalTextAccessed &&
    verified.evidence.method !== 'none' &&
    !verified.redLineTriggered &&
    (verified.conclusion === 'supported' || verified.conclusion === 'partially_supported')
  return {
    verifications: [bridged, verified],
    anchoring,
    anchorSignal: signal,
    basis:
      `T23 anchor '${key}' verdict=support → core verifyCitation over MockCitationResolverAdapter ` +
      `returned conclusion=${verified.conclusion} (reasonCode=${verified.reasonCode}); ` +
      'real identity chain, simulated external resolver (mock_external)',
  }
}
