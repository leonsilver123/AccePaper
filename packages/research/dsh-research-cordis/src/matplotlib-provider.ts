// @deepseek-ai/dsh-research-cordis — the deployment's drawing capability, driven by matplotlib.
//
// WHY HERE. Whether a machine has a scientific plotting library is a property of the DEPLOYMENT, not of
// the research packages: they state the seam (`FigureProvider`) and this file is what a deployment with
// the library fills it with. The same reasoning as the document compiler and the prose channel — a run
// under a deployment that configured none still draws its floats with the built-in renderer and its
// artifact says which one drew them.
//
// WHY MATPLOTLIB. The built-in renderer is deterministic and dependency-free, which is why it ships,
// and it is not a plotting library: its typography, scales and tick placement are a small renderer's,
// and a paper whose figures read as test fixtures is a paper a referee reads differently. Matplotlib is
// the library this field's papers are drawn with.
//
// WHAT IT DRAWS, AND IN WHAT. Both formats from ONE render: the SVG the HTML manuscript inlines and the
// base64 PNG LaTeX can carry. A provider that produced only one would lose the figure in half the
// formats, which is the loss the compile refuses rather than reports.
//
// WHAT IT REFUSES. The library is PROBED at construction, so a deployment without it offers no provider
// rather than failing at D1 — five steps into a run whose earlier gates had closed. A script that exits
// non-zero is reported with its own stderr; output that is not an SVG and a PNG is refused as a
// provider fault rather than embedded as a figure.
//
// WHAT IT IS NOT. It does not fetch, does not decide what a figure should show, and does not judge
// whether a chart is legible — the presentation plan states what to draw, and the visual review (M09)
// judges the result.

import { spawn } from 'node:child_process'

// THE SEAM IS SATISFIED STRUCTURALLY, the way the document compiler is: this package does not import
// the research-team package, which would invert the dependency direction between them. What crosses is
// the JSON the Python side reads and the two strings it answers with.

/** A figure spec as this provider reads it: the fields of the pipeline's, declared here. */
export interface FigureSpecLike {
  readonly kind?: 'bar' | 'line'
  readonly title: string
  readonly width: number
  readonly height: number
  readonly series: ReadonlyArray<{ readonly name: string; readonly values: ReadonlyArray<number> }>
  readonly axes?: {
    readonly xLabel?: string
    readonly yLabel?: string
    readonly categories?: ReadonlyArray<string>
  }
}

/** A roadmap graph as this provider reads it: the fields of the pipeline's, declared here. */
export interface RoadmapGraphLike {
  readonly title?: string
  readonly nodes: ReadonlyArray<{ readonly id: string; readonly label: string }>
  readonly edges: ReadonlyArray<{ readonly from: string; readonly to: string; readonly label?: string }>
}

/** How one figure is drawn, as this provider needs it. */
export interface ChartRequest {
  readonly title: string
  readonly width: number
  readonly height: number
  readonly kind: 'bar' | 'line'
  readonly xLabel: string
  readonly yLabel: string
  /** The category labels, one per value. */
  readonly categories: ReadonlyArray<string>
  readonly series: ReadonlyArray<{ readonly name: string; readonly values: ReadonlyArray<number> }>
}

/** How one diagram is drawn: a graph of labelled boxes and the edges between them. */
export interface DiagramRequest {
  readonly title: string
  readonly nodes: ReadonlyArray<{ readonly id: string; readonly label: string }>
  readonly edges: ReadonlyArray<{ readonly from: string; readonly to: string; readonly label: string }>
}

/** What one render produced. */
export interface ProviderFigure {
  readonly svg: string
  readonly pngBase64: string
  readonly width: number
  readonly height: number
  /**
   * What drew this figure, and which version of it.
   *
   * THEY TRAVEL ON THE FIGURE, not only on the provider, because that is the shape the drawing seam
   * hands back: a float records the code that drew it, so two packages whose charts differ name two
   * libraries rather than leaving a reader to guess from the pixels. The type is stated here as plain
   * strings rather than imported from the seam, because `dsh-research-team` is not a dependency of
   * this package — the two are structurally compatible, and the spec that drives a real run with this
   * provider is where that is checked.
   */
  readonly tool: string
  readonly toolVersion: string
}

/** How this provider runs its Python. Injectable so a test can drive the seam without a library. */
export type PythonRunner = (
  executable: string,
  args: ReadonlyArray<string>,
  stdin: string,
  timeoutMs: number,
) => Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>

/** The deployment's configuration of this provider. */
export interface MatplotlibConfig {
  /** The Python interpreter that has matplotlib. A venv's, usually — not the system one. */
  readonly executable: string
  readonly timeoutMs?: number
  /** The canvas the charts are drawn on. Deployment-varying, so it is configuration. */
  readonly width?: number
  readonly height?: number
}

/** The shipped timeout: a chart is milliseconds of work, and a hung interpreter is not a slow one. */
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_WIDTH = 720
const DEFAULT_HEIGHT = 360

