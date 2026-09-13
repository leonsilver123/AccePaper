// @deepseek-ai/dsh-research-team — the study's demand profile, derived from a
// real measured volume series.
//
// WHY THIS EXISTS. The traffic experiment used to run against a demand array
// written into the source (`[[950, 250], [450, 350], …]`). Those numbers came
// from nowhere: no dataset produced them, and no computation connected them to
// one. A C-channel verdict measured on invented demand is a verdict about the
// invention. This module replaces the literal with a DERIVATION from a real,
// openly-licensed, hourly vehicle-count series, and records every step of that
// derivation so a reader can re-run it.
//
// WHAT IS MEASURED AND WHAT IS ASSUMED. The split between measured and assumed is
// the whole point of the module, so it is carried explicitly rather than blurred:
//  - MEASURED: the shape of the demand over the day. The hourly volumes are the
//    mean of every complete calendar day in the series, so the profile is a real
//    diurnal curve and not a hand-drawn one.
//  - ASSUMED: the absolute scale (how a multi-lane interstate count maps onto one
//    two-phase intersection) and the share of the total that reaches each phase.
//    Both are declared constants, stated in `assumptions`, and neither is fitted
//    to the experiment's outcome. They scale the measurement; they do not create it.
//
// The derivation is a pure function of the series text: no clock, no randomness,
// no module-level state, and the caller's options are never mutated.

/** Where a measured series came from, in enough detail to re-obtain it. */
export interface MeasuredSeriesProvenance {
  /** Stable identifier of the dataset. */
  readonly datasetId: string
  /** Where the series is published. */
  readonly source: string
  /** Licence the series is distributed under. */
  readonly licence: string
  /** Series file name (not a host-absolute path — the root is deployment-specific). */
  readonly file: string
  /** Column the volumes were read out of. */
  readonly column: string
  /** Unit of that column, as the publisher states it. */
  readonly unit: string
  /** Timestamp column used to group rows into calendar days. */
  readonly timeColumn: string
}

/** One control interval of the derived profile. */
export interface DemandInterval {
  /** 0-based interval index, in time order. */
  readonly interval: number
  /** First hour-of-day the interval covers (inclusive). */
  readonly startHour: number
  /** Last hour-of-day the interval covers (exclusive). */
  readonly endHour: number
  /** Mean measured volume over the interval's hours, in the series' own unit. */
  readonly measuredVehPerHour: number
  /** Total demand the experiment runs at, after scaling. */
  readonly totalVehPerHour: number
  /** That total split over the two phases. */
  readonly demandPerPhase: readonly [number, number]
}

/** How the measured series was turned into the experiment's demand input. */
export interface DemandProfile {
  /** Control intervals in time order. */
  readonly intervals: ReadonlyArray<DemandInterval>
  /** Provenance of the measured series. */
  readonly provenance: MeasuredSeriesProvenance
  /** The derivation, step by step, in the order it was applied. */
  readonly derivation: ReadonlyArray<string>
  /** Every modelling choice made on top of the measurement. */
  readonly assumptions: ReadonlyArray<string>
  /** Size of the measurement the profile rests on. */
  readonly measured: {
    /** Complete calendar days the diurnal curve averages over. */
    readonly completeDays: number
    /** Rows read from the series. */
    readonly rows: number
    /** Peak hourly volume seen in the diurnal curve. */
    readonly peakHourlyVehPerHour: number
  }
}

/** Declared choices the derivation is allowed to make on top of the measurement. */
export interface DemandProfileOptions {
  /** Number of control intervals the day is divided into. */
  readonly intervalCount: number
  /** Total demand at the design interval, in veh/h — see {@link designTotalVehPerHour}. */
  readonly designTotalVehPerHour: number
  /** Share of the design total that reaches the first phase. */
  readonly majorShare: number
}

/**
 * Read the volumes out of one header-led CSV series.
 *
 * Only rows that parse cleanly contribute. A row whose timestamp or volume is
 * unreadable is DROPPED and counted, never defaulted to zero: a zero would enter
 * the diurnal mean as a real quiet hour and lower the profile.
 *
 * @param csvText - the series file's text, header row first.
 * @param timeColumn - header name of the timestamp column.
 * @param valueColumn - header name of the volume column.
 * @returns the parsed rows plus the count of dropped ones.
 */
