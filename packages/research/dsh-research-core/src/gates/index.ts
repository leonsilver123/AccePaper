/**
 * T09 A/B/C adjudication gates — PURE functions (no state machine, no store,
 * no network, no filesystem, no clocks).
 *
 * Adjudicates one trinity-component gate for one claim and returns an
 * {@link AdjudicationResult}. The public entry is {@link adjudicate}, which
 * dispatches by `input.component` ('A' | 'B' | 'C'):
 *  - A = adversarial convergence (multi-role votes + same-family correlation
 *    detection + weighted support/refute tally).
 *  - B = external anchoring (consumes T08 {@link VerificationResult}s as
 *    external evidence anchors; missing required anchor -> abstain; #6 red
 *    line -> blocked).
 *  - C = falsifiable claim -> experiment verdict (no falsifiable prediction
 *    on a C-step -> blocked; no experiment result -> abstain).
 *
 * INVARIANTS (non-negotiable — see the contracts header):
 *  - IMMUTABLE SNAPSHOTS: input is deep-cloned (+ frozen) at the boundary so
 *    the module never retains a live ref to caller state; the returned
 *    result is deep-cloned + Object.freeze'd. Non-cloneable inputs
 *    (functions/symbols/getters that throw/WeakMap) -> ResearchValueError
 *    'DSH_VALUE_NOT_CLONEABLE', never a silent coerce.
 *  - NO DEFAULT PASS: undefined thresholds / insufficient evidence / missing
 *    external anchor / insufficient valid votes / high correlation -> abstain
 *    or blocked, NEVER a silent pass. Abstention is terminal here; the gate
 *    never upgrades an abstained result to 'passed' (downstream the state
 *    machine records it as non-passing).
 *  - NO TRUTH CLAIM: a 'passed' gate outcome means the adjudication evidence
 *    cleared the configured bar, NOT that the literature is real or the claim
 *    is proven (B external anchor = a verified citation with original-text
 *    access, never an assertion of source truthfulness).
 *  - PURE FUNCTIONS: no clocks — `timestamp` is caller-injected (echoed into
 *    the result). Thresholds are config-injected; Golden Set calibration =
 *    undefined thresholds -> MUST abstain (no hardcoded "2 votes passes").
 *  - SAME-FAMILY: votes sharing a `modelFamily` are detected + downweighted
 *    and reported in `sameFamilyClusters`; a 'passed' result that still
 *    carries non-empty `sameFamilyClusters` surfaces that heterogeneity is
 *    NOT genuine (C3) — the result never describes correlated same-family
 *    votes as genuine model heterogeneity.
 *  - AUDITABLE: every result carries a DSH_GATE_* `reasonCode` +
 *    `evidenceRefs` + the caller-injected `timestamp`.
 *
 * This module imports TYPES only from the frozen contracts + engine/types; it
 * imports `ResearchError` / `ResearchValueError` (base error classes) from
 * the state machine. It never imports sibling modules' implementation code
 * (l0 / citation), so it type-checks in isolation.
 */
import type { TrinityComponent } from '../engine/types.ts'
import type {
  AdjudicationConfig,
  AdjudicationInput,
  AdjudicationOutcome,
  AdjudicationResult,
  AdjudicationVote,
  ClaimId,
  FalsifiablePrediction,
  StateMachineGateIntent,
  VerificationResult,
} from '../contracts.ts'
import { GATE_ERROR_PREFIX, GATE_OUTCOME_TO_INTENT } from '../contracts.ts'
import { ResearchError, ResearchValueError } from '../engine/state-machine.ts'

// ── Gate → state-machine mapping (FROZEN in contracts.ts) ─────────────────────
// The ONLY interpretation point for Cordis / T10-R: an outcome is never
// re-mapped by a caller. `abstained` -> 'hold_abstained' (stay gated / human
// adjudication path) — there is NO path from abstained to passed.

