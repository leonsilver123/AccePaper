/**
 * Revisions of the manuscript: the request, the candidate, the diff, and the review.
 *
 * WHY THIS EXISTS. A change request at the human gate records what the person wants changed and
 * leaves the gate open. Until this module there was nothing on the other side of that record: the
 * work that answers it happened somewhere else, and the run never learned that it had been asked
 * for anything. Here the request becomes a DURABLE OBJECT with a candidate that answers it and a
 * review bound to that candidate's own version.
 *
 * WHAT IS NOT HERE. Acceptance. A candidate cannot be made the official manuscript by this module:
 * core's `recordArtifact` writes only inside a step's in-progress attempt, and E1-format committed
 * long before a person ever read the paper, so publishing a candidate over it needs the accepting
 * transaction the module design calls for (version comparison, reference validation, atomic write,
 * downstream invalidation) as a core operation with its own production caller. This module stops at
 * a reviewed candidate and says so, rather than reporting an acceptance nothing performed.
 *
 * EVERY RECORD IS DURABLE AND BOUND TO A VERSION. A request names the sections it read and the body
 * hash each one had; a candidate names the request and the basis it was written against; a review
 * names the candidate hash it judged. A body that changed under any of them makes the next step
 * refuse, which is what keeps "the candidate you reviewed" and "the candidate that exists" the same
 * object.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ResearchProseWriter } from './runner/registry.ts'

/** Durable records of one deployment's revisions, under its snapshot root. */
export interface RevisionStoreConfig {
  /** Root the run snapshots are written under, when the deployment configured one. */
  readonly snapshotDirectory: string | undefined
}

/** One section of the manuscript as it stood when a request read it. */
export interface RevisionSectionBasis {
  /** Stable id for the section within the manuscript (derived from its heading). */
  readonly sectionId: string
  readonly heading: string
  /** The body hash the request read; a candidate is written against exactly this. */
  readonly basisHash: string
}

/** A person's request to change named sections of the manuscript. */
export interface RevisionRequestRecord {
  readonly requestId: string
  readonly runId: string
  /** The gate step the request was made at. */
  readonly stepId: string
  /** The project revision the person was reading. */
  readonly projectRevision: number
  /**
   * The manuscript artifact VERSION the person was reading.
   *
   * The section hashes say the text did not change; this says which version of the artifact it was.
   * An acceptance checks both, and the one it must check against is the one the REQUEST read — a
   * service that read the current version at accept time would accept over a manuscript the person
   * never saw.
   */
  readonly manuscriptVersion: number
  /** What to change, in the person's own words. */
  readonly instruction: string
  readonly operator: string
  readonly sections: ReadonlyArray<RevisionSectionBasis>
  /**
   * The sections the writer should rewrite.
   *
   * A REQUEST IS ABOUT SOMETHING. "Tighten the claim in the results" is not a licence to rewrite the
   * whole paper, and a candidate that rewrote every section would be a different document wearing
   * the same title. Empty means the instruction is about the manuscript as a whole.
   */
  readonly targets: ReadonlyArray<string>
  readonly requestedAt: number
}

/** One section of a candidate, with the basis it was written against. */
export interface CandidateSectionRecord {
  readonly sectionId: string
  readonly heading: string
  readonly basisHash: string
  /** The body this candidate replaced, so a reader can see the change rather than a flag. */
  readonly basisText: string
  /** The hash of the body this candidate produced. Equal to `basisHash` means no change. */
  readonly resultHash: string
  readonly bodyText: string
  readonly changed: boolean
}

/** One candidate manuscript, as a version of its own. */
export interface RevisionCandidateRecord {
  readonly candidateId: string
  readonly requestId: string
  readonly runId: string
  /** The revision the candidate was produced under, so a later reader can tell what it answered. */
  readonly projectRevision: number
  readonly sections: ReadonlyArray<CandidateSectionRecord>
  /** Which channel wrote the text, for the same reason every artifact carries one. */
  readonly writer: { readonly channel: 'llm' | 'deterministic'; readonly provider: string; readonly model: string }
  readonly createdAt: number
}

/** One check's verdict on a candidate. */
export interface RevisionReviewFinding {
  /** `numbers` | `citations` | `sections` — what the check reads. */
  readonly check: string
  readonly passed: boolean
  readonly detail: string
}

