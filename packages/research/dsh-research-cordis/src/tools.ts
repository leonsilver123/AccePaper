/**
 * Research Tool Runtime Registration (T13-R) — cordis adapter.
 *
 * Registers the seven P2 research tools on `ctx.tools` (defineTool +
 * ctx.tools.register), driven by the RESEARCH_TOOL_DIRECTORY catalog so tool
 * name/version/exposure can never drift from the pure tool package. Every
 * handler routes execution through the SINGLE executeResearchTool adapter with
 * fixture dependencies injected by this closure — an agent call can never
 * supply an adapter, and the pipeline executor path can never diverge.
 *
 * Exposure policy:
 *  - `model_ready`   (figure / three-line-table / roadmap): registered and
 *    agent-callable (pure renders over declared data).
 *  - `pipeline_only` (literature-search / citation-verify / claim-construct /
 *    ablation): registered for discovery and pipeline use, but a context guard
 *    DENIES any agent-loop execution — their real input is an injected adapter
 *    or the canonical fixture scenario, not model arguments.
 *
 * THIS FILE is what decides which corpus the tools run over, and it holds no
 * literal for it: `Config.literatureSearch` / `Config.citationResolver` /
 * `Config.prose` select the channels (see index.ts). With none configured the
 * corpus is the mock adapter and `live_external` is 0; with `openalex` the
 * literature and citation paths reach a real catalogue, and the artifacts — not
 * this comment — record which one ran.
 *
 * Type seam: the model-facing `@deepseek-ai/dsh-tools` surface is only needed
 * at RUNTIME (defineTool). It is loaded dynamically with a non-literal
 * specifier so the host tool package's type graph never enters this package's
 * compilation; the structural faces below are the only contract relied on and
 * are enforced by the real register/guard at runtime.
 */
import type { Context } from '@deepseek-ai/cordis'
import { MockCitationResolverAdapter } from '@deepseek-ai/dsh-research-core'
import type { SourceRegistryMode } from '@deepseek-ai/dsh-research-core'
import type { CitedItem } from './zotero-registration.ts'
import type { LiteratureSearchAdapter } from '@deepseek-ai/dsh-research-tools'

import { OpenAlexLiteratureAdapter } from './openalex-adapter.ts'
import { OpenAlexCitationResolver } from './openalex-citation-resolver.ts'
import type { ResearchToolDeps } from '@deepseek-ai/dsh-research-tools'
import {
  RESEARCH_TOOL_DIRECTORY,
  executeResearchTool,
} from '@deepseek-ai/dsh-research-tools'
import type { ModelExposure } from '@deepseek-ai/dsh-research-tools'

/** Structural face of one registered model-facing tool (built by real defineTool). */
export interface RegisteredTool {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: unknown
    render(args: unknown, value: unknown): unknown
  }
  readonly timeoutMs?: number
  execute(args: unknown, exec: unknown): Promise<unknown>
}

/** Structural face of the ctx.tools registry (ToolRuntime). */
export interface ToolRegistryFace {
  register(definition: RegisteredTool): () => void
  guard(guard: (execution: Readonly<{ agent?: unknown; name?: string }>) => string | undefined): () => void
  get(name: string): RegisteredTool | undefined
}

/**
 * Non-enumerable identity marker placed on every ToolDefinition THIS module
 * registers. Readiness uses it to prove the registered definition is OURS
 * (same version/exposure/instance), so a pre-existing impostor object under a
 * catalog name can never satisfy the check. Module-private: never exported,
 * never surfaced in schemas or on ctx.research.
 */
const REGISTRATION_MARKER = Symbol('research.registered.tool')

/** Marker payload captured at registration time (snapshot of the catalog). */
interface RegistrationMarker {
  readonly toolId: string
  readonly version: string
  readonly modelExposure: ModelExposure
}