/**
 * Map a gate {@link AdjudicationOutcome} to the state-machine intent, using the
 * frozen {@link GATE_OUTCOME_TO_INTENT} table from contracts.ts. Pure + total
 * (every outcome has an intent). Cordis / hosts MUST consume this function and
 * MUST NOT reinterpret an outcome themselves.
 */
export function gateToStateMachineIntent(
  outcome: AdjudicationOutcome,
): StateMachineGateIntent {
  return GATE_OUTCOME_TO_INTENT[outcome]
}
export type { StateMachineGateIntent } from '../contracts.ts'
export { GATE_OUTCOME_TO_INTENT } from '../contracts.ts'
// The full T09 input/output type surface, so consumers (Cordis / T10-R thin
// delegation) can build AdjudicationInput and type the returned result without
// importing the shared contracts file themselves.
export type {
  AdjudicationConfig,
  AdjudicationInput,
  AdjudicationOutcome,
  AdjudicationResult,
  AdjudicationVote,
  FalsifiablePrediction,
} from '../contracts.ts'

// ── Clone + Freeze (mirror state-machine patterns; freeze snapshots too) ───────

/** Deep-clone a caller-supplied value; reject non-cloneable values at the
 *  boundary (functions/symbols/WeakMap/getters that throw) so the read/return
 *  paths can never throw DataCloneError and the caller cannot smuggle a live
 *  ref past the boundary. */
function cloneValue(x: unknown): unknown {
  try {
    return structuredClone(x)
  } catch (e) {
    throw new ResearchValueError(
      'DSH_VALUE_NOT_CLONEABLE',
      'gates: input value is not structured-cloneable (functions/symbols/WeakMap/getters that throw are rejected at the module boundary — INV-SNAPSHOT-T2)',
      e,
    )
  }
}

/** Recursively Object.freeze plain objects + arrays (post-clone, so the
 *  frozen graph owns no live caller refs). Frozen arrays have immutable
 *  length + indices. Safe against `__proto__` own properties (bracket access
 *  returns the own data value; Object.prototype is never mutated). */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<PropertyKey, unknown>
    // Object.keys returns ONLY own enumerable string-keyed properties (never
    // walks the prototype chain), so inherited accessors on Object.prototype
    // are not invoked and cannot pollute globals.
    for (const k of Object.keys(obj)) {
      deepFreeze(obj[k])
    }
    Object.freeze(value)
  }
  return value
}

/** Build a result, then deep-clone + deep-freeze it before returning (the
 *  returned object is a fresh clone owning no refs to internal scratch
 *  objects, and is frozen so callers cannot mutate it). */
function seal<T>(value: T): T {
  return deepFreeze(cloneValue(value)) as T
}

// ── Small helpers ──────────────────────────────────────────────────────────────

/** A T08 VerificationResult is a usable EXTERNAL ANCHOR iff the original text
 *  was actually accessed (method !== 'none') and the conclusion is supported /
 *  partially_supported. `adjudicateB` already separates red-line verifications
 *  before calling this, so this predicate only inspects non-red-line results.
 *  It is NEVER an assertion that the source is truthful — it is an
 *  evidence-anchor marker. */
function isExternalAnchor(v: VerificationResult): boolean {
  if (!v.evidence.originalTextAccessed) return false
  if (v.evidence.method === 'none') return false
  return v.conclusion === 'supported' || v.conclusion === 'partially_supported'
}

/** Families that appear on MORE THAN ONE vote (a "cluster"). Sorted for
 *  deterministic reporting. Votes without a `modelFamily` are unique voices
 *  and never cluster. */
function detectSameFamilyClusters(votes: readonly AdjudicationVote[]): string[] {
  const counts = new Map<string, number>()
  for (const v of votes) {
    const fam = typeof v.modelFamily === 'string' ? v.modelFamily : ''
    if (fam.length > 0) counts.set(fam, (counts.get(fam) ?? 0) + 1)
  }
  const clusters: string[] = []
  for (const [fam, n] of counts) if (n > 1) clusters.push(fam)
  clusters.sort()
  return clusters
}

/** Raw (unweighted) vote tally, typed with named props so noUncheckedIndexedAccess
 *  does not widen reads to `number | undefined`. */
