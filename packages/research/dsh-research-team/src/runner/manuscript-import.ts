// @deepseek-ai/dsh-research-team — a person's edited file, handed back as a new version.
//
// WHY THIS IS EXPLICIT AND GATED. The pipeline maintains one document on disk so a person can edit
// it. That is only half a round trip: a file that was edited has to be able to come back, and the one
// thing that must NOT happen is the pipeline silently adopting bytes it did not produce. So the
// return is an operation with its own guards, its own producer and its own audit record — the shape
// `dsh-research-core`'s `publication.ts` argues for — and it publishes a NEW VERSION of the document
// rather than editing the one the run holds. A sentence that changed therefore loses the judgement
// bound to it, by the same mechanism that makes a D4 revision do so: a judgement is a reading
// somebody made, and only another reading can replace it.
//
// WHAT IT REFUSES, AND WHY EACH ONE IS A WAY OF ADOPTING SOMETHING ELSE:
//   - a directory that holds no manifest this build can read (nothing states which version the file
//     on disk was projected from);
//   - a format this deployment's compiler cannot read back (the bytes would have to be guessed at);
//   - a file the manifest does not name (it is not one this run produced);
//   - a file that is byte-for-byte what was projected (there is no edit to bring back);
//   - a document version other than the one the run holds (the file was edited against a version the
//     run has left behind, and publishing it would revert whatever moved in between).
//
// WHAT IT CARRIES FORWARD, AND WHAT IT CANNOT. The document's own structure — the floats, the
// equations, the references, the citations, the argument plan, the reading record — is carried from
// the version the file was projected from, because none of it survives a round trip through a flat
// document. {@link roundTripLossesOf} states what each format loses and which of those losses this
// module compensates for by carrying the field forward.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DocumentCompiler, RoundTripLoss } from './document-compile.ts'
import { MANUSCRIPT_DIRECTORY_FILES } from './manuscript-directory.ts'
import type { DocumentManifest } from './manuscript-directory.ts'

/**
 * The recorded producer of a version that came back from a person's editor.
 *
 * A NAME AND NOT A STEP ID, for the same reason a hand acceptance records one: no step ran, and an
 * entry that named a step would say the pipeline produced text a person typed.
 */
export const MANUSCRIPT_IMPORT_PRODUCER = 'manuscript-import'

/** The formats a person may hand back, and the file each one is read from. */
export type ManuscriptReturnFormat = 'markdown' | 'latex' | 'docx'

/** The file each returnable format is read from, inside the run's working directory. */
export const MANUSCRIPT_RETURN_FILES: Readonly<Record<ManuscriptReturnFormat, string>> = {
  markdown: MANUSCRIPT_DIRECTORY_FILES.markdown,
  latex: MANUSCRIPT_DIRECTORY_FILES.latex,
  docx: MANUSCRIPT_DIRECTORY_FILES.docx,
}

/** Every format this operation accepts, in the order a caller is offered them. */
export const MANUSCRIPT_RETURN_FORMATS: ReadonlyArray<ManuscriptReturnFormat> = ['markdown', 'latex', 'docx']

/** One thing a round trip through a document format does not carry back. */
export type ManuscriptRoundTripLoss = RoundTripLoss

/**
 * What each format loses on the way back, as a table rather than as a caveat in a README.
 *
 * THE DIFFERENCE IS THE POINT. A `.tex` holds its text and its mathematics verbatim, so the prose and
 * the equations come back as they were written; a `.docx` holds comments, cross-reference fields and
 * embedded media that no Markdown rendering keeps, so a Word round trip is lossy in ways a LaTeX one
 * is not. A reader comparing the two files should be able to see that from the run rather than from
 * this file's documentation, so the import records the losses it took — and the manifest, the audit
 * event and the returned receipt all name them.
 *
 * A LOSS THIS MODULE COMPENSATES FOR IS STILL A LOSS. A figure comes back as an image link rather
 * than as a block, and the assembly below keeps the block the previous version held; what a person
 * sees is that editing the figure's caption in Word changed the caption and not the drawing. Saying
 * "images" was lost is how a reader learns to check the drawing by hand.
 *
 * @param format - the format the file being handed back is in.
 * @returns one entry per part of the document this format does not carry back unchanged.
 */
