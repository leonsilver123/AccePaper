/**
 * Human approval of the `E2-submit` gate — this deployment's only path from `gated` to `passed`.
 *
 * WHY THIS MODULE EXISTS. `E2-submit` is the pipeline's single `humanGate` step. Core parks it at
 * `gated` and the ONLY function that can move it on is `_applyHumanApproval`, which core keeps
 * package-private and reaches solely through the host trust channel
 * (`@deepseek-ai/dsh-research-core/host`). That channel is a process singleton with no caller in
 * the tree — this module is the caller, and the module that owns the runs the channel approves.
 *
 * WHERE THE OPERATOR IDENTITY COMES FROM (ENGINEERING-CONTRACT §8.1). The host's browser session
 * is the deployment's one authenticated human identity: `dsh web` prints a root URL carrying a
 * per-process launch token, `BrowserAuth` (packages/client/connection/src/browser-auth.ts:185)
 * exchanges it for an HMAC-signed, authority-bound, expiry-bound cookie, and every request on the
 * `/api` prefix passes `HostConnectionService.requestRejection`
 * (packages/client/connection/src/rpc-host.ts:96) BEFORE dispatch. This module registers an
 * ordinary channel through `ctx.connection.rpc.handle` — the host's documented "authenticated
 * absolute channel prefix" registration (packages/client/connection/src/rpc.ts:158) — so the
 * host applies that same browser authentication to the route itself, structurally, before any
 * line of ours runs. A caller therefore reaches {@link submitApproval} only by presenting a
 * session cookie only the host's own console could have minted. The request body is NEVER
 * consulted for identity: a payload claiming `actor: 'human'`, `principal: ...` or
 * `status: 'passed'` contributes nothing — {@link readSubmission} reads exactly four fields and
 * discards every other one.
 *
 * WHAT THIS DOES NOT CLAIM. The cookie payload carries an authority and an expiry, no user id,
 * so the host cannot tell two people on one deployment apart; every authenticated browser
 * resolves to the single host-registered principal {@link OPERATOR_PRINCIPAL_ID}. And because the
 * check is a same-process HTTP boundary, code already running inside this process with a
 * `Context` could call {@link submitApproval} directly, as it could call any service — the same
 * residual `host.ts` documents. True isolation needs process-level/IPC identity the JavaScript
 * API cannot provide. Neither is a closed security boundary, and neither is described as one.
 *
 * THE RUN STORE IS MODULE-SCOPED (mirrors RC-C in `dsh-research-cordis/src/index.ts`). A TS
 * `private` field is erased at runtime and an instance property is enumerable, so a store held on
 * the service would hand live run state to anything reading `ctx.agentTeams`. Lexical scope keeps
 * it off every object reachable from the service, and it is what makes a forged approval channel
 * inert: `HostApprovalChannel.submit` takes the store as its first argument, so a channel minted
 * by other code can only approve runs in a store that code supplied.
 *
 * @module @deepseek-ai/dsh-research-team/approval
 */

import { randomBytes, randomUUID } from 'node:crypto'

import { getRunSnapshot, getStepDefinitionById } from '@deepseek-ai/dsh-research-core'
import type { ResearchRunStore, StepStatus } from '@deepseek-ai/dsh-research-core'
import { createHostApprovalChannel } from '@deepseek-ai/dsh-research-core/host'
import type { HostApprovalChannel } from '@deepseek-ai/dsh-research-core/host'

import type { ResearchRunPersistence, ResearchRunSnapshot } from './types.ts'

/**
 * Channel the approval endpoints are served on.
 *
 * A reserved absolute prefix like `/api`, carried by the same Connection transport and the same
 * origin, so the browser's session cookie is attached by the browser and never by our code.
 */
export const APPROVAL_CHANNEL = '/research-approval'

/** Endpoint on {@link APPROVAL_CHANNEL} that decides one pending human gate. */
export const APPROVAL_DECIDE_ENDPOINT = 'decide'

/**
 * The single host-registered human principal of this deployment.
 *
 * The host's browser session proves possession of the launch token; it names no person, so this
 * id names the mechanism rather than inventing a user the host cannot attest to.
 */
