// @deepseek-ai/dsh-research-team — the run's working directory: one document, on disk, at every step.
//
// WHY THIS EXISTS. Until this module, nothing in the pipeline touched disk until export. The
// document was a value in the artifact registry and the files a reader wants — the `.docx` a journal
// takes, the `.tex` a person edits, the figures it embeds — were written once, at the end, into a
// package nobody was expected to edit. A person who wanted to fix a sentence had no file to fix, and
// a person who fixed one had no way to hand it back.
//
// THE REGISTRY IS THE AUTHORITY; THIS DIRECTORY IS A PROJECTION OF IT. Every file here is built from
// `getRunSnapshot(store).registry` — the run's own record of what each step committed — and never
// from an executor's return value, so the directory cannot describe a value a commit refused. The
// projection is written after each successful commit and it is REPLACED WHOLE each time: a document
// that moved leaves no file from the version before it.
//
// WHAT THE MANIFEST IS FOR. `document-manifest.json` names the version of the document the directory
// projects (`manuscriptRef`), the rendering the compiled files came from (`renderedFrom`), the digest
// of the projected Markdown (`documentHash`), and every file with its byte count and digest. Its
// `files` entries are the SAME shape the run package's manifest uses, so a directory that drifted is
// detected by the same comparison (`staged-directory.ts`'s `checkWrittenFiles`) rather than by a
// second one written here.
//
// TWO DRIFT FACTS, AND THEY ARE DIFFERENT. A file edited, truncated or deleted on disk is a fact
// about the directory; the run having moved past the version the directory projects is a fact about
// the RUN, and no file on disk records it. {@link manuscriptDirectoryDrift} reports both, separately,
// because the remedies are different: the first is a re-projection, the second is a re-render.
//
// WHAT IS NOT HERE. The self-contained HTML preview is not projected: the layout names the documents
// a person edits and a journal takes. The directory is one run's, under `<root>/<runId>/`, for the
// same reason the package directory is — two runs in one directory is a manifest beside files nobody
// can attribute.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getArtifact, getRunSnapshot } from '@deepseek-ai/dsh-research-core'
import type { ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { packagedTablesOf, packageReferencePdfs, sanitizeForExport } from './package-export.ts'
import type { PackagedTable, ReferencePdfPlan, RunPackageManifest } from './package-export.ts'
import { figurePathOf, renderDocumentMarkdown } from './document-compile.ts'
import type { ManuscriptDocument } from './document-compile.ts'
import { checkWrittenFiles, writeStagedDirectory } from './staged-directory.ts'
import type { StagedFile, WrittenFile, WrittenFileCheck } from './staged-directory.ts'

/** The manifest this directory writes, at its root. */
export const DOCUMENT_MANIFEST_FILE = 'document-manifest.json'

/**
 * The files the directory holds, by the path the projection gives them.
 *
 * NAMED RATHER THAN DISCOVERED. A directory that carried whatever the typeset artifact happened to
 * produce would gain a file the day a compiler gained a format, and a person editing it would have
 * no list to check against. These are the documents a person edits and the assets they carry; the
 * manifest's `files` is the record of which of them the run actually has.
 */
export const MANUSCRIPT_DIRECTORY_FILES = {
  /** The assembled manuscript, as the run's own assembler rendered it. */
  markdown: 'manuscript.md',
  docx: 'manuscript.docx',
  latex: 'manuscript.tex',
  pdf: 'manuscript.pdf',
  /** Where a rendered figure's SVG lands: `figures/<label>.svg`. */
  figures: 'figures/',
  /** Where a compiled document's raster lands: `assets/<label>.png`. */
  assets: 'assets/',
} as const

/** A reference, as the run's registry holds it: which version, and the hash of its value. */
export interface ProjectedRef {
  readonly version: number
  readonly contentHash: string
}

/**
 * The manifest `document-manifest.json` carries.
 *
 * THREE FACTS ABOUT WHICH TEXT THIS DIRECTORY HOLDS, and none of them substitutes for another:
 * `manuscriptRef` is the version of the document the projection read, `renderedFrom` is the version
 * of the typeset form the compiled files were rendered by, and `documentHash` is the digest of the
 * Markdown as it landed. A directory whose `renderedFrom` is behind its `manuscriptRef` holds a
 * `.docx` of a document the run has left behind — which is exactly the state a re-render repairs.
 */
export interface DocumentManifest {
  readonly runId: string
  /** The document version this directory projects, or null when the run holds no document yet. */
  readonly manuscriptRef: ProjectedRef | null
  /** SHA-256 of `manuscript.md` as written, or null when this directory holds no Markdown. */
  readonly documentHash: string | null
  /**
   * The typeset form the compiled files were rendered by, or null when nothing was compiled.
   *
   * A RENDER IS NOT A VERSION OF THE DOCUMENT. The `.docx` in this directory was produced by one
   * typeset run over one version of the document; when a later step republishes the document, the
   * `.docx` does not change by itself and this field is how a reader can tell.
   */
  readonly renderedFrom: ProjectedRef | null
  /** When this projection was taken, ISO-8601. */
  readonly projectedAt: string
  /** Every file here, with its byte count and digest — the shape the package manifest already uses. */
  readonly files: ReadonlyArray<WrittenFile>
  readonly tables: ReadonlyArray<PackagedTable>
  readonly referencePdfs: RunPackageManifest['referencePdfs']
  readonly note: string
}

/** What one projection produced: the files to write and the manifest naming them. */
export interface ManuscriptDirectoryPlan {
  readonly runId: string
  readonly files: ReadonlyArray<StagedFile>
  readonly manifest: DocumentManifest
}

/**
 * Read one field as a record, or undefined.
 *
 * @param value - the field as the artifact carries it.
 * @returns it as a record, or undefined when it is not one.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * One artifact's value, or undefined when the run records none.
 *
 * @param store - the run store.
 * @param runId - the run to read.
 * @param slug - the artifact slug.
 * @returns the value, or undefined.
 */
function valueOf(store: ResearchRunStore, runId: string, slug: string): Record<string, unknown> | undefined {
  return asRecord(getArtifact(store, runId, slug))
}

/** A JSON file body: sanitized, pretty-printed, newline-terminated. */
function jsonFile(value: unknown): string {
  return `${JSON.stringify(sanitizeForExport(value), null, 2)}\n`
}

/** A text file body with exactly one trailing newline, which is the rule every text file here follows. */
function textFile(content: string): string {
  return `${content.replace(/\n+$/u, '')}\n`
}

/**
 * The text files the typeset form produced, keyed by the path each is written under.
 *
 * ONLY THE LATEX, and only here. The typeset form's `packageFiles` also carries the assembled
 * Markdown, the rendered figures, the self-contained HTML preview, the roadmap source and the table
 * tool's own rendering — and the first two of those are projected from the DOCUMENT, which is the
 * version the directory names. Carrying them from both places would give one path two contents and
 * the manifest would digest whichever landed last.
 *
 * @param typeset - the typeset artifact's value, or undefined when the run holds none.
 * @returns the paths and contents, in the artifact's own order.
 */
function textDocumentsOf(typeset: Record<string, unknown> | undefined): ReadonlyArray<[string, string]> {
  const produced = asRecord(typeset?.['packageFiles'])
  if (produced === undefined) return []
  return Object.entries(produced).flatMap(([path, content]): ReadonlyArray<[string, string]> => {
    if (typeof content !== 'string' || content.length === 0) return []
    return isProjectedPath(path) ? [[path, textFile(content)]] : []
  })
}

/**
 * Whether a path from the typeset form belongs in this directory.
 *
 * The LaTeX is the one text document a COMPILE produces that a person edits; the Markdown and the
 * figures are projected from the document itself, and everything else the typeset form carries is a
 * package file.
 *
 * @param path - the path the typeset form gave the file.
 * @returns whether this directory holds it.
 */
function isProjectedPath(path: string): boolean {
  return path === MANUSCRIPT_DIRECTORY_FILES.latex
}

/**
 * The compiled documents the typeset form holds as BYTES, keyed by path.
 *
 * AN ENTRY WITHOUT `base64` IS A TEXT DOCUMENT and is taken from `packageFiles` instead: `documents`
 * carries one record per compiled document, with `base64` present only for the formats that are
 * binary, and writing `.tex` from both places would give one file two contents.
 *
 * @param typeset - the typeset artifact's value, or undefined when the run holds none.
 * @returns the paths and base64 contents, in the compile's own order.
 */
function binaryDocumentsOf(typeset: Record<string, unknown> | undefined): ReadonlyArray<[string, string]> {
  const compilation = asRecord(typeset?.['compilation'])
  const documents = compilation?.['documents']
  if (!Array.isArray(documents)) return []
  return documents.flatMap((entry): ReadonlyArray<[string, string]> => {
    const record = asRecord(entry)
    const path = record?.['path']
    const base64 = record?.['base64']
    if (typeof path !== 'string' || typeof base64 !== 'string' || base64.length === 0) return []
    return isBinaryDocumentPath(path) ? [[path, base64]] : []
  })
}

/**
 * Whether a compiled document is one this directory holds as bytes.
 *
 * PDF IS HERE ONLY WHEN THE COMPILE PRODUCED ONE. A deployment without a LaTeX engine never offers
 * the format, so its absence is the deployment's own declaration rather than a file that went
 * missing; the manifest's `files` is what states which of the three the run has.
 *
 * @param path - the path the compile gave the document.
 * @returns whether this directory holds it.
 */
function isBinaryDocumentPath(path: string): boolean {
  return path === MANUSCRIPT_DIRECTORY_FILES.docx || path === MANUSCRIPT_DIRECTORY_FILES.pdf
}

/**
 * Build every file for a run's working directory, in memory.
 *
 * PURE WITH RESPECT TO THE FILESYSTEM, like `planRunPackage`: it reads the run store and returns
 * content. READING THE REGISTRY AND NOT THE VALUES is what makes the projection a statement about
 * what the run committed — a slug the registry does not hold contributes no file, however the caller
 * came by a value for it.
 *
 * @param store - the run store, as the driver holds it after a commit.
 * @param runId - the run whose document is projected.
 * @param options - the reference files the caller read, and the clock a test pins.
 * @returns the files and the manifest that names them.
 */
export function planManuscriptDirectory(
  store: ResearchRunStore,
  runId: string,
  options: {
    /**
     * The reference files the caller read for this run, when the deployment opted into reading them.
     *
     * READ BY THE CALLER, for the same reason the package's is: reading an attachment is a file or a
     * network read, and this module decides what the directory may carry rather than performing the
     * read. Absent means the deployment reads no attachment file.
     */
    readonly referencePdfs?: ReferencePdfPlan
    /** When this projection was taken; stated by the caller so a test can pin it. */
    readonly projectedAt?: string
  } = {},
): ManuscriptDirectoryPlan {
  const snapshot = getRunSnapshot(store, runId)
  const documentRef = refOf(snapshot.registry['manuscript']?.ref)
  const typesetRef = refOf(snapshot.registry['typeset']?.ref)
  const typeset = snapshot.registry['typeset'] === undefined ? undefined : valueOf(store, runId, 'typeset')
  const manuscript = snapshot.registry['manuscript'] === undefined ? undefined : valueOf(store, runId, 'manuscript')
  const document = manuscript?.['document']

  const files: StagedFile[] = []
  // THE DOCUMENT ITSELF, rendered by the module that owns the model. A run that has written its
  // document has a Markdown file here from that step onward, which is what makes the directory
  // something a person can edit before the run has finished.
  const markdown = hasSections(document) ? renderDocumentMarkdown(document) : undefined
  if (markdown !== undefined) files.push({ path: MANUSCRIPT_DIRECTORY_FILES.markdown, content: markdown })
  for (const file of figureFilesOf(document)) files.push(file)
  // THE COMPILED DELIVERABLES, WHEN THE RUN HAS BEEN TYPESET. The LaTeX is text and lives on the
  // typeset form; the DOCX and the PDF are bytes and live with the compile that produced them.
  for (const [path, content] of textDocumentsOf(typeset)) files.push({ path, content })
  for (const [path, content] of binaryDocumentsOf(typeset)) files.push({ path, content, encoding: 'base64' })
  // THE TABLES THE PAPER PRINTS, read out of the block the DOCUMENT holds rather than re-derived from
  // the run's measurements.
  const tables = packagedTablesOf(document, files)
  const referencePdfs = packageReferencePdfs(options.referencePdfs ?? { policy: 'none' }, files)

  const manifest: DocumentManifest = {
    runId,
    manuscriptRef: documentRef,
    documentHash: markdown === undefined ? null : sha256Of(markdown),
    renderedFrom: typesetRef,
    projectedAt: options.projectedAt ?? new Date().toISOString(),
    // FILLED IN BY THE WRITER, which is what makes the manifest name what landed rather than what
    // this function hoped would land.
    files: [],
    tables,
    referencePdfs,
    note:
      'This directory is a PROJECTION of the run\'s artifact registry, written after each step that'
      + ' committed. `manuscriptRef` is the document version it projects and `renderedFrom` the'
      + ' rendering the compiled files came from; a `renderedFrom` behind `manuscriptRef` means the'
      + ' .docx and .pdf here are of a document the run has left behind. Every entry in `files` is'
      + ' the file\'s byte count and SHA-256 as written. Editing a file here does not change the run:'
      + ' hand it back through the import operation, which publishes a new version.',
  }
  return { runId, files, manifest }
}

/** Whether a value carries what a document model needs to be rendered. */
function hasSections(document: unknown): document is ManuscriptDocument {
  return document !== null && typeof document === 'object'
    && Array.isArray((document as { readonly sections?: unknown }).sections)
    && typeof (document as { readonly title?: unknown }).title === 'string'
}

/** The path a float's raster is written to: `assets/<label>.png`. */
function rasterPathOf(label: string): string {
  return `assets/${figurePathOf(label).slice('figures/'.length, -'.svg'.length)}.png`
}

/**
 * The rendered floats and their rasters, as the files the directory holds.
 *
 * READ OUT OF THE DOCUMENT, NOT OUT OF THE TYPESET FORM. A figure's SVG and the raster the same tool
 * drew are both blocks of the document the writing steps approved, so a figure is projected from the
 * version of the document the directory names rather than from whatever the last compile happened to
 * embed. The paths are the ones the document's own renderer links to.
 *
 * @param document - the manuscript's `document` value, as the artifact carries it.
 * @returns one entry per float that carries a rendering, in the document's own order.
 */
function figureFilesOf(document: unknown): ReadonlyArray<StagedFile> {
  const sections = (document as { readonly sections?: unknown } | undefined)?.sections
  if (!Array.isArray(sections)) return []
  return sections.flatMap((section): ReadonlyArray<StagedFile> => {
    const blocks = (section as { readonly blocks?: unknown }).blocks
    if (!Array.isArray(blocks)) return []
    return blocks.flatMap((block): ReadonlyArray<StagedFile> => {
      const entry = block as {
        readonly kind?: unknown
        readonly label?: unknown
        readonly svg?: unknown
        readonly pngBase64?: unknown
      }
      if (entry.kind !== 'figure' || typeof entry.label !== 'string' || typeof entry.svg !== 'string') return []
      const files: StagedFile[] = []
      if (entry.svg.length > 0) files.push({ path: figurePathOf(entry.label), content: entry.svg })
      // THE RASTER, WHEN THE TOOL DREW ONE. A LaTeX engine cannot embed an SVG, so the same render
      // produces both; a figure without a raster is one LaTeX cannot carry, and its absence is a fact
      // the compile already records.
      if (typeof entry.pngBase64 === 'string' && entry.pngBase64.length > 0) {
        files.push({ path: rasterPathOf(entry.label), content: entry.pngBase64, encoding: 'base64' })
      }
      return files
    })
  })
}

/** The registry reference as this module states it, or null when the run holds no such artifact. */
function refOf(ref: { readonly version: number; readonly contentHash: string } | undefined): ProjectedRef | null {
  return ref === undefined ? null : { version: ref.version, contentHash: ref.contentHash }
}

/** SHA-256 of a text file's bytes, lower-case hex. */
function sha256Of(content: string): string {
  return createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex')
}

/**
 * Write one run's working directory, replacing whatever was there.
 *
 * THE STAGED WRITE THE PACKAGE USES, for the same reason: a half-written directory is
 * indistinguishable from a finished one, and the person editing a file has to be able to trust the
 * one that is there. The manifest is written last, so a manifest that exists means the files it
 * names were written.
 *
 * @param plan - the files and manifest to write.
 * @param root - the deployment's configured root; the run's own directory is created under it.
 * @returns the manifest as written, with every file's byte count and digest filled in.
 * @throws {Error} when a written file is empty or the staged directory does not verify.
 */
export function writeManuscriptDirectory(
  plan: ManuscriptDirectoryPlan,
  root: string,
): DocumentManifest {
  return writeStagedDirectory({
    files: plan.files,
    manifestName: DOCUMENT_MANIFEST_FILE,
    manifest: (files) => {
      const manifest: DocumentManifest = { ...plan.manifest, files }
      return { value: manifest, text: jsonFile(manifest) }
    },
  }, join(root, plan.runId)).manifest
}

/**
 * The document manifest a run's working directory holds, when it holds one.
 *
 * A directory with no manifest — never projected, or written by another tool — yields null rather
 * than a refusal: what a caller does about that is its own decision, and the two callers here state
 * different things about it.
 *
 * @param directory - the run's working directory.
 * @returns the manifest, or null when there is none this reader can use.
 */
export function readDocumentManifest(directory: string): DocumentManifest | null {
  const path = join(directory, DOCUMENT_MANIFEST_FILE)
  if (!existsSync(path)) return null
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const record = asRecord(parsed)
    const runId = record?.['runId']
    const files = record?.['files']
    if (record === undefined || typeof runId !== 'string' || !Array.isArray(files)) return null
    return {
      runId,
      manuscriptRef: projectedRefOf(record['manuscriptRef']),
      documentHash: typeof record['documentHash'] === 'string' ? record['documentHash'] : null,
      renderedFrom: projectedRefOf(record['renderedFrom']),
      projectedAt: typeof record['projectedAt'] === 'string' ? record['projectedAt'] : '',
      files: files.flatMap((entry): ReadonlyArray<WrittenFile> => {
        const file = asRecord(entry)
        const path_ = file?.['path']
        const bytes = file?.['bytes']
        const sha256 = file?.['sha256']
        return typeof path_ === 'string' && typeof bytes === 'number' && typeof sha256 === 'string'
          ? [{ path: path_, bytes, sha256 }]
          : []
      }),
      tables: Array.isArray(record['tables']) ? (record['tables'] as ReadonlyArray<PackagedTable>) : [],
      referencePdfs: (record['referencePdfs'] ?? 'not-stored') as RunPackageManifest['referencePdfs'],
      note: typeof record['note'] === 'string' ? record['note'] : '',
    }
  } catch {
    // A manifest this reader cannot parse is not one it can report drift against: the callers state
    // that as "this directory projects nothing this build can read", which is the truth about it.
    return null
  }
}

