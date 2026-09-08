// @deepseek-ai/dsh-research-team — T23 external anchor: public API + core bridge.
//
// This module ONLY re-exports the pure anchor surface and provides
// {@link anchorToVerification}, which bridges an {@link AnchorSignal} into the
// core {@link VerificationResult} SHAPE for audit/reference. The bridge is
// explicit about NOT being a usable core external anchor: originalTextAccessed
// is false and method is 'none', so the core gate-B `isExternalAnchor` predicate
// rejects it and a mock anchor can NEVER by itself upgrade a claim to supported.
// The actual B-channel pass/block decision stays with core gate B (unchanged).

import type {
  CitationEvidence,
  CitationRef,
  CitationId,
  ClaimId,
  VerificationConclusion,
  VerificationResult,
} from '@deepseek-ai/dsh-research-core'

import type { AnchorSignal, AnchorVerdict } from './types.ts'
import { ANCHOR_ERROR_PREFIX } from './types.ts'

export * from './types.ts'
export * from './fixture.ts'

function verdictToConclusion(v: AnchorVerdict): VerificationConclusion {
  if (v === 'support') return 'supported'
  if (v === 'contradict') return 'unsupported'
  return 'unverified'
}

/** Bridge an {@link AnchorSignal} into the core {@link VerificationResult} SHAPE.
 *  The produced result carries the anchor's stance as audit metadata but is
 *  explicitly NOT a usable core external anchor (originalTextAccessed: false,
 *  method: 'none', redLineTriggered: false) — so feeding it to core gate B can
 *  NEVER yield 'passed' on its own. The B-channel adjudication is done by the
 *  core gate, not here (T23 does not change gate-B semantics). */
export function anchorToVerification(signal: AnchorSignal): VerificationResult {
  const ref: CitationRef = { kind: 'unknown', id: signal.evidenceRef }
  const evidence: CitationEvidence = { originalTextAccessed: false, method: 'none' }
  return {
    claimId: signal.claimRef as ClaimId,
    citationId: signal.evidenceRef as CitationId,
    ref,
    evidence,
    conclusion: verdictToConclusion(signal.verdict),
    redLineTriggered: false,
    reasonCode: `${ANCHOR_ERROR_PREFIX}SIGNAL_${signal.verdict.toUpperCase()}`,
    timestamp: signal.timestamp,
  }
}
