// @deepseek-ai/dsh-research-team — versioned traffic Case Pack loader.
//
// The Case Pack is the run's curated input: a directory of JSON files that supply the
// research question, the central claim, the deterministic experiment's configuration and
// its scenario parameters, the ablation and boundary configs, the citation ledger and the
// reproducibility manifest. It exists so a run is driven by a SELECTED, versioned input
// set rather than by constants compiled into the registry.
//
// TRUTHFULNESS. Every file carries the same envelope
// (`schemaVersion`, `sourceKind`, `truthfulness`, `provenance`, `generatedAt`), and every
// value this loader derives keeps its originating file and pointer. The shipped traffic
// pack is `sourceKind: fixture` throughout: it is synthetic demo content, its own manifest
// says `noRealEmpiricalTruth`, and nothing derived from it may be presented as a measured
// research finding.
//
// Two facts about the manifest are reported SEPARATELY, and neither stands in for the
// other:
//   - `hashOfInputs` is the value the PACK asserts about its own files. Nothing in this
//     repository can recompute it: the generator that wrote the pack
//     (`case-pack-traffic.fixture-writer/v1`) is not part of the tree, and no documented
//     scheme reproduces the value from the file bytes. It is therefore recorded as an
//     assertion, never verified.
//   - `sha256` per file is what THIS loader computed from the bytes it read. That is the
//     value a consumer can check.

import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

/** The one schema version this loader accepts. Any other value is rejected, not guessed. */
export const CASE_PACK_SCHEMA_VERSION = 'case-pack-traffic.v1'

/**
 * Every file a traffic case pack consists of, in the order the reproducibility manifest
 * lists its own inputs. All seven are REQUIRED: a pack missing one is not a smaller pack,
 * it is an incomplete one, and the loader refuses it rather than running with a gap.
 */
export const CASE_PACK_FILES = [
  'case-pack.json',
  'claim.json',
  'citation-ledger.json',
  'mock-experiment.json',
  'ablation.json',
  'boundary-counterexample.json',
  'reproducibility-manifest.json',
] as const

/** One of {@link CASE_PACK_FILES}. */
export type CasePackFileName = (typeof CASE_PACK_FILES)[number]

/** The provenance envelope every case-pack file carries. */
export interface CasePackEnvelope {
  readonly schemaVersion: string
  readonly sourceKind: string
  readonly truthfulness: string
  readonly provenance: string
  readonly generatedAt: string
}

/** One loaded file: its envelope, its whole parsed content, and this loader's digest. */
export interface CasePackFile {
  readonly file: CasePackFileName
  readonly envelope: CasePackEnvelope
  /** The parsed document. Keys beyond the envelope are kept as they are written. */
  readonly content: Readonly<Record<string, unknown>>
  /** SHA-256 of the file's bytes as this loader read them, lower-case hex. */
  readonly sha256: string
}

/** A loaded, validated case pack. */
export interface CasePack {
  /** Absolute directory the pack was read from. */
  readonly directory: string
  /** The pack's own id (`case-pack.json#id`). */
  readonly id: string
  readonly files: ReadonlyMap<CasePackFileName, CasePackFile>
  /** The value `reproducibility-manifest.json` asserts about its six input files. */
  readonly assertedHashOfInputs: string
}

/** Stable failure codes, so a caller distinguishes why a pack was refused. */
export type CasePackErrorCode =
  | 'CASE_PACK_DIR_MISSING'
  | 'CASE_PACK_FILE_MISSING'
  | 'CASE_PACK_FILE_INVALID'
  | 'CASE_PACK_ENVELOPE_INVALID'
  | 'CASE_PACK_VERSION_UNSUPPORTED'
  | 'CASE_PACK_DATUM_MISSING'

/** A refusal to load or use a case pack, carrying which file and datum caused it. */
export class CasePackError extends Error {
  readonly code: CasePackErrorCode

  constructor(code: CasePackErrorCode, message: string) {
    super(message)
    this.name = 'CasePackError'
    this.code = code
  }
}

const ENVELOPE_FIELDS = ['schemaVersion', 'sourceKind', 'truthfulness', 'provenance', 'generatedAt'] as const

/** Read one envelope field as a non-empty string, or refuse the file. */
function envelopeField(file: string, content: Record<string, unknown>, field: string): string {
  const value = content[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new CasePackError(
      'CASE_PACK_ENVELOPE_INVALID',
      `[case-pack] ${file}: envelope field "${field}" must be a non-empty string`,
    )
  }
  return value
}

