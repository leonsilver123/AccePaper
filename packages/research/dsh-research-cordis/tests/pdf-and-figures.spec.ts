/**
 * The PDF path, and the figures a compiled document can and cannot carry.
 *
 * TWO KINDS OF EVIDENCE, AND THEY ARE NOT THE SAME. Most cases here run a STAND-IN engine that writes
 * a structurally-valid PDF where a real one would: those prove this file's own byte handling, the
 * header check and the package round-trip — which is where the defect was — and they prove nothing
 * about whether LaTeX can set what pandoc writes. A real engine is a separate block, runs only where
 * a machine has one, and is the only place that question is answered.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { PandocCompiler } from '../src/pandoc-compiler.ts'
import type { EngineRunner } from '../src/pandoc-compiler.ts'

/** The stand-in engine: run a Node script that writes a real PDF file where a LaTeX engine would. */
const STAND_IN_ENGINE = join(import.meta.dirname, 'fixtures', 'pdf-engine.cmd')

/** A runner that runs the stand-in through Node, since a `.cmd` cannot be spawned directly. */
const runStandInEngine: EngineRunner = async ({ workDir, texPath, timeoutMs }) => {
  const script = join(import.meta.dirname, 'fixtures', 'pdf-engine.mjs')
  const { spawn } = await import('node:child_process')
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, texPath], { cwd: workDir })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('stand-in engine timed out')) }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (error: Error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code: number | null) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }) })
  })
}

/** An engine that exits zero and writes LaTeX — the failure the PDF path used to have. */
const runLyingEngine: EngineRunner = async () => ({ code: 0, stdout: '\\documentclass{article}', stderr: '' })

/** An engine that fails, so the exit-code path is exercised. */
const runFailingEngine: EngineRunner = async () => ({ code: 1, stdout: '', stderr: '! Undefined control sequence.' })

/** The document the compiler is asked to render: a figure with its raster, and a diagram. */
const DOCUMENT = {
  title: 'A study',
  sections: [{
    id: 'results',
    heading: 'Results',
    blocks: [
      { kind: 'prose' as const, text: 'The quantity fell [@cite-W1].' },
      {
        kind: 'figure' as const,
        label: 'Figure 1',
        caption: 'The comparison.',
        svg: '<svg width="10" height="10"></svg>',
        pngBase64: readFileSync(join(import.meta.dirname, 'fixtures', 'figure-1.png')).toString('base64'),
      },
    ],
  }],
  references: [{ citeKey: 'cite-W1', entry: 'Chen, Y. 2026.', number: 1 }],
}

/** A compiler that has pandoc, a stand-in engine and a Node runner for it. */
function compilerWith(runner: EngineRunner): PandocCompiler {
  return new PandocCompiler({ executable: 'pandoc', latexEngine: STAND_IN_ENGINE }, ['html', 'latex', 'pdf'], runner)
}

describe('a document compiled to PDF', () => {
  it('is a PDF, byte for byte, and not a LaTeX file named .pdf', async () => {
    // THE DEFECT THIS HOLDS SHUT: the branch used to pass `-t latex --pdf-engine=…`, take pandoc's
    // stdout and name it `manuscript.pdf` — exit code 0, and a text file where a PDF was promised.
    const compiled = await compilerWith(runStandInEngine)
      .compile({ document: DOCUMENT, format: 'pdf', mode: 'submission' })

    expect(compiled.encoding).toBe('base64')
    expect(compiled.fileName).toBe('manuscript.pdf')
    const bytes = Buffer.from(compiled.content, 'base64')
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    // THE BYTES ARE THE FILE: decoding what comes back reproduces what the engine wrote, so a writer
    // that stores the content stores the document rather than a re-encoding of it.
    expect(bytes.toString('utf8')).toContain('%%EOF')
    expect(bytes.toString('utf8')).not.toContain('\\documentclass')
  })

  it('is refused when the engine exits non-zero, with the engine’s own words', async () => {
    await expect(compilerWith(runFailingEngine)
      .compile({ document: DOCUMENT, format: 'pdf', mode: 'submission' }))
      .rejects.toThrow(/Undefined control sequence/u)
  })

  it('is refused when the engine produced something that is not a PDF', async () => {
    // AN ENGINE THAT EXITED ZERO AND WROTE LATEX. The header check is what stops that from becoming a
    // file named `manuscript.pdf`.
    await expect(compilerWith(runLyingEngine)
      .compile({ document: DOCUMENT, format: 'pdf', mode: 'submission' }))
      .rejects.toThrow(/produced no PDF/u)
  })

  it('is refused when the LaTeX source cannot be written, rather than reported as compiled', async () => {
    const noPandoc = new PandocCompiler({ executable: 'pandoc-that-is-not-installed', latexEngine: STAND_IN_ENGINE }, ['html'], runStandInEngine)
    await expect(noPandoc.compile({ document: DOCUMENT, format: 'pdf', mode: 'submission' }))
      .rejects.toThrow(/cannot produce 'pdf'/u)
  })
})

