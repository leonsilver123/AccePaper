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
 * than passing an empty product downstream. The rejection names the turn's own error
 * when it had one, so an upstream failure is never reported as a neutral empty result.
 *
 * The session it creates carries an absolute `cwd` (see {@link LlmProseWriterConfig.cwd}).
 * `{{cwd}}` is a strict system-prompt variable referenced by every shipped bundle's
 * persona; a session without one fails at prompt assembly and its request never
 * reaches the provider at all.
 */

import { randomUUID } from 'node:crypto'

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
  /** The third parameter is the session's creation metadata; `cwd` lives there. */
  create: (
    sessionId: unknown,
    config: { provider: string; model: string },
    meta: { cwd: string },
  ) => unknown
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

/**
 * The failure a session's turn ended with, if it ended that way.
 *
 * A turn that fails during prompt assembly leaves no `assistant/message` event at
 * all, so the only record of WHY is the `turn/end` reason. Reading it is what keeps
 * an upstream failure (unresolved prompt variable, provider error, cancelled
 * request) from being reported as the neutral "the model produced no text".
 *
 * @param event - one entry from a session's snapshot events.
 * @returns the reported message, or undefined when this event is not a failed turn end.
 */
export function turnErrorOf(event: unknown): string | undefined {
  if (event === null || typeof event !== 'object') return undefined
  const record = event as {
    type?: unknown
    data?: { reason?: { kind?: unknown; error?: unknown } }
  }
  if (record.type !== 'turn/end') return undefined
  const reason = record.data?.reason
  if (reason?.kind !== 'error') return undefined
  const error = reason.error
  if (error !== null && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return String(error)
}

export interface LlmProseWriterConfig {
  /** Registered provider route, e.g. `deepseek-official`. */
  readonly provider: string
  /** Model id offered by that provider. */
  readonly model: string
  /**
   * Absolute working directory for the session this writer creates.
   *
   * Required, not defaulted: `{{cwd}}` is a strict system-prompt variable that every
   * shipped bundle's persona references, and a session created without one fails at
   * prompt ASSEMBLY — before any request reaches the provider. The engine resolves
   * this once from its own `workspace` config, so a deployment does not restate it
   * on the `prose` row.
   */
  readonly cwd: string
  /** Milliseconds to wait for the loop to go idle before failing the write. */
  readonly idleTimeoutMs?: number
}

const DEFAULT_IDLE_TIMEOUT_MS = 120_000

/**
 * Session id for one write.
 *
 * The suffix is random, not a per-process counter. Sessions are PERSISTED, so a counter
 * restarts at zero on every boot and collides with the previous run's sessions: the
 * store rejects the id ("already persisted at a different cwd"), which makes every prose
 * write fail after a restart. Had the working directory matched, the collision would be
 * worse than a failure — the write would resume a previous run's session and pull its
 * assistant text into this step's product, which is precisely the cross-session leak the
 * writer must not have.
 *
 * @returns an id unique across processes and concurrent writes.
 */
function proseSessionId(): string {
  return `research-prose-${randomUUID()}`
}

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
 * The most recent failed-turn reason in a session's events.
 *
 * @param events - the session's snapshot events, in log order.
 * @returns the last reported message, or undefined when no turn ended in error.
 */
function lastTurnErrorFrom(events: ReadonlyArray<unknown>): string | undefined {
  let failure: string | undefined
  for (const event of events) {
    const message = turnErrorOf(event)
    if (message !== undefined) failure = message
  }
  return failure
}

/**
 * Real-model prose writer built on the host agent loop.
 *
 * @remarks A write that yields no assistant text rejects; it never resolves with an
 * empty string, because every caller treats the text as the step's product.
 */
export class LlmProseWriter {
  /**
   * Which channel this writer was configured for.
   *
   * The runner labels an artifact with what ran. A deterministic route calls no model, and its
   * product's own text says so, so the runner has to be able to read the channel rather than
   * infer `model` from the writer's existence.
   */
  readonly channel: 'llm' | 'deterministic'

  private readonly ctx: Context
  private readonly config: LlmProseWriterConfig
  /** Resolved lazily: the host services load through the same non-literal dynamic
   *  import seam as the tool adapter, so host type graphs never enter this build. */
  private host: SessionHostFace | undefined

  constructor(ctx: Context, config: LlmProseWriterConfig, channel: 'llm' | 'deterministic' = 'llm') {
    this.ctx = ctx
    this.config = config
    this.channel = channel
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
    // Checked BEFORE any await. A signal that arrived already aborted would otherwise
    // be missed: the listener below is attached later, and an aborted signal never
    // fires `abort` again — the write would run to completion against a cancelled request.
    if (request.signal?.aborted === true) {
      throw new Error(`[research-prose] ${request.stepId}: cancelled before the request was sent`)
    }
    const host = await this.loadHost()
    // READ THE SERVICE THROUGH `ctx.get`, NOT THE PROPERTY PROXY. `ctx.agentLoop`
    // only resolves when the reading context declares `agentLoop` in its `inject`;
    // this writer is built by the research engine, which does not, so the proxy threw
    // `cannot get property "agentLoop" without inject` on the FIRST real prose call —
    // a configured `prose` channel that had never been exercised. `ctx.get` reads the
    // global service store, which is the documented read for a service this plugin
    // does not declare. A missing loop is reported as itself, not as a proxy error.
    const agentLoop = this.ctx.get('agentLoop') as AgentLoopFace | undefined
    if (agentLoop === undefined) {
      throw new Error(
        '[research-prose] the host provides no `agentLoop` service, so the configured prose '
        + 'channel cannot send a request (failing rather than returning empty text)',
      )
    }
    const anyCtx = this.ctx as Context & {
      on: (event: string, cb: (payload: { agent: unknown; status: string }) => void) => () => void
    }

    const sessionId = host.SessionId(proseSessionId())
    // The THIRD argument is the session's creation metadata, and `cwd` is the only
    // source of the strict `{{cwd}}` prompt variable. Omitting it (as this call did)
    // made every prose request fail at prompt assembly with
    // `prompt variable "{{cwd}}" has no value for this assembly`, so no request ever
    // reached the provider — a configured channel that failed before the model.
    const agent = agentLoop.create(sessionId, {
      provider: this.config.provider,
      model: this.config.model,
    }, { cwd: this.config.cwd }) as {
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

    const events = agent.session.snapshotEvents()
    const text = assistantTextFrom(events)
    if (text.length === 0) {
      // Separate the two outcomes a zero-length product can mean. A turn that ENDED
      // IN ERROR never reached the provider (unresolved prompt variable, provider
      // failure, cancellation), and reporting that as "the model produced no text"
      // hides the cause in exactly the way the engine's own discipline forbids.
      const failure = lastTurnErrorFrom(events)
      if (failure !== undefined) {
        throw new Error(
          `[research-prose] ${request.stepId}: the request failed before the model produced `
          + `text: ${failure}`,
        )
      }
      throw new Error(`[research-prose] ${request.stepId}: the model produced no text (no default pass)`)
    }
    return { text, provider: this.config.provider, model: this.config.model }
  }
}
