/**
 * The run's record of projecting its document onto a working directory.
 *
 * ONLY FAILURES ARE RECORDED, and every case below is about that being readable: a projection that
 * landed is on disk and needs no event, a projection that failed is nowhere else, and a reader that
 * cannot see the failure sees an unread directory and a current one as the same thing.
 */
import { describe, expect, it } from 'vitest'
import {
  getRunSnapshot, manuscriptProjectionFailuresOf, recordManuscriptProjectionFailure,
} from '../src/index.ts'
import { freshStore, seedRun } from './helpers.ts'

describe('a projection failure is recorded on the run', () => {
  it('appends one event, readable through the run snapshot', () => {
    const store = freshStore()
    const runId = seedRun(store)
    recordManuscriptProjectionFailure(store, runId, {
      stepId: 'D3-writing',
      attemptId: 2,
      directory: 'C:/runs/x/manuscripts/run-1',
      reason: 'the disk is full',
      manuscriptVersion: 3,
    })
    const failures = manuscriptProjectionFailuresOf(getRunSnapshot(store, runId).events)
    expect(failures).toEqual([{
      stepId: 'D3-writing',
      attemptId: 2,
      directory: 'C:/runs/x/manuscripts/run-1',
      reason: 'the disk is full',
      manuscriptVersion: 3,
    }])
  })

  it('records a failure that names no document version', () => {
    const store = freshStore()
    const runId = seedRun(store)
    recordManuscriptProjectionFailure(store, runId, {
      stepId: 'A1-landscape',
      attemptId: 1,
      directory: 'somewhere',
      reason: 'the directory is not writable',
    })
    const failures = manuscriptProjectionFailuresOf(getRunSnapshot(store, runId).events)
    expect(failures).toHaveLength(1)
    expect(failures[0]).not.toHaveProperty('manuscriptVersion')
  })

  it('does not record a success anywhere, so the log states only what failed', () => {
    const store = freshStore()
    const runId = seedRun(store)
    const events = getRunSnapshot(store, runId).events
    expect(events.filter(event => event.kind === 'manuscript-projected')).toEqual([])
    expect(manuscriptProjectionFailuresOf(events)).toEqual([])
  })

  it('refuses a run this store does not hold', () => {
    const store = freshStore()
    expect(() => {
      recordManuscriptProjectionFailure(store, 'no-such-run', {
        stepId: 'D3-writing', attemptId: 1, directory: 'x', reason: 'y',
      })
    }).toThrow(/RUN_NOT_FOUND/u)
  })
})

describe('reading the failures back', () => {
  it('ignores every other kind of event', () => {
    const store = freshStore()
    const runId = seedRun(store)
    expect(manuscriptProjectionFailuresOf(getRunSnapshot(store, runId).events)).toEqual([])
  })

  it('skips an entry this reader cannot render rather than printing undefined', () => {
    // The writer is this module, so a malformed entry is a defect in a record — and a sentence a
    // person acts on must not be built from a missing field.
    expect(manuscriptProjectionFailuresOf([
      { kind: 'manuscript-projected', runId: 'r', ts: 1, detail: { stepId: 'D3-writing' } },
      { kind: 'manuscript-projected', runId: 'r', ts: 2, detail: null },
      { kind: 'manuscript-projected', runId: 'r', ts: 3 },
      {
        kind: 'manuscript-projected',
        runId: 'r',
        ts: 4,
        detail: { stepId: 'E1-format', attemptId: 1, directory: 'd', reason: 'r' },
      },
    ])).toEqual([{ stepId: 'E1-format', attemptId: 1, directory: 'd', reason: 'r' }])
  })
})
