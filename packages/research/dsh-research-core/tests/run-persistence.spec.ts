/**
 * Tests for run persistence: capture, record validation, restore, the revision guard,
 * capability re-attachment and replay protection.
 *
 * Every case here runs inside ONE process and covers the module's branches. The process
 * boundary itself is covered by tests/run-recovery.spec.ts, which drives the same module
 * from two real child processes over one snapshot file.
 *
 * All runs are fixtures: seeded inputs, artifact values and approval ids are literals.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  RUN_SNAPSHOT_ERROR_CODES,
  RUN_SNAPSHOT_SCHEMA_VERSION,
  SnapshotConflictError,
  SnapshotInvalidError,
  captureRunSnapshot,
  createRunPersistence,
  parseRunSnapshotPayload,
  restoreRun,
} from '../src/run-persistence.ts'
import type { RunPersistence, RunSnapshotPayload } from '../src/run-persistence.ts'
import {
  SNAPSHOT_ERROR_CODES,
  SNAPSHOT_FILE_NAME,
  SnapshotCorruptError,
  SnapshotNotFoundError,
  SnapshotVersionError,
} from '../src/snapshot-store.ts'
import {
  canStart,
  completeStep,
  getArtifact,
  getRunSnapshot,
  recordArtifact,
  rollback,
  startStep,
  submitGateVerdict,
} from '../src/engine/state-machine.ts'
import { runStep } from '../src/engine/pipeline.ts'
import type { ResearchRunStore } from '../src/engine/types.ts'
import { _resetApprovalChannelForTests, createHostApprovalChannel } from '../src/host.ts'
import { abstainVerdict, freshStore, passStep, runFullPipeline, seedRun, verdict } from './helpers.ts'

const RUN_ID = 'run-p5-fixture'

let dir: string
let persistence: RunPersistence

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-run-persistence-'))
  persistence = createRunPersistence({ dir })
  _resetApprovalChannelForTests()
})

afterEach(async () => {
  _resetApprovalChannelForTests()
  await rm(dir, { recursive: true, force: true })
})

/** A capability of the kind that must live only in the running process, never in the file. */
interface FixtureCapability {
  readonly marker: string
  readonly execute: (slug: string) => string
}

function freshCapability(): FixtureCapability {
  return { marker: 'FIXTURE-CAPABILITY-MARKER', execute: (slug: string) => `produced:${slug}` }
}

function requireRun(store: ResearchRunStore, runId: string) {
  const run = store.get(runId)
  if (run === undefined) throw new Error(`fixture: run '${runId}' missing from its store`)
  return run
}

/** Return the value a synchronous call threw, or undefined when it returned. */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn()
    return undefined
  } catch (error) {
    return error
  }
}

async function snapshotFile(): Promise<string> {
  return readFile(join(dir, SNAPSHOT_FILE_NAME), { encoding: 'utf8' })
}

/** The first persisted step record of a payload read back from the file. */
function firstStep(raw: Record<string, unknown>): Record<string, unknown> {
  const steps = raw['steps']
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('fixture: expected the tampered payload to hold at least one step')
  }
  return steps[0] as Record<string, unknown>
}

/** Save a valid snapshot, then hand each case the parsed record to tamper with. */
async function writeTampered(mutate: (raw: Record<string, unknown>) => void): Promise<void> {
  const store = freshStore()
  const runId = seedRun(store, RUN_ID)
  passStep(store, runId, 'A1-landscape')
  await persistence.save(store, runId, { baseRevision: 0 })
  const raw = JSON.parse(await snapshotFile()) as Record<string, unknown>
  mutate(raw)
  await writeFile(join(dir, SNAPSHOT_FILE_NAME), JSON.stringify(raw), { encoding: 'utf8' })
}

