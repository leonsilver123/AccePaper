/**
 * Following a run: an opening snapshot, then its events in order, from a cursor.
 *
 * WHAT THIS PINS. `runSnapshot` has no position to resume from, so a reader that reconnected could
 * only take a fresh one and hope nothing in between mattered. These tests hold a real run inside a
 * real step, open the follow on it, and assert the three properties the plan's §7.2 names: the
 * opening cursor and the opening snapshot are the SAME point in the run's history, the frames after
 * it continue from exactly that position with no gap and no repeat, and a cursor this deployment
 * cannot serve is REFUSED with a re-sync rather than read as a position in some other history.
 *
 * NO SLEEPS. The run is placed in each state by a barrier the test releases, and the follow is
 * consumed until it ends, so every assertion is about a state the run was put in.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { LiteratureSearchAdapter, LiteratureSearchOutcome } from '@deepseek-ai/dsh-research-tools'
import { afterEach, describe, expect, it } from 'vitest'

import ResearchTeamService from '../src/index.ts'
import type { ResearchRunFrame } from '../src/types.ts'
import { readRunCursor, runCursorOf } from '../src/runner/run-events.ts'

/** One adapter that blocks the run inside its first retrieval until the test releases it. */
function barrier(): {
  readonly adapter: LiteratureSearchAdapter
  readonly entered: Promise<string>
  readonly release: () => void
} {
  let markEntered: (topic: string) => void = () => {}
  const entered = new Promise<string>((resolve) => { markEntered = resolve })
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  return {
    adapter: {
      search: async (query) => {
        markEntered(query.topic)
        await gate
        return { status: 'unavailable', detail: 'the test released the barrier without a corpus' } satisfies LiteratureSearchOutcome
      },
    },
    entered,
    release: () => { release() },
  }
}

/** Boot the service over a real deployment's configuration, with the research engine stubbed. */
async function boot(options: {
  readonly snapshotDirectory?: string
  readonly literatureAdapter?: LiteratureSearchAdapter
}): Promise<{ readonly service: ResearchTeamService; dispose(): Promise<void> }> {
  const ctx = new Context()
  for (const name of ['agents', 'sessions', 'sessionPersistence']) ctx.provide(name, {})
  ctx.provide('sessionProjections', { register: () => () => {} })
  ctx.provide('subagents', {})
  ctx.provide('tools', { guard: () => () => {} })
  ctx.provide('research', {
    ...(options.snapshotDirectory === undefined ? {} : { snapshotDirectory: options.snapshotDirectory }),
    ...(options.literatureAdapter === undefined ? {} : { toolDeps: { literatureAdapter: options.literatureAdapter } }),
  })
  const fiber = await ctx.plugin(ResearchTeamService, {})
  return { service: ctx.agentTeams as unknown as ResearchTeamService, dispose: async () => { await fiber.dispose() } }
}

/** Collect every frame a follow yields, consuming it to its end. */
async function drain(frames: AsyncIterable<ResearchRunFrame>): Promise<ResearchRunFrame[]> {
  const out: ResearchRunFrame[] = []
  for await (const frame of frames) out.push(frame)
  return out
}

const roots: string[] = []
function snapshotRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-runevents-'))
  roots.push(root)
  return root
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

describe('a run cursor names one position in one run', () => {
  it('reads back the position it was written for', () => {
    const cursor = runCursorOf('run-a', 7)
    expect(readRunCursor('run-a', cursor, 10)).toEqual({ ok: true, sequence: 7 })
  })

  it('refuses a cursor that belongs to another run, naming both', () => {
    // THE CROSS-RUN CASE. The cursor carries its run, so a mix-up is detectable rather than read as
    // a position in the run that was asked for.
    const foreign = runCursorOf('run-b', 3)
    const read = readRunCursor('run-a', foreign, 10)
    expect(read.ok).toBe(false)
    expect(read.ok ? '' : read.reason).toContain('run-b')
    expect(read.ok ? '' : read.reason).toContain('run-a')
  })

  it('refuses a position the run has never reached', () => {
    // The log only grows, so a position past its end did not come from this run's history.
    const read = readRunCursor('run-a', runCursorOf('run-a', 11), 10)
    expect(read.ok).toBe(false)
    expect(read.ok ? '' : read.reason).toContain('11')
    expect(read.ok ? '' : read.reason).toContain('10')
  })

  it('refuses a cursor that names no position at all', () => {
    for (const malformed of ['', 'run-a', 'run-a#', 'run-a#seven', 'run-a#-1']) {
      expect(readRunCursor('run-a', malformed, 10).ok).toBe(false)
    }
  })
})

