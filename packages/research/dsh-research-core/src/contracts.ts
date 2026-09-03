/**
 * Frozen cross-module contracts for batch-2 core capabilities (T07 / T08 / T09).
 *
 * WAVE-0 FREEZE (main Agent). This file is the SHARED TYPE BOUNDARY the three
 * implementation agents (A7 L0 routing, A8 citation identity chain, A9 A/B/C gate)
 * build against IN PARALLEL. Each module owns its own directory + tests and MUST
 * NOT import another module's implementation code — cross-module communication
 * goes ONLY through the types defined here, so each module type-checks in
 * isolation (its own files + this contracts file + engine/types.ts), never a
 * sibling module's work-in-progress.
 *
 * These modules are pure-logic SIBLINGS of the state machine, NOT replacements.
 * The state machine (engine/state-machine.ts) RECORDS verdicts; T07/T08/T09
 * PRODUCE the inputs to those verdicts (L0 classification, citation verification,
 * A/B/C adjudication). They do not touch the run store, the host trust channel,
 * or Cordis. No new runtime dependencies; node:crypto only (already used).
 *
 * NON-NEGOTIABLE INVARIANTS (apply to all three modules — Q1 tests these):
 *  - IMMUTABLE SNAPSHOTS: inputs, configs, and return values are deep-cloned /
 *    frozen at the module boundary (structuredClone + Object.freeze). Callers
 *    cannot mutate returned state; modules never retain live refs to caller
 *    inputs (INV-SNAPSHOT-T2). Non-cloneable inputs are rejected, not silently
 *    coerced (DSH_VALUE_NOT_CLONEABLE pattern from the state machine).
 *  - NO DEFAULT PASS: unknown source type, missing source, rule conflict,
 *    insufficient evidence, missing external anchor, or insufficient valid
 *    votes → abstained / blocked / unverified, NEVER a silent pass
 *    (INV-NO-DEFAULT-PASS). Abstention cannot be upgraded to passed downstream.
 *  - NO TRUTH CLAIM: L0 = source RISK + QUALITY tier only; citation = verification
 *    status of one citation; gates = adjudication outcome. None of these assert
 *    "this paper is real", "this claim is proven", or "this source is truthful".
 *  - PURE FUNCTIONS: no network, no filesystem I/O, no shared mutable state, no
 *    clocks (timestamps are caller-injected for determinism). External data
 *    (Crossref/OpenAlex/partition lists) enters ONLY via ADAPTER CONTRACTS whose
 *    implementations live outside these pure modules; batch-2 wires Fixtures/Mocks
 *    — NO real Crossref/OpenAlex/gateway calls, NO real partition lists without
 *    verified license (D16). No real API keys; fixtures use `sk-xxx` placeholder.
 *  - AUDITABLE: every result carries a stable reasonCode (module-prefixed) +
 *    evidence references + a timestamp, so the state-machine audit log and the
 *    gate result are reconcilable.
 *  - ERROR BASE: {@link ResearchError} (engine/state-machine.ts), thrown with a
 *    module-prefixed code. Never throw raw Error / string. See prefixes below.
 *    LAYERING NOTE: the pure modules import the error classes from the state
 *    machine for the shared base type only — there is no runtime cycle
 *    (state-machine never imports l0/citation/gates), but long-term the error
 *    classes should move to a neutral module (e.g. engine/errors.ts) so the
 *    state machine and the pure siblings share a base without coupling.
 *
 * Re-uses existing engine types via relative import (type-only — erased at runtime):
 *   TrinityComponent ('A'|'B'|'C')  — the judgment trinity the gates adjudicate.
 */

import type { TrinityComponent } from './engine/types.ts'

// ── IDs (branded strings: opaque, immutable, mistype-resistant) ───────────────
// Construct at the boundary via `as ClaimId` etc. (a branded string is just a
// string at runtime; structuredClone + JSON preserve it).
export type ClaimId = string & { readonly __brand: 'ClaimId' }
export type CitationId = string & { readonly __brand: 'CitationId' }
export type L0SourceId = string & { readonly __brand: 'L0SourceId' }

// ── Error-code prefixes (globally unique + grep-able; assigned here so the three
//    modules never collide. Agents throw ResearchError('<PREFIX>_<NAME>', msg).) ──
export const L0_ERROR_PREFIX = 'DSH_L0_'
export const CITATION_ERROR_PREFIX = 'DSH_CITATION_'
export const GATE_ERROR_PREFIX = 'DSH_GATE_'