/**
 * The LaTeX engine this machine has, when it has one.
 *
 * ABSENT IS THE COMMON CASE and is not a failure: whether a machine has TeX is a fact about the
 * machine, which is why `document.latexEngine` is a deployment setting. A build with no engine here
 * still checks everything above — pandoc, the temporary files, the byte handling, the header check —
 * and this block is the part it cannot answer.
 *
 * @returns the executable, or undefined.
 */
function realEngine(): string | undefined {
  const candidates = [
    process.env['DSH_LATEX_ENGINE'],
    resolve('.workbuddy/tmp/tex/TinyTeX/bin/windows/pdflatex.exe'),
    '/usr/bin/pdflatex',
    '/Library/TeX/texbin/pdflatex',
  ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)
  // ABSOLUTE, because the engine is spawned with the compile's temporary directory as its cwd — a
  // relative path resolves there and the engine is not found.
  return candidates.find(candidate => existsSync(candidate))
}

const ENGINE = realEngine()

// A REAL ENGINE IS DIFFERENT EVIDENCE FROM A STAND-IN ONE. The stand-in proves this file's own byte
// handling; it cannot prove that what pandoc writes is something LaTeX can set, which is the question
// the manuscript's mathematics and its tables actually raise.
describe.skipIf(ENGINE === undefined)('a document compiled by a real LaTeX engine', () => {
  it('compiles the mathematics the manuscript writes, and the figure it embeds', async () => {
    // MEASURED, 2026-09-18: a real manuscript wrote "Δ" and "−38.2" in its prose — correctly, because
    // that is what the study computed — and pdfLaTeX refused the whole document with
    // `Unicode character Δ (U+0394)`. The compiler now states the character as TeX mathematics, and
    // this is the case that says the source it produces really is settable.
    const withMath = {
      title: 'A study',
      sections: [{
        id: 'results',
        heading: 'Results',
        blocks: [
          { kind: 'prose' as const, text: 'The effect fell by −38.2 % and Δ stayed positive [@cite-W1].' },
          {
            kind: 'table' as const,
            label: 'Table 1',
            caption: 'The measurements.',
            markdown: '| arm | throughput |\n| --- | --- |\n| coalesced | 86.7 |',
          },
          {
            kind: 'equation' as const,
            label: 'Eq. 1',
            latex: '\\Delta = \\alpha - \\beta',
          },
          {
            kind: 'figure' as const,
            label: 'Figure 1',
            caption: 'The comparison.',
            svg: '<svg width="10" height="10"></svg>',
            pngBase64: readFileSync(join(import.meta.dirname, 'fixtures', 'figure-1.png')).toString('base64'),
          },
        ],
      }],
      references: [{ citeKey: 'cite-W1', entry: 'Chen, Y. 2026.', number: 1 }],
    }
    // The case is skipped without an engine, so the value is asserted rather than passed through:
    // `exactOptionalPropertyTypes` will not accept a possibly-undefined value where the config
    // declares a string.
    const engine = ENGINE
    if (engine === undefined) throw new Error('unreachable: the case is skipped without an engine')
    const compiler = new PandocCompiler({ executable: 'pandoc', latexEngine: engine }, ['html', 'latex', 'pdf'])
    const compiled = await compiler.compile({ document: withMath, format: 'pdf', mode: 'submission' })

    // A REAL PDF FROM A REAL ENGINE, and the deliverable's own content is inside it: the figure, the
    // mathematics and the prose are in the file a journal would receive.
    const bytes = Buffer.from(compiled.content, 'base64')
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(10_000)
    // THE PROSE IS IN THE PDF AS TEXT, not as a scanned image of it. `pdftotext` is not assumed here,
    // so the check is that the engine produced a pdfTeX document at all rather than a fallback — the
    // PDF's own trailer names the producer, and a compile that had failed would not have written one.
    expect(bytes.toString('latin1')).toContain('%%EOF')
    expect(compiled.assets.embedded).toEqual(['Figure 1'])
    expect(compiled.assets.dropped).toEqual([])
  }, 300_000)

  it('refuses a document whose reference list carries a script this engine cannot set', async () => {
    // THE HONEST LIMIT. A retrieved venue name is data, and the compiler does not rewrite it: the PDF
    // then fails, and it fails with the character NAMED, which is a state a reader can act on. That is
    // the alternative to silently stripping a reference — and the DOCX and LaTeX deliverables carry
    // the name either way.
    const withCjk = {
      title: 'A study',
      sections: [{
        id: 'references',
        heading: 'References',
        blocks: [{ kind: 'prose' as const, text: '1. Chen, Y. 2026. 西南交通大学学报：英文版, 10.1000/x.' }],
      }],
      references: [],
    }
    // The case is skipped without an engine, so the value is asserted rather than passed through:
    // `exactOptionalPropertyTypes` will not accept a possibly-undefined value where the config
    // declares a string.
    const engine = ENGINE
    if (engine === undefined) throw new Error('unreachable: the case is skipped without an engine')
    const compiler = new PandocCompiler({ executable: 'pandoc', latexEngine: engine }, ['html', 'latex', 'pdf'])
    const failure = await compiler.compile({ document: withCjk, format: 'pdf', mode: 'submission' })
      .then(() => undefined, (error: unknown) => error as Error)
    expect(failure).toBeInstanceOf(Error)
    // NAMED, so a reader knows which character and which format could set it — not "exited 1".
    expect(failure?.message).toMatch(/Unicode character/u)
    expect(failure?.message).toMatch(/U\+897F/u)
    // AND THE DELIVERABLES ARE UNAFFECTED: the same document compiles as LaTeX, which is what the
    // deployment hands over, and the name is in it verbatim.
    const latex = await compiler.compile({ document: withCjk, format: 'latex', mode: 'submission' })
    expect(latex.content).toContain('西南交通大学学报：英文版')
  }, 300_000)
})

