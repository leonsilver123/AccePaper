/**
 * Publishing a new version of an artifact the run already holds, outside a step commit.
 *
 * EVERY REFUSAL BELOW IS A WAY OF PUBLISHING SOMETHING NOBODY PRODUCED. The operation exists because
 * two callers — a person handing a file back, and a repair re-rendering a document a later step moved
 * under — have no attempt to write through, and a per-slug write beside the commit receipt would
 * leave the registry and the receipt describing different values.
 */
import { describe, expect, it } from 'vitest'
import {
  PublicationRefusal, canPublishArtifactVersion, canStart, checkPublication, getArtifact,
  getRunSnapshot, publishArtifactVersion, startStep, unsatisfiedInputs,
} from '../src/index.ts'
import { commitAll, freshStore, passStep, seedRun } from './helpers.ts'
import { STEPS } from '../src/engine/steps.ts'

/**
 * A run holding a `manuscript`, at a version a publication can derive from.
 *
 * WRITTEN THROUGH THE COMMIT POINT, like every other artifact: `recordArtifact` refuses a write
 * beside a receipt, and the operation under test is the one that exists because there is no attempt
 * to write through.
 */
function runWithArtifact() {
  const store = freshStore()
  const runId = seedRun(store)
  // THE STEPS BEFORE IT, because `canStart` refuses a step whose declared inputs are not there —
  // and D3 declares the outline A1..D2 produce.
  for (const step of STEPS) {
    if (step.id === 'D3-writing') break
    passStep(store, runId, step.id)
  }
  startStep(store, runId, 'D3-writing')
  commitAll(store, runId, 'D3-writing', { manuscript: { title: 'the first version' } })
  const snapshot = getRunSnapshot(store, runId)
  const meta = snapshot.registry['manuscript']
  if (meta === undefined) throw new Error('the fixture wrote no manuscript')
  return { store, runId, meta, revision: snapshot.revision }
}

describe('a publication writes a new version over the one it derived from', () => {
  it('advances the version counter, moves the revision, and names what it replaced', () => {
    const fixture = runWithArtifact()
    const receipt = publishArtifactVersion(fixture.store, {
      runId: fixture.runId,
      slug: 'manuscript',
      expectedRevision: fixture.revision,
      expectedVersion: fixture.meta.ref.version,
      value: { title: 'the second version' },
      producer: 'a-person',
      basis: 'a test published it',
    })
    expect(receipt.ref.version).toBe(fixture.meta.ref.version + 1)
    expect(receipt.replacedVersion).toBe(fixture.meta.ref.version)
    expect(receipt.replacedHash).toBe(fixture.meta.ref.contentHash)
    expect(receipt.revision).toBeGreaterThan(fixture.revision)
    expect(getArtifact(fixture.store, fixture.runId, 'manuscript')).toEqual({ title: 'the second version' })
  })

  it('records the publication on the run, with the basis it was made for', () => {
    const fixture = runWithArtifact()
    const receipt = publishArtifactVersion(fixture.store, {
      runId: fixture.runId,
      slug: 'manuscript',
      expectedRevision: fixture.revision,
      expectedVersion: fixture.meta.ref.version,
      value: { title: 'edited' },
      producer: 'a-person',
      basis: 'a person edited the file',
      detail: { file: 'manuscript.tex' },
    })
    const events = getRunSnapshot(fixture.store, fixture.runId).events
    const published = events.filter(event => event.kind === 'artifact-republished')
    expect(published).toHaveLength(1)
    expect(published[0]?.detail).toMatchObject({
      slug: 'manuscript',
      producer: 'a-person',
      basis: 'a person edited the file',
      replacedVersion: fixture.meta.ref.version,
      detail: { file: 'manuscript.tex' },
    })
    expect(published[0]?.detail).toMatchObject({ ref: { version: receipt.ref.version } })
    // A PUBLICATION IS NOT A COMMIT: nothing claims a step executed, so a reader asking which steps
    // produced what is not handed this.
    expect(events.some(event => event.kind === 'step-executed')).toBe(false)
  })
})

