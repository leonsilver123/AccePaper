/**
 * The team service, composed the way a deployment composes it.
 *
 * WHY THIS EXISTS BESIDE THE OTHER INTEGRATION SPECS. `manuscript-round-trip.spec.ts` and
 * `start-run.spec.ts` boot the real service over a stubbed engine with `ctx.plugin(...)`, which
 * exercises the behavior but not the COMPOSITION: the injected names, the configuration schema, and
 * what the service does with them at load are all bypassed when a spec provides services by hand.
 * `packages/AGENTS.md` requires a product-visible plugin to have one test that boots a test-only
 * `cordis.yml` through the Loader, and this is it.
 *
 * WHAT IS REAL HERE. The Loader, the config schema and its validation, the plugin's injected
 * dependencies, the team service, its driver, its executors, the research tools, and the files a run
 * writes. What is stubbed is the engine that owns the run store and the document toolchain — the two
 * things outside this package — and both are stubbed by a plugin the configuration names, not by
 * assignments this spec makes.
 *
 * WHAT IS ASSERTED is user-visible output: the run's working directory on disk, the document in it,
 * and the manifest that names every file.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { afterEach, describe, expect, it } from 'vitest'

import ResearchTeamService from '../src/index.ts'
import * as EngineStub from './fixtures/loader-boot/engine-stub.ts'
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

/**
 * Boot a test-only `cordis.yml` through the Loader.
 *
 * THE FILE IS WRITTEN PER TEST rather than checked in, because the two directories it states belong
 * to the test that owns them and are deleted with it. The plugin NAMES it uses are the shipped
 * package name and one name only this spec resolves, so nothing here can be reached by a deployment:
 * `Loader.internal.import` is the seam the include plugin loads modules through, and it resolves
 * exactly the two modules below.
 *
 * @param deployment - the two directories this deployment writes to.
 * @returns the booted context.
 */
async function bootComposition(deployment: {
  readonly snapshotDirectory: string
  readonly manuscriptDirectory: string
}): Promise<Context> {
  const root = tempRoot('dsh-loader-boot-')
  const configPath = join(root, 'cordis.yml')
  // Forward slashes and quoting: the values are absolute paths, and a Windows path's backslashes are
  // YAML escapes inside a double-quoted scalar.
  const path = (value: string): string => `"${value.replaceAll('\\', '/')}"`
  writeFileSync(configPath, [
    '- name: \'@dsh-research-team-tests/engine-stub\'',
    '  config:',
    `    snapshotDirectory: ${path(deployment.snapshotDirectory)}`,
    `    manuscriptDirectory: ${path(deployment.manuscriptDirectory)}`,
    "- name: '@deepseek-ai/dsh-research-team'",
    '',
  ].join('\n'))

  const context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@dsh-research-team-tests/engine-stub', EngineStub],
    ['@deepseek-ai/dsh-research-team', ResearchTeamService],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

/** Drive one whole study through the service the composition registered, and wait for it to stop. */
async function driveOne(context: Context): Promise<{ readonly runId: string }> {
  const service = context.agentTeams as unknown as ResearchTeamService
  const started = await service.startRun({ commandId: 'loader-boot-command' })
  for (;;) {
    const snapshot = await service.runSnapshot({ runId: started.runId })
    if (snapshot !== null && snapshot.execution === 'stopped') return { runId: started.runId }
    await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
  }
}

describe('the research team plugin, booted from a cordis.yml', () => {
  it('loads with every injected service present, and registers itself on the context', async () => {
    const context = await bootComposition({
      snapshotDirectory: tempRoot('dsh-loader-snap-'),
      manuscriptDirectory: tempRoot('dsh-loader-docs-'),
    })
    try {
      // NOTHING WAS LEFT UNLOADED: an entry that failed to load — a missing injection, a config the
      // schema refused — would be visible here rather than as a service that reads as absent.
      const unloaded = [...context.loader.entries()]
        .filter(entry => entry.fiber === undefined && !entry.disabled)
        .map(entry => entry.options.name)
      expect(unloaded).toEqual([])
      expect(context.get('agentTeams')).toBeInstanceOf(ResearchTeamService)
      // AND THE CONFIGURATION REACHED THE SERVICE: it reads this directory off the engine the same
      // configuration provided, which is what makes the projection below a deployment fact.
      expect((context.get('research') as { manuscriptDirectory?: string }).manuscriptDirectory).toBeDefined()
    } finally {
      await context.fiber.dispose()
    }
  })

  it('projects a driven run\'s document directory to disk', async () => {
    const manuscriptDirectory = tempRoot('dsh-loader-manuscripts-')
    const context = await bootComposition({
      snapshotDirectory: tempRoot('dsh-loader-snap-run-'),
      manuscriptDirectory,
    })
    try {
      const { runId } = await driveOne(context)

      // THE DIRECTORY A PERSON EDITS, written by the driver after the steps that commit. Every file
      // below was projected from the run's registry rather than handed to the driver by a step.
      const directory = join(manuscriptDirectory, runId)
      expect(existsSync(join(directory, 'manuscript.md'))).toBe(true)
      expect(existsSync(join(directory, 'document-manifest.json'))).toBe(true)
      // The compiled deliverables are the deployment's toolchain's, which the configuration named.
      expect(existsSync(join(directory, 'manuscript.docx'))).toBe(true)
      expect(existsSync(join(directory, 'manuscript.tex'))).toBe(true)

      // THE MANIFEST IS THE RECORD OF WHAT LANDED, and the document it names is the one on disk: a
      // run that projected nothing would leave the directory absent, which is a different fact from
      // a directory holding an empty document.
      const manifest = readDocumentManifest(directory)
      expect(manifest?.files.map(file => file.path)).toContain('manuscript.md')
      expect(manifest?.manuscriptRef).not.toBeNull()
      const printed = readFileSync(join(directory, 'manuscript.md'), 'utf8')
      expect(printed).toContain('## Results')
      // The tables the paper prints travel with it, which is the document's own floats projected.
      expect(existsSync(join(directory, 'tables/table-1.csv'))).toBe(true)
    } finally {
      await context.fiber.dispose()
    }
  })

})