export const OPERATOR_PRINCIPAL_ID = 'authenticated-browser-operator'

/** Stable failure codes the approval endpoint returns. */
export const APPROVAL_ERROR_CODES = {
  requestInvalid: 'research/approval-request-invalid',
  runUnknown: 'research/approval-run-unknown',
  stepUnknown: 'research/approval-step-unknown',
  notHumanGate: 'research/approval-not-human-gate',
  notStarted: 'research/approval-step-not-started',
  notPending: 'research/approval-not-pending',
  staleAttempt: 'research/approval-stale-attempt',
  staleRevision: 'research/approval-stale-revision',
  saveFailed: 'research/approval-save-failed',
  refused: 'research/approval-refused',
} as const

/** One member of {@link APPROVAL_ERROR_CODES}. */
export type ApprovalErrorCode = typeof APPROVAL_ERROR_CODES[keyof typeof APPROVAL_ERROR_CODES]

/** One approval decision as a client states it. */
export interface ApprovalSubmission {
  /** Run the caller believes the pending step belongs to. */
  readonly runId: string
  /** The `humanGate` step the caller believes is pending. */
  readonly stepId: string
  /** The attempt the caller saw pending. A decision for any other attempt is refused. */
  readonly attempt: number
  /**
   * What the person decided.
   *
   * `request_changes` is a third outcome and not a softer `rejected`: the gate STAYS OPEN and the
   * step stays `gated`, because the person asked for different work rather than reporting that this
   * one failed. Its {@link request} is the instruction, and it is required for that decision — a
   * request that names nothing leaves whoever must act on it with nothing.
   */
  readonly decision: 'approved' | 'rejected' | 'request_changes'
  /**
   * What to change, for a `request_changes` decision.
   *
   * Read from the caller and carried into the run's own approval record, so the instruction is a
   * durable fact about this run rather than a message in whatever chat asked for it. Ignored for the
   * other two decisions, which have nothing to instruct.
   */
  readonly request?: string
  /**
   * The identity of the COMMAND, not of the decision.
   *
   * A caller that sends the same command id twice is retrying — a timeout it could not read, a
   * reload, a second click on a button that appeared to do nothing — and gets the answer the first
   * send produced. Without it the second send is a second decision: at best `not-pending`, and a
   * retry cannot tell that apart from "my decision never landed".
   *
   * It is the caller's to choose and the caller's to REUSE. A new id is a new intent, so a reader
   * who changes their mind and rejects after approving must send a different one.
   */
  readonly commandId: string
  /**
   * The project revision the reader was LOOKING AT when they decided.
   *
   * A decision is about a revision, not about a step. The host records the refs it freezes at the
   * moment of the decision; this says whether the thing in front of the reader was that revision.
   * When it is not — the run moved between the render and the click, which a second tab, a running
   * step or a recovery can all do — the decision is refused rather than recorded, because approving
   * a document nobody read is the failure this field exists to catch.
   */
  readonly expectedProjectRevision: number
}

