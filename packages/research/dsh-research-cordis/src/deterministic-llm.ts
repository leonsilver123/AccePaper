/**
 * Deterministic offline provider for the prose channel.
 *
 * This is a REAL provider adapter registered on the real `ctx.llm`: a prose request
 * travels the same path as any other model call — agent loop → `LlmRuntime` → adapter →
 * session log — and the deployment's configured route selects it. Only the response is
 * computed instead of generated, which is what makes an offline deployment reproducible.
 *
 * WHAT THIS IS NOT: there is no model here, and no claim that there is one. The text is a
 * pure function of the request, and every product carrying it is a DEMO DRAFT — the
 * pipeline, tool calls, sessions, logs and browser view around it are real, the sentences
 * are not research findings. Callers must label it accordingly and must never let it
 * stand in for a model-written result.
 *
 * Why it lives in this package rather than `packages/llm/`: adding a workspace package
 * requires a package-manager install to create its lockfile entry and dependency links,
 * and the only install path available on this host re-creates the whole modules tree — a
 * failure there would take the repository with it. This package already reaches `ctx.llm`
 * through the non-literal dynamic-import seam, so the provider is assembled here. Moving
 * it under `packages/llm/` is the right change once an install can be run safely.
 *
 * @module @deepseek-ai/dsh-research-cordis/deterministic-llm
 */

import { createHash } from 'node:crypto'

/** Stream chunk vocabulary of the LLM service, declared structurally (see the module header). */
type Chunk =
  | { readonly type: 'block-start'; readonly index: number; readonly blockType: 'text' }
  | { readonly type: 'text-delta'; readonly index: number; readonly text: string }
  | { readonly type: 'block-end'; readonly index: number; readonly block: { readonly type: 'text'; readonly text: string } }
  | { readonly type: 'usage'; readonly usage: { readonly inputTokens: number; readonly outputTokens: number } }
  | { readonly type: 'finish'; readonly reason: { readonly kind: 'stop' } }

/** The request surface this adapter reads; the rest of the provider call is unused. */
interface RequestFace {
  readonly messages?: ReadonlyArray<{ readonly role?: string; readonly content?: unknown; readonly source?: unknown }>
  readonly signal?: AbortSignal
}

/** Configuration of the deterministic prose route, as a deployment writes it. */
export interface DeterministicProseConfig {
  /** Provider route to register. */
  readonly provider: string
  /** Model id requests are addressed to. */
  readonly model: string
  /** Display name for the route; shown wherever a provider is listed. */
  readonly name?: string
  /**
   * Body template. Supports `{{instruction}}`, `{{digest}}`, `{{model}}` and `{{provider}}`.
   * A deployment may replace it; the default is the demo-draft notice below.
   */
  readonly template?: string
}

/** Route display name used when the deployment states none. */
const DEFAULT_ROUTE_NAME = 'Deterministic (offline)'

/**
 * The default body: a self-describing demo draft.
 *
 * It is deliberately explicit about what it is, because this text becomes a step's
 * product and travels downstream into artifacts and eventually a draft. A reader who
 * finds it must be able to tell that no model produced it.
 */
export const DEFAULT_DETERMINISTIC_TEMPLATE = [
  'DEMO DRAFT — produced by the deployment\'s deterministic offline prose route.',
  'No model was called; this text is a pure function of the request.',
  '',
  'Task: {{instruction}}',
  'Evidence digest: sha256:{{digest}}',
  '',
  'Nothing stated here is a research finding. The pipeline, tool calls, sessions and',
  'logs around this text are real; these sentences are a placeholder so the whole chain',
  'can be exercised reproducibly without a model credential.',
].join('\n')

/** SHA-256 of one string, hex, truncated for readability. */
export function digestOf(input: string, length = 16): string {
  return createHash('sha256').update(input, 'utf8').digest('hex').slice(0, length)
}

/** Text blocks of one message, empty when it carries none. */
function textOf(message: { readonly content?: unknown }): string {
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(part => (part as { type?: unknown; text?: unknown }))
    .filter(part => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text as string)
    .join('\n')
}

