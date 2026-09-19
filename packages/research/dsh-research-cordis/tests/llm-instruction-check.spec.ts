/**
 * LlmInstructionChecker — the model-backed reading of an instruction before it is sent.
 *
 * WHAT IS REAL HERE. The host services are mounted the way a boot provides them, the request goes
 * through the REAL agent loop, and a scripted adapter stands in for the vendor — so the prompt, the
 * session, the logging and the cancellation machinery are the shipped ones. What is scripted is only
 * the model's reply, which is the one thing a test cannot have.
 *
 * THE FAILURES THIS PINS. A reader that answers with no verdict, or with one this pipeline does not
 * know, must FAIL rather than default: the check exists so that "nobody read this instruction" is a
 * different fact from "this instruction is complete", and a default would erase the distinction. And
 * what it reads is the REQUEST — instruction and context both — because several steps carry their
 * evidence as request data and name it in the instruction only by the field it sits under.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmInstructionChecker } from '../src/llm-instruction-check.ts'

const CWD = process.cwd()

/** A scripted provider: each model call consumes the next entry. */
class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: StreamChunk[][]) {
    super()
  }

  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('ScriptedAdapter: script exhausted')
    for (const chunk of entry) yield chunk
  }
}

/** One assistant turn carrying `text`. */
function reply(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/**
 * Load a host plugin by a non-literal specifier, the same seam the production code uses.
 *
 * @param name - the package name, unprefixed.
 * @returns the plugin's default export.
 */
async function hostPlugin(name: string): Promise<unknown> {
  const loaded = (await import('@deepseek-ai/' + name)) as Record<string, unknown>
  return loaded.default
}

/**
 * Mount the host services one check request needs, in the order a real boot provides them.
 *
 * @param ctx - the context to mount them on.
 */
async function mountRuntime(ctx: Context): Promise<void> {
  await ctx.plugin((await hostPlugin('dsh-llm')) as new (ctx: Context) => unknown)
  await ctx.plugin((await hostPlugin('dsh-session')) as new (ctx: Context) => unknown)
  await ctx.plugin((await hostPlugin('dsh-session-projection')) as new (ctx: Context) => unknown)
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

/**
 * A checker over a scripted route.
 *
 * @param script - the model's replies, one per call.
 * @returns the checker and the adapter that recorded the requests.
 */
async function checkerOver(script: StreamChunk[][]) {
  const ctx = new Context()
  await mountRuntime(ctx)
  const adapter = new ScriptedAdapter(script)
  ;(ctx as unknown as { llm: { registerAdapter: (p: string[], a: unknown) => void } })
    .llm.registerAdapter(['spec-check'], adapter)
  const checker = new LlmInstructionChecker(ctx, {
    provider: 'spec-check',
    model: 'spec-model',
    cwd: CWD,
    policyVersion: 'rules-1',
  })
  return { checker, adapter }
}

/** The parts D3's task requires, as the runner states them. */
const PARTS = [
  'the evidence the task must be written from',
  'the constraints on what may be asserted',
  'the output format the reply must take',
]

/** One check request, as a step composes it. */
const INPUT = {
  stepId: 'D3-writing',
  instruction: 'Write the "Results" section. State only what the evidence holds.',
  requiredParts: PARTS,
  context: { evidence: { measuredPct: -38.2 } },
}

describe('an instruction read before it is sent', () => {
  it('records the verdict and the reader, and shows the model the request', async () => {
    const { checker, adapter } = await checkerOver([
      reply('COMPLETE: yes\nMISSING: NONE\nBASIS: the instruction states the evidence, the constraints and the format.'),
    ])
    const check = await checker.check(INPUT)
    // THE REQUEST ARRIVED. A reader that never reached a provider looks, from its result, exactly
    // like one that did — so the adapter's own record is part of the assertion.
    expect(adapter.requests).toHaveLength(1)
    const sent = JSON.stringify(adapter.requests[0])
    expect(sent).toContain('Write the ')
    // THE CONTEXT IS SHOWN, because a part counts as carried when either carries it: several steps
    // state their evidence as request data under a named field.
    expect(sent).toContain('measuredPct')
    for (const part of PARTS) expect(sent).toContain(part)
    expect(check.complete).toBe(true)
    // `NONE` IS THE READER'S WORD FOR "nothing is missing", and it is recorded as the empty string
    // the runner's `missingPart` means.
    expect(check.missingPart).toBe('')
    expect(check.basis).toContain('states the evidence')
    expect(check.judgedBy).toBe('llm-instruction-checker:spec-check/spec-model')
    expect(check.judgedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
  })

  it('carries a refusal out with the part it names', async () => {
    const { checker } = await checkerOver([
      reply('COMPLETE: no\nMISSING: the evidence the task must be written from\nBASIS: nothing under `evidence` is named.'),
    ])
    const check = await checker.check(INPUT)
    expect(check.complete).toBe(false)
    expect(check.missingPart).toBe('the evidence the task must be written from')
  })

  it('refuses a reply that states no verdict', async () => {
    // THE CASE THE SEAM EXISTS FOR: an instruction nobody could read must be visible as one nobody
    // read, never as one that passed.
    const { checker } = await checkerOver([reply('BASIS: I could not tell.')])
    await expect(checker.check(INPUT)).rejects.toThrow(/states no COMPLETE/u)
  })

  it('refuses a verdict this pipeline does not know', async () => {
    const { checker } = await checkerOver([reply('COMPLETE: maybe\nMISSING: NONE\nBASIS: unclear.')])
    await expect(checker.check(INPUT)).rejects.toThrow(/unusable verdict is a failure, not a default/u)
  })
})
