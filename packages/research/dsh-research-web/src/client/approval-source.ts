/**
 * Human-approval transport for the research workbench (人工审批).
 *
 * WHY A SEPARATE CHANNEL FROM `ctx.remote`. The approval has to be attributable to the host's
 * authenticated operator, and `ctx.remote` reaches a Typert Remote method without carrying any
 * evidence of who called it: the Gateway's Remote dispatch passes the wire payload and a
 * cancellation signal and nothing else, so a method reached that way cannot tell a browser
 * holding the launch-token session cookie from an in-process caller. The host's Connection
 * service DOES apply that authentication, to the routes it registers. So the workbench calls
 * the approval channel `dsh-research-team` registers through it
 * (`connection.rpc.handle('/research-approval', ...)`), and the same-origin browser attaches
 * the `HttpOnly` session cookie the host's own console minted. The identity is the transport's,
 * never the payload's.
 *
 * TWINS. This module compiles in the Client face and `dsh-research-team` in the Host face, so
 * the request and response are declared structurally here — the same convention
 * `../run-source.ts` uses for the run snapshot. The Host side exports the same field names.
 */

import type { RunSummary } from '../summary.ts'
import { buildSummary } from '../loader.ts'
import { summaryInputFrom, type WireRunSnapshot } from '../run-source.ts'

/** Channel `dsh-research-team` serves approvals on. */
export const APPROVAL_CHANNEL = '/research-approval'

/** Endpoint on {@link APPROVAL_CHANNEL} that decides one pending human gate. */
export const APPROVAL_DECIDE_ENDPOINT = 'decide'

/** One approval decision as the workbench asks for it. */
export interface ApprovalRequest {
  /** Run the pending step belongs to. */
  readonly runId: string
  /** The `humanGate` step to decide. */
  readonly stepId: string
  /** The attempt the reader saw pending; the backend refuses any other. */
  readonly attempt: number
  readonly decision: 'approved' | 'rejected'
  /**
   * The identity of this COMMAND. Reuse it when retrying the same intent; mint a new one when the
   * reader changes their mind.
   *
   * The backend answers a repeated command id with the result the first send produced. Sending a
   * fresh id after a timeout is a second decision — which the backend refuses as `not-pending`, a
   * refusal the caller cannot tell apart from "my decision never landed".
   */
  readonly commandId: string
  /**
   * The project revision the reader was looking at.
   *
   * The backend refuses a decision that names any other revision, so a page that moved under the
   * reader — a second tab, a step that landed, a recovery — cannot get a decision recorded against
   * a document nobody read. The panel does not offer the buttons at all when this is unknown.
   */
  readonly expectedProjectRevision: number
}

/**
 * Mint one approval command id.
 *
 * @returns an id unique to this intent, to be reused for every retry of it.
 */
export function newApprovalCommandId(): string {
  return globalThis.crypto.randomUUID()
}

/** What the backend recorded, as the wire carries it. */
export interface ApprovalReceipt {
  readonly runId: string
  readonly stepId: string
  readonly attempt: number
  readonly status: string
  /** The host-attested operator the backend recorded the decision under. */
  readonly operator: string
  readonly decision: 'approved' | 'rejected'
  /** Identity of the decision itself, so a later query can find it rather than re-decide. */
  readonly approvalEventId: string
  readonly decidedAt: number
  /**
   * Whether the decision reached disk.
   *
   * FALSE means it exists in this process only: the gate is decided, the run says so, and a restart
   * loses it. That is a fact the operator has to see, because it decides whether they can close the
   * page — and it is NOT a refusal, which is what the panel used to show it as by dropping it.
   */
  readonly persisted: boolean
  /** Why the decision is not on disk, when it is not. */
  readonly persistenceError?: string | undefined
  /** Why the backend could not re-project the run, when it could not. */
  readonly projectionError?: string | undefined
}

/** How an approval attempt ended. */
export type ApprovalOutcome =
  | { readonly ok: true; readonly receipt: ApprovalReceipt; readonly summary: RunSummary }
  /**
   * The decision was APPLIED and this is the receipt for it; only the refreshed workbench is
   * missing. `summaryFailure` says which of two independent things went wrong, because they have
   * different remedies and the operator should be told which one they have:
   *
   *   - the backend could not re-project the run (`projectionError`), so no summary was sent;
   *   - the backend sent one and this client could not read it.
   *
   * Neither is a refusal. Reporting either as one would tell the operator their approval failed
   * while the run says it passed.
   */
  | {
    readonly ok: true
    readonly receipt: ApprovalReceipt
    readonly summaryUnavailable: true
    readonly summaryFailure: string
  }
  | { readonly ok: false; readonly code: ApprovalFailure; readonly detail: string }

/**
 * Why an approval did not happen. The panel owns the copy for each; the detail is the
 * specific cause the backend or the transport reported.
 */
export type ApprovalFailure =
  /** No authenticated channel is mounted: this deployment has no browser trust surface. */
  | 'unavailable'
  /** The call itself failed (transport, HTTP, or an unreadable response envelope). */
  | 'transport'
  /** The backend answered, but not in the shape this contract declares. */
  | 'malformed'
  /** The backend refused the decision; `detail` states why. */
  | 'refused'

/** Start one approval and resolve with the refreshed run summary, or why it did not happen. */
export type ApprovalSubmitter = (request: ApprovalRequest) => Promise<ApprovalOutcome>

