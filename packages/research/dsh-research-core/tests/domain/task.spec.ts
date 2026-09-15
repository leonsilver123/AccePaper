/**
 * Tests for the task attempt and its lease: what the ingress parser refuses at a stored/queued
 * boundary, and the two predicates the commit point asks before letting an execution write.
 *
 * The acceptance requirement these cases are evidence for is that a form with a wrong reference is
 * refused: a lease naming a different attempt than the record it arrives with cannot be read as
 * belonging to it, and an attempt whose lease has run out may not write however it is labelled.
 */

import { describe, expect, it } from 'vitest'

import { attemptMayWrite, leaseHolds, parseTaskAttemptIngress } from '../../src/domain/task.ts'
import type { TaskAttempt } from '../../src/domain/task.ts'

const HASH_A = 'a1'.repeat(32)
const ACQUIRED_AT = 1_760_000_000_000
const EXPIRES_AT = ACQUIRED_AT + 60_000

function validAttempt(): Record<string, unknown> {
  return {
    attemptId: 'attempt-1',
    taskId: 'task-a1-landscape',
    projectId: 'project-1',
    attempt: 1,
    state: 'leased',
    lease: {
      leaseId: 'lease-1',
      attemptId: 'attempt-1',
      acquiredAt: ACQUIRED_AT,
      expiresAt: EXPIRES_AT,
    },
    configVersion: 'recipe-v3',
    startedAt: ACQUIRED_AT,
    budget: { maxAttempts: 3, maxWallClockMs: 600_000 },
  }
}

/** The valid record with one top-level field removed, for the "field is absent" refusals. */
function without(field: string): Record<string, unknown> {
  const { [field]: _removed, ...rest } = validAttempt()
  return rest
}

function withLease(lease: unknown): Record<string, unknown> {
  return { ...validAttempt(), lease }
}

function withBudget(budget: unknown): Record<string, unknown> {
  return { ...validAttempt(), budget }
}

/** Parse the record, failing the case when it was accepted instead of refused. */
function refusalOf(value: unknown) {
  const parsed = parseTaskAttemptIngress(value)
  if (parsed.ok) throw new Error('fixture: the task attempt was accepted and should have been refused')
  return parsed
}

/** Parse the record, failing the case when it was refused instead of accepted. */
function acceptAttempt(value: unknown): TaskAttempt {
  const parsed = parseTaskAttemptIngress(value)
  if (!parsed.ok) throw new Error(`fixture: attempt refused with ${parsed.code}: ${parsed.reason}`)
  return parsed.value
}

