/**
 * The study's demand derivation.
 *
 * These tests check that the experiment's demand is COMPUTED from a measured
 * series rather than written into the source, and that the derivation refuses
 * input it cannot read instead of defaulting it. The re-derivation test is the
 * load-bearing one: it regenerates the committed profile from the dataset bytes
 * and fails if the two disagree, so a hand-edit of `study-demand.ts` cannot pass
 * unnoticed on a host that carries the series.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  designTotalVehPerHour,
  deriveDemandProfile,
  parseSeries,
  type MeasuredSeriesProvenance,
} from '../src/runner/demand-profile.ts'
import {
  STUDY_DEMAND_INTERVALS,
  STUDY_DESIGN_INPUTS,
  STUDY_MEASURED_DAYS,
  STUDY_MEASURED_ROWS,
  STUDY_SERIES_PROVENANCE,
  STUDY_SERIES_SHA256,
} from '../src/runner/study-demand.ts'

/**
 * The dataset root the generator resolves by default. A host that points the
 * generator elsewhere (`DSH_RESEARCH_DATASETS`) simply skips the re-derivation
 * check below rather than failing it.
 */
const DATASET_ROOT = 'H:/datasets'

const PROVENANCE: MeasuredSeriesProvenance = {
  datasetId: 'test-series',
  source: 'https://example.invalid/test',
  licence: 'CC0',
  file: 'test.csv',
  column: 'volume',
  unit: 'vehicles per hour',
  timeColumn: 'stamp',
}

/** Three calendar days: two complete, one missing hours (so it must be excluded). */
function sampleCsv(): string {
  const lines = ['ignored,stamp,volume']
  const day = (date: string, base: number): void => {
    for (let hour = 0; hour < 24; hour++) lines.push(`x,${date} ${String(hour).padStart(2, '0')}:00:00,${base + hour}`)
  }
  day('2020-01-01', 100)
  day('2020-01-02', 200)
  // Incomplete: only 6 hours, and its values are extreme. If it were averaged in,
  // the hourly means would move visibly.
  for (let hour = 0; hour < 6; hour++) lines.push(`x,2020-01-03 ${String(hour).padStart(2, '0')}:00:00,99999`)
  return lines.join('\n')
}

const OPTIONS = { intervalCount: 6, designTotalVehPerHour: 1200, majorShare: 0.6 }

describe('demand profile derivation', () => {
  it('reads volumes out of the named columns and drops rows it cannot read', () => {
    const { rows, dropped } = parseSeries(
      'stamp,volume\n2020-01-01 00:00:00,10\nbad-row\n2020-01-01 01:00:00,not-a-number\n2020-01-01 02:00:00,20',
      'stamp',
      'volume',
    )

    expect(rows).toEqual([
      { date: '2020-01-01', hour: 0, value: 10 },
      { date: '2020-01-01', hour: 2, value: 20 },
    ])
    // A row that does not parse is COUNTED, never defaulted to zero: a zero would
    // enter the diurnal mean as a real quiet hour and silently lower the profile.
    expect(dropped).toBe(2)
  })

  it('fails loud when the named columns are absent', () => {
    expect(() => parseSeries('a,b\n1,2', 'stamp', 'volume')).toThrow(/no 'stamp'\/'volume' column/)
  })

  it('averages only complete calendar days into the diurnal curve', () => {
    const profile = deriveDemandProfile(sampleCsv(), PROVENANCE, OPTIONS)

    // The incomplete day carries 99999 and is excluded; the two complete days give
    // hour 0 a mean of (100 + 200) / 2 = 150.
    expect(profile.measured.completeDays).toBe(2)
    // Hour means are 150 + hour for the two complete days; the peak is hour 23.
    expect(profile.measured.peakHourlyVehPerHour).toBe(173)
    expect(profile.intervals[0]?.measuredVehPerHour).toBe(151.5)
    expect(profile.derivation.join(' ')).toContain('2 days')
  })

  it('scales the measured curve so the peak interval carries the design volume', () => {
    const profile = deriveDemandProfile(sampleCsv(), PROVENANCE, OPTIONS)

    const peak = Math.max(...profile.intervals.map(interval => interval.totalVehPerHour))
    expect(peak).toBeCloseTo(OPTIONS.designTotalVehPerHour, 6)
    // Scaling preserves the measured proportions: the quietest interval keeps its
    // ratio to the peak instead of being flattened.
    const ratios = profile.intervals.map(interval => interval.totalVehPerHour)
    expect(Math.max(...ratios)).toBeGreaterThan(Math.min(...ratios))
  })

  it('splits every interval between the two phases by the declared share', () => {
    const profile = deriveDemandProfile(sampleCsv(), PROVENANCE, OPTIONS)

    for (const interval of profile.intervals) {
      const [first, second] = interval.demandPerPhase
      expect(first + second).toBeCloseTo(interval.totalVehPerHour, 6)
      expect(first).toBeCloseTo(interval.totalVehPerHour * OPTIONS.majorShare, 6)
    }
  })

  it('records what was measured and what was assumed, separately', () => {
    const profile = deriveDemandProfile(sampleCsv(), PROVENANCE, OPTIONS)

    expect(profile.derivation.length).toBeGreaterThan(0)
    expect(profile.assumptions.length).toBeGreaterThan(0)
    // The scale mapping and the phase split are the two things the series cannot
    // state, so both must appear as assumptions rather than as facts.
    expect(profile.assumptions.join(' ')).toMatch(/scale factor/)
    expect(profile.assumptions.join(' ')).toMatch(/per-approach split/)
  })

  it('refuses options that would silently produce a malformed profile', () => {
    expect(() => deriveDemandProfile(sampleCsv(), PROVENANCE, { ...OPTIONS, intervalCount: 5 }))
      .toThrow(/must divide 24/)
    expect(() => deriveDemandProfile(sampleCsv(), PROVENANCE, { ...OPTIONS, designTotalVehPerHour: 0 }))
      .toThrow(/must be positive/)
    expect(() => deriveDemandProfile(sampleCsv(), PROVENANCE, { ...OPTIONS, majorShare: 1 }))
      .toThrow(/strictly between 0 and 1/)
    expect(() => deriveDemandProfile('stamp,volume\n', PROVENANCE, OPTIONS))
      .toThrow(/no usable rows/)
    expect(() => deriveDemandProfile('stamp,volume\n2020-01-01 00:00:00,0', PROVENANCE, OPTIONS))
      .toThrow(/no positive hourly volume/)
  })

  it('sizes the design volume from declared capacity inputs, not from a chosen number', () => {
    // Peak load = saturation flow × effective-green ratio × design degree of saturation.
    expect(designTotalVehPerHour(1800, 90, 8, 0.9)).toBeCloseTo(1800 * (82 / 90) * 0.9, 9)
    expect(designTotalVehPerHour(1800, 90, 8, 0.9)).toBeCloseTo(1476, 9)
  })
})

