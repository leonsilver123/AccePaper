// @deepseek-ai/dsh-research-team — the manuscript as a document, and the compile chain that renders it.
//
// WHY THIS EXISTS. The pipeline's manuscript is a Markdown STRING assembled by concatenation: a title,
// a `## heading` per section, the figure blocks, the reference entries. Every consumer that needs the
// document as a document — a compiler, an exporter, a later DOCX backend — has to parse that string
// back into parts, and each one parses it slightly differently. This module states the parts ONCE, so
// the compiled HTML, the compiled LaTeX and (later) any other backend render the same document rather
// than three readings of one string.
//
// THE COMPILE IS A SEAM, NOT A SHELL CALL. Nothing in this package spawns a process: the deployment
// injects a `DocumentCompiler`, the way it injects a prose writer, and a deployment that configures
// none gets the refusal rather than a silent Markdown-only package. That is also what makes the
// dependency honest — whether `pandoc` or a LaTeX engine exists on the machine is a property of the
// deployment, and its absence is reported as itself.
//
// WHAT IS REFUSED. A citation the bibliography cannot resolve is refused BEFORE the compiler runs, so
// a broken key does not become a warning in a log nobody reads. A format whose tool is missing is
// refused with the tool named. A compile that fails is refused with the compiler's own stderr, and the
// caller keeps whatever it had: producing a document is not allowed to destroy the previous one.

/** What a compile produces. */
export type CompileFormat =
  /** One self-contained HTML file: the figures are inline SVG and the equations render in the browser. */
  | 'html'
  /** A LaTeX source file, for a journal that wants one, or for a PDF engine to compile. */
  | 'latex'
  /**
   * A Word document, which is what most journals' submission systems take.
   *
   * IT NEEDS NO ENGINE BEYOND PANDOC, unlike a PDF: the figures are embedded in the package and the
   * equations arrive as OMML, so a deployment with pandoc alone can hand a journal its .docx.
   */
  | 'docx'
  /** A PDF, which needs a LaTeX engine and is refused when the deployment has none. */
  | 'pdf'

/** One block of the manuscript, as a document rather than as a line of Markdown. */
export type DocumentBlock =
  /** Prose, with the citation markers the writer emitted still in it. */
  | { readonly kind: 'prose'; readonly text: string }
  /**
   * A rendered figure, carried as the bytes the run produced.
   *
   * BOTH RENDERINGS, because the formats need different ones: HTML embeds the SVG it was drawn as, and
   * LaTeX — which has no SVG support — embeds the raster the SAME tool produced from the same spec. A
   * figure that arrived without its raster can be embedded in HTML and not in LaTeX, and the compile
   * says which rather than dropping it silently.
   */
  | {
    readonly kind: 'figure'
    readonly label: string
    readonly caption: string
    readonly svg: string
    /** The PNG bytes, base64, when the producing tool emitted one. */
    readonly pngBase64?: string
  }
  /** A table, carried as the renderer's own Markdown (a native table, not an image). */
  | { readonly kind: 'table'; readonly label: string; readonly caption: string; readonly markdown: string }
  /** A diagram, carried as its Mermaid source. */
  | { readonly kind: 'diagram'; readonly label: string; readonly caption: string; readonly mermaid: string }
  /** Display mathematics, carried as LaTeX. */
  | { readonly kind: 'equation'; readonly label: string; readonly latex: string }

/** One section of the manuscript. */
export interface DocumentSection {
  readonly id: string
  readonly heading: string
  readonly blocks: ReadonlyArray<DocumentBlock>
}

/** One reference, keyed the way the manuscript cites it. */
export interface DocumentReference {
  readonly citeKey: string
  /** The entry as the reference list prints it, without its number. */
  readonly entry: string
  /**
   * The number the reference list prints it under.
   *
   * THE MANUSCRIPT'S NUMBERING, assigned once where the list is rendered: a compiler decides
   * typography, and a second numbering is how a citation and its entry come to name different things.
   */
  readonly number?: number
}

