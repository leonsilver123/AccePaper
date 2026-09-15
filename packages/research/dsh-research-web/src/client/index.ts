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
import { buildApprovalSubmitter } from './approval-source.ts'
import { en, NS, zh } from './locales.ts'
import { researchViewWith } from './ResearchEntry.tsx'
import type { WirePlan, WireProposalAnswer } from './direction-source.ts'

/**
 * Structural face of the Host's `research` Remote namespace.
 *
 * Declared here rather than imported: the service that serves it compiles in the Host
 * face and this plugin in the Client face, and the client bundle takes no cross-plugin
 * value dependency. The Host side exports the same field names and its integration spec
 * asserts them, so a rename there fails a test instead of silently blanking the view.
 */
interface ResearchRemoteNamespace {
  /**
   * One generated Remote method returns `RemoteResult<ResearchRunSnapshot>` — the value on
   * success or the host's failure — NOT the snapshot itself. Reading the wrapper as if it were
   * the snapshot is what made the tab report `Cannot read properties of undefined (reading
   * 'steps')` after the namespace was finally mounted.
   */
  run(request: { readonly domainDirection?: string; readonly plan?: WirePlan }): Promise<
    { readonly ok: true; readonly value: WireRunSnapshot }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
  >

  /**
   * The second method on the same namespace: what the run dialog asks before a run exists.
   *
   * Declared beside `run` rather than in a twin file of its own, because the two are one surface —
   * a plan is proposed here and confirmed into the call above, and a drift between their field
   * names would leave the dialog confirming a plan the host cannot read.
   */
  proposeDirections(request: { readonly field?: string }): Promise<
    { readonly ok: true; readonly value: WireProposalAnswer }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
  >
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
  // The namespace is read through `ctx.get`, never the property proxy. A mounted namespace is a
  // service named `remote.<namespace>`, and the proxy resolves a property only for a context whose
  // fiber carries it or that declares it in `inject`; this plugin declares `remote`, not each
  // namespace, so `ctx.remote.research` threw `cannot get property "remote.research" without
  // inject` on the first real click. `ctx.get` reads the global service store, which is the
  // documented read for a service this plugin does not declare — the same distinction the prose
  // writer needed for `ctx.agentLoop` (docs/postmortem/0001-acp-default-export-drops-inject.md).
  const run = async (plan?: WirePlan): Promise<ReturnType<typeof buildSummary>> => {
    const remote = ctx.get('remote.research') as unknown as ResearchRemoteNamespace | undefined
    if (remote === undefined) {
      throw new Error(
        'the client has no `remote.research` namespace: the assembly that mounts Remote '
        + 'namespaces did not mount the research one',
      )
    }
    const result = await remote.run(plan === undefined ? {} : { plan })
    // A refused call carries the host's own failure; surfacing it here is what keeps the tab
    // from showing a stale fixture as though the run had produced it.
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return buildSummary(summaryInputFrom(result.value))
  }
  /**
   * Ask the host for research directions. The failure is surfaced rather than turned into an empty
   * answer: "the host could not propose" and "the host proposed nothing" are different facts, and
   * the dialog says which.
   * @param field - the domain the person stated, or an empty string for none.
   * @returns what the host could propose, and what it refused.
   */
  const propose = async (field: string): Promise<WireProposalAnswer> => {
    const remote = ctx.get('remote.research') as unknown as ResearchRemoteNamespace | undefined
    if (remote === undefined) {
      throw new Error(
        'the client has no `remote.research` namespace: the assembly that mounts Remote '
        + 'namespaces did not mount the research one',
      )
    }
    const result = await remote.proposeDirections({ field })
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value
  }

  // `ctx.connection.rpc.call` reaches the approval channel `dsh-research-team` registers on the
  // HOST's Connection service, so the browser attaches its authenticated session cookie and the
  // decision is attributable to the host's operator rather than to anything in the payload.
  // Resolved per call: a deployment whose trust surface mounts late — or not at all — still
  // gets a working view, and the panel says so when there is nothing to call.
  const approve = buildApprovalSubmitter(() => ctx.get('connection'))
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
  }, researchViewWith(run, approve, propose)))
}
