/**
 * Process-restart persistence for ONE research run (contract §8.4 recovery).
 *
 * `snapshot-store.ts` owns the file: atomic write+rename, fail-closed read, schemaVersion
 * gate. This module owns the RECORD — which parts of a live run are persisted, how a durable
 * value is validated back into a run, and how a resumed run is re-attached to the capability
 * the new process owns.
 *
 * Persisted (plain data only): run id + seeded inputs, every step's attempt state (status,
 * attempt counters, artifacts, gate verdicts, human approval, hold reason, superseded-attempt
 * history, timestamps, declared outputs), the run-level artifact registry, the full audit event
 * log, and the approval event ids already consumed.
 *
 * NOT persisted: capabilities, service objects and credentials. Nothing in the payload is
 * callable — `captureRunSnapshot` refuses a run holding a value JSON cannot represent rather
 * than writing a degraded one, and `restoreRun` REQUIRES the caller to pass the capability the
 * resumed run must run on. That value is carried on the returned handle by identity and is
 * never read from the snapshot, so a capability object captured by the writing process is never
 * resurrected: a resumed run executes only through the capability this process constructed.
 *
 * Write discipline: a save declares the `baseRevision` it is based on and is refused unless the
 * persisted revision still equals it ({@link SnapshotConflictError}), so a snapshot captured
 * from older state can never silently overwrite newer state. An accepted write stamps
 * `revision = persisted + 1`, so revisions only move forward.
 *
 * Load discipline: the store's JSON + schemaVersion checks run first, then
 * {@link parseRunSnapshotPayload} validates the record against the live 16-step graph and throws
 * {@link SnapshotInvalidError} on any contradiction. A rejected snapshot yields no partial run.
 *
 * No Cordis / no external runtime deps.
 */

