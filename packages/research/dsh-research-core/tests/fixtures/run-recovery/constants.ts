// Shared constants for the two run-recovery fixture processes. Kept in their own module so the
// reader can name the writer's approval event id without evaluating the writer's top-level code.

/** Fixture approval event id the writer process consumes; the reader must not replay it. */
export const WRITER_APPROVAL_EVENT_ID = 'process-boundary-approval-1'

/** Fixture run id both processes address. */
export const BOUNDARY_RUN_ID = 'run-p5-boundary'
