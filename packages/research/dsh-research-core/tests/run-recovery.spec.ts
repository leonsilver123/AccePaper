/**
 * Process-boundary recovery tests (contract §8.4).
 *
 * Each test here spawns REAL child processes (`node --import tsx/esm <fixture>`): the writer
 * drives a fixture run and flushes it through the persistence layer, the process exits, and the
 * reader — a different process that shares nothing with the writer but the snapshot file —
 * restores the run. What is recovered is therefore state that crossed a file boundary, not a
 * re-instantiated `Map`.
 *
 * The children report observations on stdout (see fixtures/run-recovery/report.ts); the
 * assertions live here so the evidence is in the test output.
 *
 * Every run is fixture data: seeded inputs, literal artifact values, fixture approval ids.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { SNAPSHOT_FILE_NAME } from '../src/snapshot-store.ts'
import { REPORT_SENTINEL } from './fixtures/run-recovery/report.ts'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const fixturesDir = join(repoRoot, 'packages', 'research', 'dsh-research-core', 'tests', 'fixtures', 'run-recovery')
const WRITER = join(fixturesDir, 'run-writer.ts')
const READER = join(fixturesDir, 'run-reader.ts')

/** A child process runs its own copy of the pipeline; tsx startup dominates the runtime. */
const CHILD_TIMEOUT_MS = 120_000

interface ChildReport {
  readonly pid: number
  readonly [key: string]: unknown
}

/**
 * Run one fixture process to completion and return the report it printed. A non-zero exit is a
 * fixture failure, not an assertion — surfaced with the child's output.
 */
function runFixtureProcess(script: string, args: ReadonlyArray<string>): ChildReport {
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`fixture process '${script}' exited ${String(result.status)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  const line = result.stdout.split('\n').find(candidate => candidate.startsWith(REPORT_SENTINEL))
  if (line === undefined) {
    throw new Error(`fixture process '${script}' printed no report line\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  return JSON.parse(line.slice(REPORT_SENTINEL.length + 1)) as ChildReport
}

function writer(dir: string, scenario: string, base: number): ChildReport {
  return runFixtureProcess(WRITER, ['--dir', dir, '--scenario', scenario, '--base', String(base)])
}

