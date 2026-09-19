/**
 * A person's edited file, handed back as a new version.
 *
 * THE ONE THING THAT MUST NOT HAPPEN is the pipeline adopting bytes it did not produce. Every refusal
 * below is a way of that happening: a file this run never projected, a file that did not change, a
 * format the deployment cannot read back, and a file edited against a version the run has left
 * behind. What IS adopted is published as a new version, and what the round trip could not carry back
 * is recorded rather than smoothed over.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  MANUSCRIPT_RETURN_FILES, assembleImportedManuscript, readManuscriptReturn,
  roundTripLossesOf, sectionsOfReturnedMarkdown,
} from '../src/runner/manuscript-import.ts'
import type { DocumentManifest } from '../src/runner/manuscript-directory.ts'
import type { DocumentCompiler } from '../src/runner/document-compile.ts'

/** The directory the fixtures for this suite live in. */
function fixtureDirectory(): string {
  return fileURLToPath(new URL('./fixtures/manuscript-return', import.meta.url))
}

/** SHA-256 of one fixture file, as the manifest would have recorded it when it was projected. */
function digestOf(directory: string, name: string): string {
  return createHash('sha256').update(readFileSync(join(directory, name))).digest('hex')
}

/** A manifest naming one projected file, with the digest of the bytes it was written with. */
function manifestWith(path: string, sha256: string): DocumentManifest {
  return {
    runId: 'run-1',
    manuscriptRef: { version: 3, contentHash: 'hash' },
    documentHash: 'doc',
    renderedFrom: { version: 2, contentHash: 'typeset-hash' },
    projectedAt: '2026-01-01T00:00:00.000Z',
    files: [{ path, bytes: 10, sha256 }],
    tables: [],
    referencePdfs: 'not-stored',
    note: '',
  }
}

/** A compiler that reads a document back, so the LaTeX and DOCX paths can be exercised. */
function readingCompiler(losses: ReadonlyArray<{ part: string; reason: string }> = []): DocumentCompiler {
  return {
    tool: 'bytes',
    formats: ['html', 'latex', 'docx'],
    compile: () => Promise.reject(new Error('this compiler is only used for reading')),
    read: request => Promise.resolve({
      markdown: `# Title\n\n## Results\n\nread back from ${request.format}\n`,
      losses,
    }),
  }
}

describe('what each format does not carry back', () => {
  it('says a LaTeX round trip is nearly exact and a DOCX one is not', () => {
    const latex = roundTripLossesOf('latex').map(loss => loss.part)
    const docx = roundTripLossesOf('docx').map(loss => loss.part)
    // A DOCX LOSES THINGS A LATEX FILE NEVER HAD: the comments, the cross-reference fields and the
    // cell structure are Word's own, and the LaTeX source is the one format whose text and
    // mathematics come back as they were written.
    expect(latex).not.toContain('cross-references')
    expect(latex).not.toContain('tables')
    expect(latex.length).toBeLessThan(docx.length)
    expect(docx).toContain('comments')
    expect(docx).toContain('cross-references')
    expect(docx).toContain('tables')
    // BOTH LOSE THE THINGS A FLAT FORMAT CANNOT HOLD, and saying so is the point of the table.
    for (const part of ['figures', 'citation-markers']) {
      expect(latex).toContain(part)
      expect(docx).toContain(part)
    }
    expect(roundTripLossesOf('markdown').map(loss => loss.part)).toContain('floats-and-equations')
  })

  it('states what happened to each part rather than naming a category', () => {
    for (const format of ['markdown', 'latex', 'docx'] as const) {
      for (const loss of roundTripLossesOf(format)) {
        expect(loss.reason.length).toBeGreaterThan(20)
      }
    }
  })
})

