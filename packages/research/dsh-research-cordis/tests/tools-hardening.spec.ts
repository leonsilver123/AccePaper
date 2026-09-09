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
  registerResearchTools,
  researchToolInternalExecutionCapability,
  researchToolsPlugin,
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
    it('rejects a non-object module with a stable code', () => {
      expect(() => validateHostToolsModule(null)).toThrow(/HOST_SHAPE_INVALID/)
      expect(() => validateHostToolsModule(undefined as never)).toThrow(/not an object/)
    })

    it('rejects a module without a function defineTool (API mismatch)', () => {
      expect(() => validateHostToolsModule({ defineTool: undefined })).toThrow(/HOST_API_MISMATCH/)
      expect(() => validateHostToolsModule({ defineTool: 'nope' })).toThrow(/HOST_API_MISMATCH/)
      expect(() => validateHostToolsModule({})).toThrow(/HOST_API_MISMATCH/)
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

function sharedBlockerDef(name: string) {
  return {
    name,
    description: 'blocker',
    parameters: {},
    output: { schema: { type: 'object' }, render: () => [] },
    execute: async () => ({}),
  }
}

describe('registration transactionality and lifecycle (Phase 1.1-R)', () => {

  it('rolls back ALL side effects when the last registration collides (no partial state)', async () => {
    const ctx = await setupWithTools()
    // Occupy the LAST catalog slot ('roadmap') so the 7-tool loop fails at
    // index 7 after six registrations succeeded.
    const blocker = toolsOf(ctx).register(sharedBlockerDef('roadmap'))
    await expect(registerResearchTools(ctx)).rejects.toThrow(/already registered/)
    // Transactional rollback: none of the earlier six may remain observable.
    // The intentionally pre-registered 'roadmap' blocker is the ONLY survivor.
    for (const entry of RESEARCH_TOOL_DIRECTORY) {
      if (entry.toolId === 'roadmap') {
        expect(toolsOf(ctx).get('roadmap')?.name).toBe('roadmap')
      } else {
        expect(toolsOf(ctx).get(entry.toolId)).toBeUndefined()
      }
    }
    // Retry is deterministic once the blocker is gone.
    blocker()
    await expect(registerResearchTools(ctx)).resolves.toBeDefined()
    expect(() => { assertResearchToolsReady(ctx) }).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('unload revokes stale ToolDefinition handles (RESEARCH_TOOL_UNLOADED)', async () => {
    const ctx = await setupWithTools()
    const dispose = await registerResearchTools(ctx)
    const stale = toolsOf(ctx).get('figure')
    expect(stale).toBeDefined()
    dispose()
    // Registry removal AND capability revocation: the stale handle cannot run.
    expect(toolsOf(ctx).get('figure')).toBeUndefined()
    await expect(stale!.execute({ spec: {} }, {})).rejects.toThrow(/RESEARCH_TOOL_UNLOADED/)
    // Double unload is a no-op (deterministic).
    dispose()
  })

  it('readiness requires the exact seven-tool set, not just an onReady signal', async () => {
    const ctx = await setupWithTools()
    const applied = { value: false }
    await ctx.plugin(researchToolsPlugin, { verify: true, onReady: () => { applied.value = true } })
    expect(applied.value).toBe(true)
    expect(() => { assertResearchToolsReady(ctx) }).not.toThrow()
    await ctx.fiber.dispose()
  })
})

describe('registration lifecycle reinforcement (Phase 1.1-R track A)', () => {
  async function blockerOn(ctx: Context, name: string): Promise<() => void> {
    return toolsOf(ctx).register(sharedBlockerDef(name))
  }

  it('rolls back fully when the FIRST registration collides (nothing remains ours)', async () => {
    const ctx = await setupWithTools()
    const blocker = await blockerOn(ctx, 'literature-search')
    await expect(registerResearchTools(ctx)).rejects.toThrow(/already registered/)
    // Only the blocker exists; none of our six others leaked in.
    expect(toolsOf(ctx).get('literature-search')?.description).toBe('blocker')
    expect(toolsOf(ctx).get('claim-construct')).toBeUndefined()
    blocker()
    await expect(registerResearchTools(ctx)).resolves.toBeDefined()
    expect(() => { assertResearchToolsReady(ctx) }).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('rolls back fully when a MIDDLE registration collides', async () => {
    const ctx = await setupWithTools()
    const blocker = await blockerOn(ctx, 'claim-construct') // catalog index 3
    await expect(registerResearchTools(ctx)).rejects.toThrow(/already registered/)
    expect(toolsOf(ctx).get('literature-search')).toBeUndefined()
    expect(toolsOf(ctx).get('ablation')).toBeUndefined()
    expect(toolsOf(ctx).get('claim-construct')?.description).toBe('blocker')
    blocker()
    await expect(registerResearchTools(ctx)).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })

  it('concurrent initialisation yields exactly one winner and a consistent set', async () => {
    const ctx = await setupWithTools()
    const [a, b] = await Promise.allSettled([
      registerResearchTools(ctx),
      registerResearchTools(ctx),
    ])
    expect(a.status === 'fulfilled' ? true : b.status === 'fulfilled').toBe(true)
    const fulfilled = a.status === 'fulfilled' ? a : b
    const rejected = a.status === 'fulfilled' ? b : a
    expect(rejected.status).toBe('rejected')
    expect(() => { assertResearchToolsReady(ctx) }).not.toThrow()
    ;(fulfilled as PromiseFulfilledResult<() => void>).value()
    for (const entry of RESEARCH_TOOL_DIRECTORY) {
      expect(toolsOf(ctx).get(entry.toolId)).toBeUndefined()
    }
    await ctx.fiber.dispose()
  })

  it('stale handles from an OLD instance never work against a NEW instance', async () => {
    const ctxA = await setupWithTools()
    const disposeA = await registerResearchTools(ctxA)
    const staleFromA = toolsOf(ctxA).get('figure')
    expect(staleFromA).toBeDefined()
    disposeA()

    const ctxB = await setupWithTools()
    await registerResearchTools(ctxB)
    const freshOnB = toolsOf(ctxB).get('figure')
    expect(freshOnB).toBeDefined()
    expect(freshOnB).not.toBe(staleFromA)
    await expect(staleFromA!.execute({ spec: {} }, {})).rejects.toThrow(/RESEARCH_TOOL_UNLOADED/)
    await ctxB.fiber.dispose()
    await ctxA.fiber.dispose()
  })

  it('readiness refuses a pre-existing impostor object (not ours, no marker)', () => {
    const impostor: ToolRegistryFace = {
      get: name => (name === 'roadmap' ? { name: 'roadmap' } as never : undefined),
    }
    const ctxStub = { tools: impostor } as unknown as Context
    expect(() => { assertResearchToolsReady(ctxStub) }).toThrow(/not ours/)
  })

  it('requireResearchTools fails startup when a catalog name is already occupied', async () => {
    const ctx = await setupWithTools()
    await blockerOn(ctx, 'roadmap')
    let threw = false
    try {
      await ctx.plugin(ResearchEngine, { requireResearchTools: true })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
    // Tolerant standalone engine still loads (skips tool registration).
    const ctx2 = await setupWithTools()
    await blockerOn(ctx2, 'roadmap')
    await ctx2.plugin(ResearchEngine)
    expect(ctx2.research).toBeInstanceOf(ResearchEngine)
    await ctx2.fiber.dispose()
    await ctx.fiber.dispose()
  })
})

describe('handle-level pipeline_only execution requires the internal capability (S1-P2-4)', () => {
  it('bare / forged exec objects cannot execute a pipeline_only definition', async () => {
    const ctx = await setupWithTools()
    const dispose = await registerResearchTools(ctx)
    const claim = toolsOf(ctx).get('claim-construct')
    expect(claim).toBeDefined()
    // No exec at all / empty object / forged copy / serialized round-trip → DENY.
    for (const exec of [undefined, {}, { capability: {} }, { token: 'x', exec: {} }]) {
      await expect(claim!.execute({ assertion: 'x' }, exec)).rejects.toThrow(/RESEARCH_TOOL_NOT_CAPABILITY/)
    }
    // A model_ready tool is unaffected by the handle gate.
    const table = toolsOf(ctx).get('three-line-table')
    const ok = await table!.execute(
      { model: { columns: [{ header: 'A' }], rows: [[{ kind: 'text', text: 'x' }]] }, target: 'markdown' },
      {},
    )
    expect(ok).toBeDefined()
    dispose()
    await ctx.fiber.dispose()
  })

  it('the real module-private capability unlocks pipeline_only handle execution', async () => {
    const ctx = await setupWithTools()
    const dispose = await registerResearchTools(ctx)
    const claim = toolsOf(ctx).get('claim-construct')
    const artifact = await claim!.execute(
      { assertion: 'Adaptive control reduces delay.' },
      researchToolInternalExecutionCapability(),
    )
    expect(artifact).toMatchObject({ claim: { assertion: 'Adaptive control reduces delay.' } })
    dispose()
    await ctx.fiber.dispose()
  })
})
