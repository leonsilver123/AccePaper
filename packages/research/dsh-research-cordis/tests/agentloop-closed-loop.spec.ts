// Phase 3 — AgentLoop minimal closed loop (real host services, no gateway).
//
// Assembles the SAME real stack the host agent-loop tests use: LlmRuntime +
// SessionStore + SessionProjectionRegistry + SystemPrompt + ToolRuntime +
// AgentRegistry + AgentLoop, with a deterministic MockAdapter LLM. The
// research engine (requireResearchTools) registers the seven tools; the mock
// model emits a real tool-call, so the loop drives the FULL ToolRuntime chain
// (prepare→guard→dispatch/execute→finalize→finish) for a model_ready tool.
//
// Assertions are coarse-but-real: the loop must reach idle, the model-visible
// result of the executed research tool must contain its artifact marker
// (`"toolId":"<id>"`), and a pipeline_only tool called by the model must be
// denied by the exposure guard (its artifact marker must never appear).
//
// Intended deviation: this runtime-integration spec deliberately loads host
// services through non-literal dynamic imports so their type graphs never
// enter this package's static compilation (same seam as src/tools.ts). The
// resulting no-unsafe-* diagnostics only exist under the stricter ad-hoc 90-rule
// pass; the repo-enforced 49-rule gate does not include those rules.

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RESEARCH_TOOL_DIRECTORY } from '@deepseek-ai/dsh-research-tools'
import { ResearchEngine } from '../src/index.ts'

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
    SessionId: session.SessionId as (id: string) => unknown,
    SessionProjectionRegistry: projection.default as new (ctx: Context) => unknown,
    SystemPrompt: prompt.default as new (ctx: Context, cfg: { persona: string }) => unknown,
    ToolRuntime: tools.default as new (ctx: Context) => unknown,
    ToolCallId: tools.ToolCallId as (id: string) => unknown,
    AgentRegistry: agent.default as new (ctx: Context) => unknown,
    AgentLoop: loop.default as new (ctx: Context, cfg: { agents: unknown[] }) => unknown,
    LlmAdapter: llm.LlmAdapter as new () => unknown,
    createUserMessage: llm.createUserMessage as (content: unknown) => unknown,
  }
}

type AnyAdapter = {
  registerAdapter: (providers: string[], adapter: unknown) => void
}
type AnyAgent = {
  followup: (message: unknown) => void
  session: { snapshotEvents: () => unknown[] }
}