function voteTallyOf(votes: readonly AdjudicationVote[]): {
  support: number
  refute: number
  abstain: number
} {
  const t = { support: 0, refute: 0, abstain: 0 }
  for (const v of votes) {
    if (v.position === 'support') t.support++
    else if (v.position === 'refute') t.refute++
    else t.abstain++ // 'abstain' or any (defensive) non-deciding position
  }
  return t
}

// ── Result builder (single shape; abstentionReason only for 'abstained') ──────

interface BaseResult {
  readonly claimId: ClaimId
  readonly component: TrinityComponent
  readonly timestamp: number
}

interface BuildOpts {
  // `| undefined` on each optional so call sites may pass a `T | undefined`
  // value (e.g. a clusters array that is sometimes undefined) under
  // exactOptionalPropertyTypes without error.
  readonly abstentionReason?: string | undefined
  readonly voteTally?: Readonly<Record<string, number>> | undefined
  readonly sameFamilyClusters?: readonly string[] | undefined
}

/** Construct an AdjudicationResult in a single literal (no mutation — the
 *  result type's fields are readonly). `abstentionReason` is attached ONLY
 *  for outcome 'abstained' (the contract: "undefined if not abstained");
 *  every optional is conditionally spread so the result never carries an
 *  explicit-undefined key (exactOptionalPropertyTypes-safe). */
function buildResult(
  base: BaseResult,
  outcome: AdjudicationOutcome,
  reasonCode: string,
  evidenceRefs: readonly string[],
  opts: BuildOpts = {},
): AdjudicationResult {
  return {
    claimId: base.claimId,
    component: base.component,
    outcome,
    reasonCode,
    evidenceRefs,
    timestamp: base.timestamp,
    ...(outcome === 'abstained' && opts.abstentionReason !== undefined
      ? { abstentionReason: opts.abstentionReason }
      : {}),
    ...(opts.voteTally !== undefined ? { voteTally: opts.voteTally } : {}),
    ...(opts.sameFamilyClusters !== undefined
      ? { sameFamilyClusters: opts.sameFamilyClusters }
      : {}),
  }
}

// ── Gate A: adversarial convergence ───────────────────────────────────────────

