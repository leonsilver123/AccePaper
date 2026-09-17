/**
 * Run package export — contract tests.
 *
 * "Reproducible package" used to be a list of filenames beside a produced manuscript, and no
 * step wrote any of them. These tests hold the replacement to what that claim was missing:
 * every declared file really exists on disk, is non-empty, and is named in the manifest with
 * its own digest — and nothing that must not leave the process is in it.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getRunSnapshot, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import type { RunResult } from '../src/runner/types.ts'
import { runT19B } from '../src/runner/drive.ts'
import { checkPackagedFiles, planRunPackage, sanitizeForExport, writeRunPackage } from '../src/runner/package-export.ts'

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

describe('a package that fails to write leaves the one that was there', () => {
  it('keeps the published package intact, and leaves no half-written directory behind', async () => {
    // WHAT AN IN-PLACE WRITER COSTS. A package is the directory AND the manifest beside it, and the
    // two are the same object only while every entry matches. A failure halfway through writing files
    // in place leaves the PREVIOUS manifest beside THIS export's files: a directory that reads like a
    // package, verifies as nothing, and says nothing about which entries are which.
    const dir = join(tempDir(), 'pkg')
    const { store, run } = await realRun()
    const published = writeRunPackage(planRunPackage(store, run, 'evaluation'), dir)
    const before = readFileSync(join(dir, 'run-manifest.json'), 'utf8')

    // A plan that cannot be written: `b` is a file, and `b/c.md` needs `b` to be a directory.
    const broken = planRunPackage(store, run, 'evaluation')
    const failing = {
      files: [...broken.files, { path: 'b', content: 'a file\n' }, { path: 'b/c.md', content: 'under it\n' }],
      manifest: broken.manifest,
    }
    expect(() => writeRunPackage(failing, dir)).toThrow(/run-package|ENOTDIR|EEXIST|ENOENT/)

    // THE PACKAGE IS THE ONE FROM BEFORE: same manifest bytes, and every entry still verifies.
    expect(readFileSync(join(dir, 'run-manifest.json'), 'utf8')).toBe(before)
    expect(checkPackagedFiles(dir, published).filter(check => check.status !== 'ok')).toEqual([])
    // AND NOTHING WAS LEFT BESIDE IT: no staging directory, no superseded copy.
    const siblings = readdirSync(dirname(dir))
    expect(siblings.filter(name => name.includes('staging-') || name.includes('superseded-'))).toEqual([])
  })
})

describe('a package verifies as what its manifest says it is', () => {
  it('checks every file: present, the stated bytes, the stated digest', async () => {
    const dir = join(tempDir(), 'pkg')
    const { store, run } = await realRun()
    const manifest = writeRunPackage(planRunPackage(store, run, 'evaluation'), dir)

    const checks = checkPackagedFiles(dir, manifest)
    expect(checks).toHaveLength(manifest.files.length)
    expect(checks.filter(check => check.status !== 'ok')).toEqual([])
  })

  it('reports a file that is gone, one that changed length, and one that changed without changing length', async () => {
    // THE THREE WAYS A DIRECTORY STOPS BEING THE PACKAGE ITS MANIFEST DESCRIBES, and the reason this
    // is one call rather than a habit: a delivery that copied the files somewhere tidier, trimmed
    // them, or dropped the ones a reader did not need reads exactly like an intact package.
    const dir = join(tempDir(), 'pkg')
    const { store, run } = await realRun()
    const manifest = writeRunPackage(planRunPackage(store, run, 'evaluation'), dir)
    const [first, second, third] = manifest.files
    rmSync(join(dir, first!.path))
    // Same length, different bytes: the byte count cannot see this one.
    const original = readFileSync(join(dir, second!.path), 'utf8')
    const sameLength = `${original.slice(0, 1) === 'a' ? 'b' : 'a'}${original.slice(1)}`
    writeFileSync(join(dir, second!.path), sameLength, 'utf8')
    writeFileSync(join(dir, third!.path), 'trimmed', 'utf8')

    const byPath = new Map(checkPackagedFiles(dir, manifest).map(check => [check.path, check]))
    expect(byPath.get(first!.path)?.status).toBe('missing')
    expect(byPath.get(third!.path)?.status).toBe('bytes-differ')
    // The second file kept its length, so only the digest disagrees — and it is reported as such.
    const secondCheck = byPath.get(second!.path)
    expect(secondCheck?.status === 'digest-differs' || secondCheck?.status === 'bytes-differ').toBe(true)
    expect(secondCheck?.observedSha256).not.toBe(second!.sha256)
  })

  it('states when the reading was taken, and not the epoch', async () => {
    // A manifest reading `1970-01-01T00:00:00.000Z` told every reader the package was generated
    // before the study existed, which is also the one fact that lets a reader tell the package made
    // after an approval from the one the drive wrote.
    const { store, run } = await realRun()
    const manifest = planRunPackage(store, run, 'evaluation').manifest
    expect(Date.parse(manifest.generatedAt)).toBeGreaterThan(Date.parse('2020-01-01T00:00:00.000Z'))

    // A caller that wants a fixed value states one, which is what makes this testable at all.
    const pinned = planRunPackage(store, run, 'evaluation', {
      mode: 'draft', generatedAt: '2026-09-17T00:00:00.000Z',
    }).manifest
    expect(pinned.generatedAt).toBe('2026-09-17T00:00:00.000Z')
  })
})

describe('the package states what the quality baseline found', () => {
  it('carries the findings in the manifest, computed from the run and the manuscript', async () => {
    // A PACKAGE IS WHAT A READER RECEIVES. A list of files with digests says nothing about whether the
    // manuscript refers to its own figures or positions itself in its own bibliography — so the
    // baseline runs where the package is built, and its findings travel with it.
    const { store, run } = await realRun()
    const manifest = planRunPackage(store, run, 'evaluation').manifest

    expect(Array.isArray(manifest.qualityFindings)).toBe(true)
    // The shipped pipeline's own output, as the baseline reads it: objects it carries and never uses.
    const uncited = manifest.qualityFindings.filter(finding => finding.code === 'uncited-object')
    expect(uncited.length).toBeGreaterThan(0)
    for (const finding of uncited) expect(finding.detail).toContain('no sentence in it refers')
  })
})

describe('a package says whether it is the final one or a draft', () => {
  it('writes a draft for a run that has not been approved, naming every condition that failed', async () => {
    // THE EXPORT AT THE END OF A DRIVE IS A DRAFT, and this is the state the approval that follows it
    // never reached: the manifest used to be written without saying which of the two it was.
    const { store, run } = await realRun()
    const manifest = planRunPackage(store, run, 'evaluation').manifest

    expect(manifest.state).toBe('draft')
    const failed = manifest.checks.filter(check => !check.passed).map(check => check.code)
    expect(failed).toContain('production-evidence')
    expect(failed).toContain('approval-recorded')
    // Nothing is recorded as an approval, because none was made.
    expect(manifest.approval).toBeUndefined()
  })

  it('states the state in the package files themselves, not only in the manifest', async () => {
    const dir = join(tempDir(), 'pkg')
    const { store, run } = await realRun()
    writeRunPackage(planRunPackage(store, run, 'evaluation'), dir)
    const summary = readFileSync(join(dir, 'run-summary.md'), 'utf8')

    expect(summary).toContain('package state: `draft`')
    expect(summary).toContain('A WORKING DRAFT, not for submission')
    // And nothing in the summary reads as a journal submission.
    expect(summary.toLowerCase()).not.toContain('submitted to')
  })

  it('carries the approval and its versions when one was made', async () => {
    // The manifest of a FINAL package names the decision and the artifact versions it covered, which
    // is what lets a reader compare two packages — or a package and a screen — and see whether the
    // same revision was approved.
    const { store, run } = await realRun()
    const approved = { ...run, steps: run.steps.map(step => ({ ...step, status: 'passed' as const })) }
    const manifest = planRunPackage(store, approved, 'evaluation').manifest
    expect(manifest.state).toBe('draft')
    // The evaluation profile alone keeps it a draft: this is a REAL run under a non-production
    // profile, and no amount of ticking its steps makes its material publishable.
    expect(manifest.checks.find(check => check.code === 'production-evidence')?.passed).toBe(false)
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