function textChunks(finalText: string): Array<Record<string, unknown>> {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: finalText },
    { type: 'block-end', index: 0, block: { type: 'text', text: finalText } },
    { type: 'usage', usage: { inputTokens: 3, outputTokens: finalText.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolCallChunks(callId: string, name: string, args: object): Array<Record<string, unknown>> {
  const raw = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: raw },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: raw } },
    { type: 'usage', usage: { inputTokens: 3, outputTokens: 3 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

async function buildHarness(host: Awaited<ReturnType<typeof loadHost>>, script: unknown[]) {
  const ctx = new Context()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyCtx = ctx as any
  await ctx.plugin(host.LlmRuntime as never)
  await ctx.plugin(host.SessionStore as never)
  await ctx.plugin(host.SessionProjectionRegistry as never)
  await ctx.plugin(host.SystemPrompt as never, { persona: '' })
  await ctx.plugin(host.ToolRuntime as never)
  await ctx.plugin(host.AgentRegistry as never)
  await ctx.plugin(host.AgentLoop as never, { agents: [] })
  await ctx.plugin(ResearchEngine as never, { requireResearchTools: true })

  // Deterministic mock LLM: subclass at runtime over the real LlmAdapter base.
  class MockAdapter extends host.LlmAdapter {
    stream = async function* () {
      // replaced below
    }
  }
  const adapter = new MockAdapter()
  const requests: unknown[] = []
  // @ts-expect-error dynamic override
  adapter.requests = requests
  // @ts-expect-error dynamic override
  adapter.script = [...script]
  // @ts-expect-error dynamic subclass contract
  adapter.resolveModel = () => Promise.resolve({ provider: 'mock', id: 'mock', name: 'mock' })
  // @ts-expect-error dynamic subclass contract
  adapter.stream = async function* (options: { signal?: AbortSignal }) {
    requests.push(options)
    const entry = (this as { script: unknown[] }).script.shift()
    if (entry === undefined) throw new Error('MockAdapter script exhausted')
    const chunks = Array.isArray(entry) ? entry : [entry]
    for (const chunk of chunks) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
  ;(anyCtx.llm as AnyAdapter).registerAdapter(['mock'], adapter)
  return { ctx, anyCtx, requests }
}

async function idle(
  anyCtx: { on: (e: string, cb: (x: { agent: unknown; status: string }) => void) => () => void },
  agent: AnyAgent,
): Promise<void> {
  await new Promise<void>((resolve) => {
    const off = anyCtx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { off(); resolve() }
    })
  })
}

function textOf(events: unknown[]): string {
  return JSON.stringify(events)
}

/** Extract the first tool-result payload text (model-visible content). */
function firstToolResultText(events: unknown[]): string | undefined {
  for (const event of events) {
    const ev = event as {
      type?: string
      data?: { message?: { content?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> } }
    }
    if (ev.type !== 'tool/result') continue
    for (const block of ev.data?.message?.content ?? []) {
      for (const part of block.content ?? []) {
        if (part.type === 'text' && part.text !== undefined) return part.text
      }
    }
  }
  return undefined
}

const TABLE_CALL = {
  model: {
    title: 'Fixture results',
    columns: [{ header: 'Approach' }, { header: 'BLEU', decimals: 1 }],
    rows: [[{ kind: 'text', text: 'adaptive-rl' }, { kind: 'number', value: 42.1 }]],
  },
  target: 'markdown',
}

describe('AgentLoop minimal closed loop (model_ready runtime evidence)', () => {
  it('executes a model_ready research tool through the REAL ToolRuntime chain', async () => {
    const host = await loadHost()
    const { ctx, anyCtx } = await buildHarness(host, [
      toolCallChunks('c1', 'three-line-table', TABLE_CALL),
      textChunks('done'),
    ])
    const agent = anyCtx.agentLoop.create(host.SessionId('a1'), { provider: 'mock', model: 'mock' }) as AnyAgent
    agent.followup(host.createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await idle(anyCtx, agent)
    const events = agent.session.snapshotEvents()
    const resultText = firstToolResultText(events)
    expect(resultText).toBeDefined()
    const artifact = JSON.parse(resultText as string) as { meta?: { toolId?: string } }
    // The model-visible tool result carries the executed artifact's marker —
    // proof the business function ran through the real ToolRuntime and its
    // artifact was finalized (isError:false).
    expect(artifact.meta?.toolId).toBe('three-line-table')
    expect(textOf(events)).toContain('done')
    await ctx.fiber.dispose()
  })

  it('DENIES a pipeline_only tool called by the model (guard before business, no artifact)', async () => {
    const host = await loadHost()
    const { ctx, anyCtx } = await buildHarness(host, [
      toolCallChunks('c1', 'literature-search', { topic: 'adaptive traffic signals' }),
      textChunks('done'),
    ])
    const agent = anyCtx.agentLoop.create(host.SessionId('a2'), { provider: 'mock', model: 'mock' }) as AnyAgent
    agent.followup(host.createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await idle(anyCtx, agent)
    const events = agent.session.snapshotEvents()
    const resultText = firstToolResultText(events)
    expect(resultText).toBeDefined()
    // The exposure guard's denial is observable in the tool result...
    expect(resultText).toContain('pipeline-only')
    // ...and no literature-search artifact ever materialized (guard ran before
    // the business function: the payload is an error, not an artifact).
    expect(() => JSON.parse(resultText as string)).toThrow()
    expect(textOf(events)).not.toContain('bindingHash')
    await ctx.fiber.dispose()
  })

  it('catalog still spans the seven tools (tool ≠ step semantics unaffected)', () => {
    expect(RESEARCH_TOOL_DIRECTORY).toHaveLength(7)
  })
})
