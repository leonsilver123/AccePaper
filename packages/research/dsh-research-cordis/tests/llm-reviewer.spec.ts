/**
 * LlmReviewer — the model-backed channel for the two judgements the pipeline refuses to make itself.
 *
 * WHAT IS REAL HERE. The host services are mounted the way a boot provides them, the request goes
 * through the REAL agent loop, and a scripted adapter stands in for the vendor — so the prompt, the
 * session, the logging and the cancellation machinery are the shipped ones. What is scripted is only
 * the model's reply, which is the one thing a test cannot have.
 *
 * THE FAILURES THIS PINS. A reviewer that answers with no verdict, or with one this pipeline does not
 * know, must FAIL rather than default — the seam exists because "nobody could read this sentence" is a
 * different fact from "this sentence holds", and a default would erase the distinction the whole
 * module was built on. And the read scope is the deployment's, never the model's: a verdict cannot
 * claim to rest on a fuller reading than the passage it was given.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmReviewer } from '../src/llm-reviewer.ts'

const CWD = process.cwd()

/** A scripted provider: each model call consumes the next entry. */
type Entry = StreamChunk[] | 'fail'

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
    if (entry === 'fail') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'partial' }
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'provider refused the request', code: 'TRANSPORT' } } }
      return
    }
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
 * Mount the host services a review request needs, in the order a real boot provides them.
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
 * A reviewer over a scripted route.
 *
 * @param script - the model's replies, one per call.
 * @returns the reviewer and the adapter that recorded the requests.
 */
async function reviewerOver(script: Entry[]) {
  const ctx = new Context()
  await mountRuntime(ctx)
  const adapter = new ScriptedAdapter(script)
  ;(ctx as unknown as { llm: { registerAdapter: (p: string[], a: unknown) => void } })
    .llm.registerAdapter(['spec-review'], adapter)
  const reviewer = new LlmReviewer(ctx, {
    provider: 'spec-review',
    model: 'spec-model',
    cwd: CWD,
    policyVersion: 'rules-1',
    instructionsVersion: 'revision-review-spec-1',
  })
  return { reviewer, adapter }
}

/** A sentence as the runner models it, with its content version. */
const STATEMENT = {
  statementId: 'stmt-results-1',
  sectionId: 'results',
  text: 'Throughput fell by 38.2 % under coalescing [@cite-W1].',
  textSha256: 'sha-sentence',
}

/** The judgement about the source that sentence cites. */
const JUDGEMENT = {
  citeKey: 'cite-W1',
  location: 'Section 4',
  quote: 'Coalescing reduced throughput by 38.2 %.',
  quoteSha256: 'sha-passage',
  readScope: 'abstract-only',
}