/** One projected reference read back off a manifest, or null. */
function projectedRefOf(value: unknown): ProjectedRef | null {
  const record = asRecord(value)
  const version = record?.['version']
  const contentHash = record?.['contentHash']
  return typeof version === 'number' && typeof contentHash === 'string' ? { version, contentHash } : null
}

/** The two ways a working directory stops being what its manifest says it is. */
export interface ManuscriptDirectoryDrift {
  /** Every manifest entry's state on disk, in the manifest's order. */
  readonly files: ReadonlyArray<WrittenFileCheck>
  /**
   * The paths that are not what the manifest recorded — edited, truncated or gone.
   *
   * A FACT ABOUT THE DIRECTORY. The remedy is a re-projection: the run's document has not changed,
   * the copy on disk has.
   */
  readonly edited: ReadonlyArray<string>
  /**
   * Whether the run holds a document version this directory does not project.
   *
   * A FACT ABOUT THE RUN, and no file on disk records it: the projection was taken at one version
   * and a later step republished the document, so the `.docx` and the `.pdf` here are renders of a
   * document the run has left behind. The remedy is a re-render, not a re-projection.
   */
  readonly runMoved: boolean
  /** The document version the directory projects, or null when it projects none. */
  readonly projectedVersion: number | null
  /** The document version the run holds now, or null when it holds none. */
  readonly currentVersion: number | null
}

