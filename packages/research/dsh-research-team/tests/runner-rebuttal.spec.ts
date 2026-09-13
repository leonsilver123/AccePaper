// @deepseek-ai/dsh-research-team — runner/rebuttal.ts pure-logic spec (D4).
//
// Pins the D4 revision-record contract that the step's executor builds its
// audit trail through:
//   - NO DEFAULT PASS: an empty round throws (it never yields a well-formed
//     "0 concerns, nothing to revise" record), and blank/missing fields throw
//     instead of being read as an absent concern or an absent revision;
//   - DERIVED AGGREGATES: `revisionCount` is counted from the points and
//     `hasRevisions` follows from it — neither is trusted from, or spoofable
//     by, the input;
//   - SNAPSHOT ISOLATION (INV-WRITE-ISOLATION / INV-SNAPSHOT): the record is an
//     independent, recursively frozen clone, so later input mutation cannot
//     reach it and mutation of the record itself throws.
//
// NOTE ON THE FILE NAME: `tests/rebuttal.spec.ts` already exists in this
// package and covers `src/redteam/rebuttal.ts` (the adjudication round state
// machine). This spec therefore follows the `tests/runner-*.spec.ts` convention
// — `runner-registry.spec.ts` covers `src/runner/registry.ts` the same way —
// rather than overwriting the unrelated redteam suite.

import { describe, expect, it } from 'vitest'
import { buildRevisionRecord, DSH_REBUTTAL_ERROR_PREFIX } from '../src/runner/rebuttal.ts'
import type { RebuttalPoint } from '../src/runner/rebuttal.ts'

/** A point that answers the concern without committing to a manuscript change. */
function point(concern: string, response: string, requiresRevision = false): RebuttalPoint {
  return { concern, response, requiresRevision }
}

/** Run `fn` and return the `[DSH_REBUTTAL_*]` code of the Error it threw. */
function errorCodeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (error) {
    if (error instanceof Error) {
      const match = /^\[([A-Z0-9_]+)\]/.exec(error.message)
      return match?.[1]
    }
    return undefined
  }
  return undefined
}

/** Assert `fn` rejects with one exact code suffix and a prefixed message. */
function expectCode(fn: () => unknown, suffix: string): void {
  expect(errorCodeOf(fn)).toBe(`${DSH_REBUTTAL_ERROR_PREFIX}${suffix}`)
  expect(fn).toThrow(new RegExp(`^\\[${DSH_REBUTTAL_ERROR_PREFIX}${suffix}\\] `))
}

describe('buildRevisionRecord — derived aggregates', () => {
  it('counts only the points that require a revision', () => {
    const record = buildRevisionRecord([
      point('Baseline is unfair', 'Added the matched-budget baseline.', true),
      point('Novelty is unclear', 'Added a related-work paragraph.'),
      point('Boundary conditions?', 'Added the C3 domain probe.', true),
    ])
    expect(record.revisionCount).toBe(2)
    expect(record.hasRevisions).toBe(true)
  })

  it('reports no revisions only when every point declined one', () => {
    const record = buildRevisionRecord([
      point('Typo in section 3', 'Fixed.'),
      point('Figure 2 is unreadable at print size', 'Re-rendered at 300 dpi.'),
    ])
    expect(record.revisionCount).toBe(0)
    expect(record.hasRevisions).toBe(false)
  })

  it('preserves input order and stores concern/response verbatim', () => {
    const record = buildRevisionRecord([
      point('  padded concern  ', '  padded response  ', true),
      point('second concern', 'second response'),
    ])
    expect(record.points.map(p => p.concern)).toEqual(['  padded concern  ', 'second concern'])
    expect(record.points[0]?.response).toBe('  padded response  ')
    expect(record.points[1]?.requiresRevision).toBe(false)
  })

  it('derives the aggregates from the points instead of trusting the input', () => {
    // A point that tries to declare the outcome itself: the spoofed keys are
    // dropped, and neither aggregate is read from the caller.
    const spoofed = [
      { concern: 'a', response: 'b', requiresRevision: false, revisionCount: 7, hasRevisions: true },
    ] as unknown as ReadonlyArray<RebuttalPoint>
    const record = buildRevisionRecord(spoofed)
    expect(record.revisionCount).toBe(0)
    expect(record.hasRevisions).toBe(false)
    expect(Object.keys(record).sort()).toEqual(['basis', 'hasRevisions', 'points', 'revisionCount'])
    expect(Object.keys(record.points[0] ?? {}).sort()).toEqual([
      'concern',
      'requiresRevision',
      'response',
    ])
  })

  it('keeps hasRevisions consistent with revisionCount on a mixed round', () => {
    for (let requiring = 0; requiring <= 3; requiring += 1) {
      const points = Array.from({ length: 3 }, (_, i) => point(`c${i}`, `r${i}`, i < requiring))
      const record = buildRevisionRecord(points)
      expect(record.revisionCount).toBe(requiring)
      expect(record.hasRevisions).toBe(record.revisionCount > 0)
      expect(record.points).toHaveLength(3)
    }
  })
})