/**
 * The script this provider runs.
 *
 * IT IS WRITTEN TO THE TEMPORARY DIRECTORY rather than shipped as a file: what crosses the process
 * boundary is one script and its JSON, and a `.py` asset beside built JavaScript would have to be found
 * at run time from a path that differs between a source launch and an installed copy.
 */
const SCRIPT = `import base64, io, json, sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch

request = json.loads(sys.stdin.read())
width, height = request['width'], request['height']
fig, ax = plt.subplots(figsize=(width / 100.0, height / 100.0), dpi=100)
if request['mode'] == 'chart':
    xs = list(range(len(request['categories'])))
    for series in request['series']:
        if request['kind'] == 'bar':
            ax.bar([x + 0.0 for x in xs], series['values'], label=series['name'])
        else:
            ax.plot(xs, series['values'], marker='o', label=series['name'])
    ax.set_xticks(xs)
    ax.set_xticklabels(request['categories'], rotation=15, ha='right')
    ax.set_xlabel(request['xLabel'])
    ax.set_ylabel(request['yLabel'])
    if len(request['series']) > 1:
        ax.legend(loc='upper right')
else:
    ids = [node['id'] for node in request['nodes']]
    index = {node_id: position for position, node_id in enumerate(ids)}
    for node in request['nodes']:
        position = index[node['id']]
        ax.add_patch(plt.Rectangle((0.05, position * 0.9), 0.5, 0.6,
                                   facecolor='#eef3fa', edgecolor='#33608f'))
        ax.text(0.3, position * 0.9 + 0.3, node['label'], ha='center', va='center', fontsize=9)
    for edge in request['edges']:
        ax.add_patch(FancyArrowPatch((0.55, index[edge['from']] * 0.9 + 0.3),
                                     (0.75, index[edge['to']] * 0.9 + 0.3),
                                     arrowstyle='-|>', mutation_scale=10, color='#555555'))
        ax.text(0.65, (index[edge['from']] + index[edge['to']]) * 0.45 + 0.42, edge['label'],
                fontsize=7, ha='center')
    ax.set_xlim(0, 1)
    ax.set_ylim(-0.2, max(1, len(ids)) * 0.9)
    ax.axis('off')
ax.set_title(request['title'])
fig.tight_layout()
svg_buffer = io.StringIO()
fig.savefig(svg_buffer, format='svg')
png_buffer = io.BytesIO()
fig.savefig(png_buffer, format='png')
plt.close(fig)
print(json.dumps({
    'svg': svg_buffer.getvalue(),
    'pngBase64': base64.b64encode(png_buffer.getvalue()).decode('ascii'),
    'version': matplotlib.__version__,
}))
`

/** Run one command to completion, returning its exit code and streams. */
function defaultRunner(
  executable: string,
  args: ReadonlyArray<string>,
  stdin: string,
  timeoutMs: number,
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`'${executable}' did not finish within ${String(timeoutMs)} ms`))
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (error: Error) => {
      clearTimeout(timer)
      reject(new Error(`could not run '${executable}': ${error.message}`))
    })
    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
    child.stdin.end(stdin)
  })
}

/**
 * Draw figures with matplotlib, through the interpreter a deployment names.
 *
 * @param config - the interpreter and the canvas.
 * @param runner - how a process is run; the host's own spawn by default, and a seam a test injects.
 */
export class MatplotlibProvider {
  /** The provider's identifier, recorded on every float it draws. */
  readonly id = 'matplotlib'
  private readonly config: MatplotlibConfig
  private readonly runner: PythonRunner
  private version = ''

  constructor(config: MatplotlibConfig, runner: PythonRunner = defaultRunner) {
    this.config = config
    this.runner = runner
  }

  /**
   * Ask the machine whether this interpreter has the library, and build the provider that matches.
   *
   * PROBED, NOT ASSUMED. A deployment states an interpreter; whether matplotlib is importable there is
   * a fact only the machine has, and a provider built without asking fails at the first figure — which
   * is D1, after the gates before it have closed.
   *
   * @param config - the interpreter and the canvas.
   * @param runner - how a process is run.
   * @returns the provider, or undefined when this interpreter cannot draw.
   */
  static async probe(
    config: MatplotlibConfig,
    runner: PythonRunner = defaultRunner,
  ): Promise<MatplotlibProvider | undefined> {
    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const probe = await runner(
      config.executable,
      ['-c', 'import matplotlib; print(matplotlib.__version__)'],
      '',
      timeoutMs,
    ).catch(() => undefined)
    if (probe === undefined || probe.code !== 0) return undefined
    const provider = new MatplotlibProvider(config, runner)
    provider.version = probe.stdout.trim()
    return provider
  }

  /** The library version this provider asked the machine for. */
  get toolVersion(): string {
    return this.version
  }

  /**
   * Draw one chart.
   *
   * @param request - the chart, as this provider needs it.
   * @returns the drawn figure in both formats.
   * @throws {Error} when the interpreter refuses, naming what it said.
   */
  async renderChart(request: ChartRequest): Promise<ProviderFigure> {
    return this.draw({ mode: 'chart', ...request, width: this.widthOf(request), height: this.heightOf(request) })
  }

