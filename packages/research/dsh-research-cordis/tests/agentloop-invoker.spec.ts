// AgentLoopResearchToolInvoker (Phase 2/3) — vitest spec.
//
// Proves the AgentLoop invoker: pipeline_only ids are rejected with a stable
// code BEFORE any loop work; model_ready tools execute through the REAL
// agent-loop (registry-minted ToolRuntime chain) and return the tool artifact;
// the same legal input yields a business-equivalent artifact on Direct and
// AgentLoop channels while provenance/truthfulness differ.

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  DirectResearchToolInvoker,
  executeResearchTool,
} from '@deepseek-ai/dsh-research-tools'
import { ResearchEngine } from '../src/index.ts'
import { AgentLoopResearchToolInvoker } from '../src/agent-loop-invoker.ts'

const TS = 1_720_000_000_000

async function loadHost() {
  const llm = await import('@deepseek-ai/' + 'dsh-llm')
  const session = await import('@deepseek-ai/' + 'dsh-session')
  const projection = await import('@deepseek-ai/' + 'dsh-session-projection')
  const prompt = await import('@deepseek-ai/' + 'dsh-system-prompt')
  const tools = await import('@deepseek-ai/' + 'dsh-tools')
  const agent = await import('@deepseek-ai/' + 'dsh-agent')
  const loop = await import('@deepseek-ai/' + 'dsh-agent-loop')
  return {
    LlmRuntime: llm.default as new (ctx: Context) => unknown,
    SessionStore: session.default as new (ctx: Context) => unknown,
    SessionProjectionRegistry: projection.default as new (ctx: Context) => unknown,
    SystemPrompt: prompt.default as new (ctx: Context, cfg: { persona: string }) => unknown,
    ToolRuntime: tools.default as new (ctx: Context) => unknown,
    AgentRegistry: agent.default as new (ctx: Context) => unknown,
    AgentLoop: loop.default as new (ctx: Context, cfg: { agents: unknown[] }) => unknown,
  }
}

async function setupRuntime() {
  const host = await loadHost()
  const ctx = new Context()
  await ctx.plugin(host.LlmRuntime as never)
  await ctx.plugin(host.SessionStore as never)
  await ctx.plugin(host.SessionProjectionRegistry as never)
  await ctx.plugin(host.SystemPrompt as never, { persona: '' })
  await ctx.plugin(host.ToolRuntime as never)
  await ctx.plugin(host.AgentRegistry as never)
  await ctx.plugin(host.AgentLoop as never, { agents: [] })
  await ctx.plugin(ResearchEngine as never, { requireResearchTools: true })
  return ctx
}

const TABLE_INPUT = {
  model: {
    title: 'Fixture results',
    columns: [{ header: 'Approach' }, { header: 'BLEU', decimals: 1 }],
    rows: [[{ kind: 'text', text: 'adaptive-rl' }, { kind: 'number', value: 42.1 }]],
  },
  target: 'markdown',
}

describe('AgentLoopResearchToolInvoker', () => {
  it('rejects pipeline_only ids with a stable code, without touching the loop', async () => {
    const ctx = await setupRuntime()
    const invoker = new AgentLoopResearchToolInvoker(ctx)
    const result = await invoker.invoke('literature-search', { topic: 'traffic' }, { timestamp: TS })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('RESEARCH_TOOL_NOT_MODEL_READY')
      expect(result.truthfulness).toBe('cordis_tool_runtime')
      expect(result.message).toContain('pipeline_only')
    }
    await ctx.fiber.dispose()
  })

  it('executes a model_ready tool through the REAL agent-loop and returns its artifact', async () => {
    const ctx = await setupRuntime()
    const invoker = new AgentLoopResearchToolInvoker(ctx)
    const result = await invoker.invoke('three-line-table', TABLE_INPUT, { timestamp: TS })
    expect(result, JSON.stringify(result)).toBeTruthy()
    if (!result.ok) throw new Error('invoke failed: ' + JSON.stringify(result))
    if (result.ok) {
      const artifact = result.artifact as { meta?: { toolId?: string }; render?: { target?: string } }
      expect(artifact.meta?.toolId).toBe('three-line-table')
      expect(artifact.render?.target).toBe('markdown')
    }
    await ctx.fiber.dispose()
  })

  it('Direct and AgentLoop are business-equivalent on the same input, with different provenance', async () => {
    const direct = new DirectResearchToolInvoker()
    const directResult = await direct.invoke('three-line-table', TABLE_INPUT, { timestamp: TS })
    expect(directResult.ok).toBe(true)
    const ctx = await setupRuntime()
    const loopInvoker = new AgentLoopResearchToolInvoker(ctx)
    const loopResult = await loopInvoker.invoke('three-line-table', TABLE_INPUT, { timestamp: TS })
    expect(loopResult.ok).toBe(true)
    if (directResult.ok && loopResult.ok) {
      // Business equivalence: producedAt is a channel-time provenance field
      // (the agent loop runs on wall-clock; the Direct channel is pinned to the
      // provided timestamp), so it is stripped before comparison.
      const stripTime = (value: unknown): unknown => {
        const copy = JSON.parse(JSON.stringify(value)) as { meta?: { producedAt?: number } }
        if (copy.meta !== undefined) delete copy.meta.producedAt
        return copy
      }
      expect(stripTime(loopResult.artifact)).toEqual(stripTime(directResult.artifact))
      expect(directResult.provenance).toBe('direct')
      expect(directResult.truthfulness).toBe('direct_fixture')
      expect(loopResult.provenance).toBe('agent-loop-toolruntime')
      expect(loopResult.truthfulness).toBe('cordis_tool_runtime')
      // Same raw adapter path is exercised by the Direct channel too.
      const raw = executeResearchTool('three-line-table', TABLE_INPUT, undefined, TS)
      expect(stripTime(directResult.artifact)).toEqual(stripTime(raw))
    }
    await ctx.fiber.dispose()
  })
})