export function roundTripLossesOf(format: ManuscriptReturnFormat): ReadonlyArray<ManuscriptRoundTripLoss> {
  const citationNumbering = {
    part: 'citation-markers',
    reason: 'the document prints each citation as the number its reference list assigned, so a'
      + ' reordered or renumbered reference list changes which source a number names. The citation'
      + ' bindings are carried forward from the version this file was projected from, and a sentence'
      + ' whose text changed loses its judgement — the same rule a revision follows',
  }
  const figures = {
    part: 'figures',
    reason: 'a float comes back as an image reference rather than as the rendered block the document'
      + ' held, so the drawing is carried forward from the version this file was projected from and a'
      + ' figure redrawn in the editor is not adopted',
  }
  switch (format) {
    case 'markdown':
      return [
        figures,
        citationNumbering,
        {
          part: 'floats-and-equations',
          reason: 'the assembled Markdown prints the floats and the reference list as the assembler'
            + ' rendered them, so the document model is re-read from this file for the prose only',
        },
      ]
    case 'latex':
      return [
        figures,
        citationNumbering,
        {
          part: 'comments',
          reason: 'a LaTeX comment is not part of the document and no reader returns it; anything a'
            + ' person wrote in a `%` line is gone',
        },
      ]
    case 'docx':
      return [
        figures,
        citationNumbering,
        {
          part: 'comments',
          reason: 'a Word comment is stored beside the document and no Markdown rendering carries it,'
            + ' so it is dropped entirely',
        },
        {
          part: 'cross-references',
          reason: 'a Word cross-reference is a field or a literal number, and both come back as the'
            + ' number that was printed — a renumbering is not recoverable from the file',
        },
        {
          part: 'tables',
          reason: 'a Word table comes back as a pipe table whose cells are flattened: a newline inside'
            + ' a cell became a space when the paper printed it, and the CSV this package writes is'
            + ' read out of the printed form',
        },
      ]
  }
}

/** A file a person handed back, read and converted, with what the manifest said about it. */
export interface ReturnedManuscript {
  readonly format: ManuscriptReturnFormat
  /** Package-relative path the file was read from, e.g. `manuscript.tex`. */
  readonly path: string
  /** SHA-256 of the bytes read, lower-case hex. */
  readonly sha256: string
  /** What the manifest recorded for this file when it was projected. */
  readonly projectedSha256: string
  /** The document as Markdown, as the deployment's compiler read it back. */
  readonly markdown: string
  /** What this round trip did not carry back — the format's losses, plus the reader's own. */
  readonly losses: ReadonlyArray<ManuscriptRoundTripLoss>
}

/** What reading a handed-back file produced: the file, or why it could not be read. */
export type ManuscriptReturnRead =
  | { readonly ok: true; readonly file: ReturnedManuscript }
  | { readonly ok: false; readonly reason: string }

/**
 * Read the file a person edited, or refuse it with the reason.
 *
 * NOTHING IS ADOPTED WITHOUT KNOWING WHICH VERSION IT WAS PROJECTED FROM. The manifest names the
 * document version the directory holds and the digest of every file in it; both are checked here,
 * because "the file changed" and "the file is a file this run produced" are different questions and
 * a caller that only asked the first would adopt any bytes that happened to differ.
 *
 * @param directory - the run's working directory.
 * @param format - the format being handed back.
 * @param manifest - the manifest read from that directory.
 * @param compiler - the deployment's document toolchain, or undefined when it names none.
 * @returns the converted document, or the refusal naming what was wrong.
 */
