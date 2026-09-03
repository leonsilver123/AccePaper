import { describe, expect, it } from 'vitest'
import { SEEDABLE_INPUTS, STEP_BY_ID, STEPS } from '../src/engine/steps.ts'
import {
  ResearchError,
  ResearchRunError,
  ResearchValueError,
  canStart,
  completeStep,
  createRun,
  getArtifact,
  getAuditHistory,
  getRunSnapshot,
  isComplete,
  recordArtifact,
  rollback,
  setRunInput,
  startIfCan,
  startStep,
  submitGateVerdict,
} from '../src/engine/state-machine.ts'
import * as Core from '../src/index.ts'
import { freshStore, passStep, runFullPipeline, seedRun, verdict } from './helpers.ts'

const anyCore = Core as Record<string, unknown>

describe('export surface — the main entry has NO trust capability (P0-1-H1/H2)', () => {
  it('does NOT export transition / approveHumanGate / submitHumanApproval / TrustedHumanPrincipal / _applyHumanApproval', () => {
    expect(anyCore.transition).toBeUndefined()
    expect(anyCore.approveHumanGate).toBeUndefined()
    expect(anyCore.submitHumanApproval).toBeUndefined()
    expect(anyCore.TrustedHumanPrincipal).toBeUndefined()
    expect(anyCore._applyHumanApproval).toBeUndefined()
    expect(anyCore.createHostApprovalChannel).toBeUndefined()
  })
  it('exports the hardened public API', () => {
    for (const fn of ['createRun', 'setRunInput', 'getRunSnapshot', 'getArtifact', 'canStart', 'startStep', 'startIfCan', 'recordArtifact', 'submitGateVerdict', 'completeStep', 'rollback', 'isComplete', 'getAuditHistory']) {
      expect(typeof anyCore[fn]).toBe('function')
    }
  })
})

describe('run lifecycle (INV-RUN-ISOLATION / INV-SEED-INPUT / INV-INPUT-FROZEN)', () => {
  it('createRun throws RUN_EXISTS on explicit runId collision (never clobbers state+audit)', () => {
    const store = freshStore()
    createRun(store, 'R1')
    expect(() => createRun(store, 'R1')).toThrow(ResearchRunError)
    expect(() => createRun(store, 'R1')).toThrow(/RUN_EXISTS/)
  })
  it('runId methods throw RUN_NOT_FOUND on missing run (never auto-create a RunState)', () => {
    const store = freshStore()
    expect(() => startStep(store, 'ghost', 'A1-landscape')).toThrow(ResearchRunError)
    expect(() => startStep(store, 'ghost', 'A1-landscape')).toThrow(/RUN_NOT_FOUND/)
    expect(() => canStart(store, 'ghost', 'A1-landscape')).toThrow(ResearchRunError)
  })
  it('setRunInput rejects non-seedable slugs (INV-SEED-INPUT)', () => {
    const store = freshStore()
    const id = createRun(store)
    expect(() => setRunInput(store, id, 'not-seedable', 'x')).toThrow(ResearchError)
  })
  it('setRunInput rejects undefined/null values (H9)', () => {
    const store = freshStore()
    const id = createRun(store)
    expect(() => setRunInput(store, id, 'domain-direction', undefined)).toThrow(ResearchError)
    expect(() => setRunInput(store, id, 'domain-direction', null)).toThrow(ResearchError)
  })
  it('setRunInput throws once the run has started (INV-INPUT-FROZEN)', () => {
    const store = freshStore()
    const id = seedRun(store)
    passStep(store, id, 'A1-landscape')
    expect(() => setRunInput(store, id, 'domain-direction', 'changed')).toThrow(ResearchError)
    expect(() => setRunInput(store, id, 'domain-direction', 'changed')).toThrow(/INPUT_FROZEN/)
  })
  it('createRun + setRunInput lets A1 canStart from empty state (no fake T0 step — P1-6)', () => {
    const store = freshStore()
    const id = seedRun(store)
    expect(canStart(store, id, 'A1-landscape')).toBe(true)
  })
})

