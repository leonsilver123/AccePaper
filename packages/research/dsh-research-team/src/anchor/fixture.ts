// @deepseek-ai/dsh-research-team — T23 external anchor: deterministic mock
// fixtures + lookup (pure, no network / no real data / no model).
//
// Three frozen synthetic tables back the three anchor kinds. Every entry is
// explicitly synthetic (synthetic: true, source: 'fixture', a synthetic
// ruleVersion). A miss returns undefined so the caller can apply fail-closed
// (map to an inconclusive signal) — there is NO default pass.

import type { AnchorKind, AnchorSignal, AnchorVerdict } from './types.ts'
import { anchorError, ANCHOR_KINDS, ANCHOR_UNKNOWN_KEY } from './types.ts'

// Rule versions (auditable; explicitly synthetic, never a real partition id).
export const L0_ANCHOR_RULE_VERSION = 'anchor-fixture-v1'
export const SOTA_ANCHOR_RULE_VERSION = 'synthetic-bench-v1'
export const REPRO_ANCHOR_RULE_VERSION = 'repro-fixture-v1'

// ── L0 / literature anchor fixture ────────────────────────────────────────────
// Synthetic corpus. `tier` is the L0 venue-quality tier; `stance` is the
// pre-set stance of the synthetic literature toward the claim. Retrieval
// existence is NOT support — only tier1/tier2 with an explicit stance count as a
// usable signal; tier3/unknown degrade to inconclusive.
interface L0FixtureRow {
  readonly tier: 'tier1' | 'tier2' | 'tier3' | 'unknown'
  readonly stance: AnchorVerdict
}

const L0_FIXTURE: ReadonlyMap<string, L0FixtureRow> = deepFreezeMap(
  new Map<string, L0FixtureRow>([
    ['syn-l0-001', { tier: 'tier1', stance: 'support' }],
    ['syn-l0-002', { tier: 'tier2', stance: 'contradict' }],
    ['syn-l0-003', { tier: 'tier3', stance: 'support' }], // low tier -> inconclusive
    ['syn-l0-004', { tier: 'unknown', stance: 'support' }], // unknown tier -> inconclusive
  ]),
)

function l0Verdict(row: L0FixtureRow): AnchorVerdict {
  if (row.tier === 'tier1' || row.tier === 'tier2') return row.stance
  return 'inconclusive'
}

// ── SOTA / baseline anchor fixture (SyntheticBench v1) ───────────────────────
// Each row is a SYNTHETIC sample: a method/dataset/metric, the synthetic SOTA
// score, the synthetic claimed score, and the comparison margin. {@link
// compareSota} derives the verdict deterministically.
interface SotaFixtureRow {
  readonly method: string
  readonly dataset: string
  readonly metric: string
  readonly sotaScore: number
  readonly claimedScore: number
  readonly margin: number
}

const SOTA_FIXTURE: ReadonlyMap<string, SotaFixtureRow> = deepFreezeMap(
  new Map<string, SotaFixtureRow>([
    ['syn-sota-adaptive|grid-alpha|delay', { method: 'adaptive', dataset: 'grid-alpha', metric: 'delay', sotaScore: 0.80, claimedScore: 0.91, margin: 0.05 }],
    ['syn-sota-greedy|grid-alpha|throughput', { method: 'greedy', dataset: 'grid-alpha', metric: 'throughput', sotaScore: 0.70, claimedScore: 0.62, margin: 0.05 }],
  ]),
)

/** Pure SOTA comparison. claimed >= sota + margin -> support; claimed < sota ->
 *  contradict; non-finite inputs or a gap inside (sota, sota+margin) ->
 *  inconclusive (never a default pass). */
export function compareSota(claimed: number, sotaScore: number, margin: number): AnchorVerdict {
  if (!Number.isFinite(claimed) || !Number.isFinite(sotaScore) || !Number.isFinite(margin)) {
    return 'inconclusive'
  }
  if (claimed >= sotaScore + margin) return 'support'
  if (claimed < sotaScore) return 'contradict'
  return 'inconclusive'
}

// ── Reproducibility anchor fixture (mock experiment re-run) ───────────────────
// Synthetic re-run of a prediction on a synthetic corpus. supportsPrediction
// true -> support; false -> contradict; miss -> inconclusive. Semantics: an
// external party reproduced the result on synthetic data — NOT "the run
// succeeded", and never an assertion that the claim is correct.
interface ReproFixtureRow {
  readonly supportsPrediction: boolean
  readonly detail: string
}

const REPRO_FIXTURE: ReadonlyMap<string, ReproFixtureRow> = deepFreezeMap(
  new Map<string, ReproFixtureRow>([
    ['syn-repro-001', { supportsPrediction: true, detail: 'synthetic fixture: reproduced 9.1% delay reduction on mock corpus (not real data)' }],
    ['syn-repro-002', { supportsPrediction: false, detail: 'synthetic fixture: reproduced 0.4% throughput change, contradicts prediction (not real data)' }],
  ]),
)

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Deterministic key: `${anchorType}:${ref}`. */
export function anchorKey(kind: AnchorKind, ref: string): string {
  return `${kind}:${ref}`
}

