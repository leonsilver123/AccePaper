/**
 * When the designated sources are read, and what a missing tool means at that moment.
 *
 * THE DEFECT THIS PINS, measured on a real 1120 boot (2026-09-18): the engine read the library the
 * moment `tools` existed, while the Zotero MCP server was still starting its process and had not yet
 * answered `tools/list`. Every designated item came back `metadata-tool-missing` — **the deployment
 * reported itself as misconfigured when it was configured correctly**, because "the client is still
 * starting" and "this deployment mounts no such server" arrive as the same shrug.
 *
 * Both halves are here, and the second is the one that keeps the fix honest: a wait that never ends
 * would make the first half pass and hang every deployment that mounts nothing.
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import { ResearchEngine } from '../src/index.ts'

/** The item this deployment designates, as the live library holds it. */
const ITEM_KEY = 'UA5MIGG3'

/** One item record, as the local API returns it. */
const ITEM_RECORD = JSON.stringify({
  key: ITEM_KEY,
  version: 3408,
  library: { type: 'user', id: '17529257', name: 'My Library' },
  data: {
    itemType: 'journalArticle',
    title: 'Take-over control in critical brake situations',
    DOI: '10.1016/j.aap.2020.105588',
    date: '2020-09',
    publicationTitle: 'Accident Analysis and Prevention',
    creators: [{ lastName: 'Roche', firstName: 'Fabienne' }],
  },
})

/** The item's one PDF attachment. */
const CHILDREN = JSON.stringify([{
  key: 'PU2XWW83',
  version: 2690,
  data: { itemType: 'attachment', contentType: 'application/pdf', filename: 'Roche.pdf' },
}])

/**
 * The entry the metadata tool returns, as Better BibTeX writes one.
 *
 * One template literal rather than a concatenation: the newlines are part of the BibTeX this file is
 * standing in for, and writing them as escapes through a tool that decodes escapes is how a spec ends
 * up with a real newline inside a single-quoted string.
 */
const ENTRY = `@article{rocheWhatHappensWhen2020,
  title = {Take-over control in critical brake situations},
  author = {Roche, Fabienne},
  year = {2020},
  doi = {10.1016/j.aap.2020.105588},
}
`

/** The page tool's reply, in the shape the real server is measured to produce. */
const PAGE_REPLY = `# PDF Pages 1-1 of Take-over control\n**Item Key:** ${ITEM_KEY}\n`
  + '**Total pages in PDF:** 10\n\n## Page 1\n\nParticipants took over control after 1.2 s.'

/** A local stand-in for Zotero's HTTP API, answering the two endpoints the read uses. */
async function stubLibrary(): Promise<{ readonly base: string; readonly stop: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const path = (request.url ?? '').split('?')[0] ?? ''
    const body = path.endsWith('/children')
      ? CHILDREN
      : path.endsWith(`/items/${ITEM_KEY}`) ? ITEM_RECORD : '{}'
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(body)
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address() as AddressInfo
  return {
    base: `http://127.0.0.1:${String(port)}`,
    stop: () => new Promise<void>((resolve) => { server.close(() => { resolve() }) }),
  }
}

/**
 * The two tools the library route calls, as registry-ready definitions.
 *
 * THE REPLY SHAPE IS THE MCP CLIENT'S, and that is why this is not the content fixture. The fixture's
 * canonical value is a bare content array; the provider reads `toolText(result)` off `{ content: [...] }`,
 * which is the shape an MCP tool's result has. A stand-in with the wrong shape fails as "the tool
 * answered no text" — a different defect from the one under test, and one that would have sent a reader
 * after the provider.
 *
 * The registry validates a tool's shape, so a hand-written `{ name, execute }` is rejected outright:
 * the first version of this spec registered nothing, timed out, and reported `metadata-tool-missing`
 * while looking exactly like a client that had mounted and answered.
 *
 * @returns one definition per tool name.
 */
function zoteroTools(): ReadonlyArray<ToolDefinition> {
  const reply = (tool: string, text: string): ToolDefinition => defineTool({
    name: `mcp__zotero__${tool}`,
    description: 'a stub answering as the MCP client does',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: () => [{ type: 'text', text }],
    },
    execute: () => Promise.resolve({ content: [{ type: 'text', text }] }),
  })
  return [reply('zotero_get_item_metadata', ENTRY), reply('zotero_read_pdf_pages', PAGE_REPLY)]
}

/** What one engine build left behind. */
interface Built {
  readonly engine: ResearchEngine
  readonly stop: () => Promise<void>
}

/**
 * Boot an engine over a stubbed library, registering its tools late or never.
 *
 * The tools go onto the REAL `ctx.tools` — the same service a deployment's MCP client registers onto
 * — because a stand-in registry would let this file pass while the route the product uses disagreed.
 *
 * @param options - how long to wait before the tools exist, or `undefined` for never.
 * @returns the engine and a teardown that stops the stub.
 */
