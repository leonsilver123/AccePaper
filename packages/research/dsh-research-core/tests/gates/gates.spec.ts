import { describe, expect, it } from 'vitest'
import { adjudicate, GATE_OUTCOME_TO_INTENT, gateToStateMachineIntent } from '../../src/gates/index.ts'
import { ResearchError } from '../../src/engine/state-machine.ts'
import type {
  AdjudicationConfig,
  AdjudicationInput,
  AdjudicationVote,
  CitationId,
  ClaimId,
  FalsifiablePrediction,
  VerificationConclusion,
  VerificationMethod,
  VerificationResult,
} from '../../src/contracts.ts'

// ── Builders (branded ids + frozen-contract shapes) ─────────────────────────

const CID = (s: string): ClaimId => s as ClaimId
const CIT = (s: string): CitationId => s as CitationId

const CLAIM = CID('claim-1')

function vote(
  role: string,
  position: AdjudicationVote['position'],
  family?: string,
): AdjudicationVote {
  return {
    voterRole: role,
    position,
    rationale: `rationale-${role}`,
    ...(family !== undefined ? { modelFamily: family } : {}),
  }
}

/** Build a VerificationResult; only the fields the B gate inspects vary. */
function vref(
  citationId: string,
  conclusion: VerificationConclusion,
  opts: {
    redLine?: boolean
    accessed?: boolean
    method?: VerificationMethod
  } = {},
): VerificationResult {
  return {
    claimId: CLAIM,
    citationId: CIT(citationId),
    ref: { kind: 'doi', id: `10.0/${citationId}` },
    evidence: {
      originalTextAccessed: opts.accessed ?? true,
      method: opts.method ?? 'auto_crossref',
    },
    conclusion,
    redLineTriggered: opts.redLine ?? false,
    reasonCode: 'DSH_CITATION_OK',
    timestamp: 1,
  }
}

function aInput(
  votes: AdjudicationVote[],
  config: AdjudicationConfig,
  timestamp = 1,
): AdjudicationInput {
  return { claimId: CLAIM, component: 'A', votes, config, timestamp }
}

function bInput(
  verifs: VerificationResult[],
  config: AdjudicationConfig,
  timestamp = 1,
): AdjudicationInput {
  return { claimId: CLAIM, component: 'B', verifications: verifs, config, timestamp }
}

function cInput(
  falsifiable: FalsifiablePrediction | undefined,
  config: AdjudicationConfig = {},
  timestamp = 1,
): AdjudicationInput {
  return { claimId: CLAIM, component: 'C', falsifiable, config, timestamp }
}

const CAL = { minValidVotes: 2, passThreshold: 0.6 }

// ── Gate A: adversarial convergence ───────────────────────────────────────────

describe('Gate A — adversarial convergence (pass / fail / blocked)', () => {
  it('passes when weighted support fraction >= passThreshold', () => {
    const r = adjudicate(aInput([vote('r1', 'support'), vote('r2', 'support'), vote('r3', 'support'), vote('r4', 'refute')], CAL))
    expect(r.outcome).toBe('passed')
    expect(r.reasonCode).toMatch(/DSH_GATE_CONVERGENCE_PASSED/)
    expect(r.component).toBe('A')
    expect(r.claimId).toBe(CLAIM)
    expect(r.timestamp).toBe(1)
    expect(r.voteTally).toEqual({ support: 3, refute: 1, abstain: 0 })
    expect(r.evidenceRefs).toEqual(['r1', 'r2', 'r3', 'r4'])
  })

  it('fails when weighted refute fraction >= passThreshold', () => {
    const r = adjudicate(aInput([vote('r1', 'support'), vote('r2', 'refute'), vote('r3', 'refute'), vote('r4', 'refute')], CAL))
    expect(r.outcome).toBe('failed')
    expect(r.reasonCode).toMatch(/DSH_GATE_CONVERGENCE_FAILED/)
  })

  it('is blocked (ambiguous) when neither support nor refute reaches the threshold', () => {
    const r = adjudicate(aInput([vote('r1', 'support'), vote('r2', 'support'), vote('r3', 'refute'), vote('r4', 'refute')], CAL))
    expect(r.outcome).toBe('blocked')
    expect(r.reasonCode).toMatch(/DSH_GATE_AMBIGUOUS_CONVERGENCE/)
    expect(r.abstentionReason).toBeUndefined()
  })
})

