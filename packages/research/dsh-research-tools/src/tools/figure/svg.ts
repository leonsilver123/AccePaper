// @deepseek-ai/dsh-research-tools — T16 figure, deterministic SVG builder.
//
// Builds the SVG as a PURE string from validated tokens only. Safety rules
// enforced structurally:
//  - NO <script>, no on* event attributes, no foreignObject, no <a>, no
//    href/xlink, no external URLs, no javascript: — the builder never emits
//    any of those tokens;
//  - every dynamic text value is XML-escaped (and has already passed the
//    printable-ASCII validator);
//  - every dynamic colour value is a canonical '#rrggbb' string produced by
//    canonicalizeColor (never a raw/unvalidated token);
//  - every dynamic font-family token is validated to a safe charset before it
//    reaches an attribute.
// Content is data + rendering only (rule 7: no significance/conclusion text is
// ever emitted).

import type { FigureSpecSnapshot } from './adapter.ts'
import { computeYScale, formatTick, type YScale } from './scale.ts'

/** XML-escape a text/attribute value (& < > " '). */
export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** Safe number formatting for attributes (<= 2 decimals). */
function px(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return String(rounded)
}

/** Rough width estimate of a string in px for SVG margin math. */
function estimateTextWidth(text: string, fs: number): number {
  let sum = 0
  for (const ch of text) {
    sum += ch === ' ' ? fs * 0.34 : fs * 0.6
  }
  return sum
}

function allValues(spec: FigureSpecSnapshot): number[] {
  const values: number[] = []
  for (const series of spec.series) {
    for (const value of series.values) {
      values.push(value)
    }
  }
  return values
}

/** "label (unit)" composed from the optional axis label/unit parts. */
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

interface SvgLayout {
  plotLeft: number
  plotRight: number
  plotTop: number
  plotBottom: number
}

function computeLayout(spec: FigureSpecSnapshot, fs: number): SvgLayout {
  const width = spec.width
  const height = spec.height
  const scale = computeYScale(allValues(spec))
  let maxTickPx = fs * 0.6
  for (const tick of scale.ticks) {
    const label = formatTick(tick, scale.decimals)
    maxTickPx = Math.max(maxTickPx, estimateTextWidth(label, fs))
  }

  const legend = spec.legend
  const legendVisible = legend?.visible ?? true
  const legendPosition = legend?.position ?? 'bottom'
  const legendTitle = legend?.title
  const hasLegendTitle = legendVisible && legendTitle !== undefined
  const legendRowH = legendVisible ? (hasLegendTitle ? fs + 6 : 0) + fs + 12 : 0

  const topReserve =
    10 +
    (spec.title.length > 0 ? fs + 12 : 0) +
    (legendVisible && legendPosition === 'top' ? legendRowH : 0)

  const xLabelPresent =
    (spec.axes?.xLabel !== undefined && spec.axes.xLabel.length > 0) ||
    (spec.axes?.xUnit !== undefined && spec.axes.xUnit.length > 0)
  const bottomReserve =
    8 +
    (fs + 10) + // x category labels
    (xLabelPresent ? fs + 10 : 0) +
    (legendVisible && legendPosition === 'bottom' ? legendRowH : 0)

  const plotLeft = 12 + maxTickPx
  const plotRight = width - 10

  let plotTop = topReserve
  let plotBottom = height - bottomReserve
  if (plotBottom - plotTop < 24) {
    // Extreme font/label configuration: expand toward the canvas edges so the
    // plot rect always stays usable (deterministic clamp).
    plotTop = Math.min(plotTop, 2)
    plotBottom = Math.max(plotBottom, height - 2)
  }
  if (plotBottom <= plotTop) {
    plotBottom = plotTop + 24
  }
  return { plotLeft, plotRight, plotTop, plotBottom }
}

