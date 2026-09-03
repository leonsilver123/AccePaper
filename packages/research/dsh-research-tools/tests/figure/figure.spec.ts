// T16 figure (绘图 SVG+PNG) — vitest spec.
//
// Covers the frozen T16 design contract:
//   - strict spec validation incl. explicit NaN/Infinity/undefined rejection;
//   - SVG is SAFE (no script/javascript:/on* handlers/external hrefs) and
//     well-formed, including when hostile printable-ASCII text is embedded;
//   - PNG bytes are a REAL encoded PNG — signature / IHDR / non-empty IDAT
//     (zlib-inflatable) / IEND / dimensions all verified against the bytes;
//   - determinism: same spec + timestamp -> byte-identical SVG + PNG across
//     calls, and artifact.spec round-trips to an identical re-render;
//   - pure allowlist/traversal path guard;
//   - meta envelope + deep-frozen artifact;
//   - error transparency: adapter throws propagate as-is; structurally
//     invalid adapter output is a DSH_FIGURE_INVALID_ADAPTER_OUTPUT fault;
//   - defensive branches are driven directly (unit-level) so the merge gate's
//     per-file 100% is reachable from real tests.

import { describe, expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import {
  DEFAULT_FIGURE_DEPS,
  FIGURE_ERROR_PREFIX,
  FIGURE_TOOL_ID,
  FIGURE_TOOL_VERSION,
  FigureError,
  FigurePathError,
  canonicalizeColor,
  escapeXml,
  formatTick,
  guardFigureOutputPath,
  parseColor,
  renderFigure,
  renderFigureWithDeps,
  resolveFigureOutputPath,
  computeYScale,
} from '../../src/tools/figure/index.ts'
import type {
  FigurePngAdapter,
  FigureSpec,
  FigureSpecSnapshot,
} from '../../src/tools/figure/index.ts'
import { encodePng, inspectPng, PNG_SIGNATURE_HEX } from '../../src/tools/figure/png.ts'
import { rasterizeFigure } from '../../src/tools/figure/raster.ts'
import { buildSvg } from '../../src/tools/figure/svg.ts'
import { valueToPixelY, type YScale } from '../../src/tools/figure/scale.ts'

const TS = 1_700_000_000_000

// ── Fixture helpers ──────────────────────────────────────────────────────────

const BASE_SPEC: FigureSpec = {
  kind: 'bar',
  title: 'Latency by stage',
  width: 640,
  height: 400,
  series: [
    { name: 'p50', unit: 'ms', values: [12.5, 18.2, 9.1] },
    { name: 'p99', unit: 'ms', values: [41, 66, 28] },
  ],
  axes: {
    xLabel: 'Stage',
    categories: ['encode', 'transmit', 'decode'],
    yLabel: 'Latency',
    yUnit: 'ms',
  },
  legend: { position: 'top', title: 'Legend' },
  tokens: { palette: ['#1f77b4', '#ff7f0e'], fontFamily: 'sans-serif', fontSize: 13 },
  seed: 7,
}

/** Builder: full replacement of one top-level field. */
function specWith(over: Partial<FigureSpec>): FigureSpec {
  return { ...BASE_SPEC, ...over }
}

/** Run fn, return the FigureError code; 'NO_THROW' if none; 'RAW:' + message
 *  when a non-FigureError escapes (used to prove as-is propagation). */
function outcome(fn: () => unknown): string {
  try {
    fn()
    return 'NO_THROW'
  } catch (e) {
    if (e instanceof FigureError) {
      return e.code
    }
    return `RAW:${(e as Error).message}`
  }
}

/** Element-wise byte equality for two Uint8Arrays. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

// ── Minimal XML well-formedness check (dependency-free) ─────────────────────
/** Returns true when every tag balances and no stray '<'/'&' remains outside
 *  tags. Text content may legitimately carry escaped entities (&lt; &amp; ...);
 *  a raw '<' outside a tag or an '&' that is not a known entity both fail.
 *  Good enough to gate the fixed builder output without an XML parser. */
function xmlWellFormed(xml: string): boolean {
  if (!xml.startsWith('<svg')) {
    return false
  }
  const tagRe = /<\/?([A-Za-z][A-Za-z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/gu
  const stack: string[] = []
  let match: RegExpExecArray | null
  tagRe.lastIndex = 0
  while ((match = tagRe.exec(xml)) !== null) {
    const full = match[0]
    const name = match[1]
    const closing = full.startsWith('</')
    const selfClosing = match[3] === '/'
    if (closing) {
      if (stack.pop() !== name) {
        return false
      }
    } else if (!selfClosing) {
      stack.push(name)
    }
  }
  const body = xml.replace(tagRe, '')
  if (body.includes('<')) {
    return false
  }
  // Consume the five known entities; any leftover '&' is an escaping bug.
  if (body.replace(/&(?:amp|lt|gt|quot|apos);/gu, '').includes('&')) {
    return false
  }
  return stack.length === 0 && xml.trimEnd().endsWith('</svg>')
}

// ── ok path: artifact shape ─────────────────────────────────────────────────

describe('ok path — real artifact for bar + line figures', () => {
  it('renders a bar figure with meta / spec echo / svg / png views', () => {
    const artifact = renderFigure(BASE_SPEC, TS)
    expect(artifact.meta.toolId).toBe(FIGURE_TOOL_ID)
    expect(artifact.meta.toolId).toBe('figure')
    expect(artifact.meta.version).toBe(FIGURE_TOOL_VERSION)
    expect(artifact.meta.producedAt).toBe(TS)

    expect(artifact.spec.kind).toBe('bar')
    expect(artifact.spec.title).toBe('Latency by stage')
    expect(artifact.spec.series).toHaveLength(2)
    expect(artifact.spec.axes?.categories).toEqual(['encode', 'transmit', 'decode'])

    expect(artifact.svg.width).toBe(640)
    expect(artifact.svg.height).toBe(400)
    expect(artifact.svg.content.startsWith('<svg')).toBe(true)
    expect(artifact.svg.content.endsWith('</svg>')).toBe(true)
    expect(artifact.svg.content).toContain('Latency by stage')
    expect(artifact.svg.byteLength).toBeGreaterThan(0)

    expect(artifact.png.width).toBe(640)
    expect(artifact.png.height).toBe(400)
    expect(artifact.png.bytes).toBeInstanceOf(Uint8Array)
    expect(artifact.png.bytes.length).toBeGreaterThan(0)
    expect(artifact.png.byteLength).toBe(artifact.png.bytes.length)
    expect(artifact.png.base64.length).toBeGreaterThan(0)

    expect(artifact.config.kind).toBe('bar')
    expect(artifact.config.seed).toBe(7)
    expect(artifact.config.yScale.ticks.length).toBeGreaterThan(1)
  })

  it('renders a line figure with dashed strokes and markers', () => {
    const artifact = renderFigure(
      specWith({
        kind: 'line',
        title: 'Trends',
        series: [
          { name: 'alpha', values: [1, 3, 2, 5], dash: 'dashed', marker: 'circle' },
          { name: 'beta', values: [0.5, 2, 4, 3], marker: 'square', color: '#ff0000' },
        ],
        axes: { categories: ['q1', 'q2', 'q3', 'q4'] },
        legend: { position: 'bottom' },
      }),
      TS,
    )
    expect(artifact.spec.kind).toBe('line')
    expect(artifact.svg.content).toContain('<polyline')
    expect(artifact.svg.content).toContain('stroke-dasharray')
    expect(artifact.svg.content).toContain('<circle')
    expect(artifact.svg.content).toContain('<rect') // square markers + legend
    expect(xmlWellFormed(artifact.svg.content)).toBe(true)
  })

  it('resolves a deterministic palette rotation from the seed', () => {
    const twoSeries = specWith({ seed: 7 })
    const art = renderFigure(twoSeries, TS)
    // offset = 7 % 2 = 1 -> series[0] <- palette[1], series[1] <- palette[0]
    expect(art.spec.series[0].color).toBe('#ff7f0e')
    expect(art.spec.series[1].color).toBe('#1f77b4')
  })

  it('derives index categories when none are provided and echoes them', () => {
    const art = renderFigure(
      specWith({
        series: [{ name: 'only', values: [4, 8, 15, 16, 23, 42] }],
        // Deliberately drop BASE's 3-entry categories so the derive path runs.
        axes: { ...BASE_SPEC.axes, categories: [] },
      }),
      TS,
    )
    expect(art.spec.axes?.categories).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('handles negative values (bars crossing zero) and all-zero data', () => {
    const negative = renderFigure(
      specWith({
        kind: 'line',
        series: [{ name: 'delta', values: [-3, 0, 4, -1] }],
        // 4 points vs BASE's 3 categories -> drop categories (derive path).
        axes: { ...BASE_SPEC.axes, categories: [] },
      }),
      TS,
    )
    expect(negative.svg.content).toContain('<polyline')
    expect(negative.spec.series[0].values).toEqual([-3, 0, 4, -1])

    const zeros = renderFigure(
      specWith({ series: [{ name: 'empty', values: [0, 0, 0] }], legend: { visible: false } }),
      TS,
    )
    expect(zeros.spec.series[0].values).toEqual([0, 0, 0])
    expect(xmlWellFormed(zeros.svg.content)).toBe(true)
  })
})

// ── Input validation: NaN / Infinity / undefined / structure ────────────────

describe('spec validation — every malformed input throws FigureError', () => {
  it('rejects a null / non-object spec', () => {
    expect(outcome(() => renderFigure(null as unknown as FigureSpec, TS))).toBe('DSH_FIGURE_INVALID_SPEC')
    expect(outcome(() => renderFigure(42 as unknown as FigureSpec, TS))).toBe('DSH_FIGURE_INVALID_SPEC')
  })

  it('rejects an invalid kind', () => {
    expect(
      outcome(() => renderFigure(specWith({ kind: 'pie' as FigureSpec['kind'] }), TS)),
    ).toBe('DSH_FIGURE_INVALID_KIND')
    // Non-string kinds also reach the kind guard (serializable and non-serializable).
    expect(outcome(() => renderFigure(specWith({ kind: 7 as never }), TS))).toBe(
      'DSH_FIGURE_INVALID_KIND',
    )
    expect(outcome(() => renderFigure(specWith({ kind: Symbol('pie') as never }), TS))).toBe(
      'DSH_FIGURE_INVALID_KIND',
    )
  })

  it('rejects missing / empty / overlong / non-ASCII titles', () => {
    expect(outcome(() => renderFigure(specWith({ title: '' }), TS))).toBe(
      'DSH_FIGURE_INVALID_TITLE',
    )
    expect(outcome(() => renderFigure(specWith({ title: '   ' }), TS))).toBe(
      'DSH_FIGURE_INVALID_TITLE',
    )
    expect(outcome(() => renderFigure(specWith({ title: '图' }), TS))).toBe('DSH_FIGURE_INVALID_TITLE')
    expect(
      outcome(() => renderFigure(specWith({ title: 'x'.repeat(201) }), TS)),
    ).toBe('DSH_FIGURE_INVALID_TITLE')
    const missing = { ...BASE_SPEC }
    delete (missing as { title?: string }).title
    expect(outcome(() => renderFigure(missing as FigureSpec, TS))).toBe('DSH_FIGURE_INVALID_TITLE')
  })

  it('rejects NaN / Infinity / undefined / fractional / out-of-range canvas sizes', () => {
    for (const [key, value] of [
      ['width', Number.NaN],
      ['width', Number.POSITIVE_INFINITY],
      ['width', undefined],
      ['height', Number.NEGATIVE_INFINITY],
      ['width', '600'],
      ['height', 10.5],
      ['width', 100],
      ['height', 9000],
    ] as const) {
      expect(outcome(() => renderFigure(specWith({ [key]: value }), TS))).toMatch(
        /^DSH_FIGURE_/,
      )
    }
    expect(
      outcome(() => renderFigure(specWith({ width: Number.NaN }), TS)),
    ).toBe('DSH_FIGURE_NON_FINITE_NUMERIC')
    expect(
      outcome(() => renderFigure(specWith({ height: 1.5 }), TS)),
    ).toBe('DSH_FIGURE_INVALID_CANVAS')
  })

  it('rejects invalid series arrays', () => {
    expect(outcome(() => renderFigure(specWith({ series: [] }), TS))).toBe('DSH_FIGURE_INVALID_SERIES')
    expect(
      outcome(() => renderFigure(specWith({ series: [undefined as never] }), TS)),
    ).toBe('DSH_FIGURE_INVALID_SERIES')
    const nine = Array.from({ length: 9 }, () => BASE_SPEC.series[0])
    expect(outcome(() => renderFigure(specWith({ series: nine }), TS))).toBe('DSH_FIGURE_INVALID_SERIES')
  })

  it('rejects NaN / Infinity / undefined / non-number / huge values in series data', () => {
    const badValues: Array<Array<number>> = [
      [1, Number.NaN],
      [Number.POSITIVE_INFINITY],
      [Number.NEGATIVE_INFINITY],
      [undefined as unknown as number],
      ['5' as unknown as number],
      [1e13],
    ]
    for (const values of badValues) {
      const code = outcome(() =>
        renderFigure(specWith({ series: [{ name: 's', values }] }), TS),
      )
      if (values[0] === 1e13) {
        expect(code).toBe('DSH_FIGURE_VALUE_OUT_OF_RANGE')
      } else {
        expect(code).toBe('DSH_FIGURE_NON_FINITE_NUMERIC')
      }
    }
    // Sparse array hole reads as undefined -> NON_FINITE.
    const sparse = [1, , 3] as number[]
    expect(
      outcome(() => renderFigure(specWith({ series: [{ name: 's', values: sparse }] }), TS)),
    ).toBe('DSH_FIGURE_NON_FINITE_NUMERIC')
  })

  it('rejects empty / overlong / length-mismatched series values', () => {
    expect(
      outcome(() => renderFigure(specWith({ series: [{ name: 's', values: [] }] }), TS)),
    ).toBe('DSH_FIGURE_INVALID_SERIES')
    expect(
      outcome(() =>
        renderFigure(
          specWith({ series: [{ name: 's', values: Array.from({ length: 65 }, () => 1) }] }),
          TS,
        ),
      ),
    ).toBe('DSH_FIGURE_INVALID_SERIES')
    expect(
      outcome(() =>
        renderFigure(
          specWith({
            series: [
              { name: 'a', values: [1, 2, 3] },
              { name: 'b', values: [1, 2] },
            ],
          }),
          TS,
        ),
      ),
    ).toBe('DSH_FIGURE_INVALID_SERIES')
  })

  it('rejects invalid series name / unit / dash / marker', () => {
    expect(
      outcome(() => renderFigure(specWith({ series: [{ name: ' ', values: [1] }] }), TS)),
    ).toBe('DSH_FIGURE_INVALID_SERIES')
    expect(
      outcome(() => renderFigure(specWith({ series: [{ name: 's', unit: 'Ω', values: [1] }] }), TS)),
    ).toBe('DSH_FIGURE_INVALID_TEXT')
    expect(
      outcome(() =>
        renderFigure(
          specWith({ series: [{ name: 's', values: [1], dash: 'dot' as never }] }),
          TS,
        ),
      ),
    ).toBe('DSH_FIGURE_INVALID_SERIES')
    expect(
      outcome(() =>
        renderFigure(
          specWith({ series: [{ name: 's', values: [1], marker: 'star' as never }] }),
          TS,
        ),
      ),
    ).toBe('DSH_FIGURE_INVALID_SERIES')
    expect(
      outcome(() =>
        renderFigure(specWith({ series: [{ name: 's', values: [1], color: '#ggg' }] }), TS),
      ),
    ).toBe('DSH_FIGURE_INVALID_COLOR_TOKEN')
  })

  it('rejects malformed axes and category lists', () => {
    expect(
      outcome(() => renderFigure(specWith({ axes: null as never }), TS)),
    ).toBe('DSH_FIGURE_INVALID_AXES')
    expect(
      outcome(() =>
        renderFigure(
          specWith({ axes: { categories: ['a', 'b'] } }),
          TS,
        ),
      ),
    ).toBe('DSH_FIGURE_INVALID_AXES')
    expect(
      outcome(() =>
        renderFigure(
          specWith({
            axes: { categories: ['a', '  ', 'c'] },
          }),
          TS,
        ),
      ),
    ).toBe('DSH_FIGURE_INVALID_AXES')
    expect(
      outcome(() =>
        renderFigure(
          specWith({ axes: { categories: ['a', 'b', '图'] } }),
          TS,
        ),
      ),
    ).toBe('DSH_FIGURE_INVALID_TEXT')
    expect(
      outcome(() =>
        renderFigure(
          specWith({ axes: { yUnit: 'α' } }),
          TS,
        ),
      ),
    ).toBe('DSH_FIGURE_INVALID_TEXT')
  })

  it('rejects invalid token bundles', () => {
    expect(
      outcome(() => renderFigure(specWith({ tokens: undefined as never }), TS)),
    ).toBe('DSH_FIGURE_INVALID_TOKENS')
    expect(
      outcome(() => renderFigure(specWith({ tokens: { palette: [] } }), TS)),
    ).toBe('DSH_FIGURE_INVALID_TOKENS')
    expect(
      outcome(() => renderFigure(specWith({ tokens: { palette: ['rgb(1,2,3)'] } }), TS)),
    ).toBe('DSH_FIGURE_INVALID_COLOR_TOKEN')
    expect(
      outcome(() => renderFigure(specWith({ tokens: { palette: ['#1f77b4'] } }), TS)),
    ).toBe('NO_THROW')
    const longPalette = Array.from({ length: 33 }, () => '#123456')
    expect(
      outcome(() => renderFigure(specWith({ tokens: { palette: longPalette } }), TS)),
    ).toBe('DSH_FIGURE_INVALID_TOKENS')
    expect(
      outcome(() =>
        renderFigure(specWith({ tokens: { palette: ['#123456'], fontFamily: 'a;b' } }), TS),
      ),
    ).toBe('DSH_FIGURE_INVALID_TOKENS')
    expect(
      outcome(() =>
        renderFigure(specWith({ tokens: { palette: ['#123456'], fontSize: 3 } }), TS),
      ),
    ).toBe('DSH_FIGURE_INVALID_TOKENS')
    expect(
      outcome(() =>
        renderFigure(specWith({ tokens: { palette: ['#123456'], fontSize: Number.NaN } }), TS),
      ),
    ).toBe('DSH_FIGURE_NON_FINITE_NUMERIC')
  })

  it('rejects invalid legend fields', () => {
    expect(
      outcome(() => renderFigure(specWith({ legend: 'top' as never }), TS)),
    ).toBe('DSH_FIGURE_INVALID_LEGEND')
    expect(
      outcome(() => renderFigure(specWith({ legend: { visible: 1 as never } }), TS)),
    ).toBe('DSH_FIGURE_INVALID_LEGEND')
    expect(
      outcome(() => renderFigure(specWith({ legend: { position: 'left' as never } }), TS)),
    ).toBe('DSH_FIGURE_INVALID_LEGEND')
    expect(
      outcome(() => renderFigure(specWith({ legend: { title: '图例' } }), TS)),
    ).toBe('DSH_FIGURE_INVALID_TEXT')
  })

  it('rejects invalid seeds', () => {
    expect(outcome(() => renderFigure(specWith({ seed: Number.NaN }), TS))).toBe(
      'DSH_FIGURE_NON_FINITE_NUMERIC',
    )
    expect(outcome(() => renderFigure(specWith({ seed: 1.5 }), TS))).toBe('DSH_FIGURE_INVALID_SEED')
  })

  it('rejects an invalid timestamp and missing deps', () => {
    expect(outcome(() => renderFigure(BASE_SPEC, Number.NaN))).toBe('DSH_FIGURE_INVALID_TIMESTAMP')
    expect(outcome(() => renderFigure(BASE_SPEC, -1))).toBe('DSH_FIGURE_INVALID_TIMESTAMP')
    expect(outcome(() => renderFigureWithDeps(BASE_SPEC, null as never, TS))).toBe(
      'DSH_FIGURE_MISSING_DEPS',
    )
    expect(outcome(() => renderFigureWithDeps(BASE_SPEC, {} as never, TS))).toBe(
      'DSH_FIGURE_MISSING_DEPS',
    )
    expect(outcome(() => renderFigureWithDeps(BASE_SPEC, { pngAdapter: {} } as never, TS))).toBe(
      'DSH_FIGURE_MISSING_DEPS',
    )
  })

  it('every error carries the DSH_FIGURE_ prefix', () => {
    const code = outcome(() =>
      renderFigure(specWith({ series: [{ name: 's', values: [Number.NaN] }] }), TS),
    )
    expect(code.startsWith(FIGURE_ERROR_PREFIX)).toBe(true)
    expect(code).toBe('DSH_FIGURE_NON_FINITE_NUMERIC')
    const err = new FigureError('DSH_FIGURE_INVALID_SPEC', 'x')
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('DSH_FIGURE_INVALID_SPEC')
    expect(err.message).toContain('DSH_FIGURE_INVALID_SPEC')
  })
})

// ── SVG safety + well-formedness ─────────────────────────────────────────────

describe('SVG safety & well-formedness', () => {
  it('never emits script / event handlers / external refs / javascript: URLs', () => {
    const artifact = renderFigure(BASE_SPEC, TS)
    const svg = artifact.svg.content
    expect(svg).not.toMatch(/script/iu)
    expect(svg).not.toMatch(/javascript\s*:/iu)
    expect(svg).not.toMatch(/\shref=/iu)
    expect(svg).not.toMatch(/\bxlink:/iu)
    expect(svg).not.toMatch(/\son[a-z]+\s*=/iu)
    expect(svg).not.toMatch(/<foreignObject/iu)
    expect(svg).not.toMatch(/<image/iu)
    expect(svg).not.toMatch(/https:\/\//iu) // no TLS-external refs at all
    expect(svg).toContain('http://www.w3.org/2000/svg')
    // Count of any http: prefix is exactly the xmlns namespace URI.
    expect(svg.match(/http:/gu)?.length).toBe(1)
  })

  it('escapes hostile printable-ASCII text so markup cannot be injected', () => {
    const hostile: FigureSpec = {
      ...BASE_SPEC,
      title: "<script>alert('x')</script>",
      axes: {
        xLabel: '"><img src=x onerror=alert(1)>',
        categories: ['</text><script>', 'b', 'c'],
      },
    }
    const svg = renderFigure(hostile, TS).svg.content
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).not.toContain('<img')
    // The hostile payload's "onerror=" survives escaping only as INERT text;
    // the real guarantee is that no emitted element tag carries an on* handler.
    expect(svg).not.toMatch(/<[A-Za-z][A-Za-z0-9-]*[^>]*\s[oO][nN][A-Za-z]+\s*=/u)
    expect(xmlWellFormed(svg)).toBe(true)
    // escapeXml round-trips the five entities exactly once.
    expect(escapeXml("a&b<c>d\"e'f")).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;f')
  })

  it('emits well-formed markup for every geometry/label configuration', () => {
    const samples: FigureSpec[] = [
      BASE_SPEC,
      specWith({ kind: 'line', series: [{ name: 's', values: [1, 2, 3], dash: 'dashed', marker: 'circle' }] }),
      specWith({
        kind: 'line',
        series: [{ name: 's', values: [1, 2, 3], marker: 'square' }],
        legend: { visible: false },
      }),
      specWith({
        series: [{ name: 's', values: [0, 0] }],
        title: 'Flat',
        axes: { ...BASE_SPEC.axes, categories: [] },
        legend: { position: 'bottom', title: 'L' },
      }),
      specWith({
        kind: 'bar',
        width: 220,
        height: 220,
        tokens: { palette: ['#123456'], fontSize: 72 },
      }),
      specWith({ kind: 'bar', series: [{ name: 's', values: [-2, -1, 0] }], axes: { xLabel: 'X' } }),
    ]
    for (const sample of samples) {
      const svg = renderFigure(sample, TS).svg.content
      expect(xmlWellFormed(svg)).toBe(true)
    }
  })
})

// ── PNG real-byte verification ───────────────────────────────────────────────

function collectChunkTypes(bytes: Uint8Array): string[] {
  const types: string[] = []
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getUint32(0)
    types.push(String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]))
    if (types[types.length - 1] === 'IEND') {
      break
    }
    offset += 12 + length
  }
  return types
}

function collectIdat(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = []
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8)
    const length = view.getUint32(0)
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
    if (type === 'IDAT') {
      parts.push(bytes.slice(offset + 8, offset + 8 + length))
    }
    if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const merged = new Uint8Array(total)
  let cursor = 0
  for (const part of parts) {
    merged.set(part, cursor)
    cursor += part.length
  }
  return merged
}

describe('PNG is a REAL encoded image', () => {
  const artifact = renderFigure(BASE_SPEC, TS)
  const bytes = artifact.png.bytes

  it('has the PNG magic signature 89 50 4E 47 0D 0A 1A 0A', () => {
    expect(PNG_SIGNATURE_HEX).toBe('89504e470d0a1a0a')
    expect(bytes.length).toBeGreaterThan(0)
    expect(Array.from(bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  })

  it('has IHDR with the declared canvas dimensions and RGBA colour type', () => {
    expect(collectChunkTypes(bytes)).toEqual(['IHDR', 'IDAT', 'IEND'])
    const ihdrLength = new DataView(bytes.buffer, bytes.byteOffset + 8, 4).getUint32(0)
    expect(ihdrLength).toBe(13)
    expect(String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])).toBe('IHDR')
    const ihdr = new DataView(bytes.buffer, bytes.byteOffset + 16, 13)
    expect(ihdr.getUint32(0)).toBe(640)
    expect(ihdr.getUint32(4)).toBe(400)
    expect(bytes[24]).toBe(8) // bit depth
    expect(bytes[25]).toBe(6) // colour type RGBA
    expect(bytes[26]).toBe(0) // compression
    expect(bytes[27]).toBe(0) // filter
    expect(bytes[28]).toBe(0) // interlace
  })

  it('has a non-empty IDAT that zlib-inflates to exactly the raw scanlines', () => {
    const idat = collectIdat(bytes)
    expect(idat.length).toBeGreaterThan(0)
    const raw = inflateSync(idat)
    // filter byte (0) + width*4 RGBA bytes per scanline, for every row
    expect(raw.length).toBe(400 * (1 + 640 * 4))
    for (let y = 0; y < 400; y += 1) {
      expect(raw[y * (1 + 640 * 4)]).toBe(0) // filter type None on each row
    }
  })

  it('terminates with IEND (length 0) and consistent base64 view', () => {
    // Trailing chunk is IEND: length(4)=0 at [len-12..len-9], then the four
    // 'IEND' type bytes at [len-8..len-5], then the 4-byte CRC.
    expect(bytes[bytes.length - 12]).toBe(0)
    expect(bytes[bytes.length - 11]).toBe(0)
    expect(bytes[bytes.length - 10]).toBe(0)
    expect(bytes[bytes.length - 9]).toBe(0)
    expect(
      String.fromCharCode(
        bytes[bytes.length - 8],
        bytes[bytes.length - 7],
        bytes[bytes.length - 6],
        bytes[bytes.length - 5],
      ),
    ).toBe('IEND')
    expect(artifact.png.base64).toBe(Buffer.from(bytes).toString('base64'))
    expect(Buffer.from(artifact.png.base64, 'base64')).toEqual(Buffer.from(bytes))
  })

  it('inspectPng classifies the default encoder output as ok', () => {
    const inspected = inspectPng(bytes)
    expect(inspected.ok).toBe(true)
    if (inspected.ok) {
      expect(inspected.info.width).toBe(640)
      expect(inspected.info.height).toBe(400)
      expect(inspected.info.bitDepth).toBe(8)
      expect(inspected.info.colourType).toBe(6)
      expect(inspected.info.idatBytes).toBeGreaterThan(0)
      expect(inspected.info.chunkCount).toBe(3)
    }
  })

  it('artifact.spec round-trips to a byte-identical re-render', () => {
    const again = renderFigure(artifact.spec, TS)
    expect(again.svg.content).toBe(artifact.svg.content)
    expect(bytesEqual(again.png.bytes, bytes)).toBe(true)
  })
})

describe('PNG encoder / inspector defensive branches (direct unit coverage)', () => {
  it('encodePng rejects impossible inputs with plain Errors', () => {
    expect(() => encodePng({ width: 0, height: 4, rgba: new Uint8Array(0) })).toThrow('PNG encoder')
    expect(() =>
      encodePng({ width: 4, height: 4, rgba: 'nope' as unknown as Uint8Array }),
    ).toThrow('PNG encoder')
    expect(() =>
      encodePng({ width: 4, height: 4, rgba: new Uint8Array(3) }),
    ).toThrow('PNG encoder')
  })

  it('inspectPng rejects malformed byte streams', () => {
    expect(inspectPng('x' as unknown as Uint8Array).ok).toBe(false)
    expect(inspectPng(new Uint8Array(10)).ok).toBe(false)
    const wrongSig = new Uint8Array(32).fill(1)
    expect(inspectPng(wrongSig).ok).toBe(false)

    const small = encodePng({ width: 2, height: 2, rgba: new Uint8Array(16) })
    // strip the trailing IEND chunk -> missing IEND
    const noIend = small.slice(0, small.length - 12)
    expect(inspectPng(noIend).ok).toBe(false)

    // valid IHDR but no IDAT and no real data
    const sig = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const header = new Uint8Array(13)
    new DataView(header.buffer).setUint32(0, 2)
    new DataView(header.buffer).setUint32(4, 2)
    header[8] = 8
    header[9] = 6
    const concat = (...parts: Uint8Array[]): Uint8Array => {
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
      let o = 0
      for (const part of parts) {
        out.set(part, o)
        o += part.length
      }
      return out
    }
    const chunk = (type: string, payload: Uint8Array): Uint8Array => {
      const len = new Uint8Array(4)
      new DataView(len.buffer).setUint32(0, payload.length)
      const typeB = Uint8Array.from(type, c => c.charCodeAt(0))
      const crc = new Uint8Array(4)
      return concat(len, typeB, payload, crc)
    }
    const noData = concat(sig, chunk('IHDR', header), chunk('IEND', new Uint8Array(0)))
    expect(inspectPng(noData).ok).toBe(false) // IDAT absent/empty

    // IHDR length mismatch
    expect(inspectPng(concat(sig, chunk('IHDR', new Uint8Array(5)), chunk('IEND', new Uint8Array(0)))).ok).toBe(false)

    // invalid bit depth / colour type
    const depth4 = header.slice()
    depth4[8] = 4
    expect(inspectPng(concat(sig, chunk('IHDR', depth4), chunk('IEND', new Uint8Array(0)))).ok).toBe(false)
    const ct2 = header.slice()
    ct2[9] = 2
    expect(inspectPng(concat(sig, chunk('IHDR', ct2), chunk('IEND', new Uint8Array(0)))).ok).toBe(false)

    // width 0 -> invalid dimensions
    const w0 = header.slice()
    new DataView(w0.buffer).setUint32(0, 0)
    expect(inspectPng(concat(sig, chunk('IHDR', w0), chunk('IEND', new Uint8Array(0)))).ok).toBe(false)
  })
})

// ── Determinism ──────────────────────────────────────────────────────────────

describe('reproducibility — identical input yields identical bytes', () => {
  it('two calls with the same spec + timestamp are byte-identical', () => {
    const a = renderFigure(BASE_SPEC, TS)
    const b = renderFigure(BASE_SPEC, TS)
    expect(a.svg.content).toBe(b.svg.content)
    expect(bytesEqual(a.png.bytes, b.png.bytes)).toBe(true)
    expect(a.png.base64).toBe(b.png.base64)
    expect(a.meta.producedAt).toBe(b.meta.producedAt)
  })

  it('a different timestamp changes meta.producedAt but never the pixels', () => {
    const a = renderFigure(BASE_SPEC, TS)
    const b = renderFigure(BASE_SPEC, TS + 1000)
    expect(a.meta.producedAt).not.toBe(b.meta.producedAt)
    expect(a.svg.content).toBe(b.svg.content)
    expect(bytesEqual(a.png.bytes, b.png.bytes)).toBe(true)
  })

  it('renderFigure and renderFigureWithDeps with default deps agree byte-for-byte', () => {
    const a = renderFigure(BASE_SPEC, TS)
    const b = renderFigureWithDeps(BASE_SPEC, DEFAULT_FIGURE_DEPS, TS)
    expect(a.svg.content).toBe(b.svg.content)
    expect(bytesEqual(a.png.bytes, b.png.bytes)).toBe(true)
  })

  it('different seeds rotate the palette but keep geometry deterministic', () => {
    const a = renderFigure(specWith({ seed: 1 }), TS)
    const b = renderFigure(specWith({ seed: 2 }), TS)
    expect(a.spec.series[0].color).not.toBe(b.spec.series[0].color)
    expect(bytesEqual(a.png.bytes, b.png.bytes)).toBe(false)
  })
})

// ── Path guard ───────────────────────────────────────────────────────────────

describe('path guard — allowlist + traversal rejection', () => {
  it('resolves a clean relative path under the allowlisted root', () => {
    expect(guardFigureOutputPath('figures/chart-1.png', ['D:/work/out'])).toBe(
      'D:/work/out/figures/chart-1.png',
    )
    expect(guardFigureOutputPath('chart.svg', ['D:/work/out'])).toBe('D:/work/out/chart.svg')
    // Windows-style separators are normalized.
    expect(guardFigureOutputPath('a\\b\\c.png', ['D:/out'])).toBe('D:/out/a/b/c.png')
    // Double slashes collapse.
    expect(guardFigureOutputPath('a//b.png', ['R:/root'])).toBe('R:/root/a/b.png')
  })

  it('rejects traversal (.., ., ..\\, embedded escapes)', () => {
    for (const bad of [
      '../evil.png',
      'a/../../evil.png',
      '..\\evil.png',
      'a/..\\b.png',
      'a/./b.png',
      '/absolute.png',
      '\\absolute.png',
      'C:/windows.png',
      'c:\\evil.png',
      'a/C:/evil.png',
    ]) {
      const code = outcome(() => guardFigureOutputPath(bad, ['D:/work/out']))
      expect(code).toBe('DSH_FIGURE_PATH_TRAVERSAL')
    }
  })

  it('rejects malformed paths and non-matching roots', () => {
    expect(outcome(() => guardFigureOutputPath('', ['D:/out']))).toBe('DSH_FIGURE_PATH_INVALID')
    expect(outcome(() => guardFigureOutputPath('   ', ['D:/out']))).toBe('DSH_FIGURE_PATH_INVALID')
    expect(outcome(() => guardFigureOutputPath('a\u0000b.png', ['D:/out']))).toBe(
      'DSH_FIGURE_PATH_INVALID',
    )
    expect(outcome(() => guardFigureOutputPath(null as unknown as string, ['D:/out']))).toBe(
      'DSH_FIGURE_PATH_INVALID',
    )
    expect(outcome(() => guardFigureOutputPath('a.png', ['   ']))).toBe(
      'DSH_FIGURE_PATH_OUTSIDE_ALLOWLIST',
    )
    expect(outcome(() => guardFigureOutputPath('a.png', []))).toBe('DSH_FIGURE_PATH_INVALID')
  })

  it('throws FigureError (never a raw FigurePathError) through the public guard', () => {
    let caught: unknown
    try {
      guardFigureOutputPath('../x', ['D:/out'])
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(FigureError)
    expect((caught as FigureError).code).toBe('DSH_FIGURE_PATH_TRAVERSAL')
  })
})

// ── Meta + deep freeze ───────────────────────────────────────────────────────

describe('artifact is deeply frozen with a meta envelope', () => {
  it('rejects mutation at every plain-data level', () => {
    const artifact = renderFigure(BASE_SPEC, TS)
    expect(() => {
      (artifact.meta as { producedAt: number }).producedAt = 0
    }).toThrow(TypeError)
    expect(() => {
      (artifact.spec as { title: string }).title = 'mutated'
    }).toThrow(TypeError)
    expect(() => {
      (artifact.spec.series[0] as unknown as { values: number[] }).values.push(1)
    }).toThrow(TypeError)
    expect(() => {
      (artifact.config.yScale as unknown as { ticks: number[] }).ticks.push(0)
    }).toThrow(TypeError)
    expect(() => {
      (artifact.svg as { content: string }).content = 'x'
    }).toThrow(TypeError)
    expect(() => {
      (artifact.png as { width: number }).width = 1
    }).toThrow(TypeError)
    expect(Object.isFrozen(artifact)).toBe(true)
    expect(Object.isFrozen(artifact.spec.series[0])).toBe(true)
  })

  it('carries a normalized spec snapshot + effective config for identical re-render', () => {
    const artifact = renderFigure(BASE_SPEC, TS)
    const snapshot = artifact.spec
    // Trimming, canonical colours, defaults are all materialized.
    expect(snapshot.title).toBe('Latency by stage')
    expect(snapshot.series[0].color).toMatch(/^#[0-9a-f]{6}$/u)
    expect(snapshot.axes?.categories).toEqual(['encode', 'transmit', 'decode'])
    expect(artifact.config.fontSize).toBe(13)
    expect(artifact.config.fontFamily).toBe('sans-serif')
    expect(artifact.config.canvas).toEqual({ width: 640, height: 400 })
    expect(artifact.config.seriesCount).toBe(2)
    expect(artifact.config.paletteOffset).toBe(1)
  })
})

// ── Error transparency ───────────────────────────────────────────────────────

describe('error transparency (adapter seam)', () => {
  function adapterReturning(png: unknown): FigurePngAdapter {
    return { encode: () => png as Uint8Array }
  }

  it('a throwing adapter propagates its error as-is (never wrapped)', () => {
    const throwing: FigurePngAdapter = {
      encode: () => {
        throw new Error('png adapter exploded')
      },
    }
    const result = outcome(() => renderFigureWithDeps(BASE_SPEC, { pngAdapter: throwing }, TS))
    expect(result).toBe('RAW:png adapter exploded')
  })

  it('non-Uint8Array adapter output is an adapter fault', () => {
    for (const bad of [null, {}, 'data', 42]) {
      const result = outcome(() =>
        renderFigureWithDeps(BASE_SPEC, { pngAdapter: adapterReturning(bad) }, TS),
      )
      expect(result).toBe('DSH_FIGURE_INVALID_ADAPTER_OUTPUT')
    }
  })

  it('structurally invalid PNG bytes are an adapter fault', () => {
    const garbage = new Uint8Array([1, 2, 3, 4])
    const result = outcome(() =>
      renderFigureWithDeps(BASE_SPEC, { pngAdapter: adapterReturning(garbage) }, TS),
    )
    expect(result).toBe('DSH_FIGURE_INVALID_ADAPTER_OUTPUT')
  })

  it('a valid PNG of the WRONG dimensions is an adapter fault', () => {
    const tiny = encodePng({ width: 2, height: 2, rgba: new Uint8Array(2 * 2 * 4) })
    const result = outcome(() =>
      renderFigureWithDeps(BASE_SPEC, { pngAdapter: adapterReturning(tiny) }, TS),
    )
    expect(result).toBe('DSH_FIGURE_INVALID_ADAPTER_OUTPUT')
  })

  it('a hand-rolled but byte-valid PNG of the right dimensions is accepted', () => {
    const width = BASE_SPEC.width
    const height = BASE_SPEC.height
    const hand = encodePng({ width, height, rgba: new Uint8Array(width * height * 4).fill(200) })
    const artifact = renderFigureWithDeps(BASE_SPEC, { pngAdapter: adapterReturning(hand) }, TS)
    expect(artifact.png.width).toBe(width)
    expect(artifact.png.height).toBe(height)
  })
})

// ── Scale + color units ──────────────────────────────────────────────────────

describe('scale and color helpers', () => {
  it('computeYScale covers negatives, collapses zeros, and formats ticks', () => {
    const s = computeYScale([-3, 0, 4])
    expect(s.min).toBeLessThanOrEqual(-3)
    expect(s.max).toBeGreaterThanOrEqual(4)
    expect(s.ticks.includes(0)).toBe(true)
    const zeros = computeYScale([0, 0, 0])
    expect(zeros.min).toBe(0)
    expect(zeros.max).toBe(1)
    expect(formatTick(0.1, 1)).toBe('0.1')
    expect(formatTick(1e-17, 0)).toBe('0')
    expect(formatTick(-0.5, 1)).toBe('-0.5')
  })

  it('canonicalizeColor/parseColor implement the documented grammar', () => {
    expect(canonicalizeColor('#A1F')).toBe('#aa11ff')
    expect(canonicalizeColor('#a1f')).toBe('#aa11ff')
    expect(canonicalizeColor('RED')).toBe('#ff0000')
    expect(canonicalizeColor('#123456')).toBe('#123456')
    expect(parseColor('#123456')).toEqual({ r: 0x12, g: 0x34, b: 0x56 })
    expect(() => canonicalizeColor('notacolor')).toThrow(RangeError)
    expect(() => canonicalizeColor('#12')).toThrow(RangeError)
    expect(() => canonicalizeColor('')).toThrow(RangeError)
    expect(() => canonicalizeColor(7)).toThrow(RangeError)
  })
})

// ── Rule 7: no auto scientific claims ───────────────────────────────────────

describe('no auto scientific claims', () => {
  it('the artifact only carries data + rendering wording', () => {
    const artifact = renderFigure(BASE_SPEC, TS)
    const svg = artifact.svg.content
    expect(svg).toContain('Data and rendering only')
    expect(svg).not.toMatch(/p-value|p<0\.05|significant|correlation|conclusi/iu)
    const json = JSON.stringify({
      spec: artifact.spec,
      config: artifact.config,
      svg: artifact.svg.content,
    })
    expect(json).not.toMatch(/p-value|significant/iu)
  })
})

// ── sanity: unreachable-by-design branches are documented here ──────────────
describe('documented defensive branches', () => {
  it('figure error prefix is grep-able and stable', () => {
    expect(FIGURE_ERROR_PREFIX).toBe('DSH_FIGURE_')
    expect(FIGURE_TOOL_VERSION).toBe('0.1.2-alpha.4')
  })
})

// ── Coverage closing: normalization defaults & optional-text trimming ───────
// Drives the remaining per-file 100% branch paths through real renders.
describe('normalization defaults (kind/axes/legend/optional-text)', () => {
  it('kind/axes/legend omitted: bar default, derived categories, trimmed-away unit, no legend key', () => {
    const bare: FigureSpec = {
      title: 'Bare figure',
      width: 320,
      height: 240,
      series: [{ name: 'a', unit: '   ', values: [1, 2, 3] }],
      tokens: { palette: ['#123456'] },
      seed: 0,
    }
    const art = renderFigure(bare, TS)
    expect(art.spec.kind).toBe('bar')
    expect(art.spec.axes?.categories).toEqual(['1', '2', '3'])
    expect(art.spec.series[0].unit).toBeUndefined()
    expect(art.spec.legend).toBeUndefined()
    expect(xmlWellFormed(art.svg.content)).toBe(true)
  })

  it('an empty legend object normalizes to an absent legend', () => {
    const art = renderFigure(specWith({ legend: {} }), TS)
    expect(art.spec.legend).toBeUndefined()
    expect(art.config.seriesCount).toBe(2)
  })

  it('an x-axis unit (without x label) is echoed and drawn in the axis text', () => {
    const withXUnit: FigureSpec = {
      title: 'X unit only',
      width: 480,
      height: 320,
      series: [{ name: 's', values: [1, 2, 3] }],
      axes: { xUnit: 'sec', categories: ['a', 'b', 'c'] },
      tokens: { palette: ['#123456'] },
      seed: 0,
    }
    const art = renderFigure(withXUnit, TS)
    expect(art.spec.axes?.xUnit).toBe('sec')
    expect(art.spec.axes?.xLabel).toBeUndefined()
    expect(art.svg.content).toContain('(sec)')
  })

  it('legend on top without a title renders entries only', () => {
    const art = renderFigure(specWith({ legend: { position: 'top' } }), TS)
    expect(art.spec.legend?.position).toBe('top')
    expect(art.spec.legend?.title).toBeUndefined()
    expect(xmlWellFormed(art.svg.content)).toBe(true)
  })

  it('a single-category line chart emits markers but never a polyline', () => {
    const single: FigureSpec = {
      title: 'One point',
      width: 320,
      height: 240,
      kind: 'line',
      series: [{ name: 's', values: [7], marker: 'circle' }],
      axes: { categories: ['only'] },
      tokens: { palette: ['#123456'] },
      seed: 0,
    }
    const art = renderFigure(single, TS)
    expect(art.svg.content).not.toContain('<polyline')
    expect(art.svg.content).toContain('<circle')
  })

  it('series.values that is not an array is rejected as an invalid series', () => {
    expect(
      outcome(() =>
        renderFigure(specWith({ series: [{ name: 's', values: 'nope' as unknown as number[] }] }), TS),
      ),
    ).toBe('DSH_FIGURE_INVALID_SERIES')
  })
})

// ── Coverage closing: scale / color / path-guard direct units ──────────────
describe('scale edge helpers & color/guard error branches (direct units)', () => {
  it('valueToPixelY handles a normal band and a collapsed (max===min) scale', () => {
    const normal: YScale = { min: -1, max: 9, step: 2, decimals: 0, ticks: [-1, 1, 3, 5, 7, 9] }
    expect(valueToPixelY(4, normal, 20, 100)).toBe(60)
    expect(valueToPixelY(-1, normal, 20, 100)).toBe(100)
    expect(valueToPixelY(9, normal, 20, 100)).toBe(20)
    const collapsed: YScale = { min: 5, max: 5, step: 1, decimals: 0, ticks: [5] }
    expect(valueToPixelY(5, collapsed, 20, 100)).toBe(100)
  })

  it('canonicalizeColor rejects a malformed 6-digit hex and parseColor rejects unparsable input', () => {
    expect(() => canonicalizeColor('#gggggg')).toThrow(RangeError)
    expect(() => parseColor('#gggggg')).toThrow(RangeError)
    expect(() => parseColor('not-hex')).toThrow(RangeError)
  })

  it('resolveFigureOutputPath rejects a non-object options argument', () => {
    let code = ''
    try {
      resolveFigureOutputPath('x.png', null)
    } catch (error) {
      if (error instanceof FigurePathError) {
        code = error.code
      }
    }
    expect(code).toBe('DSH_FIGURE_PATH_INVALID')
  })
})

// ── Coverage closing: PNG inspector crafted byte streams ────────────────────
function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function pngChunk(type: string, payload: Uint8Array): Uint8Array {
  const length = new Uint8Array(4)
  new DataView(length.buffer).setUint32(0, payload.length)
  const typeBytes = Uint8Array.from(type, c => c.charCodeAt(0))
  return concatBytes(length, typeBytes, payload, new Uint8Array(4))
}

function pngHeader(width: number, height: number): Uint8Array {
  const header = new Uint8Array(13)
  new DataView(header.buffer).setUint32(0, width)
  new DataView(header.buffer).setUint32(4, height)
  header[8] = 8
  header[9] = 6
  return header
}

const PNG_MAGIC = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('PNG inspector residual branch coverage (crafted streams)', () => {
  it('rejects a chunk whose declared length overruns the byte stream', () => {
    const truncated = concatBytes(
      PNG_MAGIC,
      pngChunk('IHDR', pngHeader(2, 2)),
      pngChunk('ABCD', new Uint8Array(0)), // proper chunk to stay in the loop
    )
    // Now lie about the length of a trailing chunk: only its 8-byte header fits.
    const lying = concatBytes(truncated, new Uint8Array(4).fill(0), Uint8Array.from('EFGH', c => c.charCodeAt(0)))
    const fake = new Uint8Array(lying)
    new DataView(fake.buffer, truncated.length, 4).setUint32(0, 400)
    const result = inspectPng(fake)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('overruns')
    }
  })

  it('rejects a stream with no IHDR chunk', () => {
    const noIhdr = concatBytes(
      PNG_MAGIC,
      pngChunk('IDAT', new Uint8Array([1, 2, 3])),
      pngChunk('IEND', new Uint8Array(0)),
    )
    const result = inspectPng(noIhdr)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('IHDR chunk missing')
    }
  })

  it('accepts an unknown ancillary chunk between IHDR and IDAT', () => {
    const withUnknown = concatBytes(
      PNG_MAGIC,
      pngChunk('IHDR', pngHeader(2, 2)),
      pngChunk('ABCD', new Uint8Array(0)),
      pngChunk('IDAT', new Uint8Array([9])),
      pngChunk('IEND', new Uint8Array(0)),
    )
    const result = inspectPng(withUnknown)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.info.chunkCount).toBe(4)
    }
  })

  it('rejects zero dimensions when real IDAT data is present', () => {
    const zeroDims = concatBytes(
      PNG_MAGIC,
      pngChunk('IHDR', pngHeader(0, 1)),
      pngChunk('IDAT', new Uint8Array([5, 5, 5, 5])),
      pngChunk('IEND', new Uint8Array(0)),
    )
    const result = inspectPng(zeroDims)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('invalid dimensions')
    }
  })
})

