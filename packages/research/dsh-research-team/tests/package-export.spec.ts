/**
 * Run package export — contract tests.
 *
 * "Reproducible package" used to be a list of filenames beside a produced manuscript, and no
 * step wrote any of them. These tests hold the replacement to what that claim was missing:
 * every declared file really exists on disk, is non-empty, and is named in the manifest with
 * its own digest — and nothing that must not leave the process is in it.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getRunSnapshot, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import type { RunResult } from '../src/runner/types.ts'
import { runT19B } from '../src/runner/drive.ts'
import { planRunPackage, sanitizeForExport, writeRunPackage } from '../src/runner/package-export.ts'

const created: string[] = []

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'run-package-'))
  created.push(dir)
  return dir
}

/**
 * Drive the REAL 16-step pipeline with the shipped registry, so the package is planned from
 * artifacts a real run produced rather than from a hand-built store. A hand-built store would
 * assert against this test's idea of the store's shape, not against the engine's.
 */
async function realRun(): Promise<{ store: ResearchRunStore; run: RunResult }> {
  const store = new Map() as ResearchRunStore
  const run = await runT19B(store)
  return { store, run }
}

describe('planRunPackage', () => {
  it('names the project revision the package was read from', async () => {
    // A package is a reading of ONE state of the run. `generatedAt` says when someone read it, and
    // two exports a minute apart can carry different manuscripts — so a reader comparing two
    // packages, or matching a package against a screen, needs the revision and not the clock.
    const { store, run } = await realRun()
    const plan = planRunPackage(store, run, 'evaluation')

    expect(plan.manifest.projectRevision).toBe(getRunSnapshot(store, run.runId).revision)
    // And it is a revision this run actually reached, not the zero a missing read would produce.
    expect(plan.manifest.projectRevision).toBeGreaterThan(0)
  })

  it('builds every run-level file plus the ones E1 produced, as content', async () => {
    const { store, run } = await realRun()
    const plan = planRunPackage(store, run, 'evaluation')
    const paths = plan.files.map(file => file.path).sort()

    expect(paths).toContain('manuscript.md')
    expect(paths).toContain('experiment-tables.md')
    expect(paths).toContain('figures/figure-1.svg')
    for (const required of [
      'run-summary.md',
      'steps.json',
      'claim-evidence.json',
      'citations.json',
      'experiment.json',
      'reproducibility.md',
    ]) {
      expect(paths, required).toContain(required)
    }
    for (const file of plan.files) expect(file.content.length, file.path).toBeGreaterThan(0)
  })

  it('records every driven step with how it was produced, and nothing it did not drive', async () => {
    const { store, run } = await realRun()
    const plan = planRunPackage(store, run, 'evaluation')
    const stepIds = plan.manifest.steps.map(step => step.stepId)

    expect(stepIds).toEqual(run.steps.map(step => step.stepId))
    expect(stepIds[0]).toBe('A1-landscape')
    expect(plan.manifest.steps.find(step => step.stepId === 'E2-submit')?.kind).toBe('humanGate')
    // Each record names a producer and a channel, so a reader can tell what ran.
    for (const step of plan.manifest.steps) {
      expect(step.producer.length, step.stepId).toBeGreaterThan(0)
      expect(step.kind.length, step.stepId).toBeGreaterThan(0)
    }
  })

  it('names where each number came from instead of restating a measurement', async () => {
    const { store, run } = await realRun()
    const plan = planRunPackage(store, run, 'evaluation')
    expect(Object.keys(plan.manifest.numberSources)).toContain('experiment-tables.md')
    expect(plan.manifest.numberSources['experiment-tables.md']).toContain('mvp-results')
  })
})

describe('sanitizeForExport', () => {
  it('drops a field whose name says it carries a secret', () => {
    const value = sanitizeForExport({ keep: 'this', apiKey: 'sk-live-123', nested: { token: 'abc' } }) as Record<string, unknown>
    expect(value.keep).toBe('this')
    expect('apiKey' in value).toBe(false)
    expect('token' in (value.nested as Record<string, unknown>)).toBe(false)
  })

  it('reduces a machine path to its last segment', () => {
    expect(sanitizeForExport('written to H:\\AccePaper\\.workbuddy\\tmp\\out')).toBe('written to out')
    expect(sanitizeForExport('/home/someone/private/file.txt')).toBe('file.txt')
  })
})