function adjudicateA(input: AdjudicationInput): AdjudicationResult {
  const cfg: AdjudicationConfig = input.config
  const votes: readonly AdjudicationVote[] = input.votes ?? []
  const base: BaseResult = {
    claimId: input.claimId,
    component: 'A',
    timestamp: input.timestamp,
  }
  const tally = voteTallyOf(votes)
  const voterRoles = votes.map(v => v.voterRole)

  // (1) Golden Set calibration: undefined / non-finite thresholds -> abstain.
  //     NEVER hardcode a formal "N votes passes" threshold.
  const minValid = cfg.minValidVotes
  const passT = cfg.passThreshold
  if (
    minValid === undefined ||
    passT === undefined ||
    typeof minValid !== 'number' ||
    !Number.isFinite(minValid) ||
    typeof passT !== 'number' ||
    !Number.isFinite(passT)
  ) {
    return buildResult(
      base,
      'abstained',
      `${GATE_ERROR_PREFIX}UNDEFINED_THRESHOLD`,
      voterRoles,
      {
        abstentionReason:
          'minValidVotes or passThreshold is undefined/non-finite — Golden Set calibration missing (no hardcoded vote threshold is applied)',
        voteTally: tally,
      },
    )
  }
  if (passT < 0 || passT > 1) {
    return buildResult(
      base,
      'abstained',
      `${GATE_ERROR_PREFIX}UNDEFINED_THRESHOLD`,
      voterRoles,
      {
        abstentionReason: `passThreshold=${passT} is out of [0,1] — invalid calibration, refusing to adjudicate`,
        voteTally: tally,
      },
    )
  }
  if (typeof minValid !== 'number' || minValid < 0 || !Number.isInteger(minValid)) {
    return buildResult(
      base,
      'abstained',
      `${GATE_ERROR_PREFIX}UNDEFINED_THRESHOLD`,
      voterRoles,
      {
        abstentionReason: `minValidVotes=${String(minValid)} is not a non-negative integer — invalid calibration`,
        voteTally: tally,
      },
    )
  }

  // (2) Quorum: fewer votes than the calibrated minimum -> abstain.
  if (votes.length < minValid) {
    return buildResult(
      base,
      'abstained',
      `${GATE_ERROR_PREFIX}INSUFFICIENT_VALID_VOTES`,
      voterRoles,
      {
        abstentionReason: `only ${votes.length} vote(s) present (minValidVotes=${minValid}) — insufficient valid votes`,
        voteTally: tally,
      },
    )
  }

  // (3) Same-family detection + downweight calibration.
  const clusters = detectSameFamilyClusters(votes)
  let clustersForReport: readonly string[] | undefined
  let dw: number | undefined
  if (clusters.length > 0) {
    if (
      cfg.sameFamilyDownweight === undefined ||
      typeof cfg.sameFamilyDownweight !== 'number' ||
      !Number.isFinite(cfg.sameFamilyDownweight)
    ) {
      // Correlation is present but the discount is uncalibrated -> cannot
      // safely downweight -> abstain (treat as undefined threshold).
      return buildResult(
        base,
        'abstained',
        `${GATE_ERROR_PREFIX}UNDEFINED_THRESHOLD`,
        voterRoles,
        {
          abstentionReason:
            'same-family correlation detected but sameFamilyDownweight is undefined/non-finite — cannot calibrate the discount (C3)',
          voteTally: tally,
          sameFamilyClusters: clusters,
        },
      )
    }
    dw = cfg.sameFamilyDownweight
    clustersForReport = clusters
  }
  const clusterSet = new Set(clusters)
  const useDownweight = clustersForReport !== undefined
  const dwVal = dw as number // logically defined iff useDownweight

  // (4) Effective independent votes after downweighting. If correlation has
  //     eroded genuine heterogeneity below quorum -> abstain (the result MUST
  //     surface that heterogeneity is NOT genuine — C3).
  let effectiveVotes = 0
  for (const v of votes) {
    if (
      useDownweight &&
      typeof v.modelFamily === 'string' &&
      clusterSet.has(v.modelFamily)
    ) {
      effectiveVotes += dwVal
    } else {
      effectiveVotes += 1
    }
  }
  if (effectiveVotes < minValid) {
    return buildResult(
      base,
      'abstained',
      `${GATE_ERROR_PREFIX}CORRELATED_ROLE_OPINIONS`,
      voterRoles,
      {
        abstentionReason: `same-family downweight reduced effective independent votes to ${effectiveVotes.toFixed(4)} < minValidVotes=${minValid} — role opinions are highly correlated, heterogeneity is NOT genuine (C3)`,
        voteTally: tally,
        sameFamilyClusters: clustersForReport,
      },
    )
  }

  // (5) Weighted tally. Abstain votes do not decide; only support/refute
  //     cast weight. If every deciding vote abstains -> insufficient evidence.
  let supportW = 0
  let refuteW = 0
  for (const v of votes) {
    const w =
      useDownweight &&
      typeof v.modelFamily === 'string' &&
      clusterSet.has(v.modelFamily)
        ? dwVal
        : 1
    if (v.position === 'support') supportW += w
    else if (v.position === 'refute') refuteW += w
  }
  const deciding = supportW + refuteW
  if (deciding === 0) {
    return buildResult(
      base,
      'abstained',
      `${GATE_ERROR_PREFIX}INSUFFICIENT_EVIDENCE`,
      voterRoles,
      {
        abstentionReason: 'every (deciding) vote abstains — no support/refute opinion to adjudicate',
        voteTally: tally,
        sameFamilyClusters: clustersForReport,
      },
    )
  }
  const supportFrac = supportW / deciding
  const refuteFrac = refuteW / deciding

  if (supportFrac >= passT) {
    return buildResult(
      base,
      'passed',
      `${GATE_ERROR_PREFIX}CONVERGENCE_PASSED`,
      voterRoles,
      {
        voteTally: tally,
        sameFamilyClusters: clustersForReport,
      },
    )
  }
  if (refuteFrac >= passT) {
    return buildResult(
      base,
      'failed',
      `${GATE_ERROR_PREFIX}CONVERGENCE_FAILED`,
      voterRoles,
      {
        voteTally: tally,
        sameFamilyClusters: clustersForReport,
      },
    )
  }
  // Ambiguous: neither support nor refute converged at the threshold.
  return buildResult(
    base,
    'blocked',
    `${GATE_ERROR_PREFIX}AMBIGUOUS_CONVERGENCE`,
    voterRoles,
    {
      voteTally: tally,
      sameFamilyClusters: clustersForReport,
    },
  )
}

