// @deepseek-ai/dsh-research-team — the drawing seam, and what a figure provider must hand back.
//
// WHY A SEAM. D1 drew every float with this repository's own SVG/PNG tool. That tool is deterministic
// and dependency-free, which is why it ships — and it is not a scientific plotting library: its
// typography, its scales and its tick placement are the ones a small renderer has, and a paper whose
// figures look like a test fixture is a paper a referee reads differently. The plan asks for a mature
// provider, and "mature" is a property of the deployment's toolchain rather than of this package, so
// the drawing is a seam the deployment fills.
//
// WHAT A PROVIDER HANDS BACK, AND WHY IT IS TWO FORMATS. Every float must arrive as a VECTOR for the
// HTML manuscript and as a RASTER for LaTeX, which has no SVG support — the compile refuses a document
// that would carry a figure a reader cannot see, so a provider that can only draw one of the two is a
// provider that loses the figure in half of the formats. Both come back from one render, so the two
// cannot be pictures of different data.
//
// WHAT THIS IS NOT. It does not choose the provider, does not probe one, and does not draw anything
// itself. A deployment that configures none gets the built-in renderer and an artifact that says so.

import type { FigureSpec, RoadmapGraph } from '@deepseek-ai/dsh-research-tools'

/** One figure, drawn: the two formats a manuscript needs from one render. */
export interface RenderedFigure {
  /** The vector form, embedded in the HTML manuscript. */
  readonly svg: string
  /** The raster form, base64 PNG — what LaTeX can carry. */
  readonly pngBase64: string
  readonly width: number
  readonly height: number
  /** The provider's own name for what drew it, recorded on the float. */
  readonly tool: string
  /** The library's version, as the provider reported it, so a figure names the code that drew it. */
  readonly toolVersion: string
}

/**
 * A deployment's drawing capability: a chart from a figure spec, and a diagram from a graph.
 *
 * BOTH METHODS, because a paper carries both. A provider that drew charts and left the roadmap as
 * mermaid source is what this repository had: the compiled document then cannot carry the diagram at
 * all, and the package reports a dropped float rather than a picture.
 */
export interface FigureProvider {
  /** The provider's identifier, e.g. `matplotlib`. Recorded on every float it drew. */
  readonly id: string
  /**
   * The library's version, as the provider asked the machine for it.
   *
   * A FIGURE NAMES THE CODE THAT DREW IT, for the same reason a result names its rule version: two
   * packages whose charts differ are two renderings, and a reader comparing them needs to know which
   * library produced which rather than guessing from the pixels.
   */
  readonly toolVersion: string
  /**
   * Draw one chart.
   *
   * @param spec - the figure spec the presentation plan was rendered into.
   * @returns the drawn figure in both formats.
   * @throws {Error} when the provider cannot draw it, naming what it refused.
   */
  renderFigure(spec: FigureSpec): Promise<RenderedFigure>
  /**
   * Draw one diagram.
   *
   * @param graph - the roadmap graph the study's presentation asked for.
   * @returns the drawn diagram in both formats.
   * @throws {Error} when the provider cannot draw it, naming what it refused.
   */
  renderDiagram(graph: RoadmapGraph): Promise<RenderedFigure>
}

/**
 * Whether a value is one of these, checked where a deployment-facing config arrives.
 *
 * A deployment states its provider in `cordis.yml`, which is a durable boundary: the value that
 * reaches the driver is `unknown` until something checks it, and a config that named a function
 * without the shape below would fail at D1 — five steps into a run whose earlier gates had closed.
 *
 * @param value - the configured value.
 * @returns true when it is a figure provider.
 */
export function isFigureProvider(value: unknown): value is FigureProvider {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as { id?: unknown; renderFigure?: unknown; renderDiagram?: unknown }
  return typeof candidate.id === 'string'
    && candidate.id.length > 0
    && typeof candidate.renderFigure === 'function'
    && typeof candidate.renderDiagram === 'function'
}
