/**
 * Tests for the file-backed snapshot store (Session-restart-recovery wave).
 *
 * All tests use an isolated temp dir under os.tmpdir() and clean up afterwards so they
 * are deterministic and hermetic. No database, no network.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  createFileSnapshotStore,
  replayProtection,
  SnapshotNotFoundError,
  SnapshotCorruptError,
  SnapshotVersionError,
  SNAPSHOT_ERROR_CODES,
  SNAPSHOT_FILE_NAME,
} from '../src/snapshot-store.ts'
import type { SnapshotPayload, SnapshotStore } from '../src/snapshot-store.ts'

const SCHEMA = 1

/** Temp dirs created during the current test, removed in afterEach. */
let createdDirs: Array<string> = []

beforeEach(() => {
  createdDirs = []
})

afterEach(async () => {
  await Promise.all(createdDirs.map(d => rm(d, { recursive: true, force: true })))
  createdDirs = []
})

async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-snap-'))
  createdDirs.push(dir)
  return dir
}

function makePayload(overrides: Partial<SnapshotPayload> = {}): SnapshotPayload {
  return {
    schemaVersion: SCHEMA,
    savedAtIso: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    run: { runId: 'run-1', input: 'topic' },
    steps: [
      { stepId: 'A1', status: 'passed', artifact: { ok: true } },
      { stepId: 'A2', status: 'gated', gate: { outcome: 'hold' }, truthfulness: 'verified' },
    ],
    consumedApprovalEventIds: ['evt-already-consumed'],
    ...overrides,
  }
}

describe('snapshot-store: happy path + atomicity', () => {
  it('save then load round-trips the payload exactly', async () => {
    const dir = await freshDir()
    const store = createFileSnapshotStore({ dir, schemaVersion: SCHEMA })
    const payload = makePayload()
    await store.save(payload)
    const loaded = await store.load()
    expect(loaded).toEqual(payload)
    expect(loaded.schemaVersion).toBe(SCHEMA)
  })

  it('atomic write leaves no leftover .tmp file after success', async () => {
    const dir = await freshDir()
    const store = createFileSnapshotStore({ dir, schemaVersion: SCHEMA })
    await store.save(makePayload())
    const entries = await readdir(dir)
    expect(entries.filter(e => e.includes('.tmp.'))).toEqual([])
    expect(entries).toContain(SNAPSHOT_FILE_NAME)
  })

  it('repeated saves overwrite cleanly (still atomic, single file)', async () => {
    const dir = await freshDir()
    const store = createFileSnapshotStore({ dir, schemaVersion: SCHEMA })
    await store.save(makePayload({ run: { runId: 'v1' } }))
    await store.save(makePayload({ run: { runId: 'v2' } }))
    const loaded = await store.load()
    expect((loaded.run as { runId: string }).runId).toBe('v2')
    const entries = await readdir(dir)
    expect(entries.filter(e => e.includes('.tmp.'))).toEqual([])
  })
})

describe('snapshot-store: load failure modes (fail-closed)', () => {
  it('missing file throws SnapshotNotFoundError with stable code', async () => {
    const dir = await freshDir()
    const store: SnapshotStore = createFileSnapshotStore({ dir, schemaVersion: SCHEMA })
    let err: unknown
    try {
      await store.load()
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(SnapshotNotFoundError)
    expect((err as SnapshotNotFoundError).code).toBe(SNAPSHOT_ERROR_CODES.NOT_FOUND)
  })

  it('corrupt (non-JSON) file throws SnapshotCorruptError, never partial state', async () => {
    const dir = await freshDir()
    const store = createFileSnapshotStore({ dir, schemaVersion: SCHEMA })
    await writeFile(join(dir, SNAPSHOT_FILE_NAME), '{ this is : not json', { encoding: 'utf8' })
    let err: unknown
    try {
      await store.load()
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(SnapshotCorruptError)
    expect((err as SnapshotCorruptError).code).toBe(SNAPSHOT_ERROR_CODES.CORRUPT)
  })

  it('version mismatch throws SnapshotVersionError with stable code', async () => {
    const dir = await freshDir()
    const store = createFileSnapshotStore({ dir, schemaVersion: SCHEMA })
    await store.save(makePayload())
    const other = createFileSnapshotStore({ dir, schemaVersion: 999 })
    let err: unknown
    try {
      await other.load()
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(SnapshotVersionError)
    expect((err as SnapshotVersionError).code).toBe(SNAPSHOT_ERROR_CODES.VERSION_UNSUPPORTED)
  })

  it('garbage partial write is not readable as a complete snapshot', async () => {
    const dir = await freshDir()
    const store = createFileSnapshotStore({ dir, schemaVersion: SCHEMA })
    await writeFile(join(dir, SNAPSHOT_FILE_NAME), '#partial-garbage-not-json', { encoding: 'utf8' })
    let err: unknown
    try {
      await store.load()
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(SnapshotCorruptError)
  })
})

describe('snapshot-store: replay protection across restart', () => {
  it('replayProtection returns true for an already-consumed id after reload', async () => {
    const dir = await freshDir()
    const store = createFileSnapshotStore({ dir, schemaVersion: SCHEMA })
    const payload = makePayload({ consumedApprovalEventIds: ['evt-done-1', 'evt-done-2'] })
    await store.save(payload)

    // Simulate restart: a fresh store instance loads the persisted state.
    const restarted = createFileSnapshotStore({ dir, schemaVersion: SCHEMA })
    const loaded = await restarted.load()

    expect(replayProtection(loaded.consumedApprovalEventIds, 'evt-done-1')).toBe(true)
    expect(replayProtection(loaded.consumedApprovalEventIds, 'evt-done-2')).toBe(true)
    expect(replayProtection(loaded.consumedApprovalEventIds, 'evt-new-3')).toBe(false)
  })
})