describe('INV-DEP-PASSED — downstream canStart requires an upstream `passed` (P1-1)', () => {
  it('an in_progress upstream that recorded artifacts does NOT unlock downstream', () => {
    const store = freshStore()
    const id = seedRun(store)
    startStep(store, id, 'A1-landscape')
    recordArtifact(store, id, 'A1-landscape', 'landscape-map', 'm')
    recordArtifact(store, id, 'A1-landscape', 'gap-list', 'g')
    expect(getRunSnapshot(store, id).steps['A1-landscape']?.status).toBe('in_progress')
    expect(canStart(store, id, 'A2-claim')).toBe(false)
  })
  it('a passed upstream unlocks downstream', () => {
    const store = freshStore()
    const id = seedRun(store)
    passStep(store, id, 'A1-landscape')
    expect(canStart(store, id, 'A2-claim')).toBe(true)
  })
  it('startIfCan is atomic: null when not startable, snapshot when startable (C-9)', () => {
    const store = freshStore()
    const id = seedRun(store)
    expect(startIfCan(store, id, 'A2-claim')).toBeNull()
    const snap = startIfCan(store, id, 'A1-landscape')
    expect(snap).not.toBeNull()
    expect(snap?.status).toBe('in_progress')
  })
})

describe('INV-OUTPUT-CONTRACT — recordArtifact validates slug ∈ step.outputs (P1-2)', () => {
  it('rejects an unknown slug', () => {
    const store = freshStore()
    const id = seedRun(store)
    startStep(store, id, 'A1-landscape')
    expect(() => recordArtifact(store, id, 'A1-landscape', 'bogus', 'x')).toThrow(ResearchError)
    expect(() => recordArtifact(store, id, 'A1-landscape', 'bogus', 'x')).toThrow(/OUTPUT_NOT_DECLARED/)
  })
  it('rejects another step output slug', () => {
    const store = freshStore()
    const id = seedRun(store)
    startStep(store, id, 'A1-landscape')
    expect(() => recordArtifact(store, id, 'A1-landscape', 'claim', 'x')).toThrow(ResearchError)
  })
  it('accepts a duplicate override (registry replaces fresh, invalidated=false)', () => {
    const store = freshStore()
    const id = seedRun(store)
    startStep(store, id, 'A1-landscape')
    recordArtifact(store, id, 'A1-landscape', 'landscape-map', 'v1')
    recordArtifact(store, id, 'A1-landscape', 'landscape-map', 'v2')
    expect(getArtifact(store, id, 'landscape-map')).toBe('v2')
  })
  it('throws if the step is not in_progress', () => {
    const store = freshStore()
    const id = seedRun(store)
    expect(() => recordArtifact(store, id, 'A1-landscape', 'landscape-map', 'm')).toThrow(ResearchError)
  })
})

