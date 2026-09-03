// @deepseek-ai/dsh-research-tools — T16 figure, deterministic software rasterizer.
//
// Produces a REAL RGBA pixel buffer (width x height x 4) for the PNG encoder
// WITHOUT any canvas/font/image dependency: fills, lines, circles and the
// built-in 5x7 bitmap face (./font5x7.ts) are all drawn with hand-rolled pixel
// loops. Rendering is a pure function of the validated spec snapshot + the
// shared y scale — the same input always yields the same bytes. It never draws
// a legend claim, a p-value, or any statistical conclusion (rule 7): only the
// data, the axes and the labels the caller provided.

import type { FigureDash, FigureSpecSnapshot } from './adapter.ts'
import { parseColor, type Rgb } from './color.ts'
import { glyphRowsFor, textWidth } from './font5x7.ts'
import { formatTick, type YScale } from './scale.ts'

export interface RasterResult {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
}

const FONT_HEIGHT_PX = 7
const ADVANCE_PX = textWidth('A') // glyph advance at scale 1 == 6px

function toRgb(canonicalHex: string): Rgb {
  return parseColor(canonicalHex)
}

interface DrawCtx {
  readonly w: number
  readonly h: number
  readonly data: Uint8Array
}

function putPixel(ctx: DrawCtx, x: number, y: number, rgb: Rgb): void {
  const xi = Math.round(x)
  const yi = Math.round(y)
  if (xi < 0 || yi < 0 || xi >= ctx.w || yi >= ctx.h) {
    return
  }
  const offset = (yi * ctx.w + xi) * 4
  ctx.data[offset] = rgb.r
  ctx.data[offset + 1] = rgb.g
  ctx.data[offset + 2] = rgb.b
  ctx.data[offset + 3] = 255
}

/** Fill an inclusive [x0..x1] x [y0..y1] rectangle, clipped to the canvas. */
function fillRect(ctx: DrawCtx, x0: number, y0: number, x1: number, y1: number, rgb: Rgb): void {
  const left = Math.max(0, Math.floor(Math.min(x0, x1)))
  const right = Math.min(ctx.w - 1, Math.ceil(Math.max(x0, x1)))
  const top = Math.max(0, Math.floor(Math.min(y0, y1)))
  const bottom = Math.min(ctx.h - 1, Math.ceil(Math.max(y0, y1)))
  if (left > right || top > bottom) {
    return
  }
  for (let y = top; y <= bottom; y += 1) {
    const rowStart = y * ctx.w
    for (let x = left; x <= right; x += 1) {
      const offset = (rowStart + x) * 4
      ctx.data[offset] = rgb.r
      ctx.data[offset + 1] = rgb.g
      ctx.data[offset + 2] = rgb.b
      ctx.data[offset + 3] = 255
    }
  }
}

/** Bresenham line from (x0,y0) to (x1,y1), optionally dashed. */
function drawLine(
  ctx: DrawCtx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: Rgb,
  dash: FigureDash = 'solid',
): void {
  const ax = Math.round(x0)
  const ay = Math.round(y0)
  const bx = Math.round(x1)
  const by = Math.round(y1)
  const dx = Math.abs(bx - ax)
  const dy = -Math.abs(by - ay)
  const sx = ax < bx ? 1 : -1
  const sy = ay < by ? 1 : -1
  let err = dx + dy
  let x = ax
  let y = ay
  let distance = 0
  const maxSteps = dx + dy * -1 + 1
  for (let step = 0; step <= maxSteps; step += 1) {
    const dashOn = dash === 'dashed' ? Math.floor(distance / 4) % 2 === 0 : true
    if (dashOn) {
      putPixel(ctx, x, y, rgb)
    }
    if (x === bx && y === by) {
      break
    }
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x += sx
    }
    if (e2 <= dx) {
      err += dx
      y += sy
    }
    distance += 1
  }
}

/** Filled disc (rasterized deterministically per-pixel). */
function fillDisc(ctx: DrawCtx, cx: number, cy: number, radius: number, rgb: Rgb): void {
  const r = Math.max(1, Math.round(radius))
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      if (dx * dx + dy * dy <= r * r) {
        putPixel(ctx, cx + dx, cy + dy, rgb)
      }
    }
  }
}