/** The graded outcome of one accepted approval. */
export interface ApprovalDecision {
  readonly runId: string
  readonly stepId: string
  readonly attempt: number
  /**
   * The status the step is in after the decision.
   *
   * `passed` for an approval, `blocked` for a rejection, and `gated` for a change request — which
   * leaves the gate where it was, open, with the instruction recorded against it.
   */
  readonly status: StepStatus
  /** Which decision was recorded. A caller renders the receipt from this, not from its own intent. */
  readonly decision: 'approved' | 'rejected' | 'request_changes'
  /**
   * What a `request_changes` decision asked for, as it was recorded.
   *
   * ABSENT for the other two decisions, which have nothing to instruct. A request without it would
   * be a decision whose whole content the caller cannot read.
   */
  readonly request?: string
  /** The host-attested principal that decided. */
  readonly operator: string
  /** The single-use event id the decision was recorded under. */
  readonly approvalEventId: string
  /** Epoch milliseconds at which core recorded the decision. */
  readonly decidedAt: number
  /** The run re-projected after the decision, so a caller renders backend truth, not its own. */
  /**
   * The run re-projected after the decision, so a caller renders backend truth, not its own.
   *
   * ABSENT when the projection itself failed. The decision is still applied and still durable —
   * see `projectionError` — and the caller is told the response cannot carry the run rather than
   * that the decision was refused. Merging the two told a caller the gate was undecided while the
   * run said otherwise, and a retry then came back `not-pending`.
   */
  readonly snapshot?: ResearchRunSnapshot
  /**
   * Whether the decision reached the durable snapshot, and why not when it did not.
   *
   * A decision that only exists in this process is a decision a restart forgets: the restored
   * run would show E2 `gated` again and ask the person to approve what they already approved.
   * The failure is REPORTED rather than swallowed — the caller decided, and has to be able to
   * tell the difference between "recorded" and "lost when this process ends".
   */
  readonly persisted: boolean
  readonly persistenceError?: string
  /**
   * Why the run could not be re-projected after a decision that WAS applied.
   *
   * Separate from `persistenceError` on purpose: one says "the decision is not on disk yet", the
   * other says "the response could not carry the run". They are different failures with different
   * remedies, and merging them told a caller their decision was refused when it had been applied.
   * `snapshot` is unusable when this is set.
   */
  readonly projectionError?: string
}

/** One logical RPC endpoint result, as the Host Connection carrier carries it. */
export type ApprovalWireResult =
  | { readonly ok: true; readonly value: ApprovalDecision }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details: object } }

/**
 * Structural face of the Host Connection service this module registers on.
 *
 * Declared rather than imported: `dsh-research-team` does not depend on
 * `@deepseek-ai/dsh-client-connection`, and the shape is pinned by that package's own
 * `HostConnectionHandle.rpc` (a rename there fails its tests, not silently here).
 */
export interface ApprovalConnectionHost {
  readonly rpc: {
    /**
     * Register one authenticated absolute channel prefix.
     * @param channel - absolute logical channel, e.g. `/research-approval`.
     * @param handler - decoded endpoint handler.
     * @returns asynchronous disposer removing the channel and its route.
     */
    handle(
      channel: string,
      handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ApprovalWireResult>,
    ): () => Promise<void>
  }
}

/** One run this process started, kept so a later approval can address it. */
export interface RememberedRun {
  /** The store the run populated. */
  readonly store: ResearchRunStore
  /**
   * Re-project this run from its CURRENT store.
   *
   * Supplied by the run's owner rather than rebuilt here, so a decision's response carries the
   * same projection a `run` call produces — including the parts of it (the export manifest, the
   * driver's own outcome kinds) that do not live in the store and must not be re-derived.
   */
  readonly project: () => ResearchRunSnapshot
  /**
   * Write this run's CURRENT state to its durable snapshot, and re-export its package.
   *
   * A deployment that configured no snapshot directory has nothing to be durable about: its
   * writer answers null, and `ApprovalDecision.persisted` then reports false for the same reason
   * a refused save would.
   */
  readonly persist: () => Promise<ResearchRunPersistence | null>
  /**
   * What this run's LAST durable write did, as the run's own projection reports it.
   *
   * REQUIRED, and not a second opinion about durability: this is the one fact the page renders
   * (`ResearchRunSnapshot.runPersistence`), the readiness note explains, and {@link submitApproval}
   * refuses on. A caller that could not answer it would be a caller free to decide a gate whose
   * record exists only in this process — the decision is refused while this reports a failure.
   *
   * `null` means this deployment keeps no durable record for the run, which is a different fact
   * from a write that was attempted and failed, and is not a failure.
   */
  readonly saveState: () => ResearchRunPersistence | null
}

/**
 * Run stores kept by run id, MODULE-SCOPED on purpose (see the module header). Cleared when the
 * owning plugin unloads, so a reloaded deployment cannot approve runs it no longer holds.
 */
const rememberedRuns = new Map<string, RememberedRun>()

/**
 * The process's host approval channel, minted on first use and kept for the process lifetime.
 *
 * Cached in module scope rather than in an instance field for the same reason the run stores are:
 * the channel mints principals, and a principal is the only thing `submit` accepts.
 */