describe('gate adjudication (INV-GATE-COMPONENT / INV-VERDICT-STATUS / INV-VERDICT-IMMUTABLE / INV-COMPLETESTEP-EMPTY)', () => {
  it('submitGateVerdict rejects a component not in step.gate (INV-GATE-COMPONENT)', () => {
    const store = freshStore()
    const id = seedRun(store)
    passStep(store, id, 'A1-landscape')
    startStep(store, id, 'A2-claim') // gate ['A','C']
    recordArtifact(store, id, 'A2-claim', 'claim', 'c')
    recordArtifact(store, id, 'A2-claim', 'falsifiable-prediction', 'fp')
    expect(() => submitGateVerdict(store, id, 'A2-claim', verdict('B', true))).toThrow(ResearchError)
    expect(() => submitGateVerdict(store, id, 'A2-claim', verdict('B', true))).toThrow(/GATE_COMPONENT_NOT_DECLARED/)
  })
  it('submitGateVerdict throws on an empty-gate step (use completeStep)', () => {
    const store = freshStore()
    const id = runFullPipeline(store) // E2 gated
    rollback(store, id, 'E2-submit') // → pending
    startStep(store, id, 'E2-submit')
    recordArtifact(store, id, 'E2-submit', 'submission-record', 'sr')
    expect(() => submitGateVerdict(store, id, 'E2-submit', verdict('A', true))).toThrow(ResearchError)
    expect(() => submitGateVerdict(store, id, 'E2-submit', verdict('A', true))).toThrow(/EMPTY_GATE/)
  })
  it('submitGateVerdict throws unless status===in_progress (INV-VERDICT-STATUS)', () => {
    const store = freshStore()
    const id = seedRun(store)
    passStep(store, id, 'A1-landscape') // passed
    expect(() => submitGateVerdict(store, id, 'A1-landscape', verdict('B', true))).toThrow(ResearchError)
    expect(() => submitGateVerdict(store, id, 'A1-landscape', verdict('B', true))).toThrow(/VERDICT_BAD_STATUS/)
  })
  it('submitGateVerdict rejects a second verdict for the same component (INV-VERDICT-IMMUTABLE)', () => {
    const store = freshStore()
    const id = seedRun(store)
    passStep(store, id, 'A1-landscape')
    startStep(store, id, 'A2-claim') // gate ['A','C']
    recordArtifact(store, id, 'A2-claim', 'claim', 'c')
    recordArtifact(store, id, 'A2-claim', 'falsifiable-prediction', 'fp')
    submitGateVerdict(store, id, 'A2-claim', verdict('A', true)) // A in, C missing → in_progress
    expect(() => submitGateVerdict(store, id, 'A2-claim', verdict('A', true))).toThrow(ResearchError)
    expect(() => submitGateVerdict(store, id, 'A2-claim', verdict('A', true))).toThrow(/VERDICT_ALREADY_SET/)
  })
  it('all-pass on a falsifiable C-step → passed; C-fail → failed; other fail → blocked (INV-ADJUDICATE-SHARED)', () => {
    const store = freshStore()
    const id = seedRun(store)
    passStep(store, id, 'A1-landscape')
    // A2: gate ['A','C'], falsifiable non-null
    startStep(store, id, 'A2-claim')
    recordArtifact(store, id, 'A2-claim', 'claim', 'c')
    recordArtifact(store, id, 'A2-claim', 'falsifiable-prediction', 'fp')
    submitGateVerdict(store, id, 'A2-claim', verdict('A', true))
    expect(submitGateVerdict(store, id, 'A2-claim', verdict('C', true))).toBe('passed') // all-pass, non-humanGate
    // fresh A2 with a C-fail → failed (refutation)
    rollback(store, id, 'A2-claim')
    startStep(store, id, 'A2-claim')
    recordArtifact(store, id, 'A2-claim', 'claim', 'c2')
    recordArtifact(store, id, 'A2-claim', 'falsifiable-prediction', 'fp2')
    submitGateVerdict(store, id, 'A2-claim', verdict('A', true))
    expect(submitGateVerdict(store, id, 'A2-claim', verdict('C', false))).toBe('failed')
    // fresh A2 with an A-fail (non-C component) → blocked (adjudication fires only when ALL gate components are in)
    rollback(store, id, 'A2-claim')
    startStep(store, id, 'A2-claim')
    recordArtifact(store, id, 'A2-claim', 'claim', 'c3')
    recordArtifact(store, id, 'A2-claim', 'falsifiable-prediction', 'fp3')
    submitGateVerdict(store, id, 'A2-claim', verdict('A', false)) // A-fail, C missing → in_progress (no adjudication yet)
    expect(submitGateVerdict(store, id, 'A2-claim', verdict('C', true))).toBe('blocked') // all in, A-fail non-C → blocked
  })
  it('completeStep throws on a non-empty-gate step (INV-COMPLETESTEP-EMPTY)', () => {
    const store = freshStore()
    const id = seedRun(store)
    startStep(store, id, 'A1-landscape') // gate ['B']
    expect(() => completeStep(store, id, 'A1-landscape')).toThrow(ResearchError)
    expect(() => completeStep(store, id, 'A1-landscape')).toThrow(/NON_EMPTY_GATE/)
  })
  it('completeStep throws unless status===in_progress (C-7 idempotency)', () => {
    const store = freshStore()
    const id = runFullPipeline(store) // E2 gated via completeStep
    expect(() => completeStep(store, id, 'E2-submit')).toThrow(ResearchError) // gated not in_progress
    expect(() => completeStep(store, id, 'E2-submit')).toThrow(/COMPLETE_BAD_STATUS/)
  })
})

