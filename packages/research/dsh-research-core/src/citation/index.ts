/**
 * T08 citation identity chain — public entry of the citation module.
 *
 * Exports the pure verifier ({@link verifyCitation}), the resolver adapter
 * contract + resolved-metadata types, the batch-2 Fixture/Mock resolver, the
 * caller-injected options, and the stable DSH_CITATION_* reason-code constants.
 *
 * Re-exports the shared contract TYPES (ClaimId/CitationId/CitationRef/
 * CitationEvidence/VerificationMethod/VerificationConclusion/VerificationResult/
 * CitationIdKind) and the {@link CITATION_ERROR_PREFIX} from the frozen
 * contracts file (../contracts.ts) so consumers import a single surface.
 *
 * This module does NOT touch the run store, host trust channel, or Cordis; it
 * is a pure-logic SIBLING of the state machine that PRODUCES verification
 * results the B-channel gate (T09) consumes via the contracts types.
 */

export type {
  ResolvedCitationMetadata,
  CitationResolverAdapter,
  ResolverOutcome,
  ResolverStatus,
} from './adapter.ts'
export {
  MockCitationResolverAdapter,
} from './fixture.ts'
export type { FixtureRecord, MockCitationResolverOptions } from './fixture.ts'
export type { VerifyCitationOptions } from './verify.ts'
export { verifyCitation } from './verify.ts'
export {
  CITATION_CODE_RED_LINE_NO_ORIGINAL,
  CITATION_CODE_NOT_FOUND,
  CITATION_CODE_TEMPORARILY_UNAVAILABLE,
  CITATION_CODE_AMBIGUOUS,
  CITATION_CODE_REDACTED_UNMARKED,
  CITATION_CODE_RETRACTED_MARKED,
  CITATION_CODE_IDENTITY_MISMATCH,
  CITATION_CODE_CORRELATION_AS_CAUSATION,
  CITATION_CODE_UNSUPPORTED,
  CITATION_CODE_SUPPORTED,
  CITATION_CODE_PARTIALLY_SUPPORTED,
  CITATION_CODE_UNVERIFIED,
  CITATION_CODE_BLOCKED,
} from './verify.ts'

// Re-export the shared contract types + prefix so this is a single import surface.
export type {
  ClaimId,
  CitationId,
  CitationIdKind,
  CitationRef,
  CitationEvidence,
  VerificationMethod,
  VerificationConclusion,
  VerificationResult,
} from '../contracts.ts'
export { CITATION_ERROR_PREFIX } from '../contracts.ts'
// Error base re-export (consumers catch ResearchError; codes are DSH_CITATION_*).
export { ResearchError } from '../engine/state-machine.ts'