/** What the checks found, bound to the candidate version they judged. */
export interface RevisionReviewRecord {
  readonly candidateId: string
  /** The candidate hash this review is about. A review of another version is not a review. */
  readonly candidateHash: string
  readonly findings: ReadonlyArray<RevisionReviewFinding>
  readonly passed: boolean
  readonly reviewedAt: number
}

/** Everything a candidate's checks read about the run, taken from the run rather than from prose. */
export interface RevisionReviewMaterial {
  /** Every number the run itself declares or measured, as strings. */
  readonly knownNumbers: ReadonlyArray<string>
  /** The reference labels the manuscript carries, e.g. `1`, `2`. */
  readonly referenceLabels: ReadonlyArray<string>
  /** The headings the official manuscript had, so a candidate cannot add or drop a section. */
  readonly headings: ReadonlyArray<string>
}

/** One section split out of a manuscript's markdown. */
export interface ManuscriptSectionParts {
  readonly sectionId: string
  readonly heading: string
  readonly bodyText: string
}

/** A stable id for a heading: what a request names instead of a position. */
function sectionIdOf(heading: string): string {
  const slug = heading.trim().toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '')
  return slug === '' ? 'section' : slug
}

/**
 * Split a manuscript into its `##` sections.
 *
 * The split is on the document's own structure rather than on a stored index: a request that named
 * "section 3" would name a different section the moment anything above it changed, and the basis
 * hash is what a candidate is bound to.
 *
 * @param markdown - the manuscript's markdown.
 * @returns one part per `##` heading, in document order.
 */
export function sectionsOf(markdown: string): ReadonlyArray<ManuscriptSectionParts> {
  const parts: ManuscriptSectionParts[] = []
  let heading: string | undefined
  let body: string[] = []
  const flush = (): void => {
    if (heading === undefined) return
    parts.push({ sectionId: sectionIdOf(heading), heading, bodyText: body.join('\n').trim() })
  }
  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) {
      flush()
      heading = line.slice(3).trim()
      body = []
      continue
    }
    if (heading !== undefined) body.push(line)
  }
  flush()
  return parts
}

/**
 * The digest of one section body: the version a candidate is written against.
 *
 * @param body - the section body.
 * @returns its SHA-256, hex.
 */
export function sectionHashOf(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex')
}

/**
 * The digest of a whole candidate: what a review is bound to.
 *
 * @param sections - the candidate's sections, in order.
 * @returns a SHA-256 over each section's id and result hash.
 */
export function candidateHashOf(sections: ReadonlyArray<CandidateSectionRecord>): string {
  const material = sections.map(section => `${section.sectionId}:${section.resultHash}`).join('\n')
  return createHash('sha256').update(material, 'utf8').digest('hex')
}

/**
 * Record a person's request to change the manuscript.
 *
 * @param input - the run, the gate, the revision read, the instruction and the manuscript sections.
 * @returns the request record; writing it is the caller's next step.
 */
export function createRevisionRequest(input: {
  readonly requestId: string
  readonly runId: string
  readonly stepId: string
  readonly projectRevision: number
  readonly instruction: string
  readonly operator: string
  readonly sections: ReadonlyArray<ManuscriptSectionParts>
  /** The manuscript artifact version the caller read. */
  readonly manuscriptVersion: number
  /** The sections the instruction is about; empty means all of them. */
  readonly targets?: ReadonlyArray<string>
}): RevisionRequestRecord {
  return {
    requestId: input.requestId,
    runId: input.runId,
    stepId: input.stepId,
    projectRevision: input.projectRevision,
    manuscriptVersion: input.manuscriptVersion,
    instruction: input.instruction,
    operator: input.operator,
    sections: input.sections.map(section => ({
      sectionId: section.sectionId,
      heading: section.heading,
      basisHash: sectionHashOf(section.bodyText),
    })),
    targets: input.targets === undefined || input.targets.length === 0
      ? input.sections.map(section => section.sectionId)
      : [...input.targets],
    requestedAt: Date.now(),
  }
}

