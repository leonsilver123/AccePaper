// @deepseek-ai/dsh-research-cordis — the deployment's document compiler, driven by pandoc.
//
// WHY HERE. Whether a machine has a document toolchain is a property of the DEPLOYMENT, not of the
// research packages: they state the seam (`DocumentCompiler`) and this file is what a deployment that
// has the tool fills it with. The same reasoning as the prose channel and the literature channel — a
// run under a deployment that configured none still exports its manuscript, and says it was not
// compiled.
//
// WHAT IT RENDERS. The document model, not the assembled Markdown: the sections' blocks become
// Markdown paragraphs, the figures their own SVG (inlined by pandoc's self-contained mode), the
// equations display mathematics, and the citation markers the numbers the reference list assigned.
// The numbering is the MANUSCRIPT's — assigned once by E1 — so this file decides typography and
// nothing else.
//
// WHAT IT REFUSES. The formats it can produce are PROBED at construction, so a deployment without a
// LaTeX engine does not offer `pdf` and a caller asking for one is refused with that reason rather
// than handed an empty file. A pandoc that exits non-zero is reported with its own stderr.
//
// WHAT IT IS NOT. It does not fetch, does not validate citations (E1 refuses an unresolved one before
// this runs) and does not decide whether the document is any good.

import { spawn } from 'node:child_process'

// THE SEAM IS SATISFIED STRUCTURALLY, the way the prose channel is: this package does not import the
// research-team package, which would invert the dependency direction between them (`core` ← `tools` ←
// {`cordis`, `team`}). The shapes below are the seam's own — `DocumentCompiler` and the model it
// renders — restated here so a deployment's compiler can be handed to the service the team reads.
// When the seam changes, both sides change together, and the compiler the deployment builds is
// checked against the seam where the team reads it.

/** One format a compiler can produce. */
type CompileFormat = 'html' | 'latex' | 'pdf'

/** One block of the document model. */
type DocumentBlock =
  | { readonly kind: 'prose'; readonly text: string }
  | { readonly kind: 'figure'; readonly label: string; readonly caption: string; readonly svg: string }
  | { readonly kind: 'table'; readonly label: string; readonly caption: string; readonly markdown: string }
  | { readonly kind: 'diagram'; readonly label: string; readonly caption: string; readonly mermaid: string }
  | { readonly kind: 'equation'; readonly label: string; readonly latex: string }

/** The document model. */
interface ManuscriptDocument {
  readonly title: string
  readonly sections: ReadonlyArray<{ readonly id: string; readonly heading: string; readonly blocks: ReadonlyArray<DocumentBlock> }>
  readonly references: ReadonlyArray<{ readonly citeKey: string; readonly entry: string; readonly number?: number }>
}

/** What a compile produced. */
interface CompiledDocument {
  readonly format: CompileFormat
  readonly fileName: string
  readonly content: string
  readonly tool: string
}

/** How the compiler is configured: which executable, and how long it may take. */
export interface PandocCompilerConfig {
  /** The pandoc executable. A deployment names it; a PATH lookup is not a configuration. */
  readonly executable: string
  /** The LaTeX engine, when the deployment has one. Absent means no PDF. */
  readonly latexEngine?: string
  /** Time limit for one compile, milliseconds. */
  readonly timeoutMs?: number
}

/** The default time one compile may take. A compiler that hangs must not hold a run open. */
const DEFAULT_TIMEOUT_MS = 60_000

/** Run one command to completion, returning its exit code and streams. */
function run(
  command: string,
  args: ReadonlyArray<string>,
  stdin: string,
  timeoutMs: number,
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`'${command}' did not finish within ${String(timeoutMs)} ms`))
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    // A SPAWN THAT NEVER STARTED IS NOT A COMPILE THAT FAILED: the reason is the executable, and the
    // caller is told which one rather than being handed an exit code for a process that never ran.
    child.on('error', (error: Error) => {
      clearTimeout(timer)
      reject(new Error(`could not run '${command}': ${error.message}`))
    })
    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
    child.stdin.end(stdin)
  })
}

/** One block as the Markdown pandoc reads, so the model's structure reaches the renderer. */
function blockMarkdown(block: DocumentBlock, numbers: ReadonlyMap<string, number>): string {
  switch (block.kind) {
    case 'prose':
      return block.text.replace(/\[@([^[\]\s]+)\]/gu, (whole: string, key: string) =>
        numbers.has(key) ? `[${String(numbers.get(key))}]` : whole)
    case 'figure':
      return `${block.svg}\n\n**${block.label}.** ${block.caption}`
    case 'table':
      return `${block.markdown}\n\n**${block.label}.** ${block.caption}`
    case 'diagram':
      return `\`\`\`mermaid\n${block.mermaid}\n\`\`\`\n\n**${block.label}.** ${block.caption}`
    case 'equation':
      return `$$${block.latex}$$`
    default:
      return ''
  }
}

