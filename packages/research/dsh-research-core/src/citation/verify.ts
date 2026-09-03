/**
 * T08 citation identity chain — pure verifier (NO TRUTH CLAIM / NO DEFAULT PASS).
 *
 * Chain adjudicated: claim_id → citation_id → DOI/arXiv/ISBN/standard# →
 * original-text evidence → page/chapter/table/figure → verification method →
 * verification conclusion.
 *
 * This module ADJUDICATES a caller-asserted {@link VerifyCitationOptions.claimedConclusion}
 * against the objective evidence chain (original-text access, resolver identity,
 * retraction status, correlation-as-causation). It never asserts that literature
 * is real or a claim is proven (INV-NO-TRUTH-CLAIM). When the chain contradicts
 * a 'supported'/'partially_supported' claim, the result is BLOCKED, never a pass
 * (INV-NO-DEFAULT-PASS).
 *
 * HARD RED LINE (#6): a result that claims 'supported'/'partially_supported' while
 * the original text was NOT accessed (VerificationMethod='none' or
 * originalTextAccessed=false) is FORCED to conclusion='blocked' with
 * redLineTriggered=true. This is checked FIRST and can NEVER be downgraded to a
 * warning — getter tricks, prototype pollution, and post-call input mutation
 * are neutralized by deep-cloning the evidence ONCE at the boundary
 * (structuredClone copies the value a getter returns at clone time, freezing the
 * snapshot; own properties are read, so polluted prototypes cannot mask a 'none').
 *
 * IMMUTABLE SNAPSHOTS: inputs AND returns are deep-cloned + Object.freeze-d at
 * the boundary. Non-cloneable inputs (functions/symbols/WeakMap) throw
 * ResearchError('DSH_CITATION_VALUE_NOT_CLONEABLE') — never silently coerced.
 *
 * PURE: no network, no filesystem, no shared mutable state, no clocks (timestamp
 * is caller-injected). The resolver is an ADAPTER CONTRACT (./adapter.ts); batch-2
 * wires a Fixture/Mock — NO real Crossref/OpenAlex/gateway calls, NO real keys.
 *
 * ERROR BASE: ResearchError (../engine/state-machine.ts), thrown with a
 * DSH_CITATION_* code. Never raw Error/string.
 */

import type {
  CitationEvidence,
  CitationId,
  CitationRef,
  ClaimId,
  VerificationConclusion,
  VerificationMethod,
  VerificationResult,
} from '../contracts.ts'
import { CITATION_ERROR_PREFIX } from '../contracts.ts'
import { ResearchError } from '../engine/state-machine.ts'
import type { CitationResolverAdapter, ResolverOutcome, ResolvedCitationMetadata } from './adapter.ts'

// ── Reason codes (DSH_CITATION_* — stable, grep-able, auditable) ─────────────
export const CITATION_CODE_RED_LINE_NO_ORIGINAL = `${CITATION_ERROR_PREFIX}RED_LINE_NO_ORIGINAL`
export const CITATION_CODE_NOT_FOUND = `${CITATION_ERROR_PREFIX}NOT_FOUND`
export const CITATION_CODE_TEMPORARILY_UNAVAILABLE = `${CITATION_ERROR_PREFIX}TEMPORARILY_UNAVAILABLE`
export const CITATION_CODE_AMBIGUOUS = `${CITATION_ERROR_PREFIX}AMBIGUOUS`
export const CITATION_CODE_REDACTED_UNMARKED = `${CITATION_ERROR_PREFIX}REDACTED_UNMARKED`
export const CITATION_CODE_RETRACTED_MARKED = `${CITATION_ERROR_PREFIX}RETRACTED_MARKED`
export const CITATION_CODE_IDENTITY_MISMATCH = `${CITATION_ERROR_PREFIX}IDENTITY_MISMATCH`
export const CITATION_CODE_CORRELATION_AS_CAUSATION = `${CITATION_ERROR_PREFIX}CORRELATION_AS_CAUSATION`
export const CITATION_CODE_UNSUPPORTED = `${CITATION_ERROR_PREFIX}UNSUPPORTED`
export const CITATION_CODE_SUPPORTED = `${CITATION_ERROR_PREFIX}SUPPORTED`
export const CITATION_CODE_PARTIALLY_SUPPORTED = `${CITATION_ERROR_PREFIX}PARTIALLY_SUPPORTED`
export const CITATION_CODE_UNVERIFIED = `${CITATION_ERROR_PREFIX}UNVERIFIED`
export const CITATION_CODE_BLOCKED = `${CITATION_ERROR_PREFIX}BLOCKED`
const CODE_VALUE_NOT_CLONEABLE = `${CITATION_ERROR_PREFIX}VALUE_NOT_CLONEABLE`
const CODE_INVALID_REF = `${CITATION_ERROR_PREFIX}INVALID_REF`
const CODE_INVALID_EVIDENCE = `${CITATION_ERROR_PREFIX}INVALID_EVIDENCE`
const CODE_INVALID_OPTIONS = `${CITATION_ERROR_PREFIX}INVALID_OPTIONS`
const CODE_INVALID_ADAPTER = `${CITATION_ERROR_PREFIX}INVALID_ADAPTER`
const CODE_RESOLVER_FAILED = `${CITATION_ERROR_PREFIX}RESOLVER_FAILED`

