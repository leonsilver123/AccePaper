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
import { getArtifact, getAuditHistory, getRunSnapshot, getStepDefinitions } from '@deepseek-ai/dsh-research-core'
import { readinessOfRun } from './submission-readiness.ts'
import {
  checkFinalPackage, finalPackageApprovalOf, finalPackageFactsOf, finalPackageStateOf,
} from './final-package.ts'
import type { FinalPackageApproval, FinalPackageCheck, FinalPackageState } from './final-package.ts'
import type { EvidenceProfile, ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import type { SubmissionReadiness } from './submission-readiness.ts'
import { STEP_EXECUTOR_REGISTRY } from './registry.ts'

/**
 * What a package needs to know about one step.
 *
 * Narrower than {@link StepOutcome} on purpose: a run's outcome carries the evidence of the drive
 * (artifact values, whether a real tool ran), and a package written AFTER the drive — by an operator
 * asking for the final one — has no drive result to hand. What it has is the run's own record plus
 * the executor registry, and those are what the manifest's step table is built from.
 */
export interface PackageStepFacts {
  readonly stepId: string
  readonly status: string
  readonly attemptId: number
  readonly kind: string
  readonly producer: string
  readonly outputSlugs: ReadonlyArray<string>
  readonly verdicts: Readonly<Record<string, string>>
}

/** The run as a package needs it: its id and one entry per step. */
export interface PackageRunFacts {
  readonly runId: string
  readonly steps: ReadonlyArray<PackageStepFacts>
}

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
  /**
   * The project revision this package was exported FROM.
   *
   * A package is a reading of one state of the run. `generatedAt` says when someone read it, which
   * is not the same fact — two exports a minute apart can carry different manuscripts — and the
   * artifacts the export names are the ones this revision holds.
   */
  readonly projectRevision: number
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
  /**
   * The evidence profile this run was conducted under, whether that profile's evidence may ever
   * carry a submission, and whether THIS run is ready.
   *
   * Two facts, not one. `profileEligible` is what the deployment is on record as claiming;
   * `submissionReady` is what the run actually produced. A production run blocked at A1 is
   * eligible and not ready, and a manifest that collapsed them reported the first as the second.
   */
  readonly evidenceProfile: EvidenceProfile
  readonly profileEligible: boolean
  readonly submissionReady: boolean
  readonly readinessNote: string
  /**
   * Whether this package is the FINAL one or a working draft.
   *
   * `final` means every condition in {@link checks} holds: the run was conducted under the
   * production profile, finished, was approved at the version it holds, saved, and the package
   * carries every file the manuscript declares. A draft is a real package of a real run that is not
   * yet the thing to hand anyone — and the files it contains say so.
   */
  readonly state: FinalPackageState
  /** Every condition a final package must meet, with what the run recorded about it. */
  readonly checks: ReadonlyArray<FinalPackageCheck>
  /**
   * The decision that made this package final, as the run recorded it.
   *
   * Absent on a draft, and absent on a package whose approval was refused. Present means a person
   * approved THESE artifact versions: the targets are the refs frozen at the moment of the decision,
   * so a reader comparing two packages can see whether the same revision was approved.
   */
  readonly approval?: FinalPackageApproval
  readonly note: string
}

/**
 * Where each numeric figure comes from, for the paths E1 produces.
 *
 * Kept as data rather than inline in the manifest so that "not produced" can be computed against
 * what this run actually wrote, instead of being asserted about a name.
 */
