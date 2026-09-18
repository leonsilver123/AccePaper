/**
 * The model-backed acceptance: does the deployment's own reviewer read the passage that was read?
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `zotero-live.spec.ts`. That suite proves the retrieval, the
 * evidence, the binding, the identity chain, the invalidation and the export — everything except the
 * one thing that is a MODEL's job. Whether a passage establishes a sentence is a judgement, and until
 * now every case that needed one supplied it in script, which demonstrated the plumbing and said so.
 * Here the deployment's own reviewer is built the way the engine builds it and is asked the question
 * about the REAL passage, so the chain from the library to a support verdict is model-backed end to
 * end.
 *
 * IT SPENDS TOKENS, so it lives in the e2e suite (`vitest.e2e.config.ts`), which is where this
 * repository keeps real-API tests, and it self-skips without `DEEPSEEK_API_KEY`. Two sentences are
 * assessed, not one: a reviewer that answered `supported` to everything would pass a single case.
 *
 * ONE KNOWN ARTIFACT, as in `zotero-live.spec.ts`: vitest reports an `assert(!this.paused)` from
 * inside undici as an unhandled error while this file runs, from a socket still open at teardown.
 * Both cases pass and the error fails nothing; recorded so it is not chased.
 *
 * WHAT IS STILL NOT PROVEN. Two verdicts from one source are not evidence that the reviewer is
 * reliable, and this file does not claim they are. What it shows is that the parts compose — the
 * passage the library returned is the passage the model reads, and the verdict comes back bound to
 * the versions the rest of the chain compares.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { LlmReviewer } from '../src/llm-reviewer.ts'
import { ZoteroProvider } from '../src/zotero-provider.ts'
import { readRegistrations } from '../src/zotero-registration.ts'
import type { CitedItem } from '../src/zotero-registration.ts'
import type { RegistrationRead } from '../src/zotero-registration.ts'

/** The MCP server this deployment mounts, and the library it reads. */
const MCP_COMMAND = 'C:/Users/Administrator/.codex/mcp/zotero-mcp/Scripts/zotero-mcp.exe'
const API_BASE = 'http://127.0.0.1:23119/api'
const ITEM: CitedItem = { itemKey: 'UA5MIGG3', page: 4, bibtexKey: 'rocheWhatHappensWhen2020' }

/** The route the deployment reads on. Flash, per this session's authorisation. */
const PROVIDER = 'deepseek-official'
const MODEL = 'deepseek-v4-flash'

/** The rules version the reviewer's verdicts are bound to, as the engine states it. */
const INSTRUCTIONS_VERSION = 'd4-review-instructions-1'

/** Where the verdicts are left for a person to read. */
const OUTPUT = join(process.cwd(), 'project-plan', 'pipeline-review-2026-09-18', 'acceptance-2026-09-18')

/**
 * The verdicts this run reached, accumulated ACROSS the cases and written once at the end.
 *
 * The two cases are one demonstration — a reviewer that answers `supported` to everything passes
 * either alone — so the file that a person reads has to hold both, and writing it per case would
 * leave whichever ran last.
 */
const verdicts: Array<{ readonly sentence: string; readonly assessment: Assessment }> = []

/** The context the cases run in, so the tool registry can be read from where it is owned. */
let ctxRef: Context | undefined

/** What one case reached, as the report needs it. */
interface Assessment {
  readonly support: string
  readonly basis: string
  readonly judgedBy: string
  readonly assessorVersion: string
  readonly quoteSha256: string
}