describe('reading the file a person edited', () => {
  it('refuses a format the manifest does not name', async () => {
    const read = await readManuscriptReturn('nowhere', 'latex', manifestWith('manuscript.md', 'x'), undefined)
    expect(read).toMatchObject({ ok: false })
    if (read.ok) throw new Error('unreachable')
    expect(read.reason).toContain("holds no 'manuscript.tex'")
    expect(read.reason).toContain('manuscript.md')
  })

  it('refuses a file that is byte-for-byte what was projected', async () => {
    const directory = fixtureDirectory()
    const read = await readManuscriptReturn(
      directory,
      'latex',
      manifestWith('manuscript.tex', digestOf(directory, 'manuscript.tex')),
      readingCompiler(),
    )
    expect(read).toMatchObject({ ok: false })
    if (read.ok) throw new Error('unreachable')
    expect(read.reason).toContain('no edit to bring back')
  })

  it('refuses a file the manifest names and the disk does not hold', async () => {
    const read = await readManuscriptReturn(
      fixtureDirectory(),
      'docx',
      manifestWith('manuscript.docx', 'b'.repeat(64)),
      readingCompiler(),
    )
    expect(read).toMatchObject({ ok: false })
    if (read.ok) throw new Error('unreachable')
    expect(read.reason).toContain('is named by the manifest and is not on disk')
  })

  it('refuses a binary format when the deployment has no toolchain that reads it back', async () => {
    const read = await readManuscriptReturn(
      fixtureDirectory(),
      'latex',
      manifestWith('manuscript.tex', 'a'.repeat(64)),
      undefined,
    )
    expect(read).toMatchObject({ ok: false })
    if (read.ok) throw new Error('unreachable')
    expect(read.reason).toContain('names no document toolchain')
  })

  it('names the format when the deployment\'s compiler cannot read it', async () => {
    const read = await readManuscriptReturn(
      new URL('./fixtures/manuscript-return', import.meta.url).pathname.slice(1),
      'latex',
      manifestWith('manuscript.tex', 'a'.repeat(64)),
      { tool: 'pandoc', formats: ['latex'], compile: () => Promise.reject(new Error('unused')) },
    )
    expect(read).toMatchObject({ ok: false })
    if (read.ok) throw new Error('unreachable')
    expect(read.reason).toContain("'pandoc' cannot read a 'latex' file back")
  })

  it('refuses with the compiler\'s own words when the read fails', async () => {
    const read = await readManuscriptReturn(
      new URL('./fixtures/manuscript-return', import.meta.url).pathname.slice(1),
      'latex',
      manifestWith('manuscript.tex', 'a'.repeat(64)),
      {
        tool: 'pandoc',
        formats: ['latex'],
        compile: () => Promise.reject(new Error('unused')),
        read: () => Promise.reject(new Error('not a LaTeX file')),
      },
    )
    expect(read).toMatchObject({ ok: false })
    if (read.ok) throw new Error('unreachable')
    expect(read.reason).toContain('not a LaTeX file')
  })

  it('reads the Markdown directly, and carries the digest and the baseline forward', async () => {
    const directory = fixtureDirectory()
    const digest = digestOf(directory, 'manuscript.md')
    const read = await readManuscriptReturn(
      directory,
      'markdown',
      manifestWith('manuscript.md', 'a'.repeat(64)),
      undefined,
    )
    expect(read).toMatchObject({ ok: true })
    if (!read.ok) throw new Error(read.reason)
    expect(read.file.sha256).toBe(digest)
    expect(read.file.projectedSha256).toBe('a'.repeat(64))
    expect(read.file.path).toBe('manuscript.md')
    expect(read.file.markdown).toContain('## Results')
  })

  it('adds the reader\'s own losses to the format\'s', async () => {
    const read = await readManuscriptReturn(
      new URL('./fixtures/manuscript-return', import.meta.url).pathname.slice(1),
      'latex',
      manifestWith('manuscript.tex', 'a'.repeat(64)),
      readingCompiler([{ part: 'macros', reason: 'a definition in the preamble has no Markdown form' }]),
    )
    expect(read).toMatchObject({ ok: true })
    if (!read.ok) throw new Error(read.reason)
    expect(read.file.losses.map(loss => loss.part)).toContain('macros')
    expect(read.file.losses.map(loss => loss.part)).toContain('figures')
  })
})

describe('the sections of a returned document', () => {
  it('splits on level-two headings and keeps what is under each', () => {
    expect(sectionsOfReturnedMarkdown([
      '# The title is not read back',
      '',
      'preamble text nobody wrote',
      '',
      '## Results',
      'the results paragraph',
      '',
      '| a | b |',
      '|---|---|',
      '',
      '## Discussion',
      'the discussion',
    ].join('\n'))).toEqual([
      { heading: 'Results', body: 'the results paragraph\n\n| a | b |\n|---|---|' },
      { heading: 'Discussion', body: 'the discussion' },
    ])
  })

  it('answers nothing for a document with no sections', () => {
    expect(sectionsOfReturnedMarkdown('# Only a title\n')).toEqual([])
  })
})

