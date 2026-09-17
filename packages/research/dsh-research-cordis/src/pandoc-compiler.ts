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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
  | {
    readonly kind: 'figure'
    readonly label: string
    readonly caption: string
    readonly svg: string
    readonly pngBase64?: string
  }
  | { readonly kind: 'table'; readonly label: string; readonly caption: string; readonly markdown: string }
  | { readonly kind: 'diagram'; readonly label: string; readonly caption: string; readonly mermaid: string }
  | { readonly kind: 'equation'; readonly label: string; readonly latex: string }

/** The document model. */
interface ManuscriptDocument {
  readonly title: string
  readonly sections: ReadonlyArray<{ readonly id: string; readonly heading: string; readonly blocks: ReadonlyArray<DocumentBlock> }>
  readonly references: ReadonlyArray<{ readonly citeKey: string; readonly entry: string; readonly number?: number }>
}

/** One file a compile produced besides the document — a figure the document embeds. */
interface CompiledAsset {
  readonly path: string
  readonly label: string
  readonly base64: string
}

/** What a compile produced. */
interface CompiledDocument {
  readonly format: CompileFormat
  readonly fileName: string
  readonly content: string
  readonly encoding: 'utf8' | 'base64'
  readonly tool: string
  readonly assets: {
    readonly embedded: ReadonlyArray<string>
    readonly dropped: ReadonlyArray<{ readonly label: string; readonly reason: string }>
  }
  readonly files: ReadonlyArray<CompiledAsset>
}

/**
 * How one LaTeX engine run is performed.
 *
 * A SEAM, and a small one, because the engine is the only part of the PDF path that cannot be
 * verified here: this host has pandoc and no LaTeX engine, so a deployment that has one supplies it
 * and a test supplies a stand-in that writes a real PDF file. Everything else in the path — pandoc,
 * the temporary files, the byte handling, the header check — stays real either way.
 */
export type EngineRunner = (invocation: {
  readonly executable: string
  readonly workDir: string
  readonly texPath: string
  readonly timeoutMs: number
}) => Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>

/**
 * Run a LaTeX engine the way the common ones accept it: the .tex path, with the working directory set
 * so the engine writes `<name>.pdf` beside its input.
 */
const defaultEngineRunner: EngineRunner = async ({ executable, workDir, texPath, timeoutMs }) => {
  const result = await runIn(executable, ['-interaction=batchmode', '-halt-on-error', texPath], '', timeoutMs, workDir)
  return result
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

/**
 * Pandoc's arguments for producing a PDF from the Markdown source.
 *
 * `-t latex` alone is what produced a LaTeX file named `.pdf`; with an output path and `-o`, pandoc
 * runs the engine and writes the PDF there.
 */
const PDF_ARGS: ReadonlyArray<string> = ['-f', 'markdown+tex_math_dollars', '-t', 'latex', '--standalone']

/** A float's label as a file name: `Figure 1` becomes `figure-1`. */
function slugOf(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '')
}

/** Run one command to completion, returning its exit code and streams. */
function run(
  command: string,
  args: ReadonlyArray<string>,
  stdin: string,
  timeoutMs: number,
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  return runIn(command, args, stdin, timeoutMs, undefined)
}

