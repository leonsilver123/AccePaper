// Research Tool Runtime Registration (T13-R) — vitest spec.
//
// Proves, WITHOUT any real model/gateway, that the seven research tools are
// genuinely registered on a live ctx.tools service by the research-cordis
// plugin: discoverable by catalog id, consistent with the catalog (name /
// version / exposure), executable programmatically (Mock execution), guarded by
// exposure policy, unloadable, and duplicate-registration-safe.

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RESEARCH_TOOL_DIRECTORY } from '@deepseek-ai/dsh-research-tools'
import { ResearchEngine } from '../src/index.ts'
import {
  RESEARCH_TOOL_REGISTRATION,
  registerResearchTools,
  researchToolExposureGuard,
} from '../src/tools.ts'
import type { RegisteredTool, ToolRegistryFace } from '../src/tools.ts'

// Real host services (SystemPrompt + ToolRuntime default exports) are loaded
// dynamically so the host type graphs never enter this package's static
// compilation (see src/tools.ts header note).
async function loadHostServices(): Promise<{
  SystemPrompt: new (ctx: Context) => unknown
  ToolRuntime: new (ctx: Context) => unknown
}> {
  const promptMod = await import('@deepseek-ai/' + 'dsh-system-prompt') as unknown as {
    default: new (ctx: Context) => unknown
  }
  const toolsMod = await import('@deepseek-ai/' + 'dsh-tools') as unknown as {
    default: new (ctx: Context) => unknown
  }
  return {
    SystemPrompt: promptMod.default,
    ToolRuntime: toolsMod.default,
  }
}

/** Fresh context with a live tools service and the research engine loaded. */
async function setupResearch(): Promise<Context> {
  const host = await loadHostServices()
  const ctx = new Context()
  await ctx.plugin(host.SystemPrompt)
  await ctx.plugin(host.ToolRuntime)
  await ctx.plugin(ResearchEngine)
  return ctx
}

/** Fresh context with a live tools service only (no engine). */
async function setupToolsOnly(): Promise<Context> {
  const host = await loadHostServices()
  const ctx = new Context()
  await ctx.plugin(host.SystemPrompt)
  await ctx.plugin(host.ToolRuntime)
  return ctx
}

function toolsOf(ctx: Context): ToolRegistryFace {
  return (ctx as Context & { tools: ToolRegistryFace }).tools
}

function getTool(ctx: Context, name: string): RegisteredTool {
  const def = toolsOf(ctx).get(name)
  if (def === undefined) throw new Error(`tool '${name}' not registered`)
  return def
}

const FIGURE_SPEC = {
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

/** Minimal programmatic execution identity (handlers do not read it). */
const EXEC = { signal: new AbortController().signal } as unknown

describe('research tool runtime registration (T13-R)', () => {
  it('plugin start registers all seven tools on ctx.tools, discoverable by catalog id', async () => {
    const ctx = await setupResearch()
    for (const entry of RESEARCH_TOOL_DIRECTORY) {
      const def = toolsOf(ctx).get(entry.toolId)
      expect(def, `catalog tool '${entry.toolId}' should be registered`).toBeDefined()
      expect(def?.name).toBe(entry.toolId)
    }
    await ctx.fiber.dispose()
  })

  it('registration metadata matches the catalog exactly (7 tools, versions, exposure)', () => {
    expect(Object.keys(RESEARCH_TOOL_REGISTRATION).sort()).toEqual(
      RESEARCH_TOOL_DIRECTORY.map(entry => entry.toolId).sort(),
    )
    for (const entry of RESEARCH_TOOL_DIRECTORY) {
      const meta = RESEARCH_TOOL_REGISTRATION[entry.toolId]
      expect(meta?.version).toBe(entry.version)
      expect(meta?.modelExposure).toBe(entry.modelExposure)
    }
  })

  it('model_ready tools execute programmatically (Mock execution) and return the tool artifact', async () => {
    const ctx = await setupResearch()
    const result = await getTool(ctx, 'figure').execute({ spec: FIGURE_SPEC }, EXEC)
    const artifact = result as { meta?: { toolId?: string } }
    expect(artifact.meta?.toolId).toBe('figure')
    // The model-facing result is JSON-safe (binary PNG projected, no Buffer).
    expect(JSON.stringify(result)).not.toContain('"type":"Buffer"')
    await ctx.fiber.dispose()
  })

  it('pipeline-only tools are registered and pipeline (agent-less) execution works', async () => {
    const ctx = await setupResearch()
    const result = await getTool(ctx, 'claim-construct').execute(
      { assertion: 'Adaptive control reduces delay.' },
      EXEC,
    )
    const artifact = result as { meta?: { toolId?: string }; claim?: { assertion?: string } }
    expect(artifact.meta?.toolId).toBe('claim-construct')
    expect(artifact.claim?.assertion).toBe('Adaptive control reduces delay.')
    await ctx.fiber.dispose()
  })

  it('exposure guard denies pipeline_only tools to agent executions and lets model_ready through', () => {
    const agentExec = { agent: {} } as Readonly<{ agent?: unknown }>
    const noAgentExec = {} as Readonly<{ agent?: unknown }>
    for (const entry of RESEARCH_TOOL_DIRECTORY) {
      const guard = researchToolExposureGuard(entry.toolId, entry.modelExposure)
      if (entry.modelExposure === 'model_ready') {
        expect(guard(agentExec), entry.toolId).toBeUndefined()
      } else {
        expect(guard(agentExec), entry.toolId).toMatch(/pipeline-only/)
        expect(guard(noAgentExec), entry.toolId).toBeUndefined()
      }
    }
  })

  it('duplicate registration is rejected by the registry (idempotency NOT baked in)', async () => {
    const ctx = await setupToolsOnly()
    await expect(registerResearchTools(ctx)).resolves.toBeDefined()
    await expect(registerResearchTools(ctx)).rejects.toThrow(/already registered/)
    await ctx.fiber.dispose()
  })

  it('manual registration returns a disposer that unregisters every tool and guard', async () => {
    const ctx = await setupToolsOnly()
    const dispose = await registerResearchTools(ctx)
    expect(getTool(ctx, 'roadmap').name).toBe('roadmap')
    dispose()
    for (const entry of RESEARCH_TOOL_DIRECTORY) {
      expect(toolsOf(ctx).get(entry.toolId)).toBeUndefined()
    }
    await ctx.fiber.dispose()
  })

  it('engine unload removes the registered tools (research.tools effect)', async () => {
    const ctx = await setupResearch()
    expect(getTool(ctx, 'three-line-table').name).toBe('three-line-table')
    await ctx.fiber.dispose()
    // Disposing the owning fiber tears down the context's services — including
    // the tools service and the research.tools registration effect with it.
    expect((ctx as Context & { tools?: unknown }).tools).toBeUndefined()
  })

  it('tools carry an explicit timeoutMs and reject invalid model arguments', async () => {
    const ctx = await setupResearch()
    const figure = getTool(ctx, 'figure')
    expect(figure.timeoutMs).toBeGreaterThan(0)
    await expect(figure.execute({ notASpec: true }, EXEC)).rejects.toThrow()
    await ctx.fiber.dispose()
  })
})
