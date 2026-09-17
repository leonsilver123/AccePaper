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
  /** A PDF, which needs a LaTeX engine and is refused when the deployment has none. */
  | 'pdf'

/** One block of the manuscript, as a document rather than as a line of Markdown. */
export type DocumentBlock =
  /** Prose, with the citation markers the writer emitted still in it. */
  | { readonly kind: 'prose'; readonly text: string }
  /** A rendered figure, carried as its own SVG bytes. */
  | { readonly kind: 'figure'; readonly label: string; readonly caption: string; readonly svg: string }
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

/** What a compiler is asked to render. */
export interface CompileRequest {
  readonly document: ManuscriptDocument
  readonly format: CompileFormat
}

/** What one compile produced. */
export interface CompiledDocument {
  readonly format: CompileFormat
  /** The file's content, and the name to write it under. */
  readonly fileName: string
  readonly content: string
  /** Which tool produced it, and which version, so a package can name what rendered it. */
  readonly tool: string
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

/** One refusal, naming what is missing. */
export interface CompileRefusal {
  readonly code: CompileRefusalCode
  readonly detail: string
}

/** The file each format is written as, so a caller does not restate the mapping. */
const FILE_NAME_BY_FORMAT: Readonly<Record<CompileFormat, string>> = {
  html: 'manuscript.html',
  latex: 'manuscript.tex',
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
 * The manuscript as a document, built from the parts E1 assembled.
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
      // THE EQUATIONS BELONG TO THE SECTION THAT STATES THEM. E1 appends them to the Method section's
      // text; the document carries them as blocks of their own, so a backend renders display
      // mathematics rather than a code block that happens to look like it.
      const blocks: DocumentBlock[] = [{ kind: 'prose', text: section.bodyText }]
      if (section.id === 'method') {
        blocks.push(...input.equations.map(equation => ({
          kind: 'equation' as const,
          label: equation.label,
          latex: equation.latex,
        })))
      }
      if (section.id === 'results') blocks.push(...input.floats)
      return { id: section.id, heading: section.heading, blocks }
    }),
    references: input.references,
  }
}