describe('the characters a manuscript writes that LaTeX cannot set', () => {
  it('states a mathematical character as the mathematics it is, instead of refusing the paper', async () => {
    // MEASURED, 2026-09-18: a real manuscript wrote "Δ" and "−38.2" in its prose — correctly, because
    // that is what the study computed — and pdfLaTeX refused the document. The remedy is not to strip
    // the character (that changes what the paper says) and not to ask the model to write around its
    // toolchain; the compiler states the character as math, which is what it was.
    const withMath = {
      ...DOCUMENT,
      sections: [{
        id: 'results',
        heading: 'Results',
        blocks: [{ kind: 'prose' as const, text: 'The effect fell by −38.2 % and Δ stayed positive [@cite-W1].' }],
      }],
    }
    const compiled = await compilerWith(runStandInEngine)
      .compile({ document: withMath, format: 'latex', mode: 'submission' })
    expect(compiled.content).toContain('\\ensuremath{-}38.2')
    expect(compiled.content).toContain('\\ensuremath{\\Delta}')
    // NOT `$…$`. Pandoc's Markdown reader refuses to read `$…$` as mathematics when the closing `$` is
    // followed by a digit, and a minus sign is always in that position — `$-$38.2` reached the source
    // as the literal text `\$-\$38.2`, which is what the first version of this did.
    expect(compiled.content).not.toContain('\\$')
    // THE WORDS ARE STILL THERE. A compiler that made the document build by deleting the character
    // would have changed the study's result; these are set as mathematics, not removed.
    expect(compiled.content).toContain('The effect fell by')
  })

  it('leaves the character alone where the writer sets it as itself', async () => {
    // HTML IS UTF-8. Restating a character the browser already has would put TeX command names in the
    // reader's page, so the transformation belongs to the two formats pandoc writes through LaTeX.
    const withMath = {
      ...DOCUMENT,
      sections: [{
        id: 'results',
        heading: 'Results',
        blocks: [{ kind: 'prose' as const, text: 'The effect fell by −38.2 % and Δ stayed positive.' }],
      }],
    }
    const compiled = await compilerWith(runStandInEngine)
      .compile({ document: withMath, format: 'html', mode: 'submission' })
    expect(compiled.content).toContain('−38.2')
    expect(compiled.content).toContain('Δ')
    expect(compiled.content).not.toContain('ensuremath')
  })

  it('leaves a character it does not know exactly as the manuscript wrote it', async () => {
    // A REFERENCE CARRIES THE VENUE'S OWN NAME, which is often not Latin: `西南交通大学学报：英文版` is the
    // name OpenAlex returned for the journal, and it is retrieved data, not prose the model composed.
    // The compiler knows no LaTeX for it, so it sets the text rather than inventing a rendering — and
    // the optional PDF then fails with a reason that names the character, which is a state a reader
    // can act on and not a manuscript this pipeline silently rewrote.
    const withVenue = {
      ...DOCUMENT,
      sections: [
        ...DOCUMENT.sections,
        { id: 'references', heading: 'References', blocks: [{ kind: 'prose' as const, text: '1. Chen, Y. 2026. 西南交通大学学报：英文版, 10.1000/x.' }] },
      ],
    }
    const compiled = await compilerWith(runStandInEngine)
      .compile({ document: withVenue, format: 'latex', mode: 'submission' })
    expect(compiled.content).toContain('西南交通大学学报：英文版')
  })

  it('refuses the PDF by quoting the engine’s own words about the character', async () => {
    // BATCH MODE PRINTS NOTHING. The reason lives in `<jobname>.log`, so a refusal that reported the
    // engine's stdout would say only "This is pdfTeX … entering extended mode" — which names neither
    // the file nor the character. The log is where the useful sentence is.
    const runEngineThatLogs = async ({ workDir, texPath }: Parameters<EngineRunner>[0]) => {
      writeFileSync(join(workDir, basename(texPath).replace(/\.tex$/u, '.log')),
        'This is pdfTeX\n! Package inputenc Error: Unicode character 西 (U+897F)\n!  ==> Fatal error occurred\n')
      return { code: 1, stdout: 'This is pdfTeX, Version 3.14\nentering extended mode\n', stderr: '' }
    }
    await expect(compilerWith(runEngineThatLogs)
      .compile({ document: DOCUMENT, format: 'pdf', mode: 'submission' }))
      .rejects.toThrow(/Unicode character 西 \(U\+897F\)/u)
  })
})

