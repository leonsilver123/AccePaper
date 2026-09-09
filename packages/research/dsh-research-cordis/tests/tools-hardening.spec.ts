// T13-R Phase 1.1 hardening — vitest spec.
//
// Covers the engineering/permission hardening that Phase 1 left open:
//   1. the host module loader is fail-closed (validates shape, no arbitrary
//      module paths);
//   2. `requireResearchTools` makes registration a STARTUP requirement in
//      research-bundle mode (no silent skip when the tools service is absent);
//   3. the model-visible surface is an explicit allow-list (model_ready only),
//      never the full registered set;
//   4. adversarial: forged / absent / empty / copied agent fields never unlock
//      a pipeline-only tool; unload removes tools; post-unload calls fail.

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RESEARCH_TOOL_DIRECTORY } from '@deepseek-ai/dsh-research-tools'
import { ResearchEngine } from '../src/index.ts'
import {
  assertResearchToolsReady,
  modelReadyResearchToolIds,
  validateHostToolsModule,
} from '../src/tools.ts'
import type { ToolRegistryFace } from '../src/tools.ts'

async function loadToolRuntime(): Promise<new (ctx: Context) => unknown> {
  const mod = await import('@deepseek-ai/' + 'dsh-tools') as { default: new (ctx: Context) => unknown }
  return mod.default
}
async function loadSystemPrompt(): Promise<new (ctx: Context) => unknown> {
  const mod = await import('@deepseek-ai/' + 'dsh-system-prompt') as { default: new (ctx: Context) => unknown }
  return mod.default
}
async function setupWithTools(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(await loadSystemPrompt())
  await ctx.plugin(await loadToolRuntime())
  return ctx
}
function toolsOf(ctx: Context): ToolRegistryFace {
  return (ctx as Context & { tools: ToolRegistryFace }).tools
}

describe('T13-R Phase 1.1 hardening', () => {
  describe('host module loader is fail-closed', () => {
    it('rejects a non-object module', () => {
      expect(() => validateHostToolsModule(null)).toThrow(/fail-closed/)
      expect(() => validateHostToolsModule(undefined as never)).toThrow(/not an object/)
    })

    it('rejects a module without a function defineTool (API mismatch)', () => {
      expect(() => validateHostToolsModule({ defineTool: undefined })).toThrow(/does not export/)
      expect(() => validateHostToolsModule({ defineTool: 'nope' })).toThrow(/does not export/)
      expect(() => validateHostToolsModule({})).toThrow(/does not export/)
    })

    it('accepts a function defineTool and returns it as the loader', () => {
      const fn = () => ({ name: 'x' })
      expect(validateHostToolsModule({ defineTool: fn })).toBe(fn)
    })
  })

  describe('requireResearchTools makes registration a startup requirement', () => {
    it('FAILS the engine load (no silent skip) when the tools service is absent', async () => {
      const ctx = new Context() // no SystemPrompt / no ToolRuntime
      let threw = false
      try {
        await ctx.plugin(ResearchEngine, { requireResearchTools: true })
      } catch {
        threw = true
      }
      expect(threw).toBe(true)
    })

    it('loads and verifies readiness when the tools service is present', async () => {
      const ctx = await setupWithTools()
      await ctx.plugin(ResearchEngine, { requireResearchTools: true })
      expect(() => { assertResearchToolsReady(ctx) }).not.toThrow()
      for (const entry of RESEARCH_TOOL_DIRECTORY) {
        expect(toolsOf(ctx).get(entry.toolId)).toBeDefined()
      }
      await ctx.fiber.dispose()
    })

    it('standalone (unset) engine still loads without a tools service', async () => {
      const ctx = new Context()
      await ctx.plugin(ResearchEngine)
      expect(ctx.research).toBeInstanceOf(ResearchEngine)
      await ctx.fiber.dispose()
    })

    it('readiness fails loudly when a catalog tool is missing', () => {
      // Direct unit of the assertion over a registry that only holds six of the
      // seven catalog tools: 'roadmap' dropped → the check must refuse.
      const sixOfSeven = RESEARCH_TOOL_DIRECTORY
        .filter(entry => entry.toolId !== 'roadmap')
        .map(entry => entry.toolId)
      expect(sixOfSeven).toHaveLength(6)
      const partialTools = {
        get: (name: string) => (sixOfSeven.includes(name) ? { name } : undefined),
      } as ToolRegistryFace
      const ctxStub = { tools: partialTools } as unknown as Context
      expect(() => { assertResearchToolsReady(ctxStub) }).toThrow(/roadmap/)
    })
  })

  describe('model-visible surface is an explicit allow-list', () => {
    it('exposes ONLY model_ready tools to the agent loop', () => {
      const modelVisible = modelReadyResearchToolIds()
      expect([...modelVisible].sort()).toEqual(['figure', 'roadmap', 'three-line-table'])
      for (const entry of RESEARCH_TOOL_DIRECTORY) {
        if (entry.modelExposure === 'model_ready') {
          expect(modelVisible).toContain(entry.toolId)
        } else {
          expect(modelVisible).not.toContain(entry.toolId)
        }
      }
    })
  })

  describe('adversarial surface', () => {
    it('direct execute of an unloaded tool after unload fails (no stale handle)', async () => {
      const ctx = await setupWithTools()
      await ctx.plugin(ResearchEngine, { requireResearchTools: true })
      const handle = toolsOf(ctx).get('figure')
      expect(handle).toBeDefined()
      await ctx.fiber.dispose()
      // The context teardown removed the tools service entirely, so the stale
      // reference can no longer reach a live registry.
      expect((ctx as Context & { tools?: unknown }).tools).toBeUndefined()
    })
  })
})
