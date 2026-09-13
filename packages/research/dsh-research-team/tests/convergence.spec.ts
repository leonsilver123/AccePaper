// @deepseek-ai/dsh-research-team — C2-trinity-loop convergence decision.
//
// One test per rule of ../src/runner/convergence.ts, in the documented severity
// order, plus the fail-closed cases this project treats as load-bearing: an
// abstained channel outranks a failed one, an incomplete verdict set never
// converges, and an empty verdict set never converges.

import { describe, expect, it } from 'vitest'

import { evaluateConvergence, summarizeConvergence } from '../src/runner/convergence.ts'
import type { ChannelVerdict, ConvergenceState } from '../src/runner/convergence.ts'

type Component = ChannelVerdict['component']
type Outcome = ChannelVerdict['outcome']

const v = (component: Component, outcome: Outcome): ChannelVerdict => ({ component, outcome })

const passed = (component: Component): ChannelVerdict => v(component, 'passed')

describe('evaluateConvergence — rule 1: any abstained channel holds', () => {
  it('holds when one channel abstained and the other two passed', () => {
    const state = evaluateConvergence([passed('A'), v('B', 'abstained'), passed('C')])
    expect(state.kind).toBe('held')
    expect(state).toMatchObject({ component: 'B' })
    expect(state.basis).toContain('abstained')
    expect(state.basis).toContain('never a pass')
  })

  it('holds a fully abstained set rather than passing it', () => {
    const state = evaluateConvergence([v('A', 'abstained'), v('B', 'abstained'), v('C', 'abstained')])
    expect(state.kind).toBe('held')
    expect(state).toMatchObject({ component: 'A' })
  })

  it('outranks a failed channel (abstained is the strongest signal)', () => {
    const state = evaluateConvergence([v('A', 'failed'), v('B', 'abstained'), passed('C')])
    expect(state.kind).toBe('held')
    expect(state).toMatchObject({ component: 'B' })
  })

  it('outranks a blocked channel', () => {
    const state = evaluateConvergence([v('A', 'blocked'), passed('B'), v('C', 'abstained')])
    expect(state.kind).toBe('held')
    expect(state).toMatchObject({ component: 'C' })
  })
})

describe('evaluateConvergence — rule 2: any failed channel refutes', () => {
  it('refutes when one channel failed and the other two passed', () => {
    const state = evaluateConvergence([passed('A'), v('B', 'failed'), passed('C')])
    expect(state.kind).toBe('refuted')
    expect(state).toMatchObject({ component: 'B' })
    expect(state.basis).toContain('failed')
  })

  it('outranks a blocked channel', () => {
    const state = evaluateConvergence([v('A', 'blocked'), passed('B'), v('C', 'failed')])
    expect(state.kind).toBe('refuted')
    expect(state).toMatchObject({ component: 'C' })
  })

  it('outranks an incomplete verdict set', () => {
    const state = evaluateConvergence([v('B', 'failed')])
    expect(state.kind).toBe('refuted')
    expect(state).toMatchObject({ component: 'B' })
  })
})

describe('evaluateConvergence — rule 3: blocked or absent is pending, never a pass', () => {
  it('is pending, not converged, when one channel blocked', () => {
    const state = evaluateConvergence([passed('A'), passed('B'), v('C', 'blocked')])
    expect(state.kind).toBe('pending')
    expect(state.basis).toContain('rework required')
    expect(state.basis).toContain('C')
    // A blocked channel has a verdict; it is named in the basis, not in `missing`.
    expect(state.kind === 'pending' && state.missing).toEqual([])
  })

  it('lists the blocked channel in canonical order when several blocked', () => {
    const state = evaluateConvergence([v('C', 'blocked'), v('A', 'blocked'), passed('B')])
    expect(state.kind).toBe('pending')
    expect(state.basis).toContain('channel(s) A, C blocked')
  })

  it('is pending, not converged, when a channel has no verdict at all', () => {
    const onlyA = evaluateConvergence([passed('A')])
    expect(onlyA.kind).toBe('pending')
    expect(onlyA.kind === 'pending' && onlyA.missing).toEqual(['B', 'C'])

    const withoutB = evaluateConvergence([passed('A'), passed('C')])
    expect(withoutB.kind).toBe('pending')
    expect(withoutB.kind === 'pending' && withoutB.missing).toEqual(['B'])

    const withoutC = evaluateConvergence([passed('A'), passed('B')])
    expect(withoutC.kind).toBe('pending')
    expect(withoutC.kind === 'pending' && withoutC.missing).toEqual(['C'])
  })

  it('is pending, not converged, for an empty verdict set', () => {
    const state = evaluateConvergence([])
    expect(state.kind).toBe('pending')
    expect(state.kind === 'pending' && state.missing).toEqual(['A', 'B', 'C'])
    expect(state.basis).toContain('absent is not a pass')
  })

  it('reports blocked and absent channels together', () => {
    const state = evaluateConvergence([passed('A'), v('B', 'blocked')])
    expect(state.kind).toBe('pending')
    expect(state.kind === 'pending' && state.missing).toEqual(['C'])
    expect(state.basis).toContain('channel(s) B blocked')
    expect(state.basis).toContain('no verdict for channel(s) C')
  })

  it('ignores verdicts for a channel left absent by a repeat', () => {
    const state = evaluateConvergence([passed('A'), passed('A'), passed('B')])
    expect(state.kind).toBe('pending')
    expect(state.kind === 'pending' && state.missing).toEqual(['C'])
  })
})