/** Draw `text` with the 5x7 face; x,y = top-left of the first glyph. */
function drawText(
  ctx: DrawCtx,
  x: number,
  y: number,
  text: string,
  rgb: Rgb,
  scale: number,
): void {
  for (let i = 0; i < text.length; i += 1) {
    const rows = glyphRowsFor(text.charAt(i))
    const originX = x + i * ADVANCE_PX * scale
    for (let row = 0; row < FONT_HEIGHT_PX; row += 1) {
      // defensive: glyphRowsFor always returns the 7-row mask list (glyph or
      // QUESTION_ROWS), so rows[row] is always defined.
      /* v8 ignore start -- dense glyph-row invariant */
      const mask = rows[row] ?? 0
      /* v8 ignore stop */
      for (let col = 0; col < 5; col += 1) {
        if ((mask & (16 >> col)) !== 0) {
          fillRect(
            ctx,
            originX + col * scale,
            y + row * scale,
            originX + col * scale + scale - 1,
            y + row * scale + scale - 1,
            rgb,
          )
        }
      }
    }
  }
}

function drawTextCentered(
  ctx: DrawCtx,
  cx: number,
  y: number,
  text: string,
  rgb: Rgb,
  scale: number,
): void {
  drawText(ctx, cx - (textWidth(text) * scale) / 2, y, text, rgb, scale)
}

/** Stack each glyph of `text` vertically (reads top -> bottom) at x. Used for
 *  the y-axis label since the bitmap face has no rotated glyphs. */
function drawVerticalText(ctx: DrawCtx, x: number, yCenter: number, text: string, rgb: Rgb): void {
  const totalHeight = text.length * FONT_HEIGHT_PX
  const startY = Math.round(yCenter - totalHeight / 2)
  for (let i = 0; i < text.length; i += 1) {
    drawText(ctx, x, startY + i * FONT_HEIGHT_PX, text.charAt(i), rgb, 1)
  }
}

/** Longest y tick label, in glyphs. */
function maxTickChars(scale: YScale): number {
  let max = 1
  for (const tick of scale.ticks) {
    const label = formatTick(tick, scale.decimals)
    if (label.length > max) {
      max = label.length
    }
  }
  return max
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 }
const DARK_GRAY: Rgb = { r: 51, g: 51, b: 51 }
const GRID_GRAY: Rgb = { r: 226, g: 226, b: 226 }
const AXIS_GRAY: Rgb = { r: 110, g: 110, b: 110 }

function axisLabelText(label: string | undefined, unit: string | undefined): string | undefined {
  const parts: string[] = []
  if (label !== undefined && label.length > 0) {
    parts.push(label)
  }
  if (unit !== undefined && unit.length > 0) {
    parts.push(`(${unit})`)
  }
  return parts.length === 0 ? undefined : parts.join(' ')
}

