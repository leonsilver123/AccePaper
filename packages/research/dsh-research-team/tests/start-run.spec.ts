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

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { LiteratureSearchAdapter, LiteratureSearchOutcome } from '@deepseek-ai/dsh-research-tools'
import { afterEach, describe, expect, it } from 'vitest'

import { createRunPersistence } from '@deepseek-ai/dsh-research-core'

import ResearchTeamService from '../src/index.ts'
import { APPROVAL_ERROR_CODES, submitApproval } from '../src/approval.ts'
import type { ResearchRunSnapshot } from '../src/types.ts'
import type { JournalProfile } from '../src/runner/research-profile.ts'
import { STEP_EXECUTOR_REGISTRY } from '../src/runner/registry.ts'

/** The crash fixture, spawned as a child process the way the process-boundary suite requires. */
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const ACCEPT_FIXTURE = join(
  repoRoot, 'packages', 'research', 'dsh-research-team', 'tests', 'fixtures', 'accept-restart', 'accept-and-exit.ts',
)
const APPROVE_FIXTURE = join(
  repoRoot, 'packages', 'research', 'dsh-research-team', 'tests', 'fixtures', 'approve-restart', 'approve-and-exit.ts',
)
const CRASH_FIXTURE = join(
  repoRoot, 'packages', 'research', 'dsh-research-team', 'tests', 'fixtures', 'start-crash', 'start-and-die.ts',
)

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
  /**
   * The research engine the service reads its deployment facts from.
   *
   * Exposed for the one test that needs the deployment's directory to answer differently over time —
   * which is how a root that moved, or a write that failed, is expressed without touching internals.
   */
  readonly engine: {
    snapshotDirectory?: string
    /** Where the deployment writes packages; set by a spec that exports one. */
    packageDirectory?: string
    /** The deployment's prose route, installed by a spec that revises a manuscript. */
    proseWriter?: {
      readonly channel: 'llm' | 'deterministic'
      write(request: unknown): Promise<{ text: string; provider: string; model: string }>
    }
    /** The research type this deployment is configured as. */
    researchType?: string
    /**
     * What this deployment's evidence is allowed to be.
     *
     * THE EXPORT READS IT FROM THE DEPLOYMENT, not from the run: a `final` package is written only
     * where the deployment says its material may be published, so a case that wants one states the
     * profile on the process that exports — as `cordis.yml` does.
     */
    evidenceProfile?: string
    /** How much review this deployment requires; see {@link DriveOptions.reviewPolicy}. */
    reviewPolicy?: { readonly minimumRounds: number }
    /**
     * The journal profile this deployment is configured with.
     *
     * THE PROFILE THE RUN IS CONDUCTED UNDER, read through `resolveResearchProfile`: a deployment that
     * has read its target journal's guide states the rules it read, and one that has not states none —
     * which the publication check reads as an unread guide rather than as a venue with no requirements.
     */
    journal?: JournalProfile
    toolDeps?: { literatureAdapter: LiteratureSearchAdapter }
  }
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
  ctx.provide('tools', { guard: () => () => {}, register: () => () => {} })
  // The research engine the service reads its deployment facts from. This is the seam the real
  // deployment fills from cordis.yml, so a test that fills it is testing the production path.
  // ONE mutable object, because the service reads this per save — which is what makes "the
  // deployment's directory stopped being writable" expressible in a test without a race.
  const engine: {
    snapshotDirectory?: string
    packageDirectory?: string
    proseWriter?: {
      readonly channel: 'llm' | 'deterministic'
      write(request: unknown): Promise<{ text: string; provider: string; model: string }>
    }
    researchType?: string
    evidenceProfile?: string
    reviewPolicy?: { readonly minimumRounds: number }
    toolDeps?: { literatureAdapter: LiteratureSearchAdapter }
  } = {}
  if (options.snapshotDirectory !== undefined) engine.snapshotDirectory = options.snapshotDirectory
  if (options.literatureAdapter !== undefined) engine.toolDeps = { literatureAdapter: options.literatureAdapter }
  ctx.provide('research', engine)
  const fiber = await ctx.plugin(ResearchTeamService, {})
  return {
    ctx,
    service: ctx.agentTeams as unknown as ResearchTeamService,
    engine,
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

  it('records the command before the run it names, so a crash between them cannot start a second study', async () => {
    // THE WINDOW THIS CLOSES. Written the other way round — the run first, the command record after
    // — a process that died between the two left a study on disk with nothing naming its command,
    // and the caller's retry, finding no record, started a SECOND one. The order is what makes the
    // retry able to find something; this test observes the order at the deployment's own seam.
    const root = snapshotRoot()
    const host = await boot({ snapshotDirectory: root })
    const commandId = 'command-order'
    const record = join(root, 'commands', `${commandId}.json`)
    // Every resolution of the deployment's directory, and whether the command's record was already
    // there when it happened.
    const recordExistedWhenRead: boolean[] = []
    Object.defineProperty(host.engine, 'snapshotDirectory', {
      configurable: true,
      get: () => {
        recordExistedWhenRead.push(existsSync(record))
        return root
      },
    })
    try {
      const started = await host.service.startRun({ commandId })
      expect(started.persisted).toBe(true)
      // THE RUN'S OWN WRITE RESOLVED THE DIRECTORY AFTER THE RECORD HAD LANDED. Under the reverse
      // order no resolution can see it: the record is written last, after every read.
      expect(recordExistedWhenRead).toContain(true)
      // ...and the retry lookup, which comes first, must find nothing for a command nobody has sent.
      expect(recordExistedWhenRead[0]).toBe(false)
      expect(existsSync(record)).toBe(true)
      await untilStopped(host.service, started.runId)
    } finally {
      await host.dispose()
    }
  })

  it('takes the command record back when the start it named did not happen', async () => {
    // THE PRICE OF THAT ORDER, paid here. The record lands before the run, so a start that then
    // fails has left a record naming a run nobody began — and a retry that met it would be refused
    // for good. It is removed where it was written, so the id is free again.
    const root = snapshotRoot()
    const host = await boot({ snapshotDirectory: root })
    const commandId = 'command-unwritten'
    const record = join(root, 'commands', `${commandId}.json`)
    const unwritable = join(snapshotRoot(), 'not-a-directory')
    writeFileSync(unwritable, 'not a directory')
    Object.defineProperty(host.engine, 'snapshotDirectory', {
      configurable: true,
      get: () => (existsSync(record) ? unwritable : root),
    })
    try {
      await expect(host.service.startRun({ commandId })).rejects.toThrow(/could not be recorded/u)
      // NOTHING IS LEFT, NEITHER HALF. The record was written (the test above proves the order) and
      // the run's own write failed, so what remains is neither a record nor a run.
      expect(existsSync(record)).toBe(false)
      expect(readdirSync(root)).toEqual(['commands'])

      // THE ID IS FREE AGAIN: the deployment is repaired and the same command starts the study.
      Object.defineProperty(host.engine, 'snapshotDirectory', { configurable: true, writable: true, value: root })
      const started = await host.service.startRun({ commandId })
      expect(started.persisted).toBe(true)
      expect(host.directoryEntries('commands')).toEqual([`${commandId}.json`])
      await untilStopped(host.service, started.runId)
    } finally {
      await host.dispose()
    }
  })

  it('reports a save that did not reach the disk, and refuses to call the run ready', async () => {
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

      void held.release()
      const reported = await untilPersistedError(host.service, started.runId)

      // THE FAILURE IS REPORTED WHERE SAVING IS REPORTED, while the run is still going, and it is
      // the deployment's OWN reason — not a summary this layer invented for it.
      expect(reported.runPersistence?.error ?? '').toMatch(/not a directory|ENOTDIR/iu)
      // AND IT REFUSES READINESS. "Ready" is a claim about material that exists and can be produced
      // again; material the deployment could not write is neither.
      expect(reported.submissionReady).toBe(false)
      expect(reported.readinessNote).toContain('last save did not reach the disk')
      await untilStopped(host.service, started.runId)
    } finally {
      void held.release()
      await host.dispose()
    }
  })

  it('refuses to decide a run the deployment could not save, and leaves the gate alone', async () => {
    // THE DECISION IS REFUSED WHERE THE RUN IS NOT. Reporting `persisted: false` after the fact was
    // the wrong place for this: the gate had already moved to `passed` in memory while the snapshot
    // still said `gated`, so a restart asked the person to approve what they already had. The run
    // here reaches the human gate with every write refused, which is what a full disk leaves.
    const root = snapshotRoot()
    const host = await boot({ snapshotDirectory: root })
    try {
      const started = await host.service.startRun({ commandId: 'command-unsaved' })
      // The deployment's save path stops working while the run is working, and stays that way: the
      // checkpoints fail, and so does the write the run ends with.
      const unwritable = join(snapshotRoot(), 'not-a-directory')
      writeFileSync(unwritable, 'not a directory')
      host.setSnapshotDirectory(unwritable)
      await untilStopped(host.service, started.runId)

      const reported = await host.service.runSnapshot({ runId: started.runId })
      const e2 = reported?.steps.find(step => step.stepId === 'E2-submit')
      expect(reported?.runPersistence?.error ?? '').toMatch(/not a directory|ENOTDIR/iu)
      expect(e2?.status).toBe('gated')
      expect(reported?.submissionReady).toBe(false)
      // THE RUN LEVEL SAYS WHAT THE STEPS CANNOT: the study reached the gate, and whatever was
      // going to finish recording it is gone. The write the run ends with is the one that threw.
      expect(reported?.execution).toBe('failed')
      expect(reported?.executionError ?? '').toMatch(/not a directory|ENOTDIR/iu)

      const refused = await submitApproval({
        runId: started.runId,
        stepId: 'E2-submit',
        attempt: e2?.attempt ?? -1,
        decision: 'approved',
        commandId: 'command-unsaved-approve',
        expectedProjectRevision: reported?.projectRevision ?? -1,
      })
      expect(refused.ok).toBe(false)
      expect(refused.ok ? '' : refused.error.code).toBe(APPROVAL_ERROR_CODES.saveFailed)
      // The reason is the DEPLOYMENT'S — the same one the page renders beside the failure.
      expect(refused.ok ? '' : refused.error.message).toMatch(/not a directory|ENOTDIR/iu)

      // NOTHING WAS DECIDED. The gate is where the reader left it, which is the difference between
      // a refusal and a decision that was applied and reported as not durable.
      const after = await host.service.runSnapshot({ runId: started.runId })
      expect(after?.steps.find(step => step.stepId === 'E2-submit')?.status).toBe('gated')
      expect(after?.submissionReady).toBe(false)
    } finally {
      await host.dispose()
    }
  })

  it('decides once the run’s own next write has landed', async () => {
    // THE RECOVERY, and why the refusal above is not a dead end. The fact is cleared by the run's
    // next durable write landing, and the refusal was never remembered — so the caller decides as
    // soon as the deployment can write the run again.
    //
    // The failure here is the run's OWN snapshot being unreadable: a store that cannot read what it
    // must base a write on cannot write. It is the failure that makes the recovery observable at
    // all — the repair lands while the run is still working — and it is a real one: a half-written
    // or damaged snapshot is the state the store's own read is there to refuse.
    const root = snapshotRoot()
    const host = await boot({ snapshotDirectory: root })
    try {
      const started = await host.service.startRun({ commandId: 'command-recovered' })
      const file = join(root, started.runId, 'research-run-snapshot.json')
      const readable = readFileSync(file)
      writeFileSync(file, '{"not":"a run"}')

      const failing = await untilPersistedError(host.service, started.runId)
      // STILL WORKING: the failure is the run's state while it runs, not only the epitaph of a run
      // that stopped.
      expect(failing.execution).toBe('running')
      expect(failing.submissionReady).toBe(false)

      // The deployment is repaired, and the run's own next write lands.
      writeFileSync(file, readable)
      await untilSaveLanded(host.service, started.runId)
      await untilStopped(host.service, started.runId)

      const reported = await host.service.runSnapshot({ runId: started.runId })
      expect(reported?.runPersistence?.error).toBeUndefined()
      const e2 = reported?.steps.find(step => step.stepId === 'E2-submit')
      expect(e2?.status).toBe('gated')

      const decided = await submitApproval({
        runId: started.runId,
        stepId: 'E2-submit',
        attempt: e2?.attempt ?? -1,
        decision: 'approved',
        commandId: 'command-recovered-approve',
        expectedProjectRevision: reported?.projectRevision ?? -1,
      })
      if (!decided.ok) throw new Error(`expected a decision, got ${decided.error.code}: ${decided.error.message}`)
      expect(decided.value.status).toBe('passed')
      expect(decided.value.persisted).toBe(true)
      const after = await host.service.runSnapshot({ runId: started.runId })
      expect(after?.steps.find(step => step.stepId === 'E2-submit')?.status).toBe('passed')
    } finally {
      await host.dispose()
    }
  })

  it('writes a run that could not be saved, without carrying the study out again', async () => {
    // THE REMEDY FOR A SAVE THAT DID NOT LAND. A run whose last write failed is not on disk, so a
    // restart loses it — and the one thing that must NOT be done about that is running the study
    // again: it has already cost what it cost, and a second execution would produce different
    // numbers under the same name. The retry writes the state this process holds.
    const root = snapshotRoot()
    const host = await boot({ snapshotDirectory: root })
    try {
      const started = await host.service.startRun({ commandId: 'command-retry-save' })
      const unwritable = join(snapshotRoot(), 'not-a-directory')
      writeFileSync(unwritable, 'not a directory')
      host.setSnapshotDirectory(unwritable)
      await untilStopped(host.service, started.runId)

      const broken = await host.service.runSnapshot({ runId: started.runId })
      const e2 = broken?.steps.find(step => step.stepId === 'E2-submit')
      expect(broken?.runPersistence?.error ?? '').toMatch(/not a directory|ENOTDIR/iu)
      // Everything about the study as it stands, to be compared after the retry.
      const before = broken?.steps.map(step => [step.stepId, step.attempt, step.status])
      expect(before?.length).toBe(STEP_EXECUTOR_REGISTRY.size)

      // A DECISION IS REFUSED WHILE THE RUN IS NOT ON DISK (the unit before this one).
      const refused = await submitApproval({
        runId: started.runId, stepId: 'E2-submit', attempt: e2?.attempt ?? -1,
        decision: 'approved', commandId: 'command-retry-save-1',
        expectedProjectRevision: broken?.projectRevision ?? -1,
      })
      expect(refused.ok ? '' : refused.error.code).toBe(APPROVAL_ERROR_CODES.saveFailed)

      // THE DEPLOYMENT IS REPAIRED AND THE WRITE IS RETRIED.
      host.setSnapshotDirectory(root)
      const retried = await host.service.retryRunSave({ runId: started.runId })
      expect(retried.persisted).toBe(true)
      expect(retried.snapshot.runPersistence?.error).toBeUndefined()
      expect(retried.snapshot.runPersistence?.revision ?? 0).toBeGreaterThan(0)
      // THE STUDY WAS NOT CARRIED OUT AGAIN: the same steps, at the same attempts, in the same
      // states — and still nothing driving it.
      expect(retried.snapshot.steps.map(step => [step.stepId, step.attempt, step.status])).toEqual(before)
      expect(retried.snapshot.execution).not.toBe('running')
      // ONE STUDY ON DISK, not a second one produced to make the write succeed.
      expect(readdirSync(root).filter(name => name !== 'commands')).toEqual([started.runId])

      // THE VERSION BINDING IS UNCHANGED BY THE RECOVERY, and that is the point of checking it here
      // rather than assuming a working save reopens the gate: a decision naming a revision the run
      // is not at is refused, exactly as it was before the write landed.
      const stale = await submitApproval({
        runId: started.runId, stepId: 'E2-submit', attempt: e2?.attempt ?? -1,
        decision: 'approved', commandId: 'command-retry-save-2',
        // A retry moves the SNAPSHOT's write counter, not the revision the study committed, so the
        // reader's revision is still current — this names one that is not, to show the check is live.
        expectedProjectRevision: (broken?.projectRevision ?? 0) - 1,
      })
      expect(stale.ok ? '' : stale.error.code).toBe(APPROVAL_ERROR_CODES.staleRevision)

      // The revision the reader had IS accepted, and the retry's own projection is where the page
      // re-reads it: the save moved the snapshot's counter and left the version the study is at.
      expect(retried.snapshot.projectRevision).toBe(broken?.projectRevision)
      const decided = await submitApproval({
        runId: started.runId, stepId: 'E2-submit', attempt: e2?.attempt ?? -1,
        decision: 'approved', commandId: 'command-retry-save-3',
        expectedProjectRevision: retried.snapshot.projectRevision,
      })
      if (!decided.ok) throw new Error(`expected a decision, got ${decided.error.code}: ${decided.error.message}`)
      expect(decided.value.status).toBe('passed')
      expect(decided.value.persisted).toBe(true)

      // THE DECISION IS ON DISK, read through a writer this test did not decide with.
      const reread = await createRunPersistence({ dir: join(root, started.runId) }).read()
      expect(reread.steps.find(step => step.stepId === 'E2-submit')?.status).toBe('passed')
    } finally {
      await host.dispose()
    }
  })

  it('lists the studies this deployment holds, including one a page never saw', async () => {
    // THE HANDLE A CLOSED PAGE LOSES. A run id lived in the tab that started the study, so closing
    // the page closed the only way back to it — while the study itself stayed on disk. This read is
    // what makes it findable by a browser that knows nothing about any run.
    const root = snapshotRoot()
    const held = barrier()
    const running = await boot({ literatureAdapter: held.adapter, snapshotDirectory: root })
    try {
      const started = await running.service.startRun({ commandId: 'command-listed-running' })
      await held.entered
      // A RUN STILL BEING DRIVEN IS LISTED FROM ITS LIVE STATE, not from a file it has not written.
      const entry = (await running.service.listRuns()).find(candidate => candidate.runId === started.runId)
      expect(entry?.execution).toBe('running')
      expect(entry?.stepsTotal).toBe(STEP_EXECUTOR_REGISTRY.size)
      void held.release()
      await untilStopped(running.service, started.runId)
    } finally {
      void held.release()
      await running.dispose()
    }

    // A STUDY THAT WENT FURTHER, so "3 of 16" is a fact the entry carries rather than a guess.
    let runId = ''
    const first = await boot({ snapshotDirectory: root })
    try {
      runId = (await first.service.startRun({ commandId: 'command-listed-whole' })).runId
      await untilStopped(first.service, runId)
      const entry = (await first.service.listRuns()).find(candidate => candidate.runId === runId)
      expect(entry?.execution).toBe('stopped')
      expect(entry?.stepsPassed ?? 0).toBeGreaterThan(0)
      expect(entry?.projectRevision).toBeGreaterThan(0)
      expect(entry?.submissionReady).toBe(false)
    } finally {
      await first.dispose()
    }

    // A DIFFERENT PROCESS THAT NEVER HEARD OF THE COMMAND still lists the study — the case the id's
    // home in one tab's storage could not serve.
    const second = await boot({ snapshotDirectory: root })
    try {
      const entry = (await second.service.listRuns()).find(candidate => candidate.runId === runId)
      expect(entry).toBeDefined()
      expect(entry?.execution).toBe('stopped')
      expect(entry?.stepsPassed ?? 0).toBeGreaterThan(0)
      expect(entry?.stepsTotal).toBe(STEP_EXECUTOR_REGISTRY.size)
    } finally {
      await second.dispose()
    }
  })

  it('refuses to retry the save of a run it does not hold', async () => {
    // A RUN READ BACK FROM DISK HAS NOTHING TO RETRY: it is already at the state its file records,
    // and re-running it is not a save. The refusal says which of the two the caller asked for.
    const root = snapshotRoot()
    const first = await boot({ snapshotDirectory: root })
    let runId = ''
    try {
      runId = (await first.service.startRun({ commandId: 'command-retry-unheld' })).runId
      await untilStopped(first.service, runId)
    } finally {
      await first.dispose()
    }

    const second = await boot({ snapshotDirectory: root })
    try {
      // The run IS findable through a query — the refusal is about where its state lives, not about
      // whether this deployment has it.
      expect(await second.service.runSnapshot({ runId })).not.toBeNull()
      await expect(second.service.retryRunSave({ runId })).rejects.toThrow(/holds no run/u)
    } finally {
      await second.dispose()
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

describe('a start command across a process boundary', () => {
  it('carries the command out after a crash between its record and its run', async () => {
    // WHAT A REAL CRASH LEAVES, AND WHAT A RETRY DOES WITH IT. The record lands before the run, so a
    // process that dies in between leaves a record naming a run that does not exist. Answering the
    // retry with that id hands the caller a study this deployment does not hold; refusing makes the
    // id unusable although nothing was started. The command is carried out instead — which is only
    // safe because no study was begun, and only knowable from the record's own `runStored`.
    //
    // A separate process, not an injected exception: the in-process failure path REMOVES the record
    // it wrote, so the state under test cannot be produced without dying for real.
    const root = snapshotRoot()
    const commandId = 'command-crashed'
    const killed = spawnSync(
      process.execPath,
      ['--import', 'tsx/esm', CRASH_FIXTURE, '--dir', root, '--command', commandId],
      { cwd: repoRoot, encoding: 'utf8' },
    )
    // THE DEATH IS THE SETUP, not a fixture failure: this process was killed at the seam, so a
    // non-zero status is what a working fixture looks like.
    expect(killed.status).not.toBe(0)

    // ...and this is the state it left, read off the DISK rather than from anything this process
    // holds: a record naming a run whose directory was never created.
    const crashed = JSON.parse(readFileSync(join(root, 'commands', `${commandId}.json`), 'utf8')) as { runId: string; runStored: boolean; commandId: string }
    expect(crashed.commandId).toBe(commandId)
    expect(crashed.runStored).toBe(false)
    expect(existsSync(join(root, crashed.runId))).toBe(false)

    // A RESTART: a service that has never heard of this command, over the same root.
    const host = await boot({ snapshotDirectory: root })
    try {
      const started = await host.service.startRun({ commandId })
      // IT RECOVERS, WITH A RUN THAT EXISTS — not the id the crashed attempt recorded.
      expect(started.persisted).toBe(true)
      expect(started.runId).not.toBe(crashed.runId)
      expect(await host.service.runSnapshot({ runId: started.runId })).not.toBeNull()
      // ONE STUDY, NOT TWO: the crashed attempt never wrote a run, and the only run on disk is the
      // one this command produced.
      expect(readdirSync(root).filter(name => name !== 'commands')).toEqual([started.runId])

      // AND THE RECORD NOW NAMES IT, so the retry after THIS one is answered rather than starting a
      // third study.
      const settled = JSON.parse(readFileSync(join(root, 'commands', `${commandId}.json`), 'utf8')) as { runId: string; runStored: boolean }
      expect(settled).toEqual(expect.objectContaining({ runId: started.runId, runStored: true }))
      const retried = await host.service.startRun({ commandId })
      expect(retried.runId).toBe(started.runId)
      expect(retried.persisted).toBe(true)
      expect(readdirSync(root).filter(name => name !== 'commands')).toEqual([started.runId])
      await untilStopped(host.service, started.runId)
    } finally {
      await host.dispose()
    }
  }, 180_000)
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
 * Wait until the run's last durable write has landed, or report that the repair came too late.
 *
 * The wait is on the run's OWN reported persistence — the same read the approval's precondition
 * performs — so a run that never stops reporting the failure is a run the approval would still
 * refuse. Stopping while it still reports one is the failure this function NAMES rather than
 * waiting out: it means the deployment was repaired after the run's final write, and then nothing
 * would ever write the run again.
 *
 * @param service - the service holding the run.
 * @param runId - the run to wait for.
 * @returns the snapshot that reported the write landing.
 */
async function untilSaveLanded(
  service: ResearchTeamService,
  runId: string,
): Promise<ResearchRunSnapshot> {
  for (;;) {
    const snapshot = await service.runSnapshot({ runId })
    if (snapshot === null) throw new Error(`the run '${runId}' disappeared while waiting for it`)
    if (snapshot.runPersistence?.error === undefined) return snapshot
    if (snapshot.execution !== 'running') {
      throw new Error(
        `the run '${runId}' stopped with its saves still failing: the deployment was repaired after `
        + `its final write, so nothing will write it again (${snapshot.runPersistence?.error})`,
      )
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

describe('the final package is exported by asking for one', () => {
  it('refuses the final package of a run nobody approved, writes the draft, and refuses an unheld run', async () => {
    const root = snapshotRoot()
    const packages = mkdtempSync(join(tmpdir(), 'dsh-packages-'))
    roots.push(packages)
    const host = await boot({ snapshotDirectory: root })
    host.engine.packageDirectory = packages
    try {
      const started = await host.service.startRun({ commandId: 'command-package' })
      await untilStopped(host.service, started.runId)

      // The drive's own export is the draft that already sits there, which is the state this test
      // then tries to publish as final.
      const manifestFile = join(packages, started.runId, 'run-manifest.json')
      expect(existsSync(manifestFile)).toBe(true)
      const beforeRefusal = readFileSync(manifestFile, 'utf8')

      // THE FINAL PACKAGE IS REFUSED IN THE OPERATION, not by hiding a control: a caller that never
      // saw a page is refused for the same reason. This run is under the evaluation profile and its
      // human gate has no decision, so the first condition named is the profile.
      await expect(host.service.exportRunPackageNow({ runId: started.runId, mode: 'final' }))
        .rejects.toThrow(/\[final-package-refused\] production-evidence/)
      // AND THE DRAFT IS UNTOUCHED: a refusal that had written anything, or emptied the directory on
      // its way out, would take away the package a reader still has.
      expect(readFileSync(manifestFile, 'utf8')).toBe(beforeRefusal)

      // THE DRAFT IS WRITTEN ANYWAY, labelled, with the same conditions in its manifest.
      const draft = await host.service.exportRunPackageNow({ runId: started.runId, mode: 'draft' })
      expect(draft.state).toBe('draft')
      expect(draft.files.length).toBeGreaterThan(0)
      expect(draft.checks?.filter(check => !check.passed).map(check => check.code))
        .toContain('production-evidence')
      const manifest = JSON.parse(
        readFileSync(join(packages, started.runId, 'run-manifest.json'), 'utf8'),
      ) as { state: string; checks: ReadonlyArray<{ code: string; passed: boolean }> }
      expect(manifest.state).toBe('draft')
      expect(manifest.checks.find(check => check.code === 'production-evidence')?.passed).toBe(false)
    } finally {
      await host.dispose()
    }

    // A RUN THIS PROCESS DOES NOT HOLD: a package is written from the state in memory, and a run read
    // back from its file is already at the state its file records.
    const second = await boot({ snapshotDirectory: root })
    second.engine.packageDirectory = packages
    try {
      await expect(second.service.exportRunPackageNow({ runId: 'no-such-run', mode: 'draft' }))
        .rejects.toThrow(/holds no run/)
    } finally {
      await second.dispose()
    }
  })
})

describe('a late arrival cannot rewrite what has already been published', () => {
  it('refuses a candidate written against the manuscript an acceptance replaced', async () => {
    // THE ORDER THAT MAKES A REQUEST STALE. A request records the sections it read and the hash each
    // one had. If a person accepts a candidate while another request is still open, that other
    // request's basis is now the PREVIOUS manuscript — and generating from it would publish text
    // answering a document nobody has, over the one that was just accepted. This is the "late
    // arrival" case at the operation level: nothing is racing, the state simply moved.
    const root = snapshotRoot()
    const host = await boot({ snapshotDirectory: root })
    try {
      const started = await host.service.startRun({ commandId: 'command-late-candidate' })
      await untilStopped(host.service, started.runId)
      host.engine.proseWriter = {
        channel: 'deterministic',
        write: () => Promise.resolve({
          text: 'Rewritten by this deployment deterministic route; no model was called.',
          provider: 'fixture',
          model: 'fixture',
        }),
      }

      // The first request is taken out and then LEFT OPEN while a second one is carried all the way.
      const open = await host.service.requestRevision({
        requestId: 'request-left-open', runId: started.runId, stepId: 'E2-submit',
        instruction: 'make the abstract shorter',
      })
      const carried = await host.service.requestRevision({
        requestId: 'request-carried', runId: started.runId, stepId: 'E2-submit',
        instruction: 'tighten the claim so it matches what was measured',
      })
      const candidate = (await host.service.generateCandidate({
        runId: started.runId, requestId: carried.requestId, candidateId: '',
      })).candidates[0]?.candidateId ?? ''
      await host.service.reviewCandidate({ runId: started.runId, requestId: carried.requestId, candidateId: candidate })
      await host.service.acceptCandidate({
        runId: started.runId, requestId: carried.requestId, candidateId: candidate,
        expectedRevision: carried.projectRevision, expectedManuscriptVersion: carried.manuscriptVersion,
      })

      // NOW THE OPEN REQUEST IS ANSWERED — against a manuscript that is no longer the one it read.
      await expect(host.service.generateCandidate({
        runId: started.runId, requestId: open.requestId, candidateId: '',
      })).rejects.toThrow(/revision-basis-stale/)
      // AND NOTHING WAS WRITTEN: the refusal happens before a candidate record exists, so the
      // accepted manuscript is the only one there is.
      const view = (await host.service.listRevisions({ runId: started.runId }))
        .find(entry => entry.requestId === open.requestId)
      expect(view?.candidates).toEqual([])
    } finally {
      await host.dispose()
    }
  })
})

describe('the research profile a run is conducted under', () => {
  it('is resolved at the start and frozen into the run, so reconfiguring does not change it', async () => {
    // WHAT DRIFT WOULD COST: a deployment reconfigured while a study is under way — another venue's
    // rules, another journal's requirements — would change what the manuscript is written for, mid-run,
    // with nothing on the run saying so. The profile therefore travels in the spec, the same way the
    // plan does, and the run's own file is what a restart reads.
    //
    // THE VENUE IS THE AXIS HERE, not the research type: the platoon study can only be conducted as a
    // simulation study (the driver refuses a type whose metrics do not include the study's quantity),
    // and a journal profile is a deployment fact that any study can be written for.
    const root = snapshotRoot()
    const first = await boot({ snapshotDirectory: root })
    first.engine.researchType = 'simulation-study'
    // THE JOURNAL PROFILE, as this deployment states it read the guide. The source is a stand-in and
    // says so: what the case exercises is a deployment that has read its guide, not what TRC requires —
    // no journal's rules are recorded in this repository.
    first.engine.journal = {
      id: 'trc',
      name: 'Transportation Research Part C: Emerging Technologies',
      rules: [{
        id: 'abstract-word-limit',
        statement: "the abstract is limited to the venue's stated maximum",
        source: 'https://example.invalid/author-guide (read 2026-09-17)',
        accessedAt: '2026-09-17',
        articleType: 'a stand-in article type, stated by this spec',
        verification: 'verified',
        detail: 'a stand-in, so the case exercises the gate rather than a journal',
      }],
    }
    let runId = ''
    try {
      runId = (await first.service.startRun({ commandId: 'command-profile' })).runId
      await untilStopped(first.service, runId)
    } finally {
      await first.dispose()
    }

    interface FrozenProfile {
      readonly researchType: string
      readonly journal: { readonly rules: ReadonlyArray<{ readonly id: string }> }
      readonly metrics: { readonly required: ReadonlyArray<{ readonly key: string }> }
    }
    const specOf = (): { researchProfile?: FrozenProfile } =>
      (JSON.parse(readFileSync(join(root, runId, 'research-run-snapshot.json'), 'utf8')) as {
        run: { spec: { researchProfile?: FrozenProfile } }
      }).run.spec

    // FROZEN AS CONFIGURED: the venue's rule, and the study's own metrics.
    const frozen = specOf().researchProfile
    expect(frozen?.researchType).toBe('simulation-study')
    expect(frozen?.journal.rules.map(rule => rule.id)).toEqual(['abstract-word-limit'])
    // THE TYPE-LEVEL VIEW, which is what the profile carries: with two simulation studies it names
    // both quantities, and the run's own metrics are read off its study at the package (see
    // `package-export.spec.ts`).
    expect(frozen?.metrics.required.map(metric => metric.key))
      .toEqual(['min-ttc-seconds', 'string-stability-index', 'p95-latency-ms'])

    // AND A LATER CONFIGURATION DOES NOT MOVE IT. A second deployment on the same directory is
    // configured with the shipped, rule-free profile — which is exactly what a reconfiguration looks
    // like from the run's side.
    const second = await boot({ snapshotDirectory: root })
    try {
      await second.service.openStoredRun({ runId })
      expect(specOf().researchProfile?.journal.rules.map(rule => rule.id))
        .toEqual(['abstract-word-limit'])
    } finally {
      await second.dispose()
    }
  })

  it('refuses a research type this build does not know, at the start of the run', async () => {
    // MISCONFIGURATION FAILS WHERE IT CAN STILL BE FIXED, not at the step that happens to read it.
    const root = snapshotRoot()
    const host = await boot({ snapshotDirectory: root })
    host.engine.researchType = 'field-trial'
    try {
      await expect(host.service.startRun({ commandId: 'command-bad-profile' }))
        .rejects.toThrow(/not a research type this build knows/)
    } finally {
      await host.dispose()
    }
  })
})

describe('a decision a person made survives the process that took it', () => {
  it('reads back as an approval that still covers the manuscript, until the manuscript moves', async () => {
    // TWO OPPOSITE FAILURES, ONE TEST. An approval a restart forgets asks the person to decide again;
    // an approval that outlives what it approved lets a manuscript nobody read be published under a
    // decision about another one. The decision is taken in its OWN PROCESS, and this spec reads what
    // survives — the run's own record, and what the export operation makes of it.
    const root = snapshotRoot()
    const packages = mkdtempSync(join(tmpdir(), 'dsh-approve-packages-'))
    roots.push(packages)
    const decided = spawnSync(
      process.execPath,
      ['--import', 'tsx/esm', APPROVE_FIXTURE, '--dir', root],
      { cwd: repoRoot, encoding: 'utf8' },
    )
    expect(decided.stderr).not.toMatch(/approve-and-exit: /)
    expect(decided.status).toBe(0)
    // The fixture prints one JSON line; startup output precedes it.
    const lines = decided.stdout.trim().split(/\r?\n/u)
    const receipt = JSON.parse(lines[lines.length - 1] ?? '{}') as {
      runId: string
      status: string
      decision: string
      persisted: boolean
    }
    expect(receipt.decision).toBe('approved')
    expect(receipt.status).toBe('passed')
    expect(receipt.persisted).toBe(true)

    const next = await boot({ snapshotDirectory: root })
    next.engine.packageDirectory = packages
    try {
      // NOT FORGOTTEN: the gate is still passed in the new process, and the run is loadable at all.
      const snapshot = await next.service.runSnapshot({ runId: receipt.runId })
      expect(snapshot?.steps.find(step => step.stepId === 'E2-submit')?.status).toBe('passed')

      // A PACKAGE IS WRITTEN FROM THE STATE IN MEMORY, so the new deployment takes the study back
      // first — the same act a page performs before it can decide anything about it.
      await next.service.openStoredRun({ runId: receipt.runId })

      // AND THE DECISION REACHES THE PACKAGE DECISION: `approval-recorded` and `approval-current`
      // hold, which is what "the approval still binds the version it was made about" means in the
      // operation a person actually asks. The only unmet condition is the evidence profile.
      const first = await next.service.exportRunPackageNow({ runId: receipt.runId, mode: 'draft' })
      const checks = new Map((first.checks ?? []).map(check => [check.code, check.passed]))
      expect(checks.get('approval-recorded')).toBe(true)
      expect(checks.get('approval-current')).toBe(true)
      // TWO CONDITIONS, AND THE SECOND IS NEW: the evidence profile (this deployment is evaluation)
      // and the review — the offline route takes one round and the default policy requires two. A
      // package written before this condition existed would have called itself final here.
      // THREE CONDITIONS, AND THE THIRD IS THE JOURNAL'S OWN. The evidence profile (this deployment
      // is evaluation), the review (the offline route took one round and the default policy requires
      // two), and the target journal's requirements — which A4 records as the questions its guide
      // answers, every one unknown, because nobody has read it. A manuscript measured against an
      // invented word limit would read as compliant while being measured against nothing.
      expect([...(first.checks ?? [])].filter(check => !check.passed).map(check => check.code))
        .toEqual(['production-evidence', 'review-complete', 'journal-rules-verified'])

      // NOW MOVE THE MANUSCRIPT, the way a person accepting a revision would: the approval was made
      // about the version E1 wrote, and this is a different one. The binding is only real if the
      // check notices — otherwise `approval-current` is a field that always says yes.
      next.engine.proseWriter = {
        channel: 'deterministic',
        write: () => Promise.resolve({
          text: 'Rewritten by this deployment deterministic route; no model was called.',
          provider: 'fixture',
          model: 'fixture',
        }),
      }
      const request = await next.service.requestRevision({
        requestId: 'request-after-approval',
        runId: receipt.runId,
        stepId: 'E2-submit',
        instruction: 'tighten the claim so it matches what was measured',
      })
      const generated = await next.service.generateCandidate({
        runId: receipt.runId, requestId: request.requestId, candidateId: '',
      })
      const candidateId = generated.candidates[0]?.candidateId ?? ''
      const reviewed = await next.service.reviewCandidate({
        runId: receipt.runId, requestId: request.requestId, candidateId,
      })
      expect(reviewed.reviews[0]?.passed).toBe(true)
      await next.service.acceptCandidate({
        runId: receipt.runId,
        requestId: request.requestId,
        candidateId,
        expectedRevision: request.projectRevision,
        expectedManuscriptVersion: request.manuscriptVersion,
      })

      const second = await next.service.exportRunPackageNow({ runId: receipt.runId, mode: 'draft' })
      const moved = new Map((second.checks ?? []).map(check => [check.code, check.passed]))
      expect(moved.get('approval-recorded')).toBe(true)
      // THE APPROVAL IS STILL ON RECORD AND NO LONGER ABOUT THIS MANUSCRIPT.
      expect(moved.get('approval-current')).toBe(false)
      const stale = (second.checks ?? []).find(check => check.code === 'approval-current')
      expect(stale?.detail).toContain('changed after the decision')
    } finally {
      await next.dispose()
    }
  })
})

describe('a run the production profile published', () => {
  it('exports the FINAL package once a person has approved it', async () => {
    // THE SUCCESS PATH THE WHOLE SYSTEM EXISTS FOR, and the one that had no reading: a run conducted
    // under the production profile, whose manuscript a person approved, exported as the package a
    // journal is handed. Every other case here asserts a REFUSAL, and a set of refusals that all hold
    // is also what a pipeline that can never succeed looks like — the two are told apart only by
    // running this one.
    //
    // The decision is taken in its OWN PROCESS (the fixture), so nothing this spec holds stands in
    // for the disk, and the profile is stated there the way a `cordis.yml` states it.
    const root = snapshotRoot()
    const packages = mkdtempSync(join(tmpdir(), 'dsh-final-packages-'))
    roots.push(packages)
    const decided = spawnSync(
      process.execPath,
      // THE RUN'S OWN POLICY: the offline route takes one revision round, so the deployment that
      // conducts it states one — the review is evaluated where the rounds are taken, and a later
      // process cannot re-state what happened.
      ['--import', 'tsx/esm', APPROVE_FIXTURE, '--dir', root, '--profile', 'production', '--review-rounds', '1', '--verify', '--venue-rules-read'],
      { cwd: repoRoot, encoding: 'utf8' },
    )
    expect(decided.stderr).not.toMatch(/approve-and-exit: /)
    expect(decided.status).toBe(0)
    const lines = decided.stdout.trim().split(/\r?\n/u)
    const receipt = JSON.parse(lines[lines.length - 1] ?? '{}') as { runId: string; decision: string }
    expect(receipt.decision).toBe('approved')

    const next = await boot({ snapshotDirectory: root })
    next.engine.packageDirectory = packages
    try {
      // A PACKAGE IS WRITTEN FROM THE STATE IN MEMORY, so the deployment takes the study back first.
      // THE PROFILE IS THE DEPLOYMENT'S, READ WHERE THE EXPORT HAPPENS: the process that approved
      // the run stated `production`, and this process must state the same or it refuses its own
      // package as material that may not be published — which is the check doing its job.
      next.engine.evidenceProfile = 'production'
      // THE JOURNAL'S REQUIREMENTS ARE NOT RESTATED HERE, and that is the point: the process that
      // CONDUCTED the run stated that it had read its guide (`--venue-rules-read`), A4 wrote that
      // record onto the venue artifact, and this process reads what the run holds. An export that
      // could supply the rules itself would let a later process publish under rules the run never had.
      await next.service.openStoredRun({ runId: receipt.runId })
      const written = await next.service.exportRunPackageNow({ runId: receipt.runId, mode: 'final' })
      // EVERY CONDITION, not the state alone: a `final` package whose checks did not all pass would be
      // the state field claiming something the conditions do not support.
      expect((written.checks ?? []).filter(check => !check.passed).map(check => check.code)).toEqual([])
      expect(written.state).toBe('final')
      // AND IT IS ON DISK, as the state — and the readiness — the reader of a manifest sees, rather
      // than only as a result this process computed.
      const manifestPath = join(packages, `${receipt.runId}/run-manifest.json`)
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        state: string
        submissionReady: boolean
        approval?: { decision: string }
      }
      expect(manifest.state).toBe('final')
      expect(manifest.submissionReady).toBe(true)
      expect(manifest.approval?.decision).toBe('approved')
    } finally {
      await next.dispose()
    }
  })
})

describe('a manuscript whose review did not finish', () => {
  it('is exportable as a draft and refused as the package a journal receives', async () => {
    // THE FLOOR, ON THE PRODUCTION PATH. The same approved production run, held to the DEFAULT policy
    // of two complete readings: the offline route took one, so the package is a draft and the
    // condition that refuses it names why — "a final revision that was not re-reviewed is refused", in
    // the form this route can reach.
    const root = snapshotRoot()
    const packages = mkdtempSync(join(tmpdir(), 'dsh-review-floor-'))
    roots.push(packages)
    const decided = spawnSync(
      process.execPath,
      // THE RUN'S OWN POLICY: the offline route takes one revision round, so the deployment that
      // conducts it states one — the review is evaluated where the rounds are taken, and a later
      // process cannot re-state what happened.
      ['--import', 'tsx/esm', APPROVE_FIXTURE, '--dir', root, '--profile', 'production'],
      { cwd: repoRoot, encoding: 'utf8' },
    )
    expect(decided.status).toBe(0)
    const lines = decided.stdout.split('\n').map(part => part.trim()).filter(part => part.length > 0)
    const receipt = JSON.parse(lines[lines.length - 1] ?? '{}') as { runId: string }

    const next = await boot({ snapshotDirectory: root })
    next.engine.packageDirectory = packages
    next.engine.evidenceProfile = 'production'
    try {
      await next.service.openStoredRun({ runId: receipt.runId })
      const draft = await next.service.exportRunPackageNow({ runId: receipt.runId, mode: 'draft' })
      const refused = (draft.checks ?? []).find(check => check.code === 'review-complete')
      expect(refused?.passed).toBe(false)
      expect(refused?.detail).toContain('complete review round(s)')
      expect(draft.state).toBe('draft')
      // AND THE FINAL EXPORT IS REFUSED, naming the same condition rather than a different one.
      await expect(next.service.exportRunPackageNow({ runId: receipt.runId, mode: 'final' }))
        .rejects.toThrow(/review-complete/)
    } finally {
      await next.dispose()
    }
  })
})

describe('what a process accepted, the next process reads off the disk', () => {
  it('loads the run a person published a manuscript in, and lists it, after the accepting process is gone', async () => {
    // THE CLASS OF DEFECT THIS EXISTS FOR. Everything about an acceptance can pass in the process that
    // made it and mean nothing afterwards: the registry is replaced in memory, the record is written,
    // the receipt says `persisted: true` — and the NEXT process refuses to load the run, because the
    // snapshot writer recorded a producer the snapshot READER did not know. That is exactly what
    // happened: `human-acceptance` is not a step of the pipeline, the reader rejected it, `listRuns`
    // threw with it, and a study that had been accepted became unreadable at the first restart.
    //
    // The accepting half runs in its OWN PROCESS (the fixture), so nothing this spec holds can stand
    // in for the disk. What it asserts is what a new deployment finds: the run lists, it loads, the
    // manuscript is the accepted one, and the record on disk names the same candidate.
    const root = snapshotRoot()
    const accepted = spawnSync(
      process.execPath,
      ['--import', 'tsx/esm', ACCEPT_FIXTURE, '--dir', root],
      { cwd: repoRoot, encoding: 'utf8' },
    )
    // A NON-ZERO EXIT IS A FAILURE HERE, unlike the crash fixture: this process is supposed to finish
    // its work and end, so anything else means the acceptance never happened.
    expect(accepted.stderr).not.toMatch(/accept-and-exit: /)
    expect(accepted.status).toBe(0)
    // The fixture prints one JSON line; anything before it is startup output.
    const lines = accepted.stdout.trim().split(/\r?\n/u)
    const reported = JSON.parse(lines[lines.length - 1] ?? '{}') as {
      runId: string
      candidateId: string
      acceptance: { manuscriptVersion: number; persisted: boolean } | null
    }
    expect(reported.acceptance?.persisted).toBe(true)
    expect(reported.acceptance?.manuscriptVersion).toBeGreaterThan(1)

    const next = await boot({ snapshotDirectory: root })
    try {
      // LISTED: this is the call that threw when the parser refused the producer, and a page asking
      // for the studies a deployment holds got nothing back.
      const listed = await next.service.listRuns()
      expect(listed.map(entry => entry.runId)).toContain(reported.runId)
      expect(listed.find(entry => entry.runId === reported.runId)?.execution).toBe('stopped')

      // LOADED, with the manuscript a person published: the version moved past the one E1 wrote, and
      // the producer names the person rather than a step.
      const snapshot = await next.service.runSnapshot({ runId: reported.runId })
      // THE MANUSCRIPT A PERSON PUBLISHED, named by the producer rather than by a step: E1 wrote the
      // first one, and this one is not its.
      const manuscript = snapshot?.artifacts.find(artifact => artifact.slug === 'formatted-manuscript')
      expect(manuscript?.producerStepId).toBe('human-acceptance')

      // THE RECORD ON DISK AGREES, and the text it published is the text in the manuscript.
      const record = JSON.parse(
        readFileSync(join(root, 'revisions', 'request-accept-and-exit', 'acceptance.json'), 'utf8'),
      ) as { candidateId: string; manuscriptVersion: number; persisted: boolean }
      expect(record.candidateId).toBe(reported.candidateId)
      expect(record.manuscriptVersion).toBe(reported.acceptance?.manuscriptVersion)
      expect(record.persisted).toBe(true)
      const onDisk = JSON.parse(readFileSync(join(root, reported.runId, 'research-run-snapshot.json'), 'utf8')) as {
        registry: Record<string, { producerStepId: string; ref: { version: number } }>
      }
      expect(onDisk.registry['formatted-manuscript']?.producerStepId).toBe('human-acceptance')
      expect(onDisk.registry['formatted-manuscript']?.ref.version).toBe(reported.acceptance?.manuscriptVersion)
    } finally {
      await next.dispose()
    }
  })
})

describe('a study a previous process left is taken back before it can be decided', () => {
  /**
   * A run this process does not hold cannot be decided — the approval refuses it, which is the
   * right rule and the reason this operation exists: without it a study that reached the human gate
   * and survived a restart could be found, read, and never decided.
   */
  it('adopts a stored run, and only then can a decision be taken on it', async () => {
    const root = snapshotRoot()
    const first = await boot({ snapshotDirectory: root })
    let runId = ''
    try {
      runId = (await first.service.startRun({ commandId: 'command-adopt' })).runId
      await untilStopped(first.service, runId)
    } finally {
      await first.dispose()
    }

    const second = await boot({ snapshotDirectory: root })
    try {
      // BEFORE ADOPTION the run is readable and not held: the snapshot answers, the report says
      // `stopped`, and nothing in this process would write a decision into it.
      const before = await second.service.runSnapshot({ runId })
      expect(before?.execution).toBe('stopped')

      const adopted = await second.service.openStoredRun({ runId })
      // ADOPTION DRIVES NOTHING: the run is reported exactly as it stands, and the step states are
      // the ones on disk rather than the ones a re-drive would have produced.
      expect(adopted.execution).toBe('stopped')
      expect(adopted.run.steps.map(step => step.status))
        .toEqual(before?.run.steps.map(step => step.status))
      // The revision a decision would be taken against is the one the disk holds.
      expect(adopted.projectRevision).toBe(before?.projectRevision)

      // ADOPTING TWICE IS REFUSED: the second call would replace the state a reader is watching
      // with a copy of what was on disk, and a decision taken meanwhile would be lost with it.
      await expect(second.service.openStoredRun({ runId })).rejects.toThrow(/already holds/)
      // A run this deployment has never stored cannot be adopted into existence.
      await expect(second.service.openStoredRun({ runId: 'no-such-run' })).rejects.toThrow(/holds no run/)
    } finally {
      await second.dispose()
    }
  })
})