describe('INV-SNAPSHOT — returns are deep clones (mutating a return does not change internal)', () => {
  it('mutating a startStep snapshot does not change internal state', () => {
    const store = freshStore()
    const id = seedRun(store)
    const snap = startStep(store, id, 'A1-landscape')
    ;(snap as { status: string }).status = 'passed'
    ;(snap.artifacts as Record<string, unknown>).injected = true
    expect(getRunSnapshot(store, id).steps['A1-landscape']?.status).toBe('in_progress')
    expect('injected' in (getRunSnapshot(store, id).steps['A1-landscape']?.artifacts as Record<string, unknown>)).toBe(false)
  })
  it('mutating a getAuditHistory return does not change internal history', () => {
    const store = freshStore()
    const id = seedRun(store)
    passStep(store, id, 'A1-landscape')
    rollback(store, id, 'A1-landscape')
    const hist = getAuditHistory(store, id, 'A1-landscape')
    ;(hist[0] as { artifacts: Record<string, unknown> }).artifacts['injected'] = true
    const hist2 = getAuditHistory(store, id, 'A1-landscape')
    expect('injected' in (hist2[0] as { artifacts: Record<string, unknown> }).artifacts).toBe(false)
  })
  it('mutating a getRunSnapshot return does not change internal', () => {
    const store = freshStore()
    const id = seedRun(store)
    passStep(store, id, 'A1-landscape')
    const snap = getRunSnapshot(store, id)
    ;(snap.inputs as Record<string, unknown>)['domain-direction'] = 'forged'
    expect((getRunSnapshot(store, id).inputs as Record<string, unknown>)['domain-direction']).toBe('ML')
  })
})

describe('INV-WRITE-ISOLATION — caller values are deep-cloned at write time (HOLE-1/H1)', () => {
  it('mutating an object passed to recordArtifact after the call does not change internal', () => {
    const store = freshStore()
    const id = seedRun(store)
    startStep(store, id, 'A1-landscape')
    const obj = { k: 'v' }
    recordArtifact(store, id, 'A1-landscape', 'landscape-map', obj)
    obj.k = 'forged'
    expect(getArtifact(store, id, 'landscape-map')).toEqual({ k: 'v' })
  })
  it('mutating an object passed to setRunInput after the call does not change internal', () => {
    const store = freshStore()
    const id = createRun(store)
    const obj = { d: 'ML' }
    setRunInput(store, id, 'domain-direction', obj)
    obj.d = 'forged'
    expect((getRunSnapshot(store, id).inputs as Record<string, unknown>)['domain-direction']).toEqual({ d: 'ML' })
  })
  it('mutating a verdict object after submitGateVerdict does not change internal', () => {
    const store = freshStore()
    const id = seedRun(store)
    startStep(store, id, 'A1-landscape')
    recordArtifact(store, id, 'A1-landscape', 'landscape-map', 'm')
    const v = verdict('B', true)
    submitGateVerdict(store, id, 'A1-landscape', v)
    ;(v as unknown as { passed: boolean }).passed = false
    const current = getAuditHistory(store, id, 'A1-landscape').at(-1) as { gateResults: Record<string, { passed: boolean }> }
    expect(current.gateResults['B']?.passed).toBe(true)
  })
})

describe('INV-VALUE-CLONEABLE — non-cloneable values rejected at the write boundary (HOLE-2/H6)', () => {
  it('recordArtifact with a function value throws DSH_VALUE_NOT_CLONEABLE', () => {
    const store = freshStore()
    const id = seedRun(store)
    startStep(store, id, 'A1-landscape')
    expect(() => recordArtifact(store, id, 'A1-landscape', 'landscape-map', () => 1)).toThrow(ResearchValueError)
  })
  it('setRunInput with a function value throws', () => {
    const store = freshStore()
    const id = createRun(store)
    expect(() => setRunInput(store, id, 'domain-direction', () => 1)).toThrow(ResearchValueError)
  })
})

