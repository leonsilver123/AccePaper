// @deepseek-ai/dsh-research-tools — T16 figure, deterministic y-axis scaling.
//
// Shared by the SVG builder and the PNG rasterizer so both render the SAME
// data -> pixel transform from the same validated numbers. Pure, deterministic:
// no randomness, no clocks, no state. All arithmetic is plain IEEE-754 double
// math on finite, pre-validated inputs (NaN/Infinity never reach this module).

/** The shared data-to-pixel mapping for one figure's y axis, derived once so
 *  the SVG builder and the rasterizer cannot disagree on where a value sits. */
export interface YScale {
  /** Data value at the bottom of the plot (<= 0). */
  readonly min: number
  /** Data value at the top of the plot (>= max(data, 0)). */
  readonly max: number
  /** Distance between consecutive ticks (a "nice" 1/2/5 x 10^k step). */
  readonly step: number
  /** Fixed decimal places used to format every tick label. */
  readonly decimals: number
  /** Tick values between min and max inclusive (multiples of step). */
  readonly ticks: ReadonlyArray<number>
}

const NICE_BASES: ReadonlyArray<number> = [1, 2, 5, 10]

/** Pick a "nice" step close to span/tickTarget from {1,2,5,10} x 10^k. */
function niceStep(span: number, tickTarget: number): number {
  const rough = span / tickTarget
  // defensive: computeYScale only reaches here with a non-collapsed range
  // (lo < hi => span > 0), so rough > 0 always holds.
  /* v8 ignore start -- span is always positive here */
  if (!(rough > 0)) {
    return 1
  }
  /* v8 ignore stop */
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)))
  const normalized = rough / magnitude
  let base = 10
  for (const candidate of NICE_BASES) {
    if (normalized <= candidate) {
      base = candidate
      break
    }
  }
  return base * magnitude
}

/** Number of decimal places needed to print ticks of this step exactly. */
function stepDecimals(step: number): number {
  if (step >= 1) {
    return 0
  }
  const exponent = Math.floor(Math.log10(step))
  return Math.min(12, Math.max(0, -exponent))
}

/**
 * Build a y scale covering [min(data,0), max(data,0)] with a nice step. When
 * every value is zero (or the range collapses) the axis falls back to [0,1].
 *
 * @param dataValues - Every plotted value across all series. The axis bounds
 *   always include zero and snap outward to a multiple of the step, so no mark
 *   is clipped; an empty array collapses the range and takes the [0,1] fallback.
 * @returns The scale, whose `decimals` is the single precision every tick label
 *   of this figure is formatted with.
 */
export function computeYScale(dataValues: ReadonlyArray<number>): YScale {
  let dataMin = Number.POSITIVE_INFINITY
  let dataMax = Number.NEGATIVE_INFINITY
  for (const value of dataValues) {
    if (value < dataMin) dataMin = value
    if (value > dataMax) dataMax = value
  }
  let lo = Math.min(0, dataMin)
  let hi = Math.max(0, dataMax)
  if (!(lo < hi)) {
    // Collapsed range (e.g. all values === 0): force a 0..1 axis.
    lo = 0
    hi = 1
  }
  const span = hi - lo
  const step = niceStep(span, 5)
  // Axis bounds snap OUT to multiples of step so no bar/point is clipped.
  const k0 = Math.floor(lo / step)
  const k1 = Math.ceil(hi / step)
  const axisMin = k0 * step
  const axisMax = k1 * step
  const decimals = stepDecimals(step)
  const ticks: number[] = []
  for (let k = k0; k <= k1; k += 1) {
    let tick = k * step
    if (Math.abs(tick) < step * 1e-9) {
      tick = 0
    }
    ticks.push(tick)
    // defensive: a "nice" step stays within ~5x of span/5, so the snapped
    // k0..k1 range never exceeds ~8 ticks; the 64-tick break is unreachable.
    /* v8 ignore start -- tick-count cap is unreachable */
    if (ticks.length > 64) {
      break
    }
    /* v8 ignore stop */
  }
  return { min: axisMin, max: axisMax, step, decimals, ticks }
}

/** Linearly map a data value into the plot band [plotTop..plotBottom].
 *
 * @param value - Data value to place; values outside the scale's range map
 *  outside the band rather than being clamped.
 * @param scale - The scale supplying the data range the ratio is taken over.
 * @param plotTop - Pixel y of the band's top edge (the scale's `max`).
 * @param plotBottom - Pixel y of the band's bottom edge (the scale's `min`);
 *  y grows downward, so this is the larger pixel coordinate.
 * @returns The pixel y for the value. */
export function valueToPixelY(
  value: number,
  scale: YScale,
  plotTop: number,
  plotBottom: number,
): number {
  const ratio = scale.max === scale.min ? 0 : (value - scale.min) / (scale.max - scale.min)
  return plotBottom - ratio * (plotBottom - plotTop)
}

/** Format one tick value with the scale's fixed decimals, trimming zeros.
 *
 * @param value - Tick value; one below half of the last kept decimal place
 *  renders as `0` instead of a signed zero or a rounded non-zero.
 * @param decimals - Decimal places from the scale; 0 yields an integer string.
 * @returns The label text, with trailing zeros and a bare decimal point
 *  trimmed. */
export function formatTick(value: number, decimals: number): string {
  if (Math.abs(value) < Math.pow(10, -Math.max(decimals, 0)) / 2) {
    return '0'
  }
  const fixed = value.toFixed(decimals)
  if (decimals > 0) {
    return fixed.replace(/\.?0+$/u, '')
  }
  return fixed
}