function attachMarker(def: RegisteredTool, meta: RegistrationMarker): void {
  Object.defineProperty(def, REGISTRATION_MARKER, {
    value: meta,
    enumerable: false,
    configurable: false,
    writable: false,
  })
}

function readMarker(def: RegisteredTool | undefined): RegistrationMarker | undefined {
  if (def === undefined) return undefined
  return (def as unknown as { [REGISTRATION_MARKER]?: RegistrationMarker })[REGISTRATION_MARKER]
}

/** Registration metadata mirroring the catalog (assertable by tests). */
export interface ResearchToolRegistrationMeta {
  readonly toolId: string
  readonly version: string
  readonly modelExposure: ModelExposure
}

/** name → {version, modelExposure}, built straight from the catalog. */
export const RESEARCH_TOOL_REGISTRATION: Readonly<Record<string, ResearchToolRegistrationMeta>> =
  Object.fromEntries(
    RESEARCH_TOOL_DIRECTORY.map(entry => [entry.toolId, {
      toolId: entry.toolId,
      version: entry.version,
      modelExposure: entry.modelExposure,
    }]),
  )

/**
 * Exposure guard: `pipeline_only` research tools are NEVER reachable through
 * the agent-loop tool runtime. The guard denies unconditionally — it does NOT
 * trust "no agent field" as an internal signal (absent/forged/empty agent
 * fields are indistinguishable from a crafted context, so absence is never
 * treated as permission). Legitimate pipeline use of pipeline_only tools does
 * not route through ctx.tools at all (DirectResearchToolInvoker → the pure
 * adapter), which is why a blanket denial cannot lock out real work.
 *
 * `model_ready` tools pass the guard; their exposure to a concrete agent is
 * still granted ONLY by that agent's allow-list (see
 * {@link modelReadyResearchToolIds}) applied through ctx.tools.restrict at the
 * agent scope — never by default schema presence.
 *
 * @param toolId - the tool this guard is installed for; the guard affects only executions
 *   carrying this name.
 * @param exposure - the tool's declared model exposure.
 * @returns a predicate over one execution that returns a refusal message, or undefined to allow it.
 */
export function researchToolExposureGuard(
  toolId: string,
  exposure: ModelExposure,
): (execution: Readonly<{ agent?: unknown; name?: string }>) => string | undefined {
  return (execution) => {
    if (exposure === 'model_ready') return undefined
    // Guards are GLOBAL in the registry: a guard must only affect executions
    // of ITS OWN tool name, otherwise one pipeline_only guard would deny every
    // model_ready call too (regression caught by the AgentLoop closed loop).
    if (execution.name !== toolId) return undefined
    return `[${toolId}] is pipeline-only (injected-adapter/fixture input); `
      + 'it is registered for discovery and internal pipeline use only — not executable through the agent tool runtime'
  }
}

/**
 * Tool ids the agent loop may be ALLOWED to call (model-ready renders).
 *
 * @returns the ids whose declared exposure is `model_ready`, in catalogue order.
 */
export function modelReadyResearchToolIds(): ReadonlyArray<string> {
  return RESEARCH_TOOL_DIRECTORY
    .filter(entry => entry.modelExposure === 'model_ready')
    .map(entry => entry.toolId)
}

/** Fixture dependency bundle injected by this closure (live_external = 0). */
const FIXTURE_DEPS: ResearchToolDeps = {
  citationDeps: { resolver: new MockCitationResolverAdapter() },
}

