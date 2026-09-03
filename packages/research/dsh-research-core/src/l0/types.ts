/**
 * T07 L0 module-local types (the SHARED output types live in the frozen
 * contracts.ts: L0Classification / L0SourceType / L0Tier / L0ClassificationStatus /
 * L0SourceId / L0_ERROR_PREFIX). This file defines only the module-local input +
 * adapter shapes that the pure router consumes.
 *
 * The router takes an {@link L0SourceInput} and a VERSIONED
 * {@link L0RoutingAdapter} — the ONLY channel external partition data (CAS /
 * CCF / CORE) enters the pure module. Real partition data is NOT bundled
 * without a verified license (D16); batch-2 ships a mock fixture impl in
 * ./routing.ts.
 *
 * INVARIANTS (contracts.ts header) enforced by the router:
 *  - IMMUTABLE SNAPSHOTS: the source is deep-cloned at the boundary; the
 *    adapter's returned decision is deep-cloned before use; the returned
 *    classification is Object.freeze'd. Non-cloneable input -> ResearchError.
 *  - NO DEFAULT PASS: unknown / extension source type, missing source id, or a
 *    rule conflict -> tier 'unknown' with status 'abstained' (or 'failed' for
 *    an adapter fault), NEVER a passing tier; adjudication state lives in
 *    `status` (classified/abstained/failed), never in the tier value.
 *  - NO TRUTH CLAIM: preprintNotPeerReviewed is a RISK flag, never an assertion
 *    that the preprint is real / sound / claim-supporting.
 */

import type { L0ClassificationStatus, L0SourceId, L0SourceType, L0Tier } from '../contracts.ts'

/** One literature source to classify. All fields readonly; deep-cloned at the
 *  boundary by {@link classifyL0} (the router never retains a live ref to the
 *  caller's object). */
export interface L0SourceInput {
  /** Opaque source identifier (branded). Empty / missing / non-string ->
   *  tier 'unknown' (NO-DEFAULT-PASS: a source with no id never gets a passing
   *  tier, regardless of what the adapter returns). */
  readonly sourceId: L0SourceId
  readonly sourceType: L0SourceType
  /** Venue / journal / conference / publisher name (for partition lookup). */
  readonly venue?: string
  readonly title?: string
  readonly doi?: string
  readonly issn?: string
  /** External CAS partition (e.g. '1' / '1区') if known — INJECTED, never
   *  fetched by the pure module. */
  readonly casPartition?: string
  /** External CCF rating (A / B / C) if known — INJECTED, never fetched. */
  readonly ccfRating?: string
  /** External CORE rank (A* / A / B / C / unranked) if known — INJECTED. */
  readonly coreRank?: string
  /** Extension bag for adapter-specific signals (must be structured-cloneable;
   *  a function/symbol here is rejected with DSH_L0_VALUE_NOT_CLONEABLE). */
  readonly extra?: Readonly<Record<string, unknown>>
}

/** One adapter routing decision for a source. The adapter is the ROUTING
 *  authority; the router is the TRUST boundary that enforces NO-DEFAULT-PASS
 *  on top of this (untrusted) output — a buggy or hostile adapter can never
 *  silently pass an unknown / missing / conflicted source.
 *
 *  `status` (optional) is the adapter's adjudication state. When omitted the
 *  router infers it: 'classified' if the tier is structurally valid, 'failed'
 *  if it is not. The router ALWAYS re-validates (see classifyL0). */
export interface L0RoutingDecision {
  readonly tier: L0Tier
  /** Adapter-side adjudication state (see L0ClassificationStatus in
   *  contracts.ts): 'classified' | 'abstained' | 'failed'. Optional for
   *  ergonomics; the router defaults + re-validates. */
  readonly status?: L0ClassificationStatus
  readonly riskLevel: 'low' | 'medium' | 'high' | 'unknown'
  readonly rationale: string
  /** true when the adapter detected a rule conflict (e.g. two versioned
   *  partition lists disagree on the same source). The router maps a
   *  conflicted decision to status 'abstained' (refuses to classify). */
  readonly conflict?: boolean
}

/**
 * Versioned routing adapter — the adapter contract external partition data
 * (CAS / CCF / CORE) implements. Implementations live OUTSIDE the pure module;
 * batch-2 ships {@link createMockL0Adapter} (a fixture; NOT real partition
 * data). The adapter MUST:
 *  - be pure (no side effects, no network/fs/clocks);
 *  - return tier 'unknown' (+ status 'abstained' where it refuses, or
 *    'classified' where it determined "unrecognized type") for unknown /
 *    extension source types or missing identifiers, and signal conflicts via
 *    `conflict: true`;
 *  - on its OWN fault (throw / corrupted internal data) return or yield
 *    status 'failed' — an adapter exception must never be silently treated as
 *    a literature judgment.
 * The router double-checks every decision (NO-DEFAULT-PASS), so a buggy or
 * hostile adapter returning a passing tier for an unknown / missing source is
 * clamped DOWN to 'unknown'/'abstained' — never a silent pass.
 */
export interface L0RoutingAdapter {
  /** Versioned rule id (e.g. 'cas-2024q3', 'ccf-2023', 'fixture-mock-v1').
   *  Carried through to the classification so the state-machine audit log can
   *  reconcile which rule set produced a tier. */
  readonly ruleVersion: string
  /** Pure: route one source to a tier + risk decision. No side effects. */
  route(source: L0SourceInput): L0RoutingDecision
}
