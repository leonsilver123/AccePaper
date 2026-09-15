/**
 * The task attempt: one execution of one unit of work, with the lease that authorizes it.
 *
 * A retry is a new attempt, never the same attempt run again, and the lease is what makes that
 * enforceable: the attempt that holds the lease may write, and an attempt whose lease has been
 * superseded cannot — however long its executor took to come back. Without the lease the store
 * has only "the current attempt id", which is a value an old execution can read after it has
 * already changed, which is how a rolled-back run accepted a superseded result.
 *
 * THE RECEIPT IS NOT A RESULT. It records that an executor ran, under which rule version, and
 * whether it exited cleanly. Whether the work was any good is a gate's question, asked of the
 * artifacts the attempt committed.
 */

import type {
  ArtifactVersion,
  ArtifactId,
  ContentHash,
  LeaseId,
  ProjectId,
  TaskAttemptId,
  TaskId,
} from './ids.ts'
import { DOMAIN_ERROR_PREFIX } from './ids.ts'
import type { Parsed } from './ingress.ts'
import { accept, asRecord, countField, isContentHash, numberField, refuse, stringField } from './ingress.ts'

/** Where an attempt sits in its life. `settled` means it committed or was refused; `expired`
 *  means its lease ran out, which is not the same failure and does not free it to write. */
export type TaskAttemptState = 'leased' | 'running' | 'settled' | 'expired'

/**
 * The exclusive right of one attempt to write, bounded in time.
 *
 * `expiresAt` is a wall-clock millisecond, deliberately: a lease is about a process that may no
 * longer exist, so it cannot be measured in anything the process owns.
 */
export interface TaskLease {
  readonly leaseId: LeaseId
  readonly attemptId: TaskAttemptId
  readonly acquiredAt: number
  readonly expiresAt: number
}

/** What one task may consume. Bounds the whole task, not one attempt, so a retry loop cannot
 *  spend an unbounded amount by being chopped into attempts. */
export interface TaskBudget {
  readonly maxAttempts: number
  readonly maxWallClockMs: number
}

/** What one executor did, in the terms the runner can check afterwards. */
export interface ExecutionReceipt {
  readonly executor: string
  readonly ruleVersion: string
  readonly startedAt: number
  readonly finishedAt: number
  /** Process exit code, for an executor that was a process. Absent for in-process executors. */
  readonly exitCode?: number
  /** The artifacts this attempt produced, by reference. */
  readonly outputs: ReadonlyArray<{
    readonly artifactId: ArtifactId
    readonly version: ArtifactVersion
    readonly contentHash: ContentHash
  }>
  /** Present when the executor failed; the attempt then has no outputs to speak of. */
  readonly failure?: string
}

/** One execution of one task. */
export interface TaskAttempt {
  readonly attemptId: TaskAttemptId
  readonly taskId: TaskId
  readonly projectId: ProjectId
  /** 1 for the first execution, incrementing per retry. Never reused. */
  readonly attempt: number
  readonly state: TaskAttemptState
  readonly lease: TaskLease
  /** Which configuration revision this attempt ran under, so a later reader can tell whether the
   *  result belongs to today's configuration. */
  readonly configVersion: string
  readonly startedAt: number
  readonly budget: TaskBudget
  readonly receipt?: ExecutionReceipt
}

/**
 * Whether a lease still authorizes a write at a given instant.
 *
 * Checked at the commit point rather than when the executor starts, because the executor's
 * duration is exactly what the lease is protecting against.
 *
 * @param lease - the lease the attempt holds.
 * @param now - the current wall-clock millisecond.
 * @returns true when the lease has not expired.
 */
export function leaseHolds(lease: TaskLease, now: number): boolean {
  return now < lease.expiresAt
}

/**
 * Whether an attempt may still write: it holds a live lease and has not already settled.
 *
 * @param attempt - the attempt.
 * @param now - the current wall-clock millisecond.
 * @returns true when the attempt may write.
 */
export function attemptMayWrite(attempt: TaskAttempt, now: number): boolean {
  return (attempt.state === 'leased' || attempt.state === 'running') && leaseHolds(attempt.lease, now)
}

/**
 * Read one task attempt off an untyped boundary.
 *
 * @param value - the value read from a stored record or a queued entry.
 * @returns the attempt, or the refusal naming the first thing wrong with it.
 */