/** Retrieval channel selection as it arrives from the plugin's `cordis.yml` config. */
export type LiteratureChannel =
  | {
    /** Search the synthetic corpus this package ships; no network is reached. */
    readonly kind: 'fixture'
  }
  | {
    /** Search the real OpenAlex catalogue. */
    readonly kind: 'openalex'
    /** Contact address OpenAlex asks for ("polite pool"); improves reliability. */
    readonly mailto?: string
  }
  | {
    /**
     * Answer from a Zotero collection this deployment assembled.
     *
     * NOT A SEARCH CHANNEL: the corpus is the list somebody put in the collection, and the topic is
     * matched against titles and abstracts as a local filter. Every field here is a deployment
     * setting — an endpoint, the library it addresses, and which collection is the corpus — never a
     * request parameter, so a caller cannot widen the read to another library or another address.
     */
    readonly kind: 'zotero'
    /** The local API's origin, e.g. `http://127.0.0.1:23119/api`. */
    readonly apiBase: string
    /** The library as the local endpoint addresses it: `users/0` for the signed-in user. */
    readonly localLibraryPath: string
    /** The collection whose members are this deployment's corpus. */
    readonly collectionKey: string
    /** The MCP client's namespace for the Zotero server, e.g. `zotero`. */
    readonly mcpServerName: string
    readonly timeoutMs?: number
    readonly pageSize?: number
    /** The venue to record for an item whose own record states none. */
    readonly fallbackVenue?: string
    /**
     * Which registry this run draws its citable sources from.
     *
     * Absent means `zotero`: a deployment that configured this channel named a library as its
     * evidence, and drawing on the checked-in corpus as well would put sources in the bibliography
     * that this deployment never pointed at.
     */
    readonly sourceRegistryMode?: SourceRegistryMode
    /**
     * The items this deployment designates as sources its runs may cite, each with the page its
     * evidence is read from and the key its bibliographic entry carries.
     *
     * A run cites what is here and nothing else, so an item that could not be read leaves the run with
     * fewer sources than it named — or none — rather than with a corpus from somewhere else.
     */
    readonly citedItems?: ReadonlyArray<CitedItem>
  }

/** Bibliographic-resolver selection, configured the same way as the channel above. */
export type CitationChannel =
  | {
    /** Resolve against the synthetic records this package ships; no network is reached. */
    readonly kind: 'fixture'
  }
  | {
    /** Resolve against the real OpenAlex catalogue, where a fabricated identifier returns
     *  `not_found` rather than a fixture verdict. */
    readonly kind: 'openalex'
    /** Contact address OpenAlex asks for ("polite pool"); improves reliability. */
    readonly mailto?: string
  }

/**
 * Assemble the tool dependency graph for one deployment's retrieval channel.
 * `'fixture'` (and an absent channel) reproduce the offline graph exactly; a real
 * channel substitutes the network adapter, so the artifacts downstream carry real
 * catalogue records instead of synthetic ones.
 *
 * @param channel - the configured retrieval channel, or undefined for the fixture.
 * @param citation - the configured citation-resolver channel, or undefined for the fixture.
 * @param zotero - the adapter for a `zotero` channel, which the engine builds because it needs the
 *   host's `tools` service for the metadata route. Required when `channel` names that kind: the
 *   assembly throws rather than falling back to the fixture corpus.
 * @returns the dependency graph handed to every tool invocation.
 */
export function buildToolDeps(
  channel: LiteratureChannel | undefined,
  citation?: CitationChannel,
  zotero?: LiteratureSearchAdapter,
): ResearchToolDeps {
  const deps: ResearchToolDeps = {
    ...FIXTURE_DEPS,
    // THE ADAPTER IS BUILT BY THE ENGINE, not here: it needs the host's `tools` service for the
    // metadata route, and this module assembles pure dependencies. A channel that names a Zotero
    // corpus and arrives without its adapter is a wiring defect and is refused by name rather than
    // falling back to the fixture corpus — which would answer every query from synthetic records
    // while the artifact said the deployment read its own library.
    ...(channel?.kind === 'zotero'
      ? zotero === undefined
        ? (() => { throw new Error(
          '[research] the zotero literature channel has no adapter: the engine builds it from the'
          + ' host tool registry, so this is a wiring defect and not a missing dependency') })()
        : { literatureAdapter: zotero }
      : {}),
    ...(channel?.kind === 'openalex'
      ? {
        literatureAdapter: new OpenAlexLiteratureAdapter(
          channel.mailto !== undefined ? { mailto: channel.mailto } : {},
        ),
      }
      : {}),
    ...(citation?.kind === 'openalex'
      ? {
        citationDeps: {
          resolver: new OpenAlexCitationResolver(
            citation.mailto !== undefined ? { mailto: citation.mailto } : {},
          ),
        },
      }
      : {}),
  }
  return deps
}

