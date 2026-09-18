// @deepseek-ai/dsh-research-team — what a citation CLAIMS, and what was actually read to support it.
//
// WHY THIS EXISTS. The pipeline retrieves literature and turns the hits into a reference list, and
// until now that was one step: whatever the search returned became an entry, and the manuscript's
// bibliography was the search result set. A reader of the delivered paper could see the consequence —
// twenty-five real DOIs and a body that cites none of them — because nothing anywhere bound a
// SENTENCE to a source. An entry in a reference list is not a citation; a citation is a statement
// about one sentence, and it only means something if somebody read the passage that supports it.
//
// WHAT A BINDING RECORDS. The statement, the source, a stable key, WHERE in the source the passage
// was read, the passage itself and a hash over it, whether that passage supports the statement, and
// how the support decision was reached. The passage and its hash are what make the record auditable:
// a source can be re-read later and the paragraph a reviewer judged can be checked, which a bare
// DOI cannot support.
//
// SUPPORT IS NOT PROVENANCE. A source that exists, is real, is on the same topic and is correctly
// cited does NOT thereby support the sentence it is attached to. The two questions are separate
// fields, and keeping them separate is the point: `supported` is a judgement about one passage and
// one statement, and every other outcome — contradicted, partial, unread, unavailable — is recorded
// as itself rather than folded into "cited".
//
// WHAT THIS IS NOT. It does not retrieve, does not fetch, and does not decide what a source means.
// It records a judgement and refuses to record one it cannot express: a binding whose passage is
// empty, whose key collides with another's, or whose support rests on an abstract is refused here
// rather than published as support.

import { createHash } from 'node:crypto'

import { EVIDENCE_CORPUS, assessmentsFor, corpusBindingOf, corpusSource } from './evidence-corpus.ts'
import type { StatementAssessment } from './statement-support.ts'
import type {
  EvidenceBinding, SourceAcquisition, SourceRegistration, SourceRegistry, SourceRegistryMode,
} from '@deepseek-ai/dsh-research-core'

/** How one source stands in relation to the statement it is cited for. */
export type CitationSupport =
  /** The passage read establishes the statement. */
  | 'supported'
  /** The passage read establishes the opposite of the statement. */
  | 'contradicted'
  /** The passage read establishes part of it, or establishes it only in a narrower scope. */
  | 'partial'
  /** A candidate that was examined and does not bear on the statement. */
  | 'unrelated'

/** How far a source was actually read, which bounds what any support judgement can rest on. */
export type CitationReadScope =
  /** The passage was read in the source's full text. */
  | 'full-text'
  /** Only the abstract or another summary was available. A support judgement then rests on it. */
  | 'abstract-only'
  /** Metadata only: the record exists, nothing of its content was read. */
  | 'metadata-only'

/** Why a source could not be read, when it could not be. */
export type CitationAccess =
  /** The source was reachable and read. */
  | 'read'
  /** The identifier resolves to nothing in the service that was asked. */
  | 'not-found'
  /** The service could not be reached or answered with an error. NOT the same as `not-found`. */
  | 'unavailable'
  /** The record exists and its content is behind access this deployment does not have. */
  | 'not-accessible'

/** One source, as it was retrieved, with every field the source itself stated. */
export interface SourceRecord {
  /** The identifier the retrieval service gave it. */
  readonly id: string
  /** The DOI or other scheme the source is identified by, when it stated one. */
  readonly ref: { readonly kind: string; readonly id: string }
  readonly title: string
  readonly authors: ReadonlyArray<string>
  /** The publication year the source stated, or undefined. NEVER inferred from another field. */
  readonly year?: number
  readonly venue?: string
  /**
   * The volume, issue, page range or article number, as the source stated them.
   *
   * Held as one record of what the source said rather than as a fabricated `pages` string: a source
   * that states an article number and no page range is a fact about that source, and writing it into
   * a page field would invent the page range nobody read.
   */
  readonly locator?: Readonly<Record<string, string>>
  /** Whether the source is recorded as retracted or corrected, with what was recorded. */
  readonly correction?: { readonly kind: 'retracted' | 'corrected'; readonly note: string }
  /**
   * Which registry this record was read from.
   *
   * OPTIONAL BECAUSE A REGISTRY MAY NOT SAY, and absent is not a third registry: it is a record whose
   * origin this run cannot state. A bibliography drawn from such a record is still writable and its
   * origin is unrecorded, which is a fact about the run rather than about the source.
   */
  readonly registry?: SourceRegistry
  /** How the record entered the run. Absent when the registry did not say. */
  readonly acquisition?: SourceAcquisition
  /**
   * The passage a judgement about this source would rest on, when one was read.
   *
   * THE CITED RECORD CARRIES ITS EVIDENCE, not only its identity: a bibliography entry can be written
   * from a title and a year, and a citation cannot be checked without knowing which words were read.
   */
  readonly evidence?: EvidenceBinding
}