describe('one writer per run, across processes', () => {
  it('REFUSES a save while another writer holds the lock', async () => {
    // The revision guard is a read-then-write and two PROCESSES can both pass it. Measured: the
    // same contention probe reported "at most one writer" on one run and "BOTH writers succeeded"
    // on the next, with no change to either process — so the guard held only when the two windows
    // happened to overlap. The read-compare-write is now serialized on a lock file, and this is
    // the refusal a second writer gets while the first holds it.
    const store = freshStore()
    const runId = seedRun(store, RUN_ID)
    await persistence.save(store, runId, { baseRevision: 0 })

    // Stand in for the other process by holding its lock.
    const lock = join(dir, '.save.lock')
    await writeFile(lock, '', 'utf8')
    await expect(persistence.save(store, runId, { baseRevision: 1 }))
      .rejects.toMatchObject({ code: 'SNAPSHOT_CONFLICT' })
    // ...and the file was NOT touched by the refused writer.
    expect((await persistence.read()).revision).toBe(1)
    await rm(lock, { force: true })

    // With the lock released the same write goes through, so the refusal was about the lock.
    expect((await persistence.save(store, runId, { baseRevision: 1 })).revision).toBe(2)
  }, 20_000)

  it('re-takes a lock left behind by a process that died holding it', async () => {
    // A lock file is the one thing a crash can leave that would otherwise make a run permanently
    // unsaveable. An old one is treated as a corpse, not as a writer.
    const store = freshStore()
    const runId = seedRun(store, RUN_ID)
    const lock = join(dir, '.save.lock')
    await writeFile(lock, '', 'utf8')
    const old = new Date(Date.now() - 120_000)
    const { utimes } = await import('node:fs/promises')
    await utimes(lock, old, old)

    expect((await persistence.save(store, runId, { baseRevision: 0 })).revision).toBe(1)
  })
})