/** JSON-safe model-facing projection of a research artifact (drops Buffer bytes). */
function toJsonSafe(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return { __bytes: value.length, base64: value.toString('base64') }
  }
  if (Array.isArray(value)) return value.map(toJsonSafe)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toJsonSafe(item)]),
    )
  }
  return value
}

const jsonTextRender = (_args: unknown, value: unknown) => [
  { type: 'text' as const, text: JSON.stringify(value, null, 2) },
]

/**
 * Build the model-facing handler bound to one deployment's tool dependencies.
 * Returning a factory keeps the per-tool call sites below unchanged while letting
 * the assembled deps (fixture vs. a real retrieval channel) flow from the
 * plugin's Config down to the single executeResearchTool dispatch.
 *
 * Asynchronous: the dispatch is async because externally-backed tools perform a
 * network round trip. Without the await, `toJsonSafe` would serialize a Promise.
 */
function makeHandler(deps: ResearchToolDeps) {
  return (toolId: string, toInput: (args: Record<string, unknown>) => unknown) => {
    return async (args: Record<string, unknown>): Promise<unknown> => {
      const artifact = await executeResearchTool(toolId, toInput(args), deps, Date.now())
      return toJsonSafe(artifact)
    }
  }
}

type DefineToolLoader = (options: Record<string, unknown>) => RegisteredTool

/**
 * Fixed, non-configurable host module id of the model-facing tool runtime.
 * The loader NEVER accepts an arbitrary module path — only this constant is
 * imported, and its shape is validated before anything is registered
 * (fail-closed on missing/foreign `defineTool`). See the header note for why
 * the import is runtime-dynamic (base tsconfig `paths` forces the host tool
 * package to its src tree, whose transitive graph does not belong to this
 * package's compilation).
 */
const DSH_TOOLS_MODULE_ID = 'dsh-tools'

/** Stable error codes for the runtime host-module compatibility layer. */
export const RESEARCH_TOOL_HOST_ERROR_CODES = {
  HOST_LOAD_FAILED: 'RESEARCH_TOOL_HOST_LOAD_FAILED',
  HOST_SHAPE_INVALID: 'RESEARCH_TOOL_HOST_SHAPE_INVALID',
  HOST_API_MISMATCH: 'RESEARCH_TOOL_HOST_API_MISMATCH',
  HOST_VERSION_UNSUPPORTED: 'RESEARCH_TOOL_HOST_VERSION_UNSUPPORTED',
} as const

/** One of the stable codes above, as the error classes and callers carry it. */
export type ResearchToolHostErrorCode =
  (typeof RESEARCH_TOOL_HOST_ERROR_CODES)[keyof typeof RESEARCH_TOOL_HOST_ERROR_CODES]

/** Error with a stable machine code. Messages NEVER disclose local paths,
 *  environment variables or configuration content (the cause is dropped). */
export class ResearchToolHostError extends Error {
  /** Which of the stable codes this failure is; a caller branches on this, never on the message. */
  readonly code: ResearchToolHostErrorCode

  constructor(code: ResearchToolHostErrorCode, safeMessage: string) {
    super(safeMessage)
    this.name = 'ResearchToolHostError'
    this.code = code
  }
}

/** Expected version prefix of the host tool runtime (capability gate). */
const HOST_TOOLS_EXPECTED_VERSION_PREFIX = '0.1.2-alpha'