// ── Gate B: external anchoring ─────────────────────────────────────────────────

function adjudicateB(input: AdjudicationInput): AdjudicationResult {
  const cfg: AdjudicationConfig = input.config
  const verifs: readonly VerificationResult[] = input.verifications ?? []
  const base: BaseResult = {
    claimId: input.claimId,
    component: 'B',
    timestamp: input.timestamp,
  }

  const anchorIds: string[] = []
  const redLineIds: string[] = []
  for (const v of verifs) {
    if (v.redLineTriggered) {
      redLineIds.push(v.citationId)
    } else if (isExternalAnchor(v)) {
      anchorIds.push(v.citationId)
    }
  }

  // #6 red line: claimed verification without original-text access -> hard
  // block. Downstream MUST treat this as non-passing evidence.
  if (redLineIds.length > 0) {
    return buildResult(base, 'blocked', `${GATE_ERROR_PREFIX}RED_LINE_BLOCKED`, redLineIds)
  }

  if (anchorIds.length >= 1) {
    return buildResult(base, 'passed', `${GATE_ERROR_PREFIX}EXTERNAL_ANCHOR_PASSED`, anchorIds)
  }

  // No usable anchor present.
  if (cfg.requireExternalAnchor === true) {
    return buildResult(base, 'abstained', `${GATE_ERROR_PREFIX}MISSING_EXTERNAL_ANCHOR`, [], {
      abstentionReason:
        'requireExternalAnchor=true but no external anchor found (no VerificationResult with original-text access + supported/partially_supported conclusion + no red line) — refusing to anchor the claim (NO DEFAULT PASS)',
    })
  }
  return buildResult(base, 'abstained', `${GATE_ERROR_PREFIX}INSUFFICIENT_EVIDENCE`, [], {
    abstentionReason:
      'no external anchor verifications present — insufficient evidence to anchor the claim (NO DEFAULT PASS)',
  })
}

// ── Gate C: falsifiable claim -> experiment verdict ────────────────────────────