import { open, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import {
  SNAPSHOT_FILE_NAME,
  SnapshotNotFoundError,
  SnapshotStoreError,
  createFileSnapshotStore,
} from './snapshot-store.ts'
import type { SnapshotStore } from './snapshot-store.ts'
import { ResearchError, ResearchRunError } from './engine/state-machine.ts'
import { getStepDefinitionById } from './engine/steps-accessor.ts'
import type {
  ApprovalRecord,
  ArtifactRecord,
  AttemptRecord,
  AuditEvent,
  GateVerdict,
  HoldReason,
  ResearchRunStore,
  RunState,
  StepState,
  StepStatus,
  TrinityComponent,
} from './engine/types.ts'

/** Schema version of a run snapshot. A file stamped with another version is rejected on load. */
export const RUN_SNAPSHOT_SCHEMA_VERSION = 1

/** Error codes added by the run persistence layer (all carried on a {@link SnapshotStoreError}). */
export const RUN_SNAPSHOT_ERROR_CODES = {
  /** The record is readable and version-correct but contradicts the run model. */
  INVALID: 'SNAPSHOT_INVALID',
  /** The write is based on an older revision than the persisted snapshot. */
  CONFLICT: 'SNAPSHOT_CONFLICT',
} as const

/**
 * Thrown when a snapshot is valid JSON with the expected schemaVersion but its content
 * contradicts the run model: a wrong field type, an unknown step id, declared outputs that
 * disagree with the live step definition, a duplicate step entry, an unknown status, or an
 * attempt id ahead of its attempt counter. Fail-closed — no partial run is ever returned.
 */
export class SnapshotInvalidError extends SnapshotStoreError {
  constructor(message: string) {
    super(RUN_SNAPSHOT_ERROR_CODES.INVALID, message)
    this.name = 'SnapshotInvalidError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}


// ── One writer per run, ACROSS PROCESSES ─────────────────────────────────────
//
// The revision guard below is a read-then-write, and two PROCESSES can both pass it: each reads
// revision N, each captures N+1, and each writes. The file layer survives the collision — it
// writes a temp file and renames it over the target, so the file is never half-written — but
// "survives" is not "refuses": when the two windows do NOT overlap, both writes succeed, both are
// stamped revision N+1, and the second silently replaces the first. The loser's run state is gone
// and nothing said so.
//
// That is not a theoretical window. It was measured: the same probe reported "at most one writer"
// on one run and "BOTH writers succeeded" on the next, with no change to either process. A guard
// whose outcome depends on scheduling is not a guard, so the read-compare-write is serialized on a
// lock file that only one process can create.
//
// The lock is a file created with `wx` (exclusive create), which the filesystem makes atomic. A
// holder that dies leaves the file behind, so a lock older than {@link SAVE_LOCK_STALE_MS} is
// removed and re-taken — the alternative is a run that can never be saved again after one crash.

/** How long a save waits for the run's lock before reporting that another writer holds it. */
const SAVE_LOCK_WAIT_MS = 2_000

/** How long between attempts to take the lock. */
const SAVE_LOCK_RETRY_MS = 25

/** Age at which a lock file is treated as left behind by a process that died holding it. */
const SAVE_LOCK_STALE_MS = 30_000

/** The lock file's name inside one run's snapshot directory. */
const SAVE_LOCK_NAME = '.save.lock'

/**
 * Run `write` with the run's save lock held, releasing it whatever happens.
 *
 * @param dir - the run's snapshot directory.
 * @param write - the read-compare-write to perform while the lock is held.
 * @param runId - named in the refusal when the lock cannot be taken.
 * @returns whatever `write` returned.
 * @throws {SnapshotConflictError} when another writer holds the lock for longer than the wait.
 */
async function withSaveLock<T>(dir: string, runId: string, write: () => Promise<T>): Promise<T> {
  const lockPath = join(dir, SAVE_LOCK_NAME)
  const deadline = Date.now() + SAVE_LOCK_WAIT_MS
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx')
      try {
        return await write()
      } finally {
        await handle.close().catch(() => undefined)
        await unlink(lockPath).catch(() => undefined)
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause
      // Held. If it has been held long enough to be a corpse rather than a writer, clear it.
      const age = await stat(lockPath).then(info => Date.now() - info.mtimeMs).catch(() => 0)
      if (age > SAVE_LOCK_STALE_MS) {
        await unlink(lockPath).catch(() => undefined)
        continue
      }
      if (Date.now() >= deadline) {
        throw new SnapshotConflictError(
          0,
          0,
          `another process is writing run '${runId}' (it holds ${SAVE_LOCK_NAME}); this save waited `
          + `${String(SAVE_LOCK_WAIT_MS)} ms and was refused rather than written alongside it`,
        )
      }
      await new Promise((resolve) => { setTimeout(resolve, SAVE_LOCK_RETRY_MS) })
    }
  }
}

/**
 * Thrown when a save's `baseRevision` no longer matches the persisted revision: the write was
 * captured from older state than the file holds, so accepting it would silently discard the
 * newer state. The caller reloads and re-derives its write from the current snapshot.
 */
export class SnapshotConflictError extends SnapshotStoreError {
  /**
   * @param persistedRevision - the revision the file holds; ignored when `message` is given.
   * @param baseRevision - the revision this write was based on; ignored when `message` is given.
   * @param message - a specific conflict the revision pair cannot express, such as another
   *   process holding the save lock. Naming why is the point: the caller's remedy differs.
   */
  constructor(persistedRevision: number, baseRevision: number, message?: string) {
    super(
      RUN_SNAPSHOT_ERROR_CODES.CONFLICT,
      message
        ?? `Snapshot write refused: the persisted snapshot is at revision ${persistedRevision} but this write is based on revision ${baseRevision} — a newer snapshot exists (reload before saving).`,
    )
    this.name = 'SnapshotConflictError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Run identity + seeded inputs (the part of the run that is not step-scoped). */
export interface PersistedRunHeader {
  readonly runId: string
  readonly inputs: Record<string, unknown>
}

/**
 * Persisted form of one step's runtime state. Field-for-field the serializable part of the
 * engine's `StepState` (same names, so the record reads as the run it came from); every field is
 * re-validated on load against the live step graph.
 */
export interface PersistedStepState {
  readonly stepId: string
  readonly status: StepStatus
  readonly attempts: number
  readonly attempt_id: number
  readonly artifacts: Record<string, unknown>
  readonly gateResults: Partial<Record<TrinityComponent, GateVerdict>>
  readonly approval?: ApprovalRecord
  readonly holdReason?: HoldReason
  readonly history: ReadonlyArray<AttemptRecord>
  readonly startedAt?: number
  readonly finishedAt?: number
  readonly outputs: ReadonlyArray<string>
}

/** The complete persisted record of one run. */
export interface RunSnapshotPayload {
  readonly schemaVersion: number
  readonly savedAtIso: string
  /** Monotonic write counter; see `RunPersistence.save`. */
  readonly revision: number
  readonly run: PersistedRunHeader
  readonly steps: ReadonlyArray<PersistedStepState>
  readonly registry: Record<string, ArtifactRecord>
  readonly events: ReadonlyArray<AuditEvent>
  readonly consumedApprovalEventIds: ReadonlyArray<string>
}

/**
 * One step that was `in_progress` when the snapshot was written — the step the previous process
 * was executing when it stopped. It is restored as `in_progress`, never advanced, so the resumed
 * run must resolve it explicitly.
 */
export interface InterruptedStep {
  readonly stepId: string
  readonly attemptId: number
  /** True when this attempt already appended a `step-executed` audit record. */
  readonly executed: boolean
  /**
   * `continue_gate`: the interrupted attempt executed successfully — its artifacts are written
   * and only the gate is outstanding, so the resumed run submits the gate verdicts.
   * `rollback_and_retry`: the attempt never landed (or failed/timed out/was cancelled) — the
   * resumed run rolls the step back, starts a new attempt, and executes again.
   */
  readonly resumeVia: 'continue_gate' | 'rollback_and_retry'
}

/** A restored run plus the facts the caller needs to continue it. */
export interface RestoredRun<C = unknown> {
  /** A fresh run store holding exactly this run. */
  readonly store: ResearchRunStore
  readonly runId: string
  /** Revision of the snapshot this run was restored from. */
  readonly revision: number
  readonly savedAtIso: string
  /**
   * The capability the CALLER passed to `restoreRun` — same object identity, never a value read
   * from the snapshot. The resumed run executes only through this capability.
   */
  readonly capability: C
  /** Approval event ids already consumed, as restored into the run's replay guard. */
  readonly consumedApprovalEventIds: ReadonlyArray<string>
  /** Steps that were `in_progress` at snapshot time, with their resume path. */
  readonly interrupted: ReadonlyArray<InterruptedStep>
}

export interface RunPersistenceOptions {
  /**
   * Directory holding the snapshot file. It must exist: the store never creates it, so a missing
   * directory surfaces as a failed write at the first save rather than being papered over — the
   * host creates it at startup where it resolves this option.
   */
  readonly dir: string
  /** Expected snapshot schemaVersion; defaults to {@link RUN_SNAPSHOT_SCHEMA_VERSION}. */
  readonly schemaVersion?: number
}

/** Save options: the revision the caller's in-memory state is based on. */
export interface RunSaveOptions {
  /** Revision this write is derived from — 0 for a run never persisted before. */
  readonly baseRevision: number
}

/** Persistence for one run directory. */
export interface RunPersistence {
  /**
   * Persist `runId` from `store`. Refused with {@link SnapshotConflictError} unless the persisted
   * revision equals `options.baseRevision`; on success the file is stamped `baseRevision + 1`.
   * Returns the payload that was written.
   */
  save(
    store: ResearchRunStore,
    runId: string,
    options: RunSaveOptions,
  ): Promise<RunSnapshotPayload>
  /** Load, validate and restore the snapshot onto `capability`. Throws on any problem. */
  load<C>(capability: C): Promise<RestoredRun<C>>
  /** Like {@link RunPersistence.load}, but returns `null` when no snapshot file exists at all.
   *  A corrupt / version-incompatible / invalid snapshot still throws — it is never silently
   *  treated as "nothing to resume". */
  tryLoad<C>(capability: C): Promise<RestoredRun<C> | null>
  /** Read and validate the raw record without restoring it. */
  read(): Promise<RunSnapshotPayload>
  /** Delete the snapshot file. The explicit way to start clean after a rejected snapshot; a
   *  rejected snapshot is never overwritten silently by `save`. */
  discard(): Promise<void>
}

// ── Validation (durable-file boundary) ────────────────────────────────────────

/** Statuses the engine may hold a step in. Kept closed: an unknown status is a rejection, not
 *  a value to reinterpret (a new status must extend this set in the same change). */
const STEP_STATUSES: ReadonlySet<string> = new Set<string>([
  'pending',
  'in_progress',
  'gated',
  'passed',
  'blocked',
  'failed',
])

/** Gate outcomes accepted at the load boundary (mirrors the engine's write-boundary allow-list). */
const GATE_OUTCOMES: ReadonlySet<string> = new Set<string>([
  'passed',
  'blocked',
  'failed',
  'abstained',
])

/** Hold reasons accepted at the load boundary. */
const HOLD_REASONS: ReadonlySet<string> = new Set<string>([
  'human_gate',
  'gate_abstained',
])

/** Approval decisions accepted at the load boundary. */
const DECISIONS: ReadonlySet<string> = new Set<string>([
  'approved',
  'rejected',
])

/** Trinity components accepted at the load boundary. */
const TRINITY_COMPONENTS: ReadonlySet<string> = new Set<string>([
  'A',
  'B',
  'C',
])

/** Audit event kinds accepted at the load boundary (mirrors `AuditEventKind`). */
const AUDIT_EVENT_KINDS: ReadonlySet<string> = new Set<string>([
  'run-created',
  'input-seeded',
  'step-started',
  'artifact-recorded',
  'gate-verdict',
  'step-completed',
  'human-approval',
  'gate-abstention',
  'step-executed',
  'rollback',
])

/**
 * Narrow a durable value to a JSON object. The `as` is confined to the value this check just
 * proved is a non-null, non-array object — the file boundary is where the static types stop
 * being trustworthy.
 */
function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SnapshotInvalidError(`${what} must be a JSON object.`)
  }
  return value as Record<string, unknown>
}

function asArray(value: unknown, what: string): Array<unknown> {
  if (!Array.isArray(value)) {
    throw new SnapshotInvalidError(`${what} must be an array.`)
  }
  return value
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') {
    throw new SnapshotInvalidError(`${what} must be a string.`)
  }
  return value
}

function asNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SnapshotInvalidError(`${what} must be a finite number.`)
  }
  return value
}