/**
 * Build a candidate from the texts a writer produced, refusing anything written against another
 * version.
 *
 * @param input - the request, the sections as they stand NOW, the replacement texts by section id,
 *   what wrote them, and the id to write the candidate under when the caller has one of its own.
 *   **A candidate with no id of its own gets one**: candidates are read back, reviewed and accepted
 *   by that id, so two of them sharing one would be one file overwritten and one review standing in
 *   for another's.
 * @returns the candidate record.
 * @throws {Error} when the request names a section the manuscript no longer has, when a section's
 *   body has changed since the request read it, or when the writer produced no text for one.
 */
export function buildCandidate(input: {
  readonly candidateId?: string
  readonly request: RevisionRequestRecord
  readonly current: ReadonlyArray<ManuscriptSectionParts>
  readonly written: ReadonlyMap<string, string>
  readonly writer: RevisionCandidateRecord['writer']
}): RevisionCandidateRecord {
  const byId = new Map(input.current.map(section => [section.sectionId, section]))
  const targets = new Set(input.request.targets)
  const sections = input.request.sections.map((basis) => {
    const section = byId.get(basis.sectionId)
    if (section === undefined) {
      throw new Error(
        `[revision-section-gone] the request names section '${basis.sectionId}', and the manuscript no longer has it`,
      )
    }
    const resultHash = sectionHashOf(section.bodyText)
    // THE BASIS IS RE-READ, NOT REMEMBERED. A candidate is written against the version the person
    // read, and a manuscript that moved since then — another revision, a rollback, a re-format —
    // would otherwise be replaced by text answering a document nobody has.
    if (resultHash !== basis.basisHash) {
      throw new Error(
        `[revision-basis-stale] section '${basis.sectionId}' is not the version the request read `
        + `(read ${basis.basisHash.slice(0, 8)}, now ${resultHash.slice(0, 8)})`,
      )
    }
    // A SECTION THE REQUEST IS NOT ABOUT KEEPS ITS BODY, and it is carried in the candidate rather
    // than dropped: a candidate is a whole manuscript, and the checks that compare its structure
    // against the official one read every section, not only the ones that moved.
    if (!targets.has(basis.sectionId)) {
      return {
        sectionId: basis.sectionId,
        heading: section.heading,
        basisHash: basis.basisHash,
        basisText: section.bodyText,
        resultHash: basis.basisHash,
        bodyText: section.bodyText,
        changed: false,
      }
    }
    const written = input.written.get(basis.sectionId)
    if (written === undefined || written.trim() === '') {
      throw new Error(`[revision-no-text] the writer produced no text for section '${basis.sectionId}'`)
    }
    return {
      sectionId: basis.sectionId,
      heading: section.heading,
      basisHash: basis.basisHash,
      basisText: section.bodyText,
      resultHash: sectionHashOf(written),
      bodyText: written,
      changed: sectionHashOf(written) !== basis.basisHash,
    }
  })
  return {
    candidateId: input.candidateId ?? randomUUID(),
    requestId: input.request.requestId,
    runId: input.request.runId,
    projectRevision: input.request.projectRevision,
    sections,
    writer: input.writer,
    createdAt: Date.now(),
  }
}

/** Numbers as a body writes them: a decimal with at most a handful of places, or an integer. */
const NUMBER = /-?\d+(?:\.\d+)?/g

/**
 * Judge a candidate on the three things a pipeline can check without reading prose.
 *
 * THE SAME RULEBOOK DISCIPLINE AS THE A CHANNEL'S MANUSCRIPT REVIEW: every check is an exact match
 * against a value the run itself holds. A number nothing measured, a citation to nothing, and a
 * section that appeared or vanished are what a revision can introduce that the official manuscript
 * did not have.
 *
 * @param candidate - the candidate to judge.
 * @param material - what the run holds: its numbers, its reference labels, its headings.
 * @returns the findings and whether every one passed.
 */
