/**
 * Minimal versioned, atomic snapshot persistence for pipeline run state.
 *
 * Used by the Session-restart-recovery wave: a research run can be serialized to
 * disk (no database) and reloaded after a process restart so that a pipeline can
 * resume where it left off. The store is deliberately minimal:
 *
 *  - atomic write: the payload is written to `<dir>/research-run-snapshot.json.tmp.<rand>`
 *    and then renamed over `<dir>/research-run-snapshot.json`. `rename` (on POSIX and
 *    Windows with the same filesystem) is atomic, so a reader NEVER observes a partial
 *    file — a crash mid-write leaves only an orphan `.tmp` and the previous good snapshot.
 *  - fail-closed load: any JSON corruption or version mismatch throws rather than
 *    returning partial / stale state. The caller must treat a thrown load as "no usable
 *    snapshot" and start fresh (or surface the error).
 *  - replay protection: `replayProtection` lets the runner reject an approval event id
 *    that was already consumed before the restart, so a duplicated/misordered approval
 *    message cannot be replayed twice.
 *
 * No Cordis / no external runtime deps — only `node:fs/promises` + `node:path`.
 */

import { rename, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

/** Stable snapshot file name inside the store directory. */
export const SNAPSHOT_FILE_NAME = 'research-run-snapshot.json'

/** A single persisted step record (subset of run state we need to resume). */
export interface SnapshotStep {
  stepId: string
  status: string
  artifact?: unknown
  gate?: unknown
  abstention?: unknown
  audit?: unknown
  truthfulness?: string
}

/** The serialized pipeline run state. */
export interface SnapshotPayload {
  schemaVersion: number
  savedAtIso: string
  run: unknown
  steps: Array<SnapshotStep>
  consumedApprovalEventIds: Array<string>
}

/** Contract for a snapshot store. */
export interface SnapshotStore {
  /** Atomically persist a snapshot (never partially overwrites an existing good file). */
  save(snapshot: SnapshotPayload): Promise<void>
  /** Load the persisted snapshot, or throw a {@link SnapshotStoreError} on any problem. */
  load(): Promise<SnapshotPayload>
}

/** Stable error codes surfaced on {@link SnapshotStoreError}. */
export const SNAPSHOT_ERROR_CODES = {
  NOT_FOUND: 'SNAPSHOT_NOT_FOUND',
  CORRUPT: 'SNAPSHOT_CORRUPT',
  VERSION_UNSUPPORTED: 'SNAPSHOT_VERSION_UNSUPPORTED',
} as const

/**
 * Base error for snapshot store failures. Always carries a stable `code` so callers
 * can branch on the failure kind without string-matching messages.
 */
export class SnapshotStoreError extends Error {
  readonly code: string
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SnapshotStoreError'
    this.code = code
    // Preserve prototype chain for instanceof checks under TS/ES transpilation.
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Thrown when the snapshot file does not exist. */
export class SnapshotNotFoundError extends SnapshotStoreError {
  constructor(message = `No snapshot file found (code ${SNAPSHOT_ERROR_CODES.NOT_FOUND}).`) {
    super(SNAPSHOT_ERROR_CODES.NOT_FOUND, message)
    this.name = 'SnapshotNotFoundError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Thrown when the snapshot file exists but is not valid JSON (fail-closed). */
export class SnapshotCorruptError extends SnapshotStoreError {
  constructor(message = `Snapshot file is corrupt / not valid JSON (code ${SNAPSHOT_ERROR_CODES.CORRUPT}).`, options?: { cause?: unknown }) {
    super(SNAPSHOT_ERROR_CODES.CORRUPT, message, options)
    this.name = 'SnapshotCorruptError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Thrown when the snapshot's schemaVersion does not match the expected version. */
export class SnapshotVersionError extends SnapshotStoreError {
  constructor(message = `Snapshot schema version is unsupported (code ${SNAPSHOT_ERROR_CODES.VERSION_UNSUPPORTED}).`) {
    super(SNAPSHOT_ERROR_CODES.VERSION_UNSUPPORTED, message)
    this.name = 'SnapshotVersionError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export interface FileSnapshotStoreOptions {
  /** Directory that holds (or will hold) the snapshot file. */
  dir: string
  /** Expected `schemaVersion` of the persisted snapshot. A mismatch throws. */
  schemaVersion: number
}

/**
 * Create a filesystem-backed snapshot store rooted at `opts.dir`.
 *
 * The store uses atomic write + rename semantics and fails closed on read so that
 * a caller can never observe a torn or partial snapshot.
 */
export function createFileSnapshotStore(opts: FileSnapshotStoreOptions): SnapshotStore {
  const { dir, schemaVersion } = opts
  const targetPath = join(dir, SNAPSHOT_FILE_NAME)

  async function save(snapshot: SnapshotPayload): Promise<void> {
    // Always stamp the expected schema version so a round-trip is self-consistent.
    const payload: SnapshotPayload = {
      ...snapshot,
      schemaVersion,
    }
    const serialized = JSON.stringify(payload)
    // Random suffix avoids collisions if two writers ever race and lets us clean up.
    const tmpPath = join(dir, `${SNAPSHOT_FILE_NAME}.tmp.${randomBytes(6).toString('hex')}`)
    await writeFile(tmpPath, serialized, { encoding: 'utf8' })
    // Atomic replace: readers never see a partial file.
    await rename(tmpPath, targetPath)
  }

  async function load(): Promise<SnapshotPayload> {
    if (!existsSync(targetPath)) {
      throw new SnapshotNotFoundError()
    }
    let raw: string
    try {
      raw = await readFile(targetPath, { encoding: 'utf8' })
    } catch (cause) {
      // A read error (e.g. permission) is treated as corrupt/unusable — fail closed.
      throw new SnapshotCorruptError('Snapshot file could not be read.', { cause })
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (cause) {
      // Fail closed: NEVER return partial/best-effort state.
      throw new SnapshotCorruptError('Snapshot file content is not valid JSON.', { cause })
    }
    const obj = parsed as Partial<SnapshotPayload> | null
    if (typeof obj?.schemaVersion !== 'number') {
      throw new SnapshotCorruptError('Snapshot file is missing a numeric schemaVersion.')
    }
    if (obj.schemaVersion !== schemaVersion) {
      throw new SnapshotVersionError(
        `Snapshot schemaVersion=${obj.schemaVersion} does not match expected ${schemaVersion}.`,
      )
    }
    return parsed as SnapshotPayload
  }

  return { save, load }
}

/**
 * Replay protection for approval event ids.
 *
 * Returns `true` when `candidateId` has already been consumed (i.e. it must be
 * rejected to prevent an approval from being replayed after a restart), `false`
 * otherwise. The matching is exact-string.
 */
export function replayProtection(consumedIds: Array<string>, candidateId: string): boolean {
  return consumedIds.includes(candidateId)
}