/** The manuscript as a document: what every backend renders. */
export interface ManuscriptDocument {
  readonly title: string
  readonly sections: ReadonlyArray<DocumentSection>
  readonly references: ReadonlyArray<DocumentReference>
}

/** What a compiler is asked to render, and what the result is for. */
export interface CompileRequest {
  readonly document: ManuscriptDocument
  readonly format: CompileFormat
  /**
   * Whether the result is a working draft or something to hand a reader as a submission.
   *
   * THE DIFFERENCE IS WHAT A MISSING ASSET COSTS. A draft may carry a document whose diagram is still
   * source rather than a rendered figure — a reader of a draft can see that — while a submission that
   * does so is claiming to be the paper. `submission` refuses any float that could not be embedded;
   * `draft` embeds what it can and RECORDS what it could not, which is what keeps a half-rendered
   * document from being reported as a finished one.
   */
  readonly mode: 'draft' | 'submission'
}

/** One file a compile produced besides the document itself — a figure the document embeds. */
export interface CompiledAsset {
  /** Path relative to the compiled document, e.g. `assets/figure-1.png`. */
  readonly path: string
  /** The float the asset belongs to, so the document and its assets can be reconciled by id. */
  readonly label: string
  /** base64 of the bytes. Kept as text so it survives JSON, the manifest and the wire unchanged. */
  readonly base64: string
}

/** What one compile produced. */
export interface CompiledDocument {
  readonly format: CompileFormat
  /** The file's content, and the name to write it under. */
  readonly fileName: string
  readonly content: string
  /**
   * How {@link content} is encoded.
   *
   * A PDF is bytes and a LaTeX file is text, and reading one as the other is how a `manuscript.pdf`
   * that is really LaTeX gets written. `base64` means the content is bytes, and a writer must decode
   * it rather than encode it.
   */
  readonly encoding: 'utf8' | 'base64'
  /** Which tool produced it, and which version, so a package can name what rendered it. */
  readonly tool: string
  /** The floats this compile embedded, by label, and the ones it could not. */
  readonly assets: {
    readonly embedded: ReadonlyArray<string>
    readonly dropped: ReadonlyArray<{ readonly label: string; readonly reason: string }>
  }
  /** The files the document embeds, to be written beside it. */
  readonly files: ReadonlyArray<CompiledAsset>
}

/** The compile seam. A deployment supplies one; this package never spawns a process itself. */
export interface DocumentCompiler {
  /** Which tool this compiler drives, for the record. */
  readonly tool: string
  /** The formats this compiler can produce on THIS deployment, so a missing engine is known in advance. */
  readonly formats: ReadonlyArray<CompileFormat>
  compile(request: CompileRequest): Promise<CompiledDocument>
}

/** Why a compile was refused. */
export type CompileRefusalCode =
  /** The deployment configured no compiler at all. */
  | 'compile-compiler-missing'
  /** The compiler cannot produce the requested format on this deployment, e.g. no LaTeX engine. */
  | 'compile-format-unavailable'
  /** A sentence cites a key the bibliography does not carry. */
  | 'compile-citation-unresolved'
  /** The document carries no sections, so there is nothing a compiler could render. */
  | 'compile-nothing-to-render'
  /** A float the document carries cannot be embedded in the requested format. */
  | 'compile-asset-unembeddable'

/** One refusal, naming what is missing. */
export interface CompileRefusal {
  readonly code: CompileRefusalCode
  readonly detail: string
}

/** The file each format is written as, so a caller does not restate the mapping. */
const FILE_NAME_BY_FORMAT: Readonly<Record<CompileFormat, string>> = {
  html: 'manuscript.html',
  latex: 'manuscript.tex',
  docx: 'manuscript.docx',
  pdf: 'manuscript.pdf',
}

/**
 * The keys a document's prose cites, in first-appearance order.
 *
 * @param document - the manuscript as a document.
 * @returns the cite keys its prose names.
 */
