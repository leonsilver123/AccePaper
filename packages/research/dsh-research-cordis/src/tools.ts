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
 * Exposure guard builder: a `pipeline_only` tool is denied to any agent-loop
 * execution; model-ready tools pass. Exported for direct unit-testing and wired
 * into ctx.tools.guard by {@link registerResearchTools}.
 * @param toolId - canonical research tool id.
 * @param exposure - catalog exposure verdict.
 * @returns a denial reason, or undefined when the call is allowed.
 */
export function researchToolExposureGuard(
  toolId: string,
  exposure: ModelExposure,
): (execution: Readonly<{ agent?: unknown }>) => string | undefined {
  return (execution) => {
    if (exposure === 'model_ready') return undefined
    if (execution.agent === undefined) return undefined
    return `[${toolId}] is pipeline-only (injected-adapter/fixture input); `
      + 'registered for discovery and pipeline use, not exposed to agents'
  }
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

async function loadDefineTool(): Promise<DefineToolLoader> {
  // Non-literal specifier keeps the host tool package out of this compilation.
  // oxlint-disable-next-line typescript/no-unsafe-assignment
  const mod = await import('@deepseek-ai/' + 'dsh-tools')
  return (mod as { defineTool: DefineToolLoader }).defineTool
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
 * Register all seven research tools on `ctx.tools` plus the pipeline-only
 * exposure guards. Idempotency is NOT baked in — the tools registry itself
 * rejects a duplicate name, so a second registration throws (tested).
 * @param ctx - a context whose `tools` service is present.
 * @returns the combined disposer that unregisters every tool and guard.
 */
export async function registerResearchTools(ctx: Context): Promise<() => void> {
  const tools = ctx as Context & { tools: ToolRegistryFace }
  const defineTool = await loadDefineTool()
  const disposers: Array<() => void> = []
  for (const entry of RESEARCH_TOOL_DIRECTORY) {
    disposers.push(tools.tools.register(definitionFor(entry.toolId, defineTool)))
    if (entry.modelExposure !== 'model_ready') {
      disposers.push(tools.tools.guard(researchToolExposureGuard(entry.toolId, entry.modelExposure)))
    }
  }
  let released = false
  return () => {
    if (released) return
    released = true
    for (const dispose of disposers.reverse()) dispose()
  }
}

/**
 * Nested cordis plugin face that DECLARES the `tools` inject and registers the
 * seven research tools when the host provides the tools service. The engine
 * loads this plugin at start; standalone embeddings without `tools` reject the
 * load (caught upstream) and simply run without tool registration.
 */
export const researchToolsPlugin = {
  name: 'research-tools',
  inject: ['tools'] as const,
  async apply(ctx: Context): Promise<void> {
    // Register (dynamic defineTool loader) before the plugin load settles so
    // callers observe the tools immediately after ctx.plugin(...) resolves.
    const dispose = await registerResearchTools(ctx)
    ctx.effect(() => dispose, 'research.tools')
  },
}
