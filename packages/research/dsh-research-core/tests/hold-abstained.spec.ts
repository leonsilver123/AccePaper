import { afterEach, describe, expect, it } from 'vitest'
import {
  ResearchError,
  canStart,
  getAuditHistory,
  getRunSnapshot,
  isComplete,
  rollback,
  startStep,
  submitGateVerdict,
} from '../src/engine/state-machine.ts'
import { _resetApprovalChannelForTests, createHostApprovalChannel } from '../src/host.ts'
import type { HostApprovalChannel } from '../src/host.ts'
import { abstainVerdict, freshStore, passStep, seedRun, verdict } from './helpers.ts'

/**
 * T19 — hold_abstained freeze semantics (batch2-t19-hold-abstained-design.md).
 *
 * Drives step A2-claim (gate ['A','C'], non-humanGate, upstream A1-landscape) to a
 * `gated(holdReason='gate_abstained')` hold via an 'abstained' component outcome, then
 * asserts the six invariants + the humanGate guard. A2's downstream is A4-venue
 * (inputs ['claim','falsifiable-prediction']) — used for the downstream-canStart check.
 */

function driveAbstained(store: ReturnType<typeof freshStore>, stepId = 'A2-claim', abstainComp: 'A' | 'C' = 'C'): string {
  const id = seedRun(store)
  passStep(store, id, 'A1-landscape') // passed + records landscape-map/gap-list → unlocks A2
  expect(getRunSnapshot(store, id).steps['A1-landscape']?.status).toBe('passed')
  // A2-claim in_progress; submit one component passed, the other abstained → hold.
  startStep(store, id, stepId)
  submitGateVerdict(store, id, stepId, verdict('A', true))
  submitGateVerdict(store, id, stepId, abstainVerdict(abstainComp === 'A' ? 'A' : 'C'))
  return id
}

describe('T19 invariant 1 — held step is not complete (abstained → gated + holdReason)', () => {
  it('an abstained verdict holds the step at gated with holdReason=gate_abstained and isComplete()===false', () => {
    const store = freshStore()
    const id = driveAbstained(store)
    const snap = getRunSnapshot(store, id).steps['A2-claim']!
    expect(snap.status).toBe('gated')
    expect(snap.holdReason).toBe('gate_abstained')
    expect(isComplete(store, id, 'A2-claim')).toBe(false)
  })
  it('abstained is never passed — even if every other component passed', () => {
    const store = freshStore()
    const id = driveAbstained(store, 'A2-claim', 'C')
    expect(getRunSnapshot(store, id).steps['A2-claim']?.status).toBe('gated')
    expect(getRunSnapshot(store, id).steps['A2-claim']?.status).not.toBe('passed')
  })
})

describe('T19 invariant 2 — downstream cannot start while held', () => {
  it('A4-venue (downstream of A2) canStart is false while A2 is held by abstention', () => {
    const store = freshStore()
    const id = driveAbstained(store)
    expect(getRunSnapshot(store, id).steps['A2-claim']?.status).toBe('gated')
    expect(canStart(store, id, 'A4-venue')).toBe(false)
  })
})

describe('T19 invariant 3 — no automatic transition (stable gated, no step-completed)', () => {
  it('repeated snapshot reads stay gated and no step-completed event is emitted for the abstention', () => {
    const store = freshStore()
    const id = driveAbstained(store)
    for (let i = 0; i < 3; i++) {
      expect(getRunSnapshot(store, id).steps['A2-claim']?.status).toBe('gated')
    }
    // Scope to A2-claim: A1-landscape (driven by driveAbstained) legitimately emits its own
    // step-completed; the invariant is that the abstention hold itself emits NO step-completed.
    const a2Kinds = getRunSnapshot(store, id).events.filter(e => e.stepId === 'A2-claim').map(e => e.kind)
    expect(a2Kinds).toContain('gate-abstention')
    expect(a2Kinds).not.toContain('step-completed') // abstained hold never emits step-completed
  })
})

describe('T19 invariant 4 — abstained is stored verbatim (never compressed to passed:false)', () => {
  it('the stored verdict keeps outcome=abstained (passed stays false)', () => {
    const store = freshStore()
    const id = driveAbstained(store)
    const current = getAuditHistory(store, id, 'A2-claim').at(-1) as { gateResults: Record<string, { outcome: string; passed: boolean }> }
    expect(current.gateResults['C']?.outcome).toBe('abstained')
    expect(current.gateResults['C']?.passed).toBe(false)
  })
})

