/**
 * LlmProseWriter — the real-model channel for steps whose product is text.
 *
 * The runner's prose steps (A1's gap analysis, D2 outline, D3 writing, D4 rebuttal)
 * declare a prose-writer injection point but carry fixture text as their fallback.
 * This class is the implementation that reaches a real provider, so a deployment can
 * produce prose derived from its own retrieved evidence rather than a constant.
 *
 * It routes through the host's REAL agent loop (`ctx.agentLoop.create`) instead of
 * calling a provider directly: that keeps the request inside the harness's own
 * session, logging, and cancellation machinery, and it mints no agent of its own.
 * Only the model choice is supplied here.
 *
 * The writer never invents a result: a loop that ends without any assistant text
 * resolves to a rejection, and the caller (the step executor) fails the step rather
 * than passing an empty product downstream.
 */

import type { Context } from '@deepseek-ai/cordis'

/**
 * Structural twins of the runner's prose contract. Declared locally rather than
 * imported so this adapter package does not take a dependency on the runner package:
 * TypeScript's structural typing accepts these when the writer is handed to
 * `DriveOptions.proseWriter`, and neither package gains a cycle.
 */
export interface ProseRequestLike {
  readonly stepId: string
  readonly instruction: string
  readonly context: Readonly<Record<string, unknown>>
  readonly signal?: AbortSignal
}

export interface ProseResultLike {
  readonly text: string
  readonly provider: string
  readonly model: string
}

/** Structural faces of the host services this writer needs. */
interface AgentLoopFace {
  create: (sessionId: unknown, config: { provider: string; model: string }) => unknown
}

interface SessionHostFace {
  SessionId: (value: string) => unknown
  createUserMessage: (input: { content: Array<{ type: 'text'; text: string }>; source: { kind: string } }) => unknown
}

/**
 * Text blocks out of one `assistant/message` event.
 *
 * The session emits `assistant/message` with the message under `data.message`; the
 * earlier reading of a `message.assistant` type with `data.content` matched nothing
 * that is ever emitted, so the writer resolved every call as "no text".
 *
 * @param event - one entry from a session's snapshot events.
 * @returns the concatenated text blocks, empty when the event carries none.
 */
export function assistantTextOf(event: unknown): ReadonlyArray<string> {
  if (event === null || typeof event !== 'object') return []
  const record = event as { type?: unknown; data?: { message?: { content?: unknown } } }
  if (record.type !== 'assistant/message') return []
  const content = record.data?.message?.content
  if (!Array.isArray(content)) return []
  const parts: string[] = []
  for (const block of content) {
    const piece = block as { type?: unknown; text?: unknown }
    if (piece.type === 'text' && typeof piece.text === 'string') parts.push(piece.text)
  }
  return parts
}

export interface LlmProseWriterConfig {
  /** Registered provider route, e.g. `deepseek-official`. */
  readonly provider: string
  /** Model id offered by that provider. */
  readonly model: string
  /** Milliseconds to wait for the loop to go idle before failing the write. */
  readonly idleTimeoutMs?: number
}

const DEFAULT_IDLE_TIMEOUT_MS = 120_000

/** Monotonic suffix so concurrent writes never share a session id. */
let proseSeq = 0

/**
 * Turn a prose request into one model message. The upstream artifact values travel
 * as a compact JSON block so the model reads the same evidence the step did.
 *
 * @param request - the step's instruction plus its upstream context.
 * @returns the user-message text.
 */
function promptFor(request: ProseRequestLike): string {
  const context = JSON.stringify(request.context, null, 2)
  return `${request.instruction}\n\nContext (JSON):\n${context}`
}

/** Collect the assistant text from a session's snapshot events. */
function assistantTextFrom(events: ReadonlyArray<unknown>): string {
  return events.flatMap(event => assistantTextOf(event)).join('\n').trim()
}

/**
 * Real-model prose writer built on the host agent loop.
 *
 * @remarks A write that yields no assistant text rejects; it never resolves with an
 * empty string, because every caller treats the text as the step's product.
 */
export class LlmProseWriter {
  private readonly ctx: Context
  private readonly config: LlmProseWriterConfig
  /** Resolved lazily: the host services load through the same non-literal dynamic
   *  import seam as the tool adapter, so host type graphs never enter this build. */
  private host: SessionHostFace | undefined

  constructor(ctx: Context, config: LlmProseWriterConfig) {
    this.ctx = ctx
    this.config = config
  }

  private async loadHost(): Promise<SessionHostFace> {
    if (this.host !== undefined) return this.host
    // `SessionId` belongs to the session package; `createUserMessage` belongs to the
    // LLM package. Reading both from one of them silently yields undefined for the
    // other, which is why each is resolved from its own module.
    const sessions = (await import('@deepseek-ai/' + 'dsh-session')) as {
      SessionId: SessionHostFace['SessionId']
    }
    const llm = (await import('@deepseek-ai/' + 'dsh-llm')) as {
      createUserMessage: SessionHostFace['createUserMessage']
    }
    if (typeof llm.createUserMessage !== 'function' || typeof sessions.SessionId !== 'function') {
      throw new Error(
        '[research-prose] host services are missing createUserMessage/SessionId — the prose '
        + 'channel cannot send a request (failing rather than returning empty text)',
      )
    }
    this.host = { SessionId: sessions.SessionId, createUserMessage: llm.createUserMessage }
    return this.host
  }

  /**
   * Run one prose request through the agent loop.
   *
   * @param request - the step's instruction and upstream context.
   * @returns the model's text plus the route that produced it.
   * @throws {Error} when the loop yields no assistant text or fails to settle.
   */
  async write(request: ProseRequestLike): Promise<ProseResultLike> {
    const host = await this.loadHost()
    const anyCtx = this.ctx as Context & {
      agentLoop: AgentLoopFace
      on: (event: string, cb: (payload: { agent: unknown; status: string }) => void) => () => void
    }

    const sessionId = host.SessionId(`research-prose-${proseSeq++}`)
    const agent = anyCtx.agentLoop.create(sessionId, {
      provider: this.config.provider,
      model: this.config.model,
    }) as {
      followup: (message: unknown) => void
      session: { snapshotEvents: () => unknown[] }
    }

    const settled = new Promise<void>((resolve, reject) => {
      const timeoutMs = this.config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
      const timer = setTimeout(() => {
        off()
        reject(new Error(`[research-prose] ${request.stepId}: agent loop idle timeout after ${timeoutMs}ms`))
      }, timeoutMs)
      const off = anyCtx.on('agent/status', ({ agent: subject, status }) => {
        if (subject !== agent || status !== 'idle') return
        clearTimeout(timer)
        off()
        resolve()
      })
      request.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        off()
        reject(new Error(`[research-prose] ${request.stepId}: cancelled`))
      }, { once: true })
    })

    agent.followup(host.createUserMessage({
      content: [{ type: 'text', text: promptFor(request) }],
      source: { kind: 'user' },
    }))
    await settled

    const text = assistantTextFrom(agent.session.snapshotEvents())
    if (text.length === 0) {
      throw new Error(`[research-prose] ${request.stepId}: the model produced no text (no default pass)`)
    }
    return { text, provider: this.config.provider, model: this.config.model }
  }
}
