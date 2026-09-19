/**
 * The round trip, through the service: one document on disk, edited and handed back.
 *
 * THE WHOLE POINT OF THE UNIT, driven rather than hand-built. The driver projects the run's document
 * onto a working directory after every step that commits; a person edits the file; the service
 * publishes a new version of the document from it; and the repair re-renders the typeset form when
 * the document has moved under it. Nothing here calls a private method: `importManuscript` and
 * `materializeManuscript` are the two Remote entries a page reaches, and the projection runs where
 * the driver runs it.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import ResearchTeamService from '../src/index.ts'
import type { ResearchRunSnapshot } from '../src/types.ts'
import type { DocumentCompiler } from '../src/runner/document-compile.ts'
import { readDocumentManifest } from '../src/runner/manuscript-directory.ts'

const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

/** A compiler that produces the three deliverables and reads a `.docx` back, as one that can. */
function compiler(): DocumentCompiler {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]).toString('base64')
  return {
    tool: 'bytes',
    formats: ['html', 'latex', 'docx'],
    compile: request => Promise.resolve(request.format === 'docx'
      ? {
        format: request.format, fileName: 'manuscript.docx', content: ZIP, encoding: 'base64' as const,
        tool: 'bytes@1', assets: { embedded: [], dropped: [] },
        files: [{ path: 'assets/figure-1.png', label: 'Figure 1', base64: PNG }],
      }
      : {
        format: request.format,
        fileName: request.format === 'latex' ? 'manuscript.tex' : 'manuscript.html',
        content: `<document>${request.document.title}</document>`,
        encoding: 'utf8' as const, tool: 'bytes@1', assets: { embedded: [], dropped: [] }, files: [],
      }),
    read: () => Promise.resolve({
      markdown: '# hand edited\n\n## Results\n\nread back from the document\n',
      losses: [],
    }),
  }
}

/**
 * The service over a deployment that configures a working directory.
 *
 * The research engine is stubbed the way `cordis.yml` fills it, so what reaches the driver is the
 * deployment's own resolution of `manuscriptDirectory` and `document`.
 */
async function boot(options: {
  readonly manuscriptDirectory?: string
  readonly documentCompiler?: DocumentCompiler
}): Promise<{ readonly service: ResearchTeamService; readonly snapshotRoot: string; dispose(): Promise<void> }> {
  const ctx = new Context()
  for (const name of ['agents', 'sessions', 'sessionPersistence', 'subagents']) ctx.provide(name, {})
  ctx.provide('sessionProjections', { register: () => () => {} })
  ctx.provide('tools', { guard: () => () => {}, register: () => () => {} })
  const snapshotRoot = tempRoot('dsh-roundtrip-snap-')
  const engine: {
    snapshotDirectory?: string
    manuscriptDirectory?: string
    documentCompiler?: DocumentCompiler
  } = { snapshotDirectory: snapshotRoot }
  if (options.manuscriptDirectory !== undefined) engine.manuscriptDirectory = options.manuscriptDirectory
  if (options.documentCompiler !== undefined) engine.documentCompiler = options.documentCompiler
  ctx.provide('research', engine)
  const fiber = await ctx.plugin(ResearchTeamService, {})
  return {
    service: ctx.agentTeams as unknown as ResearchTeamService,
    snapshotRoot,
    dispose: async () => { await fiber.dispose() },
  }
}

/**
 * Drive one whole study and return the snapshot the service projects.
 *
 * THROUGH `startRun`, because that is the entry a page uses and the one that makes the run
 * addressable afterwards: the two import operations act on a run THIS PROCESS is holding, exactly as
 * an export does, and a study driven through the awaiting entry is not one they can be pointed at.
 *
 * @param service - the service under test.
 * @returns the snapshot once the driver has stopped.
 */
async function driveOne(service: ResearchTeamService): Promise<ResearchRunSnapshot> {
  const started = await service.startRun({ commandId: `command-${String(nextCommand)}` })
  nextCommand += 1
  for (;;) {
    const snapshot = await service.runSnapshot({ runId: started.runId })
    if (snapshot !== null && snapshot.execution === 'stopped') return snapshot
    await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
  }
}

/** One command id per run, so a retried id cannot be answered with the previous study. */
let nextCommand = 1

