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
  readonly decision: 'approved' | 'rejected'
}

/** The graded outcome of one accepted approval. */
export interface ApprovalDecision {
  readonly runId: string
  readonly stepId: string
  readonly attempt: number
  /** The status core moved the step to: `passed` for an approval, `blocked` for a rejection. */
  readonly status: StepStatus
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
   * Absent when the deployment configured no snapshot directory, in which case there is
   * nothing to be durable about and `ApprovalDecision.persisted` reports false for the same
   * reason a save would.
   */
  readonly persist?: () => Promise<ResearchRunPersistence | null>
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
 */
export function rememberRun(
  runId: string,
  store: ResearchRunStore,
  project: () => ResearchRunSnapshot,
  persist?: () => Promise<ResearchRunPersistence | null>,
): void {
  rememberedRuns.set(runId, persist === undefined ? { store, project } : { store, project, persist })
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

/** Drop every remembered run (the owning plugin unloading). */
export function forgetRuns(): void {
  rememberedRuns.clear()
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
  if (typeof runId !== 'string' || runId === '') return undefined
  if (typeof stepId !== 'string' || stepId === '') return undefined
  if (typeof attempt !== 'number' || !Number.isSafeInteger(attempt) || attempt < 0) return undefined
  if (decision !== 'approved' && decision !== 'rejected') return undefined
  return { runId, stepId, attempt, decision }
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

  // Minting is outside the try: a broken channel is a deployment failure to report, not a
  // decision to grade.
  const channel = requireHostChannel()
  const approvalEventId = randomUUID()
  try {
    const principal = channel.mintPrincipal(runId, stepId, OPERATOR_PRINCIPAL_ID, approvalEventId)
    const status = channel.submit(run.store, runId, stepId, decision, principal)
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

    let persisted = false
    let persistenceError: string | undefined
    if (run.persist !== undefined) {
      const saved = await run.persist().catch((error: unknown) => ({
        runId,
        revision: null,
        interrupted: [],
        error: error instanceof Error ? error.message : String(error),
      }) satisfies ResearchRunPersistence)
      persisted = saved !== null && saved.revision !== null
      if (!persisted) persistenceError = saved?.error ?? 'no snapshot directory is configured for this deployment'
    } else {
      persistenceError = 'no snapshot directory is configured for this deployment'
    }
    // Report BOTH failures when both happened. They have different remedies and neither hides the
    // other: one says the decision is not on disk, the other says the response cannot carry the run.

    return {
      ok: true,
      value: {
        runId,
        stepId,
        attempt,
        status,
        operator: OPERATOR_PRINCIPAL_ID,
        approvalEventId,
        decidedAt: Date.now(),
        ...(snapshot === undefined ? {} : { snapshot }),
        persisted,
        ...(persistenceError === undefined ? {} : { persistenceError }),
        ...(projectionError === undefined ? {} : { projectionError }),
      },
    }
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
    return refuse(APPROVAL_ERROR_CODES.requestInvalid, 'an approval request needs string runId, string stepId, integer attempt and decision approved|rejected')
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
export function installApprovalEndpoint(connection: ApprovalConnectionHost): void {
  if (installed?.host === connection) return
  const previous = installed
  installed = undefined
  if (previous !== undefined) void previous.dispose()
  const dispose = connection.rpc.handle(
    APPROVAL_CHANNEL,
    (endpoint, payload) => Promise.resolve(decideApprovalRequest(endpoint, payload)),
  )
  installed = { host: connection, dispose }
}