/** {@link run} in a chosen working directory, which is what a LaTeX engine needs. */
function runIn(
  command: string,
  args: ReadonlyArray<string>,
  stdin: string,
  timeoutMs: number,
  cwd: string | undefined,
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(cwd === undefined ? {} : { cwd }),
    })
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
  /** How one engine run is performed; see {@link EngineRunner}. */
  private readonly engineRunner: EngineRunner

  /**
   * @param config - the executable, an optional LaTeX engine, and the time limit.
   * @param available - the formats the probe found. Passed in so the probe's result is stated once,
   *   where the process was actually asked, rather than assumed here.
   */
  constructor(
    config: PandocCompilerConfig,
    available: ReadonlyArray<CompileFormat>,
    engineRunner: EngineRunner = defaultEngineRunner,
  ) {
    this.config = config
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.tool = config.executable
    this.formats = available
    this.engineRunner = engineRunner
  }

  /**
   * Ask the machine what it has, and build the compiler that matches.
   *
   * @param config - the executable, an optional LaTeX engine, and the time limit.
   * @param engineRunner - how a LaTeX engine is run over the source pandoc wrote; the host's own
   *   process runner by default, and a seam a caller injects to test the PDF path.
   * @returns the compiler, whose `formats` are the ones that really work here.
   */
  static async probe(config: PandocCompilerConfig, engineRunner: EngineRunner = defaultEngineRunner): Promise<PandocCompiler> {
    const formats: CompileFormat[] = []
    const version = await run(config.executable, ['--version'], '', DEFAULT_TIMEOUT_MS).catch(() => undefined)
    if (version !== undefined && version.code === 0) {
      formats.push('html', 'latex')
      if (config.latexEngine !== undefined) {
        const engine = await run(config.latexEngine, ['--version'], '', DEFAULT_TIMEOUT_MS).catch(() => undefined)
        if (engine !== undefined && engine.code === 0) formats.push('pdf')
      }
    }
    return new PandocCompiler(config, formats, engineRunner)
  }

  /**
   * Render one document.
   *
   * @param request - the document and the format.
   * @returns the compiled file.
   * @throws {Error} when the format is unavailable here, or when the tool exits non-zero — with the
   *   tool's own stderr, so the reason does not have to be found in a log.
   */
  async compile(request: {
    readonly document: ManuscriptDocument
    readonly format: CompileFormat
    readonly mode: 'draft' | 'submission'
  }): Promise<CompiledDocument> {
    if (!this.formats.includes(request.format)) {
      throw new Error(
        `'${this.config.executable}' on this deployment cannot produce '${request.format}'`,
      )
    }
    // THE FIGURES, AS THIS FORMAT CAN CARRY THEM. HTML embeds the SVG the tool drew; LaTeX has no SVG
    // support and embeds the raster the same tool produced from the same spec. A figure with no raster,
    // and a diagram whose static rendering nobody produced, are NOT embedded — they are reported, and
    // a submission carrying one is refused by the seam's own check.
    const dropped: Array<{ label: string; reason: string }> = []
    const embedded: string[] = []
    const files: CompiledAsset[] = []
    const work = mkdtempSync(join(tmpdir(), 'dsh-compile-'))
    const numbers = new Map<string, number>(request.document.references.flatMap(reference =>
      reference.number === undefined ? [] : [[reference.citeKey, reference.number] as [string, number]]))
    try {
      const blocks: string[] = []
      for (const section of request.document.sections) {
        const rendered: string[] = []
        for (const block of section.blocks) {
          if (block.kind === 'figure') {
            if (request.format === 'html') {
              embedded.push(block.label)
              rendered.push(`${block.svg}\n\n**${block.label}.** ${block.caption}`)
              continue
            }
            if (block.pngBase64 === undefined) {
              dropped.push({
                label: block.label,
                reason: `'${request.format}' cannot embed an SVG and this figure carries no raster rendering`,
              })
              continue
            }
            const name = `${slugOf(block.label)}.png`
            writeFileSync(join(work, name), Buffer.from(block.pngBase64, 'base64'))
            files.push({ path: `assets/${name}`, label: block.label, base64: block.pngBase64 })
            embedded.push(block.label)
            rendered.push(`![${block.caption}](${join(work, name)})`)
            continue
          }
          if (block.kind === 'diagram') {
            // A MERMAID BLOCK IS SOURCE. Printing it under a figure caption would put a number on a
            // code listing, so it is reported as not embedded rather than passed off as a figure.
            dropped.push({
              label: block.label,
              reason: 'a diagram is carried as its own source and no static rendering was produced for it',
            })
            if (request.format === 'html') rendered.push(['```mermaid', block.mermaid, '```'].join('\n'))
            continue
          }
          rendered.push(blockMarkdown(block, numbers))
        }
        blocks.push(`## ${section.heading}`, ...rendered)
      }
      const markdown = [`# ${request.document.title}`, ...blocks].join('\n\n') + '\n'
      const stdout = request.format === 'html'
        ? await this.runToStdout(markdown, ['-f', 'markdown+tex_math_dollars', '-t', 'html5', '--standalone', '--self-contained', '--mathml'])
        : request.format === 'latex'
          ? await this.runToStdout(markdown, ['-f', 'markdown+tex_math_dollars', '-t', 'latex', '--standalone'])
          // THE PDF IS REQUESTED AS A PDF. The LaTeX branch with `--pdf-engine` produced LaTeX on
          // stdout and exited 0 — a file named `manuscript.pdf` that is not one — so the output goes to
          // a real `.pdf` path, comes back as BYTES, and is checked for the PDF header before it is
          // accepted.
          : ''
      if (request.format === 'pdf') {
        // TWO STEPS, BOTH OBSERVABLE. Pandoc renders the LaTeX source to a file; the engine compiles
        // THAT file; this code reads the `.pdf` the engine wrote. Handing pandoc `--pdf-engine` did
        // neither — it produced LaTeX on stdout and exited 0 — and running the engine ourselves is
        // also what makes the failure attributable: a non-zero exit is the engine's, and an output
        // that is not a PDF is caught by the header check below rather than by the file extension.
        const texPath = join(work, 'manuscript.tex')
        await this.runToFile(markdown, PDF_ARGS, texPath)
        const engine = this.config.latexEngine ?? ''
        const run_ = await this.engineRunner({
          executable: engine,
          workDir: work,
          texPath,
          timeoutMs: this.timeoutMs,
        })
        if (run_.code !== 0) {
          throw new Error(
            `'${engine}' exited ${String(run_.code)}: `
            + (run_.stderr.trim() === '' ? run_.stdout.trim() : run_.stderr.trim()),
          )
        }
        const target = join(work, 'manuscript.pdf')
        // AN ENGINE THAT WROTE NOTHING IS THE SAME FAILURE AS ONE THAT WROTE THE WRONG THING, and both
        // are reported as "no PDF": the alternative is a filesystem error naming a temporary path,
        // which tells a reader nothing about the tool that failed.
        if (!existsSync(target)) {
          throw new Error(`'${engine}' produced no PDF (it wrote no file where its output belongs)`)
        }
        const bytes = readFileSync(target)
        const header = bytes.subarray(0, 5).toString('latin1')
        if (header !== '%PDF-') {
          throw new Error(`'${engine}' produced no PDF (output begins '${header}')`)
        }
        return {
          format: 'pdf',
          fileName: 'manuscript.pdf',
          content: bytes.toString('base64'),
          encoding: 'base64',
          tool: this.tool,
          assets: { embedded, dropped },
          files,
        }
      }
      return {
        format: request.format,
        fileName: request.format === 'html' ? 'manuscript.html' : 'manuscript.tex',
        content: stdout,
        encoding: 'utf8',
        tool: this.tool,
        assets: { embedded, dropped },
        files,
      }
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  }

  /** Run pandoc with the document on stdin and return its stdout as text. */
  private async runToStdout(markdown: string, args: ReadonlyArray<string>): Promise<string> {
    const result = await run(this.config.executable, [...args], markdown, this.timeoutMs)
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() === '' ? `exit ${String(result.code)}` : result.stderr.trim())
    }
    return result.stdout
  }

  /** Run pandoc writing its output to a file. */
  private async runToFile(markdown: string, args: ReadonlyArray<string>, target: string): Promise<void> {
    const result = await run(this.config.executable, [...args, '-o', target], markdown, this.timeoutMs)
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() === '' ? `exit ${String(result.code)}` : result.stderr.trim())
    }
  }
}