describe('parseTaskAttemptIngress refuses a record it cannot read', () => {
  const refusals: ReadonlyArray<{
    label: string
    value: unknown
    code: string
    names: readonly string[]
  }> = [
    {
      label: 'a value that is not an object',
      value: 'attempt',
      code: 'DSH_DOMAIN_NOT_AN_OBJECT',
      names: ['not an object'],
    },
    { label: 'an array', value: [], code: 'DSH_DOMAIN_NOT_AN_OBJECT', names: ['not an object'] },
    { label: 'no attemptId', value: without('attemptId'), code: 'DSH_DOMAIN_MISSING_FIELD', names: ['attemptId'] },
    { label: 'no taskId', value: without('taskId'), code: 'DSH_DOMAIN_MISSING_FIELD', names: ['taskId'] },
    { label: 'no projectId', value: without('projectId'), code: 'DSH_DOMAIN_MISSING_FIELD', names: ['projectId'] },
    {
      label: 'no configVersion',
      value: without('configVersion'),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['configVersion'],
    },
    { label: 'no startedAt', value: without('startedAt'), code: 'DSH_DOMAIN_MISSING_FIELD', names: ['startedAt'] },
    {
      label: 'attempt 0: the first execution is attempt 1',
      value: { ...validAttempt(), attempt: 0 },
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['attempt'],
    },
    {
      label: 'a negative attempt',
      value: { ...validAttempt(), attempt: -1 },
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['attempt'],
    },
    {
      label: 'an attempt that is not an integer',
      value: { ...validAttempt(), attempt: 1.5 },
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['attempt'],
    },
    {
      label: 'an unknown state',
      value: { ...validAttempt(), state: 'paused' },
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['leased', 'settled', 'expired'],
    },
    {
      label: 'no state',
      value: without('state'),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['state'],
    },
    {
      label: 'no lease object',
      value: without('lease'),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['lease'],
    },
    {
      label: 'a lease that is not an object',
      value: withLease('lease-1'),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['lease'],
    },
    {
      label: 'a lease with no leaseId',
      value: withLease({ attemptId: 'attempt-1', acquiredAt: ACQUIRED_AT, expiresAt: EXPIRES_AT }),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['leaseId'],
    },
    {
      label: "a lease naming an attempt other than the record's own",
      value: withLease({
        leaseId: 'lease-1',
        attemptId: 'attempt-2',
        acquiredAt: ACQUIRED_AT,
        expiresAt: EXPIRES_AT,
      }),
      code: 'DSH_DOMAIN_BAD_REFERENCE',
      names: ['attempt-2', 'attempt-1'],
    },
    {
      label: 'a lease that expires at the instant it was acquired',
      value: withLease({ leaseId: 'lease-1', attemptId: 'attempt-1', acquiredAt: ACQUIRED_AT, expiresAt: ACQUIRED_AT }),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['expires at or before'],
    },
    {
      label: 'a lease that expired before it was acquired',
      value: withLease({
        leaseId: 'lease-1',
        attemptId: 'attempt-1',
        acquiredAt: ACQUIRED_AT,
        expiresAt: ACQUIRED_AT - 1,
      }),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['expires at or before'],
    },
    {
      label: 'a lease whose timestamps are not numbers',
      value: withLease({ leaseId: 'lease-1', attemptId: 'attempt-1', acquiredAt: 'now', expiresAt: EXPIRES_AT }),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['acquiredAt', 'expiresAt'],
    },
    { label: 'no budget object', value: without('budget'), code: 'DSH_DOMAIN_MISSING_FIELD', names: ['budget'] },
    {
      label: 'a budget that is not an object',
      value: withBudget(600_000),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['budget'],
    },
    {
      label: 'a budget with a zero wall clock',
      value: withBudget({ maxAttempts: 3, maxWallClockMs: 0 }),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['maxWallClockMs'],
    },
    {
      label: 'a budget with a negative attempt count',
      value: withBudget({ maxAttempts: -1, maxWallClockMs: 600_000 }),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['maxAttempts'],
    },
    {
      label: 'a receipt that is not an object',
      value: { ...validAttempt(), receipt: 'ok' },
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['receipt'],
    },
    {
      label: 'a receipt with no ruleVersion',
      value: {
        ...validAttempt(),
        receipt: { executor: 'worker', startedAt: ACQUIRED_AT, finishedAt: EXPIRES_AT, outputs: [] },
      },
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['ruleVersion'],
    },
    {
      label: 'a receipt with no outputs array',
      value: {
        ...validAttempt(),
        receipt: { executor: 'worker', ruleVersion: 'v2', startedAt: ACQUIRED_AT, finishedAt: EXPIRES_AT },
      },
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['outputs'],
    },
    {
      label: 'a receipt output with a bad contentHash',
      value: {
        ...validAttempt(),
        receipt: {
          executor: 'worker',
          ruleVersion: 'v2',
          startedAt: ACQUIRED_AT,
          finishedAt: EXPIRES_AT,
          outputs: [{ artifactId: 'landscape-map', version: 1, contentHash: 'nope' }],
        },
      },
      code: 'DSH_DOMAIN_BAD_REFERENCE',
      names: ['contentHash'],
    },
    {
      label: 'a receipt output with a negative version',
      value: {
        ...validAttempt(),
        receipt: {
          executor: 'worker',
          ruleVersion: 'v2',
          startedAt: ACQUIRED_AT,
          finishedAt: EXPIRES_AT,
          outputs: [{ artifactId: 'landscape-map', version: -1, contentHash: HASH_A }],
        },
      },
      code: 'DSH_DOMAIN_BAD_REFERENCE',
      names: ['version'],
    },
    {
      label: 'a receipt with a non-integer exitCode',
      value: {
        ...validAttempt(),
        receipt: {
          executor: 'worker',
          ruleVersion: 'v2',
          startedAt: ACQUIRED_AT,
          finishedAt: EXPIRES_AT,
          outputs: [],
          exitCode: 'ok',
        },
      },
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['exitCode'],
    },
    {
      label: 'a receipt with a non-string failure',
      value: {
        ...validAttempt(),
        receipt: {
          executor: 'worker',
          ruleVersion: 'v2',
          startedAt: ACQUIRED_AT,
          finishedAt: EXPIRES_AT,
          outputs: [],
          failure: { message: 'boom' },
        },
      },
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['failure'],
    },
  ]

  for (const testCase of refusals) {
    it(`refuses ${testCase.label}`, () => {
      const failure = refusalOf(testCase.value)
      expect(failure.code).toBe(testCase.code)
      for (const name of testCase.names) expect(failure.reason).toContain(name)
    })
  }
})