let hostChannel: HostApprovalChannel | undefined

/** The channel registration currently installed, and the Connection service that owns it. */
let installed: { readonly host: object; readonly dispose: () => Promise<void> } | undefined

/**
 * The secret the singleton channel is minted with.
 *
 * `host.ts` documents `process.env.DSH_APPROVAL_SECRET` as the intended source; when the
 * deployment sets nothing, a per-process random is minted instead. Neither value is consumed by
 * the channel implementation — it exists so that a second mint in one process fails loudly — and
 * a value that lives only in this closure is strictly less observable by in-process code than
 * one that also sits in `process.env`.
 *
 * @returns a non-empty secret.
 */
function channelSecret(): string {
  const configured = process.env.DSH_APPROVAL_SECRET
  return configured !== undefined && configured !== '' ? configured : randomBytes(32).toString('base64url')
}

/**
 * Mint the process's host approval channel and register the deployment's operator principal.
 *
 * Called once per process. A second mint throws `DSH_APPROVAL_CHANNEL_EXISTS` from core's
 * singleton; that throw is left to propagate rather than swallowed — it means this module was
 * loaded twice in one process, and the second copy genuinely cannot serve approvals.
 *
 * @returns the process's channel.
 */
function requireHostChannel(): HostApprovalChannel {
  if (hostChannel !== undefined) return hostChannel
  const created = createHostApprovalChannel(channelSecret())
  created.registerPrincipal(OPERATOR_PRINCIPAL_ID)
  hostChannel = created
  return created
}

/**
 * Remember one run this process started, so a later approval can address it by id.
 *
 * @param runId - the run's immutable identity, the key a later approval addresses it by.
 * @param store - the store the run populated.
 * @param project - re-projects the run from its current store, as its owner builds it.
 * @param persist - writes the run's current state to its durable snapshot.
 * @param saveState - reads back what the run's last durable write did.
 */
export function rememberRun(
  runId: string,
  store: ResearchRunStore,
  project: () => ResearchRunSnapshot,
  persist: () => Promise<ResearchRunPersistence | null>,
  saveState: () => ResearchRunPersistence | null,
): void {
  rememberedRuns.set(runId, { store, project, persist, saveState })
}

/**
 * Read back one remembered run.
 *
 * @param runId - the run to look up.
 * @returns the run's store and re-projection, or undefined when this process holds no such run.
 */
export function rememberedRun(runId: string): RememberedRun | undefined {
  return rememberedRuns.get(runId)
}

/**
 * The answer a command id already produced, so a retry reads it instead of deciding again.
 *
 * In memory, and that is the honest boundary: across a restart the ledger is gone, and a retried
 * command meets `not-pending` because the step is already decided. That refusal is SAFE — it cannot
 * decide twice — but it is not idempotent, and the difference is recorded in the README rather than
 * papered over with a durable table this layer does not own.
 */
const decidedCommands = new Map<string, ApprovalWireResult>()

/** Drop every remembered run and command (the owning plugin unloading). */
export function forgetRuns(): void {
  rememberedRuns.clear()
  decidedCommands.clear()
}

/**
 * Read the four fields an approval request is allowed to carry.
 *
 * Every other field in the payload is discarded here, which is where the identity rule of
 * ENGINEERING-CONTRACT §8.1 is enforced: `actor`, `principal`, `principalId`, `status` and
 * anything else a body claims are never read, so they cannot influence the decision.
 *
 * @param payload - the decoded request body.
 * @returns the submission, or undefined when a required field is missing or mistyped.
 */