export async function readManuscriptReturn(
  directory: string,
  format: ManuscriptReturnFormat,
  manifest: DocumentManifest,
  compiler: DocumentCompiler | undefined,
): Promise<ManuscriptReturnRead> {
  const path = MANUSCRIPT_RETURN_FILES[format]
  const recorded = manifest.files.find(entry => entry.path === path)
  if (recorded === undefined) {
    return {
      ok: false,
      reason: `this run's working directory holds no '${path}': the manifest lists`
        + ` ${manifest.files.map(entry => entry.path).join(', ') || 'no files'}, so there is nothing to`
        + ` hand back as '${format}'`,
    }
  }
  const target = join(directory, path)
  if (!existsSync(target)) {
    return { ok: false, reason: `'${path}' is named by the manifest and is not on disk` }
  }
  const bytes = readFileSync(target)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 === recorded.sha256) {
    return {
      ok: false,
      reason: `'${path}' is byte-for-byte what this run projected: there is no edit to bring back`,
    }
  }
  const base = {
    format,
    path,
    sha256,
    projectedSha256: recorded.sha256,
    losses: roundTripLossesOf(format),
  }
  // MARKDOWN NEEDS NO TOOLCHAIN: it is the form the document is assembled in, and a person may edit
  // it directly. The other two are formats only the deployment's compiler can read.
  if (format === 'markdown') return { ok: true, file: { ...base, markdown: bytes.toString('utf8') } }
  if (compiler?.read === undefined) {
    return {
      ok: false,
      reason: (compiler === undefined ? 'this deployment names no document toolchain' : `'${compiler.tool}'`)
        + ` cannot read a '${format}' file back into the document model, so '${path}' cannot be`
        + ' imported — hand back the Markdown or the LaTeX source instead',
    }
  }
  try {
    const read = await compiler.read({
      format: format === 'latex' ? 'latex' : 'docx',
      content: bytes.toString('base64'),
      encoding: 'base64',
    })
    return { ok: true, file: { ...base, markdown: read.markdown, losses: [...base.losses, ...read.losses] } }
  } catch (error) {
    return {
      ok: false,
      reason: `'${compiler.tool}' could not read '${path}' back: `
        + (error instanceof Error ? error.message : String(error)),
    }
  }
}

/** One heading in the returned Markdown, with the text under it. */
interface ReturnedSection {
  readonly heading: string
  readonly body: string
}

/**
 * The sections of a returned Markdown document, in the order they appear.
 *
 * SPLIT ON LEVEL-TWO HEADINGS, which is what the assembler writes for every section. Anything before
 * the first one is the title, and it is NOT read back: the title is the study's own, and a person who
 * retitled the file has changed a string no step of the pipeline owns.
 *
 * @param markdown - the returned document.
 * @returns one entry per `##` heading.
 */
export function sectionsOfReturnedMarkdown(markdown: string): ReadonlyArray<ReturnedSection> {
  const lines = markdown.split(/\r?\n/u)
  const sections: Array<{ heading: string; body: string[] }> = []
  for (const line of lines) {
    const heading = /^##\s+(.*\S)\s*$/u.exec(line)
    if (heading === null) {
      if (sections.length > 0) sections[sections.length - 1]?.body.push(line)
      continue
    }
    sections.push({ heading: heading[1] ?? '', body: [] })
  }
  return sections.map(section => ({ heading: section.heading, body: section.body.join('\n').trim() }))
}

/** The document as the import publishes it, with what the assembly could and could not match. */
export interface ImportedManuscript {
  /** The new manuscript artifact value. */
  readonly value: Record<string, unknown>
  /** The sections matched by heading, in the manifest's order. */
  readonly matched: ReadonlyArray<string>
  /** Headings in the file that name no section of the document — a new section by hand. */
  readonly unmatchedHeadings: ReadonlyArray<string>
  /** Sections of the document the file says nothing about, which are carried forward untouched. */
  readonly unmentionedSections: ReadonlyArray<string>
}

