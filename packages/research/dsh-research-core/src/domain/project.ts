/**
 * The project header: what a run is about, and where its state currently stands.
 *
 * This is deliberately no more than a header. The aggregate root of the target design owns
 * questions, protocols, claims and decisions as separate versioned objects, and none of them exist
 * yet — building the whole aggregate before anything consumes it would produce a model with no
 * reader. What is here is the part the commit point needs: an identity, a revision that every
 * committed change advances exactly once, and the recipe version the run was conducted under.
 *
 * THE REVISION IS THE CONCURRENCY CONTROL. Two commits that both read revision 7 cannot both
 * write revision 8; the second is refused and re-reads. That is the whole mechanism, and it works
 * only because nothing else is allowed to advance the counter.
 */

import type { ProjectId, ProjectRevision } from './ids.ts'
import { DOMAIN_ERROR_PREFIX } from './ids.ts'
import type { Parsed } from './ingress.ts'
import { accept, asRecord, countField, numberField, refuse, stringField } from './ingress.ts'

/**
 * What kind of research this project is.
 *
 * The type decides which stages apply, so it is recorded once here rather than inferred from the
 * steps a run happens to have reached.
 */
export type PaperType =
  | 'experimental'
  | 'observational'
  | 'systematic-review'
  | 'theoretical'
  | 'qualitative'
  | 'existing-results'

/** Every {@link PaperType}. */
export const PAPER_TYPES: readonly PaperType[] = [
  'experimental',
  'observational',
  'systematic-review',
  'theoretical',
  'qualitative',
  'existing-results',
]

/** Where a project sits. `stopped` is a person's decision and keeps its evidence; it is not a
 *  failure and does not claim the work is done. */
export type ProjectStatus = 'active' | 'stopped'

/** The header of one research project. */
export interface ResearchProject {
  readonly projectId: ProjectId
  /** Advances by exactly one per committed change. */
  readonly revision: ProjectRevision
  readonly paperType: PaperType
  /** Which workflow recipe this project runs, and at which version. */
  readonly recipeId: string
  readonly recipeVersion: string
  readonly status: ProjectStatus
  readonly createdAt: number
}

/**
 * The revision a commit that succeeds against `current` will hold.
 *
 * @param current - the revision the caller read.
 * @returns the next revision. Advancing is a pure function of the current value, so two callers
 *   that read the same revision compute the same next one and the store can refuse the second.
 */
export function nextProjectRevision(current: ProjectRevision): ProjectRevision {
  return (current + 1) as ProjectRevision
}

/**
 * Read a project header off an untyped boundary.
 *
 * @param value - the value read from a stored record.
 * @returns the header, or the refusal naming the first thing wrong with it.
 */
export function parseProjectIngress(value: unknown): Parsed<ResearchProject> {
  const record = asRecord(value)
  if (record === undefined) {
    return refuse(`${DOMAIN_ERROR_PREFIX}NOT_AN_OBJECT`, 'project record is not an object')
  }
  const projectId = stringField(record, 'projectId')
  if (projectId === undefined) return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "project has no non-empty 'projectId'")
  const revision = countField(record, 'revision')
  if (revision === undefined) return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "project has no integer 'revision'")
  const paperType = record['paperType']
  if (typeof paperType !== 'string' || !(PAPER_TYPES as ReadonlyArray<string>).includes(paperType)) {
    return refuse(
      `${DOMAIN_ERROR_PREFIX}BAD_FIELD`,
      `project has no declared 'paperType' (expected one of ${PAPER_TYPES.join(', ')}): the type decides which stages apply`,
    )
  }
  const recipeId = stringField(record, 'recipeId')
  if (recipeId === undefined) return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "project has no non-empty 'recipeId'")
  const recipeVersion = stringField(record, 'recipeVersion')
  if (recipeVersion === undefined) return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "project has no non-empty 'recipeVersion'")
  if (record['status'] !== 'active' && record['status'] !== 'stopped') {
    return refuse(`${DOMAIN_ERROR_PREFIX}BAD_FIELD`, "project has no usable 'status' (expected active or stopped)")
  }
  const createdAt = numberField(record, 'createdAt')
  if (createdAt === undefined) return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "project has no finite 'createdAt'")
  return accept({
    projectId: projectId as ProjectId,
    revision: revision as ProjectRevision,
    paperType: paperType as PaperType,
    recipeId,
    recipeVersion,
    status: record['status'],
    createdAt,
  })
}