// ── Coverage closing: raster + svg extreme / defensive geometry ────────────
// These drive the software renderers directly with normalized-snapshot shapes
// that bypass the shared validation invariants (color always filled, categories
// always >= 1, title always non-empty, canvas always >= 220) so the defensive
// clamp / fallback branches execute.
describe('raster & svg extreme geometry branches (direct units)', () => {
  it('raster: empty title + tiny canvas + collapsed scale exercises all plot clamps', () => {
    const micro = {
      kind: 'bar',
      title: '',
      width: 60,
      height: 4,
      series: [{ name: 's', values: [0] }],
      tokens: { palette: ['#123456'] },
      seed: 0,
      legend: { visible: false },
    } as unknown as FigureSpecSnapshot
    const collapsed: YScale = { min: 5, max: 5, step: 1, decimals: 0, ticks: [0] }
    const out = rasterizeFigure(micro, collapsed)
    expect(out.width).toBe(60)
    expect(out.height).toBe(4)
    expect(out.rgba).toBeInstanceOf(Uint8Array)
  })

  it('raster: an overlong title selects the 1x title scale', () => {
    const wideTitle = {
      kind: 'bar',
      title: 'T'.repeat(30),
      width: 60,
      height: 220,
      series: [{ name: 's', values: [1, 2] }],
      axes: { categories: ['a', 'b'] },
      tokens: { palette: ['#123456'] },
      seed: 0,
      legend: { visible: false },
    } as unknown as FigureSpecSnapshot
    const out = rasterizeFigure(wideTitle, computeYScale([1, 2]))
    expect(out.rgba.length).toBe(60 * 220 * 4)
  })

  it('raster: sparse bar series / short values / missing color hit the defensive continues', () => {
    const spec = {
      kind: 'bar',
      title: 't',
      width: 120,
      height: 120,
      axes: { categories: ['a', 'b'] },
      tokens: { palette: ['#123456'] },
      seed: 0,
      legend: { visible: false },
    } as unknown as FigureSpecSnapshot
    const series = [{ name: 's', values: [5] }]
    series.length = 2 // hole -> spec.series[1] === undefined
    ;(spec as { series: unknown }).series = series
    const out = rasterizeFigure(spec, computeYScale([5, 6]))
    expect(out.rgba.length).toBe(120 * 120 * 4)
  })

  it('raster: sparse line series with circle/square markers and short values', () => {
    for (const marker of ['circle', 'square'] as const) {
      const spec = {
        kind: 'line',
        title: 't',
        width: 120,
        height: 120,
        axes: { categories: ['a', 'b'] },
        tokens: { palette: ['#123456'] },
        seed: 0,
        legend: { visible: false },
      } as unknown as FigureSpecSnapshot
      const series = [{ name: 's', values: [5], marker }]
      series.length = 2 // hole -> spec.series[1] === undefined
      ;(spec as { series: unknown }).series = series
      const out = rasterizeFigure(spec, computeYScale([5, 6]))
      expect(out.rgba.length).toBe(120 * 120 * 4)
    }
  })

  it('raster: a sparse category list hits the category-label defensive continue', () => {
    const spec = {
      kind: 'bar',
      title: 't',
      width: 140,
      height: 140,
      series: [{ name: 's', values: [7, 8] }],
      tokens: { palette: ['#123456'] },
      seed: 0,
      legend: { visible: false },
    } as unknown as FigureSpecSnapshot
    const categories = ['a']
    categories.length = 2 // hole -> categories[1] === undefined
    ;(spec as { axes: unknown }).axes = { categories }
    const out = rasterizeFigure(spec, computeYScale([7, 8]))
    expect(out.rgba.length).toBe(140 * 140 * 4)
  })

  it('raster: a visible legend with a series lacking a color exercises the fallback', () => {
    const spec = {
      kind: 'bar',
      title: 't',
      width: 140,
      height: 140,
      series: [{ name: 's', values: [1] }],
      axes: { categories: ['a'] },
      tokens: { palette: ['#123456'] },
      seed: 0,
    } as unknown as FigureSpecSnapshot
    const out = rasterizeFigure(spec, computeYScale([1]))
    expect(out.rgba.length).toBe(140 * 140 * 4)
  })

  it('svg: category-less spec exercises the axes?.categories fallback and zero slot', () => {
    const noCategories = {
      kind: 'bar',
      title: 't',
      width: 60,
      height: 60,
      series: [{ name: 's', values: [] }],
      tokens: { palette: ['#123456'] },
      seed: 0,
    } as unknown as FigureSpecSnapshot
    const svg = buildSvg(noCategories)
    expect(svg.startsWith('<svg')).toBe(true)
  })

  it('svg: series without an explicit color hit the color fallbacks', () => {
    const barNoColor = {
      kind: 'bar',
      title: 't',
      width: 140,
      height: 140,
      series: [{ name: 's', values: [1, 2] }],
      axes: { categories: ['a', 'b'] },
      legend: { visible: false },
      tokens: { palette: ['#123456'] },
      seed: 0,
    } as unknown as FigureSpecSnapshot
    const barSvg = buildSvg(barNoColor)
    expect(barSvg.startsWith('<svg')).toBe(true)

    const lineNoColor = {
      kind: 'line',
      title: 't',
      width: 140,
      height: 140,
      series: [{ name: 's', values: [5] }],
      axes: { categories: ['a', 'b'] },
      legend: { visible: false },
      tokens: { palette: ['#123456'] },
      seed: 0,
    } as unknown as FigureSpecSnapshot
    const lineSvg = buildSvg(lineNoColor)
    expect(lineSvg.startsWith('<svg')).toBe(true)
    expect(lineSvg).not.toContain('<polyline')
  })

  it('svg: empty title on a tiny canvas forces both plot clamps', () => {
    const emptyTitle = {
      kind: 'bar',
      title: '',
      width: 60,
      height: 4,
      series: [{ name: 's', values: [1] }],
      axes: { categories: ['a'] },
      legend: { visible: true, position: 'top', title: 'L' },
      tokens: { palette: ['#123456'] },
      seed: 0,
    } as unknown as FigureSpecSnapshot
    const svg = buildSvg(emptyTitle)
    expect(svg.startsWith('<svg')).toBe(true)
  })

  it('svg: a bar series whose values are shorter than the categories hits the value continue', () => {
    const spec = {
      kind: 'bar',
      title: 't',
      width: 120,
      height: 120,
      series: [{ name: 's', values: [5] }],
      axes: { categories: ['a', 'b'] },
      legend: { visible: false },
      tokens: { palette: ['#123456'] },
      seed: 0,
    } as unknown as FigureSpecSnapshot
    const svg = buildSvg(spec)
    expect(svg.startsWith('<svg')).toBe(true)
  })

  it('svg: a sparse category list hits the defensive category-label continue', () => {
    const spec = {
      kind: 'bar',
      title: 't',
      width: 140,
      height: 140,
      series: [{ name: 's', values: [7, 8] }],
      legend: { visible: false },
      tokens: { palette: ['#123456'] },
      seed: 0,
    } as unknown as FigureSpecSnapshot
    const categories = ['a']
    categories.length = 2 // hole -> categories[1] === undefined
    ;(spec as { axes: unknown }).axes = { categories }
    const svg = buildSvg(spec)
    expect(svg.startsWith('<svg')).toBe(true)
  })
})
