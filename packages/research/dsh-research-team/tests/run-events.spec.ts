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

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { LiteratureSearchAdapter, LiteratureSearchOutcome } from '@deepseek-ai/dsh-research-tools'
import { afterEach, describe, expect, it } from 'vitest'

import type { AuditEvent } from '@deepseek-ai/dsh-research-core'

import ResearchTeamService from '../src/index.ts'
import type { ResearchRunFrame, ResearchRunSnapshot } from '../src/types.ts'
import { chainDigest, EMPTY_LOG, partsOfCursor, readRunCursor, runCursorOf } from '../src/runner/run-events.ts'

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
  /**
   * The per-step budget this deployment configures.
   *
   * A test that HOLDS a run inside a step for longer than the registry's own budget would otherwise
   * be testing the step's timeout rather than the thing it opened the follow for.
   */
  readonly stepTimeoutMs?: number
}): Promise<{
  readonly service: ResearchTeamService
  /** Point the deployment's saves at another directory, as a reconfiguration would. */
  setSnapshotDirectory(directory: string): void
  dispose(): Promise<void>
}> {
  const ctx = new Context()
  for (const name of ['agents', 'sessions', 'sessionPersistence']) ctx.provide(name, {})
  ctx.provide('sessionProjections', { register: () => () => {} })
  ctx.provide('subagents', {})
  ctx.provide('tools', { guard: () => () => {} })
  const engine: {
    snapshotDirectory?: string
    toolDeps?: { literatureAdapter: LiteratureSearchAdapter }
    stepTimeoutMs?: number
  } = {
    ...(options.snapshotDirectory === undefined ? {} : { snapshotDirectory: options.snapshotDirectory }),
    ...(options.literatureAdapter === undefined ? {} : { toolDeps: { literatureAdapter: options.literatureAdapter } }),
    ...(options.stepTimeoutMs === undefined ? {} : { stepTimeoutMs: options.stepTimeoutMs }),
  }
  ctx.provide('research', engine)
  const fiber = await ctx.plugin(ResearchTeamService, {})
  return {
    service: ctx.agentTeams as unknown as ResearchTeamService,
    setSnapshotDirectory: (directory: string) => { engine.snapshotDirectory = directory },
    dispose: async () => { await fiber.dispose() },
  }
}

/**
 * One follow's frames, pulled one at a time.
 *
 * Typed at the boundary rather than at the call site: a spec that pulls a stream frame by frame needs
 * the frame type on every pull, and the Remote-decorated method's own type is not carried through the
 * decorator.
 *
 * @param service - the service holding the run.
 * @param runId - the run to follow.
 * @param signal - cancellation for the subscription.
 * @returns the stream's iterator.
 */
function follower(
  service: ResearchTeamService,
  runId: string,
  signal: AbortSignal,
): AsyncIterator<ResearchRunFrame, undefined> {
  const frames: AsyncIterable<ResearchRunFrame> = service.followRun({ runId }, signal)
  // The stream's own iterator type leaves its return value unstated, which makes every `value` on
  // every pull `any`. Naming it here is what lets the assertions below be typed.
  return frames[Symbol.asyncIterator]() as AsyncIterator<ResearchRunFrame, undefined>
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

/** A log of `count` distinguishable events for one run. */
function logOf(count: number, runId = 'run-a'): ReadonlyArray<AuditEvent> {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'step-started' as const,
    runId,
    stepId: `step-${String(index)}`,
    ts: 1_000 + index,
  }))
}

/** The cursor for a position in one log, built the way the follow builds it. */
function cursorAt(events: ReadonlyArray<AuditEvent>, consumed: number, runId = 'run-a'): string {
  return runCursorOf(runId, consumed, chainDigest(events, EMPTY_LOG, consumed).digest)
}

describe('a run cursor names one position in one history of one run', () => {
  it('reads back the position it was written for', () => {
    const events = logOf(10)
    expect(readRunCursor('run-a', cursorAt(events, 7), events)).toEqual({ ok: true, sequence: 7 })
  })

  it('refuses a cursor that belongs to another run, naming both', () => {
    // THE CROSS-RUN CASE. The cursor carries its run, so a mix-up is detectable rather than read as
    // a position in the run that was asked for.
    const events = logOf(10)
    const foreign = runCursorOf('run-b', 3, chainDigest(events, EMPTY_LOG, 3).digest)
    const read = readRunCursor('run-a', foreign, events)
    expect(read.ok).toBe(false)
    expect(read.ok ? '' : read.reason).toContain('run-b')
    expect(read.ok ? '' : read.reason).toContain('run-a')
  })

  it('refuses a position the run has never reached', () => {
    // The log only grows, so a position past its end did not come from this run's history.
    const events = logOf(10)
    const read = readRunCursor('run-a', cursorAt(events, 10).replace('#10#', '#11#'), events)
    expect(read.ok).toBe(false)
    expect(read.ok ? '' : read.reason).toContain('11')
    expect(read.ok ? '' : read.reason).toContain('10')
  })

  it('refuses the same position when it names a DIFFERENT history of that run', () => {
    // THE RESTART CASE, and the reason a position is not enough. A run restored from a checkpoint
    // keeps the events that checkpoint saved and appends new ones at the indices the lost tail
    // occupied, so a position a reader consumed can hold different events here. Serving the new
    // events from that position would continue a reader that never saw what replaced what it held.
    const asRead = logOf(6)
    const rebuilt = [...logOf(3), ...logOf(3).map(event => ({ ...event, stepId: `${event.stepId ?? ''}-other` }))]
    const held = cursorAt(asRead, 6)
    // Same run, same position, same count — and not the same log.
    expect(readRunCursor('run-a', cursorAt(rebuilt, 6), rebuilt)).toEqual({ ok: true, sequence: 6 })
    const read = readRunCursor('run-a', held, rebuilt)
    expect(read.ok).toBe(false)
    expect(read.ok ? '' : read.reason).toContain('different history')
  })

  it('refuses a cursor that names no position at all', () => {
    const events = logOf(10)
    for (const malformed of ['', 'run-a', 'run-a#', 'run-a#seven', 'run-a#-1', 'run-a#3', 'run-a#3#nothex', 'run-a#3#ab#cd']) {
      expect(readRunCursor('run-a', malformed, events).ok).toBe(false)
    }
    // A well-formed cursor with a digest of the wrong length is not one this host ever wrote.
    expect(readRunCursor('run-a', `run-a#3#${'a'.repeat(63)}`, events).ok).toBe(false)
  })

  it('names the position AFTER an event, and the digest of exactly what was consumed', () => {
    // THE POSITION SEMANTICS. A reader that has applied event N continues at N+1: naming N would ask
    // for the event it already holds, which is how a client that reconnects mid-batch is sent a
    // duplicate. The digest covers exactly the events below that position.
    const events = logOf(4)
    const parts = partsOfCursor(cursorAt(events, 3))
    expect(parts).toBeDefined()
    expect(parts?.sequence).toBe(3)
    expect(parts?.digest).toBe(chainDigest(events, EMPTY_LOG, 3).digest)
    // The chain is order-sensitive: the same events in another order are another history.
    expect(chainDigest([...events].reverse(), EMPTY_LOG, 3).digest)
      .not.toBe(chainDigest(events, EMPTY_LOG, 3).digest)
  })
})

