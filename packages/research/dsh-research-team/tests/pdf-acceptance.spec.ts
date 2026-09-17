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
import { PandocCompiler } from '../../dsh-research-cordis/src/pandoc-compiler.ts'
import { compileManuscript, documentOf } from '../src/runner/document-compile.ts'

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

const ENGINE = latexEngine()
const PYTHON = pdfPython()

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
  })
})