export function citedKeysOf(document: ManuscriptDocument): ReadonlyArray<string> {
  const keys: string[] = []
  for (const section of document.sections) {
    for (const block of section.blocks) {
      if (block.kind !== 'prose') continue
      for (const match of block.text.matchAll(/\[@([^[\]\s]+)\]/gu)) {
        const key = match[1]
        if (key !== undefined && !keys.includes(key)) keys.push(key)
      }
    }
  }
  return keys
}

/**
 * Judge a compile request before anything is rendered.
 *
 * THE CITATION CHECK RUNS FIRST AND IS NOT THE COMPILER'S JOB. A compiler that cannot resolve a key
 * emits a warning and renders the document anyway; a manuscript whose citations do not resolve is a
 * manuscript whose argument does not, and the refusal names every key rather than the first.
 *
 * @param request - the document and the format asked for.
 * @param compiler - the deployment's compiler, or undefined when it configured none.
 * @returns one refusal per problem, or an empty list.
 */
export function checkCompileRequest(
  request: CompileRequest,
  compiler: DocumentCompiler | undefined,
): ReadonlyArray<CompileRefusal> {
  const refusals: CompileRefusal[] = []
  if (compiler === undefined) {
    return [{
      code: 'compile-compiler-missing',
      detail: 'this deployment configures no document compiler, so the manuscript can be exported as'
        + ' Markdown and cannot be compiled',
    }]
  }
  if (request.document.sections.length === 0) {
    refusals.push({
      code: 'compile-nothing-to-render',
      detail: 'the document carries no sections, so there is nothing to compile',
    })
  }
  if (!compiler.formats.includes(request.format)) {
    refusals.push({
      code: 'compile-format-unavailable',
      detail: `'${compiler.tool}' on this deployment cannot produce '${request.format}'`
        + ` (it produces ${compiler.formats.join(', ') || 'nothing'})`,
    })
  }
  // WHAT THE FORMAT CANNOT CARRY, WHEN THE RESULT IS MEANT TO BE THE PAPER. LaTeX has no SVG support
  // and neither LaTeX nor HTML can turn a diagram's source into a figure, so a submission carrying
  // them would be claiming to be a document whose figures are there. A draft lists them instead.
  const unembeddable = unembeddableFloats(request.document, request.format)
  if (request.mode === 'submission' && unembeddable.length > 0) {
    refusals.push({
      code: 'compile-asset-unembeddable',
      detail: `this document cannot be submitted as '${request.format}': `
        + unembeddable.map(entry => `${entry.label} (${entry.reason})`).join('; '),
    })
  }
  const known = new Set(request.document.references.map(reference => reference.citeKey))
  const unresolved = citedKeysOf(request.document).filter(key => !known.has(key))
  if (unresolved.length > 0) {
    refusals.push({
      code: 'compile-citation-unresolved',
      detail: `the document cites ${unresolved.join(', ')}, which its bibliography does not carry — a`
        + ' compiled document with an unresolved citation is a document whose sources cannot be found',
    })
  }
  return refusals
}

/** What a compile attempt answers: the document, or the reasons it was refused. */
export type CompileOutcome =
  | { readonly ok: true; readonly compiled: CompiledDocument }
  | { readonly ok: false; readonly refusals: ReadonlyArray<CompileRefusal> }

/**
 * Compile a manuscript, or refuse it with the reason.
 *
 * A FAILED COMPILE LEAVES THE CALLER WITH WHAT IT HAD. Nothing is written here — the content comes
 * back for the caller to stage and publish — so a compiler that fails midway cannot have destroyed a
 * file a previous export wrote. The caller's writer is the staged one (`writeRunPackage`), which
 * verifies before it publishes.
 *
 * @param request - the document and the format.
 * @param compiler - the deployment's compiler, or undefined when it configured none.
 * @returns the compiled document, or a refusal naming what is missing.
 */
