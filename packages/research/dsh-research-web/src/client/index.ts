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
import { en, NS, zh } from './locales.ts'
import { ResearchView } from './ResearchView.tsx'

/** Required services: the conversation slot, registries, sessions, and locale. */
export const inject = ['slots', 'sessions', 'uiSession', 'uiConversation', 'locale']

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
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'research',
    order: 20,
    locale: NS,
    label: () => t('view.research'),
    // No children/store/inject — T27 sub-panels (pipeline/figure/table/gate/
    // adversarial) declare their own child slots; this entry only contributes
    // the tab and a self-contained summary view.
  }, ResearchView))
}
