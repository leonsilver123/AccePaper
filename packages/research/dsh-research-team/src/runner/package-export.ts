// @deepseek-ai/dsh-research-team — reproducible run package export.
//
// Turns one completed run into a directory of real files. "Reproducible package" used to be
// a PROPOSAL: E1 listed five filenames beside a produced manuscript and nothing wrote any of
// them, which invites a reader to take the list for run output. Here every declared file is
// written, each is checked for existence and non-emptiness after the write, and the manifest
// records its path, byte count and content digest.
//
// WHAT THIS IS NOT. A package carries demo artifacts from a synthetic run. Nothing in it is
// a research finding, and the files that hold synthetic measurements say so in their own
// text. The package describes the RUN, not a result.
//
// WHAT IT MUST NOT CONTAIN. Credentials, whole request payloads, and machine-private paths.
// The manifest records paths relative to the package root and never the absolute directory
// it was written to; `sanitizeForExport` strips anything that looks like a secret.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getArtifact, getAuditHistory, getRunSnapshot, getStepDefinitions } from '@deepseek-ai/dsh-research-core'
import { readinessOfRun } from './submission-readiness.ts'
import {
  checkWrittenFiles, writeStagedDirectory,
} from './staged-directory.ts'
import type { StagedFile, WrittenFile, WrittenFileCheck } from './staged-directory.ts'
import {
  checkFinalPackage, citationFactsOf, finalPackageApprovalOf, finalPackageFactsOf, finalPackageStateOf,
} from './final-package.ts'
import type { FinalPackageApproval, FinalPackageCheck, FinalPackageState } from './final-package.ts'
import type { EvidenceProfile, ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import type { SubmissionReadiness } from './submission-readiness.ts'
import type { ReferenceFileReader } from './reference-files.ts'
import { STEP_EXECUTOR_REGISTRY, stepProducerOf } from './registry.ts'
import { reportPaperQuality } from './paper-quality.ts'
import type { PaperQualityReport } from './paper-quality.ts'
import { checkBibliography, referenceEntriesOf } from './bibliography.ts'
import type { BibliographyWriter } from './bibliography.ts'
import { bibliographyOf } from './citation-bindings.ts'
import type { CitationUse, SourceRecord } from './citation-bindings.ts'
import { metricsForStudy } from './metrics.ts'
import { tableCellsOf } from './paper-format.ts'
import type { ThreeLineTableModel } from '@deepseek-ai/dsh-research-tools'

/**
 * What a package needs to know about one step.
 *
 * Narrower than {@link StepOutcome} on purpose: a run's outcome carries the evidence of the drive
 * (artifact values, whether a real tool ran), and a package written AFTER the drive — by an operator
 * asking for the final one — has no drive result to hand. What it has is the run's own record plus
 * the executor registry, and those are what the manifest's step table is built from.
 */
export interface PackageStepFacts {
  readonly stepId: string
  readonly status: string
  readonly attemptId: number
  readonly kind: string
  readonly producer: string
  readonly outputSlugs: ReadonlyArray<string>
  readonly verdicts: Readonly<Record<string, string>>
}

/** The run as a package needs it: its id and one entry per step. */
export interface PackageRunFacts {
  readonly runId: string
  readonly steps: ReadonlyArray<PackageStepFacts>
}

/** One file the package will contain, as content rather than as a name. */
export type PackageFile = StagedFile

/** One written file, with what was checked about it after the write. */
export type PackagedFile = WrittenFile

/** One table the package carries, as the run's document holds it. */
export interface PackagedTable {
  /** The float's number, e.g. `Table 1`, as the manuscript prints it. */
  readonly label: string
  /** Package-relative path of the printed table, e.g. `tables/table-1.md`. */
  readonly markdown: string
  /** Package-relative path of the machine-readable twin, e.g. `tables/table-1.csv`. */
  readonly csv: string
}

/**
 * One attachment a deployment read, for one cite key, with what the run's reading record states.
 *
 * THE TWO VERSIONS ARE THE POINT. `readFrom` is the file a judgement about a passage of this source
 * was made from, as the run recorded it; `file` is what reading the attachment produced now. A
 * package stores the bytes only when the two agree — see {@link planRunPackage}.
 */
export interface ReferencePdfRead {
  /** The stable key the manuscript cites, minted once and never re-derived from the title. */
  readonly citeKey: string
  /** The file the passage behind this citation was read from, as the run's reading record states it. */
  readonly readFrom: {
    readonly sourceIdentity: string
    readonly key: string
    readonly version: string
  }
  /** What reading the attachment produced: its bytes, or why none were read. */
  readonly file:
    | {
      readonly key: string
      readonly version: string
      /** SHA-256 of the bytes, as the reader computed it over the bytes it returned. */
      readonly sha256: string
      readonly base64: string
    }
    | { readonly failure: string }
}

/**
 * The reference files a package may carry, and the deployment's decision about reading them.
 *
 * `none` IS THE ABSENCE OF THE CAPABILITY, not an empty result: a deployment that reads no attachment
 * file says so in its manifest, so a reader is told "this package carries no reference PDFs because
 * the deployment does not store them" rather than being left to interpret an empty directory.
 */
export type ReferencePdfPlan =
  /** The deployment reads no attachment files; no reference file is stored and the manifest says so. */
  | { readonly policy: 'none' }
  /** The deployment reads them; these are the reads the caller made. */
  | { readonly policy: 'local-cache'; readonly reads: ReadonlyArray<ReferencePdfRead> }

/** One reference file the package holds, tied to the attachment a judgement rests on. */
export interface StoredReferencePdf {
  readonly citeKey: string
  /** Package-relative path, e.g. `refs-pdf/cite-10.1016-j.trb.2025.103352.pdf`. */
  readonly path: string
  readonly bytes: number
  readonly sha256: string
  /** The attachment the bytes belong to, as the reading record names it. */
  readonly attachmentKey: string
  /** The attachment's own version, which moves when the file is replaced even if the item does not. */
  readonly attachmentVersion: string
  /** What the file is for, stated rather than left to be inferred from its name. */
  readonly purpose: string
}

/** One reference file that was not stored, and why. */
export interface RefusedReferencePdf {
  readonly citeKey: string
  readonly attachmentKey: string
  /** The failure, in the reader's own words. NEVER a filesystem path. */
  readonly reason: string
}

/**
 * Render records as CSV, one record per line.
 *
 * RFC 4180 QUOTING, which is what makes a round trip through any reader possible: a field is quoted
 * when it contains a comma, a double quote, a carriage return or a newline, and an embedded double
 * quote is doubled. A field that needs none is written bare, so the common case stays readable.
 *
 * The record separator is `\n`, not the RFC's `\r\n`. This repository's files end in one `\n`, and a
 * reader that requires `\r\n` is a reader that also accepts `\n`; the reverse is not true, so the
 * line ending that both accept is the one used. A field carrying a bare `\r` is quoted, which is what
 * keeps a carriage return inside a cell from ending a record for a reader that splits on it.
 *
 * @param records - the records, each already in column order.
 * @returns the file body, newline-terminated, or the empty string when there are no records.
 */
export function csvRecords(records: ReadonlyArray<ReadonlyArray<string>>): string {
  if (records.length === 0) return ''
  return `${records.map(record => record.map(csvField).join(',')).join('\n')}\n`
}

/** One CSV field, quoted exactly when a reader would otherwise mis-read it. */
function csvField(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/** The file name one cite key gets under `refs-pdf/`, or undefined when it names no usable file. */
function referencePdfNameOf(citeKey: string): string | undefined {
  // A CITE KEY IS NOT A FILE NAME. It is minted from the identifier it cites and so carries dots,
  // slashes and colons — `cite-10.1016/j.trb.2025.103352` would land in a SUBDIRECTORY named after
  // the prefix. The manifest entry carries the key itself, so the mapping is explicit rather than
  // left to be read off the path.
  const slug = citeKey.replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^[.-]+|[.-]+$/gu, '')
  // A name that is empty, or that walks out of its directory, is refused rather than sanitized into
  // something that happens to be safe.
  return slug === '' || slug.includes('..') ? undefined : `${slug}.pdf`
}

/** The tables the run's document holds, read from the artifact a durable store keeps them in. */
function documentTablesOf(
  document: unknown,
): ReadonlyArray<{
  readonly label: string
  readonly caption: string
  readonly markdown: string
  readonly model: ThreeLineTableModel
}> {
  const sections = (document as { readonly sections?: unknown } | undefined)?.sections
  if (!Array.isArray(sections)) return []
  return sections.flatMap((section) => {
    const blocks = (section as { readonly blocks?: unknown }).blocks
    if (!Array.isArray(blocks)) return []
    return blocks.flatMap((block): ReadonlyArray<{
      readonly label: string
      readonly caption: string
      readonly markdown: string
      readonly model: ThreeLineTableModel
    }> => {
      const entry = block as {
        readonly kind?: unknown
        readonly label?: unknown
        readonly caption?: unknown
        readonly markdown?: unknown
        readonly model?: unknown
      }
      // THE MODEL IS WHAT MAKES THIS A TABLE this package can carry: the Markdown beside it is one
      // rendering of it and the CSV twin is another, so a block declaring itself a table without one
      // is reported as no table rather than published as a caption over a rendering nothing can be
      // checked against. The `null` in this cast is the boundary's, not the interface's: the document
      // came out of a durable store, where a key the interface forbids is still a value to refuse.
      const model = entry.model as ThreeLineTableModel | null | undefined
      return entry.kind === 'table' && typeof entry.label === 'string' && typeof entry.caption === 'string'
        && typeof entry.markdown === 'string' && entry.markdown.trim() !== ''
        && model !== undefined && model !== null && typeof model === 'object' && Array.isArray(model.columns)
        ? [{ label: entry.label, caption: entry.caption, markdown: entry.markdown, model }]
        : []
    })
  })
}

/**
 * The attachments the run's own reading records name, one per cited source.
 *
 * READ FROM THE RUN, and from the registry the deployment configured. A citation names the source it
 * rests on by `literatureRef`; the source record for it carries the reading the judgement was made
 * from — the item identity and, when the words came out of a file rather than a page of text, the
 * attachment and that attachment's own version. A source with no attachment contributed no file, so
 * it is not in this list: what a caller reads is exactly the files a judgement stands on.
 *
 * THE BYTES ARE NOT READ HERE. This module is pure with respect to the filesystem, and reading an
 * attachment is a file or a network read; the caller reads, and {@link planRunPackage} decides what
 * of it the package may carry.
 *
 * @param store - the run store.
 * @param runId - the run whose citations are read.
 * @param sources - the sources this run may cite, from the registry it configured.
 * @returns one request per cited source whose reading record names an attachment.
 */
export function citedAttachments(
  store: ResearchRunStore,
  runId: string,
  sources: ReadonlyMap<string, SourceRecord>,
): ReadonlyArray<{ readonly citeKey: string; readonly readFrom: ReferencePdfRead['readFrom'] }> {
  const citations = artifactRecord(store, runId, 'manuscript')?.citations
  if (!Array.isArray(citations)) return []
  return (citations as ReadonlyArray<CitationUse>).flatMap((citation) => {
    const evidence = sources.get(citation.literatureRef)?.evidence
    const attachment = evidence?.attachment
    if (evidence === undefined || attachment === undefined) return []
    return [{
      citeKey: citation.citeKey,
      readFrom: {
        sourceIdentity: evidence.sourceIdentity,
        key: attachment.key,
        version: attachment.version,
      },
    }]
  })
}

/**
 * The tables a document holds, written as the two files each one becomes.
 *
 * TWO FORMS OF ONE TABLE, EVERY CARDINALITY OF EACH READ FROM THE MODEL. The structured model the
 * `three-line-table` capability returned travels on the document's `table` block; the printed
 * Markdown is the rendering the block carries, and the CSV is written from the model's own cells. The
 * twin used to be parsed back out of the printed Markdown, which is a lossy round trip through the
 * pipe renderer — a cell carrying a newline is drawn as a space — so a table whose cells held one
 * could not be recovered from the file the paper prints.
 *
 * EXTRACTED RATHER THAN INLINED because two directories carry these files — the run package and the
 * run's working directory — and a second copy of this loop is how the CSV in one of them stops being
 * the table the other prints.
 *
 * @param document - the manuscript's `document` value, as the artifact carries it.
 * @param files - the files written so far, which the table files are appended to.
 * @returns the manifest section, one entry per table the document holds.
 */
export function packagedTablesOf(
  document: unknown,
  files: StagedFile[],
): ReadonlyArray<PackagedTable> {
  const tables: PackagedTable[] = []
  for (const table of documentTablesOf(document)) {
    const stem = `tables/${table.label.trim().toLowerCase().replace(/\s+/gu, '-')}`
    const markdown = `${stem}.md`
    files.push({ path: markdown, content: markdownFile([`**${table.label}.** ${table.caption}`, '', table.markdown]) })
    const cells = tableCellsOf(table.model)
    const csv = `${stem}.csv`
    files.push({ path: csv, content: csvRecords([cells.header, ...cells.rows]) })
    tables.push({ label: table.label, markdown, csv })
  }
  return tables
}

/**
 * The reference files a caller may hand to an export, read from the deployment's library.
 *
 * READ HERE AND NOT IN THE PLANNERS, which decide what a directory carries and never touch a file:
 * reading an attachment is a file or a network read. What is read is exactly what the run's own
 * reading records name — one file per cited source whose judgement was made from a file rather than
 * from a page of text.
 *
 * A READ THAT FAILS IS RECORDED, NOT THROWN. One attachment the library cannot hand back is a fact
 * about that source, and a caller that refused to write because one file was missing would take away
 * the export a reader can still use. An ABSENT reader, or one whose policy is `none`, is not a
 * failure: nothing is attempted and the manifest says the deployment stores no reference files.
 *
 * EXTRACTED SO BOTH CALLERS SHARE IT. The run's package and the run's working directory each carry
 * `refs-pdf/`, and a second implementation of "which bytes may be stored" is how the two come to
 * store different files for the same citation.
 *
 * @param store - the run store.
 * @param runId - the run being written.
 * @param reader - the deployment's reader, or undefined when it published none.
 * @param sources - the sources this run may cite, from the registry it configured.
 * @returns the plan the manifest records, whether or not any file was read.
 */
export async function referencePdfPlan(
  store: ResearchRunStore,
  runId: string,
  reader: ReferenceFileReader | undefined,
  sources: ReadonlyMap<string, SourceRecord>,
): Promise<ReferencePdfPlan> {
  if (reader === undefined || reader.policy === 'none') return { policy: 'none' }
  const requests = citedAttachments(store, runId, sources)
  const reads = await Promise.all(requests.map(async (request): Promise<ReferencePdfRead> => {
    try {
      const read = await reader.read({
        sourceIdentity: request.readFrom.sourceIdentity,
        attachmentKey: request.readFrom.key,
      })
      return {
        citeKey: request.citeKey,
        readFrom: request.readFrom,
        file: read.ok
          ? {
            key: read.attachmentKey,
            version: read.attachmentVersion,
            sha256: read.sha256,
            base64: read.base64,
          }
          : { failure: read.reason },
      }
    } catch (error) {
      // A THROW IS THE READER FAILING, not the file being absent, and both reach a reader as the
      // reason this source has no file. A throw escaping here would abandon the write for one library
      // error; the reason still carries the error rather than a location.
      return {
        citeKey: request.citeKey,
        readFrom: request.readFrom,
        file: { failure: error instanceof Error ? error.message : String(error) },
      }
    }
  }))
  return { policy: 'local-cache', reads }
}

/**
 * The reference files a directory carries, with what was checked about each one.
 *
 * NOTHING IS STORED THAT IS NOT THE FILE THE JUDGEMENT WAS MADE FROM. Bytes are stored under the
 * cite key that cites them, and a file whose version is not the version the reading record states
 * belongs to a DIFFERENT file than the passage — storing it would put a document in the directory
 * that no judgement rests on, under a name that says one does. That is refused with the two versions,
 * and so is a read that returned another attachment, or one whose bytes do not hash to what the
 * reader said they hashed to.
 *
 * @param plan - the deployment's decision, and the reads the caller made.
 * @param files - the files written so far, which the stores are appended to.
 * @returns the manifest section, and the paths this directory stores.
 */
export function packageReferencePdfs(
  plan: ReferencePdfPlan,
  files: StagedFile[],
): RunPackageManifest['referencePdfs'] {
  // THE DEPLOYMENT'S DECISION IS THE FIRST THING THE MANIFEST SAYS. An empty `refs-pdf/` and a
  // deployment that reads no files are different facts, and a reader given a list would take the
  // second for the first.
  if (plan.policy === 'none') return 'not-stored'
  const stored: StoredReferencePdf[] = []
  const refused: RefusedReferencePdf[] = []
  const taken = new Set<string>()
  for (const read of plan.reads) {
    const name = referencePdfNameOf(read.citeKey)
    if (name === undefined) {
      refused.push({
        citeKey: read.citeKey,
        attachmentKey: read.readFrom.key,
        reason: `the cite key '${read.citeKey}' names no file this package can carry`,
      })
      continue
    }
    const path = `refs-pdf/${name}`
    const file = read.file
    if ('failure' in file) {
      // THE READER'S OWN SENTENCE. It names the attachment and the reason and never a location —
      // which is the rule the bibliography writer follows for the same reason: where this machine
      // keeps its files is not part of a package.
      refused.push({ citeKey: read.citeKey, attachmentKey: read.readFrom.key, reason: file.failure })
      continue
    }
    if (file.key !== read.readFrom.key) {
      refused.push({
        citeKey: read.citeKey,
        attachmentKey: read.readFrom.key,
        reason: `the file read for '${read.citeKey}' is attachment '${file.key}', not the`
          + ` '${read.readFrom.key}' its reading record names`,
      })
      continue
    }
    if (file.version !== read.readFrom.version) {
      refused.push({
        citeKey: read.citeKey,
        attachmentKey: read.readFrom.key,
        reason: `attachment '${read.readFrom.key}' was read at version ${file.version} and the judgement`
          + ` about '${read.citeKey}' was made from version ${read.readFrom.version}; these bytes belong`
          + ' to a different file than the passage the judgement rests on, so they are not stored',
      })
      continue
    }
    if (taken.has(path)) {
      refused.push({
        citeKey: read.citeKey,
        attachmentKey: read.readFrom.key,
        reason: `another cite key already stores a file at '${path}'`,
      })
      continue
    }
    const bytes = Buffer.from(file.base64, 'base64')
    // BOTH DIGESTS ARE OVER THE SAME BYTES, which is why they can be compared at all: the reader
    // computed its `sha256` over the bytes it returned, and the digest here is over those bytes
    // decoded — no newline is normalised, because a PDF is not text and `writePackageFiles` decodes
    // base64 rather than re-encoding it. A comparison across encodings (a text document's content vs
    // the file that lands) would need to say which side it compares; this one does not.
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (digest !== file.sha256) {
      refused.push({
        citeKey: read.citeKey,
        attachmentKey: read.readFrom.key,
        reason: `the bytes read for '${read.citeKey}' hash to ${digest} and the read states ${file.sha256}`,
      })
      continue
    }
    taken.add(path)
    files.push({ path, content: file.base64, encoding: 'base64' })
    stored.push({
      citeKey: read.citeKey,
      path,
      bytes: bytes.length,
      sha256: digest,
      attachmentKey: file.key,
      attachmentVersion: file.version,
      // WHAT THE FILE IS FOR, so a reader does not have to guess why a publisher's PDF is in a
      // package of a run's own artifacts. It is evidence for one citation and nothing else.
      purpose: `the attachment the passage cited as '${read.citeKey}' was read from; stored so the`
        + ' quotation in citations.json can be checked against the file it came from. It is a source'
        + ' the run read, not a product of the run.',
    })
  }
  return { policy: 'local-cache', stored, refused }
}

/** The manifest written as `run-manifest.json`. */
export interface RunPackageManifest {
  readonly runId: string
  /**
   * The project revision this package was exported FROM.
   *
   * A package is a reading of one state of the run. `generatedAt` says when someone read it, which
   * is not the same fact — two exports a minute apart can carry different manuscripts — and the
   * artifacts the export names are the ones this revision holds.
   */
  readonly projectRevision: number
  /**
   * When this reading was taken, ISO-8601.
   *
   * It is the actual time of the export. A package is a state plus the moment it was read, and a
   * manifest that carried a fixed value could not answer "is this the package I made after the
   * approval, or the one from the drive?" — which is the whole reason both numbers are here.
   */
  readonly generatedAt: string
  readonly files: ReadonlyArray<PackagedFile>
  /** Per-step outcome, so the package states how each product was produced. */
  readonly steps: ReadonlyArray<{
    readonly stepId: string
    readonly status: string
    readonly attemptId: number
    readonly kind: string
    readonly producer: string
    readonly outputSlugs: ReadonlyArray<string>
    readonly verdicts: Readonly<Record<string, string>>
  }>
  /** Where each numeric figure came from, so a reader can trace it. */
  readonly numberSources: Readonly<Record<string, string>>
  /**
   * The tables this package carries, each with where its two forms landed.
   *
   * TWO FORMS OF ONE TABLE, and the difference matters: the Markdown is what the paper prints, and
   * the CSV is the same table for a reader that wants to re-plot or re-check the numbers. The
   * manifest says so because a directory of files does not: `tables/table-1.csv` in a package whose
   * manifest never mentions it is a file nobody can place. A run that produced no table carries an
   * empty list, which is a fact about the run rather than a missing section.
   */
  readonly tables: ReadonlyArray<PackagedTable>
  /**
   * The reference files this package carries, or the fact that this deployment stores none.
   *
   * `'not-stored'` is the absence of the CAPABILITY, not an empty result: a deployment that reads no
   * attachment files says so here, so a reader is not left to interpret an empty `refs-pdf/`. Each
   * stored file names the attachment and that attachment's own version, which is what ties the bytes
   * to the passage a judgement about this run was made from.
   *
   * NOT A PRODUCT OF THE RUN. A reference PDF is a source the run read, carried so the quotation in
   * `citations.json` can be checked against the file it came from.
   */
  readonly referencePdfs: 'not-stored' | {
    readonly policy: 'local-cache'
    readonly stored: ReadonlyArray<StoredReferencePdf>
    readonly refused: ReadonlyArray<RefusedReferencePdf>
  }
  /**
   * The evidence profile this run was conducted under, whether that profile's evidence may ever
   * carry a submission, and whether THIS run is ready.
   *
   * Two facts, not one. `profileEligible` is what the deployment is on record as claiming;
   * `submissionReady` is what the run actually produced. A production run blocked at A1 is
   * eligible and not ready, and a manifest that collapsed them reported the first as the second.
   */
  readonly evidenceProfile: EvidenceProfile
  readonly profileEligible: boolean
  readonly submissionReady: boolean
  readonly readinessNote: string
  /**
   * Whether this package is the FINAL one or a working draft.
   *
   * `final` means every condition in {@link checks} holds: the run was conducted under the
   * production profile, finished, was approved at the version it holds, saved, and the package
   * carries every file the manuscript declares. A draft is a real package of a real run that is not
   * yet the thing to hand anyone — and the files it contains say so.
   */
  readonly state: FinalPackageState
  /** Every condition a final package must meet, with what the run recorded about it. */
  readonly checks: ReadonlyArray<FinalPackageCheck>
  /**
   * The decision that made this package final, as the run recorded it.
   *
   * Absent on a draft, and absent on a package whose approval was refused. Present means a person
   * approved THESE artifact versions: the targets are the refs frozen at the moment of the decision,
   * so a reader comparing two packages can see whether the same revision was approved.
   */
  readonly approval?: FinalPackageApproval
  /**
   * What the quality baseline found in this manuscript, and what it could not judge.
   *
   * Carried in the manifest because a package is what a reader receives: a list of files and digests
   * says nothing about whether the manuscript inside refers to its own figures or positions itself in
   * its own bibliography. The report is computed here, from the run's records and the manuscript the
   * package contains, so the package states it without anyone having to run a separate tool.
   *
   * THE COVERAGE TRAVELS WITH THE FINDINGS. An empty `findings` list is the output of a handful of
   * exact comparisons, and it reads as a verdict on the paper: `checks` says which rules could read
   * this manuscript and which could not, `needsDomainReview` says what no rule here judges, and
   * `summary` states what the report is rather than how good the paper is.
   */
  readonly quality: PaperQualityReport
  /**
   * The artifact versions this package is a reading of.
   *
   * A package describes one state of a run, and a state moves: a later step, a revision, a re-run or a
   * hand edit replaces an artifact. Recording the versions is what lets a reader — or a later export —
   * tell whether the package still describes the run, and `checks` carries the verdict when a
   * previous reading is handed in.
   */
  readonly artifactRefs: ReadonlyArray<{ readonly slug: string; readonly version: number }>
  /**
   * What the metrics in this package mean, and which of them the run's own type required.
   *
   * The registry is the deployment's declaration of each metric — its unit, which way is better, and
   * what a movement means — and the run froze the profile it was driven under, so this is READ from
   * the run rather than looked up now: a package exported after the deployment was reconfigured still
   * states the metrics its study was actually conducted under. `required: false` is NOT "missing".
   * It is a metric that belongs to another research type, and a view that collapsed the two would
   * report a literature review as failing to measure a traffic quantity it never had.
   *
   * Absent when the run recorded no profile, which a run driven without one does.
   */
  readonly declaredMetrics?: ReadonlyArray<{
    readonly key: string
    readonly unit: string
    readonly direction: string
    readonly required: boolean
    readonly interpretation: string
  }>
  readonly note: string
}

/**
 * Where each numeric figure comes from, for the paths E1 produces.
 *
 * Kept as data rather than inline in the manifest so that "not produced" can be computed against
 * what this run actually wrote, instead of being asserted about a name.
 */
const NUMBER_SOURCES: Readonly<Record<string, string>> = {
  'figure-plan.json': 'figure-plan (the plan each figure was drawn from)',
  'experiment-tables.md': 'mvp-results + baseline-results (same measurement the figures use)',
  'figures/figure-1.svg': 'mvp-results',
  'roadmap.md': 'figure-plan',
}

/**
 * Where the numbers in a table this package carries come from.
 *
 * THE SAME RECORD THE FIGURE AND THE VERDICT USE. The results table is rendered by the
 * `three-line-table` tool over the run's own measured record at D3-writing, so the path is fixed and
 * the source is the measurement — not the plan, which says which table exists rather than what is in
 * it. Stated per table rather than added to {@link NUMBER_SOURCES}, whose keys are paths the
 * exporter knows before it knows whether the run produced a table.
 */
const TABLE_NUMBER_SOURCE =
  'mvp-results + baseline-results (the same measurement the figures and the verdict use)'

/**
 * Strip anything that must not leave the process.
 *
 * Applied to every string that reaches a package file. Fields whose KEY names a secret are
 * dropped outright rather than redacted, so a reader never mistakes a placeholder for a
 * value; path separators that would disclose the machine's layout are reduced to their
 * final segment.
 *
 * @param value - any artifact value.
 * @returns a copy safe to write to disk.
 */
export function sanitizeForExport(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/[A-Za-z]:\\[^\s"']*|\/(?:home|Users)\/[^\s"']*/gu, segment => segment.split(/[\\/]/u).pop() ?? '')
  }
  if (Array.isArray(value)) return value.map(sanitizeForExport)
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/secret|token|api[-_]?key|password|credential/iu.test(key)) continue
    out[key] = sanitizeForExport(entry)
  }
  return out
}