/**
 * What the upstream claim asserts this citation verifies to, plus the
 * caller-injected integrity signals the chain cannot derive purely:
 *  - {@link correlationAsCausation}: #5 — the claim overstates a correlation as
 *    a causal claim.
 *  - {@link retractionExplicitlyMarked}: #4 — whether the source explicitly
 *    marks the literature as retracted (false/unset + resolver.retracted =>
 *    REDACTED_UNMARKED hard block).
 *  - {@link contentSupportsClaim}: #3 — whether the accessed original-text
 *    content actually supports the claim (false => 'unsupported' when the claim
 *    asserted supported). Defaults true; set false to flag a content gap.
 */
export interface VerifyCitationOptions {
  readonly claimedConclusion: VerificationConclusion
  readonly correlationAsCausation?: boolean
  readonly retractionExplicitlyMarked?: boolean
  readonly contentSupportsClaim?: boolean
}

const SUPPORTIVE_CONCLUSIONS: ReadonlySet<VerificationConclusion> = new Set<VerificationConclusion>([
  'supported',
  'partially_supported',
])

const VERIFICATION_METHODS: ReadonlySet<VerificationMethod> = new Set<VerificationMethod>([
  'auto_crossref',
  'auto_openalex',
  'manual_review',
  'specialist_agent',
  'none',
])

const VERIFICATION_CONCLUSIONS: ReadonlySet<VerificationConclusion> = new Set<VerificationConclusion>([
  'supported',
  'partially_supported',
  'unsupported',
  'unverified',
  'retracted',
  'identity_mismatch',
  'blocked',
])

// ── Clone / freeze (mirrors engine cloneValue + Object.freeze snapshot) ───────

/** Deep-clone a caller-supplied value; reject non-cloneable values at the
 *  boundary so downstream paths can never throw DataCloneError. */
function cloneValue(x: unknown): unknown {
  try {
    return structuredClone(x)
  } catch (e) {
    throw new ResearchError(
      CODE_VALUE_NOT_CLONEABLE,
      'citation input is not structured-cloneable (functions/symbols/WeakMap etc. are rejected at the boundary — INV-SNAPSHOT)',
      e,
    )
  }
}

/** Recursively Object.freeze a plain-data value so callers cannot mutate the
 *  returned snapshot (INV-SNAPSHOT). Non-enumerable / non-plain members are
 *  left to their own freezing; cycles are tolerated via an already-frozen set. */
function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value
  const obj = value as unknown as object
  if (seen.has(obj)) return value
  seen.add(obj)
  // Arrays and plain objects only — leave Date/Map/Set etc. (not used here).
  if (Array.isArray(obj)) {
    for (const v of obj) deepFreeze(v, seen)
  } else {
    for (const k of Object.keys(obj)) {
      const v = (obj as Record<string, unknown>)[k]
      if (v !== null && typeof v === 'object') deepFreeze(v, seen)
    }
  }
  Object.freeze(obj)
  return value
}

/** Clone then deep-freeze: the canonical boundary transform for retained inputs
 *  and returned snapshots. */
function snapshot<T>(value: T): T {
  return deepFreeze(cloneValue(value) as T)
}

// ── Normalization (identity-mismatch oracle) ─────────────────────────────────

/** Lowercase, trim, collapse internal whitespace for tolerant title/author
 *  comparison. Never asserts equality of meaning — only of surface form. */
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** True when ref.title (if provided) matches resolver.title by surface form. */
function titleMatches(ref: CitationRef, meta: ResolvedCitationMetadata): boolean {
  if (ref.title === undefined) return true // nothing claimed to compare
  if (ref.title.trim() === '') return true // empty claim = no oracle signal
  return normalize(ref.title) === normalize(meta.title)
}

