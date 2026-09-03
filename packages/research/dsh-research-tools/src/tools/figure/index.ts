// @deepseek-ai/dsh-research-tools — T16 figure (绘图 SVG+PNG), public entry.
//
// PURE tool function: given a structured {@link FigureSpec} + a caller-provided
// epoch-ms timestamp, render a deterministic SVG string AND a REAL, byte-valid
// PNG, returned as an immutable {@link FigureArtifact}. The tool never touches
// the filesystem, never reads a clock, never performs I/O beyond CPU, never
// calls a model gateway, and never advances the batch-1 state machine.
//
// Trust-boundary invariants (frozen T16 design brief + shared.ts P2 rules):
//  - IMMUTABLE ARTIFACT: produced through {@link freezeArtifact} (structured
//    clone + deep freeze). The PNG byte payload is a typed array, which
//    Object.freeze cannot deep-freeze (V8: "Cannot freeze array buffer views
//    with elements"); it is therefore carried as a structuredClone-detached
//    private copy on the last frozen shell — no external alias exists for its
//    buffer, so in-place corruption cannot leak beyond the artifact itself.
//    A base64 view rides alongside for lossless inspection.
//  - NO HIDDEN RANDOMNESS: `seed` drives only a deterministic palette rotation
//    and layout decisions; two calls with the same spec + timestamp produce
//    byte-identical SVG and PNG.
//  - VALIDATION: every numeric input is explicitly checked — NaN, Infinity and
//    undefined anywhere in numeric positions throw {@link FigureError}; only
//    finite numbers proceed to the renderers.
//  - ADAPTER: the PNG encoder is an injected {@link FigurePngAdapter}
//    (default: the real built-in-only encoder in ./png.ts). An adapter that
//    THROWS propagates as-is; a byte stream that is not a structurally valid
//    PNG of the requested dimensions is an adapter fault -> FigureError.
//  - PATH SAFETY: a pure allowlist + traversal guard
//    {@link resolveFigureOutputPath} (./pathguard.ts) is exported for any
//    downstream stage that accepts an output/asset path; the tool itself never
//    writes.
//  - NO AUTO SCIENTIFIC CLAIMS: artifact text is limited to data + rendering
//    (axes, series, labels, units). No significance or conclusion is asserted.

import type { ToolArtifactMeta } from '../../shared.ts'
import { freezeArtifact } from '../../shared.ts'
import type {
  FigureDash,
  FigureKind,
  FigureMarker,
  FigureSpec,
  FigureSpecSnapshot,
  FigureToolDeps,
} from './adapter.ts'
import { canonicalizeColor } from './color.ts'
import { FigurePathError, resolveFigureOutputPath as guardRawPath } from './pathguard.ts'
import { encodePng, inspectPng, type PngInspectResult } from './png.ts'
import { rasterizeFigure } from './raster.ts'
import { buildSvg } from './svg.ts'
import { computeYScale, type YScale } from './scale.ts'

/** Stable tool id used in every artifact's meta. */
export const FIGURE_TOOL_ID = 'figure'

/** Version of this tool's artifact schema / implementation. Kept in lockstep
 *  with the package version (0.1.2-alpha.4 at the time of writing). */
export const FIGURE_TOOL_VERSION = '0.1.2-alpha.4'

/** Globally unique, grep-able error-code prefix for this tool. */
export const FIGURE_ERROR_PREFIX = 'DSH_FIGURE_'

/** Error codes thrown by the figure tool. */
export type FigureErrorCode =
  | 'DSH_FIGURE_INVALID_SPEC'
  | 'DSH_FIGURE_INVALID_KIND'
  | 'DSH_FIGURE_INVALID_TITLE'
  | 'DSH_FIGURE_INVALID_TEXT'
  | 'DSH_FIGURE_INVALID_SERIES'
  | 'DSH_FIGURE_NON_FINITE_NUMERIC'
  | 'DSH_FIGURE_VALUE_OUT_OF_RANGE'
  | 'DSH_FIGURE_INVALID_AXES'
  | 'DSH_FIGURE_INVALID_CANVAS'
  | 'DSH_FIGURE_INVALID_TOKENS'
  | 'DSH_FIGURE_INVALID_COLOR_TOKEN'
  | 'DSH_FIGURE_INVALID_LEGEND'
  | 'DSH_FIGURE_INVALID_SEED'
  | 'DSH_FIGURE_INVALID_TIMESTAMP'
  | 'DSH_FIGURE_MISSING_DEPS'
  | 'DSH_FIGURE_INVALID_ADAPTER_OUTPUT'
  | 'DSH_FIGURE_PATH_INVALID'
  | 'DSH_FIGURE_PATH_TRAVERSAL'
  | 'DSH_FIGURE_PATH_OUTSIDE_ALLOWLIST'