/**
 * One citation: the statement it is for, the source it names, and what was read.
 *
 * `statementId` is what makes this a citation rather than a bibliography entry. It names the sentence
 * in the manuscript the source is cited FOR, so a reader can check the pair, and so a revision that
 * rewrites the sentence can invalidate the citation that supported it.
 */
export interface CitationUse {
  /** The statement this citation supports, named the way the manuscript names it. */
  readonly statementId: string
  /**
   * THE CONTENT VERSION the judgement below was made about: the hash of the statement's text as it
   * stood when a reviewer read it.
   *
   * A JUDGEMENT IS ABOUT A SENTENCE, NOT ABOUT A SLOT. Recording only the statement id made the
   * judgement survive an edit, because the id names the node and a revision rewrites the text under
   * it: the same citation then asserted support for a sentence nobody had read. This is what a
   * revision changes, and what `checkStatementBindings` compares.
   */
  readonly statementSha256: string
  /** The retrieved source's own id. */
  readonly literatureRef: string
  /** The stable key the manuscript cites, minted once and never re-derived from the title. */
  readonly citeKey: string
  /** Where in the source the passage below was read: a section, page or paragraph the reader names. */
  readonly location: string
  /** The passage itself, quoted. */
  readonly quote: string
  /**
   * THE EVIDENCE VERSION: SHA-256 of `quote`, the passage the judgement was made on.
   *
   * Separate from the statement's content version because the two change for different reasons. A
   * corpus that corrects or replaces an excerpt changes what the source says without touching the
   * manuscript, and a judgement made about the old excerpt establishes nothing about the new one —
   * so this is compared against the evidence as it stands, not against the evidence that was there.
   */
  readonly quoteSha256: string
  /** How the source stands in relation to the statement. */
  readonly support: CitationSupport
  /** How much of the source was read. */
  readonly readScope: CitationReadScope
  /** Whether the source could be reached at all. */
  readonly access: CitationAccess
  /** Who judged the support relationship: a person, or the deployment's own reviewer. */
  readonly judgedBy: string
}

/** Why a citation binding was refused. */
export type CitationRefusalCode =
  /** Two bindings claim one cite key, so the manuscript cannot name one of them. */
  | 'citation-duplicate-key'
  /** The binding rests on its own text: no passage, or a passage nothing can be checked against. */
  | 'citation-no-passage'
  /** Support is claimed from an abstract or from metadata alone, which cannot establish it. */
  | 'citation-support-beyond-scope'
  /** The source is recorded as retracted or corrected, and the citation does not say so. */
  | 'citation-source-retracted'
  /** The source could not be reached. Distinct from a source that does not exist. */
  | 'citation-source-unavailable'
  /** The source does not state a field the bibliography needs. Recorded, never filled in. */
  | 'citation-metadata-missing'
  /** The manuscript cites a key its reference list does not carry. */
  | 'citation-target-missing'
  /** The reference list carries an entry no sentence cites. */
  | 'citation-entry-uncited'
  /** A cited source has no reviewed judgement about what it establishes. */
  | 'citation-unreviewed-source'
  /** A reviewed source no sentence cites, so the paper failed to state a position it holds. */
  | 'citation-source-uncited'
  /** A binding names a statement the manuscript no longer carries. */
  | 'citation-statement-missing'
  /** A binding was made about a version of the statement the manuscript has since rewritten. */
  | 'citation-statement-changed'
  /** The passage a judgement was made on is not the passage the source now holds. */
  | 'citation-evidence-changed'
  /**
   * A sentence cites a source and no binding covers THAT SENTENCE.
   *
   * THE OTHER DIRECTION OF THE SAME CHECK, and the one a set of bindings alone cannot see: every
   * binding can be sound while a sentence that cites something has none, and then nothing verified
   * the sentence at all. It is reachable without anybody doing anything wrong — a source cited in two
   * sentences produced one binding for the first, and a revision that leaves the markers in place
   * while the bindings age out leaves the later sentences unverified.
   */
  | 'citation-statement-unbound'

/** One refusal, naming what is wrong. */
export interface CitationRefusal {
  readonly code: CitationRefusalCode
  readonly detail: string
}

