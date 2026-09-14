// @deepseek-ai/dsh-research-team — reproducible run package export.
//
// Turns one completed run into a directory of real files. "Reproducible package" used to be
// a PROPOSAL: E1 listed five filenames beside a produced manuscript and nothing wrote any of
// them, which invites a reader to take the list for run output. Here every declared file is
// written, each is checked for existence and non-emptiness after the write, and the manifest
// records its path, byte count and content digest.
//
// WHAT THIS IS NOT. A package carries demo artifacts from a synthetic run. Nothing in it is
// a research finding, and the files that hold synthetic measurements say so in their own
// text. The package describes the RUN, not a result.
//
// WHAT IT MUST NOT CONTAIN. Credentials, whole request payloads, and machine-private paths.
// The manifest records paths relative to the package root and never the absolute directory
// it was written to; `sanitizeForExport` strips anything that looks like a secret.

import { createHash } from 'node:crypto'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getArtifact, getAuditHistory } from '@deepseek-ai/dsh-research-core'
import type { ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import type { RunResult, StepOutcome } from './types.ts'

/** One file the package will contain, as content rather than as a name. */
export interface PackageFile {
  /** Path relative to the package root, with forward slashes. */
  readonly path: string
  readonly content: string
}

/** One written file, with what was checked about it after the write. */
export interface PackagedFile {
  readonly path: string
  readonly bytes: number
  /** SHA-256 of the written bytes, lower-case hex. */
  readonly sha256: string
}

/** The manifest written as `run-manifest.json`. */
export interface RunPackageManifest {
  readonly runId: string
  readonly generatedAt: string
  readonly files: ReadonlyArray<PackagedFile>
  /** Per-step outcome, so the package states how each product was produced. */
  readonly steps: ReadonlyArray<{
    readonly stepId: string
    readonly status: string
    readonly attemptId: number
    readonly kind: string
    readonly producer: string
    readonly outputSlugs: ReadonlyArray<string>
    readonly verdicts: Readonly<Record<string, string>>
  }>
  /** Where each numeric figure came from, so a reader can trace it. */
  readonly numberSources: Readonly<Record<string, string>>
  readonly note: string
}

/** SHA-256 of one string, lower-case hex. */
function digestOf(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/**
 * Strip anything that must not leave the process.
 *
 * Applied to every string that reaches a package file. Fields whose KEY names a secret are
 * dropped outright rather than redacted, so a reader never mistakes a placeholder for a
 * value; path separators that would disclose the machine's layout are reduced to their
 * final segment.
 *
 * @param value - any artifact value.
 * @returns a copy safe to write to disk.
 */
export function sanitizeForExport(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/[A-Za-z]:\\[^\s"']*|\/(?:home|Users)\/[^\s"']*/gu, segment => segment.split(/[\\/]/u).pop() ?? '')
  }
  if (Array.isArray(value)) return value.map(sanitizeForExport)
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/secret|token|api[-_]?key|password|credential/iu.test(key)) continue
    out[key] = sanitizeForExport(entry)
  }
  return out
}