/** A non-negative integer (attempt counters, attempt ids). */
function asCount(value: unknown, what: string): number {
  const n = asNumber(value, what)
  if (!Number.isInteger(n) || n < 0) {
    throw new SnapshotInvalidError(`${what} must be a non-negative integer.`)
  }
  return n
}

/**
 * Narrow a durable string to one of `allowed`. Call sites cast the result to the union the set
 * was written from; this check is what makes that cast honest.
 */
function asMemberOf(
  value: unknown,
  allowed: ReadonlySet<string>,
  what: string,
): string {
  const s = asString(value, what)
  if (!allowed.has(s)) {
    throw new SnapshotInvalidError(
      `${what} '${s}' is not one of ${[...allowed].join(', ')}.`,
    )
  }
  return s
}

function parseApproval(raw: unknown, what: string): ApprovalRecord {
  const o = asRecord(raw, what)
  const decision = asMemberOf(o.decision, DECISIONS, `${what}.decision`)
  return {
    run_id: asString(o.run_id, `${what}.run_id`),
    step_id: asString(o.step_id, `${what}.step_id`),
    attempt_id: asCount(o.attempt_id, `${what}.attempt_id`),
    principalId: asString(o.principalId, `${what}.principalId`),
    approval_event_id: asString(
      o.approval_event_id,
      `${what}.approval_event_id`,
    ),
    decision: decision as ApprovalRecord['decision'],
    ...(o.rationale !== undefined
      ? { rationale: asString(o.rationale, `${what}.rationale`) }
      : {}),
    timestamp: asNumber(o.timestamp, `${what}.timestamp`),
  }
}

