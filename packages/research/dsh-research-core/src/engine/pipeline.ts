/**
 * T19-A P3 — minimal execution pipeline (core, Cordis-free, unit-testable).
 *
 * `runStep` organizes ONE step's execute phase into a verifiable minimal flow:
 *
 *   pre-execute guard → [guard] → execute(executor, timeout, signal) →
 *   [post-execute] → artifact write (via recordArtifact write-boundary) →
 *   result → append-only audit (step-executed)
 *
 * It deliberately does NOT re-implement gate adjudication: on a successful execute the
 * step stays `in_progress` and the caller/upper layer continues the gate via the existing
 * `submitGateVerdict` (INV-SOLE-ADJUDICATOR). `runStep` only:
 *   - guards that the step is `in_progress` and has not already been executed (result-once);
 *   - runs an injected `executor` under a `timeoutMs` + `AbortSignal` discipline that can
 *     NEVER leave the step hanging in `in_progress`;
 *   - writes only declared `step.outputs` slugs through `recordArtifact` (stopping cleanly,
 *     no partial write, when an undeclared slug is returned);
 *   - appends an append-only `step-executed` audit record for the terminal disposition
 *     (success / error / timeout / cancelled);
 *   - on any failure (executor throw, timeout, cancel) writes NO artifact and leaves the
 *     step `in_progress` so it stays rollback-able.
 *
 * No Cordis import — the engine is portable and unit-testable in isolation.
 */

import type { AuditEventKind, ResearchRunStore, StepExecutedRecord } from './types.ts'
import { ResearchError, appendAuditEvent, getRunSnapshot, recordArtifact } from './state-machine.ts'

/** Context handed to the injected executor (its return value is the artifact map). */
export interface StepExecContext {
  readonly runId: string
  readonly stepId: string
  readonly attemptId: number
  /**
   * Cooperative-cancellation signal, equal to the `signal` passed in {@link RunStepOptions}.
   * The pipeline does NOT force-kill the executor: cancellation is cooperative — the executor
   * MUST observe `ctx.signal` (e.g. `signal.addEventListener('abort', …)` / `signal.aborted`)
   * and stop/clean up on its own. The real `AbortSignal` source (timeout coordination, upstream
   * shutdown, etc.) is injected by the upper layer; the pipeline only forwards it.
   */
  readonly signal?: AbortSignal
}

/**
 * Injected executor. May run synchronously or asynchronously, may throw or reject. Its
 * resolved value (or synchronous return) is a slug→value map of artifacts to persist;
 * keys MUST be declared in `step.outputs` (write-boundary enforced via `recordArtifact`).
 */
export type StepExecutor = (ctx: StepExecContext) => Promise<Record<string, unknown>> | Record<string, unknown>

export interface RunStepOptions {
  executor: StepExecutor
  /** Milliseconds; if the executor exceeds it, a deterministic `timeout` failure is recorded (no hang). 0/undefined disables. */
  timeoutMs?: number
  /** Cancellation signal; abort → a deterministic `cancelled` failure is recorded (no hang). */
  signal?: AbortSignal
}

export type RunStepStatus = 'success' | 'error' | 'timeout' | 'cancelled'

/** Result of one {@link runStep} invocation. `ok` is true only for `success`. */
export interface RunStepResult {
  readonly ok: boolean
  readonly status: RunStepStatus
  readonly runId: string
  readonly stepId: string
  readonly attemptId: number
  readonly outputSlugs: ReadonlyArray<string>
  /** Present only when status === 'error'. */
  readonly error?: Error
}

const EXEC_EVENT: AuditEventKind = 'step-executed'

function buildRecord(
  runId: string,
  stepId: string,
  attemptId: number,
  status: RunStepStatus,
  slugs: ReadonlyArray<string>,
  durationMs: number | undefined,
  errorMessage?: string,
): StepExecutedRecord {
  return {
    runId,
    stepId,
    attemptId,
    status,
    outputSlugs: slugs,
    recordedAt: new Date().toISOString(),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  }
}

function emit(store: ResearchRunStore, rec: StepExecutedRecord, error?: Error): RunStepResult {
  appendAuditEvent(store, rec.runId, EXEC_EVENT, rec.stepId, rec.attemptId, rec)
  return {
    ok: rec.status === 'success',
    status: rec.status,
    runId: rec.runId,
    stepId: rec.stepId,
    attemptId: rec.attemptId,
    outputSlugs: rec.outputSlugs,
    ...(error !== undefined ? { error } : {}),
  }
}