describe('parseTaskAttemptIngress accepts an attempt that names its own lease', () => {
  it('reads the attempt without a receipt, and leaves the receipt key absent', () => {
    const attempt = acceptAttempt(validAttempt())
    expect(attempt.attemptId).toBe('attempt-1')
    expect(attempt.taskId).toBe('task-a1-landscape')
    expect(attempt.projectId).toBe('project-1')
    expect(attempt.attempt).toBe(1)
    expect(attempt.state).toBe('leased')
    expect(attempt.configVersion).toBe('recipe-v3')
    expect(attempt.startedAt).toBe(ACQUIRED_AT)
    expect(attempt.budget).toEqual({ maxAttempts: 3, maxWallClockMs: 600_000 })
    expect(attempt.lease).toEqual({
      leaseId: 'lease-1',
      attemptId: 'attempt-1',
      acquiredAt: ACQUIRED_AT,
      expiresAt: EXPIRES_AT,
    })
    expect('receipt' in attempt).toBe(false)
  })

  it('carries a receipt when the executor reported one', () => {
    const attempt = acceptAttempt({
      ...validAttempt(),
      state: 'settled',
      receipt: {
        executor: 'dsh-research-worker',
        ruleVersion: 'worker-v2',
        startedAt: ACQUIRED_AT,
        finishedAt: ACQUIRED_AT + 5_000,
        exitCode: 0,
        outputs: [{ artifactId: 'landscape-map', version: 2, contentHash: HASH_A }],
      },
    })
    expect(attempt.receipt?.executor).toBe('dsh-research-worker')
    expect(attempt.receipt?.exitCode).toBe(0)
    expect(attempt.receipt?.outputs).toEqual([{ artifactId: 'landscape-map', version: 2, contentHash: HASH_A }])
    expect(attempt.receipt?.failure).toBeUndefined()
  })

  it('carries a failed receipt with no outputs, which is a result the runner records', () => {
    const attempt = acceptAttempt({
      ...validAttempt(),
      state: 'settled',
      receipt: {
        executor: 'dsh-research-worker',
        ruleVersion: 'worker-v2',
        startedAt: ACQUIRED_AT,
        finishedAt: ACQUIRED_AT + 5_000,
        outputs: [],
        failure: 'executor exited 1',
      },
    })
    expect(attempt.receipt?.failure).toBe('executor exited 1')
    expect(attempt.receipt?.outputs).toEqual([])
    // The receipt says the executor ran; it does not say the work was any good.
    expect('exitCode' in (attempt.receipt ?? {})).toBe(false)
  })
})

describe('leaseHolds: the boundary is the expiry instant', () => {
  it('holds strictly before expiresAt and not at it', () => {
    const lease = acceptAttempt(validAttempt()).lease
    expect(leaseHolds(lease, ACQUIRED_AT)).toBe(true)
    expect(leaseHolds(lease, EXPIRES_AT - 1)).toBe(true)
    expect(leaseHolds(lease, EXPIRES_AT)).toBe(false)
    expect(leaseHolds(lease, EXPIRES_AT + 1)).toBe(false)
  })
})

describe('attemptMayWrite: a live lease and an unsettled attempt', () => {
  const attempt = acceptAttempt(validAttempt())

  it('is true for a live lease on a leased or running attempt', () => {
    for (const state of ['leased', 'running'] as const) {
      expect(attemptMayWrite({ ...attempt, state }, ACQUIRED_AT), state).toBe(true)
    }
  })

  it('is false for an attempt that settled or expired, even while its lease is live', () => {
    // A settled attempt has committed or been refused, and an expired one lost the right to write.
    // Neither becomes writable again by still holding a lease inside its window.
    for (const state of ['settled', 'expired'] as const) {
      expect(attemptMayWrite({ ...attempt, state }, ACQUIRED_AT), state).toBe(false)
    }
  })

  it('is false for a leased attempt whose lease has run out', () => {
    expect(attemptMayWrite(attempt, EXPIRES_AT)).toBe(false)
  })
})
