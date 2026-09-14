/**
 * LlmProseWriter — contract tests for the real-model prose channel.
 *
 * These exist because the channel was once written, claimed to work, and shipped
 * WITHOUT ever being exercised: it read `createUserMessage` from the session package
 * (where it does not exist) and matched a `message.assistant` event type that is
 * never emitted. Every call failed, and nothing noticed, because no test constructed
 * the class and no deployment configured `prose`.
 *
 * The second round of failures was subtler and is guarded here too: the writer created
 * its agent session WITHOUT a working directory, and the persona's strict `{{cwd}}`
 * variable then aborted the request during prompt assembly — before any provider call.
 * The writer reported that as "the model produced no text". Both halves of that are
 * pinned below: the harness persona references `{{cwd}}` on purpose, and the adapters
 * assert the REQUEST ARRIVED rather than only that text came back.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { assistantTextOf, LlmProseWriter, turnErrorOf } from '../src/llm-prose-writer.ts'

const CWD = process.cwd()
const STEP = 'A1-landscape'

/** A scripted provider: each model call consumes the next entry. */
type Entry = StreamChunk[] | 'hang'

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: Entry[]) {
    super()
  }

  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('ScriptedAdapter: script exhausted')
    if (entry === 'hang') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'partial' }
      await new Promise<void>((_resolve, reject) => {
        if (options.signal?.aborted) { reject(new Error('aborted')); return }
        options.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      })
      return
    }
    for (const chunk of entry) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

/** Text delivered as `pieces` separate deltas, so joining order is observable. */
function textChunks(pieces: string[]): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...pieces.map((text): StreamChunk => ({ type: 'text-delta', index: 0, text })),
    { type: 'block-end', index: 0, block: { type: 'text', text: pieces.join('') } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: pieces.join('').length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** A turn that ends normally but carries no content block at all. */
function emptyChunks(): StreamChunk[] {
  return [
    { type: 'usage', usage: { inputTokens: 5, outputTokens: 0 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** A turn whose only block is a tool call for a tool this host does not have. */
function toolCallOnlyChunks(): StreamChunk[] {
  const id = ToolCallId('c1')
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name: 'no-such-tool', argumentsDelta: '{}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'no-such-tool', arguments: '{}' } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: 2 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/**
 * Load a host plugin by a non-literal specifier, the same seam the production code
 * uses. The result is typed `unknown`-valued rather than `any`-valued so the specs
 * stay inside the repository's no-unsafe-* lint rules.
 */
async function hostPlugin(name: string): Promise<unknown> {
  const loaded = (await import('@deepseek-ai/' + name)) as Record<string, unknown>
  return loaded.default
}

async function setupRuntime(script: Entry[]) {
  const ctx = new Context()
  await ctx.plugin((await hostPlugin('dsh-llm')) as new (ctx: Context) => unknown)
  await ctx.plugin((await hostPlugin('dsh-session')) as new (ctx: Context) => unknown)
  await ctx.plugin((await hostPlugin('dsh-session-projection')) as new (ctx: Context) => unknown)
  // The persona references the STRICT variable whose absence broke the channel. A
  // writer that forgets the session cwd fails here, before any request is sent.
  await ctx.plugin(
    (await hostPlugin('dsh-system-prompt')) as new (ctx: Context, cfg: { persona: string }) => unknown,
    { persona: 'You work in {{cwd}}.' },
  )
  await ctx.plugin((await hostPlugin('dsh-tools')) as new (ctx: Context) => unknown)
  await ctx.plugin((await hostPlugin('dsh-agent')) as new (ctx: Context) => unknown)
  await ctx.plugin(
    (await hostPlugin('dsh-agent-loop')) as new (ctx: Context, cfg: { agents: unknown[] }) => unknown,
    { agents: [] },
  )

  const adapter = new ScriptedAdapter(script)
  ;(ctx as unknown as { llm: { registerAdapter: (p: string[], a: unknown) => void } })
    .llm.registerAdapter(['spec-prose'], adapter)
  return { ctx, adapter }
}

function writerFor(ctx: Context, overrides: Partial<{ idleTimeoutMs: number }> = {}): LlmProseWriter {
  return new LlmProseWriter(ctx, {
    provider: 'spec-prose',
    model: 'spec-model',
    cwd: CWD,
    ...overrides,
  })
}

describe('assistantTextOf', () => {
  it("reads text out of a real 'assistant/message' event", () => {
    const event = {
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'first line' },
            { type: 'text', text: 'second line' },
          ],
        },
      },
    }

    expect(assistantTextOf(event)).toEqual(['first line', 'second line'])
  })

  it('ignores non-text blocks and malformed events', () => {
    expect(assistantTextOf({
      type: 'assistant/message',
      data: { message: { content: [{ type: 'tool-call', name: 'x' }, { type: 'text', text: 'kept' }] } },
    })).toEqual(['kept'])

    expect(assistantTextOf({ type: 'user/message', data: { message: { content: [{ type: 'text', text: 'no' }] } } })).toEqual([])
    expect(assistantTextOf({ type: 'assistant/message', data: {} })).toEqual([])
    expect(assistantTextOf(null)).toEqual([])
    expect(assistantTextOf('assistant/message')).toEqual([])
  })
})

describe('turnErrorOf', () => {
  it('reports the message of a turn that ended in error', () => {
    expect(turnErrorOf({
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'error', error: { message: 'prompt variable broke', code: 'UNKNOWN' } } },
    })).toBe('prompt variable broke')
  })

  it('reports nothing for a normal turn end or an unrelated event', () => {
    expect(turnErrorOf({ type: 'turn/end', data: { turn: 1, reason: { kind: 'stop' } } })).toBeUndefined()
    expect(turnErrorOf({ type: 'step/end', data: { turn: 1, step: 1 } })).toBeUndefined()
    expect(turnErrorOf(null)).toBeUndefined()
  })

  it('still reports a non-object error rather than dropping it', () => {
    expect(turnErrorOf({ type: 'turn/end', data: { reason: { kind: 'error', error: 'plain string' } } }))
      .toBe('plain string')
  })
})