/**
 * How a sentence cites a source in the manuscript body: `[@cite-<source id>]`.
 *
 * AN EXPLICIT MARKER, NOT A PARSE OF PROSE. The plan's rule for this layer is that the model's output
 * is validated at the JSON boundary and the final text is not scanned with regular expressions to
 * recover meaning; a citation is one of the few things the text DOES carry as a typed inline marker,
 * so what is read here is exactly what the writer was told to emit.
 *
 * THE KEY IS EVERYTHING UP TO THE CLOSING BRACKET, because a key is minted from an identifier and
 * identifiers contain the characters a path does: a DOI-derived key is `cite-10.1016/j.trb.2025.103352`.
 * A character class listing the characters that seemed plausible matched none of the shipped keys,
 * and the check then reported every reference as uncited while the sentence in front of it cited one.
 */
const CITATION_MARKER = /\[@([^\[\]\s]+)\]/gu

/**
 * The keys one piece of prose cites, in the order they appear, without repetition.
 *
 * @param text - a section body.
 * @returns the cite keys it names.
 */
export function citedKeysIn(text: string): ReadonlyArray<string> {
  const keys: string[] = []
  for (const match of text.matchAll(CITATION_MARKER)) {
    const key = match[1]
    if (key !== undefined && !keys.includes(key)) keys.push(key)
  }
  return keys
}

/**
 * Replace each citation marker with the number its entry carries in the reference list.
 *
 * THE READER SEES A NUMBER, NOT A KEY. The key is the manuscript's internal identity for a source and
 * means nothing to somebody reading the paper, so the assembled text carries the number the reference
 * list assigns. A marker with no number is left as it stands rather than dropped: the check below
 * refuses the manuscript for it, and removing the evidence of the problem here would hide it.
 *
 * @param text - a section body.
 * @param numberByKey - the number each cite key is printed under.
 * @returns the body with markers numbered.
 */
export function renderCitationMarkers(
  text: string,
  numberByKey: ReadonlyMap<string, number>,
): string {
  return text.replace(CITATION_MARKER, (whole, key: string) =>
    numberByKey.has(key) ? `[${String(numberByKey.get(key))}]` : whole)
}

/**
 * Require a manuscript's citations and its reference list to be the same set, or refuse it.
 *
 * THREE WAYS A PAPER CITES NOTHING WHILE LOOKING LIKE IT CITES SOMETHING, all of them produced by
 * this deployment already:
 *
 * - the delivered paper's reference list is the RETRIEVAL LEDGER — twenty-five works, no sentence
 *   citing any of them, which reads to a referee as a literature base and is a search log;
 * - a sentence can name a key the reference list does not carry, which a reader cannot resolve;
 * - a sentence can cite a work the run RETRIEVED BUT NEVER REVIEWED. Being on the same topic is what
 *   a search returns, not what a citation claims, and a source with no support judgement has nothing
 *   binding it to the statement it is attached to.
 *
 * @param input - the manuscript body, the reference list, and the keys that carry a reviewed judgement.
 * @returns one refusal per problem, or an empty list.
 */
export function checkManuscriptCitations(input: {
  readonly bodyText: string
  readonly entries: ReadonlyArray<{ readonly citeKey: string }>
  readonly reviewedKeys: ReadonlyArray<string>
}): ReadonlyArray<CitationRefusal> {
  const cited = citedKeysIn(input.bodyText)
  const entryKeys = new Set(input.entries.map(entry => entry.citeKey))
  const reviewed = new Set(input.reviewedKeys)
  const refusals: CitationRefusal[] = []
  for (const key of cited) {
    if (!entryKeys.has(key)) {
      refusals.push({
        code: 'citation-target-missing',
        detail: `the manuscript cites '${key}', which its reference list does not carry — a reader`
          + ' cannot resolve the citation',
      })
    }
    if (!reviewed.has(key)) {
      refusals.push({
        code: 'citation-unreviewed-source',
        detail: `the manuscript cites '${key}' for support, and this run holds no reviewed judgement`
          + ' about what that source establishes — being retrieved is not being read',
      })
    }
  }
  for (const entry of input.entries) {
    if (!cited.includes(entry.citeKey)) {
      refusals.push({
        code: 'citation-entry-uncited',
        detail: `the reference list carries '${entry.citeKey}', which no sentence in the manuscript`
          + ' cites — a reference list is what the paper rests on, not what a search returned',
      })
    }
  }
  return refusals
}

/**
 * The sources this deployment has actually reviewed, as citation sources.
 *
 * READ FROM THE REVIEWED CORPUS, NOT FROM THE RETRIEVAL. The retrieval returns candidates; the corpus
 * holds the works somebody read and judged. A citation can only be bound to the second, which is why
 * this map is what `bibliographyOf` is given: a key that is not in it is a source nobody read.
 *
 * @returns the reviewed sources, keyed by their own id.
 */