/** The document as the Markdown pandoc reads. */
function documentMarkdown(document: ManuscriptDocument): string {
  const numbers = new Map<string, number>(document.references.flatMap(reference =>
    reference.number === undefined ? [] : [[reference.citeKey, reference.number] as [string, number]]))
  const blocks: string[] = [`# ${document.title}`]
  for (const section of document.sections) {
    blocks.push(`## ${section.heading}`)
    for (const block of section.blocks) blocks.push(blockMarkdown(block, numbers))
  }
  if (document.references.length > 0) {
    blocks.push('## References')
    blocks.push(document.references
      .map((reference, index: number) => `[${String(reference.number ?? index + 1)}] ${reference.entry}`)
      .join('\n\n'))
  }
  return `${blocks.join('\n\n')}\n`
}

/**
 * A compiler that drives pandoc, with the formats this deployment can actually produce.
 *
 * The probe runs at construction and its result is `formats`: a deployment with pandoc and no LaTeX
 * engine offers `html` and `latex` and refuses `pdf`, which is the truth about that machine rather
 * than a promise this file cannot keep.
 */
export class PandocCompiler {
  /** The executable this compiler drives, named the way the deployment configured it. */
  readonly tool: string
  /** The formats the probe found on this machine, which is what a caller may ask for. */
  readonly formats: ReadonlyArray<CompileFormat>
  private readonly config: PandocCompilerConfig
  private readonly timeoutMs: number

  /**
   * @param config - the executable, an optional LaTeX engine, and the time limit.
   * @param available - the formats the probe found. Passed in so the probe's result is stated once,
   *   where the process was actually asked, rather than assumed here.
   */
  constructor(config: PandocCompilerConfig, available: ReadonlyArray<CompileFormat>) {
    this.config = config
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.tool = config.executable
    this.formats = available
  }

  /**
   * Ask the machine what it has, and build the compiler that matches.
   *
   * @param config - the executable, an optional LaTeX engine, and the time limit.
   * @returns the compiler, whose `formats` are the ones that really work here.
   */
  static async probe(config: PandocCompilerConfig): Promise<PandocCompiler> {
    const formats: CompileFormat[] = []
    const version = await run(config.executable, ['--version'], '', DEFAULT_TIMEOUT_MS).catch(() => undefined)
    if (version !== undefined && version.code === 0) {
      formats.push('html', 'latex')
      if (config.latexEngine !== undefined) {
        const engine = await run(config.latexEngine, ['--version'], '', DEFAULT_TIMEOUT_MS).catch(() => undefined)
        if (engine !== undefined && engine.code === 0) formats.push('pdf')
      }
    }
    return new PandocCompiler(config, formats)
  }

  /**
   * Render one document.
   *
   * @param request - the document and the format.
   * @returns the compiled file.
   * @throws {Error} when the format is unavailable here, or when the tool exits non-zero — with the
   *   tool's own stderr, so the reason does not have to be found in a log.
   */
  async compile(request: { readonly document: ManuscriptDocument; readonly format: CompileFormat }): Promise<CompiledDocument> {
    if (!this.formats.includes(request.format)) {
      throw new Error(
        `'${this.config.executable}' on this deployment cannot produce '${request.format}'`,
      )
    }
    const markdown = documentMarkdown(request.document)
    const args = request.format === 'html'
      // SELF-CONTAINED, so the compiled file is the document rather than a document plus a directory
      // of assets nobody copied: the figures are inline SVG and the mathematics renders in the browser.
      // MATHML, NOT A SCRIPT: `--mathjax` pulls a renderer in (megabytes, in the self-contained
      // form), and the plan asks for a document that reads with the network off. MathML is rendered
      // natively by every current browser, so the equations work offline and the file stays small.
      ? ['-f', 'markdown+tex_math_dollars', '-t', 'html5', '--standalone', '--self-contained', '--mathml']
      : request.format === 'latex'
        ? ['-f', 'markdown+tex_math_dollars', '-t', 'latex', '--standalone']
        : ['-f', 'markdown+tex_math_dollars', '-t', 'latex', '--standalone', `--pdf-engine=${String(this.config.latexEngine)}`]
    const result = await run(this.config.executable, args, markdown, this.timeoutMs)
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() === '' ? `exit ${String(result.code)}` : result.stderr.trim())
    }
    const fileName = request.format === 'html' ? 'manuscript.html' : request.format === 'latex' ? 'manuscript.tex' : 'manuscript.pdf'
    return { format: request.format, fileName, content: result.stdout, tool: this.tool }
  }
}
