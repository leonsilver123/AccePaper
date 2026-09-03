// @deepseek-ai/dsh-research-team — compare-and-set research task board.
//
// ADAPTER LAYER (T20). The task board is the durable coordination layer that
// turns the pure CAS engine (`revision.ts`) into a log-backed service:
//   - every mutation runs inside a per-root journal transaction, so the
//     read-check-append (projection read → pure authorization/transition →
//     append whole-value snapshot) is atomic per team;
//   - the pure `applyTaskAction` enforces the owner-or-lead authorization
//     matrix, claim readiness, dependency cycles, and the monotonic
//     `expectedRevision` compare-and-set;
//   - `REVISION_CONFLICT` (a stale CAS intent) surfaces as
//     `{ ok: false, error: { code: 'team-task-conflict' } }`, while every other
//     domain rejection surfaces as `'team-rejected'` — the typed mutation
//     envelope the future tool layer consumes. Unexpected failures still throw.
//
// Task identity is caller-visible and durable: creations reserve a fresh id
// inside the transaction and append the revision-one whole-value snapshot.

import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEventMap } from '@deepseek-ai/dsh-session'
import type { ResearchJournal } from './journal.ts'
import { applyTaskAction } from './revision.ts'
import type { TaskMutationInput } from './revision.ts'
import { normalizeWriteScopes } from './revision.ts'
import type { ResearchMembership } from './roster.ts'
import {
  ResearchTeamError,
  taskId,
  TeamId,
} from './types.ts'
import { DSH_RESEARCH_TEAM_ERROR_PREFIX } from './types.ts'
import type {
  ResearchTask,
  SessionId,
  TeamMutationResult,
  TeamTaskAction,
  TeamTaskId,
} from './types.ts'

const CONFLICT_CODE = `${DSH_RESEARCH_TEAM_ERROR_PREFIX}REVISION_CONFLICT`

/** Payload of one whole-value `research/task` append. */
type ResearchTaskPayload = SessionEventMap['research/task']

/** Request body for creating one unowned pending research task. */
export interface CreateResearchTaskRequest {
  readonly subject: string
  readonly description: string
  /** Task ids that must all complete before this task can be claimed. */
  readonly blockedBy?: ReadonlyArray<TeamTaskId>
  /** Advisory normalized write-scope prefixes (overlap only warns). */
  readonly writeScopes?: ReadonlyArray<string>
}

/** Compare-and-set mutation intent for one task action. */
export interface UpdateResearchTaskRequest {
  readonly taskId: TeamTaskId
  /** Whole-value revision the caller based its intent on (CAS). */
  readonly expectedRevision: number
  readonly action: TeamTaskAction
  readonly writeScopes?: ReadonlyArray<string>
  readonly blockedBy?: ReadonlyArray<TeamTaskId>
  readonly newOwnerId?: SessionId
  readonly subject?: string
  readonly description?: string
}

/** Owns research task creation, reads, and serialized CAS transitions. */
export class ResearchTaskBoard {
  /**
   * @param journal - authoritative Lead-log transaction owner.
   */
  constructor(private readonly journal: ResearchJournal) {}

  /**
   * Create one unowned pending task in the research Lead log.
   * @param membership - exact caller membership resolved by the roster.
   * @param request - task text, blockers, and advisory write scopes.
   * @returns the committed revision-one task snapshot.
   */
  async create(
    membership: ResearchMembership,
    request: CreateResearchTaskRequest,
  ): Promise<ResearchTask> {
    const root = membership.root
    return this.journal.transact(root.id, async () => {
      const state = this.journal.state(root)
      const task: ResearchTask = {
        id: taskId(randomUUID()),
        revision: 1,
        subject: requiredText(request.subject, 'subject', 200),
        description: requiredText(request.description, 'description', 16_384),
        status: 'pending',
        blockedBy: this.dependencies(state.tasks, request.blockedBy ?? [], undefined),
        writeScopes: normalizeWriteScopes(request.writeScopes ?? []),
      }
      await this.appendTask(root, task)
      return task
    })
  }