/** Error thrown on invalid tool input / structurally-invalid adapter output.
 *  Adapter exceptions themselves are surfaced as-is, NOT wrapped here. */
export class FigureError extends Error {
  readonly code: FigureErrorCode

  constructor(code: FigureErrorCode, message: string) {
    super(`[${code}] ${message}`)
    this.name = 'FigureError'
    this.code = code
  }
}

function throwFigure(code: FigureErrorCode, message: string): never {
  throw new FigureError(code, message)
}

/** Compact single-line representation of an unknown value for error text. */
function reprValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  return String(value)
}

/** Default PNG encoder dependency (the real built-in-only implementation). */
export const DEFAULT_FIGURE_DEPS: Readonly<FigureToolDeps> = Object.freeze({
  pngAdapter: { encode: encodePng },
})

// ── Input validation (pure; rejects every malformed input explicitly) ───────

const PRINTABLE_ASCII = /^[\u0020-\u007e]*$/u

function checkAsciiText(value: unknown, code: FigureErrorCode, what: string, maxLen: number): void {
  if (typeof value !== 'string') {
    throwFigure(code, `figure: ${what} must be a string (got ${String(value)})`)
  }
  if (!PRINTABLE_ASCII.test(value)) {
    throwFigure(
      code,
      `figure: ${what} must contain printable ASCII only (no control/non-ASCII chars)`,
    )
  }
  if (value.length > maxLen) {
    throwFigure(code, `figure: ${what} must be at most ${maxLen} characters`)
  }
}

function requireFiniteNumber(value: unknown, code: FigureErrorCode, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throwFigure(
      code,
      `figure: ${what} must be a finite number (rejecting NaN/Infinity/undefined; got ${String(value)})`,
    )
  }
  return value
}

function requireFiniteInteger(
  value: unknown,
  code: FigureErrorCode,
  what: string,
  min: number,
  max: number,
): number {
  // NaN/±Infinity (and undefined in a numeric slot) surface as
  // NON_FINITE_NUMERIC regardless of the owning field; only finite values
  // proceed to the field's own integer/range rule (e.g. INVALID_CANVAS).
  const num = requireFiniteNumber(value, 'DSH_FIGURE_NON_FINITE_NUMERIC', what)
  if (!Number.isSafeInteger(num) || num < min || num > max) {
    throwFigure(
      code,
      `figure: ${what} must be an integer in [${min}, ${max}] (got ${String(value)})`,
    )
  }
  return num
}

/** Range guard applied to every series value (keeps tick labels printable). */
const MAX_ABS_VALUE = 1e12

interface NormalizedSeries {
  name: string
  values: readonly number[]
  unit?: string
  color: string
  dash?: FigureDash
  marker?: FigureMarker
}

