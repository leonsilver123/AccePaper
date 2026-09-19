/**
 * The run's working directory: one document on disk, projected from the registry.
 *
 * WHAT THIS PINS. Nothing used to touch disk until export. The directory is written after every step
 * that commits, it is built from the run's REGISTRY rather than from an executor's return value, and
 * the two ways it can stop being what its manifest says are reported separately — a file edited on
 * disk is a different fact from a run that has moved past the version the directory projects, and the
 * remedies differ.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { runT19B } from '../src/runner/drive.ts'
import {
  DOCUMENT_MANIFEST_FILE, describeManuscriptDirectoryDrift, manuscriptDirectoryDrift,
  planManuscriptDirectory, readDocumentManifest, writeManuscriptDirectory,
} from '../src/runner/manuscript-directory.ts'
import { checkWrittenFiles } from '../src/runner/staged-directory.ts'
import type { DocumentManifest } from '../src/runner/manuscript-directory.ts'
import type { DocumentCompiler } from '../src/runner/document-compile.ts'
import type { RunResult } from '../src/runner/types.ts'

const created: string[] = []

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'manuscript-dir-'))
  created.push(dir)
  return dir
}

/**
 * A compiler answering with the two kinds of file a real one produces.
 *
 * `formats` deliberately omits `pdf`: whether a PDF is projected is the deployment's own declaration,
 * and a case that wants one states it by adding the format rather than by changing this module.
 */
function byteCompiler(formats: ReadonlyArray<'html' | 'latex' | 'docx' | 'pdf'> = ['html', 'latex', 'docx']): DocumentCompiler {
  const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]).toString('base64')
  return {
    tool: 'bytes',
    formats,
    compile(request) {
      return Promise.resolve(request.format === 'docx' || request.format === 'pdf'
        ? {
          format: request.format,
          fileName: request.format === 'docx' ? 'manuscript.docx' : 'manuscript.pdf',
          content: ZIP,
          encoding: 'base64' as const,
          tool: 'bytes@1',
          assets: { embedded: [], dropped: [] },
          files: [],
        }
        : {
          format: request.format,
          fileName: request.format === 'latex' ? 'manuscript.tex' : 'manuscript.html',
          content: `<document>${request.document.title}</document>`,
          encoding: 'utf8' as const,
          tool: 'bytes@1',
          assets: { embedded: [], dropped: [] },
          files: [],
        })
    },
  }
}

/** Drive the real pipeline, with a compiler so E1 produces the deliverables. */
async function realRun(compiler: DocumentCompiler = byteCompiler()): Promise<{ store: ResearchRunStore; run: RunResult }> {
  const store = new Map() as ResearchRunStore
  const run = await runT19B(store, { documentCompiler: compiler })
  return { store, run }
}

/** Project one run into a fresh root and read it back. */
function project(store: ResearchRunStore, runId: string, root: string): DocumentManifest {
  const plan = planManuscriptDirectory(store, runId, { projectedAt: '2026-01-01T00:00:00.000Z' })
  return writeManuscriptDirectory(plan, root)
}