describe('following a run', () => {
  it('opens on a consistent point and continues from it without a gap', async () => {
    const held = barrier()
    const host = await boot({ literatureAdapter: held.adapter, snapshotDirectory: snapshotRoot() })
    try {
      const started = await host.service.startRun({ commandId: 'follow-1' })
      // The run is INSIDE a step: provably unfinished, and the follow has to work from here.
      await held.entered

      // The follow is opened WHILE the run is held, and the barrier is released underneath it: the
      // subscription has to deliver what the run does NEXT, not only what it had already done.
      const pending = drain(host.service.followRun({ runId: started.runId }, new AbortController().signal))
      held.release()
      const frames = await pending

      const first = frames[0]
      expect(first?.type).toBe('snapshot')
      const opening = first?.type === 'snapshot' ? first : undefined
      expect(opening).toBeDefined()

      // THE OPENING CURSOR IS THE SNAPSHOT'S OWN POSITION. The snapshot reports the run's events, so
      // the two are the same point in its history and a reader needs no replay to be up to date.
      const events = frames.filter(frame => frame.type === 'event')
      const snapshots = frames.filter(frame => frame.type === 'snapshot')
      expect(events.length).toBeGreaterThan(0)
      expect(snapshots.length).toBeGreaterThan(1)

      // NO GAP AND NO REPEAT: the event frames run from the opening position forward, one sequence
      // each, and every one of them belongs to this run.
      const sequences = events.map(frame => (frame.type === 'event' ? frame.event.sequence : -1))
      expect(sequences[0]).toBe(readSequence(opening?.cursor ?? ''))
      expect(sequences).toEqual(sequences.map((_, index) => (sequences[0] ?? 0) + index))
      for (const frame of events) {
        expect(frame.type === 'event' ? frame.event.runId : '').toBe(started.runId)
        expect(frame.type === 'event' ? frame.event.eventId : '').toBe(
          `${started.runId}#${String(frame.type === 'event' ? frame.event.sequence : -1)}`,
        )
      }

      // The last snapshot is the run at rest: the driver finished, so the follow ended on its own —
      // and the frame that says so is the one this stream adds when it has nothing more to deliver.
      const last = snapshots.at(-1)
      expect(last?.type === 'snapshot' ? last.snapshot.execution : undefined).toBe('stopped')
      // It advanced and then stopped, which is what this fixture does: the adapter answered
      // `unavailable` for every retrieval, so the study held rather than passing anything.
      expect(last?.type === 'snapshot' ? last.snapshot.run.steps.find(step => step.stepId === 'A1-landscape')?.status : undefined)
        .not.toBe('pending')
    } finally {
      held.release()
      await host.dispose()
    }
  })

  it('refuses a cursor from another run with a re-sync instead of a wrong history', async () => {
    const held = barrier()
    const host = await boot({ literatureAdapter: held.adapter, snapshotDirectory: snapshotRoot() })
    try {
      const started = await host.service.startRun({ commandId: 'follow-2' })
      await held.entered
      const other = await host.service.startRun({ commandId: 'follow-3' })

      const frames = await drain(host.service.followRun(
        { runId: started.runId, cursor: runCursorOf(other.runId, 1) },
        new AbortController().signal,
      ))
      expect(frames).toHaveLength(1)
      const frame = frames[0]
      expect(frame?.type).toBe('resync')
      expect(frame?.type === 'resync' ? frame.reason : '').toContain(other.runId)
    } finally {
      held.release()
      await host.dispose()
    }
  })

  it('refuses to open a stream for a run this deployment does not hold', async () => {
    const host = await boot({ snapshotDirectory: snapshotRoot() })
    try {
      // An EMPTY STREAM would read exactly like a run that has done nothing, which is a different
      // fact from "this deployment has no such run".
      await expect(drain(host.service.followRun({ runId: 'no-such-run' }, new AbortController().signal)))
        .rejects.toThrow(/holds no run'? '?no-such-run/u)
    } finally {
      await host.dispose()
    }
  })

  it('follows a run this process never held, from its checkpoints', async () => {
    const root = snapshotRoot()
    const first = await boot({ snapshotDirectory: root })
    let runId = ''
    try {
      runId = (await first.service.startRun({ commandId: 'follow-4' })).runId
      await untilStopped(first.service, runId)
    } finally {
      await first.dispose()
    }

    // A SECOND PROCESS, with no memory of the run: the follow reads the record it left behind and
    // reports it stopped, which is the same answer `runSnapshot` gives for the same reason.
    const second = await boot({ snapshotDirectory: root })
    try {
      const frames = await drain(second.service.followRun({ runId }, new AbortController().signal))
      const opening = frames[0]
      expect(opening?.type).toBe('snapshot')
      expect(opening?.type === 'snapshot' ? opening.snapshot.execution : undefined).toBe('stopped')
      // AND NOTHING IS REPLAYED. The opening snapshot is the consistent point, so an event that
      // happened before it is already IN it — delivering the log as well would ask the reader to
      // apply history whose result it has been handed. What a run at rest yields is one snapshot.
      expect(frames.filter(frame => frame.type === 'event')).toHaveLength(0)
      expect(frames).toHaveLength(1)
      // The opening cursor names the END of that log, which is where the snapshot was read.
      const cursor = opening?.type === 'snapshot' ? opening.cursor : ''
      expect(readSequence(cursor)).toBeGreaterThan(0)
    } finally {
      await second.dispose()
    }
  })
})

/** The position a cursor names, for comparing against the frames that followed it. */
function readSequence(cursor: string): number {
  return Number(cursor.slice(cursor.lastIndexOf('#') + 1))
}

/** Wait until the run reports that nothing is driving it. */
async function untilStopped(service: ResearchTeamService, runId: string): Promise<void> {
  for (;;) {
    const snapshot = await service.runSnapshot({ runId })
    if (snapshot === null) throw new Error(`the run '${runId}' disappeared while waiting for it`)
    if (snapshot.execution !== 'running') return
    await new Promise<void>((resolve) => { setImmediate(resolve) })
  }
}