async function buildEngine(options: {
  readonly registerToolsAfterMs?: number
  readonly waitMs: number
  /** Names the library through `sourceLibrary` instead of through the search channel. */
  readonly separateFromSearch?: boolean
}): Promise<Built> {
  const host = await import('@deepseek-ai/' + 'dsh-system-prompt') as { default: new (ctx: Context) => unknown }
  const tools = await import('@deepseek-ai/' + 'dsh-tools') as { default: new (ctx: Context) => unknown }
  const library = await stubLibrary()
  const ctx = new Context()
  await ctx.plugin(host.default)
  await ctx.plugin(tools.default)

  // MOUNTED, NOT CONSTRUCTED. The registration starts from `[Service.init]` — the inject callback
  // that waits for `tools` — so an engine built with `new` never starts one, and the first version of
  // this spec read `registeredSources: []` with no failures: "not asked yet" looking exactly like
  // "nothing registered", which is the confusion this whole unit is about.
  const libraryConfig = {
    apiBase: library.base,
    localLibraryPath: 'users/0',
    mcpServerName: 'zotero',
    sourceRegistryMode: 'zotero',
    citedItems: [{ itemKey: ITEM_KEY, page: 1, bibtexKey: 'rocheWhatHappensWhen2020' }],
    sourceToolWaitMs: options.waitMs,
  }
  await ctx.plugin(ResearchEngine, (options.separateFromSearch === true
    // THE SEARCH SOURCE AND THE CITABLE LIBRARY ARE DIFFERENT QUESTIONS. This deployment searches a
    // catalogue and cites a curated library — which is the arrangement the single `literatureSearch`
    // switch could not express, and whose absence emptied a correctly-configured run.
    ? { literatureSearch: { kind: 'openalex' }, sourceLibrary: libraryConfig }
    : { literatureSearch: { kind: 'zotero', collectionKey: 'ILFASAAE', ...libraryConfig } }) as never)

  const engine = (ctx as Context & { research: ResearchEngine }).research
  if (options.registerToolsAfterMs !== undefined) {
    const registry = (ctx as Context & {
      tools: { register(tool: ToolDefinition): () => void }
    }).tools
    const entries = zoteroTools()
    setTimeout(() => {
      for (const entry of entries) registry.register(entry)
    }, options.registerToolsAfterMs)
  }
  return { engine, stop: library.stop }
}

const built: Built[] = []
afterEach(async () => {
  for (const entry of built.splice(0)) await entry.stop()
})

describe('reading the designated sources when the MCP client is still starting', () => {
  it('waits for the client\'s tools and then registers the source', async () => {
    // THE CASE THAT FAILED LIVE. The tools appear 400 ms after the engine is built, which is what a
    // server that spawns a process and answers `tools/list` over stdio looks like from here.
    const { engine, stop } = await buildEngine({ registerToolsAfterMs: 400, waitMs: 5_000 })
    built.push({ engine, stop })
    await engine.sourceRegistration
    // Joined, so a failure prints the read's own reason — the one thing a bare `toEqual([])` cannot
    // show, and exactly what this file exists to keep from being mistaken for something else.
    expect(engine.registrationFailures.join(' | ')).toBe('')
    expect(engine.registeredSources).toHaveLength(1)
    expect(engine.registeredSources[0]?.identity).toBe('zotero:user:17529257:UA5MIGG3')
    // And the evidence travelled with it, at the version the stub stated.
    expect(engine.registeredSources[0]?.evidence?.sourceVersion).toBe('3408')
  }, 20_000)

  it('registers the source when the library is configured apart from the search channel', async () => {
    // THE DECOUPLING ITSELF. A1 searches a catalogue; the manuscript cites the curated library. Before
    // this, naming a library for citation also replaced what A1 searched, and a run that was configured
    // correctly found nothing.
    const { engine, stop } = await buildEngine({
      registerToolsAfterMs: 0, waitMs: 5_000, separateFromSearch: true,
    })
    built.push({ engine, stop })
    await engine.sourceRegistration
    expect(engine.registrationFailures.join(' | ')).toBe('')
    expect(engine.registeredSources[0]?.identity).toBe('zotero:user:17529257:UA5MIGG3')
  }, 20_000)

  it('gives up and names the missing tool when no client ever registers one', async () => {
    // THE OTHER HALF, WITHOUT WHICH THE FIX WOULD BE "WAIT FOREVER". A deployment that mounts no
    // Zotero server must finish booting and say what is missing.
    const { engine, stop } = await buildEngine({ waitMs: 600 })
    built.push({ engine, stop })
    const started = Date.now()
    await engine.sourceRegistration
    expect(Date.now() - started).toBeGreaterThanOrEqual(500)
    expect(engine.registeredSources).toEqual([])
    expect(engine.registrationFailures.join(' ')).toContain('metadata-tool-missing')
    expect(engine.registrationFailures.join(' ')).toContain('zotero_get_item_metadata')
  }, 20_000)
})