const NUMBER_SOURCES: Readonly<Record<string, string>> = {
  'experiment-tables.md': 'mvp-results + baseline-results (same measurement the figures use)',
  'figures/figure-1.svg': 'mvp-results',
  'roadmap.md': 'figure-plan',
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
function stepRecord(outcome: PackageStepFacts): RunPackageManifest['steps'][number] {
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
 * @param evidenceProfile - the profile the run was conducted under, which decides whether the
 *   package it produced may be submitted.
 * @param options - whether this is the final package or a working draft, and the run's last write
 *   failure when one was reported. The checks are computed here from the run's own records; the
 *   caller states only its INTENT, never whether the conditions hold.
 * @returns the files, the manifest, and the run id.
 */
export function planRunPackage(
  store: ResearchRunStore,
  run: PackageRunFacts,
  evidenceProfile: EvidenceProfile,
  options: { readonly mode: 'draft' | 'final'; readonly saveError?: string } = { mode: 'draft' },
): { readonly runId: string; readonly files: ReadonlyArray<PackageFile>; readonly manifest: RunPackageManifest } {
  const { runId } = run
  const readiness: SubmissionReadiness = readinessOfRun(store, runId, evidenceProfile)
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
      // THE RECORDS, not the artifact that carries them. This read `landscape?.records ?? landscape`,
      // and A1's field is `hits` — so `records` never existed, the fallback always won, and the file
      // shipped the whole LABELLED artifact (`__producer`, `__kind`, `__provenance`, the corpus note)
      // under a key that says "ledger". A consumer had to know that to find a DOI, and nothing in the
      // file said so. An export that has to be read with the producer's source in hand is not an
      // export.
      ledger: landscape?.hits ?? null,
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

  const written = new Set(files.map(file => file.path))
  // The paths this package WILL carry: the files written so far plus the summary, which is built
  // below because its text states the state these checks decide.
  const facts = finalPackageFactsOf(
    store, runId, evidenceProfile, [...written, 'run-summary.md'],
    options.saveError,
  )
  const checks = checkFinalPackage(facts)
  const state = finalPackageStateOf(checks)
  const approval = finalPackageApprovalOf(facts.approval)
  files.unshift({
    path: 'run-summary.md',
    content: markdownFile([
      '# Run summary',
      '',
      `- runId: \`${runId}\``,
      `- steps driven: ${run.steps.length} of 16`,
      `- final status: \`${run.steps[run.steps.length - 1]?.status ?? 'none'}\``,
      `- evidence profile: \`${evidenceProfile}\``,
      `- evidence eligible: ${readiness.profileEligible ? 'yes' : 'NO'}`,
      `- submission ready: ${readiness.ready ? 'yes' : '**NO**'}`,
      `- package state: \`${state}\`${state === 'final' ? '' : ' — A WORKING DRAFT, not for submission'}`,
      '',
      '## What this package is',
      '',
      'Artifacts of a synthetic research run. The pipeline, its tool calls, its gates and its',
      'session log are real; the measurements are the study\'s own deterministic simulation over a',
      'measured demand profile. Nothing here is a published result.',
      '',
      readiness.reason,
      '',
      '## Step outcomes',
      '',
      '| step | status | attempt | channel | producer |',
      '|---|---|---|---|---|',
      ...run.steps.map(s => `| ${s.stepId} | ${s.status} | ${s.attemptId} | ${s.kind} | ${s.producer} |`),
    ]),
  })

  const manifest: RunPackageManifest = {
    runId,
    // Read from the RUN, not derived from the files: the revision is what the artifacts in this
    // package belong to, and a reader comparing two packages needs it to tell whether they read
    // the same study or two states of it.
    projectRevision: getRunSnapshot(store, runId).revision,
    generatedAt: new Date(0).toISOString(),
    files: [],
    steps: run.steps.map(stepRecord),
    // Only paths that are IN this package. A run that stopped before E1 has no tables, no figure
    // and no roadmap, and naming their sources anyway is the same defect this exporter replaced in
    // E1's artifact — a list of files that reads as run output while nothing wrote them. A path
    // whose producer did not run is reported as not produced, not silently omitted.
    numberSources: Object.fromEntries(
      Object.entries(NUMBER_SOURCES).map(([path, source]) =>
        [path, written.has(path) ? source : 'NOT PRODUCED by this run']),
    ),
    evidenceProfile,
    profileEligible: readiness.profileEligible,
    submissionReady: readiness.ready,
    readinessNote: readiness.reason,
    state,
    checks,
    ...(approval === undefined ? {} : { approval }),
    note:
      'Paths are relative to this package root. `sha256` is over the written bytes. The manifest '
      + 'records no absolute directory and no credential. `state` is `final` only when every entry '
      + 'in `checks` holds, and an `approval` names the artifact versions a person decided on.',
  }

  return { runId, files, manifest }
}

/**
 * Read the step table a package records, off the run as it stands now.
 *
 * The kinds and producers come from the executor registry — the audit source of truth for both —
 * rather than from a drive result, so a package exported AFTER the drive (an operator asking for the
 * final one) states the same table a package exported at the end of the drive does. A step the
 * registry does not know is reported as such instead of being given a kind it did not run under.
 *
 * @param store - the run store.
 * @param runId - the run to read.
 * @returns one entry per step the pipeline declares, in pipeline order.
 */
export function packageRunFactsOf(store: ResearchRunStore, runId: string): PackageRunFacts {
  const snapshot = getRunSnapshot(store, runId)
  return {
    runId,
    steps: getStepDefinitions().map((definition) => {
      const state = snapshot.steps[definition.id]
      const entry = STEP_EXECUTOR_REGISTRY.get(definition.id)
      return {
        stepId: definition.id,
        status: state?.status ?? 'pending',
        attemptId: state?.attemptId ?? 0,
        kind: entry?.kind ?? 'unknown',
        producer: entry?.producer ?? 'unknown',
        outputSlugs: [...(state?.outputs ?? [])],
        // THE DISCRIMINANT, not the verdict object: the manifest's audit table records what each
        // component decided (`passed` / `blocked` / `failed` / `abstained`), and a table of
        // `[object Object]` would name nothing a reader could act on.
        verdicts: Object.fromEntries(
          Object.entries(state?.gateResults ?? {}).map(([component, verdict]) => [component, verdict.outcome]),
        ),
      }
    }),
  }
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
