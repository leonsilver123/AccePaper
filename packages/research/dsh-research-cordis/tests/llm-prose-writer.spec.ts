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
import { deriveDeterministicText, digestOf } from '../src/deterministic-llm.ts'
import { DETERMINISTIC_PROSE_MODEL, ResearchEngine } from '../src/index.ts'

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

/** Mount the host services a prose write needs, in the order a real boot provides them. */
async function mountRuntime(ctx: Context): Promise<void> {
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
}

async function setupRuntime(script: Entry[]) {
  const ctx = new Context()
  await mountRuntime(ctx)

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
  }, 'llm')
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
    const writer = new LlmProseWriter({} as never, { provider: 'p', model: 'm', cwd: CWD }, 'llm')

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

describe('the deterministic offline prose route', () => {
  it('registers on the real llm service and produces its draft through the real agent loop', async () => {
    const { ctx } = await setupRuntime([])
    await ctx.plugin(ResearchEngine, { prose: { kind: 'deterministic' } })
    const engine = ctx.get('research') as { proseWriter: LlmProseWriter | undefined }
    expect(engine.proseWriter).toBeDefined()

    const result = await engine.proseWriter?.write({
      stepId: STEP,
      instruction: 'Analyse the gap for adaptive signal control.',
      context: { topic: 'traffic' },
    })

    // The product names itself as a demo draft. This is the property that keeps it from
    // being read downstream as a model-written research finding.
    expect(result?.text).toContain('DEMO DRAFT')
    expect(result?.text).toContain('No model was called')
    expect(result?.text).toContain('Analyse the gap for adaptive signal control.')
    expect(result?.provider).toBe('research-deterministic')
    expect(result?.model).toBe(DETERMINISTIC_PROSE_MODEL)
    await (ctx as unknown as { fiber: { dispose: () => Promise<void> } }).fiber.dispose()
  })

  it('derives from the step instruction, not from the runtime-context snapshot', async () => {
    // The loop appends its own runtime-context user message after the caller's. Reading
    // the LAST user message therefore read the snapshot, and the derived text described
    // the deployment rather than the task — a wrong product that still looked plausible.
    const { ctx } = await setupRuntime([])
    await ctx.plugin(ResearchEngine, { prose: { kind: 'deterministic' } })
    const engine = ctx.get('research') as { proseWriter: LlmProseWriter | undefined }

    const result = await engine.proseWriter?.write({
      stepId: STEP,
      instruction: 'Assess whether adaptive control beats fixed-time plans.',
      context: { topic: 'traffic' },
    })

    expect(result?.text).toContain('Task: Assess whether adaptive control beats fixed-time plans.')
    expect(result?.text).not.toContain('Current runtime context')
    await (ctx as unknown as { fiber: { dispose: () => Promise<void> } }).fiber.dispose()
  })

  it('answers the same request with the same text, and different requests differently', async () => {
    const { ctx } = await setupRuntime([])
    await ctx.plugin(ResearchEngine, { prose: { kind: 'deterministic' } })
    const engine = ctx.get('research') as { proseWriter: LlmProseWriter | undefined }
    const write = (instruction: string) => engine.proseWriter?.write({
      stepId: STEP,
      instruction,
      context: { topic: 'traffic' },
    })

    const first = await write('Instruction one.')
    const again = await write('Instruction one.')
    const other = await write('Instruction two.')

    expect(again?.text).toBe(first?.text)
    expect(other?.text).not.toBe(first?.text)
    await (ctx as unknown as { fiber: { dispose: () => Promise<void> } }).fiber.dispose()
  })

  it('reads past a trailing plugin snapshot back to the caller message', () => {
    // Shapes below are copied from a REAL boot's session dump. The loop appends the
    // runtime-context snapshot after the caller's message, and the first version of the
    // derivation read that snapshot: the draft restated the sandbox policy as its task.
    const request = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Real instruction.\n\nContext (JSON):\n{}' }], source: { kind: 'user' } },
        {
          role: 'user',
          content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.' }],
          source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot' },
        },
      ],
    }

    const text = deriveDeterministicText(request, { provider: 'p', model: 'm' })
    expect(text).toContain('Task: Real instruction.')
    expect(text).not.toContain('Current runtime context')
    // A request composed entirely by the harness still answers rather than going empty.
    expect(deriveDeterministicText({ messages: [request.messages[1]] }, { provider: 'p', model: 'm' }))
      .toContain('Task: Current runtime context.')
  })

  it('derives its text from the request and records the digest of what it read', () => {
    const config = { provider: 'p', model: 'm' }
    const request = { messages: [{ role: 'user', content: [{ type: 'text', text: 'Instruction.\n\nContext (JSON):\n{}' }] }] }

    const text = deriveDeterministicText(request, config)
    expect(text).toContain('Instruction.')
    expect(text).toContain(`sha256:${digestOf('Instruction.\n\nContext (JSON):\n{}')}`)
    // A deployment that replaces the template replaces the whole body.
    expect(deriveDeterministicText(request, { ...config, template: 'only {{model}}' })).toBe('only m')
    // A request with no readable prompt still answers, so the writer reports "no text"
    // rather than misattributing an empty request to a provider failure.
    expect(deriveDeterministicText({ messages: [] }, config)).toContain('DEMO DRAFT')
  })

  it('REGISTERS WHEN THE LLM SERVICE APPEARS AFTER THE ENGINE (loader order)', async () => {
    // The engine binds `llm` through `ctx.inject` because the loader starts its entries
    // concurrently: on a real boot the service is absent while the engine loads. Reading
    // it eagerly failed the whole boot. This pins the order the loader actually uses.
    const ctx = new Context()
    await ctx.plugin(ResearchEngine, { prose: { kind: 'deterministic' } })
    const engine = ctx.get('research') as { proseRouteReady: boolean }
    expect(engine.proseRouteReady).toBe(false)

    await mountRuntime(ctx)

    const ready = ctx.get('research') as { proseRouteReady: boolean; proseWriter?: LlmProseWriter }
    expect(ready.proseRouteReady).toBe(true)
    const result = await ready.proseWriter?.write({ stepId: STEP, instruction: 'After the fact.', context: {} })
    expect(result?.text).toContain('DEMO DRAFT')
    await (ctx as unknown as { fiber: { dispose: () => Promise<void> } }).fiber.dispose()
  })

  it('loads without an llm service, and fails a write rather than serving nothing', async () => {
    // Absence at load is not a failure: at that moment "not up yet" and "never" are
    // indistinguishable. What must not happen is a write that appears to succeed.
    const ctx = new Context()
    await ctx.plugin(ResearchEngine, { prose: { kind: 'deterministic' } })
    const engine = ctx.get('research') as { proseRouteReady: boolean; proseWriter?: LlmProseWriter }
    expect(engine.proseRouteReady).toBe(false)

    await expect(engine.proseWriter?.write({ stepId: STEP, instruction: 'x', context: {} }))
      .rejects.toThrow(/no `agentLoop` service/)
    await (ctx as unknown as { fiber: { dispose: () => Promise<void> } }).fiber.dispose()
  })
})