export function rasterizeFigure(spec: FigureSpecSnapshot, scale: YScale): RasterResult {
  const width = spec.width
  const height = spec.height
  const ctx: DrawCtx = { w: width, h: height, data: new Uint8Array(width * height * 4) }

  // Opaque white background.
  fillRect(ctx, 0, 0, width - 1, height - 1, { r: 255, g: 255, b: 255 })

  const legend = spec.legend
  const legendVisible = legend?.visible ?? true
  const legendPosition = legend?.position ?? 'bottom'
  const legendTitle = legend?.title

  const legendTopItems = legendVisible && legendPosition === 'top'
  const legendTopTitle = legendTopItems && legendTitle !== undefined
  const legendBottomItems = legendVisible && legendPosition === 'bottom'
  const legendBottomTitle = legendBottomItems && legendTitle !== undefined

  // ── Reserved bands (pure numbers first, so the plot rect is final before
  //    any pixel is committed below it) ─────────────────────────────────────
  const titleScale = spec.title.length * ADVANCE_PX * 2 > width - 10 ? 1 : 2
  let topReserve = 4
  if (spec.title.length > 0) {
    topReserve += titleScale * FONT_HEIGHT_PX + 3
  }
  if (legendTopTitle) {
    topReserve += FONT_HEIGHT_PX + 2
  }
  if (legendTopItems) {
    topReserve += FONT_HEIGHT_PX + 3
  }

  const yLabelText = axisLabelText(spec.axes?.yLabel, spec.axes?.yUnit)
  const xAxisText = axisLabelText(spec.axes?.xLabel, spec.axes?.xUnit)
  const maxTick = maxTickChars(scale)
  const tickLabelW = maxTick * ADVANCE_PX

  const bottomReserve =
    4 +
    10 /* x category labels */ +
    (xAxisText !== undefined ? 11 : 0) +
    (legendBottomTitle ? 10 : 0) +
    (legendBottomItems ? 13 : 0)

  let plotTop = topReserve + 2
  let plotBottom = height - bottomReserve
  if (plotBottom - plotTop < 24) {
    // Extreme configuration: expand toward the canvas edges so the plot rect
    // always stays usable (deterministic clamp).
    plotTop = Math.min(plotTop, 2)
    plotBottom = Math.max(plotBottom, height - 2)
  }
  if (plotBottom <= plotTop) {
    plotBottom = plotTop + 24
  }
  const plotRight = width - 6
  const plotLeft = Math.min(
    8 + tickLabelW + (yLabelText !== undefined ? 4 : 0),
    Math.max(4, plotRight - 24),
  )
  const plotWidth = plotRight - plotLeft
  const plotHeight = plotBottom - plotTop

  const valueY = (value: number): number => {
    const ratio = scale.max === scale.min ? 0 : (value - scale.min) / (scale.max - scale.min)
    return plotBottom - ratio * plotHeight
  }

  // ── Title ────────────────────────────────────────────────────────────────
  let topCursor = 4
  if (spec.title.length > 0) {
    drawTextCentered(ctx, width / 2, topCursor, spec.title, DARK_GRAY, titleScale)
    topCursor += titleScale * FONT_HEIGHT_PX + 3
  }

  // ── Legend items helper (used for top & bottom rows) ─────────────────────
  const drawLegendItemsAt = (rowTop: number): void => {
    const swatchW = 9
    const gap = 12
    const itemTexts: string[] = []
    let total = 0
    for (const series of spec.series) {
      const text = series.unit === undefined ? series.name : `${series.name} (${series.unit})`
      itemTexts.push(text)
      total += swatchW + 3 + textWidth(text)
    }
    total += gap * Math.max(0, itemTexts.length - 1)
    let x = (width - total) / 2
    const y = rowTop + 1
    for (let i = 0; i < spec.series.length; i += 1) {
      const series = spec.series[i]
      const text = itemTexts[i]
      // defensive: itemTexts is pushed 1:1 from the same validated (dense)
      // spec.series array, so neither entry can be undefined here.
      /* v8 ignore start -- dense legend-item arrays */
      if (series === undefined || text === undefined) {
        continue // defensive: itemTexts mirrors spec.series 1:1
      }
      /* v8 ignore stop */
      const rgb = toRgb(series.color ?? '#000000')
      fillRect(ctx, x, y, x + swatchW - 1, y + FONT_HEIGHT_PX - 1, rgb)
      drawText(ctx, x + swatchW + 3, y, text, BLACK, 1)
      x += swatchW + 3 + textWidth(text) + gap
    }
  }

  // ── Top legend (heading then entries) ────────────────────────────────────
  if (legendTopTitle) {
    drawTextCentered(ctx, width / 2, topCursor, legendTitle, DARK_GRAY, 1)
    topCursor += FONT_HEIGHT_PX + 2
  }
  if (legendTopItems) {
    drawLegendItemsAt(topCursor)
  }

  // ── Vertical y-axis label in the left margin ─────────────────────────────
  if (yLabelText !== undefined) {
    drawVerticalText(ctx, 1, (plotTop + plotBottom) / 2, yLabelText, DARK_GRAY)
  }

  // ── Horizontal gridlines + y tick labels ─────────────────────────────────
  for (const tick of scale.ticks) {
    const y = valueY(tick)
    if (tick !== 0) {
      drawLine(ctx, plotLeft, y, plotRight, y, GRID_GRAY)
    }
    const label = formatTick(tick, scale.decimals)
    drawText(ctx, plotLeft - 3 - textWidth(label), y - FONT_HEIGHT_PX / 2, label, BLACK, 1)
  }

  // ── Category geometry ────────────────────────────────────────────────────
  const categories = spec.axes?.categories ?? []
  const n = categories.length
  const slot = n > 0 ? plotWidth / n : 0
  const slotCenter = (index: number): number => plotLeft + (index + 0.5) * slot
  const seriesCount = spec.series.length

  // Plot frame.
  drawLine(ctx, plotLeft, plotTop, plotRight, plotTop, AXIS_GRAY)
  drawLine(ctx, plotLeft, plotBottom, plotRight, plotBottom, AXIS_GRAY)
  drawLine(ctx, plotLeft, plotTop, plotLeft, plotBottom, AXIS_GRAY)
  drawLine(ctx, plotRight, plotTop, plotRight, plotBottom, AXIS_GRAY)

  // Zero axis when 0 is strictly inside the plot.
  const zeroY = valueY(0)
  if (zeroY > plotTop + 1 && zeroY < plotBottom - 1) {
    drawLine(ctx, plotLeft, zeroY, plotRight, zeroY, BLACK)
  }

  // ── Data ─────────────────────────────────────────────────────────────────
  if (spec.kind === 'bar') {
    const barTotal = Math.max(Math.min(slot * 0.8, Math.max(slot - 1, 1)), 1)
    const barWidth = barTotal / seriesCount
    for (let s = 0; s < seriesCount; s += 1) {
      const series = spec.series[s]
      if (series === undefined) {
        continue // defensive: loop bound is spec.series.length
      }
      const rgb = toRgb(series.color ?? '#000000')
      for (let i = 0; i < n; i += 1) {
        const value = series.values[i]
        if (value === undefined) {
          continue // defensive: validated finite values length n
        }
        const x0 = slotCenter(i) - barTotal / 2 + s * barWidth
        const y0 = valueY(Math.max(0, value))
        const y1 = valueY(Math.min(0, value))
        fillRect(ctx, x0 + 1, y0, x0 + barWidth - 1, y1, rgb)
      }
    }
  } else {
    for (let s = 0; s < seriesCount; s += 1) {
      const series = spec.series[s]
      if (series === undefined) {
        continue // defensive: loop bound is spec.series.length
      }
      const rgb = toRgb(series.color ?? '#000000')
      const dash = series.dash ?? 'solid'
      const marker = series.marker ?? 'none'
      for (let i = 1; i < n; i += 1) {
        const prev = series.values[i - 1]
        const current = series.values[i]
        if (prev === undefined || current === undefined) {
          continue // defensive: validated finite values length n
        }
        drawLine(
          ctx,
          slotCenter(i - 1),
          valueY(prev),
          slotCenter(i),
          valueY(current),
          rgb,
          dash,
        )
      }
      if (marker === 'circle') {
        for (let i = 0; i < n; i += 1) {
          const value = series.values[i]
          if (value === undefined) {
            continue
          }
          fillDisc(ctx, slotCenter(i), valueY(value), 2, rgb)
        }
      } else if (marker === 'square') {
        for (let i = 0; i < n; i += 1) {
          const value = series.values[i]
          if (value === undefined) {
            continue
          }
          const cy = valueY(value)
          fillRect(ctx, slotCenter(i) - 2, cy - 2, slotCenter(i) + 2, cy + 2, rgb)
        }
      }
    }
  }

  // ── x category labels + x-axis label/unit ────────────────────────────────
  let bottomCursor = plotBottom + 2
  for (let i = 0; i < n; i += 1) {
    const category = categories[i]
    if (category === undefined) {
      continue // defensive: category label exists for every plot slot
    }
    drawTextCentered(ctx, slotCenter(i), bottomCursor, category, DARK_GRAY, 1)
  }
  if (xAxisText !== undefined) {
    bottomCursor += FONT_HEIGHT_PX + 3
    drawTextCentered(ctx, width / 2, bottomCursor, xAxisText, DARK_GRAY, 1)
  }

  // ── Legend (bottom): heading then entries ────────────────────────────────
  if (legendBottomItems) {
    bottomCursor += FONT_HEIGHT_PX + 3
    if (legendBottomTitle) {
      drawTextCentered(ctx, width / 2, bottomCursor, legendTitle, DARK_GRAY, 1)
      bottomCursor += FONT_HEIGHT_PX + 2
    }
    drawLegendItemsAt(bottomCursor)
  }

  return { width, height, rgba: ctx.data }
}