export function reviewedSources(): ReadonlyMap<string, SourceRecord> {
  return new Map(EVIDENCE_CORPUS.map((source) => {
    const record: SourceRecord = {
      id: source.doi,
      ref: { kind: 'doi', id: source.doi },
      title: source.title,
      authors: source.authors,
      year: source.year,
      venue: source.venue,
      registry: 'curated',
      acquisition: 'retrieved-then-checked-in',
      evidence: corpusBindingOf(source),
      ...(source.retracted
        ? { correction: { kind: 'retracted' as const, note: 'the catalogue that served the record marks it retracted' } }
        : {}),
    }
    return [record.id, record]
  }))
}

/**
 * One source a deployment's registry offered, as a record the citation chain can use.
 *
 * @param registration - the source, as the reading package handed it over.
 * @returns the record, carrying the registry it came from and the passage it was read at.
 */
export function sourceRecordOf(registration: SourceRegistration): SourceRecord {
  return {
    id: registration.identity,
    ref: registration.ref,
    title: registration.title,
    authors: registration.authors,
    ...(registration.year === undefined ? {} : { year: registration.year }),
    ...(registration.venue === undefined ? {} : { venue: registration.venue }),
    registry: registration.registry,
    acquisition: registration.acquisition,
    ...(registration.evidence === undefined ? {} : { evidence: registration.evidence }),
  }
}

/**
 * The sources one run may cite, from the registry it configured.
 *
 * ONE MECHANISM, SELECTED BY CONFIGURATION, AND NO FALLBACK. `zotero` answers with what the library
 * registry offered — and when that registry could not read its library it offers nothing, so this
 * returns nothing rather than the checked-in corpus. A run configured to cite a library and silently
 * citing a repository instead has published a bibliography nobody asked for, and the failure is
 * invisible in the delivered paper.
 *
 * `combined` registers each source WITH ITS OWN ORIGIN rather than pooling two lists, so which
 * registry a reference came from survives into the bibliography.
 *
 * @param mode - which registry this run draws on.
 * @param registrations - what the library registry offered, empty for a run that does not read one.
 * @returns the citable sources, keyed by their own id.
 */
export function sourcesForMode(
  mode: SourceRegistryMode,
  registrations: ReadonlyArray<SourceRegistration>,
): ReadonlyMap<string, SourceRecord> {
  const curated = mode === 'zotero' ? new Map<string, SourceRecord>() : reviewedSources()
  if (mode === 'curated') return curated
  const records = new Map(curated)
  for (const registration of registrations) {
    const record = sourceRecordOf(registration)
    // A REGISTRATION NEVER OVERWRITES A CURATED RECORD. Two registries that minted one identity is a
    // collision, and silently preferring one would drop a source the other offered without saying so.
    if (records.has(record.id)) continue
    records.set(record.id, record)
  }
  return records
}

/**
 * One statement in the manuscript: a node with an identity, a text, and a version of that text.
 *
 * IDENTITY, TEXT AND VERSION ARE THREE FACTS, and collapsing them is how a citation comes to assert
 * support for a sentence nobody read.
 *
 *   - `statementId` names the NODE. It is minted when the statement is first located and it survives a
 *     revision, because a reader comparing two drafts needs to see that THIS node's text changed —
 *     an id derived from the text would read as one statement deleted and another created.
 *   - `text` is what the node currently says.
 *   - `textSha256` is the CONTENT VERSION. A support judgement records the version it was made about,
 *     and `checkStatementBindings` compares the two, so a rewrite invalidates the judgement rather
 *     than silently transferring it to text nobody has read.
 */
export interface Statement {
  readonly statementId: string
  /** The section the sentence sits in, for locating it and for a reader's benefit. */
  readonly sectionId: string
  readonly text: string
  readonly textSha256: string
}

/**
 * What a reviewer established about one source, BEFORE it is attached to a statement.
 *
 * THE JUDGEMENT AND THE ATTACHMENT ARE TWO STEPS. This is what the reviewed corpus holds — the
 * passage, where it was read, the verdict, who judged it — and it says nothing about where in a
 * manuscript the source will be cited. The attachment is a separate operation over the written prose,
 * which is the only order in which "a citation is for a sentence" can be true: a judgement made before
 * the sentence exists can only be about a slot.
 */
export interface SourceJudgement {
  readonly literatureRef: string
  readonly citeKey: string
  readonly location: string
  readonly quote: string
  readonly quoteSha256: string
  readonly support: CitationSupport
  readonly readScope: CitationReadScope
  readonly access: CitationAccess
  readonly judgedBy: string
}