describe('buildRevisionRecord — basis line', () => {
  it('states the answered/revision split when revisions are required', () => {
    const record = buildRevisionRecord([
      point('c1', 'r1', true),
      point('c2', 'r2', false),
      point('c3', 'r3', true),
    ])
    expect(record.basis).toBe(
      'D4-rebuttal: 3 concern(s) answered; 2 require manuscript revision; 1 answered without revision',
    )
  })

  it('states that nothing required a revision when the count is zero', () => {
    const record = buildRevisionRecord([point('c1', 'r1')])
    expect(record.basis).toBe('D4-rebuttal: 1 concern(s) answered; none require manuscript revision')
  })

  it('is a single line with no embedded newline', () => {
    const record = buildRevisionRecord([point('c1', 'r1', true), point('c2', 'r2')])
    expect(record.basis).not.toContain('\n')
  })
})

describe('buildRevisionRecord — NO DEFAULT PASS rejections', () => {
  it('throws on an empty round instead of returning an empty record', () => {
    expectCode(() => buildRevisionRecord([]), 'EMPTY_POINTS')
  })

  it('throws on a non-array input', () => {
    expect(errorCodeOf(() => buildRevisionRecord(null as unknown as ReadonlyArray<RebuttalPoint>)))
      .toBe(`${DSH_REBUTTAL_ERROR_PREFIX}INVALID_POINTS`)
    expect(errorCodeOf(() => buildRevisionRecord('nope' as unknown as ReadonlyArray<RebuttalPoint>)))
      .toBe(`${DSH_REBUTTAL_ERROR_PREFIX}INVALID_POINTS`)
    expect(errorCodeOf(() => buildRevisionRecord(42 as unknown as ReadonlyArray<RebuttalPoint>)))
      .toBe(`${DSH_REBUTTAL_ERROR_PREFIX}INVALID_POINTS`)
  })

  it('throws when an entry is not an object', () => {
    const entry = 'not-an-object' as unknown as RebuttalPoint
    expectCode(() => buildRevisionRecord([entry]), 'INVALID_POINT')
    expectCode(() => buildRevisionRecord([null as unknown as RebuttalPoint]), 'INVALID_POINT')
  })

  it('throws on a non-string concern', () => {
    const entry = { response: 'r', requiresRevision: false } as unknown as RebuttalPoint
    expectCode(() => buildRevisionRecord([entry]), 'INVALID_CONCERN')
  })

  it('throws on a blank concern', () => {
    expectCode(() => buildRevisionRecord([point('', 'response')]), 'EMPTY_CONCERN')
    expectCode(() => buildRevisionRecord([point('   \t ', 'response')]), 'EMPTY_CONCERN')
  })

  it('throws on a non-string response', () => {
    const entry = { concern: 'c', requiresRevision: false } as unknown as RebuttalPoint
    expectCode(() => buildRevisionRecord([entry]), 'INVALID_RESPONSE')
  })

  it('throws on a blank response', () => {
    expectCode(() => buildRevisionRecord([point('concern', '')]), 'EMPTY_RESPONSE')
    expectCode(() => buildRevisionRecord([point('concern', ' \n ')]), 'EMPTY_RESPONSE')
  })

  it('rejects an absent requiresRevision flag instead of reading it as "no revision"', () => {
    const entry = { concern: 'c', response: 'r' } as unknown as RebuttalPoint
    expectCode(() => buildRevisionRecord([entry]), 'INVALID_FLAG')
  })

  it('rejects a non-boolean requiresRevision flag', () => {
    const truthy = { concern: 'c', response: 'r', requiresRevision: 'yes' } as unknown as RebuttalPoint
    expectCode(() => buildRevisionRecord([truthy]), 'INVALID_FLAG')
    const nullish = { concern: 'c', response: 'r', requiresRevision: null } as unknown as RebuttalPoint
    expectCode(() => buildRevisionRecord([nullish]), 'INVALID_FLAG')
    const flagged = { concern: 'c', response: 'r', requiresRevision: 1 } as unknown as RebuttalPoint
    expectCode(() => buildRevisionRecord([flagged]), 'INVALID_FLAG')
  })

  it('rejects a round whose later point is hollow (no partial record escapes)', () => {
    expectCode(
      () => buildRevisionRecord([point('good', 'good response', true), point('bad', '   ')]),
      'EMPTY_RESPONSE',
    )
  })

  it('locates the failing point by index in the error message', () => {
    expect(() => buildRevisionRecord([point('ok', 'ok'), point('', 'resp')]))
      .toThrow(/point 1: concern is blank after trim/)
  })
})