function trimOptionalText(
  value: unknown,
  code: FigureErrorCode,
  what: string,
  maxLen: number,
): string | undefined {
  if (value === undefined) {
    return undefined
  }
  checkAsciiText(value, code, what, maxLen)
  const trimmed = (value as string).trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function normalizeSpec(raw: unknown): FigureSpecSnapshot {
  if (raw === null || typeof raw !== 'object') {
    throwFigure('DSH_FIGURE_INVALID_SPEC', 'figure: spec must be a non-null object')
  }
  const spec = raw as Record<string, unknown>

  // kind (defaults to 'bar').
  let kind: FigureKind = 'bar'
  if (spec.kind !== undefined) {
    if (spec.kind !== 'bar' && spec.kind !== 'line') {
      throwFigure('DSH_FIGURE_INVALID_KIND', `figure: spec.kind must be 'bar'|'line' (got ${reprValue(spec.kind)})`)
    }
    kind = spec.kind
  }

  // title.
  checkAsciiText(spec.title, 'DSH_FIGURE_INVALID_TITLE', 'spec.title', 200)
  const title = (spec.title as string).trim()
  if (title.length === 0) {
    throwFigure('DSH_FIGURE_INVALID_TITLE', 'figure: spec.title must be non-empty after trimming')
  }

  // canvas.
  const width = requireFiniteInteger(spec.width, 'DSH_FIGURE_INVALID_CANVAS', 'spec.width', 220, 4096)
  const height = requireFiniteInteger(spec.height, 'DSH_FIGURE_INVALID_CANVAS', 'spec.height', 220, 4096)

  // series.
  if (!Array.isArray(spec.series) || spec.series.length === 0 || spec.series.length > 8) {
    throwFigure('DSH_FIGURE_INVALID_SERIES', 'figure: spec.series must be an array of 1..8 series')
  }
  const rawSeries = spec.series as unknown[]
  const normalizedSeries: NormalizedSeries[] = []
  const seriesCount = rawSeries.length
  let sharedLength: number | undefined
  for (let s = 0; s < seriesCount; s += 1) {
    const entry = rawSeries[s]
    if (entry === null || typeof entry !== 'object') {
      throwFigure('DSH_FIGURE_INVALID_SERIES', `figure: series[${s}] must be an object`)
    }
    const series = entry as Record<string, unknown>
    checkAsciiText(series.name, 'DSH_FIGURE_INVALID_SERIES', `series[${s}].name`, 80)
    const name = (series.name as string).trim()
    if (name.length === 0) {
      throwFigure('DSH_FIGURE_INVALID_SERIES', `figure: series[${s}].name must be non-empty after trimming`)
    }
    if (!Array.isArray(series.values)) {
      throwFigure('DSH_FIGURE_INVALID_SERIES', `figure: series[${s}].values must be an array`)
    }
    const values = series.values as unknown[]
    if (values.length === 0 || values.length > 64) {
      throwFigure('DSH_FIGURE_INVALID_SERIES', `figure: series[${s}].values must have 1..64 entries`)
    }
    if (sharedLength === undefined) {
      sharedLength = values.length
    } else if (values.length !== sharedLength) {
      throwFigure(
        'DSH_FIGURE_INVALID_SERIES',
        `figure: all series must share one length (series[0]=${sharedLength}, series[${s}]=${values.length})`,
      )
    }
    const numericValues: number[] = []
    for (let v = 0; v < values.length; v += 1) {
      const value = requireFiniteNumber(
        values[v],
        'DSH_FIGURE_NON_FINITE_NUMERIC',
        `series[${s}].values[${v}]`,
      )
      if (Math.abs(value) > MAX_ABS_VALUE) {
        throwFigure(
          'DSH_FIGURE_VALUE_OUT_OF_RANGE',
          `figure: series[${s}].values[${v}] magnitude exceeds ${MAX_ABS_VALUE}`,
        )
      }
      numericValues.push(value)
    }
    const unit = trimOptionalText(series.unit, 'DSH_FIGURE_INVALID_TEXT', `series[${s}].unit`, 60)
    const color = series.color === undefined ? undefined : canonicalizeColorToken(series.color)
    const dash = series.dash === undefined ? undefined : validateDash(series.dash)
    const marker = series.marker === undefined ? undefined : validateMarker(series.marker)
    normalizedSeries.push({
      name,
      values: numericValues,
      ...(unit === undefined ? {} : { unit }),
      color: color ?? '',
      ...(dash === undefined ? {} : { dash }),
      ...(marker === undefined ? {} : { marker }),
    })
  }

  // axes.
  const axesRaw = spec.axes
  let xLabel: string | undefined
  let xUnit: string | undefined
  let yLabel: string | undefined
  let yUnit: string | undefined
  let categoriesRaw: unknown
  if (axesRaw !== undefined) {
    if (axesRaw === null || typeof axesRaw !== 'object') {
      throwFigure('DSH_FIGURE_INVALID_AXES', 'figure: spec.axes must be an object when provided')
    }
    const axes = axesRaw as Record<string, unknown>
    xLabel = trimOptionalText(axes.xLabel, 'DSH_FIGURE_INVALID_TEXT', 'spec.axes.xLabel', 60)
    xUnit = trimOptionalText(axes.xUnit, 'DSH_FIGURE_INVALID_TEXT', 'spec.axes.xUnit', 60)
    yLabel = trimOptionalText(axes.yLabel, 'DSH_FIGURE_INVALID_TEXT', 'spec.axes.yLabel', 60)
    yUnit = trimOptionalText(axes.yUnit, 'DSH_FIGURE_INVALID_TEXT', 'spec.axes.yUnit', 60)
    categoriesRaw = axes.categories
  }

  const categoryCount = sharedLength as number
  let categories: string[]
  const deriveIndexCategories = (): string[] =>
    Array.from({ length: categoryCount }, (_, i) => String(i + 1))
  if (categoriesRaw === undefined || (Array.isArray(categoriesRaw) && categoriesRaw.length === 0)) {
    // Absent or empty categories -> derive 1-based index labels ('1'..'n').
    categories = deriveIndexCategories()
  } else {
    if (!Array.isArray(categoriesRaw) || categoriesRaw.length !== categoryCount) {
      throwFigure(
        'DSH_FIGURE_INVALID_AXES',
        `figure: spec.axes.categories must have exactly ${categoryCount} entries when provided`,
      )
    }
    categories = categoriesRaw.map((entry, i) => {
      checkAsciiText(entry, 'DSH_FIGURE_INVALID_TEXT', `spec.axes.categories[${i}]`, 40)
      const label = (entry as string).trim()
      if (label.length === 0) {
        throwFigure('DSH_FIGURE_INVALID_AXES', `figure: spec.axes.categories[${i}] must be non-empty after trimming`)
      }
      return label
    })
  }
  const axesOut: FigureSpecSnapshot['axes'] = {
    ...(xLabel === undefined ? {} : { xLabel }),
    ...(xUnit === undefined ? {} : { xUnit }),
    categories,
    ...(yLabel === undefined ? {} : { yLabel }),
    ...(yUnit === undefined ? {} : { yUnit }),
  }

  // legend.
  let legendOut: FigureSpecSnapshot['legend']
  if (spec.legend !== undefined) {
    if (spec.legend === null || typeof spec.legend !== 'object') {
      throwFigure('DSH_FIGURE_INVALID_LEGEND', 'figure: spec.legend must be an object when provided')
    }
    const legend = spec.legend as Record<string, unknown>
    if (legend.visible !== undefined && typeof legend.visible !== 'boolean') {
      throwFigure('DSH_FIGURE_INVALID_LEGEND', 'figure: spec.legend.visible must be a boolean')
    }
    if (
      legend.position !== undefined &&
      legend.position !== 'top' &&
      legend.position !== 'bottom'
    ) {
      throwFigure('DSH_FIGURE_INVALID_LEGEND', `figure: spec.legend.position must be 'top'|'bottom' (got ${reprValue(legend.position)})`)
    }
    const legendTitle = trimOptionalText(legend.title, 'DSH_FIGURE_INVALID_TEXT', 'spec.legend.title', 60)
    // Capture the already-validated fields through narrowing guards so no
    // `as` assertion is needed when they are spread into the snapshot.
    const legendVisible = typeof legend.visible === 'boolean' ? legend.visible : undefined
    const legendPosition =
      legend.position === 'top' || legend.position === 'bottom' ? legend.position : undefined
    legendOut = {
      ...(legendVisible === undefined ? {} : { visible: legendVisible }),
      ...(legendPosition === undefined ? {} : { position: legendPosition }),
      ...(legendTitle === undefined ? {} : { title: legendTitle }),
    }
    if (Object.keys(legendOut).length === 0) {
      legendOut = undefined
    }
  }

  // tokens.
  if (spec.tokens === null || typeof spec.tokens !== 'object') {
    throwFigure('DSH_FIGURE_INVALID_TOKENS', 'figure: spec.tokens must be an object')
  }
  const tokens = spec.tokens as Record<string, unknown>
  if (!Array.isArray(tokens.palette) || tokens.palette.length === 0 || tokens.palette.length > 32) {
    throwFigure('DSH_FIGURE_INVALID_TOKENS', 'figure: spec.tokens.palette must be an array of 1..32 colors')
  }
  const palette = tokens.palette.map((entry, i) => {
    try {
      return canonicalizeColor(entry)
    } catch {
      throwFigure('DSH_FIGURE_INVALID_COLOR_TOKEN', `figure: spec.tokens.palette[${i}] is not a valid color token`)
    }
  })
  let fontFamily: string | undefined
  if (tokens.fontFamily !== undefined) {
    if (
      typeof tokens.fontFamily !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/.test(tokens.fontFamily)
    ) {
      throwFigure('DSH_FIGURE_INVALID_TOKENS', 'figure: spec.tokens.fontFamily is not a safe font token')
    }
    fontFamily = tokens.fontFamily
  }
  let fontSize: number | undefined
  if (tokens.fontSize !== undefined) {
    fontSize = requireFiniteInteger(tokens.fontSize, 'DSH_FIGURE_INVALID_TOKENS', 'spec.tokens.fontSize', 8, 72)
  }

  // seed.
  const seed = requireFiniteInteger(spec.seed, 'DSH_FIGURE_INVALID_SEED', 'spec.seed', Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)

  // Resolve per-series colors deterministically (palette rotated by seed).
  const paletteOffset = ((seed % palette.length) + palette.length) % palette.length
  const resolvedSeries = normalizedSeries.map((series, index) => {
    // defensive: series.color is always non-empty after normalization and
    // palette.length is in 1..32, so the modulo index is always in range;
    // neither fallback alternative below can ever be taken.
    /* v8 ignore start -- palette fallback is unreachable */
    const color =
      series.color.length > 0
        ? series.color
        : (palette[(index + paletteOffset) % palette.length] ?? '#1f77b4')
    /* v8 ignore stop */
    return {
      name: series.name,
      values: series.values,
      ...(series.unit === undefined ? {} : { unit: series.unit }),
      color,
      ...(series.dash === undefined ? {} : { dash: series.dash }),
      ...(series.marker === undefined ? {} : { marker: series.marker }),
    }
  })

  return {
    kind,
    title,
    width,
    height,
    series: resolvedSeries,
    axes: axesOut,
    ...(legendOut === undefined ? {} : { legend: legendOut }),
    tokens: {
      palette,
      ...(fontFamily === undefined ? {} : { fontFamily }),
      ...(fontSize === undefined ? {} : { fontSize }),
    },
    seed,
  }
}

function canonicalizeColorToken(value: unknown): string {
  try {
    return canonicalizeColor(value)
  } catch {
    throwFigure('DSH_FIGURE_INVALID_COLOR_TOKEN', 'figure: series.color is not a valid color token')
  }
}

function validateDash(value: unknown): FigureDash {
  if (value !== 'solid' && value !== 'dashed') {
    throwFigure('DSH_FIGURE_INVALID_SERIES', `figure: series.dash must be 'solid'|'dashed' (got ${String(value)})`)
  }
  return value
}

function validateMarker(value: unknown): FigureMarker {
  if (value !== 'none' && value !== 'circle' && value !== 'square') {
    throwFigure('DSH_FIGURE_INVALID_SERIES', `figure: series.marker must be 'none'|'circle'|'square' (got ${String(value)})`)
  }
  return value
}

function validateDeps(deps: unknown): FigureToolDeps {
  if (deps === null || typeof deps !== 'object') {
    throwFigure('DSH_FIGURE_MISSING_DEPS', 'figure: deps must be an object with a pngAdapter')
  }
  const pngAdapter = (deps as { pngAdapter?: unknown }).pngAdapter
  if (pngAdapter === null || typeof pngAdapter !== 'object' || typeof (pngAdapter as { encode?: unknown }).encode !== 'function') {
    throwFigure('DSH_FIGURE_MISSING_DEPS', 'figure: deps.pngAdapter must be an object with encode(bitmap)')
  }
  return deps as FigureToolDeps
}

function validateTimestamp(timestamp: number): void {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0) {
    throwFigure('DSH_FIGURE_INVALID_TIMESTAMP', `figure: timestamp must be a finite epoch-ms number >= 0 (got ${String(timestamp)})`)
  }
}