function parseGateResults(
  raw: unknown,
  what: string,
): Partial<Record<TrinityComponent, GateVerdict>> {
  const o = asRecord(raw, what)
  const result: Partial<Record<TrinityComponent, GateVerdict>> = {}
  for (const key of Object.keys(o)) {
    const component = asMemberOf(key, TRINITY_COMPONENTS, `${what} key`)
    const v = asRecord(o[key], `${what}.${key}`)
    const outcome = asMemberOf(
      v.outcome,
      GATE_OUTCOMES,
      `${what}.${key}.outcome`,
    )
    result[component as TrinityComponent] = {
      component: component as TrinityComponent,
      outcome: outcome as GateVerdict['outcome'],
      passed: outcome === 'passed',
      evidence: asString(v.evidence, `${what}.${key}.evidence`),
      rationale: asString(v.rationale, `${what}.${key}.rationale`),
      timestamp: asNumber(v.timestamp, `${what}.${key}.timestamp`),
    }
  }
  return result
}

/** Fields an attempt carries in common with the live step state. */
interface AttemptCore {
  artifacts: Record<string, unknown>
  gateResults: Partial<Record<TrinityComponent, GateVerdict>>
  approval?: ApprovalRecord
  holdReason?: HoldReason
}

function parseAttemptCore(
  o: Record<string, unknown>,
  what: string,
): AttemptCore {
  return {
    artifacts: asRecord(o.artifacts, `${what}.artifacts`),
    gateResults: parseGateResults(o.gateResults, `${what}.gateResults`),
    ...(o.approval !== undefined
      ? { approval: parseApproval(o.approval, `${what}.approval`) }
      : {}),
    ...(o.holdReason !== undefined
      ? {
        holdReason: asMemberOf(
          o.holdReason,
          HOLD_REASONS,
          `${what}.holdReason`,
        ) as HoldReason,
      }
      : {}),
  }
}

