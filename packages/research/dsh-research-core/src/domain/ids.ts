/**
 * Identities for the research domain objects.
 *
 * Every id is a branded string, so a value that names an artifact cannot be passed where a value
 * that names a task attempt is due. The brands are the same local idiom `contracts.ts` uses
 * (`string & { readonly __brand: … }`) rather than `dsh-brand`, because this package is the
 * zero-dependency kernel and a brand that costs a workspace dependency would not be free here.
 *
 * VERSIONS ARE NOT IDS. `ArtifactId` names a logical artifact across its whole life;
 * `ArtifactVersion` names one immutable revision of it. A reference carries both, plus the hash
 * of the bytes it meant, so a reader can tell "the artifact" from "the artifact as it was when
 * this statement was written" — the distinction a slug alone cannot express.
 */

/** Names one research project: the aggregate root every other object hangs from. */
export type ProjectId = string & { readonly __brand: 'ProjectId' }
/** Names one logical artifact, stable across its versions. */
export type ArtifactId = string & { readonly __brand: 'ArtifactId' }
/** Names one immutable revision of an artifact. */
export type ArtifactVersion = number & { readonly __brand: 'ArtifactVersion' }
/** Monotonic counter of a project's state; every committed change advances it exactly once. */
export type ProjectRevision = number & { readonly __brand: 'ProjectRevision' }
/** Names one scheduled unit of work, stable across its attempts. */
export type TaskId = string & { readonly __brand: 'TaskId' }
/** Names one execution of a task. A retry is a NEW attempt id, never the same one reused. */
export type TaskAttemptId = string & { readonly __brand: 'TaskAttemptId' }
/** Names one lease: the exclusive right of one attempt to write for a bounded time. */
export type LeaseId = string & { readonly __brand: 'LeaseId' }
/** Names one gate report. */
export type GateReportId = string & { readonly __brand: 'GateReportId' }

/** SHA-256 of an artifact's bytes, lower-case hex. Opaque on purpose: the only operations that
 *  matter are equality and inclusion in a report, and both are string operations. */
export type ContentHash = string & { readonly __brand: 'ContentHash' }

/** SHA-256 over the ordered input references of a task attempt, lower-case hex. It answers
 *  "were these the same inputs?", which is what makes a report reusable or stale. */
export type InputDigest = string & { readonly __brand: 'InputDigest' }

/** Stable code namespace for the domain-object parsers. */
export const DOMAIN_ERROR_PREFIX = 'DSH_DOMAIN_'
