/**
 * The drawing provider, against the real library where the machine has it.
 *
 * TWO KINDS OF ASSERTION, and they are different evidence. A STAND-IN interpreter proves the seam:
 * what the provider sends, what it accepts, and what it refuses to accept. A REAL interpreter proves
 * the provider — that the JSON it writes is what matplotlib reads and that what comes back is a figure
 * a document can carry. The second runs only where a machine has the library, and says so where it
 * does not, because a test that silently skipped is indistinguishable from one that passed.
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MatplotlibProvider } from '../src/matplotlib-provider.ts'
import type { PythonRunner } from '../src/matplotlib-provider.ts'

/** A PNG's first eight bytes, base64 — what a real raster begins with. */
const PNG_BASE64_PREFIX = 'iVBORw0KGgo'

/** A one-pixel PNG, so a stand-in can answer with something that really is one. */
const TINY_PNG_BASE64 = `${PNG_BASE64_PREFIX}AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==`

/**
 * The interpreter this machine has matplotlib on, when it has one.
 *
 * The shipped deployment names its own — a virtual environment's interpreter, never the system one —
 * so the search here is for a HOST to verify against, not a default the product would use.
 *
 * @returns the interpreter, or undefined when this machine cannot draw.
 */
function realPython(): string | undefined {
  const candidates = [
    process.env['DSH_MATPLOTLIB_PYTHON'],
    '.workbuddy/tmp/plot-venv/Scripts/python.exe',
    '.workbuddy/tmp/plot-venv/bin/python',
  ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)
  return candidates.find(candidate => existsSync(candidate))
}

const PYTHON = realPython()

/**
 * The probed provider, ONCE for the whole file.
 *
 * Probing is a process spawn plus a matplotlib import, and this file ran four of them per execution —
 * under a full parallel suite that was measured as an intermittent failure while the file passed on
 * its own. One probe, shared, is fewer processes and one thing to diagnose.
 */
const PROVIDER = PYTHON === undefined
  ? undefined
  : await MatplotlibProvider.probe({ executable: PYTHON, timeoutMs: 300_000 })

/** A runner that answers with a fixed result and records what it was asked. */
function standIn(answer: string, code = 0): { readonly runner: PythonRunner; readonly calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    runner: (executable, args, stdin) => {
      calls.push(`${executable} ${args.join(' ')} ${stdin}`)
      return Promise.resolve({ code, stdout: answer, stderr: code === 0 ? '' : 'no such module' })
    },
  }
}

/** The answer a working interpreter gives: both formats, as JSON on the last line. */
function goodAnswer(): string {
  return `some warning line\n${JSON.stringify({ svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', pngBase64: TINY_PNG_BASE64, version: '3.11.2' })}`
}

const CHART = {
  title: 'A chart',
  width: 480,
  height: 360,
  kind: 'bar' as const,
  xLabel: 'composition',
  yLabel: 'value',
  categories: ['a', 'b'],
  series: [{ name: 's', values: [1, 2] }],
}

const DIAGRAM = {
  title: 'A roadmap',
  nodes: [{ id: 'n1', label: 'one' }, { id: 'n2', label: 'two' }],
  edges: [{ from: 'n1', to: 'n2', label: 'then' }],
}

describe('a deployment with no library gets no provider', () => {
  it('answers undefined when the interpreter cannot import matplotlib', async () => {
    // PROBED, NOT ASSUMED. Whether an interpreter has the library is a fact only the machine has, and
    // a provider built without asking fails at the first figure — which is D1, five steps into a run
    // whose earlier gates have closed.
    const { runner } = standIn('', 1)
    expect(await MatplotlibProvider.probe({ executable: 'python' }, runner)).toBeUndefined()
  })

  it('answers undefined when the interpreter does not exist at all', async () => {
    const runner: PythonRunner = () => Promise.reject(new Error('could not run'))
    expect(await MatplotlibProvider.probe({ executable: 'nope' }, runner)).toBeUndefined()
  })
})