/**
 * Whether a message carries the caller's request rather than a harness contribution.
 *
 * The agent loop appends its own runtime-context user message (the sandbox and approval
 * policy snapshot) AFTER the caller's, so the LAST user message is a plugin snapshot.
 * Reading it made the derived text describe the deployment instead of the task.
 */
function isCallerMessage(message: { readonly source?: unknown }): boolean {
  const source = message.source
  if (source === null || typeof source !== 'object') return true
  return (source as { kind?: unknown }).kind !== 'plugin'
}

/**
 * The caller's request text.
 *
 * Prefers the last caller-authored user message and falls back to the last user message
 * of any origin, so a request the harness itself composed still yields text rather than
 * the empty-instruction placeholder.
 *
 * @param request - the provider request.
 * @returns the request text, or an empty string when the request carries none.
 */
function requestText(request: RequestFace): string {
  const messages = request.messages ?? []
  let fallback = ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message === undefined) continue
    if (message.role !== undefined && message.role !== 'user') continue
    const text = textOf(message)
    if (text.length === 0) continue
    if (isCallerMessage(message)) return text
    if (fallback.length === 0) fallback = text
  }
  return fallback
}

/**
 * A `LABEL: shape` line the caller's instruction declares as the response format.
 *
 * All-caps only. The template this route writes carries `Task:` (mixed case) and the agent
 * loop's runtime snapshot carries its own prose, so requiring caps keeps a label from being
 * invented out of unrelated text.
 */
const FORMAT_LINE = /^([A-Z][A-Z0-9_-]{0,31}):\s*(\S.*)$/u

/** One `LABEL: shape` pair the instruction declared. */
export interface DeclaredField {
  readonly label: string
  /** The shape the instruction wrote after the label, verbatim. */
  readonly shape: string
}

/**
 * The labelled response format a caller's instruction declares.
 *
 * THE PROPERTY THIS EXISTS FOR. A step that consumes a labelled field cannot use a reply that
 * does not carry the label, and several steps fail rather than invent one. This route used to
 * echo only the instruction's FIRST line, so every labelled step received a well-meaning
 * paragraph and threw: the deployment's own prose route could not drive A3-agenda, and every
 * later step behind it never ran. A route that stands in for a model has to answer in the
 * format the request asked for, or it is not a stand-in.
 *
 * @param prompt - the caller's request text.
 * @returns one entry per declared field, in the order they were written.
 */
export function declaredFieldsOf(prompt: string): ReadonlyArray<DeclaredField> {
  const out: DeclaredField[] = []
  for (const raw of prompt.split('\n')) {
    const match = FORMAT_LINE.exec(raw.trim())
    if (match === null) continue
    out.push({ label: match[1] as string, shape: (match[2] as string).trim() })
  }
  return out
}

/** The separator a shape uses between alternative values, `||` before `|`. */
function separatorOf(shape: string): string | undefined {
  if (shape.includes('||')) return '||'
  if (shape.includes('|')) return '|'
  return undefined
}

/** The noun a `<...>` placeholder names, with its angle brackets removed. */
function nounOf(part: string): string {
  const inner = /^<([^>]*)>$/u.exec(part.trim())?.[1]?.trim()
  return inner !== undefined && inner.length > 0 ? inner : part.trim()
}

/**
 * One value for a declared field, marked as the demo value it is.
 *
 * The value is BUILT FROM THE SHAPE the instruction wrote — `<phase>` becomes `phase 1` —
 * rather than invented from nothing, and every value carries the notice, so no reader can
 * take it for generated content. A shape naming N alternatives produces N distinct values,
 * because a step that splits the field on its separator needs N entries, not one repeated.
 */
function demoValuesFor(field: DeclaredField): ReadonlyArray<string> {
  const separator = separatorOf(field.shape)
  const parts = separator === undefined ? [field.shape] : field.shape.split(separator)
  const nouns = parts.map(nounOf).filter(noun => noun.length > 0)
  const list = nouns.length > 0 ? nouns : [field.label]
  return list.map((noun, index) => {
    const ordinal = list.length > 1 ? ` ${String(index + 1)}` : ''
    return `${noun}${ordinal} — DEMO value: the deterministic offline route generates no content`
  })
}

