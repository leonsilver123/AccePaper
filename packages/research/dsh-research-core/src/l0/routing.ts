/**
 * T07 L0 configurable literature routing — pure functions.
 *
 * L0 = source RISK + QUALITY tier ONLY. This module NEVER asserts that a piece
 * of literature is real, that a claim is supported, or that a source is
 * truthful. The tier is a venue-quality + risk classification produced by an
 * injected, VERSIONED {@link L0RoutingAdapter}; the router is a trust boundary
 * that enforces the NO-DEFAULT-PASS invariant on top of (untrusted) adapter
 * output.
 *
 * ROUTING IS ADAPTER-DRIVEN, NOT A HARDCODED `switch` ON THE SOURCE-TYPE UNION.
 * Unknown / extension source types and missing source identifiers resolve to
 * tier 'unknown' (never a silent passing tier); adjudication state is carried
 * in {@link L0ClassificationStatus} — 'classified' | 'abstained' | 'failed' —
 * which is SEPARATE from the venue-quality tier, so downstream code MUST branch
 * on `status` and never on tier membership (no `tier === 'abstained'` pattern).
 * The only logic the router keeps is the NO-DEFAULT-PASS *clamp-down* (it only
 * ever narrows an adapter decision toward 'unknown'/'abstained'/'failed', never
 * upgrades it toward a passing tier) and the deterministic preprint risk flag.
 *
 * Status triage (frozen, see contracts.ts):
 *  - insufficient data / rule conflict       -> 'abstained' (refuse to classify);
 *  - adapter fault / corrupted data          -> 'failed' (thrown exception or
 *    structurally invalid output — NOT a literature judgment);
 *  - unrecognized literature type            -> tier 'unknown' (a completed
 *    classification with no tier, status 'classified' is possible when the
 *    adapter determined "type unknown").
 *
 * Invariants (contracts.ts header):
 *  - IMMUTABLE SNAPSHOTS: input cloned at the boundary; return Object.freeze'd.
 *    Non-cloneable input -> ResearchError('DSH_L0_VALUE_NOT_CLONEABLE').
 *  - NO DEFAULT PASS: unknown / missing / conflict -> unknown / abstained / failed.
 *  - NO TRUTH CLAIM: preprintNotPeerReviewed is a risk flag, not a truth claim.
 *  - PURE FUNCTIONS: no network/fs/clocks; ruleVersion is caller-injected.
 *  - ERROR BASE: ResearchError, DSH_L0_* codes. Never raw Error/string.
 */

import type {
  L0Classification,
  L0ClassificationStatus,
  L0SourceType,
  L0Tier,
} from '../contracts.ts'
import { L0_ERROR_PREFIX } from '../contracts.ts'
import { ResearchError } from '../engine/state-machine.ts'
import type {
  L0RoutingAdapter,
  L0RoutingDecision,
  L0SourceInput,
} from './types.ts'

/** Versioned id of the shipped mock fixture (NOT real partition data; D16). */
export const MOCK_L0_RULE_VERSION = 'fixture-mock-v1'

/** Known source-type union (runtime guard; extension strings -> 'unknown'). */
const KNOWN_SOURCE_TYPES: ReadonlySet<L0SourceType> = new Set<L0SourceType>([
  'journal', 'conference', 'standard', 'report', 'dataset',
  'software', 'book', 'preprint', 'unknown',
])

/** All valid L0Tier values (runtime guard for hostile adapter output).
 *  'abstained' is deliberately NOT a tier value (status carries it). */
const VALID_TIERS: ReadonlySet<L0Tier> = new Set<L0Tier>([
  'tier1', 'tier2', 'tier3', 'unvetted', 'unknown',
])

/** All valid adjudication statuses (runtime guard). */
const VALID_STATUSES: ReadonlySet<L0ClassificationStatus> = new Set<
  L0ClassificationStatus
>(['classified', 'abstained', 'failed'])

/** All valid risk levels (runtime guard for hostile adapter output). */
const VALID_RISK_LEVELS: ReadonlySet<'low' | 'medium' | 'high' | 'unknown'> =
  new Set<'low' | 'medium' | 'high' | 'unknown'>(['low', 'medium', 'high', 'unknown'])

/** Tiers that assign a quality level (a "passing" tier). Unknown / missing /
 *  conflicted / faulted sources must NEVER receive one of these. */
const PASSING_TIERS: ReadonlySet<L0Tier> = new Set<L0Tier>([
  'tier1', 'tier2', 'tier3',
])

// ── Snapshot helpers (mirror engine/state-machine.ts) ───────────────────────

/** Deep-clone a caller-supplied value; reject non-cloneable values at the L0
 *  boundary (functions/symbols/WeakMap etc.) so a later read can never throw
 *  DataCloneError. Mirrors the state machine's cloneValue pattern. */
