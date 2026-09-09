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
 * No real model/gateway is used anywhere: literature runs over the mock corpus
 * adapter, ablation over the mock executor, citations over the core
 * MockCitationResolverAdapter (all fixture, `live_external` = 0).
 *
 * Type seam: the model-facing `@deepseek-ai/dsh-tools` surface is only needed
 * at RUNTIME (defineTool). It is loaded dynamically with a non-literal
 * specifier so the host tool package's type graph never enters this package's
 * compilation; the structural faces below are the only contract relied on and
 * are enforced by the real register/guard at runtime.
 */
import type { Context } from '@deepseek-ai/cordis'
import { MockCitationResolverAdapter } from '@deepseek-ai/dsh-research-core'
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
  guard(guard: (execution: Readonly<{ agent?: unknown }>) => string | undefined): () => void
  get(name: string): RegisteredTool | undefined
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
 */
export function researchToolExposureGuard(
  toolId: string,
  exposure: ModelExposure,
): (execution: Readonly<{ agent?: unknown }>) => string | undefined {
  return () => {
    if (exposure === 'model_ready') return undefined
    return `[${toolId}] is pipeline-only (injected-adapter/fixture input); `
      + 'it is registered for discovery and internal pipeline use only — not executable through the agent tool runtime'
  }
}

/** Tool ids the agent loop may be ALLOWED to call (model-ready renders). */
export function modelReadyResearchToolIds(): ReadonlyArray<string> {
  return RESEARCH_TOOL_DIRECTORY
    .filter(entry => entry.modelExposure === 'model_ready')
    .map(entry => entry.toolId)
}

/** Fixture dependency bundle injected by this closure (live_external = 0). */
const FIXTURE_DEPS: ResearchToolDeps = {
  citationDeps: { resolver: new MockCitationResolverAdapter() },
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

function handler(toolId: string, toInput: (args: Record<string, unknown>) => unknown) {
  return (args: Record<string, unknown>): unknown => {
    const artifact = executeResearchTool(toolId, toInput(args), FIXTURE_DEPS, Date.now())
    return toJsonSafe(artifact)
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

/**
 * Validate the loaded host module (a foreign runtime value — never trusted
 * structurally); returns the defineTool factory or throws fail-closed.
 * @param mod - the raw dynamic-import result of the fixed host module id.
 */
export function validateHostToolsModule(mod: unknown): DefineToolLoader {
  if (mod === null || typeof mod !== 'object') {
    throw new Error(`[research-tools] '${DSH_TOOLS_MODULE_ID}' runtime module is not an object (fail-closed)`)
  }
  const defineTool = (mod as { defineTool?: unknown }).defineTool
  if (typeof defineTool !== 'function') {
    throw new Error(
      `[research-tools] '${DSH_TOOLS_MODULE_ID}' runtime module does not export a function 'defineTool' `
      + '(host API mismatch, fail-closed) — refusing to register against an unknown tool surface',
    )
  }
  return defineTool as DefineToolLoader
}

async function loadDefineTool(): Promise<DefineToolLoader> {
  // Non-literal specifier keeps the host tool package out of this compilation.
  const mod = await import('@deepseek-ai/' + DSH_TOOLS_MODULE_ID) as { defineTool?: unknown }
  return validateHostToolsModule(mod)
}

function definitionFor(toolId: string, defineTool: DefineToolLoader): RegisteredTool {
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
function revocable(def: RegisteredTool, isAlive: () => boolean): RegisteredTool {
  const execute = def.execute.bind(def)
  return {
    ...def,
    execute(args, exec): Promise<unknown> {
      if (!isAlive()) {
        return Promise.reject(new Error(
          `[research-tools] '${def.name}' has been unregistered (RESEARCH_TOOL_UNLOADED) — `
          + 'stale handles cannot execute after unload',
        ))
      }
      return execute(args, exec)
    },
  }
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
 * @returns the combined disposer that unregisters every tool and guard.
 */
export async function registerResearchTools(ctx: Context): Promise<() => void> {
  const tools = ctx as Context & { tools: ToolRegistryFace }
  const defineTool = await loadDefineTool()
  const disposers: Array<() => void> = []
  let released = false
  const isAlive = () => !released
  try {
    for (const entry of RESEARCH_TOOL_DIRECTORY) {
      const definition = revocable(definitionFor(entry.toolId, defineTool), isAlive)
      disposers.push(tools.tools.register(definition))
      if (entry.modelExposure !== 'model_ready') {
        disposers.push(tools.tools.guard(researchToolExposureGuard(entry.toolId, entry.modelExposure)))
      }
    }
  } catch (error) {
    // Roll back every side effect taken before the failure: partial state must
    // never survive a failed registration attempt.
    for (const dispose of disposers.reverse()) dispose()
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
  const missing = RESEARCH_TOOL_DIRECTORY
    .map(entry => entry.toolId)
    .filter(toolId => tools.tools.get(toolId) === undefined)
  if (missing.length > 0) {
    throw new Error(
      `[research-tools] readiness failed: ${missing.length}/${RESEARCH_TOOL_DIRECTORY.length} `
      + `catalog tools not registered (${missing.join(', ')}) — refusing to boot without the full research tool surface`,
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
    config: { verify?: boolean; onReady?: () => void } = {},
  ): Promise<void> {
    // Register (dynamic defineTool loader) before the plugin load settles so
    // callers observe the tools immediately after ctx.plugin(...) resolves.
    const dispose = await registerResearchTools(ctx)
    if (config.verify === true) assertResearchToolsReady(ctx)
    config.onReady?.()
    ctx.effect(() => () => {
      dispose()
    }, 'research.tools')
  },
}
