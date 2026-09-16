/**
 * The revision loop: the request, the candidate, the diff and the review.
 *
 * WHAT THESE CASES ARE ABOUT. A change request at the gate records an instruction and leaves the
 * gate open. Everything after that instruction is what these tests pin: the request names the
 * version it read, a candidate is written against that version and no other, and a review is bound
 * to the candidate it judged. Each refusal below is a way of answering a document nobody has.
 *
 * A REAL WRITER IS NOT CALLED. The writer is a double whose text is the instruction plus the section
 * heading; what the loop has to get right is the binding, not the prose, and a model in the loop
 * would make the test slow and its verdict dependent on text nobody asserts.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildCandidate, candidateHashOf, createRevisionRequest, readRevision, reviewCandidate,
  revisionStoreOf, sectionHashOf, sectionsOf, writeCandidate, writeRevisionRequest, writeReview,
} from '../src/manuscript-revision.ts'
import type { RevisionCandidateRecord, RevisionStore } from '../src/manuscript-revision.ts'

const MANUSCRIPT = [
  '# A study',
  '',
  '## Introduction',
  '',
  'Traffic mixing raises risk [1]. The measured minimum TTC is 12.10 s.',
  '',
  '## Method',
  '',
  'We used the Intelligent Driver Model with a step of 0.1.',
  '',
  '## Results',
  '',
  'The minimum TTC fell to 12.10 s, which satisfies the 15 % bound.',
].join('\n')

const HEADINGS = ['Introduction', 'Method', 'Results']

let directory: string
let store: RevisionStore

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'revision-'))
  const resolved = revisionStoreOf({ snapshotDirectory: directory })
  if (resolved === undefined) throw new Error('the store did not resolve')
  store = resolved
})

afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

/**
 * One request, built the way the service builds it.
 *
 * It does NOT write: a helper that wrote would race the directory teardown, and a test that needs
 * the file on disk writes it and awaits, which is also what the service does.
 */
function makeRequest(requestId = 'req-1') {
  const request = createRevisionRequest({
    requestId,
    runId: 'run-1',
    stepId: 'E2-submit',
    projectRevision: 7,
    instruction: 'tighten the claim in the results',
    operator: 'operator',
    manuscriptVersion: 3,
    sections: sectionsOf(MANUSCRIPT),
    // The instruction is about the results; the request says so, and the candidate that answers it
    // leaves the other sections exactly as they were.
    targets: ['results'],
  })
  return request
}

describe('a request names the version it read', () => {
  it('splits the manuscript by its own headings and hashes each body', () => {
    const sections = sectionsOf(MANUSCRIPT)
    expect(sections.map(section => section.heading)).toEqual(HEADINGS)
    expect(sections[0]?.sectionId).toBe('introduction')
    const request = makeRequest()
    expect(request.sections.map(section => section.basisHash))
      .toEqual(sections.map(section => sectionHashOf(section.bodyText)))
  })

  it('records what the person asked for, and reads it back from disk', async () => {
    const request = makeRequest()
    await writeRevisionRequest(store, request)
    const read = await readRevision(store, 'req-1')
    expect(read.request?.instruction).toBe('tighten the claim in the results')
    expect(read.request?.operator).toBe('operator')
    expect(read.candidates).toEqual([])
    expect(read.reviews).toEqual([])
  })
})

describe('a candidate is written against the version the request read', () => {
  const writer = { channel: 'deterministic' as const, provider: 'test', model: 'test' }

  it('produces one section per request, with a diff a reader can see', () => {
    const request = makeRequest()
    const current = sectionsOf(MANUSCRIPT)
    const candidate = buildCandidate({
      candidateId: 'cand-1',
      request,
      current,
      written: new Map([['results', 'The minimum TTC fell to 12.10 s. The claim is now bounded by it.']]),
      writer,
    })
    const results = candidate.sections.find(section => section.sectionId === 'results')
    // CHANGED IS DERIVED, not asserted by the writer: the hash of the new body against the basis.
    expect(results?.changed).toBe(true)
    expect(results?.basisHash).toBe(sectionHashOf(current[2]?.bodyText ?? ''))
    expect(candidate.sections.filter(section => section.changed).map(section => section.sectionId))
      .toEqual(['results'])
  })

  it('mints an id for a candidate nobody named one for, and never the same one twice', () => {
    const request = makeRequest()
    const current = sectionsOf(MANUSCRIPT)
    const build = (): RevisionCandidateRecord => buildCandidate({
      request, current, written: new Map([['results', 'The bound holds.']]), writer,
    })
    const first = build()
    const second = build()
    // A candidate is READ BACK by this id: the record file is named for it, a review is looked up by
    // it, and an acceptance names it. An empty or repeated id makes two candidates one.
    expect(first.candidateId).not.toBe('')
    expect(second.candidateId).not.toBe(first.candidateId)
  })

  it('refuses a manuscript that moved since the request read it', () => {
    const request = makeRequest()
    const moved = sectionsOf(MANUSCRIPT.replace('12.10 s', '9.80 s'))
    expect(() => buildCandidate({
      candidateId: 'cand-1', request, current: moved, written: new Map(), writer,
    })).toThrow(/revision-basis-stale/)
  })

  it('refuses a request naming a section the manuscript no longer has', () => {
    const request = makeRequest()
    const trimmed = sectionsOf(MANUSCRIPT.split('## Results')[0] ?? '')
    expect(() => buildCandidate({
      candidateId: 'cand-1', request, current: trimmed, written: new Map(), writer,
    })).toThrow(/revision-section-gone/)
  })

  it('keeps the sections the request is not about', () => {
    const request = makeRequest()
    const candidate = buildCandidate({
      candidateId: 'cand-1', request, current: sectionsOf(MANUSCRIPT),
      written: new Map([['results', 'The bound holds at 12.10 s.']]), writer,
    })
    const method = candidate.sections.find(section => section.sectionId === 'method')
    expect(method?.changed).toBe(false)
    expect(method?.bodyText).toContain('Intelligent Driver Model')
  })

  it('refuses a candidate whose section the writer left empty', () => {
    const request = makeRequest()
    expect(() => buildCandidate({
      candidateId: 'cand-1', request, current: sectionsOf(MANUSCRIPT),
      written: new Map([['results', '   ']]), writer,
    })).toThrow(/revision-no-text/)
  })
})