describe('F04 — eligibility is not readiness', () => {
  it('reports a production run blocked at its first step as eligible and NOT ready', async () => {
    const store: ResearchRunStore = new Map()
    // A1 is held by core's own missing-anchor abstention: the run stops at the first step, so it
    // has no manuscript. This is the F04 shape — a blocked run whose manifest must not say it is
    // ready. The run is produced by driving the B channel's abstention scenario, not by a bypass.
    const run = await runT19B(store, {
      evidenceProfile: 'production',
      abstainComponents: (stepId: string) => (stepId === 'A1-landscape' ? ['B'] : []),
    })
    const plan = planRunPackage(store, run, 'production')
    // The deployment's profile is still `production`, so the output is ELIGIBLE — and nothing
    // about it is ready to submit.
    expect(plan.manifest.profileEligible).toBe(true)
    expect(plan.manifest.submissionReady).toBe(false)
    // The reason names the most immediate missing thing. For a run stopped at its first step that
    // is the manuscript; the unfinished-step branch is pinned in `submission-readiness.spec.ts`.
    expect(plan.manifest.readinessNote).toMatch(/no formatted manuscript/)
  })

  it('reports a production run that reached the human gate as eligible and NOT ready', async () => {
    // The other half of the same pair, and the one the reviewed evidence made reachable: with a
    // real literature anchor at B, a production run drives all fifteen steps and stops at
    // `E2-submit`. It is eligible, it produced a manuscript, and it is STILL not ready — a person
    // has not approved it.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { evidenceProfile: 'production' })
    const plan = planRunPackage(store, run, 'production')
    expect(plan.manifest.profileEligible).toBe(true)
    expect(plan.manifest.submissionReady).toBe(false)
    expect(plan.manifest.readinessNote).toMatch(/E2-submit/)
  })

  it('reports an evaluation run that finished every step as eligible-and-not-ready too', async () => {
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)
    const plan = planRunPackage(store, run, 'evaluation')
    // The evaluation profile is never eligible, whatever the run achieved.
    expect(plan.manifest.profileEligible).toBe(false)
    expect(plan.manifest.submissionReady).toBe(false)
    expect(plan.manifest.readinessNote).toMatch(/evaluation profile/)
  })

  it('still writes the run summary, and it says both facts', async () => {
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { evidenceProfile: 'production' })
    const plan = planRunPackage(store, run, 'production')
    const summary = plan.files.find(file => file.path === 'run-summary.md')
    expect(summary?.content).toMatch(/- evidence eligible: yes/)
    expect(summary?.content).toMatch(/- submission ready: \*\*NO\*\*/)
  })
})

describe('writeRunPackage', () => {
  it('writes every declared file, names it in the manifest with its digest, and nothing is empty', async () => {
    const dir = join(tempDir(), 'pkg')
    const { store, run } = await realRun()
    const plan = planRunPackage(store, run, 'evaluation')
    const manifest = writeRunPackage(plan, dir)

    expect(manifest.files.length).toBe(plan.files.length)
    for (const file of manifest.files) {
      const onDisk = join(dir, file.path)
      expect(existsSync(onDisk), file.path).toBe(true)
      const bytes = readFileSync(onDisk)
      expect(bytes.length, file.path).toBeGreaterThan(0)
      expect(file.bytes).toBe(bytes.length)
      expect(file.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    }
    // The manifest is written last, so its presence means the files it names exist.
    const manifestOnDisk = JSON.parse(readFileSync(join(dir, 'run-manifest.json'), 'utf8')) as {
      files: ReadonlyArray<{ path: string }>
      runId: string
    }
    expect(manifestOnDisk.runId).toBe(run.runId)
    expect(manifestOnDisk.files.length).toBe(plan.files.length)
  })

  it('keeps the machine directory and any secret out of the manifest', async () => {
    const dir = join(tempDir(), 'pkg')
    const { store, run } = await realRun()
    const manifest = writeRunPackage(planRunPackage(store, run, 'evaluation'), dir)
    const serialized = JSON.stringify(manifest)
    expect(serialized).not.toContain(dir)
    expect(serialized).not.toContain('sk-live-123')
  })
})