describe('the committed study profile', () => {
  const seriesPath = join(DATASET_ROOT, STUDY_SERIES_PROVENANCE.file)
  const seriesPresent = existsSync(seriesPath)

  it('carries the provenance and the derivation that produced it', () => {
    expect(STUDY_SERIES_SHA256).toMatch(/^[0-9a-f]{64}$/)
    expect(STUDY_SERIES_PROVENANCE.licence).not.toBe('')
    expect(STUDY_MEASURED_DAYS).toBeGreaterThan(0)
    expect(STUDY_MEASURED_ROWS).toBeGreaterThan(0)
    expect(STUDY_DEMAND_INTERVALS).toHaveLength(STUDY_DESIGN_INPUTS.intervalCount)
    // Every interval must be a positive, ordered, fully split demand.
    for (const interval of STUDY_DEMAND_INTERVALS) {
      const [first, second] = interval.demandPerPhase
      expect(first).toBeGreaterThan(0)
      expect(second).toBeGreaterThan(0)
      // Three separately rounded three-decimal values cannot close exactly: the
      // residual is bounded by 1.5e-3, not by zero.
      expect(Math.abs(first + second - interval.totalVehPerHour)).toBeLessThan(2e-3)
    }
  })

  it.skipIf(!seriesPresent)('is reproducible from the dataset bytes', () => {
    const csvText = readFileSync(seriesPath, 'utf8')
    const rederived = deriveDemandProfile(csvText, STUDY_SERIES_PROVENANCE, {
      intervalCount: STUDY_DESIGN_INPUTS.intervalCount,
      designTotalVehPerHour: designTotalVehPerHour(
        STUDY_DESIGN_INPUTS.saturationFlowPerLane,
        STUDY_DESIGN_INPUTS.designCycleSeconds,
        STUDY_DESIGN_INPUTS.lostTimeSeconds,
        STUDY_DESIGN_INPUTS.designDegreeOfSaturation,
      ),
      majorShare: STUDY_DESIGN_INPUTS.majorShare,
    })

    // The committed profile is not a fixture that happens to look plausible: it is
    // what the derivation produces from these bytes, stored to three decimals. A
    // hand-edit fails here; so does a dataset whose bytes have changed.
    expect(rederived.measured.completeDays).toBe(STUDY_MEASURED_DAYS)
    expect(rederived.measured.rows).toBe(STUDY_MEASURED_ROWS)
    expect(rederived.intervals).toHaveLength(STUDY_DEMAND_INTERVALS.length)
    for (const [index, interval] of rederived.intervals.entries()) {
      const stored = STUDY_DEMAND_INTERVALS[index]
      expect(stored?.interval).toBe(interval.interval)
      expect(stored?.startHour).toBe(interval.startHour)
      expect(stored?.endHour).toBe(interval.endHour)
      expect(stored?.measuredVehPerHour).toBeCloseTo(interval.measuredVehPerHour, 3)
      expect(stored?.totalVehPerHour).toBeCloseTo(interval.totalVehPerHour, 3)
      expect(stored?.demandPerPhase[0]).toBeCloseTo(interval.demandPerPhase[0], 3)
      expect(stored?.demandPerPhase[1]).toBeCloseTo(interval.demandPerPhase[1], 3)
    }
  })
})
