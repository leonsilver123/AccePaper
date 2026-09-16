/**
 * Publishing a reviewed candidate as the official manuscript.
 *
 * EVERY REFUSAL BELOW IS A WAY OF PUBLISHING SOMETHING NOBODY READ, which is the only reason this
 * operation exists rather than a per-slug write. The acceptance also has to leave the run in a state
 * its own readers agree with: one registry entry per slug, a revision that moved, and a record that
 * names the version it replaced.
 */
import { describe, expect, it } from 'vitest'
import {
  ACCEPTANCE_PRODUCER, ACCEPTED_MANUSCRIPT_SLUG, AcceptanceRefusal, acceptManuscriptCandidate,
  canAcceptManuscriptCandidate, getArtifact, getRunSnapshot,
} from '../src/index.ts'
import { freshStore, runFullPipeline } from './helpers.ts'

/**
 * A run at the human gate, with the manuscript E1 produced.
 *
 * THE VALUE IS READ THROUGH `getArtifact`, not from the snapshot's registry: a snapshot carries
 * artifact METADATA, and the value has its own accessor.
 */
function atTheGate() {
  const store = freshStore()
  const runId = runFullPipeline(store)
  const snapshot = getRunSnapshot(store, runId)
  const meta = snapshot.registry[ACCEPTED_MANUSCRIPT_SLUG]
  const value = getArtifact(store, runId, ACCEPTED_MANUSCRIPT_SLUG)
  if (meta === undefined || value === undefined) throw new Error('the run produced no manuscript')
  return { store, runId, manuscript: { meta, value }, revision: snapshot.revision }
}

/** The value a candidate would assemble: the manuscript with one section's prose replaced. */
function acceptedValue(manuscript: { value: unknown }): Record<string, unknown> {
  const value = manuscript.value as Record<string, unknown>
  return { ...value, manuscript: `${String(value['manuscript'])}\n\nAccepted revision note.\n` }
}

/** A request that would be accepted, unless a case changes one field. */
function requestFor(fixture: ReturnType<typeof atTheGate>, overrides: Record<string, unknown> = {}) {
  return {
    runId: fixture.runId,
    expectedRevision: fixture.revision,
    expectedManuscriptVersion: fixture.manuscript.meta.ref.version,
    value: acceptedValue(fixture.manuscript),
    candidateHash: 'candidate-hash-1',
    operator: 'authenticated-browser-operator',
    requestId: 'req-1',
    candidateId: 'cand-1',
    ...overrides,
  }
}

const PASSED = { candidateHash: 'candidate-hash-1', passed: true, reviewed: true }

describe('an acceptance publishes the candidate over the manuscript', () => {
  it('writes a new version, moves the revision, and names the replaced one', () => {
    const fixture = atTheGate()
    const receipt = acceptManuscriptCandidate(fixture.store, requestFor(fixture), PASSED)
    const after = getRunSnapshot(fixture.store, fixture.runId)

    expect(after.registry[ACCEPTED_MANUSCRIPT_SLUG]?.ref.version).toBe(fixture.manuscript.meta.ref.version + 1)
    expect(receipt.revision).toBe(fixture.revision + 1)
    // A PERSON DECIDING IS NOT A STEP EXECUTING, and the registry says which it was.
    expect(after.registry[ACCEPTED_MANUSCRIPT_SLUG]?.producerStepId).toBe(ACCEPTANCE_PRODUCER)
    const record = after.events.filter(event => event.kind === 'manuscript-accepted').at(-1) as
      { detail?: { replacedVersion?: number | null; candidateId?: string } } | undefined
    // THE AUDIT NAMES WHAT IT REPLACED, or it says an acceptance happened and not what it changed.
    expect(record?.detail?.replacedVersion).toBe(fixture.manuscript.meta.ref.version)
    expect(record?.detail?.candidateId).toBe('cand-1')
  })

  it('refuses nothing it should accept, before it writes', () => {
    const fixture = atTheGate()
    // The read a page makes must agree with the operation, because they share the check.
    expect(canAcceptManuscriptCandidate(fixture.store, requestFor(fixture), PASSED)).toEqual({ ok: true })
  })
})