function allSeriesValues(spec: FigureSpecSnapshot): number[] {
  const values: number[] = []
  for (const series of spec.series) {
    for (const value of series.values) {
      values.push(value)
    }
  }
  return values
}

/** Effective derived config echoed on the artifact (enables identical
 *  re-rendering + audit of every non-obvious layout decision). */
export interface FigureConfig {
  readonly seed: number
  readonly paletteOffset: number
  readonly fontFamily: string
  readonly fontSize: number
  readonly kind: FigureKind
  readonly canvas: { readonly width: number; readonly height: number }
  readonly categories: readonly string[]
  readonly yScale: YScale
  readonly seriesCount: number
}

function buildConfig(spec: FigureSpecSnapshot, scale: YScale, paletteOffset: number): FigureConfig {
  // defensive: buildConfig only ever receives a normalized snapshot (kind
  // always present, axes.categories always materialized), so the font/kind/
  // categories fallbacks below are unreachable.
  /* v8 ignore start -- normalized-snapshot invariant */
  return {
    seed: spec.seed,
    paletteOffset,
    fontFamily: spec.tokens.fontFamily ?? 'sans-serif',
    fontSize: spec.tokens.fontSize ?? 13,
    kind: spec.kind ?? 'bar',
    canvas: { width: spec.width, height: spec.height },
    categories: (spec.axes?.categories ?? []).slice(),
    yScale: scale,
    seriesCount: spec.series.length,
  }
  /* v8 ignore stop */
}