describe('Gate A — NO DEFAULT PASS / undefined threshold -> abstain (no hardcoded "2 votes")', () => {
  it('abstains when minValidVotes is undefined (even with strong support)', () => {
    const r = adjudicate(aInput([vote('r1', 'support'), vote('r2', 'support'), vote('r3', 'support')], { passThreshold: 0.6 }))
    expect(r.outcome).toBe('abstained')
    expect(r.reasonCode).toMatch(/DSH_GATE_UNDEFINED_THRESHOLD/)
    expect(r.abstentionReason).toMatch(/minValidVotes/)
  })

  it('abstains when passThreshold is undefined', () => {
    const r = adjudicate(aInput([vote('r1', 'support'), vote('r2', 'support')], { minValidVotes: 2 }))
    expect(r.outcome).toBe('abstained')
    expect(r.reasonCode).toMatch(/DSH_GATE_UNDEFINED_THRESHOLD/)
    expect(r.abstentionReason).toMatch(/passThreshold/)
  })

  it('abstains when passThreshold is non-finite (NaN)', () => {
    const r = adjudicate(aInput([vote('r1', 'support'), vote('r2', 'support')], { minValidVotes: 2, passThreshold: NaN }))
    expect(r.outcome).toBe('abstained')
    expect(r.reasonCode).toMatch(/DSH_GATE_UNDEFINED_THRESHOLD/)
  })

  it('abstains when passThreshold is out of [0,1]', () => {
    const r = adjudicate(aInput([vote('r1', 'support'), vote('r2', 'support')], { minValidVotes: 2, passThreshold: 1.5 }))
    expect(r.outcome).toBe('abstained')
    expect(r.abstentionReason).toMatch(/out of \[0,1\]/)
  })

  it('abstains when minValidVotes is not an integer', () => {
    const r = adjudicate(aInput([vote('r1', 'support'), vote('r2', 'support')], { minValidVotes: 1.5, passThreshold: 0.5 }))
    expect(r.outcome).toBe('abstained')
    expect(r.abstentionReason).toMatch(/not a non-negative integer/)
  })

  it('abstains on insufficient valid votes (below quorum)', () => {
    const r = adjudicate(aInput([vote('r1', 'support')], CAL))
    expect(r.outcome).toBe('abstained')
    expect(r.reasonCode).toMatch(/DSH_GATE_INSUFFICIENT_VALID_VOTES/)
  })

  it('abstains when every deciding vote abstains (insufficient evidence)', () => {
    const r = adjudicate(aInput([vote('r1', 'abstain', 'X'), vote('r2', 'abstain', 'Y')], CAL))
    expect(r.outcome).toBe('abstained')
    expect(r.reasonCode).toMatch(/DSH_GATE_INSUFFICIENT_EVIDENCE/)
  })
})

// ── Gate A: same-family correlation (C3) ─────────────────────────────────────