/**
 * Read a required nested string, addressed as `a.b`.
 *
 * @param pack - the loaded pack.
 * @param file - the file to read from.
 * @param pointer - the dotted path to the value.
 * @returns the non-empty string.
 * @throws {CasePackError} `CASE_PACK_DATUM_MISSING` when the path is absent or not a string.
 */
export function casePackDatum(pack: CasePack, file: CasePackFileName, pointer: string): string {
  return datumFrom(pack.files, file, pointer)
}

/**
 * Read a required array of strings out of one loaded file.
 *
 * @param pack - the loaded pack.
 * @param file - the file to read from.
 * @param pointer - the dotted path to the array.
 * @returns the strings, in the file's order.
 * @throws {CasePackError} `CASE_PACK_DATUM_MISSING` when the path is absent, is not an array,
 *   or holds a non-string entry.
 */
function stringListFrom(pack: CasePack, file: CasePackFileName, pointer: string): ReadonlyArray<string> {
  const entry = pack.files.get(file)
  let cursor: unknown = entry?.content
  for (const segment of pointer.split('.')) {
    if (cursor === null || typeof cursor !== 'object') cursor = undefined
    else cursor = (cursor as Record<string, unknown>)[segment]
  }
  if (!Array.isArray(cursor) || cursor.some(item => typeof item !== 'string')) {
    throw new CasePackError(
      'CASE_PACK_DATUM_MISSING',
      `[case-pack] ${file}#${pointer} is required and must be an array of strings`,
    )
  }
  return cursor as ReadonlyArray<string>
}

/** Read a required nested string out of one loaded file. */
function datumFrom(
  files: ReadonlyMap<CasePackFileName, CasePackFile>,
  file: CasePackFileName,
  pointer: string,
): string {
  const entry = files.get(file)
  if (entry === undefined) {
    // Unreachable for a loaded pack — every file is required — but reporting the datum
    // is more useful than a crash if a pack object is ever assembled by hand.
    throw new CasePackError('CASE_PACK_DATUM_MISSING', `[case-pack] ${file} is not loaded`)
  }
  let cursor: unknown = entry.content
  for (const segment of pointer.split('.')) {
    if (cursor === null || typeof cursor !== 'object') cursor = undefined
    else cursor = (cursor as Record<string, unknown>)[segment]
  }
  if (typeof cursor !== 'string' || cursor.length === 0) {
    throw new CasePackError(
      'CASE_PACK_DATUM_MISSING',
      `[case-pack] ${file}#${pointer} is required and must be a non-empty string`,
    )
  }
  return cursor
}

/**
 * Load and validate a traffic case pack.
 *
 * The whole pack is read or none of it is: a missing file, a malformed document, a
 * missing envelope field or an unsupported `schemaVersion` refuses the load. Keys beyond
 * the envelope are preserved untouched, so a pack that carries more than this loader
 * reads loses nothing.
 *
 * @param directory - the pack directory, absolute or relative to the process working directory.
 * @returns the validated pack.
 * @throws {CasePackError} with a stable code naming what was wrong.
 */