describe('a publication leaves the steps that read the slug able to run', () => {
  /**
   * The state a publication exists for: a run waiting on a step that reads the published slug.
   *
   * `D4-rebuttal` declares `manuscript`, which D3 committed, so the engine will start it — and the
   * question below is whether it still can once a person's version of that document is in the
   * registry.
   */
  function published(
    publisher = 'manuscript-import',
  ): {
    readonly store: ReturnType<typeof freshStore>
    readonly runId: string
    readonly meta: NonNullable<ReturnType<typeof runWithArtifact>>['meta']
    readonly startableBefore: boolean
  } {
    const store = freshStore()
    const runId = seedRun(store)
    for (const step of STEPS) {
      if (step.id === 'D3-writing') break
      passStep(store, runId, step.id)
    }
    // D3 ITSELF HAS PASSED, which is the state a run waiting on D4 is in: the step that wrote the
    // document is closed, so `D4-rebuttal`'s declared input is satisfied by a passed producer. This
    // is the one thing `runWithArtifact` above is not — it leaves D3 in progress, because its tests
    // are about what a publication writes rather than about what it satisfies.
    passStep(store, runId, 'D3-writing')
    const before = getRunSnapshot(store, runId)
    const meta = before.registry['manuscript']
    if (meta === undefined) throw new Error('the fixture wrote no manuscript')
    const startableBefore = canStart(store, runId, 'D4-rebuttal')
    publishArtifactVersion(store, {
      runId,
      slug: 'manuscript',
      expectedRevision: before.revision,
      expectedVersion: meta.ref.version,
      value: { title: 'hand edited' },
      producer: publisher,
      basis: 'a person handed the file back',
    })
    return { store, runId, meta, startableBefore }
  }

  it('keeps the producer link the engine schedules on, and records the publisher beside it', () => {
    // THE DEPENDENCY THE PIPELINE SCHEDULED ON IS THE STEP THAT PRODUCED THE REPLACED VALUE. An
    // entry naming the publisher instead told `canStart` that the input came from a step that never
    // ran, so an imported or repaired run could not be driven past the step that reads the slug —
    // and the only way back was to roll that step back and re-commit it, discarding the edit.
    const run = published()
    // THE RUN WAS STARTABLE BEFORE, which is what makes the assertion below about the publication.
    expect(run.startableBefore).toBe(true)
    const entry = getRunSnapshot(run.store, run.runId).registry['manuscript']
    expect(entry?.producerStepId).toBe(run.meta.producerStepId)
    expect(entry?.producerAttemptId).toBe(run.meta.producerAttemptId)
    // AND WHO PUBLISHED IT IS STILL READABLE off the registry entry the reader is looking at, not
    // only out of the audit log.
    expect(entry?.publishedBy).toBe('manuscript-import')
    expect(entry?.ref.version).toBe(run.meta.ref.version + 1)
    expect(getArtifact(run.store, run.runId, 'manuscript')).toEqual({ title: 'hand edited' })
  })

  it('leaves every step that declares the slug startable, with no unsatisfied input', () => {
    const run = published()
    for (const stepId of ['D4-rebuttal', 'E1-format']) {
      expect(canStart(run.store, run.runId, stepId), stepId).toBe(true)
      expect(unsatisfiedInputs(run.store, run.runId, stepId), stepId).toEqual([])
    }
  })

  it('inherits transitively, so a slug published twice still names the step it came from', () => {
    const run = published()
    const snapshot = getRunSnapshot(run.store, run.runId)
    const first = snapshot.registry['manuscript']
    if (first === undefined) throw new Error('the fixture published nothing')
    publishArtifactVersion(run.store, {
      runId: run.runId,
      slug: 'manuscript',
      expectedRevision: snapshot.revision,
      expectedVersion: first.ref.version,
      value: { title: 'hand edited twice' },
      producer: 'materialize-manuscript',
      basis: 'a repair re-rendered it',
    })
    const second = getRunSnapshot(run.store, run.runId).registry['manuscript']
    expect(second?.producerStepId).toBe(run.meta.producerStepId)
    expect(second?.publishedBy).toBe('materialize-manuscript')
    expect(canStart(run.store, run.runId, 'D4-rebuttal')).toBe(true)
  })
})