describe('Gate A — same-family correlation detection + downweight (C3)', () => {
  it('abstains when ALL votes share one family (effective votes drop below quorum)', () => {
    const r = adjudicate(
      aInput(
        [vote('r1', 'support', 'F'), vote('r2', 'support', 'F'), vote('r3', 'support', 'F')],
        { minValidVotes: 2, passThreshold: 0.5, sameFamilyDownweight: 0.5 },
      ),
    )
    expect(r.outcome).toBe('abstained')
    expect(r.reasonCode).toMatch(/DSH_GATE_CORRELATED_ROLE_OPINIONS/)
    expect(r.sameFamilyClusters).toEqual(['F'])
    expect(r.abstentionReason).toMatch(/NOT genuine/)
  })

  it('passes with a partial cluster but STILL surfaces sameFamilyClusters (heterogeneity NOT genuine)', () => {
    const r = adjudicate(
      aInput(
        [
          vote('r1', 'support', 'F'),
          vote('r2', 'support', 'F'),
          vote('r3', 'support', 'F'),
          vote('r4', 'support'), // independent voice (no family)
        ],
        { minValidVotes: 2, passThreshold: 0.5, sameFamilyDownweight: 0.5 },
      ),
    )
    expect(r.outcome).toBe('passed')
    expect(r.sameFamilyClusters).toEqual(['F']) // non-empty => NOT genuine heterogeneity
    expect(r.voteTally).toEqual({ support: 4, refute: 0, abstain: 0 })
  })

  it('reports same-family clusters sorted deterministically', () => {
    const r = adjudicate(
      aInput(
        [vote('r1', 'support', 'B'), vote('r2', 'support', 'B'), vote('r3', 'support', 'A'), vote('r4', 'support', 'A')],
        { minValidVotes: 2, passThreshold: 0.5, sameFamilyDownweight: 0.5 },
      ),
    )
    expect(r.sameFamilyClusters).toEqual(['A', 'B'])
  })

  it('abstains when a cluster is present but sameFamilyDownweight is undefined (uncalibrated)', () => {
    const r = adjudicate(
      aInput(
        [vote('r1', 'support', 'F'), vote('r2', 'support', 'F')],
        { minValidVotes: 2, passThreshold: 0.5 },
      ),
    )
    expect(r.outcome).toBe('abstained')
    expect(r.reasonCode).toMatch(/DSH_GATE_UNDEFINED_THRESHOLD/)
    expect(r.sameFamilyClusters).toEqual(['F'])
  })

  it('does NOT populate sameFamilyClusters when there is no correlation (genuine heterogeneity)', () => {
    const r = adjudicate(
      aInput([vote('r1', 'support', 'X'), vote('r2', 'support', 'Y')], { minValidVotes: 2, passThreshold: 0.5 }),
    )
    expect(r.outcome).toBe('passed')
    expect(r.sameFamilyClusters).toBeUndefined()
    expect('sameFamilyClusters' in r).toBe(false)
  })

  it('downweights the refute side the same as support (symmetric weighting)', () => {
    // 3 refute family-F (downweighted 0.5 each => 1.5) + 1 refute independent (1) => effective 2.5 >= 2
    const r = adjudicate(
      aInput(
        [vote('r1', 'refute', 'F'), vote('r2', 'refute', 'F'), vote('r3', 'refute', 'F'), vote('r4', 'refute')],
        { minValidVotes: 2, passThreshold: 0.5, sameFamilyDownweight: 0.5 },
      ),
    )
    expect(r.outcome).toBe('failed')
    expect(r.sameFamilyClusters).toEqual(['F'])
  })
})

// ── Gate B: external anchoring ────────────────────────────────────────────────