/**
 * Execute one step's executor under timeout + abort discipline. Returns a promise resolving
 * to a {@link RunStepResult}. See module docs for the full contract. Throws synchronously
 * (before any async work) on guard failure: unknown step, step not `in_progress`, or the
 * step's current attempt having already been executed (result lands exactly once — a second
 * call on the same attempt throws `DSH_STEP_ALREADY_EXECUTED`).
 *
 * CONCURRENCY: a single attempt must be driven serially. Never invoke `runStep` for the same
 * (runId, stepId, attemptId) concurrently — concurrent invocation semantics are UNDEFINED and
 * may interleave artifact writes / audit appends. The `DSH_STEP_ALREADY_EXECUTED` guard catches
 * a second call only after the first has landed its `step-executed` audit; callers MUST
 * serialize (await the first before issuing the next).
 */
export function runStep(
  store: ResearchRunStore,
  runId: string,
  stepId: string,
  opts: RunStepOptions,
): Promise<RunStepResult> {
  const snap = getRunSnapshot(store, runId)
  const stepSnap = snap.steps[stepId]
  if (!stepSnap) {
    throw new ResearchError('DSH_UNKNOWN_STEP', `runStep: unknown step '${stepId}'`)
  }
  if (stepSnap.status !== 'in_progress') {
    throw new ResearchError('DSH_NOT_IN_PROGRESS', `runStep: step '${stepId}' is not in_progress (status='${stepSnap.status}')`)
  }
  const attemptId = stepSnap.attemptId
  const alreadyExecuted = snap.events.some(
    e => e.kind === EXEC_EVENT && e.stepId === stepId && e.attemptId === attemptId,
  )
  if (alreadyExecuted) {
    throw new ResearchError(
      'DSH_STEP_ALREADY_EXECUTED',
      `runStep: step '${stepId}' attempt ${attemptId} already executed (result lands exactly once)`,
    )
  }

  const signal = opts.signal
  if (signal?.aborted) {
    return Promise.resolve(emit(store, buildRecord(runId, stepId, attemptId, 'cancelled', [], undefined)))
  }

  return new Promise<RunStepResult>((resolve) => {
    let done = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (result: RunStepResult): void => {
      done = true
      if (signal) signal.removeEventListener('abort', onAbort)
      if (timer !== undefined) clearTimeout(timer)
      resolve(result)
    }
    const onAbort = (): void => {
      finish(emit(store, buildRecord(runId, stepId, attemptId, 'cancelled', [], undefined)))
    }
    if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        finish(emit(store, buildRecord(runId, stepId, attemptId, 'timeout', [], undefined)))
      }, opts.timeoutMs)
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })

    const startedAt = Date.now()
    const declared = new Set<string>(stepSnap.outputs)

    Promise.resolve()
      .then(() => opts.executor({ runId, stepId, attemptId, ...(signal !== undefined ? { signal } : {}) }))
      .then((artifacts: unknown) => {
        if (done) return // already timed out / cancelled → ignore late success
        const arts: Record<string, unknown> =
          artifacts !== null && typeof artifacts === 'object' ? (artifacts as Record<string, unknown>) : {}
        const slugs = Object.keys(arts)
        // All-or-nothing write-boundary: validate EVERY returned slug against the declared
        // `step.outputs` set BEFORE persisting anything. If any slug is undeclared we throw
        // (→ error audit) with ZERO artifacts written — no partial write (INV-OUTPUT-CONTRACT).
        for (const slug of slugs) {
          if (!declared.has(slug)) {
            throw new ResearchError(
              'DSH_OUTPUT_NOT_DECLARED',
              `runStep: slug '${slug}' is not declared in step '${stepId}' outputs — INV-OUTPUT-CONTRACT`,
            )
          }
        }
        for (const slug of slugs) {
          recordArtifact(store, runId, stepId, slug, arts[slug])
        }
        finish(emit(store, buildRecord(runId, stepId, attemptId, 'success', slugs, Date.now() - startedAt)))
      })
      .catch((err: unknown) => {
        if (done) return // already timed out / cancelled → ignore late error
        const message = err instanceof Error ? err.message : String(err)
        const rec = buildRecord(runId, stepId, attemptId, 'error', [], Date.now() - startedAt, message)
        const surfaced = err instanceof Error ? err : new ResearchError('DSH_STEP_EXECUTION_FAILED', message, err)
        finish(emit(store, rec, surfaced))
      })
  })
}