/** Structural face of the client Connection service (`ctx.connection`). */
interface ClientConnectionLike {
  readonly rpc: {
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read the RPC caller off a candidate service, or undefined when it is not one.
 *
 * @param candidate - the value `ctx.get('connection')` resolved.
 * @returns the caller, or undefined.
 */
function rpcCaller(candidate: unknown): ClientConnectionLike['rpc'] | undefined {
  if (!isRecord(candidate)) return undefined
  const rpc = candidate['rpc']
  if (!isRecord(rpc) || typeof rpc['call'] !== 'function') return undefined
  return rpc as unknown as ClientConnectionLike['rpc']
}

/**
 * Read a successful decision off one RPC result envelope.
 *
 * @param value - the decoded `connection.rpc.call` result.
 * @returns the receipt and the run snapshot, or why the value was not one.
 */
function readDecision(value: unknown):
  | { readonly ok: true; readonly receipt: ApprovalReceipt; readonly snapshot: unknown }
  | { readonly ok: false; readonly code: ApprovalFailure; readonly detail: string } {
  if (!isRecord(value)) return { ok: false, code: 'malformed', detail: 'the result envelope is not an object' }
  if (value['ok'] !== true) {
    const error = value['error']
    const detail = isRecord(error) && typeof error['message'] === 'string'
      ? error['message']
      : 'the backend refused the decision without a stated reason'
    return { ok: false, code: 'refused', detail }
  }
  const decision = value['value']
  if (!isRecord(decision)) return { ok: false, code: 'malformed', detail: 'the decision is not an object' }
  const { runId, stepId, attempt, status, operator, approvalEventId, decidedAt, persisted,
    persistenceError, projectionError, snapshot } = decision
  if (typeof runId !== 'string' || typeof stepId !== 'string' || typeof status !== 'string'
    || typeof operator !== 'string' || typeof attempt !== 'number') {
    return { ok: false, code: 'malformed', detail: 'the decision is missing runId, stepId, attempt, status or operator' }
  }
  // The receipt fields are REQUIRED, and a backend that omits one is reported rather than
  // tolerated. They are what tells the operator whether their decision survives a restart and
  // whether the page in front of them is the run the backend has; defaulting them would invent
  // exactly the two facts this channel exists to carry. A missing `persisted` in particular is the
  // signature of a host built before the field existed.
  if (typeof approvalEventId !== 'string' || typeof decidedAt !== 'number' || typeof persisted !== 'boolean') {
    return {
      ok: false,
      code: 'malformed',
      detail: 'the decision is missing approvalEventId, decidedAt or persisted — the host and this '
        + 'client are not the same build',
    }
  }
  // The decision the backend recorded is read back from the step it changed rather than
  // taken from a field: the status IS the decision's outcome, and deriving it keeps the
  // panel from rendering a decision the backend did not make.
  const decisionValue = status === 'passed' ? 'approved' : 'rejected'
  return {
    ok: true,
    receipt: {
      runId,
      stepId,
      attempt,
      status,
      operator,
      decision: decisionValue,
      approvalEventId,
      decidedAt,
      persisted,
      ...(typeof persistenceError === 'string' ? { persistenceError } : {}),
      ...(typeof projectionError === 'string' ? { projectionError } : {}),
    },
    snapshot,
  }
}

/**
 * Build the workbench's approval submitter.
 *
 * The Connection service is resolved at CALL time, not at plugin load: a deployment whose
 * browser trust surface mounts later still gets a working approval, and one that mounts none
 * reports {@link ApprovalFailure} `unavailable` instead of failing the whole view.
 *
 * @param resolveConnection - reads `ctx.connection` (the client Connection service).
 * @returns the submitter the approval panel calls.
 */
export function buildApprovalSubmitter(resolveConnection: () => unknown): ApprovalSubmitter {
  return async (request) => {
    const rpc = rpcCaller(resolveConnection())
    if (rpc === undefined) {
      return { ok: false, code: 'unavailable', detail: 'no connection service is mounted on this client' }
    }
    let result: unknown
    try {
      result = await rpc.call(APPROVAL_CHANNEL, APPROVAL_DECIDE_ENDPOINT, {
        runId: request.runId,
        stepId: request.stepId,
        attempt: request.attempt,
        decision: request.decision,
        commandId: request.commandId,
        expectedProjectRevision: request.expectedProjectRevision,
      })
    } catch (cause) {
      return { ok: false, code: 'transport', detail: cause instanceof Error ? cause.message : String(cause) }
    }
    const decision = readDecision(result)
    if (!decision.ok) return decision
    // THE RECEIPT IS WHAT THE OPERATOR GETS, AND A FAILED REFRESH DOES NOT TAKE IT AWAY. Both
    // failures below were previously reported as `ok: false, code: 'malformed'`, which told the
    // operator the approval failed while the run said it passed — and invited them to press the
    // button again, which comes back `not-pending` at best and a second decision at worst.
    if (decision.snapshot === undefined) {
      return {
        ok: true,
        receipt: decision.receipt,
        summaryUnavailable: true,
        summaryFailure: decision.receipt.projectionError
          ?? 'the backend applied the decision and did not send a refreshed run',
      }
    }
    try {
      return {
        ok: true,
        receipt: decision.receipt,
        summary: buildSummary(summaryInputFrom(decision.snapshot as WireRunSnapshot)),
      }
    } catch (cause) {
      return {
        ok: true,
        receipt: decision.receipt,
        summaryUnavailable: true,
        summaryFailure: `the refreshed run could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
      }
    }
  }
}