/** Read one input artifact as a record, or undefined. */
function artifactRecord(store: ResearchRunStore, runId: string, slug: string): Record<string, unknown> | undefined {
  const value = getArtifact(store, runId, slug)
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * Render a run's cited sources as a bibliography, or nothing when it cites none.
 *
 * THE CITATIONS ARE READ FROM THE DRAFT ARTIFACT, not from the retrieval ledger: the ledger is what
 * the library returned and the citations are what the manuscript rests on, and a bibliography built
 * from the first is the search log this pipeline exists not to publish.
 *
 * NOTHING IS WRITTEN WHEN THE CHECKS REFUSE. A `.bib` that leaks a local path or omits a cited key is
 * worse than none — it looks like the file a journal accepts — so the refusal travels with the text
 * and the caller decides whether the package may be produced at all.
 *
 * @param store - the run store.
 * @param runId - the run whose citations are to be rendered.
 * @param sources - the sources this run may cite, from the registry it configured.
 * @param writer - the deployment's bibliography writer.
 * @returns the rendered text, or undefined when the run cites nothing; the refusals, when any.
 */
export async function renderBibliography(
  store: ResearchRunStore,
  runId: string,
  sources: ReadonlyMap<string, SourceRecord>,
  writer: BibliographyWriter,
): Promise<{ readonly text?: string; readonly refusals: ReadonlyArray<string> }> {
  const citations = artifactRecord(store, runId, 'manuscript')?.citations
  if (!Array.isArray(citations) || citations.length === 0) return { refusals: [] }
  const cited = bibliographyOf(citations as ReadonlyArray<CitationUse>, sources)
  const entries = referenceEntriesOf(cited.entries)
  // WRITTEN ONCE. A writer asked twice may answer twice differently — a reference manager stamps a
  // retrieval date — and the file that was checked has to be the file that is written.
  const text = await writer.write(entries)
  const refusals = [
    ...cited.unresolvable.map(ref => `the manuscript cites '${ref}', which the ${String(sources.size)}`
      + ' source(s) this run may cite do not hold'),
    ...checkBibliography(text, entries),
  ]
  return refusals.length > 0 ? { refusals } : { text, refusals: [] }
}

/**
 * The metric a run registered, as the quality baseline needs it: its name, which way is better, and
 * the measured change. Read from the run's own records — never from the manuscript's prose, which is
 * the thing being judged.
 *
 * @param baseline - the `baseline-results` artifact, when the run produced one.
 * @param claim - the `claim` artifact, whose metric key names the quantity.
 * @returns the metric, or undefined when the run measured none.
 */
function metricOf(
  baseline: Record<string, unknown> | undefined,
  claim: Record<string, unknown> | undefined,
): { readonly name: string; readonly direction: string; readonly changePct: number } | undefined {
  if (baseline === undefined) return undefined
  const metric = (baseline.baseline as { metric?: { name?: unknown; direction?: unknown } } | undefined)?.metric
  const measured = baseline.measured as { variantImprovementPct?: unknown } | undefined
  const name = typeof metric?.name === 'string' ? metric.name : claim?.metricKey
  const direction = typeof metric?.direction === 'string' ? metric.direction : undefined
  const changePct = typeof measured?.variantImprovementPct === 'number' ? measured.variantImprovementPct : undefined
  if (typeof name !== 'string' || direction === undefined || changePct === undefined) return undefined
  return { name, direction, changePct }
}

/**
 * Whether a value read back from a record is an array of records.
 *
 * A predicate rather than `Array.isArray` at each call site: that built-in narrows to `any[]` whatever
 * the value's declared type was, which would make every field read off an element an unchecked
 * `any` — on a value that came off disk.
 *
 * @param value - the value read from the record.
 * @returns whether every element is a record.
 */
function isRecordArray(value: unknown): value is ReadonlyArray<Record<string, unknown>> {
  return Array.isArray(value)
    && value.every((entry: unknown) => typeof entry === 'object' && entry !== null && !Array.isArray(entry))
}

/**
 * The metrics the run was conducted under, read from the profile it froze into its own spec.
 *
 * READ FROM THE RUN, NEVER RESOLVED NOW. The deployment's configuration can change between the run
 * and the export — that is what freezing the profile into the spec prevents — so a package that
 * looked the profile up again would describe a study under metrics its run never had. The shape is
 * checked rather than assumed because the spec is a durable record read back from disk.
 *
 * @param store - the run store.
 * @param runId - the run the package is for.
 * @returns one entry per declared metric, or undefined when the run recorded no usable profile.
 */
function declaredMetricsOf(
  store: ResearchRunStore,
  runId: string,
): RunPackageManifest['declaredMetrics'] {
  // THE STUDY'S OWN METRICS, not the research type's. The frozen profile carries the type-level view
  // (which metrics are applicable to this kind of work); with two studies of one type that view names
  // both, and a run requires only its own. The implementation id is read off the same frozen spec, so
  // a run that was configured as another study reports that study's metrics.
  const spec = getRunSnapshot(store, runId).spec
  const implementationId = (spec['studyPlan'] as { readonly implementationId?: unknown } | undefined)?.implementationId
  const metrics = typeof implementationId === 'string'
    ? metricsForStudy(implementationId)
    : (spec['researchProfile'] as { readonly metrics?: unknown } | undefined)?.metrics
  const required = isRecordArray((metrics as { required?: unknown } | undefined)?.required)
    ? (metrics as { required: ReadonlyArray<Record<string, unknown>> }).required
    : undefined
  const notApplicable = isRecordArray((metrics as { notApplicable?: unknown } | undefined)?.notApplicable)
    ? (metrics as { notApplicable: ReadonlyArray<Record<string, unknown>> }).notApplicable
    : undefined
  if (required === undefined || notApplicable === undefined) return undefined
  const declared = [
    ...required.map(definition => ({ definition, required: true })),
    ...notApplicable.map(definition => ({ definition, required: false })),
  ].flatMap(({ definition, required: isRequired }) => {
    const { key, unit, direction, interpretation } = definition
    return typeof key === 'string' && typeof unit === 'string'
      && typeof direction === 'string' && typeof interpretation === 'string'
      ? [{ key, unit, direction, required: isRequired, interpretation }]
      : []
  })
  return declared.length === 0 ? undefined : declared
}

/**
 * The artifacts a package is built from, as the run's registry holds them now.
 *
 * THE SLUGS ARE THE ONES THE EXPORT READS, listed rather than discovered: a package that recorded
 * every artifact the run holds would report a move in something it never used, and a reader chasing
 * that would be looking at a step the package does not describe.
 */
const PACKAGED_SLUGS: ReadonlyArray<string> = [
  'claim', 'landscape-map', 'method-spec', 'mvp-results', 'baseline-results',
  'figure-plan', 'manuscript', 'result-version', 'typeset',
]

/**
 * The artifact refs one package is read from, with the version each is at.
 *
 * @param store - the run store.
 * @param runId - the run.
 * @param slugs - the slugs the package reads.
 * @returns one entry per artifact the run holds, in the order given.
 */
function artifactRefsOf(
  store: ResearchRunStore,
  runId: string,
  slugs: ReadonlyArray<string>,
): ReadonlyArray<{ readonly slug: string; readonly ref: { readonly version: number; readonly contentHash: string } }> {
  const registry = getRunSnapshot(store, runId).registry
  return slugs.flatMap((slug) => {
    const record = registry[slug]
    return record === undefined
      ? []
      : [{ slug, ref: { version: record.ref.version, contentHash: String(record.ref.contentHash) } }]
  })
}

/** A JSON file body: sanitized, pretty-printed, newline-terminated. */
function jsonFile(value: unknown): string {
  return `${JSON.stringify(sanitizeForExport(value), null, 2)}\n`
}

/** A markdown file body, newline-terminated. */
function markdownFile(lines: ReadonlyArray<string>): string {
  const body = lines.join('\n').replace(/\n+$/u, '')
  return `${body}\n`
}

/** One step's recorded outcome, in the manifest's shape. */
function stepRecord(outcome: PackageStepFacts): RunPackageManifest['steps'][number] {
  return {
    stepId: outcome.stepId,
    status: outcome.status,
    attemptId: outcome.attemptId,
    kind: outcome.kind,
    producer: outcome.producer,
    outputSlugs: outcome.outputSlugs,
    verdicts: outcome.verdicts,
  }
}

/**
 * Build every file for a run's package, in memory.
 *
 * Pure with respect to the filesystem: it reads the run store and returns content. The
 * caller writes it, which is what lets a spec assert on the package without a directory.
 *
 * @param store - the run store.
 * @param run - the driven run result.
 * @param evidenceProfile - the profile the run was conducted under, which decides whether the
 *   package it produced may be submitted.
 * @param options - whether this is the final package or a working draft, and the run's last write
 *   failure when one was reported. The checks are computed here from the run's own records; the
 *   caller states only its INTENT, never whether the conditions hold.
 * @returns the files, the manifest, and the run id.
 */
export function planRunPackage(
  store: ResearchRunStore,
  run: PackageRunFacts,
  evidenceProfile: EvidenceProfile,
  options: {
    /**
     * Whether the caller is asking for the final package or a working draft.
     *
     * NOT READ HERE, and the field is kept rather than removed because the word is the same one two
     * other things use — the package's own `state`, which the checks decide, and the compile mode a
     * document is rendered in — and a reader who finds the three spelled alike should find it said
     * where they differ. This function is the READING: it reports `state` from the run's records and
     * writes whichever files the run holds. The refusal is the caller's, and it is taken in the
     * operation that makes the decision (`finalPackageRefusalOf` in `exportRunPackageNow`), so a
     * caller that passes `'final'` here and writes the files anyway has bypassed nothing that
     * mattered — what it wrote is the draft this reading says it is.
     */
    readonly mode: 'draft' | 'final'
    readonly saveError?: string
    /**
     * When this reading of the run was taken.
     *
     * Stated by the caller so a test can pin it; an export that states none is stamped with the
     * clock. It used to be the EPOCH — `new Date(0)` — which the contract above says it is not: a
     * manifest reading `1970-01-01T00:00:00.000Z` told every reader that the package was generated
     * before the study existed.
     */
    readonly generatedAt?: string
    /**
     * The artifact versions a PREVIOUS reading was taken from, when one is being compared.
     *
     * The export that wrote the package on disk knows what it read; this is how a later export says
     * which of those artifacts the run has moved past. Absent means nothing to compare against, and
     * the `artifacts-current` check then reports what the package was read from rather than a verdict
     * it cannot support.
     */
    readonly previousArtifactRefs?: ReadonlyArray<{ readonly slug: string; readonly version: number }>
    /**
     * The run's citations rendered as a bibliography file, when a deployment supplied a writer.
     *
     * RENDERED BY THE CALLER because the writer is a capability the deployment supplies, and this
     * module decides what goes IN the file rather than how a reference manager spells it. Absent when
     * no writer is configured, and the package then carries `citations.json` alone — which says what
     * the run cited without a file a journal could be handed.
     */
    readonly bibliography?: string
    /**
     * The reference files the caller read for this run, when the deployment opted into reading them.
     *
     * READ BY THE CALLER, for the same reason the bibliography is rendered by it: reading an
     * attachment is a file or a network read, and this module decides what of it a package may carry
     * rather than performing the read. Absent means the deployment reads no attachment file — there is
     * no default that reads one — and the manifest then says so.
     */
    readonly referencePdfs?: ReferencePdfPlan
  } = { mode: 'draft' },
): { readonly runId: string; readonly files: ReadonlyArray<PackageFile>; readonly manifest: RunPackageManifest } {
  const { runId } = run
  const readiness: SubmissionReadiness = readinessOfRun(store, runId, evidenceProfile)
  const typeset = artifactRecord(store, runId, 'typeset')
  const claim = artifactRecord(store, runId, 'claim')
  const landscape = artifactRecord(store, runId, 'landscape-map')
  const experiment = artifactRecord(store, runId, 'mvp-results')
  const baseline = artifactRecord(store, runId, 'baseline-results')
  const method = artifactRecord(store, runId, 'method-spec')
  const draftArtifact = artifactRecord(store, runId, 'manuscript')
  const baselineArtifact = artifactRecord(store, runId, 'baseline-results')

  const files: PackageFile[] = []

  // E1 produced these contents itself; a package without them is the old proposal again. They live on
  // the TYPESET artifact, which is what E1 renders and packages: the document itself is under
  // `manuscript` and carries no package files.
  const produced = typeset?.packageFiles
  if (produced !== null && typeof produced === 'object' && !Array.isArray(produced)) {
    for (const [path, content] of Object.entries(produced as Record<string, unknown>)) {
      if (typeof content === 'string' && content.length > 0) files.push({ path, content: `${content.replace(/\n+$/u, '')}\n` })
    }
  }
  // AND THE BYTES E1 PRODUCED: the compiled documents a journal is handed, and the figures they
  // embed. Trailing whitespace is not trimmed here — that rule is about text, and trimming base64
  // would corrupt the asset.
  // THEY LIVE WITH THE COMPILE THAT PRODUCED THEM (`compilation.documents` / `compilation.assets`):
  // they are outputs of the same step, and a second home for them would be a second thing to keep in
  // step. Both lists are written the same way — the split is about what a reader is told, not about
  // what the package holds.
  //
  // AN ENTRY WITHOUT `base64` IS A TEXT DOCUMENT AND IS SKIPPED, deliberately and not by the shape of
  // the test: `documents` carries one record per compiled document — `{format, path, bytes, sha256}`,
  // with `base64` present only for the formats that are binary — so `.tex` and `.html` appear here
  // and in `packageFiles` above, which is where their text is. Writing them from both places would
  // give one file two contents, and the digest this package records would describe whichever won.
  const compileRecord = (typeset as {
    compilation?: { documents?: unknown; assets?: unknown }
  } | undefined)?.compilation
  for (const list of [compileRecord?.documents, compileRecord?.assets]) {
    if (!Array.isArray(list)) continue
    for (const entry of list) {
      const asset = entry as { path?: unknown; base64?: unknown }
      if (typeof asset.path !== 'string' || asset.path.length === 0) continue
      if (typeof asset.base64 !== 'string') continue
      if (asset.base64.length === 0) continue
      files.push({ path: asset.path, content: asset.base64, encoding: 'base64' })
    }
  }

  files.push({ path: 'steps.json', content: jsonFile(run.steps.map(stepRecord)) })
  files.push({
    path: 'claim-evidence.json',
    content: jsonFile({
      claim: claim ?? null,
      prediction: artifactRecord(store, runId, 'falsifiable-prediction') ?? null,
      note: 'The claim and the prediction it commits to, as the A2 executor produced them.',
    }),
  })
  files.push({
    path: 'citations.json',
    content: jsonFile({
      // THE RECORDS, not the artifact that carries them. This read `landscape?.records ?? landscape`,
      // and A1's field is `hits` — so `records` never existed, the fallback always won, and the file
      // shipped the whole LABELLED artifact (`__producer`, `__kind`, `__provenance`, the corpus note)
      // under a key that says "ledger". A consumer had to know that to find a DOI, and nothing in the
      // file said so. An export that has to be read with the producer's source in hand is not an
      // export.
      ledger: landscape?.hits ?? null,
      // THE CITATIONS, BESIDE THE LIBRARY. The ledger above is what the retrieval returned and this is
      // what the paper rests on: per cite key, the statement it was made for, the passage that was read
      // and where, and the reviewed judgement about what that passage establishes. Both belong in the
      // file, because the difference between them is the difference between a search log and a
      // bibliography — and a reader who has only the ledger cannot tell which entries the manuscript
      // actually cites.
      citations: draftArtifact?.citations ?? null,
      note: 'Retrieved records as they appear on the A1 artifact. `citations` is what the manuscript cites,'
        + ' and a key in it names the passage the judgement was made on.',
    }),
  })
  // THE SAME CITATIONS AS A FILE A REFERENCE MANAGER READS. `citations.json` above is what a reader
  // inspects; this is what a submission portal accepts, and the two are rendered from one set of
  // cited sources — the previous export produced only the first, so "the manuscript cites these
  // works" could not be handed to anything.
  if (options.bibliography !== undefined && options.bibliography.trim() !== '') {
    // WRITTEN AS THE WRITER RENDERED IT. The trailing-newline rule belongs to the writer — it is where
    // the text is produced — and normalizing it here as well would leave two places that have to agree
    // about the ending of a file neither of them owns.
    files.push({ path: 'bibliography.bib', content: options.bibliography })
  }
  files.push({
    // WHAT THE FIGURES WERE DRAWN FROM. The presentation plan states the question each figure answers,
    // the record its values came from and the canvas it was drawn on; with the rendered file and the
    // measured values this package already carries, the figure is reproducible rather than merely
    // present — and a reader can see which float the compile could not embed.
    path: 'figure-plan.json',
    content: jsonFile({
      plan: artifactRecord(store, runId, 'figure-plan') ?? null,
      note: 'The figures this package carries, the question each answers, and the record its values'
        + ' came from. `compilation` on the typeset artifact names the floats a compiled document'
        + ' could not embed.',
    }),
  })
  files.push({
    path: 'experiment.json',
    content: jsonFile({
      method: method ?? null,
      baseline: baseline ?? null,
      variant: experiment ?? null,
      note: 'The configuration and the measurements the results table and the figures were both built from.',
    }),
  })
  files.push({
    path: 'reproducibility.md',
    content: markdownFile([
      '# Reproducibility',
      '',
      'The run is deterministic: the same inputs and the same executor registry produce the same',
      'artifacts. The steps below are the ones whose products carry measurements.',
      '',
      ...run.steps
        .filter(s => s.kind !== 'humanGate')
        .map(s => `- \`${s.stepId}\` — ${s.kind} via ${s.producer}`),
      '',
      'Session audit entries for each step are in the run log; this package does not duplicate them.',
    ]),
  })

  // THE TABLES THE PAPER PRINTS, AS THEIR OWN FILES. The document carries them as blocks, and a
  // package that carries the whole document and no table is one where a reader wanting the numbers
  // has to find them in Markdown prose.
  const tables = packagedTablesOf(draftArtifact?.document, files)
  // THE REFERENCE FILES, WHEN THE DEPLOYMENT READS THEM. Planned here rather than by the caller
  // because this module decides what a package may carry: the caller hands back what it read, and
  // the version each file must agree with is checked below.
  const referencePdfs = packageReferencePdfs(options.referencePdfs ?? { policy: 'none' }, files)

  const written = new Set(files.map(file => file.path))
  // THE ARTIFACT VERSIONS THIS PACKAGE IS A READING OF. Recorded from the run's registry at plan
  // time, so a reader — and the `artifacts-current` check below — can tell whether the run has moved
  // past the state this package describes.
  const artifactRefs = artifactRefsOf(store, runId, PACKAGED_SLUGS)
  // WHAT MOVED SINCE THE PREVIOUS READING. A slug the previous package named whose version is not
  // the version the run holds now has changed under that package's feet.
  const movedSince = (options.previousArtifactRefs ?? []).flatMap((previous) => {
    const current = artifactRefs.find(entry => entry.slug === previous.slug)
    return current === undefined || current.ref.version !== previous.version ? [previous.slug] : []
  })
  // The paths this package WILL carry: the files written so far plus the summary, which is built
  // below because its text states the state these checks decide.
  const facts = finalPackageFactsOf(
    store, runId, evidenceProfile, [...written, 'run-summary.md'],
    options.saveError,
    { read: artifactRefs.map(entry => `${entry.slug}@${entry.ref.version}`), moved: movedSince },
  )
  const checks = checkFinalPackage(facts)
  const state = finalPackageStateOf(checks)
  const approval = finalPackageApprovalOf(facts.approval)
  files.unshift({
    path: 'run-summary.md',
    content: markdownFile([
      '# Run summary',
      '',
      `- runId: \`${runId}\``,
      `- steps driven: ${run.steps.length} of 16`,
      `- final status: \`${run.steps[run.steps.length - 1]?.status ?? 'none'}\``,
      `- evidence profile: \`${evidenceProfile}\``,
      `- evidence eligible: ${readiness.profileEligible ? 'yes' : 'NO'}`,
      `- submission ready: ${readiness.ready ? 'yes' : '**NO**'}`,
      `- package state: \`${state}\`${state === 'final' ? '' : ' — A WORKING DRAFT, not for submission'}`,
      '',
      '## What this package is',
      '',
      'Artifacts of a synthetic research run. The pipeline, its tool calls, its gates and its',
      'session log are real; the measurements are the study\'s own deterministic simulation over a',
      'measured demand profile. Nothing here is a published result.',
      '',
      readiness.reason,
      '',
      '## Step outcomes',
      '',
      '| step | status | attempt | channel | producer |',
      '|---|---|---|---|---|',
      ...run.steps.map(s => `| ${s.stepId} | ${s.status} | ${s.attemptId} | ${s.kind} | ${s.producer} |`),
    ]),
  })

  // THE BASELINE RUNS WHERE THE PACKAGE IS BUILT, which is the one place that holds the manuscript,
  // the objects it carries and the metric the run registered, all at once.
  const metric = metricOf(baselineArtifact, claim)
  const quality = reportPaperQuality({
    sections: Array.isArray(draftArtifact?.sections)
      ? (draftArtifact.sections as ReadonlyArray<{ id: string; heading: string; bodyText: string }>)
      : [],
    crossReferences: {
      cited: (typeset?.crossReferences as { cited?: ReadonlyArray<string> } | undefined)?.cited ?? [],
      uncited: (typeset?.crossReferences as { uncited?: ReadonlyArray<string> } | undefined)?.uncited ?? [],
    },
    floatsNotRendered: (typeset?.floatsNotRendered as ReadonlyArray<string> | undefined) ?? [],
    referenceCount: (typeset?.manuscriptCounts as { references?: number } | undefined)?.references ?? 0,
    // WHAT THE RUN HELD TO CITE, read from the run's own record by the same function the package's
    // conditions read — see `citationFactsOf`. Zero for a run that had nothing, which is what keeps
    // the rule from firing on a study with no literature rather than on one whose sources never
    // reached the writer.
    sourcesHeld: citationFactsOf(store, runId).held,
    ...(metric === undefined ? {} : { metric }),
  })

  const declaredMetrics = declaredMetricsOf(store, runId)

  const manifest: RunPackageManifest = {
    runId,
    // Read from the RUN, not derived from the files: the revision is what the artifacts in this
    // package belong to, and a reader comparing two packages needs it to tell whether they read
    // the same study or two states of it.
    projectRevision: getRunSnapshot(store, runId).revision,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    files: [],
    steps: run.steps.map(stepRecord),
    // Only paths that are IN this package. A run that stopped before E1 has no tables, no figure
    // and no roadmap, and naming their sources anyway is the same defect this exporter replaced in
    // E1's artifact — a list of files that reads as run output while nothing wrote them. A path
    // whose producer did not run is reported as not produced, not silently omitted.
    numberSources: Object.fromEntries([
      ...Object.entries(NUMBER_SOURCES).map(([path, source]): [string, string] =>
        [path, written.has(path) ? source : 'NOT PRODUCED by this run']),
      // THE TABLE'S OWN NUMBERS, by the path this package gave the table rather than by a name the
      // plan assumed. The figure plan numbers its floats and the results table prints the run's own
      // measurement, so a reader tracing a number in the CSV lands on the same record the figure and
      // the verdict rest on.
      ...tables.flatMap((table): Array<[string, string]> => [
        [table.markdown, TABLE_NUMBER_SOURCE],
        [table.csv, TABLE_NUMBER_SOURCE],
      ]),
    ]),
    tables,
    referencePdfs,
    evidenceProfile,
    profileEligible: readiness.profileEligible,
    submissionReady: readiness.ready,
    readinessNote: readiness.reason,
    state,
    checks,
    ...(approval === undefined ? {} : { approval }),
    quality,
    artifactRefs: artifactRefs.map(entry => ({ slug: entry.slug, version: entry.ref.version })),
    ...(declaredMetrics === undefined ? {} : { declaredMetrics }),
    note:
      'Paths are relative to this package root. `sha256` is over the written bytes. The manifest '
      + 'records no absolute directory and no credential. `state` is `final` only when every entry '
      + 'in `checks` holds, and an `approval` names the artifact versions a person decided on.',
  }

  return { runId, files, manifest }
}

/**
 * The artifact versions the package already on disk was read from, when there is one.
 *
 * A RE-EXPORT OVER A MOVED RUN IS THE CASE THIS EXISTS FOR: an operator asks for the final package,
 * the run has moved since the last export, and the manifest that lands should say which artifacts
 * moved rather than describing the current state as though nothing had. A directory with no manifest
 * — or one written by another tool — yields nothing, and the check then reports what this package was
 * read from rather than a comparison it cannot make.
 *
 * @param directory - the directory the package is written to.
 * @returns the previous reading's refs, or an empty list.
 */
export function previousArtifactRefsOf(
  directory: string,
): ReadonlyArray<{ readonly slug: string; readonly version: number }> {
  const manifestPath = join(directory, 'run-manifest.json')
  if (!existsSync(manifestPath)) return []
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { artifactRefs?: unknown }
    const refs = parsed.artifactRefs
    if (!Array.isArray(refs)) return []
    return refs.flatMap((entry) => {
      const value = entry as { slug?: unknown; version?: unknown }
      return typeof value.slug === 'string' && typeof value.version === 'number'
        ? [{ slug: value.slug, version: value.version }]
        : []
    })
  } catch {
    // A manifest this reader cannot parse is not a comparison it can make: the export proceeds and
    // the check reports what this package was read from. The alternative — refusing to export
    // because an older file is damaged — would take away the remedy.
    return []
  }
}