/** True when ref.authors (if provided) share at least one surface-form author
 *  with resolver.authors. Empty ref.authors = no oracle signal. */
function authorsMatch(ref: CitationRef, meta: ResolvedCitationMetadata): boolean {
  if (ref.authors === undefined || ref.authors.length === 0) return true
  const resolved = new Set(meta.authors.map(normalize))
  for (const a of ref.authors) {
    if (a.trim() === '') continue
    if (resolved.has(normalize(a))) return true
  }
  return false
}

// ── Validation ───────────────────────────────────────────────────────────────

function assertNonEmptyBrand(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ResearchError(CODE_INVALID_REF, `${field} must be a non-empty string`)
  }
}

const CITATION_ID_KINDS: ReadonlySet<CitationRef['kind']> = new Set<CitationRef['kind']>([
  'doi',
  'arxiv',
  'isbn',
  'standard',
  'unknown',
])

function validateRef(ref: CitationRef): void {
  assertNonEmptyBrand(ref.id, 'ref.id')
  if (!CITATION_ID_KINDS.has(ref.kind)) {
    throw new ResearchError(CODE_INVALID_REF, `ref.kind is not a valid CitationIdKind: ${String(ref.kind)}`)
  }
  if (ref.title !== undefined && typeof ref.title !== 'string') {
    throw new ResearchError(CODE_INVALID_REF, 'ref.title must be a string when provided')
  }
  if (ref.authors !== undefined) {
    if (!Array.isArray(ref.authors)) {
      throw new ResearchError(CODE_INVALID_REF, 'ref.authors must be an array when provided')
    }
    for (const a of ref.authors) {
      if (typeof a !== 'string') {
        throw new ResearchError(CODE_INVALID_REF, 'ref.authors must be an array of strings')
      }
    }
  }
}

function validateEvidence(ev: CitationEvidence): void {
  if (!VERIFICATION_METHODS.has(ev.method)) {
    throw new ResearchError(CODE_INVALID_EVIDENCE, `evidence.method is not a valid VerificationMethod: ${String(ev.method)}`)
  }
  if (typeof ev.originalTextAccessed !== 'boolean') {
    throw new ResearchError(CODE_INVALID_EVIDENCE, 'evidence.originalTextAccessed must be boolean')
  }
  // Contract: accessedAt is undefined IFF method === 'none'. Enforced bidirectionally.
  if (ev.method === 'none' && ev.accessedAt !== undefined) {
    throw new ResearchError(CODE_INVALID_EVIDENCE, 'evidence.accessedAt must be undefined when method === none')
  }
  if (ev.method !== 'none' && ev.accessedAt === undefined) {
    throw new ResearchError(CODE_INVALID_EVIDENCE, 'evidence.accessedAt must be present (epoch ms) when method !== none')
  }
  if (ev.accessedAt !== undefined && (typeof ev.accessedAt !== 'number' || !Number.isFinite(ev.accessedAt) || ev.accessedAt < 0)) {
    throw new ResearchError(CODE_INVALID_EVIDENCE, 'evidence.accessedAt must be a non-negative finite epoch ms')
  }
  // Provenance fields (which original-text version was accessed) must be
  // strings when present (sourceUri / sourceVersion / contentHash / retrievedAt).
  for (const [name, value] of [
    ['sourceUri', ev.sourceUri],
    ['sourceVersion', ev.sourceVersion],
    ['contentHash', ev.contentHash],
    ['retrievedAt', ev.retrievedAt],
  ] as const) {
    if (value !== undefined && typeof value !== 'string') {
      throw new ResearchError(CODE_INVALID_EVIDENCE, `evidence.${name} must be a string when present`)
    }
  }
}

function validateOptions(opts: VerifyCitationOptions): void {
  if (opts === null || typeof opts !== 'object') {
    throw new ResearchError(CODE_INVALID_OPTIONS, 'options must be an object')
  }
  if (!VERIFICATION_CONCLUSIONS.has(opts.claimedConclusion)) {
    throw new ResearchError(
      CODE_INVALID_OPTIONS,
      `options.claimedConclusion is not a valid VerificationConclusion: ${String(opts.claimedConclusion)}`,
    )
  }
}