export function reviewCandidate(
  candidate: RevisionCandidateRecord,
  material: RevisionReviewMaterial,
): RevisionReviewRecord {
  const findings: RevisionReviewFinding[] = []
  const known = new Set(material.knownNumbers)
  const unknownNumbers = new Set<string>()
  for (const section of candidate.sections) {
    if (!section.changed) continue
    for (const match of section.bodyText.match(NUMBER) ?? []) {
      if (!known.has(match)) unknownNumbers.add(match)
    }
  }
  findings.push({
    check: 'numbers',
    passed: unknownNumbers.size === 0,
    detail: unknownNumbers.size === 0
      ? 'every number in the changed sections is one the run declares or measured'
      : `numbers nothing in this run measured or declared: ${[...unknownNumbers].join(', ')}`,
  })

  const labels = new Set(material.referenceLabels)
  const unknownLabels = new Set<string>()
  for (const section of candidate.sections) {
    if (!section.changed) continue
    for (const match of section.bodyText.matchAll(/\[(\d+)\]/g)) {
      if (!labels.has(match[1] as string)) unknownLabels.add(match[1] as string)
    }
  }
  findings.push({
    check: 'citations',
    passed: unknownLabels.size === 0,
    detail: unknownLabels.size === 0
      ? 'every citation label in the changed sections is in the reference list'
      : `citations to nothing: ${[...unknownLabels].join(', ')}`,
  })

  const expected = new Set(material.headings)
  const headings = candidate.sections.map(section => section.heading)
  const missing = material.headings.filter(heading => !headings.includes(heading))
  const added = headings.filter(heading => !expected.has(heading))
  findings.push({
    check: 'sections',
    passed: missing.length === 0 && added.length === 0,
    detail: missing.length === 0 && added.length === 0
      ? 'the candidate has exactly the sections the manuscript had'
      : 'a revision may change a section, not the document\'s structure — missing: '
        + `${missing.join(', ')}; added: ${added.join(', ')}`,
  })

  return {
    candidateId: candidate.candidateId,
    candidateHash: candidateHashOf(candidate.sections),
    findings,
    passed: findings.every(finding => finding.passed),
    reviewedAt: Date.now(),
  }
}

/**
 * Ask the deployment's writer for one replacement body.
 *
 * THE WRITER IS THE RUN'S OWN: the deployment's prose channel, the same seam D3 and D4 write
 * through, so a revision's text carries the same provenance as the manuscript it revises — and a
 * deployment whose prose route is the deterministic offline one gets deterministic revision text
 * rather than a different, unlabelled writer.
 *
 * @param writer - the deployment's prose writer.
 * @param instruction - what the person asked for, verbatim.
 * @param section - the section to rewrite.
 * @param context - the values the text must stay consistent with.
 * @returns the new body and what wrote it.
 */
export async function writeSection(
  writer: ResearchProseWriter,
  instruction: string,
  section: ManuscriptSectionParts,
  context: Readonly<Record<string, unknown>>,
): Promise<{ readonly text: string; readonly provider: string; readonly model: string }> {
  const result = await writer.write({
    stepId: 'E1-format',
    instruction: `Revise the section "${section.heading}" of this manuscript. The reader asked for: `
      + `${instruction}\n\nCurrent text:\n${section.bodyText}\n\n`
      + 'Keep every number, citation label and heading exactly as they are; change only the prose that '
      + 'the request is about. Answer with the replacement section body and nothing else.',
    context,
  })
  return { text: result.text, provider: result.provider, model: result.model }
}

/**
 * What an acceptance left behind, as the deployment records it.
 *
 * IT IS WRITTEN BECAUSE THE ACCEPTANCE IS DURABLE STATE, not only a response: a page that reloads —
 * or opens tomorrow — has to be able to say that a candidate became the manuscript, which one, and
 * who accepted it. Without this record the only trace would be the run's own audit event, which
 * names a candidate id and nothing a page can render beside the request it answered.
 */
export interface RevisionAcceptanceRecord {
  readonly requestId: string
  readonly candidateId: string
  readonly operator: string
  /** The run revision the acceptance published. */
  readonly revision: number
  /** The manuscript version the accepted text became. */
  readonly manuscriptVersion: number
  readonly acceptedAt: number
  /** Whether the run's own write of it landed; a restart keeps what the disk has. */
  readonly persisted: boolean
  readonly persistenceError?: string
}

/** Where one deployment's revision records live. */
export interface RevisionStore {
  readonly directory: string
}

/**
 * Resolve the revision store for a deployment.
 *
 * @param config - the deployment's snapshot root.
 * @returns the store, or undefined when this deployment keeps no durable root — in which case a
 *   revision cannot be recorded and its caller must say so rather than hold it in memory.
 */
export function revisionStoreOf(config: RevisionStoreConfig): RevisionStore | undefined {
  return config.snapshotDirectory === undefined
    ? undefined
    : { directory: join(config.snapshotDirectory, 'revisions') }
}

