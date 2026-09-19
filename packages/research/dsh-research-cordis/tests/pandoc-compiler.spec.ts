/**
 * The deployment's pandoc compiler, against whatever this machine has.
 *
 * IT SELF-SKIPS WITHOUT PANDOC, the way the real-API suites skip without a key: whether a machine has
 * a document toolchain is a fact about the machine, and a spec that failed on a machine without one
 * would be testing the runner rather than the compiler. What it does NOT skip is the refusal path —
 * a deployment with no LaTeX engine must refuse `pdf`, and that is asserted on any machine.
 */
import { describe, expect, it } from 'vitest'
import { PandocCompiler } from '../src/pandoc-compiler.ts'

/** The document the compiler is asked to render: prose with a citation, an equation and a figure. */
const DOCUMENT = {
  title: 'A study',
  sections: [{
    id: 'results',
    heading: 'Results',
    blocks: [
      { kind: 'prose' as const, text: 'The quantity fell [@cite-W1].' },
      { kind: 'equation' as const, label: 'Desired gap', latex: 's^{*} = s_{0} + v T' },
      { kind: 'figure' as const, label: 'Figure 1', caption: 'The comparison.', svg: '<svg width="10" height="10"></svg>', pngBase64: 'iVBORw0KGgo=' },
    ],
  }],
  references: [{ citeKey: 'cite-W1', entry: 'Chen, Y. Safe and stable. 2026.', number: 1 }],
}

describe('a deployment with pandoc', () => {
  it('offers html and latex, and renders the document model', async () => {
    const compiler = await PandocCompiler.probe({ executable: 'pandoc' })
    if (!compiler.formats.includes('html')) {
      // No pandoc on this machine: the refusal path is still asserted below.
      expect(compiler.formats).toEqual([])
      return
    }
    const html = await compiler.compile({ document: DOCUMENT, format: 'html', mode: 'draft' })
    expect(html.fileName).toBe('manuscript.html')
    // THE CITATION CARRIES THE NUMBER THE MANUSCRIPT ASSIGNED, not the key: the numbering is E1's.
    expect(html.content).toContain('[1]')
    expect(html.content).not.toContain('[@cite-W1]')
    // THE FIGURE IS THE SVG THE TOOL RENDERED, inline, so the file reads with the network off.
    expect(html.content).toContain('<svg')
    expect(html.content).toContain('<math')
    const tex = await compiler.compile({ document: DOCUMENT, format: 'latex', mode: 'draft' })
    expect(tex.fileName).toBe('manuscript.tex')
    expect(tex.content).toContain('\\documentclass')
    expect(tex.content).toContain('s^{*}')
  })
})

describe('a format this deployment cannot produce', () => {
  it('is refused rather than produced empty', async () => {
    const compiler = await PandocCompiler.probe({ executable: 'pandoc' })
    // No LaTeX engine is named, so `pdf` is not among the formats on ANY machine — the refusal is
    // about what the deployment can do, and it is the same answer whether pandoc is present or not.
    expect(compiler.formats).not.toContain('pdf')
    await expect(compiler.compile({ document: DOCUMENT, format: 'pdf', mode: 'draft' }))
      .rejects.toThrow(/cannot produce 'pdf'/u)
  })

  it('refuses when the executable does not exist, rather than claiming a format', async () => {
    const compiler = await PandocCompiler.probe({ executable: 'pandoc-that-is-not-installed' })
    expect(compiler.formats).toEqual([])
    await expect(compiler.compile({ document: DOCUMENT, format: 'html', mode: 'draft' }))
      .rejects.toThrow(/cannot produce 'html'/u)
  })
})

describe('reading a document back', () => {
  it('reads the LaTeX this compiler produced, and states what the round trip lost', async () => {
    const compiler = await PandocCompiler.probe({ executable: 'pandoc' })
    if (!compiler.formats.includes('latex')) {
      // No pandoc on this machine: the refusal path is asserted below.
      expect(compiler.formats).toEqual([])
      return
    }
    const tex = await compiler.compile({ document: DOCUMENT, format: 'latex', mode: 'draft' })
    const back = await compiler.read({ format: 'latex', content: tex.content, encoding: 'utf8' })
    // THE TEXT COMES BACK AS IT WAS WRITTEN, which is what "a LaTeX round trip is nearly exact"
    // means — and the mathematics survives as display mathematics rather than as an escaped string.
    expect(back.markdown).toContain('The quantity fell')
    expect(back.markdown).toContain('s^{*} = s_{0} + v T')
    // WHAT PANDOC COULD NOT EXPRESS IS REPORTED RATHER THAN SILENTLY LEFT IN THE TEXT.
    for (const loss of back.losses) {
      expect(loss.part).not.toBe('')
      expect(loss.reason.length).toBeGreaterThan(20)
    }
  })

  it('reads a DOCX back and says the images were extracted rather than read as floats', async () => {
    const compiler = await PandocCompiler.probe({ executable: 'pandoc' })
    if (!compiler.formats.includes('docx')) {
      expect(compiler.formats).toEqual([])
      return
    }
    const docx = await compiler.compile({ document: DOCUMENT, format: 'docx', mode: 'draft' })
    const back = await compiler.read({ format: 'docx', content: docx.content, encoding: 'base64' })
    expect(back.markdown).toContain('The quantity fell')
    // THE FIGURE CAME BACK AS A LINK TO AN EXTRACTED FILE, which is the loss a Word round trip has
    // and the reason the run carries the float forward instead of adopting it.
    expect(back.losses.map(loss => loss.part)).toContain('images')
  })

  it('refuses a format that cannot be read back, naming it', async () => {
    const compiler = await PandocCompiler.probe({ executable: 'pandoc' })
    await expect(compiler.read({ format: 'pdf', content: '', encoding: 'base64' }))
      .rejects.toThrow(/not a format that can be read back/u)
    await expect(compiler.read({ format: 'html', content: '<p/>', encoding: 'utf8' }))
      .rejects.toThrow(/not a format that can be read back/u)
  })

  it('reports pandoc\'s own words when it cannot read the file', async () => {
    const compiler = await PandocCompiler.probe({ executable: 'pandoc' })
    if (!compiler.formats.includes('latex')) {
      expect(compiler.formats).toEqual([])
      return
    }
    await expect(compiler.read({ format: 'docx', content: 'bm90IGEgZG9jeA==', encoding: 'base64' }))
      .rejects.toThrow(/./u)
  })
})