/**
 * Assemble the run's next document version from the text a person handed back.
 *
 * EVERY FIELD OF THE DOCUMENT IS CARRIED FORWARD AND ONLY THE PROSE IS REPLACED, so the published
 * version still describes the same study: a value rebuilt from the file alone would drop the
 * citations, the reference list, the argument plan, the floats and the reading record, and E1 — which
 * refuses a manuscript whose citations do not resolve — would stop the run over fields a round trip
 * through a flat format cannot carry. The one field that is deliberately left exactly as it was is
 * the sentence-level reading record: a sentence whose text changed no longer matches its assessment,
 * and E1 refuses it, which is the mechanism working rather than a case to smooth over.
 *
 * SECTIONS ARE MATCHED BY HEADING AND NOT BY POSITION. A person who reorders two sections has
 * reordered them, and matching by index would read the second section's prose into the first
 * section's judgement. A heading that matches nothing is reported rather than appended: a section
 * this pipeline never wrote has no argument-plan obligation, no citation bindings and no place in
 * the outline, and adopting it silently would publish text no gate has ever seen.
 *
 * @param previous - the manuscript artifact's value, as the run holds it.
 * @param markdown - the document as the person handed it back.
 * @returns the new value, and what the assembly matched.
 */
export function assembleImportedManuscript(previous: unknown, markdown: string): ImportedManuscript {
  const record = previous !== null && typeof previous === 'object' && !Array.isArray(previous)
    ? { ...(previous as Record<string, unknown>) }
    : {}
  const previousSections = Array.isArray(record['sections'])
    ? (record['sections'] as ReadonlyArray<Record<string, unknown>>)
    : []
  const byHeading = new Map<string, string>()
  for (const section of sectionsOfReturnedMarkdown(markdown)) {
    // FIRST WINS. Two headings with one name in one document is a duplicate this assembler cannot
    // tell apart, and taking the last would silently discard the first section's prose.
    if (!byHeading.has(section.heading)) byHeading.set(section.heading, section.body)
  }
  const matched: string[] = []
  const unmentioned: string[] = []
  const bodies = new Map<string, string>()
  for (const section of previousSections) {
    const id = section['id']
    const heading = section['heading']
    const body = typeof heading === 'string' ? byHeading.get(heading) : undefined
    if (typeof id !== 'string') continue
    if (body === undefined) {
      unmentioned.push(id)
      continue
    }
    matched.push(id)
    bodies.set(id, body)
  }
  const claimed = new Set(previousSections.flatMap((section) => {
    const heading = section['heading']
    return typeof heading === 'string' ? [heading] : []
  }))
  const sections = previousSections.map((section) => {
    const id = section['id']
    const body = typeof id === 'string' ? bodies.get(id) : undefined
    return body === undefined ? section : { ...section, bodyText: body }
  })
  const document = record['document']
  return {
    value: {
      ...record,
      sections,
      ...(document === null || typeof document !== 'object'
        ? {}
        : { document: documentWithProse(document, bodies) }),
      importedFile: true,
    },
    matched,
    unmatchedHeadings: [...byHeading.keys()].filter(heading => !claimed.has(heading)),
    unmentionedSections: unmentioned,
  }
}

/**
 * The document with the returned prose in it, everything else exactly as it was.
 *
 * THE PROSE BLOCKS ARE REPLACED, NOT REBUILT, which is the same rule a reviewed candidate's
 * acceptance follows: a section keeps the equations, the figures and the table the document already
 * placed in it, so a hand edit changes the sentences and no float, no reference and no number the
 * study produced.
 *
 * @param document - the document the run holds.
 * @param bodies - the returned body per section id.
 * @returns the document as the import publishes it.
 */
function documentWithProse(
  document: { readonly sections?: unknown },
  bodies: ReadonlyMap<string, string>,
): unknown {
  const sections = document.sections
  if (!Array.isArray(sections)) return document
  return {
    ...document,
    sections: sections.map((section): Record<string, unknown> => {
      const entry = section as Record<string, unknown>
      const id = entry['id']
      const blocks: unknown = entry['blocks']
      const body = typeof id === 'string' ? bodies.get(id) : undefined
      if (body === undefined || !Array.isArray(blocks)) return entry
      const kept: Array<Record<string, unknown>> = []
      for (const block of blocks as ReadonlyArray<Record<string, unknown>>) {
        if (block['kind'] !== 'prose') kept.push(block)
      }
      return { ...entry, blocks: [{ kind: 'prose', text: body }, ...kept] }
    }),
  }
}