describe('the driver maintains one document on disk', () => {
  it('projects the document, its figures, its tables and the compiled deliverables', async () => {
    const root = tempRoot('dsh-manuscripts-')
    const host = await boot({ manuscriptDirectory: root, documentCompiler: compiler() })
    try {
      const snapshot = await driveOne(host.service)
      const directory = join(root, snapshot.run.runId)
      expect(existsSync(join(directory, 'manuscript.md'))).toBe(true)
      expect(existsSync(join(directory, 'manuscript.docx'))).toBe(true)
      expect(existsSync(join(directory, 'manuscript.tex'))).toBe(true)
      // The manifest says which version of the document this directory holds.
      const manifest = readDocumentManifest(directory)
      expect(manifest?.manuscriptRef).not.toBeNull()
      expect(manifest?.files.map(file => file.path)).toContain('manuscript.md')
      // AND THE PANEL CAN SEE IT: the wire snapshot carries where it is and whether it drifted.
      expect(snapshot.manuscriptDirectory?.directory).toBe(directory)
      expect(snapshot.manuscriptDirectory?.projected).toBe(true)
      expect(snapshot.manuscriptDirectory?.runMoved).toBe(false)
      expect(snapshot.manuscriptDirectory?.edited).toEqual([])
      expect(snapshot.manuscriptDirectory?.projectionError).toBeUndefined()
      // No step failed to project.
      expect(snapshot.run.steps).toBeDefined()
    } finally {
      await host.dispose()
    }
  })

  it('reports a projection failure without failing the step, and says so on the run', async () => {
    // A ROOT THAT CANNOT BE WRITTEN. The path is a FILE, so every projection under it fails — and
    // the run still reaches its end, because the step it followed had already committed.
    const root = tempRoot('dsh-manuscripts-broken-')
    const blocked = join(root, 'not-a-directory')
    writeFileSync(blocked, 'this is a file\n')
    const host = await boot({ manuscriptDirectory: blocked, documentCompiler: compiler() })
    try {
      const snapshot = await driveOne(host.service)
      expect(snapshot.manuscriptDirectory?.projectionError).toBeDefined()
      // THE RUN IS NOT DECLARED SICK BY IT: the failure is reported, and the study is where it was
      // going to be. What the panel reads is the last failure the run's own log recorded.
      expect(snapshot.run.steps.some(step => step.status === 'passed')).toBe(true)
      expect(snapshot.manuscriptDirectory?.projected).toBe(false)
    } finally {
      await host.dispose()
    }
  })
})

