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

import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
import { reportPaperQuality } from './paper-quality.ts'
import type { PaperQualityReport } from './paper-quality.ts'
import { metricsForStudy } from './metrics.ts'

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
  /**
   * How {@link content} is encoded.
   *
   * A compiled figure or a PDF is BYTES, and writing base64 text where a PNG belongs produces a file
   * that looks written and is not the asset. `base64` means the writer decodes; `utf8` (the default)
   * means it encodes.
   */
  readonly encoding?: 'utf8' | 'base64'
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
  /**
   * When this reading was taken, ISO-8601.
   *
   * It is the actual time of the export. A package is a state plus the moment it was read, and a
   * manifest that carried a fixed value could not answer "is this the package I made after the
   * approval, or the one from the drive?" — which is the whole reason both numbers are here.
   */
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
  /**
   * What the quality baseline found in this manuscript, and what it could not judge.
   *
   * Carried in the manifest because a package is what a reader receives: a list of files and digests
   * says nothing about whether the manuscript inside refers to its own figures or positions itself in
   * its own bibliography. The report is computed here, from the run's records and the manuscript the
   * package contains, so the package states it without anyone having to run a separate tool.
   *
   * THE COVERAGE TRAVELS WITH THE FINDINGS. An empty `findings` list is the output of a handful of
   * exact comparisons, and it reads as a verdict on the paper: `checks` says which rules could read
   * this manuscript and which could not, `needsDomainReview` says what no rule here judges, and
   * `summary` states what the report is rather than how good the paper is.
   */
  readonly quality: PaperQualityReport
  /**
   * The artifact versions this package is a reading of.
   *
   * A package describes one state of a run, and a state moves: a later step, a revision, a re-run or a
   * hand edit replaces an artifact. Recording the versions is what lets a reader — or a later export —
   * tell whether the package still describes the run, and `checks` carries the verdict when a
   * previous reading is handed in.
   */
  readonly artifactRefs: ReadonlyArray<{ readonly slug: string; readonly version: number }>
  /**
   * What the metrics in this package mean, and which of them the run's own type required.
   *
   * The registry is the deployment's declaration of each metric — its unit, which way is better, and
   * what a movement means — and the run froze the profile it was driven under, so this is READ from
   * the run rather than looked up now: a package exported after the deployment was reconfigured still
   * states the metrics its study was actually conducted under. `required: false` is NOT "missing".
   * It is a metric that belongs to another research type, and a view that collapsed the two would
   * report a literature review as failing to measure a traffic quantity it never had.
   *
   * Absent when the run recorded no profile, which a run driven without one does.
   */
  readonly declaredMetrics?: ReadonlyArray<{
    readonly key: string
    readonly unit: string
    readonly direction: string
    readonly required: boolean
    readonly interpretation: string
  }>
  readonly note: string
}

/**
 * Where each numeric figure comes from, for the paths E1 produces.
 *
 * Kept as data rather than inline in the manifest so that "not produced" can be computed against
 * what this run actually wrote, instead of being asserted about a name.
 */