function cloneValue<T>(x: T, code: string, what: string): T {
  try {
    return structuredClone(x)
  } catch (e) {
    throw new ResearchError(
      `${L0_ERROR_PREFIX}${code}`,
      `${what} is not structured-cloneable (functions/symbols/WeakMap etc. are rejected at the L0 boundary — IMMUTABLE SNAPSHOTS)`,
      e,
    )
  }
}

// ── Public API: classifyL0 ───────────────────────────────────────────────────

/**
 * Classify one literature source to an L0 RISK + QUALITY tier via the injected,
 * versioned adapter. Pure: no network / fs / clocks; the ruleVersion is the
 * adapter's caller-injected id.
 *
 * Routing is delegated to `adapter.route` (NOT a closed switch). The router
 * then enforces the NO-DEFAULT-PASS trust boundary (clamp DOWN, never UP):
 *  - missing source id -> status 'abstained', tier 'unknown' (hard invariant);
 *  - adapter signalled a rule conflict (`conflict: true`) -> 'abstained';
 *  - an adapter that THROWS, or returns structurally invalid output, is an
 *    adapter FAULT -> status 'failed' (never a silent pass, and never a
 *    literature judgment);
 *  - unknown / extension source type that nonetheless got a passing / unvetted
 *    tier -> clamped DOWN to tier 'unknown' + status 'abstained' (defence).
 * `preprintNotPeerReviewed` is a deterministic risk flag (sourceType ===
 * 'preprint'); it NEVER asserts the preprint is real or sound.
 *
 * @throws {ResearchError} 'DSH_L0_INVALID_SOURCE_INPUT' if source is not a
 *   non-null object.
 * @throws {ResearchError} 'DSH_L0_MISSING_ADAPTER' if adapter is missing / not
 *   an object with a `route` function.
 * @throws {ResearchError} 'DSH_L0_VALUE_NOT_CLONEABLE' if the source (or the
 *   adapter's returned decision) is not structured-cloneable.
 */