export function parseSeries(csvText: string, timeColumn: string, valueColumn: string): {
  readonly rows: ReadonlyArray<{ readonly date: string; readonly hour: number; readonly value: number }>
  readonly dropped: number
} {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '')
  if (lines.length === 0) return { rows: [], dropped: 0 }
  const header = lines[0].split(',').map(cell => cell.trim())
  const timeIndex = header.indexOf(timeColumn)
  const valueIndex = header.indexOf(valueColumn)
  if (timeIndex < 0 || valueIndex < 0) {
    throw new Error(
      `demand-profile: the series has no '${timeColumn}'/'${valueColumn}' column `
      + `(header: ${header.join(',')})`,
    )
  }
  const rows: Array<{ date: string; hour: number; value: number }> = []
  let dropped = 0
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',')
    if (cells.length <= Math.max(timeIndex, valueIndex)) {
      dropped++
      continue
    }
    const stamp = cells[timeIndex].trim()
    const value = Number(cells[valueIndex])
    const [date, time] = stamp.split(' ')
    const hour = Number((time ?? '').split(':')[0])
    if (date === undefined || date === '' || !Number.isFinite(hour) || !Number.isFinite(value)) {
      dropped++
      continue
    }
    rows.push({ date, hour, value })
  }
  return { rows, dropped }
}

/**
 * Derive the study's demand profile from a measured hourly volume series.
 *
 * The diurnal curve is the mean volume per hour-of-day over the series' COMPLETE
 * calendar days (a day with fewer than 24 hourly rows is excluded rather than
 * averaged in at a lower weight). The day is then cut into `intervalCount` equal
 * control intervals and each interval takes the mean of its hours.
 *
 * The curve is scaled once, by `designTotalVehPerHour / peakIntervalMean`, so the
 * busiest interval carries exactly the declared design volume and every other
 * interval keeps its measured proportion. Nothing here reads the experiment's
 * result, so the profile cannot be fitted to a verdict.
 *
 * @param csvText - the series file's text.
 * @param provenance - where the series came from (recorded, not checked).
 * @param options - the declared choices listed in {@link DemandProfileOptions}.
 * @returns the profile plus the derivation and assumptions behind it.
 */