/**
 * Validate the loaded host module (a foreign runtime value — never trusted
 * structurally); returns the defineTool factory or throws fail-closed with a
 * stable code and a message free of environment details.
 * @param mod - the raw dynamic-import result of the fixed host module id.
 * @returns the host module's `defineTool` factory.
 * @throws {ResearchToolHostError} with a code from {@link RESEARCH_TOOL_HOST_ERROR_CODES} when the
 *   value is not an object or carries no `defineTool` function.
 */
export function validateHostToolsModule(mod: unknown): DefineToolLoader {
  if (mod === null || typeof mod !== 'object') {
    throw new ResearchToolHostError(
      RESEARCH_TOOL_HOST_ERROR_CODES.HOST_SHAPE_INVALID,
      `[research-tools] host tool runtime module is not an object (${RESEARCH_TOOL_HOST_ERROR_CODES.HOST_SHAPE_INVALID})`,
    )
  }
  const defineTool = (mod as { defineTool?: unknown }).defineTool
  if (typeof defineTool !== 'function') {
    throw new ResearchToolHostError(
      RESEARCH_TOOL_HOST_ERROR_CODES.HOST_API_MISMATCH,
      `[research-tools] host tool runtime does not export a function 'defineTool' (${RESEARCH_TOOL_HOST_ERROR_CODES.HOST_API_MISMATCH}) — refusing to register against an unknown tool surface`,
    )
  }
  return defineTool as DefineToolLoader
}

/**
 * Load + validate the host tool module through injectable loaders (default =
 * the fixed module id; version probe = the package manifest when its export
 * mapping exposes it). Test seams and the packed-package consumer smoke inject
 * failing loaders here to exercise every error code deterministically.
 *
 * @param options - the loaders to use: `load` returns the host module, `loadVersion` optionally
 *   returns its manifest for the capability check.
 * @returns the validated `defineTool` factory.
 * @throws {ResearchToolHostError} with `HOST_LOAD_FAILED` when `load` rejects, and the codes
 *   {@link validateHostToolsModule} raises for a module it will not register against.
 */
export async function loadHostToolsModuleWith(options: {
  load: () => Promise<unknown>
  loadVersion?: () => Promise<unknown>
}): Promise<DefineToolLoader> {
  let mod: unknown
  try {
    mod = await options.load()
  } catch {
    // The cause is intentionally dropped: import failures can embed local
    // resolved paths which must never surface in diagnostics.
    throw new ResearchToolHostError(
      RESEARCH_TOOL_HOST_ERROR_CODES.HOST_LOAD_FAILED,
      `[research-tools] host tool runtime could not be loaded (${RESEARCH_TOOL_HOST_ERROR_CODES.HOST_LOAD_FAILED})`,
    )
  }
  const defineTool = validateHostToolsModule(mod)
  if (options.loadVersion !== undefined) {
    let pkg: unknown
    try {
      pkg = await options.loadVersion()
    } catch {
      pkg = undefined // manifest not exported: capability gate (defineTool) only
    }
    const version = (pkg as { version?: unknown } | undefined)?.version
    if (typeof version === 'string' && !version.startsWith(HOST_TOOLS_EXPECTED_VERSION_PREFIX)) {
      throw new ResearchToolHostError(
        RESEARCH_TOOL_HOST_ERROR_CODES.HOST_VERSION_UNSUPPORTED,
        `[research-tools] host tool runtime version ${version} is outside the supported `
        + `${HOST_TOOLS_EXPECTED_VERSION_PREFIX}* line `
        + `(${RESEARCH_TOOL_HOST_ERROR_CODES.HOST_VERSION_UNSUPPORTED})`,
      )
    }
  }
  return defineTool
}

async function loadDefineTool(): Promise<DefineToolLoader> {
  // Non-literal specifier keeps the host tool package out of this compilation.
  return loadHostToolsModuleWith({
    load: () => import('@deepseek-ai/' + DSH_TOOLS_MODULE_ID) as Promise<unknown>,
    loadVersion: () => import('@deepseek-ai/' + DSH_TOOLS_MODULE_ID + '/package.json') as Promise<unknown>,
  })
}

