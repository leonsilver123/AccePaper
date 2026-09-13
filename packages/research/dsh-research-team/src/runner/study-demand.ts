// @deepseek-ai/dsh-research-team — GENERATED. Do not edit by hand.
//
// The study's demand profile, derived from the real measured series below by
// `scripts/derive-demand-profile.mjs`. Regenerate with:
//
//   node --import tsx/esm packages/research/dsh-research-team/scripts/derive-demand-profile.mjs
//
// The module is committed rather than read at run time so the experiment is
// deterministic on hosts and in CI that do not carry the dataset bytes. Every
// number here is a function of the SHA-256 below; the generator refuses nothing
// and invents nothing, so re-running it against the same bytes reproduces this
// file exactly, and running it against different bytes produces a different one.
//
// `demand-profile.spec.ts` re-derives this file from the series when the bytes are
// present, and fails if they disagree.

import type { DemandInterval, MeasuredSeriesProvenance } from './demand-profile.ts'

/** SHA-256 of the series file this profile was derived from. */
export const STUDY_SERIES_SHA256 = '749c90d720360a4215bb15345526073c079ba4cc95e3fa558796d083f85fce9e'

/** Where the measured series comes from. */
export const STUDY_SERIES_PROVENANCE: MeasuredSeriesProvenance = {
  datasetId: 'uci-metro-interstate-traffic-volume',
  source: 'https://archive.ics.uci.edu/dataset/492/metro+interstate+traffic+volume',
  licence: 'CC BY 4.0',
  file: 'Metro_Interstate_Traffic_Volume.csv',
  column: 'traffic_volume',
  unit: 'vehicles per hour',
  timeColumn: 'date_time',
}

/** Declared design inputs the derivation applied on top of the measurement. */
export const STUDY_DESIGN_INPUTS = {
  saturationFlowPerLane: 1800,
  designCycleSeconds: 90,
  lostTimeSeconds: 8,
  designDegreeOfSaturation: 0.9,
  intervalCount: 6,
  majorShare: 0.6,
} as const

/** Complete calendar days the diurnal curve averages over. */
export const STUDY_MEASURED_DAYS = 1214

/** Rows read out of the series. */
export const STUDY_MEASURED_ROWS = 48204

/** Peak hourly volume in the measured diurnal curve, in the series' own unit. */
export const STUDY_PEAK_HOURLY_VEH_PER_HOUR = 5690.852

/** The derivation, in the order it was applied. */
export const STUDY_DERIVATION: ReadonlyArray<string> = [
  "read 48204 rows of 'traffic_volume' (vehicles per hour) from Metro_Interstate_Traffic_Volume.csv",
  'kept rows forming a complete 24-hour calendar day: 1214 days (0 malformed rows dropped, day-groups with fewer than 24 hours excluded)',
  'averaged the volume per hour-of-day over those days, giving one measured diurnal curve',
  "cut the day into 6 intervals of 4h and took each interval's mean",
  'scaled every interval by 0.3x (1476 veh/h over peak interval 4898.6 measured veh/h), preserving the measured proportions',
  'split each scaled interval 60% / 40% between phase 1 and phase 2',
]

/** Every modelling choice made on top of the measurement. */
export const STUDY_ASSUMPTIONS: ReadonlyArray<string> = [
  'the series is a multi-lane interstate count and the study models ONE two-phase intersection: the mapping between them is the single scale factor above, not a measurement',
  'the share of the total reaching each phase is a declared constant (0.60 / 0.40); the series has no per-approach split',
  'the peak interval is placed at the declared design volume 1476 veh/h; the absolute size of the intersection is a design input, not something the series states',
]

/** The derived demand profile: one entry per control interval, in time order. */
export const STUDY_DEMAND_INTERVALS: ReadonlyArray<DemandInterval> = [
  {
    interval: 0,
    startHour: 0,
    endHour: 4,
    measuredVehPerHour: 539.519,
    totalVehPerHour: 162.563,
    demandPerPhase: [97.538, 65.025],
  },
  {
    interval: 1,
    startHour: 4,
    endHour: 8,
    measuredVehPerHour: 2925.426,
    totalVehPerHour: 881.463,
    demandPerPhase: [528.878, 352.585],
  },
  {
    interval: 2,
    startHour: 8,
    endHour: 12,
    measuredVehPerHour: 4408.903,
    totalVehPerHour: 1328.451,
    demandPerPhase: [797.070, 531.380],
  },
  {
    interval: 3,
    startHour: 12,
    endHour: 16,
    measuredVehPerHour: 4898.594,
    totalVehPerHour: 1476,
    demandPerPhase: [885.600, 590.400],
  },
  {
    interval: 4,
    startHour: 16,
    endHour: 20,
    measuredVehPerHour: 4651.754,
    totalVehPerHour: 1401.624,
    demandPerPhase: [840.975, 560.650],
  },
  {
    interval: 5,
    startHour: 20,
    endHour: 24,
    measuredVehPerHour: 2330.137,
    totalVehPerHour: 702.096,
    demandPerPhase: [421.257, 280.838],
  },
]