describe('the figures a document carries', () => {
  it('embeds the raster in LaTeX and reports it, so the figure is in the document and in the assets', async () => {
    // LATEX HAS NO SVG SUPPORT. The figure the tool drew as SVG is embedded as the PNG the SAME tool
    // produced from the same spec — and the asset travels with the document, so the .tex is buildable
    // outside this run and the figure can be reconciled by its label.
    const compiled = await compilerWith(runStandInEngine)
      .compile({ document: DOCUMENT, format: 'latex', mode: 'submission' })

    expect(compiled.assets.embedded).toEqual(['Figure 1'])
    expect(compiled.assets.dropped).toEqual([])
    expect(compiled.content).toContain('includegraphics')
    expect(compiled.files.map(file => file.path)).toEqual(['assets/figure-1.png'])
    expect(Buffer.from(compiled.files[0]?.base64 ?? '', 'base64').subarray(1, 4).toString('latin1')).toBe('PNG')
  })

  it('embeds the SVG in HTML, where the browser renders it', async () => {
    const compiled = await compilerWith(runStandInEngine)
      .compile({ document: DOCUMENT, format: 'html', mode: 'submission' })
    expect(compiled.assets.embedded).toEqual(['Figure 1'])
    expect(compiled.content).toContain('<svg')
  })

  it('reports a diagram as NOT embedded, in every format', async () => {
    // A MERMAID BLOCK IS SOURCE. Printing it under a figure caption puts a number on a code listing,
    // and a document that did so while reporting success would be claiming a figure the reader cannot
    // see. Here it is dropped and NAMED.
    const withDiagram = {
      ...DOCUMENT,
      sections: [{
        id: 'results',
        heading: 'Results',
        blocks: [
          ...DOCUMENT.sections[0]!.blocks,
          { kind: 'diagram' as const, label: 'Figure 2', caption: 'The roadmap.', mermaid: 'graph TD; A-->B;' },
        ],
      }],
    }
    for (const format of ['html', 'latex'] as const) {
      const compiled = await compilerWith(runStandInEngine)
        .compile({ document: withDiagram, format, mode: 'draft' })
      expect(compiled.assets.embedded, format).toEqual(['Figure 1'])
      expect(compiled.assets.dropped.map(entry => entry.label), format).toEqual(['Figure 2'])
      expect(compiled.assets.dropped[0]?.reason, format).toContain('no static rendering')
    }
  })
})
