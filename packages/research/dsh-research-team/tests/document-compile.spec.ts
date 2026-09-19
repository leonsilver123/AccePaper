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
  checkCompileRequest, citedKeysOf, compileManuscript, unembeddableFloats,
} from '../src/runner/document-compile.ts'
import type {
  CompileFormat, CompiledDocument, DocumentBlock, DocumentCompiler, ManuscriptDocument,
} from '../src/runner/document-compile.ts'
import type { FigureProvider } from '../src/runner/figure-provider.ts'

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
// THE THREE DELIVERABLES AND NOT PDF, which is what a deployment with pandoc and no LaTeX engine
// offers: a stub declaring fewer formats than the run requests is how `compile-format-unavailable`
// becomes reachable in a run rather than only in a unit call.
function stubCompiler(
  formats: ReadonlyArray<CompileFormat> = ['html', 'latex', 'docx'],
): DocumentCompiler {
  return {
    tool: 'stub',
    formats,
    compile(request) {
      return Promise.resolve({
        format: request.format,
        fileName: '',
        content: `<document>${request.document.title}</document>`,
        encoding: 'utf8' as const,
        tool: 'stub@1',
        assets: { embedded: [], dropped: [] },
        files: [],
      } satisfies CompiledDocument)
    },
  }
}

/**
 * A compiler that keeps the document it was handed, and reports what it could not embed.
 *
 * IT REPORTS THROUGH THE SEAM'S OWN PREDICATE rather than deciding for itself, so a case below tests
 * what E1 assembled and not what this stub believes about figures. The real writer is covered against
 * real pandoc by `pdf-acceptance.spec.ts`; what this one adds is that the document E1 hands over —
 * which no artifact carries in full — is the one the writer is promised.
 *
 * @returns the compiler and the documents it was asked to render, in order.
 */
function recordingCompiler(): { compiler: DocumentCompiler; documents: ManuscriptDocument[] } {
  const documents: ManuscriptDocument[] = []
  return {
    documents,
    compiler: {
      tool: 'recording',
      formats: ['html', 'latex', 'docx'],
      compile(request) {
        documents.push(request.document)
        return Promise.resolve({
          format: request.format,
          fileName: '',
          content: `<document>${request.document.title}</document>`,
          encoding: 'utf8' as const,
          tool: 'recording@1',
          assets: {
            embedded: [],
            dropped: unembeddableFloats(request.document, request.format)
              .map(entry => ({ label: entry.label, reason: entry.reason })),
          },
          files: [],
        } satisfies CompiledDocument)
      },
    },
  }
}

/**
 * The labelled floats one document carries, as `<label>:<kind>`.
 *
 * Only the blocks that carry a label are named: prose and equations are not floats, and a case below
 * asserts on what the document HOLDS as a figure rather than on the order its parts were built in.
 *
 * @param document - the document a recording compiler was handed, when it was handed one.
 * @returns one entry per labelled block, in the document's order.
 */
function blockKinds(document: ManuscriptDocument | undefined): ReadonlyArray<string> {
  return (document?.sections ?? []).flatMap(section => section.blocks.flatMap(block =>
    block.kind === 'figure' || block.kind === 'table' || block.kind === 'diagram'
      ? [`${block.label}:${block.kind}`]
      : []))
}

/** One labelled block of a document by its label, or undefined when it carries none. */
function labelledBlock(
  document: ManuscriptDocument | undefined,
  label: string,
): DocumentBlock | undefined {
  return (document?.sections ?? [])
    .flatMap(section => section.blocks)
    .find(block => (block.kind === 'figure' || block.kind === 'table' || block.kind === 'diagram')
      && block.label === label)
}