describe('a sentence read against the passage that was read for it', () => {
  it('records what the model decided, and where its verdict came from', async () => {
    const { reviewer, adapter } = await reviewerOver([
      reply('SUPPORT: supported\nBASIS: the passage states the same reduction for the same mechanism.'),
    ])
    const assessment = await reviewer.assess({ statement: STATEMENT, judgement: JUDGEMENT })

    // THE REQUEST ARRIVED. A channel that never reaches a provider looks, from its result, exactly
    // like one that did — so the adapter's own record is part of the assertion.
    expect(adapter.requests).toHaveLength(1)
    const sent = JSON.stringify(adapter.requests[0])
    expect(sent).toContain('Throughput fell by 38.2')
    expect(sent).toContain('Coalescing reduced throughput by 38.2')

    expect(assessment.support).toBe('supported')
    expect(assessment.basis).toContain('the same reduction')
    // THE SENTENCE'S VERSION AND THE PASSAGE'S, both as the reviewer read them: a later rewrite of
    // either makes this verdict stale rather than reusable.
    expect(assessment.statementSha256).toBe('sha-sentence')
    expect(assessment.quoteSha256).toBe('sha-passage')
    expect(assessment.citeKey).toBe('cite-W1')
    // THE READER IS BOUND WITH ITS RULES, not with a timestamp: two verdicts the same day are two
    // verdicts, and a replaced reader invalidates its predecessor's.
    expect(assessment.assessorVersion).toBe('llm-reviewer:spec-review/spec-model@rules-1')
    expect(assessment.judgedBy).toBe('llm-reviewer:spec-review/spec-model')
    expect(assessment.judgedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
  })

  it('takes the read scope from the judgement, not from the model', async () => {
    // A VERDICT CANNOT REST ON MORE THAN WAS READ. The judgement was made on an abstract; a model
    // that answers as though it had the full text does not get to say so, because the scope is a
    // fact about the reading that was made and not a claim about the reading it performed.
    const { reviewer } = await reviewerOver([
      reply('SUPPORT: supported\nBASIS: read in full.\nSCOPE: full-text'),
    ])
    const assessment = await reviewer.assess({ statement: STATEMENT, judgement: JUDGEMENT })
    expect(assessment.readScope).toBe('abstract-only')
  })

  it('refuses a reply that states no verdict', async () => {
    // THE CASE THE SEAM EXISTS FOR is a sentence nobody could read, and a default here would erase
    // it: a reviewer that could not answer must be visible as one that could not.
    const { reviewer } = await reviewerOver([reply('BASIS: I could not tell from this passage.')])
    await expect(reviewer.assess({ statement: STATEMENT, judgement: JUDGEMENT }))
      .rejects.toThrow(/states no SUPPORT/u)
  })

  it('refuses a verdict this pipeline does not know', async () => {
    const { reviewer } = await reviewerOver([reply('SUPPORT: maybe\nBASIS: unclear.')])
    await expect(reviewer.assess({ statement: STATEMENT, judgement: JUDGEMENT }))
      .rejects.toThrow(/not one of supported, contradicted, partial, unrelated/u)
  })

  it('refuses a verdict with nothing behind it', async () => {
    const { reviewer } = await reviewerOver([reply('SUPPORT: supported')])
    await expect(reviewer.assess({ statement: STATEMENT, judgement: JUDGEMENT }))
      .rejects.toThrow(/states no BASIS/u)
  })

  it('reports a failed turn as a failure, not as a verdict', async () => {
    const { reviewer } = await reviewerOver(['fail'])
    await expect(reviewer.assess({ statement: STATEMENT, judgement: JUDGEMENT }))
      .rejects.toThrow(/provider refused the request/u)
  })
})

describe('a revision read against the issue it was written for', () => {
  it('returns the decision and what was read, and NO identity', async () => {
    const { reviewer, adapter } = await reviewerOver([
      reply(
        'VERDICT: rejected\nBASIS: the section still reports the old baseline.'
        + '\nREAD: the concern; the change; the section as it now stands',
      ),
    ])
    const verification = await reviewer.verify({
      issue: {
        issueId: 'd4-issue-1',
        sectionId: 'results',
        concern: 'The results do not compare against a published baseline.',
        response: 'Added a sentence explaining why no published row is recorded.',
        requiresTextChange: true,
      },
      change: { sectionId: 'results', beforeHash: 'sha-before', afterHash: 'sha-after' },
      revisedBody: 'Throughput fell by 38.2 %.',
    })

    // THE REQUEST CARRIED WHAT THERE WAS TO READ: the concern as raised, the author's answer, the
    // hashes of the change, and the section as it now stands. A verifier that could not see the diff
    // could only judge the argument.
    expect(adapter.requests).toHaveLength(1)
    const sent = JSON.stringify(adapter.requests[0])
    expect(sent).toContain('published baseline')
    expect(sent).toContain('why no published row is recorded')
    expect(sent).toContain('sha-after')
    expect(sent).toContain('Throughput fell by 38.2')

    expect(verification.verdict).toBe('rejected')
    expect(verification.basis).toContain('old baseline')
    expect(verification.evidenceRead).toEqual([
      'the concern', 'the change', 'the section as it now stands',
    ])
    // NO IDENTITY AND NO TIMESTAMP ARE THE READER'S TO STATE. The host that started the execution
    // records which one it was, in which session, under which rules — a reader that could name itself
    // could forge a name, and a check against a self-reported one is a check a renamed reader passes.
    expect(Object.keys(verification).sort()).toEqual(['basis', 'evidenceRead', 'verdict'])
  })

  it('refuses a decision this pipeline does not know', async () => {
    const { reviewer } = await reviewerOver([reply('VERDICT: looks fine\nBASIS: seems alright.')])
    await expect(reviewer.verify({
      issue: {
        issueId: 'd4-issue-1',
        sectionId: 'results',
        concern: 'c',
        response: 'r',
        requiresTextChange: false,
      },
    })).rejects.toThrow(/not one of verified, rejected/u)
  })
})

describe('who the reviewer is', () => {
  it('names its route, so a reviewer on the author’s route is caught', () => {
    // THE ID IS A LABEL A READER RECOGNISES, AND NOTHING IS DECIDED ON IT. The host mints the
    // execution, the session and the rules version of every verification this class produces, so
    // renaming the reader changes nothing — which is why the id spells the route and says so.
    const ctx = new Context()
    const reviewer = new LlmReviewer(ctx, {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      cwd: CWD,
      instructionsVersion: 'revision-review-1',
    })
    expect(reviewer.role).toBe('revision-verifier')
    expect(reviewer.instructionsVersion).toBe('revision-review-1')
    expect(reviewer.id).toBe('llm-reviewer:deepseek-official/deepseek-v4-flash')
    // No policy version stated means the id alone, which is still a version — a verdict bound to the
    // reader and nothing else.
    expect(reviewer.policyVersion).toBeUndefined()
  })
})
