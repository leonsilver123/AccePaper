/**
 * The run's record of projecting its document onto a working directory.
 *
 * WHY THIS IS AN AUDIT EVENT AND NOT A RETURN VALUE. The projection happens after a step has already
 * committed, and a projection that fails must not fail the step — the work exists, and throwing away
 * a commit in order to complain that a copy of it did not land is the trade `checkpointAfterStep`
 * already refuses. What must not happen is the failure going unsaid: a directory that was never
 * updated looks exactly like one that was, and the person who is editing `manuscript.tex` has no
 * other way to learn that the file they are editing is not the document the run holds.
 *
 * ONLY FAILURES ARE RECORDED. A projection that landed is on disk, which is the record; writing an
 * event per step for every successful projection would put sixteen copies of a file list into the
 * run's log for no reader. The absence of a failure entry therefore means "no projection failed",
 * and a run under a deployment that configured no directory has no entries at all — which is a
 * different fact, carried by the configuration rather than by the log.
 *
 * READ THROUGH THE RUN SNAPSHOT, which is where a reader already looks: `RunSnapshot.events` is the
 * run's append-only log, so the panel and the package checks read the same record this writes.
 */
import { appendAuditEvent, ensureRun } from './state-machine.ts'
import type { AuditEvent, ResearchRunStore } from './types.ts'

/** One failed projection of a run's document onto its working directory. */
export interface ManuscriptProjectionFailure {
  /** The step whose commit this projection followed. */
  readonly stepId: string
  readonly attemptId: number
  /** The directory the projection was aimed at. Recorded so a reader knows which one to look at. */
  readonly directory: string
  /**
   * Why the projection did not land, in the words of whatever refused it.
   *
   * NEVER a second copy of the directory: the field above names where the reader should look, and a
   * message that restated the location would be the machine path said twice.
   */
  readonly reason: string
  /** The manuscript version the projection was reading, when it got as far as reading one. */
  readonly manuscriptVersion?: number
}

/**
 * Record that a run's document could not be projected onto its working directory.
 *
 * Called where the projection failed and nowhere else — see the module header for why a success is
 * not recorded here. It does not throw for a run this store does not hold: the store that drove the
 * step is the one the projection ran against, and a failure that reached this point has already
 * happened, so raising a second error about the run's absence would report the wrong problem.
 *
 * @param store - the run store.
 * @param runId - the run whose projection failed.
 * @param failure - what failed and where it was aimed.
 * @throws {ResearchRunError} when the store holds no such run — a caller recording a failure for a
 *   run that does not exist is one whose own bookkeeping is wrong, and silence would hide it.
 */
export function recordManuscriptProjectionFailure(
  store: ResearchRunStore,
  runId: string,
  failure: ManuscriptProjectionFailure,
): void {
  ensureRun(store, runId)
  appendAuditEvent(store, runId, 'manuscript-projected', failure.stepId, failure.attemptId, {
    ok: false,
    ...failure,
  })
}

/**
 * The projections of one run that failed, in the order they happened.
 *
 * @param events - the run's audit log, as `getRunSnapshot` returns it.
 * @returns one entry per failure. An empty list is a run whose projections all landed, or one under
 *   a deployment that projects nothing.
 */
export function manuscriptProjectionFailuresOf(
  events: ReadonlyArray<Readonly<AuditEvent>>,
): ReadonlyArray<ManuscriptProjectionFailure> {
  return events.flatMap((event): ReadonlyArray<ManuscriptProjectionFailure> => {
    if (event.kind !== 'manuscript-projected') return []
    const detail = event.detail
    if (detail === null || typeof detail !== 'object') return []
    const { stepId, attemptId, directory, reason, manuscriptVersion } = detail as {
      readonly stepId?: unknown
      readonly attemptId?: unknown
      readonly directory?: unknown
      readonly reason?: unknown
      readonly manuscriptVersion?: unknown
    }
    // A RECORD THIS READER CANNOT USE IS SKIPPED RATHER THAN RENDERED: the fields below are what a
    // sentence about the failure is built from, and `String(undefined)` in a refusal a person acts
    // on is worse than an entry it cannot show. The writer is this module, so a malformed entry is a
    // defect in the record rather than input from a boundary.
    if (typeof stepId !== 'string' || typeof attemptId !== 'number'
      || typeof directory !== 'string' || typeof reason !== 'string') {
      return []
    }
    return [{
      stepId,
      attemptId,
      directory,
      reason,
      ...(typeof manuscriptVersion === 'number' ? { manuscriptVersion } : {}),
    }]
  })
}