// ── T07: L0 configurable literature routing ───────────────────────────────────
// Directory: src/l0/   Tests: tests/l0/

/** Literature source type. The v1.1 plan (C4) routes these classes, but the
 *  router MUST NOT be a hardcoded `switch` on this union as business logic —
 *  routing is config/adapter-driven; an unknown or extension type resolves to
 *  tier 'unknown' with an abstained/failed status via the adapter + router,
 *  not a closed switch. */
export type L0SourceType =
  | 'journal'
  | 'conference'
  | 'standard'
  | 'report'
  | 'dataset'
  | 'software'
  | 'book'
  | 'preprint'
  | 'unknown'

/** L0 = source RISK + QUALITY tier. NEVER literature truth or claim support.
 *  The tier is a venue-quality LEVEL ONLY — adjudication state ("system could
 *  not decide") lives in {@link L0ClassificationStatus}, so code MUST branch on
 *  `status` and NEVER on tier membership (no `if (tier === 'abstained')`
 *  pattern; 'abstained' is deliberately NOT a tier value).
 *  `unknown` = unknown/missing literature type or missing source identifier;
 *  `unvetted` = source type recognized but no versioned rule matched. */
export type L0Tier =
  | 'tier1' // high-quality venue (top journal/conf per the versioned list)
  | 'tier2' // established venue
  | 'tier3' // borderline / regional
  | 'unvetted' // no versioned rule matched (source known, tier unknown)
  | 'unknown' // unknown source type or missing source identifier

/** L0 routing adjudication state — SEPARATE from the venue-quality tier.
 *  - 'classified'  : a routing judgment was produced (tier tier1..3 / unvetted,
 *                    or tier 'unknown' for a recognized-but-unclassifiable
 *                    literature type).
 *  - 'abstained'   : insufficient data or rule conflict — refused to classify
 *                    (INV-NO-DEFAULT-PASS; e.g. missing source id, conflicting
 *                    external signals, a hostile adapter trying to pass an
 *                    unknown type).
 *  - 'failed'      : adapter fault / corrupted data (adapter threw, or returned
 *                    structurally invalid output). NOT a literature judgment.
 *  Downstream MUST treat anything other than `classified` as non-passing. */
export type L0ClassificationStatus = 'classified' | 'abstained' | 'failed'

export interface L0Classification {
  readonly sourceType: L0SourceType
  readonly tier: L0Tier
  readonly status: L0ClassificationStatus
  readonly riskLevel: 'low' | 'medium' | 'high' | 'unknown'
  readonly rationale: string
  /** Preprints are FLAGGED as not-yet-peer-reviewed; this boolean is a risk
   *  signal, never an assertion that the preprint is real or sound. */
  readonly preprintNotPeerReviewed: boolean
  /** Versioned adapter/fixture id (e.g. 'cas-2024q3' / 'ccf-2023' / 'fixture-mock-v1').
   *  Real partition data is NOT bundled without verified license (D16). */
  readonly ruleVersion: string
}

// ── T08: citation identity chain ──────────────────────────────────────────────
// Directory: src/citation/   Tests: tests/citation/
// Chain: claim_id → citation_id → DOI/arXiv/ISBN/standard → original-text evidence
//        → page/chapter/table/figure → verification method → verification conclusion

export type CitationIdKind = 'doi' | 'arxiv' | 'isbn' | 'standard' | 'unknown'

export interface CitationRef {
  readonly kind: CitationIdKind
  /** The DOI / arXiv id / ISBN / standard number. */
  readonly id: string
  /** Claimed title (for identity-mismatch detection vs. the resolved record). */
  readonly title?: string
  /** Claimed authors (for identity-mismatch detection). */
  readonly authors?: readonly string[]
}

/** How the original text was (or was NOT) accessed. `none` === NOT accessed →
 *  any downstream "verified" claim is a HARD RED-LINE block (#6), never a warning. */
export type VerificationMethod =
  | 'auto_crossref'
  | 'auto_openalex'
  | 'manual_review'
  | 'specialist_agent'
  | 'none'

