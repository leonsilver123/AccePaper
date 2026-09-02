import { describe, it, expect } from 'vitest'
import { STEP_BY_ID } from '../src/engine/steps.ts'
import type { GateVerdict, StepState, TrinityComponent } from '../src/engine/types.ts'
import {
  canStart,
  startStep,
  recordArtifact,
  submitGateVerdict,
  transition,
  rollback,
  isComplete,
} from '../src/engine/state-machine.ts'
import type { StepStore } from '../src/engine/state-machine.ts'

function freshStore(): StepStore {
  return new Map<string, StepState>()
}

/** A pseudo prior step that has "produced" the given artifact slugs. */
function producer(stepId: string, artifacts: Record<string, unknown>): StepState {
  return { stepId, status: 'passed', attempts: 1, artifacts, gateResults: {}, startedAt: 0, finishedAt: 0 }
}

function verdict(component: TrinityComponent, passed: boolean): GateVerdict {
  return { component, passed, evidence: 'e', rationale: 'r', timestamp: 0 }
}

describe('state-machine', () => {
  it('(a) canStart is false without inputs and startStep throws', () => {
    const store = freshStore()
    // A1-landscape consumes 'domain-direction', which nothing has produced.
    expect(canStart('A1-landscape', store)).toBe(false)
    expect(() => startStep('A1-landscape', store)).toThrow()
  })

  it('(b) recordArtifact fills inputs and startStep moves pending -> in_progress', () => {
    const store = freshStore()
    store.set('T0', producer('T0', { 'domain-direction': 'dir' }))
    expect(canStart('A1-landscape', store)).toBe(true)
    const st = startStep('A1-landscape', store)
    expect(st.status).toBe('in_progress')
    recordArtifact('A1-landscape', 'landscape-map', 'm', store)
    recordArtifact('A1-landscape', 'gap-list', 'g', store)
    // A2-claim consumes landscape-map + gap-list (now produced by A1).
    expect(canStart('A2-claim', store)).toBe(true)
  })

  it('(c) all gate verdicts passed -> passed', () => {
    const store = freshStore()
    store.set('T0', producer('T0', { 'domain-direction': 'd' }))
    startStep('A1-landscape', store)
    recordArtifact('A1-landscape', 'landscape-map', 'm', store)
    recordArtifact('A1-landscape', 'gap-list', 'g', store)
    transition('A1-landscape', 'gated', store)
    // A1 gate = ['B']
    expect(submitGateVerdict('A1-landscape', verdict('B', true), store)).toBe('passed')
    expect(isComplete('A1-landscape', store)).toBe(true)
  })

  it('(d) gate fail on a falsifiable C-step -> failed', () => {
    const store = freshStore()
    // A2-claim: gate ['A','C'], falsifiable non-null. inputs: landscape-map, gap-list.
    store.set('T0', producer('T0', { 'landscape-map': 'm', 'gap-list': 'g' }))
    startStep('A2-claim', store)
    recordArtifact('A2-claim', 'claim', 'c', store)
    recordArtifact('A2-claim', 'falsifiable-prediction', 'fp', store)
    transition('A2-claim', 'gated', store)
    submitGateVerdict('A2-claim', verdict('A', true), store)
    // C fails on a falsifiable step -> 'failed' (not 'blocked').
    expect(submitGateVerdict('A2-claim', verdict('C', false), store)).toBe('failed')
  })

  it('(e) gate fail on a non-falsifiable step -> blocked', () => {
    const store = freshStore()
    // A1-landscape: gate ['B'], falsifiable null.
    store.set('T0', producer('T0', { 'domain-direction': 'd' }))
    startStep('A1-landscape', store)
    recordArtifact('A1-landscape', 'landscape-map', 'm', store)
    recordArtifact('A1-landscape', 'gap-list', 'g', store)
    transition('A1-landscape', 'gated', store)
    expect(submitGateVerdict('A1-landscape', verdict('B', false), store)).toBe('blocked')
  })

  it('(f) rollback reverts to pending, clears gate/artifacts, downstream canStart false, re-runnable', () => {
    const store = freshStore()
    store.set('T0', producer('T0', { 'domain-direction': 'd' }))
    startStep('A1-landscape', store)
    recordArtifact('A1-landscape', 'landscape-map', 'm', store)
    recordArtifact('A1-landscape', 'gap-list', 'g', store)
    transition('A1-landscape', 'gated', store)
    submitGateVerdict('A1-landscape', verdict('B', true), store) // -> passed
    // A2 consumes A1's outputs.
    expect(canStart('A2-claim', store)).toBe(true)

    rollback('A1-landscape', store)
    const a1 = store.get('A1-landscape')
    expect(a1?.status).toBe('pending')
    expect(Object.keys(a1?.artifacts ?? {}).length).toBe(0)
    expect(Object.keys(a1?.gateResults ?? {}).length).toBe(0)
    // A1's outputs gone -> A2 can no longer start.
    expect(canStart('A2-claim', store)).toBe(false)
    // A1 itself is re-runnable (its input 'domain-direction' is still produced by T0).
    expect(canStart('A1-landscape', store)).toBe(true)
    startStep('A1-landscape', store)
  })

  it('(g) illegal transition throws', () => {
    const store = freshStore()
    store.set('T0', producer('T0', { 'domain-direction': 'd' }))
    startStep('A1-landscape', store)
    recordArtifact('A1-landscape', 'landscape-map', 'm', store)
    recordArtifact('A1-landscape', 'gap-list', 'g', store)
    transition('A1-landscape', 'gated', store)
    submitGateVerdict('A1-landscape', verdict('B', true), store) // -> passed
    // passed -> in_progress is illegal.
    expect(() => transition('A1-landscape', 'in_progress', store)).toThrow()
  })
})

// sanity: the step lookups used above are real steps in STEPS.
void STEP_BY_ID
