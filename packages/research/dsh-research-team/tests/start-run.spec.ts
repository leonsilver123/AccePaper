/**
 * Starting a study asynchronously, and reading it while it runs.
 *
 * WHAT THIS PINS. `runPipeline` answers only when the study is over, which is why a person who
 * pressed a button had nothing to look at and a reload lost the only handle they had. `startRun`
 * creates the run, writes it to disk, returns its id, and drives it in the background under this
 * service. These tests hold a REAL run inside a real step (a literature adapter that does not
 * answer until the test lets it) and read the projection from there.
 *
 * NO SLEEPS. Every wait below is on an event the run itself produces — the adapter being entered,
 * the gate being released — so the state under assertion is one the test placed the run in rather
 * than one it raced it into. The one thing a timeout would catch is the failure this file exists
 * to prevent: a `startRun` that waited for the study would hang, and the spec would fail on
 * vitest's own timeout rather than on a fixed sleep of the test's choosing.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { LiteratureSearchAdapter, LiteratureSearchOutcome } from '@deepseek-ai/dsh-research-tools'
import { afterEach, describe, expect, it } from 'vitest'

import { createRunPersistence } from '@deepseek-ai/dsh-research-core'

import ResearchTeamService from '../src/index.ts'
import type { ResearchRunSnapshot } from '../src/types.ts'
import { STEP_EXECUTOR_REGISTRY } from '../src/runner/registry.ts'

/** One adapter that blocks the run inside its first retrieval until the test releases it. */
interface Barrier {
  readonly adapter: LiteratureSearchAdapter
  /** Resolves once a step has asked this adapter for literature. */
  readonly entered: Promise<string>
  /** Let the adapter answer, and resolve once the run has consumed the answer. */
  readonly release: () => Promise<void>
  /** How many searches were asked for. */
  readonly asked: number
}

function barrier(): Barrier {
  let markEntered: (topic: string) => void = () => {}
  const entered = new Promise<string>((resolve) => { markEntered = resolve })
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  let asked = 0
  const adapter: LiteratureSearchAdapter = {
    search: async (query) => {
      asked += 1
      markEntered(query.topic)
      await gate
      // UNAVAILABLE, not empty: the run has to carry on with an adapter that answered nothing, and
      // reporting an outage as a corpus with no matches would be a different fact.
      return { status: 'unavailable', detail: 'the test released the barrier without a corpus' } satisfies LiteratureSearchOutcome
    },
  }
  return {
    adapter,
    entered,
    release: async () => { release() },
    get asked() { return asked },
  }
}

/** Boot the service over a real deployment's configuration, with the research engine stubbed. */
async function boot(options: {
  readonly snapshotDirectory?: string
  readonly literatureAdapter?: LiteratureSearchAdapter
}): Promise<{
  readonly ctx: Context
  readonly service: ResearchTeamService
  directoryEntries(name: string): ReadonlyArray<string>
  /** Point the deployment's saves at another directory, as a reconfiguration would. */
  setSnapshotDirectory(directory: string): void
  dispose(): Promise<void>
}> {
  const ctx = new Context()
  for (const name of ['agents', 'sessions', 'sessionPersistence']) {
    ctx.provide(name, {})
  }
  // Registration is the one projection call the service's constructor makes; the stand-in records
  // what was registered so a spec can see the effect was installed rather than assuming it.
  const registered: string[] = []
  ctx.provide('sessionProjections', {
    register(definition: { readonly key: string }): () => void {
      registered.push(definition.key)
      return () => {}
    },
  })
  ctx.provide('subagents', {})
  ctx.provide('tools', { guard: () => () => {} })
  // The research engine the service reads its deployment facts from. This is the seam the real
  // deployment fills from cordis.yml, so a test that fills it is testing the production path.
  // ONE mutable object, because the service reads this per save — which is what makes "the
  // deployment's directory stopped being writable" expressible in a test without a race.
  const engine: { snapshotDirectory?: string; toolDeps?: { literatureAdapter: LiteratureSearchAdapter } } = {}
  if (options.snapshotDirectory !== undefined) engine.snapshotDirectory = options.snapshotDirectory
  if (options.literatureAdapter !== undefined) engine.toolDeps = { literatureAdapter: options.literatureAdapter }
  ctx.provide('research', engine)
  const fiber = await ctx.plugin(ResearchTeamService, {})
  return {
    ctx,
    service: ctx.agentTeams as unknown as ResearchTeamService,
    // What the deployment actually wrote, read off the disk rather than from the service: a count
    // taken from the thing under test would agree with itself.
    setSnapshotDirectory: (directory: string) => { engine.snapshotDirectory = directory },
    directoryEntries: (name: string) => {
      const directory = options.snapshotDirectory === undefined ? undefined : join(options.snapshotDirectory, name)
      return directory === undefined || !existsSync(directory) ? [] : readdirSync(directory)
    },
    dispose: async () => { await fiber.dispose() },
  }
}

