/**
 * Browser (client) half of the research web plugin.
 *
 * Registers the `research` entry into the `conversation.view` slot (id='research',
 * order 20) — a sibling tab of `chat` (order 0) and `trajectory` (order 10).
 * The view renders a fixture/snapshot-driven run summary; it performs no live
 * polling and adds no chat-view behavior, so the existing chat view is untouched.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row (declared by the slot's owning
// package) must be in the program for the register call to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { buildSummary } from '../loader.ts'
import { summaryInputFrom, type WireRunSnapshot } from '../run-source.ts'
import { en, NS, zh } from './locales.ts'
import { researchViewWith } from './ResearchEntry.tsx'

/**
 * Structural face of the Host's `research` Remote namespace.
 *
 * Declared here rather than imported: the service that serves it compiles in the Host
 * face and this plugin in the Client face, and the client bundle takes no cross-plugin
 * value dependency. The Host side exports the same field names and its integration spec
 * asserts them, so a rename there fails a test instead of silently blanking the view.
 */
interface ResearchRemoteNamespace {
  run(request: { readonly domainDirection?: string }): Promise<WireRunSnapshot>
}

interface RemoteFace {
  readonly research: ResearchRemoteNamespace
}

/** Required services: the conversation slot, registries, sessions, locale, and Remote. */
export const inject = ['slots', 'sessions', 'uiSession', 'uiConversation', 'locale', 'remote']

/**
 * Client plugin body: register the research view tab. The registration rides the
 * slot service's effect wrapper, so plugin unload removes the tab (lifecycle
 * follows the cordis ctx — the same axis as every other conversation-view entry).
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-research-web: dictionaries')
  // Registration-time text (the view tab label) reads through the bound
  // translate as a thunk, so it follows the active locale without re-registration.
  const t = ctx.locale.bind(NS)
  // `ctx.remote.research.run(...)` starts a real run on the Host. The result is mapped
  // into the view model here; the view never sees the wire payload.
  const remote = ctx.remote as unknown as RemoteFace
  const run = async (): Promise<ReturnType<typeof buildSummary>> =>
    buildSummary(summaryInputFrom(await remote.research.run({})))
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'research',
    order: 20,
    locale: NS,
    label: () => t('view.research'),
    // The `research` entry mounts the T26–T29 workbench: the Summary tab reuses
    // the T26 run-summary view, and the remaining tabs host the pipeline / figure
    // / table / roadmap / gate / adversarial / approval / recovery sub-panels.
    // All panels read the same MOCK fixture/snapshot; no live poll, no chat change.
  }, researchViewWith(run)))
}