describe('what a publication refuses', () => {
  it('refuses a caller whose revision is not the one the run is at', () => {
    const fixture = runWithArtifact()
    expect(() => publishArtifactVersion(fixture.store, {
      runId: fixture.runId,
      slug: 'manuscript',
      expectedRevision: fixture.revision - 1,
      expectedVersion: fixture.meta.ref.version,
      value: { title: 'x' },
      producer: 'a-person',
      basis: 'stale',
    })).toThrow(/DSH_PUBLISH_REVISION_CONFLICT/u)
  })

  it('refuses a slug the run does not hold', () => {
    const fixture = runWithArtifact()
    expect(() => publishArtifactVersion(fixture.store, {
      runId: fixture.runId,
      slug: 'typeset',
      expectedRevision: fixture.revision,
      expectedVersion: 1,
      value: { title: 'x' },
      producer: 'a-person',
      basis: 'nothing to publish over',
    })).toThrow(/DSH_PUBLISH_NO_ARTIFACT/u)
  })

  it('refuses a value derived from a version the run has left behind', () => {
    const fixture = runWithArtifact()
    expect(() => publishArtifactVersion(fixture.store, {
      runId: fixture.runId,
      slug: 'manuscript',
      expectedRevision: fixture.revision,
      expectedVersion: fixture.meta.ref.version + 4,
      value: { title: 'x' },
      producer: 'a-person',
      basis: 'the artifact moved',
    })).toThrow(/DSH_PUBLISH_ARTIFACT_MOVED/u)
  })

  it('refuses an empty slug and an unnamed producer', () => {
    const fixture = runWithArtifact()
    const base = {
      runId: fixture.runId,
      expectedRevision: fixture.revision,
      expectedVersion: fixture.meta.ref.version,
      value: { title: 'x' },
      basis: 'a test',
    }
    expect(() => publishArtifactVersion(fixture.store, { ...base, slug: '  ', producer: 'a-person' }))
      .toThrow(/DSH_PUBLISH_NO_SLUG/u)
    expect(() => publishArtifactVersion(fixture.store, { ...base, slug: 'manuscript', producer: ' ' }))
      .toThrow(/DSH_PUBLISH_NO_PRODUCER/u)
  })

  it('refuses a value with no canonical encoding, writing nothing', () => {
    const fixture = runWithArtifact()
    expect(() => publishArtifactVersion(fixture.store, {
      runId: fixture.runId,
      slug: 'manuscript',
      expectedRevision: fixture.revision,
      expectedVersion: fixture.meta.ref.version,
      value: { map: new Map([['a', 1]]) },
      producer: 'a-person',
      basis: 'unencodable',
    })).toThrow(/DSH_PUBLISH_VALUE_NOT_PERSISTABLE/u)
    expect(getRunSnapshot(fixture.store, fixture.runId).registry['manuscript']?.ref.version).toBe(fixture.meta.ref.version)
  })

  it('names every refusal with its own code', () => {
    const fixture = runWithArtifact()
    const run = fixture.store.get(fixture.runId)
    if (run === undefined) throw new Error('the fixture created no run')
    const refusal = checkPublication(run, {
      runId: fixture.runId,
      slug: 'manuscript',
      expectedRevision: fixture.revision,
      expectedVersion: 99,
      value: { title: 'x' },
      producer: 'a-person',
      basis: 'moved',
    })
    expect(refusal).toBeInstanceOf(PublicationRefusal)
    expect(refusal?.code).toBe('DSH_PUBLISH_ARTIFACT_MOVED')
    expect(checkPublication(run, {
      runId: fixture.runId,
      slug: 'manuscript',
      expectedRevision: fixture.revision,
      expectedVersion: fixture.meta.ref.version,
      value: { title: 'x' },
      producer: 'a-person',
      basis: 'fine',
    })).toBeNull()
  })
})

describe('the read a page makes before offering the control', () => {
  it('answers the same refusal the operation would raise', () => {
    const fixture = runWithArtifact()
    const stale = canPublishArtifactVersion(fixture.store, {
      runId: fixture.runId,
      slug: 'manuscript',
      expectedRevision: fixture.revision - 1,
      expectedVersion: fixture.meta.ref.version,
      value: { title: 'x' },
      producer: 'a-person',
      basis: 'stale',
    })
    expect(stale).toMatchObject({ ok: false, code: 'DSH_PUBLISH_REVISION_CONFLICT' })
    expect(canPublishArtifactVersion(fixture.store, {
      runId: fixture.runId,
      slug: 'manuscript',
      expectedRevision: fixture.revision,
      expectedVersion: fixture.meta.ref.version,
      value: { title: 'x' },
      producer: 'a-person',
      basis: 'fine',
    })).toEqual({ ok: true })
  })
})