export function parseTaskAttemptIngress(value: unknown): Parsed<TaskAttempt> {
  const record = asRecord(value)
  if (record === undefined) {
    return refuse(`${DOMAIN_ERROR_PREFIX}NOT_AN_OBJECT`, 'task attempt record is not an object')
  }
  const attemptId = stringField(record, 'attemptId')
  if (attemptId === undefined) return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "task attempt has no non-empty 'attemptId'")
  const taskId = stringField(record, 'taskId')
  if (taskId === undefined) return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "task attempt has no non-empty 'taskId'")
  const projectId = stringField(record, 'projectId')
  if (projectId === undefined) return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "task attempt has no non-empty 'projectId'")
  const attempt = countField(record, 'attempt')
  if (attempt === undefined || attempt < 1) {
    return refuse(`${DOMAIN_ERROR_PREFIX}BAD_FIELD`, "task attempt has no integer 'attempt' of at least 1")
  }
  const startedAt = numberField(record, 'startedAt')
  if (startedAt === undefined) return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "task attempt has no finite 'startedAt'")
  const configVersion = stringField(record, 'configVersion')
  if (configVersion === undefined) {
    return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "task attempt has no non-empty 'configVersion'")
  }
  if (record['state'] !== 'leased' && record['state'] !== 'running' && record['state'] !== 'settled' && record['state'] !== 'expired') {
    return refuse(`${DOMAIN_ERROR_PREFIX}BAD_FIELD`, "task attempt has no usable 'state' (expected one of leased, running, settled, expired)")
  }
  const leaseRecord = asRecord(record['lease'])
  if (leaseRecord === undefined) {
    return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "task attempt has no 'lease' object: without one it cannot be told from an attempt whose lease was superseded")
  }
  const leaseId = stringField(leaseRecord, 'leaseId')
  const leaseAttemptId = stringField(leaseRecord, 'attemptId')
  const acquiredAt = numberField(leaseRecord, 'acquiredAt')
  const expiresAt = numberField(leaseRecord, 'expiresAt')
  if (leaseId === undefined || leaseAttemptId === undefined || acquiredAt === undefined || expiresAt === undefined) {
    return refuse(`${DOMAIN_ERROR_PREFIX}BAD_FIELD`, 'task lease needs a non-empty leaseId and attemptId, and finite acquiredAt and expiresAt')
  }
  if (leaseAttemptId !== attemptId) {
    return refuse(
      `${DOMAIN_ERROR_PREFIX}BAD_REFERENCE`,
      `task lease names attempt '${leaseAttemptId}' but the record is attempt '${attemptId}' — a lease belongs to exactly the attempt it was issued for`,
    )
  }
  if (expiresAt <= acquiredAt) {
    return refuse(`${DOMAIN_ERROR_PREFIX}BAD_FIELD`, 'task lease expires at or before it was acquired')
  }
  const budgetRecord = asRecord(record['budget'])
  if (budgetRecord === undefined) {
    return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "task attempt has no 'budget' object")
  }
  const maxAttempts = countField(budgetRecord, 'maxAttempts')
  const maxWallClockMs = numberField(budgetRecord, 'maxWallClockMs')
  if (maxAttempts === undefined || maxWallClockMs === undefined || maxWallClockMs <= 0) {
    return refuse(`${DOMAIN_ERROR_PREFIX}BAD_FIELD`, 'task budget needs a non-negative integer maxAttempts and a positive maxWallClockMs')
  }
  const rawReceipt = record['receipt']
  let receipt: ExecutionReceipt | undefined
  if (rawReceipt !== undefined) {
    const receiptRecord = asRecord(rawReceipt)
    if (receiptRecord === undefined) {
      return refuse(`${DOMAIN_ERROR_PREFIX}BAD_FIELD`, "task attempt 'receipt' is present but is not an object")
    }
    const executor = stringField(receiptRecord, 'executor')
    const ruleVersion = stringField(receiptRecord, 'ruleVersion')
    const receiptStartedAt = numberField(receiptRecord, 'startedAt')
    const finishedAt = numberField(receiptRecord, 'finishedAt')
    if (executor === undefined || ruleVersion === undefined || receiptStartedAt === undefined || finishedAt === undefined) {
      return refuse(`${DOMAIN_ERROR_PREFIX}BAD_FIELD`, 'task receipt needs a non-empty executor and ruleVersion, and finite startedAt and finishedAt')
    }
    const rawOutputs = receiptRecord['outputs']
    if (!Array.isArray(rawOutputs)) {
      return refuse(`${DOMAIN_ERROR_PREFIX}BAD_FIELD`, "task receipt has no 'outputs' array")
    }
    const outputs: ExecutionReceipt['outputs'][number][] = []
    for (const raw of rawOutputs) {
      const outputRecord = asRecord(raw)
      const artifactId = outputRecord === undefined ? undefined : stringField(outputRecord, 'artifactId')
      const version = outputRecord === undefined ? undefined : countField(outputRecord, 'version')
      const contentHash = outputRecord === undefined ? undefined : outputRecord['contentHash']
      if (artifactId === undefined || version === undefined || !isContentHash(contentHash)) {
        return refuse(`${DOMAIN_ERROR_PREFIX}BAD_REFERENCE`, 'a task receipt output needs a non-empty artifactId, a non-negative integer version, and a contentHash')
      }
      outputs.push({ artifactId: artifactId as ArtifactId, version: version as ArtifactVersion, contentHash })
    }
    const rawExitCode = receiptRecord['exitCode']
    if (rawExitCode !== undefined && !Number.isInteger(rawExitCode)) {
      return refuse(`${DOMAIN_ERROR_PREFIX}BAD_FIELD`, "task receipt 'exitCode' is present but is not an integer")
    }
    const exitCode = rawExitCode === undefined ? undefined : (rawExitCode as number)
    const failure = receiptRecord['failure']
    if (failure !== undefined && typeof failure !== 'string') {
      return refuse(`${DOMAIN_ERROR_PREFIX}BAD_FIELD`, "task receipt 'failure' is present but is not a string")
    }
    receipt = {
      executor,
      ruleVersion,
      startedAt: receiptStartedAt,
      finishedAt,
      outputs,
      ...(exitCode !== undefined ? { exitCode } : {}),
      ...(failure !== undefined ? { failure } : {}),
    }
  }
  return accept({
    attemptId: attemptId as TaskAttemptId,
    taskId: taskId as TaskId,
    projectId: projectId as ProjectId,
    attempt,
    state: record['state'],
    lease: {
      leaseId: leaseId as LeaseId,
      attemptId: attemptId as TaskAttemptId,
      acquiredAt,
      expiresAt,
    },
    configVersion,
    startedAt,
    budget: { maxAttempts, maxWallClockMs },
    ...(receipt !== undefined ? { receipt } : {}),
  })
}
