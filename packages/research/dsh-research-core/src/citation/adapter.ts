/**
 * T08 citation identity chain — resolver adapter contract (EXTERNAL DATA SEAM).
 *
 * The citation verifier is PURE: it never performs network/filesystem I/O and
 * holds no API keys. External bibliographic metadata (Crossref / OpenAlex /
 * publisher APIs) enters ONLY through a {@link CitationResolverAdapter}
 * implementation whose real wiring lives OUTSIDE this pure module. Batch-2
 * ships a Fixture/Mock implementation (./fixture.ts) — NO real Crossref /
 * OpenAlex / gateway calls, NO real keys (fixtures use `sk-xxx` placeholder).
 *
 * The adapter resolves the IDENTITY of a citation ref and MUST distinguish the
 * four resolver outcomes (frozen — a service outage must never be misjudged as
 * fabricated literature):
 *   - 'resolved'                -> the id maps to exactly one bibliographic
 *                                  record ({@link ResolvedCitationMetadata});
 *   - 'not_found'               -> the authoritative data source CONFIRMS the
 *                                  id resolves to nothing (fabricated #1) →
 *                                  the verifier hard-blocks;
 *   - 'temporarily_unavailable' -> service / network fault — NOT a literature
 *                                  judgment; the verifier returns 'unverified'
 *                                  (no red line);
 *   - 'ambiguous'               -> multiple candidate records, not uniquely
 *                                  identifiable → 'unverified' (no red line).
 *
 * The resolved metadata asserts nothing about claim support (#3/#5 are
 * caller-injected signals, not adapter outputs) — see {@link ./verify.ts}.
 */

import type { CitationRef } from '../contracts.ts'

/** Adapter-side resolver outcome. See the file header for the semantics of
 *  each branch; the verifier maps them to hard blocks / unverified as frozen
 *  in contracts.ts. */
export type ResolverOutcome =
  | {
    readonly status: 'resolved'
    readonly metadata: ResolvedCitationMetadata
  }
  | {
    readonly status: 'not_found'
    readonly detail?: string
  }
  | {
    readonly status: 'temporarily_unavailable'
    readonly detail?: string
  }
  | {
    readonly status: 'ambiguous'
    readonly detail?: string
  }

/** The four resolver statuses (also carried on VerificationResult.resolverStatus
 *  for auditability). */
export type ResolverStatus = ResolverOutcome['status']

/**
 * Bibliographic metadata resolved for one {@link CitationRef}. Returned inside
 * a 'resolved' {@link ResolverOutcome}; the verifier deep-clones + freezes it
 * at the boundary.
 */
export interface ResolvedCitationMetadata {
  /** Canonical title from the resolved record (identity-mismatch oracle). */
  readonly title: string
  /** Canonical author list from the resolved record. */
  readonly authors: readonly string[]
  /** True when the resolved record is marked retracted by the source of truth. */
  readonly retracted: boolean
  /** Adapter/fixture version id (auditable; e.g. 'crossref-fixture-v1'). */
  readonly ruleVersion: string
}

/**
 * Resolves bibliographic metadata for a citation ref. PURE in batch-2
 * (Fixture/Mock); real impls live outside the pure module and MUST be
 * network-free in tests.
 *
 * @param ref a frozen, deep-cloned snapshot of the citation ref (the verifier
 *   passes a clone so the adapter cannot mutate caller state).
 * @returns a discriminated {@link ResolverOutcome} — never `undefined`, never
 *   a bare `null` (a confirmed miss is `{ status: 'not_found' }`).
 */
export interface CitationResolverAdapter {
  resolveMetadata(ref: CitationRef): ResolverOutcome
}
