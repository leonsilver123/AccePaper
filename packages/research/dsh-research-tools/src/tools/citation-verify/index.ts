// @deepseek-ai/dsh-research-tools — citation-verify tool (T13).
//
// THIN DELEGATION FACADE over T08 core verifyCitation. Every adjudication
// branch — the #6 red line (claimed verification without original-text access),
// resolver-confirmed fabricated literature (not_found => blocked), resolver
// availability (temporarily_unavailable / ambiguous => unverified, NO red line),
// retraction, identity mismatch, correlation-as-causation, content gaps — lives
// in @deepseek-ai/dsh-research-core (src/citation/verify.ts). The tool adds NO
// verdict logic: it validates only the non-empty branded ids (the same check
// core performs first), delegates with core's exact argument order, and wraps
// the frozen VerificationResult into a frozen tool artifact envelope.
//
// If core throws, the error propagates unwrapped (error transparency, same as
// the I1 delegation layer) — the tool never reinterprets a failure.

import type {
  CitationEvidence,
  CitationId,
  CitationRef,
  ClaimId,
  VerificationResult,
  VerifyCitationOptions,
} from '@deepseek-ai/dsh-research-core'
import type { CitationResolverAdapter } from '@deepseek-ai/dsh-research-core'
import { ResearchError, verifyCitation } from '@deepseek-ai/dsh-research-core'
import { freezeArtifact } from '../../shared.ts'
import type { ToolArtifactMeta } from '../../shared.ts'

/** Stable tool identity stamped into every artifact's {@link ToolArtifactMeta}. */
export const CITATION_VERIFY_TOOL_ID = 'citation-verify' as const
/** Tool-contract version (independent of the package semver). */
export const CITATION_VERIFY_TOOL_VERSION = '0.1.0' as const

// Empty claim/citation ids map to the SAME code core verify.ts uses for its
// own assertNonEmptyBrand guard (DSH_CITATION_INVALID_REF), so a tool-level
// fail-fast is auditable identically to a core-thrown one.
const CODE_TOOL_EMPTY_ID = 'DSH_CITATION_INVALID_REF'

/** Tool input. `timestamp` is caller-injected for determinism (same convention
 *  as core); it falls back to the clock ONLY when the caller omits it. */
export interface CitationVerifyToolInput {
  readonly claimId: ClaimId
  readonly citationId: CitationId
  readonly ref: CitationRef
  readonly evidence: CitationEvidence
  /** Caller-injected epoch ms (auditable; deterministic in tests). Omit only
   *  when a live wall-clock default is acceptable. */
  readonly timestamp?: number
  readonly options: VerifyCitationOptions
}

/** Tool deps — the resolver adapter seam. The tool never constructs one; the
 *  caller injects the Fixture/Mock (tests) or a real resolver (future wiring). */
export interface CitationVerifyToolDeps {
  readonly resolver: CitationResolverAdapter
}

/** Frozen artifact envelope: attribution {@link ToolArtifactMeta} + the
 *  delegated core {@link VerificationResult}. Downstream (T19 registry) reads
 *  this artifact; interpretation of conclusion/reasonCode stays in core
 *  (GATE_OUTCOME_TO_INTENT etc. — never re-mapped here). */
export interface CitationVerifyToolArtifact {
  readonly meta: ToolArtifactMeta
  readonly result: VerificationResult
}

function assertNonEmptyBrand(value: ClaimId | CitationId, name: 'claimId' | 'citationId'): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ResearchError(CODE_TOOL_EMPTY_ID, `${name} must be a non-empty string`)
  }
}

/**
 * Verify one (claim, citation) pair as a tool. Thin adapter: validates the
 * non-empty branded ids, delegates the full adjudication to core
 * {@link verifyCitation}, then freezes the result into a
 * {@link CitationVerifyToolArtifact} via {@link freezeArtifact}.
 *
 * @param input the tool input (ids, ref, evidence, options, optional timestamp).
 * @param deps the injected resolver adapter seam.
 * @returns a deeply-frozen artifact; `result` is core's frozen VerificationResult.
 * @throws ResearchError — from the tool for empty branded ids, or propagated
 *   unwrapped from core for any deeper validation/adjudication fault.
 */
export function verifyCitationTool(
  input: CitationVerifyToolInput,
  deps: CitationVerifyToolDeps,
): CitationVerifyToolArtifact {
  // Tool-boundary validation — ONLY the non-empty branded ids. Ref/evidence/
  // options shape and all verdict sanity stay in core (delegated below).
  assertNonEmptyBrand(input.claimId, 'claimId')
  assertNonEmptyBrand(input.citationId, 'citationId')

  // Caller-injected timestamp is authoritative; the clock fallback runs ONLY
  // when the caller omits it (production convenience).
  const timestamp: number = input.timestamp ?? Date.now()

  // THIN DELEGATION — core's exact argument order, result handed back as-is.
  const result: VerificationResult = verifyCitation(
    input.claimId,
    input.citationId,
    input.ref,
    input.evidence,
    deps.resolver,
    timestamp,
    input.options,
  )

  return freezeArtifact<CitationVerifyToolArtifact>({
    meta: {
      toolId: CITATION_VERIFY_TOOL_ID,
      version: CITATION_VERIFY_TOOL_VERSION,
      producedAt: timestamp,
    },
    result,
  })
}

// Re-export the core types this tool surfaces so the future registry can type
// the tool without reaching into core itself.
export type {
  CitationResolverAdapter,
  CitationEvidence,
  CitationRef,
  CitationId,
  ClaimId,
  VerificationResult,
  VerifyCitationOptions,
} from '@deepseek-ai/dsh-research-core'