describe('Gate B — external anchoring (consumes VerificationResult[])', () => {
  it('passes when a supported verification with original-text access is present', () => {
    const r = adjudicate(bInput([vref('cit-1', 'supported')], { requireExternalAnchor: true }))
    expect(r.outcome).toBe('passed')
    expect(r.reasonCode).toMatch(/DSH_GATE_EXTERNAL_ANCHOR_PASSED/)
    expect(r.evidenceRefs).toEqual(['cit-1'])
  })

  it('treats partially_supported as a usable anchor', () => {
    const r = adjudicate(bInput([vref('cit-1', 'partially_supported')], { requireExternalAnchor: true }))
    expect(r.outcome).toBe('passed')
  })

  it('is blocked when any verification triggered the #6 red line', () => {
    const r = adjudicate(
      bInput(
        [
          vref('cit-1', 'supported', { redLine: true }),
          vref('cit-2', 'supported'),
        ],
        { requireExternalAnchor: true },
      ),
    )
    expect(r.outcome).toBe('blocked')
    expect(r.reasonCode).toMatch(/DSH_GATE_RED_LINE_BLOCKED/)
    expect(r.evidenceRefs).toEqual(['cit-1'])
  })

  it('abstains (MISSING_EXTERNAL_ANCHOR) when requireExternalAnchor=true and no anchor present', () => {
    const r = adjudicate(bInput([vref('cit-1', 'unsupported')], { requireExternalAnchor: true }))
    expect(r.outcome).toBe('abstained')
    expect(r.reasonCode).toMatch(/DSH_GATE_MISSING_EXTERNAL_ANCHOR/)
    expect(r.abstentionReason).toMatch(/requireExternalAnchor/)
  })

  it('abstains (INSUFFICIENT_EVIDENCE) when not required and no anchor present', () => {
    const r = adjudicate(bInput([vref('cit-1', 'unsupported')], { requireExternalAnchor: false }))
    expect(r.outcome).toBe('abstained')
    expect(r.reasonCode).toMatch(/DSH_GATE_INSUFFICIENT_EVIDENCE/)
  })

  it('abstains (INSUFFICIENT_EVIDENCE) when requireExternalAnchor is undefined and no anchor present', () => {
    const r = adjudicate(bInput([], {}))
    expect(r.outcome).toBe('abstained')
    expect(r.reasonCode).toMatch(/DSH_GATE_INSUFFICIENT_EVIDENCE/)
  })

  it('does NOT treat retracted / unsupported / identity_mismatch as anchors', () => {
    for (const conclusion of ['retracted', 'unsupported', 'identity_mismatch'] as VerificationConclusion[]) {
      const r = adjudicate(bInput([vref('cit-1', conclusion)], { requireExternalAnchor: true }))
      expect(r.outcome).toBe('abstained')
      expect(r.reasonCode).toMatch(/DSH_GATE_MISSING_EXTERNAL_ANCHOR/)
    }
  })

  it('does NOT treat a supported-but-unaccessed verification as an anchor', () => {
    const r = adjudicate(bInput([vref('cit-1', 'supported', { accessed: false, method: 'none' })], { requireExternalAnchor: true }))
    expect(r.outcome).toBe('abstained')
    expect(r.reasonCode).toMatch(/DSH_GATE_MISSING_EXTERNAL_ANCHOR/)
  })

  it('does NOT treat accessed-but-method-none as an anchor', () => {
    const r = adjudicate(bInput([vref('cit-1', 'supported', { accessed: true, method: 'none' })], { requireExternalAnchor: true }))
    expect(r.outcome).toBe('abstained')
    expect(r.reasonCode).toMatch(/DSH_GATE_MISSING_EXTERNAL_ANCHOR/)
  })
})

// ── Gate C: falsifiable claim -> experiment verdict ───────────────────────────

describe('Gate C — falsifiable claim -> experiment verdict', () => {
  it('passes when the experiment supports the prediction', () => {
    const r = adjudicate(cInput({ prediction: 'P holds', experimentResult: { supportsPrediction: true, detail: 'd' } }))
    expect(r.outcome).toBe('passed')
    expect(r.reasonCode).toMatch(/DSH_GATE_FALSIFIABLE_PASSED/)
    expect(r.evidenceRefs).toEqual(['falsifiable-prediction', 'experiment-result'])
  })

  it('fails when the experiment refutes the prediction', () => {
    const r = adjudicate(cInput({ prediction: 'P holds', experimentResult: { supportsPrediction: false, detail: 'd' } }))
    expect(r.outcome).toBe('failed')
    expect(r.reasonCode).toMatch(/DSH_GATE_FALSIFIABLE_FAILED/)
  })

  it('is blocked when there is NO falsifiable prediction on a C-step', () => {
    const r = adjudicate(cInput(undefined))
    expect(r.outcome).toBe('blocked')
    expect(r.reasonCode).toMatch(/DSH_GATE_NO_FALSIFIABLE_PREDICTION/)
  })

  it('is blocked when the falsifiable prediction is an empty string', () => {
    const r = adjudicate(cInput({ prediction: '   ' }))
    expect(r.outcome).toBe('blocked')
    expect(r.reasonCode).toMatch(/DSH_GATE_NO_FALSIFIABLE_PREDICTION/)
  })

  it('is blocked when the prediction field is not a string', () => {
    const r = adjudicate(cInput({ prediction: 123 } as unknown as FalsifiablePrediction))
    expect(r.outcome).toBe('blocked')
    expect(r.reasonCode).toMatch(/DSH_GATE_NO_FALSIFIABLE_PREDICTION/)
  })

  it('abstains when the prediction is present but untested (no experiment result)', () => {
    const r = adjudicate(cInput({ prediction: 'P holds' }))
    expect(r.outcome).toBe('abstained')
    expect(r.reasonCode).toMatch(/DSH_GATE_NO_EXPERIMENT_RESULT/)
    expect(r.abstentionReason).toMatch(/NO DEFAULT PASS/)
  })

  it('abstains when experimentResult.supportsPrediction is not a boolean', () => {
    const r = adjudicate(cInput({ prediction: 'P holds', experimentResult: { supportsPrediction: 'yes' as unknown as boolean, detail: 'd' } }))
    expect(r.outcome).toBe('abstained')
    expect(r.reasonCode).toMatch(/DSH_GATE_INVALID_EXPERIMENT_RESULT/)
  })
})