describe('INV-CASCADE — rollback transitively invalidates downstream (P1-7)', () => {
  it('rollback of a passed upstream resets direct downstream to pending + invalidates artifacts', () => {
    const store = freshStore()
    const id = seedRun(store)
    passStep(store, id, 'A1-landscape')
    passStep(store, id, 'A2-claim')
    rollback(store, id, 'A1-landscape')
    expect(getRunSnapshot(store, id).steps['A1-landscape']?.status).toBe('pending')
    expect(getRunSnapshot(store, id).steps['A2-claim']?.status).toBe('pending')
    expect(getArtifact(store, id, 'landscape-map')).toBeUndefined()
    expect(getArtifact(store, id, 'claim')).toBeUndefined()
  })
  it('multi-hop: rollback(A1) resets every transitive dependent to pending (full closure — DEP-2)', () => {
    const store = freshStore()
    const id = runFullPipeline(store)
    rollback(store, id, 'A1-landscape')
    const snap = getRunSnapshot(store, id)
    for (const s of STEPS) {
      if (s.id === 'A1-landscape') continue
      expect(snap.steps[s.id]?.status ?? 'pending').toBe('pending')
    }
  })
  it('diamond: rollback(A2) snapshots each dependent exactly once (A4 reached via 2 paths — DEP-3)', () => {
    const store = freshStore()
    const id = runFullPipeline(store)
    const before = getAuditHistory(store, id, 'A4-venue').length
    rollback(store, id, 'A2-claim') // A2→A4 (claim) AND A2→A3→A4 (agenda)
    const after = getAuditHistory(store, id, 'A4-venue').length
    expect(after - before).toBe(1) // exactly one snapshot, not two
  })
  it('rollback preserves each downstream prior-attempt history snapshot (C-4/DEP-5)', () => {
    const store = freshStore()
    const id = seedRun(store)
    passStep(store, id, 'A1-landscape')
    passStep(store, id, 'A2-claim')
    rollback(store, id, 'A1-landscape')
    const hist = getAuditHistory(store, id, 'A2-claim')
    expect(hist.length).toBe(2) // [superseded A2, current pending A2]
    expect((hist[0] as { superseded: boolean }).superseded).toBe(true)
    expect((hist.at(-1) as { status: string }).status).toBe('pending')
  })
  it('re-run after cascade clears the invalidated flag (DEP-4 — recordArtifact replaces fresh)', () => {
    const store = freshStore()
    const id = seedRun(store)
    passStep(store, id, 'A1-landscape')
    rollback(store, id, 'A1-landscape')
    expect(getArtifact(store, id, 'landscape-map')).toBeUndefined()
    passStep(store, id, 'A1-landscape')
    expect(getArtifact(store, id, 'landscape-map')).toBe('val:landscape-map')
    expect(canStart(store, id, 'A2-claim')).toBe(true)
  })
  it('rollback is a no-op on a never-started / pending step (no bogus history — DEP-6)', () => {
    const store = freshStore()
    const id = seedRun(store) // A1 pending (never started)
    expect(() => rollback(store, id, 'A1-landscape')).not.toThrow()
    expect(getAuditHistory(store, id, 'A1-landscape')).toEqual([])
  })
  it('rollback applies to terminal states (failed → pending → re-runnable — INV-FAILED-RERUN)', () => {
    const store = freshStore()
    const id = seedRun(store)
    passStep(store, id, 'A1-landscape')
    startStep(store, id, 'A2-claim') // gate ['A','C'], falsifiable non-null
    recordArtifact(store, id, 'A2-claim', 'claim', 'c')
    recordArtifact(store, id, 'A2-claim', 'falsifiable-prediction', 'fp')
    submitGateVerdict(store, id, 'A2-claim', verdict('A', true))
    expect(submitGateVerdict(store, id, 'A2-claim', verdict('C', false))).toBe('failed')
    rollback(store, id, 'A2-claim')
    expect(getRunSnapshot(store, id).steps['A2-claim']?.status).toBe('pending')
    expect(canStart(store, id, 'A2-claim')).toBe(true)
  })
})

describe('INV-RUN-ISOLATION — runs share nothing (P1-5)', () => {
  it('an artifact recorded in R1 is invisible to R2 canStart', () => {
    const store = freshStore()
    const r1 = seedRun(store, 'R1')
    const r2 = seedRun(store, 'R2')
    passStep(store, r1, 'A1-landscape')
    expect(canStart(store, r2, 'A2-claim')).toBe(false)
    passStep(store, r2, 'A1-landscape')
    expect(canStart(store, r2, 'A2-claim')).toBe(true)
  })
})

