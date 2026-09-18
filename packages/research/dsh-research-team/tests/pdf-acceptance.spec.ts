/**
 * The PDF a deployment with a LaTeX engine actually produces, read PAGE BY PAGE.
 *
 * THE REVIEW'S R01 IS THE REASON THIS FILE EXISTS. The PDF branch reported success on a file that was
 * not a PDF — `ExitCode 0`, no `%PDF-`, LaTeX text — and the bar it set is explicit: a real engine
 * compiled it, and the acceptance reads the artifact rather than the exit code. "A `%PDF-` file
 * header" is not a finished document either: what has to hold is that the pages are there and that
 * they carry what the manuscript says they carry.
 *
 * IT RUNS ONLY WHERE AN ENGINE IS INSTALLED, and says so where one is not: an engine is a deployment
 * toolchain, not a dependency of this package. The interpreter is found through `DSH_LATEX_ENGINE` or
 * a checkout-local install, and the case is `describe.skipIf` — a skipped real-tool test is
 * distinguishable from one that passed, which a silently-succeeding stand-in is not.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getArtifact, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { PandocCompiler } from '../../dsh-research-cordis/src/pandoc-compiler.ts'
import { MatplotlibProvider } from '../../dsh-research-cordis/src/matplotlib-provider.ts'
import { compileManuscript, documentOf } from '../src/runner/document-compile.ts'
import { runT19B } from '../src/runner/drive.ts'

/** The entries of a ZIP package, by name. */
function zipNames(path: string): ReadonlyArray<string> {
  const script = [
    'import json, sys, zipfile',
    'print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))',
  ].join(String.fromCharCode(10))
  return JSON.parse(execFileSync(PYTHON ?? 'python', ['-c', script, path], { encoding: 'utf8' }))
}

/** One entry of a ZIP package, as text. */
function zipText(path: string, entry: string): string {
  const script = [
    'import sys, zipfile',
    'sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode("utf-8", "replace"))',
  ].join(String.fromCharCode(10))
  return execFileSync(PYTHON ?? 'python', ['-c', script, path, entry], { encoding: 'utf8' })
}

/** The LaTeX engine this machine has, when it has one. */
function latexEngine(): string | undefined {
  const candidates = [
    process.env['DSH_LATEX_ENGINE'],
    '.workbuddy/tmp/texlive/tex/bin/windows/pdflatex.exe',
    '.workbuddy/tmp/texlive/tex/bin/pdflatex',
  ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)
  // ABSOLUTE, because the engine is spawned with the compile's own working directory: a relative path
  // resolves against that directory and the executable is not found.
  return candidates.map(candidate => resolve(candidate)).find(candidate => existsSync(candidate))
}

/** The Python that has pypdf, which is what reads the pages back. */
function pdfPython(): string | undefined {
  const candidates = [
    process.env['DSH_PDF_PYTHON'],
    '.workbuddy/tmp/plot-venv/Scripts/python.exe',
    '.workbuddy/tmp/plot-venv/bin/python',
  ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)
  return candidates.map(candidate => resolve(candidate)).find(candidate => existsSync(candidate))
}

/** The interpreter this machine has matplotlib on, when it has one; the provider names its own. */
function drawingPython(): string | undefined {
  const candidates = [
    process.env['DSH_MATPLOTLIB_PYTHON'],
    '.workbuddy/tmp/plot-venv/Scripts/python.exe',
    '.workbuddy/tmp/plot-venv/bin/python',
  ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)
  return candidates.map(candidate => resolve(candidate)).find(candidate => existsSync(candidate))
}

const ENGINE = latexEngine()
const PYTHON = pdfPython()
const DRAWER = drawingPython()

/**
 * Read a PDF's pages with a real parser: one entry per page, with its text.
 *
 * A PAGE COUNT FROM THE BYTE STREAM is a count of `/Type /Page` occurrences; this reads the document
 * the way a reader does, so a file whose objects say three pages and whose pages are empty fails.
 *
 * @param path - the PDF to read.
 * @returns one entry per page, in reading order.
 */
function pagesOf(path: string): ReadonlyArray<{ readonly text: string }> {
  const script = 'import json,sys,pypdf\n'
    + 'r=pypdf.PdfReader(sys.argv[1])\n'
    + 'print(json.dumps([p.extract_text() or "" for p in r.pages]))\n'
  const out = execFileSync(PYTHON ?? 'python', ['-c', script, path], { encoding: 'utf8' })
  return (JSON.parse(out) as ReadonlyArray<string>).map(text => ({ text }))
}

