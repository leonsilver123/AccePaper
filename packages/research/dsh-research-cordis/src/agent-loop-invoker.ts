/**
 * AgentLoopResearchToolInvoker (Phase 2/3) — model_ready tools ONLY.
 *
 * Routes an invocation through the REAL agent-loop: an ephemeral deterministic
 * mock LLM adapter emits a genuine tool-call for the requested model_ready
 * tool; the loop creates a registry-minted ToolRuntime execution and the FULL
 * prepare→guard→dispatch/execute→finalize→finish chain runs against the
 * registered research tool. No agent is forged: a real Agent is created by
 * ctx.agentLoop with its own session; the adapter is the only mock (LLM).
 *
 *  - pipeline_only tool ids are rejected BEFORE any loop work (stable code
 *    RESEARCH_TOOL_NOT_MODEL_READY) — never executed, never routed.
 *  - truthfulness = 'cordis_tool_runtime', provenance = 'agent-loop-toolruntime'.
 *  - ToolRuntime errors/cancellation/timeouts surface as the loop's own
 *    tool/result payloads; this invoker maps failures to ok:false without
 *    swallowing them.
 *  - Host services are loaded through the same non-literal dynamic-import seam
 *    as src/tools.ts, so host type graphs never enter this compilation.
 */
import type { Context } from '@deepseek-ai/cordis'
import { modelReadyResearchToolIds } from './tools.ts'
import type {
  ResearchToolInvocationContext,
  ResearchToolInvocationResult,
  ResearchToolInvoker,
  ResearchToolProvenance,
  ResearchToolTruthfulness,
  ResearchToolId,
} from '@deepseek-ai/dsh-research-tools'
import { validateResearchToolInput } from '@deepseek-ai/dsh-research-tools'

/** model_ready set (single source: the exposure catalog). */
const MODEL_READY = new Set<string>(modelReadyResearchToolIds())

interface AgentLoopHost {
  LlmAdapter: new () => unknown
  createUserMessage: (content: unknown) => unknown
  ToolCallId: (id: string) => unknown
  SessionId: (id: string) => unknown
}

