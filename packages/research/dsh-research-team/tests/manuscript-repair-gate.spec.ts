/**
 * The repair re-renders the typeset form; it does not re-run the gates.
 *
 * WHAT THIS PINS, end to end through the operations a page reaches. `materializeManuscript` exists so
 * a form left rendering a superseded document can be brought up to date, and it is deliberately not
 * an adjudication: E1's obligations were discharged where the document was assembled and their
 * verdicts are recorded against that attempt, which is never re-submitted. So a repaired form is a
 * rendering NO GATE HAS JUDGED — and before this was a condition, the only thing standing between a
 * hand-edited document and the package a journal receives was a person's approval, which binds a
 * document VERSION rather than a judgement. The run below is measured in the two states that matter:
 * the one E1 produced, and the one the repair produced over a document a person edited.
 *
 * The facts are decided from the run's own records — the typeset artifact's `materializedFrom`
 * marker — so the refusal cannot be satisfied by describing the run differently.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import ResearchTeamService from '../src/index.ts'
import type { ResearchRunSnapshot } from '../src/types.ts'
import type { DocumentCompiler } from '../src/runner/document-compile.ts'

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

/** A compiler that produces the three deliverables and reads an edited Markdown file back. */
function compiler(): DocumentCompiler {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  return {
    tool: 'bytes',
    formats: ['html', 'latex', 'docx'],
    compile: request => Promise.resolve(request.format === 'docx'
      ? {
        format: request.format, fileName: 'manuscript.docx', content: 'UEsDBA==', encoding: 'base64' as const,
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
 * The service over a deployment with a working directory, a package directory and a production
 * profile — the configuration in which a final package is a thing a person can ask for.
 *
 * @param root - the manuscript directory.
 * @param packages - the package directory.
 * @returns the service, the engine's mutable config, and a disposer.
 */
async function boot(root: string, packages: string): Promise<{
  readonly service: ResearchTeamService
  dispose(): Promise<void>
}> {
  const ctx = new Context()
  for (const name of ['agents', 'sessions', 'sessionPersistence', 'subagents']) ctx.provide(name, {})
  ctx.provide('sessionProjections', { register: () => () => {} })
  ctx.provide('tools', { guard: () => () => {}, register: () => () => {} })
  ctx.provide('research', {
    snapshotDirectory: tempRoot('dsh-repair-snap-'),
    manuscriptDirectory: root,
    packageDirectory: packages,
    documentCompiler: compiler(),
    evidenceProfile: 'production',
  })
  const fiber = await ctx.plugin(ResearchTeamService, {})
  return {
    service: ctx.agentTeams as unknown as ResearchTeamService,
    dispose: async () => { await fiber.dispose() },
  }
}

/** One command id per run, so a retried id cannot be answered with the previous study. */
let nextCommand = 1

/**
 * Drive one whole study and return the snapshot the service projects.
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

/** One export's checks, by code. */
interface ReportedCheck {
  readonly code: string
  readonly passed: boolean
  readonly detail: string
}

/**
 * The checks an export reports, by code.
 *
 * @param exported - what `exportRunPackageNow` answered.
 * @returns each check's verdict and its detail, keyed by code.
 */
function checksOf(exported: { readonly checks?: ReadonlyArray<ReportedCheck> }): Map<string, ReportedCheck> {
  return new Map((exported.checks ?? []).map(check => [check.code, check]))
}

describe('a typeset form the repair produced is not a form the gates judged', () => {
  it('refuses the package after the document is edited and the form re-rendered', async () => {
    const root = tempRoot('dsh-repair-')
    const packages = tempRoot('dsh-repair-packages-')
    const host = await boot(root, packages)
    try {
      const before = await driveOne(host.service)
      const runId = before.run.runId
      // THE STATE E1 PRODUCED. The form renders the document the run holds and E1's execution wrote
      // it, so the condition holds — otherwise the refusal below would be about every run.
      const untouched = checksOf(await host.service.exportRunPackageNow({ runId, mode: 'draft' }))
      expect(untouched.get('manuscript-gated')?.passed).toBe(true)
      expect(untouched.get('manuscript-typeset')?.passed).toBe(true)

      // A PERSON EDITS THE FILE and hands it back, then the form is brought up to date. Both are the
      // operations a page reaches; nothing here calls a private method.
      const directory = join(root, runId)
      const original = readFileSync(join(directory, 'manuscript.md'), 'utf8')
      writeFileSync(join(directory, 'manuscript.md'), `${original}\nAn edit no gate has seen.\n`)
      const snapshot = await host.service.runSnapshot({ runId })
      await host.service.importManuscript({
        runId,
        format: 'markdown',
        expectedRevision: snapshot?.projectRevision ?? 0,
        expectedManuscriptVersion: snapshot?.manuscriptDirectory?.currentVersion ?? 0,
      })
      const repaired = await host.service.materializeManuscript({ runId })
      expect(repaired.materialized).toBe(true)

      // THE RENDER IS NOW OF THE DOCUMENT THE RUN HOLDS — which is what the repair was for — and the
      // gates are still on the one it replaced.
      const after = checksOf(await host.service.exportRunPackageNow({ runId, mode: 'draft' }))
      expect(after.get('manuscript-typeset')?.passed).toBe(true)
      expect(after.get('manuscript-gated')?.passed).toBe(false)
      expect(after.get('manuscript-gated')?.detail).toContain('no gate has judged the document the run holds')
      // AND THE MATCHING VERSION IS IN THE SENTENCE, so a reader can see which render was answered.
      expect(after.get('manuscript-gated')?.detail).toContain(`re-rendered from document version ${String(repaired.renderedFromVersion ?? -1)}`)

      // THE FINAL EXPORT IS THE OPERATION THAT ENFORCES IT, not the button that hides the control.
      await host.service.runSnapshot({ runId })
      await expect(host.service.exportRunPackageNow({ runId, mode: 'final' }))
        .rejects.toThrow(/manuscript-gated/u)
    } finally {
      await host.dispose()
    }
  })
})