/** One sentence of a section, as a location candidate. */
function sentencesWithMarkers(bodyText: string): ReadonlyArray<string> {
  return bodyText
    .split(/(?<=[.!?])\s+/u)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length > 0 && citedKeysIn(sentence).length > 0)
}

/**
 * Where each statement IS, in one manuscript: a sentence that carries a citation marker.
 *
 * LOCATING IS NOT IDENTIFYING. This scan finds the sentence a statement currently occupies; it does
 * not decide what the statement is or whether a judgement about it still holds. The node id is minted
 * from the section and the sentence's ordinal AMONG CITED SENTENCES, so inserting an uncited sentence
 * shifts nothing and rewriting a cited one keeps its node — which is what makes "this node's text
 * changed" visible rather than "this node vanished".
 *
 * @param sections - the manuscript's sections, in order.
 * @returns one statement per cited sentence, in the order a reader meets them.
 */
export function locateStatements(
  sections: ReadonlyArray<{ readonly id: string; readonly bodyText: string }>,
): ReadonlyArray<Statement> {
  const statements: Statement[] = []
  for (const section of sections) {
    if (section.id === 'references') continue
    let ordinal = 0
    for (const sentence of sentencesWithMarkers(section.bodyText)) {
      ordinal += 1
      statements.push({
        statementId: `stmt-${section.id}-${String(ordinal)}`,
        sectionId: section.id,
        text: sentence,
        textSha256: sha256(sentence),
      })
    }
  }
  return statements
}

/**
 * SHA-256 of one piece of text, as the content and evidence versions are computed.
 *
 * @param text - the text.
 * @returns its SHA-256, hex.
 */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** What the reviewed corpus establishes about one claim version's sources, unattached. */
export function judgementsFor(
  claimRef: string,
  from?: ReadonlyMap<string, SourceRecord>,
): ReadonlyArray<SourceJudgement> {
  // THE RUN'S OWN REGISTRY WHEN IT HAS ONE. A run configured to cite a literature library passes what
  // that library offered; one that names none reads the checked-in corpus, exactly as before.
  const sources = from ?? reviewedSources()
  return assessmentsFor(claimRef)
    .flatMap((assessment) => {
      const source = sources.get(assessment.sourceDoi)
      const corpus = corpusSource(assessment.sourceDoi)
      if (source === undefined || corpus === undefined) return []
      // THE SCOPE OF THE READING IS WHAT THE CORPUS RECORDED, not what the citation would like: a
      // judgement made on an abstract stays an abstract in the binding, and `checkCitationUse`
      // refuses a `supported` claim resting on one.
      const readScope: CitationReadScope = corpus.sourceAccess === 'full-text' ? 'full-text' : 'abstract-only'
      return [{
        literatureRef: source.id,
        citeKey: citeKeyOf(source),
        // WHERE IT WAS READ, as the corpus recorded it: the URI the text was fetched from and the
        // version it was at. A page number nobody wrote down would be an invention.
        location: `${corpus.sourceUri} (${corpus.sourceVersion})`,
        quote: corpus.excerpt,
        quoteSha256: corpus.excerptHash,
        support: assessment.verdict === 'supports' ? 'supported' as const : 'contradicted' as const,
        readScope,
        access: 'read' as const,
        judgedBy: assessment.reviewer,
      }]
    })
    .sort((left, right) => left.citeKey.localeCompare(right.citeKey))
}

/**
 * Attach each judgement to the statement that cites its source.
 *
 * A JUDGEMENT IS ATTACHED, NEVER INHERITED. The binding this produces records the CONTENT VERSION of
 * the sentence it was attached to and the EVIDENCE VERSION of the passage it rests on, both read at
 * this moment — so a later revision changes what the statement says, `checkStatementBindings` sees the
 * disagreement, and the citation is refused until somebody reads the new sentence. Nothing here
 * decides that a judgement still holds; it records what it held about.
 *
 * @param judgements - what the reviewed corpus establishes about this claim's sources.
 * @param statements - where the manuscript's cited sentences are.
 * @returns the bindings, in cite-key order, and the judgements no statement cited.
 */