export function classifyL0(
  source: L0SourceInput,
  adapter: L0RoutingAdapter,
): L0Classification {
  // Boundary validation — never silently coerce a malformed call into a pass.
  if (source === null || typeof source !== 'object') {
    throw new ResearchError(
      `${L0_ERROR_PREFIX}INVALID_SOURCE_INPUT`,
      'classifyL0: source must be a non-null object',
    )
  }
  if (
    adapter === null ||
    typeof adapter !== 'object' ||
    typeof (adapter as { route?: unknown }).route !== 'function'
  ) {
    throw new ResearchError(
      `${L0_ERROR_PREFIX}MISSING_ADAPTER`,
      'classifyL0: adapter must be an object with a route() function',
    )
  }

  // IMMUTABLE SNAPSHOTS: clone the source at the boundary (reject non-cloneable).
  const safeSource = cloneValue(source, 'VALUE_NOT_CLONEABLE', 'source')

  // Capture the fields we need into locals BEFORE delegating to the (untrusted)
  // adapter, so a hostile adapter mutating its argument cannot affect the
  // classification. Strings are primitives — locals are safe.
  const rawType = safeSource.sourceType
  const normalizedType: L0SourceType =
    typeof rawType === 'string' && KNOWN_SOURCE_TYPES.has(rawType as L0SourceType)
      ? (rawType as L0SourceType)
      : 'unknown'
  const rawId = safeSource.sourceId
  const hasSourceId = typeof rawId === 'string' && rawId.length > 0

  // Delegate ROUTING to the versioned adapter (NOT a hardcoded switch).
  let decision: L0RoutingDecision
  try {
    decision = adapter.route(safeSource)
  } catch {
    // An adapter that throws is an adapter FAULT -> status 'failed'
    // (NO-DEFAULT-PASS + never misread as a literature judgment).
    decision = {
      tier: 'unknown',
      status: 'failed',
      riskLevel: 'unknown',
      rationale: 'adapter.route threw — adapter fault (status=failed, not a rule conflict)',
    }
  }
  // Clone the adapter's (untrusted, external) output before use.
  const safeDecision = cloneValue(decision, 'DECISION_NOT_CLONEABLE', 'adapter decision')

  // ── Validate adapter output (defence-in-depth) ────────────────────────────
  // status: default 'classified' when the tier is structurally valid, else the
  // output is corrupted -> 'failed'. An explicit invalid status -> 'failed'.
  const rawStatus = safeDecision.status
  const tierValid = VALID_TIERS.has(safeDecision.tier as L0Tier)
  let status: L0ClassificationStatus =
    rawStatus === undefined
      ? tierValid
        ? 'classified'
        : 'failed'
      : VALID_STATUSES.has(rawStatus as L0ClassificationStatus)
        ? (rawStatus as L0ClassificationStatus)
        : 'failed'
  let tier: L0Tier = tierValid ? safeDecision.tier : 'unknown'
  let riskLevel: L0Classification['riskLevel'] = VALID_RISK_LEVELS.has(
    safeDecision.riskLevel as 'low' | 'medium' | 'high' | 'unknown',
  )
    ? safeDecision.riskLevel
    : 'unknown'
  let rationale: string =
    typeof safeDecision.rationale === 'string' ? safeDecision.rationale : ''
  const conflict = safeDecision.conflict === true

  // ── NO-DEFAULT-PASS trust boundary (clamp DOWN, never UP) ────────────────
  // 1. Missing source identifier -> abstained (insufficient data), regardless
  //    of the adapter (hard).
  if (!hasSourceId) {
    status = 'abstained'
    tier = 'unknown'
    riskLevel = 'unknown'
    rationale = 'missing source identifier — cannot classify (NO-DEFAULT-PASS)'
  }
  // 2. Adapter signalled a rule conflict -> abstained (refuse to classify).
  else if (conflict) {
    status = 'abstained'
    tier = 'unknown'
    riskLevel = 'unknown'
    rationale = `rule conflict — abstained: ${rationale}`
  }
  // 3. Unknown / extension source type must NOT receive a passing or unvetted
  //    tier. Clamp DOWN to tier 'unknown' + abstained if the adapter
  //    (buggily/hostilely) returned one — the adapter SHOULD have returned
  //    tier 'unknown' itself.
  else if (
    normalizedType === 'unknown' &&
    (PASSING_TIERS.has(tier) || tier === 'unvetted')
  ) {
    status = 'abstained'
    tier = 'unknown'
    riskLevel = 'unknown'
    rationale =
      'unknown source type cannot receive a passing/unvetted tier (NO-DEFAULT-PASS)'
  }
  // 4. Adapter fault (threw, or structurally invalid output) -> 'failed'.
  //    tier/risk are meaningless for a failed adjudication.
  else if (status === 'failed') {
    tier = 'unknown'
    riskLevel = 'unknown'
    rationale = `adapter fault or corrupted adapter output — failed (NO-DEFAULT-PASS): ${rationale}`
  }
  // 5. Adapter abstained (insufficient data / rule conflict on its side) ->
  //    normalize the tier to the 'no tier assigned' marker 'unknown' so a
  //    non-classified result never carries a misleading quality level.
  else if (status === 'abstained') {
    tier = 'unknown'
    riskLevel = 'unknown'
    rationale = `adapter abstained — cannot classify (NO-DEFAULT-PASS): ${rationale}`
  }

  // preprintNotPeerReviewed is a RISK FLAG, never a truth assertion: it records
  // that the source is a preprint (not yet peer reviewed). It does NOT claim the
  // preprint is real, sound, or that its claims are supported. A tier1 journal
  // carries preprintNotPeerReviewed = false — it asserts NOTHING about truth.
  const preprintNotPeerReviewed = normalizedType === 'preprint'

  const ruleVersion =
    typeof adapter.ruleVersion === 'string' && adapter.ruleVersion.length > 0
      ? adapter.ruleVersion
      : 'unknown'

  const classification: L0Classification = {
    sourceType: normalizedType,
    tier,
    status,
    riskLevel,
    rationale,
    preprintNotPeerReviewed,
    ruleVersion,
  }
  // Flat object (all primitive fields) — Object.freeze fully freezes it; no
  // live internal ref can leak to the caller (INV-SNAPSHOT-T2).
  return Object.freeze(classification)
}

// ── Mock fixture adapter ─────────────────────────────────────────────────────
// NOT real CAS / CCF / CORE partition data (D16: no verified license to bundle
// real lists). Venue names are DELIBERATELY SYNTHETIC ("Synthetic Journal A")
// so the fixture can never be mistaken for a real partition ranking. The real
// adapter would implement the same L0RoutingAdapter surface against licensed
// partition data; the router is agnostic to which.

/** Synthetic venue -> tier table (fixture; deliberately synthetic, NOT real
 *  partition data and NOT real venue names). */
const MOCK_VENUE_TIERS: Readonly<Record<string, L0Tier>> = {
  // tier1 (mock)
  'Synthetic Journal A': 'tier1',
  'Synthetic Journal B': 'tier1',
  'Synthetic Journal C': 'tier1',
  'Synthetic Conference A': 'tier1',
  'Synthetic Conference B': 'tier1',
  // tier2 (mock)
  'Synthetic Journal D': 'tier2',
  'Synthetic Conference C': 'tier2',
  'Synthetic Conference D': 'tier2',
  // tier3 (mock — regional)
  'Synthetic Regional Journal A': 'tier3',
}