/** Structurally validate PNG adapter output against the requested canvas. */
function verifyAdapterPng(bytes: unknown, width: number, height: number): Uint8Array {
  if (!(bytes instanceof Uint8Array)) {
    throwFigure('DSH_FIGURE_INVALID_ADAPTER_OUTPUT', 'figure: png adapter returned a non-Uint8Array')
  }
  const inspected: PngInspectResult = inspectPng(bytes)
  if (!inspected.ok) {
    throwFigure(
      'DSH_FIGURE_INVALID_ADAPTER_OUTPUT',
      `figure: png adapter returned structurally invalid PNG — ${inspected.reason}`,
    )
  }
  if (inspected.info.width !== width || inspected.info.height !== height) {
    throwFigure(
      'DSH_FIGURE_INVALID_ADAPTER_OUTPUT',
      `figure: png adapter returned dimensions ${inspected.info.width}x${inspected.info.height}, expected ${width}x${height}`,
    )
  }
  return bytes
}

export interface FigureSvgView {
  readonly content: string
  readonly width: number
  readonly height: number
  readonly byteLength: number
}

export interface FigurePngView {
  /** Real encoded PNG bytes (typed array; detached private copy). */
  readonly bytes: Uint8Array
  /** Lossless base64 view of the same bytes. */
  readonly base64: string
  readonly width: number
  readonly height: number
  readonly byteLength: number
}