describe('the working directory is a projection of the run', () => {
  it('writes the document, its figures, its tables and the compiled deliverables', async () => {
    const { store, run } = await realRun()
    const root = tempDir()
    const manifest = project(store, run.runId, root)
    const directory = join(root, run.runId)
    const paths = manifest.files.map(file => file.path)
    expect(paths).toContain('manuscript.md')
    expect(paths).toContain('manuscript.tex')
    expect(paths).toContain('manuscript.docx')
    // PDF IS NOT PROJECTED WHEN THE DEPLOYMENT DOES NOT DECLARE IT.
    expect(paths).not.toContain('manuscript.pdf')
    expect(paths.some(path => path.startsWith('figures/') && path.endsWith('.svg'))).toBe(true)
    expect(paths.some(path => path.startsWith('tables/') && path.endsWith('.md'))).toBe(true)
    for (const file of manifest.files) {
      expect(existsSync(join(directory, file.path))).toBe(true)
    }
    expect(existsSync(join(directory, DOCUMENT_MANIFEST_FILE))).toBe(true)
    // THE DIGEST OF THE MARKDOWN AS IT LANDED, which is the fact a reader compares a hand-edited
    // file against: the registry's content hash is over the document VALUE, not over this file.
    expect(manifest.documentHash).toBe(
      createHash('sha256').update(readFileSync(join(directory, 'manuscript.md'))).digest('hex'),
    )
  })

  it('projects a PDF when the deployment declares one', async () => {
    const { store, run } = await realRun(byteCompiler(['html', 'latex', 'docx', 'pdf']))
    const root = tempDir()
    const manifest = project(store, run.runId, root)
    expect(manifest.files.map(file => file.path)).toContain('manuscript.pdf')
  })

  it('names the document version it projects and the typeset form it was rendered by', async () => {
    const { store, run } = await realRun()
    const root = tempDir()
    const manifest = project(store, run.runId, root)
    const registry = store.get(run.runId)?.registry
    expect(manifest.manuscriptRef?.version).toBe(registry?.['manuscript']?.ref.version)
    expect(manifest.manuscriptRef?.contentHash).toBe(String(registry?.['manuscript']?.ref.contentHash))
    expect(manifest.renderedFrom?.version).toBe(registry?.['typeset']?.ref.version)
    expect(manifest.runId).toBe(run.runId)
    expect(manifest.projectedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('verifies as what its manifest says, by the same comparison the package uses', async () => {
    const { store, run } = await realRun()
    const root = tempDir()
    const manifest = project(store, run.runId, root)
    expect(checkWrittenFiles(join(root, run.runId), manifest.files).filter(check => check.status !== 'ok')).toEqual([])
  })

  it('renders the Markdown from the document the run holds, not from the typeset form', async () => {
    const { store, run } = await realRun()
    const root = tempDir()
    project(store, run.runId, root)
    const markdown = readFileSync(join(root, run.runId, 'manuscript.md'), 'utf8')
    // The document's own headings, in its own order, is what a person edits and hands back.
    expect(markdown).toMatch(/^# /u)
    expect(markdown).toContain('\n\n## ')
    expect(markdown.endsWith('\n')).toBe(true)
  })
})

describe('reading the manifest back', () => {
  it('returns what was written, and null for a directory that holds none', async () => {
    const { store, run } = await realRun()
    const root = tempDir()
    const written = project(store, run.runId, root)
    expect(readDocumentManifest(join(root, run.runId))).toEqual(written)
    expect(readDocumentManifest(join(root, 'never-written'))).toBeNull()
  })

  it('answers null for a manifest this reader cannot use', () => {
    const root = tempDir()
    writeFileSync(join(root, DOCUMENT_MANIFEST_FILE), 'not json at all\n')
    expect(readDocumentManifest(root)).toBeNull()
    writeFileSync(join(root, DOCUMENT_MANIFEST_FILE), '{"runId": 4}\n')
    expect(readDocumentManifest(root)).toBeNull()
  })

  it('reads back a manifest whose optional fields are absent', () => {
    const root = tempDir()
    writeFileSync(join(root, DOCUMENT_MANIFEST_FILE), JSON.stringify({
      runId: 'r1',
      files: [{ path: 'a.md', bytes: 3, sha256: 'abc' }, { path: 'b.md' }],
    }))
    const manifest = readDocumentManifest(root)
    expect(manifest?.manuscriptRef).toBeNull()
    expect(manifest?.renderedFrom).toBeNull()
    expect(manifest?.documentHash).toBeNull()
    expect(manifest?.files).toEqual([{ path: 'a.md', bytes: 3, sha256: 'abc' }])
    expect(manifest?.tables).toEqual([])
    expect(manifest?.referencePdfs).toBe('not-stored')
    expect(manifest?.projectedAt).toBe('')
  })
})

describe('the two ways a directory stops being what its manifest says', () => {
  it('reports a file edited on disk, and says the run has not moved', async () => {
    const { store, run } = await realRun()
    const root = tempDir()
    const manifest = project(store, run.runId, root)
    const directory = join(root, run.runId)
    writeFileSync(join(directory, 'manuscript.md'), '# someone was here\n')
    const drift = manuscriptDirectoryDrift(directory, manifest, {
      manuscriptVersion: store.get(run.runId)?.registry['manuscript']?.ref.version ?? null,
    })
    expect(drift.edited).toEqual(['manuscript.md'])
    expect(drift.runMoved).toBe(false)
    expect(describeManuscriptDirectoryDrift(drift)).toContain('manuscript.md')
    expect(describeManuscriptDirectoryDrift(drift)).toContain('re-projecting replaces them')
  })

  it('reports a run that has moved past the version the directory projects', async () => {
    const { store, run } = await realRun()
    const root = tempDir()
    const manifest = project(store, run.runId, root)
    const directory = join(root, run.runId)
    const drift = manuscriptDirectoryDrift(directory, manifest, {
      manuscriptVersion: (manifest.manuscriptRef?.version ?? 0) + 1,
    })
    expect(drift.edited).toEqual([])
    expect(drift.runMoved).toBe(true)
    expect(drift.projectedVersion).toBe(manifest.manuscriptRef?.version)
    expect(drift.currentVersion).toBe((manifest.manuscriptRef?.version ?? 0) + 1)
    // THE REMEDIES ARE DIFFERENT, so the sentence has to say which one applies.
    expect(describeManuscriptDirectoryDrift(drift)).toContain('re-rendered')
    expect(describeManuscriptDirectoryDrift(drift)).not.toContain('re-projecting')
  })

  it('says nothing when neither fact holds, and reports a directory that projects no document', () => {
    const empty: DocumentManifest = {
      runId: 'r', manuscriptRef: null, documentHash: null, renderedFrom: null,
      projectedAt: '', files: [], tables: [], referencePdfs: 'not-stored', note: '',
    }
    const drift = manuscriptDirectoryDrift('nowhere', empty, { manuscriptVersion: null })
    expect(drift.edited).toEqual([])
    expect(drift.runMoved).toBe(false)
    expect(describeManuscriptDirectoryDrift(drift)).toBe('')
  })
})
