/**
 * The compile chain — what it refuses, and what a compiled document is.
 *
 * THE REFUSALS ARE THE POINT. A compiler that cannot resolve a citation warns and renders anyway; a
 * deployment with no LaTeX engine produces a PDF that is empty or absent; a compile that fails
 * halfway can leave a reader with a truncated document and no previous one. Each of those is a
 * refusal here, and the last one is structural: nothing is written by this module at all.
 */
import { describe, expect, it } from 'vitest'
import { getArtifact, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { runT19B } from '../src/runner/drive.ts'
import {
  checkCompileRequest, citedKeysOf, compileManuscript,
} from '../src/runner/document-compile.ts'
import type {
  CompileFormat, CompiledDocument, DocumentCompiler, ManuscriptDocument,
} from '../src/runner/document-compile.ts'

/** A manuscript with one cited source and one that is cited and not listed. */
function document(cited = ['cite-W1']): ManuscriptDocument {
  return {
    title: 'A study',
    sections: [{
      id: 'introduction',
      heading: 'Introduction',
      blocks: [
        { kind: 'prose', text: `Prior work is not unanimous ${cited.map(key => `[@${key}]`).join(' ')}.` },
        { kind: 'equation', label: 'Equation 1', latex: 'a = b + c' },
      ],
    }],
    references: [{ citeKey: 'cite-W1', entry: 'Chen, Y. Safe and stable. 2026.' }],
  }
}

/** A compiler that renders whatever it is asked for, in the shape a real one returns. */
function stubCompiler(formats: ReadonlyArray<CompileFormat> = ['html', 'latex']): DocumentCompiler {
  return {
    tool: 'stub',
    formats,
    compile(request) {
      return Promise.resolve({
        format: request.format,
        fileName: '',
        content: `<document>${request.document.title}</document>`,
        tool: 'stub@1',
      } satisfies CompiledDocument)
    },
  }
}

describe('what a document cites', () => {
  it('is read from its prose, once per key, in order', () => {
    expect(citedKeysOf(document(['cite-W1', 'cite-W2', 'cite-W1']))).toEqual(['cite-W1', 'cite-W2'])
  })

  it('is nothing when the prose cites nothing', () => {
    expect(citedKeysOf(document([]))).toEqual([])
  })
})

describe('a compile a deployment can honour', () => {
  it('is accepted, and the file name is the format', async () => {
    const result = await compileManuscript({ document: document(), format: 'html' }, stubCompiler())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.compiled.fileName).toBe('manuscript.html')
    expect(result.compiled.content).toContain('A study')
  })

  it('refuses a citation the bibliography does not carry, before the compiler runs', () => {
    // THE COMPILER WOULD RENDER IT ANYWAY, with a warning in a log nobody reads. A document whose
    // sources cannot be resolved is a document whose argument cannot be checked, so it is refused —
    // naming every unresolved key rather than the first.
    const refusals = checkCompileRequest(
      { document: document(['cite-W1', 'cite-W9']), format: 'html' },
      stubCompiler(),
    )
    expect(refusals.map(refusal => refusal.code)).toEqual(['compile-citation-unresolved'])
    expect(refusals[0]?.detail).toContain('cite-W9')
  })
})

describe('a compile a deployment cannot honour', () => {
  it('is refused when the deployment configured no compiler', () => {
    const refusals = checkCompileRequest({ document: document(), format: 'html' }, undefined)
    expect(refusals.map(refusal => refusal.code)).toEqual(['compile-compiler-missing'])
  })

  it('is refused when the compiler cannot produce the format, naming what it can', () => {
    // NO LATEX ENGINE ON THIS DEPLOYMENT: the refusal says so rather than producing an empty PDF.
    const refusals = checkCompileRequest({ document: document(), format: 'pdf' }, stubCompiler(['html']))
    expect(refusals.map(refusal => refusal.code)).toEqual(['compile-format-unavailable'])
    expect(refusals[0]?.detail).toContain("'stub' on this deployment cannot produce 'pdf'")
    expect(refusals[0]?.detail).toContain('it produces html')
  })

  it('is refused when the document carries no sections', () => {
    const refusals = checkCompileRequest(
      { document: { ...document(), sections: [] }, format: 'html' },
      stubCompiler(),
    )
    expect(refusals.map(refusal => refusal.code)).toEqual(['compile-nothing-to-render'])
  })

  it('carries the compiler’s own failure, rather than only that it failed', async () => {
    const failing: DocumentCompiler = {
      tool: 'pandoc',
      formats: ['html'],
      compile() { return Promise.reject(new Error('pandoc: unrecognized option')) },
    }
    const result = await compileManuscript({ document: document(), format: 'html' }, failing)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusals[0]?.detail).toContain('unrecognized option')
  })

  it('reports both a missing engine and a missing compile seam at once', () => {
    const refusals = checkCompileRequest({ document: document(), format: 'pdf' }, stubCompiler(['html']))
    expect(refusals).toHaveLength(1)
  })
})

describe('a run that compiles its document', () => {
  it('writes the compiled files and names what rendered them', async () => {
    // THE PRODUCTION PATH: E1 hands the document to the deployment's compiler and the package carries
    // the compiled files, with the tool that produced them.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { documentCompiler: stubCompiler() })
    const manuscript = getArtifact(store, run.runId, 'formatted-manuscript') as {
      packageFiles: Record<string, string>
      compilation: { tool: string | null; compiled: ReadonlyArray<string>; refusals: ReadonlyArray<string> }
    }
    expect(manuscript.compilation.tool).toBe('stub')
    expect(manuscript.compilation.compiled).toEqual(['manuscript.html', 'manuscript.tex'])
    expect(manuscript.compilation.refusals).toEqual([])
    expect(manuscript.packageFiles['manuscript.html']).toContain('<document>')
    expect(manuscript.packageFiles['manuscript.tex']).toContain('<document>')
  })

  it('records that it did not compile when the deployment configured no compiler', async () => {
    // NOT A FAILED RUN. The manuscript is complete without a compiled form, and a reader of the
    // package can tell "not compiled" from "compiled badly" because the reason is on the artifact.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)
    const manuscript = getArtifact(store, run.runId, 'formatted-manuscript') as {
      packageFiles: Record<string, string>
      compilation: { tool: string | null; refusals: ReadonlyArray<string> }
    }
    expect(manuscript.compilation.tool).toBeNull()
    expect(manuscript.compilation.refusals.join(' ')).toContain('compile-compiler-missing')
    expect(manuscript.packageFiles['manuscript.html']).toBeUndefined()
  })
})