export interface FigureArtifact {
  readonly meta: ToolArtifactMeta
  /** Normalized spec snapshot (echo of series/axes/units) — same input to the
   *  tool reproduces a byte-identical figure. */
  readonly spec: FigureSpecSnapshot
  /** Effective derived figure config (scale, colors offset, fonts, canvas). */
  readonly config: FigureConfig
  readonly svg: FigureSvgView
  readonly png: FigurePngView
}

/**
 * Render one figure to a deeply-frozen {@link FigureArtifact}. Pure: same
 * spec + timestamp always yields byte-identical SVG and PNG.
 *
 * @param spec the validated figure request.
 * @param timestamp caller-injected epoch ms (auditable; lands in meta.producedAt).
 */
export function renderFigure(spec: FigureSpec, timestamp: number): FigureArtifact {
  return renderFigureWithDeps(spec, DEFAULT_FIGURE_DEPS, timestamp)
}

/**
 * {@link renderFigure} with an explicit dependency bundle (PNG encoder seam).
 * Tests use this to prove error transparency (a throwing adapter propagates
 * as-is; structurally-invalid output is a DSH_FIGURE_INVALID_ADAPTER_OUTPUT
 * fault). Renders byte-identically to {@link renderFigure} when deps carry the
 * default adapter.
 */