function parseHistory(
  raw: unknown,
  what: string,
): ReadonlyArray<AttemptRecord> {
  return asArray(raw, what).map((entry, i) => {
    const entryWhat = `${what}[${i}]`
    const o = asRecord(entry, entryWhat)
    if (o.superseded !== true) {
      throw new SnapshotInvalidError(
        `${entryWhat}.superseded must be true (history holds superseded attempts only).`,
      )
    }
    return {
      attempt_id: asCount(o.attempt_id, `${entryWhat}.attempt_id`),
      status: asMemberOf(
        o.status,
        STEP_STATUSES,
        `${entryWhat}.status`,
      ) as StepStatus,
      ...parseAttemptCore(o, entryWhat),
      superseded: true,
    }
  })
}

function parseStep(raw: unknown, index: number): PersistedStepState {
  const what = `snapshot.steps[${index}]`
  const o = asRecord(raw, what)
  const stepId = asString(o.stepId, `${what}.stepId`)
  const def = getStepDefinitionById(stepId)
  if (def === undefined) {
    throw new SnapshotInvalidError(
      `${what}.stepId '${stepId}' is not a step of the live 16-step pipeline.`,
    )
  }
  const attempts = asCount(o.attempts, `${what}.attempts`)
  const attemptId = asCount(o.attempt_id, `${what}.attempt_id`)
  if (attemptId > attempts) {
    throw new SnapshotInvalidError(
      `${what}.attempt_id ${attemptId} exceeds attempts ${attempts} (the engine advances the attempt id once per start).`,
    )
  }
  const outputs = asArray(o.outputs, `${what}.outputs`).map((s, i) =>
    asString(s, `${what}.outputs[${i}]`),
  )
  if (
    outputs.length !== def.outputs.length ||
    outputs.some((slug, i) => slug !== def.outputs[i])
  ) {
    throw new SnapshotInvalidError(
      `${what}.outputs [${outputs.join(', ')}] disagree with the live definition of '${stepId}' [${def.outputs.join(', ')}].`,
    )
  }
  return {
    stepId,
    status: asMemberOf(o.status, STEP_STATUSES, `${what}.status`) as StepStatus,
    attempts,
    attempt_id: attemptId,
    ...parseAttemptCore(o, what),
    history: parseHistory(o.history, `${what}.history`),
    ...(o.startedAt !== undefined
      ? { startedAt: asNumber(o.startedAt, `${what}.startedAt`) }
      : {}),
    ...(o.finishedAt !== undefined
      ? { finishedAt: asNumber(o.finishedAt, `${what}.finishedAt`) }
      : {}),
    outputs,
  }
}

function parseRegistry(raw: unknown): Record<string, ArtifactRecord> {
  const o = asRecord(raw, 'snapshot.registry')
  const registry: Record<string, ArtifactRecord> = {}
  for (const slug of Object.keys(o)) {
    const what = `snapshot.registry.${slug}`
    const rec = asRecord(o[slug], what)
    const recordedSlug = asString(rec.slug, `${what}.slug`)
    if (recordedSlug !== slug) {
      throw new SnapshotInvalidError(
        `${what}.slug '${recordedSlug}' does not match its registry key '${slug}'.`,
      )
    }
    const producerStepId = asString(
      rec.producerStepId,
      `${what}.producerStepId`,
    )
    if (getStepDefinitionById(producerStepId) === undefined) {
      throw new SnapshotInvalidError(
        `${what}.producerStepId '${producerStepId}' is not a step of the live 16-step pipeline.`,
      )
    }
    if (typeof rec.invalidated !== 'boolean') {
      throw new SnapshotInvalidError(`${what}.invalidated must be a boolean.`)
    }
    registry[slug] = {
      slug,
      producerStepId,
      producerAttemptId: asCount(
        rec.producerAttemptId,
        `${what}.producerAttemptId`,
      ),
      value: rec.value,
      producedAt: asNumber(rec.producedAt, `${what}.producedAt`),
      invalidated: rec.invalidated,
    }
  }
  return registry
}

function parseEvents(raw: unknown, runId: string): ReadonlyArray<AuditEvent> {
  return asArray(raw, 'snapshot.events').map((entry, i) => {
    const what = `snapshot.events[${i}]`
    const o = asRecord(entry, what)
    const eventRunId = asString(o.runId, `${what}.runId`)
    if (eventRunId !== runId) {
      throw new SnapshotInvalidError(
        `${what}.runId '${eventRunId}' does not match the snapshot's run '${runId}'.`,
      )
    }
    return {
      kind: asMemberOf(
        o.kind,
        AUDIT_EVENT_KINDS,
        `${what}.kind`,
      ) as AuditEvent['kind'],
      runId: eventRunId,
      ...(o.stepId !== undefined
        ? { stepId: asString(o.stepId, `${what}.stepId`) }
        : {}),
      ...(o.attemptId !== undefined
        ? { attemptId: asCount(o.attemptId, `${what}.attemptId`) }
        : {}),
      ts: asNumber(o.ts, `${what}.ts`),
      ...(o.detail !== undefined ? { detail: o.detail } : {}),
    }
  })
}