export function readSubmission(payload: unknown): ApprovalSubmission | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined
  const record = payload as Record<string, unknown>
  const runId = record['runId']
  const stepId = record['stepId']
  const attempt = record['attempt']
  const decision = record['decision']
  const commandId = record['commandId']
  if (typeof runId !== 'string' || runId === '') return undefined
  if (typeof stepId !== 'string' || stepId === '') return undefined
  if (typeof attempt !== 'number' || !Number.isSafeInteger(attempt) || attempt < 0) return undefined
  if (decision !== 'approved' && decision !== 'rejected' && decision !== 'request_changes') return undefined
  // A REQUEST MUST SAY WHAT TO CHANGE. Validated here rather than inside core so a caller learns it
  // before an event id is minted and a run is touched; core refuses it too, because a rule enforced
  // only at one boundary is a rule the next caller does not have.
  const request = record['request']
  if (decision === 'request_changes' && (typeof request !== 'string' || request.trim() === '')) return undefined
  if (request !== undefined && typeof request !== 'string') return undefined
  // REQUIRED. A command with no identity cannot be retried safely, and defaulting one here would
  // make every retry a fresh decision — the failure this field exists to prevent.
  if (typeof commandId !== 'string' || commandId === '') return undefined
  // REQUIRED, and for a stronger reason: a caller that cannot say which revision it read cannot
  // promise it read one, and defaulting this would make every approval a decision about whatever
  // the run happens to hold.
  const expectedProjectRevision = record['expectedProjectRevision']
  if (typeof expectedProjectRevision !== 'number' || !Number.isSafeInteger(expectedProjectRevision) || expectedProjectRevision < 0) {
    return undefined
  }
  return {
    runId, stepId, attempt, decision, commandId, expectedProjectRevision,
    ...(typeof request === 'string' ? { request } : {}),
  }
}

/**
 * Decide one pending human gate.
 *
 * The run, the step, the step's `humanGate` flag, its current status and its CURRENT attempt are
 * all read from the store this process holds — never from the caller's claims. A step that is not
 * `gated` is refused (so a repeated click cannot approve twice, and a rollback followed by a new
 * attempt leaves the old decision inert), and a request naming an attempt other than the step's
 * current one is refused before the channel is asked anything.
 *
 * @param submission - the four fields the caller stated.
 * @returns the decision with the re-projected run, or the refusal that stopped it.
 */