describe('T19 invariant 5 — same-attempt re-submission of an abstained component is rejected', () => {
  it('re-submitting the same component after abstention throws DSH_VERDICT_ALREADY_SET and keeps the verdict', () => {
    const store = freshStore()
    const id = driveAbstained(store) // A passed, C abstained
    expect(() => submitGateVerdict(store, id, 'A2-claim', abstainVerdict('C'))).toThrow(ResearchError)
    expect(() => submitGateVerdict(store, id, 'A2-claim', abstainVerdict('C'))).toThrow(/VERDICT_ALREADY_SET/)
    const current = getAuditHistory(store, id, 'A2-claim').at(-1) as { gateResults: Record<string, { outcome: string }> }
    expect(current.gateResults['C']?.outcome).toBe('abstained') // unchanged
  })
})

describe('T19 invariant 6 — abstention audit is retained across rollback (append-only)', () => {
  it('after rollback the gate-abstention record remains and references the superseded attempt', () => {
    const store = freshStore()
    const id = driveAbstained(store)
    const attemptBefore = getRunSnapshot(store, id).steps['A2-claim']!.attemptId
    rollback(store, id, 'A2-claim')
    const events = getRunSnapshot(store, id).events
    const abstentions = events.filter(e => e.kind === 'gate-abstention')
    expect(abstentions.length).toBe(1)
    const detail = abstentions[0]?.detail as {
      attemptId: number
      stepId: string
      component: string
      reasonCode: string
      evidenceRefs: readonly string[]
      recordedAt: string
    }
    expect(detail.stepId).toBe('A2-claim')
    expect(detail.component).toBe('C')
    expect(detail.reasonCode).toBe('gate_abstained')
    expect(detail.attemptId).toBe(attemptBefore)
    expect(Array.isArray(detail.evidenceRefs)).toBe(true)
    expect(typeof detail.recordedAt).toBe('string')
    const hist = getAuditHistory(store, id, 'A2-claim')
    expect((hist[0] as { superseded: boolean }).superseded).toBe(true)
    expect((hist[0] as { status: string }).status).toBe('gated')
  })
})

describe('T19 — abstained preempts any terminal (no default pass / no auto terminal)', () => {
  it('a mixed (passed + failed + abstained) adjudication holds at gated, not blocked/failed/passed', () => {
    const store = freshStore()
    const id = seedRun(store)
    passStep(store, id, 'A1-landscape')
    startStep(store, id, 'A2-claim')
    submitGateVerdict(store, id, 'A2-claim', verdict('A', false)) // fail
    submitGateVerdict(store, id, 'A2-claim', abstainVerdict('C')) // abstain → hold wins
    expect(getRunSnapshot(store, id).steps['A2-claim']?.status).toBe('gated')
    expect(getRunSnapshot(store, id).steps['A2-claim']?.holdReason).toBe('gate_abstained')
  })
})

describe('T19 — write boundary rejects verdicts missing a valid outcome (no silent reinterpretation)', () => {
  it('submitGateVerdict throws DSH_GATEVERDICT_MISSING_OUTCOME when outcome is absent', () => {
    const store = freshStore()
    const id = seedRun(store)
    passStep(store, id, 'A1-landscape')
    const bad = { component: 'B' as const, passed: true, evidence: 'e', rationale: 'r', timestamp: 1 } as never
    expect(() => submitGateVerdict(store, id, 'A1-landscape', bad)).toThrow(ResearchError)
    expect(() => submitGateVerdict(store, id, 'A1-landscape', bad)).toThrow(/GATEVERDICT_MISSING_OUTCOME/)
  })
})

describe('T19 — human approval cannot pass a gate_abstained hold (§6 guard)', () => {
  afterEach(() => _resetApprovalChannelForTests())
  function channelWithPrincipal(): HostApprovalChannel {
    const channel = createHostApprovalChannel('test-secret')
    channel.registerPrincipal('human-1')
    return channel
  }
  it('submit on a holdReason=gate_abstained step rejects with DSH_ABSTENTION_REQUIRES_ROLLBACK', () => {
    const store = freshStore()
    const id = driveAbstained(store) // A2-claim gated + holdReason gate_abstained
    const channel = channelWithPrincipal()
    const p = channel.mintPrincipal(id, 'A2-claim', 'human-1', 'evt-1')
    expect(() => channel.submit(store, id, 'A2-claim', 'approved', p)).toThrow(ResearchError)
    expect(() => channel.submit(store, id, 'A2-claim', 'approved', p)).toThrow(/ABSTENTION_REQUIRES_ROLLBACK/)
    expect(getRunSnapshot(store, id).steps['A2-claim']?.status).toBe('gated')
    expect(isComplete(store, id, 'A2-claim')).toBe(false)
  })
})
