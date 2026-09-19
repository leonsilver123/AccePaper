// @deepseek-ai/dsh-research-team — the deployment facts a Loader-booted composition test supplies.
//
// WHY THIS IS A PLUGIN AND NOT A HAND-BUILT CONTEXT. The team service reads its deployment facts off
// `ctx.research` — where the run's snapshot is saved, where the working document is projected, and
// which document toolchain the machine has — and the Loader is what a real deployment uses to fill
// those in from `cordis.yml`. This module is the STAND-IN for the engine that does that in
// production (`@deepseek-ai/dsh-research-cordis`, which this package may not depend on): it provides
// the same service names from the same kind of configuration, so a run reaches the driver through the
// real composition path rather than through a context a spec assembled by hand.
//
// WHAT IS STUBBED IS ONLY WHAT IS EXTERNAL OR NONDETERMINISTIC: the engine that owns the run store,
// the agent/session/tool services the team service injects, and the document toolchain (which on a
// real machine is `pandoc` behind a subprocess). Everything else in the composition — the team
// service, its driver, its executors, the research tools — is the shipped code.

import { mkdirSync } from 'node:fs'

import z from '@deepseek-ai/schemastery'

import type { Context } from '@deepseek-ai/cordis'
import type { DocumentCompiler } from '../../../src/runner/document-compile.ts'

/** The plugin name the Loader loads this module under. */
export const name = 'research-engine-stub'

/** The deployment settings this stand-in engine reads, as `cordis.yml` states them. */
export interface Config {
  /** Directory the run's durable snapshot is written to; created here, as the engine does at startup. */
  readonly snapshotDirectory: string
  /** Directory the run's working document is projected to. */
  readonly manuscriptDirectory: string
}

export const Config: z<Config> = z.object({
  snapshotDirectory: z.string().required(),
  manuscriptDirectory: z.string().required(),
})

/**
 * A document toolchain that answers every format without spawning anything.
 *
 * A COMPILE IS AN EXTERNAL DEPENDENCY — a `pandoc` binary on the machine — so a composition test
 * replaces it. What it answers with is the shape the seam requires and nothing more: the point of the
 * test is that the files the driver projects reach the disk, not that this renders a Word document.
 *
 * @returns the compiler, as `ctx.research.documentCompiler` is read.
 */
function stubCompiler(): DocumentCompiler {
  // A DOCX IS BYTES — a ZIP of OOXML — so it answers with one, as the real toolchain does. What the
  // bytes contain is not what a composition test is about; that they are bytes is, because the
  // projection writes the compiled deliverables from the compile's own record of them.
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]).toString('base64')
  return {
    tool: 'loader-boot-stub',
    formats: ['html', 'latex', 'docx'],
    compile: request => Promise.resolve(request.format === 'docx'
      ? {
        format: request.format,
        fileName: 'manuscript.docx',
        content: zip,
        encoding: 'base64' as const,
        tool: 'loader-boot-stub@1',
        assets: { embedded: [], dropped: [] },
        files: [],
      }
      : {
        format: request.format,
        fileName: `manuscript.${request.format === 'latex' ? 'tex' : request.format}`,
        content: `<document>${request.document.title}</document>`,
        encoding: 'utf8' as const,
        tool: 'loader-boot-stub@1',
        assets: { embedded: [], dropped: [] },
        files: [],
      }),
  }
}

/**
 * Provide the services the team service injects, and the deployment facts it reads.
 *
 * THE PROVIDES COVER EXACTLY `ResearchTeamService.static inject` plus `research`, which is the seam a
 * real deployment fills in from its own configuration.
 *
 * @param ctx - the plugin's context.
 * @param config - this deployment's directories, as the test-only `cordis.yml` states them.
 */
export function apply(ctx: Context, config: Config): void {
  for (const name of ['agents', 'sessions', 'sessionPersistence', 'subagents']) {
    ctx.provide(name, {})
  }
  // Registration is the one projection call the service's constructor makes, so the stand-in returns
  // the disposer a registry returns rather than nothing.
  ctx.provide('sessionProjections', { register: () => () => {} })
  ctx.provide('tools', { guard: () => () => {}, register: () => () => {} })
  // The snapshot store never creates its own directory, and the engine that owns it does so at
  // startup — which is what this stands in for. A missing directory must surface at the first save,
  // so it is created here rather than left for the save to discover.
  mkdirSync(config.snapshotDirectory, { recursive: true })
  ctx.provide('research', {
    snapshotDirectory: config.snapshotDirectory,
    manuscriptDirectory: config.manuscriptDirectory,
    documentCompiler: stubCompiler(),
  })
}