describe('evaluateConvergence — rule 4: converged needs all three passed', () => {
  it('converges when every channel passed', () => {
    const state = evaluateConvergence([passed('A'), passed('B'), passed('C')])
    expect(state.kind).toBe('converged')
    expect(state.basis).toBe('channels A, B, C all passed')
  })

  it('never converges on an empty or partial set', () => {
    for (const verdicts of [[], [passed('A')], [passed('A'), passed('B')]] as const) {
      expect(evaluateConvergence(verdicts).kind).not.toBe('converged')
    }
  })
})

describe('evaluateConvergence — determinism and duplicate handling', () => {
  it('folds repeated verdicts for one component by severity', () => {
    const conflicted = evaluateConvergence([v('A', 'passed'), v('A', 'abstained'), passed('B'), passed('C')])
    expect(conflicted.kind).toBe('held')

    const refuting = evaluateConvergence([v('B', 'passed'), passed('A'), v('B', 'failed'), passed('C')])
    expect(refuting.kind).toBe('refuted')
    expect(refuting).toMatchObject({ component: 'B' })

    const blocking = evaluateConvergence([passed('A'), v('C', 'passed'), v('C', 'blocked'), passed('B')])
    expect(blocking.kind).toBe('pending')
  })

  it('is independent of input order and does not mutate the input', () => {
    const verdicts: ReadonlyArray<ChannelVerdict> = Object.freeze([
      v('C', 'passed'),
      v('A', 'passed'),
      v('B', 'passed'),
    ])
    const forward = evaluateConvergence(verdicts)
    const backward = evaluateConvergence([...verdicts].reverse())
    expect(forward).toEqual(backward)
    expect(forward.kind).toBe('converged')
    expect(verdicts.map(x => x.outcome)).toEqual(['passed', 'passed', 'passed'])
  })

  it('reports the deciding channel in canonical A→B→C order', () => {
    const held = evaluateConvergence([v('C', 'abstained'), v('B', 'abstained'), v('A', 'abstained')])
    expect(held).toMatchObject({ component: 'A' })

    const refuted = evaluateConvergence([v('C', 'failed'), v('B', 'failed'), passed('A')])
    expect(refuted).toMatchObject({ component: 'B' })
  })
})

describe('summarizeConvergence — one auditable line per state', () => {
  it('renders each state kind with its basis', () => {
    const states: ReadonlyArray<ConvergenceState> = [
      evaluateConvergence([passed('A'), passed('B'), passed('C')]),
      evaluateConvergence([passed('A'), passed('B')]),
      evaluateConvergence([passed('A'), v('B', 'failed'), passed('C')]),
      evaluateConvergence([passed('A'), v('B', 'abstained'), passed('C')]),
    ]
    const lines = states.map(summarizeConvergence)

    expect(lines[0]).toBe('converged: channels A, B, C all passed')
    expect(lines[1]).toContain('pending: ')
    expect(lines[1]).toContain('no verdict for channel(s) C')
    expect(lines[2]).toBe('refuted: channel B failed')
    expect(lines[3]).toBe('held: channel B abstained; a withheld pass is never a pass')
    for (const line of lines) expect(line.split('\n')).toHaveLength(1)
  })

  it('carries the state kind into the line for every state', () => {
    const states: ReadonlyArray<ConvergenceState> = [
      evaluateConvergence([]),
      evaluateConvergence([passed('A'), v('B', 'blocked')]),
      evaluateConvergence([v('A', 'failed')]),
      evaluateConvergence([v('A', 'abstained')]),
    ]
    for (const state of states) expect(summarizeConvergence(state).startsWith(`${state.kind}: `)).toBe(true)
  })
})