function definitionFor(
  toolId: string,
  defineTool: DefineToolLoader,
  handler: ReturnType<typeof makeHandler>,
): RegisteredTool {
  const entry = RESEARCH_TOOL_DIRECTORY.find(row => row.toolId === toolId)
  if (entry === undefined) throw new Error(`[research-tools] unknown catalog tool '${toolId}'`)
  const description = [
    entry.summary,
    entry.modelExposure === 'model_ready'
      ? 'Model-callable (pure render over declared data).'
      : 'Pipeline-only research tool (registered for discovery; not exposed to agents).',
  ].join(' ')
  const output = { schema: { type: 'json' }, render: jsonTextRender }
  const common = { name: toolId, description, output, timeoutMs: 10_000 }
  switch (toolId) {
    case 'literature-search':
      return defineTool({
        ...common,
        parameters: {
          topic: { type: 'string', required: true, description: 'Research topic (fixture corpus).' },
          maxResults: { type: 'number', description: 'Optional result cap.' },
        },
        execute: handler(toolId, args => ({
          topic: String(args.topic),
          ...(args.maxResults !== undefined ? { maxResults: Number(args.maxResults) } : {}),
        })),
      })
    case 'citation-verify':
      return defineTool({
        ...common,
        parameters: {
          claimId: { type: 'string', required: true, description: 'Claim id being verified.' },
          citationId: { type: 'string', required: true, description: 'Citation id to verify.' },
          ref: { type: 'json', required: true, description: 'Citation reference record.' },
          evidence: { type: 'json', required: true, description: 'Evidence record.' },
          options: { type: 'json', required: true, description: 'Verify options.' },
        },
        execute: handler(toolId, args => args),
      })
    case 'claim-construct':
      return defineTool({
        ...common,
        parameters: {
          assertion: { type: 'string', required: true, description: 'The claim assertion.' },
          claimId: { type: 'string', description: 'Optional deterministic claim id.' },
        },
        execute: handler(toolId, args => args),
      })
    case 'ablation':
      return defineTool({
        ...common,
        parameters: {
          definition: {
            type: 'json',
            required: true,
            description: 'AblationDefinition (baseline/variant/components/dataset/metric).',
          },
        },
        execute: handler(toolId, args => ({ definition: args.definition })),
      })
    case 'figure':
      return defineTool({
        ...common,
        parameters: {
          spec: { type: 'json', required: true, description: 'Full FigureSpec (kind/series/axes/tokens).' },
        },
        execute: handler(toolId, args => args.spec),
      })
    case 'three-line-table':
      return defineTool({
        ...common,
        parameters: {
          model: { type: 'json', required: true, description: 'ThreeLineTableModel (title/columns/rows).' },
          target: { type: 'string', required: true, enum: ['markdown', 'latex'], description: 'Render target.' },
        },
        execute: handler(toolId, args => args),
      })
    case 'roadmap':
      return defineTool({
        ...common,
        parameters: {
          graph: { type: 'json', required: true, description: 'RoadmapGraph (nodes/edges).' },
          options: { type: 'json', description: 'RoadmapRenderOptions (format...).' },
        },
        execute: handler(toolId, args => args),
      })
    default:
      throw new Error(`[research-tools] no defineTool definition for '${toolId}'`)
  }
}

/**
 * Revocation wrapper: after the registration disposer runs, a stale handle to a
 * registered ToolDefinition must no longer be able to execute. The wrapper
 * checks a per-registration `alive` flag before delegating, so unload is a real
 * capability revocation, not just registry removal.
 * @param def - the registered definition.
 * @param isAlive - per-registration liveness probe.
 */