function validateAdapter(adapter: unknown): asserts adapter is CitationResolverAdapter {
  if (adapter === null || typeof adapter !== 'object') {
    throw new ResearchError(CODE_INVALID_ADAPTER, 'resolverAdapter must be an object implementing resolveMetadata(ref)')
  }
  const a = adapter as { resolveMetadata?: unknown }
  if (typeof a.resolveMetadata !== 'function') {
    throw new ResearchError(CODE_INVALID_ADAPTER, 'resolverAdapter.resolveMetadata must be a function')
  }
}

// ── Adjudication ─────────────────────────────────────────────────────────────

/** Compose a frozen {@link VerificationResult}. Inputs are already-cloned
 *  snapshots; the result is cloned+frozen again so it shares no refs. */
function makeResult(params: {
  claimId: ClaimId
  citationId: CitationId
  ref: CitationRef
  evidence: CitationEvidence
  conclusion: VerificationConclusion
  redLineTriggered: boolean
  reasonCode: string
  timestamp: number
  resolverStatus?: 'resolved' | 'not_found' | 'temporarily_unavailable' | 'ambiguous'
}): VerificationResult {
  const out: VerificationResult = {
    claimId: params.claimId,
    citationId: params.citationId,
    ref: params.ref,
    evidence: params.evidence,
    conclusion: params.conclusion,
    redLineTriggered: params.redLineTriggered,
    ...(params.resolverStatus !== undefined
      ? { resolverStatus: params.resolverStatus }
      : {}),
    reasonCode: params.reasonCode,
    timestamp: params.timestamp,
  }
  return snapshot<VerificationResult>(out)
}

/**
 * Verify one (claim, citation) pair against the identity chain. PURE; the
 * resolver is an adapter contract (batch-2 = Fixture/Mock, no real network).
 *
 * Adjudication order (first match wins). The #6 red line is checked FIRST so it
 * can never be bypassed by a later, softer check:
 *  1. #6 HARD RED LINE — claimed supported/partially but original NOT accessed
 *     (method='none' OR originalTextAccessed=false) => blocked + redLine.
 *  2. Resolver outcome triage — 'not_found' (fabricated #1) => blocked +
 *     redLine + DSH_CITATION_NOT_FOUND; 'temporarily_unavailable' /
 *     'ambiguous' => unverified, NO red line (never misread as fabrication).
 *  3. #4 retracted — resolver.retracted: unmarked => retracted + redLine;
 *     explicitly marked => retracted (surfaced, no redLine).
 *  4. #2 identity mismatch — ref.title/authors disagree with resolver.
 *  5. #5 correlation-as-causation — claim overstates => unsupported + redLine.
 *  6. #3 content gap — claimed supported but contentSupportsClaim=false => unsupported.
 *  7. otherwise honor claimedConclusion (all chain checks passed for supportive
 *     claims; non-supportive claims pass through).
 */