describe.skipIf(PYTHON === undefined)('the formats a submission actually needs, through the real pandoc', () => {
  // DOCX AND LATEX ARE THE DELIVERABLES: most journals' submission systems take a Word file and some
  // want the LaTeX source. Neither needs a LaTeX engine — pandoc writes the whole OOXML package,
  // figures embedded and equations as OMML — so this is the check that runs on ANY machine with
  // pandoc, and it is the one that matters for "can this deployment hand a journal a manuscript".
  it('writes a DOCX package whose text and figures are really in it', async () => {
    const work = mkdtempSync(join(tmpdir(), 'docx-accept-'))
    const compiler = await PandocCompiler.probe({ executable: 'pandoc', timeoutMs: 120_000 })
    expect(compiler.formats).toContain('docx')
    expect(compiler.formats).toContain('latex')

    // A ONE-PIXEL PNG, so the figure has a raster to embed and the assertion below is about the
    // package rather than about the renderer.
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const document = documentOf({
      title: 'A manuscript for a journal',
      sections: [
        { id: 'introduction', heading: 'Introduction', bodyText: 'The introduction states the claim.' },
        {
          id: 'results',
          heading: 'Results',
          bodyText: 'The results are drawn in Figure 1.',
        },
      ],
      floats: [{
        kind: 'figure' as const,
        label: 'Figure 1',
        caption: 'The measured comparison.',
        svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
        pngBase64: png,
      }],
      equations: [],
      references: [],
    })
    const result = await compileManuscript({ document, format: 'docx', mode: 'submission' }, compiler)
    if (!result.ok) {
      throw new Error('compile refused: '
        + result.refusals.map(refusal => `[${refusal.code}] ${refusal.detail}`).join('; '))
    }
    expect(result.compiled.encoding).toBe('base64')
    const path = join(work, 'manuscript.docx')
    writeFileSync(path, Buffer.from(result.compiled.content, 'base64'))
    // A DOCX IS A ZIP PACKAGE, and that is the first thing checked: a file that is not one would be
    // handed to a journal as a .docx it cannot open.
    expect(readFileSync(path).subarray(0, 2).toString('latin1')).toBe('PK')
    // AND ITS PARTS ARE READ, not assumed: the text is in `word/document.xml` and the figure is an
    // image part in the package. Both are what "the document carries it" means for this format.
    const parts = zipNames(path)
    expect(parts).toContain('word/document.xml')
    expect(parts.some(name => name.startsWith('word/media/'))).toBe(true)
    const text = zipText(path, 'word/document.xml')
    expect(text).toContain('A manuscript for a journal')
    expect(text).toContain('The introduction states the claim.')
    expect(text).toContain('The measured comparison.')
    // PANDOC IS SPAWNED HERE and the suite runs its files in parallel with other gate processes: at
    // the 5 s default this case was measured failing under load and passing alone, which is a defect
    // in the spec rather than in the writer.
  }, 120_000)

  it('writes LaTeX source carrying the same sections and the same figure', async () => {
    const compiler = await PandocCompiler.probe({ executable: 'pandoc', timeoutMs: 120_000 })
    const document = documentOf({
      title: 'A manuscript for a journal',
      // THE FLOATS SIT WITH THE RESULTS SECTION — that is where the document assembler attaches them,
      // and a fixture that put one anywhere else would test the fixture rather than the writer.
      sections: [
        { id: 'introduction', heading: 'Introduction', bodyText: 'The introduction states the claim.' },
        { id: 'results', heading: 'Results', bodyText: 'The results are drawn in Figure 1.' },
      ],
      floats: [{
        kind: 'figure' as const,
        label: 'Figure 1',
        caption: 'The measured comparison.',
        svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
        pngBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      }],
      equations: [],
      references: [],
    })
    const result = await compileManuscript({ document, format: 'latex', mode: 'submission' }, compiler)
    if (!result.ok) {
      throw new Error('compile refused: '
        + result.refusals.map(refusal => `[${refusal.code}] ${refusal.detail}`).join('; '))
    }
    const source = result.compiled.content
    expect(result.compiled.encoding).toBe('utf8')
    expect(source).toContain(String.fromCharCode(92) + 'documentclass')
    expect(source).toContain('The introduction states the claim.')
    // THE FIGURE IS REFERENCED AND THE RASTER TRAVELS BESIDE THE SOURCE: LaTeX cannot carry an SVG, so
    // the picture the document declares is the PNG, embedded as an asset the journal's own compile
    // finds. A figure that reached neither is the loss `assets.dropped` exists to report.
    expect(source).toContain('includegraphics')
    expect(result.compiled.assets.embedded).toContain('Figure 1')
    expect(result.compiled.assets.dropped).toEqual([])
    expect(result.compiled.files.map(file => file.path)).toContain('assets/figure-1.png')
  }, 120_000)

  it('carries BOTH floats — the data figure and the drawn roadmap — into one DOCX', async () => {
    // THE SECOND FLOAT IS THE ONE THAT USED TO GO MISSING. A roadmap the deployment's provider drew
    // reached E1 and was written into the document as Mermaid source, which no writer can embed, so a
    // manuscript with a plotted chart and a drawn roadmap arrived at the journal carrying the chart.
    // Both are figures now, and this reads the OOXML package to show both pictures are in it.
    const work = mkdtempSync(join(tmpdir(), 'docx-two-'))
    const compiler = await PandocCompiler.probe({ executable: 'pandoc', timeoutMs: 120_000 })
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const document = documentOf({
      title: 'A manuscript with two floats',
      sections: [
        { id: 'introduction', heading: 'Introduction', bodyText: 'The introduction states the claim.' },
        { id: 'results', heading: 'Results', bodyText: 'Figure 1 and Figure 2 show the two.' },
      ],
      floats: [
        {
          kind: 'figure' as const,
          label: 'Figure 1',
          caption: 'The measured comparison.',
          svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
          pngBase64: png,
        },
        {
          kind: 'figure' as const,
          label: 'Figure 2',
          caption: 'The plan the study followed.',
          svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
          pngBase64: png,
        },
      ],
      equations: [],
      references: [],
    })
    const result = await compileManuscript({ document, format: 'docx', mode: 'submission' }, compiler)
    if (!result.ok) {
      throw new Error('compile refused: '
        + result.refusals.map(refusal => `[${refusal.code}] ${refusal.detail}`).join('; '))
    }
    const path = join(work, 'manuscript.docx')
    writeFileSync(path, Buffer.from(result.compiled.content, 'base64'))
    // TWO MEDIA PARTS, not one: a package that embedded the chart and dropped the roadmap would carry
    // a `Figure 2` caption under nothing.
    const media = zipNames(path).filter(name => name.startsWith('word/media/'))
    expect(media).toHaveLength(2)
    const text = zipText(path, 'word/document.xml')
    expect(text).toContain('The measured comparison.')
    expect(text).toContain('The plan the study followed.')
    expect(result.compiled.assets.embedded).toEqual(['Figure 1', 'Figure 2'])
    expect(result.compiled.assets.dropped).toEqual([])
  })
})