export function deriveDemandProfile(
  csvText: string,
  provenance: MeasuredSeriesProvenance,
  options: DemandProfileOptions,
): DemandProfile {
  const { intervalCount, designTotalVehPerHour, majorShare } = options
  if (!Number.isInteger(intervalCount) || intervalCount <= 0 || 24 % intervalCount !== 0) {
    throw new Error(`demand-profile: intervalCount must divide 24, got ${String(intervalCount)}`)
  }
  if (!(designTotalVehPerHour > 0)) {
    throw new Error(`demand-profile: designTotalVehPerHour must be positive, got ${String(designTotalVehPerHour)}`)
  }
  if (!(majorShare > 0 && majorShare < 1)) {
    throw new Error(`demand-profile: majorShare must be strictly between 0 and 1, got ${String(majorShare)}`)
  }

  const { rows, dropped } = parseSeries(csvText, provenance.timeColumn, provenance.column)
  if (rows.length === 0) {
    throw new Error(`demand-profile: the series '${provenance.file}' produced no usable rows`)
  }

  // Group by calendar day; only days with a full 24 hours enter the curve.
  const perDay = new Map<string, Map<number, number>>()
  for (const row of rows) {
    const day = perDay.get(row.date) ?? new Map<number, number>()
    day.set(row.hour, row.value)
    perDay.set(row.date, day)
  }
  const completeDays = [...perDay.values()].filter(day => day.size === 24)

  const hoursPerInterval = 24 / intervalCount
  const hourOfDayMean: number[] = []
  for (let hour = 0; hour < 24; hour++) {
    if (completeDays.length === 0) {
      // No complete day: fall back to every row, so the profile still rests on the
      // measurement rather than on a constant. Recorded as an assumption below.
      const sameHour = rows.filter(row => row.hour === hour).map(row => row.value)
      hourOfDayMean.push(sameHour.length === 0 ? 0 : sameHour.reduce((a, b) => a + b, 0) / sameHour.length)
    } else {
      hourOfDayMean.push(completeDays.reduce((sum, day) => sum + (day.get(hour) ?? 0), 0) / completeDays.length)
    }
  }

  const intervalMeans: number[] = []
  for (let interval = 0; interval < intervalCount; interval++) {
    let sum = 0
    for (let offset = 0; offset < hoursPerInterval; offset++) {
      sum += hourOfDayMean[interval * hoursPerInterval + offset] ?? 0
    }
    intervalMeans.push(sum / hoursPerInterval)
  }

  const peakIntervalMean = Math.max(...intervalMeans)
  if (!(peakIntervalMean > 0)) {
    throw new Error(`demand-profile: the series '${provenance.file}' has no positive hourly volume`)
  }
  const scale = designTotalVehPerHour / peakIntervalMean

  const intervals: DemandInterval[] = intervalMeans.map((mean, interval) => {
    const totalVehPerHour = mean * scale
    const first = totalVehPerHour * majorShare
    return {
      interval,
      startHour: interval * hoursPerInterval,
      endHour: (interval + 1) * hoursPerInterval,
      measuredVehPerHour: mean,
      totalVehPerHour,
      demandPerPhase: [first, totalVehPerHour - first] as const,
    }
  })

  const derivation: string[] = [
    `read ${String(rows.length)} rows of '${provenance.column}' (${provenance.unit}) from ${provenance.file}`,
    `kept rows forming a complete 24-hour calendar day: ${String(completeDays.length)} days `
    + `(${String(dropped)} malformed rows dropped, day-groups with fewer than 24 hours excluded)`,
    'averaged the volume per hour-of-day over those days, giving one measured diurnal curve',
    `cut the day into ${String(intervalCount)} intervals of ${String(hoursPerInterval)}h and took each interval's mean`,
    `scaled every interval by ${scale.toFixed(1)}x (${designTotalVehPerHour.toFixed(0)} veh/h over `
    + `peak interval ${peakIntervalMean.toFixed(1)} measured veh/h), preserving the measured proportions`,
    `split each scaled interval ${(majorShare * 100).toFixed(0)}% / `
    + `${((1 - majorShare) * 100).toFixed(0)}% between phase 1 and phase 2`,
  ]

  const assumptions: string[] = [
    'the series is a multi-lane interstate count and the study models ONE two-phase intersection: '
    + 'the mapping between them is the single scale factor above, not a measurement',
    'the share of the total reaching each phase is a declared constant '
    + `(${majorShare.toFixed(2)} / ${(1 - majorShare).toFixed(2)}); the series has no per-approach split`,
    'the peak interval is placed at the declared design volume '
    + `${designTotalVehPerHour.toFixed(0)} veh/h; the absolute size of the intersection is a design `
    + 'input, not something the series states',
  ]
  if (completeDays.length === 0) {
    assumptions.push(
      'the series contained no complete 24-hour calendar day on this host, so the curve averages '
      + 'every row per hour-of-day instead',
    )
  }

  return {
    intervals,
    provenance,
    derivation,
    assumptions,
    measured: {
      completeDays: completeDays.length,
      rows: rows.length,
      peakHourlyVehPerHour: Math.max(...hourOfDayMean),
    },
  }
}

/**
 * The declared design volume for the peak interval.
 *
 * Webster's design practice sets a plan so the critical approach runs below
 * saturation; the same reasoning sizes the study's experiment. The value is
 * computed from the saturation flow, the design cycle and the design degree of
 * saturation — all declared — so it is never a number picked to make the
 * experiment come out a particular way.
 *
 * @param saturationFlowPerLane - veh/h one lane discharges under green.
 * @param designCycleSeconds - cycle the design is evaluated at.
 * @param lostTimeSeconds - lost time per cycle.
 * @param degreeOfSaturation - design load on the critical approach (0–1).
 * @returns the design total demand in veh/h.
 */
export function designTotalVehPerHour(
  saturationFlowPerLane: number,
  designCycleSeconds: number,
  lostTimeSeconds: number,
  degreeOfSaturation: number,
): number {
  const greenRatio = (designCycleSeconds - lostTimeSeconds) / designCycleSeconds
  return saturationFlowPerLane * greenRatio * degreeOfSaturation
}