export interface CitationEvidence {
  readonly originalTextAccessed: boolean
  readonly method: VerificationMethod
  /** Page/chapter/table/figure locator within the source. */
  readonly locator?: {
    readonly page?: number
    readonly chapter?: string
    readonly table?: string
    readonly figure?: string
  }
  /** Snippet/excerpt from the original text (provenance for the verification). */
  readonly excerpt?: string
  /** Caller-injected epoch ms (auditable). undefined iff method === 'none'. */
  readonly accessedAt?: number
  // ── Provenance of WHICH original-text version was accessed. The boolean
  //    `originalTextAccessed` alone is insufficient to claim access to the
  //    original text; batch-2 fixtures fill synthetic values, real wiring must
  //    fill the actual source record identity. ────────────────────────────────
  /** Canonical URI/identifier of the accessed original-text version. */
  readonly sourceUri?: string
  /** Version/edition identifier of the accessed source (e.g. DOI version, arXiv
   *  vN, edition, revision hash). */
  readonly sourceVersion?: string
  /** Content hash (e.g. sha256 hex) of the accessed excerpt/full text, so two
   *  verifications can be proven to refer to the SAME bytes. */
  readonly contentHash?: string
  /** Caller-injected retrieval timestamp (ISO 8601 string; audit-friendly
   *  human-readable counterpart of accessedAt). */
  readonly retrievedAt?: string
}

export type VerificationConclusion =
  | 'supported'
  | 'partially_supported'
  | 'unsupported'
  | 'unverified'
  | 'retracted'
  | 'identity_mismatch'
  | 'blocked' // hard block (incl. the #6 red line AND resolver-confirmed fabrication)

/** Full identity-chain result for one (claim, citation) pair.
 *
 *  SEMANTIC (frozen): `conclusion` is the SINGLE downstream authority.
 *  - 'blocked'   = hard block — covers the #6 red line AND resolver-confirmed
 *                 fabrication (`resolverStatus: 'not_found'`). A fabricated
 *                 citation must NEVER surface as 'unverified' (double-meaning
 *                 hazard); the reasonCode disambiguates
 *                 (DSH_CITATION_RED_LINE_* vs DSH_CITATION_NOT_FOUND).
 *  - 'unverified' = genuinely not-yet-verifiable (resolver temporarily
 *                 unavailable / ambiguous), NOT a hard block, redLineTriggered
 *                 stays false — a service outage must never be misjudged as
 *                 fabricated literature. */
export interface VerificationResult {
  readonly claimId: ClaimId
  readonly citationId: CitationId
  readonly ref: CitationRef
  readonly evidence: CitationEvidence
  readonly conclusion: VerificationConclusion
  /** true when the #6 red line (claimed verification without original-text
   *  access) OR any other hard block fired. Downstream gates MUST treat a
   *  redLineTriggered result as non-passing evidence. */
  readonly redLineTriggered: boolean
  /** Resolver outcome (present whenever the resolver was consulted):
   *  'resolved' / 'not_found' (authoritative miss — fabricated literature) /
   *  'temporarily_unavailable' (service or network fault — NOT fabrication) /
   *  'ambiguous' (multiple candidate records — not uniquely identifiable).
   *  Absent when the #6 red line short-circuited before resolver contact. */
  readonly resolverStatus?: 'resolved' | 'not_found' | 'temporarily_unavailable' | 'ambiguous'
  /** DSH_CITATION_* code (e.g. DSH_CITATION_NOT_FOUND / DSH_CITATION_REDACTED_UNMARKED). */
  readonly reasonCode: string
  /** Caller-injected epoch ms (auditable; deterministic in tests). */
  readonly timestamp: number
}

// ── T09: A/B/C adjudication gate (pure functions) ─────────────────────────────
// Directory: src/gates/   Tests: tests/gates/
// A = adversarial convergence (multi-role rebuttal + vote + dissent)
// B = external anchoring (external evidence — typically T08 VerificationResults)
// C = falsifiable claim → experiment verdict

export type AdjudicationOutcome = 'passed' | 'blocked' | 'failed' | 'abstained'

/** One voter's position for the A-channel. `voterRole` is a ROLE (e.g.
 *  'red-team-1'), never a model id; `modelFamily` is present so same-family votes
 *  can be DETECTED + downweighted — same-family votes MUST NOT be reported as
 *  genuine model heterogeneity (C3). */