describe('a review is bound to the candidate it judged', () => {
  const material = {
    knownNumbers: ['12.10', '15', '0.1'],
    referenceLabels: ['1'],
    headings: HEADINGS,
  }

  /** One candidate over the results section. */
  function candidateWith(resultsBody: string): RevisionCandidateRecord {
    const request = makeRequest()
    return buildCandidate({
      candidateId: 'cand-1',
      request,
      current: sectionsOf(MANUSCRIPT),
      written: new Map([['results', resultsBody]]),
      writer: { channel: 'deterministic', provider: 'test', model: 'test' },
    })
  }

  it('passes a candidate that only changes prose', () => {
    const review = reviewCandidate(
      candidateWith('The minimum TTC fell to 12.10 s, which satisfies the 15 % bound on the metric.'),
      material,
    )
    expect(review.findings.every(finding => finding.passed)).toBe(true)
    expect(review.passed).toBe(true)
  })

  it('refuses a number the run never measured', () => {
    const review = reviewCandidate(
      candidateWith('The minimum TTC fell to 8.42 s, a 38.2 % improvement.'),
      material,
    )
    const numbers = review.findings.find(finding => finding.check === 'numbers')
    expect(numbers?.passed).toBe(false)
    expect(numbers?.detail).toContain('8.42')
    expect(numbers?.detail).toContain('38.2')
    expect(review.passed).toBe(false)
  })

  it('refuses a citation to nothing', () => {
    const review = reviewCandidate(candidateWith('As shown elsewhere [7], the bound holds.'),
      { ...material, referenceLabels: ['1'] })
    expect(review.findings.find(finding => finding.check === 'citations')?.passed).toBe(false)
  })

  it('refuses a candidate that drops a section', () => {
    const candidate = candidateWith('The bound holds.')
    const review = reviewCandidate(
      { ...candidate, sections: candidate.sections.filter(section => section.sectionId !== 'method') },
      material,
    )
    const sections = review.findings.find(finding => finding.check === 'sections')
    expect(sections?.passed).toBe(false)
    expect(sections?.detail).toContain('Method')
  })

  it('names the candidate version its verdict is about', async () => {
    const candidate = candidateWith('The bound holds.')
    const review = reviewCandidate(candidate, material)
    expect(review.candidateHash).toBe(candidateHashOf(candidate.sections))
    await writeCandidate(store, candidate)
    await writeReview(store, candidate.requestId, review)
    const read = await readRevision(store, candidate.requestId)
    expect(read.candidates.map(entry => entry.candidateId)).toEqual(['cand-1'])
    // A REVIEW OF ANOTHER VERSION IS NOT A REVIEW: the stored hash is the candidate's own.
    expect(read.reviews[0]?.candidateHash).toBe(candidateHashOf(read.candidates[0]?.sections ?? []))
  })
})

describe('the durable records are the deployment s, not the process s', () => {
  it('reads a request from a second store over the same directory', async () => {
    const request = makeRequest()
    await writeRevisionRequest(store, request)
    // A restart's view: the same directory, a store built again from the same configuration.
    const reopened = revisionStoreOf({ snapshotDirectory: directory })
    if (reopened === undefined) throw new Error('the store did not resolve')
    const read = await readRevision(reopened, 'req-1')
    expect(read.request?.requestId).toBe('req-1')
    const onDisk = JSON.parse(readFileSync(join(directory, 'revisions', 'req-1', 'request.json'), 'utf8')) as {
      instruction?: string
    }
    expect(onDisk.instruction).toBe('tighten the claim in the results')
  })

  it('reports no store when the deployment keeps no durable root', () => {
    // A REVISION THAT CANNOT BE RECORDED IS NOT HELD IN MEMORY: the caller has to say so, because a
    // request a restart forgets asks a person to make it again.
    expect(revisionStoreOf({ snapshotDirectory: undefined })).toBeUndefined()
  })
})