describe('LlmProseWriter host resolution', () => {
  it('resolves createUserMessage from the LLM package and SessionId from the session package', async () => {
    // The two live host modules, imported here so the test fails if either export is
    // ever renamed or moved — which is the failure that went unnoticed before.
    const llm = await import('@deepseek-ai/dsh-llm')
    const session = await import('@deepseek-ai/dsh-session')

    expect(typeof llm.createUserMessage).toBe('function')
    expect(typeof session.SessionId).toBe('function')
  })

  it('rejects a write when the host services are unreachable instead of returning empty text', async () => {
    // A context with no agentLoop: the write must fail loudly rather than resolve ''
    // (an empty product would be treated by every caller as a valid step result).
    const writer = new LlmProseWriter({} as never, { provider: 'p', model: 'm', cwd: CWD })

    await expect(writer.write({ stepId: STEP, instruction: 'x', context: {} }))
      .rejects.toThrow()
  })
})

describe('LlmProseWriter against a real agent loop', () => {
  it('REACHES THE PROVIDER under a persona that requires {{cwd}}, and returns its text', async () => {
    const { ctx, adapter } = await setupRuntime([textChunks(['one known paragraph'])])
    const result = await writerFor(ctx).write({ stepId: STEP, instruction: 'x', context: {} })

    // The assertion that matters: the request ARRIVED. A writer that omits the session
    // cwd fails prompt assembly and never calls the adapter, while still ending the turn.
    expect(adapter.requests).toHaveLength(1)
    expect(result.text).toBe('one known paragraph')
    expect(result.provider).toBe('spec-prose')
    expect(result.model).toBe('spec-model')
    await (ctx as unknown as { fiber: { dispose: () => Promise<void> } }).fiber.dispose()
  })

  it('joins streamed pieces in order without duplicating the final block', async () => {
    const { ctx } = await setupRuntime([textChunks(['alpha ', 'beta ', 'gamma'])])
    const result = await writerFor(ctx).write({ stepId: STEP, instruction: 'x', context: {} })

    expect(result.text).toBe('alpha beta gamma')
    await (ctx as unknown as { fiber: { dispose: () => Promise<void> } }).fiber.dispose()
  })

  it('rejects a turn that ends normally carrying no text', async () => {
    const { ctx } = await setupRuntime([emptyChunks()])
    await expect(writerFor(ctx).write({ stepId: STEP, instruction: 'x', context: {} }))
      .rejects.toThrow(/produced no text/)
    await (ctx as unknown as { fiber: { dispose: () => Promise<void> } }).fiber.dispose()
  })

  it('never returns a tool-call payload as prose', async () => {
    const { ctx } = await setupRuntime([toolCallOnlyChunks()])
    const failure = await writerFor(ctx)
      .write({ stepId: STEP, instruction: 'x', context: {} })
      .then(() => undefined, (error: unknown) => error as Error)

    expect(failure).toBeInstanceOf(Error)
    expect(failure?.message).not.toContain('no-such-tool')
    await (ctx as unknown as { fiber: { dispose: () => Promise<void> } }).fiber.dispose()
  })

  it('reports a provider failure as a provider failure, not as an absent model reply', async () => {
    // The upstream error must survive to the caller. Reporting it as "no text" is the
    // masking this test forbids: it hides cause and makes three defects look like one.
    const { ctx } = await setupRuntime([])
    const failure = await writerFor(ctx)
      .write({ stepId: STEP, instruction: 'x', context: {} })
      .then(() => undefined, (error: unknown) => error as Error)

    expect(failure).toBeInstanceOf(Error)
    expect(failure?.message).toContain('failed before the model produced text')
    expect(failure?.message).toContain('script exhausted')
    await (ctx as unknown as { fiber: { dispose: () => Promise<void> } }).fiber.dispose()
  })

  it('fails the write on idle timeout instead of hanging forever', async () => {
    const { ctx } = await setupRuntime(['hang'])
    await expect(
      writerFor(ctx, { idleTimeoutMs: 120 }).write({ stepId: STEP, instruction: 'x', context: {} }),
    ).rejects.toThrow(/idle timeout/)
    await (ctx as unknown as { fiber: { dispose: () => Promise<void> } }).fiber.dispose()
  })

  it('refuses a write whose signal was already aborted', async () => {
    const { ctx, adapter } = await setupRuntime([textChunks(['must never be produced'])])
    const controller = new AbortController()
    controller.abort()

    await expect(writerFor(ctx).write({
      stepId: STEP,
      instruction: 'x',
      context: {},
      signal: controller.signal,
    })).rejects.toThrow(/cancelled/)
    expect(adapter.requests).toHaveLength(0)
    await (ctx as unknown as { fiber: { dispose: () => Promise<void> } }).fiber.dispose()
  })

  it('fails the write when the in-flight request is cancelled', async () => {
    const { ctx, adapter } = await setupRuntime(['hang'])
    const controller = new AbortController()
    const pending = writerFor(ctx).write({
      stepId: STEP,
      instruction: 'x',
      context: {},
      signal: controller.signal,
    })
    // Abort only once the request is actually in flight, so this exercises the
    // listener rather than the up-front check above.
    while (adapter.requests.length === 0) await new Promise(resolve => setTimeout(resolve, 5))
    controller.abort()

    await expect(pending).rejects.toThrow(/cancelled/)
    await (ctx as unknown as { fiber: { dispose: () => Promise<void> } }).fiber.dispose()
  })

  it('keeps another session’s assistant text out of this write', async () => {
    // Both agents run on the same adapter in the same process; the writer reads its own
    // session's events, so a foreign agent's prose must never become this step's product.
    const { ctx, adapter } = await setupRuntime([
      textChunks(['FOREIGN product must not leak']),
      textChunks(['this write only']),
    ])
    const anyCtx = ctx as unknown as {
      agentLoop: { create: (id: unknown, o: unknown, m: unknown) => { followup: (message: unknown) => void } }
      on: (event: string, cb: (p: { agent: unknown; status: string }) => void) => () => void
      fiber: { dispose: () => Promise<void> }
    }
    const sessionMod = (await import('@deepseek-ai/' + 'dsh-session')) as Record<string, unknown>
    const llmMod = (await import('@deepseek-ai/' + 'dsh-llm')) as Record<string, unknown>
    const foreign = anyCtx.agentLoop.create(
      (sessionMod.SessionId as (v: string) => unknown)('foreign-agent'),
      { provider: 'spec-prose', model: 'spec-model' },
      { cwd: CWD },
    )
    const foreignIdle = new Promise<void>((resolve) => {
      const off = anyCtx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === foreign && status === 'idle') { off(); resolve() }
      })
    })
    foreign.followup((llmMod.createUserMessage as (i: unknown) => unknown)({
      content: [{ type: 'text', text: 'foreign' }],
      source: { kind: 'user' },
    }))
    await foreignIdle

    const result = await writerFor(ctx).write({ stepId: STEP, instruction: 'x', context: {} })
    expect(adapter.requests).toHaveLength(2)
    expect(result.text).toBe('this write only')
    await anyCtx.fiber.dispose()
  })
})