/**
 * Module-private internal-execution capability (defense for handle-level
 * `.execute` of pipeline_only definitions, S1-P2-4). Membership is OBJECT
 * IDENTITY in a module-private WeakSet — a forged/copied/serialized object can
 * never pass. The capability is only reachable through
 * {@link researchToolInternalExecutionCapability}, which is NOT part of the
 * package's public exports (module-internal seam for trusted pipeline code).
 */
const INTERNAL_CAPABILITIES = new WeakSet<object>()
const INTERNAL_CAPABILITY: object = {}
INTERNAL_CAPABILITIES.add(INTERNAL_CAPABILITY)

/**
 * The trusted seam to the module-private capability object.
 *
 * @internal Not part of the package's public exports; trusted pipeline code passes the result to a
 *   pipeline-only definition's `execute` to satisfy the handle-level exposure check.
 * @returns the module-private capability object, whose identity is what the check reads.
 */
export function researchToolInternalExecutionCapability(): unknown {
  return INTERNAL_CAPABILITY
}

function isInternalExecution(exec: unknown): boolean {
  return typeof exec === 'object' && exec !== null && INTERNAL_CAPABILITIES.has(exec)
}

function revocable(def: RegisteredTool, isAlive: () => boolean, meta: RegistrationMarker): RegisteredTool {
  const execute = def.execute.bind(def)
  const guarded: RegisteredTool = {
    ...def,
    execute(args, exec): Promise<unknown> {
      if (!isAlive()) {
        return Promise.reject(new Error(
          `[research-tools] '${def.name}' has been unregistered (RESEARCH_TOOL_UNLOADED) — `
          + 'stale handles cannot execute after unload',
        ))
      }
      // Handle-level exposure gate (S1-P2-4): pipeline_only definitions are not
      // executable through a bare handle. Trusted internal callers pass the
      // module-private capability; everything else is denied — a guard for
      // agent-loop dispatch can never be the ONLY wall.
      if (meta.modelExposure !== 'model_ready' && !isInternalExecution(exec)) {
        return Promise.reject(new Error(
          `[${def.name}] is pipeline-only and not executable through a bare handle `
          + '(RESEARCH_TOOL_NOT_CAPABILITY) — use a ResearchToolInvoker or pass the '
          + 'internal execution capability',
        ))
      }
      return execute(args, exec)
    },
  }
  attachMarker(guarded, meta)
  return guarded
}

/**
 * Register all seven research tools on `ctx.tools` plus the pipeline-only
 * exposure guards. TRANSACTIONAL: either all seven register (plus guards) or
 * every side effect taken so far is rolled back and the error re-thrown — a
 * partial registration is never observable. Idempotency is NOT baked in: a
 * second registration of an already-registered name is rejected by the tools
 * registry (deterministic). Retry after a failure is safe because the rollback
 * leaves no residue. The returned disposer is idempotent (double-unload safe)
 * and revokes every returned ToolDefinition.
 * @param ctx - a context whose `tools` service is present.
 * @param deps - the dependency graph every tool invocation is served from; defaults to the fixture
 *   graph, so an unconfigured deployment reaches no network.
 * @returns the combined disposer that unregisters every tool and guard.
 */