function adjudicateC(input: AdjudicationInput): AdjudicationResult {
  const falsifiable: FalsifiablePrediction | undefined = input.falsifiable
  const base: BaseResult = {
    claimId: input.claimId,
    component: 'C',
    timestamp: input.timestamp,
  }
  // C does not use vote/anchor thresholds — a falsifiable result is ALWAYS
  // required to pass (NO DEFAULT PASS: a falsifiable prediction with no
  // experiment result abstains rather than passing). The contract carries no
  // 'requireFalsifiableResult' knob: the C gate hard-requires a falsifiable
  // prediction (blocked otherwise) and cannot be configured to bypass it.

  // No falsifiable prediction on a C-step -> blocked (explicit per contract).
  if (
    !falsifiable ||
    typeof falsifiable.prediction !== 'string' ||
    falsifiable.prediction.trim().length === 0
  ) {
    return buildResult(base, 'blocked', `${GATE_ERROR_PREFIX}NO_FALSIFIABLE_PREDICTION`, [])
  }

  const exp = falsifiable.experimentResult
  if (!exp) {
    // Prediction present but untested -> cannot adjudicate -> abstain.
    return buildResult(base, 'abstained', `${GATE_ERROR_PREFIX}NO_EXPERIMENT_RESULT`, ['falsifiable-prediction'], {
      abstentionReason:
        'falsifiable prediction is present but no experimentResult was provided — insufficient evidence to adjudicate (NO DEFAULT PASS)',
    })
  }

  if (exp.supportsPrediction === true) {
    return buildResult(base, 'passed', `${GATE_ERROR_PREFIX}FALSIFIABLE_PASSED`, [
      'falsifiable-prediction',
      'experiment-result',
    ])
  }
  if (exp.supportsPrediction === false) {
    return buildResult(base, 'failed', `${GATE_ERROR_PREFIX}FALSIFIABLE_FAILED`, [
      'falsifiable-prediction',
      'experiment-result',
    ])
  }
  // supportsPrediction is not a boolean -> malformed result -> abstain.
  return buildResult(base, 'abstained', `${GATE_ERROR_PREFIX}INVALID_EXPERIMENT_RESULT`, ['falsifiable-prediction'], {
    abstentionReason:
      'experimentResult.supportsPrediction is not a boolean — cannot adjudicate the falsifiable prediction',
  })
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Adjudicate one trinity-component gate for one claim. Dispatches by
 * `input.component` ('A' | 'B' | 'C'). Pure: no store, no network, no clock
 * (timestamp is caller-injected and echoed into the result).
 *
 * @param input the adjudication input (claimId + component + channel data +
 *   caller-injected config + timestamp). Deep-cloned + frozen at the
 *   boundary; non-cloneable inputs throw ResearchValueError.
 * @returns a frozen {@link AdjudicationResult} (deep-cloned; the returned
 *   object shares no references with the input or any internal scratch).
 * @throws {ResearchError} 'DSH_GATE_INVALID_INPUT' if a required field
 *   (claimId / component / config / timestamp) is missing or malformed.
 */
export function adjudicate(input: AdjudicationInput): AdjudicationResult {
  if (input === null || typeof input !== 'object') {
    throw new ResearchError(
      `${GATE_ERROR_PREFIX}INVALID_INPUT`,
      'adjudicate: input must be a non-null object',
    )
  }
  // Deep-clone at the boundary (rejects non-cloneable); freeze the snapshot
  // so internal logic cannot mutate caller-supplied data.
  const cloned = cloneValue(input) as AdjudicationInput
  deepFreeze(cloned)

  // Defensive validation of required structural fields (NO DEFAULT PASS:
  // never silently coerce a malformed input into an adjudication outcome).
  if (typeof cloned.claimId !== 'string' || cloned.claimId.length === 0) {
    throw new ResearchError(
      `${GATE_ERROR_PREFIX}INVALID_INPUT`,
      'adjudicate: input.claimId must be a non-empty string',
    )
  }
  if (
    cloned.component !== 'A' &&
    cloned.component !== 'B' &&
    cloned.component !== 'C'
  ) {
    throw new ResearchError(
      `${GATE_ERROR_PREFIX}INVALID_INPUT`,
      `adjudicate: input.component must be 'A' | 'B' | 'C' (got '${String(cloned.component)}')`,
    )
  }
  if (cloned.config === null || typeof cloned.config !== 'object') {
    throw new ResearchError(
      `${GATE_ERROR_PREFIX}INVALID_INPUT`,
      'adjudicate: input.config must be a non-null object',
    )
  }
  if (
    typeof cloned.timestamp !== 'number' ||
    !Number.isFinite(cloned.timestamp)
  ) {
    throw new ResearchError(
      `${GATE_ERROR_PREFIX}INVALID_INPUT`,
      'adjudicate: input.timestamp must be a finite number (caller-injected, deterministic in tests)',
    )
  }

  let raw: AdjudicationResult
  if (cloned.component === 'A') raw = adjudicateA(cloned)
  else if (cloned.component === 'B') raw = adjudicateB(cloned)
  else raw = adjudicateC(cloned)

  // Deep-clone + freeze the return so callers cannot mutate it and it shares
  // no references with internal scratch objects.
  return seal(raw)
}