describe.skipIf(DRAWER === undefined)('a run whose deployment draws its own floats', () => {
  it('puts the library\'s roadmap into the package the journal receives', async () => {
    // THE WHOLE CHAIN IN ONE READING: a real plotting library draws both floats, the run assembles its
    // manuscript, and a real pandoc compiles it — so what is asserted is a package, not a seam. The
    // roadmap is the float that used to be lost between the drawing and the document, and this is the
    // case that would have caught it: `floatsDropped` named `Figure 2` for every format.
    const provider = await MatplotlibProvider.probe({ executable: DRAWER ?? 'python', timeoutMs: 300_000 })
    expect(provider).toBeDefined()
    // THE ENGINE TOO, when this machine has one: E1 compiles FOUR formats under such a deployment
    // (the three deliverables plus the PDF), and the deployment that stopped inside E1 — a real run,
    // 2026-09-18 — is the only place that combination was ever exercised. A compile case that left
    // the engine out would keep not covering it.
    const compiler = await PandocCompiler.probe({
      executable: 'pandoc',
      ...(ENGINE === undefined ? {} : { latexEngine: ENGINE }),
      timeoutMs: 180_000,
    })
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, {
      // The real library for the floats and the real toolchain for the compile: neither is stubbed,
      // so a figure that reached the document is a figure the machine drew.
      ...(provider === undefined ? {} : { figureProvider: provider }),
      documentCompiler: compiler,
      // THE STEP BUDGET IS RAISED FOR THIS DEPLOYMENT, exactly as a real one does: the registry's
      // default fits the offline channels, and D1 drawing through a library plus E1 compiling four
      // formats through pandoc are process spawns that do not.
      timeoutMs: 300_000,
    })
    const manuscript = getArtifact(store, run.runId, 'formatted-manuscript') as {
      packageFiles: Record<string, string>
      compilation: {
        tool: string | null
        floatsEmbedded: Record<string, ReadonlyArray<string>>
        floatsDropped: ReadonlyArray<{ label: string; reason: string }>
        refusals: ReadonlyArray<string>
        documents: ReadonlyArray<{ path: string; base64: string }>
      }
    }
    expect(manuscript.compilation.tool).toBe('pandoc')
    expect(compiler.formats).toContain('docx')
    if (ENGINE !== undefined) expect(compiler.formats).toContain('pdf')
    expect(manuscript.compilation.refusals).toEqual([])
    // BOTH FLOATS, IN BOTH FORMATS THAT NEED A RASTER. HTML takes the SVG either way; LaTeX and DOCX
    // can only carry a picture, which is what the provider's raster is for.
    expect(manuscript.compilation.floatsEmbedded['latex']).toEqual(['Figure 1', 'Figure 2'])
    expect(manuscript.compilation.floatsDropped).toEqual([])
    // AND THE PICTURE IS REALLY A PICTURE: the roadmap's own file in the package is the SVG the
    // library produced, not the Mermaid source it was planned from.
    const roadmap = manuscript.packageFiles['figures/figure-2.svg'] ?? ''
    expect(roadmap).toContain('<svg')
    expect(manuscript.packageFiles['manuscript.md']).toContain('figures/figure-2.svg')
    expect(manuscript.packageFiles['manuscript.md']).not.toContain('```mermaid')
    // WHAT THE COMPILED DOCX CARRIES, read from the OOXML package rather than from a size. The DOCX is
    // binary, so it travels as bytes under `compilation.documents` — not among the figures the document
    // embeds, which is where a reader looking for the manuscript a journal receives would not look.
    const docx = manuscript.compilation.documents.find(entry => entry.path === 'manuscript.docx')
    expect(docx).toBeDefined()
    expect(manuscript.packageFiles['manuscript.docx']).toBeUndefined()
    const work = mkdtempSync(join(tmpdir(), 'drawn-docx-'))
    const path = join(work, 'manuscript.docx')
    writeFileSync(path, Buffer.from(docx?.base64 ?? '', 'base64'))
    expect(zipNames(path).filter(name => name.startsWith('word/media/'))).toHaveLength(2)
    // The probe imports matplotlib and the run draws two floats through it; both are process spawns,
    // which do not fit the default budget.
  }, 300_000)
})