describe('INV-AUDIT-APPEND / INV-EVENTS-IMMUTABLE (C-1, HOLE-3, H7)', () => {
  it('a full lifecycle + rollback emits every expected event kind', () => {
    const store = freshStore()
    const id = seedRun(store)
    passStep(store, id, 'A1-landscape')
    rollback(store, id, 'A1-landscape')
    const kinds = getRunSnapshot(store, id).events.map(e => e.kind)
    for (const k of ['run-created', 'input-seeded', 'step-started', 'artifact-recorded', 'gate-verdict', 'step-completed', 'rollback']) {
      expect(kinds).toContain(k)
    }
  })
  it('the events array is append-only (never shrinks across actions)', () => {
    const store = freshStore()
    const id = seedRun(store)
    passStep(store, id, 'A1-landscape')
    const before = getRunSnapshot(store, id).events.length
    passStep(store, id, 'A2-claim')
    const after = getRunSnapshot(store, id).events.length
    expect(after).toBeGreaterThan(before)
  })
  it('mutating a returned event does not change internal events (INV-EVENTS-IMMUTABLE)', () => {
    const store = freshStore()
    const id = seedRun(store)
    passStep(store, id, 'A1-landscape')
    const snap = getRunSnapshot(store, id)
    const firstKind = snap.events[0]?.kind
    // Mutate the returned (cloned) events entry; the internal audit log must be unchanged.
    const mutEvents = snap.events as unknown as { kind: string }[]
    const e0 = mutEvents[0]
    if (e0) e0.kind = 'forged'
    expect(getRunSnapshot(store, id).events[0]?.kind).toBe(firstKind)
  })
})

describe('INV-COMPLETE-ATTEMPT — isComplete requires a current-attempt approved approval for humanGate (H8)', () => {
  it('after rollback+rerun, isComplete is false until re-approved (approval cleared on rollback)', () => {
    const store = freshStore()
    const id = runFullPipeline(store) // E2 gated, not complete
    expect(isComplete(store, id, 'E2-submit')).toBe(false) // gated, no approval
    // (approved/rejected + re-run path covered in host.spec.ts via HostApprovalChannel)
  })
  it('a non-humanGate passed step is complete', () => {
    const store = freshStore()
    const id = seedRun(store)
    passStep(store, id, 'A1-landscape')
    expect(isComplete(store, id, 'A1-landscape')).toBe(true)
  })
})

describe('DAG assertion (DEP-9)', () => {
  it('SEEDABLE_INPUTS contains domain-direction', () => {
    expect(SEEDABLE_INPUTS).toContain('domain-direction')
  })
  it('the step graph loaded without throwing (acyclic — computeTransitiveDependents terminates)', () => {
    // Importing steps.ts runs assertDagAndSeedSeparation at module load; reaching here means it passed.
    expect(STEP_BY_ID.size).toBe(16)
  })
})

describe('RC-A / RC-D — adversarial-verify fixes (deep-frozen step defs; rollback→reseed blocked)', () => {
  it('RC-A: step definitions are deep-frozen — mutating step.humanGate throws TypeError', () => {
    const step = STEP_BY_ID.get('E2-submit')
    expect(step).toBeDefined()
    // Frozen in strict mode (ESM): assignment to a read-only property throws TypeError,
    // so `STEP_BY_ID.get('E2-submit').humanGate = false` cannot silently bypass completeStep/_apply.
    expect(() => { (step as { humanGate: boolean }).humanGate = false }).toThrow(TypeError)
  })
  it('RC-A: mutating step.gate / step.inputs throws (cannot empty a gate or inputs array)', () => {
    const step = STEP_BY_ID.get('A2-claim')
    expect(step).toBeDefined()
    expect(() => { (step as unknown as { gate: string[] }).gate = [] }).toThrow(TypeError)
    expect(() => { (step as unknown as { gate: string[] }).gate.push('X') }).toThrow(TypeError)
    expect(() => { (step as unknown as { inputs: string[] }).inputs = [] }).toThrow(TypeError)
  })
  it('RC-A: the main entry does NOT re-export the mutable step singletons (no import path to mutate them)', () => {
    expect(anyCore.STEPS).toBeUndefined()
    expect(anyCore.STEP_BY_ID).toBeUndefined()
    expect(anyCore.stepsByPhase).toBeUndefined()
    expect(anyCore.TRINITY_LABEL).toBeUndefined()
    expect(anyCore.SEEDABLE_INPUTS).toBeUndefined()
    expect(anyCore.assertDagAndSeedSeparation).toBeUndefined()
  })
  it('RC-D: startStep→rollback→setRunInput throws INPUT_FROZEN (rollback does not re-open seeding)', () => {
    const store = freshStore()
    const id = seedRun(store)
    passStep(store, id, 'A1-landscape') // A1 passed (attempts=1)
    rollback(store, id, 'A1-landscape') // A1 status→pending, but attempts still 1
    expect(getRunSnapshot(store, id).steps['A1-landscape']?.status).toBe('pending')
    // The frozen-input guard now checks attempts (not just status) — re-seeding is blocked.
    expect(() => setRunInput(store, id, 'domain-direction', 'changed')).toThrow(ResearchError)
    expect(() => setRunInput(store, id, 'domain-direction', 'changed')).toThrow(/INPUT_FROZEN/)
  })
})

