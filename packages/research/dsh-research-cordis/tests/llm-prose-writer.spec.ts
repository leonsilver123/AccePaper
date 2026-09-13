/**
 * LlmProseWriter — contract tests for the real-model prose channel.
 *
 * These exist because the channel was once written, claimed to work, and shipped
 * WITHOUT ever being exercised: it read `createUserMessage` from the session package
 * (where it does not exist) and matched a `message.assistant` event type that is
 * never emitted. Every call failed, and nothing noticed, because no test constructed
 * the class and no deployment configured `prose`. The two contracts pinned here are
 * exactly the two that were wrong.
 */

import { describe, expect, it } from 'vitest'
import { assistantTextOf, LlmProseWriter } from '../src/llm-prose-writer.ts'

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
    const writer = new LlmProseWriter({} as never, { provider: 'p', model: 'm' })

    await expect(writer.write({ stepId: 'A1-landscape', instruction: 'x', context: {} }))
      .rejects.toThrow()
  })
})
