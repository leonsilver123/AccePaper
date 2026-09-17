/**
 * The PDF path, and the figures a compiled document can and cannot carry.
 *
 * WHAT THESE CAN AND CANNOT PROVE. This host has pandoc and NO LaTeX engine, so nothing here typesets
 * a document: the engine is a stand-in that writes a minimal, structurally-valid PDF where a real one
 * would write its output. What is REAL in every case is pandoc itself, the temporary files, the byte
 * handling, the header check and the package round-trip — which is where the defect was. Whether LaTeX
 * sets the document correctly is a question this file cannot answer, and does not claim to.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
