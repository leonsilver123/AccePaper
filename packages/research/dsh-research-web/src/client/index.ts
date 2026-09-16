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
import { summaryInputFrom } from '../run-source.ts'
import type { WireRunSnapshot } from '../run-source.ts'
import { buildApprovalSubmitter } from './approval-source.ts'
import type { ConnectionState } from '../connection-state.ts'
import { followToRest } from './follow-source.ts'
import { en, NS, zh } from './locales.ts'
import { researchViewWith } from './ResearchEntry.tsx'
import type { WirePlan, WireProposalAnswer } from './direction-source.ts'
import { runListFrom } from '../run-source.ts'
import type {
  RunListEntryView, WireRevisionView, WireRunFrame, WireRunSaveRetry, WireRunStart, WireRunSummaryEntry,
} from '../run-source.ts'

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

  /**
   * Create a run and answer with its id, before the study has finished.
   *
   * The third method on the same surface, and the one the run control calls: {@link run} waits for
   * the whole study, so a person who pressed a button had nothing to look at until it ended and a
   * reload lost the only handle they had.
   */
  startRun(request: {
    readonly commandId: string
    readonly domainDirection?: string
    readonly plan?: WirePlan
  }): Promise<
    { readonly ok: true; readonly value: WireRunStart }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
  >

  /**
   * Follow one run: the opening snapshot, then the events appended after it.
   *
   * A STREAM method: it is not wrapped in `RemoteResult` (the generated client declares it as
   * `AsyncIterable`), and it takes a cancellation signal the carrier owns.
   */
  followRun(
    request: { readonly runId: string; readonly cursor?: string },
    signal?: AbortSignal,
  ): AsyncIterable<WireRunFrame>

  /**
   * Read one run as it stands.
   *
   * `null` on success means this deployment holds no such run — not in memory, and not on disk.
   * That is a different answer from a refused call, and the reader is told which.
   */
  runSnapshot(request: { readonly runId: string }): Promise<
    { readonly ok: true; readonly value: WireRunSnapshot | null }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
  >

  /**
   * The studies this deployment holds, newest first.
   *
   * The read that makes a study findable after the page that started it is gone: a run id lived in
   * one tab's storage, while the studies themselves stayed on disk.
   */
  listRuns(): Promise<
    { readonly ok: true; readonly value: ReadonlyArray<WireRunSummaryEntry> }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
  >

  /**
   * The revisions this deployment holds for one run, newest first.
   *
   * A revision is a durable object: a request that names the version it read, the candidates that
   * answer it, and the reviews bound to those candidates. The page reads them rather than holding
   * any of it, so what it shows survives a reload.
   */
  listRevisions(request: { readonly runId: string }): Promise<
    { readonly ok: true; readonly value: ReadonlyArray<WireRevisionView> }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
  >

  /**
   * Record a person's request to change the manuscript at the gate.
   *
   * The service reads the revision and the sections itself; the caller states only what to change.
   */
  requestRevision(request: {
    readonly requestId: string
    readonly runId: string
    readonly stepId: string
    readonly instruction: string
  }): Promise<
    { readonly ok: true; readonly value: WireRevisionView }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
  >

  /**
   * Write a candidate that answers one request, through the deployment's own prose channel.
   */
  generateCandidate(request: {
    readonly runId: string
    readonly requestId: string
    readonly candidateId: string
  }): Promise<
    { readonly ok: true; readonly value: WireRevisionView }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
  >

  /**
   * Publish a reviewed candidate as the run's official manuscript.
   *
   * The one operation in the loop that changes the study, and the one that needs a review: the
   * backend refuses a candidate nobody checked, or one whose checks failed.
   */
  acceptCandidate(request: {
    readonly runId: string
    readonly requestId: string
    readonly candidateId: string
    readonly expectedRevision?: number
    readonly expectedManuscriptVersion?: number
  }): Promise<
    { readonly ok: true; readonly value: WireRevisionView }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
  >

  /**
   * Judge one candidate on what a pipeline can check without reading its prose.
   */
  reviewCandidate(request: {
    readonly runId: string
    readonly requestId: string
    readonly candidateId: string
  }): Promise<
    { readonly ok: true; readonly value: WireRevisionView }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
  >

  /**
   * Write one run's current state to its snapshot again, after a write that failed.
   *
   * The remedy the page offers on `saveFailure`, and the reason it is this method rather than a new
   * run: the state written is the one the host already holds. A finished study stays finished.
   */
  retryRunSave(request: { readonly runId: string }): Promise<
    { readonly ok: true; readonly value: WireRunSaveRetry }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
  >
}