describe('run-persistence: capture and restore', () => {
  it('restores a mid-run as state equal to the run that was saved', async () => {
    const store = freshStore()
    const runId = seedRun(store, RUN_ID)
    for (const stepId of ['A1-landscape', 'A2-claim', 'A3-agenda', 'A4-venue', 'B1-method']) {
      passStep(store, runId, stepId)
    }
    startStep(store, runId, 'B2-data')
    const failed = await runStep(store, runId, 'B2-data', {
      executor: () => {
        throw new Error('fixture: retrieval channel unavailable')
      },
    })
    expect(failed.status).toBe('error')

    const written = await persistence.save(store, runId, { baseRevision: 0 })
    expect(written.revision).toBe(1)

    // A fresh persistence object over the same directory — no shared state with the writer.
    const reopened = createRunPersistence({ dir })
    const capability = freshCapability()
    const restored = await reopened.load(capability)

    expect(restored.runId).toBe(runId)
    expect(restored.revision).toBe(1)
    expect(restored.capability).toBe(capability)
    expect(getRunSnapshot(restored.store, runId)).toEqual(getRunSnapshot(store, runId))
    for (const slug of Object.keys(getRunSnapshot(store, runId).registry)) {
      expect(getArtifact(restored.store, runId, slug)).toEqual(getArtifact(store, runId, slug))
    }
    expect(restored.interrupted).toEqual([
      { stepId: 'B2-data', attemptId: 1, executed: true, resumeVia: 'rollback_and_retry' },
    ])
    expect(getRunSnapshot(restored.store, runId).steps['B2-data']?.status).toBe('in_progress')
  })

  it('restores a step interrupted with no attempt landed as rollback_and_retry', async () => {
    const store = freshStore()
    const runId = seedRun(store, RUN_ID)
    passStep(store, runId, 'A1-landscape')
    startStep(store, runId, 'A2-claim')
    await persistence.save(store, runId, { baseRevision: 0 })

    const restored = await createRunPersistence({ dir }).load(freshCapability())
    expect(restored.interrupted).toEqual([
      { stepId: 'A2-claim', attemptId: 1, executed: false, resumeVia: 'rollback_and_retry' },
    ])
  })

  it('classifies an executed but ungated attempt as continue_gate and lets the gate finish', async () => {
    const store = freshStore()
    const runId = seedRun(store, RUN_ID)
    passStep(store, runId, 'A1-landscape')
    startStep(store, runId, 'A2-claim')
    const res = await runStep(store, runId, 'A2-claim', {
      executor: () => ({ claim: 'fixture-claim', 'falsifiable-prediction': 'fixture-prediction' }),
    })
    expect(res.status).toBe('success')
    await persistence.save(store, runId, { baseRevision: 0 })

    const restored = await createRunPersistence({ dir }).load(freshCapability())
    expect(restored.interrupted).toEqual([
      { stepId: 'A2-claim', attemptId: 1, executed: true, resumeVia: 'continue_gate' },
    ])
    // The resumed run continues through the gate only — the attempt is not re-executed.
    submitGateVerdict(restored.store, runId, 'A2-claim', verdict('A', true))
    expect(submitGateVerdict(restored.store, runId, 'A2-claim', verdict('C', true))).toBe('passed')
    expect(getArtifact(restored.store, runId, 'claim')).toBe('fixture-claim')
  })

  it('preserves an abstention hold across restore', async () => {
    const store = freshStore()
    const runId = seedRun(store, RUN_ID)
    startStep(store, runId, 'A1-landscape')
    recordArtifact(store, runId, 'A1-landscape', 'landscape-map', 'fixture-landscape-map')
    recordArtifact(store, runId, 'A1-landscape', 'gap-list', 'fixture-gap-list')
    expect(submitGateVerdict(store, runId, 'A1-landscape', abstainVerdict('B'))).toBe('gated')
    await persistence.save(store, runId, { baseRevision: 0 })

    const restored = await createRunPersistence({ dir }).load(freshCapability())
    const step = getRunSnapshot(restored.store, runId).steps['A1-landscape']
    expect(step?.status).toBe('gated')
    expect(step?.holdReason).toBe('gate_abstained')
    expect(step?.gateResults['B']?.outcome).toBe('abstained')
    expect(restored.interrupted).toEqual([])
    // The restored hold is still a hold: the gate refuses a second verdict for the component.
    expect(thrownBy(() => submitGateVerdict(restored.store, runId, 'A1-landscape', verdict('B', true))))
      .toMatchObject({ code: 'DSH_VERDICT_ALREADY_SET' })
  })

  it('preserves superseded attempt history and the audit log', async () => {
    const store = freshStore()
    const runId = seedRun(store, RUN_ID)
    passStep(store, runId, 'A1-landscape')
    rollback(store, runId, 'A1-landscape')
    passStep(store, runId, 'A1-landscape')
    // Second rollback, not re-started: the record now holds a step with no attempt timestamps.
    rollback(store, runId, 'A1-landscape')
    await persistence.save(store, runId, { baseRevision: 0 })

    const restored = await createRunPersistence({ dir }).load(freshCapability())
    const before = getRunSnapshot(store, runId)
    const after = getRunSnapshot(restored.store, runId)
    expect(after.steps['A1-landscape']?.history).toEqual(before.steps['A1-landscape']?.history)
    expect(after.steps['A1-landscape']?.history).toHaveLength(2)
    expect(after.steps['A1-landscape']?.status).toBe('pending')
    expect(after.steps['A1-landscape']?.startedAt).toBeUndefined()
    expect(after.steps['A1-landscape']?.finishedAt).toBeUndefined()
    expect(after.events).toEqual(before.events)
    expect(after.events.some(e => e.kind === 'rollback')).toBe(true)
  })

  it('restores an approval rationale carried by the record', async () => {
    const store = freshStore()
    const runId = runFullPipeline(store, RUN_ID)
    const host = createHostApprovalChannel('fixture-host-secret')
    host.registerPrincipal('fixture-operator')
    host.submit(
      store,
      runId,
      'E2-submit',
      'approved',
      host.mintPrincipal(runId, 'E2-submit', 'fixture-operator', 'fixture-rationale-1'),
    )
    await persistence.save(store, runId, { baseRevision: 0 })

    const raw = JSON.parse(await snapshotFile()) as { steps: Array<Record<string, unknown>> }
    const e2 = raw.steps.find(step => step['stepId'] === 'E2-submit')
    if (e2 === undefined) throw new Error('fixture: E2-submit missing from the record')
    ;(e2['approval'] as Record<string, unknown>)['rationale'] = 'fixture rationale recorded by the approver'
    await writeFile(join(dir, SNAPSHOT_FILE_NAME), JSON.stringify(raw), { encoding: 'utf8' })

    const restored = await createRunPersistence({ dir }).load(freshCapability())
    const step = getRunSnapshot(restored.store, runId).steps['E2-submit']
    expect(step?.status).toBe('passed')
    expect(step?.approval?.rationale).toBe('fixture rationale recorded by the approver')
  })

  it('separates "an execution record exists" from "the execution succeeded"', async () => {
    const store = freshStore()
    const runId = seedRun(store, RUN_ID)
    passStep(store, runId, 'A1-landscape')
    startStep(store, runId, 'A2-claim')
    await runStep(store, runId, 'A2-claim', {
      executor: () => {
        throw new Error('fixture: executor failed')
      },
    })
    await persistence.save(store, runId, { baseRevision: 0 })

    // A `step-executed` record whose disposition is not a string resumes as rollback_and_retry —
    // the record exists, but nothing about it says the attempt produced artifacts.
    const raw = JSON.parse(await snapshotFile()) as { events: Array<Record<string, unknown>> }
    const executed = raw.events.find(event => event['kind'] === 'step-executed')
    if (executed === undefined) throw new Error('fixture: no step-executed event in the record')
    executed['detail'] = {}
    await writeFile(join(dir, SNAPSHOT_FILE_NAME), JSON.stringify(raw), { encoding: 'utf8' })

    const restored = await createRunPersistence({ dir }).load(freshCapability())
    expect(restored.interrupted).toEqual([
      { stepId: 'A2-claim', attemptId: 1, executed: true, resumeVia: 'rollback_and_retry' },
    ])
  })
})