/**
 * Validate a durable value as a run snapshot record. Throws {@link SnapshotInvalidError} on any
 * contradiction with the run model or the live 16-step graph; never returns partial state. The
 * returned record is freshly built — it shares no container with `raw`.
 */
export function parseRunSnapshotPayload(raw: unknown): RunSnapshotPayload {
  const o = asRecord(raw, 'snapshot')
  const headerRaw = asRecord(o.run, 'snapshot.run')
  const runId = asString(headerRaw.runId, 'snapshot.run.runId')
  const inputs = asRecord(headerRaw.inputs, 'snapshot.run.inputs')
  const steps = asArray(o.steps, 'snapshot.steps').map((s, i) =>
    parseStep(s, i),
  )
  const seen = new Set<string>()
  for (const step of steps) {
    if (seen.has(step.stepId)) {
      throw new SnapshotInvalidError(
        `snapshot.steps contains '${step.stepId}' more than once.`,
      )
    }
    seen.add(step.stepId)
  }
  return {
    schemaVersion: asCount(o.schemaVersion, 'snapshot.schemaVersion'),
    savedAtIso: asString(o.savedAtIso, 'snapshot.savedAtIso'),
    revision: asCount(o.revision, 'snapshot.revision'),
    run: { runId, inputs },
    steps,
    registry: parseRegistry(o.registry),
    events: parseEvents(o.events, runId),
    consumedApprovalEventIds: asArray(
      o.consumedApprovalEventIds,
      'snapshot.consumedApprovalEventIds',
    ).map((id, i) => asString(id, `snapshot.consumedApprovalEventIds[${i}]`)),
  }
}

// ── Faithful capture ──────────────────────────────────────────────────────────

/**
 * Reject a run value the snapshot file cannot represent. `JSON.stringify` degrades exactly these
 * values silently — a `Map` becomes `{}`, `NaN`/`Infinity` become `null`, `undefined` keys
 * disappear — so a run holding one is refused at save time instead of being restored altered.
 * Artifact values are the run's own data, so a silent degradation here would change a result
 * across a restart. Cycles are rejected too (the walk is not a serializer).
 *
 * `ancestors` holds the objects on the path from the root to here, NOT every object ever
 * visited. The difference is the whole point: JSON represents a SHARED reference faithfully by
 * writing it out twice, and only an object that contains itself cannot be written at all. A set
 * that is never popped from conflates the two and refuses ordinary data — it refused this
 * repository's own `A3-agenda` artifact, whose `phases` and `plan` are the same array, and
 * reported a "cycle" that did not exist. An entry is therefore removed on the way back out.
 */
function assertJsonRepresentable(
  value: unknown,
  what: string,
  ancestors: Set<object>,
): void {
  if (value === null) return
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return
    case 'number':
      if (!Number.isFinite(value)) {
        throw new ResearchError(
          'DSH_SNAPSHOT_VALUE_NOT_JSON',
          `${what} is ${String(value)}, which JSON represents as null (T19 snapshot capture refuses a value it cannot persist faithfully).`,
        )
      }
      return
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      throw new ResearchError(
        'DSH_SNAPSHOT_VALUE_NOT_JSON',
        `${what} is a ${typeof value}, which JSON cannot represent (T19 snapshot capture refuses a value it cannot persist faithfully).`,
      )
    default:
      break
  }
  if (ancestors.has(value)) {
    throw new ResearchError(
      'DSH_SNAPSHOT_VALUE_NOT_JSON',
      `${what} is cyclic, which JSON cannot represent.`,
    )
  }
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      for (const [i, item] of (value as ReadonlyArray<unknown>).entries()) {
        assertJsonRepresentable(item, `${what}[${i}]`, ancestors)
      }
      return
    }
    const proto: unknown = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) {
      const name =
        (proto as { constructor?: { name?: string } }).constructor?.name ??
        'non-plain'
      throw new ResearchError(
        'DSH_SNAPSHOT_VALUE_NOT_JSON',
        `${what} is a ${name} instance, which JSON serializes as a plain object.`,
      )
    }
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) {
      assertJsonRepresentable(record[key], `${what}.${key}`, ancestors)
    }
  } finally {
    ancestors.delete(value)
  }
}