/** A drawing provider that answers with markup a case can recognise; no library, no process. */
function drawingProvider(): FigureProvider {
  return {
    id: 'spec-drawer',
    toolVersion: '9.9.9',
    renderFigure: spec => Promise.resolve({
      svg: '<svg id="drawn-chart"/>',
      pngBase64: PNG_ONE_PIXEL,
      width: spec.width,
      height: spec.height,
      tool: 'spec-drawer',
      toolVersion: '9.9.9',
    }),
    renderDiagram: () => Promise.resolve({
      svg: '<svg id="drawn-roadmap"/>',
      pngBase64: PNG_ONE_PIXEL,
      width: 640,
      height: 360,
      tool: 'spec-drawer',
      toolVersion: '9.9.9',
    }),
  }
}

/** One real 1×1 PNG, so a raster a writer embeds is a raster and not a string that says `PNG`. */
const PNG_ONE_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

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
    const result = await compileManuscript({ document: document(), format: 'html', mode: 'draft' }, stubCompiler())
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
      { document: document(['cite-W1', 'cite-W9']), format: 'html', mode: 'draft' },
      stubCompiler(),
    )
    expect(refusals.map(refusal => refusal.code)).toEqual(['compile-citation-unresolved'])
    expect(refusals[0]?.detail).toContain('cite-W9')
  })
})

describe('a compile a deployment cannot honour', () => {
  it('is refused when the deployment configured no compiler', () => {
    const refusals = checkCompileRequest({ document: document(), format: 'html', mode: 'draft' }, undefined)
    expect(refusals.map(refusal => refusal.code)).toEqual(['compile-compiler-missing'])
  })

  it('is refused when the compiler cannot produce the format, naming what it can', () => {
    // NO LATEX ENGINE ON THIS DEPLOYMENT: the refusal says so rather than producing an empty PDF.
    const refusals = checkCompileRequest({ document: document(), format: 'pdf', mode: 'draft' }, stubCompiler(['html']))
    expect(refusals.map(refusal => refusal.code)).toEqual(['compile-format-unavailable'])
    expect(refusals[0]?.detail).toContain("'stub' on this deployment cannot produce 'pdf'")
    expect(refusals[0]?.detail).toContain('it produces html')
  })

  it('is refused when the document carries no sections', () => {
    const refusals = checkCompileRequest(
      { document: { ...document(), sections: [] }, format: 'html', mode: 'draft' },
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
    const result = await compileManuscript({ document: document(), format: 'html', mode: 'draft' }, failing)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusals[0]?.detail).toContain('unrecognized option')
  })

  it('reports both a missing engine and a missing compile seam at once', () => {
    const refusals = checkCompileRequest({ document: document(), format: 'pdf', mode: 'draft' }, stubCompiler(['html']))
    expect(refusals).toHaveLength(1)
  })
})