/** Map an injected CCF rating to a mock tier (or undefined if unknown). */
function ccfRatingToTier(r: string | undefined): L0Tier | undefined {
  switch (r) {
    case 'A': return 'tier1'
    case 'B': return 'tier2'
    case 'C': return 'tier3'
    default: return undefined
  }
}

/** Map an injected CORE rank to a mock tier (or undefined if unknown). */
function coreRankToTier(r: string | undefined): L0Tier | undefined {
  switch (r) {
    case 'A*': return 'tier1'
    case 'A': return 'tier1'
    case 'B': return 'tier2'
    case 'C': return 'tier3'
    case 'unranked': return 'unvetted'
    default: return undefined
  }
}

/** Map an injected CAS partition to a mock tier (or undefined if unknown). */
function casPartitionToTier(p: string | undefined): L0Tier | undefined {
  switch (p) {
    case '1': case '1区': return 'tier1'
    case '2': case '2区': return 'tier2'
    case '3': case '3区': case '4': case '4区': return 'tier3'
    default: return undefined
  }
}

/** Map a tier to a mock risk level. Exhaustive over L0Tier. */
function tierRisk(t: L0Tier): 'low' | 'medium' | 'high' | 'unknown' {
  switch (t) {
    case 'tier1': return 'low'
    case 'tier2': return 'low'
    case 'tier3': return 'medium'
    case 'unvetted': return 'medium'
    case 'unknown': return 'unknown'
  }
}

/** The mock fixture's pure routing decision. */
function mockRoute(source: L0SourceInput): L0RoutingDecision {
  const t = source.sourceType
  // Unknown / extension type -> tier 'unknown' (completed classification with
  // no tier; NO-DEFAULT-PASS; the router double-checks this too).
  if (t === 'unknown' || !KNOWN_SOURCE_TYPES.has(t as L0SourceType)) {
    return {
      tier: 'unknown',
      status: 'classified',
      riskLevel: 'unknown',
      rationale: 'unknown source type — mock fixture returns tier unknown (no tier assigned)',
    }
  }
  // Preprint: not peer reviewed -> high risk, unvetted tier (risk flag, NOT a
  // truth assertion that the preprint is real/sound).
  if (t === 'preprint') {
    return {
      tier: 'unvetted',
      status: 'classified',
      riskLevel: 'high',
      rationale: 'preprint — not peer reviewed (risk flag, not a truth assertion)',
    }
  }
  // Collect the INJECTED external tier signals (never fetched).
  const ccf = ccfRatingToTier(source.ccfRating)
  const core = coreRankToTier(source.coreRank)
  const cas = casPartitionToTier(source.casPartition)
  const signals: L0Tier[] = [ccf, core, cas].filter(
    (x): x is L0Tier => x !== undefined,
  )
  // Conflict: two or more external signals disagree -> abstained (refuse).
  if (signals.length >= 2) {
    const first = signals[0] as L0Tier
    if (!signals.every(s => s === first)) {
      return {
        tier: 'unknown',
        status: 'abstained',
        riskLevel: 'unknown',
        conflict: true,
        rationale: `mock conflict: external signals disagree (${signals.join(', ')})`,
      }
    }
  }
  // Venue lookup (synthetic mock partition list) for journals / conferences.
  if (
    (t === 'journal' || t === 'conference') &&
    typeof source.venue === 'string' &&
    source.venue.length > 0
  ) {
    const v =
      MOCK_VENUE_TIERS[source.venue] ?? MOCK_VENUE_TIERS[source.venue.toUpperCase()]
    if (v !== undefined) {
      return {
        tier: v,
        status: 'classified',
        riskLevel: tierRisk(v),
        rationale: `mock synthetic venue '${source.venue}' -> ${v}`,
      }
    }
  }
  // An agreed external signal sets the tier.
  if (signals.length >= 1) {
    const s = signals[0] as L0Tier
    return {
      tier: s,
      status: 'classified',
      riskLevel: tierRisk(s),
      rationale: `mock external signal -> ${s}`,
    }
  }
  // Known source, no versioned rule matched -> unvetted (tier unknown).
  return {
    tier: 'unvetted',
    status: 'classified',
    riskLevel: 'medium',
    rationale: `mock: no versioned rule matched source type '${t}' -> unvetted`,
  }
}

/** Build a fresh mock L0 routing adapter (fixture; NOT real partition data).
 *  Pure + stateless — each instance is independent (no shared mutable state). */
export function createMockL0Adapter(): L0RoutingAdapter {
  return {
    ruleVersion: MOCK_L0_RULE_VERSION,
    route: mockRoute,
  }
}

/** A ready mock fixture instance (stateless; safe to share). */
export const mockL0Adapter: L0RoutingAdapter = createMockL0Adapter()