function parseAnchorKey(key: string): { kind: AnchorKind; ref: string } {
  const idx = key.indexOf(':')
  if (idx < 0) {
    anchorError(ANCHOR_UNKNOWN_KEY, `anchor key must be 'kind:ref' (got ${JSON.stringify(key)})`)
  }
  const kind = key.slice(0, idx) as AnchorKind
  const ref = key.slice(idx + 1)
  if (!ANCHOR_KINDS.includes(kind)) {
    anchorError(ANCHOR_UNKNOWN_KEY, `unknown anchor kind ${JSON.stringify(kind)} in key ${JSON.stringify(key)}`)
  }
  if (ref.length === 0) {
    anchorError(ANCHOR_UNKNOWN_KEY, `empty anchor ref in key ${JSON.stringify(key)}`)
  }
  return { kind, ref }
}

function signal(opts: {
  claimRef: string
  anchorType: AnchorKind
  verdict: AnchorVerdict
  evidenceRef: string
  detail: string
  ruleVersion: string
  timestamp: number
}): AnchorSignal {
  return deepFreeze({
    claimRef: opts.claimRef,
    anchorType: opts.anchorType,
    verdict: opts.verdict,
    evidenceRef: opts.evidenceRef,
    detail: opts.detail,
    source: 'fixture',
    synthetic: true,
    ruleVersion: opts.ruleVersion,
    timestamp: opts.timestamp,
  })
}

const RULE_VERSION_BY_KIND: Readonly<Record<AnchorKind, string>> = {
  'l0-tier': L0_ANCHOR_RULE_VERSION,
  'sota': SOTA_ANCHOR_RULE_VERSION,
  'reproducibility': REPRO_ANCHOR_RULE_VERSION,
}

/** Build the fail-closed inconclusive signal a caller uses when a lookup misses
 *  (undefined). Never support — NO DEFAULT PASS. */
export function makeInconclusiveAnchorSignal(
  claimRef: string,
  kind: AnchorKind,
  detail = 'synthetic fixture: external anchor lookup missed (fail-closed -> inconclusive)',
  timestamp = 0,
): AnchorSignal {
  return signal({
    claimRef,
    anchorType: kind,
    verdict: 'inconclusive',
    evidenceRef: 'syn-miss',
    detail,
    ruleVersion: RULE_VERSION_BY_KIND[kind],
    timestamp,
  })
}

// ── Public deterministic lookup ──────────────────────────────────────────────

/** Deterministic mock lookup. Returns a frozen {@link AnchorSignal} for a known
 *  synthetic key, or undefined when the ref is missing (fail-closed: the caller
 *  maps undefined -> an inconclusive signal; it NEVER defaults to support).
 *  A malformed/unknown-kind key throws {@link AnchorError} (caller error, not a
 *  data miss). */
export function lookupAnchor(key: string, timestamp = 0): AnchorSignal | undefined {
  const { kind, ref } = parseAnchorKey(key)
  if (kind === 'l0-tier') {
    const row = L0_FIXTURE.get(ref)
    if (row === undefined) return undefined
    return signal({
      claimRef: ref,
      anchorType: 'l0-tier',
      verdict: l0Verdict(row),
      evidenceRef: ref,
      detail: `synthetic L0 fixture: tier=${row.tier}, stance=${row.stance} (mock, not real literature)`,
      ruleVersion: L0_ANCHOR_RULE_VERSION,
      timestamp,
    })
  }
  if (kind === 'sota') {
    const row = SOTA_FIXTURE.get(ref)
    if (row === undefined) return undefined
    const verdict = compareSota(row.claimedScore, row.sotaScore, row.margin)
    return signal({
      claimRef: ref,
      anchorType: 'sota',
      verdict,
      evidenceRef: ref,
      detail: `synthetic SOTA fixture: claimed=${row.claimedScore} vs sota=${row.sotaScore} (margin ${row.margin}) on ${row.method}/${row.dataset}/${row.metric} (mock)`,
      ruleVersion: SOTA_ANCHOR_RULE_VERSION,
      timestamp,
    })
  }
  // reproducibility
  const row = REPRO_FIXTURE.get(ref)
  if (row === undefined) return undefined
  return signal({
    claimRef: ref,
    anchorType: 'reproducibility',
    verdict: row.supportsPrediction ? 'support' : 'contradict',
    evidenceRef: ref,
    detail: row.detail,
    ruleVersion: REPRO_ANCHOR_RULE_VERSION,
    timestamp,
  })
}

// ── Internal deep-freeze (INV-SNAPSHOT for fixture state + returned signals) ──

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    for (const k of Object.keys(obj)) {
      deepFreeze(obj[k])
    }
    Object.freeze(value)
  }
  return value
}

function deepFreezeMap<K, V>(m: Map<K, V>): ReadonlyMap<K, V> {
  for (const v of m.values()) deepFreeze(v)
  return m
}