describe('an acceptance refuses what nobody read', () => {
  const cases: ReadonlyArray<{
    readonly name: string
    readonly code: string
    readonly request?: Record<string, unknown>
    readonly review?: typeof PASSED
  }> = [
    { name: 'a run that moved since the caller read it', code: 'DSH_ACCEPT_REVISION_CONFLICT', request: { expectedRevision: 999 } },
    { name: 'a manuscript that moved under the candidate', code: 'DSH_ACCEPT_MANUSCRIPT_MOVED', request: { expectedManuscriptVersion: 99 } },
    { name: 'a candidate nobody reviewed', code: 'DSH_ACCEPT_UNREVIEWED', review: { candidateHash: 'candidate-hash-1', passed: true, reviewed: false } },
    { name: 'a review of another version', code: 'DSH_ACCEPT_REVIEW_STALE', review: { candidateHash: 'other-hash', passed: true, reviewed: true } },
    { name: 'a candidate that failed its review', code: 'DSH_ACCEPT_REVIEW_FAILED', review: { candidateHash: 'candidate-hash-1', passed: false, reviewed: true } },
    { name: 'a value with no canonical encoding', code: 'DSH_ACCEPT_VALUE_NOT_PERSISTABLE', request: { value: { manuscript: () => 'not encodable' } } },
  ]

  for (const testCase of cases) {
    it(`refuses ${testCase.name}`, () => {
      const fixture = atTheGate()
      const request = requestFor(fixture, testCase.request ?? {})
      const review = testCase.review ?? PASSED
      expect(() => acceptManuscriptCandidate(fixture.store, request, review))
        .toThrow(AcceptanceRefusal)
      expect(() => acceptManuscriptCandidate(fixture.store, request, review))
        .toThrow(new RegExp(testCase.code))
      // THE REFUSAL LEFT NOTHING BEHIND: the manuscript is the version it was, and the revision did
      // not move. A refusal that had already written would be worse than one that accepted.
      const after = getRunSnapshot(fixture.store, fixture.runId)
      expect(after.registry[ACCEPTED_MANUSCRIPT_SLUG]?.ref.version).toBe(fixture.manuscript.meta.ref.version)
      expect(after.revision).toBe(fixture.revision)
      // And the page's read agrees, with the same code.
      const read = canAcceptManuscriptCandidate(fixture.store, request, review)
      if (read.ok) throw new Error('the page read accepted what the operation refuses')
      expect(read.code).toBe(testCase.code)
    })
  }

  it('refuses a run this store does not hold', () => {
    const fixture = atTheGate()
    expect(() => acceptManuscriptCandidate(freshStore(), requestFor(fixture), PASSED))
      .toThrow(/RUN_NOT_FOUND/)
  })
})

describe('the accepted manuscript is what the run now reports', () => {
  it('replaces the value every reader sees, and keeps the step record', () => {
    const fixture = atTheGate()
    const accepted = acceptedValue(fixture.manuscript)
    acceptManuscriptCandidate(fixture.store, requestFor(fixture, { value: accepted }), PASSED)
    const after = getRunSnapshot(fixture.store, fixture.runId)

    expect((getArtifact(fixture.store, fixture.runId, ACCEPTED_MANUSCRIPT_SLUG) as { manuscript?: string }).manuscript)
      .toBe(accepted['manuscript'])
    // THE STEP THAT PRODUCED IT IS UNTOUCHED. E1-format did its work and committed it; the acceptance
    // is a later decision about that work, and rewriting the step's own history would make the run's
    // record say the step produced text it never produced.
    expect(after.steps['E1-format']?.status).toBe('passed')
    expect(after.steps['E1-format']?.commit).toBeDefined()
  })
})