export async function compileManuscript(
  request: CompileRequest,
  compiler: DocumentCompiler | undefined,
): Promise<CompileOutcome> {
  const refusals = checkCompileRequest(request, compiler)
  if (refusals.length > 0 || compiler === undefined) return { ok: false, refusals }
  try {
    const compiled = await compiler.compile(request)
    return {
      ok: true,
      compiled: { ...compiled, fileName: compiled.fileName.length > 0 ? compiled.fileName : FILE_NAME_BY_FORMAT[request.format] },
    }
  } catch (error) {
    // THE COMPILER'S OWN WORDS. A refusal that said only "the compile failed" would send a reader to
    // the tool's log to find out why, which is where the reason already was.
    return {
      ok: false,
      refusals: [{
        code: 'compile-format-unavailable',
        detail: `'${compiler.tool}' could not produce '${request.format}': `
          + (error instanceof Error ? error.message : String(error)),
      }],
    }
  }
}

/**
 * The floats a format cannot embed, with the reason for each.
 *
 * A FIGURE NEEDS A RENDERING THE FORMAT UNDERSTANDS (HTML takes the SVG, LaTeX takes the raster) and a
 * DIAGRAM NEEDS A STATIC RENDERING NOBODY HAS PRODUCED: a Mermaid block is source, and a document that
 * prints that source under the caption `Figure 2` has a float the reader cannot see. Reported by label
 * so a document and its assets can be reconciled by id rather than by count.
 *
 * @param document - the document.
 * @param format - the format it is compiled to.
 * @returns one entry per float that cannot be embedded, or an empty list.
 */
export function unembeddableFloats(
  document: ManuscriptDocument,
  format: CompileFormat,
): ReadonlyArray<{ readonly label: string; readonly reason: string }> {
  const entries: Array<{ label: string; reason: string }> = []
  for (const section of document.sections) {
    for (const block of section.blocks) {
      if (block.kind === 'figure' && format !== 'html' && block.pngBase64 === undefined) {
        entries.push({
          label: block.label,
          reason: `'${format}' cannot embed an SVG and this figure carries no raster rendering`,
        })
      }
      if (block.kind === 'diagram') {
        entries.push({
          label: block.label,
          reason: 'a diagram is carried as its own source and no static rendering was produced for it',
        })
      }
    }
  }
  return entries
}

/**
 * The manuscript as a document, built from the parts the writing steps produced.
 *
 * THE PARTS ARE ALREADY TYPED WHERE THEY ARE MADE: the sections carry their ids and headings, the
 * floats carry their labels and their rendered content, and the references carry the cite keys the
 * prose cites. This function is the one place that says how they compose into a document, so the
 * compiled HTML, the compiled LaTeX and any later backend render the same composition instead of
 * each parsing the assembled Markdown string back into parts.
 *
 * @param input - the assembled parts.
 * @returns the document.
 */
export function documentOf(input: {
  readonly title: string
  readonly sections: ReadonlyArray<{
    readonly id: string
    readonly heading: string
    readonly bodyText: string
  }>
  readonly floats: ReadonlyArray<DocumentBlock>
  readonly equations: ReadonlyArray<{ readonly label: string; readonly latex: string }>
  readonly references: ReadonlyArray<DocumentReference>
}): ManuscriptDocument {
  return {
    title: input.title,
    sections: input.sections.map((section) => {
      // THE EQUATIONS BELONG TO THE SECTION THAT STATES THEM. D3 writes them into the document, and
      // E1 appends the same block to the Method section's rendered text; carrying them as blocks of
      // their own is what lets a backend render display mathematics rather than a code block that
      // happens to look like it.
      const blocks: DocumentBlock[] = [{ kind: 'prose', text: section.bodyText }]
      if (section.id === 'method') {
        blocks.push(...input.equations.map(equation => ({
          kind: 'equation' as const,
          label: equation.label,
          latex: equation.latex,
        })))
      }
      // THE FLOATS SIT WITH THE SECTION THAT REPORTS THEM, which is `results` in this outline. A
      // caller building a document for another skeleton has to put them where its own results are —
      // measured, the hard way: a fixture whose float belonged to a section the assembler does not
      // attach floats to produced a LaTeX file with no figure, and that was read as a LaTeX defect
      // for a while. It was the fixture.
      if (section.id === 'results') blocks.push(...input.floats)
      return { id: section.id, heading: section.heading, blocks }
    }),
    references: input.references,
  }
}