describe('run-persistence: a restored run continues, completed steps do not re-run', () => {
  it('refuses to start or execute a restored passed step, then drives the interrupted one', async () => {
    const store = freshStore()
    const runId = seedRun(store, RUN_ID)
    passStep(store, runId, 'A1-landscape')
    passStep(store, runId, 'A2-claim')
    startStep(store, runId, 'A3-agenda')
    await persistence.save(store, runId, { baseRevision: 0 })

    const capability = freshCapability()
    let executions = 0
    const executor = (): Record<string, unknown> => {
      executions += 1
      return { agenda: capability.execute('agenda'), 'contribution-list': capability.execute('contribution-list') }
    }

    const restored = await createRunPersistence({ dir }).load(capability)
    expect(restored.capability).toBe(capability)

    // Already-passed steps: not startable, and their executor is never invoked.
    expect(canStart(restored.store, runId, 'A1-landscape')).toBe(false)
    expect(thrownBy(() => startStep(restored.store, runId, 'A1-landscape'))).toMatchObject({ code: 'DSH_CANNOT_START' })
    expect(thrownBy(() => runStep(restored.store, runId, 'A1-landscape', { executor }))).toMatchObject({
      code: 'DSH_NOT_IN_PROGRESS',
    })
    expect(executions).toBe(0)

    // The interrupted step resumes on the capability THIS process built.
    rollback(restored.store, runId, 'A3-agenda')
    startStep(restored.store, runId, 'A3-agenda')
    const res = await runStep(restored.store, runId, 'A3-agenda', { executor })
    expect(res.status).toBe('success')
    expect(executions).toBe(1)
    expect(getArtifact(restored.store, runId, 'agenda')).toBe('produced:agenda')
    // The completed upstream step is untouched by the resumed work.
    expect(getArtifact(restored.store, runId, 'landscape-map')).toBe('val:landscape-map')
  })
})

