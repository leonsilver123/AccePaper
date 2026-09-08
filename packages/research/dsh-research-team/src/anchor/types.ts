// @deepseek-ai/dsh-research-team — T23 external anchor (pure, fixture/mock only).
//
// External anchor signals for L0-tier / SOTA / reproducibility evidence. These
// are PURE signals: they carry an external stance (support / contradict /
// inconclusive) as reference evidence and are NEVER a verdict and NEVER a
// substitute for the core gate-B adjudication. All data is synthetic fixture
// data (ruleVersion-stamped, source: 'fixture', synthetic: true) — no real
// literature API / database / model is ever contacted.
//
// This file is the ONLY place the anchor module defines types + its own error
// codes. It does NOT modify the shared team error union (types.ts) — the anchor
// keeps its error surface self-contained.

// ── Anchor kinds ─────────────────────────────────────────────────────────────
// The three classes of external anchor the B-gated judgment points may consult.
export type AnchorKind = 'l0-tier' | 'sota' | 'reproducibility'

/** The three anchor kinds as a frozen tuple (deterministic iteration). */
export const ANCHOR_KINDS: readonly AnchorKind[] = Object.freeze([
  'l0-tier',
  'sota',
  'reproducibility',
])

// ── Anchor verdicts ──────────────────────────────────────────────────────────
// A signal is NECESSARY-NOT-SUFFICIENT evidence. It NEVER asserts claim truth
// and MUST NOT by itself upgrade a claim to supported (core gate B decides).
export type AnchorVerdict = 'support' | 'contradict' | 'inconclusive'

/** The three verdicts as a frozen tuple. */
export const ANCHOR_VERDICTS: readonly AnchorVerdict[] = Object.freeze([
  'support',
  'contradict',
  'inconclusive',
])

// ── Anchor signal (the unit this module emits) ───────────────────────────────
export interface AnchorSignal {
  /** The claim this anchor bears on (synthetic ref in the mock path). */
  readonly claimRef: string
  readonly anchorType: AnchorKind
  readonly verdict: AnchorVerdict
  /** Synthetic anchor id / citation reference (never a real external id). */
  readonly evidenceRef: string
  readonly detail: string
  /** Provenance of the signal: a fixture table or a mock adapter. */
  readonly source: 'mock' | 'fixture'
  /** Explicit synthetic marker — true for every signal this module emits. */
  readonly synthetic: true
  /** Versioned fixture/adapter id (auditable; never a real partition-list id). */
  readonly ruleVersion: string
  /** Caller-injected epoch ms (deterministic in tests). */
  readonly timestamp: number
}

// ── Errors (self-contained; does NOT modify the shared team error union) ─────
export const ANCHOR_ERROR_PREFIX = 'DSH_RESEARCH_TEAM_ANCHOR_'

/** Thrown by anchor lookups/adapters when a key is malformed/unknown or an
 *  injected adapter returns structurally invalid output. Carries a
 *  `DSH_RESEARCH_TEAM_ANCHOR_*` code so it is grep-able + auditable. */
export class AnchorError extends Error {
  readonly code: string
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AnchorError'
    this.code = code
  }
}

/** Throw an {@link AnchorError} with a `DSH_RESEARCH_TEAM_ANCHOR_*` code. */
export function anchorError(name: string, message: string, cause?: unknown): never {
  throw new AnchorError(`${ANCHOR_ERROR_PREFIX}${name}`, message, cause === undefined ? undefined : { cause })
}

/** Error-code name for an unrecognized/unparseable anchor key. Fail-closed is
 *  reserved for *data* misses (well-formed key, unknown ref → undefined); a
 *  malformed key is a caller error and throws. */
export const ANCHOR_UNKNOWN_KEY = 'UNKNOWN_KEY'

/** Error-code name for a structurally invalid adapter/fixture output. */
export const ANCHOR_INVALID_ADAPTER = 'INVALID_ADAPTER'