describe('a hand-edited file becomes a new version', () => {
  it('publishes the edit, records what the round trip lost, and follows it with the directory', async () => {
    const root = tempRoot('dsh-manuscripts-import-')
    const host = await boot({ manuscriptDirectory: root, documentCompiler: compiler() })
    try {
      const before = await driveOne(host.service)
      const runId = before.run.runId
      const directory = join(root, runId)
      const documentVersion = before.manuscriptDirectory?.currentVersion ?? 0
      const revision = snapshotRevision(host, before)
      // A PERSON EDITS THE FILE. The load-bearing edit is a sentence the pipeline can see: a new
      // heading would be an unmatched section, and this case is about an accepted one.
      const original = readFileSync(join(directory, 'manuscript.md'), 'utf8')
      const edited = original.replace(/(\n## \S[^\n]*\n)/u, '$1\nA hand-written sentence the study did not produce.\n')
      expect(edited).not.toBe(original)
      writeFileSync(join(directory, 'manuscript.md'), edited)

      const imported = await host.service.importManuscript({
        runId,
        format: 'markdown',
        expectedRevision: revision,
        expectedManuscriptVersion: documentVersion,
      })
      expect(imported.replacedVersion).toBe(documentVersion)
      expect(imported.version).toBe(documentVersion + 1)
      expect(imported.path).toBe('manuscript.md')
      expect(imported.matched.length).toBeGreaterThan(0)
      // WHAT THE FORMAT DID NOT CARRY IS RECORDED, not smoothed over.
      expect(imported.losses.map(loss => loss.part)).toContain('figures')
      // THE DIRECTORY FOLLOWS THE RUN, so an editor left open on the old copy is replaced.
      const manifest = readDocumentManifest(directory)
      expect(manifest?.manuscriptRef?.version).toBe(documentVersion + 1)
      expect(imported.manuscriptDirectory?.currentVersion).toBe(documentVersion + 1)
      expect(imported.manuscriptDirectory?.runMoved).toBe(false)
    } finally {
      await host.dispose()
    }
  })

  it('refuses a file this run never projected', async () => {
    const root = tempRoot('dsh-manuscripts-refuse-')
    // A DEPLOYMENT THAT COMPILES NOTHING: its directory holds the Markdown and no document, and a
    // `.docx` someone drops beside it is not one this run produced.
    const host = await boot({ manuscriptDirectory: root })
    try {
      const snapshot = await driveOne(host.service)
      const runId = snapshot.run.runId
      writeFileSync(join(root, runId, 'manuscript.docx'), 'not ours')
      await expect(host.service.importManuscript({
        runId, format: 'docx',
        expectedRevision: snapshotRevision(host, snapshot),
        expectedManuscriptVersion: snapshot.manuscriptDirectory?.currentVersion ?? 0,
      })).rejects.toThrow(/holds no 'manuscript\.docx'/u)
    } finally {
      await host.dispose()
    }
  })

  it('refuses an edit against a version the run has left behind', async () => {
    const root = tempRoot('dsh-manuscripts-stale-')
    const host = await boot({ manuscriptDirectory: root, documentCompiler: compiler() })
    try {
      const snapshot = await driveOne(host.service)
      const runId = snapshot.run.runId
      const directory = join(root, runId)
      const original = readFileSync(join(directory, 'manuscript.md'), 'utf8')
      writeFileSync(join(directory, 'manuscript.md'), `${original}\nedited\n`)
      await expect(host.service.importManuscript({
        runId, format: 'markdown',
        // A MANUSCRIPT VERSION THE RUN NEVER HELD, which is what a file projected from a superseded
        // document looks like once the run has moved on.
        expectedRevision: snapshotRevision(host, snapshot),
        expectedManuscriptVersion: (snapshot.manuscriptDirectory?.currentVersion ?? 0) + 7,
      })).rejects.toThrow(/the artifact moved/u)
    } finally {
      await host.dispose()
    }
  })

  it('refuses an import into a deployment with no working directory', async () => {
    const host = await boot({})
    try {
      await expect(host.service.importManuscript({
        runId: 'anything', format: 'markdown', expectedRevision: 1, expectedManuscriptVersion: 1,
      })).rejects.toThrow(/holds no run/u)
    } finally {
      await host.dispose()
    }
  })
})

describe('the repair after a document moves under its rendering', () => {
  it('re-renders the typeset form over the document the run holds', async () => {
    const root = tempRoot('dsh-manuscripts-materialize-')
    const host = await boot({ manuscriptDirectory: root, documentCompiler: compiler() })
    try {
      const before = await driveOne(host.service)
      const runId = before.run.runId
      // ALREADY CURRENT: nothing to repair, and the answer says so rather than staying silent.
      const already = await host.service.materializeManuscript({ runId })
      expect(already.materialized).toBe(false)
      expect(already.reason).toContain('already renders the document the run holds')

      // A DOCUMENT THAT MOVED. The acceptance path publishes a new version without running a step,
      // so the typeset form is left rendering the version before it.
      const directory = join(root, runId)
      const original = readFileSync(join(directory, 'manuscript.md'), 'utf8')
      writeFileSync(join(directory, 'manuscript.md'), `${original}\nAn edit.\n`)
      const imported = await host.service.importManuscript({
        runId, format: 'markdown',
        expectedRevision: snapshotRevision(host, before),
        expectedManuscriptVersion: before.manuscriptDirectory?.currentVersion ?? 0,
      })

      const repaired = await host.service.materializeManuscript({ runId })
      expect(repaired.materialized).toBe(true)
      expect(repaired.documentVersion).toBe(imported.version)
      expect(repaired.renderedFromVersion).toBe(before.manuscriptDirectory?.currentVersion)
      expect(repaired.producedFormats).toContain('docx')
      expect(repaired.typesetVersion).not.toBeNull()
      // THE DIRECTORY PROJECTS THE REPAIR: the manifest's rendering is the version it was made from.
      const manifest = readDocumentManifest(join(root, runId))
      expect(manifest?.renderedFrom?.version).toBe(repaired.typesetVersion)
      expect(manifest?.manuscriptRef?.version).toBe(imported.version)

      // AND IT IS A NO-OP THE SECOND TIME, which is what makes it safe to call after every change.
      const again = await host.service.materializeManuscript({ runId })
      expect(again.materialized).toBe(false)
    } finally {
      await host.dispose()
    }
  })
})

/**
 * The run revision an import must state.
 *
 * THE SNAPSHOT'S OWN REVISION, which is what a page that read the run would send back — and what
 * makes "the study moved between the edit and the hand-back" checkable rather than assumed.
 *
 * @param _host - the booted host, kept in the signature so a caller reads the same way it boots.
 * @param snapshot - the snapshot the caller read.
 * @returns the revision.
 */
function snapshotRevision(_host: { service: ResearchTeamService }, snapshot: ResearchRunSnapshot): number {
  return snapshot.projectRevision
}