export interface AdjudicationVote {
  readonly voterRole: string
  readonly modelFamily?: string
  readonly position: 'support' | 'refute' | 'abstain'
  readonly rationale: string
}

/** C-channel: a falsifiable prediction that an experiment can adjudicate. A
 *  claim with no falsifiable prediction cannot pass the C gate. */
export interface FalsifiablePrediction {
  readonly prediction: string
  readonly experimentResult?: {
    readonly supportsPrediction: boolean
    readonly detail: string
  }
}

export interface AdjudicationConfig {
  /** Golden Set calibration = undefined → the gate MUST abstain (no hardcoded
   *  formal threshold like "2 votes passes" before calibration). */
  readonly minValidVotes?: number
  readonly passThreshold?: number
  readonly requireExternalAnchor?: boolean
  /** Downweight applied to same-model-family votes (0..1). */
  readonly sameFamilyDownweight?: number
  // NOTE: deliberately NO requireFalsifiableResult knob — the C gate
  // hard-requires a falsifiable prediction (blocked otherwise) and cannot be
  // configured to bypass NO DEFAULT PASS (Q1 gap-fill removed the inert field).
}

export interface AdjudicationInput {
  readonly claimId: ClaimId
  readonly component: TrinityComponent // which of A/B/C this gate adjudicates
  /** A-channel: multi-role votes. */
  readonly votes?: readonly AdjudicationVote[]
  /** B-channel: external evidence anchors (typed via this contracts file — A9
   *  consumes the VerificationResult TYPE, never A8's implementation code). */
  readonly verifications?: readonly VerificationResult[]
  /** C-channel: falsifiable prediction + experiment result. */
  readonly falsifiable?: FalsifiablePrediction
  /** Thresholds INJECTED — never hardcoded. Undefined thresholds → abstain. */
  readonly config: AdjudicationConfig
  /** Caller-injected epoch ms (auditable; deterministic in tests). */
  readonly timestamp: number
}

export interface AdjudicationResult {
  readonly claimId: ClaimId
  readonly component: TrinityComponent
  readonly outcome: AdjudicationOutcome
  /** DSH_GATE_* code (e.g. DSH_GATE_INSUFFICIENT_EVIDENCE). */
  readonly reasonCode: string
  /** Evidence references (citation ids / verification results / vote roles). */
  readonly evidenceRefs: readonly string[]
  /** Caller-injected epoch ms (auditable). */
  readonly timestamp: number
  /** Why abstained (insufficient evidence / highly-correlated role opinions /
   *  insufficient valid votes / missing external anchor). undefined if not abstained. */
  readonly abstentionReason?: string
  /** Vote tally (only meaningful for the A-channel). */
  readonly voteTally?: Readonly<Record<string, number>>
  /** Detected same-family clusters (so callers see that heterogeneity is NOT
   *  genuine). Present when same-family voting was detected + downweighted. */
  readonly sameFamilyClusters?: readonly string[]
}

// ── T09: Gate → state-machine mapping (FROZEN — T10-R / Cordis MUST NOT
//         reinterpret outcomes; consume GATE_OUTCOME_TO_INTENT or the single
//         mapping helper exported by the gates module) ────────────────────────
//
//   | Gate result | State-machine handling                                  |
//   |-------------|---------------------------------------------------------|
//   | passed      | gate condition satisfied (step may proceed)              |
//   | blocked     | evidence / quality gate not passed — REWORKABLE          |
//   | failed      | falsifiable claim negated by experiment, or an           |
//   |             | unrecoverable execution error                            |
//   | abstained   | MUST NOT pass; stay gated or enter the explicit           |
//   |             | human-adjudication path                                  |
//
// FORBIDDEN by this table:
//   - abstained → passed (never upgradable downstream);
//   - 'missing external anchor' freely reinterpreted by the caller as
//     blocked / failed — gate B returns 'abstained' and the intent below is
//     'hold_abstained'; the mapping is the SINGLE interpretation point.
export type StateMachineGateIntent = 'pass' | 'rework' | 'hard_fail' | 'hold_abstained'

export const GATE_OUTCOME_TO_INTENT: Readonly<
  Record<AdjudicationOutcome, StateMachineGateIntent>
> = Object.freeze({
  passed: 'pass',
  blocked: 'rework',
  failed: 'hard_fail',
  abstained: 'hold_abstained',
})