// ── Dispatch + structural validation (NO DEFAULT PASS) ───────────────────────

describe('adjudicate — dispatch + structural validation', () => {
  it('dispatches by component (A/B/C all route to their gate)', () => {
    expect(adjudicate(aInput([vote('r1', 'support'), vote('r2', 'support')], CAL)).component).toBe('A')
    expect(adjudicate(bInput([vref('c1', 'supported')], {})).component).toBe('B')
    expect(adjudicate(cInput({ prediction: 'p', experimentResult: { supportsPrediction: true, detail: 'd' } })).component).toBe('C')
  })

  it('every reasonCode is DSH_GATE_-prefixed', () => {
    const rs = [
      adjudicate(aInput([vote('r1', 'support')], CAL)),
      adjudicate(bInput([], {})),
      adjudicate(cInput(undefined)),
    ]
    for (const r of rs) expect(r.reasonCode.startsWith('DSH_GATE_')).toBe(true)
  })

  it('throws DSH_GATE_INVALID_INPUT for a non-object input', () => {
    expect(() => adjudicate(null as unknown as AdjudicationInput)).toThrow(ResearchError)
    expect(() => adjudicate(null as unknown as AdjudicationInput)).toThrow(/DSH_GATE_INVALID_INPUT/)
  })

  it('throws DSH_GATE_INVALID_INPUT for an empty claimId', () => {
    expect(() => adjudicate({ claimId: '' as ClaimId, component: 'A', config: {}, timestamp: 1 })).toThrow(/DSH_GATE_INVALID_INPUT/)
  })

  it('throws DSH_GATE_INVALID_INPUT for an invalid component', () => {
    expect(() => adjudicate({ claimId: CID('c'), component: 'Z' as 'A', config: {}, timestamp: 1 })).toThrow(/DSH_GATE_INVALID_INPUT/)
  })

  it('throws DSH_GATE_INVALID_INPUT for a missing config', () => {
    expect(() => adjudicate({ claimId: CID('c'), component: 'A', timestamp: 1 } as AdjudicationInput)).toThrow(/DSH_GATE_INVALID_INPUT/)
  })

  it('throws DSH_GATE_INVALID_INPUT for a non-finite timestamp', () => {
    expect(() => adjudicate({ claimId: CID('c'), component: 'A', config: {}, timestamp: NaN })).toThrow(/DSH_GATE_INVALID_INPUT/)
  })
})

// ── Immutability + isolation invariants ───────────────────────────────────────