function reader(dir: string, scenario: string, extra: ReadonlyArray<string> = []): ChildReport {
  return runFixtureProcess(READER, ['--dir', dir, '--scenario', scenario, ...extra])
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-run-recovery-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function expectedProjection(): Promise<unknown> {
  return JSON.parse(await readFile(join(dir, 'expected.json'), { encoding: 'utf8' }))
}

async function snapshotBytes(): Promise<string> {
  return readFile(join(dir, SNAPSHOT_FILE_NAME), { encoding: 'utf8' })
}

/** The step records of the projection a child reported, for the per-step assertions below. */
interface ProjectedSteps {
  readonly steps: Record<
    string,
    {
      readonly status: string
      readonly holdReason?: string
      readonly history: ReadonlyArray<unknown>
      readonly approval?: { readonly approval_event_id: string; readonly attempt_id: number }
    }
  >
}

function projectedSteps(report: ChildReport): ProjectedSteps['steps'] {
  return (report['projection'] as { snapshot: ProjectedSteps }).snapshot.steps
}

describe('run recovery across two real processes', () => {
  it('resumes the run a previous process persisted, without re-running completed steps', { timeout: CHILD_TIMEOUT_MS }, async () => {
    const written = writer(dir, 'mid-run', 0)
    const expected = await expectedProjection()
    const restored = reader(dir, 'mid-run')

    // Two different processes, and the run they share exists only in the snapshot file.
    expect(written.pid).not.toBe(restored.pid)
    expect(written.revision).toBe(1)
    expect(restored.revision).toBe(1)
    expect(restored.capabilityIdentity).toBe(true)

    // Artifacts, sources (artifact registry), gate verdicts, audit log and attempt state all
    // survive the boundary unchanged.
    expect(restored.projection).toEqual(expected)

    // The restored interrupted attempt is explicit and resumable.
    expect(restored.interrupted).toEqual([
      { stepId: 'B2-data', attemptId: 1, executed: true, resumeVia: 'rollback_and_retry' },
    ])

    // Completed steps are not re-executed: not startable, not executable, executor never called.
    expect(restored.completedSteps).toEqual([
      'A1-landscape',
      'A2-claim',
      'A3-agenda',
      'A4-venue',
      'B1-method',
    ].map(stepId => ({
      stepId,
      canStart: false,
      startErrorCode: 'DSH_CANNOT_START',
      runStepErrorCode: 'DSH_NOT_IN_PROGRESS',
    })))
    expect(restored.executions).toBe(0)

    // The resumed run continues on the capability THIS process constructed, and the upstream
    // artifacts the previous process wrote are still its values.
    expect(restored.continued).toEqual({
      status: 'success',
      outputSlugs: ['dataset', 'data-profile'],
      dataset: 'reader-process-dataset',
      upstreamLandscape: 'val:landscape-map',
    })
  })

  it('restores a held abstention and refuses to release it in the new process', { timeout: CHILD_TIMEOUT_MS }, async () => {
    writer(dir, 'abstained', 0)
    const expected = await expectedProjection()
    const restored = reader(dir, 'abstained')

    expect(restored.projection).toEqual(expected)
    const steps = projectedSteps(restored)
    expect(steps['A1-landscape']?.status).toBe('gated')
    expect(steps['A1-landscape']?.holdReason).toBe('gate_abstained')
    expect(restored.interrupted).toEqual([])
    expect(restored.abstentionRelease).toBe('DSH_ABSTENTION_REQUIRES_ROLLBACK')
  })

  it('restores superseded attempt history and the audit trail across the boundary', { timeout: CHILD_TIMEOUT_MS }, async () => {
    writer(dir, 'rollback', 0)
    const expected = await expectedProjection()
    const restored = reader(dir, 'rollback')

    expect(restored.projection).toEqual(expected)
    const steps = projectedSteps(restored)
    expect(steps['A1-landscape']?.history).toHaveLength(1)
    expect(restored.interrupted).toEqual([
      { stepId: 'A2-claim', attemptId: 1, executed: false, resumeVia: 'rollback_and_retry' },
    ])
    expect(restored.executions).toBe(0)
  })

  it('keeps a consumed approval event consumed, and refuses to replay it on a new attempt', { timeout: CHILD_TIMEOUT_MS }, async () => {
    writer(dir, 'approved', 0)
    const expected = await expectedProjection()
    const restored = reader(dir, 'approved')

    expect(restored.projection).toEqual(expected)
    expect(restored.consumedApprovalEventIds).toEqual(['process-boundary-approval-1'])
    const steps = projectedSteps(restored)
    expect(steps['E2-submit']?.status).toBe('passed')
    expect(steps['E2-submit']?.approval?.approval_event_id).toBe('process-boundary-approval-1')

    // The new process rolls the gate back to a NEW attempt and tries the consumed id again.
    expect(restored.replay).toEqual({
      gateStatus: 'gated',
      replayedCode: 'DSH_APPROVAL_REPLAY',
      freshCode: 'NONE',
    })
    expect(restored.finalE2Status).toBe('passed')
    expect(restored.executions).toBe(0)
  })
})

describe('run recovery rejects snapshots it cannot trust', () => {
  it('refuses a write based on a revision older than the persisted one', { timeout: CHILD_TIMEOUT_MS }, async () => {
    const first = writer(dir, 'mid-run', 0)
    const before = await snapshotBytes()

    // A second process holding pre-write state (revision 0) tries to save over revision 1.
    const second = writer(dir, 'rollback', 0)
    expect(second.pid).not.toBe(first.pid)
    expect(second.revision).toBeNull()
    expect(second.errorName).toBe('SnapshotConflictError')
    expect(second.errorCode).toBe('SNAPSHOT_CONFLICT')

    // The newer snapshot is untouched, byte for byte.
    expect(await snapshotBytes()).toBe(before)
  })

  it('rejects a corrupt file written outside the store', { timeout: CHILD_TIMEOUT_MS }, async () => {
    writer(dir, 'mid-run', 0)
    await writeFile(join(dir, SNAPSHOT_FILE_NAME), '{ this is : not json', { encoding: 'utf8' })

    const restored = reader(dir, 'mid-run')
    expect(restored.revision).toBeNull()
    expect(restored.errorCode).toBe('SNAPSHOT_CORRUPT')
  })

  it('rejects a snapshot written by an incompatible schema version', { timeout: CHILD_TIMEOUT_MS }, async () => {
    writer(dir, 'mid-run', 0)

    const restored = reader(dir, 'mid-run', ['--schema', '2'])
    expect(restored.revision).toBeNull()
    expect(restored.errorName).toBe('SnapshotVersionError')
    expect(restored.errorCode).toBe('SNAPSHOT_VERSION_UNSUPPORTED')
  })

  it('rejects a structurally invalid snapshot written outside the store', { timeout: CHILD_TIMEOUT_MS }, async () => {
    writer(dir, 'mid-run', 0)
    const raw = JSON.parse(await snapshotBytes()) as { steps: Array<Record<string, unknown>> }
    raw.steps[0]!['status'] = 'settled'
    await writeFile(join(dir, SNAPSHOT_FILE_NAME), JSON.stringify(raw), { encoding: 'utf8' })

    const restored = reader(dir, 'mid-run')
    expect(restored.revision).toBeNull()
    expect(restored.errorName).toBe('SnapshotInvalidError')
    expect(restored.errorCode).toBe('SNAPSHOT_INVALID')
  })

  it('refuses to persist a run value the file cannot hold, writing nothing', { timeout: CHILD_TIMEOUT_MS }, async () => {
    const refused = writer(dir, 'unpersistable', 0)
    expect(refused.revision).toBeNull()
    expect(refused.errorCode).toBe('DSH_SNAPSHOT_VALUE_NOT_JSON')

    // The refusal happens before the write: no snapshot file appears.
    await expect(readFile(join(dir, SNAPSHOT_FILE_NAME), { encoding: 'utf8' })).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
