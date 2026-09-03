// @deepseek-ai/dsh-research-tools — T16 figure (绘图 SVG+PNG), input & seam types.
//
// PURE data contract for {@link FigureSpec}: a fully structured figure request
// (series with name/unit/values, x/y axis labels + units, legend, title, fixed
// canvas width/height, explicit color/font tokens, explicit deterministic
// layout seed). The tool (./index.ts) validates every field strictly — no
// NaN / Infinity / undefined flows past validation — then renders BOTH a
// deterministic SVG string (./svg.ts) and a REAL PNG byte artifact (./raster.ts
// -> ./png.ts, a built-in-only PNG encoder on node:zlib).
//
// No external image library is reachable in this package (see capability recon
// in the T16 report): sharp lives in packages/attachment/attachment-local and,
// under pnpm's strict node_modules, is NOT importable from
// @deepseek-ai/dsh-research-tools without adding a dependency (main-Agent-owned
// package.json — out of tool-agent authority). The PNG encoder therefore uses
// ONLY Node built-ins (node:zlib deflateSync + a hand-rolled CRC32 and
// IHDR/IDAT/IEND chunk writer) and produces byte-valid truecolor PNGs.
//
// The tool NEVER writes to the filesystem and never touches a clock. Any
// consumer that later persists the artifact must route file writes through an
// injected adapter AND pre-validate the target path with the pure path guard
// (./pathguard.ts, re-exported by ./index.ts).

/** Chart geometry kind — a grouped vertical bar chart or a line/marker chart,
 *  both over the shared category axis. */
export type FigureKind = 'bar' | 'line'

/** Legend placement (deterministic). */
export type FigureLegendPosition = 'top' | 'bottom'

/** Stroke style of a line series. */
export type FigureDash = 'solid' | 'dashed'

/** Data-point marker of a line series. */
export type FigureMarker = 'none' | 'circle' | 'square'

/** One data series: explicit name, optional unit, and its per-category values
 *  (every value MUST be a finite number once validated). */
export interface FigureSeriesSpec {
  readonly name: string
  /** Per-category numeric values. All series of one spec share the same length
   *  (they are plotted over the shared category axis). */
  readonly values: ReadonlyArray<number>
  /** Optional series-level unit suffix (e.g. 'ms'), shown in the legend. */
  readonly unit?: string
  /** Optional color override. Validated through the same color-token grammar
   *  as {@link FigureTokensSpec.palette}; resolved to canonical #rrggbb. */
  readonly color?: string
  readonly dash?: FigureDash
  readonly marker?: FigureMarker
}

/** Axes: x/y axis labels + units and the shared category labels. `categories`
 *  is optional — when omitted the tool derives '1'..'N' index categories. */
export interface FigureAxesSpec {
  readonly xLabel?: string
  readonly xUnit?: string
  /** Shared x category labels. When provided its length MUST equal every
   *  series values length; when omitted index categories are derived. */
  readonly categories?: ReadonlyArray<string>
  readonly yLabel?: string
  readonly yUnit?: string
}

/** Legend control. Legend ENTRIES are always derived from the validated series
 *  (name + resolved color + unit); this only toggles visibility / placement /
 *  an optional heading. */
export interface FigureLegendSpec {
  readonly visible?: boolean
  readonly position?: FigureLegendPosition
  readonly title?: string
}

/** Explicit color/font tokens. `palette` is required and non-empty; each entry
 *  is a color token (see ./color.ts). Colors are canonicalized to #rrggbb so
 *  the SVG only ever embeds validated hex and the raster only ever needs the
 *  parsed RGB triple — no raw embedded content reaches the markup. */
export interface FigureTokensSpec {
  readonly palette: ReadonlyArray<string>
  /** Optional SVG font-family token (letters/digits/space/_/-/.), default
   *  'sans-serif'. Only affects the SVG; the PNG raster uses a built-in 5x7
   *  bitmap face so both remain byte-deterministic. */
  readonly fontFamily?: string
  /** Optional base font size in px (integer 8..72), default 13. */
  readonly fontSize?: number
}

/**
 * Frozen input of {@link FigureSpec}. Fully structured:
 *  - `title` printable-ASCII, trimmed, 1..200 chars;
 *  - `width`/`height` integer canvas size in px (160..2048);
 *  - `series` 1..8 series, each 1..64 finite values, all series same length;
 *  - `axes` labels/units printable-ASCII; categories (if given) length-matched;
 *  - `legend` optional visibility / position / title;
 *  - `tokens.palette` required (1..32 color tokens), font tokens optional;
 *  - `seed` finite integer selecting the deterministic palette rotation.
 * `kind` defaults to 'bar'. No statistical/scientific claim may be encoded in
 * any field (rule 7 — the figure carries data + rendering only).
 */
export interface FigureSpec {
  readonly kind?: FigureKind
  readonly title: string
  readonly width: number
  readonly height: number
  readonly series: ReadonlyArray<FigureSeriesSpec>
  readonly axes?: FigureAxesSpec
  readonly legend?: FigureLegendSpec
  readonly tokens: FigureTokensSpec
  /** Deterministic layout seed (integer). The tool's only stochastic-looking
   *  knob — palette rotation — is derived from it with NO randomness. */
  readonly seed: number
}

/**
 * Normalized spec snapshot echoed inside the artifact (`artifact.spec`). Same
 * shape as {@link FigureSpec} but fully resolved: kind present, title trimmed,
 * categories materialized, every series color canonicalized, palette/font
 * tokens normalized. Passing `artifact.spec` back to the tool reproduces a
 * byte-identical figure (same input ⇒ same SVG/PNG).
 */
export type FigureSpecSnapshot = FigureSpec

/** One decoded pixel buffer handed to the PNG adapter (truecolor RGBA). */
export interface FigureBitmap {
  readonly width: number
  readonly height: number
  /** width*height*4 bytes, R,G,B,A order, top row first. */
  readonly rgba: Uint8Array
}

/** PNG-encoding seam. The bundled default (./png.ts) is a REAL encoder built
 *  on Node built-ins only; consumers may inject another implementation (tests
 *  inject throwing / structurally-invalid ones to prove error transparency).
 *  Adapter exceptions are NEVER swallowed by the tool (they propagate as-is);
 *  a byte structure that is not a valid PNG matching the requested dimensions
 *  is an adapter fault -> FigureError DSH_FIGURE_INVALID_ADAPTER_OUTPUT. */
export interface FigurePngAdapter {
  encode(bitmap: FigureBitmap): Uint8Array
}

/** Injected dependencies of {@link FigureSpec}-rendering. */
export interface FigureToolDeps {
  readonly pngAdapter: FigurePngAdapter
}