describe('immutability + isolation (INV-SNAPSHOT-T2 / no live refs)', () => {
  it('returns a deeply frozen AdjudicationResult (caller cannot mutate it)', () => {
    const r = adjudicate(aInput([vote('r1', 'support'), vote('r2', 'refute')], CAL))
    expect(Object.isFrozen(r)).toBe(true)
    expect(Object.isFrozen(r.evidenceRefs)).toBe(true)
    expect(Object.isFrozen(r.voteTally)).toBe(true)
    expect(() => {
      // @ts-expect-error mutating a frozen readonly result
      ;(r as { outcome?: string }).outcome = 'passed'
    }).toThrow()
  })

  it('does NOT retain a live reference to caller input (mutating input after the call is a no-op)', () => {
    const votes = [vote('r1', 'support'), vote('r2', 'support'), vote('r3', 'support')]
    const input = aInput(votes, CAL)
    const r = adjudicate(input)
    expect(r.outcome).toBe('passed')
    // Mutate the caller's input after the call — the snapshot must not change.
    votes[0] = vote('r1', 'refute')
    ;(input as { timestamp: number }).timestamp = 999
    expect(r.voteTally).toEqual({ support: 3, refute: 0, abstain: 0 })
    expect(r.timestamp).toBe(1)
    expect(r.evidenceRefs).not.toBe(votes) // not the same array reference
  })

  it('rejects a non-cloneable input with ResearchError (DSH_VALUE_NOT_CLONEABLE)', () => {
    const input = {
      claimId: CID('c'),
      component: 'A',
      votes: [vote('r1', 'support')],
      config: { minValidVotes: 1, passThreshold: 0.5 },
      timestamp: 1,
      // a function is NOT structured-cloneable -> rejected at the boundary
      extra: (): string => 'oops',
    } as unknown as AdjudicationInput
    expect(() => adjudicate(input)).toThrow(ResearchError)
    expect(() => adjudicate(input)).toThrow(/DSH_VALUE_NOT_CLONEABLE/)
  })

  it('is prototype-pollution safe: a __proto__ own property never taints Object.prototype', () => {
    // JSON.parse yields '__proto__' as an OWN data property (not the prototype).
    const protoCfg = JSON.parse(
      '{"__proto__":{"polluted":true},"minValidVotes":2,"passThreshold":0.6}',
    ) as AdjudicationConfig
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined()
    const r = adjudicate(aInput([vote('r1', 'support'), vote('r2', 'support'), vote('r3', 'support')], protoCfg))
    expect(r.outcome).toBe('passed')
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined() // global prototype still clean
  })

  it('rejects an input whose config has a getter that throws (treated as non-cloneable)', () => {
    const cfg: AdjudicationConfig = { minValidVotes: 1, passThreshold: 0.5 }
    Object.defineProperty(cfg, 'sneaky', {
      get(): never {
        throw new Error('getter-boom')
      },
      enumerable: true,
      configurable: true,
    })
    const input = { claimId: CID('c'), component: 'A', votes: [vote('r1', 'support')], config: cfg, timestamp: 1 }
    expect(() => adjudicate(input)).toThrow(ResearchError)
    expect(() => adjudicate(input)).toThrow(/DSH_VALUE_NOT_CLONEABLE/)
  })

  it('cross-run isolation: two independent calls never bleed state', () => {
    const r1 = adjudicate(aInput([vote('r1', 'support'), vote('r2', 'support')], CAL))
    const r2 = adjudicate(aInput([vote('r1', 'refute'), vote('r2', 'refute')], CAL))
    expect(r1.outcome).toBe('passed')
    expect(r2.outcome).toBe('failed')
    expect(r1).not.toBe(r2)
    expect(r1.voteTally).not.toBe(r2.voteTally)
  })
})

// ── Gate → state-machine mapping (FROZEN — T10-R / Cordis MUST NOT
//    reinterpret an outcome; the table + helper are the SINGLE mapping point)

