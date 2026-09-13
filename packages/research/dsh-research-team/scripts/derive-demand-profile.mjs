// Regenerates `src/runner/study-demand.ts` from the real measured volume series.
//
// Run from the repository root:
//   node --import tsx/esm packages/research/dsh-research-team/scripts/derive-demand-profile.mjs
//
// The generated module is committed so the pipeline is deterministic on every
// host and in CI, where the dataset bytes are not present. The header it writes
// records the series and its SHA-256, so the committed numbers can always be
// traced back to the measurement they came from — and re-derived with this script.
//
// The dataset root resolves the same way the pipeline resolves it: the
// `DSH_RESEARCH_DATASETS` environment variable, else `H:/datasets`.

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { designTotalVehPerHour, deriveDemandProfile } from '../src/runner/demand-profile.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(HERE, '..')
const OUT_PATH = join(PACKAGE_ROOT, 'src', 'runner', 'study-demand.ts')

const DATASET_ROOT = process.env.DSH_RESEARCH_DATASETS ?? 'H:/datasets'
const SERIES_FILE = 'Metro_Interstate_Traffic_Volume.csv'
const SERIES_PATH = join(DATASET_ROOT, SERIES_FILE)

/** Declared design inputs. Changing one changes the generated profile; none is fitted to a result. */
const SATURATION_FLOW_PER_LANE = 1800
const DESIGN_CYCLE_SECONDS = 90
const LOST_TIME_SECONDS = 8
const DESIGN_DEGREE_OF_SATURATION = 0.9
const INTERVAL_COUNT = 6
const MAJOR_SHARE = 0.6

const provenance = {
  datasetId: 'uci-metro-interstate-traffic-volume',
  source: 'https://archive.ics.uci.edu/dataset/492/metro+interstate+traffic+volume',
  licence: 'CC BY 4.0',
  file: SERIES_FILE,
  column: 'traffic_volume',
  unit: 'vehicles per hour',
  timeColumn: 'date_time',
}

const csvText = readFileSync(SERIES_PATH, 'utf8')
const sha256 = createHash('sha256').update(csvText).digest('hex')

const designTotal = designTotalVehPerHour(
  SATURATION_FLOW_PER_LANE,
  DESIGN_CYCLE_SECONDS,
  LOST_TIME_SECONDS,
  DESIGN_DEGREE_OF_SATURATION,
)

const profile = deriveDemandProfile(csvText, provenance, {
  intervalCount: INTERVAL_COUNT,
  designTotalVehPerHour: designTotal,
  majorShare: MAJOR_SHARE,
})

const num = (value) => {
  const rounded = Math.round(value * 1000) / 1000
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(3)
}
// Emit in the repository's quote style (`@stylistic/quotes: single`, with the
// `avoidEscape` allowance the lint config grants a string containing an apostrophe).
const str = (value) => {
  const escaped = value.replace(/\\/g, '\\\\')
  if (!escaped.includes("'")) return `'${escaped}'`
  if (!escaped.includes('"')) return `"${escaped}"`
  return `'${escaped.replace(/'/g, "\\'")}'`
}

const intervals = profile.intervals
  .map(
    interval =>
      '  {\n'
      + `    interval: ${interval.interval},\n`
      + `    startHour: ${interval.startHour},\n`
      + `    endHour: ${interval.endHour},\n`
      + `    measuredVehPerHour: ${num(interval.measuredVehPerHour)},\n`
      + `    totalVehPerHour: ${num(interval.totalVehPerHour)},\n`
      + `    demandPerPhase: [${num(interval.demandPerPhase[0])}, ${num(interval.demandPerPhase[1])}],\n`
      + '  },',
  )
  .join('\n')

const derivation = profile.derivation.map(entry => `  ${str(entry)},`).join('\n')
const assumptions = profile.assumptions.map(entry => `  ${str(entry)},`).join('\n')

const moduleText = `// @deepseek-ai/dsh-research-team — GENERATED. Do not edit by hand.
//
// The study's demand profile, derived from the real measured series below by
// \`scripts/derive-demand-profile.mjs\`. Regenerate with:
//
//   node --import tsx/esm packages/research/dsh-research-team/scripts/derive-demand-profile.mjs
//
// The module is committed rather than read at run time so the experiment is
// deterministic on hosts and in CI that do not carry the dataset bytes. Every
// number here is a function of the SHA-256 below; the generator refuses nothing
// and invents nothing, so re-running it against the same bytes reproduces this
// file exactly, and running it against different bytes produces a different one.
//
// ${'`demand-profile.spec.ts`'} re-derives this file from the series when the bytes are
// present, and fails if they disagree.

import type { DemandInterval, MeasuredSeriesProvenance } from './demand-profile.ts'

/** SHA-256 of the series file this profile was derived from. */
export const STUDY_SERIES_SHA256 = ${str(sha256)}

/** Where the measured series comes from. */
export const STUDY_SERIES_PROVENANCE: MeasuredSeriesProvenance = {
  datasetId: ${str(provenance.datasetId)},
  source: ${str(provenance.source)},
  licence: ${str(provenance.licence)},
  file: ${str(provenance.file)},
  column: ${str(provenance.column)},
  unit: ${str(provenance.unit)},
  timeColumn: ${str(provenance.timeColumn)},
}

/** Declared design inputs the derivation applied on top of the measurement. */
export const STUDY_DESIGN_INPUTS = {
  saturationFlowPerLane: ${SATURATION_FLOW_PER_LANE},
  designCycleSeconds: ${DESIGN_CYCLE_SECONDS},
  lostTimeSeconds: ${LOST_TIME_SECONDS},
  designDegreeOfSaturation: ${DESIGN_DEGREE_OF_SATURATION},
  intervalCount: ${INTERVAL_COUNT},
  majorShare: ${MAJOR_SHARE},
} as const

/** Complete calendar days the diurnal curve averages over. */
export const STUDY_MEASURED_DAYS = ${profile.measured.completeDays}

/** Rows read out of the series. */
export const STUDY_MEASURED_ROWS = ${profile.measured.rows}

/** Peak hourly volume in the measured diurnal curve, in the series' own unit. */
export const STUDY_PEAK_HOURLY_VEH_PER_HOUR = ${num(profile.measured.peakHourlyVehPerHour)}

/** The derivation, in the order it was applied. */
export const STUDY_DERIVATION: ReadonlyArray<string> = [
${derivation}
]

/** Every modelling choice made on top of the measurement. */
export const STUDY_ASSUMPTIONS: ReadonlyArray<string> = [
${assumptions}
]

/** The derived demand profile: one entry per control interval, in time order. */
export const STUDY_DEMAND_INTERVALS: ReadonlyArray<DemandInterval> = [
${intervals}
]
`

writeFileSync(OUT_PATH, moduleText, 'utf8')
console.log(`wrote ${OUT_PATH}`)
console.log(`series sha256 ${sha256}`)
console.log(`complete days ${profile.measured.completeDays}  rows ${profile.measured.rows}`)
console.log(`design total ${designTotal.toFixed(1)} veh/h`)
for (const interval of profile.intervals) {
  console.log(
    `  interval ${interval.interval} (${String(interval.startHour).padStart(2, '0')}h-`
    + `${String(interval.endHour).padStart(2, '0')}h) measured ${interval.measuredVehPerHour.toFixed(1)} `
    + `-> ${interval.totalVehPerHour.toFixed(1)} veh/h `
    + `[${interval.demandPerPhase[0].toFixed(1)}, ${interval.demandPerPhase[1].toFixed(1)}]`,
  )
}