/**
 * Read the step table a package records, off the run as it stands now.
 *
 * The kinds come from the executor registry — the declared identity, which a package exported BEFORE
 * a step runs states as well as one exported after — rather than from a drive result, so a package
 * exported AFTER the drive (an operator asking for the final one) states the same table a package
 * exported at the end of the drive does. A step the registry does not know is reported as such
 * instead of being given a kind it did not run under.
 *
 * THE PRODUCER IS READ OFF THE STEP'S OWN COMMITTED ARTIFACTS, because for D3-writing it is not the
 * declared brand: the entry names the `three-line-table` capability the step executes, while the
 * manuscript records the channel that wrote the prose, and a run whose draft came from a configured
 * model used to be exported as a table rendered by a tool. The values are taken from the STEP, never
 * from the registry's slug, which keeps only the latest value: `manuscript` is republished by D4, E1
 * and an acceptance, so reading it by slug would report D3's row with a later step's producer.
 *
 * @param store - the run store.
 * @param runId - the run to read.
 * @returns one entry per step the pipeline declares, in pipeline order.
 */
export function packageRunFactsOf(store: ResearchRunStore, runId: string): PackageRunFacts {
  const snapshot = getRunSnapshot(store, runId)
  return {
    runId,
    steps: getStepDefinitions().map((definition) => {
      const state = snapshot.steps[definition.id]
      const entry = STEP_EXECUTOR_REGISTRY.get(definition.id)
      const committed = definition.outputs.map(slug => state?.artifacts[slug])
      return {
        stepId: definition.id,
        status: state?.status ?? 'pending',
        attemptId: state?.attemptId ?? 0,
        kind: entry?.kind ?? 'unknown',
        producer: entry === undefined ? 'unknown' : stepProducerOf(entry, committed),
        outputSlugs: [...(state?.outputs ?? [])],
        // THE DISCRIMINANT, not the verdict object: the manifest's audit table records what each
        // component decided (`passed` / `blocked` / `failed` / `abstained`), and a table of
        // `[object Object]` would name nothing a reader could act on.
        verdicts: Object.fromEntries(
          Object.entries(state?.gateResults ?? {}).map(([component, verdict]) => [component, verdict.outcome]),
        ),
      }
    }),
  }
}