async function loadAgentLoopHost(): Promise<AgentLoopHost> {
  const llm = await import('@deepseek-ai/' + 'dsh-llm')
  const session = await import('@deepseek-ai/' + 'dsh-session')
  const tools = await import('@deepseek-ai/' + 'dsh-tools')
  return {
    LlmAdapter: llm.LlmAdapter as new () => unknown,
    createUserMessage: llm.createUserMessage as (content: unknown) => unknown,
    ToolCallId: tools.ToolCallId as (id: string) => unknown,
    SessionId: session.SessionId as (id: string) => unknown,
  }
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

function toolCallChunks(callId: string, name: string, args: unknown): Array<Record<string, unknown>> {
  const raw = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: raw },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: raw } },
    { type: 'usage', usage: { inputTokens: 3, outputTokens: 3 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
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

let adapterSeq = 0

/** Invoker bound to a live context whose agentLoop/tools/llm are present. */
export class AgentLoopResearchToolInvoker implements ResearchToolInvoker {
  readonly truthfulness: ResearchToolTruthfulness = 'cordis_tool_runtime'
  readonly provenance: ResearchToolProvenance = 'agent-loop-toolruntime'

  private readonly ctx: Context

  constructor(ctx: Context) {
    this.ctx = ctx
  }

  async invoke(
    toolId: ResearchToolId,
    input: unknown,
    context: ResearchToolInvocationContext,
  ): Promise<ResearchToolInvocationResult> {
    if (!MODEL_READY.has(toolId)) {
      return {
        ok: false,
        code: 'RESEARCH_TOOL_NOT_MODEL_READY',
        message: `[${toolId}] is not model_ready; AgentLoopResearchToolInvoker only carries `
          + 'the three model-ready renders (figure/three-line-table/roadmap). '
          + 'pipeline_only tools stay on the Direct channel (direct_fixture).',
        truthfulness: this.truthfulness,
        provenance: this.provenance,
      }
    }
    const violations = validateResearchToolInput(toolId, input)
    if (violations.length > 0) {
      return {
        ok: false,
        code: 'RESEARCH_TOOL_INPUT_REJECTED',
        message: `[${toolId}] ${violations.join('; ')}`,
        truthfulness: this.truthfulness,
        provenance: this.provenance,
      }
    }
    try {
      const host = await loadAgentLoopHost()
      const artifact = await this.runThroughAgentLoop(host, toolId, input, context.timestamp)
      return { ok: true, artifact, truthfulness: this.truthfulness, provenance: this.provenance }
    } catch (error) {
      return {
        ok: false,
        code: 'RESEARCH_TOOL_AGENTLOOP_FAILED',
        message: error instanceof Error ? error.message : String(error),
        truthfulness: this.truthfulness,
        provenance: this.provenance,
      }
    }
  }

  private async runThroughAgentLoop(
    host: AgentLoopHost,
    toolId: string,
    input: unknown,
    timestamp: number,
  ): Promise<unknown> {
    const anyCtx = this.ctx as Context & {
      agentLoop: { create: (sessionId: unknown, cfg: { provider: string; model: string }) => unknown }
      on: (event: string, cb: (x: { agent: unknown; status: string }) => void) => () => void
      llm: { registerAdapter: (providers: string[], adapter: unknown) => void }
    }

    const MockAdapter = host.LlmAdapter as new () => object
    const adapter = new MockAdapter() as {
      requests: unknown[]
      script: unknown[]
      resolveModel: (provider?: string, model?: string) => Promise<{ provider: string; id: string; name: string }>
      stream: (options: { signal?: AbortSignal }) => AsyncGenerator<Record<string, unknown>>
    }
    adapter.requests = []
    adapter.resolveModel = (provider?: string, model?: string) => Promise.resolve({ provider: provider ?? 'mock', id: model ?? 'mock', name: model ?? 'mock' })
    adapter.stream = async function* (options: { signal?: AbortSignal }) {
      const script = this.script
      const entry = script.shift()
      if (entry === undefined) throw new Error('MockAdapter script exhausted')
      const chunks = Array.isArray(entry) ? entry : [entry]
      for (const chunk of chunks as Array<Record<string, unknown>>) {
        if (options.signal?.aborted) throw new Error('aborted')
        yield chunk
      }
    }

    // Unique provider avoids clobbering any pre-registered mock adapter.
    const provider = `research-mock-${adapterSeq++}`
    anyCtx.llm.registerAdapter([provider], adapter)
    const agent = anyCtx.agentLoop.create(host.SessionId(`res-invoke-${adapterSeq}`), {
      provider,
      model: 'mock',
    }) as {
      followup: (message: unknown) => void
      session: { snapshotEvents: () => unknown[] }
    }
    const plan = [
      toolCallChunks('c1', toolId, input),
      textChunks('done'),
    ]
    adapter.script = plan
    agent.followup(host.createUserMessage({
      content: [{ type: 'text', text: `run ${toolId} (timestamp ${timestamp})` }],
      source: { kind: 'user' },
    }))

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('agent loop idle timeout')), 15_000)
      const off = anyCtx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') {
          clearTimeout(timer)
          off()
          resolve()
        }
      })
    })

    const events = agent.session.snapshotEvents()
    const resultText = firstToolResultText(events)
    if (resultText === undefined) {
      const types = events.map(event => (event as { type?: string }).type ?? '?').join(',')
      const last = (events[events.length - 1] as { data?: unknown })?.data
      throw new Error(`no tool/result payload produced by the agent loop [types=${types}] [last=${JSON.stringify(last)?.slice(0, 300)}]`)
    }
    return JSON.parse(resultText) as unknown
  }
}