describe('run-persistence: the record is data only', () => {
  it('carries no capability and no field outside the documented record', async () => {
    const store = freshStore()
    const runId = seedRun(store, RUN_ID)
    passStep(store, runId, 'A1-landscape')
    const capability = freshCapability()
    await persistence.save(store, runId, { baseRevision: 0 })

    const raw = await snapshotFile()
    expect(raw).not.toContain(capability.marker)
    const payload = parseRunSnapshotPayload(JSON.parse(raw))
    expect(Object.keys(payload).sort()).toEqual([
      'consumedApprovalEventIds',
      'events',
      'registry',
      'revision',
      'run',
      'savedAtIso',
      'schemaVersion',
      'steps',
    ])
    expect(payload.schemaVersion).toBe(RUN_SNAPSHOT_SCHEMA_VERSION)
    // Restoring does not need the capability to have been serialized: the caller supplies it.
    const restored = await createRunPersistence({ dir }).load(capability)
    expect(restored.capability).toBe(capability)
    expect(restored.capability.execute('x')).toBe('produced:x')
  })

  it('refuses to capture a run value the file cannot hold faithfully', () => {
    const cyclic: Record<string, unknown> = { name: 'fixture-cycle' }
    cyclic['self'] = cyclic
    const cases: Array<{ label: string; value: unknown }> = [
      { label: 'NaN', value: Number.NaN },
      { label: 'Infinity', value: Number.POSITIVE_INFINITY },
      { label: 'undefined', value: undefined },
      { label: 'a Map', value: new Map([['a', 1]]) },
      { label: 'a Date', value: new Date('2026-01-01T00:00:00.000Z') },
      { label: 'a cyclic object', value: cyclic },
      // A prototype chain with no constructor to name, so the walk cannot describe the value.
      { label: 'a prototype with no constructor name', value: Object.create({ constructor: undefined }) },
      { label: 'a function', value: () => 'fixture' },
      { label: 'a symbol', value: Symbol('fixture') },
      { label: 'a bigint', value: 1n },
    ]
    for (const testCase of cases) {
      const store = freshStore()
      const runId = seedRun(store, RUN_ID)
      // Values the engine's own write boundary would clone are injected straight into the run
      // state; the store is a caller-owned Map and its runs are mutable interfaces.
      requireRun(store, runId).inputs['fixture'] = testCase.value
      expect(thrownBy(() => captureRunSnapshot(store, runId, 1)), testCase.label).toMatchObject({
        code: 'DSH_SNAPSHOT_VALUE_NOT_JSON',
      })
      // The refusal is specific to the value: the same run persists once it is plain data.
      requireRun(store, runId).inputs['fixture'] = 'fixture-plain'
      expect(captureRunSnapshot(store, runId, 1).revision).toBe(1)
    }
  })

  it('CAPTURES a shared reference, which JSON represents by writing it twice', () => {
    // A shared reference is NOT a cycle: JSON spells it out twice and restores an equal value.
    // The walk used one never-popped `seen` set, so the second visit of any object already
    // visited — a sibling that aliases its neighbour, not an ancestor — was refused with
    // "is cyclic". It refused this repository's own `A3-agenda` artifact, whose `phases` and
    // `plan` are the same array, and the run could not be snapshotted at all.
    const store = freshStore()
    const runId = seedRun(store, RUN_ID)
    const shared = ['one', 'two']
    requireRun(store, runId).inputs['fixture'] = { phases: shared, plan: shared }
    const payload = captureRunSnapshot(store, runId, 1)
    expect(payload.run.inputs['fixture']).toEqual({ phases: ['one', 'two'], plan: ['one', 'two'] })
    // A real cycle — an object reachable from itself — is still refused.
    const cyclic: Record<string, unknown> = { name: 'fixture-cycle' }
    cyclic['self'] = cyclic
    requireRun(store, runId).inputs['fixture'] = { outer: { inner: cyclic } }
    expect(thrownBy(() => captureRunSnapshot(store, runId, 1))).toMatchObject({
      code: 'DSH_SNAPSHOT_VALUE_NOT_JSON',
    })
  })

  it('persists a null run value, which JSON represents', () => {
    const store = freshStore()
    const runId = seedRun(store, RUN_ID)
    requireRun(store, runId).inputs['fixture'] = null
    expect(captureRunSnapshot(store, runId, 1).run.inputs['fixture']).toBeNull()
  })

  it('reports an unknown run instead of capturing an empty record', () => {
    expect(thrownBy(() => captureRunSnapshot(freshStore(), 'run-absent', 1))).toMatchObject({
      code: 'RUN_NOT_FOUND',
    })
  })
})