/**
 * Where this tab remembers the run it was following before a reload.
 *
 * A RELOAD IS NOT A NEW STUDY. The run keeps going on the host — the driver is the service's — but
 * the page had no way to name it again, so a refresh showed "nothing has been run in this session"
 * over a study that was still working.
 *
 * SESSION storage, not local: what a reload needs is a handle, and a handle that outlived the tab
 * would come back with the NEXT visit — a page opening tomorrow onto a run the reader did not come
 * back for, reported as `stopped`. A day-old run is not what "restore what I was watching" means,
 * and the narrower store says exactly the narrower thing.
 */
const LAST_RUN_KEY = 'dsh.research.lastRunId'

/**
 * Record the run this browser is following, or forget it.
 * @param runId - the run to remember, or null to forget the remembered one.
 */
function rememberRunId(runId: string | null): void {
  try {
    if (runId === null) globalThis.sessionStorage.removeItem(LAST_RUN_KEY)
    else globalThis.sessionStorage.setItem(LAST_RUN_KEY, runId)
  } catch {
    // Storage can be refused (a private window, blocked site data). The page then cannot restore a
    // run after a reload, which is a limit on a convenience and never on the run itself.
  }
}

/**
 * The run this browser was following, or null when it was following none.
 * @returns the remembered run id.
 */
function rememberedRunId(): string | null {
  try {
    return globalThis.sessionStorage.getItem(LAST_RUN_KEY)
  } catch {
    return null
  }
}

/**
 * A fresh command id.
 *
 * `randomUUID` over a counter, because the id has to survive a reload: a page that came back and
 * pressed again with a counter starting at one would send an id the host has already answered, and
 * would be handed the earlier run instead of starting the one the person asked for.
 *
 * @returns an id no other command of this client can carry.
 */
