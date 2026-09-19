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
import { getArtifact, getRunSnapshot, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import type { ThreeLineTableModel } from '@deepseek-ai/dsh-research-tools'
import type { RunResult } from '../src/runner/types.ts'
import { runT19B } from '../src/runner/drive.ts'
import { resolveResearchProfile } from '../src/runner/research-profile.ts'
import { checkPackagedFiles, citedAttachments, csvRecords, packagedTablesOf, planRunPackage, sanitizeForExport, writeRunPackage } from '../src/runner/package-export.ts'
import { tableCellsOf } from '../src/runner/paper-format.ts'
import type { StagedFile } from '../src/runner/staged-directory.ts'
import { sourcesForMode } from '../src/runner/citation-bindings.ts'
import type { ReferencePdfRead } from '../src/runner/package-export.ts'
import type { DocumentCompiler } from '../src/runner/document-compile.ts'

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

/**
 * A compiler that answers with the two kinds of binary a real one produces.
 *
 * A DOCX is a ZIP and a figure is a PNG, and this answers with each one's real magic bytes: a writer
 * that decoded, re-encoded or text-wrapped the content would still pass a length check and would not
 * pass this. The document's own content is not what is under test here — `pdf-acceptance.spec.ts`
 * reads a real one.
 *
 * @returns the compiler, as `DriveOptions.documentCompiler` takes it.
 */
function byteCompiler(): DocumentCompiler {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  return {
    tool: 'bytes',
    formats: ['html', 'latex', 'docx'],
    compile(request) {
      // `PK`, base64 — the ZIP signature every DOCX begins with.
      const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]).toString('base64')
      return Promise.resolve(request.format === 'docx'
        ? {
          format: request.format,
          fileName: 'manuscript.docx',
          content: zip,
          encoding: 'base64' as const,
          tool: 'bytes@1',
          assets: { embedded: ['Figure 1'], dropped: [] },
          files: [{ path: 'assets/figure-1.png', label: 'Figure 1', base64: PNG }],
        }
        : {
          format: request.format,
          fileName: `manuscript.${request.format === 'latex' ? 'tex' : 'html'}`,
          content: `<document>${request.document.title}</document>`,
          encoding: 'utf8' as const,
          tool: 'bytes@1',
          assets: { embedded: ['Figure 1'], dropped: [] },
          files: [{ path: 'assets/figure-1.png', label: 'Figure 1', base64: PNG }],
        })
    },
  }
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

  it('writes the compiled documents as bytes, beside the figures they embed', async () => {
    // THE DELIVERABLES A JOURNAL IS HANDED ARE BINARY. A DOCX and a PDF cannot go in the text files,
    // and they are not figures the document embeds either — a package that listed the manuscript among
    // its own assets left a reader looking for it in the wrong place, and one that listed it nowhere
    // left them without it. Both lists are written here, so this asserts the file is on disk.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { documentCompiler: byteCompiler() })
    const plan = planRunPackage(store, run, 'evaluation')
    const docx = plan.files.find(file => file.path === 'manuscript.docx')
    const figure = plan.files.find(file => file.path === 'assets/figure-1.png')
    expect(docx?.encoding).toBe('base64')
    // The byte file is the ZIP a DOCX really is, not its base64 text written out as a document.
    expect(Buffer.from(docx?.content ?? '', 'base64').subarray(0, 2).toString('latin1')).toBe('PK')
    expect(figure?.encoding).toBe('base64')
    expect(Buffer.from(figure?.content ?? '', 'base64').subarray(0, 4).toString('latin1')).toBe(String.fromCharCode(137) + 'PNG')
    // AND THE PACKAGE SAYS IT CARRIES THEM. `manuscript.docx` is not among the manuscript's declared
    // TEXT files — a DOCX is bytes — so nothing but this condition could tell a package that wrote it
    // from one that did not, and a journal is handed a document rather than the Markdown behind it.
    const deliverables = plan.manifest.checks.find(check => check.code === 'deliverables-present')
    expect(deliverables?.passed, deliverables?.detail).toBe(true)
    expect(deliverables?.detail).toContain('manuscript.docx')
  })

  it('writes a text document from `packageFiles` alone, and not again from the compile record', async () => {
    // `compilation.documents` CARRIES ONE RECORD PER COMPILED DOCUMENT — `{format, path, bytes,
    // sha256}`, with `base64` present only for the binary formats — so `.tex` and `.html` appear there
    // AND in `packageFiles`, which is where their text is. The bytes loop skips an entry with no
    // `base64` for that reason, and the failure it prevents is silent: one path written twice, with
    // the digest describing whichever content won.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { documentCompiler: byteCompiler() })
    const plan = planRunPackage(store, run, 'evaluation')
    const paths = plan.files.map(file => file.path)

    expect(paths.filter(path => path === 'manuscript.tex').length).toBe(1)
    expect(paths.filter(path => path === 'manuscript.html').length).toBe(1)
    expect(plan.files.find(file => file.path === 'manuscript.tex')?.encoding).toBeUndefined()
    // The binary one is here AND in `compilation.documents`, and it is written as the bytes it is.
    expect(plan.files.find(file => file.path === 'manuscript.docx')?.encoding).toBe('base64')
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
    //
    // AND ON THIS RUN IT FINDS NOTHING, which is the reading to keep: the same baseline reported six
    // floats nothing referred to and no literature position on the paper this pipeline produced
    // before, and the units that followed made the sections name their floats, cite their sources and
    // report their own refutation. A regression in any of those turns this assertion red — the
    // directions of the rules themselves are tested in `paper-quality.spec.ts`.
    const { store, run } = await realRun()
    const manifest = planRunPackage(store, run, 'evaluation').manifest

    expect(Array.isArray(manifest.quality.findings)).toBe(true)
    expect(manifest.quality.findings).toEqual([])
    // ...AND THE EMPTY LIST TRAVELS WITH WHAT PRODUCED IT. On its own it reads as a verdict on the
    // paper; the checks say which rules could read this manuscript, the summary says what the report
    // is, and the questions left to a reviewer are named rather than implied by the silence.
    expect(manifest.quality.checks.map(check => check.code)).toEqual([
      'uncited-object', 'unrendered-object', 'no-literature-position', 'unsupported-statement',
      'metric-misread',
    ])
    expect(manifest.quality.checks.filter(check => check.outcome === 'defect-found')).toEqual([])
    expect(manifest.quality.needsDomainReview.length).toBeGreaterThan(0)
    expect(manifest.quality.summary).toContain('no defect found by the')
    expect(manifest.quality.summary).toContain('need a domain reviewer')
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

describe('the metrics a package states its study was conducted under', () => {
  it('names the required metrics of a simulation study, and the ones it does not have', async () => {
    // REQUIRED AND NOT-APPLICABLE ARE DIFFERENT FACTS, and the package is where a reader meets them:
    // a review's metric being absent from a simulation study's package must not read as a gap in the
    // study. The profile travels in the run's frozen spec, so this is read from the run.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, {
      researchProfile: resolveResearchProfile({ researchType: 'simulation-study' }),
    })
    const declared = planRunPackage(store, run, 'evaluation').manifest.declaredMetrics
    // THE RUN'S OWN STUDY'S METRICS, not the research type's: the type says which quantities are
    // applicable to this kind of work (both simulation studies' metrics), while a RUN requires the
    // ones its study measures. `required: false` is "belongs to another study", which is a different
    // fact from a metric the study failed to measure.
    expect(declared?.map(metric => [metric.key, metric.required])).toEqual([
      ['min-ttc-seconds', true],
      ['string-stability-index', true],
      ['citation-coverage', false],
      ['p95-latency-ms', false],
    ])
    // The package states what the numbers MEAN, so a reader does not have to know the registry.
    expect(declared?.[0]?.direction).toBe('higher-is-better')
    expect(declared?.[0]?.unit).toBe('s')
    expect(declared?.[0]?.interpretation.length).toBeGreaterThan(40)
  })

  it('REFUSES a run whose plan is not a study of the type it is conducted as', () => {
    // THE STUDY AND THE TYPE MUST AGREE. Driving the platoon plan under a `literature-review` profile
    // is two configurations disagreeing about what the run is: a reader would check it against the
    // review's metric while the numbers came from a simulation. Refused before the first step.
    //
    // A review that actually runs would need a review implementation, which this runner does not have
    // — so the honest reading today is the refusal, not a package naming a review's metric.
    const store: ResearchRunStore = new Map()
    return expect(runT19B(store, {
      researchProfile: resolveResearchProfile({ researchType: 'literature-review' }),
    })).rejects.toThrow(/the study and the type must be the same configuration/u)
  })

  it('states the study\'s own metrics for a run that recorded no profile', async () => {
    // A RUN DRIVEN WITHOUT A PROFILE still has a STUDY — the plan resolved to an implementation — so
    // its metrics are read off that study. The fallback is the study, not a default profile: the run's
    // own plan is what says what it measured.
    const { store, run } = await realRun()
    const declared = planRunPackage(store, run, 'evaluation').manifest.declaredMetrics
    expect(declared?.filter(metric => metric.required).map(metric => metric.key))
      .toEqual(['min-ttc-seconds', 'string-stability-index'])
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

describe('a package that says which state it describes', () => {
  it('records the artifact versions it was read from', async () => {
    // AN EXPORT IS A READING OF ONE STATE. The manifest names the versions, so a reader comparing two
    // packages — or a package with a screen — can tell whether they describe the same run.
    const { store, run } = await realRun()
    const manifest = planRunPackage(store, run, 'evaluation').manifest
    expect(manifest.artifactRefs.map(entry => entry.slug))
      .toContain('typeset')
    for (const entry of manifest.artifactRefs) expect(entry.version).toBeGreaterThan(0)
    expect(manifest.checks.find(check => check.code === 'artifacts-current')?.passed).toBe(true)
  })

  it('refuses to call itself current when the run has moved past what it read', async () => {
    // THE LATE-WRITE CASE: the package on disk names version N of the manuscript and the run holds
    // N+1 — a later step, a revision, a re-run or a hand edit. The check names what moved instead of
    // attesting to a state the run no longer holds.
    const { store, run } = await realRun()
    const first = planRunPackage(store, run, 'evaluation').manifest
    const stale = first.artifactRefs.map(entry => ({ slug: entry.slug, version: entry.version - 1 }))
    const second = planRunPackage(store, run, 'evaluation', {
      mode: 'final',
      previousArtifactRefs: stale,
    }).manifest

    const check = second.checks.find(entry => entry.code === 'artifacts-current')
    expect(check?.passed).toBe(false)
    expect(check?.detail).toContain('typeset')
    // AND THE PACKAGE IS NOT FINAL, whatever else holds: a reading of a state the run has left is not
    // the package to hand anyone.
    expect(second.state).toBe('draft')
  })
})

describe('the tables a package carries', () => {
  it('writes the printed table and its machine-readable twin, both from the model the document holds', async () => {
    // THE TABLE WAS IN THE PACKAGE ONLY AS PROSE INSIDE THE MANUSCRIPT. A reader who wants the
    // numbers had to find them in Markdown, and nothing offered them to a tool. Both forms are read
    // out of the block the manuscript holds, so the CSV cannot describe a different table from the
    // one the paper prints.
    const { store, run } = await realRun()
    const plan = planRunPackage(store, run, 'evaluation')
    const paths = plan.files.map(file => file.path)

    expect(paths).toContain('tables/table-1.md')
    expect(paths).toContain('tables/table-1.csv')
    const markdown = plan.files.find(file => file.path === 'tables/table-1.md')?.content ?? ''
    const csv = plan.files.find(file => file.path === 'tables/table-1.csv')?.content ?? ''
    // The printed form carries the caption the paper prints with the table.
    expect(markdown).toContain('**Table 1.**')
    // THE TWO FORMS ARE ONE TABLE, and the evidence is the MODEL the block carries rather than one
    // form re-read out of the other: the CSV's records are the cells that model states.
    const artifact = getArtifact(store, run.runId, 'manuscript') as Record<string, unknown> | undefined
    const block = (artifact?.['document'] as { sections: ReadonlyArray<{ blocks: ReadonlyArray<Record<string, unknown>> }> })
      .sections.flatMap(section => section.blocks).find(entry => entry['kind'] === 'table')
    const cells = tableCellsOf(block?.['model'] as ThreeLineTableModel)
    const records = csv.trimEnd().split('\n').map(line => line.split(','))
    expect(records[0]).toEqual([...cells.header])
    expect(records.slice(1)).toEqual(cells.rows.map(row => [...row]))
    expect(records.length).toBe(3)
  })

  it('writes the twin from the structured model, so a cell the printed table cannot carry survives', () => {
    // THE MODEL IS WHAT BOTH FORMS ARE READ FROM. A pipe table ends a row at a newline, so a cell
    // holding one is flattened in the printed table — and a twin parsed back out of that rendering
    // reported the flattened text as the table's own. Written from the model, the cell is quoted
    // whole and any reader gets back what the table says.
    const files: StagedFile[] = []
    const tables = packagedTablesOf({
      sections: [{
        id: 'results',
        heading: 'Results',
        blocks: [{
          kind: 'table',
          label: 'Table 1',
          caption: 'Measured results',
          markdown: '| Method |\n| --- |\n| one two |\n',
          model: {
            columns: [{ header: 'Method' }],
            rows: [[{ kind: 'text', text: 'one\ntwo' }]],
          },
        }],
      }],
    }, files)

    expect(tables.map(table => table.label)).toEqual(['Table 1'])
    expect(files.map(file => file.path)).toEqual(['tables/table-1.md', 'tables/table-1.csv'])
    // The printed form is the rendering the document carries, newline flattened and all.
    expect(files[0]?.content).toContain('| one two |')
    // The twin is a CSV record whose field carries the newline, quoted the way RFC 4180 requires.
    expect(files[1]?.content).toBe('Method\n"one\ntwo"\n')
  })

  it('carries no table whose block declares no model, rather than a caption over nothing', () => {
    // THE MODEL IS WHAT MAKES A BLOCK A TABLE. A `table` block without one is not the block the
    // writing step splices in — this reader runs at the artifact boundary, where a value came out of
    // a durable store — and publishing its caption over an unreadable rendering would report a table
    // the run does not have.
    const files: StagedFile[] = []
    const tables = packagedTablesOf({
      sections: [{
        id: 'results',
        heading: 'Results',
        blocks: [{ kind: 'table', label: 'Table 1', caption: 'Measured results', markdown: '| Method |\n| --- |\n| x |\n' }],
      }],
    }, files)

    expect(tables).toEqual([])
    expect(files).toEqual([])
  })

  it('names both files in the manifest, and says where the numbers came from', async () => {
    const { store, run } = await realRun()
    const manifest = planRunPackage(store, run, 'evaluation').manifest
    const entry = manifest.tables.find(table => table.label === 'Table 1')

    expect(entry?.markdown).toBe('tables/table-1.md')
    expect(entry?.csv).toBe('tables/table-1.csv')
    for (const path of ['tables/table-1.md', 'tables/table-1.csv']) {
      expect(manifest.numberSources[path]).toContain('mvp-results')
    }
  })
})

describe('CSV is written so any reader reads the same cells back', () => {
  it('quotes a field that carries a comma, a quote, a newline or a carriage return', () => {
    // A CAPTION OR A CELL CONTAINING ANY OF THESE MUST SURVIVE. A writer that joined on commas and
    // did not quote would produce a file that parses into a different table — silently, because it
    // still looks like CSV.
    expect(csvRecords([['plain', 'a,b', 'say "hi"', 'two\nlines', 'cr\rhere']]))
      .toBe('plain,"a,b","say ""hi""","two\nlines","cr\rhere"\n')
  })

  it('leaves a field that needs no quoting bare, and writes the records in order', () => {
    expect(csvRecords([['Method', 'Minimum TTC (s)'], ['HV-AV-HV', '12.10']]))
      .toBe('Method,Minimum TTC (s)\nHV-AV-HV,12.10\n')
    expect(csvRecords([])).toBe('')
  })
})

/** One PDF's bytes, the digest over them, and the cite key a real run cites. */
const PDF_BYTES = Buffer.from('%PDF-1.7 synthetic reference file')
const PDF_SHA256 = createHash('sha256').update(PDF_BYTES).digest('hex')
const CITED_KEY = 'cite-10.1016/j.trb.2025.103352'

/**
 * One attachment read, as the caller hands it to the exporter.
 *
 * @param over - the fields a case varies: the version or key the reader returned, the digest it
 *   stated, or the failure it reported instead of bytes.
 * @returns the read the exporter is given.
 */
function referenceRead(
  over: Partial<{ version: string; key: string; sha256: string; failure: string }> = {},
): ReferencePdfRead {
  return {
    citeKey: CITED_KEY,
    readFrom: { sourceIdentity: 'zotero:user:1:ABCD1234', key: 'PDFKEY01', version: '7' },
    file: over.failure === undefined
      ? {
        key: over.key ?? 'PDFKEY01',
        version: over.version ?? '7',
        sha256: over.sha256 ?? PDF_SHA256,
        base64: PDF_BYTES.toString('base64'),
      }
      : { failure: over.failure },
  }
}

describe('the reference files a package carries', () => {
  it('says the deployment stores none, rather than leaving a folder to be interpreted', async () => {
    // AN EMPTY `refs-pdf/` AND A DEPLOYMENT THAT READS NO FILES ARE DIFFERENT FACTS. The manifest says
    // which one it is, so a reader is never left to decide whether a file is missing.
    const { store, run } = await realRun()
    const plan = planRunPackage(store, run, 'evaluation')
    expect(plan.manifest.referencePdfs).toBe('not-stored')
    expect(plan.files.some(file => file.path.startsWith('refs-pdf/'))).toBe(false)
  })

  it('stores the file a judgement was made from, with the attachment it came from', async () => {
    const { store, run } = await realRun()
    const plan = planRunPackage(store, run, 'evaluation', {
      mode: 'draft',
      referencePdfs: { policy: 'local-cache', reads: [referenceRead()] },
    })
    const path = 'refs-pdf/cite-10.1016-j.trb.2025.103352.pdf'
    expect(plan.files.find(file => file.path === path)?.encoding).toBe('base64')

    const section = plan.manifest.referencePdfs
    if (section === 'not-stored') throw new Error('the deployment opted in, so this is not the answer')
    expect(section.policy).toBe('local-cache')
    expect(section.refused).toEqual([])
    expect(section.stored.length).toBe(1)
    const stored = section.stored[0]
    expect(stored?.citeKey).toBe(CITED_KEY)
    expect(stored?.path).toBe(path)
    expect(stored?.bytes).toBe(PDF_BYTES.length)
    expect(stored?.sha256).toBe(PDF_SHA256)
    expect(stored?.attachmentKey).toBe('PDFKEY01')
    expect(stored?.attachmentVersion).toBe('7')
    // THE FILE SAYS WHAT IT IS. A publisher's PDF in a package of a run's own artifacts has to be
    // placable by a reader who did not build it.
    expect(stored?.purpose).toContain('not a product of the run')
  })

  it('refuses bytes whose version is not the one the judgement was made from', async () => {
    // THE FILE WAS REPLACED SINCE THE PASSAGE WAS READ. The bytes are real and belong to a DIFFERENT
    // file than the passage a judgement rests on, so storing them would put a document in the package
    // that no judgement was made from — under a name that says one was.
    const { store, run } = await realRun()
    const plan = planRunPackage(store, run, 'evaluation', {
      mode: 'draft',
      referencePdfs: { policy: 'local-cache', reads: [referenceRead({ version: '8' })] },
    })
    const section = plan.manifest.referencePdfs
    if (section === 'not-stored') throw new Error('the deployment opted in, so this is not the answer')
    expect(section.stored).toEqual([])
    expect(section.refused[0]?.reason).toContain('version 8')
    expect(section.refused[0]?.reason).toContain('version 7')
    expect(plan.files.some(file => file.path.startsWith('refs-pdf/'))).toBe(false)
  })

  it('refuses a read that returned another attachment, and bytes that do not hash to what it stated', async () => {
    const { store, run } = await realRun()
    const other = planRunPackage(store, run, 'evaluation', {
      mode: 'draft',
      referencePdfs: { policy: 'local-cache', reads: [referenceRead({ key: 'OTHER001' })] },
    }).manifest.referencePdfs
    if (other === 'not-stored') throw new Error('the deployment opted in, so this is not the answer')
    expect(other.stored).toEqual([])
    expect(other.refused[0]?.reason).toContain('OTHER001')

    const wrongDigest = planRunPackage(store, run, 'evaluation', {
      mode: 'draft',
      referencePdfs: { policy: 'local-cache', reads: [referenceRead({ sha256: 'c'.repeat(64) })] },
    }).manifest.referencePdfs
    if (wrongDigest === 'not-stored') throw new Error('the deployment opted in, so this is not the answer')
    expect(wrongDigest.stored).toEqual([])
    expect(wrongDigest.refused[0]?.reason).toContain('c'.repeat(64))
  })

  it('carries the reader\'s own reason when nothing was read, and never a path', async () => {    // A FAILURE TO READ IS RECORDED, NOT THROWN, and what travels is the error rather than where this
    // machine keeps its files — the rule the bibliography writer follows for the same reason.
    const { store, run } = await realRun()
    const refusal = 'the file of \'PDFKEY01\' could not be read from local storage (ENOENT)'
    const plan = planRunPackage(store, run, 'evaluation', {
      mode: 'draft',
      referencePdfs: { policy: 'local-cache', reads: [referenceRead({ failure: refusal })] },
    })
    const section = plan.manifest.referencePdfs
    if (section === 'not-stored') throw new Error('the deployment opted in, so this is not the answer')
    expect(section.refused).toEqual([{
      citeKey: CITED_KEY,
      attachmentKey: 'PDFKEY01',
      reason: refusal,
    }])
    expect(JSON.stringify(plan.manifest)).not.toContain('C:\\')
  })

  it('writes the PDF as the bytes it is, and the manifest digests them as written', async () => {
    // A PDF WRITTEN AS BASE64 TEXT IS NOT THE FILE. The package writer decodes, and the digest it
    // records is over the bytes that landed — so this reads the file back and compares it with the
    // attachment the read returned, byte for byte.
    const dir = join(tempDir(), 'pkg')
    const { store, run } = await realRun()
    const manifest = writeRunPackage(
      planRunPackage(store, run, 'evaluation', {
        mode: 'draft',
        referencePdfs: { policy: 'local-cache', reads: [referenceRead()] },
      }),
      dir,
    )
    const path = 'refs-pdf/cite-10.1016-j.trb.2025.103352.pdf'
    const onDisk = readFileSync(join(dir, path))
    expect(onDisk.equals(PDF_BYTES)).toBe(true)
    const entry = manifest.files.find(file => file.path === path)
    expect(entry?.bytes).toBe(PDF_BYTES.length)
    expect(entry?.sha256).toBe(PDF_SHA256)
    expect(checkPackagedFiles(dir, manifest).every(check => check.status === 'ok')).toBe(true)
  })
})

describe('the attachments a run\'s own reading records name', () => {
  it('asks for exactly the files a judgement was made from', async () => {
    // THE IDENTITY AND THE VERSION COME FROM THE READING RECORD, not from the citation and not from a
    // path: a citation names a sentence and a source, and only the binding says which file the words
    // were read out of.
    const { store, run } = await realRun()
    // The checked-in corpus reads pages of text rather than files, so it names no attachment and
    // nothing is asked for — the honest answer for a run that read no file.
    expect(citedAttachments(store, run.runId, sourcesForMode('curated', []))).toEqual([])

    const sources = new Map(sourcesForMode('curated', []))
    const literatureRef = [...sources.keys()][0] ?? ''
    const record = sources.get(literatureRef)
    if (record?.evidence === undefined) throw new Error('the curated corpus carries no reading record')
    sources.set(literatureRef, {
      ...record,
      evidence: { ...record.evidence, attachment: { key: 'PDFKEY01', version: '7' } },
    })
    const asked = citedAttachments(store, run.runId, sources)
    expect(asked.length).toBeGreaterThan(0)
    expect(asked[0]?.readFrom).toEqual({
      sourceIdentity: record.evidence.sourceIdentity,
      key: 'PDFKEY01',
      version: '7',
    })
    // The cite key travels with it, because the file is stored under the citation that rests on it.
    expect(asked[0]?.citeKey).toBe(`cite-${literatureRef}`)
  })
})