/** One request's directory, so a candidate and its review sit with the request they answer. */
function requestDirectory(store: RevisionStore, requestId: string): string {
  return join(store.directory, requestId)
}

/**
 * Write one durable record, by write-and-rename.
 *
 * @param directory - where the record lives.
 * @param name - the record's file name.
 * @param record - the record to write.
 * @returns the file written.
 */
export async function writeRevisionRecord(
  directory: string,
  name: string,
  record: unknown,
): Promise<string> {
  await mkdir(directory, { recursive: true })
  const target = join(directory, name)
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(record, null, 1), { encoding: 'utf8' })
  await rename(temporary, target)
  return target
}

/**
 * Read one request's records.
 *
 * @param store - the deployment's revision store.
 * @param requestId - the request to read.
 * @returns the request, its candidates and their reviews, each as it stands on disk.
 */
export async function readRevision(
  store: RevisionStore,
  requestId: string,
): Promise<{
  readonly request: RevisionRequestRecord | null
  readonly candidates: ReadonlyArray<RevisionCandidateRecord>
  readonly reviews: ReadonlyArray<RevisionReviewRecord>
  readonly acceptance: RevisionAcceptanceRecord | null
}> {
  const directory = requestDirectory(store, requestId)
  const names = await readdir(directory).catch(() => [] as string[])
  const read = async <T>(name: string): Promise<T | null> => {
    try {
      return JSON.parse(await readFile(join(directory, name), 'utf8')) as T
    } catch (error) {
      // ABSENT is a record that was never written; UNREADABLE is one the deployment cannot answer
      // for. Folding the second into the first would report a corrupted revision as no revision.
      if ((error as { code?: unknown }).code === 'ENOENT') return null
      throw new Error(`[revision-unreadable] '${name}' cannot be read: ${String(error)}`)
    }
  }
  const request = await read<RevisionRequestRecord>('request.json')
  const acceptance = await read<RevisionAcceptanceRecord>('acceptance.json')
  const candidates: RevisionCandidateRecord[] = []
  const reviews: RevisionReviewRecord[] = []
  for (const name of names.filter(entry => entry.startsWith('candidate-') && entry.endsWith('.json'))) {
    const candidate = await read<RevisionCandidateRecord>(name)
    if (candidate !== null) candidates.push(candidate)
  }
  for (const name of names.filter(entry => entry.startsWith('review-') && entry.endsWith('.json'))) {
    const review = await read<RevisionReviewRecord>(name)
    if (review !== null) reviews.push(review)
  }
  return { request, candidates, reviews, acceptance }
}

/**
 * Write one request's record.
 *
 * @param store - the deployment's revision store.
 * @param request - the request to record.
 * @returns the file written.
 */
export async function writeRevisionRequest(
  store: RevisionStore,
  request: RevisionRequestRecord,
): Promise<string> {
  return await writeRevisionRecord(requestDirectory(store, request.requestId), 'request.json', request)
}

/**
 * Write one candidate, under the request it answers.
 *
 * @param store - the deployment's revision store.
 * @param candidate - the candidate to record.
 * @returns the file written.
 */
export async function writeCandidate(
  store: RevisionStore,
  candidate: RevisionCandidateRecord,
): Promise<string> {
  return await writeRevisionRecord(
    requestDirectory(store, candidate.requestId),
    `candidate-${candidate.candidateId}.json`,
    candidate,
  )
}

/**
 * Write one acceptance, under the request it answers.
 *
 * @param store - the deployment's revision store.
 * @param requestId - the request that was answered.
 * @param acceptance - what the acceptance produced.
 * @returns the file written.
 */
export async function writeAcceptance(
  store: RevisionStore,
  requestId: string,
  acceptance: RevisionAcceptanceRecord,
): Promise<string> {
  return await writeRevisionRecord(requestDirectory(store, requestId), 'acceptance.json', acceptance)
}

/**
 * Write one review, under the request it belongs to.
 *
 * @param store - the deployment's revision store.
 * @param review - the review to record.
 * @returns the file written.
 */
export async function writeReview(
  store: RevisionStore,
  requestId: string,
  review: RevisionReviewRecord,
): Promise<string> {
  return await writeRevisionRecord(
    requestDirectory(store, requestId),
    `review-${review.candidateId}.json`,
    review,
  )
}