/**
 * Compare a run's working directory with the run as it stands now.
 *
 * BOTH FACTS, SEPARATELY. The checks on disk come from the same comparison the package verifies with
 * — this manifest's `files` has the shape that comparison takes — and the version comparison reads
 * the registry, which is where the run's own statement of its document lives. A caller that folded
 * them into one "stale" would send a reader to re-render a directory whose files are also edited.
 *
 * @param directory - the run's working directory.
 * @param manifest - the manifest read from it.
 * @param current - the document version the run's registry holds now.
 * @returns the drift, with each fact stated whether or not the other holds.
 */
export function manuscriptDirectoryDrift(
  directory: string,
  manifest: DocumentManifest,
  current: { readonly manuscriptVersion: number | null },
): ManuscriptDirectoryDrift {
  const files = checkWrittenFiles(directory, manifest.files)
  return {
    files,
    edited: files.filter(check => check.status !== 'ok').map(check => check.path),
    runMoved: manifest.manuscriptRef !== null
      && manifest.manuscriptRef.version !== current.manuscriptVersion,
    projectedVersion: manifest.manuscriptRef?.version ?? null,
    currentVersion: current.manuscriptVersion,
  }
}

/**
 * A drift as one sentence, or the empty string when there is none.
 *
 * WRITTEN ONCE, where the two facts are known, so a panel and a check cannot describe the same
 * directory differently. The sentence names what to do rather than only what is wrong: a reader told
 * "the directory is stale" has to work out which of the two repairs applies.
 *
 * @param drift - what {@link manuscriptDirectoryDrift} found.
 * @returns the sentence, or the empty string when neither fact holds.
 */
export function describeManuscriptDirectoryDrift(drift: ManuscriptDirectoryDrift): string {
  const parts: string[] = []
  if (drift.edited.length > 0) {
    parts.push(
      `${drift.edited.join(', ')} — the file(s) on disk are not the bytes this directory was written`
      + ' with; re-projecting replaces them, and a file edited here is handed back through the import',
    )
  }
  if (drift.runMoved) {
    parts.push(
      `this directory projects document version ${String(drift.projectedVersion)} and the run holds`
      + ` version ${String(drift.currentVersion)} — the compiled document is a rendering of a version`
      + ' the run has left behind, so it is re-rendered rather than re-projected',
    )
  }
  return parts.join('; ')
}