export async function registerResearchTools(
  ctx: Context,
  deps: ResearchToolDeps = FIXTURE_DEPS,
): Promise<() => void> {
  const tools = ctx as Context & { tools: ToolRegistryFace }
  const defineTool = await loadDefineTool()
  const handler = makeHandler(deps)
  const disposers: Array<() => void> = []
  let released = false
  const isAlive = () => !released
  try {
    for (const entry of RESEARCH_TOOL_DIRECTORY) {
      const definition = revocable(
        definitionFor(entry.toolId, defineTool, handler),
        isAlive,
        { toolId: entry.toolId, version: entry.version, modelExposure: entry.modelExposure },
      )
      disposers.push(tools.tools.register(definition))
      if (entry.modelExposure !== 'model_ready') {
        disposers.push(tools.tools.guard(researchToolExposureGuard(entry.toolId, entry.modelExposure)))
      }
    }
  } catch (error) {
    // Roll back EVERY side effect taken before the failure. A disposer that
    // itself throws must not stop the remaining rollbacks: collect extra errors
    // and surface an aggregate alongside the original registration error.
    const rollbackErrors: unknown[] = []
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(
        `[research-tools] registration failed AND rollback reported ${rollbackErrors.length} `
        + `error(s) (RESEARCH_TOOL_ROLLBACK_PARTIAL): ${(error as Error).message}`,
      )
    }
    throw error
  }
  return () => {
    if (released) return
    released = true
    for (const dispose of disposers.reverse()) dispose()
  }
}

/**
 * Readiness check: every one of the seven catalog tools must be registered
 * under its catalog id. Used by the research-bundle startup path so a bundle
 * configured with research tools FAILS LOUDLY when registration is partial or
 * names drifted — never boots silently without its full tool surface.
 * @param ctx - a context whose `tools` service is present.
 * @throws when any catalog tool is missing.
 */
export function assertResearchToolsReady(ctx: Context): void {
  const tools = ctx as Context & { tools: ToolRegistryFace }
  const problems: string[] = []
  for (const entry of RESEARCH_TOOL_DIRECTORY) {
    const def = tools.tools.get(entry.toolId)
    if (def === undefined) {
      problems.push(`'${entry.toolId}' not registered`)
      continue
    }
    if (def.name !== entry.toolId) {
      problems.push(`'${entry.toolId}' registered under unexpected name '${def.name}'`)
    }
    // Identity: the registered definition must be OURS (registration marker
    // carrying the catalog version/exposure). A pre-existing impostor object
    // with the same name can never satisfy this check.
    const marker = readMarker(def)
    if (marker === undefined) {
      problems.push(`'${entry.toolId}' definition is not ours (no registration marker)`)
    } else {
      if (marker.toolId !== entry.toolId) problems.push(`'${entry.toolId}' marker toolId mismatch`)
      if (marker.version !== entry.version) {
        problems.push(`'${entry.toolId}' version ${marker.version} != catalog ${entry.version}`)
      }
      if (marker.modelExposure !== entry.modelExposure) {
        problems.push(`'${entry.toolId}' exposure ${marker.modelExposure} != catalog ${entry.modelExposure}`)
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `[research-tools] readiness failed (${problems.length}/${RESEARCH_TOOL_DIRECTORY.length}): `
      + problems.join('; ') + ' — refusing to boot without the full, OURS-owned research tool surface',
    )
  }
}

/**
 * Nested cordis plugin face that DECLARES the `tools` inject and registers the
 * seven research tools when the host provides the tools service. The engine
 * loads this plugin at start; standalone embeddings without `tools` silently
 * skip it (cordis does not reject unmet injects), which is why the REQUIRED
 * path relies on `onReady` rather than a plugin error.
 * @param ctx - plugin context with the `tools` inject resolved.
 * @param config - `verify: true` turns the readiness assertion on; `onReady`
 *   is invoked only after successful registration + verification, giving the
 *   required path an authoritative success signal.
 */
export const researchToolsPlugin = {
  name: 'research-tools',
  inject: ['tools'] as const,
  async apply(
    ctx: Context,
    config: { verify?: boolean; onReady?: () => void; deps?: ResearchToolDeps } = {},
  ): Promise<void> {
    // Register (dynamic defineTool loader) before the plugin load settles so
    // callers observe the tools immediately after ctx.plugin(...) resolves.
    const dispose = await registerResearchTools(ctx, config.deps ?? FIXTURE_DEPS)
    if (config.verify === true) assertResearchToolsReady(ctx)
    config.onReady?.()
    ctx.effect(() => () => {
      dispose()
    }, 'research.tools')
  },
}