describe('run-persistence: revision guard', () => {
  it('advances the revision and refuses a write based on an older one', async () => {
    const store = freshStore()
    const runId = seedRun(store, RUN_ID)
    passStep(store, runId, 'A1-landscape')

    expect((await persistence.save(store, runId, { baseRevision: 0 })).revision).toBe(1)
    passStep(store, runId, 'A2-claim')
    expect((await persistence.save(store, runId, { baseRevision: 1 })).revision).toBe(2)

    // A writer still holding revision 1 state tries to save over the revision 2 file.
    let stale: unknown
    try {
      stale = await persistence.save(store, runId, { baseRevision: 1 })
    } catch (error) {
      stale = error
    }
    expect(stale).toBeInstanceOf(SnapshotConflictError)
    expect(stale).toMatchObject({ code: RUN_SNAPSHOT_ERROR_CODES.CONFLICT })
    expect((await persistence.read()).revision).toBe(2)
  })

  it('discard is the explicit way back to a first write, and is idempotent', async () => {
    const store = freshStore()
    const runId = seedRun(store, RUN_ID)
    await persistence.save(store, runId, { baseRevision: 0 })
    expect(await persistence.tryLoad(freshCapability())).not.toBeNull()

    await persistence.discard()
    expect(await persistence.tryLoad(freshCapability())).toBeNull()
    await persistence.discard()
    expect((await persistence.save(store, runId, { baseRevision: 0 })).revision).toBe(1)
  })

  it('does not swallow a discard failure other than a missing file', async () => {
    // A directory at the snapshot path cannot be removed by unlink; the failure is surfaced
    // rather than reported as "already discarded".
    await mkdir(join(dir, SNAPSHOT_FILE_NAME))
    await expect(persistence.discard()).rejects.toThrow()
  })
})