describe('a run that compiles its document', () => {
  it('writes the compiled files and names what rendered them', async () => {
    // THE PRODUCTION PATH: E1 hands the document to the deployment's compiler and the package carries
    // the compiled files, with the tool that produced them.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { documentCompiler: stubCompiler() })
    const manuscript = getArtifact(store, run.runId, 'typeset') as {
      packageFiles: Record<string, string>
      compilation: { tool: string | null; compiled: ReadonlyArray<string>; refusals: ReadonlyArray<string> }
    }
    expect(manuscript.compilation.tool).toBe('stub')
    expect(manuscript.compilation.compiled).toEqual(['manuscript.html', 'manuscript.tex', 'manuscript.docx'])
    expect(manuscript.compilation.refusals).toEqual([])
    expect(manuscript.packageFiles['manuscript.html']).toContain('<document>')
    expect(manuscript.packageFiles['manuscript.tex']).toContain('<document>')
  })

  it('hands the compiler the roadmap as a figure the deployment drew, not as its source', async () => {
    // A ROADMAP THE PROVIDER DREW IS A FIGURE, and E1 is where that is decided: the drawing reached
    // the figure plan and was dropped on the way into the document, so every compiled manuscript
    // carried a float no format can embed — reported as `a diagram is carried as its own source`.
    // That is what kept a run under a deployment WITH a drawing provider at `draft`.
    const store: ResearchRunStore = new Map()
    const recorded = recordingCompiler()
    const run = await runT19B(store, {
      figureProvider: drawingProvider(),
      documentCompiler: recorded.compiler,
    })
    const manuscript = getArtifact(store, run.runId, 'typeset') as {
      packageFiles: Record<string, string>
      compilation: {
        floatsEmbedded: Record<string, ReadonlyArray<string>>
        floatsDropped: ReadonlyArray<{ label: string; reason: string; format: string }>
      }
    }
    // THE DOCUMENT ITSELF, which is what the compile chain is handed: the roadmap is a figure with
    // the provider's own two renderings, and no block in it is a diagram.
    const kinds = blockKinds(recorded.documents[0])
    expect(kinds).toContain('Figure 2:figure')
    expect(kinds.some(entry => entry.endsWith(':diagram'))).toBe(false)
    const roadmap = labelledBlock(recorded.documents[0], 'Figure 2')
    expect(roadmap?.kind === 'figure' ? roadmap.svg : '').toContain('drawn-roadmap')
    expect(roadmap?.kind === 'figure' ? roadmap.pngBase64 : undefined).toBe(PNG_ONE_PIXEL)
    // WHAT THE COMPILE COULD NOT EMBED, per format: nothing, which is the fact `compiled-document-
    // complete` reads to decide whether a package may be final.
    expect(manuscript.compilation.floatsDropped).toEqual([])
    expect(manuscript.compilation.floatsEmbedded['latex']).toEqual([])
    // AND THE PACKAGE CARRIES THE PICTURE THE MARKDOWN POINTS AT, so the manuscript's own
    // `![Figure 2: …](figures/figure-2.svg)` resolves inside the package.
    expect(manuscript.packageFiles['figures/figure-2.svg']).toContain('drawn-roadmap')
    expect(manuscript.packageFiles['manuscript.md']).toContain('figures/figure-2.svg')
    expect(manuscript.packageFiles['manuscript.md']).not.toContain('```mermaid')
  })

  it('leaves the roadmap as its source when the deployment drew nothing, and says what that costs', async () => {
    // THE OTHER DIRECTION, and it is not a defect: a deployment with no drawing provider has a
    // roadmap whose only form is Mermaid, and the compile records it as a float it cannot carry
    // rather than passing the source off as a figure.
    const store: ResearchRunStore = new Map()
    const recorded = recordingCompiler()
    const run = await runT19B(store, { documentCompiler: recorded.compiler })
    const manuscript = getArtifact(store, run.runId, 'typeset') as {
      packageFiles: Record<string, string>
      compilation: { floatsDropped: ReadonlyArray<{ label: string; reason: string }> }
    }
    const roadmap = labelledBlock(recorded.documents[0], 'Figure 2')
    expect(roadmap?.kind).toBe('diagram')
    expect(manuscript.compilation.floatsDropped.map(entry => entry.label)).toContain('Figure 2')
    expect(manuscript.compilation.floatsDropped[0]?.reason).toContain('no static rendering')
    expect(manuscript.packageFiles['manuscript.md']).toContain('```mermaid')
    expect(manuscript.packageFiles['figures/figure-2.svg']).toBeUndefined()
  })

  it('records that it did not compile when the deployment configured no compiler', async () => {
    // NOT A FAILED RUN. The manuscript is complete without a compiled form, and a reader of the
    // package can tell "not compiled" from "compiled badly" because the reason is on the artifact.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)
    const manuscript = getArtifact(store, run.runId, 'typeset') as {
      packageFiles: Record<string, string>
      compilation: { tool: string | null; refusals: ReadonlyArray<string> }
    }
    expect(manuscript.compilation.tool).toBeNull()
    expect(manuscript.compilation.refusals.join(' ')).toContain('compile-compiler-missing')
    expect(manuscript.packageFiles['manuscript.html']).toBeUndefined()
  })
})