/** Whether both halves of this acceptance are available. */
async function libraryAnswers(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/users/0/collections`, { signal: AbortSignal.timeout(5_000) })
    return response.ok
  } catch {
    return false
  }
}

const keyed = (process.env.DEEPSEEK_API_KEY ?? '') !== ''
const live = keyed && await libraryAnswers()

describe.skipIf(!live)('the deployment\'s reviewer, reading the passage the library returned', () => {
  afterAll(() => {
    // WRITTEN ONCE, FROM BOTH CASES. See {@link writeVerdicts}.
    if (verdicts.length > 0) writeVerdicts(verdicts)
  })

  let read: RegistrationRead
  let passage: string
  let location: string
  let quoteSha256: string
  let reviewer: LlmReviewer

  /** The tool registry the MCP client registered onto, as the host holds it. */
  function toolRegistry(): {
    get?: (name: string) => { execute(args: unknown, exec: { readonly signal: AbortSignal }): Promise<unknown> } | undefined
  } | undefined {
    return ctxRef?.get('tools') as ReturnType<typeof toolRegistry>
  }

  beforeAll(async () => {
    const ctx = new Context()
    ctxRef = ctx
    // THE REAL MODEL STACK, mounted the way a deployment mounts it, and through the LOOP the prose
    // channel actually sends on: `LlmProseWriter` reaches the model by creating an agent on
    // `ctx.agentLoop`, so a spec that mounted only the adapter would fail with "the host provides no
    // `agentLoop` service" — the writer refusing rather than returning empty text.
    //
    // The prerequisites come from the repository's own testkit rather than a hand-picked list, so this
    // mounts the same services an agent-loop test mounts everywhere else. `SessionProjectionRegistry`
    // is mounted before the loop because both it and TokenMeter declare the registry as a required
    // injection.
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(LlmDeepSeek, {})

    // THE MCP TOOLS GO ONTO THE REAL `ctx.tools`, which the testkit's ToolRuntime already owns — not
    // onto a stand-in. A fake registry would let this file pass while the route a deployment actually
    // uses disagreed with it, and it collides with the real service besides.
    await ctx.plugin(mcpClient as never, {
      transport: 'stdio',
      serverName: 'zotero',
      command: MCP_COMMAND,
      args: ['serve'],
      env: { ZOTERO_LOCAL: 'true' },
      cwd: process.cwd(),
      toolCallTimeoutMs: 120_000,
      failOnStartupError: true,
    } as never)

    const provider = new ZoteroProvider(
      { apiBase: API_BASE, localLibraryPath: 'users/0', mcpServerName: 'zotero', timeoutMs: 60_000 },
      (url, init) => fetch(url, { signal: init.signal }),
      { get: name => toolRegistry()?.get?.(name) },
    )
    read = await readRegistrations(provider, [ITEM])
    // THE SAME SOURCE THIS FILE'S SIBLING REGISTERS, asserted here too: the model is being asked about
    // a passage from a source the run may actually cite, not about a page read out of band.
    if (read.registrations.length !== 1) {
      throw new Error(`the designated source did not register: ${read.failures.join('; ')}`)
    }
    const page = await provider.readPage(ITEM.itemKey, ITEM.page)
    if (!page.ok) throw new Error(`the page could not be read: [${page.failure.code}] ${page.failure.detail}`)
    passage = page.passage.text
    location = page.passage.where
    quoteSha256 = page.passage.contentSha256
    // BUILT THE WAY THE ENGINE BUILDS IT, so what is exercised is the deployment's reviewer and not a
    // second construction that happens to share a class.
    reviewer = new LlmReviewer(ctx, {
      provider: PROVIDER,
      model: MODEL,
      cwd: process.cwd(),
      instructionsVersion: INSTRUCTIONS_VERSION,
      policyVersion: 'assess-policy-1',
    })
  }, 240_000)

  it('reads the real page and answers about a sentence it establishes', async () => {
    const sentence = 'Participants rated how critical the brake situation felt on a single graphical'
      + ' scale ranging from “not critical at all” to “very critical”.'
    const assessment = await reviewer.assess({
      statement: {
        statementId: 'stmt-discussion-1',
        sectionId: 'discussion',
        text: sentence,
        textSha256: 'a'.repeat(64),
      },
      judgement: {
        citeKey: 'cite-zotero:user:17529257:UA5MIGG3',
        location,
        quote: passage,
        quoteSha256,
        readScope: 'full-text',
      },
    })
    expect(['supported', 'partial', 'contradicted', 'unrelated']).toContain(assessment.support)
    expect(assessment.basis.length).toBeGreaterThan(0)
    // BOUND TO WHAT IT READ, not to a slot: the same two versions the rest of the chain compares.
    expect(assessment.quoteSha256).toBe(quoteSha256)
    expect(assessment.statementSha256).toBe('a'.repeat(64))
    expect(assessment.assessorVersion).toContain('llm-reviewer')
    verdicts.push({ sentence, assessment })
    // THE MODEL MUST NOT HAVE SAID `contradicted` OR `unrelated`: the page states this scale in its
    // own words, and a reader that cannot see that is not reading the page.
    expect(['supported', 'partial']).toContain(assessment.support)
  }, 180_000)

  it('answers about a sentence the page does not establish', async () => {
    // THE OTHER HALF, AND THE ONE A YES-MACHINE FAILS. Page 4 records a subjective rating scale; it
    // reports no time-to-collision at all, so a sentence claiming a measured minimum TTC is not
    // established by it. A reviewer that answered `supported` here would be reading the topic rather
    // than the passage.
    const sentence = 'The study measured a platoon minimum time-to-collision of 1.2 s for the'
      + ' automated vehicle.'
    const assessment = await reviewer.assess({
      statement: {
        statementId: 'stmt-discussion-2',
        sectionId: 'discussion',
        text: sentence,
        textSha256: 'b'.repeat(64),
      },
      judgement: {
        citeKey: 'cite-zotero:user:17529257:UA5MIGG3',
        location,
        quote: passage,
        quoteSha256,
        readScope: 'full-text',
      },
    })
    verdicts.push({ sentence, assessment })
    expect(['supported', 'partial', 'contradicted', 'unrelated']).toContain(assessment.support)
    expect(assessment.support).not.toBe('supported')
  }, 180_000)
})

/**
 * Leave the verdicts where a person can read them.
 *
 * WRITTEN ONCE, FROM BOTH CASES. A reviewer that answered `supported` to everything would pass
 * either case on its own, so the verdicts are only evidence together and the file holds both.
 *
 * @param entries - the sentences and the verdicts reached about them.
 */
function writeVerdicts(entries: ReadonlyArray<{ readonly sentence: string; readonly assessment: Assessment }>): void {
  mkdirSync(OUTPUT, { recursive: true })
  const body = entries.flatMap(entry => [
    `## ${entry.assessment.support}`,
    '',
    `Sentence: ${entry.sentence}`,
    '',
    `Basis: ${entry.assessment.basis}`,
    '',
    `- judged by: \`${entry.assessment.judgedBy}\``,
    `- assessor version: \`${entry.assessment.assessorVersion}\``,
    `- passage SHA-256: \`${entry.assessment.quoteSha256}\``,
    '',
  ])
  const header = [
    '# Support verdicts: the deployment\'s reviewer against one real page',
    '',
    'Two sentences were put to the reviewer against the SAME passage — page 4 of the source named in',
    '`zotero-evidence-report.md` — one the page states and one it does not. A reviewer that answered',
    '`supported` to both would be reading the topic rather than the passage.',
    '',
  ]
  writeFileSync(join(OUTPUT, 'support-verdicts.md'), [...header, ...body].join('\n'), 'utf8')
}