/**
 * Write a package plan to disk, and publish it only once it is complete.
 *
 * STAGED, VERIFIED, THEN SWAPPED IN, which is now the shared discipline every directory this package
 * publishes uses — see `staged-directory.ts` for why the two callers cannot each have their own copy
 * of it. The manifest is written LAST, so a manifest that exists means the files it names were
 * written.
 *
 * @param plan - the files and manifest to write.
 * @param directory - the package root; created when absent, replaced when it is already there.
 * @returns the manifest, with every file's byte count and digest filled in.
 * @throws {Error} when a written file is empty, when the staged package does not verify, or when the
 *   swap itself fails — in which case the previous package is put back.
 */
export function writeRunPackage(
  plan: { readonly files: ReadonlyArray<PackageFile>; readonly manifest: RunPackageManifest },
  directory: string,
): RunPackageManifest {
  return writeStagedDirectory({
    files: plan.files,
    manifestName: 'run-manifest.json',
    manifest: (files) => {
      const manifest: RunPackageManifest = { ...plan.manifest, files }
      return { value: manifest, text: jsonFile(manifest) }
    },
  }, directory).manifest
}

/** One file's state against what a manifest says about it. */
export type PackagedFileCheck = WrittenFileCheck

/**
 * Compare a written package on disk with the manifest that names it.
 *
 * WHY THIS IS CODE AND NOT A READING DISCIPLINE. A manifest lists byte counts and digests, and a
 * package is only what it says it is while those still hold — a file edited, a file dropped when the
 * directory was copied somewhere tidier, or a manifest carried beside files from another export all
 * produce a directory that READS like a package and verifies as nothing. One pass over the manifest
 * makes "verify this package" one call rather than a habit.
 *
 * A file whose bytes differ but whose length matches is reported as a DIGEST difference and never as
 * ok: the byte count is the cheap check, and the digest is the one that means something.
 *
 * @param directory - the package root.
 * @param manifest - the manifest as it stands; its `files` are the entries checked.
 * @returns one entry per manifest entry, in the manifest's order.
 */
export function checkPackagedFiles(
  directory: string,
  manifest: Pick<RunPackageManifest, 'files'>,
): ReadonlyArray<PackagedFileCheck> {
  return checkWrittenFiles(directory, manifest.files)
}

/**
 * The audit entries recorded for one step, as package metadata.
 *
 * @param store - the run store.
 * @param runId - the run to read.
 * @param stepId - the step whose audit trail is wanted.
 * @returns the entries, sanitized.
 */
export function stepAudit(store: ResearchRunStore, runId: string, stepId: string): unknown {
  return sanitizeForExport(getAuditHistory(store, runId, stepId))
}