describe('buildRevisionRecord — snapshot isolation', () => {
  it('freezes the record, the points array and every point', () => {
    const record = buildRevisionRecord([point('c1', 'r1', true), point('c2', 'r2')])
    expect(Object.isFrozen(record)).toBe(true)
    expect(Object.isFrozen(record.points)).toBe(true)
    expect(Object.isFrozen(record.points[0])).toBe(true)
    expect(Object.isFrozen(record.points[1])).toBe(true)
  })

  it('throws TypeError when the record, its array, or a point is mutated', () => {
    const record = buildRevisionRecord([point('c1', 'r1', true)])
    const mutableRecord = record as unknown as { revisionCount: number; hasRevisions: boolean }
    const mutablePoints = record.points as unknown as RebuttalPoint[]
    const mutableFirst = record.points[0] as unknown as { concern: string }
    expect(() => { mutableRecord.revisionCount = 99 }).toThrow(TypeError)
    expect(() => { mutableRecord.hasRevisions = false }).toThrow(TypeError)
    expect(() => { mutablePoints.push(point('c2', 'r2')) }).toThrow(TypeError)
    expect(() => { mutableFirst.concern = 'mutated' }).toThrow(TypeError)
    expect(record.revisionCount).toBe(1)
    expect(record.points).toHaveLength(1)
    expect(record.points[0]?.concern).toBe('c1')
  })

  it('is an independent clone: later input mutation cannot reach the record', () => {
    const input: RebuttalPoint[] = [point('c1', 'r1', true)]
    const record = buildRevisionRecord(input)
    Object.assign(input[0]!, { requiresRevision: false, concern: 'rewritten after the fact' })
    input.push(point('c2', 'r2', true))
    expect(record.revisionCount).toBe(1)
    expect(record.hasRevisions).toBe(true)
    expect(record.points).toHaveLength(1)
    expect(record.points[0]?.concern).toBe('c1')
    expect(record.points[0]?.requiresRevision).toBe(true)
  })

  it('never aliases the caller input objects', () => {
    const input: RebuttalPoint[] = [point('c1', 'r1')]
    const record = buildRevisionRecord(input)
    expect(record.points).not.toBe(input)
    expect(record.points[0]).not.toBe(input[0])
    expect(record.points[0]).toEqual(input[0])
  })
})