describe('RC-E / RC-F — adversarial-verify re-verify fixes (getter-proof verdict immutability; WeakSet principal identity)', () => {
  // Target step A2-claim: gate ['A','C'], falsifiable non-null, non-humanGate. A=false → anyFail,
  // comp A (not C) → not cFailOnFalsifiable → 'blocked'; A=true,C=true → noFail → 'passed'.
  // So overwriting an A=false verdict to A=true flips adjudication blocked→passed (the RC-F bypass).
  function setupA2(store: ReturnType<typeof freshStore>): string {
    const id = seedRun(store)
    passStep(store, id, 'A1-landscape') // A1 passed (gate B) → unlocks A2 inputs
    startStep(store, id, 'A2-claim')
    recordArtifact(store, id, 'A2-claim', 'claim', 'c1')
    recordArtifact(store, id, 'A2-claim', 'falsifiable-prediction', 'fp1')
    return id
  }

  it('RC-F (#8): a getter-bearing verdict returning a different component per read CANNOT overwrite an existing verdict', () => {
    const store = freshStore()
    const id = setupA2(store)
    // Honest A=false verdict (adjudication waits for C). gateResults = { A: { passed: false } }.
    expect(submitGateVerdict(store, id, 'A2-claim', verdict('A', false))).toBe('in_progress')
    // TRICK: a verdict whose `component` getter returns 'A' on read#1 (gate indexOf), 'C' on
    // read#2 (immutability `in`-check — 'C' not in {A} → no DSH_VERDICT_ALREADY_SET throw), then
    // 'A' on read#3 (storage key → OVERWRITES gateResults['A'] to passed=true). Pre-RC-F the
    // function read `verdict.component` four times via live property access, so this flipped
    // adjudication blocked→passed. Post-RC-F `component` is read ONCE into a local; the
    // immutability check sees the SAME 'A' that is already in gateResults → throws
    // DSH_VERDICT_ALREADY_SET — the overwrite is blocked (INV-VERDICT-IMMUTABLE).
    const makeTrick = () => {
      let n = 0
      return { get component() { n++; return n === 2 ? 'C' : 'A' }, passed: true, evidence: 'e', rationale: 'r', timestamp: 1 } as unknown as ReturnType<typeof verdict>
    }
    expect(() => submitGateVerdict(store, id, 'A2-claim', makeTrick())).toThrow(ResearchError)
    expect(() => submitGateVerdict(store, id, 'A2-claim', makeTrick())).toThrow(/VERDICT_ALREADY_SET/)
    // The trick did NOT overwrite A (A2 still in_progress, not adjudicated to 'passed').
    expect(getRunSnapshot(store, id).steps['A2-claim']?.status).toBe('in_progress')
    // Honest C=true → adjudicate: A=false (anyFail; A is not C → not cFailOnFalsifiable) → 'blocked'.
    expect(submitGateVerdict(store, id, 'A2-claim', verdict('C', true))).toBe('blocked')
    expect(getRunSnapshot(store, id).steps['A2-claim']?.status).toBe('blocked')
  })

  it('RC-F (#9): a submitted verdict is immutable per attempt; rollback+restart re-opens adjudication', () => {
    const store = freshStore()
    const id = setupA2(store)
    // Submit A=true (in_progress; C still missing).
    expect(submitGateVerdict(store, id, 'A2-claim', verdict('A', true))).toBe('in_progress')
    // Re-submitting the SAME component in the SAME attempt is rejected (immutable — cannot
    // mutate A=true to A=false to flip adjudication).
    expect(() => submitGateVerdict(store, id, 'A2-claim', verdict('A', false))).toThrow(ResearchError)
    expect(() => submitGateVerdict(store, id, 'A2-claim', verdict('A', false))).toThrow(/VERDICT_ALREADY_SET/)
    // Submit C → adjudicate (A=true, C=true → noFail → 'passed', non-humanGate).
    expect(submitGateVerdict(store, id, 'A2-claim', verdict('C', true))).toBe('passed')
    expect(getRunSnapshot(store, id).steps['A2-claim']?.status).toBe('passed')
    // A NEW attempt re-opens adjudication: rollback resets gateResults (resetStep), restart advances the attempt.
    rollback(store, id, 'A2-claim') // → pending (attempts preserved; gateResults reset)
    startStep(store, id, 'A2-claim') // attempt 2 → in_progress
    recordArtifact(store, id, 'A2-claim', 'claim', 'c2')
    recordArtifact(store, id, 'A2-claim', 'falsifiable-prediction', 'fp2')
    // Re-submitting A is now allowed (fresh attempt — gateResults is empty).
    expect(submitGateVerdict(store, id, 'A2-claim', verdict('A', false))).toBe('in_progress')
    expect(submitGateVerdict(store, id, 'A2-claim', verdict('C', true))).toBe('blocked') // A=false → blocked
  })

  it('RC-F (#snapshot): a polymorphic-getter verdict cannot desync the storage key from the stored object\'s internal component (single-snapshot)', () => {
    const store = freshStore()
    const id = setupA2(store) // A2-claim in_progress, gate ['A','C']; gateResults empty
    // TRICK: component getter returns 'A' on read#1, 'C' on read#2, 'A' on read#3.
    // Pre-snapshot-fix: local `component`='A' (read#1) → storage KEY 'A'; cloneValue(verdict)
    // invoked the getter at read#2 → stored OBJECT.component='C'. Mismatch: key A, object C,
    // and the audit event carried component='A' for a C-valued object. Single-snapshot clones
    // FIRST (getter read#1 → 'A' stored as a data property), then reads snapshot.component for
    // the key, the stored object, AND the audit — all 'A' → consistent (INV-VERDICT-SNAPSHOT).
    const makeTrick = () => {
      let n = 0
      return {
        get component() { n++; return n === 2 ? 'C' : 'A' },
        passed: true, evidence: 'e', rationale: 'r', timestamp: 1,
      } as unknown as ReturnType<typeof verdict>
    }
    // A is NOT yet in gateResults (first submission), so this proceeds to storage (unlike #8,
    // which pre-seeds A and expects ALREADY_SET). The single-snapshot fix makes key==object.
    expect(submitGateVerdict(store, id, 'A2-claim', makeTrick())).toBe('in_progress')
    // The stored verdict's internal component MUST equal the storage key (no A-key/C-object).
    const current = getAuditHistory(store, id, 'A2-claim').at(-1) as { gateResults: Record<string, { component: string; passed: boolean }> }
    expect(Object.keys(current.gateResults)).toEqual(['A'])
    expect(current.gateResults['A']?.component).toBe('A')
    // Honest C=true → adjudicate (A=true no fail, C=true no fail → 'passed', non-humanGate).
    expect(submitGateVerdict(store, id, 'A2-claim', verdict('C', true))).toBe('passed')
  })

  it('RC-F (#key-value): the gateResults storage key, the stored verdict\'s internal component, and the audit event component are all the same single value', () => {
    const store = freshStore()
    const id = setupA2(store) // A2-claim gate ['A','C']
    expect(submitGateVerdict(store, id, 'A2-claim', verdict('A', true))).toBe('in_progress')
    // Single-snapshot: storage key === stored object.component === audit event detail.component.
    const snap = getRunSnapshot(store, id)
    const a2 = snap.steps['A2-claim'] as { gateResults: Record<string, { component: string; passed: boolean }> }
    expect(Object.keys(a2.gateResults)).toEqual(['A'])
    expect(a2.gateResults['A']?.component).toBe('A')
    const gateEvent = snap.events.find(e => e.kind === 'gate-verdict' && e.stepId === 'A2-claim') as { detail?: { component: string; passed: boolean } }
    expect(gateEvent?.detail?.component).toBe('A')
    expect(gateEvent?.detail?.passed).toBe(true)
  })
})