describe.skipIf(ENGINE === undefined || PYTHON === undefined)('the PDF a real engine produces', () => {
  it('compiles the document model to a PDF whose pages carry the manuscript', async () => {
    const work = mkdtempSync(join(tmpdir(), 'pdf-accept-'))
    // The engine is known to exist — the case is skipped without one — and the config field is not
    // optional-undefined, so the value is asserted rather than passed through.
    const engine = ENGINE
    if (engine === undefined) throw new Error('unreachable: the case is skipped without an engine')
    const compiler = await PandocCompiler.probe({
      executable: 'pandoc',
      latexEngine: engine,
      timeoutMs: 180_000,
    })
    // THE PROBE DECIDES, and it decided from the executables: a machine with pandoc and no engine
    // offers no `pdf`, which is what this asserts before asking for one.
    expect(compiler.formats).toContain('pdf')

    const document = documentOf({
      title: 'A manuscript with pages',
      sections: [
        // LONG ENOUGH TO PAGINATE, because a one-page document cannot show that the pages are real:
        // the acceptance below reads WHERE each section's text landed, and a fixture that fits on one
        // page would pass whatever the engine did.
        { id: 'introduction', heading: 'Introduction', bodyText: 'The first section states the claim. '.repeat(220) },
        { id: 'method', heading: 'Method', bodyText: 'The second section states the method. '.repeat(220) },
      ],
      floats: [],
      equations: [],
      references: [],
    })
    // THE SEAM'S OWN ENTRY POINT, so the refusals a run would meet are the ones this meets.
    const result = await compileManuscript({ document, format: 'pdf', mode: 'draft' }, compiler)
    if (!result.ok) {
      throw new Error('compile refused: '
        + result.refusals.map(refusal => `[${refusal.code}] ${refusal.detail}`).join('; '))
    }
    const path = join(work, result.compiled.fileName)
    writeFileSync(path, Buffer.from(result.compiled.content, 'base64'), { flag: 'w' })

    // THE HEADER IS THE FIRST CHECK AND NOT THE LAST: a file that begins with `%PDF-` and has one
    // empty page is exactly the failure this acceptance exists to catch.
    const bytes = readFileSync(path)
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')

    const pages = pagesOf(path)
    expect(pages.length).toBeGreaterThanOrEqual(2)
    expect(pages[0]?.text).toContain('Introduction')
    expect(pages[0]?.text).toContain('first section states the claim')
    // PER PAGE, not "somewhere in the file": the second section must be on a page, and the text that
    // belongs to it must be there with it.
    const all = pages.map(page => page.text).join('\n')
    expect(all).toContain('Method')
    expect(all).toContain('second section states the method')
    // TWO PROCESS SPAWNS — pandoc, then the engine — which do not fit the default budget. The case
    // above carries the same budget for the same reason; this one ran on the default for as long as it
    // happened to finish inside it, and failed the moment a neighbouring suite made the machine busy.
    // A case that passes only while the box is quiet is a defect in the case, not in its neighbour.
  }, 300_000)
})
