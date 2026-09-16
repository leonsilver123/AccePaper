// @vitest-environment jsdom
/**
 * Following a run's stream: what the page does with each frame.
 *
 * WHAT THIS PINS. The subscription policy is where a page can be wrong in a way nothing renders:
 * an out-of-order frame accepted as the current state shows a plausible screen that no host
 * reported. These tests drive `followToRest` with a namespace yielding exactly the frames a test
 * chooses, so each of the three answers — render a snapshot, refuse a position that is not this
 * run's history, and stop re-opening rather than spin — is asserted on its own.
 *
 * NO TIMERS. Every frame is available when the test asks for it, so nothing here waits: the follow
 * ends when the frames end, exactly as it does when a run comes to rest.
 */

import { describe, expect, it } from 'vitest'

import { followToRest, sequenceOfCursor, type RunFollowNamespace } from '../src/client/follow-source.ts'
import type { WireRunFrame } from '../src/run-source.ts'
import type { RunSummary } from '../src/summary.ts'

/** A summary the fake frames carry: only the run id is read by these assertions. */
function snapshot(runId: string, execution: string): WireRunFrame {
  return {
    type: 'snapshot',
    cursor: `${runId}#0`,
    snapshot: {
      run: { runId, steps: [] },
      catalog: [],
      gates: [],
      artifacts: [],
      steps: [],
      execution,
    },
  }
}

/** A namespace that yields one prepared list of frames per open, in the order given. */
function namespace(opened: ReadonlyArray<ReadonlyArray<WireRunFrame>>): {
  readonly remote: RunFollowNamespace
  readonly opens: number
  readonly cursors: Array<string | undefined>
} {
  let opens = 0
  const cursors: Array<string | undefined> = []
  return {
    remote: {
      followRun(request) {
        cursors.push(request.cursor)
        const frames = opened[Math.min(opens, opened.length - 1)] ?? []
        opens += 1
        return (async function * () { for (const frame of frames) yield frame })()
      },
    },
    get opens() { return opens },
    cursors,
  }
}

describe('following a run from the page', () => {
  it('renders every state the host reports, in order', async () => {
    const run = namespace([[
      snapshot('run-1', 'running'),
      // A CURSOR IS A COUNT: the position `run-1#0` means no events had been appended, so the next
      // event the host delivers is sequence 0.
      { type: 'event', event: { eventId: 'run-1#0', runId: 'run-1', sequence: 0, schemaVersion: 1, kind: 'step-started', ts: 1 } },
      { type: 'snapshot', cursor: 'run-1#1', snapshot: { run: { runId: 'run-1', steps: [] }, catalog: [], gates: [], artifacts: [], steps: [], execution: 'stopped' } },
    ]])
    const seen: string[] = []
    await followToRest(run.remote, 'run-1', null, (summary: RunSummary) => { seen.push(summary.runId) })

    // Both snapshots reached the page: the host's own projection is what it renders, and the event
    // between them was a position, not a state to replay.
    expect(seen).toEqual(['run-1', 'run-1'])
    expect(run.opens).toBe(1)
  })

  it('re-opens instead of applying a frame that does not continue the position it holds', async () => {
    // THE OUT-OF-ORDER CASE. Sequence 5 arrives where 1 was expected. Applying it would move the
    // page to a position it cannot account for, so it opens again and renders the fresh snapshot.
    const run = namespace([
      [
        snapshot('run-1', 'running'),
        { type: 'event', event: { eventId: 'run-1#5', runId: 'run-1', sequence: 5, schemaVersion: 1, kind: 'rollback', ts: 5 } },
      ],
      [snapshot('run-1', 'stopped')],
    ])
    const seen: string[] = []
    await followToRest(run.remote, 'run-1', null, () => { seen.push('update') })

    expect(run.opens).toBe(2)
    expect(seen).toHaveLength(2)
  })

  it('re-opens when the host refuses the position, and stops rather than spinning', async () => {
    // A host that answers every open with a refusal must not become an infinite loop in a tab.
    const refusing = namespace([[
      { type: 'resync', reason: 'the cursor belongs to run run-2, not run-1' },
    ]])
    await expect(followToRest(refusing.remote, 'run-1', 'run-2#3', () => {}))
      .rejects.toThrow(/would not serve a position in run run-1/u)
    expect(refusing.opens).toBe(3)
  })

  it('hands the position it holds back to the host when it re-opens after a bad frame', async () => {
    // The cursor is the page's position: sending it lets the host say "that is not this run's
    // history" instead of silently serving a snapshot from a different one.
    const run = namespace([
      [
        snapshot('run-1', 'running'),
        { type: 'event', event: { eventId: 'run-1#9', runId: 'run-1', sequence: 9, schemaVersion: 1, kind: 'rollback', ts: 9 } },
      ],
      [snapshot('run-1', 'stopped')],
    ])
    await followToRest(run.remote, 'run-1', null, () => {})
    expect(run.cursors[0]).toBeUndefined()
    expect(run.cursors[1]).toBe('run-1#0')
  })

  it('does not offer a position back after the host has refused it', async () => {
    // A position the host has just said it cannot serve is not one to send again: the page opens
    // fresh, which is what the re-sync frame told it to do.
    const run = namespace([
      [snapshot('run-1', 'running'), { type: 'resync', reason: 'the cursor belongs to run run-2' }],
      [snapshot('run-1', 'stopped')],
    ])
    await followToRest(run.remote, 'run-1', 'run-2#3', () => {})
    expect(run.cursors[0]).toBe('run-2#3')
    expect(run.cursors[1]).toBeUndefined()
  })

  it('reads a position out of a cursor only when one is written there', () => {
    expect(sequenceOfCursor('run-1#7')).toBe(7)
    expect(sequenceOfCursor('run-1#')).toBeNull()
    expect(sequenceOfCursor('run-1')).toBeNull()
    expect(sequenceOfCursor('nonsense')).toBeNull()
  })
})