const roots: string[] = []
function snapshotRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-startrun-'))
  roots.push(root)
  return root
}

afterEach(() => {
  // Each test owns the directory it created; a leftover would make the next run's one-directory-
  // per-run listing see a run that is not its own.
  while (roots.length > 0) {
    const root = roots.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

describe('a study is started and read back', () => {
  it('answers with a run id while the study is still inside its first step', async () => {
    // THE CASE THE OLD ENTRY POINT COULD NOT SERVE. The adapter holds the run inside a step, so
    // the study is provably unfinished when the id comes back — and the projection answers anyway,
    // because it reads the run's own record rather than the drive call's result.
    const held = barrier()
    const host = await boot({ literatureAdapter: held.adapter, snapshotDirectory: snapshotRoot() })
    try {
      const started = await host.service.startRun({ commandId: 'command-1' })
      expect(started.persisted).toBe(true)
      expect(started.runId).not.toBe('')

      // The study is inside a step: the adapter has been asked and has not answered.
      const topic = await held.entered
      expect(topic).not.toBe('')

      const snapshot = await host.service.runSnapshot({ runId: started.runId })
      expect(snapshot).not.toBeNull()
      // A DRIVER IS ON IT, and the page can say so. The alternative — waiting for the study — is a
      // blank screen for eight minutes.
      expect(snapshot?.execution).toBe('running')
      expect(snapshot?.executionError).toBeUndefined()
      // Every catalogued step is reported, so "not started yet" is distinguishable from "absent".
      expect(snapshot?.run.steps.length).toBe(STEP_EXECUTOR_REGISTRY.size)
      // And what has not run is not claimed to have run.
      expect(snapshot?.run.steps.some(step => step.status === 'passed')).toBe(false)
      // What is on disk is stated as a revision, not as an opinion about the run's health.
      expect(snapshot?.runPersistence?.runId).toBe(started.runId)
      expect(snapshot?.runPersistence?.directory).toBeDefined()

      await held.release()
      // Reading it to the end from here is the test's own bookkeeping, not the product's: the
      // point of the assertion above is that the id was already usable before this.
      await untilStopped(host.service, started.runId)
      const finished = await host.service.runSnapshot({ runId: started.runId })
      expect(finished?.execution).toBe('stopped')
      // IT ADVANCED AND IT WAS SAVED. The adapter answered `unavailable` for every retrieval, so
      // the study stopped early rather than passing anything — and the checkpoints that recorded
      // how far it got are on disk, which is what a reload would find.
      expect(finished?.runPersistence?.revision ?? 0).toBeGreaterThan(0)
      expect(finished?.run.steps.find(step => step.stepId === 'A1-landscape')?.status).not.toBe('pending')
    } finally {
      await host.dispose()
    }
  })

  it('creates ONE run when the same command arrives twice at once', async () => {
    // THE CONCURRENT CASE, which the map could not close while it was written after the save: two
    // calls that arrived together both missed it and both created a run. The registration now
    // happens synchronously, before the first await, so the second call waits for the first answer.
    const held = barrier()
    const host = await boot({ literatureAdapter: held.adapter, snapshotDirectory: snapshotRoot() })
    try {
      const [first, second] = await Promise.all([
        host.service.startRun({ commandId: 'command-concurrent' }),
        host.service.startRun({ commandId: 'command-concurrent' }),
      ])
      expect(second.runId).toBe(first.runId)
      expect(host.directoryEntries('commands')).toHaveLength(1)
      await held.release()
      await untilStopped(host.service, first.runId)
    } finally {
      await host.dispose()
    }
  })

  it('refuses the same command id carrying different research', async () => {
    // A RETRY RE-SENDS THE SAME REQUEST. The same id carrying a different field is a second study
    // wearing the first one's identity, and answering it with the first run would run something the
    // caller did not ask for.
    const held = barrier()
    const host = await boot({ literatureAdapter: held.adapter, snapshotDirectory: snapshotRoot() })
    try {
      const first = await host.service.startRun({ commandId: 'command-changed', domainDirection: 'road safety' })
      await expect(
        host.service.startRun({ commandId: 'command-changed', domainDirection: 'protein folding' }),
      ).rejects.toThrow(/different research/u)
      await held.release()
      await untilStopped(host.service, first.runId)
    } finally {
      await host.dispose()
    }
  })

  it('refuses a command id that cannot name a record', async () => {
    // The id becomes a file name beside the runs, so one carrying a path separator is refused at the
    // boundary — sanitising it would produce a DIFFERENT id, and the next retry would not find it.
    const host = await boot({ snapshotDirectory: snapshotRoot() })
    try {
      for (const bad of ['../escape', 'a/b', '', 'x'.repeat(129)]) {
        await expect(host.service.startRun({ commandId: bad })).rejects.toThrow(/cannot name a start command/u)
      }
      expect(host.directoryEntries('commands')).toHaveLength(0)
    } finally {
      await host.dispose()
    }
  })

  it('answers a retry from the record after a restart', async () => {
    // THE LOST RESPONSE, ONE PROCESS LATER. The caller never read its answer and the process that
    // produced it is gone; without the record the retry would be handed a second study.
    const root = snapshotRoot()
    const first = await boot({ snapshotDirectory: root })
    let runId = ''
    try {
      runId = (await first.service.startRun({ commandId: 'command-durable' })).runId
      await untilStopped(first.service, runId)
    } finally {
      await first.dispose()
    }

    const second = await boot({ snapshotDirectory: root })
    try {
      const retried = await second.service.startRun({ commandId: 'command-durable' })
      // THE SAME RUN, and it says it is still findable rather than promising a new study.
      expect(retried.runId).toBe(runId)
      expect(retried.persisted).toBe(true)
      // And it did not start a second one: the run's own records say one thing happened.
      expect(await second.service.runSnapshot({ runId })).not.toBeNull()
    } finally {
      await second.dispose()
    }
  })

  it('says which half is missing when a recorded command names a run that is gone', async () => {
    // A record without its run is not a success to report: the caller would be told its study is
    // findable when nothing can be read.
    const root = snapshotRoot()
    const first = await boot({ snapshotDirectory: root })
    let runId = ''
    try {
      runId = (await first.service.startRun({ commandId: 'command-orphan' })).runId
      await untilStopped(first.service, runId)
    } finally {
      await first.dispose()
    }
    rmSync(join(root, runId), { recursive: true, force: true })

    const second = await boot({ snapshotDirectory: root })
    try {
      const retried = await second.service.startRun({ commandId: 'command-orphan' })
      expect(retried.runId).toBe(runId)
      expect(retried.persisted).toBe(false)
      expect(retried.persistenceError).toContain('no longer stored')
    } finally {
      await second.dispose()
    }
  })

  it('answers a retried command with the run it already started', async () => {
    // A timeout is not a refusal. The caller that never read the first answer sends the same
    // command again, and a second study for it would spend a second run's worth of model calls.
    const held = barrier()
    const host = await boot({ literatureAdapter: held.adapter, snapshotDirectory: snapshotRoot() })
    try {
      const first = await host.service.startRun({ commandId: 'command-retry' })
      const retried = await host.service.startRun({ commandId: 'command-retry' })
      expect(retried.runId).toBe(first.runId)
      expect(retried.startedAt).toBe(first.startedAt)
      // ONE RUN, not two: the adapter was entered once at this point, and a second run would have
      // asked it a second time.
      await held.entered
      expect(held.asked).toBe(1)
      // A DIFFERENT command is a different study, and gets its own id.
      const other = await host.service.startRun({ commandId: 'command-other' })
      expect(other.runId).not.toBe(first.runId)
      await held.release()
      await untilStopped(host.service, first.runId)
      await untilStopped(host.service, other.runId)
    } finally {
      await host.dispose()
    }
  })

  it('refuses to start when the run cannot be recorded, and runs nothing', async () => {
    // A run that exists only in memory cannot be found after a reload, so a start that answered
    // success would have promised something it could not deliver. The directory here is named
    // under a FILE, so creating it fails the way an unwritable deployment's would.
    const file = join(snapshotRoot(), 'not-a-directory')
    // A FILE where the directory has to go: `mkdirSync` fails on it, which is how a deployment
    // pointed at an unusable path learns.
    writeFileSync(file, 'not a directory')
    const held = barrier()
    const host = await boot({ literatureAdapter: held.adapter, snapshotDirectory: join(file, 'runs') })
    try {
      await expect(host.service.startRun({ commandId: 'command-doomed' })).rejects.toThrow()
      // NOTHING RAN. The failure is before the driver, so the barrier was never entered — which is
      // the observable difference between "refused" and "started and then reported a problem".
      expect(held.asked).toBe(0)
    } finally {
      await host.dispose()
    }
  })

  it('reports the revision the run is actually on disk at, so the next writer is not refused', async () => {
    // WHAT A BROWSER RUN FOUND, and what this asserts is the half a unit test can reach: the number
    // the query reports is the file's own, and a write based on it is accepted. The half it cannot
    // reach is the approval's own write — that needs a run parked at the E2 gate — and the defect
    // lived there: the report read the finished write's revision while the approval read the last
    // CHECKPOINT's, so the decision was applied and then refused. Both now derive from
    // `savedRevisionOf`, so the two numbers cannot diverge by construction; the probe is what
    // exercises the approval end to end.
    const root = snapshotRoot()
    const host = await boot({ snapshotDirectory: root })
    try {
      const started = (await host.service.startRun({ commandId: 'command-revision' })).runId
      await untilStopped(host.service, started)

      const persistence = createRunPersistence({ dir: join(root, started) })
      const onDisk = await persistence.read()
      const reported = (await host.service.runSnapshot({ runId: started }))?.runPersistence?.revision
      expect(reported).toBe(onDisk.revision)

      // The writer an approval is: it restores the run from the same file and saves against the
      // revision the service just reported.
      const restored = await persistence.tryLoad(null)
      expect(restored).not.toBeNull()
      await expect(
        persistence.save(restored!.store, started, { baseRevision: reported ?? 0 }),
      ).resolves.toBeDefined()
    } finally {
      await host.dispose()
    }
  })

  it('reports a checkpoint that did not reach the disk, and refuses to call the run ready', async () => {
    // A READER WATCHING A STUDY ADVANCE cannot tell from the steps alone whether the work it is
    // watching is ON THE DISK. The failure used to live only in `RunResult.checkpointErrors`, which
    // a running run has not produced yet — so the page showed progress and said nothing about the
    // fact that none of it could be found again.
    const held = barrier()
    const host = await boot({ literatureAdapter: held.adapter, snapshotDirectory: snapshotRoot() })
    try {
      const started = await host.service.startRun({ commandId: 'command-checkpoint' })
      // The run is INSIDE its first step: its initial save has landed, so it is startable, and every
      // checkpoint from here on is the one about to fail.
      await held.entered
      // THE DEPLOYMENT'S OWN FAILURE MODE, through the deployment's own seam: the directory it saves
      // into stops being writable while the run is working.
      const unwritable = join(snapshotRoot(), 'not-a-directory')
      writeFileSync(unwritable, 'not a directory')
      host.setSnapshotDirectory(unwritable)

      held.release()
      const reported = await untilPersistedError(host.service, started.runId)

      // THE FAILURE IS REPORTED WHERE SAVING IS REPORTED, while the run is still going, and it is
      // the deployment's OWN reason — not a summary this layer invented for it.
      expect(reported.runPersistence?.error ?? '').toMatch(/not a directory|ENOTDIR/iu)
      // AND IT REFUSES READINESS. "Ready" is a claim about material that exists and can be produced
      // again; material the deployment could not write is neither.
      expect(reported.submissionReady).toBe(false)
      expect(reported.readinessNote).toContain('checkpoint')
      await untilStopped(host.service, started.runId)
    } finally {
      held.release()
      await host.dispose()
    }
  })

  it('finds a run started by a process that is gone', async () => {
    // THE RESTART CASE. The first service drives a run to its end and is disposed; the second has
    // no memory of it at all. The run's checkpoints are on disk, so the query answers with the
    // record — and reports it STOPPED, because nothing here is driving it. A stale `running` read
    // back from a record written by a dead process is the lie this field exists to prevent.
    const root = snapshotRoot()
    const first = await boot({ snapshotDirectory: root })
    let runId = ''
    let before: ResearchRunSnapshot | null = null
    try {
      runId = (await first.service.startRun({ commandId: 'command-restart' })).runId
      await untilStopped(first.service, runId)
      before = await first.service.runSnapshot({ runId })
    } finally {
      await first.dispose()
    }

    const second = await boot({ snapshotDirectory: root })
    try {
      const after = await second.service.runSnapshot({ runId })
      expect(after).not.toBeNull()
      expect(after?.execution).toBe('stopped')
      expect(after?.runPersistence?.revision).toBeGreaterThan(0)
      // The same run, not a fresh one wearing its id: what the first process recorded is what the
      // second reports.
      expect(after?.run.steps.map(step => step.stepId)).toEqual(before?.run.steps.map(step => step.stepId))
      expect(after?.run.steps.filter(step => step.status === 'passed').length)
        .toBe(before?.run.steps.filter(step => step.status === 'passed').length)
    } finally {
      await second.dispose()
    }

    // A run this deployment has never stored is still absent, and is not invented to look like the
    // one above.
    const third = await boot({ snapshotDirectory: root })
    try {
      expect(await third.service.runSnapshot({ runId: 'no-such-run' })).toBeNull()
    } finally {
      await third.dispose()
    }
  })
})

/**
 * Wait until the run reports a failure to save, or throws when it stops without one.
 *
 * The wait is on the run's OWN reported persistence, which is the fact under test: a run that never
 * reports the failure is a run whose page would never show it.
 *
 * @param service - the service holding the run.
 * @param runId - the run to wait for.
 * @returns the snapshot that reported the failure.
 */
async function untilPersistedError(
  service: ResearchTeamService,
  runId: string,
): Promise<ResearchRunSnapshot> {
  for (;;) {
    const snapshot = await service.runSnapshot({ runId })
    if (snapshot === null) throw new Error(`the run '${runId}' disappeared while waiting for it`)
    if (snapshot.runPersistence?.error !== undefined) return snapshot
    if (snapshot.execution !== 'running') {
      throw new Error(`the run '${runId}' stopped without reporting a failure to save`)
    }
    await new Promise<void>((resolve) => { setImmediate(resolve) })
  }
}

/**
 * Wait until the run reports that nothing is driving it.
 *
 * The wait is on the run's OWN state transition, and the polling is the same read a client
 * performs — so a run that never stops is a run the product would also never stop showing as
 * running, and vitest's timeout is what reports it.
 *
 * @param service - the service holding the run.
 * @param runId - the run to wait for.
 */
async function untilStopped(service: ResearchTeamService, runId: string): Promise<void> {
  for (;;) {
    const snapshot = await service.runSnapshot({ runId })
    if (snapshot === null) throw new Error(`the run '${runId}' disappeared while waiting for it`)
    if (snapshot.execution !== 'running') return
    await new Promise<void>((resolve) => { setImmediate(resolve) })
  }
}