/** Assert `value` survives the snapshot file unchanged, then return it for direct use. */
function persistable<T>(value: T, what: string): T {
  assertJsonRepresentable(value, what, new Set<object>())
  return value
}

/**
 * Build the persisted record of `runId` from live run state. Every value is read from the store
 * the caller owns; the run itself is not mutated. Throws `RUN_NOT_FOUND` for an unknown run and
 * `DSH_SNAPSHOT_VALUE_NOT_JSON` for a value the snapshot file cannot hold faithfully.
 *
 * The returned record references the run's values (it is consumed synchronously by
 * {@link RunPersistence.save}, which serializes it immediately) and does not own them.
 */
export function captureRunSnapshot(
  store: ResearchRunStore,
  runId: string,
  revision: number,
): RunSnapshotPayload {
  const run: RunState | undefined = store.get(runId)
  if (run === undefined) {
    throw new ResearchRunError(
      'RUN_NOT_FOUND',
      `captureRunSnapshot: run '${runId}' not found`,
    )
  }
  const steps: PersistedStepState[] = []
  for (const [stepId, state] of run.steps) {
    steps.push({
      stepId,
      status: state.status,
      attempts: state.attempts,
      attempt_id: state.attempt_id,
      artifacts: persistable(
        { ...state.artifacts },
        `run '${runId}' step '${stepId}' artifacts`,
      ),
      gateResults: persistable(
        { ...state.gateResults },
        `run '${runId}' step '${stepId}' gateResults`,
      ),
      ...(state.approval !== undefined
        ? {
          approval: persistable(
            state.approval,
            `run '${runId}' step '${stepId}' approval`,
          ),
        }
        : {}),
      ...(state.holdReason !== undefined
        ? { holdReason: state.holdReason }
        : {}),
      history: persistable(
        [...state.history],
        `run '${runId}' step '${stepId}' history`,
      ),
      ...(state.startedAt !== undefined ? { startedAt: state.startedAt } : {}),
      ...(state.finishedAt !== undefined
        ? { finishedAt: state.finishedAt }
        : {}),
      outputs: [...state.outputs],
    })
  }
  const registry: Record<string, ArtifactRecord> = {}
  for (const rec of Object.values(run.registry)) {
    persistable(rec.value, `run '${runId}' artifact '${rec.slug}'`)
    registry[rec.slug] = { ...rec }
  }
  return {
    schemaVersion: RUN_SNAPSHOT_SCHEMA_VERSION,
    savedAtIso: new Date().toISOString(),
    revision,
    run: {
      runId,
      inputs: persistable({ ...run.inputs }, `run '${runId}' inputs`),
    },
    steps,
    registry,
    events: persistable(run.events, `run '${runId}' audit log`),
    consumedApprovalEventIds: [...run.consumedApprovals],
  }
}

// ── Restore ───────────────────────────────────────────────────────────────────

/** Read the audited disposition of a `step-executed` event's detail (unknown by declaration). */
function executedStatusOf(detail: unknown): string | undefined {
  if (detail === null || typeof detail !== 'object') return undefined
  const status = (detail as { status?: unknown }).status
  return typeof status === 'string' ? status : undefined
}

/**
 * Rebuild a run from a validated record and attach it to `capability`.
 *
 * The restored run is a fresh run store containing exactly this run: fresh `Map`/`Set`/object
 * containers, values taken from `payload`. Steps declared in the record but absent from the live
 * pipeline never reach here — {@link parseRunSnapshotPayload} rejects them. `capability` is not
 * read, copied from the record, or otherwise inspected; it is carried on the handle so the
 * resumed run executes through the capability THIS process built.
 */