describe('run-persistence: rejected snapshots', () => {
  it('reports a missing file, and tryLoad returns null only for that', async () => {
    await expect(persistence.load(freshCapability())).rejects.toBeInstanceOf(SnapshotNotFoundError)
    await expect(persistence.load(freshCapability())).rejects.toMatchObject({ code: SNAPSHOT_ERROR_CODES.NOT_FOUND })
    expect(await persistence.tryLoad(freshCapability())).toBeNull()
  })

  it('rejects a corrupt file through both load and tryLoad', async () => {
    await writeFile(join(dir, SNAPSHOT_FILE_NAME), '{ this is : not json', { encoding: 'utf8' })
    await expect(persistence.load(freshCapability())).rejects.toBeInstanceOf(SnapshotCorruptError)
    await expect(persistence.tryLoad(freshCapability())).rejects.toMatchObject({ code: SNAPSHOT_ERROR_CODES.CORRUPT })
  })

  it('rejects a version-incompatible file', async () => {
    const store = freshStore()
    const runId = seedRun(store, RUN_ID)
    await persistence.save(store, runId, { baseRevision: 0 })

    const incompatible = createRunPersistence({ dir, schemaVersion: RUN_SNAPSHOT_SCHEMA_VERSION + 1 })
    await expect(incompatible.load(freshCapability())).rejects.toBeInstanceOf(SnapshotVersionError)
  })

  it('rejects a non-numeric schemaVersion as corrupt', async () => {
    await writeTampered((raw) => {
      delete raw['schemaVersion']
    })
    await expect(persistence.load(freshCapability())).rejects.toMatchObject({ code: SNAPSHOT_ERROR_CODES.CORRUPT })
  })

  const invalidCases: Array<{ label: string; mutate: (raw: Record<string, unknown>) => void }> = [
    {
      label: 'steps that are not an array',
      mutate: (raw) => {
        raw['steps'] = 'not-an-array'
      },
    },
    {
      label: 'a step id outside the pipeline',
      mutate: (raw) => {
        firstStep(raw)['stepId'] = 'Z9-not-a-step'
      },
    },
    {
      label: 'an unknown step status',
      mutate: (raw) => {
        firstStep(raw)['status'] = 'settled'
      },
    },
    {
      label: 'an attempt id ahead of the attempt counter',
      mutate: (raw) => {
        const step = firstStep(raw)
        step['attempts'] = 1
        step['attempt_id'] = 2
      },
    },
    {
      label: 'declared outputs that disagree with the live definition',
      mutate: (raw) => {
        firstStep(raw)['outputs'] = ['landscape-map']
      },
    },
    {
      label: 'a duplicated step entry',
      mutate: (raw) => {
        const steps = raw['steps'] as Array<Record<string, unknown>>
        steps.push({ ...(steps[0] as Record<string, unknown>) })
      },
    },
    {
      label: 'an artifacts field that is not an object',
      mutate: (raw) => {
        firstStep(raw)['artifacts'] = []
      },
    },
    {
      label: 'a gate verdict with an unknown outcome',
      mutate: (raw) => {
        firstStep(raw)['gateResults'] = {
          B: { component: 'B', outcome: 'maybe', passed: false, evidence: 'e', rationale: 'r', timestamp: 1 },
        }
      },
    },
    {
      label: 'a history entry that is not superseded',
      mutate: (raw) => {
        firstStep(raw)['history'] = [
          { attempt_id: 1, status: 'passed', artifacts: {}, gateResults: {}, superseded: false },
        ]
      },
    },
    {
      label: 'a registry key that disagrees with the record slug',
      mutate: (raw) => {
        const registry = raw['registry'] as Record<string, Record<string, unknown>>
        registry['landscape-map']!['slug'] = 'gap-list'
      },
    },
    {
      label: 'a registry producer outside the pipeline',
      mutate: (raw) => {
        const registry = raw['registry'] as Record<string, Record<string, unknown>>
        registry['landscape-map']!['producerStepId'] = 'Z9-not-a-step'
      },
    },
    {
      label: 'a registry invalidated flag that is not a boolean',
      mutate: (raw) => {
        const registry = raw['registry'] as Record<string, Record<string, unknown>>
        registry['landscape-map']!['invalidated'] = 'no'
      },
    },
    {
      label: 'an audit event belonging to another run',
      mutate: (raw) => {
        const events = raw['events'] as Array<Record<string, unknown>>
        events[0]!['runId'] = 'run-elsewhere'
      },
    },
    {
      label: 'an unknown audit event kind',
      mutate: (raw) => {
        const events = raw['events'] as Array<Record<string, unknown>>
        events[0]!['kind'] = 'run-teleported'
      },
    },
    {
      label: 'inputs that are not an object',
      mutate: (raw) => {
        ;(raw['run'] as Record<string, unknown>)['inputs'] = ['domain-direction']
      },
    },
    {
      label: 'a consumed approval id list that is not an array',
      mutate: (raw) => {
        raw['consumedApprovalEventIds'] = 'evt-1'
      },
    },
    {
      label: 'a revision that is not a number',
      mutate: (raw) => {
        raw['revision'] = '1'
      },
    },
    {
      label: 'a revision that is not an integer',
      mutate: (raw) => {
        raw['revision'] = 1.5
      },
    },
    {
      label: 'a savedAtIso that is not a string',
      mutate: (raw) => {
        raw['savedAtIso'] = 1
      },
    },
  ]

  for (const invalidCase of invalidCases) {
    it(`rejects a record with ${invalidCase.label}`, async () => {
      await writeTampered(invalidCase.mutate)
      await expect(persistence.load(freshCapability())).rejects.toBeInstanceOf(SnapshotInvalidError)
      await expect(persistence.tryLoad(freshCapability())).rejects.toMatchObject({
        code: RUN_SNAPSHOT_ERROR_CODES.INVALID,
      })
    })
  }

  it('leaves a rejected snapshot readable and lets the caller start clean explicitly', async () => {
    await writeTampered((raw) => {
      raw['steps'] = 'not-an-array'
    })
    await expect(persistence.load(freshCapability())).rejects.toBeInstanceOf(SnapshotInvalidError)
    // The rejected file is not overwritten silently, not even by a first write.
    const store = freshStore()
    const runId = seedRun(store, RUN_ID)
    await expect(persistence.save(store, runId, { baseRevision: 0 })).rejects.toBeInstanceOf(SnapshotInvalidError)

    await persistence.discard()
    expect((await persistence.save(store, runId, { baseRevision: 0 })).revision).toBe(1)
    expect((await persistence.load(freshCapability())).runId).toBe(runId)
  })
})