const NUMBER_SOURCES: Readonly<Record<string, string>> = {
  'figure-plan.json': 'figure-plan (the plan each figure was drawn from)',
  'experiment-tables.md': 'mvp-results + baseline-results (same measurement the figures use)',
  'figures/figure-1.svg': 'mvp-results',
  'roadmap.md': 'figure-plan',
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

/**
 * The metric a run registered, as the quality baseline needs it: its name, which way is better, and
 * the measured change. Read from the run's own records — never from the manuscript's prose, which is
 * the thing being judged.
 *
 * @param baseline - the `baseline-results` artifact, when the run produced one.
 * @param claim - the `claim` artifact, whose metric key names the quantity.
 * @returns the metric, or undefined when the run measured none.
 */
function metricOf(
  baseline: Record<string, unknown> | undefined,
  claim: Record<string, unknown> | undefined,
): { readonly name: string; readonly direction: string; readonly changePct: number } | undefined {
  if (baseline === undefined) return undefined
  const metric = (baseline.baseline as { metric?: { name?: unknown; direction?: unknown } } | undefined)?.metric
  const measured = baseline.measured as { variantImprovementPct?: unknown } | undefined
  const name = typeof metric?.name === 'string' ? metric.name : claim?.metricKey
  const direction = typeof metric?.direction === 'string' ? metric.direction : undefined
  const changePct = typeof measured?.variantImprovementPct === 'number' ? measured.variantImprovementPct : undefined
  if (typeof name !== 'string' || direction === undefined || changePct === undefined) return undefined
  return { name, direction, changePct }
}

/**
 * Whether a value read back from a record is an array of records.
 *
 * A predicate rather than `Array.isArray` at each call site: that built-in narrows to `any[]` whatever
 * the value's declared type was, which would make every field read off an element an unchecked
 * `any` — on a value that came off disk.
 *
 * @param value - the value read from the record.
 * @returns whether every element is a record.
 */
function isRecordArray(value: unknown): value is ReadonlyArray<Record<string, unknown>> {
  return Array.isArray(value)
    && value.every((entry: unknown) => typeof entry === 'object' && entry !== null && !Array.isArray(entry))
}

/**
 * The metrics the run was conducted under, read from the profile it froze into its own spec.
 *
 * READ FROM THE RUN, NEVER RESOLVED NOW. The deployment's configuration can change between the run
 * and the export — that is what freezing the profile into the spec prevents — so a package that
 * looked the profile up again would describe a study under metrics its run never had. The shape is
 * checked rather than assumed because the spec is a durable record read back from disk.
 *
 * @param store - the run store.
 * @param runId - the run the package is for.
 * @returns one entry per declared metric, or undefined when the run recorded no usable profile.
 */
function declaredMetricsOf(
  store: ResearchRunStore,
  runId: string,
): RunPackageManifest['declaredMetrics'] {
  // THE STUDY'S OWN METRICS, not the research type's. The frozen profile carries the type-level view
  // (which metrics are applicable to this kind of work); with two studies of one type that view names
  // both, and a run requires only its own. The implementation id is read off the same frozen spec, so
  // a run that was configured as another study reports that study's metrics.
  const spec = getRunSnapshot(store, runId).spec
  const implementationId = (spec['studyPlan'] as { readonly implementationId?: unknown } | undefined)?.implementationId
  const metrics = typeof implementationId === 'string'
    ? metricsForStudy(implementationId)
    : (spec['researchProfile'] as { readonly metrics?: unknown } | undefined)?.metrics
  const required = isRecordArray((metrics as { required?: unknown } | undefined)?.required)
    ? (metrics as { required: ReadonlyArray<Record<string, unknown>> }).required
    : undefined
  const notApplicable = isRecordArray((metrics as { notApplicable?: unknown } | undefined)?.notApplicable)
    ? (metrics as { notApplicable: ReadonlyArray<Record<string, unknown>> }).notApplicable
    : undefined
  if (required === undefined || notApplicable === undefined) return undefined
  const declared = [
    ...required.map(definition => ({ definition, required: true })),
    ...notApplicable.map(definition => ({ definition, required: false })),
  ].flatMap(({ definition, required: isRequired }) => {
    const { key, unit, direction, interpretation } = definition
    return typeof key === 'string' && typeof unit === 'string'
      && typeof direction === 'string' && typeof interpretation === 'string'
      ? [{ key, unit, direction, required: isRequired, interpretation }]
      : []
  })
  return declared.length === 0 ? undefined : declared
}

/**
 * The artifacts a package is built from, as the run's registry holds them now.
 *
 * THE SLUGS ARE THE ONES THE EXPORT READS, listed rather than discovered: a package that recorded
 * every artifact the run holds would report a move in something it never used, and a reader chasing
 * that would be looking at a step the package does not describe.
 */
const PACKAGED_SLUGS: ReadonlyArray<string> = [
  'claim', 'landscape-map', 'method-spec', 'mvp-results', 'baseline-results',
  'figure-plan', 'draft', 'revised-draft', 'result-version', 'formatted-manuscript',
]

/**
 * The artifact refs one package is read from, with the version each is at.
 *
 * @param store - the run store.
 * @param runId - the run.
 * @param slugs - the slugs the package reads.
 * @returns one entry per artifact the run holds, in the order given.
 */
function artifactRefsOf(
  store: ResearchRunStore,
  runId: string,
  slugs: ReadonlyArray<string>,
): ReadonlyArray<{ readonly slug: string; readonly ref: { readonly version: number; readonly contentHash: string } }> {
  const registry = getRunSnapshot(store, runId).registry
  return slugs.flatMap((slug) => {
    const record = registry[slug]
    return record === undefined
      ? []
      : [{ slug, ref: { version: record.ref.version, contentHash: String(record.ref.contentHash) } }]
  })
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
  options: {
    readonly mode: 'draft' | 'final'
    readonly saveError?: string
    /**
     * When this reading of the run was taken.
     *
     * Stated by the caller so a test can pin it; an export that states none is stamped with the
     * clock. It used to be the EPOCH — `new Date(0)` — which the contract above says it is not: a
     * manifest reading `1970-01-01T00:00:00.000Z` told every reader that the package was generated
     * before the study existed.
     */
    readonly generatedAt?: string
    /**
     * The artifact versions a PREVIOUS reading was taken from, when one is being compared.
     *
     * The export that wrote the package on disk knows what it read; this is how a later export says
     * which of those artifacts the run has moved past. Absent means nothing to compare against, and
     * the `artifacts-current` check then reports what the package was read from rather than a verdict
     * it cannot support.
     */
    readonly previousArtifactRefs?: ReadonlyArray<{ readonly slug: string; readonly version: number }>
  } = { mode: 'draft' },
): { readonly runId: string; readonly files: ReadonlyArray<PackageFile>; readonly manifest: RunPackageManifest } {
  const { runId } = run
  const readiness: SubmissionReadiness = readinessOfRun(store, runId, evidenceProfile)
  const manuscript = artifactRecord(store, runId, 'formatted-manuscript')
  const claim = artifactRecord(store, runId, 'claim')
  const landscape = artifactRecord(store, runId, 'landscape-map')
  const experiment = artifactRecord(store, runId, 'mvp-results')
  const baseline = artifactRecord(store, runId, 'baseline-results')
  const method = artifactRecord(store, runId, 'method-spec')
  const draftArtifact = artifactRecord(store, runId, 'draft')
  const baselineArtifact = artifactRecord(store, runId, 'baseline-results')

  const files: PackageFile[] = []

  // E1 produced these contents itself; a package without them is the old proposal again.
  const produced = manuscript?.packageFiles
  if (produced !== null && typeof produced === 'object' && !Array.isArray(produced)) {
    for (const [path, content] of Object.entries(produced as Record<string, unknown>)) {
      if (typeof content === 'string' && content.length > 0) files.push({ path, content: `${content.replace(/\n+$/u, '')}\n` })
    }
  }
  // AND THE BYTES E1 PRODUCED: the compiled documents a journal is handed, and the figures they
  // embed. Trailing whitespace is not trimmed here — that rule is about text, and trimming base64
  // would corrupt the asset.
  // THEY LIVE WITH THE COMPILE THAT PRODUCED THEM (`compilation.documents` / `compilation.assets`):
  // they are outputs of the same step, and a second home for them would be a second thing to keep in
  // step. Both lists are written the same way — the split is about what a reader is told, not about
  // what the package holds.
  const compileRecord = (manuscript as {
    compilation?: { documents?: unknown; assets?: unknown }
  } | undefined)?.compilation
  for (const list of [compileRecord?.documents, compileRecord?.assets]) {
    if (!Array.isArray(list)) continue
    for (const entry of list) {
      const asset = entry as { path?: unknown; base64?: unknown }
      if (typeof asset.path === 'string' && typeof asset.base64 === 'string' && asset.base64.length > 0) {
        files.push({ path: asset.path, content: asset.base64, encoding: 'base64' })
      }
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
      // THE CITATIONS, BESIDE THE LIBRARY. The ledger above is what the retrieval returned and this is
      // what the paper rests on: per cite key, the statement it was made for, the passage that was read
      // and where, and the reviewed judgement about what that passage establishes. Both belong in the
      // file, because the difference between them is the difference between a search log and a
      // bibliography — and a reader who has only the ledger cannot tell which entries the manuscript
      // actually cites.
      citations: draftArtifact?.citations ?? null,
      note: 'Retrieved records as they appear on the A1 artifact. `citations` is what the manuscript cites,'
        + ' and a key in it names the passage the judgement was made on.',
    }),
  })
  files.push({
    // WHAT THE FIGURES WERE DRAWN FROM. The presentation plan states the question each figure answers,
    // the record its values came from and the canvas it was drawn on; with the rendered file and the
    // measured values this package already carries, the figure is reproducible rather than merely
    // present — and a reader can see which float the compile could not embed.
    path: 'figure-plan.json',
    content: jsonFile({
      plan: artifactRecord(store, runId, 'figure-plan') ?? null,
      note: 'The figures this package carries, the question each answers, and the record its values'
        + ' came from. `compilation` on the manuscript artifact names the floats a compiled document'
        + ' could not embed.',
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

  // The compile the run recorded, read off the manuscript artifact: which tool compiled it, and which
  // floats the compiled document does NOT carry.
  const compilation = (manuscript as {
    compilation?: {
      tool?: unknown
      floatsDropped?: ReadonlyArray<{ label?: unknown; reason?: unknown }>
      refusals?: unknown
    }
  } | undefined)?.compilation
  const compilationFacts = compilation === undefined
    ? { tool: null, dropped: [] as ReadonlyArray<string> }
    : {
      tool: typeof compilation.tool === 'string' ? compilation.tool : null,
      dropped: (compilation.floatsDropped ?? []).flatMap((entry) => {
        if (typeof entry.label !== 'string') return []
        const reason = typeof entry.reason === 'string' ? entry.reason : 'not embedded'
        return [`${entry.label} (${reason})`]
      }),
    }
  const written = new Set(files.map(file => file.path))
  // THE ARTIFACT VERSIONS THIS PACKAGE IS A READING OF. Recorded from the run's registry at plan
  // time, so a reader — and the `artifacts-current` check below — can tell whether the run has moved
  // past the state this package describes.
  const artifactRefs = artifactRefsOf(store, runId, PACKAGED_SLUGS)
  // WHAT MOVED SINCE THE PREVIOUS READING. A slug the previous package named whose version is not
  // the version the run holds now has changed under that package's feet.
  const movedSince = (options.previousArtifactRefs ?? []).flatMap((previous) => {
    const current = artifactRefs.find(entry => entry.slug === previous.slug)
    return current === undefined || current.ref.version !== previous.version ? [previous.slug] : []
  })
  // The paths this package WILL carry: the files written so far plus the summary, which is built
  // below because its text states the state these checks decide.
  const facts = finalPackageFactsOf(
    store, runId, evidenceProfile, [...written, 'run-summary.md'],
    options.saveError,
    { read: artifactRefs.map(entry => `${entry.slug}@${entry.ref.version}`), moved: movedSince },
    compilationFacts,
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

  // THE BASELINE RUNS WHERE THE PACKAGE IS BUILT, which is the one place that holds the manuscript,
  // the objects it carries and the metric the run registered, all at once.
  const metric = metricOf(baselineArtifact, claim)
  const quality = reportPaperQuality({
    sections: Array.isArray(draftArtifact?.sections)
      ? (draftArtifact.sections as ReadonlyArray<{ id: string; heading: string; bodyText: string }>)
      : [],
    crossReferences: {
      cited: (manuscript?.crossReferences as { cited?: ReadonlyArray<string> } | undefined)?.cited ?? [],
      uncited: (manuscript?.crossReferences as { uncited?: ReadonlyArray<string> } | undefined)?.uncited ?? [],
    },
    floatsNotRendered: (manuscript?.floatsNotRendered as ReadonlyArray<string> | undefined) ?? [],
    referenceCount: (manuscript?.manuscriptCounts as { references?: number } | undefined)?.references ?? 0,
    ...(metric === undefined ? {} : { metric }),
  })

  const declaredMetrics = declaredMetricsOf(store, runId)

  const manifest: RunPackageManifest = {
    runId,
    // Read from the RUN, not derived from the files: the revision is what the artifacts in this
    // package belong to, and a reader comparing two packages needs it to tell whether they read
    // the same study or two states of it.
    projectRevision: getRunSnapshot(store, runId).revision,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
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
    quality,
    artifactRefs: artifactRefs.map(entry => ({ slug: entry.slug, version: entry.ref.version })),
    ...(declaredMetrics === undefined ? {} : { declaredMetrics }),
    note:
      'Paths are relative to this package root. `sha256` is over the written bytes. The manifest '
      + 'records no absolute directory and no credential. `state` is `final` only when every entry '
      + 'in `checks` holds, and an `approval` names the artifact versions a person decided on.',
  }

  return { runId, files, manifest }
}

/**
 * The artifact versions the package already on disk was read from, when there is one.
 *
 * A RE-EXPORT OVER A MOVED RUN IS THE CASE THIS EXISTS FOR: an operator asks for the final package,
 * the run has moved since the last export, and the manifest that lands should say which artifacts
 * moved rather than describing the current state as though nothing had. A directory with no manifest
 * — or one written by another tool — yields nothing, and the check then reports what this package was
 * read from rather than a comparison it cannot make.
 *
 * @param directory - the directory the package is written to.
 * @returns the previous reading's refs, or an empty list.
 */
export function previousArtifactRefsOf(
  directory: string,
): ReadonlyArray<{ readonly slug: string; readonly version: number }> {
  const manifestPath = join(directory, 'run-manifest.json')
  if (!existsSync(manifestPath)) return []
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { artifactRefs?: unknown }
    const refs = parsed.artifactRefs
    if (!Array.isArray(refs)) return []
    return refs.flatMap((entry) => {
      const value = entry as { slug?: unknown; version?: unknown }
      return typeof value.slug === 'string' && typeof value.version === 'number'
        ? [{ slug: value.slug, version: value.version }]
        : []
    })
  } catch {
    // A manifest this reader cannot parse is not a comparison it can make: the export proceeds and
    // the check reports what this package was read from. The alternative — refusing to export
    // because an older file is damaged — would take away the remedy.
    return []
  }
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
 * Write a package plan to disk, and publish it only once it is complete.
 *
 * STAGED, VERIFIED, THEN SWAPPED IN. A package is the directory AND the manifest beside it, and the
 * two are only the same object while every entry still matches. Writing files in place makes a
 * half-finished export indistinguishable from a finished one: the reader who opens the directory
 * after a failure finds a manifest from the previous export sitting beside files from the failed one,
 * and nothing on disk says which entries are which. So the files go into a staging directory, the
 * staged package is checked against its own manifest, and only then does it replace what was there.
 * A failure anywhere before the swap leaves the previous package exactly as it was.
 *
 * Every file is written, then re-read through `statSync` so a zero-byte or unreadable file is
 * reported here rather than discovered by whoever opens the package. The manifest is written LAST,
 * so a manifest that exists means the files it names were written.
 *
 * @param plan - the files and manifest to write.
 * @param directory - the package root; created when absent, replaced when it is already there.
 * @returns the manifest, with every file's byte count and digest filled in.
 * @throws {Error} when a written file is empty, when the staged package does not verify, or when the
 *   swap itself fails — in which case the previous package is put back.
 */
export function writeRunPackage(
  plan: { readonly files: ReadonlyArray<PackageFile>; readonly manifest: RunPackageManifest },
  directory: string,
): RunPackageManifest {
  const staging = `${directory}.staging-${randomUUID().slice(0, 8)}`
  try {
    const manifest = writePackageFiles(plan, staging)
    const failed = checkPackagedFiles(staging, manifest).filter(check => check.status !== 'ok')
    if (failed.length > 0) {
      throw new Error(
        '[run-package] the staged package does not match its own manifest: '
        + failed.map(check => `${check.path} (${check.status})`).join(', '),
      )
    }
    publish(staging, directory)
    return manifest
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

/** Write every file of a plan into one directory, and the manifest last. */
function writePackageFiles(
  plan: { readonly files: ReadonlyArray<PackageFile>; readonly manifest: RunPackageManifest },
  directory: string,
): RunPackageManifest {
  mkdirSync(directory, { recursive: true })
  const written: PackagedFile[] = []
  for (const file of plan.files) {
    const target = join(directory, file.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : file.content)
    const size = statSync(target).size
    if (size === 0) {
      throw new Error(`[run-package] ${file.path} was written empty — refusing to publish a package with a hole in it`)
    }
    // THE DIGEST IS OVER THE BYTES THAT LANDED, read back from disk rather than recomputed from the
    // string: a base64 asset and its digest must describe the same file, and hashing the encoded form
    // here would make every asset's digest wrong.
    written.push({ path: file.path, bytes: size, sha256: createHash('sha256').update(readFileSync(target)).digest('hex') })
  }
  const manifest: RunPackageManifest = { ...plan.manifest, files: written }
  writeFileSync(join(directory, 'run-manifest.json'), jsonFile(manifest), 'utf8')
  return manifest
}

/**
 * Move a completed staging directory into place, keeping the package that was there.
 *
 * THE OLD PACKAGE IS MOVED ASIDE, NOT DELETED: a rename that fails — a lock, a full disk — is
 * followed by putting it back, so the failure mode is "the package is the one from before" rather
 * than "there is no package".
 *
 * @param staging - the verified package.
 * @param directory - where it belongs.
 */
function publish(staging: string, directory: string): void {
  const superseded = `${directory}.superseded-${randomUUID().slice(0, 8)}`
  const replacing = existsSync(directory)
  if (replacing) renameSync(directory, superseded)
  try {
    renameSync(staging, directory)
  } catch (error) {
    if (replacing) renameSync(superseded, directory)
    throw error
  }
  if (replacing) rmSync(superseded, { recursive: true, force: true })
}

/** One file's state against what a manifest says about it. */
export interface PackagedFileCheck {
  readonly path: string
  /** `ok` means present, the stated number of bytes, and the stated digest. */
  readonly status: 'ok' | 'missing' | 'bytes-differ' | 'digest-differs'
  readonly expectedBytes: number
  readonly expectedSha256: string
  /** What is on disk now; absent when the file is not there at all. */
  readonly observedBytes?: number
  readonly observedSha256?: string
}

/**
 * Compare a written package on disk with the manifest that names it.
 *
 * WHY THIS IS CODE AND NOT A READING DISCIPLINE. A manifest lists byte counts and digests, and a
 * package is only what it says it is while those still hold — a file edited, a file dropped when the
 * directory was copied somewhere tidier, or a manifest carried beside files from another export all
 * produce a directory that READS like a package and verifies as nothing. One pass over the manifest
 * makes "verify this package" one call rather than a habit.
 *
 * A file whose bytes differ but whose length matches is reported as a DIGEST difference and never as
 * ok: the byte count is the cheap check, and the digest is the one that means something.
 *
 * @param directory - the package root.
 * @param manifest - the manifest as it stands; its `files` are the entries checked.
 * @returns one entry per manifest entry, in the manifest's order.
 */
export function checkPackagedFiles(
  directory: string,
  manifest: Pick<RunPackageManifest, 'files'>,
): ReadonlyArray<PackagedFileCheck> {
  return manifest.files.map((file) => {
    const target = join(directory, file.path)
    if (statSync(target, { throwIfNoEntry: false })?.isFile() !== true) {
      return { path: file.path, status: 'missing', expectedBytes: file.bytes, expectedSha256: file.sha256 }
    }
    const bytes = readFileSync(target)
    const digest = createHash('sha256').update(bytes).digest('hex')
    const observed = { observedBytes: bytes.length, observedSha256: digest }
    if (digest === file.sha256) {
      return { path: file.path, status: 'ok', expectedBytes: file.bytes, expectedSha256: file.sha256, ...observed }
    }
    return {
      path: file.path,
      status: bytes.length === file.bytes ? 'digest-differs' : 'bytes-differ',
      expectedBytes: file.bytes,
      expectedSha256: file.sha256,
      ...observed,
    }
  })
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