export function bindJudgements(
  judgements: ReadonlyArray<SourceJudgement>,
  statements: ReadonlyArray<Statement>,
  // THE SENTENCE'S OWN VERDICT, when the deployment read one. Passed in rather than derived: what a
  // passage establishes about a CLAIM is not what it establishes about the sentence citing it, and
  // `statement-support.ts` is where that second reading is recorded. A deployment that assessed
  // nothing passes none, and the binding then carries the claim's verdict — which
  // `checkStatementSupport` refuses as `statement-unassessed` wherever an assessor is configured.
  assessments: ReadonlyArray<StatementAssessment> = [],
): {
  readonly uses: ReadonlyArray<CitationUse>
  readonly uncited: ReadonlyArray<SourceJudgement>
} {
  const byCiteKey = new Map(judgements.map(judgement => [judgement.citeKey, judgement]))
  const assessmentOf = new Map(assessments.map(assessment =>
    [`${assessment.statementId} ${assessment.citeKey}`, assessment]))
  const uses: CitationUse[] = []
  // ONE BINDING PER SENTENCE THAT CITES, not one per source. The set below used to be keyed by cite
  // key ALONE, so a source cited in two sentences produced a binding for the first and none for the
  // second — and every check that reads bindings then had nothing to read for the second sentence.
  // A paper citing the same source twice makes the same claim in two places, and each of them is a
  // sentence a person has to be able to check; a binding that covers only the first is a citation
  // nothing verified for the rest of the manuscript.
  const cited = new Set<string>()
  for (const statement of statements) {
    for (const key of citedKeysIn(statement.text)) {
      const judgement = byCiteKey.get(key)
      if (judgement === undefined) continue
      cited.add(key)
      const assessed = assessmentOf.get(`${statement.statementId} ${key}`)
      uses.push({
        statementId: statement.statementId,
        statementSha256: statement.textSha256,
        literatureRef: judgement.literatureRef,
        citeKey: judgement.citeKey,
        location: judgement.location,
        quote: judgement.quote,
        quoteSha256: judgement.quoteSha256,
        // THE SENTENCE'S VERDICT WHEN THERE IS ONE, the claim's otherwise. The passage and its version
        // are the source's either way — what changes is whether anybody read it against THIS sentence.
        support: assessed?.support ?? judgement.support,
        readScope: assessed?.readScope ?? judgement.readScope,
        access: judgement.access,
        judgedBy: judgement.judgedBy,
      })
    }
  }
  // WHERE EACH STATEMENT SITS IN THE MANUSCRIPT, so the bindings for one source read in the order a
  // reader meets them. Sorting by the statement's id instead would put an introduction after a
  // discussion whenever the alphabet says so, which is a reading nobody does.
  const positionOf = new Map(statements.map((statement, index) => [statement.statementId, index]))
  return {
    // IN DOCUMENT ORDER WITHIN A KEY, so two readings of the same manuscript produce the same list:
    // the key orders the groups, the sentence orders within one, and the content version is the
    // tiebreak that keeps two occurrences of the same sentence from swapping places.
    uses: uses.sort((left, right) =>
      left.citeKey.localeCompare(right.citeKey)
      || (positionOf.get(left.statementId) ?? 0) - (positionOf.get(right.statementId) ?? 0)
      || left.statementSha256.localeCompare(right.statementSha256)),
    // A SOURCE IS UNCITED ONLY WHEN NO SENTENCE NAMES IT — the fact this returns, not "which
    // sentence claimed it first".
    uncited: judgements.filter(judgement => !cited.has(judgement.citeKey)),
  }
}

/**
 * Whether every binding still holds against the manuscript and the evidence as they stand.
 *
 * THE THREE WAYS A JUDGEMENT OUTLIVES WHAT IT WAS MADE ABOUT, and each is refused rather than
 * repaired: the sentence the binding names is gone; the sentence is there but says something else; or
 * the passage the judgement rests on is not the passage the source now holds. A re-binding is not the
 * remedy for any of them — a judgement is a reading somebody made, and the only thing that can replace
 * it is another reading.
 *
 * @param uses - the bindings the manuscript records.
 * @param statements - where the manuscript's cited sentences are now.
 * @param judgements - what the reviewed corpus establishes now.
 * @returns one refusal per stale binding, or an empty list.
 */