function newCommandId(): string {
  return globalThis.crypto.randomUUID()
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
  /**
   * The host's research namespace, or a refusal naming why there is none.
   *
   * Read through `ctx.get`, never the property proxy: a mounted namespace is a service named
   * `remote.<namespace>`, and the proxy resolves a property only for a context whose fiber carries
   * it or that declares it in `inject`; this plugin declares `remote`, not each namespace, so
   * `ctx.remote.research` threw `cannot get property "remote.research" without inject` on the first
   * real click. `ctx.get` reads the global service store, which is the documented read for a
   * service this plugin does not declare — the same distinction the prose writer needed for
   * `ctx.agentLoop` (docs/postmortem/0001-acp-default-export-drops-inject.md).
   * @returns the namespace, or throws naming the assembly that failed to mount it.
   */
  const namespace = (): ResearchRemoteNamespace => {
    const remote = ctx.get('remote.research') as unknown as ResearchRemoteNamespace | undefined
    if (remote === undefined) {
      throw new Error(
        'the client has no `remote.research` namespace: the assembly that mounts Remote '
        + 'namespaces did not mount the research one',
      )
    }
    return remote
  }

  /**
   * START → READ → FOLLOW, instead of waiting for the study.
   *
   * The old body awaited one `run` call and returned when the whole pipeline had finished, which
   * meant the page had nothing to show for the eight minutes it was working and lost the run's
   * identity on every reload. This starts the run, hands the page its first snapshot as soon as
   * the host can produce one, and keeps reading until nothing is driving the run — reporting each
   * snapshot to `onUpdate` as it arrives, so the page follows the study rather than waiting on it.
   *
   * THE COMMAND ID IS THE CALLER'S RETRY TOKEN. A dropped response is not a refusal, and the
   * client cannot tell one from the other; it sends the SAME id again, and the host answers with
   * the run it already started rather than beginning a second study. A new id is a new study, and
   * only a deliberate second press produces one.
   *
   * THE PAGE CLOSING DOES NOT CANCEL THE RUN. This loop is the page's interest in the study, not
   * the study: the driver is owned by the host service, and a reader who comes back reads the same
   * run — from this process's memory while it is alive, and from the run's own checkpoints after a
   * restart, where it is reported as stopped rather than as still running.
   *
   * @param plan - the plan the person confirmed, or undefined for the deployment's own.
   * @param onUpdate - called with every snapshot, starting with the first one available.
   * @returns when the run has stopped, failed, or left this deployment's records.
   */
  const run = async (
    plan: WirePlan | undefined,
    onUpdate: (summary: ReturnType<typeof buildSummary>) => void,
    onPhase?: (state: ConnectionState) => void,
  ): Promise<void> => {
    const remote = namespace()
    const started = await remote.startRun({
      commandId: newCommandId(),
      ...(plan === undefined ? {} : { plan }),
    })
    // A refused call carries the host's own failure; surfacing it here is what keeps the tab
    // from showing a stale fixture as though the run had produced it.
    if (!started.ok) throw new Error(`${started.error.code}: ${started.error.message}`)
    const runId = started.value.runId
    rememberRunId(runId)
    await followToRest(remote, runId, null, onUpdate, onPhase)
  }
  /**
   * List the studies this deployment holds.
   *
   * A refusal rejects with the host's own reason rather than resolving to an empty list: "this
   * deployment holds no study" and "I could not ask" are different facts, and a person looking for
   * their work has to be told which one they have.
   *
   * @returns one entry per study, in the host's order.
   */
  const listRuns = async (): Promise<ReadonlyArray<RunListEntryView>> => {
    const answered = await namespace().listRuns()
    if (!answered.ok) throw new Error(`${answered.error.code}: ${answered.error.message}`)
    return runListFrom(answered.value)
  }

  /**
   * Open one study this deployment holds, by the id the person picked.
   *
   * The same follow the run control uses, so a study opened from the list is read exactly like one
   * this tab started — and the id is remembered here, so a reload lands on the same study.
   *
   * @param runId - the study to open.
   * @param onUpdate - called with each snapshot the host reports.
   * @returns when the run stops leaving more to read.
   */
  const openRun = async (
    runId: string,
    onUpdate: (summary: ReturnType<typeof buildSummary>) => void,
    onPhase?: (state: ConnectionState) => void,
  ): Promise<void> => {
    rememberRunId(runId)
    await followToRest(namespace(), runId, null, onUpdate, onPhase)
  }

  /**
   * Ask the host to write the run's current state to its snapshot again, after a write that failed.
   *
   * THE PAGE'S ONLY REMEDY FOR A RUN THAT IS NOT ON DISK, and the reason it is not "run it again":
   * the study has already been carried out, and its results are held by the host. A second run would
   * spend its model calls again and produce different numbers under the same name. The refreshed run
   * the host answers with is handed to `onUpdate`, so the page shows the state the write produced —
   * including the revision a decision has to be taken against.
   *
   * @param runId - the run whose write to retry.
   * @param onUpdate - called with the run the host re-projected after the attempt.
   * @returns when the host has answered; a refusal is thrown with the host's own reason.
   */
  const retrySave = async (
    runId: string,
    onUpdate: (summary: ReturnType<typeof buildSummary>) => void,
  ): Promise<void> => {
    const answered = await namespace().retryRunSave({ runId })
    if (!answered.ok) throw new Error(`${answered.error.code}: ${answered.error.message}`)
    // THE VIEW IS REBUILT FROM THE HOST'S OWN PROJECTION, and the attempt's outcome is not read out
    // of the receipt: the snapshot inside it already carries the durability record the retry
    // produced, so "did it land" has one home rather than two that can disagree.
    onUpdate(buildSummary(summaryInputFrom(answered.value.snapshot)))
  }

  /**
   * Ask the host for research directions. The failure is surfaced rather than turned into an empty
   * answer: "the host could not propose" and "the host proposed nothing" are different facts, and
   * the dialog says which.
   * @param field - the domain the person stated, or an empty string for none.
   * @returns what the host could propose, and what it refused.
   */
  /**
   * Pick up the run this browser was following before the page was reloaded.
   *
   * Nothing to resume is the NORMAL case, not a failure: a first visit, or a browser whose run this
   * deployment no longer holds. Both resolve without reporting anything, and the second also forgets
   * the id — a stored handle to a run that is gone would make every later visit ask about it again.
   *
   * @param onUpdate - called with each snapshot, starting with the one read on arrival.
   * @returns when the resumed run has stopped, or immediately when there is nothing to resume.
   */
  const resume = async (
    onUpdate: (summary: ReturnType<typeof buildSummary>) => void,
    onPhase?: (state: ConnectionState) => void,
  ): Promise<void> => {
    const remembered = rememberedRunId()
    if (remembered === null) return
    await followToRest(namespace(), remembered, null, onUpdate, onPhase).catch((cause: unknown) => {
      // A run this deployment no longer holds is not an error on a page that simply came back: the
      // handle was this browser's, so it is this browser's to drop.
      rememberRunId(null)
      if (!(cause instanceof Error) || !cause.message.includes('holds no such run')) throw cause
    })
  }

  /**
   * The revisions this deployment holds for one run.
   *
   * @param runId - the run to read.
   * @returns the requests with their candidates and reviews, as the host records them.
   */
  const listRevisions = async (runId: string): Promise<ReadonlyArray<WireRevisionView>> => {
    const answered = await namespace().listRevisions({ runId })
    if (!answered.ok) throw new Error(`${answered.error.code}: ${answered.error.message}`)
    return answered.value
  }

  /**
   * Ask the host to record a request to change the manuscript.
   *
   * @param input - the run, the gate, and what to change.
   * @returns the recorded request.
   */
  const requestRevision = async (input: {
    readonly runId: string
    readonly stepId: string
    readonly instruction: string
  }): Promise<WireRevisionView> => {
    const answered = await namespace().requestRevision({
      requestId: globalThis.crypto.randomUUID(),
      runId: input.runId,
      stepId: input.stepId,
      instruction: input.instruction,
    })
    if (!answered.ok) throw new Error(`${answered.error.code}: ${answered.error.message}`)
    return answered.value
  }

  /**
   * Ask the host to write a candidate for one request, or to judge one.
   *
   * @param call - which of the two operations to perform, and on what.
   * @returns the request as it stands after the operation.
   */
  const revisionStep = async (call: {
    readonly runId: string
    readonly requestId: string
    readonly candidateId: string
    readonly operation: 'generate' | 'review' | 'accept'
    readonly expectedRevision?: number
    readonly expectedManuscriptVersion?: number
  }): Promise<WireRevisionView> => {
    const request = {
      runId: call.runId, requestId: call.requestId, candidateId: call.candidateId,
      ...(call.expectedRevision === undefined ? {} : { expectedRevision: call.expectedRevision }),
      ...(call.expectedManuscriptVersion === undefined
        ? {} : { expectedManuscriptVersion: call.expectedManuscriptVersion }),
    }
    const answered = call.operation === 'generate'
      ? await namespace().generateCandidate(request)
      : call.operation === 'review'
        ? await namespace().reviewCandidate(request)
        : await namespace().acceptCandidate(request)
    if (!answered.ok) throw new Error(`${answered.error.code}: ${answered.error.message}`)
    return answered.value
  }

  const propose = async (field: string): Promise<WireProposalAnswer> => {
    const result = await namespace().proposeDirections({ field })
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
  }, researchViewWith(run, approve, propose, resume, retrySave, listRuns, openRun, {
    list: listRevisions, request: requestRevision, step: revisionStep,
  })))
}