export function restoreRun<C>(
  payload: RunSnapshotPayload,
  capability: C,
): RestoredRun<C> {
  const steps = new Map<string, StepState>()
  for (const persisted of payload.steps) {
    steps.set(persisted.stepId, {
      stepId: persisted.stepId,
      status: persisted.status,
      attempts: persisted.attempts,
      attempt_id: persisted.attempt_id,
      artifacts: { ...persisted.artifacts },
      gateResults: { ...persisted.gateResults },
      ...(persisted.approval !== undefined
        ? { approval: persisted.approval }
        : {}),
      ...(persisted.holdReason !== undefined
        ? { holdReason: persisted.holdReason }
        : {}),
      history: [...persisted.history],
      startedAt: persisted.startedAt,
      finishedAt: persisted.finishedAt,
      // Declared outputs come from the record, which parse checked against the live definition.
      outputs: [...persisted.outputs],
    })
  }
  const run: RunState = {
    runId: payload.run.runId,
    inputs: { ...payload.run.inputs },
    steps,
    registry: { ...payload.registry },
    events: [...payload.events],
    consumedApprovals: new Set<string>(payload.consumedApprovalEventIds),
  }
  const store: ResearchRunStore = new Map([[run.runId, run]])

  const interrupted: InterruptedStep[] = []
  for (const [stepId, state] of steps) {
    if (state.status !== 'in_progress') continue
    const exec = payload.events.find(
      e =>
        e.kind === 'step-executed' &&
        e.stepId === stepId &&
        e.attemptId === state.attempt_id,
    )
    const executed = exec !== undefined
    const resumeVia =
      executedStatusOf(exec?.detail) === 'success'
        ? 'continue_gate'
        : 'rollback_and_retry'
    interrupted.push({
      stepId,
      attemptId: state.attempt_id,
      executed,
      resumeVia,
    })
  }

  return {
    store,
    runId: run.runId,
    revision: payload.revision,
    savedAtIso: payload.savedAtIso,
    capability,
    consumedApprovalEventIds: [...payload.consumedApprovalEventIds],
    interrupted,
  }
}

// ── Persistence ───────────────────────────────────────────────────────────────

/**
 * Create the persistence for one snapshot directory. Each call opens its own view of the file;
 * two processes may hold one apiece and are kept consistent by the revision guard, not by shared
 * memory.
 */
export function createRunPersistence(
  options: RunPersistenceOptions,
): RunPersistence {
  const dir = options.dir
  const schemaVersion = options.schemaVersion ?? RUN_SNAPSHOT_SCHEMA_VERSION
  const file: SnapshotStore<RunSnapshotPayload> =
    createFileSnapshotStore<RunSnapshotPayload>({ dir, schemaVersion })

  async function read(): Promise<RunSnapshotPayload> {
    return parseRunSnapshotPayload(await file.load())
  }

  async function readIfPresent(): Promise<RunSnapshotPayload | null> {
    try {
      return await read()
    } catch (cause) {
      if (cause instanceof SnapshotNotFoundError) return null
      // A corrupt / version-incompatible / invalid predecessor is never treated as absent —
      // the caller sees why the file was rejected.
      throw cause
    }
  }

  return {
    async save(
      store: ResearchRunStore,
      runId: string,
      saveOptions: RunSaveOptions,
    ): Promise<RunSnapshotPayload> {
      // The WHOLE read-compare-write is inside the lock, which is what makes the guard a guard.
      return await withSaveLock(dir, runId, async () => {
        const persisted = await readIfPresent()
        const persistedRevision = persisted?.revision ?? 0
        if (saveOptions.baseRevision !== persistedRevision) {
          throw new SnapshotConflictError(
            persistedRevision,
            saveOptions.baseRevision,
          )
        }
        const payload = captureRunSnapshot(store, runId, persistedRevision + 1)
        try {
          await file.save(payload)
        } catch (cause) {
          // The revision guard above is a read-then-write, and two PROCESSES can both pass it: each
          // reads revision N, each captures N+1, and the writes collide. The file layer survives
          // that — it writes a temp file and renames it over the target, so exactly one wins — but
          // the loser is told whatever the filesystem said, which on Windows is
          // `EPERM: operation not permitted, rename ...`. That names an operation, not the fact,
          // and the fact is the one this module already has a word for.
          //
          // So: when the write fails, re-read. If the revision MOVED, the failure was this race and
          // the caller gets the conflict, naming the revision that beat it. If it did not move, the
          // failure is something else — a real permission problem, a full disk — and is rethrown
          // with its own cause rather than disguised as a conflict.
          const afterFailure = await readIfPresent().catch(() => null)
          const winnerRevision = afterFailure?.revision ?? persistedRevision
          if (winnerRevision !== persistedRevision) {
            throw new SnapshotConflictError(
              winnerRevision,
              saveOptions.baseRevision,
            )
          }
          throw cause
        }
        return payload
      })
    },

    async load<C>(capability: C): Promise<RestoredRun<C>> {
      return restoreRun(await read(), capability)
    },

    async tryLoad<C>(capability: C): Promise<RestoredRun<C> | null> {
      const payload = await readIfPresent()
      return payload === null ? null : restoreRun(payload, capability)
    },

    read,

    async discard(): Promise<void> {
      try {
        await unlink(join(dir, SNAPSHOT_FILE_NAME))
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return
        throw cause
      }
    },
  }
}