export function checkStatementBindings(
  uses: ReadonlyArray<CitationUse>,
  statements: ReadonlyArray<Statement>,
  judgements: ReadonlyArray<SourceJudgement>,
): ReadonlyArray<CitationRefusal> {
  const byId = new Map(statements.map(statement => [statement.statementId, statement]))
  const byCiteKey = new Map(judgements.map(judgement => [judgement.citeKey, judgement]))
  const refusals: CitationRefusal[] = []
  // EVERY CITED SENTENCE MUST HAVE A BINDING, read as a set equality rather than by walking the
  // bindings: the bindings can all be sound while a sentence that cites something has none.
  const bound = new Map<string, Set<string>>()
  for (const use of uses) {
    const keys = bound.get(use.statementId) ?? new Set<string>()
    keys.add(use.citeKey)
    bound.set(use.statementId, keys)
  }
  for (const statement of statements) {
    for (const key of citedKeysIn(statement.text)) {
      if (bound.get(statement.statementId)?.has(key) === true) continue
      refusals.push({
        code: 'citation-statement-unbound',
        detail: `'${statement.statementId}' cites '${key}' and no binding covers that sentence —`
          + ' the citation is one nobody read the source against',
      })
    }
  }
  for (const use of uses) {
    const statement = byId.get(use.statementId)
    if (statement === undefined) {
      refusals.push({
        code: 'citation-statement-missing',
        detail: `'${use.citeKey}' is bound to '${use.statementId}', which this manuscript does not`
          + ' carry — the sentence it was judged against is gone',
      })
      continue
    }
    if (statement.textSha256 !== use.statementSha256) {
      refusals.push({
        code: 'citation-statement-changed',
        detail: `'${use.citeKey}' was judged against a version of '${use.statementId}' that has since`
          + ' been rewritten, so the judgement is about a sentence nobody read — the source has to be'
          + ' re-read against what the manuscript now says',
      })
    }
    const judgement = byCiteKey.get(use.citeKey)
    if (judgement !== undefined && judgement.quoteSha256 !== use.quoteSha256) {
      refusals.push({
        code: 'citation-evidence-changed',
        detail: `'${use.citeKey}' was judged on a passage the source no longer holds — the evidence`
          + ' this citation rests on has changed, so the judgement has to be made again',
      })
    }
  }
  return refusals
}

/**
 * The longest a quote may be before it stops being a passage and becomes the source.
 *
 * A citation that quotes a whole paper has not shown which part supports the statement, and the
 * quote stops being checkable by a reader.
 */
const MAX_QUOTE_LENGTH = 2000

/**
 * Judge one binding, before it is recorded.
 *
 * THE REFUSALS ARE THE POINT, and each names a way a citation can look complete while establishing
 * nothing: a key that will move, a passage nobody can check, support claimed from an abstract, a
 * retracted source cited as authority, a source that could not be reached presented as one that
 * exists, a bibliography field invented rather than read.
 *
 * @param use - the binding as it would be recorded.
 * @param source - the retrieved source it names, when the retrieval holds one.
 * @returns one refusal per problem, or an empty list when the binding may be recorded.
 */
export function checkCitationUse(
  use: SourceJudgement,
  source: SourceRecord | undefined,
): ReadonlyArray<CitationRefusal> {
  const refusals: CitationRefusal[] = []
  if (use.quote.trim() === '') {
    refusals.push({
      code: 'citation-no-passage',
      detail: `'${use.citeKey}' cites ${use.literatureRef} without quoting a passage`
        + ' the passage it was read from — a citation nothing can be checked against establishes'
        + ' nothing',
    })
  } else if (use.quote.length > MAX_QUOTE_LENGTH) {
    refusals.push({
      code: 'citation-no-passage',
      detail: `'${use.citeKey}' quotes ${use.quote.length} characters, which is the source rather than`
        + ' the passage supporting the statement',
    })
  }
  // SUPPORT CANNOT EXCEED WHAT WAS READ. An abstract states what the authors claim; whether the
  // METHOD supports it is exactly what an abstract cannot show, so a `supported` judgement resting on
  // one is refused rather than recorded at a strength its evidence does not carry.
  if (use.support === 'supported' && use.readScope !== 'full-text') {
    refusals.push({
      code: 'citation-support-beyond-scope',
      detail: `'${use.citeKey}' claims support from a source that was only ${use.readScope} — the`
        + ' judgement cannot be stronger than what was read',
    })
  }
  if (use.access !== 'read' && use.support !== 'unrelated') {
    refusals.push({
      code: 'citation-source-unavailable',
      detail: `'${use.citeKey}' records '${use.support}' about ${use.literatureRef}, which was`
        + ` ${use.access}: a source that could not be read is not the same fact as one that does`
        + ' not support the statement',
    })
  }
  if (source?.correction !== undefined) {
    refusals.push({
      code: 'citation-source-retracted',
      detail: `${use.literatureRef} is recorded as ${source.correction.kind}`
        + ` (${source.correction.note}); citing it as authority without saying so is refused`,
    })
  }
  if (source === undefined) {
    refusals.push({
      code: 'citation-metadata-missing',
      detail: `'${use.citeKey}' names ${use.literatureRef}, which the retrieval holds no record for —`
        + ' a bibliography entry cannot be written from a source nobody retrieved',
    })
  }
  return refusals
}

