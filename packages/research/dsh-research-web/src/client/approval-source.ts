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
}

/** How an approval attempt ended. */
export type ApprovalOutcome =
  | { readonly ok: true; readonly receipt: ApprovalReceipt; readonly summary: RunSummary }
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
  const { runId, stepId, attempt, status, operator, snapshot } = decision
  if (typeof runId !== 'string' || typeof stepId !== 'string' || typeof status !== 'string'
    || typeof operator !== 'string' || typeof attempt !== 'number') {
    return { ok: false, code: 'malformed', detail: 'the decision is missing runId, stepId, attempt, status or operator' }
  }
  // The decision the backend recorded is read back from the step it changed rather than
  // taken from a field: the status IS the decision's outcome, and deriving it keeps the
  // panel from rendering a decision the backend did not make.
  const decisionValue = status === 'passed' ? 'approved' : 'rejected'
  return { ok: true, receipt: { runId, stepId, attempt, status, operator, decision: decisionValue }, snapshot }
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
      })
    } catch (cause) {
      return { ok: false, code: 'transport', detail: cause instanceof Error ? cause.message : String(cause) }
    }
    const decision = readDecision(result)
    if (!decision.ok) return decision
    try {
      return {
        ok: true,
        receipt: decision.receipt,
        summary: buildSummary(summaryInputFrom(decision.snapshot as WireRunSnapshot)),
      }
    } catch (cause) {
      return {
        ok: false,
        code: 'malformed',
        detail: cause instanceof Error ? cause.message : String(cause),
      }
    }
  }
}