export function loadCasePack(directory: string): CasePack {
  const root = isAbsolute(directory) ? directory : resolve(process.cwd(), directory)
  try {
    if (!statSync(root).isDirectory()) {
      throw new CasePackError('CASE_PACK_DIR_MISSING', `[case-pack] ${root} is not a directory`)
    }
  } catch (error) {
    if (error instanceof CasePackError) throw error
    throw new CasePackError('CASE_PACK_DIR_MISSING', `[case-pack] ${root} cannot be read as a directory`)
  }

  const files = new Map<CasePackFileName, CasePackFile>()
  for (const file of CASE_PACK_FILES) {
    let bytes: string
    try {
      bytes = readFileSync(join(root, file), 'utf8')
    } catch {
      throw new CasePackError('CASE_PACK_FILE_MISSING', `[case-pack] ${file} is missing from ${root}`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(bytes)
    } catch (error) {
      throw new CasePackError(
        'CASE_PACK_FILE_INVALID',
        `[case-pack] ${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new CasePackError('CASE_PACK_FILE_INVALID', `[case-pack] ${file} must contain a JSON object`)
    }
    const content = parsed as Record<string, unknown>
    const envelope: CasePackEnvelope = {
      schemaVersion: envelopeField(file, content, ENVELOPE_FIELDS[0]),
      sourceKind: envelopeField(file, content, ENVELOPE_FIELDS[1]),
      truthfulness: envelopeField(file, content, ENVELOPE_FIELDS[2]),
      provenance: envelopeField(file, content, ENVELOPE_FIELDS[3]),
      generatedAt: envelopeField(file, content, ENVELOPE_FIELDS[4]),
    }
    if (envelope.schemaVersion !== CASE_PACK_SCHEMA_VERSION) {
      throw new CasePackError(
        'CASE_PACK_VERSION_UNSUPPORTED',
        `[case-pack] ${file} declares schemaVersion "${envelope.schemaVersion}"; this loader `
        + `accepts "${CASE_PACK_SCHEMA_VERSION}" only`,
      )
    }
    files.set(file, { file, envelope, content, sha256: digestOf(bytes) })
  }

  return {
    directory: root,
    id: datumFrom(files, 'case-pack.json', 'id'),
    files,
    assertedHashOfInputs: datumFrom(files, 'reproducibility-manifest.json', 'hashOfInputs'),
  }
}

/** SHA-256 of one string, lower-case hex. */
function digestOf(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/**
 * The run input slugs a case pack seeds.
 *
 * These are run INPUTS, not step products: the pipeline still executes every step, and a
 * step that consumes one of these does so as its evidence rather than by inventing it.
 * `domain-direction` is the pipeline's own declared entry input; the `case-pack-*` slugs
 * are the pack's contributions and are named so a reader can see where a value came from.
 */
export const CASE_PACK_INPUT_SLUGS = {
  direction: 'domain-direction',
  claim: 'case-pack-claim',
  experiment: 'case-pack-experiment',
  ablation: 'case-pack-ablation',
  boundary: 'case-pack-boundary',
  citations: 'case-pack-citations',
  scenario: 'case-pack-scenario',
} as const

/** One run input derived from a case pack, with the file and pointer it came from. */
export interface CasePackRunInput {
  readonly slug: string
  readonly value: unknown
  /** `file#pointer` for each datum the value was built from. */
  readonly derivedFrom: ReadonlyArray<string>
}

/**
 * The provenance block carried inside one derived value.
 *
 * Read from {@link CasePackFile} the value was PRIMARILY built from, not from the pack as
 * a whole: the shipped pack is not uniform — its experiment, ablation and boundary files
 * are `truthfulness: mock` and `provenance: synthetic_deterministic`, while the claim and
 * question files are `direct_fixture`. Stamping one file's envelope onto another file's
 * values would attribute a synthetic result to the wrong source, which is the exact
 * confusion the truthfulness vocabulary exists to prevent.
 *
 * @param pack - the loaded pack.
 * @param primaryFile - the file the value was primarily derived from.
 * @param derivedFrom - every `file#pointer` the value was built from.
 * @returns the provenance block.
 */
function provenanceOf(
  pack: CasePack,
  primaryFile: CasePackFileName,
  derivedFrom: ReadonlyArray<string>,
): Record<string, unknown> {
  const primary = pack.files.get(primaryFile)?.envelope
  return {
    casePackId: pack.id,
    casePackDirectory: pack.directory,
    sourceKind: primary?.sourceKind ?? 'unknown',
    truthfulness: primary?.truthfulness ?? 'unknown',
    provenance: primary?.provenance ?? 'unknown',
    primaryFile,
    derivedFrom,
  }
}

/**
 * Derive the run inputs a case pack supplies.
 *
 * Pure: it reads the loaded pack and returns values, so a caller can inspect exactly what
 * would be seeded before seeding it, and a spec can assert on the derivation without a
 * store.
 *
 * The scenario parameters travel as their own input so an executor can consume the pack's
 * numbers instead of a constant, which is what makes a change to the pack change the run.
 *
 * @param pack - a loaded pack.
 * @returns one entry per seeded slug.
 * @throws {CasePackError} `CASE_PACK_DATUM_MISSING` when a required datum is absent.
 */
export function planCasePackInputs(pack: CasePack): ReadonlyArray<CasePackRunInput> {
  const direction = casePackDatum(pack, 'case-pack.json', 'researchQuestion.en')
  const assertion = casePackDatum(pack, 'claim.json', 'assertion.en')
  const prediction = casePackDatum(pack, 'claim.json', 'prediction.en')
  const falsificationCondition = casePackDatum(pack, 'claim.json', 'falsification.condition')
  const falsificationExperiment = casePackDatum(pack, 'claim.json', 'falsification.experiment')
  const scope = casePackDatum(pack, 'claim.json', 'falsification.scope')
  const dataSource = casePackDatum(pack, 'claim.json', 'falsification.dataSource')
  const claimId = casePackDatum(pack, 'claim.json', 'id')
  // The pack's own list of its source files. The A channel's domain check traces the claim's
  // declared data source to one of these, so a claim pointing at a file the pack never
  // shipped refutes instead of passing unexamined.
  const declaredSources = stringListFrom(pack, 'reproducibility-manifest.json', 'inputFiles')

  // The claim's essential difference is RESTATED from the pack's own configuration of the
  // two variants it compares. The pack carries no free-standing difference statement, and
  // this loader does not author one: composing it from `baselineConfig` and
  // `mockExperimentConfig` keeps every word the pack's own, and both pointers are recorded.
  const baselineController = casePackDatum(pack, 'case-pack.json', 'baselineConfig.controller')
  const adaptiveController = casePackDatum(pack, 'case-pack.json', 'mockExperimentConfig.adaptiveController')

  const scenario = pack.files.get('case-pack.json')?.content.domainScenarios
  const experimentConfig = pack.files.get('case-pack.json')?.content.mockExperimentConfig

  return [
    { slug: CASE_PACK_INPUT_SLUGS.direction, value: direction, derivedFrom: ['case-pack.json#researchQuestion.en'] },
    {
      slug: CASE_PACK_INPUT_SLUGS.claim,
      value: {
        claimId,
        assertion,
        essentialDifference: `${baselineController} vs ${adaptiveController}`,
        experimentToFalsify: falsificationCondition,
        prediction,
        falsificationExperiment,
        scope,
        dataSource,
        declaredSources,
        // Present only when the pack declares it. Absent means the claim states no quantity, and
        // the C channel then HOLDS instead of grading it against whatever the experiment measured.
        ...(typeof pack.files.get('claim.json')?.content.metricKey === 'string'
          ? { metricKey: pack.files.get('claim.json')?.content.metricKey as string }
          : {}),
        ...provenanceOf(pack, 'claim.json', [
          'claim.json#assertion.en',
          'claim.json#prediction.en',
          'claim.json#falsification',
          'case-pack.json#baselineConfig.controller',
          'case-pack.json#mockExperimentConfig.adaptiveController',
        ]),
      },
      derivedFrom: ['claim.json#assertion.en', 'claim.json#prediction.en', 'case-pack.json#baselineConfig.controller'],
    },
    {
      slug: CASE_PACK_INPUT_SLUGS.scenario,
      value: { domainScenarios: scenario, experiment: experimentConfig, ...provenanceOf(pack, 'case-pack.json', ['case-pack.json#domainScenarios', 'case-pack.json#mockExperimentConfig']) },
      derivedFrom: ['case-pack.json#domainScenarios', 'case-pack.json#mockExperimentConfig'],
    },
    {
      slug: CASE_PACK_INPUT_SLUGS.experiment,
      value: { ...(pack.files.get('mock-experiment.json')?.content ?? {}), ...provenanceOf(pack, 'mock-experiment.json', ['mock-experiment.json']) },
      derivedFrom: ['mock-experiment.json'],
    },
    {
      slug: CASE_PACK_INPUT_SLUGS.ablation,
      value: { ...(pack.files.get('ablation.json')?.content ?? {}), ...provenanceOf(pack, 'ablation.json', ['ablation.json']) },
      derivedFrom: ['ablation.json'],
    },
    {
      slug: CASE_PACK_INPUT_SLUGS.boundary,
      value: { ...(pack.files.get('boundary-counterexample.json')?.content ?? {}), ...provenanceOf(pack, 'boundary-counterexample.json', ['boundary-counterexample.json']) },
      derivedFrom: ['boundary-counterexample.json'],
    },
    {
      slug: CASE_PACK_INPUT_SLUGS.citations,
      value: { ...(pack.files.get('citation-ledger.json')?.content ?? {}), ...provenanceOf(pack, 'citation-ledger.json', ['citation-ledger.json']) },
      derivedFrom: ['citation-ledger.json'],
    },
  ]
}