/** Read one input artifact as a record, or undefined. */
function artifactRecord(store: ResearchRunStore, runId: string, slug: string): Record<string, unknown> | undefined {
  const value = getArtifact(store, runId, slug)
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** A JSON file body: sanitized, pretty-printed, newline-terminated. */
function jsonFile(value: unknown): string {
  return `${JSON.stringify(sanitizeForExport(value), null, 2)}\n`
}

/** A markdown file body, newline-terminated. */
function markdownFile(lines: ReadonlyArray<string>): string {
  const body = lines.join('\n').replace(/\n+$/u, '')
  return `${body}\n`
}

/** One step's recorded outcome, in the manifest's shape. */
function stepRecord(outcome: StepOutcome): RunPackageManifest['steps'][number] {
  return {
    stepId: outcome.stepId,
    status: outcome.status,
    attemptId: outcome.attemptId,
    kind: outcome.kind,
    producer: outcome.producer,
    outputSlugs: outcome.outputSlugs,
    verdicts: outcome.verdicts,
  }
}

/**
 * Build every file for a run's package, in memory.
 *
 * Pure with respect to the filesystem: it reads the run store and returns content. The
 * caller writes it, which is what lets a spec assert on the package without a directory.
 *
 * @param store - the run store.
 * @param run - the driven run result.
 * @returns the files, the manifest, and the run id.
 */
export function planRunPackage(
  store: ResearchRunStore,
  run: RunResult,
): { readonly runId: string; readonly files: ReadonlyArray<PackageFile>; readonly manifest: RunPackageManifest } {
  const { runId } = run
  const manuscript = artifactRecord(store, runId, 'formatted-manuscript')
  const claim = artifactRecord(store, runId, 'claim')
  const landscape = artifactRecord(store, runId, 'landscape-map')
  const experiment = artifactRecord(store, runId, 'mvp-results')
  const baseline = artifactRecord(store, runId, 'baseline-results')
  const method = artifactRecord(store, runId, 'method-spec')

  const files: PackageFile[] = []

  // E1 produced these contents itself; a package without them is the old proposal again.
  const produced = manuscript?.packageFiles
  if (produced !== null && typeof produced === 'object' && !Array.isArray(produced)) {
    for (const [path, content] of Object.entries(produced as Record<string, unknown>)) {
      if (typeof content === 'string' && content.length > 0) files.push({ path, content: `${content.replace(/\n+$/u, '')}\n` })
    }
  }

  files.push({
    path: 'run-summary.md',
    content: markdownFile([
      '# Run summary',
      '',
      `- runId: \`${runId}\``,
      `- steps driven: ${run.steps.length} of 16`,
      `- final status: \`${run.steps[run.steps.length - 1]?.status ?? 'none'}\``,
      '',
      '## What this package is',
      '',
      'Artifacts of a synthetic research run. The pipeline, its tool calls, its gates and its',
      'session log are real; the measurements are the study\'s own deterministic simulation over a',
      'measured demand profile. Nothing here is a published result.',
      '',
      '## Step outcomes',
      '',
      '| step | status | attempt | channel | producer |',
      '|---|---|---|---|---|',
      ...run.steps.map(s => `| ${s.stepId} | ${s.status} | ${s.attemptId} | ${s.kind} | ${s.producer} |`),
    ]),
  })

  files.push({ path: 'steps.json', content: jsonFile(run.steps.map(stepRecord)) })
  files.push({
    path: 'claim-evidence.json',
    content: jsonFile({
      claim: claim ?? null,
      prediction: artifactRecord(store, runId, 'falsifiable-prediction') ?? null,
      note: 'The claim and the prediction it commits to, as the A2 executor produced them.',
    }),
  })
  files.push({
    path: 'citations.json',
    content: jsonFile({
      ledger: landscape?.records ?? landscape ?? null,
      note: 'Retrieved records as they appear on the A1 artifact. Each record carries its own source field.',
    }),
  })
  files.push({
    path: 'experiment.json',
    content: jsonFile({
      method: method ?? null,
      baseline: baseline ?? null,
      variant: experiment ?? null,
      note: 'The configuration and the measurements the results table and the figures were both built from.',
    }),
  })
  files.push({
    path: 'reproducibility.md',
    content: markdownFile([
      '# Reproducibility',
      '',
      'The run is deterministic: the same inputs and the same executor registry produce the same',
      'artifacts. The steps below are the ones whose products carry measurements.',
      '',
      ...run.steps
        .filter(s => s.kind !== 'humanGate')
        .map(s => `- \`${s.stepId}\` — ${s.kind} via ${s.producer}`),
      '',
      'Session audit entries for each step are in the run log; this package does not duplicate them.',
    ]),
  })

  const manifest: RunPackageManifest = {
    runId,
    generatedAt: new Date(0).toISOString(),
    files: [],
    steps: run.steps.map(stepRecord),
    numberSources: {
      'experiment-tables.md': 'mvp-results + baseline-results (same measurement the figures use)',
      'figures/figure-1.svg': 'mvp-results',
      'roadmap.md': 'figure-plan',
    },
    note:
      'Paths are relative to this package root. `sha256` is over the written bytes. The manifest '
      + 'records no absolute directory and no credential.',
  }

  return { runId, files, manifest }
}

/**
 * Write a package plan to disk.
 *
 * Every file is written, then re-read through `statSync` so a zero-byte or unreadable file is
 * reported here rather than discovered by whoever opens the package. The manifest is written
 * LAST and lists the files with their digests, so a manifest that exists means the files it
 * names were written.
 *
 * @param plan - the files and manifest to write.
 * @param directory - the package root; created when absent.
 * @returns the manifest, with every file's byte count and digest filled in.
 * @throws {Error} when a written file is missing or empty afterwards.
 */
export function writeRunPackage(
  plan: { readonly files: ReadonlyArray<PackageFile>; readonly manifest: RunPackageManifest },
  directory: string,
): RunPackageManifest {
  mkdirSync(directory, { recursive: true })
  const written: PackagedFile[] = []
  for (const file of plan.files) {
    const target = join(directory, file.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.content, 'utf8')
    const size = statSync(target).size
    if (size === 0) {
      throw new Error(`[run-package] ${file.path} was written empty — refusing to publish a package with a hole in it`)
    }
    written.push({ path: file.path, bytes: size, sha256: digestOf(file.content) })
  }
  const manifest: RunPackageManifest = { ...plan.manifest, files: written }
  writeFileSync(join(directory, 'run-manifest.json'), jsonFile(manifest), 'utf8')
  return manifest
}

/**
 * The audit entries recorded for one step, as package metadata.
 *
 * @param store - the run store.
 * @param runId - the run to read.
 * @param stepId - the step whose audit trail is wanted.
 * @returns the entries, sanitized.
 */
export function stepAudit(store: ResearchRunStore, runId: string, stepId: string): unknown {
  return sanitizeForExport(getAuditHistory(store, runId, stepId))
}