export async function submitApproval(submission: ApprovalSubmission): Promise<ApprovalWireResult> {
  const { runId, stepId, attempt, decision } = submission
  const run = rememberedRuns.get(runId)
  if (run === undefined) {
    return refuse(APPROVAL_ERROR_CODES.runUnknown, `this process holds no run '${runId}' — a run id is not an approval credential`)
  }
  const definition = getStepDefinitionById(stepId)
  if (definition === undefined) {
    return refuse(APPROVAL_ERROR_CODES.stepUnknown, `'${stepId}' is not one of the 16 pipeline steps`)
  }
  if (!definition.humanGate) {
    return refuse(APPROVAL_ERROR_CODES.notHumanGate, `step '${stepId}' is not a humanGate step — an ordinary step is never approved by hand`)
  }
  // A RETRY READS THE FIRST ANSWER. Checked before anything is decided, so a second send cannot
  // reach the channel at all — which also means it cannot be refused for the state the FIRST send
  // produced, the `not-pending` that a retrying caller cannot tell apart from "it never landed".
  const answered = decidedCommands.get(submission.commandId)
  if (answered !== undefined) return answered

  const state = getRunSnapshot(run.store, runId).steps[stepId]
  if (state === undefined) {
    return refuse(APPROVAL_ERROR_CODES.notStarted, `step '${stepId}' has no recorded state in run '${runId}'`)
  }
  if (state.status !== 'gated') {
    return refuse(
      APPROVAL_ERROR_CODES.notPending,
      `step '${stepId}' is '${state.status}', not 'gated' — there is no pending approval to decide`,
    )
  }
  if (state.attemptId !== attempt) {
    return refuse(
      APPROVAL_ERROR_CODES.staleAttempt,
      `step '${stepId}' is at attempt ${String(state.attemptId)}, not ${String(attempt)} — a decision for a superseded attempt does not decide the current one`,
    )
  }
  // A DECISION IS ABOUT A REVISION. The reader read a document at some revision of the run; this
  // refuses when the run has moved since, rather than approving whatever is there now. The refusal
  // names both revisions so the reader can re-read the difference, and it says what to do about it.
  const currentRevision = getRunSnapshot(run.store, runId).revision
  if (currentRevision !== submission.expectedProjectRevision) {
    return refuse(
      APPROVAL_ERROR_CODES.staleRevision,
      `this decision was made about project revision ${String(submission.expectedProjectRevision)}, `
      + `and run '${runId}' is at ${String(currentRevision)} — re-read the current manuscript before deciding`,
    )
  }
  // THE RUN HAS TO BE ON DISK FOR A DECISION ABOUT IT TO BE. A decision that lives only in this
  // process is one a restart forgets: the restored run shows E2 `gated` and asks the person to
  // approve what they already approved. Reporting that as `persisted: false` AFTER the decision was
  // the wrong place for it — the gate had already moved to `passed` in memory, so a caller was told
  // its decision was not durable without being able to do anything about it, and the run's own
  // record said one thing while the refusal said another. Refused here, with the other
  // preconditions, because this is the only place the operation can decline to happen.
  //
  // The fact is the run's own last write, not a second measurement of it: the page renders the same
  // value, so a reader told "the run could not be saved" is refused for exactly what they were
  // shown. It clears on the run's next write that lands (a checkpoint while it is being driven, a
  // resume's write when it is not), and a refusal is never remembered, so the caller retries the
  // same command once the deployment can write again.
  const saveState = run.saveState()
  if (saveState?.error !== undefined) {
    return refuse(
      APPROVAL_ERROR_CODES.saveFailed,
      `run '${runId}' is not on disk: its last write to the run snapshot failed (${saveState.error}). `
      + 'A decision that cannot be recorded is refused rather than applied, because a restart would '
      + 'ask the person to approve the same gate again',
    )
  }

  // Minting is outside the try: a broken channel is a deployment failure to report, not a
  // decision to grade.
  const channel = requireHostChannel()
  const approvalEventId = randomUUID()
  try {
    const principal = channel.mintPrincipal(runId, stepId, OPERATOR_PRINCIPAL_ID, approvalEventId)
    const status = channel.submit(
      run.store, runId, stepId, decision, principal,
      decision === 'request_changes' ? submission.request : undefined,
    )
    // PERSIST AFTER the decision, never before: the store now holds the state the decision
    // produced, and saving first would write the pre-decision state under a revision the
    // decision then invalidates. A failure here does NOT un-decide anything — the run has the
    // new status in memory — so it is reported alongside the decision rather than turned into
    // a refusal that would misdescribe what happened.
    // The decision is now IN the store. From here on nothing may turn it into a refusal: the
    // caller would be told the gate was not decided while the run says it was, and a retry would
    // come back `not-pending`. The projection ran inside the `try` below, so a failure to
    // re-project an already-applied decision was reported as `research/approval-refused` — an
    // audit reproduced exactly that and found `status: passed` in the store beside the refusal.
    // The projection and the persistence are INDEPENDENT, and a first version of this fix conflated
    // them: it returned early when the projection threw, so the persist closure was never called
    // and an applied decision was not written to disk at all. It reported that honestly, and the
    // report was the only correct thing about it — an audit counted zero calls to the closure.
    let snapshot: ResearchRunSnapshot | undefined
    let projectionError: string | undefined
    try {
      snapshot = run.project()
    } catch (error) {
      projectionError = error instanceof Error ? error.message : String(error)
    }

    const saved = await run.persist().catch((error: unknown) => ({
      runId,
      revision: null,
      interrupted: [],
      error: error instanceof Error ? error.message : String(error),
    }) satisfies ResearchRunPersistence)
    const persisted = saved !== null && saved.revision !== null
    const persistenceError = persisted
      ? undefined
      : (saved?.error ?? 'no snapshot directory is configured for this deployment')
    // Report BOTH failures when both happened. They have different remedies and neither hides the
    // other: one says the decision is not on disk, the other says the response cannot carry the run.

    const result: ApprovalWireResult = {
      ok: true,
      value: {
        runId,
        stepId,
        attempt,
        status,
        decision,
        ...(decision === 'request_changes' && submission.request !== undefined
          ? { request: submission.request.trim() } : {}),
        operator: OPERATOR_PRINCIPAL_ID,
        approvalEventId,
        decidedAt: Date.now(),
        ...(snapshot === undefined ? {} : { snapshot }),
        persisted,
        ...(persistenceError === undefined ? {} : { persistenceError }),
        ...(projectionError === undefined ? {} : { projectionError }),
      },
    }
    // REMEMBERED ONLY ON SUCCESS. A refusal says nothing about what the decision was, and caching
    // one would make a retry of a command that failed for a transient reason permanently refused.
    decidedCommands.set(submission.commandId, result)
    return result
  } catch (error) {
    return refuse(
      APPROVAL_ERROR_CODES.refused,
      error instanceof Error ? error.message : String(error),
    )
  }
}