describe('run-persistence: approval replay protection survives restore', () => {
  it('keeps the consumed approval id and refuses to replay it on a new attempt', async () => {
    const store = freshStore()
    const runId = runFullPipeline(store, RUN_ID)
    expect(getRunSnapshot(store, runId).steps['E2-submit']?.status).toBe('gated')

    const host = createHostApprovalChannel('fixture-host-secret')
    host.registerPrincipal('fixture-operator')
    host.submit(
      store,
      runId,
      'E2-submit',
      'approved',
      host.mintPrincipal(runId, 'E2-submit', 'fixture-operator', 'fixture-approval-1'),
    )
    _resetApprovalChannelForTests()
    await persistence.save(store, runId, { baseRevision: 0 })

    // Fresh process view: a new persistence, a new host channel, a new principal.
    const restored = await createRunPersistence({ dir }).load(freshCapability())
    expect(restored.consumedApprovalEventIds).toEqual(['fixture-approval-1'])
    const e2 = getRunSnapshot(restored.store, runId).steps['E2-submit']
    expect(e2?.status).toBe('passed')
    expect(e2?.approval?.approval_event_id).toBe('fixture-approval-1')

    // A second attempt on the same step, approved with the id the first attempt consumed.
    rollback(restored.store, runId, 'E2-submit')
    startStep(restored.store, runId, 'E2-submit')
    expect(completeStep(restored.store, runId, 'E2-submit')).toBe('gated')
    const channel = createHostApprovalChannel('fixture-host-secret-2')
    channel.registerPrincipal('fixture-operator')
    const replayed = channel.mintPrincipal(runId, 'E2-submit', 'fixture-operator', 'fixture-approval-1')
    expect(thrownBy(() => channel.submit(restored.store, runId, 'E2-submit', 'approved', replayed))).toMatchObject({
      code: 'DSH_APPROVAL_REPLAY',
    })

    // The guard is specific to the id: a fresh approval id still releases the gate.
    const fresh = channel.mintPrincipal(runId, 'E2-submit', 'fixture-operator', 'fixture-approval-2')
    expect(channel.submit(restored.store, runId, 'E2-submit', 'approved', fresh)).toBe('passed')
  })

  it('refuses to release a restored abstention through human approval', async () => {
    const store = freshStore()
    const runId = seedRun(store, RUN_ID)
    startStep(store, runId, 'A1-landscape')
    submitGateVerdict(store, runId, 'A1-landscape', abstainVerdict('B'))
    await persistence.save(store, runId, { baseRevision: 0 })

    const restored = await createRunPersistence({ dir }).load(freshCapability())
    const channel = createHostApprovalChannel('fixture-host-secret')
    channel.registerPrincipal('fixture-operator')
    const principal = channel.mintPrincipal(runId, 'A1-landscape', 'fixture-operator', 'fixture-approval-3')
    expect(thrownBy(() => channel.submit(restored.store, runId, 'A1-landscape', 'approved', principal))).toMatchObject({
      code: 'DSH_ABSTENTION_REQUIRES_ROLLBACK',
    })
  })
})

describe('run-persistence: restoreRun over a validated record', () => {
  it('restores a record into a run store holding that run only', () => {
    const store = freshStore()
    const runId = seedRun(store, RUN_ID)
    const payload: RunSnapshotPayload = captureRunSnapshot(store, runId, 7)
    const restored = restoreRun(payload, undefined)
    expect([...restored.store.keys()]).toEqual([runId])
    expect(restored.revision).toBe(7)
    expect(restored.interrupted).toEqual([])
    expect(restored.consumedApprovalEventIds).toEqual([])
    expect(restored.capability).toBeUndefined()
  })
})