describe('assembling the next version from what came back', () => {
  const previous = {
    title: 'A study',
    sections: [
      { id: 'intro', heading: 'Introduction', bodyText: 'the old introduction' },
      { id: 'results', heading: 'Results', bodyText: 'the old results' },
      { id: 'method', heading: 'Method', bodyText: 'the old method' },
    ],
    document: {
      title: 'A study',
      sections: [
        { id: 'intro', heading: 'Introduction', blocks: [{ kind: 'prose', text: 'the old introduction' }] },
        {
          id: 'results',
          heading: 'Results',
          blocks: [
            { kind: 'prose', text: 'the old results' },
            { kind: 'table', label: 'Table 1', caption: 'the numbers', markdown: '| a |\n|---|\n| 1 |' },
          ],
        },
        { id: 'method', heading: 'Method', blocks: [{ kind: 'prose', text: 'the old method' }] },
      ],
      references: [{ citeKey: 'k', entry: 'An entry' }],
    },
    citations: [{ citeKey: 'k', statement: 'a sentence' }],
    refusedSections: ['discussion'],
  }

  it('replaces the prose of the sections it matched, and carries the rest forward', () => {
    const imported = assembleImportedManuscript(previous, [
      '## Introduction',
      'the edited introduction',
      '',
      '## Results',
      'the edited results',
    ].join('\n'))
    expect(imported.matched).toEqual(['intro', 'results'])
    // A SECTION THE FILE SAYS NOTHING ABOUT IS CARRIED FORWARD UNTOUCHED, not emptied.
    expect(imported.unmentionedSections).toEqual(['method'])
    const sections = imported.value['sections'] as ReadonlyArray<Record<string, unknown>>
    expect(sections.map(section => section['bodyText'])).toEqual([
      'the edited introduction', 'the edited results', 'the old method',
    ])
    // EVERY OTHER FIELD OF THE DOCUMENT SURVIVES, which is what stops a flat round trip from
    // dropping the citations, the reference list and the argument the run holds.
    expect(imported.value['citations']).toEqual(previous.citations)
    expect(imported.value['refusedSections']).toEqual(['discussion'])
    expect(imported.value['importedFile']).toBe(true)
    const document = imported.value['document'] as { sections: ReadonlyArray<{ blocks: ReadonlyArray<{ kind: string }> }> }
    // THE FLOATS STAY WHERE THEY WERE: a table a round trip cannot carry is the table the document
    // already placed, not a gap.
    expect(document.sections[1]?.blocks.map(block => block.kind)).toEqual(['prose', 'table'])
    expect(document.sections[1]?.blocks[0]).toEqual({ kind: 'prose', text: 'the edited results' })
  })

  it('reports a heading this document has no section for rather than adopting it', () => {
    const imported = assembleImportedManuscript(previous, [
      '## Introduction',
      'edited',
      '',
      '## A section nobody planned',
      'text with no argument-plan obligation',
    ].join('\n'))
    expect(imported.matched).toEqual(['intro'])
    expect(imported.unmatchedHeadings).toEqual(['A section nobody planned'])
  })

  it('takes the first of two headings with one name', () => {
    const imported = assembleImportedManuscript(previous, [
      '## Introduction',
      'the first one',
      '',
      '## Introduction',
      'the second one',
    ].join('\n'))
    const sections = imported.value['sections'] as ReadonlyArray<Record<string, unknown>>
    expect(sections[0]?.['bodyText']).toBe('the first one')
  })

  it('assembles a value from a previous one that carries no sections', () => {
    const imported = assembleImportedManuscript(undefined, '## Results\nsomething\n')
    expect(imported.value['sections']).toEqual([])
    expect(imported.matched).toEqual([])
    expect(imported.value).toMatchObject({ importedFile: true })
  })

  it('keeps a document that is not a record, rather than inventing one', () => {
    const imported = assembleImportedManuscript({ sections: [], document: null }, '## Results\nx\n')
    expect(imported.value['document']).toBeNull()
  })

  it('leaves a section whose blocks are not an array exactly as it was', () => {
    const imported = assembleImportedManuscript({
      sections: [{ id: 'intro', heading: 'Introduction', bodyText: 'old' }],
      document: { sections: [{ id: 'intro', heading: 'Introduction', blocks: 'not an array' }] },
    }, '## Introduction\nnew\n')
    const document = imported.value['document'] as { sections: ReadonlyArray<Record<string, unknown>> }
    expect(document.sections[0]).toEqual({ id: 'intro', heading: 'Introduction', blocks: 'not an array' })
  })
})

describe('the file each format is read from', () => {
  it('names the three files the working directory holds', () => {
    expect(MANUSCRIPT_RETURN_FILES).toEqual({
      markdown: 'manuscript.md', latex: 'manuscript.tex', docx: 'manuscript.docx',
    })
  })
})