export function buildSvg(spec: FigureSpecSnapshot): string {
  const width = spec.width
  const height = spec.height
  const fs = spec.tokens.fontSize ?? 13
  const fontFamily = spec.tokens.fontFamily ?? 'sans-serif'
  const layout = computeLayout(spec, fs)
  const { plotLeft, plotRight, plotTop, plotBottom } = layout
  const plotH = plotBottom - plotTop

  const scale: YScale = computeYScale(allValues(spec))
  const valueY = (value: number): number => {
    // defensive: the y scale comes from computeYScale, whose collapsed-range
    // fallback is 0..1, so scale.max === scale.min can never hold here.
    /* v8 ignore start -- collapsed-range guard is unreachable */
    const ratio = scale.max === scale.min ? 0 : (value - scale.min) / (scale.max - scale.min)
    /* v8 ignore stop */
    return plotBottom - ratio * plotH
  }

  const categories = spec.axes?.categories ?? []
  const n = categories.length
  const slot = n > 0 ? (plotRight - plotLeft) / n : 0
  const slotCenter = (index: number): number => plotLeft + (index + 0.5) * slot
  const seriesCount = spec.series.length

  const legend = spec.legend
  const legendVisible = legend?.visible ?? true
  const legendPosition = legend?.position ?? 'bottom'
  const legendTitle = legend?.title

  const parts: string[] = []
  parts.push('<svg')
  parts.push(' xmlns="http://www.w3.org/2000/svg"')
  parts.push(` width="${width}"`)
  parts.push(` height="${height}"`)
  parts.push(` viewBox="0 0 ${width} ${height}"`)
  parts.push(' role="img"')
  parts.push('>')
  parts.push('<title>')
  parts.push(escapeXml(spec.title))
  parts.push('</title>')
  parts.push(
    `<desc>Figure of ${escapeXml(spec.title)}: ${seriesCount} series over ${n} categories. ` +
      'Data and rendering only - no statistical claims.</desc>',
  )
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`)

  // ── Title ────────────────────────────────────────────────────────────────
  if (spec.title.length > 0) {
    parts.push(
      `<text x="${px(width / 2)}" y="${px(10 + fs)}" text-anchor="middle" ` +
        `font-family="${fontFamily}" font-size="${px(fs)}" font-weight="600" fill="#1f1f1f">` +
        escapeXml(spec.title) +
        '</text>',
    )
  }

  // ── Legend group (shared by top & bottom placement) ──────────────────────
  const legendItems = spec.series.map(series => ({
    text: series.unit === undefined ? series.name : `${series.name} (${series.unit})`,
    color: series.color ?? '#000000',
  }))
  const drawLegendGroup = (yBase: number): void => {
    const itemWidths = legendItems.map(item => 20 + estimateTextWidth(item.text, fs))
    const gap = 16
    const total = itemWidths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, legendItems.length - 1)
    let x = (width - total) / 2
    const swatchY = yBase - fs * 0.7
    for (let i = 0; i < legendItems.length; i += 1) {
      const item = legendItems[i]
      const itemWidth = itemWidths[i]
      // defensive: legendItems and itemWidths are dense arrays mapped 1:1 from
      // the validated series, so neither entry can ever be undefined here.
      /* v8 ignore start -- dense legend-item arrays */
      if (item === undefined || itemWidth === undefined) {
        continue // defensive: itemWidths is built 1:1 from legendItems
      }
      /* v8 ignore stop */
      parts.push(`<rect x="${px(x)}" y="${px(swatchY)}" width="12" height="12" fill="${item.color}"/>`)
      parts.push(
        `<text x="${px(x + 18)}" y="${px(yBase)}" font-family="${fontFamily}" ` +
          `font-size="${px(fs)}" fill="#1f1f1f">${escapeXml(item.text)}</text>`,
      )
      x += itemWidth + gap
    }
  }

  if (legendVisible && legendPosition === 'top') {
    if (legendTitle !== undefined) {
      parts.push(
        `<text x="${px(width / 2)}" y="${px(10 + (spec.title.length > 0 ? fs + 12 : 0) + fs * 0.8)}" ` +
          `text-anchor="middle" font-family="${fontFamily}" font-size="${px(fs)}" fill="#1f1f1f">` +
          escapeXml(legendTitle) +
          '</text>',
      )
    }
    const legendBaseY =
      10 +
      (spec.title.length > 0 ? fs + 12 : 0) +
      (legendTitle !== undefined ? fs + 6 : 0) +
      fs * 0.8
    drawLegendGroup(legendBaseY)
  }

  // ── Plot ─────────────────────────────────────────────────────────────────
  parts.push('<g>')
  for (const tick of scale.ticks) {
    const y = valueY(tick)
    if (tick !== 0) {
      parts.push(
        `<line x1="${px(plotLeft)}" y1="${px(y)}" x2="${px(plotRight)}" y2="${px(y)}" stroke="#e2e2e2"/>`,
      )
    }
    parts.push(
      `<text x="${px(plotLeft - 6)}" y="${px(y + fs * 0.35)}" text-anchor="end" ` +
        `font-family="${fontFamily}" font-size="${px(fs)}" fill="#333333">` +
        escapeXml(formatTick(tick, scale.decimals)) +
        '</text>',
    )
  }

  for (let i = 1; i < n; i += 1) {
    const x = plotLeft + i * slot
    parts.push(
      `<line x1="${px(x)}" y1="${px(plotTop)}" x2="${px(x)}" y2="${px(plotBottom)}" stroke="#f2f2f2"/>`,
    )
  }

  // Plot frame.
  parts.push(`<line x1="${px(plotLeft)}" y1="${px(plotTop)}" x2="${px(plotRight)}" y2="${px(plotTop)}" stroke="#666666"/>`)
  parts.push(`<line x1="${px(plotLeft)}" y1="${px(plotBottom)}" x2="${px(plotRight)}" y2="${px(plotBottom)}" stroke="#666666"/>`)
  parts.push(`<line x1="${px(plotLeft)}" y1="${px(plotTop)}" x2="${px(plotLeft)}" y2="${px(plotBottom)}" stroke="#666666"/>`)
  parts.push(`<line x1="${px(plotRight)}" y1="${px(plotTop)}" x2="${px(plotRight)}" y2="${px(plotBottom)}" stroke="#666666"/>`)

  const zeroY = valueY(0)
  if (zeroY > plotTop + 1 && zeroY < plotBottom - 1) {
    parts.push(`<line x1="${px(plotLeft)}" y1="${px(zeroY)}" x2="${px(plotRight)}" y2="${px(zeroY)}" stroke="#000000"/>`)
  }

  // Data: grouped bars or connected lines.
  if (spec.kind === 'bar') {
    const barTotal = Math.min(slot * 0.8, Math.max(slot - 2, 1))
    const barWidth = barTotal / seriesCount
    for (let s = 0; s < seriesCount; s += 1) {
      const series = spec.series[s]
      // defensive: spec.series is validated dense — allValues iterates it
      // directly with for..of before any hole could be dereferenced — so a
      // series entry can never be undefined at this loop.
      /* v8 ignore start -- dense spec.series invariant */
      if (series === undefined) {
        continue // defensive: loop bound is spec.series.length
      }
      /* v8 ignore stop */
      const color = series.color ?? '#000000'
      for (let i = 0; i < n; i += 1) {
        const value = series.values[i]
        if (value === undefined) {
          continue // defensive: validated finite values length n
        }
        const x0 = slotCenter(i) - barTotal / 2 + s * barWidth
        const y0 = valueY(Math.max(0, value))
        const y1 = valueY(Math.min(0, value))
        parts.push(
          `<rect x="${px(x0 + 1)}" y="${px(y0)}" width="${px(Math.max(barWidth - 2, 1))}" ` +
            `height="${px(Math.max(y1 - y0, 0))}" fill="${color}"/>`,
        )
      }
    }
  } else {
    for (let s = 0; s < seriesCount; s += 1) {
      const series = spec.series[s]
      // defensive: spec.series is validated dense — allValues iterates it
      // directly with for..of before any hole could be dereferenced — so a
      // series entry can never be undefined at this loop.
      /* v8 ignore start -- dense spec.series invariant */
      if (series === undefined) {
        continue // defensive: loop bound is spec.series.length
      }
      /* v8 ignore stop */
      const color = series.color ?? '#000000'
      const dash = series.dash ?? 'solid'
      const marker = series.marker ?? 'none'
      const pointPairs = series.values.map((value, i) => ({ x: slotCenter(i), y: valueY(value) }))
      if (pointPairs.length > 1) {
        const points = pointPairs.map(point => `${px(point.x)},${px(point.y)}`).join(' ')
        parts.push(
          `<polyline points="${points}" fill="none" stroke="${color}" ` +
            `stroke-width="2"${dash === 'dashed' ? ' stroke-dasharray="4 3"' : ''}/>`,
        )
      }
      for (const point of pointPairs) {
        if (marker === 'circle') {
          parts.push(`<circle cx="${px(point.x)}" cy="${px(point.y)}" r="3" fill="${color}"/>`)
        } else if (marker === 'square') {
          parts.push(
            `<rect x="${px(point.x - 2.5)}" y="${px(point.y - 2.5)}" width="5" height="5" fill="${color}"/>`,
          )
        }
      }
    }
  }
  parts.push('</g>')

  // ── x category labels + x axis label/unit ────────────────────────────────
  for (let i = 0; i < n; i += 1) {
    const category = categories[i]
    if (category === undefined) {
      continue // defensive: category label exists for every plot slot
    }
    parts.push(
      `<text x="${px(slotCenter(i))}" y="${px(plotBottom + fs + 2)}" text-anchor="middle" ` +
        `font-family="${fontFamily}" font-size="${px(fs)}" fill="#333333">` +
        escapeXml(category) +
        '</text>',
    )
  }

  const xAxisText = axisLabelText(spec.axes?.xLabel, spec.axes?.xUnit)
  if (xAxisText !== undefined) {
    parts.push(
      `<text x="${px(width / 2)}" y="${px(plotBottom + fs * 2 + 8)}" text-anchor="middle" ` +
        `font-family="${fontFamily}" font-size="${px(fs)}" fill="#333333">` +
        escapeXml(xAxisText) +
        '</text>',
    )
  }

  // ── y axis label/unit (rotated 90deg, left margin) ───────────────────────
  const yAxisText = axisLabelText(spec.axes?.yLabel, spec.axes?.yUnit)
  if (yAxisText !== undefined) {
    const pivotX = Math.max(6, plotLeft - 6 - fs * 0.6)
    const pivotY = (plotTop + plotBottom) / 2
    parts.push(
      `<text x="${px(pivotY)}" y="${px(pivotX)}" text-anchor="middle" ` +
        `transform="rotate(-90 ${px(pivotY)} ${px(pivotX)})" ` +
        `font-family="${fontFamily}" font-size="${px(fs)}" fill="#333333">` +
        escapeXml(yAxisText) +
        '</text>',
    )
  }

  // ── Legend (bottom) ──────────────────────────────────────────────────────
  if (legendVisible && legendPosition === 'bottom') {
    let baseY = height - 8 - (legendTitle !== undefined ? fs + 4 : 0)
    if (legendTitle !== undefined) {
      parts.push(
        `<text x="${px(width / 2)}" y="${px(baseY)}" text-anchor="middle" ` +
          `font-family="${fontFamily}" font-size="${px(fs)}" fill="#1f1f1f">` +
          escapeXml(legendTitle) +
          '</text>',
      )
      baseY -= fs + 4
    }
    drawLegendGroup(baseY - fs * 0.3)
  }

  parts.push('</svg>')
  return parts.join('')
}