/**
 * The key a source is cited under.
 *
 * DERIVED FROM THE IDENTIFIER, NOT FROM THE TITLE. A key assembled from an author and a year collides
 * for two works by one author in one year, and a key assembled from the title changes when the title
 * is corrected — either way the manuscript's citation stops naming the thing it was bound to. The
 * identifier is the one field the source and the retrieval both treat as identity.
 *
 * @param source - the retrieved source.
 * @returns the cite key.
 */
export function citeKeyOf(source: Pick<SourceRecord, 'id'>): string {
  return `cite-${source.id}`
}

/**
 * Require the bindings of one manuscript to be usable as a set, or refuse them.
 *
 * A KEY IS AN IDENTITY, so two bindings claiming one is a manuscript that cannot say which source a
 * sentence rests on. Duplicates are refused rather than merged: two records under one key may disagree
 * about what was read, and picking one of them would publish a judgement nobody made.
 *
 * @param uses - every binding the manuscript records.
 * @returns one refusal per duplicated key, or an empty list.
 */
export function checkCitationKeys(
  uses: ReadonlyArray<{ readonly citeKey: string; readonly literatureRef?: string }>,
): ReadonlyArray<CitationRefusal> {
  // A KEY NAMES ONE SOURCE. It does not name one citation: the same source cited in two sentences is
  // two bindings for one key, which is what a paper does. What this refuses is ONE KEY MINTED TO TWO
  // SOURCES — the manuscript then prints a number that stands for two different works, and no reader
  // can tell which one a sentence means.
  const firstSourceOf = new Map<string, string | undefined>()
  const refusals: CitationRefusal[] = []
  for (const use of uses) {
    if (!firstSourceOf.has(use.citeKey)) {
      firstSourceOf.set(use.citeKey, use.literatureRef)
      continue
    }
    const first = firstSourceOf.get(use.citeKey)
    if (use.literatureRef === undefined || first === undefined || first === use.literatureRef) continue
    refusals.push({
      code: 'citation-duplicate-key',
      detail: `'${use.citeKey}' is claimed by '${first}' and by '${use.literatureRef}', so the`
        + ' manuscript prints one name for two sources',
    })
  }
  return refusals
}

/**
 * The bibliography of one manuscript: the sources its statements actually cite.
 *
 * THE REFERENCE LIST IS DERIVED FROM CITATIONS, NEVER FROM THE SEARCH RESULT SET. The delivered paper
 * is what the alternative produces: twenty-five retrieved works in the bibliography and a body that
 * cites none of them, which reads to a referee as a literature base and is in fact a search log.
 *
 * @param uses - every binding the manuscript records.
 * @param sources - the retrieved sources, keyed by their own id.
 * @returns the entries to print, in cite-key order, and the sources that were cited but not retrieved.
 */
export function bibliographyOf(
  uses: ReadonlyArray<CitationUse>,
  sources: ReadonlyMap<string, SourceRecord>,
): { readonly entries: ReadonlyArray<SourceRecord>; readonly unresolvable: ReadonlyArray<string> } {
  const cited = new Map<string, SourceRecord>()
  const unresolvable: string[] = []
  for (const use of uses) {
    // A SOURCE THAT WAS EXAMINED AND FOUND UNRELATED IS NOT CITED. It was considered and it does not
    // belong in the reference list, which is a statement about what the paper rests on.
    if (use.support === 'unrelated') continue
    const source = sources.get(use.literatureRef)
    if (source === undefined) {
      unresolvable.push(use.literatureRef)
      continue
    }
    cited.set(source.id, source)
  }
  const entries = [...cited.values()].sort((left, right) =>
    citeKeyOf(left).localeCompare(citeKeyOf(right)))
  return { entries, unresolvable }
}

/**
 * The fields the bibliography needs that a source did not state.
 *
 * A MISSING FIELD IS A FACT ABOUT THE SOURCE, NOT A GAP TO FILL. Guessing a year from a volume number
 * or an article number from a page range produces a reference that reads as verified and is not, so
 * the absence is reported for the writer to state rather than papered over downstream.
 *
 * @param source - the retrieved source.
 * @returns the names of the fields the source did not state, in a fixed order.
 */
export function missingSourceFields(source: SourceRecord): ReadonlyArray<string> {
  const missing: string[] = []
  if (source.authors.length === 0) missing.push('authors')
  if (source.year === undefined) missing.push('year')
  if (source.venue === undefined) missing.push('venue')
  if (source.locator === undefined) missing.push('locator')
  return missing
}
