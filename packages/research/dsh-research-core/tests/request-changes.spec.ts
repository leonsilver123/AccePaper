/**
 * A change request is a decision that leaves the gate open.
 *
 * The loop this closes: a person reading the manuscript at the human gate could approve it or reject
 * it, and nothing between. Rejecting reports the step as `blocked` — the study stopped — while the
 * actual intent ("change this, then show me again") had nowhere to go, so the person either passed
 * work they did not accept or blocked a study they wanted continued.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  ResearchError, getRunSnapshot,
} from '../src/engine/state-machine.ts'
import { _resetApprovalChannelForTests, createHostApprovalChannel } from '../src/host.ts'
import type { HostApprovalChannel } from '../src/host.ts'
import { freshStore, runFullPipeline } from './helpers.ts'

afterEach(() => {
  _resetApprovalChannelForTests()
  channel = undefined
})

/** The process's single approval channel, minted on first use. */
let channel: HostApprovalChannel | undefined

/**
 * A store at the human gate, and the channel that decides it.
 *
 * The channel is a process singleton, so it is minted once per test rather than once per call: a
 * case that needs two runs compares them through the same channel, which is the only shape the
 * production wiring has.
 * @returns the store, its run at the gate, and the channel.
 */
function atTheGate() {
  const store = freshStore()
  const runId = runFullPipeline(store)
  channel ??= createHostApprovalChannel('secret')
  channel.registerPrincipal('human-1')
  return { store, runId, channel }
}

describe('a change request keeps the gate open', () => {
  it('leaves the step gated and records the instruction', () => {
    const { store, runId, channel } = atTheGate()
    const principal = channel.mintPrincipal(runId, 'E2-submit', 'human-1', 'evt-1')
    const status = channel.submit(store, runId, 'E2-submit', 'request_changes', principal, '  tighten the claim in §3  ')

    // THE GATE IS STILL OPEN: the person asked for different work, not for the study to stop.
    expect(status).toBe('gated')
    const record = getRunSnapshot(store, runId).steps['E2-submit']?.approval
    expect(record?.decision).toBe('request_changes')
    // Trimmed, because an instruction with leading whitespace is the same instruction.
    expect(record?.rationale).toBe('tighten the claim in §3')
  })

  it('is not a rejection: the two outcomes differ', () => {
    // NON-VACUITY for the branch above. A rejection takes the same path with a different verdict, and
    // if `request_changes` were folded into it this pair would be the same value twice.
    const requested = atTheGate()
    const requestStatus = requested.channel.submit(
      requested.store, requested.runId, 'E2-submit', 'request_changes',
      requested.channel.mintPrincipal(requested.runId, 'E2-submit', 'human-1', 'evt-a'), 'change it',
    )
    // The channel is a process singleton: the second half of the pair reuses it rather than trying
    // to mint a second one.
    const rejected = atTheGate()
    const rejectStatus = rejected.channel.submit(
      rejected.store, rejected.runId, 'E2-submit', 'rejected',
      rejected.channel.mintPrincipal(rejected.runId, 'E2-submit', 'human-1', 'evt-b'), 'not this',
    )
    expect(requestStatus).toBe('gated')
    expect(rejectStatus).toBe('blocked')
  })

  it('refuses a request that names nothing to change', () => {
    const { store, runId, channel } = atTheGate()
    const principal = channel.mintPrincipal(runId, 'E2-submit', 'human-1', 'evt-1')
    expect(() => channel.submit(store, runId, 'E2-submit', 'request_changes', principal, '   '))
      .toThrow(/APPROVAL_REQUEST_EMPTY/)
    expect(() => channel.submit(store, runId, 'E2-submit', 'request_changes', principal, undefined))
      .toThrow(ResearchError)
    // The refusal left the gate where it was, so the caller can make the request it meant to make.
    expect(getRunSnapshot(store, runId).steps['E2-submit']?.status).toBe('gated')
  })

  it('consumes its event id, and a later approval needs a new one', () => {
    const { store, runId, channel } = atTheGate()
    const request = channel.mintPrincipal(runId, 'E2-submit', 'human-1', 'evt-1')
    channel.submit(store, runId, 'E2-submit', 'request_changes', request, 'change it')

    // The same event id again is a replay of the decision already made.
    const replay = channel.mintPrincipal(runId, 'E2-submit', 'human-1', 'evt-1')
    expect(() => channel.submit(store, runId, 'E2-submit', 'request_changes', replay, 'change it'))
      .toThrow(/APPROVAL_REPLAY/)

    // The request did not close the gate, so the work that answers it can be approved afterwards.
    const approval = channel.mintPrincipal(runId, 'E2-submit', 'human-1', 'evt-2')
    expect(channel.submit(store, runId, 'E2-submit', 'approved', approval)).toBe('passed')
    const record = getRunSnapshot(store, runId).steps['E2-submit']?.approval
    expect(record?.decision).toBe('approved')
    // The instruction is not carried over: the approval is a decision about the work that answered
    // it, and a record that kept the old request would describe a revision nobody is looking at.
    expect(record?.rationale).toBeUndefined()
  })

  it('writes the decision to the run log it can be reconstructed from', () => {
    const { store, runId, channel } = atTheGate()
    const principal = channel.mintPrincipal(runId, 'E2-submit', 'human-1', 'evt-1')
    channel.submit(store, runId, 'E2-submit', 'request_changes', principal, 'change it')
    const events = getRunSnapshot(store, runId).events.filter(event => event.kind === 'human-approval')
    const last = events.at(-1) as { detail?: { decision?: string; rationale?: string } } | undefined
    expect(last?.detail?.decision).toBe('request_changes')
    expect(last?.detail?.rationale).toBe('change it')
  })
})