export function verifyCitation(
  claimId: ClaimId,
  citationId: CitationId,
  ref: CitationRef,
  evidence: CitationEvidence,
  resolverAdapter: CitationResolverAdapter,
  timestamp: number,
  options: VerifyCitationOptions,
): VerificationResult {
  // Validate scalar inputs (before cloning — cheap structural checks).
  assertNonEmptyBrand(claimId as string, 'claimId')
  assertNonEmptyBrand(citationId as string, 'citationId')
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0) {
    throw new ResearchError(CODE_INVALID_OPTIONS, 'timestamp must be a non-negative finite epoch ms (caller-injected)')
  }
  validateAdapter(resolverAdapter)
  validateOptions(options)

  // ── IMMUTABLE BOUNDARY: clone+freeze inputs once. From here on, the verifier
  //    reads ONLY its own frozen snapshots; caller mutation / getter tricks /
  //    prototype pollution cannot alter the adjudicated values. ──────────────
  const refSnap = snapshot<CitationRef>(ref)
  const evSnap = snapshot<CitationEvidence>(evidence)
  validateRef(refSnap)
  validateEvidence(evSnap)
  const claimIdSnap = snapshot<ClaimId>(claimId)
  const citationIdSnap = snapshot<CitationId>(citationId)

  // Original-text access — read ONCE from the frozen clone into a local so
  // no later re-read can diverge (defense vs. theoretical getter/TOCTOU).
  const originalAccessed: boolean =
    evSnap.originalTextAccessed === true && evSnap.method !== 'none'
  const claimed = options.claimedConclusion
  const claimedSupportive = SUPPORTIVE_CONCLUSIONS.has(claimed)

  // ── #6 HARD RED LINE (FIRST — never bypassable) ───────────────────────────
  if (claimedSupportive && !originalAccessed) {
    return makeResult({
      claimId: claimIdSnap,
      citationId: citationIdSnap,
      ref: refSnap,
      evidence: evSnap,
      conclusion: 'blocked',
      redLineTriggered: true,
      reasonCode: CITATION_CODE_RED_LINE_NO_ORIGINAL,
      timestamp,
    })
  }

  // ── Resolve identity via the adapter (external seam). Pass a frozen clone so
  //    the adapter cannot mutate the verifier's state; clone+freeze the return. ──
  let outcome: ResolverOutcome
  try {
    outcome = resolverAdapter.resolveMetadata(refSnap)
  } catch (e) {
    if (e instanceof ResearchError) throw e
    throw new ResearchError(CODE_RESOLVER_FAILED, 'resolverAdapter.resolveMetadata threw a non-ResearchError', e)
  }
  // Structural validation of the (external, untrusted) outcome: a malformed
  // outcome is an ADAPTER FAULT — NEVER fabrication and never a hard block.
  const RESOLVER_STATUSES = new Set(['resolved', 'not_found', 'temporarily_unavailable', 'ambiguous'])
  if (
    outcome === null ||
    typeof outcome !== 'object' ||
    !RESOLVER_STATUSES.has((outcome as { status?: unknown }).status as string)
  ) {
    return makeResult({
      claimId: claimIdSnap,
      citationId: citationIdSnap,
      ref: refSnap,
      evidence: evSnap,
      conclusion: 'unverified',
      redLineTriggered: false,
      reasonCode: CODE_RESOLVER_FAILED,
      timestamp,
      resolverStatus: 'temporarily_unavailable',
    })
  }

  // ── Resolver outcome triage (frozen, contracts.ts) ──────────────────────
  //  - 'not_found'               -> #1 fabricated literature (authoritative
  //    miss). HARD BLOCK: conclusion 'blocked' (NEVER 'unverified' — a
  //    fabricated citation must not read as "not yet verified"), red line on.
  //  - 'temporarily_unavailable' -> service fault, NOT a literature judgment:
  //    'unverified', NO red line (an outage must not be misjudged as fiction).
  //  - 'ambiguous'               -> not uniquely identifiable: 'unverified',
  //    NO red line.
  if (outcome.status !== 'resolved') {
    switch (outcome.status) {
      case 'not_found':
        return makeResult({
          claimId: claimIdSnap,
          citationId: citationIdSnap,
          ref: refSnap,
          evidence: evSnap,
          conclusion: 'blocked',
          redLineTriggered: true,
          reasonCode: CITATION_CODE_NOT_FOUND,
          timestamp,
          resolverStatus: 'not_found',
        })
      case 'temporarily_unavailable':
        return makeResult({
          claimId: claimIdSnap,
          citationId: citationIdSnap,
          ref: refSnap,
          evidence: evSnap,
          conclusion: 'unverified',
          redLineTriggered: false,
          reasonCode: CITATION_CODE_TEMPORARILY_UNAVAILABLE,
          timestamp,
          resolverStatus: 'temporarily_unavailable',
        })
      case 'ambiguous':
        return makeResult({
          claimId: claimIdSnap,
          citationId: citationIdSnap,
          ref: refSnap,
          evidence: evSnap,
          conclusion: 'unverified',
          redLineTriggered: false,
          reasonCode: CITATION_CODE_AMBIGUOUS,
          timestamp,
          resolverStatus: 'ambiguous',
        })
      default: {
        // Unreachable: every ResolverOutcome status is handled above. Kept as a
        // defensive guard for structurally-invalid external adapter output.
        throw new ResearchError(CODE_RESOLVER_FAILED, 'unhandled resolver outcome status')
      }
    }
  }
  const meta = snapshot<ResolvedCitationMetadata>(outcome.metadata)

  // ── #4 retracted literature (resolver = source of truth) ──────────────────
  if (meta.retracted) {
    const explicitlyMarked = options.retractionExplicitlyMarked === true
    return makeResult({
      claimId: claimIdSnap,
      citationId: citationIdSnap,
      ref: refSnap,
      evidence: evSnap,
      conclusion: 'retracted',
      redLineTriggered: !explicitlyMarked,
      reasonCode: explicitlyMarked ? CITATION_CODE_RETRACTED_MARKED : CITATION_CODE_REDACTED_UNMARKED,
      timestamp,
      resolverStatus: 'resolved',
    })
  }

  // ── #2 DOI/title/author identity mismatch ────────────────────────────────
  const idMismatch = !titleMatches(refSnap, meta) || !authorsMatch(refSnap, meta)
  if (idMismatch) {
    return makeResult({
      claimId: claimIdSnap,
      citationId: citationIdSnap,
      ref: refSnap,
      evidence: evSnap,
      conclusion: 'identity_mismatch',
      redLineTriggered: false,
      reasonCode: CITATION_CODE_IDENTITY_MISMATCH,
      timestamp,
      resolverStatus: 'resolved',
    })
  }

  // ── #5 correlation written as causation (claim overstates) ───────────────
  if (options.correlationAsCausation === true) {
    return makeResult({
      claimId: claimIdSnap,
      citationId: citationIdSnap,
      ref: refSnap,
      evidence: evSnap,
      conclusion: 'unsupported',
      redLineTriggered: true,
      reasonCode: CITATION_CODE_CORRELATION_AS_CAUSATION,
      timestamp,
      resolverStatus: 'resolved',
    })
  }

  // ── #3 literature content does not support the claim ─────────────────────
  if (claimedSupportive && options.contentSupportsClaim === false) {
    return makeResult({
      claimId: claimIdSnap,
      citationId: citationIdSnap,
      ref: refSnap,
      evidence: evSnap,
      conclusion: 'unsupported',
      redLineTriggered: false,
      reasonCode: CITATION_CODE_UNSUPPORTED,
      timestamp,
      resolverStatus: 'resolved',
    })
  }

  // ── Honor the claimed conclusion (all chain checks passed) ───────────────
  switch (claimed) {
    case 'supported':
      return makeResult({
        claimId: claimIdSnap, citationId: citationIdSnap, ref: refSnap, evidence: evSnap,
        conclusion: 'supported', redLineTriggered: false, reasonCode: CITATION_CODE_SUPPORTED, timestamp,
        resolverStatus: 'resolved',
      })
    case 'partially_supported':
      return makeResult({
        claimId: claimIdSnap, citationId: citationIdSnap, ref: refSnap, evidence: evSnap,
        conclusion: 'partially_supported', redLineTriggered: false, reasonCode: CITATION_CODE_PARTIALLY_SUPPORTED, timestamp,
        resolverStatus: 'resolved',
      })
    case 'unsupported':
      return makeResult({
        claimId: claimIdSnap, citationId: citationIdSnap, ref: refSnap, evidence: evSnap,
        conclusion: 'unsupported', redLineTriggered: false, reasonCode: CITATION_CODE_UNSUPPORTED, timestamp,
        resolverStatus: 'resolved',
      })
    case 'unverified':
      return makeResult({
        claimId: claimIdSnap, citationId: citationIdSnap, ref: refSnap, evidence: evSnap,
        conclusion: 'unverified', redLineTriggered: false, reasonCode: CITATION_CODE_UNVERIFIED, timestamp,
        resolverStatus: 'resolved',
      })
    case 'identity_mismatch':
      return makeResult({
        claimId: claimIdSnap, citationId: citationIdSnap, ref: refSnap, evidence: evSnap,
        conclusion: 'identity_mismatch', redLineTriggered: false, reasonCode: CITATION_CODE_IDENTITY_MISMATCH, timestamp,
        resolverStatus: 'resolved',
      })
    case 'retracted':
      // resolver said not retracted but claim asserts retracted — surface as
      // retracted (no hard block; the resolver is the source of truth but we
      // never assert the literature is real).
      return makeResult({
        claimId: claimIdSnap, citationId: citationIdSnap, ref: refSnap, evidence: evSnap,
        conclusion: 'retracted', redLineTriggered: false, reasonCode: CITATION_CODE_RETRACTED_MARKED, timestamp,
        resolverStatus: 'resolved',
      })
    case 'blocked':
      return makeResult({
        claimId: claimIdSnap, citationId: citationIdSnap, ref: refSnap, evidence: evSnap,
        conclusion: 'blocked', redLineTriggered: false, reasonCode: CITATION_CODE_BLOCKED, timestamp,
        resolverStatus: 'resolved',
      })
    default: {
      // Exhaustiveness guard — should be unreachable (validateOptions).
      const _exhaustive: never = claimed
      throw new ResearchError(CODE_INVALID_OPTIONS, `unhandled claimedConclusion: ${String(_exhaustive)}`)
    }
  }
}