  /**
   * Return one task snapshot, including a deleted tombstone.
   * @param membership - exact caller membership resolved by the roster.
   * @param id - team-local task identity.
   * @returns the latest task snapshot.
   */
  get(membership: ResearchMembership, id: TeamTaskId): ResearchTask {
    const task = this.journal.state(membership.root).tasks[id as unknown as string]
    if (task === undefined) {
      throw new ResearchTeamError(
        `${DSH_RESEARCH_TEAM_ERROR_PREFIX}TASK_NOT_FOUND`,
        `research task "${id}" not found`,
      )
    }
    return task
  }

  /**
   * List the current non-deleted task snapshots in arbitrary order.
   * @param membership - exact caller membership resolved by the roster.
   * @returns detached current task snapshots.
   */
  list(membership: ResearchMembership): ResearchTask[] {
    return Object.values(this.journal.state(membership.root).tasks)
      .filter(task => task.status !== 'deleted')
  }

  /**
   * Compare-and-set one authorized task transition.
   * @param membership - exact caller membership resolved by the roster.
   * @param request - task identity, expected revision, action, and action fields.
   * @returns the committed next snapshot, or a typed conflict/rejection result
   * for research-domain denials. Unexpected failures still throw.
   */
  async update(
    membership: ResearchMembership,
    request: UpdateResearchTaskRequest,
  ): Promise<TeamMutationResult> {
    const root = membership.root
    try {
      const value = await this.journal.transact(root.id, async () => {
        const state = this.journal.state(root)
        const input: TaskMutationInput = {
          action: request.action,
          taskId: request.taskId,
          expectedRevision: request.expectedRevision,
          actor: { role: membership.role, id: membership.memberId },
          board: Object.values(state.tasks),
          ...request.writeScopes === undefined ? {} : { writeScopes: request.writeScopes },
          ...request.blockedBy === undefined ? {} : { blockedBy: request.blockedBy },
          ...request.newOwnerId === undefined ? {} : { newOwnerId: request.newOwnerId },
          ...request.subject === undefined ? {} : { subject: request.subject },
          ...request.description === undefined ? {} : { description: request.description },
        }
        const next = applyTaskAction(input)
        await this.appendTask(root, next)
        return next
      })
      return { ok: true, value }
    } catch (error: unknown) {
      if (!(error instanceof ResearchTeamError)) throw error
      return {
        ok: false,
        error: {
          code: error.code === CONFLICT_CODE ? 'team-task-conflict' : 'team-rejected',
          message: error.message,
        },
      }
    }
  }

  /** Append one whole-value task snapshot to the Lead log. */
  private async appendTask(root: Agent, task: ResearchTask): Promise<void> {
    const payload: ResearchTaskPayload = { version: 1, teamId: TeamId(root.id), task }
    await this.journal.appendAndFlush(root, 'research/task', payload)
  }

  /** Canonicalize a blockedBy list: dedupe/sort, reject self and unknown/deleted blockers. */
  private dependencies(
    tasks: Readonly<Record<string, ResearchTask>>,
    values: ReadonlyArray<TeamTaskId>,
    self: TeamTaskId | undefined,
  ): ReadonlyArray<TeamTaskId> {
    const board = Object.values(tasks)
    const unique: TeamTaskId[] = []
    for (const id of values) {
      if (id === self) {
        throw new ResearchTeamError(
          `${DSH_RESEARCH_TEAM_ERROR_PREFIX}DEPENDENCY_CYCLE`,
          `research task "${id}" cannot block itself`,
        )
      }
      const blocker = board.find(candidate => candidate.id === id)
      if (blocker === undefined) {
        throw new ResearchTeamError(
          `${DSH_RESEARCH_TEAM_ERROR_PREFIX}TASK_NOT_FOUND`,
          `blocker task "${id}" does not exist on the board`,
        )
      }
      if (blocker.status === 'deleted') {
        throw new ResearchTeamError(
          `${DSH_RESEARCH_TEAM_ERROR_PREFIX}TASK_DELETED`,
          `blocker task "${id}" is deleted and cannot be a dependency`,
        )
      }
      if (!unique.includes(id)) unique.push(id)
    }
    return unique.sort()
  }
}

/** Require a trimmed, bounded text field (malformed caller input). */
function requiredText(value: string, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} is required`)
  }
  return value.trim().slice(0, maxLength)
}