/**
 * Derive the response body for one request.
 *
 * Pure and total: the same request always yields the same text, and a request carrying no
 * readable prompt yields the placeholder for an empty instruction rather than throwing —
 * the writer above treats empty text as a failed write, which is the correct outcome and
 * should be reported as such rather than as a provider error.
 *
 * A request that declares a labelled format gets those labels after the notice, so the steps
 * that consume labelled fields receive a well-formed answer. See {@link declaredFieldsOf}.
 *
 * @param request - the provider request.
 * @param config - the route's configuration.
 * @returns the text this route answers with.
 */
export function deriveDeterministicText(request: unknown, config: DeterministicProseConfig): string {
  const prompt = requestText(request as RequestFace)
  const instruction = prompt.split('\n', 1)[0]?.trim() ?? ''
  const template = config.template ?? DEFAULT_DETERMINISTIC_TEMPLATE
  const body = template
    .replaceAll('{{instruction}}', instruction)
    .replaceAll('{{digest}}', digestOf(prompt))
    .replaceAll('{{model}}', config.model)
    .replaceAll('{{provider}}', config.provider)

  const fields = declaredFieldsOf(prompt)
  if (fields.length === 0) return body
  const answered = fields
    .map(field => `${field.label}: ${demoValuesFor(field).join(separatorOf(field.shape) ?? ' ')}`)
    .join('\n')
  return `${body}\n\n${answered}`
}

/**
 * Build the deterministic adapter.
 *
 * The result is a plain object rather than an `LlmAdapter` subclass: the base class lives
 * behind the dynamic-import seam, and `registerAdapter` is a typed same-process boundary,
 * so the structural contract is the whole contract. `providerInfo` and
 * `providerRetryPolicy` are what registration reads; `stream` is what a request reads.
 *
 * @param config - the route's configuration.
 * @returns an adapter serving exactly `config.provider`.
 */
export function createDeterministicAdapter(config: DeterministicProseConfig): Record<string, unknown> {
  const resolveModel = (provider: string, model: string): Promise<{ provider: string; id: string; name: string }> =>
    Promise.resolve({ provider, id: model, name: model })

  // An async generator because the provider contract is an AsyncIterable; the body has no
  // asynchronous step, since the response is computed from the request rather than awaited.
  // The gate's lint config enables `require-await` and reports it here, so the rule is disabled
  // for this one declaration rather than an artificial `await` being added to satisfy it. (The
  // staged pre-commit config does not enable the rule, so it reports this directive as unused;
  // the gate config is the one that decides.)
  // oxlint-disable-next-line typescript/require-await -- a provider stream is async by contract
  async function* stream(request: RequestFace): AsyncGenerator<Chunk> {
    const text = deriveDeterministicText(request, config)
    // Two deltas, so a real run exercises the streaming join as well as the final
    // block; they concatenate to exactly `text`.
    const split = Math.ceil(text.length / 2)
    const pieces = [text.slice(0, split), text.slice(split)]
    yield { type: 'block-start', index: 0, blockType: 'text' }
    for (const piece of pieces) {
      if (request.signal?.aborted === true) throw new Error('aborted')
      yield { type: 'text-delta', index: 0, text: piece }
    }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 0, outputTokens: text.length } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }

  return {
    providerInfo: (provider: string) => ({ id: provider, name: config.name ?? DEFAULT_ROUTE_NAME }),
    providerRetryPolicy: () => undefined,
    listModels: () => Promise.resolve([{ id: config.model, name: config.model }]),
    resolveModel,
    // The runtime dispatches through `prepareCall`, not `stream` directly. The base
    // class's default is re-stated here because this adapter is a plain object, not a
    // subclass: nothing may rely on `this`.
    prepareCall: async (provider: string, model: string) => ({
      model: await resolveModel(provider, model),
      stream: (request: RequestFace) => stream(request),
    }),
    stream,
  }
}