describe('following a run', () => {
  it('reports a run whose SAVE changed without an event being appended', async () => {
    // SAVE HEALTH IS NOT AN EVENT. A run can fall out of step with the disk while its log does not
    // grow at all — here, a write retried against an unusable directory — and a reader watching for
    // exactly that would be told nothing by a stream that only reported appended events.
    const held = barrier()
    const host = await boot({
      literatureAdapter: held.adapter,
      snapshotDirectory: snapshotRoot(),
      // THE STEP BUDGET OUTLASTS THIS TEST, so what delivers the frame under test is the control
      // update rather than the run's own step timing out.
      stepTimeoutMs: 60_000,
    })
    const abort = new AbortController()
    try {
      const started = await host.service.startRun({ commandId: 'follow-control' })
      // The run is INSIDE its first step and stays there: while the adapter holds it, no step can
      // commit, so no event can be appended and no closing frame is due.
      await held.entered
      const frames = follower(host.service, started.runId, abort.signal)

      const opening: IteratorResult<ResearchRunFrame, undefined> = await frames.next()
      const firstFrame: ResearchRunFrame | undefined = opening.value
      expect(firstFrame?.type).toBe('snapshot')
      const atOpen: ResearchRunSnapshot | undefined = firstFrame?.type === 'snapshot' ? firstFrame.snapshot : undefined
      expect(atOpen?.execution).toBe('running')

      // THE DEPLOYMENT'S WRITE FAILS, with the run exactly where it was: the projection's durability
      // record moves and nothing else does.
      const unwritable = join(snapshotRoot(), 'not-a-directory')
      writeFileSync(unwritable, 'not a directory')
      host.setSnapshotDirectory(unwritable)
      const retried = await host.service.retryRunSave({ runId: started.runId })
      expect(retried.persisted).toBe(false)

      // The frames are pulled until one reports the failure. The stream has nothing else to send: the
      // run is held inside its step, so there are no events and no closing frame — a snapshot that
      // says the save failed can only arrive as the control update this test is about.
      // Pulled with a DEADLINE rather than a frame count: a quiet stream yields nothing at all, so
      // counting pulls would wait forever on the very failure this test is here to catch.
      const deadline = Date.now() + 10_000
      let reported: ResearchRunSnapshot | undefined
      while (reported === undefined && Date.now() < deadline) {
        const raced: IteratorResult<ResearchRunFrame, undefined> | 'quiet' = await Promise.race([
          frames.next(),
          new Promise<'quiet'>((resolve) => { setTimeout(() => { resolve('quiet') }, 250) }),
        ])
        if (raced === 'quiet') continue
        const frame: ResearchRunFrame | undefined = raced.value
        if (frame?.type === 'snapshot' && frame.snapshot.runPersistence?.error !== undefined) {
          reported = frame.snapshot
        }
      }
      if (reported === undefined) throw new Error('no frame reported the failing save within 10s — the stream only sends events and closing frames')
      expect(reported.runPersistence?.error ?? '').toMatch(/not a directory|ENOTDIR/iu)
      // WHILE THE RUN IS STILL GOING, and at the same position: nothing was carried out and nothing
      // happened, so the frame is a state rather than a step in the log.
      expect(reported.execution).toBe('running')
      expect(reported.projectRevision).toBe(atOpen?.projectRevision)

      abort.abort()
      await frames.next().catch(() => undefined)
    } finally {
      held.release()
      await host.dispose()
    }
  }, 60_000)

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
/**
 * The position one cursor names.
 *
 * A cursor is `<runId>#<consumed>#<digest>` — the count, not the last index seen — so the position
 * is the segment between the two separators, read through the module's own parser rather than by
 * slicing text here.
 *
 * @param cursor - a cursor as the host produced it.
 * @returns the number of events it says the reader has consumed.
 */
function readSequence(cursor: string): number {
  const parts = partsOfCursor(cursor)
  if (parts === undefined) throw new Error(`'${cursor}' is not a cursor`)
  return parts.sequence
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