describe('Gate → state-machine intent (frozen GATE_OUTCOME_TO_INTENT)', () => {
  it('maps every adjudication outcome to its state-machine intent', () => {
    expect(gateToStateMachineIntent('passed')).toBe('pass')
    expect(gateToStateMachineIntent('blocked')).toBe('rework')
    expect(gateToStateMachineIntent('failed')).toBe('hard_fail')
    expect(gateToStateMachineIntent('abstained')).toBe('hold_abstained')
  })

  it('the mapping table is frozen at module load (Cordis cannot re-map it)', () => {
    expect(Object.isFrozen(GATE_OUTCOME_TO_INTENT)).toBe(true)
  })

  it('abstained NEVER maps to pass (NO DEFAULT PASS survives the boundary)', () => {
    expect(GATE_OUTCOME_TO_INTENT.abstained).not.toBe('pass')
    expect(GATE_OUTCOME_TO_INTENT.abstained).toBe('hold_abstained')
  })

  it('the helper is total: it equals the frozen table for every outcome', () => {
    for (const outcome of ['passed', 'blocked', 'failed', 'abstained'] as const) {
      expect(gateToStateMachineIntent(outcome)).toBe(GATE_OUTCOME_TO_INTENT[outcome])
    }
  })

  it('end-to-end: real adjudicate outcomes feed the frozen mapping unchanged', () => {
    // ambiguous convergence -> blocked -> rework (returnable), never pass/fail
    const blocked = adjudicate(aInput([vote('r1', 'support'), vote('r2', 'refute')], CAL))
    expect(blocked.outcome).toBe('blocked')
    expect(gateToStateMachineIntent(blocked.outcome)).toBe('rework')
    // insufficient votes -> abstained -> hold_abstained (stay gated / human path)
    const abst = adjudicate(aInput([vote('r1', 'support')], CAL))
    expect(abst.outcome).toBe('abstained')
    expect(gateToStateMachineIntent(abst.outcome)).toBe('hold_abstained')
    // converging support -> passed -> pass
    const passed = adjudicate(aInput([vote('r1', 'support'), vote('r2', 'support')], CAL))
    expect(passed.outcome).toBe('passed')
    expect(gateToStateMachineIntent(passed.outcome)).toBe('pass')
    // converging refute -> failed -> hard_fail (unrecoverable / experiment negates)
    const failed = adjudicate(aInput([vote('r1', 'refute'), vote('r2', 'refute')], CAL))
    expect(failed.outcome).toBe('failed')
    expect(gateToStateMachineIntent(failed.outcome)).toBe('hard_fail')
  })
})

// ── Abstention is terminal (NOT upgradeable to passed) ───────────────────────

describe('ABSTENTION-NOT-UPGRADABLE-TO-PASSED (NO DEFAULT PASS)', () => {
  const abstainInputs: Array<[string, AdjudicationInput]> = [
    ['undefined threshold', aInput([vote('r1', 'support'), vote('r2', 'support')], { passThreshold: 0.6 })],
    ['insufficient valid votes', aInput([vote('r1', 'support')], CAL)],
    ['all abstain', aInput([vote('r1', 'abstain', 'X'), vote('r2', 'abstain', 'Y')], CAL)],
    ['correlated role opinions', aInput([vote('r1', 'support', 'F'), vote('r2', 'support', 'F')], { minValidVotes: 2, passThreshold: 0.5, sameFamilyDownweight: 0.5 })],
    ['B missing required anchor', bInput([], { requireExternalAnchor: true })],
    ['B no evidence', bInput([], {})],
    ['C no experiment result', cInput({ prediction: 'p' })],
    ['C invalid experiment result', cInput({ prediction: 'p', experimentResult: { supportsPrediction: 'x' as unknown as boolean, detail: 'd' } })],
  ]

  for (const [label, input] of abstainInputs) {
    it(`abstention (${label}) is 'abstained', never 'passed', and carries a reason`, () => {
      const r = adjudicate(input)
      expect(r.outcome).toBe('abstained')
      expect(r.outcome).not.toBe('passed')
      expect(typeof r.abstentionReason).toBe('string')
      expect(r.abstentionReason!.length).toBeGreaterThan(0)
      expect(r.reasonCode.startsWith('DSH_GATE_')).toBe(true)
    })
  }

  it('a passed outcome always requires real evidence (A votes meet threshold; B has an anchor; C experiment supports)', () => {
    // A: cannot pass without votes meeting the threshold
    expect(adjudicate(aInput([], CAL)).outcome).toBe('abstained') // no votes -> insufficient
    expect(adjudicate(aInput([vote('r1', 'support'), vote('r2', 'refute')], CAL)).outcome).toBe('blocked') // ambiguous -> not passed
    // B: cannot pass without an anchor
    expect(adjudicate(bInput([], { requireExternalAnchor: false })).outcome).toBe('abstained')
    // C: cannot pass without a supporting experiment
    expect(adjudicate(cInput({ prediction: 'p' })).outcome).toBe('abstained')
  })
})