describe('a provider that drew a figure', () => {
  it('reads the result off the interpreter, past whatever else it printed', async () => {
    const { runner, calls } = standIn(goodAnswer())
    const provider = await MatplotlibProvider.probe({ executable: 'python' }, runner)
    expect(provider).toBeDefined()
    const drawn = await provider?.renderChart(CHART)
    expect(drawn?.svg).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>')
    expect(drawn?.pngBase64).toBe(TINY_PNG_BASE64)
    expect(drawn?.width).toBe(480)
    // THE REQUEST CROSSES AS JSON, which is what the Python side reads: a provider that passed a
    // figure spec object would work in tests and fail against a real interpreter.
    expect(calls.at(-1)).toContain('"mode":"chart"')
    expect(calls.at(-1)).toContain('"categories":["a","b"]')
  })

  it('reports the library version the machine gave it', async () => {
    const { runner } = standIn('3.11.2\n')
    const provider = await MatplotlibProvider.probe({ executable: 'python' }, runner)
    expect(provider?.toolVersion).toBe('3.11.2')
  })

  it('refuses an interpreter that exited non-zero, naming what it said', async () => {
    const { runner } = standIn('', 1)
    const provider = new MatplotlibProvider({ executable: 'python' }, runner)
    await expect(provider.renderChart(CHART)).rejects.toThrow(/exited 1[\s\S]*no such module/u)
  })

  it('refuses an answer that is not a figure, rather than embedding it', async () => {
    // A PROVIDER THAT ANSWERED WITH SOMETHING ELSE would put markup no reader can render into the
    // manuscript, and the compile would report the float as embedded. Both halves are checked.
    const notSvg = standIn(JSON.stringify({ svg: 'not markup', pngBase64: TINY_PNG_BASE64 }))
    const a = new MatplotlibProvider({ executable: 'python' }, notSvg.runner)
    await expect(a.renderChart(CHART)).rejects.toThrow(/not an SVG/u)

    const notPng = standIn(JSON.stringify({ svg: '<svg/>', pngBase64: 'bm90IGEgcG5n' }))
    const b = new MatplotlibProvider({ executable: 'python' }, notPng.runner)
    await expect(b.renderChart(CHART)).rejects.toThrow(/not a PNG/u)

    const notJson = standIn('Traceback (most recent call last)')
    const c = new MatplotlibProvider({ executable: 'python' }, notJson.runner)
    await expect(c.renderChart(CHART)).rejects.toThrow(/not its result JSON/u)
  })

  it('draws a diagram as well as a chart, from the graph the study asked for', async () => {
    // THE FLOAT THE COMPILED DOCUMENT COULD NOT CARRY. A roadmap left as mermaid source is text to
    // LaTeX and nothing to a PDF reader; drawn, it is a figure like any other.
    const { runner, calls } = standIn(goodAnswer())
    const provider = new MatplotlibProvider({ executable: 'python' }, runner)
    const drawn = await provider.renderDiagramRequest(DIAGRAM)
    expect(drawn.svg).toContain('<svg')
    expect(calls.at(-1)).toContain('"mode":"diagram"')
    expect(calls.at(-1)).toContain('"from":"n1"')
  })
})

// THE TIMEOUT IS THE TEST'S, not the product's: the shipped default is 30 seconds, which a cold
// matplotlib import under a full parallel suite can exceed — measured as a flaky failure that passed
// whenever the file ran alone.
describe.skipIf(PYTHON === undefined || PROVIDER === undefined)('the provider, against the real library', () => {
  it('draws a chart the machine actually rendered', async () => {
    const provider = PROVIDER
    expect(provider, 'a probed interpreter that cannot draw').toBeDefined()
    const drawn = await provider?.renderChart({
      ...CHART,
      kind: 'line',
      categories: ['100', '200', '300'],
      series: [
        { name: 'no coalescing', values: [236.67, 436.67, 636.67] },
        { name: 'coalesced', values: [86.67, 120, 120] },
      ],
    })
    // A REAL FIGURE: markup matplotlib produced, and a raster a LaTeX document can carry. Asserting
    // the signature rather than the length, because the size is the library's business.
    expect(drawn?.svg).toContain('<svg')
    expect(drawn?.svg).toContain('</svg>')
    expect(drawn?.pngBase64.startsWith(PNG_BASE64_PREFIX)).toBe(true)
    expect((drawn?.svg.length ?? 0)).toBeGreaterThan(1000)
  })

  it('draws a roadmap the machine actually rendered', async () => {
    const provider = PROVIDER
    const drawn = await provider?.renderDiagramRequest(DIAGRAM)
    expect(drawn?.svg).toContain('<svg')
    expect(drawn?.pngBase64.startsWith(PNG_BASE64_PREFIX)).toBe(true)
  })

  it('reports the library version it probed', () => {
    expect(PROVIDER?.toolVersion).toMatch(/^\d+\.\d+/u)
  })
})