  /**
   * Draw one diagram.
   *
   * @param request - the graph, as this provider needs it.
   * @returns the drawn diagram in both formats.
   * @throws {Error} when the interpreter refuses, naming what it said.
   */
  async renderDiagramRequest(request: DiagramRequest): Promise<ProviderFigure> {
    return this.draw({
      mode: 'diagram',
      ...request,
      width: this.config.width ?? DEFAULT_WIDTH,
      height: this.config.height ?? DEFAULT_HEIGHT,
    })
  }

  /** The canvas a chart is drawn on. */
  private widthOf(request: { readonly width?: number }): number {
    return request.width ?? this.config.width ?? DEFAULT_WIDTH
  }

  /** The canvas a chart is drawn on. */
  private heightOf(request: { readonly height?: number }): number {
    return request.height ?? this.config.height ?? DEFAULT_HEIGHT
  }

  /**
   * Draw one chart, from the shape the research pipeline's seam passes.
   *
   * STRUCTURAL, not a shared interface: this package cannot import the research-team package without
   * inverting the dependency direction, so the two shapes agree by declaration rather than by import.
   *
   * @param spec - the figure spec the presentation plan was rendered into.
   * @returns the drawn figure in both formats.
   * @throws {Error} when the deployment's interpreter cannot draw it.
   */
  async renderFigure(spec: FigureSpecLike): Promise<ProviderFigure> {
    return this.renderChart({
      title: spec.title,
      width: spec.width,
      height: spec.height,
      kind: spec.kind ?? 'bar',
      xLabel: spec.axes?.xLabel ?? '',
      yLabel: spec.axes?.yLabel ?? '',
      categories: spec.axes?.categories ?? spec.series[0]?.values.map((_, index) => String(index + 1)) ?? [],
      series: spec.series.map(series => ({ name: series.name, values: series.values })),
    })
  }

  /**
   * Draw one diagram, from the shape the research pipeline's seam passes.
   *
   * A DIAGRAM IS A PICTURE, and this is what makes the compiled document carry it: the alternative is
   * mermaid source, which LaTeX renders as text and no PDF reader draws.
   *
   * @param graph - the roadmap graph the study's presentation asked for.
   * @returns the drawn diagram in both formats.
   * @throws {Error} when the deployment's interpreter cannot draw it.
   */
  async renderDiagram(graph: RoadmapGraphLike): Promise<ProviderFigure> {
    return this.renderDiagramRequest({
      title: graph.title ?? 'Research roadmap',
      nodes: graph.nodes.map(node => ({ id: node.id, label: node.label })),
      edges: graph.edges.map(edge => ({ from: edge.from, to: edge.to, label: edge.label ?? '' })),
    })
  }

  /**
   * Run the script over one request and read its answer.
   *
   * THE ANSWER IS CHECKED, not trusted: the SVG must be an SVG and the raster must begin with the PNG
   * signature, because a provider that returned a string for either would put a figure the reader
   * cannot see into the manuscript, and the compile would report it as embedded.
   */
  private async draw(request: Record<string, unknown>): Promise<ProviderFigure> {
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const width = Number(request['width'] ?? DEFAULT_WIDTH)
    const height = Number(request['height'] ?? DEFAULT_HEIGHT)
    const result = await this.runner(
      this.config.executable,
      ['-c', SCRIPT],
      JSON.stringify(request),
      timeoutMs,
    )
    if (result.code !== 0) {
      throw new Error(
        `[matplotlib] '${this.config.executable}' exited ${String(result.code)}: `
        + (result.stderr.trim() || 'no stderr'),
      )
    }
    const parsed = parseAnswer(result.stdout)
    if (!parsed.svg.trimStart().startsWith('<')) {
      throw new Error(
        '[matplotlib] the interpreter answered with something that is not an SVG, so the float would'
        + ' reach the manuscript as markup no reader can render',
      )
    }
    if (!parsed.pngBase64.startsWith('iVBORw0KGgo')) {
      throw new Error(
        '[matplotlib] the interpreter answered with something that is not a PNG, so the float would'
        + ' reach a LaTeX document as bytes no reader can render',
      )
    }
    return {
      svg: parsed.svg,
      pngBase64: parsed.pngBase64,
      width,
      height,
      tool: this.id,
      toolVersion: this.toolVersion,
    }
  }
}

/** One answer from the script, or a refusal naming what came back instead. */
function parseAnswer(stdout: string): { readonly svg: string; readonly pngBase64: string } {
  const lastLine = stdout.trim().split('\n').at(-1) ?? ''
  let parsed: unknown
  try {
    parsed = JSON.parse(lastLine)
  } catch {
    throw new Error(
      '[matplotlib] the interpreter answered with something that is not its result JSON: '
      + `'${lastLine.slice(0, 120)}'`,
    )
  }
  const record = parsed as { svg?: unknown; pngBase64?: unknown }
  if (typeof record.svg !== 'string' || typeof record.pngBase64 !== 'string') {
    throw new Error('[matplotlib] the interpreter answered without both formats of the figure')
  }
  return { svg: record.svg, pngBase64: record.pngBase64 }
}