export function renderFigureWithDeps(
  spec: FigureSpec,
  deps: FigureToolDeps,
  timestamp: number,
): FigureArtifact {
  const snapshot = normalizeSpec(spec)
  const validatedDeps = validateDeps(deps)
  validateTimestamp(timestamp)

  const scale = computeYScale(allSeriesValues(snapshot))
  const svgContent = buildSvg(snapshot)
  const svgByteLength = new TextEncoder().encode(svgContent).byteLength

  const raster = rasterizeFigure(snapshot, scale)
  const pngBytes = verifyAdapterPng(
    validatedDeps.pngAdapter.encode({ width: raster.width, height: raster.height, rgba: raster.rgba }),
    raster.width,
    raster.height,
  )
  const base64 = Buffer.from(pngBytes).toString('base64')

  const meta: ToolArtifactMeta = {
    toolId: FIGURE_TOOL_ID,
    version: FIGURE_TOOL_VERSION,
    producedAt: timestamp,
  }
  const paletteOffset = ((snapshot.seed % snapshot.tokens.palette.length) + snapshot.tokens.palette.length) % snapshot.tokens.palette.length
  const config = buildConfig(snapshot, scale, paletteOffset)

  // Freeze the plain-data graph first (shared freezeArtifact). The PNG byte
  // payload cannot pass through shared deepFreeze (typed arrays are not
  // freezable), so bytes ride on a final frozen shell as a detached copy.
  const frozen = freezeArtifact({
    meta,
    spec: snapshot,
    config,
    svg: {
      content: svgContent,
      width: snapshot.width,
      height: snapshot.height,
      byteLength: svgByteLength,
    },
    png: {
      width: snapshot.width,
      height: snapshot.height,
      byteLength: pngBytes.byteLength,
      base64,
    },
  })
  const pngNode = Object.freeze({ ...(frozen.png as object), bytes: pngBytes }) as FigurePngView
  const artifact = Object.freeze({ ...(frozen as object), png: pngNode }) as FigureArtifact
  return artifact
}

/**
 * Pure allowlist + traversal guard for a downstream figure-output path. The
 * tool itself never writes; this is the required gate for any figure API that
 * accepts an output/asset path. Throws {@link FigureError} with code
 * DSH_FIGURE_PATH_INVALID / DSH_FIGURE_PATH_TRAVERSAL /
 * DSH_FIGURE_PATH_OUTSIDE_ALLOWLIST.
 */
export function guardFigureOutputPath(
  rawPath: string,
  allowlistRoots: readonly string[],
): string {
  try {
    const result = guardRawPath(rawPath, { allowlistRoots })
    return result.resolved
  } catch (error) {
    // defensive: guardRawPath only ever throws FigurePathError, so the
    // instanceof branch below always matches and the raw rethrow is never
    // reached.
    /* v8 ignore start -- FigurePathError-only throw path */
    if (error instanceof FigurePathError) {
      throwFigure(error.code, error.message)
    }
    throw error
    /* v8 ignore stop */
  }
}

// ── Public re-exports (single import surface for consumers) ────────────────
export type {
  FigureAxesSpec,
  FigureBitmap,
  FigureDash,
  FigureKind,
  FigureLegendPosition,
  FigureLegendSpec,
  FigureMarker,
  FigurePngAdapter,
  FigureSeriesSpec,
  FigureSpec,
  FigureSpecSnapshot,
  FigureTokensSpec,
  FigureToolDeps,
} from './adapter.ts'
export { resolveFigureOutputPath, FigurePathError } from './pathguard.ts'
export type { PathGuardOptions, FigurePathErrorCode } from './pathguard.ts'
export { inspectPng, PNG_SIGNATURE, PNG_SIGNATURE_HEX } from './png.ts'
export type { PngBitmapInput, PngInspectInfo, PngInspectResult } from './png.ts'
export { escapeXml } from './svg.ts'
export { computeYScale, formatTick } from './scale.ts'
export type { YScale } from './scale.ts'
export { canonicalizeColor, parseColor } from './color.ts'