/**
 * Build one refusal.
 *
 * @param code - the stable failure code.
 * @param message - the specific reason, in the terms of the check that produced it.
 * @returns the wire failure result.
 */
function refuse(code: ApprovalErrorCode, message: string): ApprovalWireResult {
  return { ok: false, error: { code, message: `[${code}] ${message}`, details: {} } }
}

/**
 * Decide one request that arrived on {@link APPROVAL_CHANNEL}.
 *
 * @param endpoint - the channel-relative endpoint the caller addressed.
 * @param payload - the decoded request body.
 * @returns the decision, or the refusal that stopped it.
 */
export async function decideApprovalRequest(endpoint: string, payload: unknown): Promise<ApprovalWireResult> {
  if (endpoint !== APPROVAL_DECIDE_ENDPOINT) {
    return refuse(APPROVAL_ERROR_CODES.requestInvalid, `unknown approval endpoint '${endpoint}'`)
  }
  const submission = readSubmission(payload)
  if (submission === undefined) {
    return refuse(
      APPROVAL_ERROR_CODES.requestInvalid,
      'an approval request needs string runId, string stepId, integer attempt and a decision of '
      + 'approved, rejected or request_changes (the last requiring a non-empty request)',
    )
  }
  return submitApproval(submission)
}

/**
 * Serve {@link APPROVAL_DECIDE_ENDPOINT} on {@link APPROVAL_CHANNEL}.
 *
 * Registration goes through `connection.rpc.handle`, so Connection applies its Host/Origin fence
 * and browser authentication to the route before dispatch (packages/client/connection/src/
 * rpc-host.ts:162). Idempotent per Connection service: re-registering on the same host is a
 * no-op, and a replacement host's registration is disposed first so one route never has two
 * owners.
 *
 * @param connection - the Host Connection service to register the authenticated channel on.
 */
/** What an endpoint installation may do after a decision has been applied. */
export interface ApprovalEndpointOptions {
  /**
   * Called with the receipt of a decision that WAS applied.
   *
   * THE GATE IS WHERE THE REVISION LOOP STARTS, which is why this exists: a `request_changes`
   * decision is an instruction, and the service that owns the run's records is the only layer that
   * can turn it into a durable request naming the sections it read. A hook failure does NOT change
   * the answer — the decision is applied and durable by the time this runs, and reporting it as
   * refused would tell the operator their decision did not land while the run says it did.
   */
  readonly onDecided?: (receipt: ApprovalDecision) => Promise<void> | void
}

export function installApprovalEndpoint(
  connection: ApprovalConnectionHost,
  options: ApprovalEndpointOptions = {},
): void {
  if (installed?.host === connection) return
  const previous = installed
  installed = undefined
  if (previous !== undefined) void previous.dispose()
  const dispose = connection.rpc.handle(
    APPROVAL_CHANNEL,
    async (endpoint: string, payload: unknown) => {
      const result = await decideApprovalRequest(endpoint, payload)
      if (result.ok && options.onDecided !== undefined) {
        // AWAITED, so a caller that decides and immediately reads the loop sees the request this
        // decision created. GUARDED AROUND THE CALL ITSELF, not only around its promise: a hook that
        // throws synchronously — a missing revision root, a store that refuses — would otherwise
        // reject this handler and report a decision that WAS applied as one that never landed.
        try {
          await options.onDecided(result.value)
        } catch {
          // Swallowed on purpose, and it is the only safe direction: the decision is applied and
          // durable before this runs. The hook's own caller records the failure it can act on.
        }
      }
      return result
    },
  )
  installed = { host: connection, dispose }
}
